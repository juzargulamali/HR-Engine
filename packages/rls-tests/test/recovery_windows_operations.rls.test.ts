import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { COMPANY_AE, COMPANY_OTHER, H, createRecoveryFixtures, plusSeconds, type Person } from "../src/recoveryFixtures";

// Recovery windows — the background processor, HR alerts, who may see what,
// the automatic register and the dashboard read model. Controlled clock; see
// src/recoveryFixtures.ts.

const SAT = "2027-01-09T05:00:00Z";

describe("Recovery windows — processor, alerts, visibility, read models", () => {
  const db = new RlsTestDatabase();
  const fx = createRecoveryFixtures(db);
  const { setClock, newPerson, seedSessions, recalc, windows, requests, alerts } = fx;

  let hr1: Person;
  let hrOther: Person;
  let ceo: Person;
  let sysAdmin: Person;

  beforeAll(async () => {
    await db.setup();
    await fx.setupDatabase();
    hr1 = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    hrOther = await newPerson(COMPANY_OTHER, "AE", ["hr_admin"]);
    ceo = await newPerson(COMPANY_AE, "AE", ["ceo"]);
    sysAdmin = await newPerson(COMPANY_AE, "AE");
    await db.seed(`insert into user_roles (user_id, role) values ('${sysAdmin.userId}', 'sys_admin')`);
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  async function as<T>(person: Person | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.asUser(person?.userId ?? null, async (q) => (await q(sql, params)).rows as T[]);
  }
  async function asCommit<T>(person: Person, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.asUserCommit(person.userId, async (q) => (await q(sql, params)).rows as T[]);
  }
  async function rowsAffected(person: Person, sql: string, params: unknown[]): Promise<number> {
    return db.asUser(person.userId, async (q) => (await q(sql, params)).rowCount ?? 0);
  }
  async function fails(person: Person | null, sql: string, params: unknown[], pattern: RegExp) {
    await expect(db.asUser(person?.userId ?? null, async (q) => q(sql, params))).rejects.toThrow(pattern);
  }

  // ---------------------------------------------------------------------
  // Group 20 — processor authority, idempotency, observability, scheduler
  // ---------------------------------------------------------------------
  describe("protected background processor", () => {
    it("is not callable by signed-in users or the public — only the database owner / service role", async () => {
      await fails(hr1, "select recovery_process_due('x')", [], /permission denied for function recovery_process_due/);
      await fails(null, "select recovery_process_due('x')", [], /permission denied for function recovery_process_due/);
      await fails(hr1, "select recovery_recalculate_employee($1::uuid)", [hr1.employeeId], /permission denied for function recovery_recalculate_employee/);
      await fails(hr1, "select recovery_derive($1::uuid, now())", [hr1.employeeId], /permission denied for function recovery_derive/);
      await fails(hr1, "select user_has_role($1::uuid, 'hr_admin')", [hr1.userId], /permission denied for function user_has_role/);
    });

    it("runs under no HR identity: its audit rows carry origin 'processor' and no actor; HR corrections carry origin 'user' and the real HR actor", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 1 * H));
      await seedSessions(person, [{ start: SAT, end: null, lead: lead.employeeId, project: "P", mode: "site_work" }]);
      await recalc(person);
      await setClock(plusSeconds(SAT, 25 * H));
      const { rows } = await db.seed("select recovery_process_due('pg_cron') as r");
      expect(rows[0].r).toMatchObject({ status: "succeeded", failed: 0 });
      const [w] = await windows(person);
      expect(w!.status).toBe("closed");
      const { rows: audit } = await db.seed(`select origin, actor_id, action from audit_log where table_name = 'recovery_windows' and record_id = '${w!.id}' order by occurred_at, id`);
      const closing = audit.find((a) => a.action === "update");
      expect(closing).toMatchObject({ origin: "processor", actor_id: null });
      const [req] = await requests(person);
      expect(req!.created_by).toBe("00000000-0000-0000-0000-000000000000");
    });

    it("repeating or overlapping runs is safe (a second run in the same moment does nothing new)", async () => {
      const before = (await db.seed("select count(*)::int as n from recovery_credit_requests")).rows[0].n;
      await db.seed("select recovery_process_due('pg_cron')");
      await db.seed("select recovery_process_due('pg_cron')");
      expect((await db.seed("select count(*)::int as n from recovery_credit_requests")).rows[0].n).toBe(before);
    });

    it("a failure for one employee is recorded and visible, does not stop the others, and clears once it is fixed", async () => {
      const good = await newPerson(COMPANY_AE, "AE");
      const broken = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 2 * H));
      await seedSessions(good, [{ start: SAT, end: null }]);
      await recalc(good); // snapshot of the rules is taken for this period
      await seedSessions(broken, [{ start: SAT, end: null }]); // no period/snapshot yet
      // The policy goes away underneath the engine: a period with no stored snapshot can no longer be derived.
      await db.seed("update policy_versions set status = 'superseded' where country_code = 'AE' and payload ->> 'model' = 'recovery_windows'");
      await setClock(plusSeconds(SAT, 3 * H));
      const run = (await db.seed("select recovery_process_due('pg_cron') as r")).rows[0].r;
      expect(run.status).toBe("partial");
      expect(run.failed).toBe(1);
      const { rows: failures } = await db.seed(`select employee_id, error, resolved_at from recovery_processor_failures where employee_id = '${broken.employeeId}'`);
      expect(failures[0].error).toMatch(/No active Recovery Leave windows policy/);
      expect(failures[0].resolved_at).toBeNull();
      expect((await windows(good))[0]!.secs).toBe(3 * H); // the healthy employee was still processed

      const status = (await as<{ s: Record<string, unknown> }>(hr1, "select recovery_scheduler_status() as s"))[0]!.s;
      expect(status.open_failures).toBe(1);

      await db.seed(`begin; select set_config('app.recovery_policy_activation', 'on', true);
        update policy_versions set status = 'active' where country_code = 'AE' and payload ->> 'model' = 'recovery_windows'; commit;`);
      const run2 = (await db.seed("select recovery_process_due('pg_cron') as r")).rows[0].r;
      expect(run2.status).toBe("succeeded");
      const { rows: after } = await db.seed(`select resolved_at from recovery_processor_failures where employee_id = '${broken.employeeId}'`);
      expect(after.every((r) => r.resolved_at !== null)).toBe(true);
      expect((await windows(broken))[0]!.secs).toBe(3 * H);
    });

    it("reports scheduler health honestly: nothing run yet is stale, and pg_cron being absent is stated, not hidden", async () => {
      await db.seed("delete from recovery_processor_failures; delete from recovery_processor_runs"); // fresh view of the status function
      const at = (minutes: number) => plusSeconds(SAT, 3 * H + minutes * 60);
      await setClock(at(0));
      let s = (await as<{ s: Record<string, any> }>(hr1, "select recovery_scheduler_status() as s"))[0]!.s;
      expect(s.windows_policy_active).toBe(true);
      expect(s.last_run).toBeNull();
      expect(s.open_periods).toBeGreaterThan(0);
      expect(s.stale).toBe(true); // open periods exist and nothing has ever run
      expect(s.pg_cron_installed).toBe(false); // the isolated test database has no pg_cron
      expect(s.expected_interval_minutes).toBe(5);

      await db.seed("select recovery_process_due('pg_cron')");
      await setClock(at(5));
      s = (await as<{ s: Record<string, any> }>(hr1, "select recovery_scheduler_status() as s"))[0]!.s;
      expect(s.stale).toBe(false);
      expect(s.last_run.status).toBe("succeeded");
      await setClock(at(40));
      s = (await as<{ s: Record<string, any> }>(hr1, "select recovery_scheduler_status() as s"))[0]!.s;
      expect(s.stale).toBe(true); // 40 minutes without a successful run

      await fails(newPersonPlaceholder(), "select recovery_scheduler_status()", [], /Only HR Admin or Sys Admin/);
      expect((await as<{ s: unknown }>(sysAdmin, "select recovery_scheduler_status() as s")).length).toBe(1);
    });
  });

  // Needs an ordinary (no role) user; created lazily so the declaration above stays readable.
  let plain: Person | null = null;
  function newPersonPlaceholder(): Person {
    if (!plain) throw new Error("plain person not initialised");
    return plain;
  }
  beforeAll(async () => {
    plain = await fx.newPerson(COMPANY_AE, "AE");
  });

  // ---------------------------------------------------------------------
  // HR alerts — raised once, company-scoped, acknowledgeable, auditable
  // ---------------------------------------------------------------------
  describe("HR alerts", () => {
    async function longWorker() {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 22 * H));
      await seedSessions(person, [{ start: SAT, end: plusSeconds(SAT, 21 * H) }]);
      await recalc(person);
      return person;
    }

    it("a 20h+ stretch raises one open alert with the original start, worked and elapsed hours", async () => {
      const person = await longWorker();
      const a = await alerts(person, "long_work");
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ status: "open" });
      expect(a[0]!.triggered_at.toISOString()).toBe(plusSeconds(SAT, 20 * H));
      expect(a[0]!.recorded).toBe(21 * H);
      expect(a[0]!.elapsed).toBe(21 * H);
      const { rows } = await db.seed(`select period_started_at, details from recovery_alerts where employee_id = '${person.employeeId}'`);
      expect(rows[0].period_started_at.toISOString()).toBe(new Date(SAT).toISOString());
      expect(rows[0].details.threshold_hours).toBe(20);
    });

    it("is visible to HR Admin and the CEO of the company only — not the employee, a colleague or another company's HR", async () => {
      const person = await longWorker();
      const [alert] = await alerts(person, "long_work");
      expect(await as(hr1, "select id from recovery_alerts where id = $1", [alert!.id])).toHaveLength(1);
      expect(await as(ceo, "select id from recovery_alerts where id = $1", [alert!.id])).toHaveLength(1);
      expect(await as(person, "select id from recovery_alerts where id = $1", [alert!.id])).toHaveLength(0);
      expect(await as(newPersonPlaceholder(), "select id from recovery_alerts where id = $1", [alert!.id])).toHaveLength(0);
      expect(await as(hrOther, "select id from recovery_alerts where id = $1", [alert!.id])).toHaveLength(0);
    });

    it("can be acknowledged by that company's HR Admin, once, and the acknowledgement is audited", async () => {
      const person = await longWorker();
      const [alert] = await alerts(person, "long_work");
      await fails(hrOther, "select acknowledge_recovery_alert($1, 'x')", [alert!.id], /Only HR Admin may acknowledge/);
      await fails(person, "select acknowledge_recovery_alert($1, 'x')", [alert!.id], /Only HR Admin may acknowledge/);
      await asCommit(hr1, "select acknowledge_recovery_alert($1, 'Spoke with the employee; they were on a long install')", [alert!.id]);
      const { rows } = await db.seed(`select status, acknowledged_by, acknowledgement_note from recovery_alerts where id = '${alert!.id}'`);
      expect(rows[0]).toMatchObject({ status: "acknowledged", acknowledged_by: hr1.userId });
      await fails(hr1, "select acknowledge_recovery_alert($1, 'again')", [alert!.id], /no longer open/);
      const { rows: audit } = await db.seed(`select actor_id, origin, after_data ->> 'status' as s from audit_log where table_name = 'recovery_alerts' and record_id = '${alert!.id}' and action = 'update'`);
      expect(audit[0]).toMatchObject({ actor_id: hr1.userId, origin: "user", s: "acknowledged" });
      // acknowledging never stops a re-run from being idempotent
      await recalc(person);
      expect(await alerts(person, "long_work")).toHaveLength(1);
    });

    it("an alert whose condition was removed by a correction is marked obsolete instead of staying a false alarm", async () => {
      const person = await longWorker();
      const [{ id: sessionId }] = (await db.seed(`select id from attendance_sessions where employee_id = '${person.employeeId}'`)).rows;
      await asCommit(hr1, "select hr_correct_attendance_session($1, $2, $3, 'Left at 4pm, not 2am')", [sessionId, SAT, plusSeconds(SAT, 10 * H)]);
      expect((await alerts(person, "long_work"))[0]!.status).toBe("obsolete");
    });
  });

  // ---------------------------------------------------------------------
  // Group 21 — who may read evidence; nobody writes it directly
  // ---------------------------------------------------------------------
  describe("evidence visibility and direct-write protection", () => {
    it("the employee, their manager and HR see a window and its allocations; a colleague, another company's HR and the public do not; the named project lead sees only their window", async () => {
      const manager = await newPerson(COMPANY_AE, "AE", ["line_manager"]);
      const lead = await newPerson(COMPANY_AE, "AE");
      const person = await newPerson(COMPANY_AE, "AE");
      await db.seed(`update employees set manager_id = '${manager.employeeId}' where id = '${person.employeeId}'`);
      await setClock(plusSeconds(SAT, 20 * H));
      await seedSessions(person, [{ start: SAT, end: plusSeconds(SAT, 6 * H), lead: lead.employeeId, project: "P", mode: "site_work" }]);
      await recalc(person);
      const [w] = await windows(person);
      const q = "select id from recovery_windows where id = $1";
      for (const viewer of [person, manager, hr1, ceo, lead]) expect(await as(viewer, q, [w!.id])).toHaveLength(1);
      for (const viewer of [newPersonPlaceholder(), hrOther]) expect(await as(viewer, q, [w!.id])).toHaveLength(0);
      expect(await as(null, q, [w!.id]).catch(() => [])).toHaveLength(0);
      const alloc = "select id from recovery_window_allocations where window_id = $1";
      for (const viewer of [person, manager, hr1, lead]) expect((await as(viewer, alloc, [w!.id])).length).toBeGreaterThan(0);
      expect(await as(newPersonPlaceholder(), alloc, [w!.id])).toHaveLength(0);
      expect(await as(person, "select id from recovery_periods where employee_id = $1", [person.employeeId])).toHaveLength(1);
      expect(await as(lead, "select id from recovery_periods where employee_id = $1", [person.employeeId])).toHaveLength(0);
    });

    it("nobody can write these tables directly, including HR Admin", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock(plusSeconds(SAT, 20 * H));
      await seedSessions(person, [{ start: SAT, end: plusSeconds(SAT, 6 * H) }]);
      await recalc(person);
      const [w] = await windows(person);
      for (const who of [hr1, person, ceo]) {
        // No INSERT/UPDATE/DELETE policy exists, so row-level security leaves nothing to touch
        // (in Production the write privileges are also revoked outright — see the migration).
        expect(await rowsAffected(who, "update recovery_windows set entitlement_days = 1 where id = $1", [w!.id])).toBe(0);
        expect(await rowsAffected(who, "delete from recovery_windows where id = $1", [w!.id])).toBe(0);
        expect(await rowsAffected(who, "update recovery_alerts set status = 'acknowledged'", [])).toBe(0);
        expect(await rowsAffected(who, "update recovery_window_allocations set seconds = 1", [])).toBe(0);
        await fails(who, "insert into recovery_periods (employee_id, company_id, country_code, timezone, policy_version_id, rules, started_at, last_work_end_at, has_open_session, status) select employee_id, company_id, country_code, timezone, policy_version_id, rules, now(), now(), false, 'ended' from recovery_periods limit 1", [], /row-level security|permission denied/);
      }
      expect(await as(hr1, "select * from recovery_processor_runs")).toHaveLength(0); // deny-all table: no policy at all
    });

    it("clock sessions can no longer be forged into the future or overlapped through a direct insert", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await setClock("2027-01-12T00:00:00Z");
      await expect(
        db.seed(`insert into attendance_sessions (employee_id, clock_in_at, clock_out_at, status) values ('${person.employeeId}', '2027-01-13T00:00:00Z', '2027-01-13T05:00:00Z', 'closed')`),
      ).rejects.toThrow(/cannot be in the future/);
    });
  });

  // ---------------------------------------------------------------------
  // Group 19 — the automatic register and the dashboard status
  // ---------------------------------------------------------------------
  describe("read-first register and dashboard status", () => {
    const DAY = "2027-01-12"; // Tuesday
    const NOW = "2027-01-12T10:00:00Z"; // 14:00 Dubai

    it("derives clock state from real sessions, keeps Present after clock-out, and never infers an absence", async () => {
      const clockedIn = await newPerson(COMPANY_AE, "AE");
      const clockedOut = await newPerson(COMPANY_AE, "AE");
      const mixed = await newPerson(COMPANY_AE, "AE");
      const nothing = await newPerson(COMPANY_AE, "AE");
      const hrRecorded = await newPerson(COMPANY_AE, "AE");
      const manual = await newPerson(COMPANY_AE, "AE");
      const lead = await newPerson(COMPANY_AE, "AE");
      await setClock(NOW);
      await seedSessions(clockedIn, [{ start: "2027-01-12T06:00:00Z", end: null, lead: lead.employeeId, project: "P", mode: "site_work" }]);
      await seedSessions(clockedOut, [{ start: "2027-01-12T05:00:00Z", end: "2027-01-12T09:00:00Z" }]);
      await seedSessions(mixed, [
        { start: "2027-01-12T05:00:00Z", end: "2027-01-12T07:00:00Z", mode: "office" },
        { start: "2027-01-12T07:30:00Z", end: "2027-01-12T09:30:00Z", mode: "wfh" },
      ]);
      await seedSessions(hrRecorded, [{ start: "2027-01-12T05:00:00Z", end: "2027-01-12T08:00:00Z", byHr: true }]);
      await db.seed(`insert into attendance_records (employee_id, work_date, status, source, hours_worked) values ('${manual.employeeId}', '${DAY}', 'present', 'manual', 8)`);
      for (const p of [clockedIn, clockedOut, mixed, hrRecorded]) await recalc(p);
      for (const p of [clockedIn, clockedOut, mixed, hrRecorded]) await db.seed(`select sync_attendance_presence_for_day('${p.employeeId}', '${DAY}')`);

      const rows = await as<Record<string, any>>(hr1, "select * from attendance_register_for_date($1, $2)", [COMPANY_AE, DAY]);
      const byId = new Map(rows.map((r) => [r.employee_id, r]));

      expect(byId.get(clockedIn.employeeId)).toMatchObject({ clock_status: "clocked_in", attendance_status: "present", is_provisional: true });
      expect(Number(byId.get(clockedIn.employeeId)!.recorded_seconds)).toBe(4 * H); // 06:00 -> 10:00, provisional, live
      expect(byId.get(clockedIn.employeeId)!.work_modes).toEqual(["site_work"]);

      expect(byId.get(clockedOut.employeeId)).toMatchObject({ clock_status: "clocked_out", attendance_status: "present", is_provisional: false });
      expect(Number(byId.get(clockedOut.employeeId)!.recorded_seconds)).toBe(4 * H);
      expect(new Date(byId.get(clockedOut.employeeId)!.last_clock_out).toISOString()).toBe("2027-01-12T09:00:00.000Z");

      expect(byId.get(mixed.employeeId)!.work_modes.sort()).toEqual(["office", "wfh"]); // every mode shown
      expect(byId.get(mixed.employeeId)!.session_count).toBe(2);
      expect(Number(byId.get(mixed.employeeId)!.recorded_seconds)).toBe(4 * H); // the 30-minute clocked-out gap is excluded

      expect(byId.get(nothing.employeeId)).toMatchObject({ clock_status: "not_started", attendance_status: "not_recorded" });
      expect(Number(byId.get(nothing.employeeId)!.recorded_seconds)).toBe(0);

      // HR-recorded evidence is clearly marked and never looks like a live Clocked-in state.
      expect(byId.get(hrRecorded.employeeId)).toMatchObject({ clock_status: "clocked_out", hr_recorded: true });

      // The manual register entry stays the day's attendance record, with its own hours.
      expect(byId.get(manual.employeeId)).toMatchObject({ attendance_status: "present", attendance_source: "manual", clock_status: "not_started" });
      expect(Number(byId.get(manual.employeeId)!.manual_hours)).toBe(8);
    });

    it("a date in the future never shows anyone as clocked in", async () => {
      const rows = await as<Record<string, any>>(hr1, "select * from attendance_register_for_date($1, '2099-01-01')", [COMPANY_AE]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.clock_status === "not_started")).toBe(true);
    });

    it("a person with approved leave that day is flagged on the register without any clock evidence being altered", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      await db.seed(`begin; set local session_replication_role = replica;
        insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days, status) values ('${person.employeeId}', 'annual', '${DAY}', '${DAY}', 1, 'approved');
        commit;`);
      const rows = await as<Record<string, any>>(hr1, "select * from attendance_register_for_date($1, $2)", [COMPANY_AE, DAY]);
      expect(rows.find((r) => r.employee_id === person.employeeId)).toMatchObject({ on_leave: true, clock_status: "not_started" });
    });

    it("a colleague's register shows no clock evidence for other people, and another company's HR sees nothing of this company", async () => {
      const rows = await as<Record<string, any>>(newPersonPlaceholder(), "select * from attendance_register_for_date($1, $2)", [COMPANY_AE, DAY]);
      expect(rows.every((r) => r.clock_status === "not_started" || r.employee_id === plain!.employeeId)).toBe(true);
      const other = await as<Record<string, any>>(hrOther, "select * from attendance_register_for_date($1, $2)", [COMPANY_AE, DAY]);
      expect(other.every((r) => r.clock_status === "not_started")).toBe(true);
    });

    it("the dashboard summary shows status, mode, start, recorded hours in the current window, the original period start and provisional recovery — never a balance", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      const lead = await newPerson(COMPANY_AE, "AE");
      await setClock("2027-01-09T23:00:00Z"); // Sat 27:00 Dubai... 18h after the start
      await seedSessions(person, [{ start: SAT, end: null, lead: lead.employeeId, project: "Tower", mode: "site_work" }]);
      await recalc(person);
      const s = (await as<{ s: Record<string, any> }>(person, "select recovery_live_summary($1) as s", [person.employeeId]))[0]!.s;
      expect(s).toMatchObject({ linked: true, clock_status: "clocked_in", work_mode: "site_work", project_name: "Tower", windowed: true, timezone: "Asia/Dubai" });
      expect(new Date(s.open_since).toISOString()).toBe(new Date(SAT).toISOString());
      expect(s.period.recorded_seconds).toBe(18 * H);
      expect(new Date(s.period.started_at).toISOString()).toBe(new Date(SAT).toISOString());
      expect(s.period.long_work_warning).toBe(false);
      expect(s.window).toMatchObject({ index: 1, closed: false, classification: "rest_day", entitlement_days: 1, request_status: null });
      expect(s).not.toHaveProperty("balance");

      await setClock("2027-01-10T02:00:00Z"); // 21h in: the 20h warning is active
      const warn = (await as<{ s: Record<string, any> }>(person, "select recovery_live_summary($1) as s", [person.employeeId]))[0]!.s;
      expect(warn.period.long_work_warning).toBe(true);

      await setClock("2027-01-10T07:00:00Z"); // 26h in: rolled over automatically
      const rolled = (await as<{ s: Record<string, any> }>(person, "select recovery_live_summary($1) as s", [person.employeeId]))[0]!.s;
      expect(rolled.period.rollover_count).toBe(1);
      expect(rolled.window.index).toBe(2);
      expect(rolled.window.recorded_seconds).toBe(2 * H);
    });

    it("who may read the dashboard summary: the employee, their manager and HR — not a colleague or another company's HR", async () => {
      const person = await newPerson(COMPANY_AE, "AE");
      for (const viewer of [person, hr1]) expect(await as(viewer, "select recovery_live_summary($1) as s", [person.employeeId])).toHaveLength(1);
      await fails(newPersonPlaceholder(), "select recovery_live_summary($1)", [person.employeeId], /may not view/);
      await fails(hrOther, "select recovery_live_summary($1)", [person.employeeId], /may not view/);
      const empty = (await as<{ s: Record<string, any> }>(person, "select recovery_live_summary($1) as s", [person.employeeId]))[0]!.s;
      expect(empty).toMatchObject({ clock_status: "not_started", windowed: false, period: null, window: null }); // neutral, not a fabricated red state
    });
  });
});
