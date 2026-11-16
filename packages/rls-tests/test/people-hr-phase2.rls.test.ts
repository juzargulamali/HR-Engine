import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// People & HR Phase 2 (migration 20270116000100_people_hr_phase2_queue.sql), against a real Postgres. Fictional data throughout.
//   * acknowledging an HR queue item records that it was SEEN and changes nothing else: the contract, document or attendance record is untouched, so whether the issue is still open is always
//     derived from the source;
//   * only HR Admin of the item's own company may acknowledge; the company and employee come from the source record, never from the caller; CEO/CTO may read, nobody else may;
//   * an acknowledgement belongs to one date: if the record changed since the screen was loaded the call refuses; asking twice is not an error and leaves one row;
//   * there is no direct write path to the table; the packs behave as documented.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { hrA: id(), hrB: id(), ceoA: id(), emp: id(), mgr: id() };
const E = { emp: id(), other: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@hrp2.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ID = { doc: id(), docRemoved: id(), ident: id(), contract: id(), probation: id(), att: id(), win: id(), docOther: id(), alert: id() };

describe("People & HR Phase 2: acknowledging an HR queue item", () => {
  const db = new RlsTestDatabase();
  const ack = (user: string, kind: string, source: string, date: string, note: string | null = null) =>
    db.asUserCommit(user, async (query) => { await query(`select acknowledge_hr_queue_item('${kind}', '${source}', '${date}', ${note === null ? "null" : `'${note}'`})`); });
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const message = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return (e as Error).message; } };
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const rowsFor = (source: string) => admin<Row>(`select * from hr_queue_acknowledgements where source_id = '${source}'`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional Aurora LLC', 'AE', 'AED'), ('${CO.b}', 'Fictional Birch LLC', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, job_title) values
        ('${E.emp}', '${U.emp}', 'P2-001', '${CO.a}', 'AE', 'Fictional', 'Technician', '2024-01-01', 'Technician'),
        ('${E.other}', null, 'P2-002', '${CO.b}', 'AE', 'Fictional', 'OtherCo', '2024-01-01', 'Clerk');
      update employees set manager_id = null where id = '${E.emp}';
      insert into user_roles (user_id, role, company_id) values ('${U.hrA}', 'hr_admin', '${CO.a}'), ('${U.hrB}', 'hr_admin', '${CO.b}'), ('${U.ceoA}', 'ceo', '${CO.a}'), ('${U.mgr}', 'line_manager', '${CO.a}');
      insert into employee_documents (id, employee_id, document_type, file_path, expiry_date) values
        ('${ID.doc}', '${E.emp}', 'visa', 'a/b/visa.pdf', '${day(-3)}'),
        ('${ID.docOther}', '${E.other}', 'visa', 'a/b/visa2.pdf', '${day(-3)}');
      insert into employee_documents (id, employee_id, document_type, file_path, expiry_date, deleted_at) values ('${ID.docRemoved}', '${E.emp}', 'certificate', 'a/b/c.pdf', '${day(-3)}', now());
      insert into identity_documents (id, employee_id, document_type, document_number, expiry_date, created_by) values ('${ID.ident}', '${E.emp}', 'passport', 'FICTIONAL-0001', '${day(10)}', '${U.hrA}');
      insert into employment_contracts (id, employee_id, contract_type, start_date, end_date, probation_end_date, is_current, version_no, created_by) values
        ('${ID.contract}', '${E.emp}', 'fixed_term', '2024-01-01', '${day(12)}', null, true, 1, '${U.hrA}'),
        ('${ID.probation}', '${E.other}', 'probation', '2024-01-01', null, '${day(0)}', true, 1, '${U.hrB}');
      insert into attendance_records (id, employee_id, work_date, status, source, presence_conflict) values ('${ID.att}', '${E.emp}', '${day(-1)}', 'present', 'manual', 'Self-clock activity exists for this day');
      -- a recovery window waiting for HR verification (its period and policy version are not needed for what is proved here, so their foreign keys are not enforced while seeding)
      set local session_replication_role = replica;
      insert into recovery_windows (id, period_id, employee_id, company_id, window_index, window_start, window_end, status, closed_at, closed_reason, starting_local_date, country_code, timezone, classification, policy_version_id, hr_verification_required)
        values ('${ID.win}', '${id()}', '${E.emp}', '${CO.a}', 1, now() - interval '30 hours', now() - interval '6 hours', 'closed', now(), 'elapsed_window', '${day(-2)}', 'AE', 'Asia/Dubai', 'rest_day', '${id()}', true);
    `);
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  it("HR Admin of the company acknowledges a document: the company and employee come from the document, the note is kept, and the document itself is unchanged", async () => {
    const before = await admin<Row>(`select * from employee_documents where id = '${ID.doc}'`);
    await ack(U.hrA, "employee_document", ID.doc, day(-3), "Renewal booked with the PRO");
    const r = await rowsFor(ID.doc);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ company_id: CO.a, employee_id: E.emp, kind: "employee_document", note: "Renewal booked with the PRO", acknowledged_by: U.hrA });
    expect(r[0]!.source_date.toISOString?.().slice(0, 10) ?? String(r[0]!.source_date).slice(0, 10)).toBe(day(-3));
    expect(await admin<Row>(`select * from employee_documents where id = '${ID.doc}'`)).toEqual(before); // still expired, still the same row: acknowledging is "seen", not "resolved"
  });

  it("acknowledging again is not an error and leaves one row (the first acknowledgement stands)", async () => {
    await ack(U.hrA, "employee_document", ID.doc, day(-3), "A second look");
    const r = await rowsFor(ID.doc);
    expect(r).toHaveLength(1);
    expect(r[0]!.note).toBe("Renewal booked with the PRO");
  });

  it("the other kinds work the same way: identity document, current contract end, probation, a day where manual and clock records differ, and a recovery window waiting for verification", async () => {
    await ack(U.hrA, "identity_document", ID.ident, day(10));
    await ack(U.hrA, "contract_end", ID.contract, day(12));
    await ack(U.hrB, "probation", ID.probation, day(0));
    await ack(U.hrA, "attendance", ID.att, day(-1));
    await ack(U.hrA, "attendance", ID.win, day(-2));
    expect((await rowsFor(ID.ident))[0]).toMatchObject({ company_id: CO.a, kind: "identity_document" });
    expect((await rowsFor(ID.contract))[0]).toMatchObject({ company_id: CO.a, kind: "contract_end" });
    expect((await rowsFor(ID.probation))[0]).toMatchObject({ company_id: CO.b, employee_id: E.other, kind: "probation" });
    expect((await rowsFor(ID.att))[0]).toMatchObject({ company_id: CO.a, employee_id: E.emp, kind: "attendance" });
    expect((await rowsFor(ID.win))[0]).toMatchObject({ company_id: CO.a, employee_id: E.emp, kind: "attendance" });
  });

  it("HR Admin of another company, a CEO, the employee and the line manager are all refused with the same message and nothing is recorded", async () => {
    const fresh = await admin<{ id: string }>(`insert into employee_documents (employee_id, document_type, file_path, expiry_date) values ('${E.emp}', 'labor_card', 'a/b/lc.pdf', '${day(-8)}') returning id`);
    const target = fresh[0]!.id;
    for (const u of [U.hrB, U.ceoA, U.emp, U.mgr]) expect(await message(ack(u, "employee_document", target, day(-8)))).toMatch(/Only HR Admin may acknowledge this item/);
    expect(await rowsFor(target)).toHaveLength(0);
  });

  it("a stale screen is refused: the record's date changed, the document was removed, or the contract is no longer current", async () => {
    expect(await message(ack(U.hrA, "employee_document", ID.docOther, day(-3)))).toMatch(/Only HR Admin may acknowledge/); // exists, but another company
    expect(await message(ack(U.hrA, "employee_document", ID.docRemoved, day(-3)))).toMatch(/changed or is already resolved/);
    const renewed = await admin<{ id: string }>(`insert into employee_documents (employee_id, document_type, file_path, expiry_date) values ('${E.emp}', 'other', 'a/b/o.pdf', '${day(-20)}') returning id`);
    await admin(`update employee_documents set expiry_date = '${day(300)}' where id = '${renewed[0]!.id}'`);
    expect(await message(ack(U.hrA, "employee_document", renewed[0]!.id, day(-20)))).toMatch(/changed or is already resolved/);
    await admin(`update employment_contracts set is_current = false where id = '${ID.contract}'`);
    await admin(`delete from hr_queue_acknowledgements where source_id = '${ID.contract}'`);
    expect(await message(ack(U.hrA, "contract_end", ID.contract, day(12)))).toMatch(/changed or is already resolved/);
    expect(await message(ack(U.hrA, "attendance", id(), day(-1)))).toMatch(/changed or is already resolved/);
    expect(await message(ack(U.hrA, "employee_document", "not-a-uuid", day(-1)))).not.toBe("");
    expect(await message(ack(U.hrA, "bogus", ID.doc, day(-3)))).toMatch(/Unknown item type/);
  });

  it("an acknowledgement belongs to one date: after a renewal moves the date it no longer applies, and the new date can be acknowledged on its own", async () => {
    const d = await admin<{ id: string }>(`insert into employee_documents (employee_id, document_type, file_path, expiry_date) values ('${E.emp}', 'visa', 'a/b/v2.pdf', '${day(-5)}') returning id`);
    const docId = d[0]!.id;
    await ack(U.hrA, "employee_document", docId, day(-5));
    await admin(`update employee_documents set expiry_date = '${day(20)}' where id = '${docId}'`);
    expect(await message(ack(U.hrA, "employee_document", docId, day(-5)))).toMatch(/changed or is already resolved/);
    await ack(U.hrA, "employee_document", docId, day(20));
    expect(await rowsFor(docId)).toHaveLength(2);
  });

  it("nobody can write the table directly (row level security refuses an insert and an update or delete changes nothing); HR Admin and CEO of the company read their own company's acknowledgements, other companies and employees do not", async () => {
    const before = await rowsFor(ID.ident);
    expect(await code(db.asUserCommit(U.hrA, async (query) => { await query(`insert into hr_queue_acknowledgements (company_id, employee_id, kind, source_id, source_date, acknowledged_by) values ('${CO.a}', '${E.emp}', 'probation', '${id()}', '${day(0)}', '${U.hrA}')`); }))).toBe("42501");
    await db.asUserCommit(U.hrA, async (query) => { await query(`update hr_queue_acknowledgements set note = 'changed'`); await query(`delete from hr_queue_acknowledgements`); });
    expect(await rowsFor(ID.ident)).toEqual(before);
    const seen = async (u: string) => (await db.asUserCommit(u, async (query) => (await query(`select company_id from hr_queue_acknowledgements`)).rows as { company_id: string }[]));
    expect(new Set((await seen(U.hrA)).map((r) => r.company_id))).toEqual(new Set([CO.a]));
    expect(new Set((await seen(U.hrB)).map((r) => r.company_id))).toEqual(new Set([CO.b]));
    expect(await seen(U.emp)).toEqual([]);
    expect(await seen(U.mgr)).toEqual([]);
  });

  it("an acknowledgement is readable only by someone who can read ITS SOURCE record: a CEO reads the contract and recovery-window ones, and NONE of the identity-document metadata, document, or attendance-day ones (or their notes)", async () => {
    // acknowledge one of every kind in company A as HR Admin, each with a note
    const tag = (n: string) => `note for ${n}`;
    const doc = (await admin<{ id: string }>(`insert into employee_documents (employee_id, document_type, file_path, expiry_date) values ('${E.emp}', 'visa', 'a/b/p2v.pdf', '${day(-9)}') returning id`))[0]!.id;
    const ident = (await admin<{ id: string }>(`insert into identity_documents (employee_id, document_type, document_number, expiry_date, created_by) values ('${E.emp}', 'iqama', 'FICTIONAL-0777', '${day(-9)}', '${U.hrA}') returning id`))[0]!.id;
    const contract = (await admin<{ id: string }>(`insert into employment_contracts (employee_id, contract_type, start_date, end_date, is_current, version_no, created_by) values ('${E.emp}', 'fixed_term', '2025-01-01', '${day(9)}', true, 2, '${U.hrA}') returning id`))[0]!.id;
    const att = (await admin<{ id: string }>(`insert into attendance_records (employee_id, work_date, status, source, presence_conflict) values ('${E.emp}', '${day(-6)}', 'present', 'manual', 'differs') returning id`))[0]!.id;
    const kinds: [string, string, string, boolean][] = [
      ["employee_document", doc, day(-9), false], ["identity_document", ident, day(-9), false], ["contract_end", contract, day(9), true], ["attendance", att, day(-6), false], ["attendance", ID.win, day(-2), true],
    ];
    for (const [kind, source, date] of kinds) { await db.seed(`delete from hr_queue_acknowledgements where source_id = '${source}'`); await ack(U.hrA, kind, source, date, tag(kind === "attendance" ? source.slice(0, 8) : kind)); }
    const notesOf = async (u: string) => (await db.asUserCommit(u, async (query) => (await query(`select kind, source_id, note from hr_queue_acknowledgements where source_id in ('${doc}', '${ident}', '${contract}', '${att}', '${ID.win}')`)).rows as { kind: string; source_id: string; note: string }[]));
    const hr = await notesOf(U.hrA);
    expect(hr.map((r) => r.source_id).sort()).toEqual([doc, ident, contract, att, ID.win].sort());   // HR Admin reads every kind
    const ceo = await notesOf(U.ceoA);
    // the CEO can read contracts and recovery windows of the company, but not employee documents, identity documents or attendance records, so those acknowledgements (and HR's notes on them) are not theirs to read
    expect(ceo.map((r) => r.source_id).sort()).toEqual([contract, ID.win].sort());
    expect(JSON.stringify(ceo)).not.toMatch(/FICTIONAL-0777|visa|iqama/);
    expect(await notesOf(U.emp)).toEqual([]);   // the employee can read their own documents and contract, but HR's note on them is not theirs
    expect(await notesOf(U.mgr)).toEqual([]);
    expect(await notesOf(U.hrB)).toEqual([]);   // another company's HR Admin reads none of company A
    // it follows the source's own visibility: HR Admin still reads a REMOVED document (the profile lists it as Removed), so its acknowledgement stays readable; once the source row no longer exists
    // nobody but the table owner can read the acknowledgement, and the row is kept
    await admin(`update employee_documents set deleted_at = now() where id = '${doc}'`);
    expect((await notesOf(U.hrA)).map((r) => r.source_id)).toContain(doc);
    await admin(`delete from identity_documents where id = '${ident}'`);
    expect((await notesOf(U.hrA)).map((r) => r.source_id)).not.toContain(ident);
    expect(await rowsFor(ident)).toHaveLength(1);
  });

  it("each acknowledgement is audited", async () => {
    const n = await admin<{ n: string }>(`select count(*) n from audit_log where table_name = 'hr_queue_acknowledgements'`);
    expect(Number(n[0]!.n)).toBeGreaterThan(0);
  });

  it("the packs behave as documented: preflight, verify (every row OK) and rollback (stops while acknowledgements exist)", async () => {
    const pre = (await db.seed(manual("people_hr_phase2_00_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[0]!.result).toBe("OK");
    expect(pre[1]!.result).toMatch(/^already installed/);
    expect(pre[2]!.result).toBe("OK");
    const verify = await admin<{ item: string; result: string }>(manual("people_hr_phase2_20_verify_readonly.sql"));
    expect(verify.filter((r) => r.result !== "OK" && !/^\d+$/.test(r.result))).toEqual([]);
    expect(verify).toHaveLength(7);
    expect(await message(db.seed(manual("people_hr_phase2_90_rollback.sql")))).toMatch(/STOP: \d+ acknowledgement\(s\) exist/);
    await admin(`delete from hr_queue_acknowledgements`);
    await db.seed(manual("people_hr_phase2_90_rollback.sql"));
    await db.seed(manual("people_hr_phase2_90_rollback.sql")); // safe to run twice
    expect((await admin<Row>(`select to_regclass('public.hr_queue_acknowledgements') as t`))[0]!.t).toBeNull();
  });
});
