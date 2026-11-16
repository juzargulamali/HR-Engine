import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// People & HR Phase 1 (migration 20270115000100_people_hr_phase1.sql), against a real Postgres. Fictional data throughout.
//   * ONE job-and-pay change: today or earlier is applied in the same transaction as its audit event (title and pay together or not at all); a later date is SCHEDULED and changes nothing yet;
//   * HR Admin may change either; Finance pay only, in force already, with no event; nobody else, no other company, and an unknown employee gets the same refusal;
//   * the effective-date cutoff is the EMPLOYEE'S OWN calendar day, decided in the database (no date is accepted from the caller);
//   * allowances the person did not edit are carried over; only "Others" is ever edited;
//   * the daily applier is service-role only, applies each due event on ITS employee's calendar in date order, HOLDS an event whose pay version is no longer current (visible for HR review, never
//     overwriting newer pay), reports a failed event as a failure without undoing the events applied in the same run, and leaves a leaver's event unapplied; HR can cancel a scheduled change;
//   * a second opening balance (leave or comp-day) is refused by the database, whatever the app checked; the packs behave as documented.

const id = () => randomUUID();
const CO = { a: id(), b: id(), pl: id() };
const U = { hrA: id(), finA: id(), hrB: id(), emp: id(), mgr: id(), ceoA: id(), hrPl: id() };
const E = { emp: id(), mgr: id(), bare: id(), left: id(), other: id(), pl: id(), sched: id(), allow: id(), conf: id(), cascade: id(), f1: id(), f2: id(), f3: id(), race: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@hrp1.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = day(0);
const change = (emp: string, date: string, title: string | null, basic: number | null, other: number | null, note: string | null = null) =>
  `record_employment_change('${emp}', '${date}', ${title === null ? "null" : `'${title}'`}, ${basic === null ? "null" : basic}, ${other === null ? "null" : other}, ${note === null ? "null" : `'${note}'`})`;
/** An instant for the applier: 12:00 UTC is the same calendar day in Dubai, Riyadh and Warsaw. */
const noon = (d: string) => `'${d} 12:00:00+00'::timestamptz`;
const applyAt = (instant: string) => `apply_due_employment_changes(${instant})`;

describe("People & HR Phase 1: one effective-dated job-and-pay change, and one opening balance", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const message = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return (e as Error).message; } };
  const title = async (emp: string) => (await admin<{ job_title: string | null }>(`select job_title from employees where id = '${emp}'`))[0]!.job_title;
  const current = async (emp: string) => admin<{ base_salary: string; allowances: Row; currency: string; bank_iban: string | null; effective_from: string }>(`select base_salary, allowances, currency, bank_iban, effective_from::text from compensation_details where employee_id = '${emp}' and is_current`);
  const events = async (emp: string) => admin<Row>(`select event_type, effective_date::text, applied_at, new_job_title, new_base_salary, created_by from employee_career_events where employee_id = '${emp}' order by created_at`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional Enginious LLC FZ', 'AE', 'AED'), ('${CO.b}', 'Fictional Other Co', 'AE', 'AED'), ('${CO.pl}', 'Fictional Enginious PL', 'PL', 'PLN');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, job_title) values
        ('${E.emp}', '${U.emp}', 'HP-001', '${CO.a}', 'AE', 'Fictional', 'Technician', '2024-01-01', 'Technician'),
        ('${E.mgr}', '${U.mgr}', 'HP-002', '${CO.a}', 'AE', 'Fictional', 'Manager', '2024-01-01', 'Manager'),
        ('${E.bare}', null, 'HP-003', '${CO.a}', 'AE', 'Fictional', 'NoPay', '2024-01-01', null),
        ('${E.left}', null, 'HP-004', '${CO.a}', 'AE', 'Fictional', 'Leaver', '2024-01-01', 'Designer'),
        ('${E.other}', null, 'HP-005', '${CO.b}', 'AE', 'Fictional', 'OtherCo', '2024-01-01', 'Clerk'),
        ('${E.pl}', null, 'HP-006', '${CO.pl}', 'PL', 'Fictional', 'Pole', '2024-01-01', 'Engineer'),
        ('${E.sched}', null, 'HP-007', '${CO.a}', 'AE', 'Fictional', 'Scheduled', '2024-01-01', 'Analyst'),
        ('${E.allow}', null, 'HP-008', '${CO.a}', 'AE', 'Fictional', 'Allowances', '2024-01-01', 'Engineer'),
        ('${E.conf}', null, 'HP-009', '${CO.a}', 'AE', 'Fictional', 'Conflict', '2024-01-01', 'Surveyor'),
        ('${E.cascade}', null, 'HP-010', '${CO.a}', 'AE', 'Fictional', 'Cascade', '2024-01-01', 'Estimator'),
        ('${E.f1}', null, 'HP-011', '${CO.a}', 'AE', 'Fictional', 'FailOne', '2024-01-01', 'Fitter'),
        ('${E.f2}', null, 'HP-012', '${CO.a}', 'AE', 'Fictional', 'FailTwo', '2024-01-01', 'Fitter'),
        ('${E.f3}', null, 'HP-013', '${CO.a}', 'AE', 'Fictional', 'FailThree', '2024-01-01', 'Fitter'),
        ('${E.race}', null, 'HP-014', '${CO.a}', 'AE', 'Fictional', 'Race', '2024-01-01', 'Rigger');
      update employees set manager_id = '${E.mgr}' where id = '${E.emp}';
      insert into user_roles (user_id, role, company_id) values ('${U.hrA}', 'hr_admin', '${CO.a}'), ('${U.finA}', 'finance', '${CO.a}'), ('${U.hrB}', 'hr_admin', '${CO.b}'), ('${U.mgr}', 'line_manager', '${CO.a}'), ('${U.ceoA}', 'ceo', '${CO.a}'), ('${U.hrPl}', 'hr_admin', '${CO.pl}');
      insert into compensation_details (employee_id, effective_from, base_salary, allowances, currency, bank_iban, created_by) values
        ('${E.emp}', '2024-01-01', 5000, '{"other": 500}', 'AED', 'AE070331234567890123456', '${U.hrA}'),
        ('${E.left}', '2024-01-01', 4000, '{}', 'AED', null, '${U.hrA}'),
        ('${E.other}', '2024-01-01', 3000, '{}', 'AED', null, '${U.hrB}'),
        ('${E.pl}', '2024-01-01', 9000, '{}', 'PLN', null, '${U.hrPl}'),
        ('${E.sched}', '2024-01-01', 5000, '{}', 'AED', 'AE070331234567890123456', '${U.hrA}'),
        ('${E.allow}', '2024-01-01', 5000, '{"housing": 1200, "transport": 300, "other": 500}', 'AED', null, '${U.hrA}'),
        ('${E.conf}', '2024-01-01', 5000, '{"housing": 100}', 'AED', null, '${U.hrA}'),
        ('${E.cascade}', '2024-01-01', 5000, '{"housing": 100}', 'AED', null, '${U.hrA}'),
        ('${E.f1}', '2024-01-01', 4000, '{}', 'AED', null, '${U.hrA}'),
        ('${E.f2}', '2024-01-01', 4000, '{}', 'AED', null, '${U.hrA}'),
        ('${E.f3}', '2024-01-01', 4000, '{}', 'AED', null, '${U.hrA}'),
        ('${E.race}', '2024-01-01', 5000, '{"housing": 100}', 'AED', null, '${U.hrA}');
      update employees set employment_status = 'terminated', termination_date = '2026-01-01' where id = '${E.left}';
    `);
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  it("HR Admin records a job and pay change dated today: both are in force together, one pay version is current, the event is applied and the IBAN carries over", async () => {
    const r = await call(U.hrA, change(E.emp, TODAY, "Senior Technician", 6000, 700, "Annual review"));
    expect(r).toMatchObject({ status: "applied", title_changed: true, pay_changed: true });
    expect(await title(E.emp)).toBe("Senior Technician");
    const cur = await current(E.emp);
    expect(cur).toHaveLength(1);
    expect(Number(cur[0]!.base_salary)).toBe(6000);
    expect(cur[0]!.allowances).toEqual({ other: 700 });
    expect(cur[0]!.currency).toBe("AED");
    expect(cur[0]!.bank_iban).toBe("AE070331234567890123456");
    const ev = await events(E.emp);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_type: "promotion", new_job_title: "Senior Technician" });
    expect(ev[0]!.applied_at).not.toBeNull();
    expect(ev[0]!.created_by).toBe(U.hrA);
    const history = await admin<{ n: string }>(`select count(*) n from compensation_details where employee_id = '${E.emp}'`);
    expect(Number(history[0]!.n)).toBe(2); // the earlier version is kept, superseded
  });

  it("a change dated later is SCHEDULED: the event is saved unapplied and the job title and current pay do not move", async () => {
    const r = await call(U.hrA, change(E.sched, day(30), "Lead Analyst", 6500, null));
    expect(r).toMatchObject({ status: "scheduled", title_changed: true, pay_changed: true });
    expect(await title(E.sched)).toBe("Analyst");
    expect(Number((await current(E.sched))[0]!.base_salary)).toBe(5000);
    const ev = await events(E.sched);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.applied_at).toBeNull();
  });

  it("the daily applier is for the service role only: signed-in users and anon are refused", async () => {
    expect(await code(call(U.hrA, `apply_due_employment_changes()`))).toBe("42501");
    expect(await code(call(U.hrA, applyAt(noon(day(60)))))).toBe("42501");
    expect(await code(db.asUser(null, (q) => q(`select apply_due_employment_changes()`)))).toBe("42501");
    expect(await code(call(U.hrA, `dismiss_employment_change('${randomUUID()}')`))).toBe("42501"); // unknown event: the same refusal as no right
    expect(await code(call(U.hrA, `_hr_apply_career_event('${randomUUID()}')`))).toBe("42501");
  });

  it("the applier applies each event on ITS employee's calendar day, in date order, and not before: 21:00 UTC is already tomorrow in Dubai but still today in Warsaw", async () => {
    await call(U.hrPl, change(E.pl, day(30), "Senior Engineer", 9500, null));
    const before = await admin<Row>(`select ${applyAt(noon(day(29)))} as v`);
    expect(before[0]!.v).toMatchObject({ applied: 0, conflicts: 0, failed: 0 });
    expect(await title(E.sched)).toBe("Analyst");
    // 21:00 UTC on the eve: Dubai is already on the due date, Warsaw (UTC+1 or +2) is not.
    const eve = await admin<Row>(`select apply_due_employment_changes('${day(29)} 21:00:00+00'::timestamptz) as v`);
    expect(eve[0]!.v).toMatchObject({ applied: 1, skipped: 0, conflicts: 0, failed: 0, failures: [] });
    expect(await title(E.sched)).toBe("Lead Analyst");
    const cur = await current(E.sched);
    expect(cur).toHaveLength(1);
    expect(Number(cur[0]!.base_salary)).toBe(6500);
    expect(cur[0]!.effective_from).toBe(day(30));
    expect(cur[0]!.bank_iban).toBe("AE070331234567890123456");
    expect(await title(E.pl)).toBe("Engineer"); // Poland's event was not due yet on Warsaw's calendar
    expect((await events(E.pl))[0]!.applied_at).toBeNull();
    const again = await admin<Row>(`select apply_due_employment_changes('${day(29)} 21:00:00+00'::timestamptz) as v`);
    expect(again[0]!.v).toMatchObject({ applied: 0 });
    const pl = await admin<Row>(`select ${applyAt(noon(day(30)))} as v`);
    expect(pl[0]!.v).toMatchObject({ applied: 1 });
    expect(await title(E.pl)).toBe("Senior Engineer");
  });

  it("the cutoff is decided in the database from the employee's country: the helper answers per country and the change takes no date from the caller", async () => {
    const d = async (cc: string, at: string) => (await admin<{ v: string }>(`select hr_business_date('${cc}', '${at}')::text as v`))[0]!.v;
    expect(await d("AE", "2026-11-16 21:00:00+00")).toBe("2026-11-17");
    expect(await d("SA", "2026-11-16 21:00:00+00")).toBe("2026-11-17");
    expect(await d("PL", "2026-11-16 22:30:00+00")).toBe("2026-11-16");
    expect(await d("PL", "2026-11-16 23:30:00+00")).toBe("2026-11-17");   // Warsaw is UTC+1 in November
    expect(await d("PL", "2026-07-16 21:30:00+00")).toBe("2026-07-16");   // and UTC+2 in July: 23:30 there, still the 16th
    expect(await d("PL", "2026-07-16 22:30:00+00")).toBe("2026-07-17");
    expect(await d("XX", "2026-11-16 21:00:00+00")).toBe("2026-11-17");   // a country nobody decided on gets Dubai, as in the app
    // The caller cannot send a date: the old seven-argument form no longer exists.
    expect(await code(call(U.hrA, `record_employment_change('${E.emp}', '${TODAY}', 'Sneaky', null, null, null, '2999-01-01')`))).toBe("42883");
    // Dated on the employee's own "today" it is applied; one day later it is scheduled, whatever the browser or server clock says.
    const today = (await admin<{ v: string }>(`select hr_business_today('AE')::text as v`))[0]!.v;
    const tomorrow = (await admin<{ v: string }>(`select (hr_business_today('AE') + 1)::text as v`))[0]!.v;
    expect(await call(U.hrA, change(E.cascade, today, "Senior Estimator", null, null))).toMatchObject({ status: "applied", business_date: today });
    expect(await call(U.hrA, change(E.cascade, tomorrow, "Principal Estimator", null, null))).toMatchObject({ status: "scheduled", business_date: today });
    expect(await title(E.cascade)).toBe("Senior Estimator");
    await admin(`delete from employee_career_events where employee_id = '${E.cascade}' and applied_at is null`);
  });

  it("allowances the person did not edit are carried over: a basic-only change, an Others-only change, clearing Others, a Finance change and a scheduled change all keep housing and transport", async () => {
    const allow = async () => (await current(E.allow))[0]!.allowances;
    await call(U.hrA, change(E.allow, TODAY, null, 5600, null));
    expect(await allow()).toEqual({ housing: 1200, transport: 300, other: 500 });
    await call(U.hrA, change(E.allow, TODAY, null, null, 700));
    expect(await allow()).toEqual({ housing: 1200, transport: 300, other: 700 });
    expect(Number((await current(E.allow))[0]!.base_salary)).toBe(5600);
    await call(U.finA, change(E.allow, TODAY, null, 5800, null));
    expect(await allow()).toEqual({ housing: 1200, transport: 300, other: 700 });
    await call(U.hrA, change(E.allow, TODAY, null, null, 0));
    expect(await allow()).toEqual({ housing: 1200, transport: 300 });
    await call(U.hrA, change(E.allow, day(40), "Senior Engineer", 6100, null));
    const scheduled = await admin<{ new_allowances: Row; previous_allowances: Row }>(`select new_allowances, previous_allowances from employee_career_events where employee_id = '${E.allow}' and applied_at is null`);
    expect(scheduled[0]!.new_allowances).toEqual({ housing: 1200, transport: 300 });
    expect(scheduled[0]!.previous_allowances).toEqual({ housing: 1200, transport: 300 });
    await admin(`select ${applyAt(noon(day(40)))}`);
    expect(await allow()).toEqual({ housing: 1200, transport: 300 });
    expect(Number((await current(E.allow))[0]!.base_salary)).toBe(6100);
    expect(await title(E.allow)).toBe("Senior Engineer");
  });

  it("a scheduled change whose pay version is no longer current is HELD for HR review, never applied over newer pay, title included; re-running changes nothing; HR can cancel it", async () => {
    await call(U.hrA, change(E.conf, day(10), "Chief Surveyor", 6000, null));
    await call(U.finA, change(E.conf, TODAY, null, 5500, null));   // pay moves on after the change was scheduled
    const run = await admin<Row>(`select ${applyAt(noon(day(10)))} as v`);
    expect(run[0]!.v).toMatchObject({ applied: 0, conflicts: 1, failed: 0 });
    expect(run[0]!.v.held).toHaveLength(1);
    expect(Number((await current(E.conf))[0]!.base_salary)).toBe(5500);
    expect(await title(E.conf)).toBe("Surveyor");                   // the title waits with the pay: one change, held as a whole
    const [held] = await events(E.conf);
    expect(held!.applied_at).toBeNull();
    const reason = await admin<{ conflict_reason: string; conflict_at: string | null }>(`select conflict_reason, conflict_at from employee_career_events where employee_id = '${E.conf}' and applied_at is null`);
    expect(reason[0]!.conflict_reason).toMatch(/Pay changed after this change was scheduled/);
    expect(reason[0]!.conflict_at).not.toBeNull();
    const again = await admin<Row>(`select ${applyAt(noon(day(11)))} as v`);
    expect(again[0]!.v).toMatchObject({ applied: 0, conflicts: 1 });
    expect(Number((await current(E.conf))[0]!.base_salary)).toBe(5500);
    // HR review: only an HR Admin of that company may cancel; the row stays, marked cancelled, and is not picked up again.
    const id1 = (await admin<{ id: string }>(`select id from employee_career_events where employee_id = '${E.conf}' and applied_at is null`))[0]!.id;
    expect(await code(call(U.hrB, `dismiss_employment_change('${id1}')`))).toBe("42501");
    expect(await code(call(U.finA, `dismiss_employment_change('${id1}')`))).toBe("42501");
    expect(await call(U.hrA, `dismiss_employment_change('${id1}')`)).toMatchObject({ status: "cancelled" });
    expect(await call(U.hrA, `dismiss_employment_change('${id1}')`)).toMatchObject({ status: "cancelled" }); // a second tap changes nothing
    const gone = await admin<Row>(`select ${applyAt(noon(day(12)))} as v`);
    expect(gone[0]!.v).toMatchObject({ applied: 0, conflicts: 0 });
    expect((await admin<{ dismissed_at: string | null; dismissed_by: string }>(`select dismissed_at, dismissed_by from employee_career_events where id = '${id1}'`))[0]!.dismissed_by).toBe(U.hrA);
    const applied = (await events(E.sched))[0]!;
    expect(applied.applied_at).not.toBeNull();
    expect(await message(call(U.hrA, `dismiss_employment_change('${(await admin<{ id: string }>(`select id from employee_career_events where employee_id = '${E.sched}'`))[0]!.id}')`))).toMatch(/already in force/);
  });

  it("two scheduled changes both worked out from the same pay: the first applies, the second is held, so an Others-only change cannot put the old basic salary back", async () => {
    await call(U.hrA, change(E.cascade, day(10), null, 6000, null));
    await call(U.hrA, change(E.cascade, day(20), null, null, 800));
    const first = await admin<Row>(`select ${applyAt(noon(day(10)))} as v`);
    expect(first[0]!.v).toMatchObject({ applied: 1, conflicts: 0 });
    const second = await admin<Row>(`select ${applyAt(noon(day(20)))} as v`);
    expect(second[0]!.v).toMatchObject({ applied: 0, conflicts: 1 });
    const cur = await current(E.cascade);
    expect(Number(cur[0]!.base_salary)).toBe(6000);
    expect(cur[0]!.allowances).toEqual({ housing: 100 });
  });

  it("a failed application is reported as a failure with its event, and the events applied in the same run are kept", async () => {
    for (const e of [E.f1, E.f2, E.f3]) await call(U.hrA, change(e, day(15), "Senior Fitter", 4500, null));
    await admin(`create function _hrp1_block_f2() returns trigger language plpgsql as $$ begin raise exception 'pay blocked for the failing event'; end $$;
                 create trigger _hrp1_block_f2 before insert on compensation_details for each row when (new.employee_id = '${E.f2}') execute function _hrp1_block_f2();`);
    const run = await admin<Row>(`select ${applyAt(noon(day(15)))} as v`);
    expect(run[0]!.v).toMatchObject({ applied: 2, failed: 1, conflicts: 0 });
    expect(run[0]!.v.failures).toHaveLength(1);
    expect(run[0]!.v.failures[0]).toMatchObject({ sqlstate: "P0001" });
    expect(run[0]!.v.failures[0].message).toMatch(/pay blocked for the failing event/);
    const failedEvent = (await events(E.f2))[0]!;
    expect(run[0]!.v.failures[0].event_id).toBe((await admin<{ id: string }>(`select id from employee_career_events where employee_id = '${E.f2}'`))[0]!.id);
    expect(failedEvent.applied_at).toBeNull();
    expect(await title(E.f2)).toBe("Fitter");                       // its own writes were rolled back
    expect(await title(E.f1)).toBe("Senior Fitter");                // the others in the same run are kept
    expect(await title(E.f3)).toBe("Senior Fitter");
    expect(Number((await current(E.f1))[0]!.base_salary)).toBe(4500);
    expect(Number((await current(E.f3))[0]!.base_salary)).toBe(4500);
    await admin(`drop trigger _hrp1_block_f2 on compensation_details; drop function _hrp1_block_f2();`);
    const retry = await admin<Row>(`select ${applyAt(noon(day(16)))} as v`);
    expect(retry[0]!.v).toMatchObject({ applied: 1, failed: 0 });   // the next run tries it again
    expect(await title(E.f2)).toBe("Senior Fitter");
  });

  it("Finance can change pay dated today or earlier, with no career event; it cannot change the title or schedule a later date", async () => {
    const r = await call(U.finA, change(E.emp, TODAY, null, 6800, null));
    expect(r).toMatchObject({ status: "applied", title_changed: false, pay_changed: true, event_id: null });
    expect(Number((await current(E.emp))[0]!.base_salary)).toBe(6800);
    expect((await events(E.emp)).filter((e) => e.new_base_salary !== null && Number(e.new_base_salary) === 6800)).toHaveLength(0);
    expect(await message(call(U.finA, change(E.emp, TODAY, "Director", null, null)))).toMatch(/Only an HR Admin can change the job title/);
    expect(await message(call(U.finA, change(E.emp, day(10), null, 7000, null)))).toMatch(/Only an HR Admin can schedule/);
    expect(await title(E.emp)).toBe("Senior Technician");
    expect(Number((await current(E.emp))[0]!.base_salary)).toBe(6800);
  });

  it("another company's HR Admin, a line manager, the CEO, the employee themself and an unknown employee all get the same refusal", async () => {
    const msgs = new Set<string>();
    for (const u of [U.hrB, U.mgr, U.ceoA, U.emp]) {
      const m = await message(call(u, change(E.emp, TODAY, "Hacked", null, null)));
      expect(await code(call(u, change(E.emp, TODAY, "Hacked", null, null)))).toBe("42501");
      msgs.add(m);
    }
    const unknown = await message(call(U.hrA, change(randomUUID(), TODAY, "Ghost", null, null)));
    msgs.add(unknown);
    expect(msgs.size).toBe(1);
    expect(await title(E.emp)).toBe("Senior Technician");
  });

  it("refuses an empty change, a date before the hire date or before the current pay, a leaver, and a first salary without a basic figure", async () => {
    expect(await message(call(U.hrA, change(E.emp, TODAY, "Senior Technician", 6800, 700)))).toMatch(/Nothing changed/);
    expect(await message(call(U.hrA, change(E.emp, "2023-12-31", "Earlier", null, null)))).toMatch(/hire date/);
    expect(await message(call(U.hrA, change(E.emp, day(-100), null, 7500, null)))).toMatch(/current pay did/);
    expect(await message(call(U.hrA, change(E.left, TODAY, "Back again", null, null)))).toMatch(/has left or was removed/);
    expect(await message(call(U.hrA, change(E.bare, TODAY, null, null, 300)))).toMatch(/no salary on record/);
    expect(await message(call(U.hrA, change(E.emp, TODAY, null, -5, null)))).toMatch(/more than zero/);
  });

  it("the first salary and a job title for someone with neither use the same process", async () => {
    const r = await call(U.hrA, change(E.bare, "2024-01-01", "Coordinator", 4200, 300));
    expect(r).toMatchObject({ status: "applied", title_changed: true, pay_changed: true });
    expect(await title(E.bare)).toBe("Coordinator");
    const cur = await current(E.bare);
    expect(cur).toHaveLength(1);
    expect(Number(cur[0]!.base_salary)).toBe(4200);
    expect(cur[0]!.currency).toBe("AED"); // the company's default when no salary was on record
  });

  it("job title and pay save together or not at all: a failing pay write rolls the title and the event back", async () => {
    await admin(`insert into compensation_details (employee_id, effective_from, base_salary, currency, created_by) values ('${E.mgr}', '2024-01-01', 8000, 'AED', '${U.hrA}');
                 create function _hrp1_block_pay() returns trigger language plpgsql as $$ begin raise exception 'pay blocked for the test'; end $$;
                 create trigger _hrp1_block_pay before insert on compensation_details for each row when (new.employee_id = '${E.mgr}') execute function _hrp1_block_pay();`);
    expect(await message(call(U.hrA, change(E.mgr, TODAY, "Head of Operations", 9000, null)))).toMatch(/pay blocked for the test/);
    expect(await title(E.mgr)).toBe("Manager");
    expect(await events(E.mgr)).toHaveLength(0);
    expect(Number((await current(E.mgr))[0]!.base_salary)).toBe(8000);
    await admin(`drop trigger _hrp1_block_pay on compensation_details; drop function _hrp1_block_pay();`);
  });

  it("a row written the way the PREVIOUS build wrote it (no applied_at) counts as applied, so the daily job never applies it twice", async () => {
    await db.asUserCommit(U.hrA, (q) => q(`insert into employee_career_events (employee_id, event_type, effective_date, new_job_title, created_by) values ('${E.mgr}', 'title_change', '${TODAY}', 'Manager', '${U.hrA}')`));
    const ev = await events(E.mgr);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.applied_at).not.toBeNull();
  });

  it("the applier leaves a leaver's scheduled event unapplied and says so", async () => {
    await admin(`insert into employee_career_events (employee_id, event_type, effective_date, new_job_title, created_by, applied_at) values ('${E.left}', 'title_change', '${day(5)}', 'Art Director', '${U.hrA}', null)`);
    const r = await admin<Row>(`select ${applyAt(noon(day(6)))} as v`);
    expect(r[0]!.v).toMatchObject({ applied: 0, skipped: 1 });
    expect(await title(E.left)).toBe("Designer");
    expect((await events(E.left))[0]!.applied_at).toBeNull();
    await admin(`delete from employee_career_events where employee_id = '${E.left}'`);
  });

  it("an employee has one opening leave balance per leave type and one opening comp-day entry: a second is refused by the database", async () => {
    const leave = (type: string, ref = "opening_balance") => `insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, reference_type, created_by) values ('${E.emp}', '${type}', '2024-01-01', 'adjustment', 10, '${ref}', '${U.hrA}')`;
    await admin(leave("annual"));
    expect(await code(admin(leave("annual")))).toBe("23505");
    await admin(leave("sick"));                       // a different leave type is a different balance
    await admin(leave("annual", "manual_adjustment")); // an ordinary correction is not an opening balance
    const comp = (days: number) => `insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, created_by) values ('${E.emp}', '2024-01-01', 'earned', ${days}, 'opening_balance', 'manual_adjustment', '${U.hrA}')`;
    await admin(comp(2));
    expect(await code(admin(comp(3)))).toBe("23505");
    await admin(`insert into comp_day_ledger (employee_id, txn_date, entry_type, days, source, reference_type, created_by) values ('${E.emp}', '2024-02-01', 'earned', 1, 'overtime', 'manual_adjustment', '${U.hrA}')`);
  });

  it("TWO SESSIONS: a manual pay change still being saved cannot be overwritten by the daily applier: the applier waits for the employee's lock, then holds the stale change", async () => {
    await call(U.hrA, change(E.race, day(10), "Senior Rigger", 6000, null));     // scheduled, worked out from pay version 1
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const aHasLock = new Promise<void>((r) => { locked = r; });
    // Session A (Finance): changes pay dated today inside a transaction it has not committed yet. It holds the employee's lock and the new pay version.
    const a = db.asUserCommit(U.finA, async (q) => { await q(`select ${change(E.race, TODAY, null, 5500, null)}`); locked(); await hold; });
    await aHasLock;
    // Session B (the daily job): starts while A is still open. It must WAIT for the employee, not read pay around A.
    const b = db.seed(`select ${applyAt(noon(day(10)))} as v`);
    let blocked = false;
    try {
      for (let i = 0; i < 60 && !blocked; i++) {
        const n = await admin<{ n: string }>(`select count(*) n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%apply_due_employment_changes%'`);
        blocked = Number(n[0]!.n) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      release();   // always let A finish, so a failure here cannot leave the transaction open
    }
    await a;
    const run = (await b).rows[0] as Row;
    expect(blocked, "the applier should have been waiting on the employee's lock while the save was open").toBe(true);
    // After A committed, B rechecked the pay version under the lock: pay moved on, so the scheduled change is held, not applied over A's pay.
    expect(run.v).toMatchObject({ applied: 0, conflicts: 1, failed: 0 });
    const cur = await current(E.race);
    expect(cur).toHaveLength(1);                                     // exactly one current pay version, never two
    expect(Number(cur[0]!.base_salary)).toBe(5500);                 // A's pay, not overwritten
    expect(cur[0]!.allowances).toEqual({ housing: 100 });
    expect(await title(E.race)).toBe("Rigger");                     // the held change wrote nothing, title included
    const [held] = await events(E.race);
    expect(held!.applied_at).toBeNull();
    await admin(`delete from employee_career_events where employee_id = '${E.race}' and applied_at is null`);
  });

  it("running the migration file again converges: it replaces an older draft's functions instead of leaving two versions, and the verify pack says OK", async () => {
    await admin(`create function record_employment_change(p_employee_id uuid, p_effective_date date, p_job_title text, p_basic numeric, p_other numeric, p_note text, p_today date) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
    const pre = (await db.seed(manual("people_hr_phase1_00_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[1]!.result).toMatch(/OLDER DRAFT/);
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/migrations/20270115000100_people_hr_phase1.sql"), "utf8"));
    const old = await admin<{ n: string }>(`select count(*) n from pg_proc where proname = 'record_employment_change'`);
    expect(Number(old[0]!.n)).toBe(1);
    const verify = await admin<{ item: string; result: string }>(manual("people_hr_phase1_20_verify_readonly.sql"));
    expect(verify.slice(0, 8).map((r) => r.result)).toEqual(Array(8).fill("OK"));
  });

  it("the verify pack says OK on every row, the preflight says the migration is installed, and the rollback stops while a change is scheduled or cancelled, then removes everything it added", async () => {
    const verify = await admin<{ item: string; result: string }>(manual("people_hr_phase1_20_verify_readonly.sql"));
    expect(verify).toHaveLength(9);
    expect(verify.slice(0, 8).map((r) => r.result)).toEqual(Array(8).fill("OK"));
    expect(verify[8]!.result).toMatch(/^\d+ \/ \d+ \/ \d+$/);
    const pre = (await db.seed(manual("people_hr_phase1_00_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[1]!.result).toBe("already installed");
    await admin(`insert into employee_career_events (employee_id, event_type, effective_date, new_job_title, created_by, applied_at) values ('${E.emp}', 'title_change', '${day(90)}', 'Future', '${U.hrA}', null)`);
    // two are pending: this one, and the held second change of the cascade case (a held change is still scheduled until HR reviews it)
    expect(await message(db.seed(manual("people_hr_phase1_90_rollback.sql")))).toMatch(/STOP: 2 scheduled employment change/);
    await admin(`update employee_career_events set dismissed_at = now(), dismissed_by = '${U.hrA}' where applied_at is null`);
    expect(await message(db.seed(manual("people_hr_phase1_90_rollback.sql")))).toMatch(/STOP: 3 cancelled employment change/);
    await admin(`delete from employee_career_events where applied_at is null`);
    await db.seed(manual("people_hr_phase1_90_rollback.sql"));
    await db.seed(manual("people_hr_phase1_90_rollback.sql")); // safe twice
    const left = await admin<{ n: string }>(`select count(*) n from pg_proc where proname in ('record_employment_change', 'apply_due_employment_changes', 'dismiss_employment_change', '_hr_apply_career_event', '_hr_set_current_pay', '_hr_lock_employee', 'hr_business_today', 'hr_business_date', 'hr_business_time_zone')`);
    expect(Number(left[0]!.n)).toBe(0);
    const cols = await admin<{ n: string }>(`select count(*) n from information_schema.columns where table_name = 'employee_career_events' and column_name in ('applied_at', 'base_compensation_id', 'conflict_reason', 'conflict_at', 'dismissed_at', 'dismissed_by')`);
    expect(Number(cols[0]!.n)).toBe(0);
  });
});
