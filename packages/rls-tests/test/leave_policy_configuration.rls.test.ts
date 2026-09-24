import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Phase 2b (leave-policy-configuration), correction round: Recovery Leave
// earning is now approval-gated (Line Manager, then HR Admin) — neither
// record_overnight_recovery_credit() nor record_attendance_and_recovery()
// (phase4.rls.test.ts's own describe block) post a comp_day_ledger 'earned'
// row directly any more. Both only ever create a recovery_credit_requests
// row and route it through the existing generic approval engine
// (create_initial_approval / decide_leave_approval); the ledger is credited
// solely at HR Admin's final approval. This file covers: the two earning
// RPCs' request-creation behavior, the full approval chain to an actual
// ledger post, termination forfeiture (including the atomic
// terminate_employee() wrapper), the safe comp-day-exclusive deduction fix
// in decide_leave_approval()'s leave_request finalization, and the UAE/
// Saudi/Poland workweek preflight.

async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

const COMPANY_A = "00000000-0000-0000-0000-00000000ab01";

const USER_MANAGER = "00000000-0000-0000-0000-00000000ab11";
const USER_REPORT = "00000000-0000-0000-0000-00000000ab12";
const USER_HR = "00000000-0000-0000-0000-00000000ab13";
const USER_PEER = "00000000-0000-0000-0000-00000000ab14";

const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-00000000ab21";
const EMPLOYEE_REPORT = "00000000-0000-0000-0000-00000000ab22";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-00000000ab23";

describe("Phase 2b row-level security: overnight recovery credit + termination forfeiture", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_MANAGER}', 'p2b-manager@enginious.ae'),
        ('${USER_REPORT}', 'p2b-report@enginious.ae'),
        ('${USER_HR}', 'p2b-hr@enginious.ae'),
        ('${USER_PEER}', 'p2b-peer@enginious.ae');

      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD')
      on conflict (code) do nothing;
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Phase 2b Co', 'ZZ', 'ZZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'P2B-01', '${COMPANY_A}', 'ZZ', 'Mona', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_REPORT}', '${USER_REPORT}', 'P2B-02', '${COMPANY_A}', 'ZZ', 'Remy', 'Report', '2024-02-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'P2B-03', '${COMPANY_A}', 'ZZ', 'Pia', 'Peer', '2024-02-01');
      update employees set manager_id = '${EMPLOYEE_MANAGER}' where id = '${EMPLOYEE_REPORT}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}');

      -- An active leave_rules policy defining 'recovery' as a valid leave
      -- type for 'ZZ' — guard_leave_request_type() requires this before any
      -- leave_requests row with leave_type_code = 'recovery' can even be
      -- inserted. Also a comp_day-only deduction_priority_rules row, the
      -- same shape this migration seeds for AE/SA/PL, so the safe-deduction
      -- fix (decide_leave_approval()) can be exercised in isolation here
      -- without depending on those country-specific seeded rows.
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by) values
        ('00000000-0000-0000-0000-00000000ab90', 'ZZ', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${USER_HR}');
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method) values
        ('00000000-0000-0000-0000-00000000ab90', 'recovery', 'Recovery Leave', 'annual_grant'),
        ('00000000-0000-0000-0000-00000000ab90', 'annual', 'Annual Leave', 'monthly_accrual');
      insert into deduction_priority_rules (country_code, leave_type_code, source_ledger, priority_order, effective_from)
        values ('ZZ', 'recovery', 'comp_day', 1, '2020-01-01');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  // Recovery Leave earning is approval-gated (Line Manager, then HR Admin)
  // — walks a recovery_credit_requests row all the way to its final,
  // ledger-posting approval. Must run inside ONE asUser() call (started as
  // the manager, the first step's approver), switching to USER_HR with
  // actAs() for the second.
  async function fullyApproveRecoveryCredit(query: Client["query"], attendanceRecordId: string) {
    const request = await query(
      "select id from recovery_credit_requests where attendance_record_id = $1 and status not in ('cancelled', 'rejected')",
      [attendanceRecordId],
    );
    const requestId = request.rows[0]?.id;

    await actAs(query, USER_MANAGER);
    const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [requestId]);
    await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);

    await actAs(query, USER_HR);
    const step2 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 2", [requestId]);
    await query("select decide_leave_approval($1, 'approved', null)", [step2.rows[0]?.id]);

    return requestId;
  }

  describe("record_overnight_recovery_credit()", () => {
    async function seedAttendance(workDate: string, employeeId: string = EMPLOYEE_REPORT) {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${employeeId}', '${workDate}', 'present');`);
    }

    it("requires an existing attendance record for the day first", async () => {
      await expect(
        db.asUser(USER_HR, (query) =>
          query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-01"]),
        ),
      ).rejects.toThrow(/Record ordinary attendance/);
    });

    it("grants nothing (no request created) when work ends exactly at midnight (0 active hours after midnight)", async () => {
      await seedAttendance("2026-07-02");
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from record_overnight_recovery_credit($1, $2, true, 0)", [EMPLOYEE_REPORT, "2026-07-02"]);
        expect(rows).toEqual([{ credited: false, credit_days: "0" }]);

        const request = await query(
          "select id from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-07-02')",
          [EMPLOYEE_REPORT],
        );
        expect(request.rows).toEqual([]);
      });
    });

    it("creates a 0.5-day request for continuing to 2:00am (2 active hours after midnight)", async () => {
      await seedAttendance("2026-07-03");
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, true, 2)", [EMPLOYEE_REPORT, "2026-07-03"]),
      );
      expect(rows).toEqual([{ credited: true, credit_days: "0.5" }]);
    });

    it("creates a 0.5-day request for continuing to exactly 4:00am — the inclusive boundary", async () => {
      await seedAttendance("2026-07-04");
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, true, 4)", [EMPLOYEE_REPORT, "2026-07-04"]),
      );
      expect(rows).toEqual([{ credited: true, credit_days: "0.5" }]);
    });

    it("creates a 1-day request for continuing to 5:00am (over the 4-hour threshold), not an immediate ledger credit", async () => {
      await seedAttendance("2026-07-05");
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-05"]);
        expect(rows).toEqual([{ credited: true, credit_days: "1" }]);

        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-07-05'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;

        const ledgerBefore = await query("select id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1", [
          recordId,
        ]);
        expect(ledgerBefore.rows).toEqual([]);

        const request = await query("select event_type, proposed_days, status from recovery_credit_requests where attendance_record_id = $1", [
          recordId,
        ]);
        expect(request.rows).toEqual([{ event_type: "overnight", proposed_days: "1.0", status: "submitted" }]);
      });
    });

    it("requires the normal scheduled day to have been completed first, regardless of hours", async () => {
      await seedAttendance("2026-07-06");
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, false, 5)", [EMPLOYEE_REPORT, "2026-07-06"]),
      );
      expect(rows).toEqual([{ credited: false, credit_days: "0" }]);
    });

    it("rejects a negative active_hours_after_midnight value", async () => {
      await seedAttendance("2026-07-07");
      await expect(
        db.asUser(USER_HR, (query) => query("select * from record_overnight_recovery_credit($1, $2, true, -1)", [EMPLOYEE_REPORT, "2026-07-07"])),
      ).rejects.toThrow(/non-negative/);
    });

    it("is idempotent under a repeated (double-submitted) call — never creates a second request for the same day", async () => {
      await seedAttendance("2026-07-08");
      await db.asUser(USER_HR, async (query) => {
        const first = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-08"]);
        expect(first.rows).toEqual([{ credited: true, credit_days: "1" }]);

        const second = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-08"]);
        expect(second.rows).toEqual([{ credited: false, credit_days: "0" }]);

        const requests = await query(
          "select status from recovery_credit_requests where attendance_record_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-07-08')",
          [EMPLOYEE_REPORT],
        );
        expect(requests.rows).toEqual([{ status: "submitted" }]);
      });
    });

    // Reuses the SAME natural-key protection (the partial unique index on
    // recovery_credit_requests, backstopped by the guard trigger on
    // comp_day_ledger once a credit is actually posted) — a day already
    // holding an active request from the standard weekend/holiday path must
    // not also earn an overnight one (the policy brief's "the same working
    // hours cannot generate duplicate credits").
    it("does not double-credit a day that already has an active request from the standard weekend/holiday path", async () => {
      // 2026-07-11 is a Saturday under ZZ's default week_start_day (1, Monday).
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-07-11",
          JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present", hours_worked: 8 }]),
        ]);

        const { rows } = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-11"]);
        expect(rows).toEqual([{ credited: false, credit_days: "0" }]);

        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-07-11'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        const requests = await query("select event_type from recovery_credit_requests where attendance_record_id = $1", [recordId]);
        expect(requests.rows).toEqual([{ event_type: "standard" }]);
      });
    });

    it("lets the employee's own manager record an overnight credit (and does not treat this as self-approval)", async () => {
      await seedAttendance("2026-07-09");
      const { rows } = await db.asUser(USER_MANAGER, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-09"]),
      );
      expect(rows).toEqual([{ credited: true, credit_days: "1" }]);
    });

    it("blocks an unrelated peer (not HR Admin, not this employee's manager) from recording a credit", async () => {
      await seedAttendance("2026-07-10");
      await expect(
        db.asUser(USER_PEER, (query) => query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-10"])),
      ).rejects.toThrow(/Only HR Admin or this employee's manager/);
    });

    it("blocks the employee from recording their own overnight credit (never trust a self-supplied flag)", async () => {
      await seedAttendance("2026-07-12");
      await expect(
        db.asUser(USER_REPORT, (query) => query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-12"])),
      ).rejects.toThrow(/Only HR Admin or this employee's manager/);
    });
  });

  describe("recovery_credit approval chain (decide_leave_approval)", () => {
    it("manager approval alone (step 1) never posts a ledger credit — only marks the request pending HR", async () => {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-08-01', 'present');`);
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-08-01"]);
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-01'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        const requestId = (await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId])).rows[0]?.id;

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

    it("HR Admin's final approval credits exactly once, with the overnight source and 180-day expiry", async () => {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-08-08', 'present');`);
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-08-08"]);
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-08'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;

        const requestId = await fullyApproveRecoveryCredit(query, recordId);

        const request = await query("select status, comp_day_ledger_id from recovery_credit_requests where id = $1", [requestId]);
        expect(request.rows[0]?.status).toBe("approved");
        expect(request.rows[0]?.comp_day_ledger_id).toBeTruthy();

        const ledger = await query(
          "select entry_type, days, source, expiry_date, txn_date from comp_day_ledger where reference_type = 'attendance_record' and reference_id = $1",
          [recordId],
        );
        expect(ledger.rows).toEqual([
          { entry_type: "earned", days: "1.00", source: "overnight_extension", expiry_date: expect.anything(), txn_date: expect.anything() },
        ]);
        const expiry = new Date(ledger.rows[0]?.expiry_date as string);
        const txn = new Date(ledger.rows[0]?.txn_date as string);
        expect(Math.round((expiry.getTime() - txn.getTime()) / (24 * 60 * 60 * 1000))).toBe(180);
      });
    });

    it("rejection at either step never posts a credit", async () => {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-08-15', 'present');`);
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-08-15"]);
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-15'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        const requestId = (await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId])).rows[0]?.id;

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
      });
    });

    // Each of these two scenarios ends its own asUser() transaction with a
    // rejected query — Postgres aborts a transaction on the first error
    // inside it, so no further statement (even a read) can run in the SAME
    // transaction afterward. Two separate its() (each its own transaction)
    // instead of one continuing past a caught rejection, same convention
    // every other "expect this call to reject" test in this suite follows.
    it("blocks the employee from approving their own recovery credit request", async () => {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-08-22', 'present');`);
      const requestId = await db.asUserCommit(USER_HR, async (query) => {
        await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-08-22"]);
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-22'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        return (await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId])).rows[0]?.id;
      });

      await expect(
        db.asUser(USER_REPORT, async (query) => {
          const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [
            requestId,
          ]);
          return query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);
        }),
      ).rejects.toThrow(/Only the assigned approver/);
    });

    it("rejects a repeated decision on the same approval (idempotency/duplicate-decision guard)", async () => {
      await db.seed(`insert into attendance_records (employee_id, work_date, status) values ('${EMPLOYEE_REPORT}', '2026-08-23', 'present');`);
      const requestId = await db.asUserCommit(USER_HR, async (query) => {
        await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-08-23"]);
        const recordId = (
          await query("select id from attendance_records where employee_id = $1 and work_date = '2026-08-23'", [EMPLOYEE_REPORT])
        ).rows[0]?.id;
        return (await query("select id from recovery_credit_requests where attendance_record_id = $1", [recordId])).rows[0]?.id;
      });

      await expect(
        db.asUser(USER_MANAGER, async (query) => {
          const step1 = await query("select id from approvals where entity_type = 'recovery_credit' and entity_id = $1 and step_order = 1", [
            requestId,
          ]);
          await query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);
          return query("select decide_leave_approval($1, 'approved', null)", [step1.rows[0]?.id]);
        }),
      ).rejects.toThrow(/already been decided/);
    });
  });

  describe("Recovery Leave consumption safety (decide_leave_approval leave_request finalization)", () => {
    async function seedCompDayBalance(employeeId: string, days: number, expiryDate = "2027-01-01") {
      await db.seed(
        `insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, expiry_date, created_by) values ('${employeeId}', '2026-01-01', 'earned', ${days}, 'holiday_worked', '${expiryDate}', '${USER_HR}');`,
      );
    }

    async function seedSubmittedRecoveryRequest(employeeId: string, totalDays: number, startDate = "2026-09-01", endDate = "2026-09-10") {
      const requestId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days, status)
          values ('${requestId}', '${employeeId}', 'recovery', '${startDate}', '${endDate}', ${totalDays}, 'pending_approval');
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          select '${approvalId}', 'leave_request', '${requestId}', aw.id, 1, '${USER_MANAGER}'
          from approval_workflows aw where aw.company_id = '${COMPANY_A}' and aw.entity_type = 'leave_request';
      `);
      return { requestId, approvalId };
    }

    it("approves and deducts exactly when the requested amount exactly matches the available balance", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', null, 'P2B-EX-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'Ex', 'Act', '2024-01-01', '${EMPLOYEE_MANAGER}');
      `);
      await seedCompDayBalance(employeeId, 2);
      const { approvalId } = await seedSubmittedRecoveryRequest(employeeId, 2);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        const request = await query("select status from leave_requests where id = (select entity_id from approvals where id = $1)", [approvalId]);
        expect(request.rows).toEqual([{ status: "approved" }]);

        const balance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0);
      });
    });

    it("refuses final approval outright — never overdrawing into leave_ledger — when the comp-day balance can't cover the full request", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', null, 'P2B-IN-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'In', 'Sufficient', '2024-01-01', '${EMPLOYEE_MANAGER}');
      `);
      await seedCompDayBalance(employeeId, 1);
      const { approvalId, requestId } = await seedSubmittedRecoveryRequest(employeeId, 2);

      await expect(
        db.asUser(USER_MANAGER, (query) => query("select decide_leave_approval($1, 'approved', null)", [approvalId])),
      ).rejects.toThrow(/Insufficient balance/);

      // Rolled back entirely — no partial draw, request still pending, balance untouched.
      const balance = await db.seed(`select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = '${employeeId}'`);
      expect(Number(balance.rows[0]?.balance)).toBe(1);
      const request = await db.seed(`select status from leave_requests where id = '${requestId}'`);
      expect(request.rows).toEqual([{ status: "pending_approval" }]);
      const leaveLedgerRows = await db.seed(`select id from leave_ledger where employee_id = '${employeeId}'`);
      expect(leaveLedgerRows.rows).toEqual([]);
    });

    it("draws from the pool correctly when it spans two earned credits with different expiry dates (mixed expiries)", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', null, 'P2B-MX-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'Mixed', 'Expiry', '2024-01-01', '${EMPLOYEE_MANAGER}');
      `);
      // Two separate earned credits, expiring on different dates — the
      // deduction itself is one aggregate 'redeemed' row (not linked to a
      // specific earned entry); FIFO/oldest-first CONSUMPTION ORDER is a
      // property of how the comp-day-expiry cron's pooling algorithm
      // (packages/domain/src/compDayExpiry.ts, exercised directly in
      // packages/domain/test/recoveryCredit.test.ts's
      // selectOldestFirstConsumption suite) reads the ledger afterward —
      // this test only needs to confirm the AGGREGATE balance this
      // redemption leaves behind is correct.
      await seedCompDayBalance(employeeId, 1, "2026-06-01");
      await seedCompDayBalance(employeeId, 1, "2026-12-01");
      const { approvalId } = await seedSubmittedRecoveryRequest(employeeId, 1.5);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        const balance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0.5);
      });
    });

    it("never lets two concurrent approvals for the same employee overdraw the comp-day balance", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', null, 'P2B-CC-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'Con', 'Current', '2024-01-01', '${EMPLOYEE_MANAGER}');
      `);
      await seedCompDayBalance(employeeId, 1);
      const first = await seedSubmittedRecoveryRequest(employeeId, 1, "2026-09-01", "2026-09-01");
      const second = await seedSubmittedRecoveryRequest(employeeId, 1, "2026-10-01", "2026-10-01");

      // asUserCommit (unlike asUser) actually commits, exercising a real
      // cross-transaction race — the per-employee advisory lock in
      // decide_leave_approval() must serialize these so the SECOND to
      // acquire it re-reads the now-reduced balance and correctly refuses,
      // rather than both reading "1 available" before either commits.
      const results = await Promise.allSettled([
        db.asUserCommit(USER_MANAGER, (query) => query("select decide_leave_approval($1, 'approved', null)", [first.approvalId])),
        db.asUserCommit(USER_MANAGER, (query) => query("select decide_leave_approval($1, 'approved', null)", [second.approvalId])),
      ]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const { rows } = await db.seed(`select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = '${employeeId}'`);
      expect(Number(rows[0]?.balance)).toBe(0);
    });

    // Regression guard: every OTHER leave type (annual, sick, ...) has
    // never had a deduction_priority_rules row configured at all — the
    // safety fix must not change their existing unconditional
    // leave_ledger-fallback behavior.
    it("still falls back to the unconditional leave_ledger deduction for a leave type with no configured deduction_priority_rules at all", async () => {
      const employeeId = randomUUID();
      const requestId = randomUUID();
      const approvalId = randomUUID();
      await db.seed(`
        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id)
          values ('${employeeId}', null, 'P2B-AN-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'An', 'Nual', '2024-01-01', '${EMPLOYEE_MANAGER}');
        insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days, status)
          values ('${requestId}', '${employeeId}', 'annual', '2026-09-01', '2026-09-05', 5, 'pending_approval');
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          select '${approvalId}', 'leave_request', '${requestId}', aw.id, 1, '${USER_MANAGER}'
          from approval_workflows aw where aw.company_id = '${COMPANY_A}' and aw.entity_type = 'leave_request';
      `);

      await db.asUser(USER_MANAGER, async (query) => {
        await query("select decide_leave_approval($1, 'approved', null)", [approvalId]);
        const request = await query("select status from leave_requests where id = $1", [requestId]);
        expect(request.rows).toEqual([{ status: "approved" }]);

        const ledger = await query("select amount_days from leave_ledger where employee_id = $1 and reference_id = $2", [employeeId, requestId]);
        expect(ledger.rows).toEqual([{ amount_days: "-5.00" }]);
      });
    });
  });

  describe("forfeit_recovery_leave_on_termination()", () => {
    async function seedTerminatedEmployeeWithBalance(balanceDays: number) {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${employeeId}', 'P2B-T-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'Term', 'Inated', '2020-01-01', 'terminated');
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, created_by)
          values ('${employeeId}', '2026-01-01', 'earned', ${balanceDays}, 'holiday_worked', '${USER_HR}');
      `);
      return employeeId;
    }

    it("forfeits the full remaining balance via an auditable reversal row, never a delete", async () => {
      const employeeId = await seedTerminatedEmployeeWithBalance(2.5);

      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from forfeit_recovery_leave_on_termination($1)", [employeeId]);
        expect(rows).toEqual([{ forfeited_days: "2.50" }]);

        const ledger = await query("select entry_type, days, source from comp_day_ledger where employee_id = $1 order by created_at", [
          employeeId,
        ]);
        expect(ledger.rows).toEqual([
          { entry_type: "earned", days: "2.50", source: "holiday_worked" },
          { entry_type: "reversal", days: "-2.50", source: "termination_forfeiture" },
        ]);

        const balance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0);
      });
    });

    it("is idempotent — a second call forfeits 0 and never drives the balance negative", async () => {
      const employeeId = await seedTerminatedEmployeeWithBalance(1);

      await db.asUser(USER_HR, async (query) => {
        const first = await query("select * from forfeit_recovery_leave_on_termination($1)", [employeeId]);
        expect(first.rows).toEqual([{ forfeited_days: "1.00" }]);

        const second = await query("select * from forfeit_recovery_leave_on_termination($1)", [employeeId]);
        expect(second.rows).toEqual([{ forfeited_days: "0" }]);

        const balance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0);
      });
    });

    it("does nothing (0 forfeited) when the balance is already zero or negative", async () => {
      const employeeId = await seedTerminatedEmployeeWithBalance(0);
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from forfeit_recovery_leave_on_termination($1)", [employeeId]);
        expect(rows).toEqual([{ forfeited_days: "0" }]);

        const ledgerCount = await query("select count(*) from comp_day_ledger where employee_id = $1 and entry_type = 'reversal'", [employeeId]);
        expect(Number(ledgerCount.rows[0]?.count)).toBe(0);
      });
    });

    it("refuses to forfeit for an employee who is not marked terminated", async () => {
      await expect(
        db.asUser(USER_HR, (query) => query("select * from forfeit_recovery_leave_on_termination($1)", [EMPLOYEE_REPORT])),
      ).rejects.toThrow(/not marked terminated/);
    });

    it("blocks anyone other than HR Admin from forfeiting recovery leave on termination", async () => {
      const employeeId = await seedTerminatedEmployeeWithBalance(1);
      await expect(
        db.asUser(USER_MANAGER, (query) => query("select * from forfeit_recovery_leave_on_termination($1)", [employeeId])),
      ).rejects.toThrow(/Only HR Admin/);
      await expect(
        db.asUser(USER_PEER, (query) => query("select * from forfeit_recovery_leave_on_termination($1)", [employeeId])),
      ).rejects.toThrow(/Only HR Admin/);

      const balance = await db.asUser(USER_HR, (query) =>
        query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]),
      );
      expect(Number(balance.rows[0]?.balance)).toBe(1);
    });
  });

  describe("terminate_employee() — forfeiture as part of the authorised termination transaction", () => {
    async function seedActiveEmployeeWithRecoveryBalance(days: number) {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${employeeId}', 'P2B-TE-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'Active', 'Employee', '2020-01-01', 'active');
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, created_by)
          values ('${employeeId}', '2026-01-01', 'earned', ${days}, 'holiday_worked', '${USER_HR}');
      `);
      return employeeId;
    }

    it("sets employment_status/termination_date AND forfeits Recovery Leave in one call — never an optional separate step", async () => {
      const employeeId = await seedActiveEmployeeWithRecoveryBalance(3);

      await db.asUser(USER_HR, async (query) => {
        await query("select terminate_employee($1, $2)", [employeeId, "2026-09-15"]);

        const employee = await query("select employment_status, termination_date from employees where id = $1", [employeeId]);
        expect(employee.rows).toEqual([{ employment_status: "terminated", termination_date: expect.anything() }]);
        const terminationDate = new Date(employee.rows[0]?.termination_date as string).toISOString().slice(0, 10);
        expect(terminationDate).toBe("2026-09-15");

        const balance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0);

        const forfeitureRow = await query(
          "select entry_type, source from comp_day_ledger where employee_id = $1 and source = 'termination_forfeiture'",
          [employeeId],
        );
        expect(forfeitureRow.rows).toEqual([{ entry_type: "reversal", source: "termination_forfeiture" }]);
      });
    });

    it("never forfeits payable Annual Leave (leave_ledger) — only comp_day_ledger", async () => {
      const employeeId = await seedActiveEmployeeWithRecoveryBalance(2);
      await db.seed(
        `insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ('${employeeId}', 'annual', '2026-01-01', 'accrual', 10, '${USER_HR}');`,
      );

      await db.asUser(USER_HR, async (query) => {
        await query("select terminate_employee($1)", [employeeId]);

        const annualBalance = await query("select coalesce(sum(amount_days), 0) as balance from leave_ledger where employee_id = $1", [
          employeeId,
        ]);
        expect(Number(annualBalance.rows[0]?.balance)).toBe(10);
      });
    });

    it("is safely repeatable — a second call never double-forfeits or goes negative", async () => {
      const employeeId = await seedActiveEmployeeWithRecoveryBalance(1);

      await db.asUser(USER_HR, async (query) => {
        await query("select terminate_employee($1)", [employeeId]);
        await query("select terminate_employee($1)", [employeeId]);

        const balance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0);
      });
    });

    it("blocks anyone other than HR Admin from terminating an employee", async () => {
      const employeeId = await seedActiveEmployeeWithRecoveryBalance(1);
      await expect(db.asUser(USER_MANAGER, (query) => query("select terminate_employee($1)", [employeeId]))).rejects.toThrow(/Only HR Admin/);

      const employee = await db.asUser(USER_HR, (query) => query("select employment_status from employees where id = $1", [employeeId]));
      expect(employee.rows).toEqual([{ employment_status: "active" }]);
    });
  });

  describe("post_poland_termination_leave_adjustment() — Poland leaver Annual Leave true-up", () => {
    // The FTE-interval resolution and ledger-grant classification that
    // decide WHAT amount to post (including detecting an ambiguous/mid-
    // period FTE change and refusing to guess) live entirely in TypeScript
    // — packages/domain/test/annualLeaveEntitlement.test.ts's own
    // "computePolandAnnualLeaveEntitlementAtTermination" suite exhaustively
    // covers that blocking behavior, and
    // apps/web/src/lib/actions/polandTermination.test.ts covers the
    // orchestration that refuses to call this function at all when blocked
    // (mocked, since it needs a live Supabase client). This function's own
    // job is narrower and purely mechanical — given an already-computed
    // amount, post it safely — so these RLS tests exercise exactly that
    // mechanical contract: idempotency, the never-claw-back-below-zero
    // floor, and the HR-Admin/Poland/terminated guard rails a direct SQL
    // caller could otherwise bypass.
    async function seedTerminatedPolandEmployee(ledgerRows: { entry_type: string; amount_days: number; reference_type: string }[] = []) {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status, termination_date)
          values ('${employeeId}', 'P2B-PLT-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'PL', 'Pola', 'Leaver', '2023-01-01', 'terminated', '2026-06-30');
      `);
      for (const row of ledgerRows) {
        await db.seed(
          `insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, created_by) values ('${employeeId}', 'annual', '2026-01-01', '${row.entry_type}', ${row.amount_days}, '${row.reference_type}', '${USER_HR}');`,
        );
      }
      return employeeId;
    }

    it("applies a negative true-up correctly when there's enough unused balance to absorb it (mid-year leaver after the cron already granted a full year)", async () => {
      // The cron already posted the full 26 for this year; the true
      // prorated entitlement through termination is 13 — a -13 true-up.
      const employeeId = await seedTerminatedPolandEmployee([{ entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }]);

      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from post_poland_termination_leave_adjustment($1, $2, $3)", [employeeId, -13, "test true-up"]);
        expect(Number(rows[0]?.applied_days)).toBe(-13);
        expect(Number(rows[0]?.excess_requiring_review)).toBe(0);
        expect(rows[0]?.already_posted).toBe(false);

        const balance = await query("select coalesce(sum(amount_days), 0) as balance from leave_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(13);

        const posted = await query(
          "select entry_type, reference_type, reference_id, idempotency_key from leave_ledger where employee_id = $1 and reference_type = 'termination_settlement'",
          [employeeId],
        );
        expect(posted.rows).toEqual([
          { entry_type: "adjustment", reference_type: "termination_settlement", reference_id: employeeId, idempotency_key: `termination_settlement:${employeeId}` },
        ]);
      });
    });

    it("caps the clawback at a zero balance and reports the excess for HR review when the employee already used more than the corrected entitlement", async () => {
      // Granted 26, but 20 already taken -> balance 6. The true-up would
      // need to claw back 13 (26 entitled -> 13 corrected), but only 6 is
      // actually unused — never drive the balance to -7; cap at 0 and flag
      // the other 7 days for HR review instead.
      const employeeId = await seedTerminatedPolandEmployee([
        { entry_type: "accrual", amount_days: 26, reference_type: "policy_run" },
        { entry_type: "deduction", amount_days: -20, reference_type: "leave_request" },
      ]);

      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13]);
        expect(Number(rows[0]?.applied_days)).toBe(-6);
        expect(Number(rows[0]?.excess_requiring_review)).toBe(7);
        expect(rows[0]?.already_posted).toBe(false);

        const balance = await query("select coalesce(sum(amount_days), 0) as balance from leave_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(0);
      });
    });

    it("is idempotent — a repeated (retried termination) call never posts the adjustment twice", async () => {
      const employeeId = await seedTerminatedPolandEmployee([{ entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }]);

      await db.asUser(USER_HR, async (query) => {
        const first = await query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13]);
        expect(Number(first.rows[0]?.applied_days)).toBe(-13);
        expect(Number(first.rows[0]?.excess_requiring_review)).toBe(0);
        expect(first.rows[0]?.already_posted).toBe(false);

        const second = await query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13]);
        expect(Number(second.rows[0]?.applied_days)).toBe(0);
        expect(Number(second.rows[0]?.excess_requiring_review)).toBe(0);
        expect(second.rows[0]?.already_posted).toBe(true);

        const balance = await query("select coalesce(sum(amount_days), 0) as balance from leave_ledger where employee_id = $1", [employeeId]);
        expect(Number(balance.rows[0]?.balance)).toBe(13);

        const postedCount = await query("select count(*) from leave_ledger where employee_id = $1 and reference_type = 'termination_settlement'", [
          employeeId,
        ]);
        expect(Number(postedCount.rows[0]?.count)).toBe(1);
      });
    });

    it("does nothing (no row posted) when the computed amount is exactly zero — the cron already granted the correct prorated amount", async () => {
      const employeeId = await seedTerminatedPolandEmployee([{ entry_type: "accrual", amount_days: 13, reference_type: "policy_run" }]);

      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, 0]);
        expect(Number(rows[0]?.applied_days)).toBe(0);
        expect(Number(rows[0]?.excess_requiring_review)).toBe(0);
        expect(rows[0]?.already_posted).toBe(false);

        const postedCount = await query("select count(*) from leave_ledger where employee_id = $1 and reference_type = 'termination_settlement'", [
          employeeId,
        ]);
        expect(Number(postedCount.rows[0]?.count)).toBe(0);
      });
    });

    it("blocks a non-Poland employee outright, even if HR Admin and terminated", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status, termination_date)
          values ('${employeeId}', 'P2B-NOTPL-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'ZZ', 'Not', 'Poland', '2023-01-01', 'terminated', '2026-06-30');
      `);
      await expect(
        db.asUser(USER_HR, (query) => query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13])),
      ).rejects.toThrow(/only applies to Poland employees/);
    });

    it("refuses to post for a Poland employee who is not marked terminated", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${employeeId}', 'P2B-ACTIVEPL-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'PL', 'Still', 'Active', '2023-01-01', 'active');
      `);
      await expect(
        db.asUser(USER_HR, (query) => query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13])),
      ).rejects.toThrow(/not marked terminated/);
    });

    it("blocks anyone other than HR Admin from posting a termination Annual Leave adjustment", async () => {
      const employeeId = await seedTerminatedPolandEmployee([{ entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }]);
      await expect(
        db.asUser(USER_MANAGER, (query) => query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13])),
      ).rejects.toThrow(/Only HR Admin/);

      const balance = await db.asUser(USER_HR, (query) =>
        query("select coalesce(sum(amount_days), 0) as balance from leave_ledger where employee_id = $1", [employeeId]),
      );
      expect(Number(balance.rows[0]?.balance)).toBe(26);
    });

    it("never rewrites or deletes existing ledger history — the true-up is an additional row, and prior grants/deductions stay exactly as they were", async () => {
      const employeeId = await seedTerminatedPolandEmployee([
        { entry_type: "accrual", amount_days: 26, reference_type: "policy_run" },
        { entry_type: "deduction", amount_days: -5, reference_type: "leave_request" },
      ]);

      await db.asUser(USER_HR, async (query) => {
        await query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13]);

        const rows = await query("select entry_type, amount_days, reference_type from leave_ledger where employee_id = $1 order by created_at", [
          employeeId,
        ]);
        expect(rows.rows).toEqual([
          { entry_type: "accrual", amount_days: "26.00", reference_type: "policy_run" },
          { entry_type: "deduction", amount_days: "-5.00", reference_type: "leave_request" },
          { entry_type: "adjustment", amount_days: "-13.00", reference_type: "termination_settlement" },
        ]);
      });
    });

    it("Annual Leave remains payable while Recovery Leave remains non-cash, even for the same terminating Poland employee", async () => {
      const employeeId = randomUUID();
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status)
          values ('${employeeId}', 'P2B-BOTH-${employeeId.slice(0, 8)}', '${COMPANY_A}', 'PL', 'Both', 'Ledgers', '2023-01-01', 'active');
        insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, created_by)
          values ('${employeeId}', '2026-01-01', 'earned', 2, 'holiday_worked', '${USER_HR}');
        insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, created_by)
          values ('${employeeId}', 'annual', '2026-01-01', 'accrual', 26, 'policy_run', '${USER_HR}');
      `);

      await db.asUser(USER_HR, async (query) => {
        await query("select terminate_employee($1, $2)", [employeeId, "2026-06-30"]);
        await query("select * from post_poland_termination_leave_adjustment($1, $2)", [employeeId, -13]);

        // Recovery Leave: forfeited to zero, no cash conversion — the
        // existing forfeit_recovery_leave_on_termination() mechanic,
        // untouched by this correction.
        const compBalance = await query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]);
        expect(Number(compBalance.rows[0]?.balance)).toBe(0);

        // Annual Leave: still a real, payable ledger balance — trued up,
        // never forfeited or zeroed out by termination itself.
        const leaveBalance = await query("select coalesce(sum(amount_days), 0) as balance from leave_ledger where employee_id = $1", [employeeId]);
        expect(Number(leaveBalance.rows[0]?.balance)).toBe(13);
      });
    });
  });

  describe("preflight_country_schedule_config() — UAE/Saudi/Poland workweek (Blocker 3: resolved, not left conflicting)", () => {
    it("sets AE's working_weekdays to the resolved Monday-Friday convention, superseding the legacy Sunday-start week_start_day", async () => {
      // AE/SA/PL are seeded (idempotently) by the migration itself before
      // this test runs — see section 0 of the migration file. The
      // migration's own idempotent `do $$ ... $$` block (section 1b) is
      // what sets working_weekdays here, not this test.
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from preflight_country_schedule_config() where country_code = 'AE'"),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.week_start_day).toBe(0); // the legacy value — left untouched, but no longer authoritative
      expect(rows[0]?.working_weekdays).toEqual([1, 2, 3, 4, 5]); // Monday-Friday, resolved by this correction round
      expect(rows[0]?.effective_working_days).toEqual([1, 2, 3, 4, 5]);
      expect(rows[0]?.conflicts_with_requested_convention).toBe(false); // no longer an unresolved conflict
    });

    it("sets Saudi to Sunday-Thursday and Poland to Monday-Friday, with no conflicts remaining for either", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query(
          "select country_code, working_weekdays, effective_working_days, conflicts_with_requested_convention from preflight_country_schedule_config() where country_code in ('SA', 'PL') order by country_code",
        ),
      );
      expect(rows).toEqual([
        { country_code: "PL", working_weekdays: [1, 2, 3, 4, 5], effective_working_days: [1, 2, 3, 4, 5], conflicts_with_requested_convention: false },
        { country_code: "SA", working_weekdays: [0, 1, 2, 3, 4], effective_working_days: [0, 1, 2, 3, 4], conflicts_with_requested_convention: false },
      ]);
    });

    it("is idempotent — the migration having already run once (as it does for every test in this file) never leaves a different result on a second application", async () => {
      // Re-running the exact same idempotent update the migration's section
      // 1b applies must be a no-op, never additive/conditional.
      await db.seed(`
        update countries set working_weekdays = array[1,2,3,4,5] where code = 'AE';
        update countries set working_weekdays = array[0,1,2,3,4] where code = 'SA';
        update countries set working_weekdays = array[1,2,3,4,5] where code = 'PL';
      `);
      const { rows } = await db.asUser(USER_HR, (query) =>
        query(
          "select country_code, working_weekdays from preflight_country_schedule_config() where country_code in ('AE', 'SA', 'PL') order by country_code",
        ),
      );
      expect(rows).toEqual([
        { country_code: "AE", working_weekdays: [1, 2, 3, 4, 5] },
        { country_code: "PL", working_weekdays: [1, 2, 3, 4, 5] },
        { country_code: "SA", working_weekdays: [0, 1, 2, 3, 4] },
      ]);
    });
  });

  // Blocker 3's explicit ask: prove Friday/Saturday/Sunday eligibility for
  // every region, exercised through the real RPC
  // (record_attendance_and_recovery), not just the raw column values above.
  // Each region gets its own minimal company/employee/manager/HR-admin —
  // companies' own after-insert trigger auto-provisions the
  // 'recovery_credit' approval workflow, so no extra setup is needed for
  // that. 2026-09-04/05/06 is a real, consecutive Friday/Saturday/Sunday.
  describe("regional workweek eligibility matrix (Blocker 3)", () => {
    const FRIDAY = "2026-09-04";
    const SATURDAY = "2026-09-05";
    const SUNDAY = "2026-09-06";

    interface RegionOrg {
      companyId: string;
      hrUserId: string;
      reportEmployeeId: string;
    }

    async function seedRegionOrg(countryCode: string, idSuffix: string): Promise<RegionOrg> {
      const companyId = `00000000-0000-0000-0000-00000000${idSuffix}0`;
      const managerUserId = `00000000-0000-0000-0000-00000000${idSuffix}1`;
      const reportUserId = `00000000-0000-0000-0000-00000000${idSuffix}2`;
      const hrUserId = `00000000-0000-0000-0000-00000000${idSuffix}3`;
      const managerEmployeeId = `00000000-0000-0000-0000-00000000${idSuffix}4`;
      const reportEmployeeId = `00000000-0000-0000-0000-00000000${idSuffix}5`;

      await db.seed(`
        insert into auth.users (id, email) values
          ('${managerUserId}', 'p2b-${idSuffix}-manager@enginious.ae'),
          ('${reportUserId}', 'p2b-${idSuffix}-report@enginious.ae'),
          ('${hrUserId}', 'p2b-${idSuffix}-hr@enginious.ae');

        insert into companies (id, legal_name, country_code, default_currency)
          values ('${companyId}', 'Phase 2b Workweek Co ${idSuffix}', '${countryCode}', 'USD');

        insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
          ('${managerEmployeeId}', '${managerUserId}', 'WW-${idSuffix}-01', '${companyId}', '${countryCode}', 'Mona', 'Manager', '2024-01-01'),
          ('${reportEmployeeId}', '${reportUserId}', 'WW-${idSuffix}-02', '${companyId}', '${countryCode}', 'Remy', 'Report', '2024-02-01');
        update employees set manager_id = '${managerEmployeeId}' where id = '${reportEmployeeId}';

        insert into user_roles (user_id, role, company_id) values ('${hrUserId}', 'hr_admin', '${companyId}');
      `);

      return { companyId, hrUserId, reportEmployeeId };
    }

    async function isRecoveryEligible(org: RegionOrg, workDate: string): Promise<boolean> {
      const { rows } = await db.asUser(org.hrUserId, (query) =>
        query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          workDate,
          JSON.stringify([{ employee_id: org.reportEmployeeId, status: "present", hours_worked: 8 }]),
        ]),
      );
      // credited=true only ever happens for a genuine recovery day (see
      // record_attendance_and_recovery's is_recovery_day branch) — a
      // working day falls through to the "not eligible" else-branch and
      // reports credited=false, reversed=false, needs_policy_review=false.
      return rows[0]?.credited === true;
    }

    it("UAE (Monday-Friday): Friday is a working day, Saturday and Sunday are recovery-eligible", async () => {
      const org = await seedRegionOrg("AE", "c1a");
      expect(await isRecoveryEligible(org, FRIDAY)).toBe(false);
      expect(await isRecoveryEligible(org, SATURDAY)).toBe(true);
      expect(await isRecoveryEligible(org, SUNDAY)).toBe(true);
    });

    it("Saudi Arabia (Sunday-Thursday): Friday and Saturday are recovery-eligible, Sunday is a working day", async () => {
      const org = await seedRegionOrg("SA", "c2a");
      expect(await isRecoveryEligible(org, FRIDAY)).toBe(true);
      expect(await isRecoveryEligible(org, SATURDAY)).toBe(true);
      expect(await isRecoveryEligible(org, SUNDAY)).toBe(false);
    });

    it("Poland (Monday-Friday): Friday is a working day, Saturday and Sunday are recovery-eligible", async () => {
      const org = await seedRegionOrg("PL", "c3a");
      expect(await isRecoveryEligible(org, FRIDAY)).toBe(false);
      expect(await isRecoveryEligible(org, SATURDAY)).toBe(true);
      expect(await isRecoveryEligible(org, SUNDAY)).toBe(true);
    });
  });
});
