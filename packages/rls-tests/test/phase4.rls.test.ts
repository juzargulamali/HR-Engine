import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Every asUser() call is its own transaction that always rolls back (see
// harness.ts) — a scenario needing a second actor mid-flow (Finance
// deciding after the manager, then CEO after Finance) must switch identity
// with actAs() inside ONE asUser() call, never chain separate asUser() calls
// expecting one's writes to be visible to the next (docs/09, and the exact
// bug this file's own author fixed once already in phase3.rls.test.ts).
async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY_A = "00000000-0000-0000-0000-0000000004a1";

const USER_MANAGER = "00000000-0000-0000-0000-0000000004b1";
const USER_REPORT = "00000000-0000-0000-0000-0000000004b2";
const USER_HR = "00000000-0000-0000-0000-0000000004b3";
const USER_FINANCE = "00000000-0000-0000-0000-0000000004b4";
const USER_CEO = "00000000-0000-0000-0000-0000000004b5";
const USER_PEER = "00000000-0000-0000-0000-0000000004b6";

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000004c1";
const EMPLOYEE_REPORT = "00000000-0000-0000-0000-0000000004c2";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-0000000004c3";

describe("Phase 4 row-level security: projects, reimbursements, timesheets, attendance", () => {
  const db = new RlsTestDatabase();
  let reimbursementWorkflowId: string;
  let timesheetWorkflowId: string;

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_MANAGER}', 'p4-manager@enginious.ae'),
        ('${USER_REPORT}', 'p4-report@enginious.ae'),
        ('${USER_HR}', 'p4-hr@enginious.ae'),
        ('${USER_FINANCE}', 'p4-finance@enginious.ae'),
        ('${USER_CEO}', 'p4-ceo@enginious.ae'),
        ('${USER_PEER}', 'p4-peer@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Phase 4 Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'P4-01', '${COMPANY_A}', 'ZZ', 'Mona', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'P4-02', '${COMPANY_A}', 'ZZ', 'Remy', 'Report', '2024-02-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'P4-03', '${COMPANY_A}', 'ZZ', 'Pia', 'Peer', '2024-02-01');
      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_REPORT}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_FINANCE}', 'finance', '${COMPANY_A}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_A}');
    `);

    const { rows } = await db.asUser(USER_HR, (query) =>
      query(
        "select id, entity_type from approval_workflows where company_id = $1 and entity_type in ('reimbursement_claim', 'timesheet')",
        [COMPANY_A],
      ),
    );
    reimbursementWorkflowId = rows.find((r) => r.entity_type === "reimbursement_claim")?.id;
    timesheetWorkflowId = rows.find((r) => r.entity_type === "timesheet")?.id;
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("auto-creates default one-step (direct manager) workflows for reimbursement_claim and timesheet on company creation", async () => {
    // Later phases (letters, payroll) add their own entity types to this
    // same auto-provisioning trigger, so this only asserts Phase 4's own
    // contribution is present, not the full current set.
    const { rows } = await db.asUser(USER_HR, (query) =>
      query("select entity_type from approval_workflows where company_id = $1", [COMPANY_A]),
    );
    const entityTypes = rows.map((r) => r.entity_type);
    expect(entityTypes).toEqual(expect.arrayContaining(["leave_request", "reimbursement_claim", "timesheet"]));
    expect(reimbursementWorkflowId).toBeTruthy();
    expect(timesheetWorkflowId).toBeTruthy();
  });

  describe("projects", () => {
    it("lets HR Admin create a project", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("insert into projects (company_id, code, name) values ($1, 'HR-CREATED', 'HR rollout') returning id", [COMPANY_A]),
      );
      expect(rows.length).toBe(1);
    });

    it("lets any signed-in user read projects (needed to pick one on a timesheet/claim line), blocks a peer from writing", async () => {
      await db.seed(`insert into projects (company_id, code, name) values ('${COMPANY_A}', 'ACME', 'Acme rollout');`);

      const readByPeer = await db.asUser(USER_PEER, (query) => query("select code from projects where company_id = $1", [COMPANY_A]));
      expect(readByPeer.rows.map((r) => r.code)).toContain("ACME");

      await expect(
        db.asUser(USER_PEER, (query) =>
          query("insert into projects (company_id, code, name) values ($1, 'SNEAKY', 'Should fail')", [COMPANY_A]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("project_allocations", () => {
    it("lets the employee and their manager read an allocation, blocks an unrelated peer, HR Admin manages", async () => {
      const projectId = "00000000-0000-0000-0000-0000000004d1";
      // Seeded via the admin pool, not asUser(): every asUser() call is its
      // own transaction that always rolls back (see harness.ts), so an
      // insert made there would never be visible to a later asUser() read.
      await db.seed(`
        insert into projects (id, company_id, code, name) values ('${projectId}', '${COMPANY_A}', 'ALLOC', 'Allocation project');
        insert into project_allocations (employee_id, project_id, allocation_percent, start_date)
        values ('${EMPLOYEE_REPORT}', '${projectId}', 50, '2024-03-01');
      `);

      const selfRead = await db.asUser(USER_REPORT, (query) =>
        query("select id from project_allocations where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(selfRead.rows.length).toBe(1);

      const managerRead = await db.asUser(USER_MANAGER, (query) =>
        query("select id from project_allocations where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(managerRead.rows.length).toBe(1);

      const peerRead = await db.asUser(USER_PEER, (query) =>
        query("select id from project_allocations where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(peerRead.rows.length).toBe(0);

      await expect(
        db.asUser(USER_PEER, (query) =>
          query(
            "insert into project_allocations (employee_id, project_id, allocation_percent, start_date) values ($1, $2, 100, '2024-03-01')",
            [EMPLOYEE_PEER, projectId],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const hrInsert = await db.asUser(USER_HR, (query) =>
        query(
          "insert into project_allocations (employee_id, project_id, allocation_percent, start_date) values ($1, $2, 100, '2024-03-01') returning id",
          [EMPLOYEE_PEER, projectId],
        ),
      );
      expect(hrInsert.rows.length).toBe(1);
    });
  });

  describe("reimbursement claims: lifecycle and total_amount trigger", () => {
    it("lets an employee create a draft claim and add lines, keeping total_amount in sync automatically", async () => {
      await db.asUser(USER_REPORT, async (query) => {
        const { rows: claimRows } = await query(
          "insert into reimbursement_claims (employee_id, currency) values ($1, 'ZZD') returning id, status, total_amount",
          [EMPLOYEE_REPORT],
        );
        expect(claimRows[0]?.status).toBe("draft");
        expect(Number(claimRows[0]?.total_amount)).toBe(0);
        const claimId = claimRows[0]?.id;

        await query(
          "insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ($1, 1, '2026-01-01', 'travel', 120.50)",
          [claimId],
        );
        const afterOneLine = await query("select total_amount from reimbursement_claims where id = $1", [claimId]);
        expect(Number(afterOneLine.rows[0]?.total_amount)).toBe(120.5);

        await query(
          "insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ($1, 2, '2026-01-02', 'meals', 30)",
          [claimId],
        );
        const afterTwoLines = await query("select total_amount from reimbursement_claims where id = $1", [claimId]);
        expect(Number(afterTwoLines.rows[0]?.total_amount)).toBe(150.5);
      });
    });

    it("blocks submitting a claim for someone else", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) => query("insert into reimbursement_claims (employee_id, currency) values ($1, 'ZZD')", [EMPLOYEE_PEER])),
      ).rejects.toThrow(/row-level security/);
    });

    // Regression test: guard_reimbursement_claim_total() (fourth audit pass)
    // now fires before insert or update on reimbursement_claims itself, not
    // just on its lines — the lines-recompute trigger only ever fired on
    // reimbursement_claim_lines, so nothing stopped an employee setting
    // total_amount directly on the claim row, a value that flows straight
    // into generate_payroll_export_lines()'s payroll export or could be
    // deflated to dodge an amount-gated approval step.
    it("recomputes total_amount from its lines on a direct client UPDATE, ignoring any client-supplied value", async () => {
      await db.asUser(USER_REPORT, async (query) => {
        const { rows: claimRows } = await query(
          "insert into reimbursement_claims (employee_id, currency) values ($1, 'ZZD') returning id",
          [EMPLOYEE_REPORT],
        );
        const claimId = claimRows[0]?.id;

        await query(
          "insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ($1, 1, '2026-01-01', 'travel', 40)",
          [claimId],
        );

        const attempt = await query(
          "update reimbursement_claims set total_amount = 999999 where id = $1 returning total_amount",
          [claimId],
        );
        expect(Number(attempt.rows[0]?.total_amount)).toBe(40); // recomputed from the one real 40 line, not the attempted 999999

        const reread = await query("select total_amount from reimbursement_claims where id = $1", [claimId]);
        expect(Number(reread.rows[0]?.total_amount)).toBe(40);
      });
    });

    it("recomputes total_amount to 0 on a direct client UPDATE when the claim has no lines at all", async () => {
      await db.asUser(USER_REPORT, async (query) => {
        const { rows: claimRows } = await query(
          "insert into reimbursement_claims (employee_id, currency) values ($1, 'ZZD') returning id",
          [EMPLOYEE_REPORT],
        );
        const claimId = claimRows[0]?.id;

        const attempt = await query(
          "update reimbursement_claims set total_amount = 500 where id = $1 returning total_amount",
          [claimId],
        );
        expect(Number(attempt.rows[0]?.total_amount)).toBe(0);
      });
    });

    it("blocks editing claim lines once the claim is no longer a draft", async () => {
      const requestId = randomUUID();
      await db.seed(`
        insert into reimbursement_claims (id, employee_id, currency, status) values ('${requestId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');
      `);
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query("insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ($1, 1, '2026-01-01', 'late', 10)", [
            requestId,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("lets the manager, HR Admin, Finance, and CEO see a claim; blocks an unrelated peer", async () => {
      const requestId = randomUUID();
      await db.seed(`insert into reimbursement_claims (id, employee_id, currency, status) values ('${requestId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');`);

      for (const viewer of [USER_MANAGER, USER_HR, USER_FINANCE, USER_CEO]) {
        const { rows } = await db.asUser(viewer, (query) => query("select id from reimbursement_claims where id = $1", [requestId]));
        expect(rows.length).toBe(1);
      }
      const peerView = await db.asUser(USER_PEER, (query) => query("select id from reimbursement_claims where id = $1", [requestId]));
      expect(peerView.rows).toEqual([]);
    });

    // Regression coverage for the exact blind spot that hid the original
    // is_entity_owner() bug (see phase6's generated_letter/payroll_export_run
    // tests, and the phase3 leave_request equivalent): every OTHER approvable
    // entity type has a test that inserts its first approvals row through the
    // real RLS path (asUser(), not the seed() bypass) — reimbursement_claim
    // and timesheet didn't, so a regression in is_entity_owner() specific to
    // either of them could have gone undetected indefinitely.
    it("lets the requester create the first approval via create_initial_approval() on their own just-submitted claim", async () => {
      const claimId = randomUUID();
      await db.seed(`insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');`);
      const { rows } = await db.asUser(USER_REPORT, async (query) => {
        const { rows: created } = await query("select create_initial_approval('reimbursement_claim', $1) as id", [claimId]);
        return query("select decision from approvals where id = $1", [created[0]?.id]);
      });
      expect(rows).toEqual([{ decision: "pending" }]);
    });

    it("blocks a peer from creating the first approval on someone else's claim", async () => {
      const claimId = randomUUID();
      await db.seed(`insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');`);
      await expect(
        db.asUser(USER_PEER, (query) => query("select create_initial_approval('reimbursement_claim', $1)", [claimId])),
      ).rejects.toThrow(/do not own this/);
    });

    // Regression test: approvals_insert_initial never validated workflow_id
    // or approver_id, so any owner could forge a self-approving first
    // approval row directly. There is no INSERT policy on approvals at all
    // anymore — create_initial_approval() is the only way in.
    it("blocks a direct client INSERT into approvals entirely, even from the claim's own owner", async () => {
      const claimId = randomUUID();
      await db.seed(`insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');`);
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
             values ('reimbursement_claim', $1, $2, 1, $3)`,
            [claimId, reimbursementWorkflowId, USER_REPORT],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("timesheet approval: initial insert (real RLS path)", () => {
    it("lets the requester create the first approval via create_initial_approval() on their own just-submitted timesheet", async () => {
      const timesheetId = randomUUID();
      await db.seed(`insert into timesheets (id, employee_id, period_start, period_end, status) values ('${timesheetId}', '${EMPLOYEE_REPORT}', '2026-05-04', '2026-05-10', 'submitted');`);
      const { rows } = await db.asUser(USER_REPORT, async (query) => {
        const { rows: created } = await query("select create_initial_approval('timesheet', $1) as id", [timesheetId]);
        return query("select decision from approvals where id = $1", [created[0]?.id]);
      });
      expect(rows).toEqual([{ decision: "pending" }]);
    });

    it("blocks a peer from creating the first approval on someone else's timesheet", async () => {
      const timesheetId = randomUUID();
      await db.seed(`insert into timesheets (id, employee_id, period_start, period_end, status) values ('${timesheetId}', '${EMPLOYEE_REPORT}', '2026-05-11', '2026-05-17', 'submitted');`);
      await expect(
        db.asUser(USER_PEER, (query) => query("select create_initial_approval('timesheet', $1)", [timesheetId])),
      ).rejects.toThrow(/do not own this/);
    });
  });

  describe("create_initial_approval(): idempotent on a double-submitted entity", () => {
    // Regression test: approvals had no constraint stopping a second step-1
    // row from being created for the same entity. reimbursement_claims and
    // timesheets (unlike leave_requests, which always inserts a fresh row)
    // submit against an EXISTING row — a double-clicked "Submit for
    // approval" could race past every check in create_initial_approval()
    // and insert twice, and deciding that stale duplicate later could
    // re-walk the whole workflow and regress an already-finalized entity
    // back to pending. create_initial_approval() now checks for an existing
    // step-1 row first and returns it instead of inserting again, backed by
    // approvals_entity_type_entity_id_step_order_key as the race-safe
    // backstop.
    it("returns the same approval id on a second call for the same claim, and never creates a second step-1 row", async () => {
      const claimId = randomUUID();
      await db.seed(`insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');`);

      await db.asUser(USER_REPORT, async (query) => {
        const { rows: first } = await query("select create_initial_approval('reimbursement_claim', $1) as id", [claimId]);
        const { rows: second } = await query("select create_initial_approval('reimbursement_claim', $1) as id", [claimId]);
        expect(first[0]?.id).toBeTruthy();
        expect(second[0]?.id).toBe(first[0]?.id);

        const count = await query(
          "select count(*) from approvals where entity_type = 'reimbursement_claim' and entity_id = $1 and step_order = 1",
          [claimId],
        );
        expect(Number(count.rows[0]?.count)).toBe(1);
      });
    });
  });

  describe("comp_day_ledger: attendance-credit dedup constraint", () => {
    // Regression test: bulkRecordAttendance()'s "already credited?" check
    // was a plain SELECT immediately followed by an INSERT, with no lock in
    // between — two concurrent saves for the same attendance record (a
    // double-clicked "Save" on the daily register, or two admins editing the
    // same date) could both pass it and both insert an 'earned' comp-day
    // credit, doubling the day. comp_day_ledger_attendance_uniq backs that
    // check with a real partial unique index scoped to
    // reference_type = 'attendance_record' only — a real or fixture UUID is
    // fine here, since the constraint only cares about uniqueness, not FK
    // validity.
    it("rejects a second comp_day_ledger row crediting the same attendance_record, but allows the same reference_id under a different reference_type", async () => {
      const referenceId = randomUUID();
      await db.seed(`
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
        values ('${EMPLOYEE_REPORT}', '2026-04-10', 'earned', 1, 'attendance_record', '${referenceId}', '${USER_HR}');
      `);

      await expect(
        db.seed(`
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
          values ('${EMPLOYEE_REPORT}', '2026-04-10', 'earned', 1, 'attendance_record', '${referenceId}', '${USER_HR}');
        `),
      ).rejects.toThrow(/duplicate key value violates unique constraint/);

      // Same reference_id, but a different reference_type — the partial
      // index only scopes to 'attendance_record', so this must succeed.
      await db.seed(`
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
        values ('${EMPLOYEE_REPORT}', '2026-04-10', 'redeemed', -1, 'leave_request', '${referenceId}', '${USER_HR}');
      `);
    });
  });

  describe("reimbursement approval: threshold-based routing", () => {
    let stepFinanceId: string;
    let stepCeoId: string;

    beforeAll(async () => {
      stepFinanceId = randomUUID();
      stepCeoId = randomUUID();
      await db.seed(`
        insert into approval_workflow_steps (id, workflow_id, step_order, approver_type, condition) values
          ('${stepFinanceId}', '${reimbursementWorkflowId}', 2, 'role:finance', '{"amount_gt": 1000}'::jsonb),
          ('${stepCeoId}', '${reimbursementWorkflowId}', 3, 'role:ceo', '{"amount_gt": 1000}'::jsonb);
      `);
    });

    afterAll(async () => {
      await db.seed(`delete from approval_workflow_steps where id in ('${stepFinanceId}', '${stepCeoId}');`);
    });

    async function seedSubmittedClaim(amount: number) {
      const claimId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'submitted');
        insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ('${claimId}', 1, '2026-01-01', 'travel', ${amount});
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'reimbursement_claim', '${claimId}', '${reimbursementWorkflowId}', 1, '${USER_MANAGER}');
      `);
      return { claimId, approvalId };
    }

    it("finalizes a small claim after the manager's single step — never escalates to Finance/CEO", async () => {
      const { claimId, approvalId } = await seedSubmittedClaim(50);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        const claim = await query("select status from reimbursement_claims where id = $1", [claimId]);
        expect(claim.rows[0]?.status).toBe("approved");

        const anyFurtherSteps = await query("select id from approvals where entity_id = $1 and step_order > 1", [claimId]);
        expect(anyFurtherSteps.rows).toEqual([]);
      });
    });

    it("routes a large claim manager -> Finance -> CEO in order, finalizing only after all three decide", async () => {
      const { claimId, approvalId } = await seedSubmittedClaim(5000);

      // All three decisions happen inside ONE transaction, switching actor
      // with actAs() between them — decide_leave_approval()'s writes only
      // exist within the transaction that made them, so a real multi-actor
      // chain has to be simulated this way, not as three separate asUser()
      // calls (each of which would roll back before the next one starts).
      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        const afterStep1 = await query("select status from reimbursement_claims where id = $1", [claimId]);
        expect(afterStep1.rows[0]?.status).toBe("pending_approval");

        await actAs(query, USER_FINANCE);
        const step2 = await query("select id, decision from approvals where entity_id = $1 and step_order = 2", [claimId]);
        expect(step2.rows[0]?.decision).toBe("pending");
        await query("select decide_leave_approval($1, 'approved', null)", [step2.rows[0]?.id]);

        const afterStep2 = await query("select status from reimbursement_claims where id = $1", [claimId]);
        expect(afterStep2.rows[0]?.status).toBe("pending_approval");

        await actAs(query, USER_CEO);
        const step3 = await query("select id, decision from approvals where entity_id = $1 and step_order = 3", [claimId]);
        expect(step3.rows[0]?.decision).toBe("pending");
        await query("select decide_leave_approval($1, 'approved', null)", [step3.rows[0]?.id]);

        const final = await query("select status, decided_at from reimbursement_claims where id = $1", [claimId]);
        expect(final.rows[0]?.status).toBe("approved");
        expect(final.rows[0]?.decided_at).not.toBeNull();
      });
    });

    it("stops the chain on rejection at any step, leaving later steps never created", async () => {
      const { claimId, approvalId } = await seedSubmittedClaim(5000);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'rejected', 'not a valid expense')", [approvalId]);
        const claim = await query("select status from reimbursement_claims where id = $1", [claimId]);
        expect(claim.rows[0]?.status).toBe("rejected");

        const laterSteps = await query("select id from approvals where entity_id = $1 and step_order > 1", [claimId]);
        expect(laterSteps.rows).toEqual([]);
      });
    });

    it("skips step 2 straight to step 3 when the requester themselves is the only Finance role holder (self-approval prevention)", async () => {
      // Make USER_REPORT the ONLY finance holder in the company (revoke
      // Finance's own grant, add it to the requester) so resolve_approver()
      // has no other candidate to pick — unlike phase3's leave_request
      // equivalent (which can't force the scenario because an earlier
      // hr_admin holder always wins the earliest-granted tiebreak), this
      // deterministically forces the self-approval branch to fire.
      await db.seed(`
        update user_roles set revoked_at = now() where user_id = '${USER_FINANCE}' and role = 'finance';
        insert into user_roles (user_id, role, company_id) values ('${USER_REPORT}', 'finance', '${COMPANY_A}');
      `);
      try {
        const { claimId, approvalId } = await seedSubmittedClaim(5000);

        await db.asUser(USER_MANAGER, async (query) => {
          await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

          // Step 2 (role:finance) resolves to USER_REPORT — the requester —
          // so it must be skipped entirely; step 3 (role:ceo) is where this
          // lands instead.
          const step2 = await query("select id from approvals where entity_id = $1 and step_order = 2", [claimId]);
          expect(step2.rows).toEqual([]);

          await actAs(query, USER_CEO);
          const step3 = await query("select approver_id, decision from approvals where entity_id = $1 and step_order = 3", [claimId]);
          expect(step3.rows[0]).toEqual({ approver_id: USER_CEO, decision: "pending" });

          const status = await query("select status from reimbursement_claims where id = $1", [claimId]);
          expect(status.rows[0]?.status).toBe("pending_approval");
        });
      } finally {
        await db.seed(`
          update user_roles set revoked_at = null where user_id = '${USER_FINANCE}' and role = 'finance';
          delete from user_roles where user_id = '${USER_REPORT}' and role = 'finance';
        `);
      }
    });

    it("aborts the decision (rather than silently finalizing) when a required step's role has no current holder", async () => {
      // No one at all holds 'finance' in this company for the duration of
      // this test — the exact real-world gap the payroll control-bypass fix
      // targets, exercised here against reimbursement_claim since this
      // describe block already has a two-step (Finance -> CEO) workflow
      // wired up for a >1000 claim.
      await db.seed(`update user_roles set revoked_at = now() where user_id = '${USER_FINANCE}' and role = 'finance';`);
      try {
        const { approvalId } = await seedSubmittedClaim(5000);

        // Every asUser() call's transaction always rolls back at the end
        // (see harness.ts) — a rejected call has nothing to check
        // afterward, so this asserts only the exception itself, same as
        // phase3's "blocks deciding the same approval twice".
        await expect(
          db.asUser(USER_MANAGER, (query) => query("select decide_leave_approval($1, 'approved', null)", [approvalId])),
        ).rejects.toThrow(/no one currently holds/);
      } finally {
        await db.seed(`update user_roles set revoked_at = null where user_id = '${USER_FINANCE}' and role = 'finance';`);
      }
    });
  });

  describe("timesheets", () => {
    it("lets an employee create a draft timesheet and entries, blocks entries once submitted", async () => {
      await db.asUser(USER_REPORT, async (query) => {
        const { rows } = await query(
          "insert into timesheets (employee_id, period_start, period_end) values ($1, '2026-02-02', '2026-02-08') returning id, status",
          [EMPLOYEE_REPORT],
        );
        expect(rows[0]?.status).toBe("draft");
        const timesheetId = rows[0]?.id;

        await query("insert into timesheet_entries (timesheet_id, work_date, hours) values ($1, '2026-02-02', 8)", [timesheetId]);

        // The owner's own draft -> submitted transition is allowed by
        // timesheets_update_draft — no admin bypass needed here.
        await query("update timesheets set status = 'submitted' where id = $1", [timesheetId]);

        await expect(
          query("insert into timesheet_entries (timesheet_id, work_date, hours) values ($1, '2026-02-03', 8)", [timesheetId]),
        ).rejects.toThrow(/row-level security/);
      });
    });

    it("enforces the 24-hour-per-entry cap regardless of who inserts it", async () => {
      const timesheetId = randomUUID();
      await db.seed(`insert into timesheets (id, employee_id, period_start, period_end) values ('${timesheetId}', '${EMPLOYEE_REPORT}', '2026-02-09', '2026-02-15');`);
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query("insert into timesheet_entries (timesheet_id, work_date, hours) values ($1, '2026-02-09', 25)", [timesheetId]),
        ),
      ).rejects.toThrow(/hours/);
    });

    it("lets the manager, HR Admin, and Finance see a timesheet; blocks an unrelated peer", async () => {
      const timesheetId = randomUUID();
      await db.seed(`insert into timesheets (id, employee_id, period_start, period_end, status) values ('${timesheetId}', '${EMPLOYEE_REPORT}', '2026-02-16', '2026-02-22', 'submitted');`);

      for (const viewer of [USER_MANAGER, USER_HR, USER_FINANCE]) {
        const { rows } = await db.asUser(viewer, (query) => query("select id from timesheets where id = $1", [timesheetId]));
        expect(rows.length).toBe(1);
      }
      const peerView = await db.asUser(USER_PEER, (query) => query("select id from timesheets where id = $1", [timesheetId]));
      expect(peerView.rows).toEqual([]);
    });

    // Timesheets are deprecated: decide_leave_approval() used to convert
    // approved overtime into comp_day_ledger 'earned' entries here, but that
    // conversion compared a WHOLE timesheet period's hours against a
    // "weekly" threshold — timesheets can be any length (the UI's own
    // comment calls the default weekly range "freely editable"), so a
    // monthly timesheet could wildly over-credit comp days for perfectly
    // normal work. Attendance's bulkRecordAttendance now owns comp-day
    // crediting for weekend/holiday work instead (phase4's own "attendance
    // records" describe block below, and phase 5's bulk-attendance tests).
    // This just confirms approving a timesheet no longer posts anything,
    // even with an active overtime_rules policy still configured.
    it("approving a timesheet posts nothing to comp_day_ledger, even with an active overtime_rules policy in place", async () => {
      await db.seed(`
        insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by) values
          ('${randomUUID()}', 'ZZ', 'overtime_rules', 1, '2020-01-01', 'active',
           '{"weekly_threshold_hours": 40, "comp_day_conversion_ratio": 8}'::jsonb, '${USER_HR}')
        on conflict do nothing;
      `);

      const timesheetId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into timesheets (id, employee_id, period_start, period_end, status)
          values ('${timesheetId}', '${EMPLOYEE_REPORT}', '2026-03-02', '2026-03-08', 'submitted');
        insert into timesheet_entries (timesheet_id, work_date, hours) values
          ('${timesheetId}', '2026-03-02', 10),
          ('${timesheetId}', '2026-03-03', 10),
          ('${timesheetId}', '2026-03-04', 10),
          ('${timesheetId}', '2026-03-05', 10),
          ('${timesheetId}', '2026-03-06', 8);
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'timesheet', '${timesheetId}', '${timesheetWorkflowId}', 1, '${USER_MANAGER}');
      `);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

        const timesheet = await query("select status from timesheets where id = $1", [timesheetId]);
        expect(timesheet.rows[0]?.status).toBe("approved");

        const compEntries = await query("select id from comp_day_ledger where employee_id = $1 and reference_id = $2", [
          EMPLOYEE_REPORT,
          timesheetId,
        ]);
        expect(compEntries.rows).toEqual([]);
      });
    });
  });

  describe("attendance records", () => {
    it("lets the employee, manager, and HR Admin see an attendance record; blocks a peer; only HR Admin writes", async () => {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-04-01', 'present');`);

      for (const viewer of [USER_REPORT, USER_MANAGER, USER_HR]) {
        const { rows } = await db.asUser(viewer, (query) =>
          query("select id from attendance_records where employee_id = $1 and work_date = '2026-04-01'", [EMPLOYEE_REPORT]),
        );
        expect(rows.length).toBe(1);
      }

      const peerView = await db.asUser(USER_PEER, (query) =>
        query("select id from attendance_records where employee_id = $1 and work_date = '2026-04-01'", [EMPLOYEE_REPORT]),
      );
      expect(peerView.rows).toEqual([]);

      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query("insert into attendance_records (employee_id, work_date, status) values ($1, '2026-04-02', 'present')", [EMPLOYEE_REPORT]),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});
