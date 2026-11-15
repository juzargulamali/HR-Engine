import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Outreach to enquiry (migration 20270112000300_crm_outreach_conversion.sql), against a real Postgres.
//   * the outreach's contact: one of the account's own contacts, set by the assignee or a Sales lead only, never on a closed outreach;
//   * the Outreach source is accepted, existing sources are untouched, anything else is still refused;
//   * conversion in one transaction: the enquiry is created and linked, or nothing is; a second attempt (again, a stale tab, two at the same moment) creates nothing
//     and returns the one enquiry; a different person without the right is refused; another company cannot touch it;
//   * the guard: an outreach's enquiry cannot be replaced, by the existing link function either;
//   * the functions the deployed app calls (crm_create_opportunity, crm_outreach_link_inquiry) still work with their old arguments;
//   * the owner pack: preflight, verify, rollback (stops while an Outreach enquiry exists; runs twice).

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), lead: id(), sara: id(), omar: id(), ksaOnly: id(), nogrant: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@conv-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const MIGRATION = "20270112000300_crm_outreach_conversion.sql";

describe("Outreach to enquiry: contact, source and one enquiry per outreach", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const fields = (org: string, over: Record<string, unknown> = {}) => ({ company_id: CO.uae, title: "Enquiry from outreach", source: "outreach", next_title: "Call back", next_due: "2027-03-01T09:00:00Z", agency_org_id: org, ...over });
  const convert = (user: string, outreach: string, f: Record<string, unknown>) => call<Row>(user, `crm_create_enquiry_from_outreach('${outreach}', ${j(f)})`);
  const outreach = async (org: string, to = U.sara) => {
    await call(U.lead, `crm_assign_outreach('${CO.uae}', array['${org}'::uuid], '${to}', '2027-02-01'::date, 'Spring programme')`);
    return (await admin<{ id: string }>(`select id from crm_outreach where organisation_id = '${org}' and company_id = '${CO.uae}' and status <> 'closed'`))[0]!.id;
  };
  const enquiries = async (org: string) => Number((await admin(`select count(*) n from crm_opportunities where agency_org_id = '${org}' or client_org_id = '${org}'`))[0]!.n);
  let A = "", B = "", C = "", D = "", E = "", CA1 = "", CA2 = "", CB1 = "", OA = "", OB = "", OC = "", OD = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional UAE', 'AE', 'AED'), ('${CO.ksa}', 'Fictional KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR') on conflict do nothing;
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.ksa}', '{founder}'),
        ('${U.lead}', '${CO.uae}', '{assign_owner}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaOnly}', '${CO.ksa}', '{}');
    `);
    const org = async (name: string) => (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('${name}', 'agency') returning id`))[0]!.id;
    [A, B, C, D, E] = [await org("Fictional Agency A"), await org("Fictional Agency B"), await org("Fictional Agency C"), await org("Fictional Agency D"), await org("Fictional Agency E")];
    const contact = async (name: string, o: string) => (await admin<{ id: string }>(`insert into crm_contacts (organisation_id, name, created_by) values ('${o}', '${name}', '${U.sara}') returning id`))[0]!.id;
    CA1 = await contact("Aisha A", A); CA2 = await contact("Bilal A", A); CB1 = await contact("Chen B", B);
    OA = await outreach(A); OB = await outreach(B); OC = await outreach(C); OD = await outreach(D);
  });
  afterAll(async () => db.teardown());

  it("the contact of an outreach: the account's own contact, the assignee or a lead only, cleared with null", async () => {
    await expect(call(U.sara, `crm_outreach_set_contact('${OA}', '${CB1}')`)).rejects.toThrow(/account's own contacts/);
    await expect(call(U.sara, `crm_outreach_set_contact('${OA}', '${id()}')`)).rejects.toThrow(/account's own contacts/);
    await expect(call(U.omar, `crm_outreach_set_contact('${OA}', '${CA1}')`)).rejects.toThrow(/assigned to/);
    await expect(call(U.ksaOnly, `crm_outreach_set_contact('${OA}', '${CA1}')`)).rejects.toThrow(/not found/i);
    await expect(call(U.nogrant, `crm_outreach_set_contact('${OA}', '${CA1}')`)).rejects.toThrow();
    await expect(q(null, `select crm_outreach_set_contact('${OA}', '${CA1}')`)).rejects.toThrow();
    await call(U.sara, `crm_outreach_set_contact('${OA}', '${CA1}')`);
    await call(U.sara, `crm_outreach_set_contact('${OA}', '${CA1}')`);                           // again: nothing
    await call(U.lead, `crm_outreach_set_contact('${OA}', '${CA2}')`);
    expect((await admin(`select contact_id from crm_outreach where id = '${OA}'`))[0]!.contact_id).toBe(CA2);
    // an archived contact is not offered
    await admin(`update crm_contacts set archived_at = now() where id = '${CA1}'`);
    await expect(call(U.sara, `crm_outreach_set_contact('${OA}', '${CA1}')`)).rejects.toThrow(/account's own contacts/);
    await admin(`update crm_contacts set archived_at = null where id = '${CA1}'`);
    await call(U.sara, `crm_outreach_set_contact('${OB}', '${CB1}')`);
    await call(U.sara, `crm_outreach_set_contact('${OB}', null)`);
    expect((await admin(`select contact_id from crm_outreach where id = '${OB}'`))[0]!.contact_id).toBeNull();
    // the assignee reads it on their own outreach; a colleague who is not assigned reads no outreach at all (unchanged policy)
    expect((await q(U.sara, `select contact_id from crm_outreach where id = '${OA}'`))[0]!.contact_id).toBe(CA2);
    expect(await q(U.omar, `select contact_id from crm_outreach where id = '${OA}'`)).toEqual([]);
  });

  it("the Outreach source is accepted by the existing create function; old sources still are; anything else is still refused", async () => {
    const mk = (source: string) => call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Source ${source}', p_source => '${source}', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_agency_org_id => '${E}')`);
    for (const s of ["outreach", "agency_call", "linkedin", "direct_client", "whatsapp", "instagram", "website", "referral", "other"]) expect(await mk(s), s).toMatch(/^[0-9a-f-]{36}$/);
    await expect(mk("exhibition")).rejects.toThrow();
    await expect(mk("made_up")).rejects.toThrow();
    // an existing enquiry's source can be corrected to and from Outreach through the existing edit function
    const one = (await admin<{ id: string; version: number }>(`select id, version from crm_opportunities where title = 'Source referral'`))[0]!;
    await call(U.sara, `crm_update_opportunity('${one.id}', ${one.version}, ${j({ source: "outreach" })})`);
    expect((await admin(`select source from crm_opportunities where id = '${one.id}'`))[0]!.source).toBe("outreach");
  });

  it("conversion creates the enquiry and links it in one step, with the chosen contact and the Outreach source; the outreach becomes Enquiry raised", async () => {
    const r = await convert(U.sara, OA, fields(A, { contacts: [{ contact_id: CA2 }], brief: "From the outreach" }));
    expect(r).toMatchObject({ created: true, existing: null });
    const opp = (await admin(`select source, agency_org_id, company_id, owner_id, created_by, brief from crm_opportunities where id = '${r.id}'`))[0]!;
    expect(opp).toMatchObject({ source: "outreach", agency_org_id: A, company_id: CO.uae, owner_id: U.sara, created_by: U.sara, brief: "From the outreach" });
    expect((await admin(`select contact_id from crm_opportunity_contacts where opportunity_id = '${r.id}'`)).map((x) => x.contact_id)).toEqual([CA2]);
    expect((await admin(`select status, opportunity_id from crm_outreach where id = '${OA}'`))[0]).toEqual({ status: "inquiry_raised", opportunity_id: r.id });
    expect((await admin(`select kind from crm_outreach_events where outreach_id = '${OA}' and kind = 'inquiry_linked'`))).toHaveLength(1);
    expect(await admin(`select 1 from crm_follow_ups where opportunity_id = '${r.id}'`)).toHaveLength(1);
  });

  it("a second attempt creates nothing and returns the one enquiry: the same person again, a lead on a stale tab, different details", async () => {
    const first = (await admin(`select opportunity_id from crm_outreach where id = '${OA}'`))[0]!.opportunity_id as string;
    const before = await enquiries(A);
    expect(await convert(U.sara, OA, fields(A))).toEqual({ id: first, created: false, existing: "outreach" });
    expect(await convert(U.lead, OA, fields(A, { title: "A different title typed in a stale tab" }))).toEqual({ id: first, created: false, existing: "outreach" });
    expect(await enquiries(A)).toBe(before);
    expect(await admin(`select 1 from crm_outreach_events where outreach_id = '${OA}' and kind = 'inquiry_linked'`)).toHaveLength(1);
  });

  it("two tabs at the same moment, and a double submit, create exactly one enquiry", async () => {
    const before = await enquiries(B);
    const results = await Promise.all([convert(U.sara, OB, fields(B, { title: "Tab one" })), convert(U.sara, OB, fields(B, { title: "Tab two" })), convert(U.lead, OB, fields(B, { title: "The lead, too" }))]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await enquiries(B)).toBe(before + 1);
    // held open: the second waits for the first to finish, then returns the first one's enquiry
    let second: Promise<Row> | null = null;
    let settled = false;
    const first = await db.asUserCommit(U.sara, async (query) => {
      const r = (await query(`select crm_create_enquiry_from_outreach('${OC}', ${j(fields(C, { title: "Held open" }))}) as v`)).rows[0].v as Row;
      second = convert(U.sara, OC, fields(C, { title: "Waiting" })).then((x) => { settled = true; return x; });
      await new Promise((res) => setTimeout(res, 400));
      expect(settled).toBe(false);                                                            // still waiting on the first transaction
      return r;
    });
    expect(first.created).toBe(true);
    expect(await second!).toEqual({ id: first.id, created: false, existing: "outreach" });
    expect(await enquiries(C)).toBe(1);
  });

  it("who may convert, and what is refused with nothing created", async () => {
    const before = await enquiries(D);
    await expect(convert(U.omar, OD, fields(D))).rejects.toThrow(/not found/i);                 // a colleague who is not the assignee and holds no assign right
    await expect(convert(U.ksaOnly, OD, fields(D))).rejects.toThrow(/not found/i);              // another company
    await expect(convert(U.nogrant, OD, fields(D))).rejects.toThrow();
    await expect(q(null, `select crm_create_enquiry_from_outreach('${OD}', ${j(fields(D))})`)).rejects.toThrow();
    await expect(convert(U.sara, OD, fields(E))).rejects.toThrow(/account and the company of the outreach/);                       // another account
    await expect(convert(U.founder, OD, fields(D, { company_id: CO.ksa }))).rejects.toThrow(/account and the company of the outreach/);   // another company's enquiry
    await expect(convert(U.sara, OD, fields(D, { source: "made_up" }))).rejects.toThrow();     // the enquiry's own rules still apply
    await expect(convert(U.sara, OD, fields(D, { next_title: "" }))).rejects.toThrow(/next action/);
    await expect(convert(U.sara, id(), fields(D))).rejects.toThrow(/not found/i);
    expect(await enquiries(D)).toBe(before);
    expect((await admin(`select status, opportunity_id from crm_outreach where id = '${OD}'`))[0]).toMatchObject({ opportunity_id: null });
    // a closed outreach raises nothing
    await call(U.sara, `crm_outreach_set_status('${OD}', 'closed', 'Not interested')`);
    await expect(convert(U.sara, OD, fields(D))).rejects.toThrow(/closed/);
    expect(await enquiries(D)).toBe(before);
    // the account's end client side counts as the account too
    const again = await outreach(D);
    await expect(convert(U.sara, again, fields(D, { agency_org_id: null, client_org_id: D }))).rejects.toThrow(/not recorded as an end client/);   // the existing party-role rule still applies
    await admin(`update crm_organisations set roles = array['agency', 'client'] where id = '${D}'`);
    const r = await convert(U.sara, again, fields(D, { agency_org_id: null, client_org_id: D }));
    expect(r.created).toBe(true);
  });

  it("the guard: the enquiry of an outreach cannot be replaced, through the existing link function or directly; the old two-step path still works for a fresh outreach", async () => {
    const linked = (await admin(`select opportunity_id from crm_outreach where id = '${OA}'`))[0]!.opportunity_id as string;
    const other = await call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'A second one', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_agency_org_id => '${A}')`);
    await expect(call(U.sara, `crm_outreach_link_inquiry('${OA}', '${other}')`)).rejects.toThrow(/already has an enquiry/);
    await expect(admin(`update crm_outreach set opportunity_id = '${other}' where id = '${OA}'`)).rejects.toThrow(/already has an enquiry/);
    await expect(admin(`update crm_outreach set opportunity_id = null where id = '${OA}'`)).rejects.toThrow(/already has an enquiry/);
    expect((await admin(`select opportunity_id from crm_outreach where id = '${OA}'`))[0]!.opportunity_id).toBe(linked);
    // the deployed app's path: create with the old function, then link, on an outreach that has none
    const fresh = await outreach(E);
    const made = await call<string>(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Old path', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_agency_org_id => '${E}')`);
    await call(U.sara, `crm_outreach_link_inquiry('${fresh}', '${made}')`);
    expect((await admin(`select status, opportunity_id from crm_outreach where id = '${fresh}'`))[0]).toEqual({ status: "inquiry_raised", opportunity_id: made });
  });

  it("the helper is not callable by signed-in people", async () => {
    await expect(q(U.sara, `select crm_create_opportunity_json(${j(fields(E))})`)).rejects.toThrow(/permission denied/);
    await expect(q(U.sara, `select crm_outreach_one_enquiry()`)).rejects.toThrow();
  });

  it("owner pack: verify says OK; the rollback stops while an Outreach enquiry exists, then runs twice; the migration applies again", async () => {
    const verify = await admin<{ item: string; result: string }>(pack("crm_outreach_conversion_20_verify_readonly.sql"));
    for (const r of verify) if (!/^information/.test(r.item)) expect(r.result, r.item).toBe("OK");
    const pre = await admin<{ item: string; result: string }>(pack("crm_outreach_conversion_00_preflight_readonly.sql"));
    expect(pre.find((r) => /not installed yet/.test(r.item))!.result).toBe("already installed");
    expect(pre.find((r) => /eight existing sources/.test(r.item))!.result).toBe("OK");
    expect(pre.find((r) => /more than one outreach/.test(r.item))!.result).toBe("0 / 0");
    await expect(db.seed(pack("crm_outreach_conversion_90_rollback.sql"))).rejects.toThrow(/STOP: \d+ enquiry/);
    expect((await admin(`select to_regprocedure('public.crm_create_enquiry_from_outreach(uuid, jsonb)') f`))[0]!.f).not.toBeNull();
    await admin(`update crm_opportunities set source = 'other' where source = 'outreach'`);
    await db.seed(pack("crm_outreach_conversion_90_rollback.sql"));
    await db.seed(pack("crm_outreach_conversion_90_rollback.sql"));
    expect((await admin(`select to_regprocedure('public.crm_create_enquiry_from_outreach(uuid, jsonb)') f, to_regprocedure('public.crm_outreach_set_contact(uuid, uuid)') g`))[0]).toEqual({ f: null, g: null });
    expect(await admin(`select 1 from information_schema.columns where table_name = 'crm_outreach' and column_name = 'contact_id'`)).toEqual([]);
    await expect(call(U.sara, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'x', p_source => 'outreach', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_agency_org_id => '${E}')`)).rejects.toThrow();
    // the submission-identifier migration is still installed here, so its shared helper stays
    expect((await admin(`select to_regprocedure('public.crm_create_opportunity_json(jsonb)') f`))[0]!.f).not.toBeNull();
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);
    const again = await admin<{ item: string; result: string }>(pack("crm_outreach_conversion_20_verify_readonly.sql"));
    for (const r of again) if (!/^information/.test(r.item)) expect(r.result, r.item).toBe("OK");
  });
});
