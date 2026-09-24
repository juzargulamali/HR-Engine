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

// Recovery Leave earning is approval-gated (Line Manager, then HR Admin) —
// this walks a standard/overnight recovery_credit_requests row all the way
// to its final, ledger-posting approval. Must run inside ONE asUser() call
// (started as the manager, the first step's approver), switching to USER_HR
// with actAs() for the second — same reason as every other multi-step chain
// in this file.
async function fullyApproveRecoveryCredit(query: Client["query"], attendanceRecordId: string, managerUserId: string, hrUserId: string) {
  const request = await query(
    "select id from recovery_credit_requests where attendance_record_id = $1 and status not in ('cancelled', 'rejected')",
    [attendanceRecordId],
  );
  const requestId = request.rows[0]?.id;

  await actAs(query, managerUserId);
  const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [requestId]);
  await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);

  await actAs(query, hrUserId);
  const step2 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 2", [requestId]);
  await query("select decide_leave_approval($1, 'approved', null)", [step2.rows[0]?.id]);

  return requestId;
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

  // Attendance-credit deduplication used to be a partial unique index
  // (comp_day_ledger_attendance_uniq) forbidding a second comp_day_ledger
  // row from ever referencing the same attendance_record — but a
  // correction's reversal legitimately needs to do exactly that (reverse,
  // then possibly re-earn later, both referencing the same
  // attendance_record id). That index was dropped; deduplication is now
  // record_attendance_and_recovery()'s own responsibility, backed by an
  // advisory lock rather than a unique constraint (same technique
  // decide_leave_approval() already uses for this employee's comp-day
  // balance) — see the "record_attendance_and_recovery()" describe block
  // below, whose "idempotent under a repeated ... save" test is this
  // regression's real coverage now.

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

  // Previously untested entirely — the app relies on receipts_select/write/
  // update/delete (schema.sql) being correct with no RLS test ever
  // verifying it, despite receipts being one of the areas Phase 1
  // hardening calls out for special attention.
  describe("storage: receipts bucket", () => {
    const RECEIPT_FILE = `${COMPANY_A}/${EMPLOYEE_REPORT}/receipts/dinner.pdf`;

    beforeAll(async () => {
      await db.seed(`
        insert into storage.buckets (id, name, public) values ('receipts','receipts',false)
        on conflict (id) do nothing;
        insert into storage.objects (bucket_id, name) values ('receipts', '${RECEIPT_FILE}');
      `);
    });

    it("lets the owning employee, HR Admin, and Finance read a receipt — never the manager or CEO", async () => {
      const owner = await db.asUser(USER_REPORT, (query) => query("select name from storage.objects where bucket_id = 'receipts'"));
      expect(owner.rows.length).toBe(1);

      const hr = await db.asUser(USER_HR, (query) => query("select name from storage.objects where bucket_id = 'receipts'"));
      expect(hr.rows.length).toBe(1);

      const finance = await db.asUser(USER_FINANCE, (query) => query("select name from storage.objects where bucket_id = 'receipts'"));
      expect(finance.rows.length).toBe(1);

      // docs/03-permission-matrix.md §3.3: manager and CEO approve claims by
      // amount, but never get file access to the receipt itself.
      for (const viewer of [USER_MANAGER, USER_CEO]) {
        const view = await db.asUser(viewer, (query) => query("select name from storage.objects where bucket_id = 'receipts'"));
        expect(view.rows).toEqual([]);
      }

      const peer = await db.asUser(USER_PEER, (query) => query("select name from storage.objects where bucket_id = 'receipts'"));
      expect(peer.rows).toEqual([]);
    });

    it("blocks anyone but the claim's own employee from uploading a receipt into their folder", async () => {
      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query("insert into storage.objects (bucket_id, name) values ('receipts', $1)", [
            `${COMPANY_A}/${EMPLOYEE_REPORT}/receipts/manager-upload.pdf`,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);
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
           '{"weekly_threshold_hours": 40, "comp_day_conversion_ratio": 8, "recovery_credit_days": 1}'::jsonb, '${USER_HR}')
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

  // 2026-04-04 is a Saturday and 2026-04-06 a Monday — ZZ took the default
  // week_start_day (1, Monday), so Sat/Sun are its weekend.
  // Phase 2b correction: earning a recovery credit is now approval-gated
  // (Line Manager, then HR Admin) — record_attendance_and_recovery() only
  // ever CREATES a recovery_credit_requests row and routes it through
  // create_initial_approval(); the actual comp_day_ledger 'earned' row is
  // posted only once decide_leave_approval() finalizes the HR Admin step
  // (see the "recovery_credit approval chain" describe block below). The
  // old country-configured flat recovery_credit_days amount is retired
  // entirely in favor of a deterministic hour-threshold rule, so it no
  // longer needs any active overtime_rules policy at all to compute a
  // credit amount.
  describe("record_attendance_and_recovery()", () => {
    it("creates a recovery credit REQUEST (not an immediate ledger credit) for present on a weekend, re-deriving the day itself", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-04", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }])],
        );
        expect(rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: true, reversed: false, needs_policy_review: false }]);

        const record = await query(
          "select status, work_mode from attendance_records where employee_id = $1 and work_date = '2026-04-04'",
          [EMPLOYEE_REPORT],
        );
        expect(record.rows).toEqual([{ status: "present", work_mode: null }]);

        const ledger = await query(
          "select entry_type from comp_day_ledger where reference_type = 'attendance_record' and reference_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-04')",
          [EMPLOYEE_REPORT],
        );
        expect(ledger.rows).toEqual([]); // nothing posted yet — awaiting approval

        const request = await query(
          "select event_type, proposed_days, status from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-04')",
          [EMPLOYEE_REPORT],
        );
        expect(request.rows).toEqual([{ event_type: "standard", proposed_days: "1.0", status: "submitted" }]);
      });
    });

    it("does not credit present on an ordinary weekday", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-06", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", work_mode: "office", hours_worked: 8 }])],
        );
        expect(rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: false, reversed: false, needs_policy_review: false }]);

        const request = await query(
          "select id from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-06')",
          [EMPLOYEE_REPORT],
        );
        expect(request.rows).toEqual([]);
      });
    });

    it("flags needs_policy_review, without guessing an amount, when a recovery-eligible day has no hours_worked recorded yet", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-05", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present" }])],
        );
        expect(rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: false, reversed: false, needs_policy_review: true }]);

        const request = await query(
          "select id from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-05')",
          [EMPLOYEE_REPORT],
        );
        expect(request.rows).toEqual([]);
      });
    });

    it("uses the hour-threshold rule: up to and including 4 active hours -> 0.5 day, more than 4 -> 1 day", async () => {
      await db.asUser(USER_HR, async (query) => {
        // 2026-04-11 is a Saturday, 2026-04-12 a Sunday — both within ZZ's weekend.
        const half = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-11", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 4 }])],
        );
        expect(half.rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: true, reversed: false, needs_policy_review: false }]);
        const halfRequest = await query(
          "select proposed_days from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-11')",
          [EMPLOYEE_REPORT],
        );
        expect(halfRequest.rows).toEqual([{ proposed_days: "0.5" }]);

        const full = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-12", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 4.5 }])],
        );
        expect(full.rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: true, reversed: false, needs_policy_review: false }]);
        const fullRequest = await query(
          "select proposed_days from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-12')",
          [EMPLOYEE_REPORT],
        );
        expect(fullRequest.rows).toEqual([{ proposed_days: "1.0" }]);
      });
    });

    it("is idempotent under a repeated (e.g. double-clicked) save — never creates a second request for the same day", async () => {
      await db.asUser(USER_HR, async (query) => {
        const payload = JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }]);
        const first = await query("select * from record_attendance_and_recovery($1, $2::jsonb)", ["2026-04-18", payload]);
        expect(first.rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: true, reversed: false, needs_policy_review: false }]);

        const second = await query("select * from record_attendance_and_recovery($1, $2::jsonb)", ["2026-04-18", payload]);
        expect(second.rows).toEqual([
          { attendance_employee_id: EMPLOYEE_REPORT, credited: false, reversed: false, needs_policy_review: false },
        ]);

        const requests = await query(
          "select status from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-04-18')",
          [EMPLOYEE_REPORT],
        );
        expect(requests.rows).toEqual([{ status: "submitted" }]);
      });
    });

    it("reverses (never deletes) an already-earned credit when the day is corrected away from present, and a later re-correction earns a genuinely fresh request", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-25", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }])],
        );
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-04-25'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;

        // Fully approve it first, so there's an actual earned ledger credit to reverse.
        await fullyApproveRecoveryCredit(query, recordId, USER_MANAGER, USER_HR);
        await actAs(query, USER_HR);
        const activeLedger = await query(
          "select entry_type from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1",
          [recordId],
        );
        expect(activeLedger.rows).toEqual([{ entry_type: "earned" }]);

        const correction = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-25", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "absent" }])],
        );
        expect(correction.rows).toEqual([
          { attendance_employee_id: EMPLOYEE_REPORT, credited: false, reversed: true, needs_policy_review: false },
        ]);

        const record = await query("select status from attendance_records where employee_id = $1 and work_date = '2026-04-25'", [
          EMPLOYEE_REPORT,
        ]);
        expect(record.rows).toEqual([{ status: "absent" }]);

        const ledger = await query(
          "select entry_type, days, reversal_of_id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1 order by created_at",
          [recordId],
        );
        expect(ledger.rows).toHaveLength(2);
        expect(ledger.rows[0]).toMatchObject({ entry_type: "earned", days: "1.00", reversal_of_id: null });
        expect(ledger.rows[1]).toMatchObject({ entry_type: "reversal", days: "-1.00" });
        expect(ledger.rows[1]?.reversal_of_id).toBeTruthy();

        const requestAfterReversal = await query("select status from recovery_credit_requests where attendance_record_id = $1", [recordId]);
        expect(requestAfterReversal.rows).toEqual([{ status: "cancelled" }]);

        // Correcting it back to present earns a FRESH request — the
        // original (now-cancelled) request must not permanently block this
        // day from ever qualifying again (the partial unique index only
        // enforces uniqueness among non-cancelled/non-rejected requests).
        const restored = await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-04-25", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }])],
        );
        expect(restored.rows).toEqual([{ attendance_employee_id: EMPLOYEE_REPORT, credited: true, reversed: false, needs_policy_review: false }]);

        const requestsAfterRestore = await query(
          "select status from recovery_credit_requests where attendance_record_id = $1 order by created_at",
          [recordId],
        );
        expect(requestsAfterRestore.rows.map((r) => r.status)).toEqual(["cancelled", "submitted"]);
      });
    });

    it("blocks anyone other than HR Admin from recording attendance", async () => {
      const payload = JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }]);
      await expect(
        db.asUser(USER_MANAGER, (query) => query("select * from record_attendance_and_recovery($1, $2::jsonb)", ["2026-04-27", payload])),
      ).rejects.toThrow(/Only HR Admin/);
      await expect(
        db.asUser(USER_REPORT, (query) => query("select * from record_attendance_and_recovery($1, $2::jsonb)", ["2026-04-27", payload])),
      ).rejects.toThrow(/Only HR Admin/);
    });

    // Restores a real database-level guarantee against double-crediting —
    // the guard trigger closes this for a raw insert bypassing the whole
    // approval flow entirely (or a bug that reintroduces the old
    // check-then-insert race).
    it("rejects a second active earned credit for the same attendance record, even via a raw insert", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-05-30", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }])],
        );
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-05-30'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;

        await fullyApproveRecoveryCredit(query, recordId, USER_MANAGER, USER_HR);
        await actAs(query, USER_HR);

        await expect(
          query(
            "insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, reference_id, created_by) values ($1, '2026-05-30', 'earned', 1, 'holiday_worked', 'attendance_record', $2, $3)",
            [EMPLOYEE_REPORT, recordId, USER_HR],
          ),
        ).rejects.toThrow(/active \(unreversed\) earned comp-day credit already exists/);
      });
    });
  });

  describe("recovery_credit approval chain (decide_leave_approval)", () => {
    async function submitStandardRequest(query: Client["query"], workDate: string, hours = 8) {
      await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
        workDate,
        JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: hours }]),
      ]);
      const record = await query("select id from attendance_records where employee_id = $1 and work_date = $2", [EMPLOYEE_REPORT, workDate]);
      const recordId = record.rows[0]?.id;
      const request = await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId]);
      return { recordId, requestId: request.rows[0]?.id };
    }

    it("manager approval alone (step 1) never posts a ledger credit — only marks the request pending HR", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { recordId, requestId } = await submitStandardRequest(query, "2026-06-13");

        await actAs(query, USER_MANAGER);
        const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [
          requestId,
        ]);
        await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);

        await actAs(query, USER_HR);
        const request = await query("select status from recovery_credit_requests where id = $1", [requestId]);
        expect(request.rows).toEqual([{ status: "pending_approval" }]);

        const ledger = await query("select id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1", [recordId]);
        expect(ledger.rows).toEqual([]);
      });
    });

    it("HR Admin's final approval (step 2) credits exactly once, with the correct source and 180-day expiry", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { recordId, requestId } = await submitStandardRequest(query, "2026-06-20");
        await fullyApproveRecoveryCredit(query, recordId, USER_MANAGER, USER_HR);

        const request = await query("select status, comp_day_ledger_id from recovery_credit_requests where id = $1", [requestId]);
        expect(request.rows[0]?.status).toBe("approved");
        expect(request.rows[0]?.comp_day_ledger_id).toBeTruthy();

        const ledger = await query(
          "select entry_type, days, source, expiry_date, txn_date from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1",
          [recordId],
        );
        expect(ledger.rows).toEqual([{ entry_type: "earned", days: "1.00", source: "holiday_worked", expiry_date: expect.anything(), txn_date: expect.anything() }]);
        const expiry = new Date(ledger.rows[0]?.expiry_date as string);
        const txn = new Date(ledger.rows[0]?.txn_date as string);
        expect(Math.round((expiry.getTime() - txn.getTime()) / (24 * 60 * 60 * 1000))).toBe(180);
      });
    });

    it("rejection at either step never posts a credit, and closes the chain", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { recordId, requestId } = await submitStandardRequest(query, "2026-06-27");

        await actAs(query, USER_MANAGER);
        const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [
          requestId,
        ]);
        await query("select decide_leave_approval($1, 'rejected', 'not eligible')", [step1.rows[0]?.id]);

        await actAs(query, USER_HR);
        const request = await query("select status from recovery_credit_requests where id = $1", [requestId]);
        expect(request.rows).toEqual([{ status: "rejected" }]);

        const ledger = await query("select id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1", [recordId]);
        expect(ledger.rows).toEqual([]);

        const step2 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 2", [
          requestId,
        ]);
        expect(step2.rows).toEqual([]);
      });
    });

    it("blocks the employee from approving their own recovery credit request", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { requestId } = await submitStandardRequest(query, "2026-07-04");
        const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [
          requestId,
        ]);

        await actAs(query, USER_REPORT);
        await expect(query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id])).rejects.toThrow(
          /Only the assigned approver/,
        );
      });
    });

    it("rejects a repeated decision on the same approval (idempotency/duplicate-decision guard)", async () => {
      await db.asUser(USER_HR, async (query) => {
        const { requestId } = await submitStandardRequest(query, "2026-07-11");
        await actAs(query, USER_MANAGER);
        const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [
          requestId,
        ]);
        await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);

        await expect(query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id])).rejects.toThrow(
          /already been decided/,
        );
      });
    });
  });

  describe("delete_attendance_record()", () => {
    // The primary regression test this correction round asked for:
    // deleting (or correcting away) an attendance record must never leave
    // an active, orphaned recovery credit referencing a row that no
    // longer exists.
    it("reverses an active earned credit before deleting the record, leaving no active orphan credit", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-08-01", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }])],
        );
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-01'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        await fullyApproveRecoveryCredit(query, recordId, USER_MANAGER, USER_HR);

        const activeBefore = await query(
          "select id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1 and entry_type = 'earned' and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = comp_day_ledger.id)",
          [recordId],
        );
        expect(activeBefore.rows.length).toBe(1);

        await query("select delete_attendance_record($1)", [recordId]);

        const recordAfter = await query("select id from attendance_records where id = $1", [recordId]);
        expect(recordAfter.rows).toEqual([]);

        // The original earned row is still on the record (never deleted)...
        const ledgerAfter = await query(
          "select entry_type, days, reversal_of_id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1 order by created_at",
          [recordId],
        );
        expect(ledgerAfter.rows).toHaveLength(2);
        expect(ledgerAfter.rows[0]).toMatchObject({ entry_type: "earned", days: "1.00", reversal_of_id: null });
        expect(ledgerAfter.rows[1]).toMatchObject({ entry_type: "reversal", days: "-1.00" });

        // ...but no ACTIVE (unreversed) credit remains for this reference_id.
        const activeAfter = await query(
          "select id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1 and entry_type = 'earned' and not exists (select 1 from comp_day_ledger r where r.reversal_of_id = comp_day_ledger.id)",
          [recordId],
        );
        expect(activeAfter.rows).toEqual([]);
      });
    });

    it("deletes cleanly with no ledger activity when the record never earned a credit", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-06-15", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "absent" }])],
        );
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-06-15'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;

        await query("select delete_attendance_record($1)", [recordId]);

        const recordAfter = await query("select id from attendance_records where id = $1", [recordId]);
        expect(recordAfter.rows).toEqual([]);
      });
    });

    // recovery_credit_requests.attendance_record_id has no ON DELETE
    // action — a still-pending request (never decided at all) would
    // otherwise block this delete outright with a foreign key violation.
    it("deletes cleanly even when a recovery credit request is still pending (never approved) for that day", async () => {
      await db.asUser(USER_HR, async (query) => {
        await query(
          "select * from record_attendance_and_recovery($1, $2::jsonb)",
          ["2026-08-08", JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }])],
        );
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-08'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        const requestBefore = await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId]);
        expect(requestBefore.rows.length).toBe(1);

        await query("select delete_attendance_record($1)", [recordId]);

        const recordAfter = await query("select id from attendance_records where id = $1", [recordId]);
        expect(recordAfter.rows).toEqual([]);
        const requestAfter = await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId]);
        expect(requestAfter.rows).toEqual([]);
        const approvalsAfter = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1", [
          requestBefore.rows[0]?.id,
        ]);
        expect(approvalsAfter.rows).toEqual([]);
      });
    });

    it("blocks anyone other than HR Admin from deleting an attendance record", async () => {
      // Seeded directly (not via a rolled-back asUser() transaction) so the
      // record still exists for the separate asUser() calls below that
      // attempt — and must fail — to delete it.
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-06-20', 'present');`);
      const recordId = (
        await db.asUser(USER_HR, (query) => query("select id from attendance_records where employee_id = $1 and work_date = '2026-06-20'", [EMPLOYEE_REPORT]))
      ).rows[0]?.id;

      await expect(db.asUser(USER_MANAGER, (query) => query("select delete_attendance_record($1)", [recordId]))).rejects.toThrow(
        /Only HR Admin/,
      );
      await expect(db.asUser(USER_REPORT, (query) => query("select delete_attendance_record($1)", [recordId]))).rejects.toThrow(
        /Only HR Admin/,
      );

      // Still there — neither attempt should have partially applied.
      const stillThere = await db.asUser(USER_HR, (query) => query("select id from attendance_records where id = $1", [recordId]));
      expect(stillThere.rows.length).toBe(1);
    });
  });
});
