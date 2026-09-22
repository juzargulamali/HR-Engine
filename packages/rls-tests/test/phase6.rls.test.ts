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
        ('${USER_PEER}', 'p6-peer@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Phase 6 Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'P6-01', '${COMPANY_A}', 'ZZ', 'Remi', 'Report', '2024-01-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'P6-02', '${COMPANY_A}', 'ZZ', 'Pia', 'Peer', '2024-01-01');

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_FINANCE}', 'finance', '${COMPANY_A}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_A}');
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
  });

  describe("payroll export authorization", () => {
    async function seedDraftRun(month: number) {
      const runId = randomUUID();
      await db.seed(`
        insert into payroll_export_runs (id, company_id, period_month, period_year, generated_by)
        values ('${runId}', '${COMPANY_A}', ${month}, 2026, '${USER_FINANCE}');
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
    // went undetected — submitPayrollExport() inserts as the signed-in
    // Finance user, through the real RLS path exercised here.
    it("lets the generating Finance user insert the first approval row directly, the same way submitPayrollExport() does", async () => {
      const runId = await seedDraftRun(7);
      await db.seed(`update payroll_export_runs set status = 'submitted' where id = '${runId}';`);

      const { rows } = await db.asUser(USER_FINANCE, (query) =>
        query(
          "insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision) values ('payroll_export_run', $1, $2, 1, $3, 'pending') returning id",
          [runId, payrollWorkflowId, USER_FINANCE],
        ),
      );
      expect(rows.length).toBe(1);
    });

    it("blocks anyone other than the run's own generated_by from inserting that first approval row", async () => {
      const runId = await seedDraftRun(8);
      await db.seed(`update payroll_export_runs set status = 'submitted' where id = '${runId}';`);

      await expect(
        db.asUser(USER_HR, (query) =>
          query(
            "insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision) values ('payroll_export_run', $1, $2, 1, $3, 'pending')",
            [runId, payrollWorkflowId, USER_FINANCE],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("generate_payroll_export_lines: reconciliation", () => {
    it("includes only approved reimbursements and this period's leave encashments, and is idempotent on re-run", async () => {
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
        expect(rows.length).toBe(2);

        const reimbursementLine = rows.find((r) => r.component_code === "reimbursement");
        expect(reimbursementLine?.source_reference_id).toBe(approvedClaimId);
        expect(Number(reimbursementLine?.amount)).toBe(200);

        const encashmentLine = rows.find((r) => r.component_code === "leave_encashment");
        expect(Number(encashmentLine?.amount)).toBe(3);

        const rerun = await query("select * from generate_payroll_export_lines($1)", [runId]);
        expect(rerun.rows).toEqual([]);

        const total = await query("select count(*) from payroll_export_lines where run_id = $1", [runId]);
        expect(Number(total.rows[0]?.count)).toBe(2);
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
    // generated_letter branch went undetected — issueLetter() inserts as
    // the signed-in HR Admin who issued it, through the real RLS path
    // exercised here.
    it("lets the issuing HR Admin insert the first approval row directly, the same way issueLetter() does", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
      `);

      const { rows } = await db.asUser(USER_HR, (query) =>
        query(
          "insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision) values ('generated_letter', $1, $2, 1, $3, 'pending') returning id",
          [letterId, letterWorkflowId, USER_CEO],
        ),
      );
      expect(rows.length).toBe(1);
    });

    it("blocks anyone other than the letter's own generated_by from inserting that first approval row", async () => {
      const letterId = randomUUID();
      await db.seed(`
        insert into generated_letters (id, employee_id, template_id, generated_by, status)
          values ('${letterId}', '${EMPLOYEE_REPORT}', '${templateId}', '${USER_HR}', 'pending_approval');
      `);

      await expect(
        db.asUser(USER_PEER, (query) =>
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
      await db.seed(`
        insert into countries (code, name, default_currency) values ('YY', 'Yland', 'YYD') on conflict do nothing;
        insert into auth.users (id, email) values ('${otherUserId}', 'other-co@enginious.ae');
        insert into companies (id, legal_name, country_code, default_currency) values ('${otherCompanyId}', 'Other Co', 'YY', 'YYD');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${otherEmployeeId}', '${otherUserId}', 'OC-01', '${otherCompanyId}', 'YY', 'Other', 'Employee', '2024-01-01');
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
