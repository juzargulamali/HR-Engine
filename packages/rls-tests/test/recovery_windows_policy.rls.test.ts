import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_RECOVERY_WINDOW_RULES, recoveryWindowRulesToPayload, renderRecoveryWindowPolicyWording } from "../../domain/src/recoveryWindows";
import { RlsTestDatabase } from "../src/harness";

// Recovery Leave windows — policy lifecycle: next-version DRAFT creation without
// touching the active V2, generated wording, controlled activation (no SQL
// shortcut), in-flight sessions at activation, and period snapshots.
//
// This suite uses its OWN database with NO windows policy active, the way
// Production is the moment the migration is applied: nothing here may change
// how anything is calculated until activate_recovery_windows_policy() runs.

const COMPANY = "00000000-0000-0000-0000-0000000f0a01";
const SAT = "2027-01-16"; // a Saturday

describe("Recovery windows — policy drafts, wording, controlled activation", () => {
  const db = new RlsTestDatabase();
  let seq = 0;

  const policyHr1 = randomUUID(); // company-UNSCOPED HR Admin (may draft/activate country policy)
  const policyHr2 = randomUUID();
  const companyHr = randomUUID(); // HR Admin of ONE company only
  const ceoUser = randomUUID();
  const workerUser = randomUUID();
  const workerEmployee = randomUUID();

  async function setClock(at: string | null) {
    await db.seed(
      at === null
        ? "create or replace function recovery_now() returns timestamptz language sql stable as $$ select now() $$"
        : `create or replace function recovery_now() returns timestamptz language sql stable as $$ select '${at}'::timestamptz $$`,
    );
  }
  async function person(country = "AE", roles: string[] = []) {
    seq += 1;
    const userId = randomUUID();
    const employeeId = randomUUID();
    await db.seed(`
      insert into auth.users (id, email) values ('${userId}', 'pol-${seq}-${userId.slice(0, 5)}@enginious.ae');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('${employeeId}', '${userId}', 'PL-${seq}-${employeeId.slice(0, 4)}', '${COMPANY}', '${country}', 'P${seq}', 'Tester', '2024-01-01');
      ${roles.map((r) => `insert into user_roles (user_id, role, company_id) values ('${userId}', '${r}', '${COMPANY}');`).join("\n")}`);
    return { userId, employeeId };
  }
  // pg_cron does not exist in the throwaway database, so the scheduler gate is exercised against a stub
  // cron.job table plus real recovery_processor_runs rows — the gate function itself is the production one.
  async function markSchedulerReady() {
    await db.seed(`
      create schema if not exists cron;
      create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);
      insert into cron.job (jobname, schedule, command, active)
        select 'recovery-window-processor', '*/5 * * * *', 'select public.recovery_process_due(''pg_cron'')', true
        where not exists (select 1 from cron.job where jobname = 'recovery-window-processor');
      insert into recovery_processor_runs (origin, as_of, started_at, finished_at, status, employees_examined, employees_failed)
        values ('pg_cron', recovery_now(), recovery_now(), recovery_now(), 'succeeded', 0, 0);`);
  }
  async function asCommit<T>(userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.asUserCommit(userId, async (q) => (await q(sql, params)).rows as T[]);
  }
  async function fails(userId: string, sql: string, params: unknown[], pattern: RegExp) {
    await expect(db.asUserCommit(userId, async (q) => q(sql, params))).rejects.toThrow(pattern);
  }
  async function overtimeVersions(country: string) {
    const { rows } = await db.seed(
      `select id, version_no, status, effective_from::text as effective_from, effective_to::text as effective_to, payload, created_by, activation_record
       from policy_versions where country_code = '${country}' and policy_type = 'overtime_rules' order by version_no`,
    );
    return rows as Array<{ id: string; version_no: number; status: string; effective_from: string; effective_to: string | null; payload: Record<string, any>; created_by: string; activation_record: Record<string, any> | null }>;
  }

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      update countries set working_weekdays = array[1,2,3,4,5] where code in ('AE', 'PL');
      update countries set working_weekdays = array[0,1,2,3,4] where code = 'SA';
      insert into companies (id, legal_name, country_code, default_currency) values ('${COMPANY}', 'Policy Co', 'AE', 'AED');
      insert into auth.users (id, email) values
        ('${policyHr1}', 'pol-hr1@enginious.ae'), ('${policyHr2}', 'pol-hr2@enginious.ae'),
        ('${companyHr}', 'pol-companyhr@enginious.ae'), ('${ceoUser}', 'pol-ceo@enginious.ae'), ('${workerUser}', 'pol-worker@enginious.ae');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${workerEmployee}', '${workerUser}', 'PW-1', '${COMPANY}', 'AE', 'Wally', 'Worker', '2024-01-01');
      insert into user_roles (user_id, role) values ('${policyHr1}', 'hr_admin'), ('${policyHr2}', 'hr_admin');
      insert into user_roles (user_id, role, company_id) values ('${companyHr}', 'hr_admin', '${COMPANY}'), ('${ceoUser}', 'ceo', '${COMPANY}');
      -- The currently ACTIVE Recovery Leave version in Production: the V2 same-day / 4-hour policy.
      insert into policy_versions (country_code, policy_type, version_no, effective_from, status, created_by, payload)
      select c, 'overtime_rules', 2, '2026-01-01', 'active', '00000000-0000-0000-0000-000000000000',
        jsonb_build_object('phase2b_seed_marker', 'leave_policy_configuration', 'policy_name', 'Enginious Recovery Leave',
          'wording', 'Recovery Leave is a time-off benefit.', 'standard_threshold_hours', 4, 'expiry_days', 180)
      from unnest(array['AE', 'SA', 'PL']) c;`);
    await setClock("2027-01-01T08:00:00Z");
  }, 60_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("drafting the next version", () => {
    it("cannot be run from the SQL editor (no signed-in HR Admin), by a single-company HR Admin, or by anyone else", async () => {
      await expect(db.seed("select * from seed_recovery_windows_policy_drafts()")).rejects.toThrow(/must be called by an authenticated HR Admin/);
      await fails(companyHr, "select * from seed_recovery_windows_policy_drafts()", [], /company-unscoped HR Admin/);
      await fails(workerUser, "select * from seed_recovery_windows_policy_drafts()", [], /company-unscoped HR Admin/);
      await fails(ceoUser, "select * from seed_recovery_windows_policy_drafts()", [], /company-unscoped HR Admin/);
      for (const c of ["AE", "SA", "PL"]) expect(await overtimeVersions(c)).toHaveLength(1); // nothing was created by the refusals
    });

    it("creates the NEXT available version as a DRAFT for UAE, Saudi Arabia and Poland, and leaves the active V2 exactly as it was", async () => {
      const before = Object.fromEntries(await Promise.all(["AE", "SA", "PL"].map(async (c) => [c, (await overtimeVersions(c))[0]!])));
      const rows = await asCommit<{ country_code: string; version_no: number; action: string }>(policyHr1, "select * from seed_recovery_windows_policy_drafts()");
      expect(rows.map((r) => [r.country_code, r.version_no, r.action]).sort()).toEqual([["AE", 3, "created"], ["PL", 3, "created"], ["SA", 3, "created"]]);
      for (const c of ["AE", "SA", "PL"]) {
        const [v2, v3] = await overtimeVersions(c);
        expect(v2).toEqual(before[c]); // V2: same status, same dates, same payload, untouched
        expect(v2!.status).toBe("active");
        expect(v3).toMatchObject({ version_no: 3, status: "draft", created_by: policyHr1 });
        expect(v3!.payload.model).toBe("recovery_windows");
        expect(v3!.payload.rules).toEqual(recoveryWindowRulesToPayload(DEFAULT_RECOVERY_WINDOW_RULES)); // machine-readable bands, 9h, 8h rest, 20h alert, 24h, 1 day cap, 180 days
        expect(v3!.payload.eligible_work_modes).toEqual(["office", "wfh", "site_work", "client_meeting"]);
        expect(v3!.payload.business_travel).toBe("recorded_and_hr_reviewed");
        expect(v3!.payload.cash_conversion).toBe(false);
        expect(v3!.payload.statutory_safeguard).toMatch(/Where applicable employment law mandates/); // statutory wording retained
        expect(v3!.activation_record).toBeNull();
      }
    });

    it("is safe to repeat: a second call creates nothing", async () => {
      const rows = await asCommit<{ action: string }>(policyHr2, "select * from seed_recovery_windows_policy_drafts()");
      expect(rows.every((r) => r.action === "skipped_already_seeded")).toBe(true);
      expect(await overtimeVersions("AE")).toHaveLength(2);
    });

    it("the wording is GENERATED from the machine rules — identical to the application's own renderer — and cannot be typed over", async () => {
      const [, v3] = await overtimeVersions("AE");
      expect(v3!.payload.wording).toBe(renderRecoveryWindowPolicyWording(DEFAULT_RECOVERY_WINDOW_RULES));
      // HR tries to save hand-written wording that disagrees with the rules:
      await asCommit(policyHr1, `update policy_versions set payload = jsonb_set(payload, '{wording}', '"Everything counts double."') where id = $1`, [v3!.id]);
      expect((await overtimeVersions("AE"))[1]!.payload.wording).toBe(renderRecoveryWindowPolicyWording(DEFAULT_RECOVERY_WINDOW_RULES));
    });

    it("changing a number changes the wording with it; an incoherent set of rules is refused in plain English", async () => {
      const [, v3] = await overtimeVersions("PL");
      const changed = { ...DEFAULT_RECOVERY_WINDOW_RULES, normalDay: { zeroMaxHours: 12, halfMaxHours: 17 } };
      await asCommit(policyHr1, "update policy_versions set payload = jsonb_set(payload, '{rules}', $2::jsonb) where id = $1", [v3!.id, JSON.stringify(recoveryWindowRulesToPayload(changed))]);
      expect((await overtimeVersions("PL"))[1]!.payload.wording).toBe(renderRecoveryWindowPolicyWording(changed));
      expect((await overtimeVersions("PL"))[1]!.payload.wording).toContain("up to and including 12 recorded hours earns nothing");

      const broken = { ...recoveryWindowRulesToPayload(DEFAULT_RECOVERY_WINDOW_RULES), normal_day: { zero_max_hours: 17, half_max_hours: 13 } };
      await fails(policyHr1, "update policy_versions set payload = jsonb_set(payload, '{rules}', $2::jsonb) where id = $1", [v3!.id, JSON.stringify(broken)], /zero_max_hours must be less than normal_day.half_max_hours/);
      await fails(policyHr1, "update policy_versions set payload = jsonb_set(payload, '{rules,max_days_per_window}', '2') where id = $1", [v3!.id], /max_days_per_window must be exactly 1/);
      // put PL back to the defaults for the rest of the suite
      await asCommit(policyHr1, "update policy_versions set payload = jsonb_set(payload, '{rules}', $2::jsonb) where id = $1", [v3!.id, JSON.stringify(recoveryWindowRulesToPayload(DEFAULT_RECOVERY_WINDOW_RULES))]);
    });
  });

  describe("nothing changes until activation (dormant)", () => {
    it("a clock-in while only the draft exists stays on the legacy calculation, and the manual register still credits the old way", async () => {
      await setClock(null); // real now()
      const legacy = await person("AE");
      await db.asUserCommit(legacy.userId, async (q) => q("select clock_in('office', null, null, null)"));
      const { rows } = await db.seed(`select recovery_model from attendance_sessions where employee_id = '${legacy.employeeId}'`);
      expect(rows[0].recovery_model).toBe("legacy");
      const { rows: periods } = await db.seed("select count(*)::int as n from recovery_periods");
      expect(periods[0].n).toBe(0);
      await db.asUserCommit(legacy.userId, async (q) => q("select clock_out(null)"));

      const hr = await person("AE", ["hr_admin"]);
      const emp = await person("AE");
      const res = await db.asUserCommit(hr.userId, async (q) =>
        q("select * from record_attendance_and_recovery('2027-01-16', $1::jsonb)", [JSON.stringify([{ employee_id: emp.employeeId, status: "present", work_mode: "office", hours_worked: 8 }])]),
      );
      expect(res.rows[0]).toMatchObject({ credited: true }); // the legacy 4-hour rule: > 4h on a weekend = 1 day, unchanged
      const { rows: legacyReq } = await db.seed(`select event_type, proposed_days::float8 as d from recovery_credit_requests where employee_id = '${emp.employeeId}'`);
      expect(legacyReq).toEqual([{ event_type: "standard", d: 1 }]);
    });
  });

  describe("controlled activation (no SQL shortcut)", () => {
    let aeV3: string;
    beforeAll(async () => {
      aeV3 = (await overtimeVersions("AE"))[1]!.id;
    });

    it("a plain status update — the old activation path — is refused for a windows policy, even for HR Admin", async () => {
      await fails(policyHr2, "update policy_versions set status = 'active' where id = $1", [aeV3], /only through activate_recovery_windows_policy/);
      await expect(db.seed(`update policy_versions set status = 'active' where id = '${aeV3}'`)).rejects.toThrow(/only through activate_recovery_windows_policy/); // not even from the SQL editor
      expect((await overtimeVersions("AE"))[1]!.status).toBe("draft");
    });

    it("refuses: the drafter, a single-company HR Admin, a single-company CEO, a retroactive/today date, a missing date, and a non-windows policy", async () => {
      await setClock("2027-01-01T08:00:00Z");
      await fails(policyHr1, "select activate_recovery_windows_policy($1, '2027-01-10')", [aeV3], /someone other than who drafted/);
      await fails(companyHr, "select activate_recovery_windows_policy($1, '2027-01-10')", [aeV3], /company-unscoped HR Admin/);
      await fails(ceoUser, "select activate_recovery_windows_policy($1, '2027-01-10')", [aeV3], /company-unscoped HR Admin, CEO or CTO/); // a CEO limited to one company is not enough either
      await fails(workerUser, "select activate_recovery_windows_policy($1, '2027-01-10')", [aeV3], /company-unscoped HR Admin/);
      await fails(policyHr2, "select activate_recovery_windows_policy($1, '2027-01-01')", [aeV3], /must be after today/); // today in Dubai
      await fails(policyHr2, "select activate_recovery_windows_policy($1, '2026-12-01')", [aeV3], /must be after today/);
      await fails(policyHr2, "select activate_recovery_windows_policy($1, null)", [aeV3], /must be after today/);
      const v2 = (await overtimeVersions("AE"))[0]!;
      await fails(policyHr2, "select activate_recovery_windows_policy($1, '2027-01-10')", [v2.id], /not a Recovery Leave windows policy/);
      expect((await overtimeVersions("AE"))[1]!.status).toBe("draft");
    });

    it("refuses until the 5-minute processor is VERIFIED running: pg_cron installed, job scheduled and active, and a recent successful run started by it", async () => {
      await setClock("2027-01-01T08:00:00Z");
      const activate = "select activate_recovery_windows_policy($1, '2027-01-10')";
      await fails(policyHr2, activate, [aeV3], /pg_cron is not installed/);
      await db.seed("create schema cron; create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text, active boolean default true);");
      await fails(policyHr2, activate, [aeV3], /recovery-window-processor job is not scheduled/);
      await db.seed("insert into cron.job (jobname, schedule, command, active) values ('recovery-window-processor', '*/5 * * * *', 'select 1', false)");
      await fails(policyHr2, activate, [aeV3], /not active/);
      await db.seed("update cron.job set active = true");
      await fails(policyHr2, activate, [aeV3], /does not call recovery_process_due/);
      await db.seed("update cron.job set command = 'select public.recovery_process_due(''pg_cron'')'");
      await fails(policyHr2, activate, [aeV3], /no successful run started by pg_cron/);
      // a daily Vercel run, a FAILED pg_cron run and a STALE pg_cron run are not verification
      await db.seed(`insert into recovery_processor_runs (origin, as_of, started_at, finished_at, status, employees_examined, employees_failed) values
        ('vercel_cron', recovery_now(), recovery_now(), recovery_now(), 'succeeded', 0, 0),
        ('pg_cron', recovery_now(), recovery_now(), recovery_now(), 'failed', 1, 1),
        ('pg_cron', recovery_now() - interval '16 minutes', recovery_now() - interval '16 minutes', recovery_now() - interval '16 minutes', 'succeeded', 0, 0)`);
      await fails(policyHr2, activate, [aeV3], /older than 15 minutes/);
      expect((await overtimeVersions("AE"))[1]!.status).toBe("draft"); // every refusal changed nothing
      expect((await overtimeVersions("AE"))[0]!).toMatchObject({ status: "active", effective_to: null });
      // the HR status read shows the same verdict
      const status = (await asCommit<{ s: any }>(policyHr2, "select recovery_scheduler_status() as s"))[0]!.s;
      expect(status.scheduler_ready.ready).toBe(false);
      expect(status.database_fingerprint).toMatch(/^[0-9a-f]{8}$/);
      await markSchedulerReady();
      const ready = (await asCommit<{ s: any }>(policyHr2, "select recovery_scheduler_status() as s"))[0]!.s;
      expect(ready.scheduler_ready.ready).toBe(true);
    });

    it("activates a future-dated version: V2 ends the day before (never edited otherwise), nothing overlaps, and who/when/which date is recorded", async () => {
      await markSchedulerReady();
      const v2Before = (await overtimeVersions("AE"))[0]!;
      await asCommit(policyHr2, "select activate_recovery_windows_policy($1, '2027-01-10')", [aeV3]);
      const [v2, v3] = await overtimeVersions("AE");
      expect(v2).toMatchObject({ status: "active", effective_to: "2027-01-09", payload: v2Before.payload, effective_from: v2Before.effective_from });
      expect(v3).toMatchObject({ status: "active", effective_from: "2027-01-10", effective_to: null });
      expect(v3!.activation_record).toMatchObject({ activated_by: policyHr2, effective_from: "2027-01-10", supersedes_version_no: 2, supersedes_ended_on: "2027-01-09" });
      // resolve_policy (the one resolver everything else uses) gives V2 up to the day before and V3 from the effective date.
      const { rows } = await db.seed(`select (resolve_policy('AE', 'overtime_rules', '2027-01-09') ->> 'phase2b_seed_marker') as before, (resolve_policy('AE', 'overtime_rules', '2027-01-10') ->> 'model') as after`);
      expect(rows[0]).toEqual({ before: "leave_policy_configuration", after: "recovery_windows" });
      await fails(policyHr2, "select activate_recovery_windows_policy($1, '2027-01-20')", [aeV3], /Only a draft version/);
    });

    it("countries are independent: activating AE changes nothing for SA or Poland", async () => {
      for (const c of ["SA", "PL"]) {
        const [v2, v3] = await overtimeVersions(c);
        expect(v2).toMatchObject({ status: "active", effective_to: null });
        expect(v3).toMatchObject({ status: "draft" });
      }
    });
  });

  describe("sessions in flight at the effective point, and period snapshots", () => {
    it("a session that started before the effective date finishes under the legacy rules; the first clock-in on/after it is windowed", async () => {
      // The employee clocked in BEFORE the effective date (legacy) and is still open on it.
      const inFlight = await person("AE");
      await setClock("2027-01-09T11:00:00Z"); // 15:00 on 2027-01-09 in Dubai: the day BEFORE the effective date
      await db.seed(`insert into attendance_sessions (id, employee_id, clock_in_at, status) values ('${randomUUID()}', '${inFlight.employeeId}', '2027-01-09T10:00:00Z', 'open');`);
      const { rows } = await db.seed(`select recovery_model from attendance_sessions where employee_id = '${inFlight.employeeId}'`);
      expect(rows).toEqual([{ recovery_model: "legacy" }]);

      await setClock("2027-01-11T12:00:00Z"); // after the effective date
      const fresh = await person("AE");
      await db.seed(`
        begin; select set_config('recovery.defer', 'on', true);
        insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status) values ('${randomUUID()}', '${fresh.employeeId}', '2027-01-10T05:00:00Z', '2027-01-10T09:00:00Z', 'closed');
        commit;`);
      expect((await db.seed(`select recovery_model from attendance_sessions where employee_id = '${fresh.employeeId}'`)).rows[0].recovery_model).toBe("windowed");
      // and the session that was already open stayed legacy even though it is still running on the effective date
      expect((await db.seed(`select recovery_model from attendance_sessions where employee_id = '${inFlight.employeeId}'`)).rows[0].recovery_model).toBe("legacy");
      expect((await db.seed(`select count(*)::int as n from recovery_periods where employee_id = '${inFlight.employeeId}'`)).rows[0].n).toBe(0);
    });

    it("after activation the manual register's typed totals never create a credit by themselves", async () => {
      const hr = await person("AE", ["hr_admin"]);
      const emp = await person("AE");
      await setClock("2027-01-11T12:00:00Z");
      const res = await db.asUserCommit(hr.userId, async (q) =>
        q("select * from record_attendance_and_recovery('2027-01-16', $1::jsonb)", [JSON.stringify([{ employee_id: emp.employeeId, status: "present", work_mode: "office", hours_worked: 8 }])]),
      );
      expect(res.rows[0]).toMatchObject({ credited: false, needs_policy_review: true });
    });

    it("a working period keeps the policy version and rules it started under, even when a newer version is activated mid-period; the next period uses the newer one", async () => {
      // A second windows version for AE with different numbers (zero_max 12 instead of 13).
      await setClock("2027-02-02T12:00:00Z");
      const v4 = randomUUID();
      const rules4 = recoveryWindowRulesToPayload({ ...DEFAULT_RECOVERY_WINDOW_RULES, normalDay: { zeroMaxHours: 12, halfMaxHours: 17 } });
      await asCommit(
        policyHr1,
        `insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
         values ($1, 'AE', 'overtime_rules', 4, '2027-02-05', 'draft', jsonb_build_object('model', 'recovery_windows', 'rules', $2::jsonb), '${policyHr1}')`,
        [v4, JSON.stringify(rules4)],
      );

      // A worker's period is open under V3 (starts 2027-02-02, a Tuesday).
      const worker = await person("AE");
      await db.seed(`
        begin; select set_config('recovery.defer', 'on', true);
        insert into attendance_sessions (id, employee_id, clock_in_at, status) values ('${randomUUID()}', '${worker.employeeId}', '2027-02-02T05:00:00Z', 'open');
        insert into attendance_segments (session_id, employee_id, work_mode, segment_start) select id, employee_id, 'office', clock_in_at from attendance_sessions where employee_id = '${worker.employeeId}';
        commit;`);
      await db.seed(`select recovery_recalculate_employee('${worker.employeeId}', null, 'test')`);
      const v3Id = (await overtimeVersions("AE"))[1]!.id;
      expect((await db.seed(`select policy_version_id from recovery_periods where employee_id = '${worker.employeeId}'`)).rows[0].policy_version_id).toBe(v3Id);

      await markSchedulerReady();
      await asCommit(policyHr2, "select activate_recovery_windows_policy($1, '2027-02-05')", [v4]);
      expect((await overtimeVersions("AE")).map((v) => [v.version_no, v.effective_to])).toEqual([[2, "2027-01-09"], [3, "2027-02-04"], [4, null]]);

      await setClock("2027-02-06T12:00:00Z"); // V4 is now in force; the open period (started under V3) is still running
      await db.seed(`select recovery_recalculate_employee('${worker.employeeId}', null, 'test')`);
      const { rows } = await db.seed(`select policy_version_id, rules -> 'normal_day' ->> 'zero_max_hours' as zero_max from recovery_periods where employee_id = '${worker.employeeId}'`);
      expect(rows).toEqual([{ policy_version_id: v3Id, zero_max: "13" }]); // snapshot unchanged

      // After a real rest the NEXT period is created under V4.
      await db.seed(`
        begin; select set_config('recovery.defer', 'on', true);
        update attendance_sessions set clock_out_at = '2027-02-02T15:00:00Z', status = 'closed' where employee_id = '${worker.employeeId}';
        update attendance_segments set segment_end = '2027-02-02T15:00:00Z' where employee_id = '${worker.employeeId}';
        insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status) values ('${randomUUID()}', '${worker.employeeId}', '2027-02-06T05:00:00Z', '2027-02-06T08:00:00Z', 'closed');
        insert into attendance_segments (session_id, employee_id, work_mode, segment_start, segment_end) select id, employee_id, 'office', clock_in_at, clock_out_at from attendance_sessions where employee_id = '${worker.employeeId}' and clock_in_at = '2027-02-06T05:00:00Z';
        commit;`);
      await db.seed(`select recovery_recalculate_employee('${worker.employeeId}', null, 'test')`);
      const { rows: both } = await db.seed(`select started_at::text, rules -> 'normal_day' ->> 'zero_max_hours' as zero_max from recovery_periods where employee_id = '${worker.employeeId}' order by started_at`);
      expect(both.map((r) => r.zero_max)).toEqual(["13", "12"]);
    });
  });

  describe("disabling (deactivate) without deleting anything", () => {
    it("ends the windows version on a future date, stamps later clock-ins legacy again, keeps every record, and re-drafts the earlier version for HR to reactivate", async () => {
      await setClock("2027-03-01T08:00:00Z");
      const [, v3, v4] = await overtimeVersions("AE");
      expect(v4!.status).toBe("active");
      const before = (await db.seed("select (select count(*) from recovery_periods)::int as periods, (select count(*) from attendance_sessions)::int as sessions")).rows[0];

      await fails(workerUser, "select deactivate_recovery_windows_policy($1, '2027-03-10')", [v4!.id], /company-unscoped HR Admin/);
      await fails(companyHr, "select deactivate_recovery_windows_policy($1, '2027-03-10')", [v4!.id], /company-unscoped HR Admin/);
      await fails(policyHr1, "select deactivate_recovery_windows_policy($1, '2027-03-01')", [v4!.id], /must be after today/);
      await fails(policyHr1, "select deactivate_recovery_windows_policy($1, '2027-03-10')", [v3!.id], /not an active Recovery Leave windows policy|already ends/);
      await asCommit(policyHr1, "select deactivate_recovery_windows_policy($1, '2027-03-10')", [v4!.id]);

      const versions = await overtimeVersions("AE");
      expect(versions.find((v) => v.id === v4!.id)).toMatchObject({ status: "active", effective_to: "2027-03-10" });
      expect(versions.find((v) => v.id === v4!.id)!.activation_record).toMatchObject({ deactivated_by: policyHr1, last_effective_date: "2027-03-10" });
      const redraft = versions[versions.length - 1]!;
      expect(redraft).toMatchObject({ status: "draft", effective_from: "2027-03-11", created_by: policyHr1 });
      expect(redraft.payload.model).toBe("recovery_windows"); // the earlier version (v3, itself a windows policy in this suite) is re-drafted verbatim

      // nothing was deleted or rewritten
      const after = (await db.seed("select (select count(*) from recovery_periods)::int as periods, (select count(*) from attendance_sessions)::int as sessions")).rows[0];
      expect(after).toEqual(before);

      // a clock-in AFTER the end date is a legacy session again; one on the last day is still windowed
      await setClock("2027-03-12T12:00:00Z");
      const late = await person("AE");
      await db.seed(`insert into attendance_sessions (employee_id, clock_in_at, clock_out_at, status) values ('${late.employeeId}', '2027-03-11T05:00:00Z', '2027-03-11T06:00:00Z', 'closed')`);
      expect((await db.seed(`select recovery_model from attendance_sessions where employee_id = '${late.employeeId}'`)).rows[0].recovery_model).toBe("legacy");
      const onLastDay = await person("AE");
      await db.seed(`insert into attendance_sessions (employee_id, clock_in_at, clock_out_at, status) values ('${onLastDay.employeeId}', '2027-03-10T05:00:00Z', '2027-03-10T06:00:00Z', 'closed')`);
      expect((await db.seed(`select recovery_model from attendance_sessions where employee_id = '${onLastDay.employeeId}'`)).rows[0].recovery_model).toBe("windowed");
    });
  });

  async function addSession(employeeId: string, start: string, end: string | null) {
    const id = randomUUID();
    await db.seed(`
      insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status)
        values ('${id}', '${employeeId}', '${start}', ${end ? `'${end}'` : "null"}, '${end ? "closed" : "open"}');
      insert into attendance_segments (session_id, employee_id, work_mode, segment_start, segment_end)
        values ('${id}', '${employeeId}', 'office', '${start}', ${end ? `'${end}'` : "null"});`);
    return id;
  }
  const modelOf = async (employeeId: string) =>
    (await db.seed(`select recovery_model from attendance_sessions where employee_id = '${employeeId}' order by clock_in_at`)).rows.map((r) => r.recovery_model as string);

  describe("continuity: a restart within the rest threshold keeps the period's policy across activation and deactivation", () => {
    // AE timeline built above: V2 (legacy) until 2027-01-09, V3 windows from 2027-01-10, V4 from 2027-02-05, ended 2027-03-10.
    beforeAll(async () => {
      await setClock("2027-03-12T12:00:00Z");
    });

    it("ACTIVATION: a legacy period is not split by the new policy — a restart less than 8h later stays legacy; exactly 8h later starts the first windowed period", async () => {
      const within = await person("AE");
      await addSession(within.employeeId, "2027-01-09T08:00:00Z", "2027-01-09T16:00:00Z"); // legacy day, ends 20:00 Dubai
      await addSession(within.employeeId, "2027-01-09T22:00:00Z", "2027-01-10T02:00:00Z"); // 6h later: 02:00 Dubai on the effective date
      expect(await modelOf(within.employeeId)).toEqual(["legacy", "legacy"]);
      await db.seed(`select recovery_recalculate_employee('${within.employeeId}', null, 'test')`);
      expect((await db.seed(`select count(*)::int as n from recovery_periods where employee_id = '${within.employeeId}'`)).rows[0].n).toBe(0); // no windowed period -> nothing can be awarded twice
      expect((await db.seed(`select count(*)::int as n from recovery_credit_requests where employee_id = '${within.employeeId}' and recovery_window_id is not null`)).rows[0].n).toBe(0);

      const justUnder = await person("AE");
      await addSession(justUnder.employeeId, "2027-01-09T08:00:00Z", "2027-01-09T16:00:00Z");
      await addSession(justUnder.employeeId, "2027-01-09T23:59:59Z", "2027-01-10T03:00:00Z"); // 7h 59m 59s later
      expect(await modelOf(justUnder.employeeId)).toEqual(["legacy", "legacy"]);

      const exactly8h = await person("AE");
      await addSession(exactly8h.employeeId, "2027-01-09T08:00:00Z", "2027-01-09T16:00:00Z");
      await addSession(exactly8h.employeeId, "2027-01-10T00:00:00Z", "2027-01-10T03:00:00Z"); // exactly 8h later: a new period, so the policy in force decides
      expect(await modelOf(exactly8h.employeeId)).toEqual(["legacy", "windowed"]);
    });

    it("DEACTIVATION: a windowed period that runs past the end date is not split — the restart stays windowed, ONE window, ONE award for the combined hours", async () => {
      const worker = await person("AE");
      const v4 = (await overtimeVersions("AE"))[2]!;
      await addSession(worker.employeeId, "2027-03-10T10:00:00Z", "2027-03-10T20:00:00Z"); // 10h on the last effective day (Dubai 14:00-00:00)
      await addSession(worker.employeeId, "2027-03-10T22:00:00Z", "2027-03-11T03:00:00Z"); // restarts 2h later, after the end date (02:00 Dubai on 11 March): 5h
      expect(await modelOf(worker.employeeId)).toEqual(["windowed", "windowed"]);
      await db.seed(`select recovery_recalculate_employee('${worker.employeeId}', null, 'test')`);

      const periods = (await db.seed(`select id, policy_version_id, status from recovery_periods where employee_id = '${worker.employeeId}' and status <> 'superseded'`)).rows;
      expect(periods).toHaveLength(1);
      expect(periods[0].policy_version_id).toBe(v4.id); // the rules it started under, although V4 has ended
      const windows = (await db.seed(`select recorded_seconds::float8 as rs, entitlement_days::float8 as d, starting_local_date::text as sd from recovery_windows where employee_id = '${worker.employeeId}'`)).rows;
      expect(windows).toEqual([{ rs: 15 * 3600, d: 0.5, sd: "2027-03-10" }]); // 15h in one window = half a day, judged once
      const reqs = (await db.seed(`select event_type, proposed_days::float8 as d from recovery_credit_requests where employee_id = '${worker.employeeId}' and status not in ('cancelled', 'rejected')`)).rows;
      expect(reqs).toEqual([{ event_type: "window", d: 0.5 }]);

      // exactly 8h after the last work, the period ends and the policy status decides: a legacy session
      const rested = await person("AE");
      await addSession(rested.employeeId, "2027-03-10T10:00:00Z", "2027-03-10T14:00:00Z");
      await addSession(rested.employeeId, "2027-03-10T22:00:00Z", "2027-03-11T01:00:00Z");
      const under = await person("AE");
      await addSession(under.employeeId, "2027-03-10T10:00:00Z", "2027-03-10T14:00:00Z");
      await addSession(under.employeeId, "2027-03-10T21:59:59Z", "2027-03-11T01:00:00Z");
      expect(await modelOf(rested.employeeId)).toEqual(["windowed", "legacy"]);
      expect(await modelOf(under.employeeId)).toEqual(["windowed", "windowed"]);
    });

    it("a retroactive HR entry that sits within 8h of a windowed session joins that period instead of being judged by the old rules, and no work is dropped", async () => {
      const worker = await person("AE");
      await addSession(worker.employeeId, "2027-01-09T22:00:00Z", "2027-01-09T23:30:00Z"); // 02:00 Dubai on the effective date: first windowed period
      await db.seed(`select recovery_recalculate_employee('${worker.employeeId}', null, 'test')`);
      await addSession(worker.employeeId, "2027-01-09T16:00:00Z", "2027-01-09T18:30:00Z"); // entered later; the day BEFORE the effective date, 3.5h before the later session
      expect(await modelOf(worker.employeeId)).toEqual(["windowed", "windowed"]);
      await db.seed(`select recovery_recalculate_employee('${worker.employeeId}', null, 'test')`);
      const periods = (await db.seed(`select started_at::text as s, policy_version_id from recovery_periods where employee_id = '${worker.employeeId}' and status <> 'superseded'`)).rows;
      expect(periods).toHaveLength(1);
      expect(new Date(periods[0].s).toISOString()).toBe("2027-01-09T16:00:00.000Z"); // one period starting with the earliest evidence
      expect((await db.seed(`select count(*)::int as n from recovery_processor_failures where employee_id = '${worker.employeeId}' and resolved_at is null`)).rows[0].n).toBe(0);
      const secs = (await db.seed(`select sum(w.recorded_seconds)::float8 as s from recovery_windows w join recovery_periods p on p.id = w.period_id where w.employee_id = '${worker.employeeId}' and p.status <> 'superseded'`)).rows[0].s;
      expect(secs).toBe(4 * 3600); // 2.5h + 1.5h, all counted
    });

    it("the manual register never adds a second award on a date where the employee has windowed clock evidence, even after the policy ended", async () => {
      const hr = await person("AE", ["hr_admin"]);
      const worker = await person("AE");
      await addSession(worker.employeeId, "2027-03-10T22:00:00Z", "2027-03-11T01:00:00Z"); // first session AFTER the end date is legacy...
      const w2 = await person("AE");
      await addSession(w2.employeeId, "2027-03-10T10:00:00Z", "2027-03-10T14:00:00Z");
      await addSession(w2.employeeId, "2027-03-10T20:00:00Z", "2027-03-11T01:00:00Z"); // ...but this one continues a windowed period into 11 March (Saturday: a rest day)
      const res = await db.asUserCommit(hr.userId, async (q) =>
        q("select * from record_attendance_and_recovery('2027-03-13', $1::jsonb)", [JSON.stringify([{ employee_id: w2.employeeId, status: "present", work_mode: "office", hours_worked: 8 }])]),
      );
      expect(res.rows[0]).toMatchObject({ credited: true }); // 13 March: no windowed evidence, policy ended -> legacy manual path, unchanged
      const sameDay = await db.asUserCommit(hr.userId, async (q) =>
        q("select * from record_attendance_and_recovery('2027-03-11', $1::jsonb)", [JSON.stringify([{ employee_id: w2.employeeId, status: "present", work_mode: "office", hours_worked: 8 }])]),
      );
      expect(sameDay.rows[0]).toMatchObject({ credited: false, needs_policy_review: true }); // 11 March: windowed evidence exists -> no legacy credit
    });
  });

  describe("governance: who may activate and disable (same predicate as every other policy version)", () => {
    const execCeo = randomUUID();
    const execCto = randomUUID();
    const plHr = randomUUID(); // HR Admin limited to POLAND (not to one company)
    const aeHr = randomUUID(); // HR Admin limited to the UAE (not to one company)
    beforeAll(async () => {
      await db.seed(`
        insert into auth.users (id, email) values ('${execCeo}', 'gov-ceo@enginious.ae'), ('${execCto}', 'gov-cto@enginious.ae'), ('${plHr}', 'gov-plhr@enginious.ae'), ('${aeHr}', 'gov-aehr@enginious.ae');
        insert into user_roles (user_id, role) values ('${execCeo}', 'ceo'), ('${execCto}', 'cto');
        insert into user_roles (user_id, role, country_code) values ('${plHr}', 'hr_admin', 'PL'), ('${aeHr}', 'hr_admin', 'AE');`);
      await setClock("2027-03-12T12:00:00Z");
    });

    it("the CEO may activate a draft but only on the effective date HR already set on it — never change it; the drafter and single-country grants are as before", async () => {
      const saV3 = (await overtimeVersions("SA"))[1]!.id;
      await markSchedulerReady();
      await asCommit(policyHr1, "update policy_versions set effective_from = '2027-04-01' where id = $1", [saV3]); // HR edits the draft's planned date (the existing draft-edit path)
      await fails(policyHr1, "select activate_recovery_windows_policy($1)", [saV3], /someone other than who drafted/);
      await fails(execCeo, "select activate_recovery_windows_policy($1, '2027-04-02')", [saV3], /only on the effective date already set on the draft \(2027-04-01\)/);
      await fails(execCeo, "update policy_versions set effective_from = '2027-04-05' where id = $1", [saV3], /CEO may only activate a drafted policy, not edit its content/); // existing rule, unchanged
      await fails(plHr, "select activate_recovery_windows_policy($1)", [saV3], /company-unscoped HR Admin, CEO or CTO/); // a Poland-only grant has no say over Saudi Arabia
      await asCommit(execCeo, "select activate_recovery_windows_policy($1)", [saV3]);
      const [v2, v3] = await overtimeVersions("SA");
      expect(v2).toMatchObject({ status: "active", effective_to: "2027-03-31" });
      expect(v3).toMatchObject({ status: "active", effective_from: "2027-04-01" });
      expect(v3!.activation_record).toMatchObject({ activated_by: execCeo, effective_from: "2027-04-01" });
    });

    it("the CTO has the same standing as the CEO, and a country-limited HR Admin can activate for their own country with no wider access", async () => {
      const plV3 = (await overtimeVersions("PL"))[1]!.id;
      await asCommit(policyHr1, "update policy_versions set effective_from = '2027-04-01' where id = $1", [plV3]);
      await markSchedulerReady();
      await asCommit(execCto, "select activate_recovery_windows_policy($1, '2027-04-01')", [plV3]);
      expect((await overtimeVersions("PL"))[1]).toMatchObject({ status: "active" });

      const aeDraft = (await overtimeVersions("AE")).at(-1)!; // the re-drafted earlier version created by the deactivation above (drafter: policyHr1)
      expect(aeDraft.status).toBe("draft");
      await fails(plHr, "select activate_recovery_windows_policy($1, '2027-05-01')", [aeDraft.id], /company-unscoped HR Admin, CEO or CTO/);
      await markSchedulerReady();
      await asCommit(aeHr, "select activate_recovery_windows_policy($1, '2027-05-01')", [aeDraft.id]);
      expect((await overtimeVersions("AE")).at(-1)).toMatchObject({ status: "active", effective_from: "2027-05-01" });
    });

    it("disabling is allowed to the same people, needs a future date, and never touches evidence", async () => {
      const saV3 = (await overtimeVersions("SA"))[1]!;
      await fails(workerUser, "select deactivate_recovery_windows_policy($1, '2027-06-01')", [saV3.id], /company-unscoped HR Admin, CEO or CTO/);
      await fails(companyHr, "select deactivate_recovery_windows_policy($1, '2027-06-01')", [saV3.id], /company-unscoped HR Admin, CEO or CTO/);
      const before = (await db.seed("select (select count(*) from attendance_sessions)::int as s, (select count(*) from recovery_windows)::int as w")).rows[0];
      await asCommit(execCeo, "select deactivate_recovery_windows_policy($1, '2027-06-01')", [saV3.id]);
      expect((await overtimeVersions("SA"))[1]).toMatchObject({ status: "active", effective_to: "2027-06-01" });
      expect((await db.seed("select (select count(*) from attendance_sessions)::int as s, (select count(*) from recovery_windows)::int as w")).rows[0]).toEqual(before);
    });
  });
});
