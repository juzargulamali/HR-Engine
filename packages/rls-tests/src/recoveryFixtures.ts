import { randomUUID } from "node:crypto";
import type { RlsTestDatabase } from "./harness";

// Shared fixtures for the Recovery Leave windows test suites. Time is
// controlled, never waited for: recovery_now() (the ONE clock the engine
// reads — exactly now() in Production) is replaced, in the THROWAWAY test
// database only, by a fixed instant, and every evidence row is seeded with
// explicit timestamps.

export const COMPANY_AE = "00000000-0000-0000-0000-0000000e0a01";
export const COMPANY_SA = "00000000-0000-0000-0000-0000000e0a02";
export const COMPANY_PL = "00000000-0000-0000-0000-0000000e0a03";
export const COMPANY_OTHER = "00000000-0000-0000-0000-0000000e0b01";
export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
export const H = 3600;

export type Person = { userId: string; employeeId: string };
export type Iv = {
  start: string;
  end: string | null;
  mode?: string;
  project?: string | null;
  lead?: string | null;
  hrClosed?: boolean;
  byHr?: boolean;
};

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
export function plusSeconds(isoStart: string, seconds: number): string {
  return iso(new Date(isoStart).getTime() + seconds * 1000);
}

export type WindowRow = {
  window_index: number; secs: number; status: string; closed_reason: string | null; classification: string; days: number; band: string;
  review_flags: string[]; hr_verification_required: boolean; local_date: string; window_start: Date; window_end: Date; revision_no: number; id: string;
};
export type RequestRow = {
  id: string; event_type: string; status: string; days: number; applicant_route: string | null; awaiting_project_lead: boolean; routing_issue: string | null;
  needs_policy_review: boolean; project_lead_employee_id: string | null; adjusts_request_id: string | null; recovery_window_id: string; window_revision_no: number;
  work_date: string; created_by: string;
};
export type AlertRow = { alert_type: string; status: string; triggered_at: Date; recorded: number; elapsed: number; dedup_key: string; id: string };

export function createRecoveryFixtures(db: RlsTestDatabase) {
  let seq = 0;

  async function setClock(at: string) {
    await db.seed(`create or replace function recovery_now() returns timestamptz language sql stable as $$ select '${at}'::timestamptz $$`);
  }

  async function newPerson(company: string, country: string, roles: string[] = []): Promise<Person> {
    seq += 1;
    const userId = randomUUID();
    const employeeId = randomUUID();
    await db.seed(`
      insert into auth.users (id, email) values ('${userId}', 'rw-${seq}-${userId.slice(0, 6)}@enginious.ae');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('${employeeId}', '${userId}', 'RW-${seq}-${employeeId.slice(0, 5)}', '${company}', '${country}', 'Emp${seq}', 'Test', '2024-01-01');
      ${roles.map((r) => `insert into user_roles (user_id, role, company_id) values ('${userId}', '${r}', '${company}');`).join("\n")}
    `);
    return { userId, employeeId };
  }

  /** One session per interval (a closed one when `end` is set, otherwise open). */
  async function seedSessions(person: Person, intervals: Iv[]) {
    const stmts: string[] = [];
    for (const iv of intervals) {
      const sessionId = randomUUID();
      const segId = randomUUID();
      const project = iv.project ? `'${iv.project}'` : "null";
      const lead = iv.lead ? `'${iv.lead}'` : "null";
      const mode = iv.mode ?? "office";
      stmts.push(`
        insert into attendance_sessions (id, employee_id, clock_in_at, clock_out_at, status, hr_closed_at, hr_closed_reason, hr_closed_by, recorded_by_hr)
        values ('${sessionId}', '${person.employeeId}', '${iv.start}', ${iv.end ? `'${iv.end}'` : "null"}, '${iv.end ? "closed" : "open"}',
                ${iv.hrClosed ? "now()" : "null"}, ${iv.hrClosed ? "'forgot to clock out'" : "null"}, ${iv.hrClosed ? "(select user_id from employees where id = '" + person.employeeId + "')" : "null"}, ${iv.byHr ? "true" : "false"});
        insert into attendance_segments (id, session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start, segment_end)
        values ('${segId}', '${sessionId}', '${person.employeeId}', '${mode}', ${project}, ${lead}, '${iv.start}', ${iv.end ? `'${iv.end}'` : "null"});`);
    }
    await db.seed(`
      begin;
      select set_config('recovery.defer', 'on', true);
      ${stmts.join("\n")}
      select set_config('recovery.defer', 'off', true);
      commit;`);
  }

  async function recalc(person: Person, asOf?: string) {
    const { rows } = await db.seed(`select recovery_recalculate_employee('${person.employeeId}'::uuid, ${asOf ? `'${asOf}'::timestamptz` : "null"}, 'test') as r`);
    return rows[0].r;
  }

  async function windows(person: Person) {
    const { rows } = await db.seed(
      `select window_index, recorded_seconds::float8 as secs, status, closed_reason, classification, entitlement_days::float8 as days, band,
              review_flags, hr_verification_required, starting_local_date::text as local_date, window_start, window_end, revision_no, id
       from recovery_windows where employee_id = '${person.employeeId}' order by window_start, window_index`,
    );
    return rows as WindowRow[];
  }

  async function requests(person: Person) {
    const { rows } = await db.seed(
      `select id, event_type, status, proposed_days::float8 as days, applicant_route, awaiting_project_lead, routing_issue, needs_policy_review,
              project_lead_employee_id, adjusts_request_id, recovery_window_id, window_revision_no, work_date::text as work_date, created_by
       from recovery_credit_requests where employee_id = '${person.employeeId}' and recovery_window_id is not null
       order by (select w.window_start from recovery_windows w where w.id = recovery_window_id), created_at, ctid`,
    );
    return rows as Array<{
      id: string; event_type: string; status: string; days: number; applicant_route: string | null; awaiting_project_lead: boolean; routing_issue: string | null;
      needs_policy_review: boolean; project_lead_employee_id: string | null; adjusts_request_id: string | null; recovery_window_id: string; window_revision_no: number;
      work_date: string; created_by: string;
    }>;
  }

  async function alerts(person: Person, type?: string) {
    const { rows } = await db.seed(
      `select alert_type, status, triggered_at, recorded_seconds::float8 as recorded, elapsed_seconds::float8 as elapsed, dedup_key, id
       from recovery_alerts where employee_id = '${person.employeeId}' ${type ? `and alert_type = '${type}'` : ""} order by triggered_at`,
    );
    return rows as Array<{ alert_type: string; status: string; triggered_at: Date; recorded: number; elapsed: number; dedup_key: string; id: string }>;
  }

  /** A single closed shift on its own fresh employee, evaluated well after it ended. */
  async function singleShift(country: "AE" | "SA" | "PL", start: string, seconds: number, extra: Partial<Iv> = {}) {
    const company = country === "AE" ? COMPANY_AE : country === "SA" ? COMPANY_SA : COMPANY_PL;
    const person = await newPerson(company, country);
    const lead = extra.lead ?? (await newPerson(company, country)).employeeId;
    const end = plusSeconds(start, seconds);
    await setClock(plusSeconds(end, 9 * H));
    await seedSessions(person, [{ start, end, lead, ...extra }]);
    await recalc(person);
    return { person, lead, ws: await windows(person), rs: await requests(person) };
  }


  async function setupDatabase() {
    await db.seed(`
      update countries set working_weekdays = array[1,2,3,4,5] where code in ('AE', 'PL');
      update countries set working_weekdays = array[0,1,2,3,4] where code = 'SA';
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_AE}', 'Dubai Co', 'AE', 'AED'),
        ('${COMPANY_SA}', 'Riyadh Co', 'SA', 'SAR'),
        ('${COMPANY_PL}', 'Warsaw Co', 'PL', 'PLN'),
        ('${COMPANY_OTHER}', 'Other Dubai Co', 'AE', 'AED');
      insert into public_holidays (country_code, holiday_date, name) values
        ('AE', '2027-03-02', 'Weekday holiday'),
        ('AE', '2027-02-06', 'Saturday holiday'),
        ('SA', '2027-03-02', 'Saudi weekday holiday');
    `);
    await setClock("2026-12-31T00:00:00Z");
    // One ACTIVE windows policy per country, inserted the way only the controlled
    // activation function otherwise may (the guard trigger needs this setting).
    await db.seed(`
      begin;
      select set_config('app.recovery_policy_activation', 'on', true);
      insert into policy_versions (country_code, policy_type, version_no, effective_from, status, created_by, payload)
      select c, 'overtime_rules', 3, '2026-01-01', 'active', '${SYSTEM_ACTOR}', jsonb_build_object(
        'model', 'recovery_windows',
        'rules', jsonb_build_object('window_hours', 24, 'rest_gap_hours', 8, 'alert_work_hours', 20, 'normal_day_required_hours', 9,
          'normal_day', jsonb_build_object('zero_max_hours', 13, 'half_max_hours', 17),
          'rest_day', jsonb_build_object('zero_below_hours', 2, 'half_max_hours', 6),
          'max_days_per_window', 1, 'expiry_days', 180))
      from unnest(array['AE', 'SA', 'PL']) c;
      commit;`);
  }

  return { setClock, newPerson, seedSessions, recalc, windows, requests, alerts, singleShift, setupDatabase };
}
