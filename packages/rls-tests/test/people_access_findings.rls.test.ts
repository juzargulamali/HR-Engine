import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// People & Access: findings about who can grant what TODAY (no rule is changed by this file).
//
// These tests record the current behaviour of the four grant functions (crm_/proj_/inv_/pbx_grant_access and their revoke twins) so
// the proposal in docs/people-access-security-proposal.md rests on proven behaviour, and so a later, separately approved fix has a
// before/after to compare. They are "characterisation" tests: where a test asserts that something SUCCEEDS which the proposal says
// should be refused, that is the finding, not a requirement. When the proposed rules are approved and implemented, those assertions
// flip in the same change.
//
// Two different things are kept apart:
//   * transaction self-approval (nobody decides what they prepared or submitted): already enforced by the database, and unaffected;
//   * access administration (who may create the person who decides): the subject of the findings.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUAL_SQL = path.resolve(__dirname, "../../../supabase/manual-sql");

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { admin: id(), mgr: id(), other: id(), ksaFin: id(), colleague: id(), soleMgr: id(), newPerson: id(), founder: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

describe("People & Access: current grant authority (findings)", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const call = async <T = unknown>(user: string, sql: string): Promise<T> => (Object.values((await commit<Row>(user, sql))[0])[0] as T);
  const failsCommit = (user: string, sql: string, re: RegExp) => expect(commit(user, sql)).rejects.toThrow(re);
  const caps = async (table: string, user: string, company: string) =>
    ((await admin<{ c: string[] }>(`select capabilities c from ${table} where user_id = '${user}' and company_id = '${company}' and revoked_at is null`))[0]?.c ?? []).slice().sort();

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@access-test.ae')`).join(", ")};
      insert into user_roles (user_id, role) values ('${U.admin}', 'sys_admin');
    `);
  }, 120_000);
  afterAll(async () => { await db.teardown(); });

  // ---- what stays exactly as it is ------------------------------------------------------------------------------------------
  describe("System Administrator", () => {
    it("holds no module access by title: it cannot grant Sales, Projects, Inventory or Budget access", async () => {
      await failsCommit(U.admin, `select crm_grant_access('${U.other}', '${CO.uae}', '{}', null)`, /founder|access management|Sales access/i);
      await failsCommit(U.admin, `select proj_grant_access('${U.other}', '${CO.uae}', '{}', null)`, /founder|access management|Projects access/i);
      await failsCommit(U.admin, `select inv_grant_access('${U.other}', '${CO.uae}', '{}', null)`, /founder|access management|Inventory access/i);
      await failsCommit(U.admin, `select pbx_grant_access('${U.other}', '${CO.uae}', '{view}', null)`, /access management|budget access/i);
    });
  });

  // ---- Budget: access administration versus transaction self-approval ---------------------------------------------------------
  describe("Budget", () => {
    let project = "";
    let version = "";
    let rv = 0;

    beforeAll(async () => {
      // A KSA Finance person who manages Budget access, and who is also the Project Manager of a KSA project. The company has NO CEO/CTO approver.
      await admin(`
        insert into pbx_company_grants (user_id, company_id, capabilities) values ('${U.ksaFin}', '${CO.ksa}', '{finance,manage_access}');
        insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.ksaFin}', '${CO.ksa}', '{}');`);
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
      rv = await call<number>(U.ksaFin, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({ period_start: "2026-10-20", period_end: "2026-10-23", people: [U.ksaFin] })},
        ${j([{ category_id: food, date_from: "2026-10-20", activity: "setup", description: "Meals", basis: "fixed", fixed: "500" }])})`);
      await call(U.ksaFin, `select pbx_submit_budget('${version}', ${rv}, '${id()}')`);
    });

    it("the submission by a Finance holder needs a CEO/CTO approver, and the company has none: nobody can decide it", async () => {
      expect((await admin<{ n: string }>(`select count(*) n from pbx_company_grants where company_id = '${CO.ksa}' and 'executive_approver' = any (capabilities)`))[0].n).toBe("0");
      await failsCommit(U.colleague, `select pbx_decide_budget('${version}', 'approve')`, /.+/);
    });

    it("TRANSACTION RULE (holds): the submitter cannot decide their own budget, even after granting themselves the approver right", async () => {
      await call(U.ksaFin, `select pbx_grant_access('${U.ksaFin}', '${CO.ksa}', '{finance,manage_access,executive_approver}', 'self')`);
      expect(await caps("pbx_company_grants", U.ksaFin, CO.ksa)).toEqual(["executive_approver", "finance", "manage_access"]);
      await failsCommit(U.ksaFin, `select pbx_decide_budget('${version}', 'approve')`, /prepared or submitted|cannot be decided by/i);
      await admin(`update pbx_company_grants set capabilities = '{finance,manage_access}' where user_id = '${U.ksaFin}' and company_id = '${CO.ksa}' and revoked_at is null`);
    });

    it("FINDING (access administration): the submitter can create their own independent approver, who then approves it", async () => {
      // The access manager hands the approver right to a colleague who holds no other budget access, in a company with no CEO/CTO.
      await call(U.ksaFin, `select pbx_grant_access('${U.colleague}', '${CO.ksa}', '{executive_approver}', 'my approver')`);
      expect(await caps("pbx_company_grants", U.colleague, CO.ksa)).toEqual(["executive_approver"]);
      await call(U.colleague, `select pbx_decide_budget('${version}', 'approve')`);
      const status = (await admin<{ status: string }>(`select status from pbx_budget_versions where id = '${version}'`))[0].status;
      expect(status).toBe("approved");
    });
  });

  // ---- Sales: an access manager can hand themselves rights nobody delegated ------------------------------------------------------
  describe("Sales", () => {
    it("FINDING: an access manager (not a founder) can give themselves the commercial-approval-rules right, and use it", async () => {
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.mgr}', '${CO.uae}', '{manage_access}'), ('${U.founder}', '${CO.uae}', '{founder}')`);
      await call(U.founder, `select crm_upsert_settings('${CO.uae}', 'ENG', 'AED', null, null, 180, false, null, null)`);
      await failsCommit(U.mgr, `select crm_upsert_settings('${CO.uae}', 'ENG', 'AED', null, null, 180, false, 'not_required', null)`, /Not allowed/i);
      await call(U.mgr, `select crm_grant_access('${U.mgr}', '${CO.uae}', '{manage_settings,manage_approval_rules}', 'self')`);
      expect(await caps("crm_company_grants", U.mgr, CO.uae)).toEqual(["manage_approval_rules", "manage_settings"]);
      await call(U.mgr, `select crm_upsert_settings('${CO.uae}', 'ENG', 'AED', null, null, 180, false, 'not_required', 'self-granted')`);
      expect((await admin<{ p: string }>(`select approval_policy p from crm_company_settings where company_id = '${CO.uae}'`))[0].p).toBe("not_required");
    });
    it("Protected today: founder and access-management rights cannot be handed out by a non-founder", async () => {
      await admin(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.other}', '${CO.uae}', '{manage_access}') on conflict do nothing`);
      await failsCommit(U.other, `select crm_grant_access('${U.other}', '${CO.uae}', '{founder}', null)`, /founder/i);
    });
  });

  // ---- Projects ----------------------------------------------------------------------------------------------------------------
  describe("Projects", () => {
    it("Protected today: an access manager cannot change their own rights (changing an access manager's rights is a founder's decision)", async () => {
      await admin(`insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.mgr}', '${CO.uae}', '{manage_access}'), ('${U.founder}', '${CO.uae}', '{founder}')`);
      await failsCommit(U.mgr, `select proj_grant_access('${U.mgr}', '${CO.uae}', '{approve_scope,view_commercial}', 'self')`, /founder/i);
      await failsCommit(U.mgr, `select proj_grant_access('${U.newPerson}', '${CO.uae}', '{manage_access}', null)`, /founder|access management|access manager/i);
    });
    it("By design (delegation): an access manager can give another person the scope-decision and commercial-figures rights", async () => {
      await call(U.mgr, `select proj_grant_access('${U.other}', '${CO.uae}', '{approve_scope,view_commercial}', 'delegated')`);
      expect(await caps("proj_company_grants", U.other, CO.uae)).toEqual(["approve_scope", "view_commercial"]);
    });
  });

  describe("Revoking (an asymmetry between the database and the old screens)", () => {
    it("FINDING (minor): an access manager who is not a founder can withdraw another access manager's access in the database, although the screens say only a founder can", async () => {
      await admin(`insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.soleMgr}', '${CO.uae}', '{manage_access}')`);
      await call(U.mgr, `select proj_revoke_access('${U.soleMgr}', '${CO.uae}')`);
      expect(await caps("proj_company_grants", U.soleMgr, CO.uae)).toEqual([]);
    });
  });

  // ---- Inventory ---------------------------------------------------------------------------------------------------------------
  describe("Inventory", () => {
    it("Protected today: an access manager cannot change their own rights, and cost visibility needs a founder", async () => {
      await admin(`insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.mgr}', '${CO.uae}', '{manage_access}')`);
      await failsCommit(U.mgr, `select inv_grant_access('${U.mgr}', '${CO.uae}', '{confirm_stock}', 'self')`, /founder/i);
      await failsCommit(U.mgr, `select inv_grant_access('${U.other}', '${CO.uae}', '{view_costs}', null)`, /founder|cost/i);
    });
    it("By design (delegation): an access manager can give another person stock confirmation, the audit trail and employee custody", async () => {
      await call(U.mgr, `select inv_grant_access('${U.other}', '${CO.uae}', '{confirm_stock,view_audit,view_employee_custody}', 'delegated')`);
      expect(await caps("inv_company_grants", U.other, CO.uae)).toEqual(["confirm_stock", "view_audit", "view_employee_custody"]);
    });
  });

  // ---- Last access administrator and recovery -----------------------------------------------------------------------------------
  describe("Last access administrator", () => {
    it("Budget: the last access manager cannot revoke themselves or drop the right by replacement", async () => {
      await admin(`insert into pbx_company_grants (user_id, company_id, capabilities) values ('${U.soleMgr}', '${CO.uae}', '{finance,manage_access}')`);
      await failsCommit(U.soleMgr, `select pbx_revoke_access('${U.soleMgr}', '${CO.uae}')`, /last person/i);
      await failsCommit(U.soleMgr, `select pbx_grant_access('${U.soleMgr}', '${CO.uae}', '{finance}', null)`, /last person/i);
    });
    it("Budget: if that sole manager's login is deactivated nobody eligible remains inside the app (the guard still counts the inactive grant)", async () => {
      await admin(`update profiles set is_active = false where id = '${U.soleMgr}'`);
      await failsCommit(U.soleMgr, `select pbx_grant_access('${U.newPerson}', '${CO.uae}', '{view}', null)`, /access management/i);
      await failsCommit(U.admin, `select pbx_grant_access('${U.newPerson}', '${CO.uae}', '{view}', null)`, /access management/i);
    });
    it("Recovery: the owner-run script (Supabase SQL Editor, as the database owner) names a new access manager without any in-app permission", async () => {
      await admin(`update profiles set is_active = true where id = '${U.newPerson}'`);
      const script = readFileSync(path.join(MANUAL_SQL, "pbx_30_bootstrap_access.sql"), "utf8").replace(
        /'REPLACE-WITH-FINANCE-EMAIL@yourcompany\.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID => finance, manage_access'/,
        `'newPerson@access-test.ae => Enginious UAE => finance, manage_access'`,
      );
      await admin(script);
      expect(await caps("pbx_company_grants", U.newPerson, CO.uae)).toEqual(["finance", "manage_access"]);
      await call(U.newPerson, `select pbx_grant_access('${U.colleague}', '${CO.uae}', '{view}', 'by the recovered manager')`);
    });
  });
});
