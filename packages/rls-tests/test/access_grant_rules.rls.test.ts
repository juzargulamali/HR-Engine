import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { ACCESS_PRESETS, applyPreset, capabilitiesOf, evaluateGrant, evaluateRevoke, type AccessModule } from "../../domain/src/peopleAccess";

// Access grant rules R1 to R3 (supabase/migrations/20261215000000_access_grant_rules.sql), proved against a real Postgres built from every migration.
//
// Two different things are kept apart. TRANSACTION SELF-APPROVAL (nobody decides what they prepared or submitted) is a guard that this migration does not
// touch and these tests prove still holds. ACCESS ADMINISTRATION (who may create or change the person who decides) is what R1 to R3 tighten:
//   R1  Budget: only a CEO / CTO approver of the company adds or removes the approver right; the last eligible approver is never removed; changes are serialised;
//   R2  Budget and Sales: nobody adds a right to their own grant (removing one's own stays allowed);
//   R3  Sales, Projects, Inventory: a non-founder cannot withdraw another access manager (or Inventory cost reader), and Sales cannot replace another access
//       manager's rights through the grant function; stepping down oneself stays allowed.
//
// It also proves the rules cannot be sidestepped: through presets (every preset of every module is run against the database and must be allowed or refused
// exactly as the screen's rule says), through any other function (a catalogue scan of every function that can write a grant table), through the tables
// themselves (read-only for the signed-in role), by racing two changes, or across companies; and that the owner-run recovery still works.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUAL_SQL = path.resolve(__dirname, "../../../supabase/manual-sql");

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const ALL_TEST_NAMES = ["f1", "f2", "ma", "mb", "x", "y", "p", "z", "cr", "m1", "a1", "a2", "ap", "fin"] as const;
const names = ["admin", "f1", "f2", "ma", "mb", "x", "y", "p", "z", "cr", "m1", "a1", "a2", "ap", "fin", "ksaFin", "ksaA", "colleague", "newPerson", "sub"] as const;
type Name = (typeof names)[number];
const U = Object.fromEntries(names.map((n) => [n, id()])) as Record<Name, string>;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (caps: readonly string[]) => `'{${caps.join(",")}}'::text[]`;
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const TABLE = { sales: "crm_company_grants", projects: "proj_company_grants", inventory: "inv_company_grants", budget: "pbx_company_grants" } as const;
const GRANT = { sales: "crm_grant_access", projects: "proj_grant_access", inventory: "inv_grant_access", budget: "pbx_grant_access" } as const;
const REVOKE = { sales: "crm_revoke_access", projects: "proj_revoke_access", inventory: "inv_revoke_access", budget: "pbx_revoke_access" } as const;

describe("access grant rules R1 to R3", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as Rows<T>); // always rolled back
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const call = async <T = unknown>(user: string, sql: string): Promise<T> => (Object.values((await commit<Row>(user, sql))[0])[0] as T);
  const failsCommit = (user: string, sql: string, re: RegExp) => expect(commit(user, sql)).rejects.toThrow(re);
  const caps = async (module: AccessModule, user: string, company = CO.uae) =>
    ((await admin<{ c: string[] }>(`select capabilities c from ${TABLE[module]} where user_id = '${user}' and company_id = '${company}' and revoked_at is null`))[0]?.c ?? []).slice().sort();
  const hasRow = async (module: AccessModule, user: string, company = CO.uae) =>
    (await admin<{ n: string }>(`select count(*) n from ${TABLE[module]} where user_id = '${user}' and company_id = '${company}' and revoked_at is null`))[0].n === "1";
  const seedGrant = (module: AccessModule, user: string, c: readonly string[], company = CO.uae) =>
    admin(`insert into ${TABLE[module]} (user_id, company_id, capabilities, note) values ('${user}', '${company}', ${arr(c)}, 'test seed')
      on conflict (user_id, company_id) where revoked_at is null do update set capabilities = excluded.capabilities`);
  const clearGrant = (module: AccessModule, user: string, company = CO.uae) => admin(`delete from ${TABLE[module]} where user_id = '${user}' and company_id = '${company}'`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${names.map((n) => `('${U[n]}', '${n}@grant-rules.ae')`).join(", ")};
      insert into user_roles (user_id, role) values ('${U.admin}', 'sys_admin');
    `);
  }, 120_000);
  afterAll(async () => { await db.teardown(); });

  // -----------------------------------------------------------------------------------------------------------------------------------------
  // Budget: R1 (approver appointment) and R2 (no adding to one's own grant), and the transaction rule that must still hold
  // -----------------------------------------------------------------------------------------------------------------------------------------
  describe("Budget", () => {
    let project = "";
    let version = "";

    beforeAll(async () => {
      // A KSA Finance person who manages Budget access and is also the Project Manager of a KSA project. The company has NO CEO / CTO approver.
      await seedGrant("budget", U.ksaFin, ["finance", "manage_access"], CO.ksa);
      await seedGrant("projects", U.ksaFin, [], CO.ksa);
      project = id();
      await admin(`
        insert into proj_projects (id, company_id, reference, name, kind, pm_user_id, created_by, start_date, end_date)
          values ('${project}', '${CO.ksa}', 'K-P-2026-1', 'KSA install', 'internal', '${U.ksaFin}', '${U.ksaFin}', current_date, current_date + 10);
        insert into proj_project_details (project_id, location, site_timezone, install_start, event_start, event_end)
          values ('${project}', 'Riyadh hall', 'Asia/Riyadh', current_date + 2, current_date + 4, current_date + 6);
        insert into proj_project_members (project_id, user_id, role) values ('${project}', '${U.ksaFin}', 'pm');`);
      const food = (await admin<{ id: string }>(`select id from pbx_categories where company_id is null and key = 'food'`))[0].id;
      await call(U.ksaFin, `select pbx_create_budget('${project}', 'SAR')`);
      const d = (await admin<{ id: string; row_version: number }>(`select id, row_version from pbx_budget_versions where project_id = '${project}' and status = 'draft'`))[0];
      version = d.id;
      const rv = await call<number>(U.ksaFin, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({ period_start: "2026-10-20", period_end: "2026-10-23", people: [U.ksaFin] })},
        ${j([{ category_id: food, date_from: "2026-10-20", activity: "setup", description: "Meals", basis: "fixed", fixed: "500" }])})`);
      await call(U.ksaFin, `select pbx_submit_budget('${version}', ${rv}, '${id()}')`);
    });

    it("the submission by a Finance holder needs a CEO / CTO approver, and the company has none: it is held", async () => {
      expect((await admin<{ n: string }>(`select count(*) n from pbx_company_grants where company_id = '${CO.ksa}' and 'executive_approver' = any (capabilities)`))[0].n).toBe("0");
      await failsCommit(U.colleague, `select pbx_decide_budget('${version}', 'approve')`, /.+/);
    });

    it("F1 closed: the submitter cannot appoint their own approver, so the held submission stays held", async () => {
      await failsCommit(U.ksaFin, `select pbx_grant_access('${U.colleague}', '${CO.ksa}', '{executive_approver}', 'my approver')`, /Only a CEO \/ CTO approver of this company/);
      expect(await hasRow("budget", U.colleague, CO.ksa)).toBe(false);
      await failsCommit(U.colleague, `select pbx_decide_budget('${version}', 'approve')`, /.+/);
      expect((await admin<{ status: string }>(`select status from pbx_budget_versions where id = '${version}'`))[0].status).toBe("submitted");
    });

    it("F2 closed: an access manager cannot give themselves any budget right, including the approver right", async () => {
      for (const c of ["executive_approver", "view"]) {
        await failsCommit(U.ksaFin, `select pbx_grant_access('${U.ksaFin}', '${CO.ksa}', '{finance,manage_access,${c}}', 'self')`, c === "executive_approver" ? /Only a CEO \/ CTO approver|own access/ : /own access/);
      }
      expect(await caps("budget", U.ksaFin, CO.ksa)).toEqual(["finance", "manage_access"]);
    });

    it("the transaction rule is unchanged: an approver who submitted cannot decide their own budget (named by the owner, as in production)", async () => {
      await seedGrant("budget", U.ksaFin, ["finance", "manage_access", "executive_approver"], CO.ksa);
      await failsCommit(U.ksaFin, `select pbx_decide_budget('${version}', 'approve')`, /prepared or submitted|cannot be decided by/i);
      await seedGrant("budget", U.ksaFin, ["finance", "manage_access"], CO.ksa);
    });

    it("an approver named by the owner releases it; the approver may then appoint a second approver, and withdraw one while another remains", async () => {
      await seedGrant("budget", U.ksaA, ["executive_approver", "manage_access"], CO.ksa);
      await call(U.ksaA, `select pbx_decide_budget('${version}', 'approve')`);
      expect((await admin<{ status: string }>(`select status from pbx_budget_versions where id = '${version}'`))[0].status).toBe("approved");
      await call(U.ksaA, `select pbx_grant_access('${U.colleague}', '${CO.ksa}', '{executive_approver}', 'second approver')`);
      expect(await caps("budget", U.colleague, CO.ksa)).toEqual(["executive_approver"]);
      await call(U.ksaA, `select pbx_revoke_access('${U.colleague}', '${CO.ksa}')`);
      expect(await hasRow("budget", U.colleague, CO.ksa)).toBe(false);
    });

    it("R1 also covers withdrawing: a Finance access manager cannot remove an approver, by grant or by revoke", async () => {
      await failsCommit(U.ksaFin, `select pbx_revoke_access('${U.ksaA}', '${CO.ksa}')`, /Only a CEO \/ CTO approver of this company can withdraw an approver/);
      await failsCommit(U.ksaFin, `select pbx_grant_access('${U.ksaA}', '${CO.ksa}', '{manage_access}')`, /Only a CEO \/ CTO approver of this company can give or remove/);
      expect(await caps("budget", U.ksaA, CO.ksa)).toEqual(["executive_approver", "manage_access"]);
    });

    it("R1 changes nothing else about an approver: another right can still be added or removed without touching the approver right", async () => {
      await call(U.ksaFin, `select pbx_grant_access('${U.ksaA}', '${CO.ksa}', '{executive_approver,manage_access,view}')`);
      expect(await caps("budget", U.ksaA, CO.ksa)).toEqual(["executive_approver", "manage_access", "view"]);
      await call(U.ksaFin, `select pbx_grant_access('${U.ksaA}', '${CO.ksa}', '{executive_approver,manage_access}')`);
    });

    it("the last ELIGIBLE approver is protected: by replacement, by revoke, and while a colleague holds the right but is not eligible", async () => {
      // ksaA is the only approver of KSA
      await failsCommit(U.ksaA, `select pbx_grant_access('${U.ksaA}', '${CO.ksa}', '{manage_access}')`, /last eligible CEO \/ CTO approver/);
      await failsCommit(U.ksaA, `select pbx_revoke_access('${U.ksaA}', '${CO.ksa}')`, /last eligible CEO \/ CTO approver|last person who manages/);
      // a second approver exists but is deactivated: not eligible, so ksaA is still the last eligible one
      await seedGrant("budget", U.colleague, ["executive_approver"], CO.ksa);
      await admin(`update profiles set is_active = false where id = '${U.colleague}'`);
      await failsCommit(U.ksaA, `select pbx_grant_access('${U.ksaA}', '${CO.ksa}', '{manage_access}')`, /last eligible CEO \/ CTO approver/);
      // removing the deactivated one is allowed (it was never eligible), and the active approver stays
      await call(U.ksaA, `select pbx_revoke_access('${U.colleague}', '${CO.ksa}')`);
      expect(await hasRow("budget", U.colleague, CO.ksa)).toBe(false);
      await admin(`update profiles set is_active = true where id = '${U.colleague}'`);
      // with a second ACTIVE approver either may step aside
      await seedGrant("budget", U.colleague, ["executive_approver"], CO.ksa);
      await call(U.ksaA, `select pbx_grant_access('${U.ksaA}', '${CO.ksa}', '{manage_access}')`);
      expect(await caps("budget", U.ksaA, CO.ksa)).toEqual(["manage_access"]);
      await clearGrant("budget", U.colleague, CO.ksa);
      await seedGrant("budget", U.ksaA, ["executive_approver", "manage_access"], CO.ksa);
    });

    it("company boundaries: an approver of one company cannot give, remove or see the approver right of another", async () => {
      await seedGrant("budget", U.a1, ["executive_approver", "manage_access"], CO.uae);
      await failsCommit(U.a1, `select pbx_grant_access('${U.colleague}', '${CO.ksa}', '{executive_approver}')`, /access management for this company/);
      await failsCommit(U.ksaA, `select pbx_grant_access('${U.colleague}', '${CO.uae}', '{executive_approver}')`, /access management for this company/);
      await failsCommit(U.ksaA, `select pbx_revoke_access('${U.a1}', '${CO.uae}')`, /access management for this company/);
      expect(await caps("budget", U.a1, CO.uae)).toEqual(["executive_approver", "manage_access"]);
    });

    it("two approvers removing each other at the same moment cannot leave the company with none (changes are serialised)", async () => {
      for (let round = 0; round < 6; round++) {
        await seedGrant("budget", U.a1, ["executive_approver", "manage_access"], CO.uae);
        await seedGrant("budget", U.a2, ["executive_approver", "manage_access"], CO.uae);
        const results = await Promise.allSettled([
          commit(U.a1, `select pbx_revoke_access('${U.a2}', '${CO.uae}')`),
          commit(U.a2, `select pbx_revoke_access('${U.a1}', '${CO.uae}')`),
        ]);
        const ok = results.filter((r) => r.status === "fulfilled").length;
        const left = (await admin<{ n: string }>(`select count(*) n from pbx_company_grants g join profiles p on p.id = g.user_id and p.is_active
          where g.company_id = '${CO.uae}' and g.revoked_at is null and 'executive_approver' = any (g.capabilities)`))[0].n;
        expect(ok, `round ${round}`).toBe(1);
        expect(left, `round ${round}`).toBe("1");
        await clearGrant("budget", U.a1, CO.uae); await clearGrant("budget", U.a2, CO.uae);
      }
    });

    it("owner-run recovery still works: with no eligible approver the in-app route is closed, and the owner script names one without any in-app permission", async () => {
      await clearGrant("budget", U.a1, CO.uae); await clearGrant("budget", U.a2, CO.uae);
      await seedGrant("budget", U.m1, ["finance", "manage_access"], CO.uae);
      await failsCommit(U.m1, `select pbx_grant_access('${U.newPerson}', '${CO.uae}', '{executive_approver}')`, /Only a CEO \/ CTO approver of this company/);
      const script = readFileSync(path.join(MANUAL_SQL, "pbx_30_bootstrap_access.sql"), "utf8").replace(
        /'REPLACE-WITH-FINANCE-EMAIL@yourcompany\.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID => finance, manage_access'/,
        `'newPerson@grant-rules.ae => Enginious UAE => executive_approver, manage_access'`,
      );
      await admin(script);
      expect(await caps("budget", U.newPerson, CO.uae)).toEqual(["executive_approver", "manage_access"]);
      // and the person the owner named can now appoint a second approver in the app
      await call(U.newPerson, `select pbx_grant_access('${U.a1}', '${CO.uae}', '{executive_approver}', 'second approver')`);
      expect(await caps("budget", U.a1, CO.uae)).toEqual(["executive_approver"]);
      await clearGrant("budget", U.newPerson, CO.uae); await clearGrant("budget", U.a1, CO.uae); await clearGrant("budget", U.m1, CO.uae);
    });

    it("a deactivated approver cannot act at all", async () => {
      await seedGrant("budget", U.sub, ["executive_approver", "manage_access"], CO.uae);
      await admin(`update profiles set is_active = false where id = '${U.sub}'`);
      await failsCommit(U.sub, `select pbx_grant_access('${U.colleague}', '${CO.uae}', '{view}')`, /access management/);
      await admin(`update profiles set is_active = true where id = '${U.sub}'`);
      await clearGrant("budget", U.sub, CO.uae);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------
  // Sales
  // -----------------------------------------------------------------------------------------------------------------------------------------
  describe("Sales", () => {
    beforeAll(async () => {
      await seedGrant("sales", U.f1, ["founder"]); await seedGrant("sales", U.f2, ["founder"]);
      await seedGrant("sales", U.ma, ["manage_access"]); await seedGrant("sales", U.mb, ["manage_access", "assign_owner"]);
    });

    it("F3 closed: an access manager (not a founder) cannot give themselves the approval-rules right, so they cannot change the commercial approval policy", async () => {
      await call(U.f1, `select crm_upsert_settings('${CO.uae}', 'ENG', 'AED', null, null, 180, false, null, null)`);
      await failsCommit(U.ma, `select crm_grant_access('${U.ma}', '${CO.uae}', '{manage_settings,manage_approval_rules}', 'self')`, /own access/);
      await failsCommit(U.ma, `select crm_upsert_settings('${CO.uae}', 'ENG', 'AED', null, null, 180, false, 'not_required', null)`, /Not allowed/i);
      expect(await caps("sales", U.ma)).toEqual(["manage_access"]);
    });

    it("R2: removing one's own right stays allowed (an access manager may step down)", async () => {
      await call(U.mb, `select crm_grant_access('${U.mb}', '${CO.uae}', '{assign_owner}', 'step down')`);
      expect(await caps("sales", U.mb)).toEqual(["assign_owner"]);
      await seedGrant("sales", U.mb, ["manage_access", "assign_owner"]);
    });

    it("R3: a non-founder cannot replace another access manager's rights through the grant function, nor withdraw them", async () => {
      await failsCommit(U.ma, `select crm_grant_access('${U.mb}', '${CO.uae}', '{assign_owner}', null)`, /founder's or access manager's rights/);
      await failsCommit(U.ma, `select crm_revoke_access('${U.mb}', '${CO.uae}')`, /Only a CRM founder can withdraw an access manager/);
      expect(await caps("sales", U.mb)).toEqual(["assign_owner", "manage_access"]);
    });

    it("R3: stepping down oneself by revoke stays allowed; a founder can still change and withdraw an access manager", async () => {
      await call(U.f1, `select crm_grant_access('${U.mb}', '${CO.uae}', '{manage_access,assign_owner,view_audit}', null)`);
      expect(await caps("sales", U.mb)).toEqual(["assign_owner", "manage_access", "view_audit"]);
      await call(U.mb, `select crm_revoke_access('${U.mb}', '${CO.uae}')`);
      expect(await hasRow("sales", U.mb)).toBe(false);
      await seedGrant("sales", U.mb, ["manage_access", "assign_owner"]);
      await call(U.f1, `select crm_revoke_access('${U.mb}', '${CO.uae}')`);
      expect(await hasRow("sales", U.mb)).toBe(false);
      await seedGrant("sales", U.mb, ["manage_access", "assign_owner"]);
    });

    it("unchanged: only a founder hands out founder or access-management rights; the last founder is protected", async () => {
      await failsCommit(U.ma, `select crm_grant_access('${U.x}', '${CO.uae}', '{founder}', null)`, /founder/);
      await failsCommit(U.ma, `select crm_grant_access('${U.x}', '${CO.uae}', '{manage_access}', null)`, /founder/);
      await call(U.f1, `select crm_revoke_access('${U.f2}', '${CO.uae}')`);
      await failsCommit(U.f1, `select crm_revoke_access('${U.f1}', '${CO.uae}')`, /last founder/);
      await seedGrant("sales", U.f2, ["founder"]);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------
  // Projects and Inventory (R3, revoke)
  // -----------------------------------------------------------------------------------------------------------------------------------------
  describe("Projects and Inventory", () => {
    beforeAll(async () => {
      for (const m of ["projects", "inventory"] as const) {
        await seedGrant(m, U.f1, ["founder"]); await seedGrant(m, U.f2, ["founder"]);
        await seedGrant(m, U.ma, ["manage_access"]); await seedGrant(m, U.mb, ["manage_access"]);
      }
      await seedGrant("inventory", U.cr, ["view_costs"]);
    });

    for (const m of ["projects", "inventory"] as const) {
      it(`${m}: F4 closed: a non-founder access manager cannot withdraw another access manager; stepping down stays allowed; a founder can withdraw`, async () => {
        await failsCommit(U.ma, `select ${REVOKE[m]}('${U.mb}', '${CO.uae}')`, /founder can withdraw an access manager/);
        expect(await hasRow(m, U.mb)).toBe(true);
        await call(U.mb, `select ${REVOKE[m]}('${U.mb}', '${CO.uae}')`);
        expect(await hasRow(m, U.mb)).toBe(false);
        await seedGrant(m, U.mb, ["manage_access"]);
        await call(U.f1, `select ${REVOKE[m]}('${U.mb}', '${CO.uae}')`);
        expect(await hasRow(m, U.mb)).toBe(false);
        await seedGrant(m, U.mb, ["manage_access"]);
      });
    }

    it("inventory: a non-founder cannot withdraw a cost reader either; withdrawing an ordinary operator stays allowed", async () => {
      await failsCommit(U.ma, `select inv_revoke_access('${U.cr}', '${CO.uae}')`, /cost reader/);
      await seedGrant("inventory", U.x, ["warehouse"]);
      await call(U.ma, `select inv_revoke_access('${U.x}', '${CO.uae}')`);
      expect(await hasRow("inventory", U.x)).toBe(false);
    });

    it("unchanged: an access manager cannot change their own rights in Projects and Inventory, and cost visibility needs a founder", async () => {
      await failsCommit(U.ma, `select proj_grant_access('${U.ma}', '${CO.uae}', '{approve_scope}', 'self')`, /founder/);
      await failsCommit(U.ma, `select inv_grant_access('${U.ma}', '${CO.uae}', '{confirm_stock}', 'self')`, /founder/);
      await failsCommit(U.ma, `select inv_grant_access('${U.x}', '${CO.uae}', '{view_costs}', null)`, /founder|cost/);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------
  // System Administrator
  // -----------------------------------------------------------------------------------------------------------------------------------------
  it("System Administrator holds no module access by title: it cannot grant or revoke in any module", async () => {
    for (const m of ["sales", "projects", "inventory", "budget"] as const) {
      await failsCommit(U.admin, `select ${GRANT[m]}('${U.x}', '${CO.uae}', '{}', null)`, /.+/);
      await failsCommit(U.admin, `select ${REVOKE[m]}('${U.x}', '${CO.uae}')`, /.+/);
    }
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------
  // Cannot be sidestepped: other functions, the tables themselves
  // -----------------------------------------------------------------------------------------------------------------------------------------
  describe("no alternative route to a grant table", () => {
    const GRANT_TABLES = Object.values(TABLE);

    it("exactly the eight grant and revoke functions can write a grant table, however it is reached", async () => {
      // every function whose source writes (insert, update or delete) a grant table
      const writers = await admin<{ proname: string; callable: boolean }>(`
        select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as callable
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.prokind = 'f'
           and (${GRANT_TABLES.map((t) => `p.prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\M'`).join(" or ")})
         order by 1`);
      expect(writers.map((w) => w.proname)).toEqual(
        ["crm_grant_access", "crm_revoke_access", "inv_grant_access", "inv_revoke_access", "pbx_grant_access", "pbx_revoke_access", "proj_grant_access", "proj_revoke_access"].sort(),
      );
      expect(writers.every((w) => w.callable)).toBe(true);
    });

    it("no function builds SQL dynamically that names a grant table (so the scan above cannot be dodged)", async () => {
      const dynamic = await admin<{ proname: string }>(`
        select p.proname from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
           and p.prosrc ~* '\\mexecute\\M' and (${GRANT_TABLES.map((t) => `p.prosrc ilike '%${t}%'`).join(" or ")})`);
      expect(dynamic).toEqual([]);
    });

    it("no trigger on a grant table changes capabilities (only audit and updated-at triggers)", async () => {
      const triggers = await admin<{ tgname: string; proname: string }>(`
        select t.tgname, f.proname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc f on f.oid = t.tgfoid
         where not t.tgisinternal and c.relname in (${GRANT_TABLES.map((t) => `'${t}'`).join(", ")}) order by 1`);
      expect(triggers.every((t) => /audit|updated_at/.test(`${t.tgname} ${t.proname}`)), JSON.stringify(triggers)).toBe(true);
    });

    it("every grant table has row-level security on and only a read policy (the test database also gives the signed-in role broad table privileges, as a hosted project does by default for old objects, so the policies are the gate here; the owner verify script checks the real privileges on the hosted project)", async () => {
      for (const t of GRANT_TABLES) {
        const rls = await admin<{ on: boolean }>(`select relrowsecurity "on" from pg_class where oid = 'public.${t}'::regclass`);
        expect(rls[0].on, `${t} row-level security`).toBe(true);
        const policies = await admin<{ cmd: string }>(`select cmd from pg_policies where schemaname = 'public' and tablename = '${t}'`);
        expect(policies.length, t).toBeGreaterThan(0);
        expect(policies.every((p) => p.cmd === "SELECT"), `${t}: ${JSON.stringify(policies)}`).toBe(true);
      }
    });

    it("a signed-in access manager, even a founder, cannot write any grant table through the table interface: each attempt is refused or changes nothing", async () => {
      for (const m of ["sales", "projects", "inventory", "budget"] as const) {
        for (const n of ALL_TEST_NAMES) await clearGrant(m, U[n]);
        await seedGrant(m, U.f1, m === "budget" ? ["finance", "manage_access", "executive_approver"] : ["founder"]);
        await seedGrant(m, U.x, ["view"].filter(() => m === "budget"));
        const t = TABLE[m];
        const before = JSON.stringify(await admin(`select user_id, company_id, capabilities, revoked_at from ${t} order by user_id`));
        for (const sql of [
          `update ${t} set capabilities = '{founder,manage_access,finance,executive_approver}' where user_id = '${U.x}'`,
          `update ${t} set revoked_at = null, capabilities = '{founder}' where user_id = '${U.f1}'`,
          `insert into ${t} (user_id, company_id, capabilities) values ('${U.y}', '${CO.uae}', '{founder}')`,
          `delete from ${t} where user_id = '${U.x}'`,
          `update ${t} set revoked_at = now() where user_id = '${U.f1}'`,
        ]) {
          try { await commit(U.f1, sql); } catch { /* refused: fine */ }
        }
        const after = JSON.stringify(await admin(`select user_id, company_id, capabilities, revoked_at from ${t} order by user_id`));
        expect(after, `${m}: the table changed through the table interface`).toBe(before);
        for (const n of ALL_TEST_NAMES) await clearGrant(m, U[n]);
      }
    });

    it("the eight functions are security definer with a fixed search path and are not callable by the anonymous role", async () => {
      const fns = await admin<{ proname: string; secdef: boolean; cfg: string[] | null; anon: boolean; authed: boolean }>(`
        select p.proname, p.prosecdef secdef, p.proconfig cfg, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authed
          from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${([...Object.values(GRANT), ...Object.values(REVOKE)] as string[]).map((n) => `'${n}'`).join(", ")}) order by 1`);
      expect(fns).toHaveLength(8);
      for (const f of fns) {
        expect(f.secdef, f.proname).toBe(true);
        expect((f.cfg ?? []).join(","), f.proname).toMatch(/search_path=public/);
        expect(f.anon, f.proname).toBe(false);
        expect(f.authed, f.proname).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------
  // Presets cannot bypass the rules: every preset of every module, against the database, must be allowed or refused exactly as the screen's rule says
  // -----------------------------------------------------------------------------------------------------------------------------------------
  describe("presets and the database agree", () => {
    // fixed state for the matrix; two holders of every protected right so the "last founder / last manager / last approver" rules never fire
    const STATE: Record<AccessModule, Partial<Record<Name, string[]>>> = {
      sales: { f1: ["founder"], f2: ["founder"], ma: ["manage_access"], mb: ["manage_access", "assign_owner"], x: ["assign_owner", "view_audit"], y: [], p: ["assign_owner"] },
      projects: { f1: ["founder"], f2: ["founder"], ma: ["manage_access"], mb: ["manage_access", "assign_pm"], x: ["assign_pm", "view_audit"], y: [], p: ["assign_pm"] },
      inventory: { f1: ["founder"], f2: ["founder"], ma: ["manage_access"], mb: ["manage_access", "warehouse"], x: ["warehouse", "view_audit"], y: [], p: ["warehouse"], cr: ["view_costs"] },
      budget: { m1: ["finance", "manage_access"], a1: ["executive_approver", "manage_access"], a2: ["executive_approver", "manage_access"], ap: ["executive_approver"], fin: ["finance"], x: ["finance", "view"], y: ["view"] },
    };
    const VIEWERS: Record<AccessModule, Name[]> = { sales: ["f1", "ma", "mb", "p"], projects: ["f1", "ma", "mb", "p"], inventory: ["f1", "ma", "mb", "p"], budget: ["m1", "a1", "ap", "fin"] };
    const TARGETS: Record<AccessModule, Name[]> = { sales: ["f2", "mb", "x", "y", "z"], projects: ["f2", "mb", "x", "y", "z"], inventory: ["f2", "mb", "x", "y", "z", "cr"], budget: ["a2", "m1", "x", "y", "z"] };
    const ALL_NAMES: Name[] = ["f1", "f2", "ma", "mb", "x", "y", "p", "z", "cr", "m1", "a1", "a2", "ap", "fin"];

    for (const module of ["sales", "projects", "inventory", "budget"] as const) {
      it(`${module}: for every viewer, target (another person or oneself) and preset, the database allows or refuses exactly as evaluateGrant says; same for revoking`, async () => {
        for (const n of ALL_NAMES) await clearGrant(module, U[n]);
        for (const [n, c] of Object.entries(STATE[module]) as [Name, string[]][]) await seedGrant(module, U[n], c);
        let compared = 0;
        const mismatches: string[] = [];
        for (const viewer of VIEWERS[module]) {
          const viewerCaps = STATE[module][viewer] ?? [];
          for (const target of [...TARGETS[module], viewer]) {
            const targetCaps = STATE[module][target] ?? [];
            const self = target === viewer;
            for (const preset of ACCESS_PRESETS[module]) {
              const desired = applyPreset(module, targetCaps, preset);
              const expected = evaluateGrant(module, viewerCaps, { capabilities: targetCaps, self }, desired);
              let allowed = true; let message = "";
              try { await q(U[viewer], `select ${GRANT[module]}('${U[target]}', '${CO.uae}', ${arr(desired)}, null)`); } catch (e) { allowed = false; message = String((e as Error).message); }
              compared++;
              if (allowed !== expected.allowed) mismatches.push(`GRANT ${module} viewer=${viewer} target=${target}${self ? "(self)" : ""} preset=${preset.id}: screen says ${expected.allowed ? "allowed" : `refused (${expected.reason})`}, database ${allowed ? "allowed" : `refused (${message})`}`);
            }
            const rev = evaluateRevoke(module, viewerCaps, { capabilities: targetCaps, self });
            let revAllowed = true; let revMessage = "";
            try { await q(U[viewer], `select ${REVOKE[module]}('${U[target]}', '${CO.uae}')`); } catch (e) { revAllowed = false; revMessage = String((e as Error).message); }
            compared++;
            if (revAllowed !== rev.allowed) mismatches.push(`REVOKE ${module} viewer=${viewer} target=${target}${self ? "(self)" : ""}: screen says ${rev.allowed ? "allowed" : `refused (${rev.reason})`}, database ${revAllowed ? "allowed" : `refused (${revMessage})`}`);
          }
        }
        expect(mismatches, mismatches.join("\n")).toEqual([]);
        expect(compared).toBeGreaterThan(100);
      });

      it(`${module}: applying a preset keeps what the person had and adds what the preset gives`, () => {
        for (const preset of ACCESS_PRESETS[module]) {
          for (const existing of [[], capabilitiesOf(module).slice(0, 2)]) {
            const applied = applyPreset(module, existing, preset);
            for (const c of existing) expect(applied, `${preset.id} kept ${c}`).toContain(c);
            for (const c of preset.capabilities) expect(applied, `${preset.id} added ${c}`).toContain(c);
          }
        }
      });
    }
  });
});
