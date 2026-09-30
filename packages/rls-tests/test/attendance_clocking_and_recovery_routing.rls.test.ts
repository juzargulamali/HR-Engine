import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Covers the Jibble replacement end to end: employee self-service attendance
// clocking (clock_in()/switch_work_segment()/clock_out()/
// hr_close_attendance_session(), attendance_locations capture) and the 4-tier
// Recovery Leave routing matrix it feeds (resolve_recovery_credit_route()/
// sync_attendance_recovery_for_day()/decide_recovery_credit_request()/
// adjust_recovery_credit_request()/resolve_recovery_credit_project_lead()).
// The pre-existing manual-attendance-register and overnight-form paths
// (record_attendance_and_recovery()/record_overnight_recovery_credit()) are
// UNCHANGED by this feature and stay covered in phase4.rls.test.ts.

async function actAs(query: Client["query"], userId: string) {
  await query("SET LOCAL ROLE authenticated");
  await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
}

function claims(userId: string): string {
  return JSON.stringify({ sub: userId, role: "authenticated" }).replace(/'/g, "''");
}

/**
 * clock_in()/switch_work_segment()/clock_out() all stamp segment_start/
 * segment_end with the server's own now() — there is no way to ask the real
 * RPCs to backdate a shift onto a specific historical weekend/holiday. To
 * test sync_attendance_recovery_for_day()'s detection math (which takes an
 * explicit work_date and only ever reads already-closed segments) against
 * chosen calendar dates, this seeds closed attendance_sessions/segments rows
 * directly via the unrestricted admin connection — attendance_segments has
 * no INSERT policy at all (writes only ever happen through the SECURITY
 * DEFINER RPCs), so this is the only way to place historical rows — then
 * invokes sync_attendance_recovery_for_day() in the SAME statement batch
 * with request.jwt.claims set to the employee's own user id, exactly as it
 * runs for real inside clock_out() (auth.uid() there is the clocking
 * employee's own session, which created_by / is_entity_owner() rely on).
 */
async function seedDayAndSync(
  db: RlsTestDatabase,
  args: {
    employeeUserId: string;
    employeeId: string;
    workDate: string;
    segments: Array<{
      workMode: string;
      projectName?: string | null;
      projectLeadEmployeeId?: string | null;
      startUtc: string;
      endUtc: string;
    }>;
  },
) {
  const sessionId = randomUUID();
  const first = args.segments[0]!.startUtc;
  const last = args.segments[args.segments.length - 1]!.endUtc;
  const segmentInserts = args.segments
    .map((s) => {
      const segId = randomUUID();
      const project = s.projectName ? `'${s.projectName.replace(/'/g, "''")}'` : "null";
      const lead = s.projectLeadEmployeeId ? `'${s.projectLeadEmployeeId}'` : "null";
      return `insert into attendance_segments (id, session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start, segment_end) values
        ('${segId}', '${sessionId}', '${args.employeeId}', '${s.workMode}', ${project}, ${lead}, '${s.startUtc}', '${s.endUtc}');`;
    })
    .join("\n");

  await db.seed(`
    begin;
    select set_config('request.jwt.claims', '${claims(args.employeeUserId)}', true);
    insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status)
      values ('${sessionId}', '${args.employeeId}', '${first}', '${last}', 'closed');
    ${segmentInserts}
    select sync_attendance_recovery_for_day('${args.employeeId}'::uuid, '${args.workDate}'::date);
    commit;
  `);
  return sessionId;
}

async function resync(db: RlsTestDatabase, employeeUserId: string, employeeId: string, workDate: string) {
  await db.seed(`
    begin;
    select set_config('request.jwt.claims', '${claims(employeeUserId)}', true);
    select sync_attendance_recovery_for_day('${employeeId}'::uuid, '${workDate}'::date);
    commit;
  `);
}

async function getRequest(query: Client["query"], employeeId: string, workDate: string) {
  const { rows } = await query(
    `select * from recovery_credit_requests where employee_id = $1 and work_date = $2 and status not in ('cancelled', 'rejected') order by created_at desc limit 1`,
    [employeeId, workDate],
  );
  return rows[0] as
    | {
        id: string;
        status: string;
        event_type: string;
        proposed_days: string;
        applicant_route: string | null;
        awaiting_project_lead: boolean;
        needs_policy_review: boolean;
        routing_issue: string | null;
        project_lead_employee_id: string | null;
        comp_day_ledger_id: string | null;
      }
    | undefined;
}

// ---------------------------------------------------------------------
// Fixed calendar anchors (2027) so the seeded-history tests below never
// depend on the real wall-clock date. Company A's country works Mon-Fri
// (weekend = Sat/Sun); 2027-03-02 is additionally seeded as a public
// holiday.
// ---------------------------------------------------------------------
const WEEKDAY = "2027-01-05"; // Tuesday, ordinary working day
const WEEKEND_BIG = "2027-01-09"; // Saturday
const WEEKEND_SMALL = "2027-02-06"; // Saturday
const HOLIDAY_WEEKDAY = "2027-03-02"; // Tuesday, public holiday
const OVERNIGHT_WEEKDAY = "2027-01-19"; // Tuesday, ordinary working day (shift crosses into 2027-01-20, also a Tuesday->Wednesday, ordinary)

const COMPANY_A = "00000000-0000-0000-0000-0000000c0a01";
const COMPANY_B = "00000000-0000-0000-0000-0000000c0b01";

const USER_HR1 = "00000000-0000-0000-0000-0000000c0a11";
const USER_HR2 = "00000000-0000-0000-0000-0000000c0a12";
const USER_CEO = "00000000-0000-0000-0000-0000000c0a13";
const USER_CTO = "00000000-0000-0000-0000-0000000c0a14";
const USER_MANAGER = "00000000-0000-0000-0000-0000000c0a15";
const USER_LEAD = "00000000-0000-0000-0000-0000000c0a16";
const USER_WORKER = "00000000-0000-0000-0000-0000000c0a17";
const USER_WORKER2 = "00000000-0000-0000-0000-0000000c0a18";
const USER_SELF_LED = "00000000-0000-0000-0000-0000000c0a19";
const USER_PEER = "00000000-0000-0000-0000-0000000c0a1a";
const USER_HR_MANAGER = "00000000-0000-0000-0000-0000000c0a1b"; // holds BOTH hr_admin and line_manager

const EMPLOYEE_HR1 = "00000000-0000-0000-0000-0000000c0a21";
const EMPLOYEE_HR2 = "00000000-0000-0000-0000-0000000c0a22";
const EMPLOYEE_CEO = "00000000-0000-0000-0000-0000000c0a23";
const EMPLOYEE_CTO = "00000000-0000-0000-0000-0000000c0a24";
const EMPLOYEE_MANAGER = "00000000-0000-0000-0000-0000000c0a25";
const EMPLOYEE_LEAD = "00000000-0000-0000-0000-0000000c0a26";
const EMPLOYEE_WORKER = "00000000-0000-0000-0000-0000000c0a27";
const EMPLOYEE_WORKER2 = "00000000-0000-0000-0000-0000000c0a28";
const EMPLOYEE_SELF_LED = "00000000-0000-0000-0000-0000000c0a29";
const EMPLOYEE_PEER = "00000000-0000-0000-0000-0000000c0a2a";
const EMPLOYEE_GHOST_LEAD = "00000000-0000-0000-0000-0000000c0a2b"; // active employee, no auth.users row at all -> "no HR Engine account"
const EMPLOYEE_TERMINATED = "00000000-0000-0000-0000-0000000c0a2c";
const EMPLOYEE_HR_MANAGER = "00000000-0000-0000-0000-0000000c0a2d";

const USER_HR_B = "00000000-0000-0000-0000-0000000c0b11";
const EMPLOYEE_HR_B = "00000000-0000-0000-0000-0000000c0b21";
const EMPLOYEE_LEAD_B = "00000000-0000-0000-0000-0000000c0b22"; // no auth.users row; only used as a cross-company id

describe("Attendance clocking + Recovery Leave 4-tier routing", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR1}', 'ac-hr1@enginious.ae'),
        ('${USER_HR2}', 'ac-hr2@enginious.ae'),
        ('${USER_CEO}', 'ac-ceo@enginious.ae'),
        ('${USER_CTO}', 'ac-cto@enginious.ae'),
        ('${USER_MANAGER}', 'ac-manager@enginious.ae'),
        ('${USER_LEAD}', 'ac-lead@enginious.ae'),
        ('${USER_WORKER}', 'ac-worker@enginious.ae'),
        ('${USER_WORKER2}', 'ac-worker2@enginious.ae'),
        ('${USER_SELF_LED}', 'ac-selfled@enginious.ae'),
        ('${USER_PEER}', 'ac-peer@enginious.ae'),
        ('${USER_HR_MANAGER}', 'ac-hrmanager@enginious.ae'),
        ('${USER_HR_B}', 'ac-hrb@enginious.ae');

      -- Mon-Fri working week (Sat/Sun weekend) for a clean, unambiguous
      -- eligibility split. Not one of AE/SA/PL, so country_timezone()
      -- resolves it to its Asia/Dubai fallback -- every seeded timestamp
      -- below is chosen with that offset (UTC+4) in mind.
      insert into countries (code, name, default_currency, working_weekdays) values ('CX', 'Clockland', 'CXD', array[1,2,3,4,5])
      on conflict (code) do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_A}', 'Clock Co', 'CX', 'CXD'),
        ('${COMPANY_B}', 'Other Clock Co', 'CX', 'CXD');
      insert into public_holidays (country_code, holiday_date, name) values ('CX', '${HOLIDAY_WEEKDAY}', 'Clockland Founding Day');

      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMPLOYEE_HR1}', '${USER_HR1}', 'AC-01', '${COMPANY_A}', 'CX', 'Hana', 'HrOne', '2024-01-01'),
        ('${EMPLOYEE_HR2}', '${USER_HR2}', 'AC-02', '${COMPANY_A}', 'CX', 'Hasan', 'HrTwo', '2024-01-01'),
        ('${EMPLOYEE_CEO}', '${USER_CEO}', 'AC-03', '${COMPANY_A}', 'CX', 'Cara', 'Ceo', '2024-01-01'),
        ('${EMPLOYEE_CTO}', '${USER_CTO}', 'AC-04', '${COMPANY_A}', 'CX', 'Carl', 'Cto', '2024-01-01'),
        ('${EMPLOYEE_MANAGER}', '${USER_MANAGER}', 'AC-05', '${COMPANY_A}', 'CX', 'Mona', 'Manager', '2024-01-01'),
        ('${EMPLOYEE_LEAD}', '${USER_LEAD}', 'AC-06', '${COMPANY_A}', 'CX', 'Leo', 'Lead', '2024-01-01'),
        ('${EMPLOYEE_WORKER}', '${USER_WORKER}', 'AC-07', '${COMPANY_A}', 'CX', 'Wale', 'Worker', '2024-01-01'),
        ('${EMPLOYEE_WORKER2}', '${USER_WORKER2}', 'AC-08', '${COMPANY_A}', 'CX', 'Wynn', 'WorkerTwo', '2024-01-01'),
        ('${EMPLOYEE_SELF_LED}', '${USER_SELF_LED}', 'AC-09', '${COMPANY_A}', 'CX', 'Sasha', 'SelfLed', '2024-01-01'),
        ('${EMPLOYEE_PEER}', '${USER_PEER}', 'AC-10', '${COMPANY_A}', 'CX', 'Pia', 'Peer', '2024-01-01'),
        ('${EMPLOYEE_GHOST_LEAD}', null, 'AC-11', '${COMPANY_A}', 'CX', 'Gia', 'Ghost', '2024-01-01'),
        ('${EMPLOYEE_TERMINATED}', null, 'AC-12', '${COMPANY_A}', 'CX', 'Tara', 'Terminated', '2024-01-01'),
        ('${EMPLOYEE_HR_MANAGER}', '${USER_HR_MANAGER}', 'AC-13', '${COMPANY_A}', 'CX', 'Hedy', 'HrManager', '2024-01-01'),
        ('${EMPLOYEE_HR_B}', '${USER_HR_B}', 'BC-01', '${COMPANY_B}', 'CX', 'Hina', 'HrB', '2024-01-01'),
        ('${EMPLOYEE_LEAD_B}', null, 'BC-02', '${COMPANY_B}', 'CX', 'Leyla', 'LeadB', '2024-01-01');
      update employees set employment_status = 'terminated' where id = '${EMPLOYEE_TERMINATED}';

      insert into user_roles (user_id, role, company_id) values
        ('${USER_HR1}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_HR2}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_CEO}', 'ceo', '${COMPANY_A}'),
        ('${USER_CTO}', 'cto', '${COMPANY_A}'),
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR_MANAGER}', 'hr_admin', '${COMPANY_A}'),
        ('${USER_HR_MANAGER}', 'line_manager', '${COMPANY_A}'),
        ('${USER_HR_B}', 'hr_admin', '${COMPANY_B}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  // =====================================================================
  // clock_in() / switch_work_segment() / clock_out(): session & segment
  // mechanics. Uses now()-based real calls (mechanics only -- the actual
  // calendar date doesn't matter here, unlike the detection-math tests
  // below).
  // =====================================================================
  describe("clock_in/switch_work_segment/clock_out: mechanics", () => {
    it("requires a project name and lead for Site work / Installation", async () => {
      await db.asUser(USER_PEER, async (query) => {
        await expect(query("select clock_in('site_work', null, null, null)")).rejects.toThrow(
          /Site work \/ Installation requires a project name and a project lead/,
        );
      });
    });

    it("rejects a project lead from a different company", async () => {
      await db.asUser(USER_PEER, async (query) => {
        await expect(query("select clock_in('site_work', 'Cross-co project', $1, $2::jsonb)", [
          EMPLOYEE_LEAD_B,
          JSON.stringify({ permission_status: "granted", latitude: 25.2, longitude: 55.3, accuracy_meters: 5 }),
        ])).rejects.toThrow(/must be an employee of your own company/);
      });
    });

    it("rejects a terminated employee as project lead", async () => {
      await db.asUser(USER_PEER, async (query) => {
        await expect(query("select clock_in('site_work', 'Terminated lead project', $1, $2::jsonb)", [
          EMPLOYEE_TERMINATED,
          JSON.stringify({ permission_status: "granted", latitude: 25.2, longitude: 55.3, accuracy_meters: 5 }),
        ])).rejects.toThrow(/must be a currently active employee/);
      });
    });

    it("requires a location payload (even a denied/unavailable one) for a Site work clock-in", async () => {
      await db.asUser(USER_PEER, async (query) => {
        await expect(query("select clock_in('site_work', 'No location project', $1, null)", [EMPLOYEE_LEAD])).rejects.toThrow(
          /Location status is required/,
        );
      });
    });

    it("clocks in, switches work mode mid-shift without ending the session, then clocks out", async () => {
      // Each step is its OWN transaction (asUserCommit, not asUser): every
      // one of these RPCs stamps its timestamp with now(), and now() is
      // stable for the lifetime of a single Postgres transaction -- chaining
      // them inside one asUser() call would give every segment the exact
      // same instant and trip the segment_end > segment_start check.
      const sessionId = await db.asUserCommit(USER_PEER, (query) => query("select clock_in('office') as id").then((r) => r.rows[0].id as string));

      await db.asUserCommit(USER_PEER, (query) =>
        query("select switch_work_segment('site_work', 'Mid-shift project', $1, null, $2::jsonb)", [
          EMPLOYEE_LEAD,
          JSON.stringify({ permission_status: "granted", latitude: 25.1, longitude: 55.2, accuracy_meters: 12 }),
        ]),
      );
      await db.asUserCommit(USER_PEER, (query) =>
        query("select switch_work_segment('wfh', null, null, $1::jsonb, null)", [
          JSON.stringify({ permission_status: "granted", latitude: 25.1, longitude: 55.2, accuracy_meters: 12 }),
        ]),
      );
      await db.asUserCommit(USER_PEER, (query) => query("select clock_out(null)"));

      const segments = await db.seed(
        `select work_mode, segment_end is not null as closed from attendance_segments where session_id = '${sessionId}' order by segment_start asc`,
      );
      expect(segments.rows).toEqual([
        { work_mode: "office", closed: true },
        { work_mode: "site_work", closed: true },
        { work_mode: "wfh", closed: true },
      ]);

      const session = await db.seed(
        `select status, clock_out_at is not null as has_clock_out from attendance_sessions where id = '${sessionId}'`,
      );
      expect(session.rows).toEqual([{ status: "closed", has_clock_out: true }]);

      const openSegments = await db.seed(
        `select count(*)::int as n from attendance_segments where session_id = '${sessionId}' and segment_end is null`,
      );
      expect(openSegments.rows[0].n).toBe(0);

      // One location row per site_work boundary the segment actually owns
      // (its own start AND its own end) -- office/wfh segments never get
      // one at all.
      const locations = await db.seed(
        `select event, permission_status, latitude is not null as has_lat from attendance_locations al
         join attendance_segments s on s.id = al.segment_id where s.session_id = '${sessionId}' order by al.captured_at asc`,
      );
      expect(locations.rows).toEqual([
        { event: "segment_start", permission_status: "granted", has_lat: true },
        { event: "segment_end", permission_status: "granted", has_lat: true },
      ]);
    });

    it("records a denied/timeout location with no coordinates, and never blocks the clock action on it", async () => {
      const sessionId = await db.asUserCommit(USER_WORKER2, (query) =>
        query("select clock_in('site_work', 'Denied-location project', $1, $2::jsonb) as id", [
          EMPLOYEE_LEAD,
          JSON.stringify({ permission_status: "denied" }),
        ]).then((r) => r.rows[0].id as string),
      );

      await db.asUserCommit(USER_WORKER2, (query) => query("select clock_out($1::jsonb)", [JSON.stringify({ permission_status: "timeout" })]));

      const locations = await db.seed(
        `select event, permission_status, latitude, longitude from attendance_locations al
         join attendance_segments s on s.id = al.segment_id where s.session_id = '${sessionId}' order by al.captured_at asc`,
      );
      expect(locations.rows).toEqual([
        { event: "segment_start", permission_status: "denied", latitude: null, longitude: null },
        { event: "segment_end", permission_status: "timeout", latitude: null, longitude: null },
      ]);
    });

    it("rejects clocking out when there is no open session (already clocked out / a second browser tab)", async () => {
      await db.asUserCommit(USER_PEER, (query) => query("select clock_in('office')"));
      await db.asUserCommit(USER_PEER, (query) => query("select clock_out(null)"));
      await db.asUser(USER_PEER, async (query) => {
        await expect(query("select clock_out(null)")).rejects.toThrow(/not currently clocked in/);
      });
    });

    it("rejects switching work mode when there is no open session", async () => {
      await db.asUser(USER_PEER, async (query) => {
        await expect(query("select switch_work_segment('office')")).rejects.toThrow(/not currently clocked in/);
      });
    });

    it("rejects a second clock-in while already clocked in — including a genuine concurrent double-click across two connections", async () => {
      // A true race: two separate transactions/connections both call
      // clock_in() for the SAME employee at (almost) the same time.
      // clock_in()'s pg_advisory_xact_lock keyed on the employee serializes
      // them -- the loser must see the already-open session and raise,
      // never create a second one. asUserCommit (not asUser) is required
      // here since asUser's automatic rollback would hide the first call's
      // insert from the second, defeating the whole point of the race.
      const results = await Promise.allSettled([
        db.asUserCommit(USER_LEAD, (query) => query("select clock_in('office') as id")),
        db.asUserCommit(USER_LEAD, (query) => query("select clock_in('wfh') as id")),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/already clocked in/);

      const openSessions = await db.seed(
        `select count(*)::int as n from attendance_sessions where employee_id = '${EMPLOYEE_LEAD}' and status = 'open'`,
      );
      expect(openSessions.rows[0].n).toBe(1);

      // Clean up the real, committed open session left behind by the
      // winning branch above so it doesn't leak into any later test that
      // clocks EMPLOYEE_LEAD in again.
      await db.asUserCommit(USER_LEAD, (query) => query("select clock_out(null)"));
    });
  });

  // =====================================================================
  // hr_close_attendance_session(): the missing-clock-out correction path.
  // =====================================================================
  describe("hr_close_attendance_session(): missing clock-out correction", () => {
    it("lets HR Admin close a forgotten clock-out with a corrected time and a reason", async () => {
      const sessionId = await db.asUserCommit(USER_WORKER, (query) =>
        query("select clock_in('office') as id").then((r) => r.rows[0].id as string),
      );

      // The correction time just needs to be strictly after clock_in_at --
      // now() alone (a real, separately-committed transaction later than
      // the clock-in above) already satisfies that.
      await db.asUserCommit(USER_HR1, async (query) => {
        await query("select hr_close_attendance_session($1, now(), 'Employee forgot to clock out')", [sessionId]);
      });

      const session = await db.seed(
        `select status, hr_closed_by is not null as was_hr_closed, hr_closed_reason from attendance_sessions where id = '${sessionId}'`,
      );
      expect(session.rows).toEqual([{ status: "closed", was_hr_closed: true, hr_closed_reason: "Employee forgot to clock out" }]);
    });

    it("requires a reason, and requires the corrected time to be after clock-in", async () => {
      const sessionId = await db.asUserCommit(USER_WORKER, (query) =>
        query("select clock_in('office') as id").then((r) => r.rows[0].id as string),
      );

      // Each failed call aborts its own transaction (Postgres semantics) --
      // one asUser() call per expected failure, not two statements in one.
      await db.asUser(USER_HR1, async (query) => {
        await expect(query("select hr_close_attendance_session($1, now(), null)", [sessionId])).rejects.toThrow(/A reason is required/);
      });
      await db.asUser(USER_HR1, async (query) => {
        await expect(query("select hr_close_attendance_session($1, now() - interval '2 hours', 'Too early')", [sessionId])).rejects.toThrow(
          /must be after the original clock-in time/,
        );
      });

      // Clean up the still-open real session.
      await db.asUserCommit(USER_HR1, (query) => query("select hr_close_attendance_session($1, now(), 'cleanup')", [sessionId]));
    });

    it("rejects a non-HR-Admin caller", async () => {
      const sessionId = await db.asUserCommit(USER_WORKER, (query) =>
        query("select clock_in('office') as id").then((r) => r.rows[0].id as string),
      );

      await db.asUser(USER_MANAGER, async (query) => {
        await expect(query("select hr_close_attendance_session($1, now(), 'Not HR')", [sessionId])).rejects.toThrow(
          /Only HR Admin may close a missing clock-out/,
        );
      });

      await db.asUserCommit(USER_HR1, (query) => query("select hr_close_attendance_session($1, now(), 'cleanup')", [sessionId]));
    });

    it("rejects closing when there is no open session for the given id", async () => {
      await db.asUser(USER_HR1, async (query) => {
        await expect(query("select hr_close_attendance_session($1, now(), 'reason')", [randomUUID()])).rejects.toThrow(
          /Open attendance session not found/,
        );
      });
    });
  });

  // =====================================================================
  // sync_attendance_recovery_for_day(): eligibility detection math, using
  // directly-seeded historical segments (see seedDayAndSync's own doc
  // comment for why).
  // =====================================================================
  describe("sync_attendance_recovery_for_day(): eligibility detection", () => {
    it("does not qualify Office work on an ordinary weekday, no matter how many hours", async () => {
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: WEEKDAY,
        segments: [{ workMode: "office", startUtc: `${WEEKDAY}T04:00:00Z`, endUtc: `${WEEKDAY}T16:00:00Z` }],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, WEEKDAY);
        expect(request).toBeUndefined();
      });
    });

    it("credits a full weekend day of Office work (>4h -> 1 day, standard)", async () => {
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: WEEKEND_BIG,
        segments: [{ workMode: "office", startUtc: `${WEEKEND_BIG}T04:00:00Z`, endUtc: `${WEEKEND_BIG}T10:00:00Z` }],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, WEEKEND_BIG);
        expect(request).toMatchObject({ event_type: "standard", proposed_days: "1.0" });
      });
    });

    it("credits a half day for a short weekend WFH stint (<=4h -> 0.5 day)", async () => {
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: WEEKEND_SMALL,
        segments: [{ workMode: "wfh", startUtc: `${WEEKEND_SMALL}T06:00:00Z`, endUtc: `${WEEKEND_SMALL}T09:00:00Z` }],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, WEEKEND_SMALL);
        expect(request).toMatchObject({ event_type: "standard", proposed_days: "0.5" });
      });
    });

    it("credits Office work on a public holiday that falls on an ordinary weekday", async () => {
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: HOLIDAY_WEEKDAY,
        segments: [{ workMode: "office", startUtc: `${HOLIDAY_WEEKDAY}T05:00:00Z`, endUtc: `${HOLIDAY_WEEKDAY}T11:00:00Z` }],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, HOLIDAY_WEEKDAY);
        expect(request).toMatchObject({ event_type: "standard", proposed_days: "1.0" });
      });
    });

    it("credits only the portion of an overnight shift past local midnight on an ordinary weekday", async () => {
      // Asia/Dubai is UTC+4 (country_timezone()'s fallback for a country
      // code other than AE/SA/PL). Local midnight going into
      // 2027-01-20 is 2027-01-19T20:00:00Z; a shift from 18:00Z to
      // 23:00Z local-start 22:00 to local-end 03:00 spans 5 real hours but
      // only 3 of them (20:00Z-23:00Z) fall past that local midnight.
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: OVERNIGHT_WEEKDAY,
        segments: [{ workMode: "office", startUtc: `${OVERNIGHT_WEEKDAY}T18:00:00Z`, endUtc: `${OVERNIGHT_WEEKDAY}T23:00:00Z` }],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, OVERNIGHT_WEEKDAY);
        expect(request).toMatchObject({ event_type: "overnight", proposed_days: "0.5" });
      });
    });

    it("flags needs_policy_review for business travel, but still creates the request rather than silently auto-crediting", async () => {
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: "2027-02-13", // Saturday
        segments: [{ workMode: "business_travel", startUtc: "2027-02-13T04:00:00Z", endUtc: "2027-02-13T10:00:00Z" }],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, "2027-02-13");
        expect(request).toMatchObject({ needs_policy_review: true, event_type: "standard", proposed_days: "1.0" });
        // "Never auto-credited" -- the request exists for HR to review, but
        // nothing is posted to the ledger until a real decision is made.
        const ledger = await query("select count(*)::int as n from comp_day_ledger where reference_type = 'recovery_credit_request' and reference_id = $1", [
          request!.id,
        ]);
        expect(ledger.rows[0].n).toBe(0);
      });
    });

    it("flags needs_policy_review when the day's site_work segments name more than one distinct lead", async () => {
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate: "2027-02-20", // Saturday
        segments: [
          { workMode: "site_work", projectName: "Multi-lead A", projectLeadEmployeeId: EMPLOYEE_LEAD, startUtc: "2027-02-20T04:00:00Z", endUtc: "2027-02-20T07:00:00Z" },
          { workMode: "site_work", projectName: "Multi-lead B", projectLeadEmployeeId: EMPLOYEE_HR1, startUtc: "2027-02-20T07:00:00Z", endUtc: "2027-02-20T10:00:00Z" },
        ],
      });
      await db.asUser(USER_WORKER2, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER2, "2027-02-20");
        expect(request).toMatchObject({ needs_policy_review: true });
      });
    });

    it("is idempotent: re-syncing an already-requested day never creates a second request", async () => {
      const workDate = "2027-02-27"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      await resync(db, USER_WORKER2, EMPLOYEE_WORKER2, workDate);

      await db.asUser(USER_WORKER2, async (query) => {
        const { rows } = await query("select count(*)::int as n from recovery_credit_requests where employee_id = $1 and work_date = $2", [
          EMPLOYEE_WORKER2,
          workDate,
        ]);
        expect(rows[0].n).toBe(1);
      });
    });

    it("cancels a still-pending request when a later re-sync finds the day no longer qualifies", async () => {
      const workDate = "2027-03-06"; // Saturday
      const sessionId = await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });

      // Simulate the day's only segment being corrected onto a different
      // date (never happens via the RPCs, but a manual data fix could) --
      // total_hours for the ORIGINAL work_date drops to 0, no longer a
      // qualifying day at all. Shifting both timestamps together (rather
      // than deleting the row, which recovery_credit_requests.segment_id
      // still references, or collapsing its own duration to zero, which
      // the segment_end > segment_start check constraint forbids) keeps
      // the row valid while moving it off this work_date entirely.
      await db.seed(
        `update attendance_segments set segment_start = segment_start - interval '2 days', segment_end = segment_end - interval '2 days' where session_id = '${sessionId}'`,
      );
      await resync(db, USER_WORKER2, EMPLOYEE_WORKER2, workDate);

      await db.asUser(USER_WORKER2, async (query) => {
        const { rows } = await query("select status from recovery_credit_requests where employee_id = $1 and work_date = $2", [
          EMPLOYEE_WORKER2,
          workDate,
        ]);
        expect(rows).toEqual([{ status: "cancelled" }]);
      });
    });

    it("reverses an already-approved credit when a later re-sync finds the day no longer qualifies", async () => {
      const workDate = "2027-03-13"; // Saturday
      const sessionId = await seedDayAndSync(db, {
        employeeUserId: USER_WORKER2,
        employeeId: EMPLOYEE_WORKER2,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });

      let requestId!: string;
      await db.asUserCommit(USER_WORKER2, async (query) => {
        const req = await getRequest(query, EMPLOYEE_WORKER2, workDate);
        requestId = req!.id;
      });
      // EMPLOYEE_WORKER2 has no manager/HR/lead role of its own and no
      // project lead captured (plain Office work) -> awaiting_project_lead.
      // Resolve it to an ordinary peer lead so it routes and can be decided.
      await db.asUserCommit(USER_WORKER2, (query) => query("select resolve_recovery_credit_project_lead($1, $2)", [requestId, EMPLOYEE_LEAD]));
      await db.asUserCommit(USER_LEAD, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Confirmed on site')", [requestId]));
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked with the lead')", [requestId]));

      const credited = await db.seed(
        `select days from comp_day_ledger where reference_type = 'recovery_credit_request' and reference_id = '${requestId}' and entry_type = 'earned'`,
      );
      expect(credited.rows).toHaveLength(1);

      // Shift the segment off this work_date entirely -- see the previous
      // test's doc comment for why (FK + check-constraint reasons rule out
      // deleting the row or collapsing its duration to zero in place).
      await db.seed(
        `update attendance_segments set segment_start = segment_start - interval '2 days', segment_end = segment_end - interval '2 days' where session_id = '${sessionId}'`,
      );
      await resync(db, USER_WORKER2, EMPLOYEE_WORKER2, workDate);

      const after = await db.seed(`select status from recovery_credit_requests where id = '${requestId}'`);
      expect(after.rows).toEqual([{ status: "cancelled" }]);
      const reversal = await db.seed(
        `select days from comp_day_ledger where reversal_of_id = (select id from comp_day_ledger where reference_id = '${requestId}' and entry_type = 'earned')`,
      );
      expect(reversal.rows).toEqual([{ days: "-1.00" }]);
    });
  });

  // =====================================================================
  // The 4-tier applicant_route matrix.
  // =====================================================================
  describe("4-tier routing: resolve_recovery_credit_route()", () => {
    it("routes an ordinary employee with a named (different) project lead to employee_lead_then_hr", async () => {
      const workDate = "2027-04-03"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Lead route project", projectLeadEmployeeId: EMPLOYEE_LEAD, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` },
        ],
      });
      await db.asUser(USER_WORKER, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER, workDate);
        expect(request).toMatchObject({ applicant_route: "employee_lead_then_hr", awaiting_project_lead: false, routing_issue: null });

        const approval = await query("select approver_id, queue_roles, step_order from approvals where entity_type = 'recovery_credit' and entity_id = $1", [
          request!.id,
        ]);
        expect(approval.rows).toEqual([{ approver_id: USER_LEAD, queue_roles: null, step_order: 1 }]);
      });
    });

    it("holds an ordinary employee's Office/WFH day with no project lead as awaiting_project_lead, with no approvals row at all", async () => {
      const workDate = "2027-04-10"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [{ workMode: "wfh", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      let requestId!: string;
      await db.asUser(USER_WORKER, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER, workDate);
        expect(request).toMatchObject({ applicant_route: null, awaiting_project_lead: true });
        requestId = request!.id;

        const approvals = await query("select count(*)::int as n from approvals where entity_type = 'recovery_credit' and entity_id = $1", [requestId]);
        expect(approvals.rows[0].n).toBe(0);
      });

      // resolve_recovery_credit_project_lead() supplies the missing lead
      // afterward and the request routes for the first time.
      await db.asUserCommit(USER_WORKER, (query) => query("select resolve_recovery_credit_project_lead($1, $2)", [requestId, EMPLOYEE_LEAD]));
      const after = await db.seed(`select applicant_route, awaiting_project_lead from recovery_credit_requests where id = '${requestId}'`);
      expect(after.rows).toEqual([{ applicant_route: "employee_lead_then_hr", awaiting_project_lead: false }]);
      const approvalAfter = await db.seed(`select approver_id from approvals where entity_type = 'recovery_credit' and entity_id = '${requestId}'`);
      expect(approvalAfter.rows).toEqual([{ approver_id: USER_LEAD }]);
    });

    it("routes a permanent Manager's own attendance straight to HR (manager_hr_direct)", async () => {
      const workDate = "2027-04-17"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_MANAGER,
        employeeId: EMPLOYEE_MANAGER,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      await db.asUser(USER_MANAGER, async (query) => {
        const request = await getRequest(query, EMPLOYEE_MANAGER, workDate);
        expect(request).toMatchObject({ applicant_route: "manager_hr_direct" });
        const approval = await query("select approver_id, queue_roles::text[] from approvals where entity_type = 'recovery_credit' and entity_id = $1", [
          request!.id,
        ]);
        expect(approval.rows).toEqual([{ approver_id: null, queue_roles: ["hr_admin"] }]);
      });

      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_MANAGER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked with the manager directly')", [requestId]));
      const credited = await db.seed(
        `select days from comp_day_ledger where reference_type = 'recovery_credit_request' and reference_id = '${requestId}' and entry_type = 'earned'`,
      );
      expect(credited.rows).toEqual([{ days: "1.00" }]);
    });

    it("routes an HR Admin's own attendance to the shared CEO/CTO queue, decidable by either", async () => {
      const workDate = "2027-04-24"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_HR1,
        employeeId: EMPLOYEE_HR1,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      let requestId!: string;
      await db.asUser(USER_HR1, async (query) => {
        const request = await getRequest(query, EMPLOYEE_HR1, workDate);
        expect(request).toMatchObject({ applicant_route: "hr_admin_ceo_cto_queue" });
        requestId = request!.id;
        const approval = await query("select approver_id, queue_roles::text[] from approvals where entity_type = 'recovery_credit' and entity_id = $1", [requestId]);
        expect(approval.rows).toEqual([{ approver_id: null, queue_roles: ["ceo", "cto"] }]);
      });

      // The OTHER HR Admin holds no ceo/cto role and must be refused.
      await db.asUser(USER_HR2, async (query) => {
        await expect(query("select decide_recovery_credit_request($1, 'approved', 'Trying anyway')", [requestId])).rejects.toThrow(
          /Only an active ceo or cto/,
        );
      });

      // The CTO alone may decide it (either would do).
      await db.asUserCommit(USER_CTO, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked with HR directly')", [requestId]));
      const status = await db.seed(`select status from recovery_credit_requests where id = '${requestId}'`);
      expect(status.rows).toEqual([{ status: "approved" }]);
    });

    it("routes to the shared CEO/CTO queue for an employee who holds BOTH hr_admin and line_manager -- HR precedence, never manager_hr_direct", async () => {
      // resolve_recovery_credit_route() checks has_role('hr_admin', ...)
      // BEFORE has_role('line_manager', ...) -- confirms that check order
      // actually matters, not just in the abstract.
      const workDate = "2027-04-25"; // Sunday, also a weekend day for CX
      await seedDayAndSync(db, {
        employeeUserId: USER_HR_MANAGER,
        employeeId: EMPLOYEE_HR_MANAGER,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      await db.asUser(USER_HR_MANAGER, async (query) => {
        const request = await getRequest(query, EMPLOYEE_HR_MANAGER, workDate);
        expect(request).toMatchObject({ applicant_route: "hr_admin_ceo_cto_queue" });
        const approval = await query("select approver_id, queue_roles::text[] from approvals where entity_type = 'recovery_credit' and entity_id = $1", [
          request!.id,
        ]);
        expect(approval.rows).toEqual([{ approver_id: null, queue_roles: ["ceo", "cto"] }]);
      });
    });

    it("lets whichever of CEO/CTO decides first win a genuinely concurrent race on the same shared-queue item", async () => {
      const workDate = "2027-05-01"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_HR2,
        employeeId: EMPLOYEE_HR2,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_HR2}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);

      const results = await Promise.allSettled([
        db.asUserCommit(USER_CEO, (query) => query("select decide_recovery_credit_request($1, 'approved', 'CEO checked')", [requestId])),
        db.asUserCommit(USER_CTO, (query) => query("select decide_recovery_credit_request($1, 'approved', 'CTO checked')", [requestId])),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/No pending approval found|already been decided/);

      const credits = await db.seed(
        `select count(*)::int as n from comp_day_ledger where reference_type = 'recovery_credit_request' and reference_id = '${requestId}' and entry_type = 'earned'`,
      );
      expect(credits.rows[0].n).toBe(1);
    });

    it("routes an ordinary employee who names themselves as the Site work lead to self_led_hr_direct, for independent HR verification", async () => {
      const workDate = "2027-05-08"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_SELF_LED,
        employeeId: EMPLOYEE_SELF_LED,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Self-led project", projectLeadEmployeeId: EMPLOYEE_SELF_LED, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` },
        ],
      });
      await db.asUser(USER_SELF_LED, async (query) => {
        const request = await getRequest(query, EMPLOYEE_SELF_LED, workDate);
        expect(request).toMatchObject({ applicant_route: "self_led_hr_direct" });
        const approval = await query("select approver_id, queue_roles::text[] from approvals where entity_type = 'recovery_credit' and entity_id = $1", [
          request!.id,
        ]);
        expect(approval.rows).toEqual([{ approver_id: null, queue_roles: ["hr_admin"] }]);
      });
    });

    it("records a routing_issue instead of aborting when the named project lead has no HR Engine account", async () => {
      const workDate = "2027-05-15"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Ghost lead project", projectLeadEmployeeId: EMPLOYEE_GHOST_LEAD, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` },
        ],
      });
      await db.asUser(USER_WORKER, async (query) => {
        const request = await getRequest(query, EMPLOYEE_WORKER, workDate);
        expect(request?.applicant_route).toBe("employee_lead_then_hr");
        expect(request?.routing_issue).toMatch(/no HR Engine account/);
        const approvals = await query("select count(*)::int as n from approvals where entity_type = 'recovery_credit' and entity_id = $1", [request!.id]);
        expect(approvals.rows[0].n).toBe(0);
      });
    });

    it("rejects a cross-company project lead at resolve_recovery_credit_project_lead() the same way clock_in() does", async () => {
      const workDate = "2027-05-22"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [{ workMode: "wfh", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_WORKER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);

      await db.asUser(USER_WORKER, async (query) => {
        await expect(query("select resolve_recovery_credit_project_lead($1, $2)", [requestId, EMPLOYEE_LEAD_B])).rejects.toThrow(
          /must be an employee of your own company/,
        );
      });
    });

    it("gives the named project lead temporary read access to just the request/segment they lead, never to unrelated employees' records", async () => {
      const workDate = "2027-05-29"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Visibility project", projectLeadEmployeeId: EMPLOYEE_LEAD, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` },
        ],
      });
      await db.asUser(USER_LEAD, async (query) => {
        const own = await query("select employee_id from recovery_credit_requests where employee_id = $1 and work_date = $2", [EMPLOYEE_WORKER, workDate]);
        expect(own.rows).toHaveLength(1);

        const segment = await query("select id from attendance_segments where employee_id = $1 and project_name = 'Visibility project'", [
          EMPLOYEE_WORKER,
        ]);
        expect(segment.rows).toHaveLength(1);

        // No lead relationship to EMPLOYEE_PEER at all -> invisible.
        const unrelated = await query("select 1 from recovery_credit_requests where employee_id = $1", [EMPLOYEE_PEER]);
        expect(unrelated.rows).toHaveLength(0);
      });
    });

    it("never shows one company's attendance/recovery data to another company's HR Admin", async () => {
      await db.asUser(USER_HR_B, async (query) => {
        const sessions = await query("select 1 from attendance_sessions where employee_id = $1", [EMPLOYEE_WORKER]);
        expect(sessions.rows).toHaveLength(0);
        const requests = await query("select 1 from recovery_credit_requests where employee_id = $1", [EMPLOYEE_WORKER]);
        expect(requests.rows).toHaveLength(0);
      });
    });
  });

  // =====================================================================
  // employee_lead_then_hr: two-step advance + renewed approval after a
  // material HR correction.
  // =====================================================================
  describe("employee_lead_then_hr: step advancement and renewed approval", () => {
    it("advances from the lead's approval to HR's queue, then credits on HR's approval", async () => {
      const workDate = "2027-06-05"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Two-step project", projectLeadEmployeeId: EMPLOYEE_LEAD, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` },
        ],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_WORKER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);

      await db.asUserCommit(USER_LEAD, (query) => query("select decide_recovery_credit_request($1, 'approved', null)", [requestId]));
      const afterLead = await db.seed(`select status from recovery_credit_requests where id = '${requestId}'`);
      expect(afterLead.rows).toEqual([{ status: "pending_approval" }]);
      const step2 = await db.seed(
        `select queue_roles::text[] as queue_roles, decision from approvals where entity_type = 'recovery_credit' and entity_id = '${requestId}' and step_order = 2`,
      );
      expect(step2.rows).toEqual([{ queue_roles: ["hr_admin"], decision: "pending" }]);

      // The lead's own step never requires checked_with (their decision IS
      // the in-app verification) -- proven above by passing null and
      // succeeding. HR's step here is ALSO exempt (this route's own
      // exception), unlike every other route.
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', null)", [requestId]));
      const final = await db.seed(`select status, comp_day_ledger_id is not null as credited from recovery_credit_requests where id = '${requestId}'`);
      expect(final.rows).toEqual([{ status: "approved", credited: true }]);
    });

    it("stops the chain outright when the lead rejects — HR never sees it", async () => {
      const workDate = "2027-06-12"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Rejected-by-lead project", projectLeadEmployeeId: EMPLOYEE_LEAD, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` },
        ],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_WORKER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);

      await db.asUserCommit(USER_LEAD, (query) => query("select decide_recovery_credit_request($1, 'rejected', null)", [requestId]));
      const after = await db.seed(`select status from recovery_credit_requests where id = '${requestId}'`);
      expect(after.rows).toEqual([{ status: "rejected" }]);
      const step2 = await db.seed(
        `select count(*)::int as n from approvals where entity_type = 'recovery_credit' and entity_id = '${requestId}' and step_order = 2`,
      );
      expect(step2.rows[0].n).toBe(0);
    });

    it("resets the lead's approval to pending after a material HR correction, and blocks HR's step until it is renewed", async () => {
      const workDate = "2027-06-19"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [
          { workMode: "site_work", projectName: "Corrected project", projectLeadEmployeeId: EMPLOYEE_LEAD, startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T09:00:00Z` },
        ],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_WORKER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);

      await db.asUserCommit(USER_LEAD, (query) => query("select decide_recovery_credit_request($1, 'approved', null)", [requestId]));

      // HR corrects the hours down from 1 day to 0.5 day -- a MATERIAL
      // change (proposed_days actually differs).
      await db.asUserCommit(USER_HR1, (query) =>
        query("select adjust_recovery_credit_request($1, $2, 3, 'Timesheet overstated the hours', null)", [requestId, workDate]),
      );
      const step1AfterCorrection = await db.seed(
        `select decision from approvals where entity_type = 'recovery_credit' and entity_id = '${requestId}' and step_order = 1`,
      );
      expect(step1AfterCorrection.rows).toEqual([{ decision: "pending" }]);

      // Both step 1 (just reset) and step 2 (untouched, still pending from
      // the earlier advance) are pending at once -- decide_recovery_credit_
      // request() must resolve to the EARLIEST pending step (the lead's own
      // step 1, awaiting its renewed approval), never HR's step 2, so HR
      // calling it now is correctly refused as not the assigned approver,
      // rather than being let through to (and wrongly finalizing) step 2.
      await db.asUser(USER_HR1, async (query) => {
        await expect(query("select decide_recovery_credit_request($1, 'approved', null)", [requestId])).rejects.toThrow(
          /Only the assigned approver may decide this/,
        );
      });

      // The lead re-approves the corrected figures, THEN HR may finish it.
      await db.asUserCommit(USER_LEAD, (query) => query("select decide_recovery_credit_request($1, 'approved', null)", [requestId]));
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', null)", [requestId]));
      const final = await db.seed(`select status, proposed_days from recovery_credit_requests where id = '${requestId}'`);
      expect(final.rows).toEqual([{ status: "approved", proposed_days: "0.5" }]);
    });
  });

  // =====================================================================
  // decide_recovery_credit_request(): the "checked with" requirement is
  // conditional on the route.
  // =====================================================================
  describe("decide_recovery_credit_request(): checked_with requirement by route", () => {
    it("requires checked_with to approve manager_hr_direct, self_led_hr_direct, and hr_admin_ceo_cto_queue, but never to reject", async () => {
      const cases: Array<{ userId: string; employeeId: string; workDate: string; decider: string }> = [
        { userId: USER_MANAGER, employeeId: EMPLOYEE_MANAGER, workDate: "2027-07-03", decider: USER_HR1 },
        { userId: USER_SELF_LED, employeeId: EMPLOYEE_SELF_LED, workDate: "2027-07-10", decider: USER_HR1 },
      ];
      for (const c of cases) {
        await seedDayAndSync(db, {
          employeeUserId: c.userId,
          employeeId: c.employeeId,
          workDate: c.workDate,
          segments:
            c.employeeId === EMPLOYEE_SELF_LED
              ? [{ workMode: "site_work", projectName: "Checked-with project", projectLeadEmployeeId: EMPLOYEE_SELF_LED, startUtc: `${c.workDate}T04:00:00Z`, endUtc: `${c.workDate}T10:00:00Z` }]
              : [{ workMode: "office", startUtc: `${c.workDate}T04:00:00Z`, endUtc: `${c.workDate}T10:00:00Z` }],
        });
        const requestId = await db
          .seed(`select id from recovery_credit_requests where employee_id = '${c.employeeId}' and work_date = '${c.workDate}'`)
          .then((r) => r.rows[0].id as string);

        // The failed approve attempt raises inside Postgres, aborting the
        // rest of that transaction (see phase4.rls.test.ts's own doc
        // comment on this exact pitfall) -- the rejection below must run in
        // its own separate asUser() call, not a second statement of this one.
        await db.asUser(c.decider, async (query) => {
          await expect(query("select decide_recovery_credit_request($1, 'approved', null)", [requestId])).rejects.toThrow(
            /Record whom you checked this work with/,
          );
        });
        // A rejection never needs it.
        await db.asUser(c.decider, (query) => query("select decide_recovery_credit_request($1, 'rejected', null)", [requestId]));
      }
    });
  });

  // =====================================================================
  // adjust_recovery_credit_request(): HR's correction RPC.
  // =====================================================================
  describe("adjust_recovery_credit_request(): HR corrections", () => {
    it("requires HR Admin", async () => {
      const workDate = "2027-08-07"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [{ workMode: "wfh", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_WORKER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);
      // resolve a lead so there is a pending approval for the lock at the
      // top of adjust_recovery_credit_request() to find.
      await db.asUserCommit(USER_WORKER, (query) => query("select resolve_recovery_credit_project_lead($1, $2)", [requestId, EMPLOYEE_LEAD]));

      await db.asUser(USER_MANAGER, async (query) => {
        await expect(query("select adjust_recovery_credit_request($1, $2, 8, 'trying anyway', null)", [requestId, workDate])).rejects.toThrow(
          /Only HR Admin may adjust/,
        );
      });
    });

    it("requires a reason only when the date or hours actually change, and recomputes the day threshold", async () => {
      const workDate = "2027-08-14"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_WORKER,
        employeeId: EMPLOYEE_WORKER,
        workDate,
        segments: [{ workMode: "wfh", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }], // 6h -> 1 day
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_WORKER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);
      await db.asUserCommit(USER_WORKER, (query) => query("select resolve_recovery_credit_project_lead($1, $2)", [requestId, EMPLOYEE_LEAD]));

      await db.asUser(USER_HR1, async (query) => {
        await expect(query("select adjust_recovery_credit_request($1, $2, 3, null, null)", [requestId, workDate])).rejects.toThrow(
          /A reason is required/,
        );
      });

      await db.asUserCommit(USER_HR1, (query) => query("select adjust_recovery_credit_request($1, $2, 3, 'Overstated hours', 'Confirmed with lead')", [requestId, workDate]));
      const after = await db.seed(
        `select proposed_days, checked_with, corrected_by is not null as was_corrected from recovery_credit_requests where id = '${requestId}'`,
      );
      expect(after.rows).toEqual([{ proposed_days: "0.5", checked_with: "Confirmed with lead", was_corrected: true }]);
    });

    it("refuses to adjust a request that has already been decided", async () => {
      const workDate = "2027-08-21"; // Saturday
      await seedDayAndSync(db, {
        employeeUserId: USER_MANAGER,
        employeeId: EMPLOYEE_MANAGER,
        workDate,
        segments: [{ workMode: "office", startUtc: `${workDate}T04:00:00Z`, endUtc: `${workDate}T10:00:00Z` }],
      });
      const requestId = await db
        .seed(`select id from recovery_credit_requests where employee_id = '${EMPLOYEE_MANAGER}' and work_date = '${workDate}'`)
        .then((r) => r.rows[0].id as string);
      await db.asUserCommit(USER_HR1, (query) => query("select decide_recovery_credit_request($1, 'approved', 'Checked directly')", [requestId]));

      await db.asUser(USER_HR1, async (query) => {
        await expect(query("select adjust_recovery_credit_request($1, $2, 8, 'too late', null)", [requestId, workDate])).rejects.toThrow(
          /already been decided and can no longer be adjusted/,
        );
      });
    });
  });
});
