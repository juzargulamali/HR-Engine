import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Covers sync_attendance_presence_for_day() -- the bridge between employee
// self-service attendance clocking (attendance_sessions/attendance_segments)
// and attendance_records, the one table the dashboard's per-company headcount
// (dashboard-data.ts) and the daily attendance register (attendance/page.tsx)
// actually read. Before this function existed, clocking in/out never touched
// attendance_records at all, so a self-clocked employee counted as
// 'not_recorded' everywhere outside the attendance-clock page itself.
//
// Deliberately verifies presence syncing is INDEPENDENT of Recovery Leave:
// sync_attendance_recovery_for_day() (covered exhaustively in
// attendance_clocking_and_recovery_routing.rls.test.ts) is never asserted on
// here beyond confirming clock_in() alone never creates a request.

function claims(userId: string): string {
  return JSON.stringify({ sub: userId, role: "authenticated" }).replace(/'/g, "''");
}

/** Runs one or more SECURITY DEFINER RPC calls as a given user, committing
 * (not rolling back) -- the same effect as asUserCommit(), via the admin
 * connection's own explicit transaction, matching this suite's established
 * seedDayAndSync()/resync() pattern for calling these RPCs with a chosen
 * auth context. */
async function callAsCommit(db: RlsTestDatabase, userId: string, sql: string) {
  await db.seed(`
    begin;
    select set_config('request.jwt.claims', '${claims(userId)}', true);
    ${sql}
    commit;
  `);
}

/** Seeds one historical attendance_segments row directly via the
 * unrestricted admin connection -- attendance_segments has no INSERT policy
 * at all (writes only ever happen through the SECURITY DEFINER RPCs), so
 * this is the only way to place historical rows for a chosen date, exactly
 * the same technique attendance_clocking_and_recovery_routing.rls.test.ts's
 * seedDayAndSync() uses for Recovery Leave. `endUtc: null` leaves that
 * segment (and its session) open, simulating "still clocked in". Pass the
 * SAME sessionId to add a second segment to an already-seeded session (a
 * mode switch); omit it to start a brand-new session (a separate clock-in).
 */
async function seedSegment(
  db: RlsTestDatabase,
  args: { employeeId: string; sessionId?: string; workMode: string; startUtc: string; endUtc: string | null },
) {
  const sessionId = args.sessionId ?? randomUUID();
  const segId = randomUUID();
  const endVal = args.endUtc ? `'${args.endUtc}'` : "null";
  const isOpen = args.endUtc === null;
  await db.seed(`
    insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status)
      values ('${sessionId}', '${args.employeeId}', '${args.startUtc}', ${isOpen ? "null" : `'${args.endUtc}'`}, '${isOpen ? "open" : "closed"}')
      on conflict (id) do update set clock_out_at = excluded.clock_out_at, status = excluded.status;
    insert into attendance_segments (id, session_id, employee_id, work_mode, segment_start, segment_end) values
      ('${segId}', '${sessionId}', '${args.employeeId}', '${args.workMode}', '${args.startUtc}', ${endVal});
  `);
  return sessionId;
}

async function syncPresence(db: RlsTestDatabase, employeeUserId: string, employeeId: string, workDate: string) {
  await callAsCommit(db, employeeUserId, `select sync_attendance_presence_for_day('${employeeId}'::uuid, '${workDate}'::date);`);
}

async function getAttendanceRecord(query: Client["query"], employeeId: string, workDate: string) {
  const { rows } = await query(
    `select status, work_mode, hours_worked, source, presence_conflict from attendance_records where employee_id = $1 and work_date = $2`,
    [employeeId, workDate],
  );
  return rows[0] as
    | { status: string; work_mode: string | null; hours_worked: string | null; source: string; presence_conflict: string | null }
    | undefined;
}

async function getLatestSegmentWorkDate(query: Client["query"], employeeId: string): Promise<string> {
  const { rows } = await query(
    `select (segment_start at time zone country_timezone((select country_code from employees where id = $1)))::date::text as d
     from attendance_segments where employee_id = $1 order by segment_start desc limit 1`,
    [employeeId],
  );
  return rows[0].d as string;
}

async function countAttendanceRecords(query: Client["query"], employeeId: string, workDate: string): Promise<number> {
  const { rows } = await query(`select count(*)::int as c from attendance_records where employee_id = $1 and work_date = $2`, [
    employeeId,
    workDate,
  ]);
  return rows[0].c as number;
}

async function countRecoveryRequests(query: Client["query"], employeeId: string, workDate: string): Promise<number> {
  const { rows } = await query(`select count(*)::int as c from recovery_credit_requests where employee_id = $1 and work_date = $2`, [
    employeeId,
    workDate,
  ]);
  return rows[0].c as number;
}

const COMPANY_A = "00000000-0000-0000-0000-0000000d0a01";
const USER_HR = "00000000-0000-0000-0000-0000000d0a11";
const USER_WORKER = "00000000-0000-0000-0000-0000000d0a12";
const EMPLOYEE_HR = "00000000-0000-0000-0000-0000000d0a21";
const EMPLOYEE_WORKER = "00000000-0000-0000-0000-0000000d0a22";

// Fixed historical anchors so seeded-segment tests never depend on the real
// wall-clock date -- not used for the "immediate Clocked-in" live-RPC tests
// below, which always act on whatever today actually is.
const HIST_DAY_1 = "2027-04-12"; // Monday
const HIST_DAY_2 = "2027-04-13"; // Tuesday
const OVERNIGHT_DAY_1 = "2027-04-19"; // Monday
const OVERNIGHT_DAY_2 = "2027-04-20"; // Tuesday

describe("Self-clock attendance presence sync (attendance_records)", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR}', 'aps-hr@enginious.ae'),
        ('${USER_WORKER}', 'aps-worker@enginious.ae');

      insert into countries (code, name, default_currency, working_weekdays) values ('DZ', 'Dayzone', 'DZD', array[1,2,3,4,5])
      on conflict (code) do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_A}', 'Dayzone Co', 'DZ', 'DZD');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_HR}', '${USER_HR}', 'AP-01', '${COMPANY_A}', 'DZ', 'Hana', 'HrOne', '2024-01-01'),
        ('${EMPLOYEE_WORKER}', '${USER_WORKER}', 'AP-02', '${COMPANY_A}', 'DZ', 'Wale', 'Worker', '2024-01-01');

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR}', 'hr_admin', '${COMPANY_A}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("live clock_in()/switch_work_segment()/clock_out() (today, real clock)", () => {
    it("clock_in() immediately marks the employee present today with no hours yet, and never creates a recovery credit", async () => {
      await callAsCommit(db, USER_WORKER, `select clock_in('office', null, null, null);`);

      await db.asUser(USER_WORKER, async (query) => {
        const workDate = await getLatestSegmentWorkDate(query, EMPLOYEE_WORKER);
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDate);
        expect(rec?.status).toBe("present");
        expect(rec?.source).toBe("self_clock");
        expect(rec?.work_mode).toBe("office");
        expect(rec?.hours_worked).toBeNull();
        expect(rec?.presence_conflict).toBeNull();

        expect(await countRecoveryRequests(query, EMPLOYEE_WORKER, workDate), "clock_in() must never create a recovery credit request").toBe(
          0,
        );
      });
    });

    it("switch_work_segment() updates the register's work mode for today, hours still not final", async () => {
      await callAsCommit(db, USER_WORKER, `select switch_work_segment('wfh', null, null, null, null);`);

      await db.asUser(USER_WORKER, async (query) => {
        const workDate = await getLatestSegmentWorkDate(query, EMPLOYEE_WORKER);
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDate);
        expect(rec?.status).toBe("present");
        expect(rec?.work_mode).toBe("work_from_home");
        expect(rec?.hours_worked).toBeNull();
      });
    });

    it("clock_out() finalizes recorded hours while keeping presence for today", async () => {
      const workDateBefore = await db.asUser(USER_WORKER, (query) => getLatestSegmentWorkDate(query, EMPLOYEE_WORKER));
      await callAsCommit(db, USER_WORKER, `select clock_out(null);`);

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDateBefore);
        expect(rec?.status).toBe("present");
        expect(rec?.source).toBe("self_clock");
        // A real number now, not the "still open" null from before clock_out
        // — this test's clock_in-switch-clock_out sequence runs in
        // milliseconds, so the actual figure legitimately rounds to 0.00 at
        // attendance_records.hours_worked's numeric(5,2) precision; the
        // seeded-history tests below assert real non-zero totals.
        expect(rec?.hours_worked).not.toBeNull();
        expect(Number(rec?.hours_worked)).toBeGreaterThanOrEqual(0);

        // Exactly one attendance_records row for the whole day -- clock_in,
        // one switch, and clock_out all touched the SAME day.
        expect(await countAttendanceRecords(query, EMPLOYEE_WORKER, workDateBefore)).toBe(1);
      });
    });
  });

  describe("multiple sessions the same day (seeded history)", () => {
    it("counts the employee once, with hours summed across both sessions", async () => {
      await seedSegment(db, { employeeId: EMPLOYEE_WORKER, workMode: "office", startUtc: `${HIST_DAY_1}T02:00:00Z`, endUtc: `${HIST_DAY_1}T06:00:00Z` }); // 4h, session 1
      await seedSegment(db, { employeeId: EMPLOYEE_WORKER, workMode: "office", startUtc: `${HIST_DAY_1}T10:00:00Z`, endUtc: `${HIST_DAY_1}T13:00:00Z` }); // 3h, session 2
      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, HIST_DAY_1);

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, HIST_DAY_1);
        expect(rec?.status).toBe("present");
        expect(Number(rec?.hours_worked)).toBeCloseTo(7, 1);
        expect(await countAttendanceRecords(query, EMPLOYEE_WORKER, HIST_DAY_1)).toBe(1);
      });
    });
  });

  describe("a session crossing local midnight", () => {
    it("finalizes the start date and shows 'still clocked in' on the new date separately", async () => {
      // DZ falls back to country_timezone()'s Asia/Dubai default (UTC+4) --
      // 19:30 UTC on day 1 is 23:30 Dubai on day 1, and 20:15 UTC on day 1 is
      // 00:15 Dubai on day 2, so this pair genuinely straddles local
      // midnight even though both instants share the same UTC calendar day.
      const sessionId = await seedSegment(db, {
        employeeId: EMPLOYEE_WORKER,
        workMode: "office",
        startUtc: `${OVERNIGHT_DAY_1}T14:00:00Z`,
        endUtc: `${OVERNIGHT_DAY_1}T19:30:00Z`, // 5.5h, closes at 23:30 Dubai (still day 1)
      });
      // A second, still-open segment in the SAME session -- exactly what
      // switch_work_segment() produces for a real overnight mode change.
      await seedSegment(db, {
        employeeId: EMPLOYEE_WORKER,
        sessionId,
        workMode: "client_meeting",
        startUtc: `${OVERNIGHT_DAY_1}T20:15:00Z`, // opens 00:15 Dubai on day 2
        endUtc: null,
      });

      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, OVERNIGHT_DAY_1);
      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, OVERNIGHT_DAY_2);

      await db.asUser(USER_WORKER, async (query) => {
        const day1 = await getAttendanceRecord(query, EMPLOYEE_WORKER, OVERNIGHT_DAY_1);
        expect(day1?.status).toBe("present");
        expect(Number(day1?.hours_worked)).toBeCloseTo(5.5, 1);
        expect(day1?.work_mode).toBe("office");

        const day2 = await getAttendanceRecord(query, EMPLOYEE_WORKER, OVERNIGHT_DAY_2);
        expect(day2?.status).toBe("present");
        expect(day2?.hours_worked).toBeNull(); // still open -- "Clocked in", not a partial figure
        expect(day2?.work_mode).toBe("field_work"); // client_meeting -> field_work
      });
    });
  });

  describe("conflicts with the manual register -- never silently overwritten", () => {
    it("a manual 'absent' day is preserved; self-clock only flags the conflict", async () => {
      await db.seed(`
        insert into attendance_records (employee_id, work_date, status, source)
        values ('${EMPLOYEE_WORKER}', '${HIST_DAY_2}', 'absent', 'manual');
      `);
      await seedSegment(db, { employeeId: EMPLOYEE_WORKER, workMode: "office", startUtc: `${HIST_DAY_2}T02:00:00Z`, endUtc: `${HIST_DAY_2}T06:00:00Z` });
      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, HIST_DAY_2);

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, HIST_DAY_2);
        expect(rec?.status).toBe("absent");
        expect(rec?.source).toBe("manual");
        expect(rec?.presence_conflict).toMatch(/absent/i);
      });
    });

    it("a manual 'leave' day is likewise preserved", async () => {
      const workDate = "2027-04-14";
      await db.seed(`
        insert into attendance_records (employee_id, work_date, status, source)
        values ('${EMPLOYEE_WORKER}', '${workDate}', 'leave', 'manual');
      `);
      await seedSegment(db, { employeeId: EMPLOYEE_WORKER, workMode: "office", startUtc: `${workDate}T02:00:00Z`, endUtc: `${workDate}T06:00:00Z` });
      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, workDate);

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDate);
        expect(rec?.status).toBe("leave");
        expect(rec?.presence_conflict).toMatch(/leave/i);
      });
    });

    it("an already-audited manual 'present' entry (its own hours) is preserved, not silently replaced", async () => {
      const workDate = "2027-04-15";
      await db.seed(`
        insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source)
        values ('${EMPLOYEE_WORKER}', '${workDate}', 'present', 'office', 6, 'manual');
      `);
      await seedSegment(db, { employeeId: EMPLOYEE_WORKER, workMode: "wfh", startUtc: `${workDate}T02:00:00Z`, endUtc: `${workDate}T05:00:00Z` }); // 3h, disagrees with the manual 6h
      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, workDate);

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDate);
        expect(rec?.source).toBe("manual");
        expect(Number(rec?.hours_worked)).toBe(6); // untouched
        expect(rec?.work_mode).toBe("office"); // untouched
        expect(rec?.presence_conflict).not.toBeNull();
      });
    });

    it("HR re-saving the day through the manual register clears a stale conflict", async () => {
      const workDate = "2027-04-15"; // continues from the conflict just created above
      await callAsCommit(
        db,
        USER_HR,
        `select * from record_attendance_and_recovery('${workDate}'::date, '[{"employee_id":"${EMPLOYEE_WORKER}","status":"present","work_mode":"office","hours_worked":6}]'::jsonb);`,
      );

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDate);
        expect(rec?.source).toBe("manual");
        expect(rec?.presence_conflict).toBeNull();
      });
    });

    it("a day explicitly saved as 'not_recorded' is safely filled in by self-clock (it is the genuine no-one-said-anything default)", async () => {
      const workDate = "2027-04-16";
      await db.seed(`
        insert into attendance_records (employee_id, work_date, status, source)
        values ('${EMPLOYEE_WORKER}', '${workDate}', 'not_recorded', 'manual');
      `);
      await seedSegment(db, { employeeId: EMPLOYEE_WORKER, workMode: "office", startUtc: `${workDate}T02:00:00Z`, endUtc: `${workDate}T06:00:00Z` });
      await syncPresence(db, USER_WORKER, EMPLOYEE_WORKER, workDate);

      await db.asUser(USER_WORKER, async (query) => {
        const rec = await getAttendanceRecord(query, EMPLOYEE_WORKER, workDate);
        expect(rec?.status).toBe("present");
        expect(rec?.source).toBe("self_clock");
        expect(rec?.presence_conflict).toBeNull();
      });
    });
  });
});
