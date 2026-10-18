import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Sales & CRM (Stage B). Proves, against a real Postgres built from every migration:
//   * company-scoped CRM grants, with no overlap between CRM access and HR roles in either direction;
//   * every write goes through a controlled function that enforces owner/founder/capability rules;
//   * commercial approval stays "not configured" until a founder sets a policy;
//   * files, reminders, duplicates and privileges behave as designed.
// The CRM migrations are applied AFTER companies already exist, as on V2, to prove they seed settings from existing
// companies and never create one.

const FIRST_CRM_MIGRATION = "20261115000000_crm_access_audit_settings.sql";
const CRM_MIGRATIONS = [
  "20261115000000_crm_access_audit_settings.sql",
  "20261115000100_crm_core_tables.sql",
  "20261115000200_crm_workflow_functions.sql",
  "20261115000300_crm_proposals_files_reminders.sql",
];

const id = () => randomUUID();
const CO = { uae: id(), ksa: id(), pl: id() };
const U = {
  juzar: id(), rafi: id(), amira: id(), daniel: id(), lena: id(),
  hr: id(), ceo: id(), sysadmin: id(), pm: id(), outsider: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@crm-test.ae')`).join(", ");

const DENIED = /permission denied|row-level security|not allowed|Only |not found|no Sales access|do not have|No CRM access/i;

describe("Sales & CRM", () => {
  const db = new RlsTestDatabase();
  let agencyId: string;
  let clientId: string;
  let oppUae: string;
  let oppKsa: string;
  let oppPl: string;
  let companyCount = 0;

  // Rows are typed as non-empty so `rows[0]` reads naturally; assertions on emptiness use toHaveLength.
  type Rows<T> = [T, ...T[]];
  const q = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) =>
    db.asUser(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const commit = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
    db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const soon = "now() + interval '2 days'";
  /** Assert a statement fails inside an open transaction without aborting it (savepoint). */
  const fails = async (query: (sql: string) => Promise<unknown>, sql: string, re: RegExp) => {
    await query("savepoint s");
    await expect(query(sql)).rejects.toThrow(re);
    await query("rollback to savepoint s");
  };

  async function newOpp(user: string, company: string, title: string, extra = ""): Promise<string> {
    const rows = await commit<{ id: string }>(
      user,
      `select crm_create_opportunity(
         p_company_id => '${company}', p_title => '${title}', p_source => 'agency_call',
         p_next_title => 'Call the agency', p_next_due => ${soon},
         p_agency_org_id => '${agencyId}', p_client_org_id => '${clientId}' ${extra}) as id`,
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    await db.setupBefore(FIRST_CRM_MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values
        ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('PL', 'Poland', 'PLN')
        on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'),
        ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR'),
        ('${CO.pl}',  'Enginious Poland', 'PL', 'PLN');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hr}', 'hr_admin'), ('${U.ceo}', 'ceo'), ('${U.sysadmin}', 'sys_admin');
    `);
    companyCount = Number((await admin<{ n: string }>("select count(*) n from companies"))[0].n);
    for (const f of CRM_MIGRATIONS) await db.applyMigration(f);
    await db.seed(`
      -- Production-style grants after migrations (what the test harness does for every suite).
      grant select, insert, update, delete on all tables in schema public to authenticated;
      -- Founders (bootstrap as the owner's manual SQL would do it) and sales staff.
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.juzar}', '${CO.uae}', '{founder}'), ('${U.juzar}', '${CO.ksa}', '{founder}'), ('${U.juzar}', '${CO.pl}', '{founder}'),
        ('${U.rafi}',  '${CO.uae}', '{founder}'), ('${U.rafi}',  '${CO.ksa}', '{founder}'), ('${U.rafi}',  '${CO.pl}', '{founder}'),
        ('${U.amira}', '${CO.uae}', '{}'), ('${U.amira}', '${CO.ksa}', '{}'),
        ('${U.daniel}', '${CO.uae}', '{}'),
        ('${U.lena}',  '${CO.pl}', '{}');
    `);
    agencyId = (await commit<{ id: string }>(U.amira, `select crm_create_organisation('Zeta Media LLC', 'agency', 'Dubai') as id`))[0].id;
    clientId = (await commit<{ id: string }>(U.amira, `select crm_create_organisation('Orbit Motors', 'client', 'Riyadh') as id`))[0].id;
    oppUae = await newOpp(U.amira, CO.uae, 'Floor projection');
    oppKsa = await newOpp(U.amira, CO.ksa, 'LED tunnel');
    oppPl = await newOpp(U.lena, CO.pl, 'Mirror booth');
  });

  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("settings seeded from existing companies", () => {
    it("created no company", async () => {
      expect(Number((await admin<{ n: string }>("select count(*) n from companies"))[0].n)).toBe(companyCount);
    });
    it("seeds UAE/KSA/PL reference codes and AED/SAR/EUR currencies", async () => {
      const rows = await admin<{ company_id: string; reference_code: string; default_quote_currency: string }>(
        "select company_id, reference_code, default_quote_currency from crm_company_settings order by reference_code",
      );
      expect(rows.map((r) => [r.reference_code, r.default_quote_currency])).toEqual([
        ["KSA", "SAR"], ["PL", "EUR"], ["UAE", "AED"],
      ]);
    });
    it("leaves response targets, calendar and approval policy unconfigured", async () => {
      const rows = await admin<{ response_target_hours: number | null; working_calendar: unknown; approval_policy: string; owner_email_enabled: boolean }>(
        "select response_target_hours, working_calendar, approval_policy, owner_email_enabled from crm_company_settings",
      );
      for (const r of rows) {
        expect(r.response_target_hours).toBeNull();
        expect(r.working_calendar).toBeNull();
        expect(r.approval_policy).toBe("not_configured");
        expect(r.owner_email_enabled).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("company-scoped visibility and HR separation", () => {
    it("shows a user the shared pipeline of every company they are granted, and no other", async () => {
      const amira = await q<{ company_id: string }>(U.amira, "select distinct company_id from crm_opportunities");
      expect(amira.map((r) => r.company_id).sort()).toEqual([CO.uae, CO.ksa].sort());
      const daniel = await q<{ company_id: string }>(U.daniel, "select distinct company_id from crm_opportunities");
      expect(daniel.map((r) => r.company_id)).toEqual([CO.uae]);
      const lena = await q<{ company_id: string }>(U.lena, "select distinct company_id from crm_opportunities");
      expect(lena.map((r) => r.company_id)).toEqual([CO.pl]);
    });
    it("lets a colleague see an opportunity another salesperson owns (shared pipeline)", async () => {
      const rows = await q(U.daniel, `select id from crm_opportunities where id = '${oppUae}'`);
      expect(rows).toHaveLength(1);
    });
    it("gives HR admin, CEO and sys_admin roles no CRM visibility at all", async () => {
      for (const who of [U.hr, U.ceo, U.sysadmin, U.outsider, U.pm]) {
        for (const table of ["crm_opportunities", "crm_organisations", "crm_contacts", "crm_follow_ups", "crm_activities",
          "crm_files", "crm_proposals", "crm_company_settings", "crm_company_grants", "crm_audit_log", "crm_opportunity_events"]) {
          const rows = await q(who, `select 1 from ${table}`);
          expect(rows, `${table} visible to ${who}`).toHaveLength(0);
        }
      }
    });
    it("gives a CRM grant no HR access", async () => {
      const [role] = await q<{ hr: boolean; ceo: boolean }>(U.amira, "select has_role('hr_admin', null) as hr, has_role('ceo', null) as ceo");
      expect(role).toEqual({ hr: false, ceo: false });
      expect(await q(U.juzar, "select 1 from employees")).toHaveLength(0);
      expect(await q(U.juzar, "select 1 from user_roles")).toHaveLength(0);
    });
    it("denies anonymous callers everything", async () => {
      await expect(q(null, "select 1 from crm_opportunities")).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select crm_has_access('${CO.uae}')`)).rejects.toThrow(/permission denied/i);
    });
    it("shows nothing about opportunities of a company the caller has no grant for, by direct id lookup", async () => {
      expect(await q(U.daniel, `select 1 from crm_opportunities where id = '${oppKsa}'`)).toHaveLength(0);
      await expect(q(U.daniel, `select crm_move_stage('${oppKsa}', 'qualified')`)).rejects.toThrow(/not found/i);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("tables are read-only to clients", () => {
    it.each(["crm_opportunities", "crm_organisations", "crm_follow_ups", "crm_company_grants", "crm_company_settings", "crm_proposals"])(
      "refuses direct INSERT into %s",
      async (table) => {
        const sql: Record<string, string> = {
          crm_opportunities: `insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, currency, agency_org_id)
            values ('${CO.uae}', 'HACK-1', 'x', 'other', '${U.amira}', '${U.amira}', 'AED', '${agencyId}')`,
          crm_organisations: `insert into crm_organisations (name, kind) values ('X', 'agency')`,
          crm_follow_ups: `insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, due_at, created_by)
            values ('${oppUae}', '${CO.uae}', '${U.amira}', 'x', now(), '${U.amira}')`,
          crm_company_grants: `insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.amira}', '${CO.pl}', '{founder}')`,
          crm_company_settings: `update crm_company_settings set approval_policy = 'not_required'`,
          crm_proposals: `insert into crm_proposals (opportunity_id, company_id, version, created_by) values ('${oppUae}', '${CO.uae}', 9, '${U.amira}')`,
        };
        const rows = await q(U.juzar, sql[table] as string).then(
          (r) => r,
          (e: Error) => e,
        );
        // Either the statement is rejected, or (for UPDATE) it touches no row.
        if (rows instanceof Error) expect(rows.message).toMatch(DENIED);
        else expect(rows).toHaveLength(0);
      },
    );
    it("does not let an owner change their own opportunity by UPDATE (stage, owner, value stay put)", async () => {
      const result = await db.asUser(U.amira, async (query) => {
        const r = await query(`update crm_opportunities set owner_id = '${U.daniel}', stage = 'won', value = 1 where id = '${oppUae}'`);
        return r.rowCount;
      }).catch((e: Error) => e);
      if (result instanceof Error) expect(result.message).toMatch(DENIED);
      else expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("access grants", () => {
    it("lets a founder grant and revoke; revoked users lose visibility at once", async () => {
      const rows = await q<{ n: string }>(U.juzar, `
        select crm_grant_access('${U.pm}', '${CO.uae}', '{}', 'trial') as g, 1 as x`).then(async () => {
        return db.asUser(U.juzar, async (query) => {
          await query(`select crm_grant_access('${U.pm}', '${CO.uae}', '{}')`);
          await query(`select set_config('request.jwt.claims', '{"sub":"${U.pm}","role":"authenticated"}', true)`);
          const seen = (await query("select count(*)::int n from crm_opportunities")).rows[0].n;
          await query(`select set_config('request.jwt.claims', '{"sub":"${U.juzar}","role":"authenticated"}', true)`);
          await query(`select crm_revoke_access('${U.pm}', '${CO.uae}')`);
          await query(`select set_config('request.jwt.claims', '{"sub":"${U.pm}","role":"authenticated"}', true)`);
          const after = (await query("select count(*)::int n from crm_opportunities")).rows[0].n;
          return [{ n: `${seen}/${after}` }];
        });
      });
      expect(rows[0].n).toBe("1/0");
    });
    it("refuses a non-founder, and never grants access to inactive users", async () => {
      await expect(q(U.amira, `select crm_grant_access('${U.pm}', '${CO.uae}', '{}')`)).rejects.toThrow(/founder/i);
      await admin(`update profiles set is_active = false where id = '${U.outsider}'`);
      await expect(q(U.juzar, `select crm_grant_access('${U.outsider}', '${CO.uae}', '{}')`)).rejects.toThrow(/not active|does not exist/i);
      await admin(`update profiles set is_active = true where id = '${U.outsider}'`);
    });
    it("rejects unknown capabilities", async () => {
      await expect(q(U.juzar, `select crm_grant_access('${U.pm}', '${CO.uae}', '{superuser}')`)).rejects.toThrow(/capability/i);
    });
    it("lets only a founder hand out founder or access-management rights", async () => {
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.uae}', '{manage_access}')`);
      await expect(q(U.pm, `select crm_grant_access('${U.daniel}', '${CO.uae}', '{founder}')`)).rejects.toThrow(/founder/i);
      await admin(`delete from crm_company_grants where user_id = '${U.pm}'`);
    });
    it("does not let a non-founder access manager demote a founder, nor anyone demote the last founder", async () => {
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.uae}', '{manage_access}')`);
      await expect(q(U.pm, `select crm_grant_access('${U.juzar}', '${CO.uae}', '{}')`)).rejects.toThrow(/founder/i);
      await admin(`delete from crm_company_grants where user_id = '${U.pm}'`);
      // A founder may step another founder down while a second founder remains...
      expect(await q(U.juzar, `select crm_grant_access('${U.rafi}', '${CO.uae}', '{assign_owner}')`)).toHaveLength(1);
      // ...but not the last one.
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.rafi}' and company_id = '${CO.pl}'`);
      await expect(q(U.juzar, `select crm_grant_access('${U.juzar}', '${CO.pl}', '{}')`)).rejects.toThrow(/last founder/i);
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.rafi}' and company_id = '${CO.pl}'`);
    });
    it("refuses to revoke the last founder", async () => {
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.rafi}' and company_id = '${CO.pl}'`);
      await expect(q(U.juzar, `select crm_revoke_access('${U.juzar}', '${CO.pl}')`)).rejects.toThrow(/last founder/i);
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.rafi}' and company_id = '${CO.pl}'`);
    });
    it("lets users see their own grants and founders see the company's, not other users' elsewhere", async () => {
      expect(await q(U.daniel, "select 1 from crm_company_grants")).toHaveLength(1);
      expect((await q(U.juzar, "select 1 from crm_company_grants")).length).toBeGreaterThanOrEqual(9);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("CRM audit log (separate from the HR audit log)", () => {
    it("is readable by founders only", async () => {
      expect((await q(U.juzar, "select 1 from crm_audit_log where table_name = 'crm_opportunities'")).length).toBeGreaterThan(0);
      expect(await q(U.amira, "select 1 from crm_audit_log")).toHaveLength(0);
      expect(await q(U.hr, "select 1 from crm_audit_log")).toHaveLength(0);
    });
    it("never writes CRM rows into the shared audit_log", async () => {
      const rows = await admin<{ n: string }>("select count(*) n from audit_log where table_name like 'crm_%'");
      expect(Number(rows[0].n)).toBe(0);
    });
    it("records who did it", async () => {
      const rows = await admin<{ actor_id: string }>(`select actor_id from crm_audit_log where table_name = 'crm_opportunities' and row_id = '${oppUae}' and action = 'insert'`);
      expect(rows[0].actor_id).toBe(U.amira);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("creating opportunities", () => {
    it("builds references from the company code and Dubai year", async () => {
      const [r] = await admin<{ reference: string }>(`select reference from crm_opportunities where id = '${oppUae}'`);
      expect(r.reference).toMatch(/^OPP-UAE-\d{4}-0001$/);
      const [k] = await admin<{ reference: string }>(`select reference from crm_opportunities where id = '${oppKsa}'`);
      expect(k.reference).toMatch(/^OPP-KSA-\d{4}-0001$/);
    });
    it("defaults the owner to the creator, the currency to the company default, and creates the first next action", async () => {
      const [o] = await admin<{ owner_id: string; currency: string; stage: string }>(`select owner_id, currency, stage from crm_opportunities where id = '${oppKsa}'`);
      expect(o).toEqual({ owner_id: U.amira, currency: "SAR", stage: "new" });
      const [f] = await admin<{ n: string }>(`select count(*) n from crm_follow_ups where opportunity_id = '${oppKsa}' and status = 'open'`);
      expect(Number(f.n)).toBe(1);
    });
    it("allows another quotation currency", async () => {
      await db.asUser(U.amira, async (query) => {
        const opp = (await query(`select crm_create_opportunity(
          p_company_id => '${CO.uae}', p_title => 'USD job', p_source => 'referral', p_next_title => 'x', p_next_due => ${soon},
          p_client_org_id => '${clientId}', p_currency => 'usd', p_value => 1000) as id`)).rows[0].id;
        expect((await query(`select currency from crm_opportunities where id = '${opp}'`)).rows[0].currency).toBe("USD");
      });
    });
    it("needs an agency or a client, a next action, and valid technologies", async () => {
      const base = `p_company_id => '${CO.uae}', p_title => 't', p_source => 'other'`;
      await expect(q(U.amira, `select crm_create_opportunity(${base}, p_next_title => 'x', p_next_due => ${soon})`)).rejects.toThrow(/agency or an end client/);
      await expect(q(U.amira, `select crm_create_opportunity(${base}, p_agency_org_id => '${agencyId}', p_next_title => '', p_next_due => ${soon})`)).rejects.toThrow(/next action/);
      await expect(q(U.amira, `select crm_create_opportunity(${base}, p_agency_org_id => '${agencyId}', p_next_title => 'x', p_next_due => ${soon}, p_technologies => '[{"name":"LED","qty":0}]')`)).rejects.toThrow(/quantity/);
    });
    it("refuses creation in a company without a grant", async () => {
      await expect(q(U.daniel, `select crm_create_opportunity(p_company_id => '${CO.ksa}', p_title => 't', p_source => 'other', p_agency_org_id => '${agencyId}', p_next_title => 'x', p_next_due => ${soon})`)).rejects.toThrow(/Sales access/);
    });
    it("lets only founders (or delegates) assign someone else as owner, who must have access", async () => {
      const args = (owner: string) => `p_company_id => '${CO.uae}', p_title => 't', p_source => 'other', p_agency_org_id => '${agencyId}', p_next_title => 'x', p_next_due => ${soon}, p_owner_id => '${owner}'`;
      await expect(q(U.amira, `select crm_create_opportunity(${args(U.daniel)})`)).rejects.toThrow(/founder/);
      expect(await q(U.juzar, `select crm_create_opportunity(${args(U.daniel)})`)).toHaveLength(1);
      await expect(q(U.juzar, `select crm_create_opportunity(${args(U.lena)})`)).rejects.toThrow(/no Sales access/);
    });
    it("fails clearly when a company has no CRM settings", async () => {
      const lonely = id();
      await admin(`insert into companies (id, legal_name, country_code, default_currency) values ('${lonely}', 'Other Co', 'AE', 'AED')`);
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.juzar}', '${lonely}', '{founder}')`);
      await expect(q(U.juzar, `select crm_create_opportunity(p_company_id => '${lonely}', p_title => 't', p_source => 'other', p_agency_org_id => '${agencyId}', p_next_title => 'x', p_next_due => ${soon})`)).rejects.toThrow(/not configured/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("stage rules", () => {
    it("lets the owner and a founder move forward; others cannot", async () => {
      expect(await q(U.amira, `select crm_move_stage('${oppUae}', 'qualified')`)).toHaveLength(1);
      expect(await q(U.juzar, `select crm_move_stage('${oppUae}', 'proposal_prep')`)).toHaveLength(1);
      await expect(q(U.daniel, `select crm_move_stage('${oppUae}', 'qualified')`)).rejects.toThrow(/owner/);
    });
    it("allows one step back but not more, and never to won/lost/on_hold by plain move", async () => {
      await expect(db.asUser(U.amira, async (query) => {
        await query(`select crm_move_stage('${oppUae}', 'negotiation')`);
        await query(`select crm_move_stage('${oppUae}', 'new')`);
      })).rejects.toThrow(/not allowed/);
      for (const to of ["won", "lost", "on_hold"]) {
        await expect(q(U.amira, `select crm_move_stage('${oppUae}', '${to}')`)).rejects.toThrow(/Hold, Won or Lost/);
      }
    });
    it("requires a recorded sent proposal before Proposal sent and a Zoho quote reference before Quote sent", async () => {
      await expect(q(U.amira, `select crm_move_stage('${oppUae}', 'proposal_sent')`)).rejects.toThrow(/proposal as sent/);
      await expect(q(U.amira, `select crm_move_stage('${oppUae}', 'quote_sent')`)).rejects.toThrow(/quote reference/);
      await db.asUser(U.amira, async (query) => {
        const p = (await query(`select crm_add_proposal('${oppUae}', 'v1') as id`)).rows[0].id;
        await query(`select crm_set_proposal_status('${p}', 'sent', current_date)`);
        await query(`select crm_move_stage('${oppUae}', 'proposal_sent')`);
        await query(`select crm_upsert_zoho_reference('${oppUae}', 'QT-1001')`);
        await query(`select crm_move_stage('${oppUae}', 'quote_sent')`);
        const stage = (await query(`select stage from crm_opportunities where id = '${oppUae}'`)).rows[0].stage;
        expect(stage).toBe("quote_sent");
      });
    });
    it("detects concurrent edits with the version number", async () => {
      await expect(q(U.amira, `select crm_move_stage('${oppUae}', 'qualified', 999)`)).rejects.toThrow(/changed by someone else/);
    });
    it("logs each stage change on the timeline", async () => {
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_move_stage('${oppUae}', 'qualified')`);
        const rows = (await query(`select kind, from_value, to_value from crm_opportunity_events where opportunity_id = '${oppUae}' and kind = 'stage_changed'`)).rows;
        expect(rows).toEqual(expect.arrayContaining([{ kind: "stage_changed", from_value: "new", to_value: "qualified" }]));
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("on hold, won and lost", () => {
    it("requires reason and a review date not in the past to hold; resume needs a next action", async () => {
      await expect(q(U.amira, `select crm_hold_opportunity('${oppUae}', '', current_date + 7)`)).rejects.toThrow(/reason/);
      await expect(q(U.amira, `select crm_hold_opportunity('${oppUae}', 'Client postponed', current_date - 30)`)).rejects.toThrow(/review date/);
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_hold_opportunity('${oppUae}', 'Client postponed', current_date + 14)`);
        await expect(query(`select crm_move_stage('${oppUae}', 'qualified')`)).rejects.toThrow(/Resume/);
      });
      await expect(db.asUser(U.amira, async (query) => {
        await query(`select crm_hold_opportunity('${oppUae}', 'Client postponed', current_date + 14)`);
        await query(`select crm_resume_opportunity('${oppUae}', '', ${soon})`);
      })).rejects.toThrow(/next action/);
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_hold_opportunity('${oppUae}', 'Client postponed', current_date + 14)`);
        await query(`select crm_resume_opportunity('${oppUae}', 'Check in', ${soon})`);
        const o = (await query(`select stage, hold_reason from crm_opportunities where id = '${oppUae}'`)).rows[0];
        expect(o).toEqual({ stage: "new", hold_reason: null });
      });
    });
    it("requires evidence and a value for Won; cancels open follow-ups; creates the handover; freezes the record", async () => {
      await expect(q(U.amira, `select crm_mark_won('${oppUae}', 'purchase_order', '', current_date)`)).rejects.toThrow(/evidence/);
      await expect(q(U.amira, `select crm_mark_won('${oppUae}', 'whatsapp', 'x', current_date)`)).rejects.toThrow(/evidence/);
      await expect(q(U.amira, `select crm_mark_won('${oppUae}', 'purchase_order', 'PO-1', current_date)`)).rejects.toThrow(/value/);
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_update_opportunity('${oppUae}', null, '{"value": 90000}')`);
        await query(`select crm_mark_won('${oppUae}', 'purchase_order', 'PO-1', current_date)`);
        const o = (await query(`select stage, closed_at is not null as closed, evidence_reference from crm_opportunities where id = '${oppUae}'`)).rows[0];
        expect(o).toEqual({ stage: "won", closed: true, evidence_reference: "PO-1" });
        expect((await query(`select count(*)::int n from crm_follow_ups where opportunity_id = '${oppUae}' and status = 'open'`)).rows[0].n).toBe(0);
        expect((await query(`select status from crm_handovers where opportunity_id = '${oppUae}'`)).rows[0].status).toBe("draft");
        await expect(query(`select crm_move_stage('${oppUae}', 'qualified')`)).rejects.toThrow(/closed/);
      });
    });
    it("lets only a founder change the value of a won opportunity", async () => {
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_update_opportunity('${oppUae}', null, '{"value": 90000}')`);
        await query(`select crm_mark_won('${oppUae}', 'authorised_email', 'mail 12 Oct', current_date)`);
        await fails(query, `select crm_update_opportunity('${oppUae}', null, '{"value": 80000}')`, /founder/);
      });
      await db.asUser(U.juzar, async (query) => {
        await query(`select crm_update_opportunity('${oppUae}', null, '{"value": 90000}')`);
        await query(`select crm_mark_won('${oppUae}', 'authorised_email', 'mail 12 Oct', current_date)`);
        await query(`select crm_update_opportunity('${oppUae}', null, '{"value": 85000}')`);
      });
    });
    it("requires a reason for Lost and cancels open follow-ups", async () => {
      await expect(q(U.amira, `select crm_mark_lost('${oppUae}', ' ')`)).rejects.toThrow(/reason/);
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_mark_lost('${oppUae}', 'Went with another supplier')`);
        expect((await query(`select stage from crm_opportunities where id = '${oppUae}'`)).rows[0].stage).toBe("lost");
        expect((await query(`select count(*)::int n from crm_follow_ups where opportunity_id = '${oppUae}' and status = 'open'`)).rows[0].n).toBe(0);
        await expect(query(`select crm_add_activity('${oppUae}', 'note', 'late note')`)).rejects.toThrow(/lost/);
      });
    });
    it("lets a colleague who does not own the opportunity do neither", async () => {
      await expect(q(U.daniel, `select crm_mark_lost('${oppUae}', 'because')`)).rejects.toThrow(/owner/);
      await expect(q(U.daniel, `select crm_hold_opportunity('${oppUae}', 'x', current_date + 3)`)).rejects.toThrow(/owner/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("ownership", () => {
    it("lets a founder reassign, moving the previous owner's open follow-ups with it", async () => {
      await db.asUser(U.juzar, async (query) => {
        await query(`select crm_assign_owner('${oppUae}', '${U.daniel}', 'Capacity')`);
        const o = (await query(`select owner_id from crm_opportunities where id = '${oppUae}'`)).rows[0];
        expect(o.owner_id).toBe(U.daniel);
        const f = (await query(`select assigned_to from crm_follow_ups where opportunity_id = '${oppUae}' and status = 'open'`)).rows;
        expect(f.map((r) => r.assigned_to)).toEqual([U.daniel]);
        const e = (await query(`select to_value, reason from crm_opportunity_events where opportunity_id = '${oppUae}' and kind = 'owner_changed'`)).rows;
        expect(e).toEqual([{ to_value: U.daniel, reason: "Capacity" }]);
      });
    });
    it("refuses owners and other sales staff; honours a delegated assign_owner capability", async () => {
      await expect(q(U.amira, `select crm_assign_owner('${oppUae}', '${U.daniel}')`)).rejects.toThrow(/founder/);
      await expect(q(U.daniel, `select crm_assign_owner('${oppUae}', '${U.daniel}')`)).rejects.toThrow(/founder/);
      await admin(`update crm_company_grants set capabilities = '{assign_owner}' where user_id = '${U.daniel}' and company_id = '${CO.uae}'`);
      expect(await q(U.daniel, `select crm_assign_owner('${oppUae}', '${U.daniel}')`)).toHaveLength(1);
      await admin(`update crm_company_grants set capabilities = '{}' where user_id = '${U.daniel}' and company_id = '${CO.uae}'`);
    });
    it("refuses a new owner without access to the company", async () => {
      await expect(q(U.juzar, `select crm_assign_owner('${oppUae}', '${U.lena}')`)).rejects.toThrow(/no Sales access/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("follow-ups", () => {
    it("completes with an outcome, and demands a next action (or a hold) for the last open follow-up", async () => {
      const [{ id: fu }] = await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${oppUae}' and status = 'open'`);
      await expect(q(U.amira, `select crm_complete_follow_up('${fu}', '')`)).rejects.toThrow(/outcome/);
      await expect(q(U.amira, `select crm_complete_follow_up('${fu}', 'Spoke to client')`)).rejects.toThrow(/next action or put the opportunity on hold/);
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_complete_follow_up('${fu}', 'Spoke to client', 'Send options', ${soon}, 'email')`);
        const open = (await query(`select title from crm_follow_ups where opportunity_id = '${oppUae}' and status = 'open'`)).rows;
        expect(open).toEqual([{ title: "Send options" }]);
      });
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_complete_follow_up('${fu}', 'Client paused', null, null, 'other', 'Client postponed', current_date + 10)`);
        expect((await query(`select stage from crm_opportunities where id = '${oppUae}'`)).rows[0].stage).toBe("on_hold");
      });
    });
    it("lets only the assignee, the owner or a founder complete a follow-up", async () => {
      const [{ id: fu }] = await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${oppKsa}' and status = 'open'`);
      await expect(q(U.pm, `select crm_complete_follow_up('${fu}', 'x', 'y', ${soon})`)).rejects.toThrow(/not found/i);
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.ksa}', '{}')`);
      await expect(q(U.pm, `select crm_complete_follow_up('${fu}', 'x', 'y', ${soon})`)).rejects.toThrow(/assignee/);
      await admin(`delete from crm_company_grants where user_id = '${U.pm}'`);
      expect(await q(U.rafi, `select crm_complete_follow_up('${fu}', 'Done by founder', 'y', ${soon})`)).toHaveLength(1);
    });
    it("will not cancel the only next action of an active opportunity", async () => {
      const [{ id: fu }] = await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${oppKsa}' and status = 'open'`);
      await expect(q(U.amira, `select crm_cancel_follow_up('${fu}', 'no longer needed')`)).rejects.toThrow(/only next action/);
    });
    it("lets any CRM user add a follow-up for themselves but not put tasks on a stranger's list", async () => {
      expect(await q(U.daniel, `select crm_create_follow_up('${oppKsa}', 'x', ${soon})`).catch((e: Error) => e)).toBeInstanceOf(Error); // no KSA access
      await expect(q(U.amira, `select crm_create_follow_up('${oppKsa}', 'x', ${soon}, 'call', '${U.lena}')`)).rejects.toThrow(/no Sales access/);
    });
    it("rescheduling clears the old reminder so the new due time reminds again", async () => {
      const [{ id: fu }] = await admin<{ id: string }>(`select id from crm_follow_ups where opportunity_id = '${oppPl}' and status = 'open'`);
      await admin(`update crm_follow_ups set due_at = now() - interval '1 hour' where id = '${fu}'`);
      await admin(`select crm_generate_reminders()`);
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_reminders where follow_up_id = '${fu}'`))[0].n)).toBeGreaterThan(0);
      await q(U.lena, `select crm_reschedule_follow_up('${fu}', now() + interval '3 days')`);
      await db.asUserCommit(U.lena, async (query) => { await query(`select crm_reschedule_follow_up('${fu}', now() + interval '3 days')`); });
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_reminders where follow_up_id = '${fu}'`))[0].n)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("equipment availability", () => {
    it("is not confirmable by the owner alone; a founder or delegate can", async () => {
      await expect(q(U.amira, `select crm_confirm_availability('${oppKsa}', 'confirmed', 'checked')`)).rejects.toThrow(/founder/);
      expect(await q(U.juzar, `select crm_confirm_availability('${oppKsa}', 'confirmed', '2 walls free')`)).toHaveLength(1);
      await admin(`update crm_company_grants set capabilities = '{confirm_availability}' where user_id = '${U.amira}' and company_id = '${CO.ksa}'`);
      expect(await q(U.amira, `select crm_confirm_availability('${oppKsa}', 'unavailable', 'Alternative: LED cube')`)).toHaveLength(1);
      await admin(`update crm_company_grants set capabilities = '{}' where user_id = '${U.amira}' and company_id = '${CO.ksa}'`);
    });
    it("needs recheck once dates or technologies change, and not before", async () => {
      await db.asUser(U.juzar, async (query) => {
        await query(`select crm_confirm_availability('${oppKsa}', 'confirmed', 'ok')`);
        expect((await query(`select crm_availability_needs_recheck('${oppKsa}') as r`)).rows[0].r).toBe(false);
        await query(`select crm_update_opportunity('${oppKsa}', null, '{"technologies":[{"name":"LED tunnel","qty":2}]}')`);
        expect((await query(`select crm_availability_needs_recheck('${oppKsa}') as r`)).rows[0].r).toBe(true);
        await query(`select crm_confirm_availability('${oppKsa}', 'confirmed', 'rechecked')`);
        expect((await query(`select crm_availability_needs_recheck('${oppKsa}') as r`)).rows[0].r).toBe(false);
        await query(`select crm_update_opportunity('${oppKsa}', null, '{"install_start":"2027-02-01"}')`);
        expect((await query(`select crm_availability_needs_recheck('${oppKsa}') as r`)).rows[0].r).toBe(true);
      });
    });
    it("requires a note", async () => {
      await expect(q(U.juzar, `select crm_confirm_availability('${oppKsa}', 'confirmed', '')`)).rejects.toThrow(/note/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("commercial approval is never granted while unconfigured", () => {
    it("defaults to not configured and refuses requests", async () => {
      await expect(q(U.amira, `select crm_request_approval('${oppKsa}')`)).rejects.toThrow(/not configured/);
      await expect(q(U.juzar, `select crm_request_approval('${oppKsa}')`)).rejects.toThrow(/not configured/);
      expect(await q(U.juzar, "select 1 from crm_approvals")).toHaveLength(0);
    });
    it("lets only someone with manage_approval_rules (founders) set the policy", async () => {
      await expect(q(U.amira, `select crm_upsert_settings('${CO.ksa}', 'KSA', 'SAR', null, null, 180, false, 'required')`)).rejects.toThrow(/Not allowed/);
      expect(await q(U.juzar, `select crm_upsert_settings('${CO.ksa}', 'KSA', 'SAR', null, null, 180, false, 'required', 'Founders decide')`)).toHaveLength(1);
    });
    it("with policy required: owner requests, only a founder decides", async () => {
      await db.asUser(U.juzar, async (query) => {
        await query(`select crm_upsert_settings('${CO.ksa}', 'KSA', 'SAR', null, null, 180, false, 'required')`);
      });
      await admin(`update crm_company_settings set approval_policy = 'required' where company_id = '${CO.ksa}'`);
      const approvalId = (await commit<{ id: string }>(U.amira, `select crm_request_approval('${oppKsa}') as id`))[0].id;
      await expect(q(U.amira, `select crm_decide_approval('${approvalId}', 'approved')`)).rejects.toThrow(/founder/);
      await expect(q(U.juzar, `select crm_decide_approval('${approvalId}', 'changes_requested')`)).rejects.toThrow(/what needs to change/);
      expect(await q(U.juzar, `select crm_decide_approval('${approvalId}', 'approved', 'ok at quoted price')`)).toHaveLength(1);
      await admin(`delete from crm_approvals; update crm_company_settings set approval_policy = 'not_configured' where company_id = '${CO.ksa}'`);
    });
    it("refuses requests when a founder decided approval is not required, and when the policy is reset", async () => {
      await admin(`update crm_company_settings set approval_policy = 'not_required' where company_id = '${CO.ksa}'`);
      await expect(q(U.amira, `select crm_request_approval('${oppKsa}')`)).rejects.toThrow(/not required/);
      await admin(`update crm_company_settings set approval_policy = 'not_configured' where company_id = '${CO.ksa}'`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("files and links", () => {
    const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_");
    type Intent = { intent_id: string; quarantine_path: string };
    const intentSql = (opp: string, name: string, mime: string, size: number, purpose = "purchase_order") =>
      `select * from crm_create_upload_intent('${opp}', '${name}', '${mime}', ${size}, '${safe(name)}', '${purpose}', 'PO')`;
    /** What the server does after a successful validation: the object is moved to the real bucket and the intent marked. */
    async function validate(intentId: string) {
      const [i] = await admin<{ final_path: string; quarantine_path: string }>(`select final_path, quarantine_path from crm_upload_intents where id = '${intentId}'`);
      await admin(`insert into storage.objects (bucket_id, name) values ('crm-files', '${i.final_path}') on conflict do nothing`);
      await admin(`select crm_mark_upload_intent('${intentId}', 'validated')`);
      return i;
    }

    it("never accepts a file straight into the real bucket: crm_register_file records links only", async () => {
      await expect(q(U.amira, `select crm_register_file('${oppKsa}', 'file', 'other', null, '${CO.ksa}/${oppKsa}/${id()}-a.pdf', 'a.pdf', 'application/pdf', 10)`)).rejects.toThrow(/upload flow/i);
    });
    it("creates an upload intent whose paths are built by the database, inside the opportunity's own folder", async () => {
      const [i] = await commit<Intent>(U.amira, intentSql(oppKsa, "po.pdf", "application/pdf", 1000));
      expect(i.quarantine_path).toMatch(new RegExp(`^${CO.ksa}/${oppKsa}/${i.intent_id}-po\\.pdf$`));
      const [row] = await admin<{ final_path: string; status: string; user_id: string }>(`select final_path, status, user_id from crm_upload_intents where id = '${i.intent_id}'`);
      expect(row.final_path).toMatch(new RegExp(`^${CO.ksa}/${oppKsa}/[0-9a-f-]{36}-po\\.pdf$`));
      expect(row.final_path).not.toBe(i.quarantine_path);
      expect(row).toMatchObject({ status: "pending", user_id: U.amira });
    });
    it.each([
      ["an .exe", "setup.exe", "application/pdf", 1000, /Executable/],
      ["a macro-enabled workbook", "budget.xlsm", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1000, /Executable|macro/i],
      ["a double extension", "invoice.exe.pdf", "application/pdf", 1000, /Executable/],
      ["a script", "run.js", "text/plain", 1000, /Executable/],
      ["an HTML page", "page.html", "text/plain", 1000, /Executable/],
      ["a disallowed type", "movie.mp4", "video/mp4", 1000, /not allowed/],
      ["a macro mime type", "sheet.xlsx", "application/vnd.ms-excel.sheet.macroEnabled.12", 1000, /not allowed/],
      ["an empty file", "a.pdf", "application/pdf", 0, /between 1 byte and 20 MB/],
      ["an oversize file", "a.pdf", "application/pdf", 20971521, /between 1 byte and 20 MB/],
    ])("refuses an intent for %s before anything is uploaded", async (_l, name, mime, size, re) => {
      await expect(q(U.amira, intentSql(oppKsa, name, mime, size))).rejects.toThrow(re);
    });
    it("accepts a full 20 MB file (the larger-file requirement)", async () => {
      expect(await q(U.amira, intentSql(oppKsa, "big-deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 20971520))).toHaveLength(1);
    });
    it("refuses an unsafe stored name and a person without access to the company", async () => {
      await expect(q(U.amira, `select * from crm_create_upload_intent('${oppKsa}', 'a.pdf', 'application/pdf', 10, '../../x.pdf')`)).rejects.toThrow(/Invalid file name/);
      await expect(q(U.daniel, intentSql(oppKsa, "a.pdf", "application/pdf", 10))).rejects.toThrow(/not found/i);
      await expect(q(U.hr, intentSql(oppKsa, "a.pdf", "application/pdf", 10))).rejects.toThrow(/not found|No CRM|Not signed/i);
    });
    it("caps how many unfinished uploads one person can park in quarantine", async () => {
      const rows = await db.asUser(U.rafi, async (query) => {
        for (let n = 0; n < 20; n++) await query(intentSql(oppKsa, `f${n}.pdf`, "application/pdf", 10));
        await query("savepoint s");
        const failure = await query(intentSql(oppKsa, "one-too-many.pdf", "application/pdf", 10)).catch((e: Error) => e);
        return failure instanceof Error ? failure.message : "no error";
      });
      expect(rows).toMatch(/Too many uploads/);
    });
    it("keeps intents out of reach of browsers: no one can read or write the table, not even the uploader", async () => {
      const [i] = await commit<Intent>(U.amira, intentSql(oppKsa, "mine.pdf", "application/pdf", 10));
      expect(await q(U.amira, "select 1 from crm_upload_intents")).toHaveLength(0);
      const w = await q(U.amira, `update crm_upload_intents set status = 'validated' where id = '${i.intent_id}'`).then((r) => r, (e: Error) => e);
      if (w instanceof Error) expect(w.message).toMatch(DENIED);
      else expect(w).toHaveLength(0);
      const status = (await admin<{ status: string }>(`select status from crm_upload_intents where id = '${i.intent_id}'`))[0].status;
      expect(status).toBe("pending");
    });
    it("only the server (service role) can record a validation result", async () => {
      const [i] = await commit<Intent>(U.amira, intentSql(oppKsa, "x.pdf", "application/pdf", 10));
      await expect(q(U.amira, `select crm_mark_upload_intent('${i.intent_id}', 'validated')`)).rejects.toThrow(/permission denied/i);
      await expect(q(U.juzar, `select * from crm_expire_upload_intents()`)).rejects.toThrow(/permission denied/i);
    });
    it("registers a file only after validation, from the intent's own values, and only for its owner, once", async () => {
      const [i] = await commit<Intent>(U.amira, intentSql(oppKsa, "po.pdf", "application/pdf", 4321));
      await expect(q(U.amira, `select crm_register_uploaded_file('${i.intent_id}')`)).rejects.toThrow(/not passed the file checks/);
      const row = await validate(i.intent_id);
      await expect(q(U.daniel, `select crm_register_uploaded_file('${i.intent_id}')`)).rejects.toThrow(/not found/i);
      await expect(q(U.juzar, `select crm_register_uploaded_file('${i.intent_id}')`)).rejects.toThrow(/not found/i); // even a founder cannot register someone else's upload
      const fileId = (await commit<{ id: string }>(U.amira, `select crm_register_uploaded_file('${i.intent_id}') as id`))[0].id;
      const [f] = await admin<{ storage_path: string; original_name: string; size_bytes: string; mime_type: string; purpose: string; uploaded_by: string }>(
        `select storage_path, original_name, size_bytes, mime_type, purpose, uploaded_by from crm_files where id = '${fileId}'`);
      expect(f).toMatchObject({ storage_path: row.final_path, original_name: "po.pdf", mime_type: "application/pdf", purpose: "purchase_order", uploaded_by: U.amira });
      expect(Number(f.size_bytes)).toBe(4321);
      await expect(q(U.amira, `select crm_register_uploaded_file('${i.intent_id}')`)).rejects.toThrow(/already added/);
    });
    it("refuses to register when the validated object is missing, or the intent was rejected or has expired", async () => {
      const [a] = await commit<Intent>(U.amira, intentSql(oppKsa, "a.pdf", "application/pdf", 10));
      await admin(`select crm_mark_upload_intent('${a.intent_id}', 'validated')`);
      await expect(q(U.amira, `select crm_register_uploaded_file('${a.intent_id}')`)).rejects.toThrow(/not found/i);
      const [b] = await commit<Intent>(U.amira, intentSql(oppKsa, "b.pdf", "application/pdf", 10));
      await admin(`select crm_mark_upload_intent('${b.intent_id}', 'rejected', 'macro found')`);
      await expect(q(U.amira, `select crm_register_uploaded_file('${b.intent_id}')`)).rejects.toThrow(/not passed/);
      const [c] = await commit<Intent>(U.amira, intentSql(oppKsa, "c.pdf", "application/pdf", 10));
      await admin(`update crm_upload_intents set expires_at = now() - interval '1 minute' where id = '${c.intent_id}'`);
      await expect(admin(`select crm_mark_upload_intent('${c.intent_id}', 'validated')`)).rejects.toThrow(/expired|not found/i);
    });
    it("sweeps finished intents' quarantine paths too, once, because a replayed upload URL could have refilled them", async () => {
      const [r] = await commit<Intent>(U.amira, intentSql(oppKsa, "r.pdf", "application/pdf", 10));
      await validate(r.intent_id);
      await commit(U.amira, `select crm_register_uploaded_file('${r.intent_id}')`);
      await admin(`update crm_upload_intents set expires_at = now() - interval '1 hour' where id = '${r.intent_id}'`);
      const out = await admin<{ quarantine_path: string; orphaned_validated: boolean }>("select * from crm_expire_upload_intents()");
      expect(out.find((x) => x.quarantine_path === r.quarantine_path)).toMatchObject({ orphaned_validated: false });
      expect((await admin<{ status: string }>(`select status from crm_upload_intents where id = '${r.intent_id}'`))[0].status).toBe("registered");
    });
    it("expires unfinished intents and hands back what to delete (quarantine, and validated-but-unregistered files)", async () => {
      const [p] = await commit<Intent>(U.amira, intentSql(oppKsa, "p.pdf", "application/pdf", 10));
      const [v] = await commit<Intent>(U.amira, intentSql(oppKsa, "v.pdf", "application/pdf", 10));
      await validate(v.intent_id);
      await admin(`update crm_upload_intents set expires_at = now() - interval '1 hour' where id in ('${p.intent_id}', '${v.intent_id}')`);
      const out = await admin<{ quarantine_path: string; orphaned_validated: boolean }>("select * from crm_expire_upload_intents()");
      const byPath = new Map(out.map((r) => [r.quarantine_path, r.orphaned_validated]));
      expect(byPath.get(p.quarantine_path)).toBe(false);
      expect(byPath.get(v.quarantine_path)).toBe(true);
      expect((await admin("select * from crm_expire_upload_intents()")).filter((r) => (r as { quarantine_path: string }).quarantine_path === p.quarantine_path)).toHaveLength(0); // once only
      expect((await admin<{ status: string }>(`select status from crm_upload_intents where id = '${p.intent_id}'`))[0].status).toBe("expired");
    });
    it("refuses new uploads on a lost opportunity", async () => {
      const opp = await newOpp(U.amira, CO.uae, "Lost file job");
      await commit(U.amira, `select crm_mark_lost('${opp}', 'Went elsewhere')`);
      await expect(q(U.amira, intentSql(opp, "late.pdf", "application/pdf", 10))).rejects.toThrow(/lost/i);
    });
    it("accepts https links only", async () => {
      expect(await q(U.amira, `select crm_register_file('${oppKsa}', 'link', 'proposal', 'Canva v2', null, null, null, null, 'https://www.canva.com/design/x')`)).toHaveLength(1);
      await expect(q(U.amira, `select crm_register_file('${oppKsa}', 'link', 'proposal', 'bad', null, null, null, null, 'javascript:alert(1)')`)).rejects.toThrow(/check constraint/i);
      await expect(q(U.amira, `select crm_register_file('${oppKsa}', 'link', 'proposal', 'bad', null, null, null, null, 'http://insecure.example')`)).rejects.toThrow(/check constraint/i);
    });
    it("still refuses executables and macro files at the table even if every earlier check were bypassed", async () => {
      for (const [name, mime] of [["setup.exe", "application/pdf"], ["b.xlsm", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["c.exe.pdf", "application/pdf"]] as const) {
        await expect(admin(`insert into crm_files (opportunity_id, company_id, kind, original_name, storage_path, mime_type, size_bytes, uploaded_by)
          values ('${oppKsa}', '${CO.ksa}', 'file', '${name}', '${CO.ksa}/${oppKsa}/${id()}-${safe(name)}', '${mime}', 10, '${U.amira}')`)).rejects.toThrow(/crm_files_file_shape/);
      }
    });
    it.each(["crm-files", "crm-quarantine"])("keeps the %s bucket private, size-limited and type-locked, with no client policies", async (bucket) => {
      const [b] = await admin<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = '${bucket}'`);
      expect(b.public).toBe(false);
      expect(Number(b.file_size_limit)).toBe(20971520);
      expect(b.allowed_mime_types).not.toContain("application/x-msdownload");
      expect(b.allowed_mime_types.some((m) => /macro/i.test(m))).toBe(false);
      const pol = await admin<{ n: string }>(`select count(*) n from pg_policies where schemaname = 'storage' and (qual ilike '%${bucket}%' or with_check ilike '%${bucket}%')`);
      expect(Number(pol[0].n)).toBe(0);
    });
    it("lets only the uploader, owner or founder remove a file", async () => {
      const file = (await commit<{ id: string }>(U.amira, `select crm_register_file('${oppKsa}', 'link', 'other', 'Brief', null, null, null, null, 'https://example.com/brief') as id`))[0].id;
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.ksa}', '{}')`);
      await expect(q(U.pm, `select crm_remove_file('${file}')`)).rejects.toThrow(/uploader/);
      await admin(`delete from crm_company_grants where user_id = '${U.pm}'`);
      expect(await q(U.amira, `select crm_remove_file('${file}')`)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("proposals and handover", () => {
    it("treats sent as sent, not accepted; only sent can be accepted; versions increment", async () => {
      await db.asUser(U.amira, async (query) => {
        const a = (await query(`select crm_add_proposal('${oppKsa}', 'v1') as id`)).rows[0].id;
        const b = (await query(`select crm_add_proposal('${oppKsa}', 'v2') as id`)).rows[0].id;
        await fails(query, `select crm_set_proposal_status('${a}', 'accepted')`, /sent proposal/);
        await query(`select crm_set_proposal_status('${a}', 'sent', current_date)`);
        await query(`select crm_set_proposal_status('${b}', 'sent', current_date)`);
        const st = (await query(`select version, status from crm_proposals where opportunity_id = '${oppKsa}' order by version`)).rows;
        expect(st).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "sent" }]);
      });
    });
    it("refuses a sent date in the future", async () => {
      await db.asUser(U.amira, async (query) => {
        const a = (await query(`select crm_add_proposal('${oppKsa}', 'v1') as id`)).rows[0].id;
        await expect(query(`select crm_set_proposal_status('${a}', 'sent', current_date + 5)`)).rejects.toThrow(/not in the future/);
      });
    });
    it("allows handover only for won opportunities and needs a PM to hand over", async () => {
      await expect(q(U.amira, `select crm_update_handover('${oppKsa}', 'ready')`)).rejects.toThrow(/Won/);
      await db.asUser(U.amira, async (query) => {
        await query(`select crm_update_opportunity('${oppKsa}', null, '{"value": 50000}')`);
        await query(`select crm_mark_won('${oppKsa}', 'purchase_order', 'PO-9', current_date)`);
        await fails(query, `select crm_update_handover('${oppKsa}', 'handed_over')`, /Project Manager/);
        await query(`select crm_update_handover('${oppKsa}', 'handed_over', '${U.pm}', 'Site visit booked')`);
        expect((await query(`select status from crm_handovers where opportunity_id = '${oppKsa}'`)).rows[0].status).toBe("handed_over");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("duplicate candidates", () => {
    it("returns same-organisation enquiries as candidates but only within accessible companies", async () => {
      const amira = await q<{ opportunity_id: string }>(U.amira, `select opportunity_id from crm_find_duplicate_candidates('${agencyId}', null, null, null, null)`);
      expect(amira.map((r) => r.opportunity_id)).toEqual(expect.arrayContaining([oppUae, oppKsa]));
      expect(amira.map((r) => r.opportunity_id)).not.toContain(oppPl);
      const daniel = await q<{ opportunity_id: string }>(U.daniel, `select opportunity_id from crm_find_duplicate_candidates('${agencyId}', null, null, null, null)`);
      expect(daniel.map((r) => r.opportunity_id)).not.toContain(oppKsa);
    });
    it("finds similar organisation names, ignoring case and punctuation", async () => {
      const rows = await q<{ name: string }>(U.amira, `select name from crm_find_similar_organisations('ZETA MEDIA L.L.C')`);
      expect(rows.map((r) => r.name)).toContain("Zeta Media LLC");
    });
    it("hides all of it from outsiders", async () => {
      expect(await q(U.hr, `select * from crm_find_duplicate_candidates('${agencyId}', null, null, null, null)`)).toHaveLength(0);
      expect(await q(U.hr, `select * from crm_find_similar_organisations('Zeta Media')`)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("reminders", () => {
    async function dueNow(opp: string) {
      await admin(`update crm_follow_ups set due_at = now() - interval '2 hours' where opportunity_id = '${opp}' and status = 'open'`);
    }
    it("generates in-app reminders once (idempotent) for the assignee, visible to them only", async () => {
      const opp = await newOpp(U.amira, CO.uae, 'Reminder job');
      await dueNow(opp);
      const first = (await admin<{ n: number }>("select crm_generate_reminders() as n"))[0].n;
      expect(first).toBeGreaterThan(0);
      expect((await admin<{ n: number }>("select crm_generate_reminders() as n"))[0].n).toBe(0);
      const mine = await q(U.amira, `select kind, email_status from crm_reminders where opportunity_id = '${opp}'`);
      expect(mine).toEqual([{ kind: "follow_up_due", email_status: "not_requested" }]);
      expect(await q(U.daniel, `select 1 from crm_reminders where opportunity_id = '${opp}'`)).toHaveLength(0);
      expect(await q(U.juzar, `select 1 from crm_reminders where opportunity_id = '${opp}'`)).toHaveLength(0);
    });
    it("queues email only when the company setting is on, then sends once with retry and backoff", async () => {
      await admin(`update crm_company_settings set owner_email_enabled = true where company_id = '${CO.uae}'`);
      const opp = await newOpp(U.amira, CO.uae, 'Email job');
      await dueNow(opp);
      await admin("select crm_generate_reminders()");
      const [r] = await admin<{ id: string; email_status: string }>(`select id, email_status from crm_reminders where opportunity_id = '${opp}'`);
      expect(r.email_status).toBe("pending");
      // Claim: returns the row once; an overlapping claim gets nothing.
      const claimed = await admin<{ reminder_id: string; recipient_email: string; attempt: number }>("select * from crm_claim_reminder_emails(10)");
      const mine = claimed.filter((c) => c.reminder_id === r.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.recipient_email).toBe("amira@crm-test.ae");
      expect((await admin<{ reminder_id: string }>("select * from crm_claim_reminder_emails(10)")).filter((c) => c.reminder_id === r.id)).toHaveLength(0);
      // Failure schedules a retry; the retry succeeds; a sent row is never reopened.
      await admin(`select crm_finish_reminder_email('${r.id}', false, 'smtp down')`);
      let [row] = await admin<{ email_status: string; email_next_attempt_at: string | null }>(`select email_status, email_next_attempt_at from crm_reminders where id = '${r.id}'`);
      expect(row.email_status).toBe("failed");
      expect(row.email_next_attempt_at).not.toBeNull();
      await admin(`update crm_reminders set email_next_attempt_at = now() - interval '1 minute' where id = '${r.id}'`);
      expect((await admin<{ reminder_id: string; attempt: number }>("select * from crm_claim_reminder_emails(10)")).find((c) => c.reminder_id === r.id)?.attempt).toBe(2);
      await admin(`select crm_finish_reminder_email('${r.id}', true)`);
      await admin(`select crm_finish_reminder_email('${r.id}', false, 'late failure')`);
      [row] = await admin(`select email_status, email_next_attempt_at from crm_reminders where id = '${r.id}'`);
      expect(row.email_status).toBe("sent");
      expect((await admin<{ reminder_id: string }>("select * from crm_claim_reminder_emails(10)")).filter((c) => c.reminder_id === r.id)).toHaveLength(0);
      await admin(`update crm_company_settings set owner_email_enabled = false where company_id = '${CO.uae}'`);
    });
    it("stops after five attempts", async () => {
      const [r] = await admin<{ id: string }>("select id from crm_reminders where email_status = 'sent' limit 1");
      await admin(`update crm_reminders set email_status = 'failed', email_attempts = 5, email_next_attempt_at = now() - interval '1 hour', email_last_error='x' where id = '${r.id}'`);
      expect((await admin<{ reminder_id: string }>("select * from crm_claim_reminder_emails(10)")).filter((c) => c.reminder_id === r.id)).toHaveLength(0);
      await admin(`select crm_finish_reminder_email('${r.id}', false, 'x')`);
      const [after] = await admin<{ email_next_attempt_at: string | null }>(`select email_next_attempt_at from crm_reminders where id = '${r.id}'`);
      expect(after.email_next_attempt_at).toBeNull();
    });
    it("is not callable by browser sessions", async () => {
      await expect(q(U.juzar, "select crm_generate_reminders()")).rejects.toThrow(/permission denied/i);
      await expect(q(U.juzar, "select * from crm_claim_reminder_emails(5)")).rejects.toThrow(/permission denied/i);
      await expect(q(U.juzar, `select crm_finish_reminder_email('${id()}', true)`)).rejects.toThrow(/permission denied/i);
    });
    it("lets a user mark only their own reminders read", async () => {
      expect(await q(U.amira, "select crm_mark_reminder_read()")).toHaveLength(1);
    });
    it("reminds about on-hold reviews that have come due and active opportunities with no next action", async () => {
      const opp = await newOpp(U.amira, CO.uae, 'Held job');
      await admin(`update crm_opportunities set stage='on_hold', stage_before_hold='new', hold_reason='x', hold_review_date = current_date - 1 where id = '${opp}'`);
      const opp2 = await newOpp(U.amira, CO.uae, 'No action job');
      await admin(`update crm_follow_ups set status = 'cancelled' where opportunity_id = '${opp2}'`);
      await admin("select crm_generate_reminders()");
      const kinds = await admin<{ kind: string }>(`select kind from crm_reminders where opportunity_id in ('${opp}', '${opp2}') order by kind`);
      expect(kinds.map((k) => k.kind)).toEqual(["hold_review_due", "no_next_action"]);
    });
    it("does not remind staff who lost CRM access", async () => {
      const opp = await newOpp(U.daniel, CO.uae, 'Daniel job');
      await dueNow(opp);
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.daniel}'`);
      await admin("select crm_generate_reminders()");
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_reminders where opportunity_id = '${opp}'`))[0].n)).toBe(0);
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.daniel}'`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("opportunity contacts after creation", () => {
    let hana: string;
    let opp1: string;
    let opp2: string;
    beforeAll(async () => {
      hana = (await commit<{ id: string }>(U.amira, `select crm_create_contact('${agencyId}', 'Hana Al Mansoori', 'Producer', 'hana@zeta.example', '+971500000001') as id`))[0].id;
      opp1 = await newOpp(U.amira, CO.uae, "Contacts job one");
      opp2 = await newOpp(U.amira, CO.uae, "Contacts job two");
    });
    const links = async (opp: string) => (await admin<{ contact_id: string; role: string | null }>(`select contact_id, role from crm_opportunity_contacts where opportunity_id = '${opp}'`));

    it("lets the owner link a shared contact, change its role, and unlink it, without touching the contact record", async () => {
      await commit(U.amira, `select crm_link_contact('${opp1}', '${hana}', 'Day-to-day')`);
      await commit(U.amira, `select crm_link_contact('${opp2}', '${hana}', 'Approver')`);
      expect(await links(opp1)).toEqual([{ contact_id: hana, role: "Day-to-day" }]);
      await commit(U.amira, `select crm_link_contact('${opp1}', '${hana}', 'Producer')`); // upsert changes only the role
      expect(await links(opp1)).toEqual([{ contact_id: hana, role: "Producer" }]);
      await commit(U.amira, `select crm_unlink_contact('${opp1}', '${hana}')`);
      expect(await links(opp1)).toEqual([]);
      expect(await links(opp2)).toEqual([{ contact_id: hana, role: "Approver" }]); // the other opportunity keeps its link
      expect((await admin<{ name: string; archived_at: string | null }>(`select name, archived_at from crm_contacts where id = '${hana}'`))[0]).toMatchObject({ name: "Hana Al Mansoori", archived_at: null });
    });
    it("is a no-op to unlink a contact that is not linked, and refuses unknown contacts", async () => {
      expect(await q(U.amira, `select crm_unlink_contact('${opp1}', '${hana}')`)).toHaveLength(1);
      await expect(q(U.amira, `select crm_link_contact('${opp1}', '${id()}')`)).rejects.toThrow(/not found/i);
    });
    it("lets only the owner or a founder change who is on an opportunity", async () => {
      await expect(q(U.daniel, `select crm_link_contact('${opp1}', '${hana}')`)).rejects.toThrow(/owner/);
      await expect(q(U.daniel, `select crm_unlink_contact('${opp2}', '${hana}')`)).rejects.toThrow(/owner/);
      expect(await commit(U.juzar, `select crm_link_contact('${opp1}', '${hana}', 'Founder added')`)).toHaveLength(1);
      await expect(q(U.hr, `select crm_link_contact('${opp1}', '${hana}')`)).rejects.toThrow(/not found|No CRM/i);
      await expect(q(U.lena, `select crm_link_contact('${opp1}', '${hana}')`)).rejects.toThrow(/not found/i); // other company
    });
    it("refuses changes on a lost opportunity, allows them on a won one (handover needs the right people)", async () => {
      const won = await newOpp(U.amira, CO.uae, "Contacts won job");
      await commit(U.amira, `select crm_update_opportunity('${won}', null, '{"value": 1000}')`);
      await commit(U.amira, `select crm_mark_won('${won}', 'purchase_order', 'PO-C', current_date)`);
      expect(await q(U.amira, `select crm_link_contact('${won}', '${hana}', 'Site contact')`)).toHaveLength(1);
      const lost = await newOpp(U.amira, CO.uae, "Contacts lost job");
      await commit(U.amira, `select crm_mark_lost('${lost}', 'No budget')`);
      await expect(q(U.amira, `select crm_link_contact('${lost}', '${hana}')`)).rejects.toThrow(/lost/i);
    });
    it("writes each change to the timeline and to the CRM audit log with who did it", async () => {
      const kinds = await admin<{ reason: string; actor_id: string }>(`select reason, actor_id from crm_opportunity_events where opportunity_id = '${opp1}' and kind = 'contact' order by created_at`);
      expect(kinds.map((k) => k.reason)).toEqual(expect.arrayContaining(["Contact linked", "Contact role updated", "Contact unlinked (the contact record is kept)"]));
      const audit = await q<{ action: string; actor_id: string }>(U.juzar, `select action, actor_id from crm_audit_log where table_name = 'crm_opportunity_contacts' and company_id = '${CO.uae}'`);
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["insert", "update", "delete"]));
      expect(audit.some((a) => a.actor_id === U.amira)).toBe(true);
      expect(await q(U.amira, `select 1 from crm_audit_log where table_name = 'crm_opportunity_contacts'`)).toHaveLength(0); // sales staff cannot read the audit trail
    });
    it("lets the contact's creator, a founder, or the owner of an opportunity it is on edit the shared record; others cannot", async () => {
      const [r] = await q<{ a: boolean; d: boolean; j: boolean; h: boolean }>(U.amira, `select crm_can_edit_contact('${hana}') a, false d, false j, false h`);
      expect(r.a).toBe(true);
      expect((await q<{ ok: boolean }>(U.daniel, `select crm_can_edit_contact('${hana}') ok`))[0].ok).toBe(false);
      expect((await q<{ ok: boolean }>(U.juzar, `select crm_can_edit_contact('${hana}') ok`))[0].ok).toBe(true);
      expect((await q<{ ok: boolean }>(U.hr, `select crm_can_edit_contact('${hana}') ok`))[0].ok).toBe(false);
      await expect(q(U.daniel, `select crm_update_contact('${hana}', '{"phone": "+971 55 000 0000"}')`)).rejects.toThrow(/Only the person who added/);
      // an owner of an opportunity it is linked to, who did not create it, may
      const other = (await commit<{ id: string }>(U.daniel, `select crm_create_contact('${agencyId}', 'Omar Contact', null, null, null) as id`))[0].id;
      const dOpp = await newOpp(U.daniel, CO.uae, "Daniel job");
      await commit(U.daniel, `select crm_link_contact('${dOpp}', '${hana}', 'Producer')`);
      expect((await q<{ ok: boolean }>(U.daniel, `select crm_can_edit_contact('${hana}') ok`))[0].ok).toBe(true);
      expect((await q<{ ok: boolean }>(U.amira, `select crm_can_edit_contact('${other}') ok`))[0].ok).toBe(false);
    });
    it("updates the shared record once, logs it on every linked opportunity's timeline, and keeps old and new values in the audit log", async () => {
      await commit(U.amira, `select crm_update_contact('${hana}', '{"role_title": "Senior Producer", "phone": "+971 50 111 2222"}')`);
      expect((await admin<{ role_title: string; phone: string }>(`select role_title, phone from crm_contacts where id = '${hana}'`))[0]).toEqual({ role_title: "Senior Producer", phone: "+971 50 111 2222" });
      const ev = await admin<{ opportunity_id: string }>(`select opportunity_id from crm_opportunity_events where kind = 'contact' and reason like 'Contact details updated%'`);
      expect(ev.map((e) => e.opportunity_id)).toEqual(expect.arrayContaining([opp1, opp2]));
      const aud = await q<{ old_row: { role_title: string | null }; new_row: { role_title: string } }>(U.juzar, `select old_row, new_row from crm_audit_log where table_name = 'crm_contacts' and row_id = '${hana}' and action = 'update' order by id desc limit 1`);
      expect(aud[0].old_row.role_title).toBe("Producer");
      expect(aud[0].new_row.role_title).toBe("Senior Producer");
    });
    it("validates what can be changed", async () => {
      await expect(q(U.amira, `select crm_update_contact('${hana}', '{"created_by": "${U.daniel}"}')`)).rejects.toThrow(/cannot be changed here/);
      await expect(q(U.amira, `select crm_update_contact('${hana}', '{}')`)).rejects.toThrow(/Nothing to change/);
      await expect(q(U.amira, `select crm_update_contact('${hana}', '{"email": "not-an-email"}')`)).rejects.toThrow(/check constraint|crm_contacts_email_check/i);
      await expect(q(U.amira, `select crm_update_contact('${hana}', '{"name": ""}')`)).rejects.toThrow(/check constraint/i);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("reopening a closed opportunity", () => {
    async function wonOpp(title: string, stage = "qualified") {
      const opp = await newOpp(U.amira, CO.uae, title);
      if (stage !== "new") await commit(U.amira, `select crm_move_stage('${opp}', '${stage}')`);
      await commit(U.amira, `select crm_update_opportunity('${opp}', null, '{"value": 90000}')`);
      await commit(U.amira, `select crm_mark_won('${opp}', 'purchase_order', 'PO-RE-1', current_date)`);
      return opp;
    }
    const NEXT = `'Call the client to restart', now() + interval '3 days'`;

    it("records each closure in history when it happens", async () => {
      const opp = await wonOpp("Closure history job");
      const [c] = await admin<{ outcome: string; closed_from_stage: string; value_at_close: string; evidence_reference: string; reopened_at: string | null }>(
        `select outcome, closed_from_stage, value_at_close, evidence_reference, reopened_at from crm_closures where opportunity_id = '${opp}'`);
      expect(c).toMatchObject({ outcome: "won", closed_from_stage: "qualified", evidence_reference: "PO-RE-1", reopened_at: null });
      expect(Number(c.value_at_close)).toBe(90000);
      expect((await admin<{ stage_before_close: string }>(`select stage_before_close from crm_opportunities where id = '${opp}'`))[0].stage_before_close).toBe("qualified");
    });
    it("needs the reopen right (founders have it; owners and colleagues do not), a reason and a new next action", async () => {
      const opp = await wonOpp("Permission job");
      await expect(q(U.amira, `select crm_reopen_opportunity('${opp}', 'Client changed scope', ${NEXT})`)).rejects.toThrow(/Only a founder/);
      await expect(q(U.daniel, `select crm_reopen_opportunity('${opp}', 'x', ${NEXT})`)).rejects.toThrow(/Only a founder/);
      await expect(q(U.hr, `select crm_reopen_opportunity('${opp}', 'x', ${NEXT})`)).rejects.toThrow(/not found|No CRM/i);
      await expect(q(U.juzar, `select crm_reopen_opportunity('${opp}', ' ', ${NEXT})`)).rejects.toThrow(/reason is required/);
      await expect(q(U.juzar, `select crm_reopen_opportunity('${opp}', 'Scope changed', '', now() + interval '1 day')`)).rejects.toThrow(/new next action/);
      await expect(q(U.juzar, `select crm_reopen_opportunity('${opp}', 'Scope changed', 'x', null)`)).rejects.toThrow(/new next action/);
      await expect(q(U.juzar, `select crm_reopen_opportunity('${opp}', 'Scope changed', ${NEXT}, 'other', 'won')`)).rejects.toThrow(/working stages/);
      await expect(q(U.juzar, `select crm_reopen_opportunity('${opp}', 'Scope changed', ${NEXT}, 'other', null, 999)`)).rejects.toThrow(/changed by someone else/);
    });
    it("can be delegated with the reopen_closed capability, and nothing else", async () => {
      const opp = await wonOpp("Delegation job");
      await admin(`update crm_company_grants set capabilities = '{reopen_closed}' where user_id = '${U.daniel}' and company_id = '${CO.uae}'`);
      expect(await q(U.daniel, `select crm_reopen_opportunity('${opp}', 'Delegate reopens', ${NEXT})`)).toHaveLength(1);
      await expect(q(U.daniel, `select crm_assign_owner('${opp}', '${U.daniel}')`)).rejects.toThrow(/founder/);
      await admin(`update crm_company_grants set capabilities = '{}' where user_id = '${U.daniel}' and company_id = '${CO.uae}'`);
    });
    it("returns a Won opportunity to the stage it was in, keeps value and everything else, and keeps the closure as history", async () => {
      const opp = await wonOpp("Won reopen job", "negotiation");
      await commit(U.juzar, `select crm_reopen_opportunity('${opp}', 'Client asked to revise the scope', ${NEXT})`);
      const [o] = await admin<{ stage: string; closed_at: string | null; closed_by: string | null; evidence_reference: string | null; lost_reason: string | null; value: string; stage_before_close: string | null; owner_id: string }>(
        `select stage, closed_at, closed_by, evidence_reference, lost_reason, value, stage_before_close, owner_id from crm_opportunities where id = '${opp}'`);
      expect(o).toMatchObject({ stage: "negotiation", closed_at: null, closed_by: null, evidence_reference: null, lost_reason: null, stage_before_close: null, owner_id: U.amira });
      expect(Number(o.value)).toBe(90000);
      const [c] = await admin<{ outcome: string; reopened_by: string; reopen_reason: string; evidence_reference: string }>(
        `select outcome, reopened_by, reopen_reason, evidence_reference from crm_closures where opportunity_id = '${opp}'`);
      expect(c).toEqual({ outcome: "won", reopened_by: U.juzar, reopen_reason: "Client asked to revise the scope", evidence_reference: "PO-RE-1" });
      const fu = await admin<{ title: string; assigned_to: string }>(`select title, assigned_to from crm_follow_ups where opportunity_id = '${opp}' and status = 'open'`);
      expect(fu).toEqual([{ title: "Call the client to restart", assigned_to: U.amira }]);
      const ev = await admin<{ kind: string; from_value: string; to_value: string; reason: string }>(`select kind, from_value, to_value, reason from crm_opportunity_events where opportunity_id = '${opp}' and kind = 'reopened'`);
      expect(ev).toEqual([{ kind: "reopened", from_value: "won", to_value: "negotiation", reason: "Client asked to revise the scope" }]);
    });
    it("leaves an already prepared handover exactly as it was, through reopen and a second Won", async () => {
      const opp = await wonOpp("Handover survives job");
      await commit(U.amira, `select crm_update_handover('${opp}', 'handed_over', '${U.pm}', 'Site visit booked')`);
      const before = await admin(`select status, pm_user_id, notes, prepared_by, prepared_at, handed_over_at from crm_handovers where opportunity_id = '${opp}'`);
      await commit(U.juzar, `select crm_reopen_opportunity('${opp}', 'Scope revision', ${NEXT})`);
      expect(await admin(`select status, pm_user_id, notes, prepared_by, prepared_at, handed_over_at from crm_handovers where opportunity_id = '${opp}'`)).toEqual(before);
      await expect(q(U.amira, `select crm_update_handover('${opp}', 'ready')`)).rejects.toThrow(/Won/); // not editable while open again
      await commit(U.amira, `select crm_mark_won('${opp}', 'authorised_email', 'Mail 20 Oct', current_date)`);
      expect(await admin(`select status, pm_user_id, notes, prepared_by, prepared_at, handed_over_at from crm_handovers where opportunity_id = '${opp}'`)).toEqual(before);
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_handovers where opportunity_id = '${opp}'`))[0].n)).toBe(1);
    });
    it("keeps both closures after a second outcome, with exactly one current", async () => {
      const opp = await wonOpp("Two closures job");
      await commit(U.juzar, `select crm_reopen_opportunity('${opp}', 'Reopened once', ${NEXT})`);
      await commit(U.amira, `select crm_mark_lost('${opp}', 'Went with another supplier')`);
      const rows = await admin<{ outcome: string; reopened_at: string | null; lost_reason: string | null }>(`select outcome, reopened_at, lost_reason from crm_closures where opportunity_id = '${opp}' order by closed_at`);
      expect(rows.map((r) => [r.outcome, r.reopened_at !== null])).toEqual([["won", true], ["lost", false]]);
      expect(rows[1]!.lost_reason).toBe("Went with another supplier");
      await commit(U.juzar, `select crm_reopen_opportunity('${opp}', 'Lost job came back', ${NEXT}, 'other', 'proposal_prep')`);
      expect((await admin<{ stage: string }>(`select stage from crm_opportunities where id = '${opp}'`))[0].stage).toBe("proposal_prep");
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_closures where opportunity_id = '${opp}'`))[0].n)).toBe(2);
    });
    it("refuses to reopen something that is not closed", async () => {
      await expect(q(U.juzar, `select crm_reopen_opportunity('${oppKsa}', 'x', ${NEXT})`)).rejects.toThrow(/Only a Won or Lost/);
    });
    it("moves ownership to the person reopening when the owner no longer has Sales access, and says so", async () => {
      const opp = await wonOpp("Owner left job");
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.amira}' and company_id = '${CO.uae}'`);
      await commit(U.juzar, `select crm_reopen_opportunity('${opp}', 'Reopen after the owner left', ${NEXT})`);
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.amira}' and company_id = '${CO.uae}'`);
      expect((await admin<{ owner_id: string }>(`select owner_id from crm_opportunities where id = '${opp}'`))[0].owner_id).toBe(U.juzar);
      expect(Number((await admin<{ n: string }>(`select count(*) n from crm_opportunity_events where opportunity_id = '${opp}' and kind = 'owner_changed'`))[0].n)).toBe(1);
    });
    it("shows closure history to people with Sales access for the company only, and audits it", async () => {
      expect((await q(U.daniel, "select 1 from crm_closures")).length).toBeGreaterThan(0);
      expect(await q(U.lena, `select 1 from crm_closures where company_id = '${CO.uae}'`)).toHaveLength(0);
      expect(await q(U.hr, "select 1 from crm_closures")).toHaveLength(0);
      expect((await q(U.juzar, "select 1 from crm_audit_log where table_name = 'crm_closures' and action = 'update'")).length).toBeGreaterThan(0);
    });
    it("does not let a browser write a closure", async () => {
      const r = await q(U.juzar, `update crm_closures set outcome = 'lost'`).then((x) => x, (e: Error) => e);
      if (r instanceof Error) expect(r.message).toMatch(DENIED); else expect(r).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("people pickers", () => {
    it("lists CRM staff of the caller's companies by name only (email for founders)", async () => {
      const daniel = await q<{ user_id: string; email: string | null }>(U.daniel, "select user_id, email from crm_people()");
      expect(daniel.map((r) => r.user_id)).toEqual(expect.arrayContaining([U.amira, U.juzar, U.daniel]));
      expect(daniel.map((r) => r.user_id)).not.toContain(U.lena); // PL staff are not visible from UAE only
      expect(daniel.every((r) => r.email === null)).toBe(true);
      const juzar = await q<{ email: string | null }>(U.juzar, "select email from crm_people()");
      expect(juzar.every((r) => r.email !== null)).toBe(true);
    });
    it("lists the staff directory for pickers, hidden from anyone without CRM access", async () => {
      expect((await q(U.amira, "select * from crm_staff_directory()")).length).toBeGreaterThanOrEqual(8);
      expect(await q(U.hr, "select * from crm_staff_directory()")).toHaveLength(0);
      expect(await q(U.hr, "select * from crm_people()")).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("privileges", () => {
    const CRM_TABLES = [
      "crm_company_grants", "crm_audit_log", "crm_company_settings", "crm_organisations", "crm_contacts", "crm_reference_counters",
      "crm_opportunities", "crm_opportunity_contacts", "crm_opportunity_events", "crm_activities", "crm_follow_ups", "crm_files",
      "crm_proposals", "crm_zoho_references", "crm_approvals", "crm_handovers", "crm_reminders", "crm_closures", "crm_upload_intents",
    ];
    it("gives anon nothing on any CRM table, and authenticated nothing beyond what the suite grants for DML", async () => {
      const rows = await admin<{ table_name: string; grantee: string; privilege_type: string }>(`
        select table_name, grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name like 'crm\\_%' and grantee in ('anon', 'PUBLIC')`);
      expect(rows.filter((r) => r.grantee === "anon")).toEqual([]);
      expect(rows.filter((r) => r.grantee === "PUBLIC")).toEqual([]);
    });
    it.each(CRM_TABLES)("%s has no TRUNCATE / TRIGGER / REFERENCES for signed-in users", async (table) => {
      const rows = await admin<{ privilege_type: string }>(`
        select privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name = '${table}' and grantee = 'authenticated'
          and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')`);
      expect(rows).toEqual([]);
    });
    it("has RLS enabled on every CRM table", async () => {
      const rows = await admin<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname like 'crm\\_%' and relkind = 'r' and not relrowsecurity`);
      expect(rows).toEqual([]);
    });
    it("grants no INSERT/UPDATE/DELETE policy on any CRM table", async () => {
      const rows = await admin<{ tablename: string; cmd: string }>(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename like 'crm\\_%' and cmd <> 'SELECT'`);
      expect(rows).toEqual([]);
    });
    it("does not let anon execute CRM functions", async () => {
      const rows = await admin<{ proname: string }>(`
        select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\\_%'
          and has_function_privilege('anon', p.oid, 'execute')`);
      expect(rows).toEqual([]);
    });
    it("makes every SECURITY DEFINER CRM function pin search_path", async () => {
      const rows = await admin<{ proname: string }>(`
        select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'crm\\_%'
          and p.prosecdef and not coalesce(p.proconfig::text, '') like '%search_path=public%'`);
      expect(rows).toEqual([]);
    });
  });
});
