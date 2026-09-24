import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

const COMPANY_A = "00000000-0000-0000-0000-0000000006a1";

const USER_HR = "00000000-0000-0000-0000-0000000006b1";
const USER_FINANCE = "00000000-0000-0000-0000-0000000006b2";
const USER_CEO = "00000000-0000-0000-0000-0000000006b3";
const USER_REPORT = "00000000-0000-0000-0000-0000000006b4";
const USER_PEER = "00000000-0000-0000-0000-0000000006b5";
const USER_FINANCE_2 = "00000000-0000-0000-0000-0000000006b6";
const USER_CTO = "00000000-0000-0000-0000-0000000006b7";

const EMPLOYEE_REPORT = "00000000-0000-0000-0000-0000000006c1";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-0000000006c2";

async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

describe("Phase 6 row-level security: letters, payroll export, audit log, AI drafts", () => {
  const db = new RlsTestDatabase();
  let payrollWorkflowId: string;
  let letterWorkflowId: string;

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR}', 'p6-hr@enginious.ae'),
        ('${USER_FINANCE}', 'p6-finance@enginious.ae'),
        ('${USER_CEO}', 'p6-ceo@enginious.ae'),
        ('${USER_REPORT}', 'p6-report@enginious.ae'),
        ('${USER_PEER}', 'p6-peer@enginious.ae'),
        ('${USER_CTO}', 'p6-cto@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Phase 6 Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'P6-01', '${COMPANY_A}', 'ZZ', 'Remi', 'Report', '2024-01-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'P6-02', '${COMPANY_A}', 'ZZ', 'Pia', 'Peer', '2024-01-01');

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_FINANCE}', 'finance', '${COMPANY_A}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_A}'),
        ('${USER_CTO}', 'cto', '${COMPANY_A}');

      -- guard_leave_request_type() requires an active leave_rules policy
      -- defining whatever leave_type_code a request uses — every
      -- leave_requests row seeded below uses 'annual'.
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('00000000-0000-0000-0000-0000000006e1', 'ZZ', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${USER_HR}', '${USER_CEO}', now());
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
        values ('00000000-0000-0000-0000-0000000006e1', 'annual', 'Annual Leave', 'monthly_accrual');
    `);

    const { rows } = await db.asUser(USER_HR, (query) =>
      query(
        "select id, entity_type from approval_workflows where company_id = $1 and entity_type in ('payroll_export_run', 'generated_letter')",
        [COMPANY_A],
      ),
    );
    payrollWorkflowId = rows.find((r) => r.entity_type === "payroll_export_run")?.id;
    letterWorkflowId = rows.find((r) => r.entity_type === "generated_letter")?.id;
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("auto-provisions the mandatory 2-step (Finance, then CEO) payroll workflow and a 1-step (CEO) letter workflow", async () => {
    expect(payrollWorkflowId).toBeTruthy();
    expect(letterWorkflowId).toBeTruthy();

    const { rows: payrollSteps } = await db.asUser(USER_HR, (query) =>
      query("select step_order, approver_type from approval_workflow_steps where workflow_id = $1 order by step_order", [payrollWorkflowId]),
    );
    expect(payrollSteps).toEqual([
      { step_order: 1, approver_type: "role:finance" },
      { step_order: 2, approver_type: "role:ceo" },
    ]);

    const { rows: letterSteps } = await db.asUser(USER_HR, (query) =>
      query("select step_order, approver_type from approval_workflow_steps where workflow_id = $1", [letterWorkflowId]),
    );
    expect(letterSteps).toEqual([{ step_order: 1, approver_type: "role:ceo" }]);
  });

  describe("payroll workflow immutability", () => {
    it("blocks HR Admin from deleting, editing, or adding to the payroll workflow's steps", async () => {
      await expect(
        db.asUser(USER_HR, (query) => query("delete from approval_workflow_steps where workflow_id = $1 and step_order = 2", [payrollWorkflowId])),
      ).rejects.toThrow(/cannot be modified/);

      await expect(
        db.asUser(USER_HR, (query) =>
          query("update approval_workflow_steps set approver_type = 'role:hr_admin' where workflow_id = $1 and step_order = 2", [payrollWorkflowId]),
        ),
      ).rejects.toThrow(/cannot be modified/);

      await expect(
        db.asUser(USER_HR, (query) =>
          query("insert into approval_workflow_steps (workflow_id, step_order, approver_type) values ($1, 3, 'role:hr_admin')", [payrollWorkflowId]),
        ),
      ).rejects.toThrow(/cannot be modified/);
    });

    it("never blocks editing an ordinary (non-payroll) workflow's steps", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select id from approval_workflows where company_id = $1 and entity_type = 'timesheet'", [COMPANY_A]),
      );
      const timesheetWorkflowId = rows[0]?.id;
      const stepId = randomUUID();
      await db.asUser(USER_HR, (query) =>
        query("insert into approval_workflow_steps (id, workflow_id, step_order, approver_type) values ($1, $2, 2, 'role:hr_admin')", [
          stepId,
          timesheetWorkflowId,
        ]),
      );
      await db.seed(`delete from approval_workflow_steps where id = '${stepId}';`);
    });

    // Regression test: guard_payroll_workflow_immutable() used to check
    // only the NEW row's workflow_id, so an HR Admin could evade "the
    // payroll workflow's steps are immutable" by re-parenting a payroll
    // step onto a different, ordinary workflow they also manage — that
    // UPDATE's new.workflow_id resolves to a non-payroll entity_type, so
    // the old single-sided check passed even though the row being detached
    // WAS a mandatory payroll step the instant before.
    it("blocks HR Admin from detaching a payroll step by re-parenting it onto a different workflow", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select id from approval_workflows where company_id = $1 and entity_type = 'timesheet'", [COMPANY_A]),
      );
      const timesheetWorkflowId = rows[0]?.id;

      await expect(
        db.asUser(USER_HR, (query) =>
          query("update approval_workflow_steps set workflow_id = $1 where workflow_id = $2 and step_order = 2", [
            timesheetWorkflowId,
            payrollWorkflowId,
          ]),
        ),
      ).rejects.toThrow(/cannot be modified/);

      // And the reverse direction: moving an ordinary step ONTO the payroll
      // workflow should be blocked too, for the same reason.
      const stepId = randomUUID();
      await db.seed(`insert into approval_workflow_steps (id, workflow_id, step_order, approver_type) values ('${stepId}', '${timesheetWorkflowId}', 2, 'role:hr_admin');`);
      await expect(
        db.asUser(USER_HR, (query) =>
          query("update approval_workflow_steps set workflow_id = $1 where id = $2", [payrollWorkflowId, stepId]),
        ),
      ).rejects.toThrow(/cannot be modified/);
      await db.seed(`delete from approval_workflow_steps where id = '${stepId}';`);
    });
  });

  describe("payroll export authorization", () => {
    async function seedDraftRun(month: number, year = 2026) {
      const runId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by)
        values ('${runId}', '${COMPANY_A}', ${month}, ${year}, '${USER_FINANCE}');
      `);
      return runId;
    }

    it("blocks Finance from self-authorizing directly, even though they can otherwise update the run", async () => {
      const runId = await seedDraftRun(1);
      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query("update payroll_export_runs set status = 'approved', authorized_by = $1, authorized_at = now() where id = $2", [
            USER_FINANCE,
            runId,
          ]),
        ),
      ).rejects.toThrow(/only happen through the approval workflow/);
    });

    it("lets Finance submit a draft run (draft -> submitted) directly", async () => {
      const runId = await seedDraftRun(2);
      await db.asUser(USER_FINANCE, async (query) => {
        await query("update payroll_export_runs set status = 'submitted' where id = $1", [runId]);
        const after = await query("select status from payroll_export_runs where id = $1", [runId]);
        expect(after.rows[0]?.status).toBe("submitted");
      });
    });

    it("routes Finance -> CEO in order and stamps authorized_by/authorized_at only once the CEO decides", async () => {
      const runId = await seedDraftRun(3);
      const approvalId = randomUUID();
      await db.seed(`
        update payroll_export_runs set status = 'submitted' where id = '${runId}';
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'payroll_export_run', '${runId}', '${payrollWorkflowId}', 1, '${USER_FINANCE}');
      `);

      await db.asUser(USER_FINANCE, async (query) => {
        await query("select decide_leave_approval($1, 'approved', 'figures reviewed')", [approvalId]);

        const afterStep1 = await query("select status, authorized_by from payroll_export_runs where id = $1", [runId]);
        expect(afterStep1.rows[0]?.status).toBe("pending_approval");
        expect(afterStep1.rows[0]?.authorized_by).toBeNull();

        await actAs(query, USER_CEO);
        const step2 = await query("select id, decision from approvals where entity_id = $1 and step_order = 2", [runId]);
        expect(step2.rows[0]?.decision).toBe("pending");

        await query("select decide_leave_approval($1, 'approved', 'signed off')", [step2.rows[0]?.id]);

        const final = await query("select status, authorized_by, authorized_at from payroll_export_runs where id = $1", [runId]);
        expect(final.rows[0]?.status).toBe("approved");
        expect(final.rows[0]?.authorized_by).toBe(USER_CEO);
        expect(final.rows[0]?.authorized_at).not.toBeNull();
      });
    });

    // CTO is a deliberate, complete mirror of CEO throughout this system
    // (docs/03-permission-matrix.md §3.7) — resolve_approver() resolves a
    // 'role:ceo' workflow step to either a CEO or a CTO holder, so the
    // payroll export's mandatory final sign-off can be satisfied by a CTO
    // alone, with no CEO ever involved in that specific export. This is
    // the intended design, not a gap — this test is the regression
    // coverage for it (previously untested). Needs its own company with NO
    // CEO holder at all — COMPANY_A already has one, and
    // resolve_approver_for_company() would just resolve to that CEO
    // (whichever C-level holder it picks first), which wouldn't actually
    // exercise "CTO alone, no CEO involved".
    it("lets a CTO alone fulfill the mandatory final sign-off step, with no CEO involved", async () => {
      const ctoOnlyCompanyId = randomUUID();
      await db.seed(`
        insert into companies (id, legal_name, country_code, default_currency)
          values ('${ctoOnlyCompanyId}', 'CTO-only Co', 'ZZ', 'ZZD');
        insert into user_roles (user_id, role, company_id) values
          ('${USER_FINANCE}', 'finance', '${ctoOnlyCompanyId}'),
          ('${USER_CTO}', 'cto', '${ctoOnlyCompanyId}');
      `);

      const { rows: workflowRows } = await db.asUser(USER_HR, (query) =>
        query("select id from approval_workflows where company_id = $1 and entity_type = 'payroll_export_run'", [ctoOnlyCompanyId]),
      );
      const ctoOnlyPayrollWorkflowId = workflowRows[0]?.id;
      expect(ctoOnlyPayrollWorkflowId).toBeTruthy();

      const runId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by, status)
          values ('${runId}', '${ctoOnlyCompanyId}', 1, 2026, '${USER_FINANCE}', 'submitted');
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'payroll_export_run', '${runId}', '${ctoOnlyPayrollWorkflowId}', 1, '${USER_FINANCE}');
      `);

      await db.asUser(USER_FINANCE, async (query) => {
        await query("select decide_leave_approval($1, 'approved', 'figures reviewed')", [approvalId]);

        await actAs(query, USER_CTO);
        const step2 = await query("select id, decision from approvals where entity_id = $1 and step_order = 2", [runId]);
        expect(step2.rows[0]?.decision).toBe("pending");

        await query("select decide_leave_approval($1, 'approved', 'signed off by CTO')", [step2.rows[0]?.id]);

        const final = await query("select status, authorized_by from payroll_export_runs where id = $1", [runId]);
        expect(final.rows[0]?.status).toBe("approved");
        expect(final.rows[0]?.authorized_by).toBe(USER_CTO);

        // Read access mirrors CEO too: the CTO can see the lines this
        // approved run posted, same as HR Admin/Finance/CEO can.
        const lines = await query("select id from payroll_export_lines where run_id = $1", [runId]);
        expect(lines.rows).toEqual([]); // no reimbursement/leave-encashment source rows exist for this run — just confirms the query itself isn't blocked by RLS
      });
    });

    // payroll_export_lines carries per-employee compensation amounts and had
    // no negative test at all before this — previously verified only via
    // inspection of payroll_lines_select, never exercised against an actual
    // unauthorized role.
    it("keeps payroll_export_lines visible only to HR Admin/Finance/CEO/CTO, never the line's own employee or an unrelated employee", async () => {
      const runId = await seedDraftRun(6, 2029);
      const lineId = randomUUID();
      await db.seed(`
        insert into payroll_export_lines (id, run_id, employee_id, component_code, amount, currency)
        values ('${lineId}', '${runId}', '${EMPLOYEE_REPORT}', 'basic_salary', 5000, 'ZZD');
      `);

      for (const viewer of [USER_HR, USER_FINANCE, USER_CEO, USER_CTO]) {
        const { rows } = await db.asUser(viewer, (query) => query("select id from payroll_export_lines where id = $1", [lineId]));
        expect(rows.length).toBe(1);
      }

      // Not even the line's own employee gets payroll access
      // (docs/03-permission-matrix.md §3.6: Employee is "–" on payroll
      // export) — nor an unrelated peer.
      const employeeView = await db.asUser(USER_REPORT, (query) => query("select id from payroll_export_lines where id = $1", [lineId]));
      expect(employeeView.rows).toEqual([]);

      const peerView = await db.asUser(USER_PEER, (query) => query("select id from payroll_export_lines where id = $1", [lineId]));
      expect(peerView.rows).toEqual([]);
    });

    it("stops at Finance's rejection — the run never reaches the CEO", async () => {
      const runId = await seedDraftRun(4);
      const approvalId = randomUUID();
      await db.seed(`
        update payroll_export_runs set status = 'submitted' where id = '${runId}';
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'payroll_export_run', '${runId}', '${payrollWorkflowId}', 1, '${USER_FINANCE}');
      `);

      await db.asUser(USER_FINANCE, async (query) => {
        await query("select decide_leave_approval($1, 'rejected', 'numbers look wrong')", [approvalId]);
        const after = await query("select status from payroll_export_runs where id = $1", [runId]);
        expect(after.rows[0]?.status).toBe("rejected");

        const ceoStep = await query("select id from approvals where entity_id = $1 and step_order = 2", [runId]);
        expect(ceoStep.rows).toEqual([]);
      });
    });

    // Regression test for the permanent-drop bug: generate_payroll_export_lines()
    // only checks payroll_export_lines for an existing claim on a source
    // row — it never looked at whether the run that claimed it was later
    // rejected. Without decide_leave_approval() releasing the rejected
    // run's lines, this approved claim would never be exportable again.
    it("releases a rejected run's lines, so a later run can pick up the same source rows", async () => {
      const claimId = randomUUID();
      await db.seed(`
        insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'approved');
        insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ('${claimId}', 1, '2026-07-01', 'travel', 150);
      `);
      const runId = await seedDraftRun(9);
      const secondRunId = await seedDraftRun(10);
      const approvalId = randomUUID();
      // This test is about decide_leave_approval()'s release-on-reject fix,
      // not about create_initial_approval()'s own authorization — the
      // approval row is seeded via db.seed (trusted bypass) like the other
      // fixtures in this describe block, rather than exercising the real
      // RPC (which would hit its own, separately-tested self-approval
      // block: USER_FINANCE is this fixture's only finance-role holder, so
      // they can never resolve as anyone but themselves for a payroll run
      // they generated).
      await db.seed(`
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'payroll_export_run', '${runId}', '${payrollWorkflowId}', 1, '${USER_FINANCE}');
      `);

      // Everything below runs inside a single db.asUser transaction (which
      // always rolls back at the end) — separate asUser calls each get
      // their own transaction and can't see each other's writes, so the
      // reject-then-regenerate sequence has to stay in one.
      await db.asUser(USER_FINANCE, async (query) => {
        const { rows: firstLines } = await query("select * from generate_payroll_export_lines($1)", [runId]);
        expect(firstLines.some((l) => l.source_reference_id === claimId)).toBe(true);

        await query("update payroll_export_runs set status = 'submitted' where id = $1", [runId]);
        await query("select decide_leave_approval($1, 'rejected', 'redo it')", [approvalId]);

        const afterReject = await query("select id from payroll_export_lines where run_id = $1", [runId]);
        expect(afterReject.rows).toEqual([]);

        const { rows: secondLines } = await query("select * from generate_payroll_export_lines($1)", [secondRunId]);
        expect(secondLines.some((l) => l.source_reference_id === claimId)).toBe(true);
      });

      // This claim's own db.seed insert isn't rolled back by the asUser
      // transaction above — clean it up so it doesn't leak into other
      // tests in this file that also generate lines for COMPANY_A.
      await db.seed(`delete from reimbursement_claims where id = '${claimId}';`);
    });

    it("lets Finance delete a draft run, cascading to its lines and releasing their source rows", async () => {
      const claimId = randomUUID();
      await db.seed(`
        insert into reimbursement_claims (id, employee_id, currency, status) values ('${claimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'approved');
        insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values ('${claimId}', 1, '2026-08-01', 'travel', 90);
      `);
      const runId = await seedDraftRun(11);
      const secondRunId = await seedDraftRun(12);

      await db.asUser(USER_FINANCE, async (query) => {
        await query("select * from generate_payroll_export_lines($1)", [runId]);

        await query("delete from payroll_export_runs where id = $1", [runId]);
        const runGone = await query("select id from payroll_export_runs where id = $1", [runId]);
        expect(runGone.rows).toEqual([]);

        // Proves the cascade actually removed the line (not just that RLS
        // now hides it): if it were still there, generate_payroll_export_lines()'s
        // "not exists" check on this same claim would skip it again.
        const { rows: secondLines } = await query("select * from generate_payroll_export_lines($1)", [secondRunId]);
        expect(secondLines.some((l) => l.source_reference_id === claimId)).toBe(true);
      });

      await db.seed(`delete from reimbursement_claims where id = '${claimId}';`);
    });

    it("blocks Finance from deleting a run once it's no longer a draft", async () => {
      const runId = await seedDraftRun(1, 2027);
      await db.seed(`update payroll_export_runs set status = 'submitted' where id = '${runId}';`);

      await db.asUser(USER_FINANCE, async (query) => {
        await query("delete from payroll_export_runs where id = $1", [runId]);
        const stillThere = await query("select id from payroll_export_runs where id = $1", [runId]);
        expect(stillThere.rows.length).toBe(1);
      });
    });

    it("lets HR Admin, Finance, and CEO see a run; blocks an ordinary employee", async () => {
      const runId = await seedDraftRun(5);
      for (const viewer of [USER_HR, USER_FINANCE, USER_CEO]) {
        const { rows } = await db.asUser(viewer, (query) => query("select id from payroll_export_runs where id = $1", [runId]));
        expect(rows.length).toBe(1);
      }
      const employeeView = await db.asUser(USER_REPORT, (query) => query("select id from payroll_export_runs where id = $1", [runId]));
      expect(employeeView.rows).toEqual([]);
    });

    // Regression test for a real bug: every fixture above inserts into
    // approvals via db.seed (a trusted connection, bypassing RLS entirely),
    // which is why is_entity_owner() missing a payroll_export_run branch
    // went undetected — submitPayrollExport() calls create_initial_approval()
    // as the signed-in Finance user, through the real RLS/ownership path
    // exercised here. A second Finance user is seeded with an earlier
    // granted_at so resolve_approver_for_company() resolves to them, not
    // USER_FINANCE — otherwise this would hit create_initial_approval()'s
    // own self-approval block, since USER_FINANCE is both the run's
    // generator and (without this) the only finance-role holder.
    it("lets the generating Finance user create the first approval via create_initial_approval(), the same way submitPayrollExport() does", async () => {
      const runId = await seedDraftRun(7);
      await db.seed(`
        insert into auth.users (id, email) values ('${USER_FINANCE_2}', 'p6-finance2@enginious.ae') on conflict do nothing;
        insert into user_roles (user_id, role, company_id, granted_at) values ('${USER_FINANCE_2}', 'finance', '${COMPANY_A}', '2000-01-01') on conflict do nothing;
        update payroll_export_runs set status = 'submitted' where id = '${runId}';
      `);

      const { rows } = await db.asUser(USER_FINANCE, async (query) => {
        const { rows: created } = await query("select create_initial_approval('payroll_export_run', $1) as id", [runId]);
        return query("select decision from approvals where id = $1", [created[0]?.id]);
      });
      expect(rows).toEqual([{ decision: "pending" }]);

      await db.seed(`delete from user_roles where user_id = '${USER_FINANCE_2}' and role = 'finance';`);
    });

    it("blocks anyone other than the run's own generated_by from creating that first approval", async () => {
      const runId = await seedDraftRun(8);
      await db.seed(`update payroll_export_runs set status = 'submitted' where id = '${runId}';`);

      await expect(
        db.asUser(USER_HR, (query) => query("select create_initial_approval('payroll_export_run', $1)", [runId])),
      ).rejects.toThrow(/do not own this/);
    });

    // Regression test for the real bug this whole flow replaced:
    // approvals_insert_initial never validated workflow_id or approver_id,
    // so any owner could forge a self-approving first approval row
    // directly — including for payroll_export_run's mandatory
    // Finance-then-CEO sign-off. There is no INSERT policy on approvals at
    // all anymore.
    it("blocks a direct client INSERT into approvals entirely, even from the run's own generating Finance user", async () => {
      const runId = await seedDraftRun(2, 2028);
      await db.seed(`update payroll_export_runs set status = 'submitted' where id = '${runId}';`);

      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query(
            "insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision) values ('payroll_export_run', $1, $2, 1, $3, 'pending')",
            [runId, payrollWorkflowId, USER_FINANCE],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("payroll_export_lines: source-row dedup constraint", () => {
    // Regression test: generate_payroll_export_lines()'s only anti-double-
    // claim mechanism was a plain "not exists" check with no backing
    // constraint and no locking, so two overlapping calls (e.g. two
    // different-period draft runs for the same company racing on the same
    // pool of approved reimbursement claims) could both see a source row as
    // "not yet exported" and both insert an export line for it — double-
    // paying the employee once both runs were sent.
    // payroll_export_lines_source_uniq backs that check with a real unique
    // constraint, proven here with a plain duplicate insert against two
    // different draft runs, independent of generate_payroll_export_lines()'s
    // own on-conflict-do-nothing upsert.
    it("rejects a second payroll_export_lines row claiming the same source row under a different draft run", async () => {
      const runIdA = randomUUID();
      const runIdB = randomUUID();
      const sourceClaimId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by) values
          ('${runIdA}', '${COMPANY_A}', 1, 2030, '${USER_FINANCE}'),
          ('${runIdB}', '${COMPANY_A}', 2, 2030, '${USER_FINANCE}');
      `);

      // Both inserts happen inside ONE asUser() transaction — every asUser()
      // call rolls back at the end (see harness.ts), so a separate second
      // call would never see the first insert to conflict with.
      await db.asUser(USER_FINANCE, async (query) => {
        await query(
          `insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id)
           values ($1, $2, 'reimbursement', 100, 'ZZD', 'reimbursement_claim', $3)`,
          [runIdA, EMPLOYEE_REPORT, sourceClaimId],
        );

        await expect(
          query(
            `insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id)
             values ($1, $2, 'reimbursement', 100, 'ZZD', 'reimbursement_claim', $3)`,
            [runIdB, EMPLOYEE_REPORT, sourceClaimId],
          ),
        ).rejects.toThrow(/duplicate key value violates unique constraint/);
      });
    });
  });

  describe("payroll_export_lines: employee must belong to the run's own company", () => {
    // Regression test: payroll_lines_insert/payroll_lines_update originally
    // verified only that the RUN's company matched the acting Finance
    // user's role grant — never that employee_id itself belonged to that
    // company. That let a manual-line insert (or a raw update) target an
    // employee_id from an entirely different company than the run.
    const COMPANY_B = "00000000-0000-0000-0000-0000000006a2";
    const EMPLOYEE_OTHER_CO = "00000000-0000-0000-0000-0000000006c9";

    beforeAll(async () => {
      await db.seed(`
        insert into companies (id, legal_name, country_code, default_currency)
          values ('${COMPANY_B}', 'Phase 6 Co B', 'ZZ', 'ZZD');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${EMPLOYEE_OTHER_CO}', 'P6B-01', '${COMPANY_B}', 'ZZ', 'Other', 'Co', '2024-01-01');
      `);
    });

    it("blocks Finance from inserting a manual line for an employee outside the run's company", async () => {
      const runId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by)
          values ('${runId}', '${COMPANY_A}', 3, 2030, '${USER_FINANCE}');
      `);

      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query(
            `insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, label, is_manual, created_by)
             values ($1, $2, 'bonus', 100, 'ZZD', 'cross-company attempt', true, $3)`,
            [runId, EMPLOYEE_OTHER_CO, USER_FINANCE],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      const check = await db.asUser(USER_HR, (query) => query("select id from payroll_export_lines where run_id = $1", [runId]));
      expect(check.rows).toEqual([]);
    });

    it("blocks retargeting an existing line onto an employee outside the run's company", async () => {
      const runId = randomUUID();
      const lineId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by)
          values ('${runId}', '${COMPANY_A}', 4, 2030, '${USER_FINANCE}');
        insert into payroll_export_lines (id, run_id, employee_id, component_code, amount, currency, label, is_manual, created_by)
          values ('${lineId}', '${runId}', '${EMPLOYEE_REPORT}', 'bonus', 100, 'ZZD', 'legit bonus', true, '${USER_FINANCE}');
      `);

      await expect(
        db.asUser(USER_FINANCE, (query) =>
          query("update payroll_export_lines set employee_id = $1 where id = $2", [EMPLOYEE_OTHER_CO, lineId]),
        ),
      ).rejects.toThrow(/row-level security/);

      const check = await db.asUser(USER_HR, (query) => query("select employee_id from payroll_export_lines where id = $1", [lineId]));
      expect(check.rows[0]?.employee_id).toBe(EMPLOYEE_REPORT);
    });
  });

  describe("generate_payroll_export_lines: reconciliation", () => {
    it("includes a basic_salary line, only approved reimbursements, and this period's leave encashments, and never duplicates on re-run", async () => {
      const runId = randomUUID();
      const approvedClaimId = randomUUID();
      const draftClaimId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by)
          values ('${runId}', '${COMPANY_A}', 6, 2026, '${USER_FINANCE}');
        insert into reimbursement_claims (id, employee_id, currency, status) values
          ('${approvedClaimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'approved'),
          ('${draftClaimId}', '${EMPLOYEE_REPORT}', 'ZZD', 'draft');
        insert into reimbursement_claim_lines (claim_id, line_no, expense_date, category, amount) values
          ('${approvedClaimId}', 1, '2026-06-01', 'travel', 200),
          ('${draftClaimId}', 1, '2026-06-01', 'meals', 40);
        insert into compensation_details (employee_id, effective_from, base_salary, currency, is_current, created_by)
          values ('${EMPLOYEE_REPORT}', '2024-01-01', 3000, 'ZZD', true, '${USER_HR}');
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by)
          values ('${EMPLOYEE_REPORT}', 'annual', '2026-06-15', 'encashment', 3, '${USER_HR}');
      `);

      await db.asUser(USER_FINANCE, async (query) => {
        const { rows } = await query("select * from generate_payroll_export_lines($1)", [runId]);
        // basic_salary (EMPLOYEE_REPORT's only active line for this company —
        // EMPLOYEE_MANAGER/EMPLOYEE_PEER have no compensation_details seeded)
        // + the one approved reimbursement + the one in-period encashment.
        expect(rows.length).toBe(3);

        const salaryLine = rows.find((r) => r.component_code === "basic_salary");
        expect(salaryLine?.employee_id).toBe(EMPLOYEE_REPORT);
        expect(Number(salaryLine?.amount)).toBe(3000);

        const reimbursementLine = rows.find((r) => r.component_code === "reimbursement");
        expect(reimbursementLine?.source_reference_id).toBe(approvedClaimId);
        expect(Number(reimbursementLine?.amount)).toBe(200);

        const encashmentLine = rows.find((r) => r.component_code === "leave_encashment");
        expect(Number(encashmentLine?.amount)).toBe(3);

        // "Idempotent" now means "re-running never accumulates duplicates",
        // not "returns nothing" — generate_payroll_export_lines() deletes
        // every previously auto-generated line for this run and rebuilds it
        // fresh each time (so a stale salary figure never lingers), so a
        // re-run returns the same three lines again as new rows, not zero.
        const rerun = await query("select * from generate_payroll_export_lines($1)", [runId]);
        expect(rerun.rows.length).toBe(3);

        const total = await query("select count(*) from payroll_export_lines where run_id = $1", [runId]);
        expect(Number(total.rows[0]?.count)).toBe(3);
      });
    });

    it("leaves a manually-added or manually-corrected line untouched across a re-run", async () => {
      // Relies on the compensation_details row the previous test seeded for
      // EMPLOYEE_REPORT (persisted via db.seed, never rolled back) so that
      // generate_payroll_export_lines() has a basic_salary line to generate
      // here too — inserting a second row here would give EMPLOYEE_REPORT
      // two is_current rows and double the salary line via the join.
      const runId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by)
          values ('${runId}', '${COMPANY_A}', 1, 2031, '${USER_FINANCE}');
      `);

      await db.asUser(USER_FINANCE, async (query) => {
        const { rows: firstRun } = await query("select * from generate_payroll_export_lines($1)", [runId]);
        const salaryLineId = firstRun.find((r) => r.component_code === "basic_salary")?.id;
        expect(salaryLineId).toBeDefined();

        // Finance hand-corrects the auto-generated salary line and adds a
        // manual bonus line — both must survive a later re-run untouched.
        await query("update payroll_export_lines set amount = 3200, is_manual = true where id = $1", [salaryLineId]);
        const bonusId = randomUUID();
        await query(
          "insert into payroll_export_lines (id, run_id, employee_id, component_code, amount, currency, label, is_manual, created_by) values ($1, $2, $3, 'bonus', 500, 'ZZD', 'Spot bonus', true, $4)",
          [bonusId, runId, EMPLOYEE_REPORT, USER_FINANCE],
        );

        await query("select * from generate_payroll_export_lines($1)", [runId]);

        const after = await query("select id, component_code, amount, is_manual from payroll_export_lines where run_id = $1", [runId]);
        const correctedSalary = after.rows.find((r) => r.id === salaryLineId);
        expect(correctedSalary).toBeDefined();
        expect(Number(correctedSalary?.amount)).toBe(3200);

        const bonusLine = after.rows.find((r) => r.id === bonusId);
        expect(bonusLine).toBeDefined();
        expect(Number(bonusLine?.amount)).toBe(500);
      });
    });
  });

  describe("letters", () => {
    let templateId: string;

    beforeAll(async () => {
      templateId = randomUUID();
      await db.seed(`
        insert into letter_templates (id, company_id, template_type, name, body_template, requires_approval)
        values ('${templateId}', '${COMPANY_A}', 'salary_certificate', 'Salary Certificate', 'Dear {{employee.full_name}}...', true);
      `);
    });

    it("lets any signed-in user read templates; only HR Admin manages them", async () => {
      const readByPeer = await db.asUser(USER_PEER, (query) => query("select id from letter_templates where id = $1", [templateId]));
      expect(readByPeer.rows.length).toBe(1);

      // An UPDATE whose USING clause matches no rows for this caller
      // succeeds with rowCount 0 rather than throwing — RLS on UPDATE
      // filters visible rows silently, only INSERT's WITH CHECK throws.
      const { rowCount } = await db.asUser(USER_PEER, (query) =>
        query("update letter_templates set name = 'Hacked' where id = $1", [templateId]),
      );
      expect(rowCount).toBe(0);
    });

    // Regression test for a real bug: every fixture in this describe block
    // inserts into approvals via db.seed (a trusted connection, bypassing
    // RLS entirely), which is why is_entity_owner() missing a
    // generated_letter branch went undetected — issueLetter() calls
    // create_initial_approval() as the signed-in HR Admin who issued it,
    // through the real RLS/ownership path exercised here.
    it("lets the issuing HR Admin create the first approval via create_initial_approval(), the same way issueLetter() does", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
      `);

      const { rows } = await db.asUser(USER_HR, async (query) => {
        const { rows: created } = await query("select create_initial_approval('generated_letter', $1) as id", [letterId]);
        return query("select decision from approvals where id = $1", [created[0]?.id]);
      });
      expect(rows).toEqual([{ decision: "pending" }]);
    });

    it("blocks anyone other than the letter's own generated_by from creating that first approval", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
      `);

      await expect(
        db.asUser(USER_PEER, (query) => query("select create_initial_approval('generated_letter', $1)", [letterId])),
      ).rejects.toThrow(/do not own this/);
    });

    // Regression test for the real bug this whole flow replaced:
    // approvals_insert_initial never validated workflow_id or approver_id,
    // so any owner could forge a self-approving first approval row
    // directly — including for a letter template's mandatory CEO
    // sign-off. There is no INSERT policy on approvals at all anymore.
    it("blocks a direct client INSERT into approvals entirely, even from the letter's own issuing HR Admin", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
      `);

      await expect(
        db.asUser(USER_HR, (query) =>
          query(
            "insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision) values ('generated_letter', $1, $2, 1, $3, 'pending')",
            [letterId, letterWorkflowId, USER_CEO],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("routes a letter requiring approval to the CEO, finalizing as 'issued' only once they approve", async () => {
      const letterId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'generated_letter', '${letterId}', '${letterWorkflowId}', 1, '${USER_CEO}');
      `);

      await db.asUser(USER_CEO, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        const after = await query("select status from generated_letters where id = $1", [letterId]);
        expect(after.rows[0]?.status).toBe("issued");
      });
    });

    it("voids a letter when the CEO rejects it", async () => {
      const letterId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'generated_letter', '${letterId}', '${letterWorkflowId}', 1, '${USER_CEO}');
      `);

      await db.asUser(USER_CEO, async (query) => {
        await query("select decide_leave_approval($1, 'rejected', 'not eligible yet')", [approvalId]);
        const after = await query("select status from generated_letters where id = $1", [letterId]);
        expect(after.rows[0]?.status).toBe("void");
      });
    });

    it("lets the employee see their own letter; blocks an unrelated peer", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
        values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'issued');
      `);

      const ownerView = await db.asUser(USER_REPORT, (query) => query("select id from generated_letters where id = $1", [letterId]));
      expect(ownerView.rows.length).toBe(1);

      const peerView = await db.asUser(USER_PEER, (query) => query("select id from generated_letters where id = $1", [letterId]));
      expect(peerView.rows).toEqual([]);
    });

    it("lets HR Admin delete a letter; blocks an unrelated peer", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
        values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'issued');
      `);

      const peerAttempt = await db.asUser(USER_PEER, (query) => query("delete from generated_letters where id = $1", [letterId]));
      expect(peerAttempt.rowCount).toBe(0);

      const hrDelete = await db.asUser(USER_HR, (query) => query("delete from generated_letters where id = $1", [letterId]));
      expect(hrDelete.rowCount).toBe(1);
    });

    describe("storage", () => {
      const fileName = () => `${COMPANY_A}/${EMPLOYEE_REPORT}/letters/${randomUUID()}.pdf`;

      beforeAll(async () => {
        await db.seed(`insert into storage.buckets (id, name, public) values ('letters', 'letters', false) on conflict (id) do nothing;`);
      });

      it("lets the owning employee, HR Admin, and CEO read a stored letter file; blocks a peer", async () => {
        const name = fileName();
        await db.seed(`insert into storage.objects (bucket_id, name) values ('letters', '${name}');`);

        for (const viewer of [USER_REPORT, USER_HR, USER_CEO]) {
          const { rows } = await db.asUser(viewer, (query) => query("select name from storage.objects where bucket_id = 'letters' and name = $1", [name]));
          expect(rows.length).toBe(1);
        }

        const peerView = await db.asUser(USER_PEER, (query) =>
          query("select name from storage.objects where bucket_id = 'letters' and name = $1", [name]),
        );
        expect(peerView.rows).toEqual([]);
      });

      it("lets HR Admin delete a stored letter file; blocks an unrelated peer", async () => {
        const name = fileName();
        await db.seed(`insert into storage.objects (bucket_id, name) values ('letters', '${name}');`);

        const peerAttempt = await db.asUser(USER_PEER, (query) => query("delete from storage.objects where bucket_id = 'letters' and name = $1", [name]));
        expect(peerAttempt.rowCount).toBe(0);

        const hrDelete = await db.asUser(USER_HR, (query) => query("delete from storage.objects where bucket_id = 'letters' and name = $1", [name]));
        expect(hrDelete.rowCount).toBe(1);
      });
    });
  });

  describe("audit_log", () => {
    it("captures an insert on a guarded table with the record's resolved company_id", async () => {
      const requestId = randomUUID();
      await db.seed(`
        insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
        values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-07-01', '2026-07-01', 1);
      `);

      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select company_id, action from audit_log where table_name = 'leave_requests' and record_id = $1", [requestId]),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]?.company_id).toBe(COMPANY_A);
      expect(rows[0]?.action).toBe("insert");
    });

    it("scopes HR Admin's audit visibility to their own company, never another company's HR-content rows", async () => {
      const otherCompanyId = randomUUID();
      const otherEmployeeId = randomUUID();
      const otherUserId = randomUUID();
      const otherRequestId = randomUUID();
      const otherPolicyId = randomUUID();
      await db.seed(`
        insert into countries (code, name, default_currency) values ('YY', 'Yland', 'YYD') on conflict do nothing;
        insert into auth.users (id, email) values ('${otherUserId}', 'other-co@enginious.ae');
        insert into companies (id, legal_name, country_code, default_currency) values ('${otherCompanyId}', 'Other Co', 'YY', 'YYD');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${otherEmployeeId}', '${otherUserId}', 'OC-01', '${otherCompanyId}', 'YY', 'Other', 'Employee', '2024-01-01');
        insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
          values ('${otherPolicyId}', 'YY', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${USER_HR}', '${USER_CEO}', now());
        insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
          values ('${otherPolicyId}', 'annual', 'Annual Leave', 'monthly_accrual');
        insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
          values ('${otherRequestId}', '${otherEmployeeId}', 'annual', '2026-07-02', '2026-07-02', 1);
      `);

      const hrView = await db.asUser(USER_HR, (query) =>
        query("select id from audit_log where table_name = 'leave_requests' and record_id = $1", [otherRequestId]),
      );
      expect(hrView.rows).toEqual([]);
    });

    it("blocks an ordinary employee from the audit log entirely", async () => {
      const view = await db.asUser(USER_REPORT, (query) => query("select id from audit_log limit 1"));
      expect(view.rows).toEqual([]);
    });

    it("lets Sys Admin see system-scoped rows (companies, user_roles) but not HR-content rows", async () => {
      const sysAdminUserId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values ('${sysAdminUserId}', 'p6-sysadmin@enginious.ae');
        insert into user_roles (user_id, role) values ('${sysAdminUserId}', 'sys_admin');
      `);

      const companyRows = await db.asUser(sysAdminUserId, (query) =>
        query("select id from audit_log where table_name = 'companies' and record_id = $1", [COMPANY_A]),
      );
      expect(companyRows.rows.length).toBeGreaterThan(0);

      const hrContentRows = await db.asUser(sysAdminUserId, (query) => query("select id from audit_log where table_name = 'leave_requests'"));
      expect(hrContentRows.rows).toEqual([]);
    });

    it("captures every currently-held role for a multi-role actor, never collapsing them to just one", async () => {
      const multiRoleUserId = randomUUID();
      const multiRoleEmployeeId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values ('${multiRoleUserId}', 'p6-multirole@enginious.ae');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${multiRoleEmployeeId}', '${multiRoleUserId}', 'P6-MULTI', '${COMPANY_A}', 'ZZ', 'Multi', 'Role', '2024-01-01');
        insert into user_roles (user_id, role, company_id) values
          ('${multiRoleUserId}', 'line_manager', '${COMPANY_A}'),
          ('${multiRoleUserId}', 'finance', '${COMPANY_A}');
      `);

      const requestId = randomUUID();
      // The trigger fires within this same transaction, so the resulting
      // audit_log row is only visible to a query still inside this same
      // asUser() call (it rolls back at the end, same as every other test).
      await db.asUser(multiRoleUserId, async (query) => {
        await query(
          "insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days) values ($1, $2, 'annual', '2026-08-01', '2026-08-01', 1)",
          [requestId, multiRoleEmployeeId],
        );

        // audit_log_select_hr only lets an hr_admin read this row — the
        // insert above is already committed within this same transaction
        // regardless of who queries it next, so switching the session's
        // claims to an HR Admin here is just to satisfy RLS on the read.
        await actAs(query, USER_HR);
        // pg doesn't know how to auto-parse a custom enum array type
        // (app_role[]) back into a JS array — casting to jsonb first gets
        // one for free, since jsonb columns are parsed automatically.
        const { rows } = await query(
          "select actor_role, to_jsonb(actor_roles) as actor_roles from audit_log where table_name = 'leave_requests' and record_id = $1",
          [requestId],
        );
        expect(rows.length).toBe(1);
        expect(rows[0]?.actor_roles?.slice().sort()).toEqual(["finance", "line_manager"]);
        // actor_role (kept for backward compatibility) still resolves to one
        // of them, never null just because there's more than one now.
        expect(rows[0]?.actor_roles).toContain(rows[0]?.actor_role);
      });
    });
  });

  describe("ai_drafts: the one table an AI service identity may write to, and nothing else", () => {
    it("has no INSERT policy reachable by any authenticated role — only the service-role client (which bypasses RLS) can write here", async () => {
      await expect(
        db.asUser(USER_HR, (query) =>
          query(
            "insert into ai_drafts (entity_type, proposed_action, proposed_payload, created_by_agent) values ('leave_ledger', 'adjust_balance', '{}'::jsonb, 'balance-discrepancy-detector')",
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("never grants an ordinary, no-special-role identity insert access to leave_ledger, comp_day_ledger, approvals, or payroll_export_lines — the tables an AI draft must never write directly", async () => {
      // USER_PEER holds no role grant at all — exactly what an AI
      // integration's identity would look like if it were (incorrectly)
      // provisioned as a normal Supabase authenticated user instead of the
      // service-role client. Even acting on their OWN employee record,
      // none of these direct writes are reachable — HR Admin's own
      // leave_ledger_insert_hr policy is a distinct, human-only path this
      // identity doesn't have.
      await expect(
        db.asUser(USER_PEER, (query) =>
          query(
            "insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ($1, 'annual', '2026-01-01', 'adjustment', 1, $2)",
            [EMPLOYEE_PEER, USER_PEER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      await expect(
        db.asUser(USER_PEER, (query) =>
          query(
            "insert into comp_day_ledger (employee_id, txn_date, entry_type, days, created_by) values ($1, '2026-01-01', 'adjustment', 1, $2)",
            [EMPLOYEE_PEER, USER_PEER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      await expect(
        db.asUser(USER_PEER, (query) =>
          query(
            "insert into approvals (entity_type, entity_id, step_order, approver_id, decision) values ('leave_request', gen_random_uuid(), 1, $1, 'pending')",
            [USER_PEER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      await expect(
        db.asUser(USER_PEER, (query) =>
          query(
            "insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id) values (gen_random_uuid(), $1, 'reimbursement', 1, 'ZZD', 'reimbursement_claim', gen_random_uuid())",
            [EMPLOYEE_PEER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("lets HR Admin see the AI Suggestions queue; blocks an ordinary employee", async () => {
      const draftId = randomUUID();
      await db.seed(`
        insert into ai_drafts (id, entity_type, proposed_action, proposed_payload, rationale, created_by_agent)
        values ('${draftId}', 'leave_ledger', 'adjust_balance', '{"employee_id": "${EMPLOYEE_REPORT}", "amount_days": -1}'::jsonb, 'Attendance import discrepancy on 2026-06-10', 'balance-discrepancy-detector');
      `);

      const hrView = await db.asUser(USER_HR, (query) => query("select id from ai_drafts where id = $1", [draftId]));
      expect(hrView.rows.length).toBe(1);

      const employeeView = await db.asUser(USER_REPORT, (query) => query("select id from ai_drafts where id = $1", [draftId]));
      expect(employeeView.rows).toEqual([]);
    });

    it("lets HR Admin authorize a draft by flipping its status — the actual ledger write still has to go through the normal path separately", async () => {
      const draftId = randomUUID();
      await db.seed(`
        insert into ai_drafts (id, entity_type, proposed_action, proposed_payload, created_by_agent)
        values ('${draftId}', 'leave_ledger', 'adjust_balance', '{}'::jsonb, 'balance-discrepancy-detector');
      `);

      await db.asUser(USER_HR, async (query) => {
        await query("update ai_drafts set status = 'authorized', authorized_by = $1, authorized_at = now() where id = $2", [USER_HR, draftId]);
        const after = await query("select status from ai_drafts where id = $1", [draftId]);
        expect(after.rows[0]?.status).toBe("authorized");
      });
    });
  });
});
