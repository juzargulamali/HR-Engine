import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: Clients & Agencies, corrections (migration 20261219000100_crm_clients_agencies.sql, sections 5 to 7). Real Postgres, SEPARATE
// connections for every call (each `commit` takes its own pooled session), so overlapping confirms really overlap.
//   * import safety: advisory locks, fill-only writes, batch key, preview fingerprint ('preview_stale' applies nothing), ambiguous untouched,
//     company boundary, unauthorised refused;
//   * organisation roles decide who can be an agency / end client on an inquiry (multi-role organisation, legacy kind, no-role refused);
//   * a dated follow-up on an account with no inquiry (eligible assignee, company boundary, independent of the account owner, completes).

const MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
  "20261219000100_crm_clients_agencies.sql",
];

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), lead: id(), sara: id(), omar: id(), stranger: id(), ksaOnly: id(), hr: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@import-test.ae')`).join(", ");

interface Item {
  key: string; name: string; website?: string | null; roles?: string[]; country_code?: string | null; note?: string | null;
  lead_source?: string | null; exhibition?: string | null; owner_id?: string | null;
  contacts?: { name: string; email?: string | null; role_title?: string | null; phone?: string | null }[]; fingerprint?: string;
}
interface Result { status: string; created?: number; updated?: number; contacts_added?: number; owners_assigned?: number; untouched?: number; failed?: { key: string; message: string }[]; repeated?: boolean; stale?: string[]; stale_count?: number }

describe("Clients & Agencies corrections", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  const soon = "now() + interval '2 days'";
  const bk = (label: string) => `batch-${label}-${randomUUID()}`;

  const fingerprints = async (user: string, co: string, items: Item[]) =>
    (await commit<{ r: Record<string, string> }>(user, `select crm_import_fingerprints('${co}', ${lit(items)}) as r`))[0].r;
  const preview = async (user: string, co: string, items: Item[]): Promise<Item[]> => {
    const fps = await fingerprints(user, co, items);
    return items.map((i) => ({ ...i, fingerprint: fps[i.key] }));
  };
  const apply = async (user: string, co: string, key: string, items: Item[]) =>
    (await commit<{ r: Result }>(user, `select crm_import_apply('${co}', '${key}', ${lit(items)}) as r`))[0].r;
  const count = async (name: string) => Number((await admin<{ n: string }>(`select count(*) n from crm_organisations where name_key = lower(regexp_replace('${name}', '[^A-Za-z0-9]+', '', 'g'))`))[0].n);
  const orgByName = async (name: string) => (await admin<{ id: string; roles: string[]; country_code: string | null; website: string | null; note: string | null }>(`select id, roles, country_code, website, note from crm_organisations where name = '${name}'`))[0];
  const newOrg = async (user: string, args: string) => (await commit<{ id: string }>(user, `select crm_create_organisation_profile(${args}) as id`))[0].id;

  beforeAll(async () => {
    await db.setupBefore(MIGRATIONS[0]!);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hr}', 'hr_admin');
    `);
    for (const f of MIGRATIONS) await db.applyMigration(f);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder}', '${CO.ksa}', '{founder}'),
        ('${U.lead}', '${CO.uae}', '{assign_owner}'),
        ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.stranger}', '${CO.uae}', '{}'),
        ('${U.ksaOnly}', '${CO.ksa}', '{}');
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED') on conflict do nothing;
    `);
  });
  afterAll(async () => { await db.teardown(); });

  describe("import safety (database-enforced)", () => {
    it("the same file confirmed twice at once, by two people, creates one organisation; the second gets the first result", async () => {
      const items: Item[] = [{ key: "a", name: "Fictional Alpha Events", roles: ["agency"], country_code: "AE", contacts: [{ name: "Ana One", email: "ana@alpha.example" }] }];
      const pv = await preview(U.sara, CO.uae, items);
      const key = bk("same-file");
      const [a, b] = await Promise.all([apply(U.sara, CO.uae, key, pv), apply(U.omar, CO.uae, key, pv)]);
      expect(await count("Fictional Alpha Events")).toBe(1);
      expect([a, b].filter((r) => r.repeated).length).toBe(1);
      for (const r of [a, b]) expect(r).toMatchObject({ status: "applied", created: 1, contacts_added: 1 });
      expect((await admin<{ n: string }>(`select count(*) n from crm_contacts c join crm_organisations o on o.id = c.organisation_id where o.name = 'Fictional Alpha Events'`))[0].n).toBe("1");
    });

    it("a repeated batch key is a no-op that returns the first result, even if the items now differ", async () => {
      const items: Item[] = [{ key: "r", name: "Fictional Repeat Co", roles: ["client"] }];
      const pv = await preview(U.sara, CO.uae, items);
      const key = bk("repeat");
      const first = await apply(U.sara, CO.uae, key, pv);
      expect(first).toMatchObject({ status: "applied", created: 1 });
      const again = await apply(U.sara, CO.uae, key, pv);
      expect(again).toMatchObject({ status: "applied", created: 1, repeated: true });
      const different = await apply(U.omar, CO.uae, key, [{ key: "x", name: "Fictional Other Co", fingerprint: "none" }]);
      expect(different).toMatchObject({ repeated: true, created: 1 });
      expect(await count("Fictional Repeat Co")).toBe(1);
      expect(await count("Fictional Other Co")).toBe(0);
    });

    it("two different files naming the same organisation, confirmed at once: exactly one organisation; the other is a stale preview that applied nothing", async () => {
      const fileA: Item[] = [{ key: "z", name: "Fictional Zeta Media L.L.C.", roles: ["agency"], country_code: "AE" }, { key: "q", name: "Fictional Only In A", roles: ["client"] }];
      const fileB: Item[] = [{ key: "z", name: "FICTIONAL ZETA MEDIA LLC", roles: ["client"], country_code: "SA" }, { key: "w", name: "Fictional Only In B", roles: ["client"] }];
      const [pa, pb] = [await preview(U.sara, CO.uae, fileA), await preview(U.omar, CO.uae, fileB)];
      const [ra, rb] = await Promise.all([apply(U.sara, CO.uae, bk("file-a"), pa), apply(U.omar, CO.uae, bk("file-b"), pb)]);
      expect(await count("Fictional Zeta Media LLC")).toBe(1);
      const statuses = [ra.status, rb.status].sort();
      expect(statuses).toEqual(["applied", "preview_stale"]);
      // all or nothing: the stale file created none of its rows (including the row nobody else named)
      const stale = ra.status === "preview_stale" ? "Fictional Only In A" : "Fictional Only In B";
      const applied = ra.status === "preview_stale" ? "Fictional Only In B" : "Fictional Only In A";
      expect(await count(stale)).toBe(0);
      expect(await count(applied)).toBe(1);
    });

    it("an organisation changed after the preview makes the plan stale: nothing is applied", async () => {
      const org = await newOrg(U.founder, `p_name => 'Fictional Stale Co', p_roles => '{agency}'`);
      const items: Item[] = [{ key: "s", name: "Fictional Stale Co", country_code: "AE", website: "stale.example", contacts: [{ name: "Late Add", email: "late@stale.example" }], lead_source: "referral" }];
      const pv = await preview(U.founder, CO.uae, items);
      await commit(U.founder, `select crm_update_organisation('${org}', '{"country_code":"SA"}'::jsonb)`);   // a person edits it after the preview
      const r = await apply(U.founder, CO.uae, bk("stale"), pv);
      expect(r).toMatchObject({ status: "preview_stale", stale: ["s"] });
      const o = await orgByName("Fictional Stale Co");
      expect(o).toMatchObject({ country_code: "SA", website: null });
      expect((await admin<{ n: string }>(`select count(*) n from crm_contacts where organisation_id = '${org}'`))[0].n).toBe("0");
      expect((await admin<{ n: string }>(`select count(*) n from crm_account_profiles where organisation_id = '${org}'`))[0].n).toBe("0");
      // a fresh preview then succeeds, still without overwriting the person's value
      const fresh = await preview(U.founder, CO.uae, items);
      expect(await apply(U.founder, CO.uae, bk("fresh"), fresh)).toMatchObject({ status: "applied", updated: 1, contacts_added: 1 });
      expect(await orgByName("Fictional Stale Co")).toMatchObject({ country_code: "SA", website: "stale.example" });
    });

    it("a contact added by hand, or an owner assigned by hand, after the preview also makes it stale", async () => {
      const org = await newOrg(U.founder, `p_name => 'Fictional Hand Co', p_company_id => '${CO.uae}'`);
      const items: Item[] = [{ key: "h", name: "Fictional Hand Co", contacts: [{ name: "Hand Contact", email: "hand@hand.example" }], owner_id: U.sara }];
      const pv = await preview(U.lead, CO.uae, items);
      await commit(U.lead, `select crm_assign_account_owner('${org}', '${CO.uae}', '${U.omar}')`);
      expect(await apply(U.lead, CO.uae, bk("hand-owner"), pv)).toMatchObject({ status: "preview_stale" });
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${org}'`))[0].owner_id).toBe(U.omar);
      const pv2 = await preview(U.lead, CO.uae, items);
      await commit(U.sara, `select crm_create_contact('${org}', 'Someone Else', null, 'else@hand.example', null)`);
      expect(await apply(U.lead, CO.uae, bk("hand-contact"), pv2)).toMatchObject({ status: "preview_stale" });
      // fresh preview: the owner is already assigned (kept), the contact is new (added)
      const pv3 = await preview(U.lead, CO.uae, items);
      expect(await apply(U.lead, CO.uae, bk("hand-fresh"), pv3)).toMatchObject({ status: "applied", contacts_added: 1, owners_assigned: 0 });
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${org}'`))[0].owner_id).toBe(U.omar);
    });

    it("a confirm racing a manual edit and a manual owner assignment never overwrites either, whichever lands first", async () => {
      for (let round = 0; round < 4; round++) {
        const name = `Fictional Race Co ${round}`;
        const org = await newOrg(U.founder, `p_name => '${name}', p_company_id => '${CO.uae}'`);
        const items: Item[] = [{ key: "x", name, country_code: "SA", owner_id: U.sara, contacts: [{ name: "Race Person", email: `race${round}@race.example` }] }];
        const pv = await preview(U.lead, CO.uae, items);
        const settled = await Promise.allSettled([
          apply(U.lead, CO.uae, bk(`race-${round}`), pv),
          commit(U.founder, `select crm_update_organisation('${org}', '{"country_code":"AE"}'::jsonb)`),
          commit(U.founder, `select crm_assign_account_owner('${org}', '${CO.uae}', '${U.omar}')`),
        ]);
        expect(settled[0]!.status).toBe("fulfilled");
        expect(await count(name)).toBe(1);
        const [o] = await admin<{ country_code: string }>(`select country_code from crm_organisations where id = '${org}'`);
        const [p] = await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${org}'`);
        expect(o.country_code).toBe("AE");       // the person's value, never the file's
        expect(p.owner_id).toBe(U.omar);         // the person's choice, never the file's
        expect((await admin<{ n: string }>(`select count(*) n from crm_contacts where organisation_id = '${org}'`))[0].n).toMatch(/^[01]$/);
      }
    });

    it("never overwrites: existing fields, contacts and owner stay exactly as recorded; the database also refuses a repeated e-mail", async () => {
      const org = await newOrg(U.founder, `p_name => 'Fictional Keep Co', p_roles => '{direct}', p_country_code => 'AE', p_website => 'https://keep.example', p_note => 'Original note',
        p_company_id => '${CO.uae}', p_lead_source => 'linkedin', p_exhibition => 'Original Expo', p_owner_id => '${U.omar}',
        p_contacts => '[{"name":"Kept Person","email":"kept@keep.example"}]'::jsonb`);
      const items: Item[] = [{ key: "k", name: "Fictional Keep Co", roles: ["agency", "client"], country_code: "SA", website: "other.example", note: "Different note", lead_source: "referral", exhibition: "Other Expo", owner_id: U.sara,
        contacts: [{ name: "Renamed Person", email: "KEPT@keep.example" }, { name: "Kept Person" }] }];
      const pv = await preview(U.lead, CO.uae, items);
      const r = await apply(U.lead, CO.uae, bk("keep"), pv);
      expect(r).toMatchObject({ status: "applied", created: 0, updated: 0, contacts_added: 0, owners_assigned: 0, untouched: 1 });
      expect(await orgByName("Fictional Keep Co")).toMatchObject({ roles: ["direct"], country_code: "AE", website: "https://keep.example", note: "Original note" });
      expect((await admin(`select lead_source, exhibition, owner_id from crm_account_profiles where organisation_id = '${org}'`))[0]).toEqual({ lead_source: "linkedin", exhibition: "Original Expo", owner_id: U.omar });
      expect((await admin<{ n: string }>(`select count(*) n from crm_contacts where organisation_id = '${org}'`))[0].n).toBe("1");
      await expect(admin(`insert into crm_contacts (organisation_id, name, email) values ('${org}', 'Dup', 'Kept@Keep.Example')`)).rejects.toThrow(/uq_crm_contacts_org_email|duplicate key/);
    });

    it("fills only what is empty, adds only contacts that are not there, and sets an owner only when unassigned", async () => {
      const org = await newOrg(U.founder, `p_name => 'Fictional Fill Co', p_company_id => '${CO.uae}', p_contacts => '[{"name":"Existing Mail","email":"mail@fill.example"},{"name":"Name Only"}]'::jsonb`);
      const items: Item[] = [{ key: "f", name: "Fictional Fill Co", roles: ["technology", "agency"], country_code: "ae", website: "https://www.fill.example/about", note: "Met at expo", lead_source: "referral", exhibition: "Sample Expo", owner_id: U.sara,
        contacts: [{ name: "Existing Mail", email: "MAIL@fill.example" }, { name: "name only" }, { name: "Brand New", email: "new@fill.example", role_title: "Buyer", phone: "+971500000000" }, { name: "Brand New Again", email: "new@fill.example" }] }];
      const pv = await preview(U.founder, CO.uae, items);
      expect(await apply(U.founder, CO.uae, bk("fill"), pv)).toMatchObject({ status: "applied", updated: 1, contacts_added: 1, owners_assigned: 1, failed: [] });
      expect(await orgByName("Fictional Fill Co")).toMatchObject({ roles: ["technology", "agency"], country_code: "AE", website: "https://www.fill.example/about", note: "Met at expo" });
      expect((await admin(`select lead_source, exhibition, owner_id from crm_account_profiles where organisation_id = '${org}'`))[0]).toEqual({ lead_source: "referral", exhibition: "Sample Expo", owner_id: U.sara });
      expect((await admin<{ name: string }>(`select name from crm_contacts where organisation_id = '${org}' order by name`)).map((c) => c.name)).toEqual(["Brand New", "Existing Mail", "Name Only"]);
    });

    it("ambiguous matches are never applied: several candidates, or the same website under a different name", async () => {
      const a = await newOrg(U.founder, `p_name => 'Fictional Twin Co', p_website => 'twin.example'`);
      await admin(`insert into crm_organisations (name, kind, roles) values ('Fictional Twin Co.', 'client', '{client}')`);   // same normalised name, second record
      const other = await newOrg(U.founder, `p_name => 'Fictional Brand Holdings', p_website => 'https://brand.example'`);
      const items: Item[] = [
        { key: "t", name: "Fictional Twin Co", country_code: "AE", contacts: [{ name: "Nobody", email: "nobody@twin.example" }] },
        { key: "b", name: "Fictional Brand Studio", website: "brand.example", country_code: "AE" },
      ];
      const pv = await preview(U.founder, CO.uae, items);
      expect(await apply(U.founder, CO.uae, bk("ambiguous"), pv)).toMatchObject({ status: "applied", created: 0, updated: 0, untouched: 2, contacts_added: 0 });
      expect(await count("Fictional Brand Studio")).toBe(0);
      expect((await admin<{ n: string }>(`select count(*) n from crm_organisations where name_key = 'fictionaltwinco'`))[0].n).toBe("2");
      expect((await admin<{ country_code: string | null }>(`select country_code from crm_organisations where id in ('${a}', '${other}')`)).every((r) => r.country_code === null)).toBe(true);
      expect((await admin<{ n: string }>(`select count(*) n from crm_contacts where email = 'nobody@twin.example'`))[0].n).toBe("0");
    });

    it("company boundary: a caller without a grant for the company is refused, and rows land only in the company named", async () => {
      const items: Item[] = [{ key: "c", name: "Fictional Border Co", roles: ["client"], lead_source: "referral" }];
      const pv = await preview(U.founder, CO.uae, items);
      await expect(apply(U.ksaOnly, CO.uae, bk("border"), pv)).rejects.toThrow(/Sales access for this company/);
      await expect(fingerprints(U.ksaOnly, CO.uae, items)).rejects.toThrow(/Sales access for this company/);
      expect(await count("Fictional Border Co")).toBe(0);
      expect(await apply(U.founder, CO.uae, bk("border-ok"), pv)).toMatchObject({ status: "applied", created: 1 });
      const org = (await orgByName("Fictional Border Co")).id;
      expect((await admin<{ company_id: string }>(`select company_id from crm_account_profiles where organisation_id = '${org}'`)).map((r) => r.company_id)).toEqual([CO.uae]);
      expect((await admin<{ company_id: string }>(`select company_id from crm_import_batches where created_by = '${U.founder}' and result->>'created' = '1' order by created_at desc limit 1`))[0].company_id).toBe(CO.uae);
    });

    it("unauthorised: no Sales grant is refused, assigning an owner without the right is refused (nothing created), the batch table is not readable directly", async () => {
      const plain: Item[] = [{ key: "u", name: "Fictional Unauthorised Co" }];
      await expect(apply(U.hr, CO.uae, bk("hr"), await preview(U.founder, CO.uae, plain))).rejects.toThrow(/Sales access for this company/);
      const withOwner: Item[] = [{ key: "u", name: "Fictional Unauthorised Co", owner_id: U.omar }];
      await expect(apply(U.sara, CO.uae, bk("sara-owner"), await preview(U.sara, CO.uae, withOwner))).rejects.toThrow(/Only a founder/);
      expect(await count("Fictional Unauthorised Co")).toBe(0);
      expect(await commit(U.sara, `select * from crm_import_batches`)).toEqual([]);   // row-level security, no policy: nothing is readable
      await expect(commit(U.sara, `select crm_import_apply_item('${CO.uae}', '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
      await expect(commit(U.founder, `select crm_import_apply('${CO.uae}', 'short', '[]'::jsonb)`)).rejects.toThrow(/batch key/);
    });

    it("an organisation the person may not edit is reported against that row; the rest of the batch still goes ahead", async () => {
      await newOrg(U.founder, `p_name => 'Fictional Not Mine Co'`);
      const items: Item[] = [{ key: "n", name: "Fictional Not Mine Co", country_code: "AE" }, { key: "m", name: "Fictional Mine Co", country_code: "AE" }];
      const pv = await preview(U.sara, CO.uae, items);
      const r = await apply(U.sara, CO.uae, bk("not-mine"), pv);
      expect(r).toMatchObject({ status: "applied", created: 1, updated: 0 });
      expect(r.failed).toEqual([{ key: "n", message: expect.stringMatching(/Only the person who added/) }]);
      expect((await orgByName("Fictional Not Mine Co")).country_code).toBeNull();
    });
  });

  describe("organisation roles on inquiries", () => {
    let both: string; let agencyOnly: string; let clientOnly: string; let techOnly: string; let noRoles: string; let legacyClient: string;
    const create = (user: string, agency: string | null, client: string | null, title = "Role check") => commit<{ id: string }>(user, `select crm_create_opportunity(
      p_company_id => '${CO.uae}', p_title => '${title}', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon},
      p_agency_org_id => ${agency ? `'${agency}'` : "null"}, p_client_org_id => ${client ? `'${client}'` : "null"}) as id`);
    beforeAll(async () => {
      both = await newOrg(U.founder, `p_name => 'Fictional Both Roles Co', p_roles => '{agency,client}'`);
      agencyOnly = await newOrg(U.founder, `p_name => 'Fictional Agency Only', p_roles => '{agency}'`);
      clientOnly = await newOrg(U.founder, `p_name => 'Fictional Client Only', p_roles => '{client}'`);
      techOnly = await newOrg(U.founder, `p_name => 'Fictional Tech Only', p_roles => '{technology}'`);
      noRoles = await newOrg(U.founder, `p_name => 'Fictional Name Only'`);
      legacyClient = (await commit<{ id: string }>(U.sara, `select crm_create_organisation('Fictional Legacy Client Two', 'client') as id`))[0].id;
    });

    it("one organisation with roles agency and client can be selected as the agency AND as the client, on create and on edit, without a duplicate", async () => {
      const before = Number((await admin<{ n: string }>(`select count(*) n from crm_organisations`))[0].n);
      const [asAgency] = await create(U.sara, both, null, "Both as agency");
      const [asClient] = await create(U.sara, null, both, "Both as client");
      const [asBoth] = await create(U.sara, both, both, "Both in both");
      const [plain] = await create(U.sara, agencyOnly, clientOnly, "Plain pair");
      for (const o of [asAgency, asClient, asBoth, plain]) expect(o.id).toBeTruthy();
      // edit: move the plain inquiry to the multi-role organisation, in each field
      const [v] = await admin<{ version: number }>(`select version from crm_opportunities where id = '${plain.id}'`);
      await commit(U.sara, `select crm_update_opportunity('${plain.id}', ${v.version}, '{"agency_org_id":"${both}"}'::jsonb)`);
      const [v2] = await admin<{ version: number }>(`select version from crm_opportunities where id = '${plain.id}'`);
      await commit(U.sara, `select crm_update_opportunity('${plain.id}', ${v2.version}, '{"client_org_id":"${both}"}'::jsonb)`);
      expect((await admin(`select agency_org_id, client_org_id from crm_opportunities where id = '${plain.id}'`))[0]).toEqual({ agency_org_id: both, client_org_id: both });
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_organisations`))[0].n)).toBe(before);
    });

    it("an organisation without the role is refused for that field (create and edit); legacy kinds and roles-less records keep working", async () => {
      await expect(create(U.sara, clientOnly, null)).rejects.toThrow(/not recorded as an agency/);
      await expect(create(U.sara, techOnly, null)).rejects.toThrow(/not recorded as an agency/);
      await expect(create(U.sara, null, agencyOnly)).rejects.toThrow(/not recorded as an end client or direct client/);
      await expect(create(U.sara, null, techOnly)).rejects.toThrow(/not recorded as an end client or direct client/);
      await expect(create(U.sara, noRoles, null)).rejects.toThrow(/not recorded as an agency/);        // no roles: reads as its legacy kind (client)
      expect((await create(U.sara, null, noRoles))[0].id).toBeTruthy();
      expect((await create(U.sara, null, legacyClient))[0].id).toBeTruthy();
      const [o] = await create(U.sara, agencyOnly, null, "Edit target");
      const [v] = await admin<{ version: number }>(`select version from crm_opportunities where id = '${o.id}'`);
      await expect(commit(U.sara, `select crm_update_opportunity('${o.id}', ${v.version}, '{"agency_org_id":"${clientOnly}"}'::jsonb)`)).rejects.toThrow(/not recorded as an agency/);
      await expect(commit(U.sara, `select crm_update_opportunity('${o.id}', ${v.version}, '{"client_org_id":"${agencyOnly}"}'::jsonb)`)).rejects.toThrow(/not recorded as an end client/);
      // an older inquiry whose organisation later lost the role stays editable, because the field is not being changed
      await admin(`update crm_organisations set roles = '{client}' where id = '${agencyOnly}'`);
      await commit(U.sara, `select crm_update_opportunity('${o.id}', ${v.version}, '{"title":"Renamed"}'::jsonb)`);
      await admin(`update crm_organisations set roles = '{agency}' where id = '${agencyOnly}'`);
    });
  });

  describe("a dated follow-up on an account with no inquiry", () => {
    let acct: string; let fu: string;
    const add = (user: string, org: string, co: string, assignee: string | null, title = "Call the account") => commit<{ id: string }>(user,
      `select crm_create_account_follow_up('${org}', '${co}', '${title}', ${soon}, 'call', ${assignee ? `'${assignee}'` : "null"}) as id`);
    beforeAll(async () => { acct = await newOrg(U.founder, `p_name => 'Fictional No Inquiry Account', p_roles => '{client}', p_company_id => '${CO.uae}'`); });

    it("Sales staff add one for themselves; it needs the assign right to give it to someone else; the assignee must be eligible for the company", async () => {
      const [mine] = await add(U.sara, acct, CO.uae, null);
      expect((await admin(`select opportunity_id, organisation_id, assigned_to, created_by, status from crm_follow_ups where id = '${mine.id}'`))[0]).toEqual({ opportunity_id: null, organisation_id: acct, assigned_to: U.sara, created_by: U.sara, status: "open" });
      await expect(add(U.sara, acct, CO.uae, U.omar)).rejects.toThrow(/Only the owner or a founder can assign/);
      fu = (await add(U.lead, acct, CO.uae, U.omar, "Assigned by lead"))[0].id;
      expect((await add(U.founder, acct, CO.uae, U.sara, "Assigned by founder"))[0].id).toBeTruthy();
      await expect(add(U.lead, acct, CO.uae, U.ksaOnly)).rejects.toThrow(/no Sales access for this company/);
      await expect(add(U.sara, acct, CO.uae, null, "   ")).rejects.toThrow(/title and a due date/);
    });

    it("company boundary: a caller of another company cannot create or read it; nobody without a grant can", async () => {
      await expect(add(U.ksaOnly, acct, CO.uae, null)).rejects.toThrow(/Sales access for this company/);
      await expect(add(U.hr, acct, CO.uae, null)).rejects.toThrow(/Sales access for this company/);
      expect((await commit<{ n: string }>(U.ksaOnly, `select count(*) n from crm_follow_ups where organisation_id = '${acct}'`))[0].n).toBe("0");
      expect((await commit<{ n: string }>(U.hr, `select count(*) n from crm_follow_ups where organisation_id = '${acct}'`))[0].n).toBe("0");
      expect(Number((await commit<{ n: string }>(U.sara, `select count(*) n from crm_follow_ups where organisation_id = '${acct}'`))[0].n)).toBeGreaterThanOrEqual(3);
      await expect(commit(U.sara, `insert into crm_follow_ups (organisation_id, company_id, assigned_to, title, due_at, created_by) values ('${acct}', '${CO.uae}', '${U.sara}', 'direct', now(), '${U.sara}')`)).rejects.toThrow(/permission denied|row-level security/);
    });

    it("account owner and follow-up assignee are independent: reassigning either never changes the other", async () => {
      await commit(U.lead, `select crm_assign_account_owner('${acct}', '${CO.uae}', '${U.omar}')`);
      await commit(U.founder, `select crm_reassign_follow_up('${fu}', '${U.founder}')`);
      expect((await admin<{ assigned_to: string }>(`select assigned_to from crm_follow_ups where id = '${fu}'`))[0].assigned_to).toBe(U.founder);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${acct}' and company_id = '${CO.uae}'`))[0].owner_id).toBe(U.omar);
      await commit(U.lead, `select crm_assign_account_owner('${acct}', '${CO.uae}', '${U.sara}')`);
      expect((await admin<{ assigned_to: string }>(`select assigned_to from crm_follow_ups where id = '${fu}'`))[0].assigned_to).toBe(U.founder);
      await expect(commit(U.sara, `select crm_reassign_follow_up('${fu}', '${U.omar}')`)).rejects.toThrow(/Only the assignee, the person who added it or a founder/);   // being the account owner gives no right over it
      await expect(commit(U.founder, `select crm_reassign_follow_up('${fu}', '${U.ksaOnly}')`)).rejects.toThrow(/no Sales access/);
    });

    it("completes, reschedules and cancels like an inquiry follow-up: assignee, creator or founder only; an outcome is required; closed ones stay closed", async () => {
      const [x] = await add(U.sara, acct, CO.uae, null, "To complete");
      await expect(commit(U.stranger, `select crm_complete_follow_up('${x.id}', 'done')`)).rejects.toThrow(/Only the assignee/);
      await expect(commit(U.sara, `select crm_complete_follow_up('${x.id}', '  ')`)).rejects.toThrow(/outcome/);
      await commit(U.sara, `select crm_reschedule_follow_up('${x.id}', now() + interval '5 days')`);
      await commit(U.sara, `select crm_complete_follow_up('${x.id}', 'Spoke to the account', 'Send the portfolio', ${soon}, 'email')`);
      expect((await admin(`select status, outcome, completed_by from crm_follow_ups where id = '${x.id}'`))[0]).toEqual({ status: "done", outcome: "Spoke to the account", completed_by: U.sara });
      expect((await admin<{ title: string; assigned_to: string; opportunity_id: string | null }>(`select title, assigned_to, opportunity_id from crm_follow_ups where organisation_id = '${acct}' and title = 'Send the portfolio'`))[0]).toEqual({ title: "Send the portfolio", assigned_to: U.sara, opportunity_id: null });
      await expect(commit(U.sara, `select crm_complete_follow_up('${x.id}', 'again')`)).rejects.toThrow(/already closed/);
      const [y] = await add(U.sara, acct, CO.uae, null, "To cancel");
      await expect(commit(U.sara, `select crm_cancel_follow_up('${y.id}', '')`)).rejects.toThrow(/why/);
      await commit(U.founder, `select crm_cancel_follow_up('${y.id}', 'Not needed')`);   // a founder may act on anyone's
      expect((await admin<{ status: string }>(`select status from crm_follow_ups where id = '${y.id}'`))[0].status).toBe("cancelled");
      // no reminder or activity row is made for an account follow-up (there is no inquiry to attach it to)
      expect((await admin<{ n: string }>(`select count(*) n from crm_reminders where follow_up_id in (select id from crm_follow_ups where organisation_id = '${acct}')`))[0].n).toBe("0");
    });

    it("an account follow-up needs an organisation or an inquiry; inquiry follow-ups are unchanged", async () => {
      await expect(admin(`insert into crm_follow_ups (company_id, assigned_to, title, due_at, created_by) values ('${CO.uae}', '${U.sara}', 'nowhere', now(), '${U.sara}')`)).rejects.toThrow(/crm_follow_ups_target|check constraint/);
      const o = await newOrg(U.founder, `p_name => 'Fictional With Inquiry', p_roles => '{client}', p_company_id => '${CO.uae}'`);
      const [opp] = await commit<{ id: string }>(U.sara, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Has inquiry', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon}, p_client_org_id => '${o}') as id`);
      const [f] = await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${opp.id}'`);
      await expect(commit(U.stranger, `select crm_complete_follow_up('${f.id}', 'x', 'next', ${soon})`)).rejects.toThrow(/Only the assignee, the opportunity owner or a founder/);
      await commit(U.sara, `select crm_complete_follow_up('${f.id}', 'Done', 'Next step', ${soon})`);
      expect((await admin<{ n: string }>(`select count(*) n from crm_follow_ups where opportunity_id = '${opp.id}' and status = 'open'`))[0].n).toBe("1");
    });
  });
});
