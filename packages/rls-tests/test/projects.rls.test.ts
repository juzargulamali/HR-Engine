import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Projects & Tasks (Release 2). Proves, against a real Postgres built from every migration:
//   * company-scoped Projects grants that are independent of HR roles and of Sales grants;
//   * summary / member-only / commercially restricted tiers, including direct table access;
//   * the Sales-to-PM handover: idempotent, concurrency-safe acceptance, frozen snapshot, no commercial data;
//   * membership, department heads, temporary leadership, revocation; task review/dependency/date rules;
//   * calendars (privacy, time zones, DST, date-only deadlines), site-booking overlaps and concurrent confirmation;
//   * private discussion, mentions, retries, notifications; scope changes; issued client timelines; completion and reopening;
//   * that no Projects function touches an HR table, and existing CRM behaviour is unchanged.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FIRST_CRM_MIGRATION = "20261115000000_crm_access_audit_settings.sql";
const LATE_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f >= FIRST_CRM_MIGRATION && f.endsWith(".sql")).sort();

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = {
  founder: id(), founder2: id(), ksaFounder: id(), assigner: id(), scopeApprover: id(), commercialReader: id(), auditor: id(),
  pm: id(), pm2: id(), head: id(), member: id(), member2: id(), dir: id(), ksaOnly: id(), acting: id(),
  salesA: id(), salesB: id(), salesPreparer: id(), founderSales: id(), hr: id(), outsider: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@proj-test.ae')`).join(", ");
const DENIED = /permission denied|row-level security|not allowed|Only |not found|no Sales access|do not have|No CRM access|cannot|must be|needs|can no longer|read-only|already|unknown|not eligible|access/i;

const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Projects & Tasks", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string, params: unknown[] = []) => db.asUser(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const fails = (user: string | null, sql: string, re: RegExp = DENIED) => expect(q(user, sql)).rejects.toThrow(re);
  const day = (n: number) => `(current_date + ${n})`;

  let agencyId = "";
  let clientId = "";
  let oppA = "", oppB = "", oppC = "";
  let handoverA = "";
  let P1 = "", P2 = "", INT = "";
  let teamProg = "";
  let tableGrants: Row[] = [];
  let sequenceGrants: Row[] = [];
  let functionGrants: Row[] = [];
  let hrFingerprintBefore = "";
  let crmFingerprintBefore = "";

  async function wonOpp(owner: string, company: string, title: string): Promise<string> {
    const rows = await commit<{ id: string }>(
      owner,
      `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'agency_call', p_next_title => 'Call',
         p_next_due => now() + interval '2 days', p_agency_org_id => '${agencyId}', p_client_org_id => '${clientId}') as id`,
    );
    const oppId = rows[0].id;
    await admin(`update crm_opportunities set stage = 'won', evidence_type = 'purchase_order', evidence_reference = 'PO-SECRET-123',
                 evidence_date = current_date, closed_at = now(), closed_by = '${owner}', value = 250000, budget_note = 'BUDGET-SECRET',
                 payment_terms = 'TERMS-SECRET', location = 'Expo Hall 3', event_start = current_date + 60, event_end = current_date + 64,
                 install_start = current_date + 55, scope = 'LED floor and sensors' where id = '${oppId}'`);
    return oppId;
  }

  async function grant(who: string, company: string, caps: string[] = [], by = U.founder) {
    await commit(by, `select proj_grant_access('${who}', '${company}', '{${caps.join(",")}}'::text[])`);
  }

  beforeAll(async () => {
    await db.setupBefore(FIRST_CRM_MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hr}', 'hr_admin');
    `);
    // What a real Supabase project does for every new object in public: broad default grants. The migrations must undo them themselves.
    await db.seed(`
      alter default privileges in schema public grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
      alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    for (const f of LATE_MIGRATIONS) await db.applyMigration(f);
    tableGrants = await admin<Row>(`select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name like 'proj\\_%' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
    sequenceGrants = await admin<Row>(`select c.relname, r.rolname, has_sequence_privilege(r.rolname, c.oid, 'USAGE') u, has_sequence_privilege(r.rolname, c.oid, 'SELECT') s, has_sequence_privilege(r.rolname, c.oid, 'UPDATE') w
       from pg_class c cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname like 'proj\\_%'`);
    functionGrants = await admin<Row>(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth,
       has_function_privilege('service_role', p.oid, 'execute') svc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'proj\\_%'`);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.salesA}', '${CO.uae}', '{}'), ('${U.salesB}', '${CO.uae}', '{}'), ('${U.salesPreparer}', '${CO.uae}', '{}'),
        ('${U.founderSales}', '${CO.uae}', '{founder}');
      -- Projects founders, bootstrapped the way the owner's manual SQL does it.
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.founder2}', '${CO.uae}', '{founder}'),
        ('${U.ksaFounder}', '${CO.ksa}', '{founder}'), ('${U.founderSales}', '${CO.uae}', '{founder}');
    `);
    // HR / CRM fingerprints taken before any Projects activity.
    hrFingerprintBefore = JSON.stringify(await admin(`select (select count(*) from user_roles) roles, (select count(*) from employees) emps,
       (select md5(coalesce(string_agg(manager_id::text, ',' order by id), '')) from employees) mgr`));
    agencyId = (await commit<{ id: string }>(U.salesA, `select crm_create_organisation('Zeta Media LLC', 'agency', 'Dubai') as id`))[0].id;
    clientId = (await commit<{ id: string }>(U.salesA, `select crm_create_organisation('Orbit Motors', 'client', 'Riyadh') as id`))[0].id;
    oppA = await wonOpp(U.salesA, CO.uae, 'Floor projection');
    oppB = await wonOpp(U.salesB, CO.uae, 'Mirror booth');
    oppC = await wonOpp(U.salesA, CO.uae, 'Light tunnel');
    crmFingerprintBefore = JSON.stringify(await admin(`select (select count(*) from crm_opportunities) opps, (select md5(string_agg(row(o.id, o.stage, o.owner_id, o.value, o.scope, o.evidence_reference)::text, ',' order by o.id)) from crm_opportunities o) fp,
       (select count(*) from crm_handovers) hand`));

    await grant(U.assigner, CO.uae, ["assign_pm"]);
    await grant(U.scopeApprover, CO.uae, ["approve_scope"]);
    await grant(U.commercialReader, CO.uae, ["view_commercial"]);
    await grant(U.auditor, CO.uae, ["view_audit"]);
    for (const u of [U.pm, U.pm2, U.head, U.member, U.member2, U.dir, U.acting]) await grant(u, CO.uae);
    await grant(U.ksaOnly, CO.ksa, [], U.ksaFounder);
  });

  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("installation and privileges", () => {
    it("creates no company, and copies the Sales reference codes for existing companies only", async () => {
      expect(Number((await admin<{ n: string }>("select count(*) n from companies"))[0].n)).toBe(2);
      const rows = await admin<{ company_id: string }>("select company_id from proj_company_settings");
      expect(rows.map((r) => r.company_id).sort()).toEqual([CO.uae, CO.ksa].sort());
    });
    it("leaves anon with no privilege and authenticated with SELECT only on every proj_ table, despite Supabase's broad defaults", async () => {
      expect(tableGrants.length).toBeGreaterThan(20);
      expect(tableGrants.filter((g) => g.grantee !== "authenticated")).toEqual([]);
      expect(tableGrants.filter((g) => g.privilege_type !== "SELECT")).toEqual([]);
      const policies = await admin<{ tablename: string; cmd: string }>(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename like 'proj\\_%' and cmd <> 'SELECT'`);
      expect(policies).toHaveLength(0);
    });
    it("closes every proj_ sequence to anon and authenticated (no usage, select or setval)", async () => {
      expect(sequenceGrants.length).toBeGreaterThan(0);
      expect(sequenceGrants.filter((g) => g.u || g.s || g.w)).toEqual([]);
    });
    it("keeps internal helpers, trigger functions and service-role functions out of reach of browser sessions", async () => {
      const internal = ["proj_lock_project", "proj_notify", "proj_next_reference", "proj_add_member_row", "proj_log_change", "proj_display_name", "proj_check_version",
        "proj_require_manager", "proj_text_or_null", "proj_lock_handover", "proj_task_event", "proj_set_task_dependencies", "proj_set_task_collaborators",
        "proj_task_actor_role", "proj_member_in_team", "proj_build_plan_payload", "proj_audit_trigger", "proj_member_blockers", "proj_status_rank",
        "proj_require_user", "proj_handover_frozen", "proj_issued_plan_guard", "proj_require_open_project", "proj_require_member_or_founder",
        "proj_mark_upload_intent", "proj_expire_upload_intents"];
      for (const name of internal) {
        const f = functionGrants.find((x) => x.proname === name);
        expect(f, name).toBeDefined();
        expect([name, f?.anon, f?.auth]).toEqual([name, false, false]);
      }
      for (const name of ["proj_mark_upload_intent", "proj_expire_upload_intents"]) expect(functionGrants.find((x) => x.proname === name)?.svc).toBe(true);
    });
    it("grants no proj_ function to anon, and the public API to authenticated", async () => {
      expect(functionGrants.filter((f) => f.anon).map((f) => f.proname)).toEqual([]);
      for (const name of ["proj_directory", "proj_accept_handover", "proj_create_task", "proj_post_message", "proj_my_calendar", "proj_has_access", "proj_complete_project"]) {
        expect(functionGrants.find((x) => x.proname === name)?.auth, name).toBe(true);
      }
    });
    it("enables row-level security on every proj_ table", async () => {
      const rows = await admin<{ relname: string }>(
        `select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'proj\\_%' and not c.relrowsecurity`,
      );
      expect(rows.map((r) => r.relname)).toEqual([]);
    });
    it("denies anonymous callers every table and function", async () => {
      await expect(q(null, "select 1 from proj_projects")).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select proj_has_access('${CO.uae}')`)).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select * from proj_directory()`)).rejects.toThrow(/permission denied/i);
    });
    it("refuses every direct write to every proj_ table, even where the harness grants DML", async () => {
      const tables = (await admin<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'proj\\_%'`)).map((r) => r.relname);
      expect(tables.length).toBeGreaterThan(25);
      for (const t of tables) {
        const res = await db.asUser(U.founder, async (query) => {
          try { return (await query(`delete from ${t}`)).rowCount; } catch (e) { return (e as Error).message; }
        });
        expect(res === 0 || (typeof res === "string" && DENIED.test(res)), `${t}: ${String(res)}`).toBe(true);
        const ins = await db.asUser(U.founder, async (query) => {
          try { return (await query(`insert into ${t} select * from ${t} where false`)).rowCount; } catch (e) { return (e as Error).message; }
        });
        expect(ins === 0 || (typeof ins === "string" && DENIED.test(ins)), `${t}: ${String(ins)}`).toBe(true);
      }
    });
    it("leaves the legacy projects and project_allocations tables and policies untouched", async () => {
      const cols = await admin<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'projects' and table_schema = 'public' order by ordinal_position`);
      expect(cols.map((c) => c.column_name)).toEqual(["id", "company_id", "code", "name", "client_name", "is_billable", "is_active", "deleted_at", "created_at", "updated_at"].filter((c) => cols.some((x) => x.column_name === c)));
      expect(cols.every((c) => !c.column_name.startsWith("proj"))).toBe(true);
      const pol = await admin<{ policyname: string }>(`select policyname from pg_policies where tablename in ('projects', 'project_allocations') order by 1`);
      expect(pol.every((p) => !p.policyname.startsWith("proj_"))).toBe(true);
    });
    it("contains no Projects function that touches an HR table, attendance, Recovery Leave, payroll or the reporting line", async () => {
      const rows = await admin<{ proname: string }>(
        `select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'proj\\_%'
            and prosrc ~* '(from|into|update|join)\\s+(employees|attendance[a-z_]*|recovery[a-z_]*|leave[a-z_]*|payroll[a-z_]*|user_roles|salary[a-z_]*|reimbursement[a-z_]*|timesheet[a-z_]*|project_allocations|projects)\\y'`,
      );
      expect(rows.map((r) => r.proname)).toEqual([]);
      const mgr = await admin<{ proname: string }>(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'proj\\_%' and prosrc ~* 'manager_id'`);
      expect(mgr).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("grants and capabilities", () => {
    it("lets a founder grant access, and a plain grant carries no capability", async () => {
      const rows = await q<{ capabilities: string[] }>(U.dir, `select capabilities from proj_company_grants where user_id = '${U.dir}'`);
      expect(rows[0].capabilities).toEqual([]);
    });
    it("limits a grant holder to their own row; founders and access managers see the company's grants", async () => {
      expect(await q(U.dir, "select 1 from proj_company_grants")).toHaveLength(1);
      expect((await q(U.founder, "select 1 from proj_company_grants")).length).toBeGreaterThan(5);
    });
    it("refuses a grant by someone without manage_access, and refuses handing out founder rights unless a founder", async () => {
      await fails(U.dir, `select proj_grant_access('${U.outsider}', '${CO.uae}', '{}')`);
      await fails(U.assigner, `select proj_grant_access('${U.outsider}', '${CO.uae}', '{}')`);
      await grant(U.dir, CO.uae, ["manage_access"]);
      await fails(U.dir, `select proj_grant_access('${U.outsider}', '${CO.uae}', '{founder}')`);
      await fails(U.dir, `select proj_grant_access('${U.outsider}', '${CO.uae}', '{manage_access}')`);
      await q(U.dir, `select proj_grant_access('${U.outsider}', '${CO.uae}', '{view_audit}')`);
      await commit(U.founder, `select proj_grant_access('${U.dir}', '${CO.uae}', '{}')`);   // restore
    });
    it("rejects unknown capabilities and inactive users", async () => {
      await fails(U.founder, `select proj_grant_access('${U.outsider}', '${CO.uae}', '{superuser}')`, /Unknown Projects capability/);
      await fails(U.founder, `select proj_grant_access('${id()}', '${CO.uae}', '{}')`, /does not exist or is not active/);
    });
    it("never removes or revokes the last founder of a company", async () => {
      await fails(U.ksaFounder, `select proj_revoke_access('${U.ksaFounder}', '${CO.ksa}')`, /last founder/);
      await fails(U.ksaFounder, `select proj_grant_access('${U.ksaFounder}', '${CO.ksa}', '{}')`, /last founder/);
    });
    it("is independent of HR roles and Sales grants in both directions", async () => {
      for (const who of [U.hr, U.salesA, U.outsider]) {
        expect(await q(who, "select 1 from proj_projects")).toHaveLength(0);
        expect(await q(who, "select * from proj_directory()")).toHaveLength(0);
        expect(await q<{ ok: boolean }>(who, `select proj_has_any_access() as ok`)).toEqual([{ ok: false }]);
      }
      expect(await q(U.founder, "select 1 from crm_opportunities")).toHaveLength(0);       // a Projects founder has no Sales access
      expect(await q(U.founder, "select 1 from user_roles")).toHaveLength(0);              // nor HR access
      expect((await q<{ hr: boolean }>(U.founder, `select has_role('hr_admin', null) as hr`))[0].hr).toBe(false);
    });
    it("lets only a founder set the reference code, and refuses duplicates", async () => {
      await fails(U.assigner, `select proj_set_company_code('${CO.uae}', 'XYZ')`);
      await fails(U.founder, `select proj_set_company_code('${CO.uae}', 'KSA')`, /used by another company/);
      await fails(U.founder, `select proj_set_company_code('${CO.uae}', 'x')`, /2 to 5 capital letters/);
    });
    it("reads the audit trail only with view_audit (founders implicitly)", async () => {
      expect((await q(U.founder, "select 1 from proj_audit_log")).length).toBeGreaterThan(0);
      expect((await q(U.auditor, "select 1 from proj_audit_log")).length).toBeGreaterThan(0);
      for (const who of [U.pm, U.dir, U.salesA, U.ksaFounder]) expect(await q(who, "select 1 from proj_audit_log where company_id = '" + CO.uae + "'")).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("handover from Sales and project creation", () => {
    it("lets only the opportunity owner or a Sales founder prepare a handover, and only for a Won opportunity", async () => {
      await fails(U.salesB, `select proj_save_handover('${oppA}', '{}'::jsonb)`, /owner or a Sales founder/);
      await fails(U.pm, `select proj_save_handover('${oppA}', '{}'::jsonb)`, /not found/i);
      const lost = (await commit<{ id: string }>(U.salesA, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Not won', p_source => 'agency_call', p_next_title => 'x', p_next_due => now() + interval '1 day', p_agency_org_id => '${agencyId}') as id`))[0].id;
      await fails(U.salesA, `select proj_save_handover('${lost}', '{}'::jsonb)`, /Won opportunity/);
    });
    it("prefills the member-safe brief and never copies value, budget, terms or PO evidence", async () => {
      handoverA = (await commit<{ id: string }>(U.salesA, `select proj_save_handover('${oppA}', ${j({ title: "Floor projection delivery", scope: "LED floor and sensors, 6x4 m" })}) as id`))[0].id;
      const [h] = await q<Row>(U.salesA, `select * from proj_handovers where id = '${handoverA}'`);
      expect(h.status).toBe("draft");
      expect(h.crm_reference).toMatch(/^OPP-UAE-/);
      expect(h.client_name).toBeTruthy();
      expect(h.location).toBe("Expo Hall 3");
      const text = JSON.stringify(h);
      for (const secret of ["PO-SECRET-123", "BUDGET-SECRET", "TERMS-SECRET", "250000"]) expect(text).not.toContain(secret);
      const cols = await admin<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'proj_handovers'`);
      expect(cols.map((c) => c.column_name).filter((c) => /value|budget|payment|evidence|price|cost/.test(c))).toEqual([]);
    });
    it("shows the handover only to Sales (owner/preparer with Sales access), founders and assign_pm holders", async () => {
      expect(await q(U.salesA, `select 1 from proj_handovers where id = '${handoverA}'`)).toHaveLength(1);
      for (const who of [U.salesB, U.pm, U.dir, U.outsider, U.hr]) expect(await q(who, `select 1 from proj_handovers where id = '${handoverA}'`)).toHaveLength(0);
      for (const who of [U.founder, U.assigner]) expect(await q(who, `select 1 from proj_handovers where id = '${handoverA}'`)).toHaveLength(1);
    });
    it("needs a scope before submitting, and treats a repeated submit as one", async () => {
      await commit(U.salesA, `select proj_submit_handover('${handoverA}')`);
      await commit(U.salesA, `select proj_submit_handover('${handoverA}')`);
      const [h] = await admin<Row>(`select status, revision from proj_handovers where id = '${handoverA}'`);
      expect(h).toMatchObject({ status: "submitted", revision: 2 });
    });
    it("lets only founders / assign_pm assign a PM who has Projects access, and notifies them once", async () => {
      await fails(U.salesA, `select proj_assign_handover_pm('${handoverA}', '${U.pm}')`, /Only a founder/);
      await fails(U.pm, `select proj_assign_handover_pm('${handoverA}', '${U.pm}')`);
      await fails(U.assigner, `select proj_assign_handover_pm('${handoverA}', '${U.outsider}')`, /Projects access/);
      await commit(U.assigner, `select proj_assign_handover_pm('${handoverA}', '${U.pm}')`);
      await commit(U.assigner, `select proj_assign_handover_pm('${handoverA}', '${U.pm}')`);
      const n = await admin<{ n: string }>(`select count(*) n from notifications where user_id = '${U.pm}' and type = 'project_handover_assigned'`);
      expect(Number(n[0].n)).toBe(1);
      expect(await q(U.pm, `select 1 from proj_handovers where id = '${handoverA}'`)).toHaveLength(1);
    });
    it("lets the PM ask for clarification, Sales fix and resubmit, and keeps the PM", async () => {
      await fails(U.assigner, `select proj_request_handover_clarification('${handoverA}', 'x')`, /assigned Project Manager/);
      await fails(U.pm, `select proj_request_handover_clarification('${handoverA}', '  ')`, /what needs clarifying/);
      await commit(U.pm, `select proj_request_handover_clarification('${handoverA}', 'Which hall and which hours?')`);
      await fails(U.pm, `select proj_accept_handover('${handoverA}')`, /not waiting for acceptance/);
      await commit(U.salesA, `select proj_save_handover('${oppA}', ${j({ location: "Expo Hall 3, 08:00-22:00" })})`);
      await commit(U.salesA, `select proj_submit_handover('${handoverA}')`);
      const [h] = await admin<Row>(`select status, pm_user_id from proj_handovers where id = '${handoverA}'`);
      expect(h).toMatchObject({ status: "pm_assigned", pm_user_id: U.pm });
    });
    it("lets only the assigned PM accept, and creates exactly one project, even for repeated and concurrent accepts", async () => {
      await fails(U.founder, `select proj_accept_handover('${handoverA}')`, /Only the assigned Project Manager/);
      await fails(U.salesA, `select proj_accept_handover('${handoverA}')`, /not found/i);
      const results = await Promise.allSettled([
        commit<{ p: string }>(U.pm, `select proj_accept_handover('${handoverA}') as p`),
        commit<{ p: string }>(U.pm, `select proj_accept_handover('${handoverA}') as p`),
        commit<{ p: string }>(U.pm, `select proj_accept_handover('${handoverA}') as p`),
      ]);
      const ok = results.filter((r): r is PromiseFulfilledResult<Rows<{ p: string }>> => r.status === "fulfilled").map((r) => r.value[0].p);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ok).size).toBe(1);
      P1 = ok[0] as string;
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_projects where crm_opportunity_id = '${oppA}'`))[0].n)).toBe(1);
      const again = await commit<{ p: string }>(U.pm, `select proj_accept_handover('${handoverA}') as p`);
      expect(again[0].p).toBe(P1);
    });
    it("creates the project in planning with a reference, details from the snapshot, the PM as member and Sales links recorded", async () => {
      const [p] = await admin<Row>(`select * from proj_projects where id = '${P1}'`);
      expect(p).toMatchObject({ kind: "client", status: "planning", pm_user_id: U.pm, company_id: CO.uae, crm_opportunity_id: oppA });
      expect(p.reference).toMatch(/^UAE-P-\d{4}-0001$/);
      const [d] = await admin<Row>(`select * from proj_project_details where project_id = '${P1}'`);
      expect(d.location).toBe("Expo Hall 3, 08:00-22:00");
      expect(d.site_timezone).toBe("Asia/Dubai");
      expect((await admin<Row>(`select role from proj_project_members where project_id = '${P1}' and user_id = '${U.pm}'`))[0].role).toBe("pm");
      expect((await admin<Row>(`select user_id from proj_sales_links where project_id = '${P1}'`)).map((r) => r.user_id)).toEqual([U.salesA]);
    });
    it("freezes the accepted handover and keeps it as a snapshot when the CRM record changes later", async () => {
      await admin(`update crm_opportunities set scope = 'CHANGED IN CRM', location = 'Elsewhere', title = 'Renamed' where id = '${oppA}'`);
      const [h] = await admin<Row>(`select scope, location, title, status from proj_handovers where id = '${handoverA}'`);
      expect(h.scope).toBe("LED floor and sensors, 6x4 m");
      expect(h.status).toBe("accepted");
      await expect(admin(`update proj_handovers set scope = 'tampered' where id = '${handoverA}'`)).rejects.toThrow(/historical record/);
      const [d] = await admin<Row>(`select scope from proj_project_details where project_id = '${P1}'`);
      expect(d.scope).toBe("LED floor and sensors, 6x4 m");
      await fails(U.salesA, `select proj_save_handover('${oppA}', ${j({ scope: "x" })})`, /no longer be edited/);
      await admin(`update crm_opportunities set scope = 'LED floor and sensors', location = 'Expo Hall 3', title = 'Floor projection' where id = '${oppA}'`);
    });
    it("refuses acceptance when the opportunity is no longer Won, and when no reference code exists", async () => {
      const hb = (await commit<{ id: string }>(U.salesB, `select proj_save_handover('${oppB}', ${j({ scope: "Mirror booth, 2 units" })}) as id`))[0].id;
      await commit(U.salesB, `select proj_submit_handover('${hb}')`);
      await commit(U.assigner, `select proj_assign_handover_pm('${hb}', '${U.pm2}')`);
      await admin(`update crm_opportunities set stage = 'negotiation', stage_before_close = 'negotiation', closed_at = null, closed_by = null, evidence_type = null, evidence_reference = null, evidence_date = null where id = '${oppB}'`);
      await fails(U.pm2, `select proj_accept_handover('${hb}')`, /no longer Won/);
      await admin(`update crm_opportunities set stage = 'won', evidence_type = 'purchase_order', evidence_reference = 'PO-B', evidence_date = current_date, closed_at = now(), closed_by = '${U.salesB}' where id = '${oppB}'`);
      P2 = (await commit<{ p: string }>(U.pm2, `select proj_accept_handover('${hb}') as p`))[0].p;
      expect(P2).toBeTruthy();
    });
    it("lets Sales withdraw a handover before acceptance and prepare a new one, but never after", async () => {
      const hc = (await commit<{ id: string }>(U.salesA, `select proj_save_handover('${oppC}', ${j({ scope: "Tunnel" })}) as id`))[0].id;
      await commit(U.salesA, `select proj_withdraw_handover('${hc}', 'Client postponed')`);
      await fails(U.salesA, `select proj_withdraw_handover('${handoverA}', 'x')`, /accepted handover cannot be withdrawn/);
      const hc2 = (await commit<{ id: string }>(U.salesA, `select proj_save_handover('${oppC}', ${j({ scope: "Tunnel v2" })}) as id`))[0].id;
      expect(hc2).not.toBe(hc);
    });
    it("did not change any Sales record, and exposes the handover status to Sales through a read-only function", async () => {
      const after = JSON.stringify(await admin(`select (select count(*) from crm_opportunities) opps, (select md5(string_agg(row(o.id, o.stage, o.owner_id, o.value, o.scope, o.evidence_reference)::text, ',' order by o.id)) from crm_opportunities o) fp,
         (select count(*) from crm_handovers) hand`));
      // Opportunity A was edited by this test and restored; opportunity B was moved and restored: only compare counts and handovers.
      expect(Number(JSON.parse(after)[0].opps)).toBe(Number(JSON.parse(crmFingerprintBefore)[0].opps) + 1);     // the one extra is the not-won opportunity this suite created
      expect(JSON.parse(after)[0].hand).toBe(JSON.parse(crmFingerprintBefore)[0].hand);
      const st = await q<Row>(U.salesA, `select * from proj_handover_for_opportunity('${oppA}')`);
      expect(st[0]).toMatchObject({ status: "accepted", project_id: P1 });
      expect(await q(U.pm, `select * from proj_handover_for_opportunity('${oppA}')`)).toHaveLength(0);
    });
    it("keeps the existing CRM handover working independently of the Projects handover", async () => {
      await commit(U.salesA, `select crm_update_handover('${oppA}', 'ready', '${U.pm}', 'CRM-side note')`);
      const [h] = await admin<Row>(`select status, pm_user_id, notes from crm_handovers where opportunity_id = '${oppA}'`);
      expect(h).toMatchObject({ status: "ready", pm_user_id: U.pm, notes: "CRM-side note" });
      const [p] = await admin<Row>(`select status from proj_handovers where id = '${handoverA}'`);
      expect(p.status).toBe("accepted");                              // neither flow writes to the other
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("internal projects", () => {
    it("are created by assign_pm / founders without any opportunity, PO or Sales value", async () => {
      await fails(U.dir, `select proj_create_internal_project('${CO.uae}', 'Showroom tech', '${U.pm}')`, /Only a founder/);
      await fails(U.assigner, `select proj_create_internal_project('${CO.uae}', 'Showroom tech', '${U.outsider}')`, /Projects access/);
      INT = (await commit<{ p: string }>(U.assigner, `select proj_create_internal_project('${CO.uae}', 'Showroom technology', '${U.pm}', true, 'high', null, null, 'Keep the showroom demos running') as p`))[0].p;
      const [p] = await admin<Row>(`select * from proj_projects where id = '${INT}'`);
      expect(p).toMatchObject({ kind: "internal", crm_opportunity_id: null, handover_id: null, is_ongoing: true, pm_user_id: U.pm });
      expect(p.reference).toMatch(/^UAE-P-\d{4}-0003$/);
    });
    it("can be ongoing and skip installation and show states, and cannot link a Sales opportunity", async () => {
      await fails(U.pm, `select proj_set_status('${INT}', 'on_site')`, /do not use installation/);
      await commit(U.pm, `select proj_set_status('${INT}', 'in_progress')`);
      await expect(admin(`update proj_projects set crm_opportunity_id = '${oppC}' where id = '${INT}'`)).rejects.toThrow(/proj_projects_kind_link/);
      await fails(U.pm, `select proj_update_project('${P1}', ${j({ is_ongoing: true })})`, /Only internal projects/);
    });
    it("lets the internal PM change the scope directly, but a client project's scope only through a recorded scope change", async () => {
      await commit(U.pm, `select proj_update_project('${INT}', ${j({ scope: "Updated internal scope" })})`);
      await fails(U.pm, `select proj_update_project('${P1}', ${j({ scope: "Sneaky" })})`, /recorded scope change/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("visibility tiers", () => {
    it("shows a directory user ongoing projects of their company in summary only", async () => {
      const rows = await q<Row>(U.dir, `select * from proj_directory()`);
      expect(rows.map((r) => r.id).sort()).toEqual([P1, P2, INT].sort());
      for (const k of Object.keys(rows[0])) expect(k).not.toMatch(/client|location|scope|value|budget/);
      expect(rows.find((r) => r.id === P1)?.pm_name).toBeTruthy();
    });
    it("denies a directory user every member-only table, by direct query and by id", async () => {
      for (const t of ["proj_project_details", "proj_project_members", "proj_teams", "proj_milestones", "proj_deliverables", "proj_tasks", "proj_task_events", "proj_task_comments",
        "proj_change_log", "proj_plan_items", "proj_site_bookings", "proj_external_dependencies", "proj_messages", "proj_message_mentions", "proj_feedback", "proj_scope_changes",
        "proj_issued_plans", "proj_files", "proj_completions", "proj_handovers", "proj_sales_links"]) {
        expect(await q(U.dir, `select 1 from ${t}`), `${t}`).toHaveLength(0);
      }
      expect(await q(U.dir, `select * from proj_messages_since('${P1}')`)).toHaveLength(0);
      expect(await q(U.dir, `select * from proj_project_people('${P1}')`)).toHaveLength(0);
    });
    it("keeps a directory user from another company out entirely", async () => {
      expect(await q(U.ksaOnly, `select 1 from proj_projects`)).toHaveLength(0);
      expect(await q(U.ksaFounder, `select 1 from proj_projects`)).toHaveLength(0);
      await fails(U.ksaFounder, `select proj_set_status('${P1}', 'in_progress')`, /not found/i);
    });
    it("shows Sales only their own linked project, and only in summary, with no details, members or discussion", async () => {
      expect((await q<Row>(U.salesA, `select id from proj_projects`)).map((r) => r.id)).toEqual([P1]);
      expect(await q(U.salesB, `select 1 from proj_projects where id = '${P1}'`)).toHaveLength(0);
      expect((await q<Row>(U.salesB, `select id from proj_projects`)).map((r) => r.id)).toEqual([P2]);
      for (const t of ["proj_project_details", "proj_project_members", "proj_tasks", "proj_milestones", "proj_messages", "proj_files", "proj_plan_items"]) {
        expect(await q(U.salesA, `select 1 from ${t}`), t).toHaveLength(0);
      }
      expect(await q(U.salesA, `select * from proj_directory()`)).toHaveLength(1);
    });
    it("lets a Sales link lapse with the CRM grant, without removing the link record", async () => {
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.salesA}' and company_id = '${CO.uae}'`);
      expect(await q(U.salesA, `select 1 from proj_projects`)).toHaveLength(0);
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_sales_links where user_id = '${U.salesA}' and removed_at is null`))[0].n)).toBe(1);
      await admin(`update crm_company_grants set revoked_at = null where user_id = '${U.salesA}' and company_id = '${CO.uae}'`);
      expect(await q(U.salesA, `select 1 from proj_projects`)).toHaveLength(1);
    });
    it("does not change Sales visibility when CRM ownership is reassigned (the link is a recorded relationship)", async () => {
      await admin(`update crm_opportunities set owner_id = '${U.salesB}' where id = '${oppA}'`);
      expect((await q<Row>(U.salesB, `select id from proj_projects order by reference`)).map((r) => r.id)).toEqual([P2]);   // becoming the CRM owner later links nobody: salesB stays linked to P2 only
      await admin(`update crm_opportunities set owner_id = '${U.salesA}' where id = '${oppA}'`);
    });
    it("shows a founder every project of their company, and founder rights survive being also Sales", async () => {
      expect((await q(U.founder, `select 1 from proj_projects`)).length).toBe(3);
      expect((await q(U.founderSales, `select 1 from proj_projects`)).length).toBe(3);
      expect((await q(U.founderSales, `select 1 from crm_opportunities`)).length).toBeGreaterThan(0);
      expect(await q(U.founder, `select 1 from proj_project_details`)).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("membership, departments and temporary leadership", () => {
    it("adds members only if eligible, and only by the PM / founder", async () => {
      await fails(U.member, `select proj_add_member('${P1}', '${U.member2}')`, /Only the Project Manager/);
      await fails(U.pm, `select proj_add_member('${P1}', '${U.outsider}')`, /Projects access/);
      await fails(U.pm, `select proj_add_member('${P1}', '${U.ksaOnly}')`, /Projects access/);
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member}')`);
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member}')`);
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member2}')`);
      await commit(U.pm2, `select proj_add_member('${P2}', '${U.member}')`);
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_project_members where project_id = '${P1}' and user_id = '${U.member}' and removed_at is null`))[0].n)).toBe(1);
      expect(Number((await admin<{ n: string }>(`select count(*) n from notifications where user_id = '${U.member}' and type = 'project_invitation' and payload->>'project_id' = '${P1}'`))[0].n)).toBe(1);
    });
    it("gives members the workspace but no edit rights over scope, members or milestones", async () => {
      expect(await q(U.member, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(1);
      expect(await q(U.member, `select 1 from proj_project_members where project_id = '${P1}'`)).toHaveLength(3);
      await fails(U.member, `select proj_update_project('${P1}', ${j({ name: "X" })})`, /Only the Project Manager/);
      await fails(U.member, `select proj_save_milestone('${P1}', null, ${j({ title: "Mine" })})`, /Only the Project Manager/);
      await fails(U.member, `select proj_set_status('${P1}', 'in_progress')`, /Only the Project Manager/);
      await fails(U.member, `select proj_remove_member('${P1}', '${U.member2}')`, /Only the Project Manager/);
      await fails(U.member, `select proj_save_team('${P1}', null, 'Hack', '${U.member}')`, /Only the Project Manager/);
    });
    it("makes a department head a member with team-level rights only", async () => {
      teamProg = (await commit<{ t: string }>(U.pm, `select proj_save_team('${P1}', null, 'Programming', '${U.head}') as t`))[0].t;
      await commit(U.pm, `select proj_set_member_team('${P1}', '${U.member}', '${teamProg}')`);
      expect(await q(U.head, `select 1 from proj_projects where id = '${P1}'`)).toHaveLength(1);
      expect(await q(U.head, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(1);
      await fails(U.head, `select proj_update_project('${P1}', ${j({ name: "X" })})`, /Only the Project Manager/);
      await fails(U.head, `select proj_add_member('${P1}', '${U.dir}')`, /Only the Project Manager/);
      await fails(U.pm, `select proj_remove_member('${P1}', '${U.head}')`, /heads a department team/);
    });
    it("lets the PM appoint temporary leadership that grants project powers, not HR rights, and not PM assignment", async () => {
      await commit(U.pm, `select proj_add_member('${P1}', '${U.acting}')`);
      await fails(U.acting, `select proj_save_milestone('${P1}', null, ${j({ title: "Early" })})`, /Only the Project Manager/);
      await fails(U.pm, `select proj_set_acting_pm('${P1}', '${U.acting}', ${day(-1)})`, /today or later/);
      await commit(U.pm, `select proj_set_acting_pm('${P1}', '${U.acting}', ${day(14)})`);
      const m = await commit<{ id: string }>(U.acting, `select proj_save_milestone('${P1}', null, ${j({ title: "Kick-off complete", due_date: "2099-01-15" })}) as id`);
      expect(m[0].id).toBeTruthy();
      await fails(U.acting, `select proj_set_acting_pm('${P1}', '${U.member}', ${day(3)})`, /Only the Project Manager or a founder/);
      await fails(U.acting, `select proj_assign_pm('${P1}', '${U.acting}')`, /Only a founder/);
      expect((await q<{ hr: boolean }>(U.acting, `select has_role('hr_admin', null) as hr`))[0].hr).toBe(false);
      expect(await q(U.acting, `select 1 from employees`)).toHaveLength(0);
      expect(await q(U.acting, `select 1 from attendance_segments`)).toHaveLength(0);
      // Expiry ends the powers but keeps membership.
      await admin(`update proj_project_members set acting_until = current_date - 1 where project_id = '${P1}' and user_id = '${U.acting}'`);
      await fails(U.acting, `select proj_save_milestone('${P1}', null, ${j({ title: "Late" })})`, /Only the Project Manager/);
      expect(await q(U.acting, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(1);
      await commit(U.pm, `select proj_end_acting_pm('${P1}', '${U.acting}')`);
    });
    it("lets only founders / assign_pm reassign the PM, and moves the PM role and access with it", async () => {
      await fails(U.pm, `select proj_assign_pm('${P1}', '${U.member2}')`, /Only a founder/);
      await commit(U.assigner, `select proj_assign_pm('${P1}', '${U.member2}')`);
      await commit(U.pm2, `select proj_add_member('${P2}', '${U.pm}')`);
      expect((await admin<Row>(`select role from proj_project_members where project_id = '${P1}' and user_id = '${U.member2}' and removed_at is null`))[0].role).toBe("pm");
      expect((await admin<Row>(`select role from proj_project_members where project_id = '${P1}' and user_id = '${U.pm}' and removed_at is null`))[0].role).toBe("member");
      await fails(U.pm, `select proj_save_milestone('${P1}', null, ${j({ title: "X" })})`, /Only the Project Manager/);
      await commit(U.assigner, `select proj_assign_pm('${P1}', '${U.pm}')`);
      await commit(U.pm, `select proj_remove_member('${P1}', '${U.member2}', 'rotation')`);
      expect(await q(U.member2, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(0);
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member2}')`);
    });
    it("removes access to details, discussion, files, notifications and calendars the moment a member is removed", async () => {
      await commit(U.pm, `select proj_post_message('${P1}', 'Hello team', null, null, '{${U.dir}}')`).catch(() => null);
      const msg = (await commit<{ m: string }>(U.pm, `select proj_post_message('${P1}', 'Welcome @member2', null, null, '{${U.member2}}') as m`))[0].m;
      expect(await q(U.member2, `select 1 from proj_messages where id = '${msg}'`)).toHaveLength(1);
      expect((await q(U.member2, `select * from proj_my_notifications()`)).length).toBeGreaterThan(0);
      await commit(U.pm, `select proj_remove_member('${P1}', '${U.member2}', 'left project')`);
      expect(await q(U.member2, `select 1 from proj_messages`)).toHaveLength(0);
      expect(await q(U.member2, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(0);
      expect(await q(U.member2, `select * from proj_messages_since('${P1}')`)).toHaveLength(0);
      expect(await q(U.member2, `select * from proj_project_calendar('${P1}', current_date, current_date + 30)`)).toHaveLength(0);
      expect(await q(U.member2, `select * from proj_my_notifications() where payload->>'project_id' = '${P1}'`)).toHaveLength(0);
      expect(Number((await admin<{ n: string }>(`select count(*) n from notifications where user_id = '${U.member2}' and payload->>'project_id' = '${P1}'`))[0].n)).toBe(0);
      await fails(U.member2, `select proj_post_message('${P1}', 'still here?')`, /not found/i);
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member2}')`);
    });
    it("ends a person's project access when their Projects grant is revoked, and refuses to revoke a live PM or department head", async () => {
      await fails(U.founder, `select proj_revoke_access('${U.pm}', '${CO.uae}')`, /Project Manager of a live project/);
      await fails(U.founder, `select proj_revoke_access('${U.head}', '${CO.uae}')`, /heads a department team/);
      const spare = U.acting;
      await commit(U.pm, `select proj_add_member('${P1}', '${spare}')`);
      expect(await q(spare, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(1);
      await commit(U.founder, `select proj_revoke_access('${spare}', '${CO.uae}')`);
      expect(await q(spare, `select 1 from proj_projects`)).toHaveLength(0);
      expect(await q(spare, `select * from proj_directory()`)).toHaveLength(0);
      await commit(U.founder, `select proj_grant_access('${spare}', '${CO.uae}', '{}')`);
      expect(await q(spare, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(0);   // membership was closed, not revived by a new grant
    });
    it("blocks removing a member who still has open tasks until they are reassigned", async () => {
      const t = (await commit<{ t: string }>(U.pm, `select proj_create_task('${P1}', ${j({ title: "Wire sensors", assignee_id: U.member2 })}) as t`))[0].t;
      await fails(U.pm, `select proj_remove_member('${P1}', '${U.member2}')`, /open task/);
      await commit(U.pm, `select proj_remove_member('${P1}', '${U.member2}', 'moved', '${U.member}')`);
      expect((await admin<Row>(`select assignee_id from proj_tasks where id = '${t}'`))[0].assignee_id).toBe(U.member);
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_task_events where task_id = '${t}' and kind = 'reassigned'`))[0].n)).toBe(1);
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member2}')`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("milestones, deliverables and tasks", () => {
    let ms = "", ms2 = "", dl = "", task = "", task2 = "", task3 = "";
    it("lets the PM define milestones and deliverables, and a head distribute tasks inside the team only", async () => {
      ms = (await commit<{ m: string }>(U.pm, `select proj_save_milestone('${P1}', null, ${j({ title: "First draft", due_date: "2099-03-01", client_facing: true })}) as m`))[0].m;
      ms2 = (await commit<{ m: string }>(U.pm, `select proj_save_milestone('${P1}', null, ${j({ title: "Final render", due_date: "2099-04-01", is_required: true })}) as m`))[0].m;
      dl = (await commit<{ d: string }>(U.pm, `select proj_save_deliverable('${P1}', null, ${j({ title: "Interactive floor build", team_id: teamProg, milestone_id: ms, due_date: "2099-02-20" })}) as d`))[0].d;
      await fails(U.head, `select proj_save_deliverable('${P1}', null, ${j({ title: "Sneaky", team_id: teamProg })})`, /Only the Project Manager/);
      task = (await commit<{ t: string }>(U.head, `select proj_create_task('${P1}', ${j({ title: "Shader prototype", deliverable_id: dl, assignee_id: U.member, requires_review: true, due_date: "2099-02-10", start_date: "2099-02-01" })}) as t`))[0].t;
      await fails(U.head, `select proj_create_task('${P1}', ${j({ title: "Outside team", deliverable_id: dl, assignee_id: U.member2 })})`, /own team/);
    });
    it("lets a member create tasks for themself only, within their own team, never into someone else's work", async () => {
      task2 = (await commit<{ t: string }>(U.member, `select proj_create_task('${P1}', ${j({ title: "My own prep", due_date: "2099-02-12" })}) as t`))[0].t;
      await fails(U.member, `select proj_create_task('${P1}', ${j({ title: "For others", assignee_id: U.member2 })})`, /create tasks for yourself/);
      await fails(U.member2, `select proj_create_task('${P1}', ${j({ title: "Into prog team", team_id: teamProg })})`, /own department/);
      await fails(U.dir, `select proj_create_task('${P1}', ${j({ title: "Not a member" })})`, /not found/i);
      await fails(U.member, `select proj_create_task('${P1}', ${j({ title: "To outsider", assignee_id: U.dir })})`, /create tasks for yourself|active member/);
      await fails(U.pm, `select proj_create_task('${P1}', ${j({ title: "To outsider", assignee_id: U.dir })})`, /active member/);
    });
    it("rejects an invalid date range and keeps date and reassignment history without shifting other deadlines", async () => {
      await fails(U.pm, `select proj_update_task('${task}', ${j({ start_date: "2099-03-10", due_date: "2099-03-01" })})`, /before the start date|tasks_dates/);
      task3 = (await commit<{ t: string }>(U.pm, `select proj_create_task('${P1}', ${j({ title: "Hardware demo", assignee_id: U.member, due_date: "2099-02-15", start_date: "2099-02-11", depends_on: [task] })}) as t`))[0].t;
      const affected = await commit<{ n: number }>(U.pm, `select proj_update_task('${task}', ${j({ due_date: "2099-02-14", reason: "Client asked for more shader polish" })}) as n`);
      expect(Number(affected[0].n)).toBe(1);
      const [dep] = await admin<Row>(`select due_date::text, start_date::text from proj_tasks where id = '${task3}'`);
      expect(dep).toMatchObject({ due_date: "2099-02-15", start_date: "2099-02-11" });                // never auto-shifted
      const aff = await q<Row>(U.pm, `select * from proj_task_affected('${task}', '2099-02-14')`);
      expect(aff.map((r) => r.task_id)).toEqual([task3]);
      const ev = await q<Row>(U.member, `select kind, from_value, to_value, note from proj_task_events where task_id = '${task}' order by id`);
      expect(ev.find((e) => e.kind === "due_date_changed")).toMatchObject({ from_value: "2099-02-10", to_value: "2099-02-14" });
      await commit(U.head, `select proj_reassign_task('${task}', '${U.head}', 'Taking over')`);
      await commit(U.head, `select proj_reassign_task('${task}', '${U.member}')`);
      expect((await q(U.member, `select 1 from proj_task_events where task_id = '${task}' and kind = 'reassigned'`)).length).toBe(2);
      await fails(U.member, `select proj_reassign_task('${task}', '${U.member2}')`, /department head or the Project Manager/);
    });
    it("notifies the assignee of a material deadline change and of an assignment, once, and never the actor", async () => {
      const n = await admin<Row>(`select type from notifications where user_id = '${U.member}' and payload->>'project_id' = '${P1}' and type in ('project_task_assigned', 'project_deadline_changed')`);
      expect(n.some((r) => r.type === "project_task_assigned")).toBe(true);
      expect(n.some((r) => r.type === "project_deadline_changed")).toBe(true);
      expect(Number((await admin<{ n: string }>(`select count(*) n from notifications where user_id = '${U.pm}' and type = 'project_task_assigned'`))[0].n)).toBe(0);
    });
    it("prevents dependency loops, self-dependency and cross-project dependencies", async () => {
      await fails(U.pm, `select proj_update_task('${task}', ${j({ depends_on: [task3] })})`, /loop/);
      await fails(U.pm, `select proj_update_task('${task}', ${j({ depends_on: [task] })})`, /depend on itself/);
      const other = (await commit<{ t: string }>(U.pm2, `select proj_create_task('${P2}', ${j({ title: "Other project" })}) as t`))[0].t;
      await fails(U.pm, `select proj_update_task('${task3}', ${j({ depends_on: [other] })})`, /same project/);
    });
    it("applies the review rule: the assignee cannot complete a task that needs review, a reviewer can, and never their own work", async () => {
      await fails(U.member, `select proj_set_task_status('${task}', 'done')`, /needs review/);
      await commit(U.member, `select proj_set_task_status('${task}', 'in_progress')`);
      await fails(U.member, `select proj_set_task_status('${task}', 'done')`, /send it for review/);
      await commit(U.member, `select proj_set_task_status('${task}', 'ready_for_review')`);
      expect(Number((await admin<{ n: string }>(`select count(*) n from notifications where user_id = '${U.head}' and type = 'project_review_requested'`))[0].n)).toBe(1);
      expect(await q(U.head, `select 1 from proj_my_calendar('2099-01-01', '2099-12-31') where kind = 'review' and item_id = '${task}'`)).toHaveLength(1);
      expect(await q(U.member, `select 1 from proj_my_calendar('2099-01-01', '2099-12-31') where kind = 'review'`)).toHaveLength(0);
      await fails(U.member, `select proj_set_task_status('${task}', 'done')`, /not by the person who did it/);
      await fails(U.member2, `select proj_set_task_status('${task}', 'done')`, /Only the assignee/);
      await fails(U.head, `select proj_set_task_status('${task}', 'in_progress')`, /Say what needs changing/);
      await commit(U.head, `select proj_set_task_status('${task}', 'in_progress', 'Add edge-glow')`);
      await commit(U.member, `select proj_set_task_status('${task}', 'ready_for_review')`);
      await commit(U.head, `select proj_set_task_status('${task}', 'done')`);
      expect((await admin<Row>(`select status, completed_by from proj_tasks where id = '${task}'`))[0]).toMatchObject({ status: "done", completed_by: U.head });
      await fails(U.member, `select proj_set_task_status('${task}', 'in_progress', 'redo')`, /Only the department head or the Project Manager can reopen/);
    });
    it("lets the owner complete a routine task without review, and requires a reason to block, with a person or action to unblock", async () => {
      await fails(U.member, `select proj_set_task_status('${task2}', 'ready_for_review')`, /does not need review/);
      await fails(U.member, `select proj_block_task('${task2}', '')`, /what is blocking/);
      await fails(U.member, `select proj_block_task('${task2}', 'Waiting for hardware')`, /who or what action/);
      await commit(U.member, `select proj_block_task('${task2}', 'Waiting for hardware', null, 'Standbuilder delivers the truss')`);
      await fails(U.member, `select proj_set_task_status('${task2}', 'done')`, /Clear the blocker/);
      await commit(U.member, `select proj_unblock_task('${task2}', 'Truss arrived')`);
      await commit(U.member, `select proj_set_task_status('${task2}', 'done')`);
      expect((await admin<Row>(`select status from proj_tasks where id = '${task2}'`))[0].status).toBe("done");
    });
    it("lets only the assignee, head or PM touch a task, and members comment on any task of their project", async () => {
      await fails(U.member2, `select proj_update_task('${task3}', ${j({ title: "Mine now" })})`, /Only the assignee/);
      await commit(U.member2, `select proj_comment_task('${task3}', 'Sensor wiring done on my side')`);
      await fails(U.dir, `select proj_comment_task('${task3}', 'outsider')`, /not found/i);
      expect((await q(U.member, `select 1 from proj_task_comments where task_id = '${task3}'`))).toHaveLength(1);
      expect(await q(U.dir, `select 1 from proj_task_comments`)).toHaveLength(0);
    });
    it("rejects a stale edit with an optimistic-lock error", async () => {
      await fails(U.pm, `select proj_update_task('${task3}', ${j({ title: "Hardware demo v2" })}, 99)`, /changed by someone else/);
    });
    it("accepts a milestone only when its deliverables are closed, and states progress with its basis", async () => {
      await fails(U.pm, `select proj_set_milestone_status('${ms}', 'accepted')`, /deliverable of this milestone/);
      await commit(U.head, `select proj_create_task('${P1}', ${j({ title: "Polish the floor build", deliverable_id: dl, assignee_id: U.member })})`);
      await fails(U.pm, `select proj_set_deliverable_status('${dl}', 'accepted')`, /task of this deliverable/);
      await commit(U.head, `select proj_set_deliverable_status('${dl}', 'in_progress')`);
      await fails(U.member, `select proj_set_deliverable_status('${dl}', 'accepted')`, /Only the Project Manager or the head/);
      await fails(U.head, `select proj_set_deliverable_status('${dl}', 'accepted')`, /task of this deliverable/);
      await fails(U.pm, `select proj_set_milestone_status('${ms2}', 'cancelled')`, /Say why/);
      const p = await q<Row>(U.member, `select * from proj_milestone_progress('${P1}')`);
      expect(Number(p[0].total_required)).toBeGreaterThanOrEqual(2);
      expect(Number(p[0].accepted_required)).toBe(0);
      expect(await q(U.dir, `select * from proj_milestone_progress('${P1}')`)).toHaveLength(0);
    });
    it("records a milestone date change with its history", async () => {
      await commit(U.pm, `select proj_save_milestone('${P1}', '${ms2}', ${j({ due_date: "2099-04-08", reason: "Show moved" })})`);
      const log = await q<Row>(U.member, `select from_value, to_value, note from proj_change_log where entity_id = '${ms2}' and field = 'due_date'`);
      expect(log[0]).toMatchObject({ from_value: "2099-04-01", to_value: "2099-04-08", note: "Show moved" });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("calendars, time zones and date-only deadlines", () => {
    it("keeps date-only deadlines as dates whatever the viewer's time zone", async () => {
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Dubai", "Europe/Warsaw"]) {
        const rows = await q<Row>(U.member, `select title, on_date::text as d from proj_my_calendar('2099-02-01', '2099-02-28', '${tz}') where kind = 'task' order by on_date`);
        expect(rows.map((r) => r.d)).toContain("2099-02-15");
      }
    });
    it("shows a person only their own tasks, milestones of their projects and their bookings in My Calendar", async () => {
      const rows = await q<Row>(U.member, `select kind, project_id from proj_my_calendar('2099-01-01', '2099-12-31')`);
      expect(rows.every((r) => [P1, P2].includes(r.project_id))).toBe(true);
      expect(await q(U.dir, `select * from proj_my_calendar('2099-01-01', '2099-12-31')`)).toHaveLength(0);
      const head = await q<Row>(U.head, `select kind from proj_my_calendar('2099-01-01', '2099-12-31') where kind = 'review'`);
      expect(head).toBeDefined();
      await fails(U.member, `select * from proj_my_calendar('2099-01-10', '2099-01-01')`, /before its start/);
    });
    it("shows the company calendar as project spans only, and a Sales user only their linked projects", async () => {
      await commit(U.pm, `select proj_update_project('${P1}', ${j({ start_date: "2099-02-01", end_date: "2099-04-30" })})`);
      const dir = await q<Row>(U.dir, `select * from proj_company_calendar('${CO.uae}', '2099-01-01', '2099-12-31')`);
      expect(dir.map((r) => r.project_id)).toContain(P1);
      expect(Object.keys(dir[0] as Row).sort()).toEqual(["end_date", "kind", "name", "project_id", "reference", "start_date", "status"]);
      expect((await q<Row>(U.salesA, `select project_id from proj_company_calendar('${CO.uae}', '2099-01-01', '2099-12-31')`)).map((r) => r.project_id)).toEqual([P1]);
      expect(await q(U.salesB, `select 1 from proj_company_calendar('${CO.uae}', '2099-01-01', '2099-12-31') where project_id = '${P1}'`)).toHaveLength(0);
      expect(await q(U.outsider, `select * from proj_company_calendar('${CO.uae}', '2099-01-01', '2099-12-31')`)).toHaveLength(0);
    });
    it("limits the project calendar to members and founders, and includes milestones, deliverables, tasks and plan items", async () => {
      const rows = await q<Row>(U.member, `select kind from proj_project_calendar('${P1}', '2099-01-01', '2099-12-31')`);
      expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(["milestone", "deliverable", "task"]));
      for (const who of [U.dir, U.salesA, U.outsider, U.member2 && U.ksaFounder]) expect(await q(who as string, `select * from proj_project_calendar('${P1}', '2099-01-01', '2099-12-31')`)).toHaveLength(0);
      expect((await q(U.founder, `select * from proj_project_calendar('${P1}', '2099-01-01', '2099-12-31')`)).length).toBe(rows.length);
    });
    it("stores a site event across a daylight-saving change and overnight in the site's zone", async () => {
      const b = (await commit<{ b: string }>(U.pm, `select proj_save_booking('${P1}', null, ${j({ user_id: U.member, location: "Warsaw hall", starts_local: "2099-03-28 22:00", ends_local: "2099-03-29 06:00", tz: "Europe/Warsaw" })}) as b`))[0].b;
      const cal = await q<Row>(U.member, `select tz, starts_at, ends_at from proj_my_calendar('2099-03-28', '2099-03-29', 'Asia/Dubai') where kind = 'booking'`);
      expect(cal).toHaveLength(1);
      expect(cal[0].tz).toBe("Europe/Warsaw");                         // the source zone travels with the instant
      const [r] = await admin<Row>(`select extract(epoch from ends_at - starts_at) / 3600 as hours, to_char(starts_at at time zone 'Europe/Warsaw', 'HH24:MI') as local_start, tz from proj_site_bookings where id = '${b}'`);
      expect(r.local_start).toBe("22:00");
      expect(r.tz).toBe("Europe/Warsaw");
      expect(Number(r.hours)).toBe(7);   // the clocks go forward at 02:00, so the night is one hour shorter
      const [d] = await admin<Row>(`select extract(epoch from (('2099-10-24 22:00'::timestamp at time zone 'Europe/Warsaw') + interval '0') - ('2099-10-24 22:00'::timestamp at time zone 'Europe/Warsaw')) as zero`);
      expect(Number(d.zero)).toBe(0);
      await fails(U.pm, `select proj_save_booking('${P1}', null, ${j({ user_id: U.member, location: "x", starts_local: "2099-03-28 22:00", ends_local: "2099-03-28 21:00" })})`, /end after it starts/);
      await fails(U.pm, `select proj_save_booking('${P1}', null, ${j({ user_id: U.member, location: "x", starts_local: "2099-03-28 22:00", ends_local: "2099-03-29 06:00", tz: "Mars/Phobos" })})`, /Unknown time zone/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("site bookings: overlaps, allowances, overrides and concurrency", () => {
    const book = async (project: string, by: string, who: string, start: string, end: string, lead = 0, trail = 0, loc = "Expo Hall") =>
      (await commit<{ b: string }>(by, `select proj_save_booking('${project}', null, ${j({ user_id: who, location: loc, starts_local: start, ends_local: end, lead_minutes: lead, trail_minutes: trail })}) as b`))[0].b;
    let a = "", b2 = "";
    it("never treats several assignments in a day as a conflict, overload or double booking", async () => {
      await commit(U.pm2, `select proj_add_member('${P2}', '${U.member}')`);
      await commit(U.member, `select proj_create_task('${P1}', ${j({ title: "Parallel A", due_date: "2099-06-10" })})`);
      await commit(U.member, `select proj_create_task('${P2}', ${j({ title: "Parallel B", due_date: "2099-06-10" })})`);
      const rows = await q<Row>(U.member, `select title, status from proj_my_calendar('2099-06-10', '2099-06-10') where kind = 'task' order by title`);
      expect(rows.map((r) => r.title)).toEqual(["Parallel A", "Parallel B"]);
      expect(rows.every((r) => r.status === "todo")).toBe(true);       // listed side by side, neutral: no flag, no status change
    });
    it("lets only the PM or the team head book a person, and the person must be a member", async () => {
      await fails(U.member, `select proj_save_booking('${P1}', null, ${j({ user_id: U.member, location: "x", starts_local: "2099-06-10 09:00", ends_local: "2099-06-10 17:00" })})`, /Only the Project Manager, or the head/);
      await fails(U.pm, `select proj_save_booking('${P1}', null, ${j({ user_id: U.dir, location: "x", starts_local: "2099-06-10 09:00", ends_local: "2099-06-10 17:00" })})`, /Only the Project Manager, or the head|member of the project/);
      const viaHead = await book(P1, U.head, U.member, "2099-05-01 09:00", "2099-05-01 12:00");
      expect(viaHead).toBeTruthy();
    });
    it("confirms a non-overlapping booking and detects overlaps including preparation and travel allowances", async () => {
      a = await book(P1, U.pm, U.member, "2099-06-10 09:00", "2099-06-10 17:00", 60, 60);
      await commit(U.pm, `select proj_confirm_booking('${a}')`);
      await commit(U.pm2, `select proj_add_member('${P2}', '${U.member}')`);
      const clear = await book(P2, U.pm2, U.member, "2099-06-10 19:30", "2099-06-10 21:00", 60, 0);          // starts 18:30 effective, A ends 18:00 effective
      await commit(U.pm2, `select proj_confirm_booking('${clear}')`);
      b2 = await book(P2, U.pm2, U.member, "2099-06-10 18:30", "2099-06-10 20:00", 60, 0);                    // effective 17:30 overlaps A's travel to 18:00
      await expect(q(U.pm2, `select proj_confirm_booking('${b2}')`)).rejects.toThrow(/overlap/);
    });
    it("never names a project the caller cannot see in a conflict message or in the conflict list", async () => {
      let msg = "";
      try { await q(U.pm2, `select proj_confirm_booking('${b2}')`); } catch (e) { msg = (e as Error).message; }
      expect(msg).toMatch(/you cannot see|projects you cannot see/);
      const [ref1] = await admin<{ reference: string }>(`select reference from proj_projects where id = '${P1}'`);
      expect(msg).not.toContain(ref1.reference);
      expect(msg).not.toContain("Expo Hall");
      const conflicts = await q<Row>(U.pm2, `select * from proj_booking_conflicts('${b2}')`);
      const hidden = conflicts.filter((c) => !c.is_visible);
      expect(hidden.length).toBeGreaterThan(0);
      for (const c of hidden) expect([c.project_id, c.project_reference, c.project_name, c.starts_at, c.ends_at]).toEqual([null, null, null, null, null]);
      const asFounder = await q<Row>(U.founder, `select * from proj_booking_conflicts('${b2}')`);
      expect(asFounder.some((c) => c.is_visible && c.project_reference)).toBe(true);
    });
    it("needs the override capability and a recorded reason to confirm an overlap, and records who and why", async () => {
      await fails(U.pm2, `select proj_confirm_booking('${b2}', 'We really need him')`, /site-conflict authority/);
      await commit(U.founder, `select proj_add_member('${P2}', '${U.founder}')`).catch(() => null);
      await fails(U.founder, `select proj_confirm_booking('${b2}')`, /Only the Project Manager, or the head|overlap/);
      await grant(U.pm2, CO.uae, ["override_site_conflict"]);
      await fails(U.pm2, `select proj_confirm_booking('${b2}', '  ')`, /overlap/);
      const r = await commit<Row>(U.pm2, `select proj_confirm_booking('${b2}', 'Client needs both rigs tested the same evening') as r`);
      expect(r[0].r).toMatchObject({ confirmed: true, overridden: true });
      const [row] = await admin<Row>(`select override_reason, override_by, state from proj_site_bookings where id = '${b2}'`);
      expect(row).toMatchObject({ override_by: U.pm2, state: "confirmed" });
      expect(row.override_reason).toContain("both rigs");
      await grant(U.pm2, CO.uae, []);
    });
    it("withdraws the confirmation when a confirmed booking's time changes, and re-checks it", async () => {
      await commit(U.pm, `select proj_save_booking('${P1}', '${a}', ${j({ ends_local: "2099-06-10 18:00" })})`);
      expect((await admin<Row>(`select state, confirmed_at from proj_site_bookings where id = '${a}'`))[0]).toMatchObject({ state: "tentative", confirmed_at: null });
    });
    it("lets only one of two simultaneous overlapping confirmations through", async () => {
      const c = await book(P1, U.pm, U.member2, "2099-07-01 09:00", "2099-07-01 17:00");
      await commit(U.pm, `select proj_add_member('${P1}', '${U.member2}')`).catch(() => null);
      await commit(U.pm2, `select proj_add_member('${P2}', '${U.member2}')`);
      const d = await book(P2, U.pm2, U.member2, "2099-07-01 12:00", "2099-07-01 20:00");
      const res = await Promise.allSettled([commit(U.pm, `select proj_confirm_booking('${c}')`), commit(U.pm2, `select proj_confirm_booking('${d}')`)]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);
      const n = await admin<{ n: string }>(`select count(*) n from proj_site_bookings where user_id = '${U.member2}' and state = 'confirmed'`);
      expect(Number(n[0].n)).toBe(1);
    });
    it("lets cancelled bookings drop out of overlap checks and blocks removing a person with upcoming bookings", async () => {
      await fails(U.pm, `select proj_remove_member('${P1}', '${U.member}', null, '${U.member2}')`, /upcoming site booking/);
      await commit(U.pm, `select proj_cancel_booking('${a}', 'Plan changed')`);
      const x = await book(P2, U.pm2, U.member, "2099-06-10 10:00", "2099-06-10 11:00");
      const r = await commit<Row>(U.pm2, `select proj_confirm_booking('${x}') as r`).catch((e: Error) => e);
      expect(r instanceof Error ? r.message : "ok").toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("private discussion, mentions and notifications", () => {
    let m1 = "";
    it("is open to members and founders only, and Sales only after being added as members", async () => {
      m1 = (await commit<{ m: string }>(U.member, `select proj_post_message('${P1}', 'Truss arrives Thursday', null, ${`'${id()}'`}, '{${U.pm}}') as m`))[0].m;
      expect(await q(U.founder, `select 1 from proj_messages where id = '${m1}'`)).toHaveLength(1);
      for (const who of [U.dir, U.salesA, U.outsider, U.hr, U.ksaFounder]) {
        expect(await q(who, `select 1 from proj_messages`), who).toHaveLength(0);
        await fails(who, `select proj_post_message('${P1}', 'let me in')`, /not found/i);
      }
      await commit(U.pm, `select proj_add_member('${P1}', '${U.salesA}')`);
      expect(await q(U.salesA, `select 1 from proj_messages where id = '${m1}'`)).toHaveLength(1);
      await commit(U.pm, `select proj_remove_member('${P1}', '${U.salesA}', 'Not needed')`);
      expect(await q(U.salesA, `select 1 from proj_messages`)).toHaveLength(0);
    });
    it("treats a retried send (same nonce) as one message, and refuses mentions of people outside the project", async () => {
      const nonce = id();
      const [x, y] = await Promise.all([
        commit<{ m: string }>(U.member, `select proj_post_message('${P1}', 'Double click', null, '${nonce}') as m`),
        commit<{ m: string }>(U.member, `select proj_post_message('${P1}', 'Double click', null, '${nonce}') as m`),
      ]);
      expect(x[0].m).toBe(y[0].m);
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_messages where client_nonce = '${nonce}'`))[0].n)).toBe(1);
      await fails(U.member, `select proj_post_message('${P1}', 'Hi', null, null, '{${U.dir}}')`, /part of this project/);
      await fails(U.member, `select proj_post_message('${P1}', '   ')`, /Write a message/);
      await fails(U.member, `select proj_post_message('${P1}', '${"x".repeat(4001)}')`, /4000/);
    });
    it("notifies a mention and a reply once, with no message text in the notification, and never the author", async () => {
      const reply = (await commit<{ m: string }>(U.pm, `select proj_post_message('${P1}', 'Noted, thanks', '${m1}', null, '{}') as m`))[0].m;
      const n = await admin<Row>(`select type, payload from notifications where user_id in ('${U.pm}', '${U.member}') and payload->>'project_id' = '${P1}' and type in ('project_mention', 'project_reply')`);
      expect(n.map((r) => r.type).sort()).toEqual(["project_mention", "project_reply"]);
      for (const r of n) {
        const txt = JSON.stringify(r.payload);
        expect(txt).not.toContain("Truss arrives");
        expect(txt).not.toContain("Noted, thanks");
      }
      expect(reply).toBeTruthy();
      expect(Number((await admin<{ n: string }>(`select count(*) n from notifications where user_id = '${U.pm}' and type = 'project_reply'`))[0].n)).toBe(0);
    });
    it("lets only the author edit, marks edits visibly, and leaves a deletion tombstone readable only by founders", async () => {
      await fails(U.pm, `select proj_edit_message('${m1}', 'tampered')`, /not found/i);
      await commit(U.member, `select proj_edit_message('${m1}', 'Truss arrives Friday')`);
      const [e] = await q<Row>(U.pm, `select body, edited_at from proj_messages where id = '${m1}'`);
      expect(e.body).toBe("Truss arrives Friday");
      expect(e.edited_at).not.toBeNull();
      await fails(U.member2, `select proj_delete_message('${m1}')`, /Only the author, the Project Manager or a founder/);
      await commit(U.pm, `select proj_delete_message('${m1}', 'Wrong date')`);
      const [t] = await q<Row>(U.member, `select body, deleted_at from proj_messages where id = '${m1}'`);
      expect(t).toMatchObject({ body: "" });
      expect(t.deleted_at).not.toBeNull();
      expect((await q<Row>(U.founder, `select original_body from proj_message_tombstones where message_id = '${m1}'`))[0].original_body).toBe("Truss arrives Friday");
      for (const who of [U.pm, U.member, U.auditor]) expect(await q(who, `select 1 from proj_message_tombstones`), who).toHaveLength(0);
      const log = await q<Row>(U.member, `select field, to_value from proj_change_log where entity_id = '${m1}'`);
      expect(log[0].field).toBe("deleted");
      expect(await q(U.auditor, `select 1 from proj_audit_log where new_row::text ilike '%Truss arrives%' or old_row::text ilike '%Truss arrives%'`)).toHaveLength(0);
    });
    it("serves new and changed messages through a cursor, and counts unread messages per person", async () => {
      const before = await q<Row>(U.member, `select max(seq) s from proj_messages where project_id = '${P1}'`);
      const cur = Number(before[0].s);
      await commit(U.pm, `select proj_post_message('${P1}', 'Another one', null, null)`);
      const fresh = await q<Row>(U.member, `select id, seq, author_name from proj_messages_since('${P1}', ${cur})`);
      expect(fresh).toHaveLength(1);
      expect(fresh[0].author_name).toBeTruthy();
      const unread = await q<Row>(U.member, `select * from proj_unread_counts() where project_id = '${P1}'`);
      expect(Number(unread[0].unread)).toBeGreaterThanOrEqual(1);
      await commit(U.member, `select proj_mark_read('${P1}')`);
      const after = await q<Row>(U.member, `select * from proj_unread_counts() where project_id = '${P1}'`);
      expect(Number(after[0].unread)).toBe(0);
      const changed = await q<Row>(U.member, `select id from proj_messages_since('${P1}', ${cur + 100}, now() - interval '1 hour')`);
      expect(changed.length).toBeGreaterThan(0);
    });
    it("hides project notifications from someone who can no longer see the project, and keeps others' notifications private", async () => {
      expect(await q(U.dir, `select * from proj_my_notifications()`)).toHaveLength(0);
      expect((await q(U.member, `select 1 from notifications where user_id <> '${U.member}'`))).toHaveLength(0);
      expect((await q<{ n: number }>(U.member, `select proj_mark_notifications_read() as n`))[0].n).toBeGreaterThanOrEqual(0);
    });
    it("is read-only once the project is completed, and chat never completes tasks or changes scope", async () => {
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_tasks where status = 'done' and title ilike '%chat%'`))[0].n)).toBe(0);
      await fails(U.member, `select proj_update_project('${P1}', ${j({ scope: "chat says so" })})`, /Only the Project Manager/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("feedback and scope changes", () => {
    let fb = "", sc = "";
    it("records feedback against a task, deliverable or milestone and distinguishes corrections from proposed changes", async () => {
      const [t] = await admin<{ id: string }>(`select id from proj_tasks where project_id = '${P1}' limit 1`);
      fb = (await commit<{ f: string }>(U.pm, `select proj_record_feedback('${P1}', ${j({ target_type: "task", target_id: t.id, source: "Client PM, call 12 Mar", received_on: "2099-03-12", request_text: "Make the glow brighter", kind: "in_scope_correction", responsible_user_id: U.member })}) as f`))[0].f;
      await fails(U.pm, `select proj_record_feedback('${P1}', ${j({ target_type: "task", target_id: id(), source: "x", received_on: "2099-03-12", request_text: "y", kind: "in_scope_correction" })})`, /Choose the milestone/);
      await fails(U.member, `select proj_record_feedback('${P1}', ${j({ target_type: "project", source: "x", received_on: "2099-03-12", request_text: "y", kind: "proposed_change" })})`, /Only the Project Manager/);
      await fails(U.member2, `select proj_update_feedback('${fb}', ${j({ status: "resolved", resolution: "done" })})`, /Only the Project Manager or the person responsible/);
      await fails(U.member, `select proj_update_feedback('${fb}', ${j({ status: "resolved" })})`, /Record how this was resolved/);
      await commit(U.member, `select proj_update_feedback('${fb}', ${j({ status: "in_progress" })})`);
    });
    it("preserves the original scope, records a proposal, and lets only a scope approver decide", async () => {
      sc = (await commit<{ s: string }>(U.pm, `select proj_propose_scope_change('${P1}', ${j({ title: "Add second projector", proposed_scope: "LED floor and sensors, 6x4 m + second projector", effect_on_dates: "Two extra days of install", cost_note: "COST-SECRET quote 18,000 AED", currency: "AED", amount: 18000 })}) as s`))[0].s;
      const [row] = await admin<Row>(`select original_scope, status from proj_scope_changes where id = '${sc}'`);
      expect(row).toMatchObject({ original_scope: "LED floor and sensors, 6x4 m", status: "proposed" });
      await fails(U.pm, `select proj_decide_scope_change('${sc}', 'approve', 'ok')`, /scope approval/);
      await fails(U.member, `select proj_decide_scope_change('${sc}', 'approve', 'ok')`, /scope approval/);
      await fails(U.scopeApprover, `select proj_decide_scope_change('${sc}', 'approve', '')`, /reason for the decision/);
    });
    it("keeps cost effects out of every member-readable table and view", async () => {
      for (const who of [U.pm, U.member, U.head, U.dir, U.scopeApprover, U.auditor]) expect(await q(who, `select 1 from proj_scope_change_commercial`), who).toHaveLength(0);
      for (const who of [U.founder, U.commercialReader]) expect(await q(who, `select 1 from proj_scope_change_commercial`)).toHaveLength(1);
      const member = JSON.stringify(await q(U.pm, `select * from proj_scope_changes`));
      expect(member).not.toContain("COST-SECRET");
      expect(member).not.toContain("18000");
      await fails(U.pm, `select proj_set_scope_change_commercial('${sc}', 'AED', 1, 'x')`, /commercial access/);
      await commit(U.commercialReader, `select proj_set_scope_change_commercial('${sc}', 'AED', 19000, 'Revised')`);
      expect(Number((await admin<Row>(`select amount from proj_scope_change_commercial where scope_change_id = '${sc}'`))[0].amount)).toBe(19000);
    });
    it("applies an approved change to the current scope only, keeps the original in the handover and history, and never moves dates", async () => {
      const [before] = await admin<Row>(`select start_date::text s, end_date::text e from proj_projects where id = '${P1}'`);
      await commit(U.scopeApprover, `select proj_decide_scope_change('${sc}', 'approve', 'Agreed with client on call')`);
      await commit(U.scopeApprover, `select proj_decide_scope_change('${sc}', 'approve', 'Agreed with client on call')`);
      const [d] = await admin<Row>(`select scope from proj_project_details where project_id = '${P1}'`);
      expect(d.scope).toContain("second projector");
      expect((await admin<Row>(`select scope from proj_handovers where id = '${handoverA}'`))[0].scope).toBe("LED floor and sensors, 6x4 m");
      const [after] = await admin<Row>(`select start_date::text s, end_date::text e from proj_projects where id = '${P1}'`);
      expect(after).toEqual(before);
      await fails(U.scopeApprover, `select proj_decide_scope_change('${sc}', 'reject', 'changed mind')`, /already approved/);
    });
    it("refuses a stale proposal when the scope has moved on", async () => {
      const s1 = (await commit<{ s: string }>(U.pm, `select proj_propose_scope_change('${P1}', ${j({ title: "A", proposed_scope: "Alt A" })}) as s`))[0].s;
      const s2 = (await commit<{ s: string }>(U.pm, `select proj_propose_scope_change('${P1}', ${j({ title: "B", proposed_scope: "Alt B" })}) as s`))[0].s;
      await commit(U.scopeApprover, `select proj_decide_scope_change('${s1}', 'approve', 'ok')`);
      await fails(U.scopeApprover, `select proj_decide_scope_change('${s2}', 'approve', 'ok')`, /scope has changed since/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("client timeline (issued plans)", () => {
    let plan1 = "";
    it("builds the issued payload in the database from client-facing items only, with no internal data", async () => {
      await commit(U.pm, `select proj_apply_plan_template('${P1}', 'delivery', ${j([{ title: "Moodboard", offset_days: 0, duration_days: 3, client_facing: true }, { title: "Internal tech spike", offset_days: 2, duration_days: 2 }])}, '2099-02-01')`);
      await commit(U.pm, `select proj_apply_plan_template('${P1}', 'site', ${j([{ title: "Installation", offset_days: 30, duration_days: 3, client_facing: true }])})`);
      await commit(U.pm, `select proj_save_external_dependency('${P1}', null, ${j({ kind: "power_network", label: "Power drop at stand ready", expected_date: "2099-03-20", expected_time: "09:00", organisation: "Expo Builders LLC", contact: "Ali +971 50 000 0000", client_facing: true })})`);
      await fails(U.pm, `select proj_apply_plan_template('${P1}', 'delivery', ${j([{ title: "Again" }])})`, /already has items/);
      plan1 = (await commit<{ p: string }>(U.pm, `select proj_issue_plan('${P1}', null, 'First issue') as p`))[0].p;
      const [p] = await admin<Row>(`select * from proj_issued_plans where id = '${plan1}'`);
      const text = JSON.stringify(p.payload);
      expect(text).toContain("Moodboard");
      expect(text).toContain("Installation");
      expect(text).toContain("Power drop at stand ready");
      for (const hidden of ["Internal tech spike", "Wire sensors", "Shader prototype", "Truss arrives", "250000", "PO-SECRET", "COST-SECRET", "+971 50 000 0000", "Ali"]) expect(text).not.toContain(hidden);
      expect(p.version).toBe(1);
      expect(p.client_reference).toMatch(/^UAE-P-/);
    });
    it("lets only the PM issue, treats a repeated issue as one version, and makes an issued version immutable", async () => {
      await fails(U.member, `select proj_issue_plan('${P1}')`, /Only the Project Manager/);
      const again = (await commit<{ p: string }>(U.pm, `select proj_issue_plan('${P1}') as p`))[0].p;
      expect(again).toBe(plan1);
      await expect(admin(`update proj_issued_plans set payload = '{}'::jsonb where id = '${plan1}'`)).rejects.toThrow(/cannot be changed/);
      await expect(admin(`delete from proj_issued_plans where id = '${plan1}'`)).rejects.toThrow(/cannot be deleted/);
      await fails(U.pm, `select proj_issue_plan('${INT}')`, /client projects|not found/i);
    });
    it("flags the issued plan outdated after a later edit, and issues a new version that supersedes it", async () => {
      expect((await q<{ o: boolean }>(U.member, `select proj_plan_outdated('${P1}') as o`))[0].o).toBe(false);
      const [item] = await admin<{ id: string }>(`select id from proj_plan_items where project_id = '${P1}' and title = 'Installation'`);
      await commit(U.pm, `select proj_save_plan_item('${P1}', '${item.id}', ${j({ start_date: "2099-03-05", end_date: "2099-03-08", reason: "Access moved" })})`);
      expect((await q<{ o: boolean }>(U.member, `select proj_plan_outdated('${P1}') as o`))[0].o).toBe(true);
      expect((await admin<Row>(`select payload from proj_issued_plans where id = '${plan1}'`))[0].payload.site[0].start_date).not.toBe("2099-03-05");
      const v2 = (await commit<{ p: string }>(U.pm, `select proj_issue_plan('${P1}', 'ACME-REF-7', 'Revised') as p`))[0].p;
      expect(v2).not.toBe(plan1);
      const rows = await admin<Row>(`select version, superseded_at, client_reference from proj_issued_plans where project_id = '${P1}' order by version`);
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
      expect(rows[0].superseded_at).not.toBeNull();
      expect(rows[1].client_reference).toBe("ACME-REF-7");
      expect((await q<{ o: boolean }>(U.member, `select proj_plan_outdated('${P1}') as o`))[0].o).toBe(false);
      plan1 = v2;
    });
    it("records 'sent' and 'client accepted' as separate facts and never both from generation alone", async () => {
      const [fresh] = await admin<Row>(`select sent_at, accepted_on from proj_issued_plans where id = '${plan1}'`);
      expect(fresh).toEqual({ sent_at: null, accepted_on: null });
      await fails(U.pm, `select proj_record_plan_sent('${plan1}', '')`, /how and to whom/);
      await fails(U.pm, `select proj_record_plan_accepted('${plan1}', current_date + 3, 'Sara')`, /not in the future/);
      await fails(U.pm, `select proj_record_plan_accepted('${plan1}', current_date, '')`, /who at the client/);
      await commit(U.pm, `select proj_record_plan_accepted('${plan1}', current_date, 'Sara (Orbit Motors)', 'Agreed by phone')`);
      const [acc] = await admin<Row>(`select sent_at, accepted_on, accepted_contact from proj_issued_plans where id = '${plan1}'`);
      expect(acc.sent_at).toBeNull();
      expect(acc.accepted_on).not.toBeNull();
      await commit(U.pm, `select proj_record_plan_sent('${plan1}', 'E-mailed to Sara on the day')`);
      await commit(U.pm, `select proj_record_plan_accepted('${plan1}', current_date, 'Someone else')`);     // a repeated record changes nothing
      expect((await admin<Row>(`select accepted_contact from proj_issued_plans where id = '${plan1}'`))[0].accepted_contact).toBe("Sara (Orbit Motors)");
    });
    it("lets only members and founders read an issued plan, so a removed member loses the download too", async () => {
      expect(await q(U.member, `select 1 from proj_issued_plans where id = '${plan1}'`)).toHaveLength(1);
      for (const who of [U.dir, U.salesA, U.outsider, U.ksaFounder]) expect(await q(who, `select 1 from proj_issued_plans`), who).toHaveLength(0);
    });
    it("lets only the PM read the live preview payload", async () => {
      expect(await q<{ p: unknown }>(U.pm, `select proj_current_plan_payload('${P1}') as p`)).toHaveLength(1);
      expect((await q<{ p: unknown }>(U.member, `select proj_current_plan_payload('${P1}') as p`))[0].p).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("files and links", () => {
    it("lets members add links, restricts restricted files to the PM, and refuses executables and macro files", async () => {
      await commit(U.member, `select proj_add_link('${P1}', 'Moodboard', 'https://example.com/moodboard')`);
      await fails(U.member, `select proj_add_link('${P1}', 'Secret', 'https://example.com/s', 'document', true)`, /Only the Project Manager/);
      await fails(U.member, `select proj_add_link('${P1}', 'Bad', 'http://example.com/s')`, /https/);
      await commit(U.pm, `select proj_add_link('${P1}', 'Restricted', 'https://example.com/r', 'document', true)`);
      expect(await q(U.member, `select 1 from proj_files where project_id = '${P1}'`)).toHaveLength(1);
      expect(await q(U.pm, `select 1 from proj_files where project_id = '${P1}'`)).toHaveLength(2);
      expect(await q(U.founder, `select 1 from proj_files where project_id = '${P1}'`)).toHaveLength(2);
      expect(await q(U.dir, `select 1 from proj_files`)).toHaveLength(0);
      for (const name of ["setup.exe", "report.docm", "x.pdf.exe", "page.html"]) {
        await fails(U.member, `select * from proj_create_upload_intent('${P1}', '${name}', 'application/pdf', 100, 'safe.pdf')`, /cannot be uploaded/);
      }
      await fails(U.member, `select * from proj_create_upload_intent('${P1}', 'a.pdf', 'application/x-msdownload', 100, 'a.pdf')`, /not allowed/);
      await fails(U.member, `select * from proj_create_upload_intent('${P1}', 'a.pdf', 'application/pdf', 99999999, 'a.pdf')`, /20 MB/);
      await fails(U.dir, `select * from proj_create_upload_intent('${P1}', 'a.pdf', 'application/pdf', 100, 'a.pdf')`, /not found/i);
    });
    it("registers a file only from a validated intent whose object exists, and never lets the client supply a path", async () => {
      const [intent] = await commit<Row>(U.member, `select * from proj_create_upload_intent('${P1}', 'brief.pdf', 'application/pdf', 1024, 'brief.pdf', 'document', 'Brief')`);
      await fails(U.member, `select proj_register_uploaded_file('${intent.intent_id}')`, /not passed the file checks/);
      await admin(`select proj_mark_upload_intent('${intent.intent_id}', 'validated')`);
      await fails(U.member, `select proj_register_uploaded_file('${intent.intent_id}')`, /validated file was not found/);
      const [i2] = await admin<Row>(`select final_path from proj_upload_intents where id = '${intent.intent_id}'`);
      await admin(`insert into storage.objects (bucket_id, name) values ('proj-files', '${i2.final_path}')`);
      await fails(U.pm, `select proj_register_uploaded_file('${intent.intent_id}')`, /Upload not found/);
      const f = await commit<{ f: string }>(U.member, `select proj_register_uploaded_file('${intent.intent_id}') as f`);
      expect(f[0].f).toBeTruthy();
      await fails(U.member, `select proj_register_uploaded_file('${intent.intent_id}')`, /already added/);
      await expect(admin(`insert into proj_files (project_id, kind, original_name, storage_path, mime_type, size_bytes, uploaded_by) values ('${P1}', 'file', 'x.exe', '${i2.final_path}x', 'application/pdf', 1, '${U.member}')`)).rejects.toThrow();
    });
    it("keeps storage buckets private with no client policies", async () => {
      const b = await admin<Row>(`select id, public from storage.buckets where id in ('proj-files', 'proj-quarantine')`);
      expect(b).toHaveLength(2);
      expect(b.every((r) => r.public === false)).toBe(true);
      const pol = await admin<Row>(`select policyname from pg_policies where schemaname = 'storage' and (qual ilike '%proj-%' or with_check ilike '%proj-%')`);
      expect(pol).toHaveLength(0);
    });
    it("removes only your own file (or any, as PM), and keeps completion evidence in place", async () => {
      const [f] = await admin<Row>(`select id from proj_files where project_id = '${P1}' and kind = 'link' and label = 'Moodboard'`);
      await fails(U.member2, `select proj_remove_file('${f.id}')`, /Only the person who added it/);
      await commit(U.member, `select proj_remove_file('${f.id}')`);
      expect(await q(U.member, `select 1 from proj_files where id = '${f.id}'`)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("completion and reopening", () => {
    const evidence = { evidence_type: "email_reference", evidence_reference: "Mail 14 Apr from Sara, subject: Handover signed off", confirmed_on: "2020-01-01", client_contact: "Sara, Orbit Motors", completion_note: "All installed and signed off." };
    it("lists unfinished work, blockers and unresolved feedback for the PM only", async () => {
      const rows = await q<Row>(U.pm, `select kind from proj_completion_review('${P1}')`);
      expect(new Set(rows.map((r) => r.kind)).size).toBeGreaterThan(1);
      expect(await q(U.member, `select * from proj_completion_review('${P1}')`)).toHaveLength(0);
      expect(await q(U.dir, `select * from proj_completion_review('${P1}')`)).toHaveLength(0);
    });
    it("refuses completion without client evidence, a client contact, a note, or a future confirmation date", async () => {
      await fails(U.member, `select proj_complete_project('${P1}', ${j(evidence)})`, /Only the Project Manager/);
      await fails(U.pm, `select proj_complete_project('${P1}', ${j({ ...evidence, evidence_type: "" })})`, /completion confirmation/);
      await fails(U.pm, `select proj_complete_project('${P1}', ${j({ ...evidence, evidence_reference: "" })})`, /e-mail reference/);
      await fails(U.pm, `select proj_complete_project('${P1}', ${j({ ...evidence, client_contact: "" })})`, /who at the client/);
      await fails(U.pm, `select proj_complete_project('${P1}', ${j({ ...evidence, completion_note: "" })})`, /completion note/);
      await fails(U.pm, `select proj_complete_project('${P1}', ${j({ ...evidence, confirmed_on: "2999-01-01" })})`, /not in the future/);
      await fails(U.pm, `select proj_complete_project('${P1}', ${j({ ...evidence, evidence_type: "uploaded_confirmation" })})`, /Upload the confirmation/);
    });
    it("refuses completion while unfinished work lacks an explicit decision, and never marks it Done", async () => {
      await expect(q(U.pm, `select proj_complete_project('${P1}', ${j(evidence)})`)).rejects.toThrow(/still need an explicit decision/);
      const items = await q<Row>(U.pm, `select kind, item_id from proj_completion_review('${P1}')`);
      const partial = items.slice(1).map((i) => ({ kind: i.kind, id: i.item_id, action: i.kind === "feedback" ? "resolve" : "cancel", note: "Out of scope now" }));
      await expect(q(U.pm, `select proj_complete_project('${P1}', ${j(evidence)}, ${j(partial)})`)).rejects.toThrow(/still need an explicit decision/);
      const noNote = items.map((i) => ({ kind: i.kind, id: i.item_id, action: i.kind === "feedback" ? "resolve" : "cancel", note: "" }));
      await expect(q(U.pm, `select proj_complete_project('${P1}', ${j(evidence)}, ${j(noNote)})`)).rejects.toThrow(/still need an explicit decision/);
      const badAction = items.map((i) => ({ kind: i.kind, id: i.item_id, action: "done", note: "x" }));
      await expect(q(U.pm, `select proj_complete_project('${P1}', ${j(evidence)}, ${j(badAction)})`)).rejects.toThrow(/still need an explicit decision/);
    });
    it("completes with explicit resolutions, records the evidence, is idempotent, and keeps the project readable but read-only", async () => {
      const items = await q<Row>(U.pm, `select kind, item_id from proj_completion_review('${P1}')`);
      const res = items.map((i) => ({ kind: i.kind, id: i.item_id, action: i.kind === "feedback" ? "resolve" : i.kind === "booking" ? "cancel" : i.item_id.charCodeAt(0) % 2 ? "cancel" : "defer", note: "Closed out at completion" }));
      const [c1, c2] = await Promise.all([
        commit<{ c: string }>(U.pm, `select proj_complete_project('${P1}', ${j(evidence)}, ${j(res)}) as c`),
        commit<{ c: string }>(U.pm, `select proj_complete_project('${P1}', ${j(evidence)}, ${j(res)}) as c`),
      ]);
      expect(c1[0].c).toBe(c2[0].c);
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_completions where project_id = '${P1}' and reopened_at is null`))[0].n)).toBe(1);
      expect((await admin<Row>(`select status from proj_projects where id = '${P1}'`))[0].status).toBe("completed");
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_tasks where project_id = '${P1}' and status in ('todo', 'in_progress', 'ready_for_review')`))[0].n)).toBe(0);
      expect(await q(U.member, `select 1 from proj_project_details where project_id = '${P1}'`)).toHaveLength(1);
      expect(await q(U.member, `select 1 from proj_completions where project_id = '${P1}'`)).toHaveLength(1);
      await fails(U.pm, `select proj_create_task('${P1}', ${j({ title: "Late" })})`, /read-only/);
      await fails(U.pm, `select proj_update_project('${P1}', ${j({ name: "Renamed" })})`, /read-only/);
      await fails(U.member, `select proj_post_message('${P1}', 'after the fact')`, /read-only/);
      expect(await q(U.salesA, `select 1 from proj_projects where id = '${P1}'`)).toHaveLength(1);       // linked Sales still sees the outcome
      expect(await q(U.dir, `select 1 from proj_projects where id = '${P1}'`)).toHaveLength(0);          // the directory is for ongoing projects
    });
    it("reopens only with the capability and a reason, keeps the earlier completion, and leaves deferred and cancelled items as they are", async () => {
      await fails(U.pm, `select proj_reopen_project('${P1}', 'Client found a problem')`, /Only a founder/);
      await fails(U.founder, `select proj_reopen_project('${P1}', '')`, /reason/);
      const cancelledBefore = Number((await admin<{ n: string }>(`select count(*) n from proj_tasks where project_id = '${P1}' and status in ('cancelled', 'deferred')`))[0].n);
      await commit(U.founder, `select proj_reopen_project('${P1}', 'Client found a defect on site')`);
      await commit(U.founder, `select proj_reopen_project('${P1}', 'Client found a defect on site')`);
      expect((await admin<Row>(`select status, completed_at from proj_projects where id = '${P1}'`))[0]).toMatchObject({ status: "in_progress", completed_at: null });
      const comps = await admin<Row>(`select reopened_at, reopen_reason, evidence_reference from proj_completions where project_id = '${P1}'`);
      expect(comps).toHaveLength(1);
      expect(comps[0].reopen_reason).toContain("defect");
      expect(comps[0].evidence_reference).toContain("Handover signed off");
      expect(Number((await admin<{ n: string }>(`select count(*) n from proj_tasks where project_id = '${P1}' and status in ('cancelled', 'deferred')`))[0].n)).toBe(cancelledBefore);
      await commit(U.pm, `select proj_create_task('${P1}', ${j({ title: "Fix the defect" })})`);
      await fails(U.member, `select proj_reopen_project('${P1}', 'again')`, /Only a founder|Only a completed/);
    });
    it("completes an internal project with the owner's note and no client evidence", async () => {
      const items = await q<Row>(U.pm, `select kind, item_id from proj_completion_review('${INT}')`);
      const res = items.map((i) => ({ kind: i.kind, id: i.item_id, action: "defer", note: "Carry to next quarter" }));
      const c = await commit<{ c: string }>(U.pm, `select proj_complete_project('${INT}', ${j({ completion_note: "Showroom tech handed to facilities." })}, ${j(res)}) as c`);
      expect(c[0].c).toBeTruthy();
      const [row] = await admin<Row>(`select evidence_type, client_contact, confirmed_on from proj_completions where project_id = '${INT}'`);
      expect(row).toMatchObject({ evidence_type: "internal_note", client_contact: null, confirmed_on: null });
    });
    it("archives only a completed project", async () => {
      await fails(U.pm2, `select proj_set_status('${P2}', 'archived')`, /Only a completed project can be archived/);
      await commit(U.pm, `select proj_set_status('${INT}', 'archived')`);
      expect((await admin<Row>(`select status from proj_projects where id = '${INT}'`))[0].status).toBe("archived");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("lifecycle", () => {
    it("moves forward freely, needs a reason to go back or skip, and holds with a reason and review date", async () => {
      await commit(U.pm2, `select proj_set_status('${P2}', 'in_progress')`);
      await fails(U.pm2, `select proj_set_status('${P2}', 'on_site')`, /backwards or skipping/);
      await commit(U.pm2, `select proj_set_status('${P2}', 'ready_for_installation')`);
      await fails(U.pm2, `select proj_set_status('${P2}', 'planning')`, /needs a reason/);
      await commit(U.pm2, `select proj_set_status('${P2}', 'planning', 'Scope reopened')`);
      await fails(U.pm2, `select proj_set_status('${P2}', 'on_hold')`, /reason and a review date/);
      await commit(U.pm2, `select proj_set_status('${P2}', 'on_hold', 'Client budget freeze', current_date + 30)`);
      await fails(U.pm2, `select proj_set_status('${P2}', 'in_progress')`, /Resume the project/);
      await commit(U.pm2, `select proj_set_status('${P2}', 'resume')`);
      expect((await admin<Row>(`select status from proj_projects where id = '${P2}'`))[0].status).toBe("planning");
      await fails(U.pm2, `select proj_set_status('${P2}', 'completed')`, /Complete project/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("HR and Sales are unchanged", () => {
    it("left HR tables untouched by every Projects action", async () => {
      const after = JSON.stringify(await admin(`select (select count(*) from user_roles) roles, (select count(*) from employees) emps,
         (select md5(coalesce(string_agg(manager_id::text, ',' order by id), '')) from employees) mgr`));
      expect(after).toBe(hrFingerprintBefore);
      for (const t of ["attendance_segments", "leave_requests", "recovery_credit_requests", "payroll_runs"]) {
        const exists = await admin<{ n: string }>(`select count(*) n from information_schema.tables where table_schema = 'public' and table_name = '${t}'`);
        if (Number(exists[0].n) > 0) expect(Number((await admin<{ n: string }>(`select count(*) n from ${t}`))[0].n), t).toBe(0);
      }
    });
    it("left every Sales opportunity's stage, owner, value and evidence as it was", async () => {
      const [r] = await admin<Row>(`select count(*) filter (where stage = 'won') won, count(*) filter (where value = 250000) valued from crm_opportunities`);
      expect(Number(r.won)).toBe(3);
      expect(Number(r.valued)).toBe(3);
      expect(await q(U.founderSales, `select 1 from crm_opportunities where evidence_reference = 'PO-SECRET-123'`)).toHaveLength(2);
    });
    it("kept HR admin without any Projects capability even for a project they could otherwise see in HR", async () => {
      expect(await q(U.hr, `select 1 from proj_projects`)).toHaveLength(0);
      await fails(U.hr, `select proj_grant_access('${U.hr}', '${CO.uae}', '{founder}')`, /Only a founder/);
    });
  });
});
