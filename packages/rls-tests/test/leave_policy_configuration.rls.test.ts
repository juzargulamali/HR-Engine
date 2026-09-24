import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Phase 2b: record_overnight_recovery_credit() and
// forfeit_recovery_leave_on_termination() — the two new RPCs added by
// supabase/migrations/20261101000000_leave_policy_configuration.sql. This
// file only exercises those two RPCs and the new attendance_records columns
// they write; the standard weekend/holiday credit path is already covered by
// phase4.rls.test.ts's "record_attendance_and_recovery()" describe block.

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

      -- Needed so record_attendance_and_recovery() actually posts a
      -- standard weekend/holiday credit in the "does not double-credit a
      -- day already credited by the standard weekend/holiday path" test
      -- below — without an active overtime_rules policy it would post
      -- nothing at all (needs_policy_review: true instead), same as
      -- phase4.rls.test.ts's own 'ZZ' setup.
      insert into policy_versions (country_code, policy_type, version_no, effective_from, status, payload, created_by) values
        ('ZZ', 'overtime_rules', 1, '2020-01-01', 'active',
         '{"weekly_threshold_hours": 40, "comp_day_conversion_ratio": 8, "recovery_credit_days": 1}'::jsonb, '${USER_HR}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

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

    it("grants nothing when work ends exactly at midnight (0 active hours after midnight)", async () => {
      await seedAttendance("2026-07-02");
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, true, 0)", [EMPLOYEE_REPORT, "2026-07-02"]),
      );
      expect(rows).toEqual([{ credited: false, credit_days: "0" }]);

      const ledger = await db.asUser(USER_HR, (query) =>
        query(
          "select id from comp_day_ledger where reference_type = 'attendance_record' and reference_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-07-02')",
          [EMPLOYEE_REPORT],
        ),
      );
      expect(ledger.rows).toEqual([]);
    });

    it("grants 0.5 day for continuing to 2:00am (2 active hours after midnight)", async () => {
      await seedAttendance("2026-07-03");
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, true, 2)", [EMPLOYEE_REPORT, "2026-07-03"]),
      );
      expect(rows).toEqual([{ credited: true, credit_days: "0.5" }]);
    });

    it("grants 0.5 day for continuing to exactly 4:00am — the inclusive boundary", async () => {
      await seedAttendance("2026-07-04");
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select * from record_overnight_recovery_credit($1, $2, true, 4)", [EMPLOYEE_REPORT, "2026-07-04"]),
      );
      expect(rows).toEqual([{ credited: true, credit_days: "0.5" }]);
    });

    it("grants 1 day for continuing to 5:00am (over the 4-hour threshold)", async () => {
      await seedAttendance("2026-07-05");
      await db.asUser(USER_HR, async (query) => {
        const { rows } = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-05"]);
        expect(rows).toEqual([{ credited: true, credit_days: "1" }]);

        const ledger = await query(
          "select entry_type, days, source, expiry_date, txn_date from comp_day_ledger where reference_type = 'attendance_record' and reference_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-07-05')",
          [EMPLOYEE_REPORT],
        );
        expect(ledger.rows).toEqual([
          { entry_type: "earned", days: "1.00", source: "overnight_extension", expiry_date: expect.anything(), txn_date: expect.anything() },
        ]);
        const row = ledger.rows[0];
        const expiry = new Date(row.expiry_date as string);
        const txn = new Date(row.txn_date as string);
        const diffDays = Math.round((expiry.getTime() - txn.getTime()) / (24 * 60 * 60 * 1000));
        expect(diffDays).toBe(180);
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

    it("is idempotent under a repeated (double-submitted) call — never double-credits the same day", async () => {
      await seedAttendance("2026-07-08");
      await db.asUser(USER_HR, async (query) => {
        const first = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-08"]);
        expect(first.rows).toEqual([{ credited: true, credit_days: "1" }]);

        const second = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-08"]);
        expect(second.rows).toEqual([{ credited: false, credit_days: "0" }]);

        const ledger = await query(
          "select entry_type from comp_day_ledger where reference_type = 'attendance_record' and reference_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-07-08')",
          [EMPLOYEE_REPORT],
        );
        expect(ledger.rows).toEqual([{ entry_type: "earned" }]);
      });
    });

    // Reuses guard_comp_day_ledger_single_active_credit — the SAME row a
    // standard weekend/holiday credit would occupy — so a day already
    // credited by record_attendance_and_recovery() must not also earn an
    // overnight credit (the policy brief's "same working hours cannot
    // generate duplicate credits").
    it("does not double-credit a day already credited by the standard weekend/holiday path", async () => {
      // 2026-07-11 is a Saturday under ZZ's default week_start_day (1, Monday).
      await db.asUser(USER_HR, async (query) => {
        await query("select * from record_attendance_and_recovery($1, $2::jsonb)", [
          "2026-07-11",
          JSON.stringify([{ employee_id: EMPLOYEE_REPORT, status: "present" }]),
        ]);

        const { rows } = await query("select * from record_overnight_recovery_credit($1, $2, true, 5)", [EMPLOYEE_REPORT, "2026-07-11"]);
        expect(rows).toEqual([{ credited: false, credit_days: "0" }]);

        const ledger = await query(
          "select entry_type, source from comp_day_ledger where reference_type = 'attendance_record' and reference_id = (select id from attendance_records where employee_id = $1 and work_date = '2026-07-11')",
          [EMPLOYEE_REPORT],
        );
        expect(ledger.rows).toEqual([{ entry_type: "earned", source: "holiday_worked" }]);
      });
    });

    it("lets the employee's own manager record an overnight credit", async () => {
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

      // Untouched by the rejected attempts.
      const balance = await db.asUser(USER_HR, (query) =>
        query("select coalesce(sum(days), 0) as balance from comp_day_ledger where employee_id = $1", [employeeId]),
      );
      expect(Number(balance.rows[0]?.balance)).toBe(1);
    });
  });
});
