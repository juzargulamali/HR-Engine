import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { COMPANY_AE, COMPANY_OTHER, COMPANY_SA, H, createRecoveryFixtures, plusSeconds, type Person } from "../src/recoveryFixtures";
import { attendanceItems, countByState, makeViewer, recoveryAlertItems, type QueueItem } from "../../../apps/web/src/lib/hr/queue";

// One-time, owner-run, PRODUCTION PRE-LAUNCH CLEANUP of requests and alerts (supabase/manual-sql/prelaunch_cleanup_*.sql).
// The four SQL files are run exactly as written, by string substitution of their marked edit lines only, on an isolated database built from every migration, with
// fictional companies, people and requests. They run as the database owner (like the Supabase SQL editor); what a signed-in person can then SEE is asserted with
// asUser(), using SQL equivalents of the app's own queue queries and the app's own pure queue builders (apps/web/src/lib/hr/queue.ts).
//
// Time: the cutoff is 10 days ago (real clock). "Before" items are stamped 30 days ago, "after" items 2 days ago. The Recovery Leave engine's clock is the controllable
// recovery_now() of the throwaway database, exactly as in the other Recovery Leave suites.

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const CUTOFF = iso(NOW - 10 * DAY);
const PRE = iso(NOW - 30 * DAY);
const POST = iso(NOW - 2 * DAY);
const cutoffClock = iso(NOW - 10 * DAY - 1 * H * 1000);
const PLACEHOLDER = "timestamptz '2000-01-01 00:00:00+00'";
const MARKER = "Pre-launch cleanup (go-live)";

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK_DIR = path.resolve(here, "../../../supabase/manual-sql");
const readPack = (name: string) => readFileSync(path.join(PACK_DIR, name), "utf8");
const AUDIT_SQL = readPack("prelaunch_cleanup_00_audit_readonly.sql");
const IMPACT_SQL = readPack("prelaunch_cleanup_05_impact_readonly.sql");
const CLEANUP_SQL = readPack("prelaunch_cleanup_10_cleanup.sql");
const VERIFY_SQL = readPack("prelaunch_cleanup_20_verify_readonly.sql");

/** The read-only files have ONE marked value: the cutoff. Replace exactly that, nothing else. */
function withCutoff(sql: string, cutoff: string | null): string {
  if (cutoff === null) return sql;
  expect(sql.split(PLACEHOLDER).length - 1).toBe(1);
  return sql.replace(PLACEHOLDER, `timestamptz '${cutoff}'`);
}

/** The write file has three marked lines. Replace exactly those. */
function cleanupSql(o: { cutoff?: string; reversals?: string[]; actor?: string }): string {
  let sql = CLEANUP_SQL;
  const swap = (marker: string, line: string) => {
    const hits = sql.match(new RegExp(`^.*${marker}.*$`, "gm")) ?? [];
    expect(hits).toHaveLength(1);
    sql = sql.replace(new RegExp(`^.*${marker}.*$`, "m"), () => line);
  };
  if (o.cutoff) swap("<<< EDIT 1 of 3", `  timestamptz '${o.cutoff}' as cutoff,`);
  if (o.reversals) swap("<<< EDIT 2 of 3", `  array[${o.reversals.map((i) => `'${i}'::uuid`).join(", ")}]::uuid[] as approved_reversals,`);
  if (o.actor) swap("<<< EDIT 3 of 3", `  uuid '${o.actor}' as actor_user_id;`);
  return sql;
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Pre-launch cleanup of requests and alerts (owner-run SQL pack)", () => {
  const db = new RlsTestDatabase();
  const fx = createRecoveryFixtures(db);
  const { setClock, newPerson, seedSessions, recalc, windows, requests, alerts } = fx;

  const COMPANY_QA = "00000000-0000-0000-0000-0000000e0c01";

  /** Runs a script on its own connection (a failed script must not poison a pooled one), optionally inside a read-only transaction. Returns the last result's rows. */
  async function runScript(sql: string, readOnly = false): Promise<Row[]> {
    const url = new URL(process.env.RLS_TEST_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres");
    url.pathname = `/${db.dbName}`;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      if (readOnly) await client.query("BEGIN READ ONLY");
      const res = (await client.query(sql)) as unknown as { rows: Row[] } | { rows: Row[] }[];
      return (Array.isArray(res) ? res[res.length - 1]! : res).rows;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      if (readOnly) await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  }
  const q = async (sql: string): Promise<Row[]> => (await db.seed(sql)).rows as Row[];
  const one = async (sql: string): Promise<Row> => (await q(sql))[0] ?? {};
  const as = <T = Row>(p: Person, sql: string, params: unknown[] = []) => db.asUser(p.userId, async (query) => (await query(sql, params)).rows as T[]);

  // ------------------------------------------------------------------ the cast (all fictional)
  let hrAe: Person, ceoAe: Person, mgrAe: Person, leadAe: Person, hrSa: Person, mgrSa: Person, hrOther: Person, hrQa: Person, mgrQa: Person, leadQa: Person;
  let eAz: Person, eA1: Person, eA2: Person, eA3: Person, eA4: Person, eA5: Person, eA6: Person, eA7: Person, eAx: Person, eAy: Person, eS1: Person, eS2: Person, eQ1: Person, eQ2: Person, eQ3: Person;
  let wIdle: Person; // an employee with nothing at all
  const ids: Record<string, string> = {};
  const W: Record<string, Person> = {};

  async function approverOf(requestId: string, type: "leave_request" | "recovery_credit") {
    return (await q(`select id, step_order, decision, approver_id, queue_roles::text[] as queue_roles from approvals where entity_type = '${type}' and entity_id = '${requestId}' order by step_order`)) as Row[];
  }

  async function leave(opts: {
    key: string; person: Person; approver?: Person; from: string; to: string; days: number; status?: string; stamp: string; withApproval?: boolean; unit?: "annual";
  }) {
    const id = randomUUID();
    ids[opts.key] = id;
    const status = opts.status ?? "submitted";
    await db.seed(`
      insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days, status, submitted_at, created_at)
      values ('${id}', '${opts.person.employeeId}', 'annual', ${opts.from}, ${opts.to}, ${opts.days}, '${status}', '${opts.stamp}', '${opts.stamp}');`);
    if (opts.withApproval !== false && opts.approver) {
      const wf = await one(`select id from approval_workflows where company_id = (select company_id from employees where id = '${opts.person.employeeId}') and entity_type = 'leave_request'`);
      await db.seed(`insert into approvals (entity_type, entity_id, workflow_id, step_order, approver_id, decision, created_at)
                     values ('leave_request', '${id}', '${wf.id}', 1, '${opts.approver.userId}', '${status === "submitted" || status === "pending_approval" ? "pending" : "approved"}', '${opts.stamp}');`);
    }
    return id;
  }

  /** Approves a pending leave request through the real function, as its approver, so the real ledger rows are posted. */
  async function approveLeave(key: string, approver: Person) {
    const [step] = await approverOf(ids[key]!, "leave_request");
    await db.asUserCommit(approver.userId, async (query) => query("select decide_leave_approval($1::uuid, 'approved'::approval_decision, 'ok')", [step!.id]));
  }

  const tuesday = (daysAgo: number) => {
    const d = new Date(NOW - daysAgo * DAY);
    d.setUTCHours(5, 0, 0, 0);
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString();
  };

  async function windowShift(key: string, startIso: string, hours: number, opts: { stamp?: string; open?: boolean; clockAt?: string } = {}) {
    const person = await newPerson(COMPANY_AE, "AE");
    const lead = (await newPerson(COMPANY_AE, "AE")).employeeId;
    W[key] = person;
    const end = plusSeconds(startIso, hours * H);
    await setClock(opts.clockAt ?? plusSeconds(end, 9 * H));
    await seedSessions(person, [{ start: startIso, end: opts.open ? null : end, lead, project: "Fictional Project", mode: "site_work" }]);
    await recalc(person);
    if (opts.stamp) await db.seed(`update recovery_credit_requests set submitted_at = '${opts.stamp}' where employee_id = '${person.employeeId}'`);
    return person;
  }

  /** Everything that must never move in a cleanup, as one fingerprint (counts and hashes). */
  async function fingerprint(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const t of ["attendance_records", "attendance_sessions", "attendance_segments", "recovery_windows", "recovery_periods", "recovery_window_allocations", "payroll_export_runs", "payroll_export_lines", "leave_ledger", "comp_day_ledger"]) {
      const r = await one(`select count(*)::text as n, coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by x.id)), '') as h from ${t} x`);
      out[t] = `${r.n}:${r.h}`;
    }
    return out;
  }

  const cell = (rows: Row[], f: { section: string; company?: string | null; item_type?: string; status?: string; scope?: string }) =>
    rows.filter((r) => String(r.section).startsWith(f.section)
      && (f.company === undefined || r.company === f.company) && (f.item_type === undefined || r.item_type === f.item_type)
      && (f.status === undefined || r.status === f.status) && (f.scope === undefined || String(r.scope).startsWith(f.scope)))
      .reduce((n, r) => n + Number(r.count), 0);

  beforeAll(async () => {
    await db.setup();
    await fx.setupDatabase();
    await db.seed(`
      insert into countries (code, name, default_currency, week_start_day, working_weekdays) values ('QA', 'Qatar', 'QAR', 0, array[0,1,2,3,4]);
      insert into companies (id, legal_name, country_code, default_currency) values ('${COMPANY_QA}', 'Doha Legacy Co', 'QA', 'QAR');
    `);
    hrAe = await newPerson(COMPANY_AE, "AE", ["hr_admin"]);
    ceoAe = await newPerson(COMPANY_AE, "AE", ["ceo"]);
    mgrAe = await newPerson(COMPANY_AE, "AE", ["line_manager"]);
    leadAe = await newPerson(COMPANY_AE, "AE");
    hrSa = await newPerson(COMPANY_SA, "SA", ["hr_admin"]);
    mgrSa = await newPerson(COMPANY_SA, "SA", ["line_manager"]);
    hrOther = await newPerson(COMPANY_OTHER, "AE", ["hr_admin"]);
    hrQa = await newPerson(COMPANY_QA, "QA", ["hr_admin"]);
    mgrQa = await newPerson(COMPANY_QA, "QA", ["line_manager"]);
    leadQa = await newPerson(COMPANY_QA, "QA");
    eA1 = await newPerson(COMPANY_AE, "AE");
    eA2 = await newPerson(COMPANY_AE, "AE");
    eA3 = await newPerson(COMPANY_AE, "AE");
    eA4 = await newPerson(COMPANY_AE, "AE");
    eA5 = await newPerson(COMPANY_AE, "AE");
    eA6 = await newPerson(COMPANY_AE, "AE");
    eA7 = await newPerson(COMPANY_AE, "AE");
    eAx = await newPerson(COMPANY_AE, "AE");
    eAy = await newPerson(COMPANY_AE, "AE");
    wIdle = await newPerson(COMPANY_AE, "AE");
    eS1 = await newPerson(COMPANY_SA, "SA");
    eS2 = await newPerson(COMPANY_SA, "SA");
    eQ1 = await newPerson(COMPANY_QA, "QA");
    eQ2 = await newPerson(COMPANY_QA, "QA");
    eQ3 = await newPerson(COMPANY_QA, "QA");
    await db.seed(`
      update employees set manager_id = '${mgrAe.employeeId}' where id in ('${[eA1, eA2, eA3, eA4, eA5, eA6, eA7, eAx, eAy, wIdle].map((p) => p.employeeId).join("', '")}');
      update employees set manager_id = '${mgrSa.employeeId}' where id in ('${eS1.employeeId}', '${eS2.employeeId}');
      update employees set manager_id = '${mgrQa.employeeId}' where id in ('${eQ1.employeeId}', '${eQ2.employeeId}', '${eQ3.employeeId}');
      -- guard_leave_request_type() needs an active leave_rules policy that defines 'annual' for the country.
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('${randomUUID()}', 'AE', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${hrAe.userId}', '${ceoAe.userId}', now());
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('${randomUUID()}', 'SA', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${hrAe.userId}', '${ceoAe.userId}', now());
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
        select id, 'annual', 'Annual Leave', 'monthly_accrual' from policy_versions where policy_type = 'leave_rules';
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by)
        select id, 'annual', '2026-01-01', 'accrual', 20, '${hrAe.userId}' from employees where id in ('${[eA1, eA2, eA3, eA4, eA5, eA6, eA7, eS1, eS2].map((p) => p.employeeId).join("', '")}');
    `);

    // ---------------------------------------------------------------- LEAVE APPLICATIONS
    // L_pend: submitted BEFORE the cutoff for a FUTURE leave date (in scope because of its submission time).
    await leave({ key: "L_pend", person: eA1, approver: mgrAe, from: "current_date + 20", to: "current_date + 22", days: 3, stamp: PRE });
    // L_post: submitted AFTER the cutoff, pending (stays).
    await leave({ key: "L_post", person: eA1, approver: mgrAe, from: "current_date + 50", to: "current_date + 51", days: 2, stamp: POST });
    // L_appr: approved through the real function, FUTURE dates, posted a ledger deduction (before the cutoff).
    await leave({ key: "L_appr", person: eA2, approver: mgrAe, from: "current_date + 30", to: "current_date + 31", days: 2, stamp: PRE });
    await approveLeave("L_appr", mgrAe);
    // L_pay: approved, FUTURE dates, its ledger row is referenced by a payroll export line, in an approved and sent payroll period.
    await leave({ key: "L_pay", person: eA3, approver: mgrAe, from: "current_date + 40", to: "current_date + 41", days: 2, stamp: PRE });
    await approveLeave("L_pay", mgrAe);
    // L_past: approved and already taken (history), ledger deduction posted. L_rej / L_can: rejected and cancelled history.
    await leave({ key: "L_past", person: eA4, approver: mgrAe, from: "current_date - 40", to: "current_date - 39", days: 2, status: "approved", stamp: PRE });
    await db.seed(`insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, reference_id, created_by)
                   values ('${eA4.employeeId}', 'annual', current_date - 40, 'deduction', -2, 'leave_request', '${ids.L_past}', '${mgrAe.userId}')`);
    await leave({ key: "L_rej", person: eA5, approver: mgrAe, from: "current_date + 60", to: "current_date + 60", days: 1, status: "rejected", stamp: PRE });
    await db.seed(`update approvals set decision = 'rejected' where entity_id = '${ids.L_rej}'`);
    await leave({ key: "L_can", person: eA5, approver: mgrAe, from: "current_date + 70", to: "current_date + 70", days: 1, status: "cancelled", stamp: PRE });
    await db.seed(`update approvals set decision = 'cancelled' where entity_id = '${ids.L_can}'`);
    // L_orphan: cancelled before the cutoff but its approval step was never closed (the state older versions left behind): shows on the approver's page for nothing.
    await leave({ key: "L_orphan", person: eA6, approver: mgrAe, from: "current_date + 80", to: "current_date + 80", days: 1, status: "cancelled", stamp: PRE });
    await db.seed(`update approvals set decision = 'pending' where entity_id = '${ids.L_orphan}'`);
    // Riyadh Co: one pending, one approved (future, with ledger)
    await leave({ key: "L_pend_sa", person: eS1, approver: mgrSa, from: "current_date + 25", to: "current_date + 25", days: 1, stamp: PRE });
    await leave({ key: "L_appr_sa", person: eS2, approver: mgrSa, from: "current_date + 35", to: "current_date + 36", days: 2, stamp: PRE });
    await approveLeave("L_appr_sa", mgrSa);

    // Payroll: an approved AND sent run for the month of L_pay, with a line pointing at L_pay's deduction row.
    await db.seed(`
      insert into payroll_export_runs (id, company_id, period_month, period_year, status, generated_by, sent_at)
      select '${randomUUID()}', '${COMPANY_AE}', extract(month from (current_date + 40))::int, extract(year from (current_date + 40))::int, 'approved', '${hrAe.userId}', now();
      insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, source_reference_type, source_reference_id)
      select (select id from payroll_export_runs where company_id = '${COMPANY_AE}'), '${eA3.employeeId}', 'leave_encashment', 50, 'AED', 'leave_ledger', l.id
      from leave_ledger l where l.reference_type = 'leave_request' and l.reference_id = '${ids.L_pay}';`);

    // An approval of ANOTHER type (an expense claim), pending, from before the cutoff: must never be touched.
    ids.other_claim = randomUUID();
    await db.seed(`insert into approvals (entity_type, entity_id, step_order, approver_id, decision, created_at)
                   values ('reimbursement_claim', '${ids.other_claim}', 1, '${mgrAe.userId}', 'pending', '${PRE}')`);

    // ---------------------------------------------------------------- RECOVERY LEAVE (working-period windows, Dubai): requests, alerts, windows waiting for HR verification
    await windowShift("W1", tuesday(35), 15, { stamp: PRE }); // a plain pending request
    await windowShift("W2", tuesday(34), 22, { stamp: PRE }); // a pending request, a 20-hour alert, a window waiting for HR verification
    const start3 = iso(NOW - 10 * DAY - 30 * H * 1000);
    await windowShift("W3", start3, 0, { open: true, clockAt: iso(NOW - 10 * DAY - 1 * H * 1000), stamp: PRE }); // an OPEN session: one window closed, a rollover alert, a 20-hour alert
    await windowShift("W4", tuesday(2), 22, {}); // AFTER the cutoff: request, alert and window all stay
    await windowShift("W5", tuesday(90), 22, { stamp: PRE }); // before the cutoff but older than the 60-day look-back: in no live queue
    ids.W3_start = start3;
    // An approved window credit (through the real two-step approval), before the cutoff.
    const w6 = await windowShift("W6", tuesday(33), 15, { stamp: PRE });
    const w6req = (await requests(w6))[0]!;
    ids.W6_req = w6req.id;
    const w6steps = await approverOf(w6req.id, "recovery_credit");
    expect(w6steps).toHaveLength(1);
    await db.asUserCommit((await q(`select user_id from employees where id = '${w6req.project_lead_employee_id}'`))[0]!.user_id, async (query) => query("select decide_leave_approval($1::uuid, 'approved'::approval_decision, 'ok')", [w6steps[0]!.id]));
    const w6after = await approverOf(w6req.id, "recovery_credit");
    expect(w6after.map((s) => s.decision)).toEqual(["approved", "pending"]); // step 2 waits on the HR queue
    await db.asUserCommit(hrAe.userId, async (query) => {
      const w = await query("select id from recovery_windows where employee_id = $1", [w6.employeeId]);
      const verifyNeeded = (await query("select hr_verification_required as v from recovery_windows where id = $1", [w.rows[0].id])).rows[0].v;
      if (verifyNeeded) await query("select hr_verify_recovery_window($1::uuid, 'checked with the lead')", [w.rows[0].id]);
      await query("select decide_leave_approval($1::uuid, 'approved'::approval_decision, 'ok')", [w6after[1]!.id]);
    });
    expect((await one(`select status from recovery_credit_requests where id = '${w6req.id}'`)).status).toBe("approved");

    // W7: step 1 (the lead) approved, step 2 waits on the HR queue: a request in 'pending_approval' with a QUEUE approval step.
    const w7 = await windowShift("W7", tuesday(32), 15, { stamp: PRE });
    const w7req = (await requests(w7))[0]!;
    ids.W7_req = w7req.id;
    const w7steps = await approverOf(w7req.id, "recovery_credit");
    await db.asUserCommit((await q(`select user_id from employees where id = '${w7req.project_lead_employee_id}'`))[0]!.user_id, async (query) => query("select decide_leave_approval($1::uuid, 'approved'::approval_decision, 'ok')", [w7steps[0]!.id]));
    expect((await one(`select status from recovery_credit_requests where id = '${w7req.id}'`)).status).toBe("pending_approval");

    // ---------------------------------------------------------------- COMP-OFF, the daily kind (a country without a windows policy: Qatar)
    // LG1: a manual attendance entry on a rest day (Friday) saved by HR: the request is born from the record. Pending, before the cutoff.
    const friday = (daysAgo: number) => {
      const d = new Date(NOW - daysAgo * DAY);
      d.setUTCHours(5, 0, 0, 0);
      while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
      return d;
    };
    ids.fri1 = friday(40).toISOString().slice(0, 10);
    await db.asUserCommit(hrQa.userId, async (query) => {
      await query("select * from record_attendance_and_recovery($1::date, $2::jsonb)", [ids.fri1, JSON.stringify([{ employee_id: eQ1.employeeId, status: "present", work_mode: "office", hours_worked: 10 }])]);
    });
    await db.seed(`update recovery_credit_requests set submitted_at = '${PRE}' where employee_id = '${eQ1.employeeId}'`);
    // LG2: clock evidence on another rest day (legacy sessions): the request is born from the clock segments. Pending, before the cutoff.
    ids.fri2 = friday(41).toISOString().slice(0, 10);
    await seedSessions(eQ2, [{ start: `${ids.fri2}T05:00:00Z`, end: `${ids.fri2}T15:00:00Z`, mode: "site_work", project: "Fictional Project", lead: leadQa.employeeId }]);
    await db.asUserCommit(eQ2.userId, async (query) => query("select sync_attendance_recovery_for_day($1::uuid, $2::date)", [eQ2.employeeId, ids.fri2]));
    await db.seed(`update recovery_credit_requests set submitted_at = '${PRE}' where employee_id = '${eQ2.employeeId}'`);
    // LG3: an approved daily comp-off credit with its ledger row (before the cutoff).
    ids.fri3 = friday(50).toISOString().slice(0, 10);
    ids.LG3_rec = randomUUID();
    ids.LG3_req = randomUUID();
    ids.LG3_led = randomUUID();
    await db.seed(`
      insert into attendance_records (id, employee_id, work_date, status, work_mode, hours_worked, source) values ('${ids.LG3_rec}', '${eQ3.employeeId}', '${ids.fri3}', 'present', 'office', 9, 'manual');
      insert into comp_day_ledger (id, employee_id, txn_date, entry_type, days, source, expiry_date, reference_type, reference_id, created_by)
        values ('${ids.LG3_led}', '${eQ3.employeeId}', '${ids.fri3}', 'earned', 1, 'holiday_worked', date '${ids.fri3}' + 180, 'attendance_record', '${ids.LG3_rec}', '${hrQa.userId}');
      insert into recovery_credit_requests (id, employee_id, attendance_record_id, work_date, event_type, proposed_days, status, submitted_at, decided_at, created_by, comp_day_ledger_id)
        values ('${ids.LG3_req}', '${eQ3.employeeId}', '${ids.LG3_rec}', '${ids.fri3}', 'standard', 1, 'approved', '${PRE}', '${PRE}', '${hrQa.userId}', '${ids.LG3_led}');
      insert into approvals (entity_type, entity_id, step_order, approver_id, decision, created_at) values ('recovery_credit', '${ids.LG3_req}', 1, '${mgrQa.userId}', 'approved', '${PRE}');`);

    // ---------------------------------------------------------------- ATTENDANCE EXCEPTIONS (a manual entry and the clock disagree)
    const conflictText = "Self-clock activity exists for this day, which was already recorded as present (source: manual). Not overwritten.";
    ids.AX1 = randomUUID(); ids.AX2 = randomUUID(); ids.AX3 = randomUUID();
    await db.seed(`
      insert into attendance_records (id, employee_id, work_date, status, work_mode, hours_worked, source, presence_conflict) values
        ('${ids.AX1}', '${eAx.employeeId}', current_date - 20, 'present', 'office', 8, 'manual', '${conflictText}'),
        ('${ids.AX2}', '${eAy.employeeId}', current_date - 3, 'present', 'office', 8, 'manual', '${conflictText}'),
        ('${ids.AX3}', '${eAx.employeeId}', current_date - 100, 'present', 'office', 8, 'manual', '${conflictText}');`);
    // AX4: the REAL generating function: a manual entry on a day that also has clock evidence -> sync_attendance_presence_for_day() flags the conflict (before the cutoff).
    eAz = await newPerson(COMPANY_AE, "AE");
    ids.AX4_date = (await one("select (current_date - 15)::text as d")).d;
    await db.seed(`update employees set manager_id = '${mgrAe.employeeId}' where id = '${eAz.employeeId}'`);
    await db.seed(`insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source) values ('${eAz.employeeId}', '${ids.AX4_date}', 'present', 'office', 8, 'manual')`);
    await setClock(iso(NOW));
    await seedSessions(eAz, [{ start: `${ids.AX4_date}T05:00:00Z`, end: `${ids.AX4_date}T09:00:00Z`, mode: "office" }]);
    await db.seed(`select sync_attendance_presence_for_day('${eAz.employeeId}', '${ids.AX4_date}')`);
    ids.AX4 = (await one(`select id from attendance_records where employee_id = '${eAz.employeeId}' and work_date = '${ids.AX4_date}'`)).id;
    expect((await one(`select presence_conflict is not null as c from attendance_records where id = '${ids.AX4}'`)).c).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  // ------------------------------------------------------------------ helpers for the assertions
  const states = async () => {
    const out: Record<string, string> = {};
    for (const t of ["leave_requests", "approvals", "recovery_credit_requests", "recovery_alerts", "hr_queue_acknowledgements"]) {
      const r = await one(`select count(*)::text as n, coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by x.id)), '') as h from ${t} x`);
      out[t] = `${r.n}:${r.h}`;
    }
    out.audit_log = (await one("select count(*)::text as n from audit_log")).n;
    return out;
  };
  /** Everything submitted / triggered at or after the cutoff that the cleanup must leave byte for byte as it is. */
  const postCutoffHash = async () => {
    const w4 = W.W4!;
    const r = await one(`
      select md5(string_agg(t, '|' order by t)) as h from (
        select to_jsonb(x)::text as t from leave_requests x where id = '${ids.L_post}'
        union all select to_jsonb(x)::text from approvals x where entity_id = '${ids.L_post}'
        union all select to_jsonb(x)::text from recovery_credit_requests x where employee_id = '${w4.employeeId}'
        union all select to_jsonb(x)::text from approvals x where entity_id in (select id from recovery_credit_requests where employee_id = '${w4.employeeId}')
        union all select to_jsonb(x)::text from recovery_alerts x where employee_id = '${w4.employeeId}'
        union all select to_jsonb(x)::text from recovery_windows x where employee_id = '${w4.employeeId}'
        union all select to_jsonb(x)::text from attendance_records x where id = '${ids.AX2}'
        union all select to_jsonb(x)::text from approvals x where entity_id = '${ids.other_claim}'
      ) y`);
    return r.h as string;
  };
  const statusOf = async (table: "leave_requests" | "recovery_credit_requests", id: string) => (await one(`select status::text as s from ${table} where id = '${id}'`)).s as string;
  const decisionsOf = async (entityId: string) => ((await q(`select decision::text as d, comments from approvals where entity_id = '${entityId}' order by step_order`)) as Row[]);
  const winReq = async (key: string) => (await requests(W[key]!));
  const ackCount = async (kind = "attendance") => Number((await one(`select count(*)::int as n from hr_queue_acknowledgements where kind = '${kind}'`)).n);
  const verify = async (cutoff = CUTOFF) => runScript(withCutoff(VERIFY_SQL, cutoff), true);
  const verifyProblems = (rows: Row[]) => rows.filter((r) => String(r.result).startsWith("FAIL")).map((r) => `${r.ord}: ${r.item} -> ${r.result}`);
  const runCleanup = (o: { cutoff?: string; reversals?: string[]; actor?: string } = {}) => runScript(cleanupSql({ cutoff: CUTOFF, actor: hrAe.userId, ...o }));
  const change = (rows: Row[], f: { company?: string; item_type: string; result?: string; action?: string }) =>
    rows.filter((r) => String(r.section).startsWith("1.") && r.item_type === f.item_type && (f.company === undefined || r.company === f.company)
      && (f.result === undefined || r.result === f.result) && (f.action === undefined || r.action === f.action)).reduce((n, r) => n + Number(r.count), 0);
  const left = (rows: Row[], f: { company: string; item_type: string }) =>
    rows.filter((r) => String(r.section).startsWith("2.") && r.company === f.company && r.item_type === f.item_type).reduce((n, r) => n + Number(r.count), 0);

  // The SQL equivalents of what the app loads, run as the signed-in person (so row-level security decides), and the app's own pure builders (queue.ts).
  async function hrQueue(viewer: Person, employeeId?: string) {
    return db.asUser(viewer.userId, async (query) => {
      const scope = employeeId ? ` and employee_id = '${employeeId}'` : "";
      const emps = (await query(`select id, first_name, last_name, company_id from employees where deleted_at is null ${employeeId ? `and id = '${employeeId}'` : ""}`)).rows as Row[];
      const comps = (await query("select id, legal_name from companies")).rows as Row[];
      const conflicts = (await query(`select id, employee_id, work_date::text as work_date from attendance_records where presence_conflict is not null and work_date >= current_date - 60 ${scope}`)).rows as Row[];
      const wins = (await query(`select id, employee_id, starting_local_date::text as starting_local_date from recovery_windows where hr_verification_required = true and hr_verified_at is null and starting_local_date >= current_date - 60 ${scope}`)).rows as Row[];
      const alertRows = (await query(`select id, company_id, employee_id, alert_type, triggered_at, status, acknowledged_at, acknowledgement_note from recovery_alerts where status in ('open', 'acknowledged') ${scope} order by triggered_at desc limit 100`)).rows as Row[];
      const acks = (await query(`select kind, source_id, source_date::text as source_date, acknowledged_at, note from hr_queue_acknowledgements where true ${scope}`)).rows as Row[];
      const ctx = {
        today: (await query("select current_date::text as d")).rows[0].d as string,
        viewer: makeViewer((c: string) => c === COMPANY_AE),
        employees: new Map(emps.map((e) => [e.id as string, { name: `${e.first_name} ${e.last_name}`, companyId: e.company_id as string }])),
        companies: new Map(comps.map((c) => [c.id as string, c.legal_name as string])),
        acks: new Map(acks.map((a) => [`${a.kind}:${a.source_id}:${a.source_date}`, { at: new Date(a.acknowledged_at).toISOString(), note: (a.note as string | null) ?? null }])),
      };
      const items: QueueItem[] = [
        ...attendanceItems(conflicts as never, wins as never, ctx),
        ...recoveryAlertItems(alertRows.map((a) => ({ ...a, triggered_at: new Date(a.triggered_at).toISOString(), acknowledged_at: a.acknowledged_at ? new Date(a.acknowledged_at).toISOString() : null })) as never, ctx, (t) => t,
          (isoTs) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoTs))),
      ];
      return items;
    });
  }
  /** My Day counts an item as waiting for attention when it is not acknowledged (apps/web/src/lib/my-day/attention.ts, hrCandidates). */
  const myDayCount = (items: QueueItem[]) => items.filter((i) => i.state !== "acknowledged").length;
  const pendingSteps = async (p: Person) => Number((await as(p, "select count(*)::int as n from approvals where approver_id = $1 and decision = 'pending'", [p.userId]))[0]!.n);
  const hrInbox = async (p: Person) => (await as(p, "select approval_id from recovery_decider_inbox()")).length;

  let fpBefore: Record<string, string>;
  let st0: Record<string, string>;
  let pre: { hrItems: QueueItem[]; mgrSteps: number; hrInbox: number; eA1Pending: number; counts: Record<string, string> };

  // ------------------------------------------------------------------ 0. the fixture is what the tests say it is
  it("fixture: leave dates, ledger rows and payroll link are as described", async () => {
    expect((await one(`select (start_date > current_date) as f from leave_requests where id = '${ids.L_pend}'`)).f).toBe(true); // a FUTURE leave date, pending
    expect((await one(`select count(*)::int as n from leave_ledger where reference_type = 'leave_request' and reference_id = '${ids.L_appr}'`)).n).toBe(1);
    expect((await one(`select status::text as s from leave_requests where id = '${ids.L_pay}'`)).s).toBe("approved");
    expect((await one(`select count(*)::int as n from payroll_export_lines l join leave_ledger g on g.id = l.source_reference_id where g.reference_id = '${ids.L_pay}'`)).n).toBe(1);
  });

  // ------------------------------------------------------------------ 1. AUDIT
  describe("step 1: the audit (read-only)", () => {
    it("the three read-only files run inside a READ ONLY transaction (any write would fail) and change nothing", async () => {
      const before = await states();
      for (const sql of [AUDIT_SQL, IMPACT_SQL, VERIFY_SQL]) {
        await expect(runScript(withCutoff(sql, CUTOFF), true)).resolves.toBeInstanceOf(Array);
        await expect(runScript(sql, true)).resolves.toBeInstanceOf(Array); // with the placeholder too
      }
      expect(await states()).toEqual(before);
    });

    it("says PLACEHOLDER and counts nothing in scope while the cutoff is still the placeholder", async () => {
      const rows = await runScript(AUDIT_SQL, true);
      expect(String(rows[0]!.status)).toMatch(/^PLACEHOLDER/);
      expect(rows.filter((r) => String(r.scope).startsWith("IN SCOPE"))).toEqual([]);
    });

    it("counts BY COMPANY, ITEM TYPE and STATUS, in sections A (pending), B (approved, future), C (historical), with at-or-after-cutoff rows shown as untouched", async () => {
      const rows = await runScript(withCutoff(AUDIT_SQL, CUTOFF), true);
      expect(String(rows[0]!.status)).toContain(CUTOFF.slice(0, 16).replace("T", " "));
      const IN = "IN SCOPE";
      const AFTER = "untouched";
      // (a) PENDING: a leave application submitted BEFORE the cutoff for a FUTURE date is in scope; one submitted after is not
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "leave_request", status: "submitted", scope: IN })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "leave_request", status: "submitted", scope: AFTER })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Riyadh Co", item_type: "leave_request", status: "submitted", scope: IN })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "recovery_leave_request:window", status: "submitted", scope: IN })).toBe(4);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "recovery_leave_request:window", status: "pending_approval", scope: IN })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "recovery_leave_request:window", status: "submitted", scope: AFTER })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Doha Legacy Co", item_type: "comp_off_request:standard", status: "submitted", scope: IN })).toBe(2);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "recovery_alert:long_work", status: "open", scope: IN })).toBe(3);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "recovery_alert:window_rollover", status: "open", scope: IN })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "recovery_alert:long_work", status: "open", scope: AFTER })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "attendance_alert:presence_conflict", status: "needs_action", scope: IN })).toBe(3); // AX1, AX4 live + AX3 older than the look-back
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "attendance_alert:presence_conflict", status: "needs_action", scope: AFTER })).toBe(1);
      expect(cell(rows, { section: "A.", company: "Dubai Co", item_type: "attendance_alert:window_needs_hr_verification", status: "needs_action", scope: IN })).toBe(3); // W2, W3 live + W5 older
      // (b) APPROVED with dates today or later (leave still to be taken)
      expect(cell(rows, { section: "B.", company: "Dubai Co", item_type: "leave_request", status: "approved", scope: IN })).toBe(2);
      expect(cell(rows, { section: "B.", company: "Riyadh Co", item_type: "leave_request", status: "approved", scope: IN })).toBe(1);
      // (c) COMPLETED OR HISTORICAL: approved and past, rejected, cancelled
      expect(cell(rows, { section: "C.", company: "Dubai Co", item_type: "leave_request", status: "approved", scope: IN })).toBe(1);
      expect(cell(rows, { section: "C.", company: "Dubai Co", item_type: "leave_request", status: "rejected", scope: IN })).toBe(1);
      expect(cell(rows, { section: "C.", company: "Dubai Co", item_type: "leave_request", status: "cancelled", scope: IN })).toBe(2);
      expect(cell(rows, { section: "C.", company: "Dubai Co", item_type: "recovery_leave_request:window", status: "approved", scope: IN })).toBe(1);
      expect(cell(rows, { section: "C.", company: "Doha Legacy Co", item_type: "comp_off_request:standard", status: "approved", scope: IN })).toBe(1);
      // E: what the write step would change; the look-back keeps old exceptions out
      expect(cell(rows, { section: "E.", company: "Dubai Co", item_type: "attendance_alert:presence_conflict" })).toBe(2);
      expect(cell(rows, { section: "E.", company: "Dubai Co", item_type: "attendance_alert:window_needs_hr_verification" })).toBe(2);
      expect(cell(rows, { section: "E.", company: "Dubai Co", item_type: "leave_request" })).toBe(1);
      // F: approval steps, including the orphan, and another type that is only counted
      expect(cell(rows, { section: "F.", company: "Dubai Co", item_type: "approval_step:leave_request", status: "pending (ORPHAN: request already cancelled, rejected or removed)", scope: IN })).toBe(1);
      expect(rows.filter((r) => String(r.item_type).startsWith("approval_step:reimbursement_claim")).map((r) => Number(r.count))).toEqual([1]);
    });
  });

  // ------------------------------------------------------------------ 2. IMPACT
  describe("step 2: the impact (read-only)", () => {
    let rows: Row[];
    const flagged = (id: string) => rows.find((r) => String(r.section).startsWith("1.") && r.item_id === id);
    const proposal = (id: string) => rows.filter((r) => String(r.section).startsWith("3. ") && r.item_id === id);
    const detail = (r: Row | undefined) => JSON.parse(String(r?.detail ?? "{}")) as Row;
    beforeAll(async () => {
      rows = await runScript(withCutoff(IMPACT_SQL, CUTOFF), true);
    });

    it("flags exactly the requests that moved a leave balance, a comp-off credit, an attendance record or a payroll export", async () => {
      expect(String(flagged(ids.L_appr!)?.summary)).toMatch(/^LEAVE-LEDGER;/);
      expect(String(flagged(ids.L_appr!)?.summary)).toContain("LEAVES IT IN PLACE unless you list its id as an approved reversal");
      expect(String(flagged(ids.L_pay!)?.summary)).toMatch(/LEAVE-LEDGER PAYROLL-LINE PAYROLL-PERIOD/);
      expect(String(flagged(ids.L_past!)?.summary)).toMatch(/^LEAVE-LEDGER;/);
      expect(String(flagged(ids.LG3_req!)?.summary)).toMatch(/COMP-LEDGER ATTENDANCE/);
      expect(String(flagged(ids.W6_req!)?.summary)).toMatch(/COMP-LEDGER ATTENDANCE/); // clock segments are its evidence
      // a pending window request was born from clock segments, nothing posted; a pending leave request moved nothing
      expect(String(flagged(ids.W7_req!)?.summary)).toBe("ATTENDANCE; the write step: cancels the request (nothing was posted, nothing is reversed)");
      expect(flagged(ids.L_pend!)).toBeUndefined();
      expect(flagged(ids.L_post!)).toBeUndefined(); // at or after the cutoff: not in scope, not listed
      expect(detail(flagged(ids.L_appr!))).toMatchObject({ leave_ledger_rows: 1, leave_ledger_net_days: -2, payroll_lines_referencing_its_ledger_rows: 0 });
      expect(detail(flagged(ids.L_pay!))).toMatchObject({ payroll_lines_referencing_its_ledger_rows: 1, approved_or_sent_payroll_periods_covering_its_dates: 1 });
      expect(detail(flagged(ids.LG3_req!))).toMatchObject({ comp_ledger_rows: 1, comp_ledger_net_days: 1, attendance_records_linked: 1 });
    });

    it("lists the exact ledger rows and the PROPOSED REVERSAL entries (a new reversing row; nothing is written)", async () => {
      const led = await one(`select id::text as id from leave_ledger where reference_type = 'leave_request' and reference_id = '${ids.L_appr}'`);
      const ledgerRows = rows.filter((r) => String(r.section).startsWith("2.") && r.item_id === ids.L_appr);
      expect(ledgerRows).toHaveLength(1);
      expect(detail(ledgerRows[0])).toMatchObject({ ledger: "leave_ledger", ledger_row_id: led.id, entry_type: "deduction", amount: -2, already_reversed: false });
      const p = proposal(ids.L_appr!);
      expect(p).toHaveLength(1);
      expect(String(p[0]!.summary)).toBe("would insert a leave_ledger reversal of 2.00");
      expect(detail(p[0])).toMatchObject({ table: "leave_ledger", entry_type: "reversal", amount: 2, reversal_of_id: led.id, reference_type: "leave_request", reference_id: ids.L_appr, blocked: null });
      expect(detail(p[0]).txn_date).toBe((await one("select current_date::text as d")).d);
      // comp-off: the daily credit (reference = the attendance record) and the window credit (reference = the request)
      expect(detail(proposal(ids.LG3_req!)[0])).toMatchObject({ table: "comp_day_ledger", amount: -1, reversal_of_id: ids.LG3_led, reference_type: "attendance_record", reference_id: ids.LG3_rec });
      expect(detail(proposal(ids.W6_req!)[0])).toMatchObject({ table: "comp_day_ledger", amount: -0.5, reference_type: "recovery_credit_request", reference_id: ids.W6_req });
      // blocked proposals say why: a payroll line points at it; the leave has already started
      expect(String(proposal(ids.L_pay!)[0]!.summary)).toMatch(/^BLOCKED: a payroll export line already references this ledger row/);
      expect(String(proposal(ids.L_past!)[0]!.summary)).toMatch(/^BLOCKED: the leave has already started/);
      // nothing is proposed for an item that is not approved or not in scope
      expect(proposal(ids.L_pend!)).toEqual([]);
      expect(proposal(ids.L_post!)).toEqual([]);
    });

    it("shows the balance now, the change and the balance after, per employee", async () => {
      const balance = async (p: Person) => {
        const emp = await one(`select first_name || ' ' || last_name as n from employees where id = '${p.employeeId}'`);
        return detail(rows.find((r) => String(r.section).startsWith("4.") && r.employee === emp.n && r.item_type === "leave_ledger:annual"));
      };
      expect(await balance(eA2)).toMatchObject({ balance_now: 18, change: 2, balance_after: 20, blocked_rows: 0 });
      expect(await balance(eA3)).toMatchObject({ balance_now: 18, change: 0, balance_after: 18, blocked_rows: 1 }); // payroll-referenced: excluded
    });

    it("prints a snapshot of the source records the write step must never change", async () => {
      const snap = Object.fromEntries(rows.filter((r) => String(r.section).startsWith("5.")).map((r) => [r.summary as string, r.detail as string]));
      expect(snap["attendance_records (rows)"]).toBe((await one("select count(*)::text as n from attendance_records")).n);
      expect(snap["payroll_export_lines (rows / net amount)"]).toBe("1 / 50.00");
      expect(snap["approvals of other types, pending"]).toBe("1");
    });
  });

  // ------------------------------------------------------------------ 3. CLEANUP: refusals first (each leaves everything untouched)
  describe("step 3: the cleanup refuses to run when a precondition fails", () => {
    beforeAll(async () => {
      fpBefore = await fingerprint();
      st0 = await states();
    });
    const untouched = async () => {
      expect(await fingerprint()).toEqual(fpBefore);
      expect(await states()).toEqual(st0);
    };

    it("REFUSES while the cutoff is still the placeholder, and changes nothing", async () => {
      await expect(runScript(CLEANUP_SQL)).rejects.toThrow(/REFUSING TO RUN: the cutoff is still the placeholder/);
      await expect(runScript(cleanupSql({ actor: hrAe.userId }))).rejects.toThrow(/REFUSING TO RUN: the cutoff is still the placeholder/); // actor set, cutoff not
      await untouched();
    });

    it("REFUSES a cutoff in the future, and an actor that is not a real sign-in account", async () => {
      await expect(runScript(cleanupSql({ cutoff: iso(NOW + DAY), actor: hrAe.userId }))).rejects.toThrow(/cutoff .* is in the future/);
      await expect(runScript(cleanupSql({ cutoff: CUTOFF }))).rejects.toThrow(/EDIT 3 \(actor_user_id\) is not the id of a real sign-in account/);
      await expect(runScript(cleanupSql({ cutoff: CUTOFF, actor: randomUUID() }))).rejects.toThrow(/EDIT 3 \(actor_user_id\)/);
      await untouched();
    });

    it("REFUSES when an audit trigger is disabled (the audit trail must still fire)", async () => {
      await db.seed("alter table recovery_alerts disable trigger audit_recovery_alerts");
      try {
        await expect(runCleanup()).rejects.toThrow(/audit triggers this file relies on are missing or disabled/);
      } finally {
        await db.seed("alter table recovery_alerts enable trigger audit_recovery_alerts");
      }
      await untouched();
    });

    it("verify says FAIL for every queue check BEFORE the cleanup (the checks do detect outstanding items)", async () => {
      const problems = verifyProblems(await verify());
      expect(problems.map((p) => p.split(":")[0])).toEqual(["2", "3", "4", "5", "6", "11"]);
    });
  });

  // ------------------------------------------------------------------ 3. CLEANUP: the run with an EMPTY approved-reversal list
  describe("step 3: the cleanup with an EMPTY approved-reversal list", () => {
    let result: Row[];
    let post0: string;
    let auditBefore: number;

    beforeAll(async () => {
      fpBefore = await fingerprint();
      post0 = await postCutoffHash();
      auditBefore = Number((await one("select count(*)::int as n from audit_log")).n);
      pre = {
        hrItems: await hrQueue(hrAe),
        mgrSteps: await pendingSteps(mgrAe),
        hrInbox: await hrInbox(hrAe),
        eA1Pending: Number((await as(eA1, "select count(*)::int as n from leave_requests where employee_id = $1 and status in ('submitted', 'pending_approval')", [eA1.employeeId]))[0]!.n),
        counts: await states(),
      };
      result = await runCleanup();
    });

    it("prints the cutoff it used, then what it changed by company, type and status", async () => {
      expect(String(result[0]!.section)).toMatch(/^0\./);
      expect(String(result[0]!.result)).toContain(CUTOFF.slice(0, 16).replace("T", " "));
      expect(change(result, { company: "Dubai Co", item_type: "leave_request", result: "cancelled (was submitted)" })).toBe(1);
      expect(change(result, { company: "Riyadh Co", item_type: "leave_request", result: "cancelled (was submitted)" })).toBe(1);
      expect(change(result, { company: "Dubai Co", item_type: "approval_step:leave_request (orphan)" })).toBe(1);
      expect(change(result, { company: "Dubai Co", item_type: "recovery_leave_request:window", result: "cancelled (was submitted)" })).toBe(4);
      expect(change(result, { company: "Dubai Co", item_type: "recovery_leave_request:window", result: "cancelled (was pending_approval)" })).toBe(1);
      expect(change(result, { company: "Doha Legacy Co", item_type: "comp_off_request:standard", result: "cancelled (was submitted)" })).toBe(2);
      expect(change(result, { company: "Dubai Co", item_type: "recovery_alert:long_work", action: "acknowledged" })).toBe(3);
      expect(change(result, { company: "Dubai Co", item_type: "recovery_alert:window_rollover", action: "acknowledged" })).toBe(1);
      expect(change(result, { company: "Dubai Co", item_type: "attendance_alert:presence_conflict", action: "acknowledged" })).toBe(2); // AX1, AX4: AX3 is older than the look-back
      expect(change(result, { company: "Dubai Co", item_type: "attendance_alert:window_needs_hr_verification", action: "acknowledged" })).toBe(2);
      const total = result.find((r) => r.action === "TOTAL")!;
      expect(Number(total.count)).toBe(1 + 1 + 1 + 4 + 1 + 2 + 3 + 1 + 2 + 2);
      expect(total.result).toBe("rows changed or written");
      expect(result.some((r) => String(r.section).startsWith("1.") && String(r.action).includes("ledger"))).toBe(false); // no ledger row is written with an empty list
    });

    it("reports the approved items it LEFT IN PLACE (including the ones that moved a ledger) and writes no ledger row", async () => {
      expect(left(result, { company: "Dubai Co", item_type: "leave_request" })).toBe(3); // L_appr, L_pay, L_past
      expect(left(result, { company: "Riyadh Co", item_type: "leave_request" })).toBe(1);
      expect(left(result, { company: "Dubai Co", item_type: "recovery_leave_request:window" })).toBe(1);
      expect(left(result, { company: "Doha Legacy Co", item_type: "comp_off_request:standard" })).toBe(1);
      for (const k of ["L_appr", "L_pay", "L_past", "L_appr_sa"]) expect(await statusOf("leave_requests", ids[k]!)).toBe("approved");
      expect(await statusOf("recovery_credit_requests", ids.W6_req!)).toBe("approved");
      expect(await statusOf("recovery_credit_requests", ids.LG3_req!)).toBe("approved");
    });

    it("cancelled every in-scope outstanding request through the app's own statuses, closing its approval steps with the marker", async () => {
      expect(await statusOf("leave_requests", ids.L_pend!)).toBe("cancelled");
      expect(await statusOf("leave_requests", ids.L_pend_sa!)).toBe("cancelled");
      expect((await decisionsOf(ids.L_pend!))[0]).toEqual({ d: "cancelled", comments: MARKER });
      expect((await decisionsOf(ids.L_orphan!))[0]).toEqual({ d: "cancelled", comments: MARKER }); // the orphan step is closed
      for (const k of ["W1", "W2", "W3", "W5", "W7"]) {
        const rs = await winReq(k);
        expect(rs.map((r) => r.status)).toEqual(["cancelled"]);
        expect((await decisionsOf(rs[0]!.id)).every((d) => d.d === "cancelled" || d.d === "approved")).toBe(true);
        expect((await one(`select correction_reason from recovery_credit_requests where id = '${rs[0]!.id}'`)).correction_reason).toBe(MARKER);
      }
      expect((await decisionsOf(ids.W7_req!)).map((d) => d.d)).toEqual(["approved", "cancelled"]); // step 1 approved earlier stays, the queue step is closed
      for (const e of [eQ1, eQ2]) expect((await q(`select status::text as s from recovery_credit_requests where employee_id = '${e.employeeId}'`)).map((r) => r.s)).toEqual(["cancelled"]);
    });

    it("dismissed the old alerts: Recovery Leave alerts acknowledged with the marker; attendance exceptions acknowledged without touching their source", async () => {
      const a = await q(`select alert_type, status, acknowledgement_note, acknowledged_by::text as by from recovery_alerts where employee_id in (select employee_id from recovery_alerts) order by triggered_at`);
      const old = a.filter((r) => r.status === "acknowledged");
      expect(old).toHaveLength(4);
      expect(old.every((r) => r.acknowledgement_note === MARKER && r.by === hrAe.userId)).toBe(true);
      expect((await q("select count(*)::int as n from recovery_alerts where status = 'open'"))[0]!.n).toBe(1); // W4's, triggered after the cutoff
      const acks = await q("select source_id::text as id, note from hr_queue_acknowledgements where kind = 'attendance' order by source_id");
      expect(acks.map((r) => r.id).sort()).toEqual([ids.AX1, ids.AX4, ...(await q(`select id::text as id from recovery_windows where hr_verification_required and hr_verified_at is null and employee_id in ('${W.W2!.employeeId}', '${W.W3!.employeeId}')`)).map((r) => r.id)].sort());
      expect(acks.every((r) => r.note === MARKER)).toBe(true);
      expect(await ackCount()).toBe(4);
    });

    it("preserves audit history: every change fired the audit trigger with origin prelaunch_cleanup, with before and after; nothing was deleted", async () => {
      const by = await q("select table_name, action, count(*)::int as n from audit_log where origin = 'prelaunch_cleanup' group by 1, 2 order by 1, 2");
      const map = Object.fromEntries(by.map((r) => [`${r.table_name}/${r.action}`, r.n]));
      expect(map).toEqual({
        "approvals/update": 3 + 5 + 2, // L_pend, SA, orphan; W1, W2, W3, W5 step 1 and W7 step 2; the two Doha steps
        "hr_queue_acknowledgements/insert": 4,
        "leave_requests/update": 2,
        "recovery_alerts/update": 4,
        "recovery_credit_requests/update": 7,
      });
      const lp = (await q(`select before_data ->> 'status' as b, after_data ->> 'status' as a, actor_id from audit_log where origin = 'prelaunch_cleanup' and table_name = 'leave_requests' and record_id = '${ids.L_pend}'`))[0]!;
      expect(lp).toEqual({ b: "submitted", a: "cancelled", actor_id: null }); // the cleanup never impersonates a person
      expect(Number((await one("select count(*)::int as n from audit_log")).n)).toBeGreaterThan(auditBefore);
      // no hard delete and no new request / approval / alert row: only the four acknowledgements were added
      const now = await states();
      for (const t of ["leave_requests", "approvals", "recovery_credit_requests", "recovery_alerts"]) expect(now[t]!.split(":")[0]).toBe(pre.counts[t]!.split(":")[0]);
      expect(Number(now.hr_queue_acknowledgements!.split(":")[0])).toBe(Number(pre.counts.hr_queue_acknowledgements!.split(":")[0]) + 4);
    });

    it("leaves the source attendance records, clock evidence, windows, payroll and every ledger row exactly as they were", async () => {
      expect(await fingerprint()).toEqual(fpBefore);
      expect((await one(`select count(*)::int as n from attendance_records where presence_conflict is not null`)).n).toBe(4); // AX1..AX4 still flagged at their source
    });

    it("leaves everything submitted or triggered at or after the cutoff, and every unrelated approval, exactly as it was", async () => {
      expect(await postCutoffHash()).toBe(post0);
      expect(await statusOf("leave_requests", ids.L_post!)).toBe("submitted");
      expect(await winReq("W4").then((r) => r.map((x) => x.status))).toEqual(["submitted"]);
      expect((await decisionsOf(ids.other_claim!))[0]).toEqual({ d: "pending", comments: null });
    });

    it("is RE-RUNNABLE: a second run changes nothing at all (no row, no audit entry) and says so", async () => {
      const s1 = await states();
      const second = await runCleanup();
      const total = second.find((r) => r.action === "TOTAL")!;
      expect(Number(total.count)).toBe(0);
      expect(total.result).toMatch(/^NOTHING TO CHANGE/);
      expect(second.filter((r) => String(r.section).startsWith("1.") && r.action !== "TOTAL")).toEqual([]);
      expect(await states()).toEqual(s1);
      expect(await fingerprint()).toEqual(fpBefore);
    });

    it("verify (step 4) passes: no in-scope outstanding item, audit rows for what was cleared, ledgers untouched, a re-run would change nothing", async () => {
      const rows = await verify();
      expect(verifyProblems(rows)).toEqual([]);
      const info = (label: string) => rows.find((r) => String(r.item).startsWith(label))!.result;
      expect(info("information: attendance_records")).toBe(`${(await one("select count(*)::int as n from attendance_records")).n} / 4 / ${(await one("select count(*)::int as n from attendance_sessions")).n}`);
      expect(info("information: reversal rows written by the cleanup")).toBe("0 / 0");
      expect(info("information: in-scope APPROVED requests still approved")).toBe("6 / 6"); // 4 leave (Dubai 3, Riyadh 1), the window credit, the daily comp-off: all moved a ledger
    });
  });

  // ------------------------------------------------------------------ 5. NO REAPPEARANCE (the source records are unchanged: the generators are run again)
  describe("no reappearance: old requests and alerts do not come back from unchanged source records", () => {
    it("the Recovery Leave engine, run again for every employee and the scheduler run twice, creates no request, alert, window revision or acknowledgement", async () => {
      await setClock(cutoffClock); // the clock stands where it stood when the old evidence was recorded: nothing new has happened
      const snap = async () => ({
        requests: await q("select id, status::text as status, window_revision_no from recovery_credit_requests order by id"),
        alerts: await q("select id, status, dedup_key, acknowledgement_note from recovery_alerts order by id"),
        windows: await q("select id, revision_no, status, entitlement_days::text as d, hr_verification_required, hr_verified_at from recovery_windows order by id"),
        acks: await q("select id, kind, source_id, source_date::text as d from hr_queue_acknowledgements order by id"),
        periods: await q("select id, status from recovery_periods order by id"),
      });
      const before = await snap();
      for (const k of ["W1", "W2", "W3", "W5", "W6", "W7"]) { await recalc(W[k]!); await recalc(W[k]!); }
      for (let i = 0; i < 2; i++) await db.seed("select recovery_process_due('prelaunch-test')");
      expect(await snap()).toEqual(before);
    });

    it("WHY: the alert's dedup key is unique and its row is kept, so a dismissed alert still blocks a second one; a cancelled window request is the final answer for that revision", async () => {
      const a = await q(`select a.dedup_key, a.status from recovery_alerts a where a.employee_id = '${W.W2!.employeeId}'`);
      expect(a).toHaveLength(1);
      expect(a[0]!.status).toBe("acknowledged");
      // the very insert the engine makes, repeated, is refused by the unique key (on conflict do nothing): no new row
      await db.seed(`insert into recovery_alerts (company_id, employee_id, period_id, alert_type, dedup_key, triggered_at, period_started_at, recorded_seconds, elapsed_seconds)
                     select company_id, employee_id, period_id, alert_type, dedup_key, triggered_at, period_started_at, recorded_seconds, elapsed_seconds from recovery_alerts where employee_id = '${W.W2!.employeeId}'
                     on conflict (dedup_key) do nothing`);
      expect(await alerts(W.W2!)).toHaveLength(1);
      expect((await alerts(W.W2!))[0]!.status).toBe("acknowledged");
      const r = await winReq("W2");
      const w = await windows(W.W2!);
      expect(r).toHaveLength(1);
      expect(r[0]!.status).toBe("cancelled");
      expect(Number(r[0]!.window_revision_no)).toBeGreaterThanOrEqual(w[0]!.revision_no); // answered for the window's CURRENT revision: the engine does not ask again
    });

    it("the attendance-presence generator, run twice for the flagged day, changes neither the flag nor the acknowledgement (the same record id and date keep matching it)", async () => {
      const row = () => one(`select id::text as id, presence_conflict from attendance_records where id = '${ids.AX4}'`);
      const before = await row();
      for (let i = 0; i < 2; i++) await db.seed(`select sync_attendance_presence_for_day('${eAz.employeeId}', '${ids.AX4_date}')`);
      expect(await row()).toEqual(before);
      expect(await ackCount()).toBe(4);
      const items = await hrQueue(hrAe, eAz.employeeId);
      expect(items.map((i) => [i.kind, i.state])).toEqual([["attendance", "acknowledged"]]);
    });
  });

  // ------------------------------------------------------------------ 6. CONSISTENCY across My Day, Alerts, Approvals and the employee profile
  describe("consistency: My Day, Alerts, Approvals and the employee profile agree after the cleanup", () => {
    it("the HR queue (Alerts page, My Day count, profile block) shows only what is new, and its three views add up", async () => {
      // BEFORE the cleanup everything old was waiting: 3 conflicts + 3 windows + 5 alerts
      expect(countByState(pre.hrItems)).toEqual({ needs_action: 11, due_soon: 0, acknowledged: 0 });
      expect(myDayCount(pre.hrItems)).toBe(11);
      const alertsPage = await hrQueue(hrAe);
      const states2 = countByState(alertsPage);
      expect(states2).toEqual({ needs_action: 3, due_soon: 0, acknowledged: 8 }); // AX2, W4's window, W4's alert wait; the 8 cleared ones are listed as acknowledged with the marker
      expect(myDayCount(alertsPage)).toBe(states2.needs_action + states2.due_soon); // My Day's count IS the Alerts page's open count
      expect(alertsPage.filter((i) => i.state === "acknowledged").every((i) => i.acknowledged?.note === MARKER)).toBe(true);
      expect(alertsPage.filter((i) => i.state === "needs_action").map((i) => i.kind).sort()).toEqual(["attendance", "attendance", "recovery_alert"]);
      // the employee profile block: the same loader narrowed to one person; summed over the company it equals the Alerts page, item for item
      const emps = await q(`select id::text as id from employees where company_id = '${COMPANY_AE}'`);
      const profiles = await Promise.all(emps.map((e) => hrQueue(hrAe, e.id as string)));
      expect(profiles.flat().map((i) => `${i.key}|${i.state}`).sort()).toEqual(alertsPage.map((i) => `${i.key}|${i.state}`).sort());
      expect(profiles.reduce((n, p) => n + myDayCount(p), 0)).toBe(myDayCount(alertsPage));
      expect(await hrQueue(hrAe, wIdle.employeeId)).toEqual([]); // a person with nothing flagged has an empty block
    });

    it("Approvals: nobody is asked to decide a cleared request any more; the new request and the unrelated approval still wait", async () => {
      expect(pre.mgrSteps).toBe(4); // L_pend, L_post, the orphan, the expense claim
      expect(await pendingSteps(mgrAe)).toBe(2); // L_post (after the cutoff) and the expense claim (another type)
      expect(pre.hrInbox).toBe(1); // W7's HR queue step
      expect(await hrInbox(hrAe)).toBe(0);
      // every lead of a cleared window request has nothing pending; W4's lead (after the cutoff) still has one
      for (const k of ["W1", "W2", "W3", "W5", "W7"]) {
        const lead = (await winReq(k))[0]!.project_lead_employee_id;
        const leadUser = (await one(`select user_id::text as u from employees where id = '${lead}'`)).u as string;
        expect(Number((await one(`select count(*)::int as n from approvals where approver_id = '${leadUser}' and decision = 'pending'`)).n)).toBe(0);
      }
      const l4 = (await winReq("W4"))[0]!.project_lead_employee_id;
      expect(Number((await one(`select count(*)::int as n from approvals where approver_id = (select user_id from employees where id = '${l4}') and decision = 'pending'`)).n)).toBe(1);
    });

    it("the employee profile (Leave tab) and My Day 'waiting on others' count the same pending requests: only what was submitted after the cutoff", async () => {
      expect(pre.eA1Pending).toBe(2);
      for (const viewer of [hrAe, eA1]) {
        const leaveRows = await as(viewer, "select id from leave_requests where employee_id = $1 and status in ('submitted', 'pending_approval') and deleted_at is null", [eA1.employeeId]);
        expect(leaveRows.map((r) => r.id)).toEqual([ids.L_post]);
      }
      // Recovery Leave earning requests waiting (Leave tab and My Day): W4's only, over the whole company
      const pending = await as(hrAe, `select r.id from recovery_credit_requests r join employees e on e.id = r.employee_id where e.company_id = '${COMPANY_AE}' and r.status in ('submitted', 'pending_approval')`);
      expect(pending.map((r) => r.id)).toEqual([(await winReq("W4"))[0]!.id]);
      // KNOWN GAP (reported, not changed here): the profile's Attendance tab "Needs review" block reads the SOURCE rows and does not look at acknowledgements, so an acknowledged
      // exception inside the 60-day look-back is still listed THERE (Alerts, My Day and the Overview block do count it as seen). The source record must not be changed by a cleanup.
      const tab = await as(hrAe, `select id from attendance_records where employee_id = '${eAx.employeeId}' and presence_conflict is not null and work_date >= current_date - 60`);
      expect(tab).toHaveLength(1);
    });

    it("people who may not see HR's queue see none of it (the packs run as the owner; the app does not)", async () => {
      const count = async (p: Person, t: string) => Number((await as(p, `select count(*)::int as n from ${t}`))[0]!.n);
      // an ordinary employee: no alerts, no acknowledgements, only their own leave, no other person's approval step
      expect(await count(eA1, "recovery_alerts")).toBe(0);
      expect(await count(eA1, "hr_queue_acknowledgements")).toBe(0);
      expect((await as(eA1, "select distinct employee_id from leave_requests")).map((r) => r.employee_id)).toEqual([eA1.employeeId]);
      expect(Number((await as(eA1, `select count(*)::int as n from approvals where entity_type = 'reimbursement_claim'`))[0]!.n)).toBe(0);
      // a project lead sees no alerts either
      expect(await count(leadAe, "recovery_alerts")).toBe(0);
      // HR of another company sees nothing of this company
      for (const t of ["leave_requests", "recovery_alerts", "hr_queue_acknowledgements", "attendance_records", "recovery_credit_requests"]) expect(await count(hrOther, t)).toBe(0);
      // HR of Riyadh Co sees only their own company's leave, and none of Dubai's alerts or acknowledgements
      expect((await as(hrSa, "select distinct employee_id from leave_requests")).map((r) => r.employee_id).sort()).toEqual([eS1.employeeId, eS2.employeeId].sort());
      expect(await count(hrSa, "recovery_alerts")).toBe(0);
      expect(await count(hrSa, "hr_queue_acknowledgements")).toBe(0);
      // the CEO reads the company's Recovery Leave alerts and the window acknowledgements, but NOT the attendance-day acknowledgements (that source table is not theirs to read)
      expect(await count(ceoAe, "recovery_alerts")).toBe(5);
      expect(await count(ceoAe, "hr_queue_acknowledgements")).toBe(2); // the two Recovery Leave window ones; the two attendance-day ones are not readable by a CEO
      // HR Admin of the company reads them all
      expect(await count(hrAe, "recovery_alerts")).toBe(5);
      expect(await count(hrAe, "hr_queue_acknowledgements")).toBe(4);
    });
  });

  // ------------------------------------------------------------------ 7. NEW items after the cutoff appear normally
  describe("new requests and alerts created after the cleanup appear normally everywhere", () => {
    it("a NEW leave application (the app's own submit function) is pending, routed to the manager, and counted in Approvals, the profile and My Day", async () => {
      const beforeSteps = await pendingSteps(mgrAe);
      const id = await db.asUserCommit(eA7.userId, async (query) => (await query("select submit_leave_request('annual', current_date + 90, current_date + 91, false, false, 2, 'a new request') as id")).rows[0].id as string);
      ids.L_new = id;
      expect(await statusOf("leave_requests", id)).toBe("submitted");
      expect((await decisionsOf(id)).map((d) => d.d)).toEqual(["pending"]);
      expect(await pendingSteps(mgrAe)).toBe(beforeSteps + 1);
      expect((await as(eA7, "select id from leave_requests where employee_id = $1 and status in ('submitted', 'pending_approval')", [eA7.employeeId])).map((r) => r.id)).toEqual([id]);
      expect((await as(hrAe, "select id from leave_requests where employee_id = $1 and status = 'submitted'", [eA7.employeeId])).map((r) => r.id)).toEqual([id]);
      // verify still passes: the new item is at or after the cutoff and is not "outstanding in scope"
      expect(verifyProblems(await verify())).toEqual([]);
    });

    it("a NEW alert from the engine after the cutoff (the open session's next 24-hour boundary) appears once, while the cleared alert and request stay cleared", async () => {
      const oldAlerts = await alerts(W.W3!);
      const oldReq = await winReq("W3");
      expect(oldAlerts.map((a) => a.status)).toEqual(["acknowledged", "acknowledged"]);
      expect(oldReq).toHaveLength(1);
      await setClock(plusSeconds(ids.W3_start!, 49 * H));
      for (let i = 0; i < 2; i++) await db.seed("select recovery_process_due('prelaunch-test')");
      const now = await alerts(W.W3!);
      expect(now.map((a) => [a.alert_type, a.status])).toEqual([["long_work", "acknowledged"], ["window_rollover", "acknowledged"], ["window_rollover", "open"]]);
      expect(now.slice(0, 2).map((a) => a.id)).toEqual(oldAlerts.map((a) => a.id)); // the old rows, untouched
      expect(new Date(now[2]!.triggered_at).getTime()).toBeGreaterThan(Date.parse(CUTOFF)); // triggered after the cutoff
      const reqs = await winReq("W3");
      expect(reqs.map((r) => r.status)).toEqual(["cancelled", "submitted"]); // the old one stays cancelled; window 2's is new and pending
      expect(reqs[0]!.id).toBe(oldReq[0]!.id);
      // it shows in the queue as needing action, with the cleared ones listed as acknowledged
      const items = await hrQueue(hrAe, W.W3!.employeeId);
      expect(items.filter((i) => i.kind === "recovery_alert").map((i) => i.state).sort()).toEqual(["acknowledged", "acknowledged", "needs_action"]);
      // and the cleanup, run again, leaves the new request and alert alone (they are after the cutoff) and changes nothing
      const again = await runCleanup();
      expect(Number(again.find((r) => r.action === "TOTAL")!.count)).toBe(0);
      expect((await winReq("W3")).map((r) => r.status)).toEqual(["cancelled", "submitted"]);
    });

    it("a NEW attendance exception on a new day appears as needing action in Alerts and the profile block, and My Day counts it", async () => {
      const before = await hrQueue(hrAe);
      await db.seed(`insert into attendance_records (employee_id, work_date, status, work_mode, hours_worked, source, presence_conflict)
                     values ('${eAy.employeeId}', current_date - 1, 'present', 'office', 8, 'manual', 'A new disagreement between the manual entry and the clock.')`);
      const after = await hrQueue(hrAe);
      expect(after.length).toBe(before.length + 1);
      expect(myDayCount(after)).toBe(myDayCount(before) + 1);
      const mine = await hrQueue(hrAe, eAy.employeeId);
      expect(mine.filter((i) => i.state === "needs_action")).toHaveLength(2); // the earlier AX2 and the new one
      expect(await ackCount()).toBe(4); // nothing was acknowledged by itself
    });
  });

  // ------------------------------------------------------------------ 8. APPROVED REVERSALS: only the ids the owner lists, as new reversing rows
  describe("step 3 again: the approved-reversal list (explicit ids only; reversals are new rows, never edits or deletes)", () => {
    let fp: Record<string, string>;
    const untouched2 = async (label: string) => {
      expect(await fingerprint(), label).toEqual(fp);
    };

    beforeAll(async () => {
      fp = await fingerprint();
    });

    it("REFUSES a listed id that is not found, is after the cutoff, is not approved, has already started, or has a payroll line pointing at its ledger row", async () => {
      await expect(runCleanup({ reversals: [randomUUID()] })).rejects.toThrow(/is not a leave request or a Recovery Leave \/ comp-off request/);
      await expect(runCleanup({ reversals: [ids.L_post!] })).rejects.toThrow(/submitted at or after the cutoff/);
      await expect(runCleanup({ reversals: [ids.L_rej!] })).rejects.toThrow(/is rejected, not approved/);
      await expect(runCleanup({ reversals: [ids.L_past!] })).rejects.toThrow(/has already started/);
      await expect(runCleanup({ reversals: [ids.L_pay!] })).rejects.toThrow(/payroll export line already references/);
      await untouched2("refusals");
      expect(await statusOf("leave_requests", ids.L_pay!)).toBe("approved");
    });

    it("REFUSES a window credit whose window still has another live request (a top-up) that is not in the list, and changes nothing", async () => {
      const sibling = randomUUID();
      await db.seed(`insert into recovery_credit_requests (id, employee_id, segment_id, work_date, event_type, proposed_days, status, created_by, recovery_window_id, window_revision_no, adjusts_request_id, applicant_route)
                     select '${sibling}', employee_id, segment_id, work_date, 'window_top_up', 0.5, 'submitted', '${hrAe.userId}', recovery_window_id, window_revision_no, id, applicant_route
                     from recovery_credit_requests where id = '${ids.W6_req}'`);
      const fpSibling = await fingerprint();
      await expect(runCleanup({ reversals: [ids.W6_req!] })).rejects.toThrow(/still has another live request/);
      expect(await fingerprint()).toEqual(fpSibling);
      expect(await statusOf("recovery_credit_requests", ids.W6_req!)).toBe("approved");
      await db.seed(`delete from recovery_credit_requests where id = '${sibling}'`); // test housekeeping only (the fixture's own row)
    });

    it("REFUSES a reversal that would take a comp-off balance below zero (days already used) and changes nothing", async () => {
      const used = randomUUID();
      await db.seed(`insert into comp_day_ledger (id, employee_id, txn_date, entry_type, days, reference_type, reference_id, created_by)
                     values ('${used}', '${eQ3.employeeId}', current_date, 'redeemed', -1, 'leave_request', '${randomUUID()}', '${hrQa.userId}')`);
      const fpUsed = await fingerprint();
      await expect(runCleanup({ reversals: [ids.LG3_req!] })).rejects.toThrow(/comp-off balance of employee .* \(days already used\)/);
      expect(await fingerprint()).toEqual(fpUsed);
      expect(await statusOf("recovery_credit_requests", ids.LG3_req!)).toBe("approved");
      await db.seed(`delete from comp_day_ledger where id = '${used}'`); // test housekeeping only (the fixture's own row)
      fp = await fingerprint();
    });

    it("with ids listed: cancels them and WRITES NEW reversing ledger rows (same employee, opposite amount, reversal_of_id, today), leaving every original row byte for byte", async () => {
      const list = [ids.L_appr!, ids.L_appr_sa!, ids.LG3_req!, ids.W6_req!];
      const orig = await q(`select 'leave' as t, id::text as id, to_jsonb(l)::text as j from leave_ledger l union all select 'comp', id::text, to_jsonb(c)::text from comp_day_ledger c order by 2`);
      const bal = async (sql: string) => Number((await one(sql)).b);
      const leaveBal = (p: Person) => bal(`select coalesce(sum(amount_days), 0)::float8 as b from leave_ledger where employee_id = '${p.employeeId}' and leave_type_code = 'annual'`);
      const compBal = (p: Person) => bal(`select coalesce(sum(days), 0)::float8 as b from comp_day_ledger where employee_id = '${p.employeeId}'`);
      expect([await leaveBal(eA2), await leaveBal(eS2), await compBal(eQ3), await compBal(W.W6!)]).toEqual([18, 18, 1, 0.5]);

      const res = await runCleanup({ reversals: list });
      expect(change(res, { company: "Dubai Co", item_type: "leave_ledger", action: "ledger reversal written" })).toBe(1);
      expect(change(res, { company: "Riyadh Co", item_type: "leave_ledger", action: "ledger reversal written" })).toBe(1);
      expect(change(res, { company: "Doha Legacy Co", item_type: "comp_day_ledger", action: "ledger reversal written" })).toBe(1);
      expect(change(res, { company: "Dubai Co", item_type: "comp_day_ledger", action: "ledger reversal written" })).toBe(1);
      expect(change(res, { item_type: "leave_request", result: "cancelled (was approved; ledger rows reversed)" })).toBe(2);
      expect(change(res, { item_type: "recovery_leave_request:window", result: "cancelled (was approved; ledger rows reversed)" })).toBe(1);
      expect(change(res, { item_type: "comp_off_request:standard", result: "cancelled (was approved; ledger rows reversed)" })).toBe(1);

      // the requests are cancelled with the marker; the others (payroll-referenced, past, post-cutoff) are exactly as they were
      for (const id of [ids.L_appr!, ids.L_appr_sa!]) expect(await statusOf("leave_requests", id)).toBe("cancelled");
      for (const id of [ids.LG3_req!, ids.W6_req!]) expect(await statusOf("recovery_credit_requests", id)).toBe("cancelled");
      expect(await statusOf("leave_requests", ids.L_pay!)).toBe("approved");
      expect(await statusOf("leave_requests", ids.L_past!)).toBe("approved");

      // balances come back through NEW rows
      expect([await leaveBal(eA2), await leaveBal(eS2), await compBal(eQ3), await compBal(W.W6!)]).toEqual([20, 20, 0, 0]);
      const rev = await q(`select 'leave' as t, x.employee_id::text, x.amount_days::float8 as amt, x.txn_date::text as d, x.reference_type, x.reference_id::text, x.reversal_of_id::text, x.entry_type::text, x.note, x.created_by::text as by, o.amount_days::float8 as orig_amt, o.employee_id::text as orig_emp
                           from leave_ledger x join leave_ledger o on o.id = x.reversal_of_id where x.entry_type = 'reversal' and x.reference_id in ('${ids.L_appr}', '${ids.L_appr_sa}')`);
      expect(rev).toHaveLength(2);
      for (const r of rev) {
        expect(r.orig_amt).toBe(-r.amt);
        expect(r.orig_emp).toBe(r.employee_id);
        expect(r.d).toBe((await one("select current_date::text as d")).d);
        expect(r.reference_type).toBe("leave_request");
        expect(String(r.note)).toContain(MARKER);
        expect(r.by).toBe(hrAe.userId);
      }
      const compRev = await q(`select x.days::float8 as days, o.days::float8 as orig, x.reference_type, x.source, x.reversal_of_id::text as of from comp_day_ledger x join comp_day_ledger o on o.id = x.reversal_of_id where x.entry_type = 'reversal'`);
      expect(compRev.map((r) => `${r.reference_type}:${r.orig}:${r.days}`).sort()).toEqual(["attendance_record:1:-1", "recovery_credit_request:0.5:-0.5"]);
      // EVERY original ledger row is byte for byte unchanged (nothing edited, nothing deleted); the only new rows are the four reversals
      const after = await q(`select 'leave' as t, id::text as id, to_jsonb(l)::text as j from leave_ledger l union all select 'comp', id::text, to_jsonb(c)::text from comp_day_ledger c order by 2`);
      const origIds = new Set(orig.map((r) => r.id));
      expect(after.filter((r) => origIds.has(r.id))).toEqual(orig);
      expect(after.length).toBe(orig.length + 4);
      // attendance, clock evidence, windows, periods, payroll: unchanged
      const now = await fingerprint();
      for (const t of ["attendance_records", "attendance_sessions", "attendance_segments", "recovery_windows", "recovery_periods", "recovery_window_allocations", "payroll_export_runs", "payroll_export_lines"]) expect(now[t]).toBe(fp[t]);
      // audit: each ledger insert and each cancellation fired the audit trigger with the cleanup origin
      const aud = await q("select table_name, action, count(*)::int as n from audit_log where origin = 'prelaunch_cleanup' and table_name in ('leave_ledger', 'comp_day_ledger') group by 1, 2 order by 1");
      expect(aud).toEqual([{ table_name: "comp_day_ledger", action: "insert", n: 2 }, { table_name: "leave_ledger", action: "insert", n: 2 }]);
    });

    it("the reversal rows have exactly the shape the app's own cancel_leave_request() writes for an approved future leave", async () => {
      await leave({ key: "L_E", person: eA6, approver: mgrAe, from: "current_date + 100", to: "current_date + 101", days: 2, stamp: PRE });
      await approveLeave("L_E", mgrAe);
      await db.asUserCommit(eA6.userId, async (query) => query("select cancel_leave_request($1::uuid)", [ids.L_E]));
      const shape = async (reqId: string) => (await one(`select x.entry_type::text as entry_type, x.reference_type, x.reference_id::text = '${reqId}' as ref_ok, x.txn_date = current_date as dated_today, x.amount_days = -o.amount_days as opposite,
                                                                x.leave_type_code = o.leave_type_code as same_type, x.employee_id = o.employee_id as same_employee
                                                         from leave_ledger x join leave_ledger o on o.id = x.reversal_of_id where x.reference_id = '${reqId}' and x.entry_type = 'reversal'`));
      expect(await shape(ids.L_E!)).toEqual({ entry_type: "reversal", reference_type: "leave_request", ref_ok: true, dated_today: true, opposite: true, same_type: true, same_employee: true });
      expect(await shape(ids.L_appr!)).toEqual(await shape(ids.L_E!).then((s) => ({ ...s })));
      expect(await statusOf("leave_requests", ids.L_E!)).toBe("cancelled"); // the app's status for the same thing
      fp = await fingerprint();
    });

    it("is RE-RUNNABLE with the same list: nothing more is written", async () => {
      const s1 = await states();
      const res = await runCleanup({ reversals: [ids.L_appr!, ids.L_appr_sa!, ids.LG3_req!, ids.W6_req!] });
      expect(Number(res.find((r) => r.action === "TOTAL")!.count)).toBe(0);
      expect(res.filter((r) => String(r.section).startsWith("2.") && String(r.result).startsWith("listed id already cancelled")).reduce((n, r) => n + Number(r.count), 0)).toBe(0); // reported with a zero count
      expect(await states()).toEqual(s1);
      await untouched2("rerun");
    });

    it("a reversed window credit does not come back when the engine runs again, and verify still passes with the reversal rows counted", async () => {
      const before = await q(`select id, status::text as status from recovery_credit_requests where employee_id = '${W.W6!.employeeId}'`);
      await setClock(cutoffClock);
      await recalc(W.W6!);
      await recalc(W.W6!);
      expect(await q(`select id, status::text as status from recovery_credit_requests where employee_id = '${W.W6!.employeeId}'`)).toEqual(before);
      expect(before.map((r) => r.status)).toEqual(["cancelled"]);
      const rows = await verify();
      expect(verifyProblems(rows)).toEqual([]);
      expect(rows.find((r) => String(r.item).startsWith("information: reversal rows written"))!.result).toBe("2 / 2");
      expect(rows.find((r) => String(r.item).startsWith("information: requests the cleanup cancelled after"))!.result).toBe("4");
      expect(rows.find((r) => String(r.item).startsWith("information: in-scope APPROVED requests still approved"))!.result).toBe("2 / 2"); // the payroll-linked and the already-taken leave
    });
  });

  // ------------------------------------------------------------------ 9. THE ONE PATH THAT CAN RECREATE AN OLD DAILY REQUEST
  describe("generation-logic risk (documented, not changed): the daily comp-off rules have no tombstone", () => {
    it("a cleared DAILY comp-off request is recreated ONLY by a new action on that same day (a new clock-out / HR re-saving that day), as a NEW row after the cutoff; the old one stays cancelled", async () => {
      // clock evidence family: sync_attendance_recovery_for_day() looks for a live request for the day and, finding only the cancelled one, writes a fresh one
      const before = await q(`select id::text as id, status::text as status from recovery_credit_requests where employee_id = '${eQ2.employeeId}'`);
      expect(before.map((r) => r.status)).toEqual(["cancelled"]);
      for (let i = 0; i < 2; i++) await db.asUserCommit(eQ2.userId, async (query) => query("select sync_attendance_recovery_for_day($1::uuid, $2::date)", [eQ2.employeeId, ids.fri2]));
      const after = await q(`select id::text as id, status::text as status, submitted_at >= '${CUTOFF}'::timestamptz as post from recovery_credit_requests where employee_id = '${eQ2.employeeId}' order by submitted_at`);
      expect(after.map((r) => r.status)).toEqual(["cancelled", "submitted"]); // exactly one new row (the second call finds it), the old row untouched
      expect(after[0]!.id).toBe(before[0]!.id);
      expect(after[1]!.post).toBe(true);
      // manual-register family: HR saving the same day's entry again
      await db.asUserCommit(hrQa.userId, async (query) => query("select * from record_attendance_and_recovery($1::date, $2::jsonb)", [ids.fri1, JSON.stringify([{ employee_id: eQ1.employeeId, status: "present", work_mode: "office", hours_worked: 10 }])]));
      expect((await q(`select status::text as s from recovery_credit_requests where employee_id = '${eQ1.employeeId}' order by submitted_at`)).map((r) => r.s)).toEqual(["cancelled", "submitted"]);
      // and the window-model engine never does this (proved above): only these two explicit paths, neither of which a refresh or the scheduler calls
    });
  });
});
