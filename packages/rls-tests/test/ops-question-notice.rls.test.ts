import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Operations asks Sales a question: one in-app notice (migration 20270112000200_ops_question_notice.sql), against a real Postgres.
//   * a new question tells the enquiry's owner once; the same question again, other planning fields, a retry and two saves at once tell nobody again;
//   * a changed question keeps ONE unread notice; once the notice was read, a changed question tells again;
//   * answering or withdrawing the question clears the unread notice;
//   * the owner who asked is not told; an owner who cannot act hands the notice to the company's Sales founders; another company is never told;
//   * the notice carries no text of the question, and each person reads and dismisses only their own.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { sales: id(), salesFounder: id(), salesFounder2: id(), gone: id(), opsOwner: id(), ops: id(), ops2: id(), salesB: id(), opsB: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@opsq-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const SECRET = "QUESTION-TEXT-NEVER-IN-A-NOTICE";

describe("Operations question: Sales is told once", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const notices = (user?: string, opp?: string) => admin(`select user_id, read_at is null as unread, payload from notifications where type = 'project_ops_question'${user ? ` and user_id = '${user}'` : ""}${opp ? ` and payload ->> 'opportunity_id' = '${opp}'` : ""} order by created_at`);
  const ask = (user: string, opp: string, patch: Record<string, unknown>) => call(user, `ops_set_enquiry_planning('${opp}', ${j(patch)})`);
  let OPP = "", OPP_GONE = "", OPP_SELF = "", OPP_B = "", OPP_RACE = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.a}', '{}'), ('${U.salesFounder}', '${CO.a}', '{founder}'), ('${U.salesFounder2}', '${CO.a}', '{founder}'),
        ('${U.gone}', '${CO.a}', '{}'), ('${U.opsOwner}', '${CO.a}', '{}'), ('${U.salesB}', '${CO.b}', '{founder}');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'KSA');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.ops}', '${CO.a}', '{operations}'), ('${U.ops2}', '${CO.a}', '{operations}'), ('${U.opsOwner}', '${CO.a}', '{operations}'), ('${U.opsB}', '${CO.b}', '{operations}');
    `);
    const org = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Motors', 'client') returning id`))[0]!.id;
    const opp = (company: string, owner: string, ref: string) => admin<{ id: string }>(`insert into crm_opportunities (company_id, reference, title, client_org_id, source, owner_id, created_by, stage, currency, ops_flagged_at, ops_flagged_by)
      values ('${company}', '${ref}', 'Stand ${ref}', '${org}', 'direct_client', '${owner}', '${owner}', 'proposal_sent', 'AED', now(), '${owner}') returning id`).then((r) => r[0]!.id);
    OPP = await opp(CO.a, U.sales, "UAE-O-2027-0201");
    OPP_GONE = await opp(CO.a, U.gone, "UAE-O-2027-0202");
    OPP_SELF = await opp(CO.a, U.opsOwner, "UAE-O-2027-0203");
    OPP_RACE = await opp(CO.a, U.sales, "UAE-O-2027-0204");
    OPP_B = await opp(CO.b, U.salesB, "KSA-O-2027-0201");
  });
  afterAll(async () => db.teardown());

  it("planning fields without a question tell nobody; a question tells the owner once, with no text of the question", async () => {
    await ask(U.ops, OPP, { risk: "high", risk_note: "Tight load-in", capacity_conflict: true });
    expect(await notices()).toEqual([]);
    await ask(U.ops, OPP, { question: `Is the power drop confirmed? ${SECRET}` });
    const sent = await notices();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ user_id: U.sales, unread: true });
    expect(Object.keys(sent[0]!.payload).sort()).toEqual(["dedupe_key", "opportunity_id", "project_id", "reference"]);
    expect(sent[0]!.payload).toMatchObject({ opportunity_id: OPP, reference: "UAE-O-2027-0201", dedupe_key: `ops_question:${OPP}`, project_id: null });
    expect(JSON.stringify(sent)).not.toContain(SECRET);
    // neither the Sales founders (the owner can act) nor the asker nor the other Operations Manager
    for (const who of [U.salesFounder, U.salesFounder2, U.ops, U.ops2]) expect(await notices(who), who).toEqual([]);
  });

  it("the same question again, other fields, a retry and a blank-padded copy send nothing more", async () => {
    await ask(U.ops, OPP, { question: `Is the power drop confirmed? ${SECRET}` });
    await ask(U.ops, OPP, { question: `  Is the power drop confirmed? ${SECRET}  ` });
    await ask(U.ops2, OPP, { question: `Is the power drop confirmed? ${SECRET}`, risk: "medium" });
    await ask(U.ops, OPP, { risk_note: "Still tight", capacity_note: "Two crews" });
    await ask(U.ops, OPP, {});
    expect(await notices()).toHaveLength(1);
    // the history has one "asked Sales" line, as before this migration
    expect(await admin(`select 1 from crm_opportunity_events where opportunity_id = '${OPP}' and reason like '%asked Sales to confirm details%'`)).toHaveLength(1);
  });

  it("a changed question while the notice is unread keeps ONE notice; after it was read, a changed question tells again, once", async () => {
    await ask(U.ops, OPP, { question: "Is the power drop on the left or the right?" });
    expect(await notices(U.sales)).toHaveLength(1);
    // the owner reads (dismisses) their own notice through the existing function; somebody else's call marks nothing
    expect(await call<number>(U.salesFounder, `proj_mark_notifications_read(null)`)).toBe(0);
    expect(await call<number>(U.sales, `proj_mark_notifications_read(null)`)).toBe(1);
    await ask(U.ops, OPP, { question: "Is the power drop on the left or the right?" });          // unchanged: nothing
    expect((await notices(U.sales)).filter((n) => n.unread)).toHaveLength(0);
    await ask(U.ops, OPP, { question: "And is rigging allowed from the ceiling?" });
    await ask(U.ops, OPP, { question: "And is rigging allowed from the ceiling?" });
    const mine = await notices(U.sales);
    expect(mine).toHaveLength(2);
    expect(mine.filter((n) => n.unread)).toHaveLength(1);
  });

  it("Sales answers: the unread notice is cleared and Operations is told as before; a new question after the answer tells again", async () => {
    await call(U.sales, `crm_set_ops_planning('${OPP}', null, ${j({ answer: "Yes, from the ceiling" })}, null)`);
    expect((await notices(U.sales)).filter((n) => n.unread)).toHaveLength(0);
    expect((await admin(`select 1 from notifications where type = 'project_ops_sales_answered' and user_id = '${U.ops}'`)).length).toBeGreaterThanOrEqual(1);
    await ask(U.ops, OPP, { question: "One more: who signs off the drawings?" });
    expect((await notices(U.sales)).filter((n) => n.unread)).toHaveLength(1);
    // Operations withdraws the question: nothing is left asking
    await ask(U.ops, OPP, { question: "" });
    expect((await notices(U.sales)).filter((n) => n.unread)).toHaveLength(0);
    expect(await notices(U.sales)).toHaveLength(3);
  });

  it("two saves of the same new question at the same moment create one notice", async () => {
    await Promise.all([ask(U.ops, OPP_RACE, { question: "Same moment?" }), ask(U.ops2, OPP_RACE, { question: "Same moment?" }), ask(U.ops, OPP_RACE, { question: "Same moment?" })]);
    expect(await notices(U.sales, OPP_RACE)).toHaveLength(1);
  });

  it("an owner who cannot act hands the notice to the Sales founders; an owner who asked is not told and the founders are", async () => {
    await admin(`update crm_company_grants set revoked_at = now(), revoked_by = '${U.salesFounder}' where user_id = '${U.gone}' and company_id = '${CO.a}'`);
    await ask(U.ops, OPP_GONE, { question: "Who do I ask now?" });
    expect(await notices(U.gone)).toEqual([]);
    expect((await notices(undefined, OPP_GONE)).map((n) => n.user_id).sort()).toEqual([U.salesFounder, U.salesFounder2].sort());
    // an inactive owner
    await admin(`update crm_company_grants set revoked_at = null, revoked_by = null where user_id = '${U.gone}' and company_id = '${CO.a}'`);
    await admin(`update profiles set is_active = false where id = '${U.gone}'`);
    await ask(U.ops, OPP_GONE, { question: "Changed question" });                             // the founders' notices are still unread: nothing more
    expect(await notices(undefined, OPP_GONE)).toHaveLength(2);
    // the owner is the Operations Manager who asked
    await ask(U.opsOwner, OPP_SELF, { question: "My own enquiry: what did the client say?" });
    expect(await notices(U.opsOwner)).toEqual([]);
    expect((await notices(undefined, OPP_SELF)).map((n) => n.user_id).sort()).toEqual([U.salesFounder, U.salesFounder2].sort());
    // another Operations Manager asks on that enquiry: now the owner is told
    await ask(U.ops, OPP_SELF, { question: "A colleague asks instead" });
    expect((await notices(U.opsOwner, OPP_SELF))).toHaveLength(1);
  });

  it("company boundary and privacy: another company is never told; each person reads only their own notice; the helpers are not callable", async () => {
    await ask(U.opsB, OPP_B, { question: "KSA question" });
    expect((await notices(undefined, OPP_B)).map((n) => n.user_id)).toEqual([U.salesB]);
    await expect(ask(U.opsB, OPP, { question: "Not my company" })).rejects.toThrow(/not found/i);
    await expect(ask(U.sales, OPP, { question: "Sales cannot ask itself" })).rejects.toThrow(/not found/i);
    // own rows only, through the table's existing policy and through the Project notices read
    const seenBySales = await q(U.sales, `select user_id from notifications where type = 'project_ops_question'`);
    expect(seenBySales.length).toBeGreaterThan(0);
    expect(new Set(seenBySales.map((r) => r.user_id))).toEqual(new Set([U.sales]));
    expect(await q(U.salesB, `select 1 from notifications where type = 'project_ops_question' and payload ->> 'opportunity_id' = '${OPP}'`)).toEqual([]);
    expect((await q(U.salesFounder, `select type from proj_my_notifications(50, true)`)).map((r) => r.type)).toContain("project_ops_question");
    await expect(q(U.sales, `select ops_question_recipients('${OPP}')`)).rejects.toThrow(/permission denied/);
    await expect(q(null, `select ops_question_recipients('${OPP}')`)).rejects.toThrow();
  });

  it("owner pack: verify says OK, the preflight counts the unanswered questions, the rollback runs twice and questions still save", async () => {
    const verify = await admin<{ item: string; result: string }>(pack("ops_question_notice_20_verify_readonly.sql"));
    for (const r of verify) if (!/^information/.test(r.item)) expect(r.result, r.item).toBe("OK");
    const pre = await admin<{ item: string; result: string }>(pack("ops_question_notice_00_preflight_readonly.sql"));
    expect(pre.find((r) => /not installed yet/.test(r.item))!.result).toBe("already installed");
    expect(Number(pre.find((r) => /not answered by Sales/.test(r.item))!.result)).toBeGreaterThanOrEqual(3);
    expect(Number(pre.find((r) => /inactive or without Sales access/.test(r.item))!.result)).toBe(1);
    await db.seed(pack("ops_question_notice_90_rollback.sql"));
    await db.seed(pack("ops_question_notice_90_rollback.sql"));
    const before = (await notices()).length;
    await ask(U.ops, OPP, { question: "After the rollback nobody is told" });
    expect((await notices()).length).toBe(before);
    expect((await admin(`select question from ops_enquiry_planning where opportunity_id = '${OPP}'`))[0]!.question).toBe("After the rollback nobody is told");
    await db.applyMigration("20270112000200_ops_question_notice.sql");
    await db.applyMigration("20270112000200_ops_question_notice.sql");
    await ask(U.ops, OPP, { question: "Installed again: told once" });
    expect((await notices()).length).toBe(before + 1);
  });
});
