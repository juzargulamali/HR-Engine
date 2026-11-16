import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// People & HR "Correct pay record" (migration 20270118000200_people_hr_pay_correction.sql), against a real Postgres. Fictional data throughout.
//   * a mistaken pay record (the usual case: the current salary saved with the joining date) is corrected IN PLACE (amount, date or both), the original values are kept in compensation_corrections and the
//     audit trail, and the pay in force afterwards is the corrected one;
//   * a date that duplicates, overlaps or reorders another record's, is before the hire date, or is after today is refused, and nothing is written;
//   * pending (scheduled) pay changes: refused when the amount of the record they were based on changes, or when the date would reach them; held and title-only changes do not block;
//   * approved payroll exports and final settlements are NEVER changed: the ones that use the corrected record's period are flagged in the result and the correction row;
//   * HR Admin or Finance of the company only; another company, a plain employee, anon and an unknown record are refused alike; the same request key twice applies once;
//   * no direct write path to the table, the table is append-only, and the packs behave as documented.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { hrA: id(), finA: id(), hrB: id(), emp: id(), mgr: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@hrpc.ae')`).join(", ");
const NAMES = ["amount", "date", "both", "fin", "chain", "hire", "pend", "held", "title", "pay", "settle", "settleOld", "idem", "race", "unauth", "multi", "removed", "allow", "lone", "other", "plain"] as const;
const E = Object.fromEntries(NAMES.map((n) => [n, id()])) as Record<(typeof NAMES)[number], string>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const key = () => `key-${randomUUID()}`;
const q = (v: string | number | null) => (v === null ? "null" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
const correct = (rec: string, date: string | null, basic: number | null, allow: object | null, reason: string, k: string) =>
  `correct_pay_record('${rec}', ${q(date)}, ${basic === null ? "null" : basic}, ${allow === null ? "null" : `'${JSON.stringify(allow)}'::jsonb`}, ${q(reason)}, ${q(k)})`;

describe("People & HR: correct a pay record", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string | null, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const message = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return (e as Error).message; } };
  /** Pay records of an employee, oldest first. */
  const records = (emp: string) => admin<Row>(`select id, effective_from::text, base_salary::float8 as base_salary, allowances, is_current, currency, bank_iban from compensation_details where employee_id = '${emp}' order by effective_from, created_at`);
  const corrections = (emp: string) => admin<Row>(`select *, previous_effective_from::text as prev_date, new_effective_from::text as new_date, previous_base_salary::float8 as prev_basic, new_base_salary::float8 as new_basic from compensation_corrections where employee_id = '${emp}' order by corrected_at, id`);
  const addRecord = async (emp: string, from: string, basic: number, allowances: object, current: boolean, by = U.hrA) => (await admin<{ id: string }>(`
    insert into compensation_details (employee_id, effective_from, base_salary, allowances, currency, is_current, created_by, bank_iban) values ('${emp}', '${from}', ${basic}, '${JSON.stringify(allowances)}', 'AED', ${current}, '${by}', 'AE070331234567890123456') returning id`))[0]!.id;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional Aurora LLC', 'AE', 'AED'), ('${CO.b}', 'Fictional Birch LLC', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, job_title) values
        ${NAMES.map((n, i) => `('${E[n]}', ${n === "plain" ? `'${U.emp}'` : "null"}, 'PC-${String(i + 1).padStart(3, "0")}', '${n === "other" ? CO.b : CO.a}', 'AE', 'Fictional', '${n}', '2024-01-01', 'Technician')`).join(",\n        ")};
      insert into user_roles (user_id, role, company_id) values ('${U.hrA}', 'hr_admin', '${CO.a}'), ('${U.finA}', 'finance', '${CO.a}'), ('${U.hrB}', 'hr_admin', '${CO.b}'), ('${U.mgr}', 'line_manager', '${CO.a}');
    `);
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  // ---------------------------------------------------------------------------------------------------------- the mistaken opening record
  it("corrects the AMOUNT of a mistaken opening record: same row, new figures, the other allowances kept, the original preserved, and the pay in force is the corrected pay", async () => {
    const rec = await addRecord(E.amount, "2024-01-01", 8000, { housing: 1000, other: 500 }, true);
    const r = await call(U.hrA, correct(rec, null, 9000, { housing: 1000, other: 700 }, "Entered last year's figure by mistake", key()));
    expect(r).toMatchObject({ status: "applied", compensation_id: rec });
    expect(r.previous).toMatchObject({ effective_from: "2024-01-01", base_salary: 8000 });
    expect(r.new).toMatchObject({ effective_from: "2024-01-01", base_salary: 9000, allowances: { housing: 1000, other: 700 } });
    const rows = await records(E.amount);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: rec, base_salary: 9000, allowances: { housing: 1000, other: 700 }, is_current: true, bank_iban: "AE070331234567890123456", effective_from: "2024-01-01" });
    const c = await corrections(E.amount);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ compensation_id: rec, prev_basic: 8000, new_basic: 9000, prev_date: "2024-01-01", new_date: "2024-01-01", currency: "AED", corrected_by: U.hrA, company_id: CO.a, reason: "Entered last year's figure by mistake" });
    expect(c[0]!.previous_allowances).toEqual({ housing: 1000, other: 500 });
    expect(c[0]!.new_allowances).toEqual({ housing: 1000, other: 700 });
    // The pay in force today, before and after, is in the result and stored.
    expect(c[0]!.impact.in_force_today_before).toMatchObject({ id: rec, base_salary: 8000 });
    expect(c[0]!.impact.in_force_today_after).toMatchObject({ id: rec, base_salary: 9000 });
    expect(r.impact).toEqual(c[0]!.impact);
  });

  it("corrects the EFFECTIVE DATE of a mistaken opening record (the joining date was entered instead of the real one)", async () => {
    const rec = await addRecord(E.date, "2024-01-01", 8000, { other: 500 }, true);
    const r = await call(U.hrA, correct(rec, "2025-03-01", null, null, "Salary started in March 2025, not on joining", key()));
    expect(r).toMatchObject({ status: "applied" });
    const rows = await records(E.date);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: rec, effective_from: "2025-03-01", base_salary: 8000, allowances: { other: 500 }, is_current: true });
    const c = await corrections(E.date);
    expect(c[0]).toMatchObject({ prev_date: "2024-01-01", new_date: "2025-03-01", prev_basic: 8000, new_basic: 8000 });
    expect(r.impact.in_force_today_after).toMatchObject({ id: rec, effective_from: "2025-03-01" });
  });

  it("corrects amount AND date together, and a second correction of the same record keeps the very first original in the first row", async () => {
    const rec = await addRecord(E.both, "2024-01-01", 8000, { other: 500 }, true);
    await call(U.hrA, correct(rec, "2025-02-01", 8800, null, "First fix: date and amount", key()));
    await call(U.hrA, correct(rec, null, 8900, { other: 450 }, "Second fix: figures typed wrongly again", key()));
    const rows = await records(E.both);
    expect(rows[0]).toMatchObject({ effective_from: "2025-02-01", base_salary: 8900, allowances: { other: 450 } });
    const c = await corrections(E.both);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ prev_date: "2024-01-01", prev_basic: 8000, new_date: "2025-02-01", new_basic: 8800 });   // the original entry, still recoverable
    expect(c[0]!.previous_allowances).toEqual({ other: 500 });
    expect(c[1]).toMatchObject({ prev_date: "2025-02-01", prev_basic: 8800, new_basic: 8900 });
  });

  it("the audit trail records the change to the pay record (old and new row) and the correction itself, with who did it", async () => {
    const rec = (await records(E.amount))[0]!.id as string;
    const a = await admin<Row>(`select action, actor_id, company_id, before_data, after_data from audit_log where table_name = 'compensation_details' and record_id = '${rec}' and action = 'update'`);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: U.hrA, company_id: CO.a });
    expect(Number(a[0]!.before_data.base_salary)).toBe(8000);
    expect(Number(a[0]!.after_data.base_salary)).toBe(9000);
    expect(a[0]!.before_data.bank_iban).toBe("[redacted]");   // the audit trigger's own redaction is unchanged
    const corr = (await corrections(E.amount))[0]!;
    const b = await admin<Row>(`select actor_id, company_id, after_data from audit_log where table_name = 'compensation_corrections' and record_id = '${corr.id}'`);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ actor_id: U.hrA, company_id: CO.a });
    expect(b[0]!.after_data.reason).toBe(corr.reason);
  });

  it("Finance of the company may correct too (the same permission as changing pay); no other record or row is touched", async () => {
    const rec = await addRecord(E.fin, "2024-01-01", 5000, {}, true);
    const other = await records(E.amount);
    const r = await call(U.finA, correct(rec, null, 5200, null, "Typo in the basic salary", key()));
    expect(r).toMatchObject({ status: "applied" });
    expect((await corrections(E.fin))[0]!.corrected_by).toBe(U.finA);
    expect(await records(E.amount)).toEqual(other);
  });

  // ---------------------------------------------------------------------------------------------------------- dates: overlap, duplicates, reordering, hire date, future
  it("refuses a date that duplicates, overlaps or reorders another record's, accepts one between its neighbours, and writes nothing when it refuses", async () => {
    const r1 = await addRecord(E.chain, "2024-01-01", 4000, {}, false);
    const r2 = await addRecord(E.chain, "2024-07-01", 4500, {}, false);
    const r3 = await addRecord(E.chain, "2025-01-01", 5000, {}, true);
    const before = await records(E.chain);
    const refuse = (rec: string, date: string) => message(call(U.hrA, correct(rec, date, null, null, "Trying a date", key())));
    expect(await refuse(r2, "2025-01-01")).toMatch(/Another pay record already starts on 2025-01-01/);     // the same start as the next record: a duplicate
    expect(await refuse(r2, "2024-01-01")).toMatch(/Another pay record already starts on 2024-01-01/);     // the same start as the one before
    expect(await refuse(r2, "2025-06-01")).toMatch(/after the next pay record, which starts on 2025-01-01.*out of order/);   // past the next record: reorders history
    expect(await refuse(r3, "2024-03-01")).toMatch(/before the pay record that starts on 2024-07-01.*out of order/);          // before the previous record
    expect(await refuse(r1, "2024-09-01")).toMatch(/after the next pay record, which starts on 2024-07-01/);
    expect(await records(E.chain)).toEqual(before);
    expect(await corrections(E.chain)).toHaveLength(0);
    const ok = await call(U.hrA, correct(r2, "2024-08-15", null, null, "Raise took effect mid-August", key()));
    expect(ok).toMatchObject({ status: "applied" });
    expect((await records(E.chain)).map((x) => x.effective_from)).toEqual(["2024-01-01", "2024-08-15", "2025-01-01"]);
    expect((await records(E.chain)).filter((x) => x.is_current).map((x) => x.id)).toEqual([r3]);   // the current marker never moves
  });

  it("refuses a date before the hire date, and a date later than today (that is a scheduled change: Update pay)", async () => {
    const rec = await addRecord(E.hire, "2024-01-01", 6000, {}, true);
    expect(await message(call(U.hrA, correct(rec, "2023-12-31", null, null, "Wrong year", key())))).toMatch(/cannot start before the hire date \(2024-01-01\)/);
    expect(await message(call(U.hrA, correct(rec, day(10), null, null, "Future date", key())))).toMatch(/cannot be later than today.*Update pay/);
    expect(await records(E.hire)).toMatchObject([{ effective_from: "2024-01-01", base_salary: 6000 }]);
    expect(await corrections(E.hire)).toHaveLength(0);
  });

  it("refuses an empty change, a short reason, a zero or negative amount, an unknown allowance, and a bad request key", async () => {
    const rec = (await records(E.hire))[0]!.id as string;
    const m = (expr: string) => message(call(U.hrA, expr));
    expect(await m(correct(rec, null, null, null, "No change at all", key()))).toMatch(/Nothing changed/);
    expect(await m(correct(rec, null, 6000, { }, "Same figures typed again", key()))).toMatch(/Nothing changed/);
    expect(await m(correct(rec, null, 6100, null, "abc", key()))).toMatch(/at least 5 characters/);
    expect(await m(correct(rec, null, 0, null, "Zero salary", key()))).toMatch(/more than zero/);
    expect(await m(correct(rec, null, null, { other: -5 }, "Negative allowance", key()))).toMatch(/zero or more/);
    expect(await m(correct(rec, null, null, { bonus: 5 }, "Unknown allowance", key()))).toMatch(/no allowance called "bonus"/);
    expect(await m(correct(rec, null, 6100, null, "Key too short", "short"))).toMatch(/Reload the page/);
    expect(await corrections(E.hire)).toHaveLength(0);
  });

  it("a record that is already dated later (older data) may keep its date while only its amount is corrected", async () => {
    const rec = await addRecord(E.lone, day(20), 3000, {}, true);
    const r = await call(U.hrA, correct(rec, null, 3300, null, "Amount typed wrongly", key()));
    expect(r).toMatchObject({ status: "applied" });
    expect((await records(E.lone))[0]).toMatchObject({ effective_from: day(20), base_salary: 3300 });
  });

  // ---------------------------------------------------------------------------------------------------------- pending (scheduled / held) pay changes
  it("a SCHEDULED pay change worked out from this record blocks an AMOUNT correction until it is cancelled; a date-only correction before its date is allowed", async () => {
    const rec = await addRecord(E.pend, "2024-01-01", 5000, { housing: 100 }, true);
    await call(U.hrA, `record_employment_change('${E.pend}', '${day(30)}', null, 6000, null, 'Planned raise')`);
    const [ev] = await admin<{ id: string }>(`select id from employee_career_events where employee_id = '${E.pend}' and applied_at is null`);
    const m = await message(call(U.hrA, correct(rec, null, 5100, null, "Amount was typed wrongly", key())));
    expect(m).toMatch(new RegExp(`pay change for ${day(30)} is already scheduled.*Cancel that scheduled change first`));
    expect((await records(E.pend))[0]!.base_salary).toBe(5000);
    expect(await corrections(E.pend)).toHaveLength(0);
    // A date-only correction (the amounts the scheduled change carries are still right) goes through, and the result lists the pending change.
    const r = await call(U.hrA, correct(rec, "2024-02-01", null, null, "Start date was a month late", key()));
    expect(r.impact.pending_changes).toMatchObject([{ event_id: ev!.id, effective_date: day(30), held: false }]);
    // Cancelling the scheduled change unblocks the amount correction.
    await call(U.hrA, `dismiss_employment_change('${ev!.id}')`);
    expect(await call(U.hrA, correct(rec, null, 5100, null, "Amount was typed wrongly", key()))).toMatchObject({ status: "applied" });
    expect((await records(E.pend))[0]).toMatchObject({ base_salary: 5100, effective_from: "2024-02-01", is_current: true });
  });

  it("a pay change that is due but not applied yet blocks a date that reaches it; an earlier date is fine", async () => {
    const rec = await addRecord(E.pay, "2024-01-01", 5000, {}, true);
    await admin(`insert into employee_career_events (employee_id, event_type, effective_date, new_base_salary, new_allowances, base_compensation_id, created_by, applied_at) values ('${E.pay}', 'salary_change', '${day(-5)}', 5600, '{}', '${rec}', '${U.hrA}', null)`);
    expect(await message(call(U.hrA, correct(rec, day(-5), null, null, "Pick the same day", key())))).toMatch(/pay change is scheduled for .*must be before it/);
    expect(await message(call(U.hrA, correct(rec, day(-2), null, null, "Pick a later day", key())))).toMatch(/must be before it/);
    expect(await call(U.hrA, correct(rec, "2024-04-01", null, null, "Pick an earlier day", key()))).toMatchObject({ status: "applied" });
  });

  it("a change the daily job HELD for review never blocks a correction, and is listed in the result; a job-title-only change is ignored", async () => {
    const rec = await addRecord(E.held, "2024-01-01", 5000, {}, true);
    await admin(`insert into employee_career_events (employee_id, event_type, effective_date, new_base_salary, new_allowances, base_compensation_id, created_by, applied_at, conflict_at, conflict_reason)
                 values ('${E.held}', 'salary_change', '${day(-5)}', 5600, '{}', '${rec}', '${U.hrA}', null, now(), 'Pay changed after this change was scheduled.')`);
    await admin(`insert into employee_career_events (employee_id, event_type, effective_date, new_job_title, created_by, applied_at) values ('${E.held}', 'title_change', '${day(-1)}', 'Lead', '${U.hrA}', null)`);
    const r = await call(U.hrA, correct(rec, "2024-03-01", 5050, null, "Amount and date typed wrongly", key()));
    expect(r).toMatchObject({ status: "applied" });
    expect(r.impact.pending_changes).toHaveLength(1);
    expect(r.impact.pending_changes[0]).toMatchObject({ held: true });
    const ev = await admin<Row>(`select applied_at, conflict_reason from employee_career_events where employee_id = '${E.held}' order by event_type`);
    expect(ev.every((e) => e.applied_at === null)).toBe(true);    // nothing about the pending events was changed
  });

  // ---------------------------------------------------------------------------------------------------------- impact on payroll and settlement
  it("flags APPROVED payroll runs that carry a salary line for this person in the record's period, and changes no payroll row", async () => {
    const r1 = await addRecord(E.multi, "2024-01-01", 5000, {}, false);
    await addRecord(E.multi, "2025-01-01", 5500, {}, true);
    const run = async (month: number, year: number, status: string, withLine: boolean, sentAt: string | null = null) => {
      const [row] = await admin<{ id: string }>(`insert into payroll_export_runs (company_id, period_month, period_year, status, generated_by, sent_at) values ('${CO.a}', ${month}, ${year}, '${status}', '${U.finA}', ${q(sentAt)}) returning id`);
      if (withLine) await admin(`insert into payroll_export_lines (run_id, employee_id, component_code, amount, currency, created_by) values ('${row!.id}', '${E.multi}', 'basic_salary', 5000, 'AED', '${U.finA}')`);
      return row!.id;
    };
    const inPeriodSent = await run(3, 2024, "approved", true, "2024-04-02 09:00:00+00");   // approved and already sent to the payroll provider
    const inPeriodUnsent = await run(11, 2024, "approved", true);
    await run(4, 2024, "approved", false);                                                  // approved but carries no line for this person
    await run(5, 2024, "draft", true);                                                      // not approved
    await run(3, 2025, "approved", true);                                                   // approved, but after this record's period (the next record is in force)
    await run(6, 2023, "approved", true);                                                   // approved, but before the record's period began
    const snapshot = async () => ({
      runs: await admin<Row>(`select id, status, authorized_by, sent_at, file_path from payroll_export_runs order by id`),
      lines: await admin<Row>(`select id, run_id, employee_id, component_code, amount::float8 as amount from payroll_export_lines order by id`),
    });
    const before = await snapshot();
    const r = await call(U.hrA, correct(r1, "2024-02-15", 5200, null, "Basic salary and start date were wrong", key()));
    expect(r.impact.payroll_runs.map((x: Row) => x.run_id).sort()).toEqual([inPeriodSent, inPeriodUnsent].sort());
    const sent = r.impact.payroll_runs.find((x: Row) => x.run_id === inPeriodSent);
    expect(sent).toMatchObject({ period_month: 3, period_year: 2024, status: "approved" });
    expect(sent.sent_at).not.toBeNull();
    expect(r.impact.final_settlement).toBeNull();
    expect((await corrections(E.multi))[0]!.impact.payroll_runs).toHaveLength(2);   // the same flags are stored on the correction
    expect(await snapshot()).toEqual(before);                                       // nothing in payroll was touched
  });

  it("flags a FINAL SETTLEMENT that reads the corrected record (a person who has left) and changes no settlement input or status; an old record outside the termination date is not flagged", async () => {
    const cur = await addRecord(E.settle, "2024-01-01", 7000, {}, true);
    // The input's stamp trigger takes the signed-in user (none while seeding) and its audit trigger reads an id this table does not have, so both are switched off for this one seeded insert.
    await admin(`alter table termination_settlement_inputs disable trigger user;
                 insert into termination_settlement_inputs (employee_id, leave_encashment_daily_rate, entered_by) values ('${E.settle}', 250, '${U.hrA}');
                 alter table termination_settlement_inputs enable trigger user;`);
    await admin(`update employees set employment_status = 'terminated', termination_date = '2025-06-30' where id = '${E.settle}'`);
    const inputs = await admin<Row>(`select employee_id, leave_encashment_daily_rate::float8 as r, entered_by, entered_at from termination_settlement_inputs where employee_id = '${E.settle}'`);
    const emp = await admin<Row>(`select employment_status, termination_date::text, job_title from employees where id = '${E.settle}'`);
    const r = await call(U.hrA, correct(cur, null, 7300, null, "Basic salary typed wrongly", key()));
    expect(r.impact.final_settlement).toEqual({ termination_date: "2025-06-30", reads_current_pay: true, statutory_rate_recorded: true });
    expect(await admin<Row>(`select employee_id, leave_encashment_daily_rate::float8 as r, entered_by, entered_at from termination_settlement_inputs where employee_id = '${E.settle}'`)).toEqual(inputs);
    expect(await admin<Row>(`select employment_status, termination_date::text, job_title from employees where id = '${E.settle}'`)).toEqual(emp);

    // An earlier record that is not current and whose period ends before the termination date does not feed the settlement.
    const old = await addRecord(E.settleOld, "2024-01-01", 4000, {}, false);
    await addRecord(E.settleOld, "2024-06-01", 4400, {}, true);
    await admin(`update employees set employment_status = 'terminated', termination_date = '2025-06-30' where id = '${E.settleOld}'`);
    const r2 = await call(U.hrA, correct(old, null, 4100, null, "Amount typed wrongly", key()));
    expect(r2.impact.final_settlement).toBeNull();
    // A person still working never has one.
    expect((await call(U.hrA, correct((await records(E.fin))[0]!.id, null, 5300, null, "Fix again for a working person", key()))).impact.final_settlement).toBeNull();
  });

  it("a removed employee's pay cannot be corrected", async () => {
    const rec = await addRecord(E.removed, "2024-01-01", 4000, {}, true);
    await admin(`update employees set deleted_at = now() where id = '${E.removed}'`);
    expect(await message(call(U.hrA, correct(rec, null, 4100, null, "Fix for a removed person", key())))).toMatch(/was removed/);
  });

  // ---------------------------------------------------------------------------------------------------------- who may
  it("refuses another company's HR Admin, a plain employee (even for their own record), a line manager and anon, with one sentence, and an unknown record the same way; nothing changes", async () => {
    const rec = await addRecord(E.unauth, "2024-01-01", 5000, {}, true);
    const own = await addRecord(E.plain, "2024-01-01", 4000, {}, true);
    const before = [await records(E.unauth), await records(E.plain)];
    const sentence = "You are not allowed to correct this pay record.";
    expect(await message(call(U.hrB, correct(rec, null, 5100, null, "Other company tries", key())))).toBe(sentence);
    expect(await message(call(U.emp, correct(own, null, 4100, null, "Employee corrects own pay", key())))).toBe(sentence);
    expect(await message(call(U.mgr, correct(rec, null, 5100, null, "Manager tries", key())))).toBe(sentence);
    expect(await message(call(U.hrA, correct(randomUUID(), null, 5100, null, "Unknown record", key())))).toBe(sentence);
    expect(await code(call(U.hrB, correct(rec, null, 5100, null, "Other company tries", key())))).toBe("42501");
    expect(await code(call(null, correct(rec, null, 5100, null, "Anon tries", key())))).toBe("42501");
    expect(await code(call(U.hrA, `_hr_pay_in_force('${E.unauth}', current_date)`))).toBe("42501");   // the internal helper is not callable
    expect([await records(E.unauth), await records(E.plain)]).toEqual(before);
    expect(await corrections(E.unauth)).toHaveLength(0);
    expect(await corrections(E.plain)).toHaveLength(0);
  });

  it("another company's employee cannot be corrected through a record id from the right company (the record decides the company, never the caller)", async () => {
    const rec = await addRecord(E.other, "2024-01-01", 3000, {}, true, U.hrB);
    expect(await code(call(U.hrA, correct(rec, null, 3100, null, "Wrong company tries", key())))).toBe("42501");
    expect(await call(U.hrB, correct(rec, null, 3100, null, "Own company fixes it", key()))).toMatchObject({ status: "applied" });
  });

  // ---------------------------------------------------------------------------------------------------------- retry safety and concurrency
  it("the same request key twice applies once: the second call returns the first result, writes nothing and creates no second correction or audit row", async () => {
    const rec = await addRecord(E.idem, "2024-01-01", 5000, {}, true);
    const k = key();
    const first = await call(U.hrA, correct(rec, "2024-05-01", 5200, null, "Fix on the first try", k));
    const again = await call(U.hrA, correct(rec, "2024-05-01", 5200, null, "Fix on the first try", k));
    expect(first.status).toBe("applied");
    expect(again).toMatchObject({ status: "already_applied", correction_id: first.correction_id, compensation_id: rec });
    expect(again.new).toEqual(first.new);
    expect(again.impact).toEqual(first.impact);
    expect(await corrections(E.idem)).toHaveLength(1);
    const audit = await admin<{ n: string }>(`select count(*) n from audit_log where table_name = 'compensation_details' and record_id = '${rec}' and action = 'update'`);
    expect(Number(audit[0]!.n)).toBe(1);
    // The same key sent with different figures still returns the stored correction (the first request stands); it never applies a second time.
    const other = await call(U.hrA, correct(rec, null, 9999, null, "Different figures, same key", k));
    expect(other).toMatchObject({ status: "already_applied", correction_id: first.correction_id });
    expect((await records(E.idem))[0]).toMatchObject({ base_salary: 5200 });
    // The key belongs to one record: using it for another record of the employee is refused.
    const rec2 = await addRecord(E.idem, "2024-09-01", 5300, {}, false);
    expect(await message(call(U.hrA, correct(rec2, null, 5400, null, "Reusing a key", k)))).toMatch(/already used for a different pay record/);
    // Another employee may use the same key text: the key is per employee.
    const rec3 = await addRecord(E.allow, "2024-01-01", 5000, { housing: 1 }, true);
    expect(await call(U.hrA, correct(rec3, null, 5001, null, "Fix on another employee", k))).toMatchObject({ status: "applied" });
  });

  it("TWO SESSIONS: the same request sent twice at once applies once; and a correction waits for the employee's lock, then decides from what the first one committed", async () => {
    const rec = await addRecord(E.race, "2024-01-01", 5000, {}, true);
    const k = key();
    const both = await Promise.all([
      call(U.hrA, correct(rec, null, 5100, null, "Double tap, first", k)),
      call(U.hrA, correct(rec, null, 5100, null, "Double tap, second", k)),
    ]);
    expect(both.map((x) => x.status).sort()).toEqual(["already_applied", "applied"]);
    expect(await corrections(E.race)).toHaveLength(1);

    // Session A has corrected the record but not committed yet (it holds the employee's lock). Session B asks for the SAME figures with a different key: it must wait, then see A's result and refuse
    // "nothing changed" instead of writing a second correction from stale figures.
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const aHasLock = new Promise<void>((r) => { locked = r; });
    const a = db.asUserCommit(U.finA, async (query) => { await query(`select ${correct(rec, null, 5300, null, "Session A correction", key())}`); locked(); await hold; });
    await aHasLock;
    const b = message(call(U.hrA, correct(rec, null, 5300, null, "Session B correction", key())));
    let blocked = false;
    try {
      for (let i = 0; i < 60 && !blocked; i++) {
        const n = await admin<{ n: string }>(`select count(*) n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%correct_pay_record%'`);
        blocked = Number(n[0]!.n) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 100));
      }
    } finally { release(); }
    await a;
    expect(blocked, "session B should have been waiting on the employee's lock while A was open").toBe(true);
    expect(await b).toMatch(/Nothing changed/);
    expect(await corrections(E.race)).toHaveLength(2);
    expect((await records(E.race))[0]!.base_salary).toBe(5300);
  });

  // ---------------------------------------------------------------------------------------------------------- reading and writing the table
  it("HR Admin and Finance of the company read the corrections; another company's HR Admin, a plain employee, a line manager and anon read none", async () => {
    const read = (user: string | null) => db.asUser(user, async (query) => (await query(`select id from compensation_corrections where employee_id = '${E.amount}'`)).rows.length);
    expect(await read(U.hrA)).toBe(1);
    expect(await read(U.finA)).toBe(1);
    expect(await read(U.hrB)).toBe(0);
    expect(await read(U.emp)).toBe(0);
    expect(await read(U.mgr)).toBe(0);
    expect(await read(null)).toBe(0);
  });

  it("nobody can write the table directly (RLS refuses an insert, an update or a delete changes nothing) and even the owner cannot change or remove a correction", async () => {
    const [c] = await corrections(E.amount);
    const insert = `insert into compensation_corrections (company_id, employee_id, compensation_id, request_key, previous_effective_from, previous_base_salary, previous_allowances, new_effective_from, new_base_salary, new_allowances, currency, reason, corrected_by)
                    values ('${CO.a}', '${E.amount}', '${c!.compensation_id}', 'direct-write-1', '2024-01-01', 1, '{}', '2024-01-01', 2, '{}', 'AED', 'Direct write', '${U.hrA}')`;
    for (const user of [U.hrA, U.finA]) {
      expect(await code(db.asUser(user, (query) => query(insert)))).toBe("42501");
      expect(await db.asUser(user, async (query) => (await query(`update compensation_corrections set reason = 'edited' where id = '${c!.id}'`)).rowCount)).toBe(0);
      expect(await db.asUser(user, async (query) => (await query(`delete from compensation_corrections where id = '${c!.id}'`)).rowCount)).toBe(0);
    }
    expect(await code(db.asUser(null, (query) => query(insert)))).toMatch(/42501/);
    expect(await message(db.seed(`update compensation_corrections set reason = 'edited by owner' where id = '${c!.id}'`))).toMatch(/permanent record/);
    expect(await message(db.seed(`delete from compensation_corrections where id = '${c!.id}'`))).toMatch(/permanent record/);
    expect((await corrections(E.amount))[0]!.reason).toBe("Entered last year's figure by mistake");
  });

  // ---------------------------------------------------------------------------------------------------------- owner packs and re-running the migration
  it("the migration file can be applied again, the preflight says it is installed, and the verify pack says OK on every row (after the platform's table privileges are applied)", async () => {
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/migrations/20270118000200_people_hr_pay_correction.sql"), "utf8"));
    const old = await admin<{ n: string }>(`select count(*) n from pg_proc where proname = 'correct_pay_record'`);
    expect(Number(old[0]!.n)).toBe(1);
    const pre = (await db.seed(manual("people_hr_pay_correction_00_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[0]!.result).toBe("OK");
    expect(pre[1]!.result).toMatch(/^already installed/);
    expect(pre.slice(2).every((r) => /^\d+$/.test(r.result))).toBe(true);
    // Applying the file again has just re-run its revokes, so every row is OK. (The test database grants every table to the API roles after the first run, which is why this order matters.)
    let verify = await admin<{ item: string; result: string }>(manual("people_hr_pay_correction_20_verify_readonly.sql"));
    expect(verify).toHaveLength(8);
    expect(verify.slice(0, 7).map((r) => r.result)).toEqual(Array(7).fill("OK"));
    expect(Number(verify[7]!.result)).toBeGreaterThan(0);
    // The pack really does detect a table privilege that is still granted, and the revoke it names puts it right.
    await admin(`grant select, insert, update, delete on compensation_corrections to anon, authenticated;`);
    verify = await admin<{ item: string; result: string }>(manual("people_hr_pay_correction_20_verify_readonly.sql"));
    expect(verify[3]!.result).toMatch(/^FAIL - a table privilege is still granted/);
    await admin(`revoke all on compensation_corrections from anon; revoke insert, update, delete, truncate on compensation_corrections from authenticated;`);
    verify = await admin<{ item: string; result: string }>(manual("people_hr_pay_correction_20_verify_readonly.sql"));
    expect(verify.slice(0, 7).map((r) => r.result)).toEqual(Array(7).fill("OK"));
  });

  it("the rollback stops while any correction exists, and once the owner has exported them it removes only what the migration added and leaves every pay record as corrected", async () => {
    expect(await message(db.seed(manual("people_hr_pay_correction_90_rollback.sql")))).toMatch(/STOP: \d+ pay correction/);
    expect(await admin<{ n: string }>(`select count(*) n from pg_proc where proname = 'correct_pay_record'`)).toEqual([{ n: "1" }]);   // nothing was dropped
    const payBefore = await admin<Row>(`select id, effective_from::text, base_salary::float8 as b from compensation_details order by id`);
    await admin(`alter table compensation_corrections disable trigger compensation_corrections_no_change; delete from compensation_corrections; alter table compensation_corrections enable trigger compensation_corrections_no_change;`);
    await db.seed(manual("people_hr_pay_correction_90_rollback.sql"));
    await db.seed(manual("people_hr_pay_correction_90_rollback.sql")); // safe twice
    const left = await admin<{ n: string }>(`select count(*) n from pg_proc where proname in ('correct_pay_record', '_hr_pay_in_force', 'compensation_corrections_append_only')`);
    expect(Number(left[0]!.n)).toBe(0);
    expect((await admin<{ t: string | null }>(`select to_regclass('public.compensation_corrections')::text as t`))[0]!.t).toBeNull();
    expect(await admin<Row>(`select id, effective_from::text, base_salary::float8 as b from compensation_details order by id`)).toEqual(payBefore);
    // Phase 1 is untouched: the existing pay change function is still there.
    expect((await admin<{ n: string }>(`select count(*) n from pg_proc where proname = 'record_employment_change'`))[0]!.n).toBe("1");
    // Applying the migration again after a rollback installs it afresh.
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/migrations/20270118000200_people_hr_pay_correction.sql"), "utf8"));
    expect(Number((await admin<{ n: string }>(`select count(*) n from pg_proc where proname = 'correct_pay_record'`))[0]!.n)).toBe(1);
  });
});
