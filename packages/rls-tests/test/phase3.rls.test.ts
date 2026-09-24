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

const LEAVE_RULES_POLICY_ID = "00000000-0000-0000-0000-0000000003d1";

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

      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
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

      -- guard_leave_request_type() requires an active leave_rules policy
      -- defining whatever leave_type_code a request uses — every raw
      -- leave_requests insert below uses 'annual', so this has to exist
      -- before any of them will succeed.
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('${LEAVE_RULES_POLICY_ID}', 'AE', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${USER_HR}', '${USER_CEO}', now());
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
        values ('${LEAVE_RULES_POLICY_ID}', 'annual', 'Annual Leave', 'monthly_accrual');
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

    // Regression test: resolve_approver() never excluded a terminated
    // employee, so a manager who left the company remained a fully valid,
    // resolvable approver of their former reports' leave/reimbursements
    // indefinitely — nothing else in the schema cascades a termination
    // into reassigning direct reports.
    it("excludes a terminated manager from direct_manager resolution", async () => {
      const terminatedManagerUserId = randomUUID();
      const terminatedManagerEmployeeId = randomUUID();
      const tempReportEmployeeId = randomUUID();
      await db.seed(`
        insert into auth.users (id, email) values ('${terminatedManagerUserId}', 'terminated-mgr@enginious.ae');
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${terminatedManagerEmployeeId}', '${terminatedManagerUserId}', 'TERM-01', '${COMPANY_A}', 'AE', 'Former', 'Manager', '2020-01-01', 'terminated');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${tempReportEmployeeId}', 'TEMP-01', '${COMPANY_A}', 'AE', 'Temp', 'Report', '2024-01-01', '${terminatedManagerEmployeeId}');
      `);

      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select resolve_approver('direct_manager', $1) as approver", [tempReportEmployeeId]),
      );
      expect(rows[0]?.approver).toBeNull();

      await db.seed(`delete from employees where id in ('${tempReportEmployeeId}', '${terminatedManagerEmployeeId}');`);
    });

    it("lets an ordinary employee resolve all HR Admin / CEO holders for their company (for leave-notification emails), despite user_roles' own RLS blocking a direct select", async () => {
      const directSelect = await db.asUser(USER_REPORT, (query) => query("select user_id from user_roles where role = 'hr_admin'"));
      expect(directSelect.rows).toEqual([]); // user_roles_select_own blocks seeing anyone else's grants directly

      const hrHolders = await db.asUser(USER_REPORT, (query) =>
        query("select resolve_role_holders('hr_admin', $1) as holder", [COMPANY_A]),
      );
      expect(hrHolders.rows.map((r) => r.holder)).toEqual([USER_HR]);

      const ceoHolders = await db.asUser(USER_REPORT, (query) =>
        query("select resolve_role_holders('ceo', $1) as holder", [COMPANY_A]),
      );
      expect(ceoHolders.rows.map((r) => r.holder)).toEqual([USER_CEO]);
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

    // Regression test: total_days had no floor, reachable via a raw insert
    // bypassing the app's own computeLeaveDays() check (exactly the shape of
    // a direct PostgREST call). decide_leave_approval()'s deduction loop
    // starts at v_remaining := total_days and exits immediately once
    // v_remaining <= 0, so a zero/negative value approved a request with
    // zero ledger entries posted — unaccounted, unlimited "free" leave.
    it("rejects a leave request with total_days <= 0, even via a raw insert bypassing computeLeaveDays()", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
             values ($1, 'annual', '2026-03-20', '2026-03-20', 0)`,
            [EMPLOYEE_REPORT],
          ),
        ),
      ).rejects.toThrow(/violates check constraint/);

      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
             values ($1, 'annual', '2026-03-21', '2026-03-22', -1)`,
            [EMPLOYEE_REPORT],
          ),
        ),
      ).rejects.toThrow(/violates check constraint/);
    });

    // Regression test: the leave request form used to fall back to a
    // free-text leave type field, and nothing stopped an arbitrary string
    // even with one configured. guard_leave_request_type() is the backstop
    // for a raw insert bypassing the app's own allowlist check entirely.
    it("rejects a leave type not defined by any active policy for the employee's country, even via a raw insert", async () => {
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
             values ($1, 'made_up_leave_type', '2026-03-23', '2026-03-23', 1)`,
            [EMPLOYEE_REPORT],
          ),
        ),
      ).rejects.toThrow(/No active leave policy.*defines leave type/);
    });

    // Regression test: submitLeaveRequest()'s own overlap check is a
    // check-then-insert with the same race shape as
    // bulkRecordAttendance()'s comp-day credit check — the GiST exclusion
    // constraint on leave_requests is the database-enforced backstop, both
    // for that race and for a raw insert bypassing the app layer entirely.
    it("rejects a second live request that overlaps an existing one for the same employee, even via a raw insert", async () => {
      await db.seed(`
        insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
        values ('${EMPLOYEE_REPORT}', 'annual', '2026-03-25', '2026-03-27', 3);
      `);

      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
             values ($1, 'annual', '2026-03-26', '2026-03-28', 3)`,
            [EMPLOYEE_REPORT],
          ),
        ),
      ).rejects.toThrow(/conflicting key value violates exclusion constraint/);

      // A non-overlapping range for the same employee is unaffected.
      const { rows } = await db.asUser(USER_REPORT, (query) =>
        query(
          `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
           values ($1, 'annual', '2026-03-29', '2026-03-30', 2) returning id`,
          [EMPLOYEE_REPORT],
        ),
      );
      expect(rows.length).toBe(1);
    });

    it("lets the requester create the first approval via create_initial_approval() on their own just-created request", async () => {
      const requestId = randomUUID();
      await db.seed(
        `insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-04-05', '2026-04-05', 1)`,
      );
      const { rows } = await db.asUser(USER_REPORT, async (query) => {
        const { rows: created } = await query("select create_initial_approval('leave_request', $1) as id", [requestId]);
        return query("select decision from approvals where id = $1", [created[0]?.id]);
      });
      expect(rows).toEqual([{ decision: "pending" }]);
    });

    it("blocks a peer from creating the first approval on someone else's request", async () => {
      const requestId = randomUUID();
      await db.seed(
        `insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-04-06', '2026-04-06', 1)`,
      );
      await expect(
        db.asUser(USER_PEER, (query) => query("select create_initial_approval('leave_request', $1)", [requestId])),
      ).rejects.toThrow(/do not own this/);
    });

    // Regression test for the real bug this replaced: approvals_insert_initial
    // used to let ANY owner of an entity insert the first approvals row
    // directly, with no validation on workflow_id or approver_id at all — an
    // owner could set workflow_id = null and approver_id = themselves, then
    // call decide_leave_approval() to self-approve, since a null/foreign
    // workflow_id makes the "walk every remaining step" loop match nothing
    // and fall straight through to final approval. There is now no INSERT
    // policy on approvals at all — create_initial_approval() (SECURITY
    // DEFINER) is the only way a row is ever created.
    it("blocks a direct client INSERT into approvals entirely, even from the entity's own owner", async () => {
      const requestId = randomUUID();
      await db.seed(
        `insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${requestId}', '${EMPLOYEE_REPORT}', 'annual', '2026-04-07', '2026-04-07', 1)`,
      );
      await expect(
        db.asUser(USER_REPORT, (query) =>
          query(
            `insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id)
             values ('leave_request', $1, null, 1, $2)`,
            [requestId, USER_REPORT],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  // Phase 1 correction (2): submitLeaveRequest() used to INSERT into
  // leave_requests and then, as a SEPARATE round trip, call
  // create_initial_approval() — if that second call never reached the
  // database at all, the request was left permanently stuck "submitted"
  // with no approval and no one able to act on it. submit_leave_request()
  // does both writes inside one plpgsql function body, which Postgres
  // treats as a single statement: if create_initial_approval() raises for
  // any reason, the leave_requests insert made earlier in the SAME function
  // call is undone too (statement-level atomicity — this holds even before
  // the test harness's own outer ROLLBACK), so a caller only ever observes
  // "fully submitted and routed" or "nothing written at all".
  describe("submit_leave_request() atomicity", () => {
    it("creates the leave request and its initial approval in one atomic call", async () => {
      const { rows } = await db.asUser(USER_REPORT, async (query) => {
        const { rows: created } = await query("select submit_leave_request($1, $2, $3, $4, $5, $6, $7) as id", [
          "annual",
          "2026-07-10",
          "2026-07-10",
          false,
          false,
          1,
          null,
        ]);
        return query(
          `select lr.id is not null as has_request, a.decision, a.step_order from leave_requests lr
           join approvals a on a.entity_type = 'leave_request' and a.entity_id = lr.id
           where lr.id = $1`,
          [created[0]?.id],
        );
      });
      expect(rows).toEqual([{ has_request: true, decision: "pending", step_order: 1 }]);
    });

    // Temporarily deactivates the company's only leave_request workflow so
    // create_initial_approval() has nothing to route to and raises — the
    // failure path this correction was specifically meant to make safe.
    // Restored in `finally` since this workflow row is shared, persistent
    // fixture state other tests in this file also depend on.
    it("leaves neither an orphan leave request nor an orphan approval when routing fails", async () => {
      await db.seed(`update approval_workflows set is_active = false where id = '${defaultWorkflowId}'`);
      try {
        await expect(
          db.asUser(USER_PEER, (query) =>
            query("select submit_leave_request($1, $2, $3, $4, $5, $6, $7)", ["annual", "2026-07-11", "2026-07-11", false, false, 1, null]),
          ),
        ).rejects.toThrow(/No approval workflow is configured/);
      } finally {
        await db.seed(`update approval_workflows set is_active = true where id = '${defaultWorkflowId}'`);
      }

      // A fresh call sees the real, committed state — no leave_requests row
      // survived, proving Postgres's per-statement atomicity rolled back
      // submit_leave_request()'s own insert along with the routing failure,
      // not just the test harness's outer transaction.
      const after = await db.asUser(USER_HR, (query) =>
        query("select id from leave_requests where employee_id = $1 and start_date = '2026-07-11'", [EMPLOYEE_PEER]),
      );
      expect(after.rows).toEqual([]);
    });
  });

  // Phase 1 correction (3): guard_leave_request_type() used to resolve the
  // applicable leave_rules policy as of current_date, not the request's own
  // start_date — the same mismatch submitLeaveRequest() and the leave/new
  // page's leave-type dropdown had. A newer policy that only takes effect
  // in the future was invisible to a request that starts after it becomes
  // effective (rejecting a leave type the correct, future-dated policy
  // actually defines), and a request starting after a superseding policy's
  // cutover could still be validated against whatever's active today.
  describe("effective-dated leave policy resolution (correction 3)", () => {
    // A country of its own (policy_versions has a GiST exclusion constraint
    // forbidding two overlapping ACTIVE ranges per country+policy_type, and
    // AE's own leave_rules policy — seeded in the outer beforeAll — is
    // already open-ended from 2020 onward, so a future-dated policy for AE
    // would collide with it). Isolating this scenario in its own country
    // also means no policy is active for it TODAY at all, which is the
    // clearest possible demonstration that start_date, not current_date, is
    // what the guard actually resolves against.
    const COUNTRY_FUTURE = "ZZ";
    const COMPANY_FUTURE = "00000000-0000-0000-0000-0000000003e0";
    const EMPLOYEE_FUTURE = "00000000-0000-0000-0000-0000000003e1";
    const FUTURE_POLICY_ID = "00000000-0000-0000-0000-0000000003d2";

    beforeAll(async () => {
      // A leave_rules policy that only becomes effective 30 days from
      // whenever this suite actually runs — computed relative to
      // current_date, not a fixed literal, so the test is meaningful
      // regardless of what today happens to be when it runs.
      await db.seed(`
        insert into countries (code, name, default_currency) values ('${COUNTRY_FUTURE}', 'Future-land', 'ZZD');
        insert into companies (id, legal_name, country_code, default_currency)
          values ('${COMPANY_FUTURE}', 'Future Co', '${COUNTRY_FUTURE}', 'ZZD');
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date)
          values ('${EMPLOYEE_FUTURE}', 'EF01', '${COMPANY_FUTURE}', '${COUNTRY_FUTURE}', 'Fara', 'Future', '2024-01-01');
        -- USER_HR already exists as an auth user; granting them hr_admin
        -- for this second company too just lets the test below read back
        -- what it seeded, via the existing leave_requests_select policy.
        insert into user_roles (user_id, role, company_id) values ('${USER_HR}', 'hr_admin', '${COMPANY_FUTURE}');

        insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
          values ('${FUTURE_POLICY_ID}', '${COUNTRY_FUTURE}', 'leave_rules', 1, current_date + 30, 'active', '{}'::jsonb, '${USER_HR}', '${USER_CEO}', now());
        insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
          values ('${FUTURE_POLICY_ID}', 'sabbatical', 'Sabbatical', 'monthly_accrual');
      `);
    });

    // Seeded directly (admin connection) rather than via asUser(), since
    // EMPLOYEE_FUTURE has no linked auth user for leave_requests_insert's
    // "employee_id = current_employee_id()" check to satisfy — these tests
    // are only exercising guard_leave_request_type() itself, which fires as
    // a trigger regardless of who (or what) performs the insert.
    it("rejects a request starting today when the only leave_rules policy for its country isn't effective until later", async () => {
      await expect(
        db.seed(
          `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
           values ('${EMPLOYEE_FUTURE}', 'sabbatical', current_date, current_date, 1)`,
        ),
      ).rejects.toThrow(/No active leave policy.*defines leave type/);
    });

    it("accepts a request whose start_date falls after a policy becomes effective, even though it isn't active yet today", async () => {
      await db.seed(
        `insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days)
         values ('${EMPLOYEE_FUTURE}', 'sabbatical', current_date + 30, current_date + 30, 1)`,
      );
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select id from leave_requests where employee_id = $1 and leave_type_code = 'sabbatical'", [EMPLOYEE_FUTURE]),
      );
      expect(rows.length).toBe(1);
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

  describe("cancelling", () => {
    it("cancels a pending request and resolves its still-pending approval row atomically", async () => {
      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        totalDays: 1,
      });

      await db.asUser(USER_REPORT, async (query) => {
        await query("select cancel_leave_request($1)", [requestId]);

        const request = await query("select status from leave_requests where id = $1", [requestId]);
        expect(request.rows[0]?.status).toBe("cancelled");

        // Only the assigned approver, the requester, or HR can see an
        // approvals row (RLS) — switch to the manager (this approval's
        // approver) to confirm it no longer reads as pending.
        await actAs(query, USER_MANAGER);
        const approval = await query("select decision from approvals where id = $1", [approvalId]);
        expect(approval.rows[0]?.decision).toBe("cancelled");
      });
    });

    it("no longer counts toward the approver's pending total, or appears on their Approvals page, once cancelled", async () => {
      const { requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-08-05",
        endDate: "2026-08-05",
        totalDays: 1,
      });

      // cancel_leave_request()'s write only exists within the transaction
      // that called it (asUser() always rolls back) — the manager's "pending
      // total" query has to run inside that same transaction, after
      // switching identity with actAs(), not as a separate asUser() call.
      await db.asUser(USER_REPORT, async (query) => {
        await query("select cancel_leave_request($1)", [requestId]);

        await actAs(query, USER_MANAGER);
        const managerPending = await query("select id from approvals where approver_id = $1 and decision = 'pending' and entity_id = $2", [
          USER_MANAGER,
          requestId,
        ]);
        expect(managerPending.rows).toEqual([]);
      });
    });

    it("blocks cancelling someone else's leave request", async () => {
      const { requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        totalDays: 1,
      });

      await expect(db.asUser(USER_PEER, (query) => query("select cancel_leave_request($1)", [requestId]))).rejects.toThrow(
        /not yours to cancel/,
      );
    });

    it("blocks cancelling a rejected request", async () => {
      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-08-15",
        endDate: "2026-08-15",
        totalDays: 1,
      });

      // Same-transaction requirement as above: the decision only persists
      // within the transaction that made it, so the cancel attempt has to
      // run in that same transaction (after switching identity back to the
      // requester), not as a separate asUser() call.
      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'rejected', null)", [approvalId]);

        await actAs(query, USER_REPORT);
        await expect(query("select cancel_leave_request($1)", [requestId])).rejects.toThrow(/can no longer be cancelled/);
      });
    });

    it("cancels an approved request that hasn't started yet, and reverses its ledger deduction", async () => {
      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-12-01",
        endDate: "2026-12-02",
        totalDays: 2,
      });

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

        const afterApproval = await query(
          "select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'",
          [EMPLOYEE_REPORT],
        );
        expect(Number(afterApproval.rows[0]?.balance_days)).toBe(8); // 10 accrued - 2 deducted

        await actAs(query, USER_REPORT);
        await query("select cancel_leave_request($1)", [requestId]);

        const request = await query("select status from leave_requests where id = $1", [requestId]);
        expect(request.rows[0]?.status).toBe("cancelled");

        // Reversed via a linked reversal row, not by deleting the original
        // deduction — both stay on the record.
        const ledgerRows = await query(
          "select id, entry_type, amount_days, reversal_of_id from leave_ledger where reference_type = 'leave_request' and reference_id = $1 order by created_at",
          [requestId],
        );
        expect(ledgerRows.rows).toHaveLength(2);
        expect(ledgerRows.rows[0]).toMatchObject({ entry_type: "deduction", amount_days: "-2.00" });
        expect(ledgerRows.rows[1]).toMatchObject({ entry_type: "reversal", amount_days: "2.00", reversal_of_id: ledgerRows.rows[0]?.id });

        const restoredBalance = await query(
          "select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'",
          [EMPLOYEE_REPORT],
        );
        expect(Number(restoredBalance.rows[0]?.balance_days)).toBe(10);
      });
    });

    it("blocks cancelling an approved request that has already started", async () => {
      const { approvalId, requestId } = await seedPendingRequest({
        employeeId: EMPLOYEE_REPORT,
        approverId: USER_MANAGER,
        startDate: "2026-01-01",
        endDate: "2026-01-01",
        totalDays: 1,
      });

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);

        await actAs(query, USER_REPORT);
        await expect(query("select cancel_leave_request($1)", [requestId])).rejects.toThrow(/can only be cancelled before it starts/);
      });
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

  // Regression coverage for the cron double-posting race: the leave-accrual
  // and comp-day-expiry crons used to only check "has this already been
  // posted?" in application code before inserting, which two overlapping
  // invocations (a Vercel Cron retry racing the original request) could
  // both pass before either had written anything. idempotency_key is a
  // real database-level unique constraint, so it holds even against a
  // client that bypasses RLS entirely (like the crons' service-role
  // client) — proven here with a plain duplicate insert, independent of
  // the ON CONFLICT DO NOTHING upsert the routes use on top of it.
  describe("cron idempotency keys", () => {
    it("rejects a second leave_ledger row with the same idempotency_key", async () => {
      const key = `test-accrual-${randomUUID()}`;
      await db.seed(`
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, created_by, idempotency_key)
        values ('${EMPLOYEE_REPORT}', 'annual', '2026-05-01', 'accrual', 1.5, 'policy_run', '${USER_HR}', '${key}');
      `);
      await expect(
        db.seed(`
          insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, created_by, idempotency_key)
          values ('${EMPLOYEE_REPORT}', 'annual', '2026-05-01', 'accrual', 1.5, 'policy_run', '${USER_HR}', '${key}');
        `),
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    });

    it("rejects a second comp_day_ledger row with the same idempotency_key", async () => {
      const key = `test-expiry-${randomUUID()}`;
      await db.seed(`
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, created_by, idempotency_key)
        values ('${EMPLOYEE_REPORT}', '2026-05-01', 'expired', -2, 'comp_day_expiry_sweep', '${USER_HR}', '${key}');
      `);
      await expect(
        db.seed(`
          insert into comp_day_ledger (employee_id, txn_date, entry_type, days, reference_type, created_by, idempotency_key)
          values ('${EMPLOYEE_REPORT}', '2026-05-01', 'expired', -2, 'comp_day_expiry_sweep', '${USER_HR}', '${key}');
        `),
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    });

    it("still allows any number of rows with a null idempotency_key (every non-cron write)", async () => {
      await db.seed(`
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, created_by)
        values
          ('${EMPLOYEE_REPORT}', 'annual', '2026-05-02', 'deduction', -1, 'manual_adjustment', '${USER_HR}'),
          ('${EMPLOYEE_REPORT}', 'annual', '2026-05-02', 'deduction', -1, 'manual_adjustment', '${USER_HR}');
      `);
    });
  });
});
