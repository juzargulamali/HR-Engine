import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// decide_leave_approval()'s writes exist only within the transaction that
// called it — like every asUser() call, that transaction always rolls back
// at the end (see harness.ts). So checking its effect must happen with
// more queries in that SAME asUser() call, never a separate one. Where a
// scenario needs a second actor (e.g. step 2 of an approval chain decided
// by a different person), switch identity mid-transaction with actAs()
// rather than starting a new asUser() call.
async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY_A = "00000000-0000-0000-0000-0000000003a1";

const USER_MANAGER = "00000000-0000-0000-0000-0000000003b1";
const USER_REPORT = "00000000-0000-0000-0000-0000000003b2";
const USER_HR = "00000000-0000-0000-0000-0000000003b3";
const USER_CEO = "00000000-0000-0000-0000-0000000003b4";
const USER_PEER = "00000000-0000-0000-0000-0000000003b5"; // unrelated employee, same company

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000003c1";
const EMPLOYEE_REPORT = "00000000-0000-0000-0000-0000000003c2";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-0000000003c3";

describe("Phase 3 row-level security: leave, ledgers, deduction priority, approvals", () => {
  const db = new RlsTestDatabase();
  let defaultWorkflowId: string;

  // Seeds a leave_requests row plus its first approvals row directly
  // (bypassing RLS, as if the app's submission flow already ran) — every
  // asUser() call is its own transaction that always rolls back, so a test
  // that needs a *pre-existing* pending request to decide on must arrange
  // it this way, never by chaining two separate asUser() calls.
  async function seedPendingRequest(opts: {
    employeeId: string;
    approverId: string;
    startDate: string;
    endDate: string;
    totalDays: number;
  }) {
    const requestId = randomUUID();
    const approvalId = randomUUID();
    await db.seed(`
      insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
        values ('${requestId}', '${opts.employeeId}', 'annual', '${opts.startDate}', '${opts.endDate}', ${opts.totalDays});
      insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
        values ('${approvalId}', 'leave_request', '${requestId}', '${defaultWorkflowId}', 1, '${opts.approverId}');
    `);
    return { requestId, approvalId };
  }

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_MANAGER}', 'manager@enginious.ae'),
        ('${USER_REPORT}', 'report@enginious.ae'),
        ('${USER_HR}', 'hr@enginious.ae'),
        ('${USER_CEO}', 'ceo@enginious.ae'),
        ('${USER_PEER}', 'peer@enginious.ae');

      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Enginious LLC FZ', 'AE', 'AED');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'E001', '${COMPANY_A}', 'AE', 'Maya', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'E002', '${COMPANY_A}', 'AE', 'Ravi', 'Report', '2024-02-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'E003', '${COMPANY_A}', 'AE', 'Priya', 'Peer', '2024-02-01');
      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_REPORT}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_A}');

      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by)
        values ('${EMPLOYEE_REPORT}', 'annual', '2026-01-01', 'accrual', 10, '${USER_HR}');
    `);

    const { rows } = await db.asUser(USER_HR, (query) =>
      query("select id from approval_workflows where company_id = $1 and entity_type = 'leave_request'", [COMPANY_A]),
    );
    defaultWorkflowId = rows[0]?.id;
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("auto-creates a default one-step (direct manager) leave-approval workflow when a company is created", async () => {
    expect(defaultWorkflowId).toBeTruthy();
    const { rows } = await db.asUser(USER_HR, (query) =>
      query("select step_order, approver_type from approval_workflow_steps where workflow_id = $1", [defaultWorkflowId]),
    );
    expect(rows).toEqual([{ step_order: 1, approver_type: "direct_manager" }]);
  });

  describe("submitting a leave request", () => {
    it("lets an employee submit their own request, defaulting to 'submitted'", async () => {
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query(
          `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
           values ($1, 'annual', '2026-03-02', '2026-03-04', 3) returning status`,
          [EMPLOYEE_REPORT],
        ),
      );
      expect(rows).toEqual([{ status: "submitted" }]);
    });

    it("resolves the employee's direct manager as the approver", async () => {
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query("select resolve_approver('direct_manager', $1) as approver", [EMPLOYEE_REPORT]),
      );
      expect(rows[0]?.approver).toBe(USER_MANAGER);
    });

    it("blocks submitting a leave request for someone else", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
             values ($1, 'annual', '2026-03-02', '2026-03-04', 3)`,
            [EMPLOYEE_PEER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("lets the requester insert the first approvals row on their own just-created request", async () => {
      const requestId = randomUUID();
      await db.seed(
        `insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-04-05', '2026-04-05', 1)`,
      );
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query(
          `insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
           values ('leave_request', $1, $2, 1, $3) returning decision`,
          [requestId, defaultWorkflowId, USER_MANAGER],
        ),
      );
      expect(rows).toEqual([{ decision: "pending" }]);
    });

    it("blocks a peer from inserting the first approvals row on someone else's request", async () => {
      const requestId = randomUUID();
      await db.seed(
        `insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-04-06', '2026-04-06', 1)`,
      );
      await expect(
        db.asUser(USER_PEER, (query) =>
          query(
            `insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
             values ('leave_request', $1, $2, 1, $3)`,
            [requestId, defaultWorkflowId, USER_MANAGER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("approving and rejecting", () => {
    it("approves a single-step request and posts the ledger deduction atomically", async () => {
      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-05-04",
        endDate: "2026-05-06",
        totalDays: 3,
      });

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', 'enjoy')", [approvalId]);

        const status = await query("select status from leave_requests where id = $1", [requestId]);
        expect(status.rows[0]?.status).toBe("approved");

        const balance = await query(
          "select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'",
          [EMPLOYEE_REPORT],
        );
        expect(Number(balance.rows[0]?.balance_days)).toBe(7); // 10 accrued - 3 deducted
      });
    });

    it("rejecting stops the chain and leaves the balance untouched", async () => {
      const before = await db.asUser(USER_REPORT, (query) =>
        query("select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'", [EMPLOYEE_REPORT]),
      );

      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        totalDays: 2,
      });

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'rejected', 'not now')", [approvalId]);

        const status = await query("select status from leave_requests where id = $1", [requestId]);
        expect(status.rows[0]?.status).toBe("rejected");

        const after = await query(
          "select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'",
          [EMPLOYEE_REPORT],
        );
        expect(after.rows[0]?.balance_days).toBe(before.rows[0]?.balance_days);
      });
    });

    it("blocks anyone other than the assigned approver from deciding", async () => {
      const { approvalId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-06-10",
        endDate: "2026-06-10",
        totalDays: 1,
      });
      await expect(
        db.asUser(USER_PEER, (query) => query("select decide_leave_approval($1, 'approved', null)", [approvalId])),
      ).rejects.toThrow(/Only the assigned approver/);
    });

    it("blocks deciding the same approval twice", async () => {
      const { approvalId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-06-15",
        endDate: "2026-06-15",
        totalDays: 1,
      });
      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        await expect(query("select decide_leave_approval($1, 'rejected', null)", [approvalId])).rejects.toThrow(
          /already been decided/,
        );
      });
    });

    it("routes to a second workflow step when one exists, and finalizes only after that step decides too", async () => {
      const stepTwoId = randomUUID();
      await db.seed(`
        insert into approval_workflow_steps (id, workflow_id, step_order, approver_type)
        values ('${stepTwoId}', '${defaultWorkflowId}', 2, 'role:hr_admin');
      `);

      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        totalDays: 1,
      });

      try {
        // Both decisions run inside one transaction, switching identity
        // between them with actAs() — a real multi-actor workflow, but
        // still cleanly isolated by the outer asUser() rollback.
        await db.asUser(USER_MANAGER, async (query) => {
          await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

          const afterStep1 = await query("select status from leave_requests where id = $1", [requestId]);
          expect(afterStep1.rows[0]?.status).toBe("pending_approval");

          // Only the step's approver, the requester, or HR Admin can see an
          // approvals row (RLS), and the manager who just decided step 1 is
          // none of those for step 2 — switch to HR (step 2's approver)
          // before reading it.
          await actAs(query, USER_HR);
          const step2 = await query(
            "select id, approver_id, decision from approvals where entity_id = $1 and step_order = 2",
            [requestId],
          );
          expect(step2.rows[0]?.approver_id).toBe(USER_HR);
          expect(step2.rows[0]?.decision).toBe("pending");

          await query("select decide_leave_approval($1, 'approved', null)", [step2.rows[0]?.id]);

          const final = await query("select status from leave_requests where id = $1", [requestId]);
          expect(final.rows[0]?.status).toBe("approved");
        });
      } finally {
        await db.seed(`delete from approval_workflow_steps where id = '${stepTwoId}';`);
      }
    });

    it("never routes an approval step back to the requester themselves (self-approval prevention)", async () => {
      // Grant Ravi (the requester) the hr_admin role too, and route step 2
      // to role:hr_admin — resolve_approver() picks the earliest-granted
      // holder of that role, so this direct setup makes Ravi himself the
      // resolved candidate for step 2, the exact case the guard exists for.
      const stepTwoId = randomUUID();
      await db.seed(`
        insert into user_roles (user_id, role, company_id) values ('${USER_REPORT}', 'hr_admin', '${COMPANY_A}');
        insert into approval_workflow_steps (id, workflow_id, step_order, approver_type)
        values ('${stepTwoId}', '${defaultWorkflowId}', 2, 'role:hr_admin');
      `);

      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-07-15",
        endDate: "2026-07-15",
        totalDays: 1,
      });

      try {
        await db.asUser(USER_MANAGER, async (query) => {
          await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

          // Whatever resolve_approver('role:hr_admin', ...) picks, it must
          // never be the requester — either the request finalizes
          // immediately (the only eligible approver was self, so the step
          // is skipped) or it routes to a *different* hr_admin holder.
          const result = await query("select status from leave_requests where id = $1", [requestId]);
          if (result.rows[0]?.status === "pending_approval") {
            // Switch to HR (hr_admin can see any approvals row) so this
            // check can't silently pass just because the manager's own
            // view of step 2 is empty under RLS.
            await actAs(query, USER_HR);
            const step2 = await query("select approver_id from approvals where entity_id = $1 and step_order = 2", [requestId]);
            expect(step2.rows[0]?.approver_id).toBeTruthy();
            expect(step2.rows[0]?.approver_id).not.toBe(USER_REPORT);
          } else {
            expect(result.rows[0]?.status).toBe("approved");
          }
        });
      } finally {
        await db.seed(`
          delete from approval_workflow_steps where id = '${stepTwoId}';
          update user_roles set revoked_at = now() where user_id = '${USER_REPORT}' and role = 'hr_admin';
        `);
      }
    });
  });

  describe("comp-day deduction priority", () => {
    it("draws from comp-day before the leave ledger when configured to, capped at the available balance", async () => {
      await db.seed(`
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, created_by)
        values ('${EMPLOYEE_PEER}', '2026-01-01', 'earned', 2, 'holiday_worked', '${USER_HR}');
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by)
        values ('${EMPLOYEE_PEER}', 'annual', '2026-01-01', 'accrual', 10, '${USER_HR}');
        insert into deduction_priority_rules (company_id, leave_type_code, source_ledger, priority_order, effective_from) values
          ('${COMPANY_A}', 'annual', 'comp_day', 1, '2026-01-01'),
          ('${COMPANY_A}', 'annual', 'leave_ledger', 2, '2026-01-01');
      `);

      // Priya has no manager set, so this seeds HR directly as the approver
      // to keep the test focused purely on deduction priority, not routing.
      const { approvalId } = await seedPendingRequest({
        employeeId: EMPLOYEE_PEER,
        approverId: USER_HR,
        startDate: "2026-08-03",
        endDate: "2026-08-05",
        totalDays: 3,
      });
      await db.asUser(USER_HR, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

        const compBalance = await query(
          "select coalesce(sum(days),0) as balance from comp_day_ledger where employee_id = $1",
          [EMPLOYEE_PEER],
        );
        expect(Number(compBalance.rows[0]?.balance)).toBe(0); // fully drawn down (2 days)

        const leaveBalance = await query(
          "select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'",
          [EMPLOYEE_PEER],
        );
        expect(Number(leaveBalance.rows[0]?.balance_days)).toBe(9); // 10 accrued - 1 (the shortfall after comp-day)
      });
    });
  });

  describe("visibility", () => {
    it("lets the manager and HR Admin see the report's leave requests and ledger, blocks an unrelated peer", async () => {
      const requestId = randomUUID();
      await db.seed(
        `insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-10-01', '2026-10-01', 1)`,
      );

      const managerView = await db.asUser(USER_MANAGER, (query) => query("select id from leave_requests where id = $1", [requestId]));
      expect(managerView.rows.length).toBe(1);

      const hrView = await db.asUser(USER_HR, (query) => query("select id from leave_requests where id = $1", [requestId]));
      expect(hrView.rows.length).toBe(1);

      const peerView = await db.asUser(USER_PEER, (query) => query("select id from leave_requests where id = $1", [requestId]));
      expect(peerView.rows).toEqual([]);

      const peerLedgerView = await db.asUser(USER_PEER, (query) =>
        query("select id from leave_ledger where employee_id = $1", [EMPLOYEE_REPORT]),
      );
      expect(peerLedgerView.rows).toEqual([]);
    });

    it("lets any signed-in user read deduction priority rules and approval workflows (transparency), but only HR Admin write them", async () => {
      await db.seed(
        `insert into deduction_priority_rules (company_id, leave_type_code, source_ledger, priority_order) values ('${COMPANY_A}', 'maternity', 'leave_ledger', 1)`,
      );

      const readByPeer = await db.asUser(USER_PEER, (query) => query("select id from deduction_priority_rules"));
      expect(readByPeer.rows.length).toBeGreaterThan(0);

      await expect(
        db.asUser(USER_PEER, (query) =>
          query("insert into deduction_priority_rules (company_id, leave_type_code, source_ledger, priority_order) values ($1, 'sick', 'comp_day', 1)", [
            COMPANY_A,
          ]),
        ),
      ).rejects.toThrow(/row-level security/);

      const hrInsert = await db.asUser(USER_HR, (query) =>
        query(
          "insert into deduction_priority_rules (company_id, leave_type_code, source_ledger, priority_order) values ($1, 'sick', 'comp_day', 1) returning id",
          [COMPANY_A],
        ),
      );
      expect(hrInsert.rows.length).toBe(1);
    });

    it("never lets a client directly insert or update a decided approval row outside decide_leave_approval()", async () => {
      const { approvalId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        totalDays: 1,
      });

      const { rowCount } = await db.asUser(USER_MANAGER, (query) =>
        query("update approvals set decision = 'approved' where id = $1", [approvalId]),
      );
      expect(rowCount).toBe(0); // no UPDATE policy exists at all for approvals
    });
  });
});
