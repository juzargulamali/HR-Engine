import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// New enquiry with a submission identifier (migration 20270112000400_crm_enquiry_submission_key.sql), against a real Postgres.
//   * the first save creates the enquiry; the same identifier again (a retry after a lost answer, a double click) returns the ORIGINAL enquiry and creates nothing;
//   * two calls with the same identifier on two connections at the same moment create exactly one (one waits for the other);
//   * two different identifiers with identical details create two enquiries; without an identifier it is the old behaviour;
//   * the identifier is per person: another person's same identifier is their own; nobody reads the table;
//   * the old function keeps its signature; a refused save records nothing and can be tried again with the same identifier;
//   * with an outreach: the outreach's existing enquiry is returned, and one identifier and one outreach still mean one enquiry;
//   * the owner pack: preflight (lists look-alike pairs, changes nothing), verify, rollback twice.

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { sara: id(), omar: id(), lead: id(), ksaOnly: id(), nogrant: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@submit-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const MIGRATION = "20270112000400_crm_enquiry_submission_key.sql";

describe("New enquiry: one enquiry per submission identifier", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  let ORG = "", CONTACT = "";
  const fields = (over: Record<string, unknown> = {}) => ({
    company_id: CO.uae, title: "Fictional gala dinner", source: "website", next_title: "Call the client", next_due: "2027-03-01T05:00:00Z", next_kind: "call",
    agency_org_id: ORG, client_org_id: null, owner_id: null, currency: "aed", value: 125000.5, budget_note: " Around 125k ", brief: "LED wall and stage", event_start: "2027-04-10", event_end: "2027-04-11",
    install_start: "2027-04-08", location: "Dubai", technologies: [{ name: "LED wall", qty: 2 }], scope: "Supply and install", waiting_on: "client", contacts: [{ contact_id: CONTACT, role: "Buyer" }], ...over });
  const create = (user: string, key: string | null, f: Record<string, unknown> = fields(), outreach: string | null = null) =>
    call<Row>(user, `crm_create_enquiry(${j(f)}, ${key ? `'${key}'` : "null"}, ${outreach ? `'${outreach}'` : "null"})`);
  const count = async () => Number((await admin(`select count(*) n from crm_opportunities`))[0]!.n);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional UAE', 'AE', 'AED'), ('${CO.ksa}', 'Fictional KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.lead}', '${CO.uae}', '{assign_owner}'), ('${U.ksaOnly}', '${CO.ksa}', '{}');
    `);
    ORG = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Agency', 'agency') returning id`))[0]!.id;
    CONTACT = (await admin<{ id: string }>(`insert into crm_contacts (organisation_id, name, created_by) values ('${ORG}', 'Aisha Buyer', '${U.sara}') returning id`))[0]!.id;
  });
  afterAll(async () => db.teardown());

  it("the first save creates the enquiry exactly as the existing function does, field for field", async () => {
    const key = id();
    const r = await create(U.sara, key);
    expect(r).toMatchObject({ created: true, existing: null });
    const o = (await admin(`select * from crm_opportunities where id = '${r.id}'`))[0]!;
    expect(o).toMatchObject({ company_id: CO.uae, title: "Fictional gala dinner", source: "website", agency_org_id: ORG, client_org_id: null, owner_id: U.sara, created_by: U.sara, currency: "AED",
      budget_note: "Around 125k", brief: "LED wall and stage", location: "Dubai", scope: "Supply and install", waiting_on: "client", stage: "new" });
    expect(Number(o.value)).toBe(125000.5);
    expect(o.reference).toMatch(/^OPP-UAE-\d{4}-\d{4}$/);
    expect(o.technologies).toEqual([{ name: "LED wall", qty: 2 }]);
    expect((await admin(`select to_char(event_start, 'YYYY-MM-DD') a, to_char(event_end, 'YYYY-MM-DD') b, to_char(install_start, 'YYYY-MM-DD') c from crm_opportunities where id = '${r.id}'`))[0]).toEqual({ a: "2027-04-10", b: "2027-04-11", c: "2027-04-08" });
    expect(await admin(`select contact_id, role from crm_opportunity_contacts where opportunity_id = '${r.id}'`)).toEqual([{ contact_id: CONTACT, role: "Buyer" }]);
    const f = (await admin(`select title, kind, assigned_to, due_at from crm_follow_ups where opportunity_id = '${r.id}'`))[0]!;
    expect(f).toMatchObject({ title: "Call the client", kind: "call", assigned_to: U.sara });
    expect(new Date(f.due_at).toISOString()).toBe("2027-03-01T05:00:00.000Z");
    expect(await admin(`select created_by, opportunity_id from crm_enquiry_submissions where submission_key = '${key}'`)).toEqual([{ created_by: U.sara, opportunity_id: r.id }]);
  });

  it("a retry after a lost answer and a double click return the ORIGINAL enquiry: same id, nothing created, even with changed details", async () => {
    const key = id();
    const first = await create(U.sara, key);
    const before = await count();
    const retry = await create(U.sara, key);
    expect(retry).toEqual({ id: first.id, created: false, existing: "submission" });
    expect(await create(U.sara, key, fields({ title: "Edited after the answer was lost" }))).toEqual({ id: first.id, created: false, existing: "submission" });
    const burst = await Promise.all([create(U.sara, key), create(U.sara, key), create(U.sara, key)]);
    expect(new Set(burst.map((r) => r.id))).toEqual(new Set([first.id]));
    expect(burst.every((r) => r.created === false)).toBe(true);
    expect(await count()).toBe(before);
    expect((await admin(`select title from crm_opportunities where id = '${first.id}'`))[0]!.title).toBe("Fictional gala dinner");
    expect(await admin(`select 1 from crm_follow_ups where opportunity_id = '${first.id}'`)).toHaveLength(1);
  });

  it("two connections with the same identifier at the same moment create exactly one: the second waits for the first, then returns its enquiry", async () => {
    const key = id();
    const before = await count();
    let second: Promise<Row> | null = null;
    let settled = false;
    const first = await db.asUserCommit(U.sara, async (query) => {
      const r = (await query(`select crm_create_enquiry(${j(fields({ title: "Held open" }))}, '${key}', null) as v`)).rows[0].v as Row;
      // a second connection, same person, same identifier, while the first transaction has not committed
      second = create(U.sara, key, fields({ title: "Second connection" })).then((x) => { settled = true; return x; });
      await new Promise((res) => setTimeout(res, 500));
      expect(settled).toBe(false);
      return r;
    });
    expect(first.created).toBe(true);
    expect(await second!).toEqual({ id: first.id, created: false, existing: "submission" });
    expect(await count()).toBe(before + 1);
    // five at once, a fresh identifier
    const key2 = id();
    const five = await Promise.all(Array.from({ length: 5 }, () => create(U.sara, key2)));
    expect(five.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(five.map((r) => r.id)).size).toBe(1);
    expect(await count()).toBe(before + 2);
    // a first attempt that fails after it started leaves nothing behind: the retry with the same identifier creates the enquiry
    const key3 = id();
    await expect(db.asUserCommit(U.sara, async (query) => { await query(`select crm_create_enquiry(${j(fields())}, '${key3}', null)`); throw new Error("the connection dropped before the commit"); })).rejects.toThrow(/dropped/);
    expect(await admin(`select 1 from crm_enquiry_submissions where submission_key = '${key3}'`)).toEqual([]);
    expect((await create(U.sara, key3)).created).toBe(true);
    expect(await count()).toBe(before + 3);
  });

  it("two forms with identical details are two enquiries; no identifier is the old behaviour", async () => {
    const before = await count();
    const a = await create(U.sara, id());
    const b = await create(U.sara, id());
    expect(a.created && b.created).toBe(true);
    expect(a.id).not.toBe(b.id);
    const refs = await admin(`select reference from crm_opportunities where id in ('${a.id}', '${b.id}')`);
    expect(new Set(refs.map((r) => r.reference)).size).toBe(2);
    const c = await create(U.sara, null);
    const d = await create(U.sara, null);
    expect(c.id).not.toBe(d.id);
    expect(await count()).toBe(before + 4);
    expect(await admin(`select 1 from crm_enquiry_submissions where opportunity_id in ('${c.id}', '${d.id}')`)).toEqual([]);
  });

  it("the identifier is per person; nobody can read or write the table; the helper is not callable", async () => {
    const key = id();
    const mine = await create(U.sara, key);
    const theirs = await create(U.omar, key);                                                    // the same identifier, another person: their own enquiry
    expect(theirs.created).toBe(true);
    expect(theirs.id).not.toBe(mine.id);
    expect(await create(U.omar, key)).toEqual({ id: theirs.id, created: false, existing: "submission" });
    for (const who of [U.sara, U.omar, U.lead]) expect(await q(who, `select * from crm_enquiry_submissions`), who).toEqual([]);
    await expect(db.asUserCommit(U.sara, (query) => query(`insert into crm_enquiry_submissions (created_by, submission_key, opportunity_id) values ('${U.sara}', '${id()}', '${mine.id}')`))).rejects.toThrow();
    await expect(q(U.sara, `select crm_create_opportunity_json(${j(fields())})`)).rejects.toThrow(/permission denied/);
    await expect(q(null, `select crm_create_enquiry(${j(fields())}, '${id()}', null)`)).rejects.toThrow();
  });

  it("every rule of the existing function still applies, a refused save records nothing, and the same identifier then works", async () => {
    const before = await count();
    const key = id();
    await expect(create(U.ksaOnly, key)).rejects.toThrow(/Sales access for this company/);       // another company
    await expect(create(U.nogrant, key)).rejects.toThrow();
    await expect(create(U.sara, key, fields({ agency_org_id: null }))).rejects.toThrow(/agency or an end client/);
    await expect(create(U.sara, key, fields({ next_title: " " }))).rejects.toThrow(/next action/);
    await expect(create(U.sara, key, fields({ owner_id: U.omar }))).rejects.toThrow(/assign another owner/);
    await expect(create(U.sara, key, fields({ source: "made_up" }))).rejects.toThrow();
    await expect(create(U.sara, key, fields({ company_id: "" }))).rejects.toThrow();
    expect(await count()).toBe(before);
    expect(await admin(`select 1 from crm_enquiry_submissions where submission_key = '${key}'`)).toEqual([]);
    expect((await create(U.sara, key)).created).toBe(true);                                       // corrected and saved with the same form
    expect((await create(U.lead, id(), fields({ owner_id: U.omar }))).created).toBe(true);        // a lead may assign another owner, as before
    // the function the deployed app and JARVIS call: same 21 named arguments, untouched
    const old = await call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Old signature', p_source => 'website', p_next_title => 'Call', p_next_due => now() + interval '2 days',
      p_agency_org_id => '${ORG}', p_client_org_id => null, p_owner_id => null, p_currency => null, p_value => null, p_budget_note => null, p_brief => null, p_event_start => null, p_event_end => null,
      p_install_start => null, p_location => null, p_technologies => '[]'::jsonb, p_scope => null, p_waiting_on => null, p_contacts => '[]'::jsonb, p_next_kind => 'other')`);
    expect(old).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("with an outreach: one outreach and one identifier are one enquiry; a second form on the same outreach opens the first one's enquiry", async () => {
    await call(U.lead, `crm_assign_outreach('${CO.uae}', array['${ORG}'::uuid], '${U.sara}', '2027-02-01'::date, null)`);
    const outreach = (await admin<{ id: string }>(`select id from crm_outreach where organisation_id = '${ORG}' and status <> 'closed'`))[0]!.id;
    const before = await count();
    const key = id();
    const first = await create(U.sara, key, fields({ source: "outreach" }), outreach);
    expect(first).toMatchObject({ created: true, existing: null });
    expect(await create(U.sara, key, fields({ source: "outreach" }), outreach)).toEqual({ id: first.id, created: false, existing: "submission" });   // the retry
    expect(await create(U.sara, id(), fields({ source: "outreach" }), outreach)).toEqual({ id: first.id, created: false, existing: "outreach" });    // another tab, another form
    expect(await count()).toBe(before + 1);
    expect((await admin(`select opportunity_id, status from crm_outreach where id = '${outreach}'`))[0]).toEqual({ opportunity_id: first.id, status: "inquiry_raised" });
  });

  it("owner pack: verify says OK, the preflight lists look-alike pairs and changes nothing, the rollback runs twice and the old function still saves", async () => {
    const verify = await admin<{ item: string; result: string }>(pack("crm_enquiry_submission_key_20_verify_readonly.sql"));
    for (const r of verify) if (!/^information/.test(r.item)) expect(r.result, r.item).toBe("OK");
    const before = JSON.stringify(await admin(`select id, version, updated_at from crm_opportunities order by id`));
    const pre = await admin<{ item: string; result: string }>(pack("crm_enquiry_submission_key_00_preflight_readonly.sql"));
    expect(pre.find((r) => /not installed yet/.test(r.item))!.result).toBe("already installed");
    expect(Number(pre.find((r) => /look like an earlier double save/.test(r.item))!.result)).toBeGreaterThan(0);   // the identical enquiries made on purpose above
    expect(JSON.stringify(await admin(`select id, version, updated_at from crm_opportunities order by id`))).toBe(before);
    await db.seed(pack("crm_enquiry_submission_key_90_rollback.sql"));
    await db.seed(pack("crm_enquiry_submission_key_90_rollback.sql"));
    expect((await admin(`select to_regclass('public.crm_enquiry_submissions') t, to_regprocedure('public.crm_create_enquiry(jsonb, uuid, uuid)') f`))[0]).toEqual({ t: null, f: null });
    // the outreach conversion is still installed here, so the shared helper stays and conversion still works
    expect((await admin(`select to_regprocedure('public.crm_create_opportunity_json(jsonb)') f`))[0]!.f).not.toBeNull();
    expect(await call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'After rollback', p_source => 'website', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_agency_org_id => '${ORG}')`)).toMatch(/^[0-9a-f-]{36}$/);
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);
    expect((await create(U.sara, id())).created).toBe(true);
  });
});
