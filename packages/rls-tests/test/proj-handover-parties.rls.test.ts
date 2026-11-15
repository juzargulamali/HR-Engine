import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales to Projects handover: agency, site contact and notes (migration 20270112000100_proj_handover_parties.sql), against a real Postgres.
//   * an agency-led job and a direct job are told apart, and the agency is the enquiry's own;
//   * Sales chooses the site contact only from the contacts linked to the enquiry; only the owner or a Sales founder; never once the Project Manager has the brief;
//   * the copy is taken again at submission; a contact removed from the enquiry stops the submission in words; a contact edited AFTER acceptance does not reach the project;
//   * who reads what on the project: managers and Operations get the contact, members get the agency and the notes, summary-only people, another company and a Sales
//     person without a place on the project get "not found";
//   * a repeated acceptance returns the same project; the accepted copy cannot be changed, by anyone;
//   * a project accepted BEFORE the migration opens and says "not recorded" (recorded = false), never a guessed "direct";
//   * the owner pack: preflight, verify, rollback (twice).

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { sales: id(), salesOther: id(), salesFounder: id(), ops: id(), pm: id(), acting: id(), member: id(), summary: id(), founder: id(), pmB: id(), nobody: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@handover-test.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const ROOT = path.join(__dirname, "../../..");
const pack = (f: string) => readFileSync(path.join(ROOT, "supabase/manual-sql", f), "utf8");
const MIGRATION = "20270112000100_proj_handover_parties.sql";

const SEED = `
  insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
  insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional KSA', 'SA', 'SAR');
  insert into auth.users (id, email) values ${SQL_USERS};
  insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.a}', '{}'), ('${U.salesOther}', '${CO.a}', '{}'), ('${U.salesFounder}', '${CO.a}', '{founder}');
  insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'KSA');
  insert into proj_company_grants (user_id, company_id, capabilities) values
    ('${U.ops}', '${CO.a}', '{operations}'), ('${U.pm}', '${CO.a}', '{}'), ('${U.acting}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'), ('${U.summary}', '${CO.a}', '{}'),
    ('${U.founder}', '${CO.a}', '{founder}'), ('${U.pmB}', '${CO.b}', '{founder}');
`;

describe("Handover: agency, site contact and notes reach the project", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  let CLIENT = "", AGENCY = "", C_SITE = "", C_OTHER = "", C_UNLINKED = "", OPP_AGENCY = "", OPP_DIRECT = "", H_AGENCY = "", H_DIRECT = "", P_AGENCY = "", P_DIRECT = "";

  const opp = (ref: string, title: string, agency: string | null) => admin<{ id: string }>(`insert into crm_opportunities (company_id, reference, title, client_org_id, agency_org_id, source, owner_id, created_by, stage, currency, value, scope, location, install_start, event_start, event_end, evidence_type, evidence_reference, evidence_date, closed_at, closed_by)
    values ('${CO.a}', '${ref}', '${title}', '${CLIENT}', ${agency ? `'${agency}'` : "null"}, 'direct_client', '${U.sales}', '${U.sales}', 'won', 'AED', 100000, 'LED wall 6 x 4 m', 'Dubai', '2027-02-26', '2027-03-01', '2027-03-05', 'purchase_order', 'PO-1', current_date, now(), '${U.sales}') returning id`).then((r) => r[0]!.id);
  const projectHandover = (user: string, project: string) => call<Row>(user, `proj_project_handover('${project}')`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(SEED);
    CLIENT = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Motors', 'client') returning id`))[0]!.id;
    AGENCY = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Agency', 'agency') returning id`))[0]!.id;
    const contact = (name: string, org: string, phone: string) => admin<{ id: string }>(`insert into crm_contacts (organisation_id, name, role_title, email, phone, created_by) values ('${org}', '${name}', 'Site lead', '${name.toLowerCase().replace(/ /g, ".")}@example.test', '${phone}', '${U.sales}') returning id`).then((r) => r[0]!.id);
    C_SITE = await contact("Sara Site", AGENCY, "+971 50 000 0001");
    C_OTHER = await contact("Omar Other", CLIENT, "+971 50 000 0002");
    C_UNLINKED = await contact("Una Unlinked", CLIENT, "+971 50 000 0003");
    OPP_AGENCY = await opp("UAE-O-2027-0101", "Agency-led stand", AGENCY);
    OPP_DIRECT = await opp("UAE-O-2027-0102", "Direct stand", null);
    await admin(`insert into crm_opportunity_contacts (opportunity_id, contact_id, company_id, role) values ('${OPP_AGENCY}', '${C_SITE}', '${CO.a}', 'Site'), ('${OPP_AGENCY}', '${C_OTHER}', '${CO.a}', 'Client'), ('${OPP_DIRECT}', '${C_OTHER}', '${CO.a}', 'Client')`);
  });
  afterAll(async () => db.teardown());

  it("the brief records whether the job is direct or agency-led, from the enquiry, as soon as it is saved", async () => {
    H_AGENCY = await call<string>(U.sales, `proj_save_handover('${OPP_AGENCY}', ${j({ notes: "Loading bay B, call the site lead first" })}, null)`);
    H_DIRECT = await call<string>(U.sales, `proj_save_handover('${OPP_DIRECT}', '{}'::jsonb, null)`);
    const rows = await admin(`select id, job_type, agency_name, agency_org_id, parties_recorded_at is not null as recorded, client_name from proj_handovers where id in ('${H_AGENCY}', '${H_DIRECT}')`);
    expect(rows.find((r) => r.id === H_AGENCY)).toMatchObject({ job_type: "agency", agency_name: "Fictional Agency", agency_org_id: AGENCY, recorded: true, client_name: "Fictional Motors" });
    expect(rows.find((r) => r.id === H_DIRECT)).toMatchObject({ job_type: "direct", agency_name: null, agency_org_id: null, recorded: true });
    // Sales reads it back; so does a Sales founder through the status read's sibling; a Sales colleague who neither owns nor prepared it does not
    expect(await call<Row>(U.sales, `proj_handover_parties('${H_AGENCY}')`)).toMatchObject({ recorded: true, job_type: "agency", agency_name: "Fictional Agency", site_contact: null });
    await expect(call(U.salesOther, `proj_handover_parties('${H_AGENCY}')`)).rejects.toThrow(/not found/i);
    await expect(call(U.pm, `proj_handover_parties('${H_AGENCY}')`)).rejects.toThrow(/not found/i);          // not named yet
    await expect(call(U.pmB, `proj_handover_parties('${H_AGENCY}')`)).rejects.toThrow(/not found/i);         // another company
    await expect(q(null, `select proj_handover_parties('${H_AGENCY}')`)).rejects.toThrow();
  });

  it("Sales chooses the site contact from the enquiry's contacts only; owner or Sales founder only; a repeat changes nothing", async () => {
    await expect(call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_UNLINKED}')`)).rejects.toThrow(/contacts linked to this enquiry/);
    await expect(call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${id()}')`)).rejects.toThrow(/contacts linked to this enquiry/);
    await expect(call(U.salesOther, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`)).rejects.toThrow(/owner or a Sales founder/);
    await expect(call(U.pm, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`)).rejects.toThrow(/not found/i);
    await expect(call(U.ops, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`)).rejects.toThrow(/not found/i);
    await expect(call(U.pmB, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`)).rejects.toThrow(/not found/i);
    const v0 = Number((await admin(`select version from proj_handovers where id = '${H_AGENCY}'`))[0]!.version);
    await call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_OTHER}')`);
    await call(U.salesFounder, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`);
    await call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`);                       // the same contact again
    expect(Number((await admin(`select version from proj_handovers where id = '${H_AGENCY}'`))[0]!.version)).toBe(v0 + 2);
    expect(await admin(`select name, role_title, phone, email, contact_id from proj_handover_site_contacts where handover_id = '${H_AGENCY}'`)).toEqual([
      { name: "Sara Site", role_title: "Site lead", phone: "+971 50 000 0001", email: "sara.site@example.test", contact_id: C_SITE }]);
    expect((await call<Row>(U.sales, `proj_handover_parties('${H_AGENCY}')`)).site_contact).toMatchObject({ name: "Sara Site", phone: "+971 50 000 0001" });
    // clearing, then clearing again
    await call(U.sales, `proj_set_handover_site_contact('${H_DIRECT}', '${C_OTHER}')`);
    await call(U.sales, `proj_set_handover_site_contact('${H_DIRECT}', null)`);
    await call(U.sales, `proj_set_handover_site_contact('${H_DIRECT}', null)`);
    expect(await admin(`select 1 from proj_handover_site_contacts where handover_id = '${H_DIRECT}'`)).toEqual([]);
    // the copy table itself is closed to signed-in people, whoever they are
    for (const who of [U.sales, U.pm, U.founder, U.ops]) expect(await q(who, `select * from proj_handover_site_contacts`), who).toEqual([]);
  });

  it("the copy is taken again at submission; a contact that left the enquiry stops the submission in words and keeps the draft", async () => {
    // edited in Sales before submission: the submission carries the new phone
    await admin(`update crm_contacts set phone = '+971 50 111 1111' where id = '${C_SITE}'`);
    // the agency renamed in Sales before submission: the submission carries the new name
    await admin(`update crm_organisations set name = 'Fictional Agency FZ' where id = '${AGENCY}'`);
    // unlinked from the enquiry: refused, nothing submitted
    await admin(`delete from crm_opportunity_contacts where opportunity_id = '${OPP_AGENCY}' and contact_id = '${C_SITE}'`);
    await expect(call(U.sales, `proj_submit_handover('${H_AGENCY}')`)).rejects.toThrow(/no longer on the enquiry/);
    expect((await admin(`select status from proj_handovers where id = '${H_AGENCY}'`))[0]!.status).toBe("draft");
    await admin(`insert into crm_opportunity_contacts (opportunity_id, contact_id, company_id, role) values ('${OPP_AGENCY}', '${C_SITE}', '${CO.a}', 'Site')`);
    await call(U.sales, `proj_submit_handover('${H_AGENCY}')`);
    await call(U.sales, `proj_submit_handover('${H_AGENCY}')`);                                              // double click
    expect((await admin(`select status, agency_name from proj_handovers where id = '${H_AGENCY}'`))[0]).toEqual({ status: "submitted", agency_name: "Fictional Agency FZ" });
    expect((await admin(`select phone from proj_handover_site_contacts where handover_id = '${H_AGENCY}'`))[0]!.phone).toBe("+971 50 111 1111");
    // still editable while nobody is named: Sales may change the contact
    await call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_OTHER}')`);
    await call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_SITE}')`);
    // Operations (assigns the Project Manager) and a Projects founder read the brief's people; the named Project Manager does once named
    expect((await call<Row>(U.ops, `proj_handover_parties('${H_AGENCY}')`)).site_contact).toMatchObject({ name: "Sara Site" });
    expect((await call<Row>(U.founder, `proj_handover_parties('${H_AGENCY}')`)).agency_name).toBe("Fictional Agency FZ");
    await call(U.ops, `proj_assign_handover_pm('${H_AGENCY}', '${U.pm}')`);
    expect(await call<Row>(U.pm, `proj_handover_parties('${H_AGENCY}')`)).toMatchObject({ job_type: "agency", agency_name: "Fictional Agency FZ", site_contact: { name: "Sara Site", email: "sara.site@example.test" } });
    await expect(call(U.member, `proj_handover_parties('${H_AGENCY}')`)).rejects.toThrow(/not found/i);
    // once the Project Manager has it, Sales can no longer change the contact
    await expect(call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_OTHER}')`)).rejects.toThrow(/can no longer be edited/);
    // a change in Sales between submission and acceptance does not reach the brief
    await admin(`update crm_contacts set phone = 'CHANGED-AFTER-SUBMIT' where id = '${C_SITE}'`);
    await admin(`update crm_organisations set name = 'Renamed After Submit' where id = '${AGENCY}'`);
    // the direct job: no contact chosen
    await call(U.sales, `proj_submit_handover('${H_DIRECT}')`);
    await call(U.ops, `proj_assign_handover_pm('${H_DIRECT}', '${U.pm}')`);
  });

  it("acceptance creates exactly one project, twice asked and asked at once; the project shows the accepted values", async () => {
    const [a, b] = await Promise.all([call<string>(U.pm, `proj_accept_handover('${H_AGENCY}')`), call<string>(U.pm, `proj_accept_handover('${H_AGENCY}')`)]);
    P_AGENCY = a;
    expect(b).toBe(a);
    expect(await call<string>(U.pm, `proj_accept_handover('${H_AGENCY}')`)).toBe(a);
    expect(Number((await admin(`select count(*) n from proj_projects where crm_opportunity_id = '${OPP_AGENCY}'`))[0]!.n)).toBe(1);
    P_DIRECT = await call<string>(U.pm, `proj_accept_handover('${H_DIRECT}')`);
    const agency = await projectHandover(U.pm, P_AGENCY);
    expect(agency).toMatchObject({ has_handover: true, recorded: true, job_type: "agency", agency_name: "Fictional Agency FZ", notes: "Loading bay B, call the site lead first", contact_restricted: false,
      site_contact: { name: "Sara Site", role_title: "Site lead", phone: "+971 50 111 1111", email: "sara.site@example.test" } });
    expect(await projectHandover(U.pm, P_DIRECT)).toMatchObject({ has_handover: true, recorded: true, job_type: "direct", agency_name: null, site_contact: null, contact_restricted: false, notes: null });
  });

  it("a contact edited, unlinked or archived in Sales after acceptance does not change the project; the accepted copy cannot be changed", async () => {
    await admin(`update crm_contacts set name = 'Sara Renamed', phone = 'NEW-PHONE', archived_at = now() where id = '${C_SITE}'`);
    await admin(`delete from crm_opportunity_contacts where opportunity_id = '${OPP_AGENCY}' and contact_id = '${C_SITE}'`);
    await admin(`update crm_opportunities set agency_org_id = null where id = '${OPP_AGENCY}'`);
    expect((await projectHandover(U.pm, P_AGENCY))).toMatchObject({ job_type: "agency", agency_name: "Fictional Agency FZ", site_contact: { name: "Sara Site", phone: "+971 50 111 1111" } });
    await expect(admin(`update proj_handover_site_contacts set phone = 'x' where handover_id = '${H_AGENCY}'`)).rejects.toThrow(/historical record/);
    await expect(admin(`delete from proj_handover_site_contacts where handover_id = '${H_AGENCY}'`)).rejects.toThrow(/historical record/);
    await expect(admin(`insert into proj_handover_site_contacts (handover_id, contact_id, name) values ('${H_DIRECT}', '${C_OTHER}', 'Late')`)).rejects.toThrow(/historical record/);
    await expect(admin(`update proj_handovers set agency_name = 'x' where id = '${H_AGENCY}'`)).rejects.toThrow(/historical record/);
    await expect(call(U.sales, `proj_set_handover_site_contact('${H_AGENCY}', '${C_OTHER}')`)).rejects.toThrow(/can no longer be edited/);
    await expect(call(U.salesFounder, `proj_set_handover_site_contact('${H_AGENCY}', null)`)).rejects.toThrow(/can no longer be edited/);
  });

  it("who reads what on the project: managers and Operations get the contact, members do not, everyone else gets nothing", async () => {
    await call(U.pm, `proj_add_member('${P_AGENCY}', '${U.member}', null)`);
    await call(U.pm, `proj_add_member('${P_AGENCY}', '${U.acting}', null)`);
    await call(U.pm, `proj_set_acting_pm('${P_AGENCY}', '${U.acting}', (current_date + 7))`);
    for (const who of [U.pm, U.acting, U.founder, U.ops]) {
      expect(await projectHandover(who, P_AGENCY), who).toMatchObject({ contact_restricted: false, site_contact: { name: "Sara Site", phone: "+971 50 111 1111", email: "sara.site@example.test" }, agency_name: "Fictional Agency FZ" });
    }
    const member = await projectHandover(U.member, P_AGENCY);
    expect(member).toMatchObject({ has_handover: true, job_type: "agency", agency_name: "Fictional Agency FZ", notes: "Loading bay B, call the site lead first", contact_restricted: true, site_contact: null });
    expect(JSON.stringify(member)).not.toMatch(/Sara|971|example\.test/);
    // summary only (Projects access in the company, not on the project), the Sales owner (linked to the project as its Sales contact: summary only), a Sales colleague,
    // another company's founder, somebody with nothing, and nobody signed in
    for (const who of [U.summary, U.sales, U.salesOther, U.salesFounder, U.pmB, U.nobody]) await expect(projectHandover(who, P_AGENCY), who).rejects.toThrow(/not found/i);
    await expect(q(null, `select proj_project_handover('${P_AGENCY}')`)).rejects.toThrow();
    expect((await q<{ n: string }>(U.summary, `select count(*) n from proj_projects where id = '${P_AGENCY}'`))[0]!.n).toBe("1");   // the summary row itself is still theirs
    // the accepted handover: the acting Project Manager reads its people through the project; a member does not
    expect((await call<Row>(U.acting, `proj_handover_parties('${H_AGENCY}')`)).site_contact).toMatchObject({ name: "Sara Site" });
    await expect(call(U.member, `proj_handover_parties('${H_AGENCY}')`)).rejects.toThrow(/not found/i);
    // an internal project has no handover
    const internal = await call<string>(U.founder, `proj_create_internal_project('${CO.a}', 'Internal tidy-up', '${U.pm}', null, null, false, null)`).catch(() => null);
    if (internal) expect(await projectHandover(U.pm, internal)).toEqual({ has_handover: false });
    // revoking Projects access closes it on the next read
    await admin(`update proj_company_grants set revoked_at = now(), revoked_by = '${U.founder}' where user_id = '${U.ops}' and company_id = '${CO.a}'`);
    await expect(projectHandover(U.ops, P_AGENCY)).rejects.toThrow(/not found/i);
    await admin(`update proj_company_grants set revoked_at = null, revoked_by = null where user_id = '${U.ops}' and company_id = '${CO.a}'`);
  });

  it("a withdrawn brief and a clarification round: the copy follows the brief while Sales still holds it", async () => {
    const o = await opp("UAE-O-2027-0103", "Round trip", AGENCY);
    await admin(`insert into crm_opportunity_contacts (opportunity_id, contact_id, company_id) values ('${o}', '${C_OTHER}', '${CO.a}')`);
    const h = await call<string>(U.sales, `proj_save_handover('${o}', '{}'::jsonb, null)`);
    await call(U.sales, `proj_set_handover_site_contact('${h}', '${C_OTHER}')`);
    await call(U.sales, `proj_submit_handover('${h}')`);
    await call(U.ops, `proj_assign_handover_pm('${h}', '${U.pm}')`);
    await call(U.pm, `proj_request_handover_clarification('${h}', 'Who do I call on site?')`);
    await admin(`update crm_contacts set phone = 'AFTER-QUESTION' where id = '${C_OTHER}'`);
    await call(U.sales, `proj_submit_handover('${h}')`);                                                     // resubmission takes the copy again
    expect((await call<Row>(U.pm, `proj_handover_parties('${h}')`)).site_contact).toMatchObject({ phone: "AFTER-QUESTION" });
    // a contact that has left the enquiry does not stop a withdrawal
    await call(U.pm, `proj_request_handover_clarification('${h}', 'Again')`);
    await admin(`delete from crm_opportunity_contacts where opportunity_id = '${o}' and contact_id = '${C_OTHER}'`);
    await call(U.sales, `proj_withdraw_handover('${h}', 'Client postponed')`);
    expect((await admin(`select status from proj_handovers where id = '${h}'`))[0]!.status).toBe("withdrawn");
  });

  it("owner pack: verify says OK, the rollback runs twice and leaves the handover functions working", async () => {
    const verify = await admin<{ item: string; result: string }>(pack("proj_handover_parties_20_verify_readonly.sql"));
    for (const r of verify) if (!/^information/.test(r.item)) expect(r.result, r.item).toBe("OK");
    const pre = await admin<{ item: string; result: string }>(pack("proj_handover_parties_00_preflight_readonly.sql"));
    expect(pre.find((r) => /not installed yet/.test(r.item))!.result).toBe("already installed");
    await db.seed(pack("proj_handover_parties_90_rollback.sql"));
    await db.seed(pack("proj_handover_parties_90_rollback.sql"));
    expect((await admin(`select to_regclass('public.proj_handover_site_contacts') t, to_regprocedure('public.proj_project_handover(uuid)') f`))[0]).toEqual({ t: null, f: null });
    expect(await admin(`select 1 from information_schema.columns where table_name = 'proj_handovers' and column_name in ('job_type', 'agency_name', 'agency_org_id', 'parties_recorded_at')`)).toEqual([]);
    // the handover still works as it did before
    const o = await opp("UAE-O-2027-0104", "After rollback", null);
    const h = await call<string>(U.sales, `proj_save_handover('${o}', '{}'::jsonb, null)`);
    await call(U.sales, `proj_submit_handover('${h}')`);
    await call(U.ops, `proj_assign_handover_pm('${h}', '${U.pm}')`);
    expect(await call<string>(U.pm, `proj_accept_handover('${h}')`)).toMatch(/^[0-9a-f-]{36}$/);
    // and the migration applies again on top (safe to run twice)
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);
    expect((await call<Row>(U.pm, `proj_project_handover('${P_AGENCY}')`))).toMatchObject({ has_handover: true, recorded: false, job_type: null, site_contact: null });
  });
});

describe("Handover parties: a project accepted BEFORE the migration", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  let PROJECT = "", OPEN = "", OPP_OPEN = "";

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(readFileSync(path.join(ROOT, "supabase/tests/grant-authenticated-access.sql"), "utf8"));
    await db.seed(SEED);
    const client = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Motors', 'client') returning id`))[0]!.id;
    const agency = (await admin<{ id: string }>(`insert into crm_organisations (name, kind) values ('Fictional Agency', 'agency') returning id`))[0]!.id;
    const opp = (ref: string) => admin<{ id: string }>(`insert into crm_opportunities (company_id, reference, title, client_org_id, agency_org_id, source, owner_id, created_by, stage, currency, scope, evidence_type, evidence_reference, evidence_date, closed_at, closed_by)
      values ('${CO.a}', '${ref}', 'Old job ${ref}', '${client}', '${agency}', 'direct_client', '${U.sales}', '${U.sales}', 'won', 'AED', 'LED wall', 'purchase_order', 'PO-1', current_date, now(), '${U.sales}') returning id`).then((r) => r[0]!.id);
    const old = await opp("UAE-O-2026-0001");
    const h = await call<string>(U.sales, `proj_save_handover('${old}', ${j({ notes: "Old notes for the PM" })}, null)`);
    await call(U.sales, `proj_submit_handover('${h}')`);
    await call(U.ops, `proj_assign_handover_pm('${h}', '${U.pm}')`);
    PROJECT = await call<string>(U.pm, `proj_accept_handover('${h}')`);
    OPP_OPEN = await opp("UAE-O-2026-0002");
    OPEN = await call<string>(U.sales, `proj_save_handover('${OPP_OPEN}', '{}'::jsonb, null)`);
    await call(U.sales, `proj_submit_handover('${OPEN}')`);
    await call(U.ops, `proj_assign_handover_pm('${OPEN}', '${U.pm}')`);
  });
  afterAll(async () => db.teardown());

  it("preflight counts them; the migration applies on top of them without touching the accepted brief or guessing", async () => {
    const pre = await admin<{ item: string; result: string }>(pack("proj_handover_parties_00_preflight_readonly.sql"));
    expect(pre.find((r) => /not installed yet/.test(r.item))!.result).toBe("not installed yet");
    expect(pre.find((r) => /accepted handovers/.test(r.item))!.result).toBe("1");
    expect(pre.find((r) => /with the Project Manager/.test(r.item))!.result).toMatch(/^1\b/);
    const before = JSON.stringify(await admin(`select id, status, version, updated_at, notes, client_name from proj_handovers order by id`));
    await db.applyMigration(MIGRATION);
    expect(JSON.stringify(await admin(`select id, status, version, updated_at, notes, client_name from proj_handovers order by id`))).toBe(before);
    expect(await admin(`select 1 from proj_handovers where parties_recorded_at is not null or job_type is not null or agency_name is not null`)).toEqual([]);
  });

  it("the old project opens and says it was not recorded; the notes it already had are there; nothing is invented", async () => {
    const v = await call<Row>(U.pm, `proj_project_handover('${PROJECT}')`);
    expect(v).toMatchObject({ has_handover: true, recorded: false, job_type: null, agency_name: null, site_contact: null, contact_restricted: false, notes: "Old notes for the PM" });
  });

  it("a brief that was already with the Project Manager is accepted as it stood: still not recorded, and exactly one project", async () => {
    const p = await call<string>(U.pm, `proj_accept_handover('${OPEN}')`);
    expect(await call<string>(U.pm, `proj_accept_handover('${OPEN}')`)).toBe(p);
    expect(await call<Row>(U.pm, `proj_project_handover('${p}')`)).toMatchObject({ recorded: false, job_type: null, agency_name: null });
    expect(Number((await admin(`select count(*) n from proj_projects where crm_opportunity_id = '${OPP_OPEN}'`))[0]!.n)).toBe(1);
  });
});
