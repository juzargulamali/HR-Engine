import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM: Clients & Agencies (migration 20261219000100_crm_clients_agencies.sql). Proves, against a real Postgres:
//   * one organisation record can carry several roles (agency + direct client + technology company); old kind still works;
//   * a profile needs only a name, and contacts are saved atomically with it;
//   * editing an organisation follows the contact rule; account owner and follow-up assignee confer NO edit right;
//   * assigning an account owner needs assign_owner in that company and an eligible person; clearing means Unassigned;
//   * account owner and follow-up assignee are independent of each other and of the opportunity owner;
//   * the company profile is readable only with a grant for that company; writes are function-only.

const FIRST_CRM_MIGRATION = "20261115000000_crm_access_audit_settings.sql";
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
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@clients-test.ae')`).join(", ");

describe("Clients & Agencies", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const commit = <T = Record<string, unknown>>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql, [])).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";

  let orgId: string;       // created by the founder
  let oppId: string;       // UAE opportunity owned by sara, linked to orgId
  let fuId: string;        // open follow-up on oppId, assigned to sara (the owner)

  beforeAll(async () => {
    await db.setupBefore(FIRST_CRM_MIGRATION);
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
    `);
    orgId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(
      p_name => 'Fictional Aurora Events', p_roles => '{agency,technology}', p_company_id => '${CO.uae}') as id`))[0].id;
    oppId = (await commit<{ id: string }>(U.sara, `select crm_create_opportunity(
      p_company_id => '${CO.uae}', p_title => 'Aurora gala', p_source => 'agency_call', p_next_title => 'Call', p_next_due => ${soon},
      p_agency_org_id => '${orgId}') as id`))[0].id;
    fuId = (await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${oppId}'`))[0].id;
  });

  afterAll(async () => { await db.teardown(); });

  describe("roles and profile", () => {
    it("keeps one record for several roles and derives the legacy kind", async () => {
      const [o] = await admin<{ roles: string[]; kind: string }>(`select roles, kind from crm_organisations where id = '${orgId}'`);
      expect(o.roles.sort()).toEqual(["agency", "technology"]);
      expect(o.kind).toBe("agency");
      await commit(U.founder, `select crm_update_organisation('${orgId}', '{"roles":["agency","direct","technology"]}'::jsonb)`);
      expect((await admin<{ n: string }>(`select count(*) n from crm_organisations where name = 'Fictional Aurora Events'`))[0].n).toBe("1");
      expect((await admin<{ roles: string[] }>(`select roles from crm_organisations where id = '${orgId}'`))[0].roles.sort()).toEqual(["agency", "direct", "technology"]);
    });
    it("the older creator still works and records its kind as the role", async () => {
      const [r] = await commit<{ id: string }>(U.sara, `select crm_create_organisation('Fictional Legacy Client', 'client', 'Dubai') as id`);
      expect((await admin<{ roles: string[] }>(`select roles from crm_organisations where id = '${r.id}'`))[0].roles).toEqual(["client"]);
    });
    it("needs only a name; everything else can be filled in later", async () => {
      const [r] = await commit<{ id: string }>(U.sara, `select crm_create_organisation_profile(p_name => 'Fictional Imported Co') as id`);
      const [o] = await admin<{ roles: string[]; country_code: string | null; website: string | null }>(`select roles, country_code, website from crm_organisations where id = '${r.id}'`);
      expect(o).toEqual({ roles: [], country_code: null, website: null });
      // the creator fills it in later
      await commit(U.sara, `select crm_update_organisation('${r.id}', '{"country_code":"ae","website":"https://www.imported.example/about","roles":["direct"]}'::jsonb)`);
      const [o2] = await admin<{ country_code: string; website_domain: string; kind: string }>(`select country_code, website_domain, kind from crm_organisations where id = '${r.id}'`);
      expect(o2).toEqual({ country_code: "AE", website_domain: "imported.example", kind: "direct" });
    });
    it("saves contacts atomically with the profile, and refuses the whole thing when one is invalid", async () => {
      const [r] = await commit<{ id: string }>(U.sara, `select crm_create_organisation_profile(p_name => 'Fictional Two Contacts',
        p_contacts => '[{"name":"Noor A","role_title":"Producer","email":"noor@two.example"},{"name":"Ravi B","phone":"+971 50 000 0000"}]'::jsonb) as id`);
      expect(await admin(`select 1 from crm_contacts where organisation_id = '${r.id}'`)).toHaveLength(2);
      await expect(commit(U.sara, `select crm_create_organisation_profile(p_name => 'Fictional Broken Co',
        p_contacts => '[{"name":"Ok P"},{"name":"Bad Mail","email":"nope"}]'::jsonb)`)).rejects.toThrow();
      expect(await admin(`select 1 from crm_organisations where name = 'Fictional Broken Co'`)).toHaveLength(0);
    });
    it("rejects an invalid role and a malformed country", async () => {
      await expect(commit(U.sara, `select crm_create_organisation_profile(p_name => 'X1 Co', p_roles => '{sponsor}')`)).rejects.toThrow(/roles_valid|check constraint/i);
      await expect(commit(U.sara, `select crm_create_organisation_profile(p_name => 'X2 Co', p_country_code => 'UAE')`)).rejects.toThrow(/country_format|check constraint/i);
    });
    it("refuses creation without any CRM grant", async () => {
      for (const who of [U.hr]) await expect(commit(who, `select crm_create_organisation_profile(p_name => 'No Grant Co')`)).rejects.toThrow(/No CRM access/);
    });
  });

  describe("who may edit", () => {
    it("lets the creator, a founder and the owner of an open linked opportunity edit", async () => {
      await commit(U.founder, `select crm_update_organisation('${orgId}', '{"note":"founder note"}'::jsonb)`);
      await commit(U.sara, `select crm_update_organisation('${orgId}', '{"note":"owner of the opportunity note"}'::jsonb)`);
      expect((await admin<{ note: string }>(`select note from crm_organisations where id = '${orgId}'`))[0].note).toBe("owner of the opportunity note");
    });
    it("refuses a colleague with Sales access who is none of those, and people without a grant", async () => {
      for (const who of [U.stranger, U.omar, U.ksaOnly, U.hr]) {
        await expect(commit(who, `select crm_update_organisation('${orgId}', '{"note":"nope"}'::jsonb)`), who).rejects.toThrow(/Only the person who added|No CRM|not found/i);
      }
      await expect(commit(U.stranger, `select crm_save_account_profile('${orgId}', '${CO.uae}', '{"exhibition":"x"}'::jsonb)`)).rejects.toThrow(/Only the person who added/);
    });
    it("refuses unknown fields and an empty patch", async () => {
      await expect(commit(U.founder, `select crm_update_organisation('${orgId}', '{"created_by":null}'::jsonb)`)).rejects.toThrow(/cannot be changed/);
      await expect(commit(U.founder, `select crm_update_organisation('${orgId}', '{}'::jsonb)`)).rejects.toThrow(/Nothing to change/);
    });
    it("a founder of another company cannot edit this company's lead source", async () => {
      await expect(commit(U.ksaOnly, `select crm_save_account_profile('${orgId}', '${CO.ksa}', '{"exhibition":"x"}'::jsonb)`)).rejects.toThrow(/Only the person who added/);
      await commit(U.founder, `select crm_save_account_profile('${orgId}', '${CO.ksa}', '{"lead_source":"exhibition","exhibition":"Gulf Expo 2026 (fictional)"}'::jsonb)`);
      await commit(U.sara, `select crm_save_account_profile('${orgId}', '${CO.uae}', '{"lead_source":"exhibition","exhibition":"Gulf Expo 2026 (fictional)"}'::jsonb)`);
    });
  });

  describe("account owner", () => {
    it("is assigned only by assign_owner / founder, only to an eligible person of that company", async () => {
      await expect(commit(U.sara, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.sara}')`)).rejects.toThrow(/Only a founder/);
      await expect(commit(U.stranger, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.stranger}')`)).rejects.toThrow(/Only a founder/);
      await expect(commit(U.lead, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.ksaOnly}')`)).rejects.toThrow(/no Sales access for this company/);
      await expect(commit(U.hr, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.sara}')`)).rejects.toThrow(/Only a founder/);
      await commit(U.lead, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.sara}')`);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${orgId}' and company_id = '${CO.uae}'`))[0].owner_id).toBe(U.sara);
    });
    it("does not let a UAE assigner assign for KSA", async () => {
      await expect(commit(U.lead, `select crm_assign_account_owner('${orgId}', '${CO.ksa}', '${U.ksaOnly}')`)).rejects.toThrow(/Only a founder/);
    });
    it("can be cleared (Unassigned) and reassigned", async () => {
      await commit(U.lead, `select crm_assign_account_owner('${orgId}', '${CO.uae}', null)`);
      expect((await admin<{ owner_id: string | null }>(`select owner_id from crm_account_profiles where organisation_id = '${orgId}' and company_id = '${CO.uae}'`))[0].owner_id).toBeNull();
      await commit(U.lead, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.sara}')`);
    });
    it("is per company: a KSA profile can have a different owner", async () => {
      await commit(U.founder, `select crm_assign_account_owner('${orgId}', '${CO.ksa}', '${U.ksaOnly}')`);
      const rows = await admin<{ company_id: string; owner_id: string }>(`select company_id, owner_id from crm_account_profiles where organisation_id = '${orgId}'`);
      expect(rows.find((r) => r.company_id === CO.uae)?.owner_id).toBe(U.sara);
      expect(rows.find((r) => r.company_id === CO.ksa)?.owner_id).toBe(U.ksaOnly);
    });
  });

  describe("owner and follow-up assignee are independent, and confer no access", () => {
    it("reassigning the follow-up leaves the account owner and the opportunity owner alone", async () => {
      await commit(U.sara, `select crm_reassign_follow_up('${fuId}', '${U.omar}')`);
      expect((await admin<{ assigned_to: string }>(`select assigned_to from crm_follow_ups where id = '${fuId}'`))[0].assigned_to).toBe(U.omar);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_account_profiles where organisation_id = '${orgId}' and company_id = '${CO.uae}'`))[0].owner_id).toBe(U.sara);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_opportunities where id = '${oppId}'`))[0].owner_id).toBe(U.sara);
    });
    it("reassigning the account owner leaves the follow-up assignee and the opportunity owner alone", async () => {
      await commit(U.lead, `select crm_assign_account_owner('${orgId}', '${CO.uae}', '${U.stranger}')`);
      expect((await admin<{ assigned_to: string }>(`select assigned_to from crm_follow_ups where id = '${fuId}'`))[0].assigned_to).toBe(U.omar);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_opportunities where id = '${oppId}'`))[0].owner_id).toBe(U.sara);
    });
    it("being account owner confers no right to edit the organisation or its profile", async () => {
      // stranger is now the account owner and still cannot edit
      await expect(commit(U.stranger, `select crm_update_organisation('${orgId}', '{"note":"as account owner"}'::jsonb)`)).rejects.toThrow(/Only the person who added/);
      await expect(commit(U.stranger, `select crm_save_account_profile('${orgId}', '${CO.uae}', '{"exhibition":"y"}'::jsonb)`)).rejects.toThrow(/Only the person who added/);
      expect((await q<{ ok: boolean }>(U.stranger, `select crm_can_edit_organisation('${orgId}', '${CO.uae}') as ok`))[0].ok).toBe(false);
    });
    it("being the follow-up assignee confers no right to edit the organisation, nor to move the opportunity", async () => {
      await expect(commit(U.omar, `select crm_update_organisation('${orgId}', '{"note":"as assignee"}'::jsonb)`)).rejects.toThrow(/Only the person who added/);
      await expect(commit(U.omar, `select crm_assign_owner('${oppId}', '${U.omar}')`)).rejects.toThrow(/Only a founder/);
    });
    it("follow-up reassignment follows the existing rules", async () => {
      // the assignee (omar) may hand it to himself/owner but not to a third person; an outsider is refused; the new person must be eligible
      await expect(commit(U.omar, `select crm_reassign_follow_up('${fuId}', '${U.stranger}')`)).rejects.toThrow(/Only the owner or a founder/);
      await expect(commit(U.stranger, `select crm_reassign_follow_up('${fuId}', '${U.stranger}')`)).rejects.toThrow(/Only the assignee/);
      await expect(commit(U.sara, `select crm_reassign_follow_up('${fuId}', '${U.ksaOnly}')`)).rejects.toThrow(/no Sales access/);
      await expect(commit(U.ksaOnly, `select crm_reassign_follow_up('${fuId}', '${U.ksaOnly}')`)).rejects.toThrow(/not found/i);
      await commit(U.omar, `select crm_reassign_follow_up('${fuId}', '${U.sara}')`);
    });
  });

  describe("visibility and writes", () => {
    it("shows a company's profile rows only to people with a grant for that company", async () => {
      expect((await q<{ company_id: string }>(U.omar, `select company_id from crm_account_profiles where organisation_id = '${orgId}'`)).map((r) => r.company_id)).toEqual([CO.uae]);
      expect((await q<{ company_id: string }>(U.ksaOnly, `select company_id from crm_account_profiles where organisation_id = '${orgId}'`)).map((r) => r.company_id)).toEqual([CO.ksa]);
      expect(await q(U.hr, `select 1 from crm_account_profiles`)).toHaveLength(0);
    });
    it("refuses direct writes to the profile table and to organisations", async () => {
      await expect(commit(U.founder, `insert into crm_account_profiles (organisation_id, company_id) values ('${orgId}', '${CO.uae}')`)).rejects.toThrow(/permission denied|row-level security/i);
      await commit(U.founder, `update crm_account_profiles set owner_id = '${U.founder}'`); // no UPDATE policy: touches no row
      expect((await admin<{ n: string }>(`select count(*) n from crm_account_profiles where owner_id = '${U.founder}'`))[0].n).toBe("0");
      await expect(q(null, `select 1 from crm_account_profiles`)).rejects.toThrow(/permission denied/i);
    });
  });
});
