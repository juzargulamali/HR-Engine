import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Inventory planning (migration 20261201000400). Proves, against a real Postgres built from the migrations:
//   * templates are recipes: draft / complete / retired, versioned, and editing one never changes an existing request line;
//   * requests for projects and employees, planning dates in the request's zone converted to UTC (Europe/Warsaw daylight saving);
//   * expansion as a snapshot, alternatives and the substitution rule (the warehouse never accepts a substitute alone);
//   * reservations: units through the exclusion constraint AND a pre-check, quantities through the item lock, under real parallel
//     connections; partial fulfilment with a reported shortage; kits counted once; draft / damaged / employee / overdue never reserved;
//   * date changes that never displace another reservation; cancellation that leaves dispatched equipment outstanding;
//   * Sales checks that reserve nothing, go out of date when the opportunity moves, and say "Warehouse check required" when unsure;
//   * the handover import (idempotent, never blocks the handover) and the project completion hook (never blocks completion);
//   * that Sales and PM views carry no cost, employee or unrelated project data, and that no CRM / Projects / HR row changes.
//
// These tests build the database from the migrations up to and including the planning migration and do NOT depend on the stock
// functions (migration 4): units, balances, locations and dispatched states are created with admin SQL. Set INV_PLANNING_ALL=1 to
// include every migration that sorts before the planning one (including the stock functions).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FIRST_CRM_MIGRATION = "20261115000000_crm_access_audit_settings.sql";
const PLANNING_MIGRATION = "20261201000400_inv_planning_functions.sql";
const STOCK_PREFIX = "20261201000300";
const WITH_STOCK = process.env.INV_PLANNING_ALL === "1";
const LATE_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f >= FIRST_CRM_MIGRATION && f <= PLANNING_MIGRATION && f.endsWith(".sql") && (WITH_STOCK || !f.startsWith(STOCK_PREFIX)))
  .sort();

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = {
  founder: id(), whA: id(), whB: id(), whC: id(), whRev: id(), cat: id(), viewer: id(), browser: id(), head: id(), headNoCap: id(),
  pm: id(), pm2: id(), pm3: id(), projFounder: id(), memberOnly: id(), salesA: id(), salesB: id(), crmFounder: id(), mgr: id(), emp: id(),
  empTerminated: id(), outsider: id(), ksaFounder: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-plan.ae')`).join(", ");
const DENIED = /permission denied|row-level security|not allowed|Only |not found|do not have|cannot|must be|needs|can no longer|read-only|already|unknown|not eligible|access|Choose/i;

const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const arr = (ids: string[]) => `array[${ids.map((x) => `'${x}'`).join(",")}]::uuid[]`;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Planning windows in 2030 (far in the future, so "now" never moves under the tests). Dubai has no daylight saving.
const W1 = { dispatch: "2030-06-10 09:00", return_due: "2030-06-15 18:00" };
const W2 = { dispatch: "2030-06-12 09:00", return_due: "2030-06-20 18:00" };
const W3 = { dispatch: "2030-07-01 09:00", return_due: "2030-07-05 18:00" };
const SECRET = { employee: "Zorbulon", project: "SECRETPROJ Mirage", cost: "7777.77", serial: "SER-SECRET-4711", unitCodeTag: "UAE-E-SECRET" };

describe("Inventory planning", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string, params: unknown[] = []) => db.asUser(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const fails = (user: string | null, sql: string, re: RegExp = DENIED) => expect(q(user, sql)).rejects.toThrow(re);
  const one = async <T = unknown>(user: string, sql: string) => (await commit<{ v: T }>(user, `select (${sql}) as v`))[0].v;
  const num = async (sql: string) => Number((await admin<{ n: string }>(sql))[0].n);

  let seq = 0;
  const nm = (p: string) => `${p} ${++seq}`;
  const LOC = { a: id(), b: id(), ksa: id() };
  const PRJ = { p1: id(), p2: id(), p3: id(), secret: id(), done: id(), arch: id(), boom: id() };
  const EMP = { mgr: id(), emp: id(), terminated: id(), ksa: id() };
  let agencyId = "", clientId = "";
  let hrBefore = "", crmBefore = "", projBefore = "";

  async function newItem(tracking: string, o: { name?: string; scale?: number; company?: string; status?: string; model?: string } = {}) {
    const rows = await admin<{ id: string }>(`insert into inv_items (company_id, name, tracking, quantity_scale, status, model)
      values ('${o.company ?? CO.uae}', '${o.name ?? nm("Item")}', '${tracking}', ${o.scale ?? 0}, '${o.status ?? "active"}', ${o.model ? `'${o.model}'` : "null"}) returning id`);
    return rows[0].id;
  }
  async function newUnit(item: string, o: { code?: string; life?: string; cond?: string; custody?: string; loc?: string; serial?: string; employee?: string;
    project?: string; kit?: string; repair?: string; returnAt?: string; ownership?: string; transfer?: string } = {}) {
    const custody = o.custody ?? "warehouse";
    const loc = custody === "kit" ? null : o.loc ?? LOC.a;           // a unit that is out keeps the place it left from
    const rows = await admin<{ id: string }>(`insert into inv_units (company_id, item_id, code, lifecycle, condition, custody_kind, location_id, serial_number, employee_id,
        project_id, in_kit_id, repair_reference, transfer_id, expected_return_at${o.life === "retired" ? ", retired_at" : ""})
      values ('${CO.uae}', '${item}', '${o.code ?? nm("UAE-E-T")}', '${o.life ?? "active"}', '${o.cond ?? "good"}', '${custody}', ${loc ? `'${loc}'` : "null"},
        ${o.serial ? `'${o.serial}'` : "null"}, ${o.employee ? `'${o.employee}'` : "null"}, ${o.project ? `'${o.project}'` : "null"},
        ${o.kit ? `'${o.kit}'` : "null"}, ${o.repair ? `'${o.repair}'` : "null"}, ${o.transfer ? `'${o.transfer}'` : "null"}, ${o.returnAt ?? "null"}${o.life === "retired" ? ", now()" : ""}) returning id`);
    return rows[0].id;
  }
  async function newBalance(item: string, qty: number, o: { loc?: string; holder?: string; project?: string; condition?: string; returnAt?: string } = {}) {
    const holder = o.holder ?? "warehouse";
    const rows = await admin<{ id: string }>(`insert into inv_balances (company_id, item_id, holder_kind, location_id, project_id, condition, qty, expected_return_at)
      values ('${CO.uae}', '${item}', '${holder}', ${holder === "warehouse" ? `'${o.loc ?? LOC.a}'` : "null"}, ${o.project ? `'${o.project}'` : "null"},
        '${o.condition ?? "good"}', ${qty}, ${o.returnAt ?? "null"}) returning id`);
    return rows[0].id;
  }
  async function mkTech(name: string, comps: { item: string; qty: number; alt?: string; opt?: boolean; note?: string; sort?: number }[], status = "complete") {
    const t = await one<string>(U.cat, `inv_save_technology('${CO.uae}', null, '${name}', 'recipe')`);
    await commit(U.cat, `select inv_save_technology_components('${t}', ${j(comps.map((c, i) => ({ item_id: c.item, qty: c.qty, alt_group: c.alt ?? null, is_optional: c.opt ?? false, note: c.note ?? null, sort_order: c.sort ?? (i + 1) * 10 })))})`);
    if (status !== "draft") await commit(U.cat, `select inv_set_technology_status('${t}', '${status}')`);
    return t;
  }
  /** A project request with lines, submitted, made by the project's PM. */
  async function mkRequest(lines: { item: string; qty: number }[], o: { project?: string; pm?: string; plan?: Record<string, string>; submit?: boolean; tz?: string } = {}) {
    const pm = o.pm ?? U.pm;
    const req = await one<string>(pm, `inv_create_request('project', '${o.project ?? PRJ.p1}', null, 'Test request', ${j(o.plan ?? W1)}, '${o.tz ?? "Asia/Dubai"}')`);
    const ids: string[] = [];
    for (const l of lines) ids.push(await one<string>(pm, `inv_add_request_line('${req}', '${l.item}', ${l.qty})`));
    if (o.submit !== false) await commit(pm, `select inv_submit_request('${req}')`);
    return { req, lines: ids as [string, string, string, string, ...string[]] };
  }
  const reserve = (user: string, line: string, loc: string, extra = "") => commit<{ r: Row }>(user, `select inv_reserve('${line}', '${loc}'${extra}) as r`).then((r) => r[0].r);
  const resCount = async (line: string, status = "active") => num(`select coalesce(sum(qty), 0) n from inv_reservations where request_line_id = '${line}' and status = '${status}'`);

  async function mkOpp(owner: string, o: { techs?: unknown[]; install?: string; start?: string; end?: string; location?: string; scope?: string } = {}) {
    const rows = await commit<{ id: string }>(owner, `select crm_create_opportunity(p_company_id => '${CO.uae}', p_title => '${nm("Opp")}', p_source => 'agency_call', p_next_title => 'Call',
        p_next_due => now() + interval '2 days', p_agency_org_id => '${agencyId}', p_client_org_id => '${clientId}') as id`);
    const oppId = rows[0].id;
    await admin(`update crm_opportunities set technologies = ${j(o.techs ?? [])}, install_start = ${o.install ? `'${o.install}'` : "null"}, event_start = ${o.start ? `'${o.start}'` : "null"},
      event_end = ${o.end ? `'${o.end}'` : "null"}, location = ${o.location ? `'${o.location}'` : "null"}, scope = '${o.scope ?? "LED floor and rigging"}', value = 100000 where id = '${oppId}'`);
    return oppId;
  }
  async function winOpp(oppId: string, owner: string) {
    await commit(owner, `select crm_mark_won('${oppId}', 'purchase_order', 'PO-WIN-1', current_date)`);
  }
  async function handoverAccept(oppId: string, owner: string, pm: string) {
    const h = await one<string>(owner, `proj_save_handover('${oppId}', '{}'::jsonb)`);
    await commit(owner, `select proj_submit_handover('${h}')`);
    await commit(U.projFounder, `select proj_assign_handover_pm('${h}', '${pm}')`);
    return h;
  }

  beforeAll(async () => {
    await db.setupBefore(FIRST_CRM_MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
    `);
    // What a real Supabase project does for every new object in public: broad default grants. The migrations must undo them themselves.
    await db.seed(`
      alter default privileges in schema public grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
      alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    for (const f of LATE_MIGRATIONS) await db.applyMigration(f);
    await db.seed(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
    await db.seed(`
      insert into inv_company_settings (company_id, reference_code) values ('${CO.uae}', 'UAE'), ('${CO.ksa}', 'KSA');
      insert into inv_locations (id, company_id, code, name, timezone) values
        ('${LOC.a}', '${CO.uae}', 'DXB', 'Dubai warehouse', 'Asia/Dubai'), ('${LOC.b}', '${CO.uae}', 'POZ', 'Poznan warehouse', 'Europe/Warsaw'),
        ('${LOC.ksa}', '${CO.ksa}', 'RUH', 'Riyadh warehouse', 'Asia/Riyadh');
      insert into inv_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.whA}', '${CO.uae}', '{warehouse}'), ('${U.whB}', '${CO.uae}', '{warehouse}'),
        ('${U.whC}', '${CO.uae}', '{warehouse}'), ('${U.whRev}', '${CO.uae}', '{warehouse}'), ('${U.cat}', '${CO.uae}', '{manage_catalogue}'),
        ('${U.viewer}', '${CO.uae}', '{view_stock}'), ('${U.browser}', '${CO.uae}', '{}'), ('${U.head}', '${CO.uae}', '{request_for_employees}'),
        ('${U.headNoCap}', '${CO.uae}', '{}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}');
      insert into inv_operator_locations (company_id, user_id, location_id) values
        ('${CO.uae}', '${U.whA}', '${LOC.a}'), ('${CO.uae}', '${U.whB}', '${LOC.b}'), ('${CO.uae}', '${U.whC}', '${LOC.a}'), ('${CO.uae}', '${U.whRev}', '${LOC.a}');
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.salesA}', '${CO.uae}', '{}'), ('${U.salesB}', '${CO.uae}', '{}'), ('${U.crmFounder}', '${CO.uae}', '{founder}');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.projFounder}', '${CO.uae}', '{founder}'), ('${U.pm}', '${CO.uae}', '{}'), ('${U.pm2}', '${CO.uae}', '{}'), ('${U.pm3}', '${CO.uae}', '{}'),
        ('${U.memberOnly}', '${CO.uae}', '{}'), ('${U.whC}', '${CO.uae}', '{}');
      -- Projects created directly (internal kind: the handover import trigger is for client projects only).
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${PRJ.p1}', '${CO.uae}', 'UAE-P-T1', 'Alpha stage', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.p2}', '${CO.uae}', 'UAE-P-T2', 'Beta arena', 'internal', 'in_progress', '${U.pm2}', '${U.pm2}'),
        ('${PRJ.p3}', '${CO.uae}', 'UAE-P-T3', 'Gamma gallery', 'internal', 'in_progress', '${U.pm3}', '${U.pm3}'),
        ('${PRJ.secret}', '${CO.uae}', 'UAE-P-T4', '${SECRET.project}', 'internal', 'in_progress', '${U.pm3}', '${U.pm3}'),
        ('${PRJ.done}', '${CO.uae}', 'UAE-P-T5', 'Done deal', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.arch}', '${CO.uae}', 'UAE-P-T6', 'Archive me', 'internal', 'in_progress', '${U.pm}', '${U.pm}'),
        ('${PRJ.boom}', '${CO.uae}', 'UAE-P-T7', 'Boom', 'internal', 'in_progress', '${U.pm}', '${U.pm}');
      insert into proj_project_details (project_id, site_timezone) select id, 'Asia/Dubai' from proj_projects;
      insert into proj_project_members (project_id, user_id, role) values
        ('${PRJ.p1}', '${U.pm}', 'pm'), ('${PRJ.p2}', '${U.pm2}', 'pm'), ('${PRJ.p3}', '${U.pm3}', 'pm'), ('${PRJ.secret}', '${U.pm3}', 'pm'),
        ('${PRJ.done}', '${U.pm}', 'pm'), ('${PRJ.arch}', '${U.pm}', 'pm'), ('${PRJ.boom}', '${U.pm}', 'pm'),
        ('${PRJ.p1}', '${U.memberOnly}', 'member'), ('${PRJ.secret}', '${U.whC}', 'member');
      -- Employees (HR): a manager, an employee reporting to them, a terminated employee, one in the other company.
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, manager_id, employment_status) values
        ('${EMP.mgr}', '${U.mgr}', 'E1', '${CO.uae}', 'AE', 'Marta', 'Manager', current_date - 900, null, 'active'),
        ('${EMP.emp}', '${U.emp}', 'E2', '${CO.uae}', 'AE', '${SECRET.employee}', 'Employee', current_date - 400, '${EMP.mgr}', 'active'),
        ('${EMP.terminated}', '${U.empTerminated}', 'E3', '${CO.uae}', 'AE', 'Tom', 'Gone', current_date - 800, '${EMP.mgr}', 'terminated'),
        ('${EMP.ksa}', null, 'K1', '${CO.ksa}', 'SA', 'Kareem', 'Saudi', current_date - 100, null, 'active');
    `);
    agencyId = (await commit<{ id: string }>(U.salesA, `select crm_create_organisation('Zeta Media LLC', 'agency', 'Dubai') as id`))[0].id;
    clientId = (await commit<{ id: string }>(U.salesA, `select crm_create_organisation('Orbit Motors', 'client', 'Riyadh') as id`))[0].id;
  });

  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("installation and privileges", () => {
    it("closes every internal helper and trigger function, opens the client functions to signed-in users only", async () => {
      const names = ["inv_save_technology", "inv_save_technology_components", "inv_set_technology_status", "inv_create_request", "inv_save_request_plan",
        "inv_add_request_line", "inv_expand_technology", "inv_update_request_line", "inv_cancel_request_line", "inv_submit_request", "inv_cancel_request",
        "inv_propose_substitution", "inv_decide_substitution", "inv_set_shortage_action", "inv_reserve", "inv_release_reservation", "inv_change_request_window",
        "inv_availability", "inv_technology_availability", "inv_request_opportunity_check", "inv_record_opportunity_check", "inv_opportunity_availability",
        "inv_project_equipment", "inv_import_handover_requirements"];
      const internal = ["inv_user_name", "inv_check_version", "inv_lock_request", "inv_can_edit_request", "inv_require_edit", "inv_plan_window", "inv_effective_item",
        "inv_reserve_block_reason", "inv_free_count", "inv_expand_into_request", "inv_release_row", "inv_release_unused", "inv_cancel_request_internal",
        "inv_demand_check", "inv_opportunity_compute", "inv_import_handover_internal", "inv_line_progress", "inv_proj_after_insert", "inv_proj_after_status"];
      const rows = await admin<Row>(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${[...names, ...internal].map((n) => `'${n}'`).join(",")}])`);
      for (const n of names) {
        const r = rows.filter((x) => x.proname === n);
        expect(r.length, n).toBeGreaterThan(0);
        expect(r.every((x) => x.auth === true && x.anon === false), n).toBe(true);
      }
      for (const n of internal) {
        const r = rows.filter((x) => x.proname === n);
        expect(r.length, n).toBeGreaterThan(0);
        expect(r.every((x) => x.auth === false && x.anon === false), n).toBe(true);
      }
    });
    it("denies anonymous callers", async () => {
      await expect(q(null, `select inv_availability('${id()}', '${LOC.a}', now(), now() + interval '1 day')`)).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select inv_project_equipment('${PRJ.p1}')`)).rejects.toThrow(/permission denied/i);
    });
    it("refuses direct writes to every planning table, even where the harness grants DML", async () => {
      for (const t of ["inv_technologies", "inv_technology_components", "inv_requests", "inv_request_lines", "inv_reservations", "inv_availability_checks", "inv_import_log"]) {
        for (const user of [U.founder, U.pm, U.whA]) {
          const res = await db.asUser(user, async (query) => {
            try { return (await query(`delete from ${t}`)).rowCount; } catch (e) { return (e as Error).message; }
          });
          expect(res === 0 || (typeof res === "string" && DENIED.test(res)), `${t}: ${String(res)}`).toBe(true);
          const ins = await db.asUser(user, async (query) => {
            try { return (await query(`insert into ${t} select * from ${t} where false`)).rowCount; } catch (e) { return (e as Error).message; }
          });
          expect(ins === 0 || (typeof ins === "string" && DENIED.test(ins)), `${t}: ${String(ins)}`).toBe(true);
        }
      }
      const item = await newItem("quantity");
      await db.asUser(U.founder, async (query) => {
        await expect(query(`insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, reserved_during, made_by)
          values ('${CO.uae}', '${id()}', '${item}', '${LOC.a}', 1, tstzrange(now(), now() + interval '1 day'), '${U.founder}')`)).rejects.toThrow(DENIED);
      });
    });
    it("adds only the two documented triggers on proj_projects and no policy that allows a write", async () => {
      const trg = await admin<{ tgname: string }>(`select tgname from pg_trigger where tgrelid = 'proj_projects'::regclass and not tgisinternal and tgname like 'inv\\_%' order by 1`);
      expect(trg.map((t) => t.tgname)).toEqual(["inv_proj_projects_import", "inv_proj_projects_release"]);
      const pol = await admin<Row>(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename in ('inv_requests', 'inv_request_lines', 'inv_reservations', 'inv_technologies') and cmd <> 'SELECT'`);
      expect(pol).toHaveLength(0);
    });
    it("never reads or writes a CRM, Projects or HR table from a planning function except the documented reads", async () => {
      const fns = await admin<{ proname: string; src: string }>(`select proname, prosrc as src from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('inv_proj_after_insert', 'inv_proj_after_status', 'inv_import_handover_internal', 'inv_opportunity_compute', 'inv_create_request', 'inv_request_opportunity_check',
                        'inv_record_opportunity_check', 'inv_reserve', 'inv_cancel_request_internal', 'inv_change_request_window')`);
      expect(fns.length).toBe(10);
      for (const f of fns) {
        expect(f.src, f.proname).not.toMatch(/\b(insert\s+into|update|delete\s+from)\s+(crm_|proj_|employees|user_roles|assets|asset_assignments)/i);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("technology templates", () => {
    let head1 = "", head2 = "", truss = "", tech = "";
    it("lets only catalogue managers (and founders) create and edit templates, in their own company", async () => {
      head1 = await newItem("individual", { name: nm("Moving head X1") });
      head2 = await newItem("individual", { name: nm("Moving head X2") });
      truss = await newItem("quantity", { name: nm("Truss 2m") });
      await fails(U.whA, `select inv_save_technology('${CO.uae}', null, 'Nope', null)`, /Only catalogue managers/);
      await fails(U.viewer, `select inv_save_technology('${CO.uae}', null, 'Nope', null)`, /Only catalogue managers/);
      await fails(U.pm, `select inv_save_technology('${CO.uae}', null, 'Nope', null)`, /Only catalogue managers/);
      await fails(U.ksaFounder, `select inv_save_technology('${CO.uae}', null, 'Nope', null)`, /Only catalogue managers/);
      await fails(U.outsider, `select inv_save_technology('${CO.uae}', null, 'Nope', null)`, /Only catalogue managers/);
      await fails(U.cat, `select inv_save_technology('${CO.uae}', null, '   ', null)`, /name/);
      tech = await one<string>(U.cat, `inv_save_technology('${CO.uae}', null, '${nm("Wall")}', 'LED wall')`);
      expect((await admin<Row>(`select status, version from inv_technologies where id = '${tech}'`))[0]).toMatchObject({ status: "draft", version: 1 });
      expect(await one<string>(U.founder, `inv_save_technology('${CO.uae}', null, '${nm("Founder tech")}', null)`)).toBeTruthy();
    });
    it("refuses a duplicate name, a stale version, and components that are wrong", async () => {
      const name = nm("Dup");
      await one<string>(U.cat, `inv_save_technology('${CO.uae}', null, '${name}', null)`);
      await fails(U.cat, `select inv_save_technology('${CO.uae}', null, '${name.toUpperCase()}', null)`, /already exists/);
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: head1, qty: 1 }])}, 99)`, /changed by someone else/);
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: head1, qty: 1 }, { item_id: head1, qty: 2 }])})`, /appears twice/);
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: head1, qty: 0 }])})`, /more than zero/);
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: head1, qty: 1.5 }])})`, /decimal/);
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: id(), qty: 1 }])})`, /does not exist in this company/);
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: head1, qty: 1, alt_group: "g" }, { item_id: head2, qty: 1, alt_group: "g", is_optional: true }])})`, /required, or all optional/);
      const ksaItem = await newItem("quantity", { company: CO.ksa });
      await fails(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: ksaItem, qty: 1 }])})`, /does not exist in this company/);
    });
    it("bumps the version on every edit, needs a required component to be complete, and treats a draft as no basis for availability", async () => {
      const v0 = (await admin<Row>(`select version from inv_technologies where id = '${tech}'`))[0].version;
      await fails(U.cat, `select inv_set_technology_status('${tech}', 'complete')`, /at least one required component/);
      await commit(U.cat, `select inv_save_technology_components('${tech}', ${j([{ item_id: head1, qty: 2, alt_group: "head", sort_order: 10 }, { item_id: head2, qty: 2, alt_group: "head", sort_order: 20 }, { item_id: truss, qty: 4 }])})`);
      await commit(U.cat, `select inv_save_technology('${CO.uae}', '${tech}', 'LED wall renamed', 'LED wall v2')`);
      expect((await admin<Row>(`select version from inv_technologies where id = '${tech}'`))[0].version).toBe(v0 + 2);
      const a = await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tech}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`);
      expect(a[0].r).toMatchObject({ result: "check_required", message: "Warehouse check required", rows: [] });
      await fails(U.cat, `select inv_set_technology_status('${tech}', 'bogus')`, /draft, complete or retired/);
      await commit(U.cat, `select inv_set_technology_status('${tech}', 'complete')`);
      const b = await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tech}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`);
      expect(b[0].r.result).not.toBe("check_required");
      await commit(U.cat, `select inv_set_technology_status('${tech}', 'draft')`);
      await commit(U.cat, `select inv_set_technology_status('${tech}', 'complete')`);
    });
    it("refuses to empty a complete template of required components, and a retired template can no longer be edited or expanded", async () => {
      const t2 = await mkTech(nm("Only required"), [{ item: truss, qty: 1 }]);
      await fails(U.cat, `select inv_save_technology_components('${t2}', ${j([{ item_id: truss, qty: 1, is_optional: true }])})`, /at least one required component/);
      await fails(U.cat, `select inv_save_technology_components('${t2}', '[]'::jsonb)`, /at least one required component/);
      const { req } = await mkRequest([{ item: truss, qty: 1 }], { submit: false });
      await commit(U.cat, `select inv_set_technology_status('${t2}', 'retired')`);
      await fails(U.cat, `select inv_save_technology('${CO.uae}', '${t2}', 'x', null)`, /retired/);
      await fails(U.pm, `select inv_expand_technology('${req}', '${t2}')`, /Only a complete template/);
    });
    it("keeps request lines exactly as they were when the template is edited afterwards (snapshot)", async () => {
      const a = await newItem("quantity", { name: nm("Snap A") });
      const b = await newItem("quantity", { name: nm("Snap B") });
      const t = await mkTech(nm("Snapshot tech"), [{ item: a, qty: 2, note: "use the long ones" }, { item: b, qty: 5 }]);
      const { req } = await mkRequest([], { submit: false });
      const v0 = (await admin<Row>(`select version from inv_technologies where id = '${t}'`))[0].version;
      const ex = await one<Row>(U.pm, `inv_expand_technology('${req}', '${t}', 3)`);
      expect(ex.line_ids).toHaveLength(2);
      const before = await admin<Row>(`select id, item_id, qty, technology_id, technology_snapshot, alt_group, version from inv_request_lines where request_id = '${req}' order by sort_order`);
      expect(before.map((l) => Number(l.qty))).toEqual([6, 15]);
      expect(before[0].technology_snapshot).toMatchObject({ name: expect.stringContaining("Snapshot tech"), version: v0 });
      expect(before[0].technology_snapshot.component).toMatchObject({ qty: 2, note: "use the long ones" });
      // Edit the template in every way: rename, change quantities, drop and add components.
      const c = await newItem("quantity", { name: nm("Snap C") });
      await commit(U.cat, `select inv_save_technology('${CO.uae}', '${t}', '${nm("Renamed tech")}', 'changed')`);
      await commit(U.cat, `select inv_save_technology_components('${t}', ${j([{ item_id: a, qty: 99 }, { item_id: c, qty: 1 }])})`);
      const after = await admin<Row>(`select id, item_id, qty, technology_id, technology_snapshot, alt_group, version from inv_request_lines where request_id = '${req}' order by sort_order`);
      expect(after).toEqual(before);
      expect((await admin<Row>(`select version from inv_technologies where id = '${t}'`))[0].version).toBe(v0 + 2);
      expect(after[0].technology_snapshot.version).toBe(v0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("requests, planning dates and daylight saving", () => {
    it("lets the project's PM, warehouse staff and founders create project requests, and nobody else", async () => {
      for (const user of [U.pm, U.whA, U.founder, U.projFounder]) {
        expect(await one<string>(user, `inv_create_request('project', '${PRJ.p1}', null, 't', null, 'Asia/Dubai')`)).toBeTruthy();
      }
      for (const user of [U.pm2, U.viewer, U.browser, U.memberOnly, U.outsider, U.cat, U.ksaFounder, U.salesA]) {
        await fails(user, `select inv_create_request('project', '${PRJ.p1}', null, 't', null, 'Asia/Dubai')`, /Only the project manager/);
      }
      await fails(U.pm, `select inv_create_request('project', '${id()}', null, 't', null, 'Asia/Dubai')`, /Project not found/);
      await fails(U.pm, `select inv_create_request('project', '${PRJ.p1}', '${EMP.emp}', 't', null, 'Asia/Dubai')`, /no employee/);
      await fails(U.pm, `select inv_create_request('project', '${PRJ.p1}', null, 't', null, 'Mars/Phobos')`, /Unknown time zone/);
      await fails(U.pm, `select inv_create_request('other', null, null, 't')`, /project or for an employee/);
    });
    it("uses the project's own time zone when none is given, and stores code, kind and status", async () => {
      const req = await one<string>(U.pm, `inv_create_request('project', '${PRJ.p1}')`);
      const [r] = await admin<Row>(`select * from inv_requests where id = '${req}'`);
      expect(r).toMatchObject({ kind: "project", status: "draft", timezone: "Asia/Dubai", requested_by: U.pm, source: "manual" });
      expect(r.code).toMatch(/^UAE-R-\d{5}$/);
    });
    it("creates employee requests only for an active employee, by a department head with the right or the employee's manager", async () => {
      expect(await one<string>(U.head, `inv_create_request('employee', null, '${EMP.emp}', 'Laptop', null, 'Asia/Dubai')`)).toBeTruthy();
      expect(await one<string>(U.mgr, `inv_create_request('employee', null, '${EMP.emp}', 'Laptop', null, 'Asia/Dubai')`)).toBeTruthy();
      expect(await one<string>(U.founder, `inv_create_request('employee', null, '${EMP.emp}', 'Laptop', null, 'Asia/Dubai')`)).toBeTruthy();
      for (const user of [U.headNoCap, U.emp, U.whA, U.pm, U.ksaFounder, U.outsider]) {
        await fails(user, `select inv_create_request('employee', null, '${EMP.emp}', 'Laptop', null, 'Asia/Dubai')`, /Only department heads/);
      }
      await fails(U.head, `select inv_create_request('employee', null, '${EMP.terminated}', 'x', null, 'Asia/Dubai')`, /active employee/);
      await fails(U.head, `select inv_create_request('employee', null, '${EMP.ksa}', 'x', null, 'Asia/Dubai')`, /Only department heads/);
      await fails(U.head, `select inv_create_request('employee', null, '${id()}', 'x', null, 'Asia/Dubai')`, /Employee not found/);
      await fails(U.head, `select inv_create_request('employee', null, '${EMP.emp}', 'x')`, /time zone/);
      expect(await one<string>(U.head, `inv_create_request('employee', null, '${EMP.emp}', 'x', null, null, null, '${LOC.b}')`)).toBeTruthy();
    });
    it("lets only the requester (or warehouse) change an employee request", async () => {
      const req = await one<string>(U.head, `inv_create_request('employee', null, '${EMP.emp}', 'Laptop', null, 'Asia/Dubai')`);
      await fails(U.mgr, `select inv_save_request_plan('${req}', ${j(W1)})`, /not found|cannot change/i);
      await commit(U.head, `select inv_save_request_plan('${req}', ${j(W1)})`);
      await commit(U.whA, `select inv_save_request_plan('${req}', ${j(W2)})`);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j(W1)})`, /not found/i);
    });

    const win = async (req: string) => (await admin<Row>(`select to_char(needed_from at time zone 'UTC', 'YYYY-MM-DD HH24:MI') f, to_char(needed_until at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u,
      to_char(expected_return_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') r, round(extract(epoch from needed_until - needed_from) / 3600) hours, plan from inv_requests where id = '${req}'`))[0];
    it("converts a window across the last Sunday of March in Europe/Warsaw (the day is 23 hours long)", async () => {
      const { req } = await mkRequest([], { submit: false, plan: { dispatch: "2030-03-30 12:00", install_start: "2030-03-31 09:00", return_due: "2030-04-01 12:00" }, tz: "Europe/Warsaw" });
      const w = await win(req);
      expect(w).toMatchObject({ f: "2030-03-30 11:00", u: "2030-04-01 10:00", r: "2030-04-01 10:00" });
      expect(Number(w.hours)).toBe(47);
      expect(w.plan).toMatchObject({ dispatch: "2030-03-30T12:00", return_due: "2030-04-01T12:00" });
    });
    it("converts a window across the last Sunday of October in Europe/Warsaw (the day is 25 hours long)", async () => {
      const { req } = await mkRequest([], { submit: false, plan: { dispatch: "2030-10-26 12:00", return_due: "2030-10-28 12:00" }, tz: "Europe/Warsaw" });
      const w = await win(req);
      expect(w).toMatchObject({ f: "2030-10-26 10:00", u: "2030-10-28 11:00" });
      expect(Number(w.hours)).toBe(49);
    });
    it("moves a nonexistent local time (02:30 on the spring-forward day) past the gap, never before it", async () => {
      const { req } = await mkRequest([], { submit: false, plan: { dispatch: "2030-03-31 00:00", return_due: "2030-03-31 02:30" }, tz: "Europe/Warsaw" });
      const w = await win(req);
      expect(w.u >= "2030-03-31 01:00" && w.u <= "2030-03-31 02:00").toBe(true);        // 03:00 CEST = 01:00 UTC is the first real instant after the gap
      expect((await admin<Row>(`select to_char(inv_local_to_utc('2030-03-31 02:30', 'Europe/Warsaw') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') v`))[0].v).toBe(w.u);
    });
    it("resolves a repeated local time (02:30 on the fall-back day) to one of its two real instants, the same way every time", async () => {
      const { req } = await mkRequest([], { submit: false, plan: { dispatch: "2030-10-27 00:00", return_due: "2030-10-27 02:30" }, tz: "Europe/Warsaw" });
      const w = await win(req);
      expect(["2030-10-27 00:30", "2030-10-27 01:30"]).toContain(w.u);
      const { req: req2 } = await mkRequest([], { submit: false, plan: { dispatch: "2030-10-27 00:00", return_due: "2030-10-27 02:30" }, tz: "Europe/Warsaw" });
      expect((await win(req2)).u).toBe(w.u);
    });
    it("reads the same wall-clock date differently in different zones, and keeps the request zone", async () => {
      const { req } = await mkRequest([], { submit: false, plan: W1, tz: "Europe/Warsaw" });
      expect(await win(req)).toMatchObject({ f: "2030-06-10 07:00", u: "2030-06-15 16:00" });
      await commit(U.pm, `select inv_save_request_plan('${req}', ${j(W1)}, 'Asia/Dubai')`);
      expect(await win(req)).toMatchObject({ f: "2030-06-10 05:00", u: "2030-06-15 14:00" });
    });
    it("rejects offsets, unknown phases, impossible dates, and treats a single date as an incomplete window", async () => {
      const req = await one<string>(U.pm, `inv_create_request('project', '${PRJ.p1}', null, 't', null, 'Asia/Dubai')`);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j({ dispatch: "2030-06-10T09:00:00Z" })})`, /without a time zone offset/);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j({ dispatch: "2030-06-10 09:00+02" })})`, /without a time zone offset/);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j({ party: "2030-06-10 09:00" })})`, /Unknown plan date/);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j({ dispatch: "2030-02-31 09:00" })})`, /not a real date/);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j({ dispatch: 5 })})`, /must be written as/);
      const r = await one<Row>(U.pm, `inv_save_request_plan('${req}', ${j({ dispatch: "2030-06-10 09:00" })})`);
      expect(r.needed_until).toBeNull();
      await expect(admin(`select 1`)).resolves.toBeTruthy();
      await fails(U.pm, `select inv_submit_request('${req}')`, /Add at least one item/);
    });
    it("rejects a stale version and keeps the version moving", async () => {
      const req = await one<string>(U.pm, `inv_create_request('project', '${PRJ.p1}', null, 't', null, 'Asia/Dubai')`);
      const r = await one<Row>(U.pm, `inv_save_request_plan('${req}', ${j(W1)}, null, 1)`);
      expect(r.version).toBe(2);
      await fails(U.pm, `select inv_save_request_plan('${req}', ${j(W2)}, null, 1)`, /changed by someone else/);
      await fails(U.pm, `select inv_add_request_line('${req}', '${await newItem("quantity")}', 1, null, 1)`, /changed by someone else/);
    });
    it("validates line items and quantities, and keeps the lines of other companies out", async () => {
      const req = await one<string>(U.pm, `inv_create_request('project', '${PRJ.p1}', null, 't', ${j(W1)}, 'Asia/Dubai')`);
      const unitItem = await newItem("individual");
      const retired = await newItem("quantity", { status: "retired" });
      const ksa = await newItem("quantity", { company: CO.ksa });
      const meters = await newItem("quantity", { scale: 2 });
      await fails(U.pm, `select inv_add_request_line('${req}', '${unitItem}', 1.5)`, /decimal/);
      await fails(U.pm, `select inv_add_request_line('${req}', '${unitItem}', 0)`, /more than zero/);
      await fails(U.pm, `select inv_add_request_line('${req}', '${retired}', 1)`, /retired/);
      await fails(U.pm, `select inv_add_request_line('${req}', '${ksa}', 1)`, /Unknown item/);
      expect(await one<string>(U.pm, `inv_add_request_line('${req}', '${meters}', 2.25)`)).toBeTruthy();
      await fails(U.pm2, `select inv_add_request_line('${req}', '${unitItem}', 1)`, /not found/i);
      await fails(U.ksaFounder, `select inv_add_request_line('${req}', '${unitItem}', 1)`, /not found/i);
    });
    it("moves draft to submitted (once, however often clicked) and refuses to submit without window or lines", async () => {
      const item = await newItem("quantity");
      const req = await one<string>(U.pm, `inv_create_request('project', '${PRJ.p1}', null, 't', null, 'Asia/Dubai')`);
      await commit(U.pm, `select inv_add_request_line('${req}', '${item}', 1)`);
      await fails(U.pm, `select inv_submit_request('${req}')`, /planning dates/);
      await commit(U.pm, `select inv_save_request_plan('${req}', ${j({ dispatch: "2020-01-01 09:00", return_due: "2020-01-05 09:00" })})`);
      await fails(U.pm, `select inv_submit_request('${req}')`, /in the past/);
      await commit(U.pm, `select inv_save_request_plan('${req}', ${j(W1)})`);
      await fails(U.viewer, `select inv_submit_request('${req}')`, /not found|cannot change/i);
      await commit(U.pm, `select inv_submit_request('${req}')`);
      await commit(U.pm, `select inv_submit_request('${req}')`);
      const [r] = await admin<Row>(`select status, submitted_at from inv_requests where id = '${req}'`);
      expect(r.status).toBe("submitted");
      expect(r.submitted_at).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("expansion, quantities and substitution", () => {
    it("copies components x multiplier as lines, offers the other alternatives and lets the PM adjust quantities", async () => {
      const h1 = await newItem("individual", { name: nm("Spot S1") });
      const h2 = await newItem("individual", { name: nm("Spot S2") });
      const cab = await newItem("quantity", { name: nm("Cable") });
      const opt = await newItem("quantity", { name: nm("Spare") });
      const t = await mkTech(nm("Spot rig"), [{ item: h1, qty: 2, alt: "spot", sort: 10 }, { item: h2, qty: 3, alt: "spot", sort: 20 }, { item: cab, qty: 4, sort: 30 }, { item: opt, qty: 1, opt: true, sort: 40 }]);
      const { req } = await mkRequest([], { submit: false });
      const ex = await one<Row>(U.pm, `inv_expand_technology('${req}', '${t}', 2)`);
      expect(ex.line_ids).toHaveLength(3);
      expect(ex.offered_alternatives).toHaveLength(1);
      expect(ex.offered_alternatives[0]).toMatchObject({ alt_group: "spot", standard_item_id: h1 });
      expect(ex.offered_alternatives[0].alternatives.map((a: Row) => a.item_id)).toEqual([h2]);
      const lines = await admin<Row>(`select item_id, qty, is_optional, substitution_status, original_item_id from inv_request_lines where request_id = '${req}' order by sort_order`);
      expect(lines.map((l) => [l.item_id, Number(l.qty), l.is_optional])).toEqual([[h1, 4, false], [cab, 8, false], [opt, 2, true]]);
      expect(lines.every((l) => l.substitution_status === "none")).toBe(true);
      const ids = ex.line_ids as string[];
      await commit(U.pm, `select inv_update_request_line('${ids[1]}', 10, 'a bit more')`);
      expect((await admin<Row>(`select qty, note, version from inv_request_lines where id = '${ids[1]}'`))[0]).toMatchObject({ note: "a bit more", version: 2 });
      expect(Number((await admin<Row>(`select qty from inv_request_lines where id = '${ids[1]}'`))[0].qty)).toBe(10);
      await fails(U.pm, `select inv_update_request_line('${ids[1]}', 10, null, 1)`, /changed by someone else/);
      await fails(U.pm, `select inv_update_request_line('${ids[0]}', 0.5)`, /decimal|more than zero/);
      await fails(U.pm2, `select inv_update_request_line('${ids[1]}', 3)`, /not found/i);
      await fails(U.pm, `select inv_expand_technology('${req}', '${t}', 0)`, /more than zero/);
      await fails(U.pm, `select inv_expand_technology('${req}', '${t}', 1, ${j({ nogroup: h2 })})`, /no alternative group/);
      await fails(U.pm, `select inv_expand_technology('${req}', '${t}', 1, ${j({ spot: cab })})`, /not one of its alternatives/);
    });
    it("makes a different alternative a PROPOSED substitution; the warehouse reserves the original until the PM accepts", async () => {
      const m1 = await newItem("individual", { name: nm("Moving head A") });
      const m2 = await newItem("individual", { name: nm("Moving head B") });
      const u1 = await newUnit(m1), u2 = await newUnit(m2);
      const t = await mkTech(nm("Heads"), [{ item: m1, qty: 1, alt: "head", sort: 10 }, { item: m2, qty: 1, alt: "head", sort: 20 }]);
      const { req } = await mkRequest([], { submit: false });
      const ex = await one<Row>(U.pm, `inv_expand_technology('${req}', '${t}', 1, ${j({ head: m2 })})`);
      const line = (ex.line_ids as string[])[0] as string;
      expect((await admin<Row>(`select item_id, original_item_id, substitution_status from inv_request_lines where id = '${line}'`))[0]).toMatchObject({ item_id: m2, original_item_id: m1, substitution_status: "proposed" });
      await commit(U.pm, `select inv_submit_request('${req}')`);
      // The warehouse treats the original as the requirement: it reserves a unit of A, not B.
      const r1 = await reserve(U.whA, line, LOC.a);
      expect(r1.item_id).toBe(m1);
      expect((await admin<Row>(`select unit_id, item_id from inv_reservations where request_line_id = '${line}'`))[0]).toMatchObject({ unit_id: u1, item_id: m1 });
      // Only an authorised project person decides: never the warehouse operator, not even a founder of Inventory.
      for (const user of [U.whA, U.founder, U.cat, U.viewer, U.outsider, U.pm2]) await fails(user, `select inv_decide_substitution('${line}', true)`, /Only the project manager|not found/i);
      const acc = await one<Row>(U.pm, `inv_decide_substitution('${line}', true, 'client agreed')`);
      expect(acc).toMatchObject({ substitution_status: "accepted", released_qty: 1 });
      expect((await admin<Row>(`select substitution_status, substitution_by from inv_request_lines where id = '${line}'`))[0]).toMatchObject({ substitution_status: "accepted", substitution_by: U.pm });
      expect(await resCount(line, "released")).toBe(1);
      const r2 = await reserve(U.whA, line, LOC.a);
      expect(r2.item_id).toBe(m2);
      expect((await admin<Row>(`select unit_id from inv_reservations where request_line_id = '${line}' and status = 'active'`))[0].unit_id).toBe(u2);
      await fails(U.pm, `select inv_decide_substitution('${line}', false)`, /no substitute waiting/);
    });
    it("lets the PM decline a substitute, which restores the original item and quantity", async () => {
      const m1 = await newItem("quantity", { name: nm("Driver 1") });
      const m2 = await newItem("quantity", { name: nm("Driver 2") });
      const t = await mkTech(nm("Drivers"), [{ item: m1, qty: 2, alt: "drv", sort: 10 }, { item: m2, qty: 3, alt: "drv", sort: 20 }]);
      const { req } = await mkRequest([], { submit: false });
      const line = ((await one<Row>(U.pm, `inv_expand_technology('${req}', '${t}', 2, ${j({ drv: m2 })})`)).line_ids as string[])[0];
      expect(Number((await admin<Row>(`select qty from inv_request_lines where id = '${line}'`))[0].qty)).toBe(6);
      const d = await one<Row>(U.pm, `inv_decide_substitution('${line}', false, 'not acceptable')`);
      expect(d.substitution_status).toBe("declined");
      expect((await admin<Row>(`select item_id, qty, substitution_status from inv_request_lines where id = '${line}'`))[0]).toMatchObject({ item_id: m1, substitution_status: "declined" });
      expect(Number((await admin<Row>(`select qty from inv_request_lines where id = '${line}'`))[0].qty)).toBe(4);
    });
    it("only offers alternatives written into the template: a look-alike model is never assumed interchangeable", async () => {
      const a = await newItem("individual", { name: nm("Controller A") });
      const lookalike = await newItem("individual", { name: nm("Controller A pro") });
      const alt = await newItem("individual", { name: nm("Controller B") });
      const t = await mkTech(nm("Control"), [{ item: a, qty: 1, alt: "ctl", sort: 10 }, { item: alt, qty: 1, alt: "ctl", sort: 20 }]);
      const { req } = await mkRequest([], { submit: false });
      const line = ((await one<Row>(U.pm, `inv_expand_technology('${req}', '${t}')`)).line_ids as string[])[0];
      await fails(U.pm, `select inv_propose_substitution('${line}', '${lookalike}')`, /not an alternative listed in the template/);
      await commit(U.whA, `select inv_propose_substitution('${line}', '${alt}', 'in stock')`);       // the warehouse can PROPOSE
      expect((await admin<Row>(`select item_id, original_item_id, substitution_status from inv_request_lines where id = '${line}'`))[0]).toMatchObject({ item_id: alt, original_item_id: a, substitution_status: "proposed" });
      await commit(U.pm, `select inv_propose_substitution('${line}', '${a}')`);                       // back to the standard item
      expect((await admin<Row>(`select item_id, original_item_id, substitution_status from inv_request_lines where id = '${line}'`))[0]).toMatchObject({ item_id: a, original_item_id: null, substitution_status: "none" });
      const manual = await one<string>(U.pm, `inv_add_request_line('${req}', '${a}', 1)`);
      await fails(U.pm, `select inv_propose_substitution('${manual}', '${alt}')`, /Only alternatives written into the technology template/);
    });
    it("records need_to_buy / need_to_rent with an external reference text only", async () => {
      const item = await newItem("quantity");
      const { lines } = await mkRequest([{ item, qty: 5 }]);
      await commit(U.pm, `select inv_set_shortage_action('${lines[0]}', 'need_to_rent', 'rent from Acme', 'ACME-PO-77')`);
      expect((await admin<Row>(`select shortage_action, shortage_note, rental_reference from inv_request_lines where id = '${lines[0]}'`))[0]).toMatchObject({ shortage_action: "need_to_rent", shortage_note: "rent from Acme", rental_reference: "ACME-PO-77" });
      await fails(U.pm, `select inv_set_shortage_action('${lines[0]}', 'need_to_buy', null, 'ACME-PO-77')`, /only belongs to a need to rent/);
      await fails(U.pm, `select inv_set_shortage_action('${lines[0]}', 'order_it')`, /must be none/);
      await commit(U.pm, `select inv_set_shortage_action('${lines[0]}', 'need_to_buy', 'buy 5')`);
      expect((await admin<Row>(`select shortage_action, rental_reference from inv_request_lines where id = '${lines[0]}'`))[0]).toMatchObject({ shortage_action: "need_to_buy", rental_reference: null });
      await fails(U.pm2, `select inv_set_shortage_action('${lines[0]}', 'none')`, /not found/i);
      await commit(U.pm, `select inv_set_shortage_action('${lines[0]}', 'none')`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("reservations", () => {
    it("reserves chosen units for the request window, performed only by staff who can operate the location", async () => {
      const item = await newItem("individual");
      const [u1, u2] = [await newUnit(item), await newUnit(item)];
      const { req, lines } = await mkRequest([{ item, qty: 2 }]);
      for (const user of [U.pm, U.viewer, U.browser, U.outsider, U.cat, U.whB, U.ksaFounder]) {
        await fails(user, `select inv_reserve('${lines[0]}', '${LOC.a}', ${arr([u1])})`, /Only warehouse staff|not found/i);
      }
      await fails(U.whA, `select inv_reserve('${lines[0]}', '${LOC.b}', ${arr([u1])})`, /Only warehouse staff/);
      await fails(U.whA, `select inv_reserve('${lines[0]}', '${LOC.ksa}', ${arr([u1])})`, /Location not found/);
      const r = await reserve(U.whA, lines[0], LOC.a, `, ${arr([u1, u2])}`);
      expect(r).toMatchObject({ requested: 2, reserved_now: 2, shortage: 0, still_needed: 0, reserved_total: 2 });
      expect(r.reservations.map((x: Row) => x.unit_id).sort()).toEqual([u1, u2].sort());
      const rows = await admin<Row>(`select to_char(lower(reserved_during) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') f, to_char(upper(reserved_during) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u, status, qty, made_by, location_id
        from inv_reservations where request_line_id = '${lines[0]}'`);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ f: "2030-06-10 05:00", u: "2030-06-15 14:00", status: "active", made_by: U.whA, location_id: LOC.a });
      expect((await admin<Row>(`select status from inv_requests where id = '${req}'`))[0].status).toBe("in_progress");
      await fails(U.whA, `select inv_reserve('${lines[0]}', '${LOC.a}', ${arr([u1])})`, /already fully reserved/);
      const f = await commit<{ r: Row }>(U.founder, `select inv_reserve('${(await mkRequest([{ item, qty: 1 }], { pm: U.pm, project: PRJ.p1, plan: W3 })).lines[0]}', '${LOC.a}', ${arr([u1])}) as r`);
      expect(f[0].r.reserved_now).toBe(1);                                // a founder may reserve; the other window is free
    });
    it("refuses a draft request and a request without dates, and units of another item", async () => {
      const item = await newItem("individual");
      const other = await newItem("individual");
      const uo = await newUnit(other);
      const u = await newUnit(item);
      const draft = await mkRequest([{ item, qty: 1 }], { submit: false });
      await fails(U.whA, `select inv_reserve('${draft.lines[0]}', '${LOC.a}', ${arr([u])})`, /Only a submitted request/);
      const sub = await mkRequest([{ item, qty: 1 }]);
      await fails(U.whA, `select inv_reserve('${sub.lines[0]}', '${LOC.a}', ${arr([uo])})`, /That unit is not a/);
      await fails(U.whA, `select inv_reserve('${sub.lines[0]}', '${LOC.a}', ${arr([u])}, 1)`, /either the units or a quantity/);
      await fails(U.whA, `select inv_reserve('${sub.lines[0]}', '${LOC.a}', ${arr([u, uo])})`, /needs only/);
    });
    it("never reserves draft, damaged, inspection, missing, retired, employee-assigned, repair, in-kit or overdue equipment, with a plain reason", async () => {
      const item = await newItem("individual");
      const kit = await newItem("kit", { name: nm("Kit") });
      const kitUnit = await newUnit(kit, { code: "UAE-E-KIT1" });
      const bad: [string, string, RegExp][] = [
        [await newUnit(item, { life: "draft" }), "draft", /draft record/],
        [await newUnit(item, { cond: "damaged" }), "damaged", /damaged/],
        [await newUnit(item, { cond: "needs_inspection" }), "inspect", /waiting for inspection/],
        [await newUnit(item, { life: "missing" }), "missing", /recorded as missing/],
        [await newUnit(item, { life: "retired" }), "retired", /retired/],
        [await newUnit(item, { custody: "employee", employee: EMP.emp }), "employee", /assigned to an employee/],
        [await newUnit(item, { custody: "repair", repair: "RMA-1" }), "repair", /out for repair/],
        [await newUnit(item, { custody: "kit", kit: kitUnit }), "kit", /packed in kit UAE-E-KIT1\. Reserve the kit/],
        [await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "now() - interval '3 days'" }), "overdue", /overdue back from a project/],
        [await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "null" }), "noreturn", /no return date/],
        [await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "'2030-06-14 00:00+00'" }), "late", /not expected back before/],
        [await newUnit(item, { loc: LOC.b }), "elsewhere", /different location/],
      ];
      const { lines } = await mkRequest([{ item, qty: 12 }]);
      for (const [unit, label, re] of bad) {
        await expect(commit(U.whA, `select inv_reserve('${lines[0]}', '${LOC.a}', ${arr([unit])})`), label).rejects.toThrow(re);
      }
      // Auto-pick never touches them either: nothing usable exists, so nothing is reserved and the shortage is the full quantity.
      const r = await reserve(U.whA, lines[0], LOC.a, `, null, 12`);
      expect(r).toMatchObject({ reserved_now: 0, shortage: 12 });
      expect(await resCount(lines[0])).toBe(0);
      expect(employeeNameLeak(JSON.stringify(r))).toBe(false);
    });
    it("reserves a unit that is out on a project only when its return is on time and ends before the window starts", async () => {
      const item = await newItem("individual");
      const onTime = await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "'2030-06-05 12:00+00'" });
      const { lines } = await mkRequest([{ item, qty: 1 }]);
      const a = await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', '2030-06-10 05:00+00', '2030-06-15 14:00+00') as r`);
      expect(a[0].r).toMatchObject({ basis: "future", free_for_range: 1, returning_on_time: 1, dispatched_to_projects: 1, usable_now: 0 });
      const now = await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', now(), now() + interval '2 days') as r`);
      expect(now[0].r).toMatchObject({ basis: "now", free_for_range: 0, dispatched_to_projects: 1 });
      expect((await reserve(U.whA, lines[0], LOC.a, `, ${arr([onTime])}`)).reserved_now).toBe(1);
    });
    it("counts overdue equipment as overdue, never as ready", async () => {
      const item = await newItem("individual");
      await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "now() - interval '2 days'" });
      await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "now() + interval '3 days'" });
      const a = await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', now() + interval '10 days', now() + interval '12 days') as r`);
      expect(a[0].r).toMatchObject({ overdue: 1, dispatched_to_projects: 2, free_for_range: 1, returning_on_time: 1, usable_now: 0 });
    });
    it("protects a unit twice: a plain pre-check message, and the exclusion constraint underneath", async () => {
      const item = await newItem("individual");
      const unit = await newUnit(item, { code: "UAE-E-DUP1" });
      const a = await mkRequest([{ item, qty: 1 }], { project: PRJ.p2, pm: U.pm2 });
      const b = await mkRequest([{ item, qty: 1 }], { project: PRJ.p3, pm: U.pm3, plan: W2 });      // overlaps W1
      await reserve(U.whA, a.lines[0], LOC.a, `, ${arr([unit])}`);
      await expect(commit(U.whC, `select inv_reserve('${b.lines[0]}', '${LOC.a}', ${arr([unit])})`)).rejects.toThrow(/UAE-E-DUP1 is already reserved from 10 Jun 2030 09:00 to 15 Jun 2030 18:00 \(Asia\/Dubai\)/);
      // whC sees project Beta (Projects access), so the name may be mentioned; whA has no project access at all
      const c = await mkRequest([{ item, qty: 1 }], { project: PRJ.p3, pm: U.pm3, plan: W2 });
      await expect(commit(U.whC, `select inv_reserve('${c.lines[0]}', '${LOC.a}', ${arr([unit])})`)).rejects.toThrow(/Beta arena/);
      await db.seed(`delete from proj_company_grants where user_id = '${U.whA}'`);
      const noProjectAccess = await commit(U.whA, `select inv_reserve('${c.lines[0]}', '${LOC.a}', ${arr([unit])})`).catch((e: Error) => e.message);
      expect(String(noProjectAccess)).toMatch(/already reserved from/);
      expect(String(noProjectAccess)).not.toContain("Beta arena");
      // The constraint itself: a direct overlapping row is refused by the database whatever any function does.
      await expect(admin(`insert into inv_reservations (company_id, request_line_id, item_id, unit_id, location_id, qty, reserved_during, made_by)
        values ('${CO.uae}', '${b.lines[0]}', '${item}', '${unit}', '${LOC.a}', 1, tstzrange('2030-06-11', '2030-06-12'), '${U.whA}')`)).rejects.toThrow(/inv_reservations_no_overlap/);
      expect(await resCount(b.lines[0])).toBe(0);
    });
    it("does not leak another project's name to a warehouse operator who cannot see it, but shows it to one who can", async () => {
      const item = await newItem("individual");
      const unit = await newUnit(item, { code: "UAE-E-SEC1" });
      const secret = await mkRequest([{ item, qty: 1 }], { project: PRJ.secret, pm: U.pm3 });
      await reserve(U.founder, secret.lines[0], LOC.a, `, ${arr([unit])}`);
      const probe = await mkRequest([{ item, qty: 1 }], { project: PRJ.p2, pm: U.pm2 });
      const msgA = await commit(U.whA, `select inv_reserve('${probe.lines[0]}', '${LOC.a}', ${arr([unit])})`).catch((e: Error) => e.message);
      // whA holds no Projects access at all, so the secret name must not appear in the message
      expect(String(msgA)).toMatch(/already reserved/);
      expect(String(msgA)).not.toContain(SECRET.project);
      const msgC = await commit(U.whC, `select inv_reserve('${probe.lines[0]}', '${LOC.a}', ${arr([unit])})`).catch((e: Error) => e.message);
      expect(String(msgC)).toContain(SECRET.project);                     // whC is a member of that very project
    });
    it("picks free units by itself, reserves what is free, reports the shortage and the buy / rent need", async () => {
      const item = await newItem("individual");
      await newUnit(item); await newUnit(item); await newUnit(item, { cond: "damaged" });
      const { lines } = await mkRequest([{ item, qty: 5 }]);
      const r = await reserve(U.whA, lines[0], LOC.a, `, null, null, 'need_to_rent', 'ACME-77'`);
      expect(r).toMatchObject({ requested: 5, reserved_now: 2, shortage: 3, still_needed: 3, reserved_total: 2 });
      expect(r.need).toMatchObject({ action: "need_to_rent", qty: 3, rental_reference: "ACME-77" });
      expect((await admin<Row>(`select shortage_action, rental_reference from inv_request_lines where id = '${lines[0]}'`))[0]).toMatchObject({ shortage_action: "need_to_rent", rental_reference: "ACME-77" });
      const again = await reserve(U.whA, lines[0], LOC.a);
      expect(again).toMatchObject({ reserved_now: 0, shortage: 3, still_needed: 3 });
      expect(again.need).toMatchObject({ action: "need_to_rent", qty: 3 });
      await newUnit(item);
      const more = await reserve(U.whA, lines[0], LOC.a);
      expect(more).toMatchObject({ reserved_now: 1, shortage: 2, reserved_total: 3 });
    });
    it("reserves quantity stock up to what is free, partly when it is short, and never above the stock", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 10);
      await newBalance(item, 3, { condition: "damaged" });
      const a = await mkRequest([{ item, qty: 4 }], { project: PRJ.p1 });
      const b = await mkRequest([{ item, qty: 4 }], { project: PRJ.p2, pm: U.pm2 });
      const c = await mkRequest([{ item, qty: 4 }], { project: PRJ.p3, pm: U.pm3 });
      expect((await reserve(U.whA, a.lines[0], LOC.a)).reserved_now).toBe(4);
      expect((await reserve(U.whA, b.lines[0], LOC.a)).reserved_now).toBe(4);
      const rc = await reserve(U.whA, c.lines[0], LOC.a);
      expect(rc).toMatchObject({ reserved_now: 2, shortage: 2, still_needed: 2 });
      const av = await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`);
      expect(av[0].r).toMatchObject({ physical_at_location: 13, usable_now: 10, awaiting_inspection: 0, damaged_repair_missing: 3, reserved_in_range: 10, free_for_range: 0 });
      // Another window is untouched by those reservations.
      const w3 = await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', '2030-07-01', '2030-07-05') as r`);
      expect(w3[0].r.free_for_range).toBe(10);
      await fails(U.whA, `select inv_reserve('${a.lines[0]}', '${LOC.a}', null, 1)`, /already fully reserved/);
    });
    it("honours decimal quantities per item scale", async () => {
      const item = await newItem("quantity", { scale: 1, name: nm("Rope m") });
      await newBalance(item, 7.5);
      const a = await mkRequest([{ item, qty: 5 }]);
      const b = await mkRequest([{ item, qty: 4.5 }], { project: PRJ.p2, pm: U.pm2 });
      expect((await reserve(U.whA, a.lines[0], LOC.a)).reserved_now).toBe(5);
      expect(await reserve(U.whA, b.lines[0], LOC.a)).toMatchObject({ reserved_now: 2.5, shortage: 2 });
      await fails(U.whA, `select inv_reserve('${b.lines[0]}', '${LOC.a}', null, 0.25)`, /decimal/);
    });
    it("reserves the last unit for exactly one of two simultaneous callers", async () => {
      const item = await newItem("individual");
      const unit = await newUnit(item, { code: "UAE-E-RACE" });
      const a = await mkRequest([{ item, qty: 1 }], { project: PRJ.p2, pm: U.pm2 });
      const b = await mkRequest([{ item, qty: 1 }], { project: PRJ.p3, pm: U.pm3 });
      const res = await Promise.allSettled([
        commit<{ r: Row }>(U.whA, `select inv_reserve('${a.lines[0]}', '${LOC.a}', ${arr([unit])}) as r`),
        commit<{ r: Row }>(U.whC, `select inv_reserve('${b.lines[0]}', '${LOC.a}', ${arr([unit])}) as r`),
      ]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failed = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(failed.reason)).toMatch(/already reserved|just reserved/);
      expect(await num(`select count(*) n from inv_reservations where unit_id = '${unit}' and status = 'active'`)).toBe(1);
    });
    it("lets simultaneous callers auto-pick the last units without ever reserving one twice", async () => {
      const item = await newItem("individual");
      const units = [await newUnit(item), await newUnit(item), await newUnit(item)];
      const a = await mkRequest([{ item, qty: 2 }], { project: PRJ.p2, pm: U.pm2 });
      const b = await mkRequest([{ item, qty: 2 }], { project: PRJ.p3, pm: U.pm3 });
      const res = await Promise.all([
        commit<{ r: Row }>(U.whA, `select inv_reserve('${a.lines[0]}', '${LOC.a}', null, 2) as r`),
        commit<{ r: Row }>(U.whC, `select inv_reserve('${b.lines[0]}', '${LOC.a}', null, 2) as r`),
      ]);
      const got = res.map((r) => r[0].r.reserved_now as number).sort();
      expect(got).toEqual([1, 2]);
      expect(await num(`select count(distinct unit_id) n from inv_reservations where item_id = '${item}' and status = 'active'`)).toBe(3);
      expect(units).toHaveLength(3);
    });
    it("never oversells the last quantity to simultaneous callers: exactly one gets it", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 3);
      const a = await mkRequest([{ item, qty: 3 }], { project: PRJ.p2, pm: U.pm2 });
      const b = await mkRequest([{ item, qty: 3 }], { project: PRJ.p3, pm: U.pm3 });
      const res = await Promise.all([
        commit<{ r: Row }>(U.whA, `select inv_reserve('${a.lines[0]}', '${LOC.a}') as r`),
        commit<{ r: Row }>(U.whC, `select inv_reserve('${b.lines[0]}', '${LOC.a}') as r`),
      ]);
      const got = res.map((r) => Number(r[0].r.reserved_now)).sort();
      expect(got).toEqual([0, 3]);
      expect(await num(`select coalesce(sum(qty), 0) n from inv_reservations where item_id = '${item}' and status = 'active'`)).toBe(3);
    });
    it("splits the last quantities between simultaneous callers without exceeding the stock", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 5);
      const reqs = await Promise.all([PRJ.p1, PRJ.p2, PRJ.p3].map((p, i) => mkRequest([{ item, qty: 3 }], { project: p, pm: [U.pm, U.pm2, U.pm3][i] })));
      const res = await Promise.all([
        commit<{ r: Row }>(U.whA, `select inv_reserve('${reqs[0]!.lines[0]}', '${LOC.a}') as r`),
        commit<{ r: Row }>(U.whC, `select inv_reserve('${reqs[1]!.lines[0]}', '${LOC.a}') as r`),
        commit<{ r: Row }>(U.founder, `select inv_reserve('${reqs[2]!.lines[0]}', '${LOC.a}') as r`),
      ]);
      expect(res.reduce((s, r) => s + Number(r[0].r.reserved_now), 0)).toBe(5);
      expect(await num(`select coalesce(sum(qty), 0) n from inv_reservations where item_id = '${item}' and status = 'active'`)).toBe(5);
    });
    it("counts a kit once and never also its packed parts (no double allocation)", async () => {
      const kitItem = await newItem("kit", { name: nm("Show kit") });
      const laptop = await newItem("individual", { name: nm("Show laptop") });
      const kitUnit = await newUnit(kitItem, { code: "UAE-E-KITA" });
      await newUnit(laptop, { code: "UAE-E-LAPA", custody: "kit", kit: kitUnit });
      const kitAv = await q<{ r: Row }>(U.founder, `select inv_availability('${kitItem}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`);
      expect(kitAv[0].r).toMatchObject({ free_for_range: 1, usable_now: 1, physical_at_location: 1 });
      const lapAv = await q<{ r: Row }>(U.founder, `select inv_availability('${laptop}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`);
      expect(lapAv[0].r).toMatchObject({ free_for_range: 0, usable_now: 0 });
      const tKit = await mkTech(nm("Needs kit"), [{ item: kitItem, qty: 1 }]);
      const tLap = await mkTech(nm("Needs laptop"), [{ item: laptop, qty: 1 }]);
      const tBoth = await mkTech(nm("Needs both"), [{ item: kitItem, qty: 1 }, { item: laptop, qty: 1 }]);
      const r1 = (await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tKit}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(r1.result).toBe("available");
      const r2 = (await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tLap}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(r2.result).toBe("short");                                                    // the laptop exists only inside the kit
      const r3 = (await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tBoth}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(r3.result).toBe("partial");
      const r4 = (await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tKit}', 2, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(r4.result).toBe("partial");
      // The part can only be reserved through the kit; reserving the kit blocks it for everyone else.
      const part = (await admin<{ id: string }>(`select id from inv_units where code = 'UAE-E-LAPA'`))[0].id;
      const lapReq = await mkRequest([{ item: laptop, qty: 1 }]);
      await expect(commit(U.whA, `select inv_reserve('${lapReq.lines[0]}', '${LOC.a}', ${arr([part])})`)).rejects.toThrow(/packed in kit UAE-E-KITA\. Reserve the kit/);
      const kitReq = await mkRequest([{ item: kitItem, qty: 1 }], { project: PRJ.p2, pm: U.pm2 });
      await reserve(U.whA, kitReq.lines[0], LOC.a);
      const after = (await q<{ r: Row }>(U.founder, `select inv_technology_availability('${tKit}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(after.result).toBe("short");
    });
    it("lets the PM, the requester and warehouse staff at the location release a reservation, nobody else, and keeps it in history", async () => {
      const item = await newItem("individual");
      await newUnit(item); await newUnit(item); await newUnit(item);
      const { req, lines } = await mkRequest([{ item, qty: 3 }]);
      const r = await reserve(U.whA, lines[0], LOC.a);
      const ids = r.reservations.map((x: Row) => x.reservation_id) as string[];
      for (const user of [U.pm2, U.viewer, U.whB, U.outsider, U.ksaFounder]) await fails(user, `select inv_release_reservation('${ids[0]}', 'x')`, /Only the project manager|not found/i);
      await commit(U.pm, `select inv_release_reservation('${ids[0]}', 'not needed')`);
      await commit(U.whA, `select inv_release_reservation('${ids[1]}')`);
      await commit(U.founder, `select inv_release_reservation('${ids[2]}', 'founder cleanup')`);
      await fails(U.pm, `select inv_release_reservation('${ids[0]}')`, /already released/);
      const rows = await admin<Row>(`select status, released_reason, released_at from inv_reservations where request_line_id = '${lines[0]}' order by released_reason`);
      expect(rows).toHaveLength(3);
      expect(rows.every((x) => x.status === "released" && x.released_at !== null)).toBe(true);
      expect(rows.map((x) => x.released_reason).sort()).toEqual(["Released", "founder cleanup", "not needed"].sort());
      expect(req).toBeTruthy();
    });
    it("refuses to ask for less than is already reserved", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 10);
      const { lines } = await mkRequest([{ item, qty: 6 }]);
      await reserve(U.whA, lines[0], LOC.a);
      await fails(U.pm, `select inv_update_request_line('${lines[0]}', 4)`, /already has 6 reserved/);
      await commit(U.pm, `select inv_update_request_line('${lines[0]}', 8)`);
      await fails(U.pm, `select inv_propose_substitution('${lines[0]}', '${item}')`, /Only alternatives|Release the reservations/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("changing a request's dates", () => {
    const utc = (col: string, line: string) => `select to_char(lower(${col}) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') f, to_char(upper(${col}) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u from inv_reservations where request_line_id = '${line}' and status = 'active' order by 1`;
    it("extends reservations that can be extended and never takes anything from another reservation", async () => {
      const item = await newItem("individual");
      const [ua, ub] = [await newUnit(item), await newUnit(item)];
      const mine = await mkRequest([{ item, qty: 2 }]);
      await reserve(U.whA, mine.lines[0], LOC.a, `, ${arr([ua, ub])}`);
      const w = await one<Row>(U.pm, `inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-10 09:00", return_due: "2030-06-18 18:00" })})`);
      expect(w.conflicts).toEqual([]);
      expect(w.extended).toEqual([{ line_id: mine.lines[0], reservations: 2 }]);
      expect((await admin<Row>(utc("reserved_during", mine.lines[0]))).map((r) => r.u)).toEqual(["2030-06-18 14:00", "2030-06-18 14:00"]);
      expect((await admin<Row>(`select to_char(needed_until at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u, version from inv_requests where id = '${mine.req}'`))[0]).toMatchObject({ u: "2030-06-18 14:00" });
      // earlier start and shorter end are free as well
      await commit(U.pm, `select inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-09 09:00", return_due: "2030-06-16 18:00" })})`);
      expect((await admin<Row>(utc("reserved_during", mine.lines[0]))).map((r) => [r.f, r.u])[0]).toEqual(["2030-06-09 05:00", "2030-06-16 14:00"]);
    });
    it("leaves a conflicting line at its old range, reports the shortage, never displaces the other reservation, and updates other lines", async () => {
      const item = await newItem("individual");
      const free = await newItem("individual");
      const [ua, ub] = [await newUnit(item), await newUnit(item)];
      const uf = await newUnit(free);
      const mine = await mkRequest([{ item, qty: 2 }, { item: free, qty: 1 }]);
      await reserve(U.whA, mine.lines[0], LOC.a, `, ${arr([ua, ub])}`);
      await reserve(U.whA, mine.lines[1], LOC.a, `, ${arr([uf])}`);
      // somebody else holds unit B right after our window
      const other = await mkRequest([{ item, qty: 1 }], { project: PRJ.p2, pm: U.pm2, plan: { dispatch: "2030-06-17 09:00", return_due: "2030-06-20 18:00" } });
      await reserve(U.whC, other.lines[0], LOC.a, `, ${arr([ub])}`);
      const before = await admin<Row>(`select id, reserved_during::text rd, status from inv_reservations order by id`);
      const w = await one<Row>(U.pm, `inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-10 09:00", return_due: "2030-06-18 18:00" })})`);
      expect(w.extended).toEqual([{ line_id: mine.lines[1], reservations: 1 }]);          // the free line moved
      expect(w.conflicts).toHaveLength(1);
      expect(w.conflicts[0]).toMatchObject({ line_id: mine.lines[0], shortage: 1 });
      expect(w.conflicts[0].reason).toMatch(/already reserved from 17 Jun 2030 09:00/);
      expect(w.conflicts[0].kept_window.until).toMatch(/2030-06-15T14:00/);
      // all or nothing per line: unit A (which could have been extended) kept its old range too
      const rows = await admin<Row>(`select unit_id, to_char(upper(reserved_during) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u from inv_reservations where request_line_id = '${mine.lines[0]}' and status = 'active' order by unit_id`);
      expect(rows.map((r) => r.u)).toEqual(["2030-06-15 14:00", "2030-06-15 14:00"]);
      // nobody lost anything: every reservation of every other line is as it was
      const after = await admin<Row>(`select id, reserved_during::text rd, status from inv_reservations order by id`);
      const changed = after.filter((a) => before.find((b) => b.id === a.id)?.rd !== a.rd).map((a) => a.id);
      expect(changed).toHaveLength(1);
      expect((await admin<Row>(`select status from inv_reservations where request_line_id = '${other.lines[0]}'`))[0].status).toBe("active");
      expect(await num(`select count(*) n from inv_reservations where request_line_id = '${mine.lines[0]}' and status = 'active'`)).toBe(2);
      // the project sees a shortage for the window it asked for
      const pe = await q<{ r: Row }>(U.pm, `select inv_project_equipment('${PRJ.p1}') as r`);
      expect(pe[0].r.shortages.some((s: Row) => s.line_id === mine.lines[0] && Number(s.short_qty) === 2)).toBe(true);
    });
    it("checks quantity reservations against the free stock for the new dates", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 10);
      const mine = await mkRequest([{ item, qty: 6 }]);
      await reserve(U.whA, mine.lines[0], LOC.a);
      const other = await mkRequest([{ item, qty: 6 }], { project: PRJ.p2, pm: U.pm2, plan: { dispatch: "2030-06-16 09:00", return_due: "2030-06-20 18:00" } });
      expect((await reserve(U.whA, other.lines[0], LOC.a)).reserved_now).toBe(6);        // the two windows do not overlap yet
      const w = await one<Row>(U.pm, `inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-10 09:00", return_due: "2030-06-18 18:00" })})`);
      expect(w.conflicts).toHaveLength(1);
      expect(w.conflicts[0]).toMatchObject({ line_id: mine.lines[0], shortage: 2 });
      expect((await admin<Row>(`select qty, to_char(upper(reserved_during) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u from inv_reservations where request_line_id = '${mine.lines[0]}'`))[0]).toMatchObject({ u: "2030-06-15 14:00" });
      const ok = await one<Row>(U.pm, `inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-10 09:00", return_due: "2030-06-15 20:00" })})`);
      expect(ok.conflicts).toEqual([]);
      expect(ok.extended).toHaveLength(1);
    });
    it("only extends the end of equipment that is already out, and needs a plan that has a start and an end", async () => {
      const item = await newItem("individual");
      const unit = await newUnit(item);
      const mine = await mkRequest([{ item, qty: 1 }]);
      await reserve(U.whA, mine.lines[0], LOC.a, `, ${arr([unit])}`);
      await admin(`update inv_reservations set dispatched_qty = 1 where request_line_id = '${mine.lines[0]}'`);
      await admin(`update inv_units set custody_kind = 'project', project_id = '${PRJ.p1}', expected_return_at = '2030-06-15 14:00+00' where id = '${unit}'`);
      const w = await one<Row>(U.pm, `inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-12 09:00", return_due: "2030-06-19 18:00" })})`);
      expect(w.conflicts).toEqual([]);
      expect((await admin<Row>(utc("reserved_during", mine.lines[0])))[0]).toEqual({ f: "2030-06-10 05:00", u: "2030-06-19 14:00" });       // start unchanged, end extended
      await fails(U.pm, `select inv_change_request_window('${mine.req}', ${j({ dispatch: "2030-06-12 09:00" })})`, /start and an end/);
      await fails(U.pm, `select inv_save_request_plan('${mine.req}', ${j(W2)})`, /already reserved/);
    });
    it("is limited to people who may change the request and refuses a stale version", async () => {
      const item = await newItem("quantity");
      const mine = await mkRequest([{ item, qty: 1 }]);
      await fails(U.pm2, `select inv_change_request_window('${mine.req}', ${j(W2)})`, /not found/i);
      await fails(U.viewer, `select inv_change_request_window('${mine.req}', ${j(W2)})`, /cannot change/);
      await fails(U.pm, `select inv_change_request_window('${mine.req}', ${j(W2)}, null, 1)`, /changed by someone else/);
      await commit(U.whA, `select inv_change_request_window('${mine.req}', ${j(W2)})`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("cancellation", () => {
    it("releases unused reservations, keeps dispatched equipment outstanding, and keeps the history", async () => {
      const item = await newItem("individual");
      const [u1, u2] = [await newUnit(item, { serial: "SN-OUT-1" }), await newUnit(item)];
      const qty = await newItem("quantity");
      await newBalance(qty, 10);
      const { req, lines } = await mkRequest([{ item, qty: 2 }, { item: qty, qty: 5 }]);
      await reserve(U.whA, lines[0], LOC.a, `, ${arr([u1, u2])}`);
      await reserve(U.whA, lines[1], LOC.a);
      // simulate dispatch with admin SQL: unit 1 and 3 of the 5 are out
      await admin(`update inv_reservations set dispatched_qty = 1 where unit_id = '${u1}' and status = 'active'`);
      await admin(`update inv_units set custody_kind = 'project', project_id = '${PRJ.p1}', expected_return_at = '2030-06-15 14:00+00' where id = '${u1}'`);
      await admin(`update inv_reservations set dispatched_qty = 3 where request_line_id = '${lines[1]}' and status = 'active'`);
      await expect(commit(U.pm, `select inv_cancel_request('${req}')`)).rejects.toThrow(/Say why/);
      await expect(commit(U.pm2, `select inv_cancel_request('${req}', 'x')`)).rejects.toThrow(/not found/i);
      await expect(commit(U.viewer, `select inv_cancel_request('${req}', 'x')`)).rejects.toThrow(/cannot change/);
      const r = await one<Row>(U.pm, `inv_cancel_request('${req}', 'The client cancelled the show')`);
      expect(r).toMatchObject({ status: "cancelled", released_qty: 3, outstanding_qty: 4 });
      const rows = await admin<Row>(`select unit_id, qty, dispatched_qty, status, released_reason from inv_reservations where request_line_id in ('${lines[0]}', '${lines[1]}') order by status, unit_id nulls last, qty`);
      const active = rows.filter((x) => x.status === "active");
      expect(active.map((x) => [x.unit_id ?? "qty", Number(x.qty), Number(x.dispatched_qty)]).sort()).toEqual([[u1, 1, 1], ["qty", 3, 3]].sort());
      const released = rows.filter((x) => x.status === "released");
      expect(released).toHaveLength(2);
      expect(released.every((x) => x.released_reason === "The client cancelled the show")).toBe(true);
      expect(released.map((x) => Number(x.qty)).sort()).toEqual([1, 2]);                        // the unused unit, and the unused 2 of 5
      expect(await num(`select coalesce(sum(returned_qty), 0) n from inv_reservations where request_line_id in ('${lines[0]}', '${lines[1]}')`)).toBe(0);   // no fictional returns
      const [rq] = await admin<Row>(`select status, cancelled_at, cancel_reason from inv_requests where id = '${req}'`);
      expect(rq).toMatchObject({ status: "cancelled", cancel_reason: "The client cancelled the show" });
      expect(await num(`select count(*) n from inv_request_lines where request_id = '${req}' and status = 'cancelled'`)).toBe(2);
      // the freed unit is available again, the unit that is out is not
      const av = await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`);
      expect(av[0].r).toMatchObject({ free_for_range: 1, dispatched_to_projects: 1 });
      // the outstanding equipment is still shown to the project
      const pe = (await q<{ r: Row }>(U.pm, `select inv_project_equipment('${PRJ.p1}') as r`))[0].r;
      const out = (pe.outstanding as Row[]).filter((o) => o.request_code === (rq && (pe.requests as Row[]).find((x) => x.id === req)?.code));
      expect(out.map((o) => Number(o.qty_outstanding)).sort()).toEqual([1, 3]);
      expect(out.find((o) => o.unit_code && o.serial_number === "SN-OUT-1")).toBeTruthy();
      // idempotent
      const again = await one<Row>(U.pm, `inv_cancel_request('${req}', 'again')`);
      expect(again).toMatchObject({ status: "cancelled", outstanding_qty: 4 });
      await fails(U.whA, `select inv_reserve('${lines[0]}', '${LOC.a}')`, /Only a submitted request/);
    });
    it("cancels one line the same way, leaving the other lines alone", async () => {
      const item = await newItem("quantity");
      const item2 = await newItem("quantity");
      await newBalance(item, 10); await newBalance(item2, 10);
      const { req, lines } = await mkRequest([{ item, qty: 5 }, { item: item2, qty: 2 }]);
      await reserve(U.whA, lines[0], LOC.a); await reserve(U.whA, lines[1], LOC.a);
      await admin(`update inv_reservations set dispatched_qty = 2 where request_line_id = '${lines[0]}'`);
      const r = await one<Row>(U.pm, `inv_cancel_request_line('${lines[0]}', 'not needed')`);
      expect(r).toMatchObject({ status: "cancelled", released_qty: 3, outstanding_qty: 2 });
      expect((await admin<Row>(`select qty, dispatched_qty from inv_reservations where request_line_id = '${lines[0]}' and status = 'active'`))[0]).toMatchObject({ qty: "2.000", dispatched_qty: "2.000" });
      expect(await resCount(lines[1])).toBe(2);
      expect((await admin<Row>(`select status from inv_requests where id = '${req}'`))[0].status).toBe("in_progress");
      await fails(U.pm2, `select inv_cancel_request_line('${lines[1]}')`, /not found/i);
    });
    it("cancels a draft without a reason, and refuses to cancel a fulfilled request", async () => {
      const item = await newItem("quantity");
      const d = await mkRequest([{ item, qty: 1 }], { submit: false });
      expect((await one<Row>(U.pm, `inv_cancel_request('${d.req}')`)).status).toBe("cancelled");
      const f = await mkRequest([{ item, qty: 1 }]);
      await admin(`update inv_requests set status = 'fulfilled' where id = '${f.req}'`);
      await fails(U.pm, `select inv_cancel_request('${f.req}', 'x')`, /fulfilled request cannot be cancelled/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("project completion and archive", () => {
    it("releases unused reservations and cancels draft / submitted requests, keeps dispatched equipment, and never blocks completion", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 20);
      const unitItem = await newItem("individual");
      const unit = await newUnit(unitItem);
      const draft = await mkRequest([{ item, qty: 1 }], { project: PRJ.done, submit: false });
      const submitted = await mkRequest([{ item, qty: 1 }], { project: PRJ.done });
      const active = await mkRequest([{ item, qty: 5 }, { item: unitItem, qty: 1 }], { project: PRJ.done });
      await reserve(U.whA, active.lines[0], LOC.a);
      await reserve(U.whA, active.lines[1], LOC.a, `, ${arr([unit])}`);
      await admin(`update inv_reservations set dispatched_qty = 2 where request_line_id = '${active.lines[0]}'`);
      await admin(`update proj_projects set status = 'completed', completed_at = now() where id = '${PRJ.done}'`);
      expect((await admin<Row>(`select status from proj_projects where id = '${PRJ.done}'`))[0].status).toBe("completed");
      expect((await admin<Row>(`select status, cancel_reason from inv_requests where id = '${draft.req}'`))[0]).toMatchObject({ status: "cancelled", cancel_reason: "Project completed" });
      expect((await admin<Row>(`select status from inv_requests where id = '${submitted.req}'`))[0].status).toBe("cancelled");
      expect((await admin<Row>(`select status from inv_requests where id = '${active.req}'`))[0].status).toBe("in_progress");
      const rs = await admin<Row>(`select request_line_id, qty, dispatched_qty, status, released_reason from inv_reservations where request_line_id in ('${active.lines[0]}', '${active.lines[1]}') order by status, qty`);
      expect(rs.filter((r) => r.status === "active").map((r) => [Number(r.qty), Number(r.dispatched_qty)])).toEqual([[2, 2]]);
      expect(rs.filter((r) => r.status === "released").map((r) => [Number(r.qty), r.released_reason])).toEqual([[1, "Project completed"], [3, "Project completed"]]);
      const pe = (await q<{ r: Row }>(U.projFounder, `select inv_project_equipment('${PRJ.done}') as r`))[0].r;
      expect((pe.outstanding as Row[]).map((o) => Number(o.qty_outstanding))).toEqual([2]);
      // archiving later releases what is still unused and changes nothing that is out
      await admin(`update proj_projects set status = 'archived', archived_at = now() where id = '${PRJ.done}'`);
      expect(await num(`select count(*) n from inv_reservations where request_line_id = '${active.lines[0]}' and status = 'active' and dispatched_qty = 2`)).toBe(1);
    });
    it("releases at archive too, and a failure inside the hook never blocks the project change", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 10);
      const a = await mkRequest([{ item, qty: 4 }], { project: PRJ.arch });
      await reserve(U.whA, a.lines[0], LOC.a);
      await admin(`update proj_projects set status = 'archived', archived_at = now() where id = '${PRJ.arch}'`);
      expect(await resCount(a.lines[0], "released")).toBe(4);
      expect((await admin<Row>(`select status from inv_requests where id = '${a.req}'`))[0].status).toBe("in_progress");
      // now make the hook fail on purpose
      const b = await mkRequest([{ item, qty: 3 }], { project: PRJ.boom });
      await reserve(U.whA, b.lines[0], LOC.a);
      await admin(`create or replace function inv_test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom from test'; end; $$;
        create trigger inv_test_boom_trg before update on inv_reservations for each row execute function inv_test_boom();`);
      try {
        await admin(`update proj_projects set status = 'completed', completed_at = now() where id = '${PRJ.boom}'`);
        expect((await admin<Row>(`select status from proj_projects where id = '${PRJ.boom}'`))[0].status).toBe("completed");
        const log = await admin<Row>(`select outcome, detail from inv_import_log where project_id = '${PRJ.boom}'`);
        expect(log).toHaveLength(1);
        expect(log[0].outcome).toBe("failed");
        expect(log[0].detail).toMatch(/boom from test/);
        expect(await resCount(b.lines[0])).toBe(3);                               // nothing half-done: the whole hook rolled back
      } finally {
        await admin(`drop trigger inv_test_boom_trg on inv_reservations; drop function inv_test_boom();`);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("technology availability", () => {
    it("considers every required component x quantity, alternatives and commitments, per component and overall", async () => {
      const h1 = await newItem("individual", { name: nm("Light 1") });
      const h2 = await newItem("individual", { name: nm("Light 2") });
      const cab = await newItem("quantity", { name: nm("Cable q") });
      const opt = await newItem("quantity", { name: nm("Spare q") });
      const t = await mkTech(nm("Light show"), [{ item: h1, qty: 2, alt: "light", sort: 10 }, { item: h2, qty: 2, alt: "light", sort: 20 }, { item: cab, qty: 6, sort: 30 }, { item: opt, qty: 1, opt: true, sort: 40 }]);
      for (let i = 0; i < 3; i++) await newUnit(h1);
      for (let i = 0; i < 5; i++) await newUnit(h2);
      await newBalance(cab, 10);
      const av = async (qty: number, from = "2030-06-10", until = "2030-06-15") => (await q<{ r: Row }>(U.pm, `select inv_technology_availability('${t}', ${qty}, '${LOC.a}', '${from}', '${until}') as r`))[0].r;
      const one1 = await av(1);
      expect(one1.result).toBe("available");
      expect(one1.rows).toHaveLength(3);
      expect(one1.rows[0]).toMatchObject({ item_id: h1, needed: 2, free: 3, short: 0, status: "available", alt_group: "light" });
      expect(one1.rows[1]).toMatchObject({ item_id: cab, needed: 6, free: 10, status: "available" });
      expect(one1.rows[2]).toMatchObject({ is_optional: true, status: "short" });                     // optional rows never change the result
      const two = await av(2);
      expect(two.result).toBe("partial");                                                             // 4 heads of the standard model: only 3; cable 12: only 10
      expect(two.rows[0]).toMatchObject({ status: "alternative", short: 1, alternative_item_id: h2 });
      expect(two.rows[1]).toMatchObject({ status: "partial", needed: 12, free: 10, short: 2 });
      expect(two.needs_substitution).toBe(true);
      expect(two.shortages.map((s: Row) => [s.item_id, Number(s.short), s.covered_by_alternative])).toEqual([[h1, 1, true], [cab, 2, false]]);
      const big = await av(5);
      expect(big.result).toBe("partial");
      expect(big.rows[0].status).toBe("partial");                                                      // 3 of 10 standard heads, and no alternative covers 10
      // an existing commitment in the range reduces the answer; another range is unaffected
      const r = await mkRequest([{ item: cab, qty: 8 }]);
      await reserve(U.whA, r.lines[0], LOC.a);
      const after = await av(1);
      expect(after.rows[1]).toMatchObject({ free: 2, short: 4, status: "partial" });
      expect((await av(1, "2030-08-01", "2030-08-05")).result).toBe("available");
      expect(JSON.stringify(after)).not.toMatch(/unit_code|serial/);
    });
    it("says short when nothing is available, and check_required for a draft template", async () => {
      const item = await newItem("quantity");
      const t = await mkTech(nm("Empty stock"), [{ item, qty: 1 }]);
      const r = (await q<{ r: Row }>(U.pm, `select inv_technology_availability('${t}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(r).toMatchObject({ result: "short" });
      const d = await mkTech(nm("Draft only"), [{ item, qty: 1 }], "draft");
      expect((await q<{ r: Row }>(U.pm, `select inv_technology_availability('${d}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r).toMatchObject({ result: "check_required", message: "Warehouse check required" });
    });
    it("lets browsers see counts only, and keeps outsiders, other companies and bad input out", async () => {
      const item = await newItem("individual", { name: nm("Hidden custody") });
      await newUnit(item, { code: SECRET.unitCodeTag + "-1", serial: SECRET.serial });
      await newUnit(item, { code: SECRET.unitCodeTag + "-2", custody: "employee", employee: EMP.emp });
      await db.seed(`insert into inv_costs (company_id, item_id, unit_id, unit_cost, currency) select '${CO.uae}', '${item}', id, ${SECRET.cost}, 'AED' from inv_units where item_id = '${item}'`);
      const t = await mkTech(nm("Hidden tech"), [{ item, qty: 1 }]);
      for (const user of [U.browser, U.pm, U.cat]) {
        const a = (await q<{ r: Row }>(user, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
        expect(a).toMatchObject({ free_for_range: 1, assigned_to_employees: 1 });
        expect(a.units).toBeUndefined();
        const text = JSON.stringify(a) + JSON.stringify((await q<{ r: Row }>(user, `select inv_technology_availability('${t}', 1, '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r);
        for (const s of [SECRET.employee, SECRET.cost, SECRET.serial, SECRET.unitCodeTag, "Marta"]) expect(text).not.toContain(s);
      }
      const viewer = (await q<{ r: Row }>(U.viewer, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(viewer.units).toHaveLength(2);                                                          // unit level only for stock readers
      expect(JSON.stringify(viewer)).not.toContain(SECRET.employee);
      await fails(U.outsider, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15')`, /Item not found/);
      await fails(U.ksaFounder, `select inv_availability('${item}', '${LOC.ksa}', '2030-06-10', '2030-06-15')`, /Item not found/);
      await fails(U.ksaFounder, `select inv_technology_availability('${t}', 1, '${LOC.ksa}', '2030-06-10', '2030-06-15')`, /Technology not found/);
      await fails(U.browser, `select inv_availability('${item}', '${LOC.ksa}', '2030-06-10', '2030-06-15')`, /Location not found/);
      await fails(U.browser, `select inv_availability('${item}', '${LOC.a}', '2030-06-15', '2030-06-10')`, /end after the start/);
      await fails(U.browser, `select inv_technology_availability('${t}', 0, '${LOC.a}', '2030-06-10', '2030-06-15')`, /more than zero/);
    });
    it("reports every dimension for individual equipment: physical, usable, reserved, out, assigned, transit, inspection, damaged, overdue", async () => {
      const item = await newItem("individual");
      const transfer = (await admin<{ id: string }>(`insert into inv_transfers (company_id, code, from_location_id, to_location_id, dispatched_by, expected_at)
        values ('${CO.uae}', '${nm("TRF")}', '${LOC.b}', '${LOC.a}', '${U.whB}', now() + interval '2 days') returning id`))[0].id;
      await newUnit(item); await newUnit(item);                                                                     // 2 usable
      await newUnit(item, { cond: "fair" });                                                                        // usable (fair)
      await newUnit(item, { cond: "needs_inspection" });
      await newUnit(item, { cond: "damaged" });
      await newUnit(item, { life: "missing" });
      await newUnit(item, { life: "draft" });
      await newUnit(item, { custody: "employee", employee: EMP.emp });
      await newUnit(item, { custody: "project", project: PRJ.p2, returnAt: "now() - interval '1 day'" });
      await newUnit(item, { custody: "repair", repair: "RMA-9" });
      await newUnit(item, { custody: "transit", loc: LOC.b, transfer });
      const reserved = await newUnit(item);
      const { lines } = await mkRequest([{ item, qty: 1 }]);
      await reserve(U.whA, lines[0], LOC.a, `, ${arr([reserved])}`);
      const a = (await q<{ r: Row }>(U.founder, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r;
      expect(a).toMatchObject({
        physical_at_location: 6, usable_now: 4, reserved_in_range: 1, dispatched_to_projects: 1, assigned_to_employees: 1, in_transit: 1,
        awaiting_inspection: 1, damaged_repair_missing: 3, draft_unverified: 1, overdue: 1, free_for_range: 4, returning_on_time: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("Sales availability checks", () => {
    let wall = "", truss = "", lights = "";
    const wallName = nm("LED wall sales");
    const lightsName = nm("Light rig sales");
    let opp = "";

    it("sets up templates and stock for the Sales checks", async () => {
      truss = await newItem("quantity", { name: nm("Sales truss") });
      const panel = await newItem("quantity", { name: nm("Sales panel") });
      const lamp = await newItem("individual", { name: nm("Sales lamp") });
      await newBalance(truss, 10); await newBalance(panel, 20);
      for (let i = 0; i < 4; i++) await newUnit(lamp);
      wall = await mkTech(wallName, [{ item: panel, qty: 10, sort: 10 }, { item: truss, qty: 3, sort: 20 }]);
      lights = await mkTech(lightsName, [{ item: lamp, qty: 2, sort: 10 }, { item: truss, qty: 4, sort: 20 }]);
      opp = await mkOpp(U.salesA, { techs: [{ name: wallName.toUpperCase(), qty: 1 }, { name: "Mystery holograms", qty: 1 }], install: "2030-06-08", start: "2030-06-10", end: "2030-06-12", location: "Expo Hall 3" });
      expect(wall && lights).toBeTruthy();
    });
    it("lets the opportunity's owner or a Sales founder ask, once, and nobody else", async () => {
      await fails(U.salesB, `select inv_request_opportunity_check('${opp}', '${LOC.a}')`, /Only the owner/);
      await fails(U.outsider, `select inv_request_opportunity_check('${opp}', '${LOC.a}')`, /not found/i);
      await fails(U.pm, `select inv_request_opportunity_check('${opp}', '${LOC.a}')`, /not found/i);
      await fails(U.whA, `select inv_request_opportunity_check('${opp}', '${LOC.a}')`, /not found/i);
      await fails(U.salesA, `select inv_request_opportunity_check('${opp}', '${LOC.ksa}')`, /Location not found/);
      const a = await one<string>(U.salesA, `inv_request_opportunity_check('${opp}', '${LOC.a}')`);
      const b = await one<string>(U.salesA, `inv_request_opportunity_check('${opp}', '${LOC.a}')`);
      const c = await one<string>(U.crmFounder, `inv_request_opportunity_check('${opp}')`);
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(await num(`select count(*) n from inv_availability_checks where opportunity_id = '${opp}' and result = 'pending'`)).toBe(1);
      const [row] = await admin<Row>(`select result, requested_by, checked_at from inv_availability_checks where id = '${a}'`);
      expect(row).toMatchObject({ result: "pending", requested_by: U.salesA, checked_at: null });
    });
    it("keeps one pending check per opportunity even when asked for at the same moment", async () => {
      const o = await mkOpp(U.salesA, { techs: [{ name: "Whatever", qty: 1 }], start: "2030-09-10", end: "2030-09-12" });
      const res = await Promise.all([U.salesA, U.crmFounder, U.salesA, U.crmFounder].map((u) => commit<{ v: string }>(u, `select inv_request_opportunity_check('${o}', '${LOC.a}') as v`)));
      expect(new Set(res.map((r) => r[0].v)).size).toBe(1);
      expect(await num(`select count(*) n from inv_availability_checks where opportunity_id = '${o}'`)).toBe(1);
    });
    it("reserves nothing when a check is asked for or recorded", async () => {
      const before = await num(`select count(*) n from inv_reservations`);
      const balBefore = await admin<Row>(`select id, qty from inv_balances where item_id = '${truss}'`);
      await commit(U.whA, `select inv_record_opportunity_check('${opp}', null, 'first look')`);
      expect(await num(`select count(*) n from inv_reservations`)).toBe(before);
      expect(await admin<Row>(`select id, qty from inv_balances where item_id = '${truss}'`)).toEqual(balBefore);
      expect(await num(`select count(*) n from inv_requests where source_ref = '${opp}'`)).toBe(0);
    });
    it("says 'Warehouse check required' for a technology without a complete template and never invents 'available'", async () => {
      const [c] = await admin<Row>(`select * from inv_availability_checks where opportunity_id = '${opp}' and result <> 'pending'`);
      expect(c.result).toBe("check_required");
      expect(c.checked_by).toBe(U.whA);
      expect(c.note).toBe("first look");
      const rows = c.summary as Row[];
      expect(rows.find((r) => r.technology === "Mystery holograms")).toMatchObject({ status: "check_required", message: "Warehouse check required" });
      expect(rows.find((r) => (r.technology as string).toLowerCase() === wallName.toLowerCase())).toMatchObject({ status: "available" });   // matched case-insensitively
      expect(c.covers).toMatchObject({ install_start: "2030-06-08", event_start: "2030-06-10", event_end: "2030-06-12", location: "Expo Hall 3", location_id: LOC.a });
      expect(c.covers.technologies).toHaveLength(2);
      // a draft template is no basis either
      const draftName = nm("Draft sales tech");
      await mkTech(draftName, [{ item: truss, qty: 1 }], "draft");
      const o2 = await mkOpp(U.salesA, { techs: [{ name: draftName, qty: 1 }], start: "2030-06-10", end: "2030-06-12" });
      await commit(U.whA, `select inv_record_opportunity_check('${o2}', '${LOC.a}')`);
      const [d] = await admin<Row>(`select result, summary from inv_availability_checks where opportunity_id = '${o2}'`);
      expect(d.result).toBe("check_required");
      expect(d.summary[0]).toMatchObject({ status: "check_required" });
      // no dates, no technologies
      const o3 = await mkOpp(U.salesA, { techs: [{ name: wallName, qty: 1 }] });
      await commit(U.whA, `select inv_record_opportunity_check('${o3}', '${LOC.a}')`);
      expect((await admin<Row>(`select result, summary from inv_availability_checks where opportunity_id = '${o3}'`))[0].result).toBe("check_required");
      const o4 = await mkOpp(U.salesA, { techs: [], start: "2030-06-10", end: "2030-06-12" });
      await commit(U.whA, `select inv_record_opportunity_check('${o4}', '${LOC.a}')`);
      expect((await admin<Row>(`select result from inv_availability_checks where opportunity_id = '${o4}'`))[0].result).toBe("check_required");
    });
    it("lets only warehouse, catalogue managers and founders record a check, in their own company", async () => {
      for (const user of [U.salesA, U.salesB, U.crmFounder, U.pm, U.viewer, U.browser, U.outsider, U.ksaFounder]) {
        await fails(user, `select inv_record_opportunity_check('${opp}', '${LOC.a}')`, /Only warehouse staff|not found/i);
      }
      await fails(U.whA, `select inv_record_opportunity_check('${opp}', '${LOC.ksa}')`, /Location not found/);
      await fails(U.whA, `select inv_record_opportunity_check('${opp}')`, /Choose the location/);
      await commit(U.cat, `select inv_record_opportunity_check('${opp}', '${LOC.a}', 'catalogue manager')`);
      await commit(U.founder, `select inv_record_opportunity_check('${opp}', '${LOC.a}', 'founder')`);
    });
    it("supersedes the earlier check without deleting it, and a fully covered opportunity becomes 'available'", async () => {
      const first = await admin<Row>(`select id from inv_availability_checks where opportunity_id = '${opp}' and result <> 'pending' order by checked_at`);
      expect(first.length).toBeGreaterThanOrEqual(3);
      await admin(`update crm_opportunities set technologies = ${j([{ name: wallName.toLowerCase(), qty: 1 }, { name: lightsName, qty: 1 }])} where id = '${opp}'`);
      const id2 = await one<string>(U.whA, `inv_record_opportunity_check('${opp}', '${LOC.a}', 'all templates exist now')`);
      const rows = await admin<Row>(`select id, result, superseded_by from inv_availability_checks where opportunity_id = '${opp}' order by checked_at, id`);
      expect(rows.length).toBe(first.length + 1);
      expect(rows.filter((r) => r.superseded_by === null)).toHaveLength(1);
      expect(rows.find((r) => r.id === id2)).toMatchObject({ result: "available", superseded_by: null });
      for (const f of first) expect(rows.find((r) => r.id === f.id)?.superseded_by).not.toBeNull();     // earlier rows stay, marked as superseded
    });
    it("shares stock between technologies of one opportunity instead of counting it twice", async () => {
      const item = await newItem("quantity", { name: nm("Shared truss") });
      await newBalance(item, 5);
      const n1 = nm("Shared A"), n2 = nm("Shared B");
      await mkTech(n1, [{ item, qty: 3 }]); await mkTech(n2, [{ item, qty: 3 }]);
      const o = await mkOpp(U.salesA, { techs: [{ name: n1, qty: 1 }, { name: n2, qty: 1 }], start: "2030-09-10", end: "2030-09-12" });
      await commit(U.whA, `select inv_record_opportunity_check('${o}', '${LOC.a}')`);
      const [c] = await admin<Row>(`select result, summary from inv_availability_checks where opportunity_id = '${o}'`);
      expect(c.result).toBe("partial");
      expect(c.summary.map((s: Row) => s.status)).toEqual(["available", "partial"]);
      expect(c.summary[1].shortages).toEqual([{ item_name: expect.stringContaining("Shared truss"), short: 1 }]);
    });
    it("reports the latest check, who made it and when, a live summary, and whether it is out of date", async () => {
      const a = (await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${opp}') as r`))[0].r;
      expect(a).toMatchObject({ state: "checked", needs_recheck: false });
      expect(a.latest).toMatchObject({ result: "available", note: "all templates exist now", location_name: "Dubai warehouse" });
      expect(a.latest.checked_by).toBe("whA");
      expect(a.latest.checked_at).toBeTruthy();
      expect(a.live.result).toBe("available");
      expect(a.live.summary).toHaveLength(2);
      // out of date as soon as dates, technologies, quantities or the location text move away from what was checked
      const check = async (label: string, change: string, restore: string) => {
        await admin(`update crm_opportunities set ${change} where id = '${opp}'`);
        const r = (await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${opp}') as r`))[0].r;
        expect(r.needs_recheck, label).toBe(true);
        expect(r.latest.result, label).toBe("available");                                                 // the earlier check is preserved
        await admin(`update crm_opportunities set ${restore} where id = '${opp}'`);
        expect((await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${opp}') as r`))[0].r.needs_recheck, label + " restored").toBe(false);
      };
      await check("install date", `install_start = '2030-06-09'`, `install_start = '2030-06-08'`);
      await check("event start", `event_start = '2030-06-11'`, `event_start = '2030-06-10'`);
      await check("event end", `event_end = '2030-06-13'`, `event_end = '2030-06-12'`);
      await check("location text", `location = 'Expo Hall 4'`, `location = 'Expo Hall 3'`);
      const techs = (await admin<Row>(`select technologies from crm_opportunities where id = '${opp}'`))[0].technologies;
      await check("quantity", `technologies = ${j(techs.map((t: Row, i: number) => (i === 0 ? { ...t, qty: 2 } : t)))}`, `technologies = ${j(techs)}`);
      await check("technologies", `technologies = ${j([techs[0]])}`, `technologies = ${j(techs)}`);
      // and a new check makes it current again, while the old rows remain
      await admin(`update crm_opportunities set location = 'Expo Hall 5' where id = '${opp}'`);
      const before = await num(`select count(*) n from inv_availability_checks where opportunity_id = '${opp}'`);
      await commit(U.whA, `select inv_record_opportunity_check('${opp}', '${LOC.a}')`);
      expect(await num(`select count(*) n from inv_availability_checks where opportunity_id = '${opp}'`)).toBe(before + 1);
      expect((await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${opp}') as r`))[0].r.needs_recheck).toBe(false);
      await admin(`update crm_opportunities set location = 'Expo Hall 3' where id = '${opp}'`);
    });
    it("shows a live summary with shortages and alternatives at summary level, and 'Warehouse check required' before any check", async () => {
      const item = await newItem("individual", { name: nm("Alt A") });
      const alt = await newItem("individual", { name: nm("Alt B") });
      await newUnit(alt);
      const n = nm("Alt tech");
      await mkTech(n, [{ item, qty: 1, alt: "g", sort: 10 }, { item: alt, qty: 1, alt: "g", sort: 20 }]);
      const o = await mkOpp(U.salesA, { techs: [{ name: n, qty: 1 }], start: "2030-09-10", end: "2030-09-12" });
      const none = (await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${o}') as r`))[0].r;
      expect(none).toMatchObject({ state: "none", message: "Warehouse check required", latest: null, live: null, needs_recheck: false });
      await commit(U.salesA, `select inv_request_opportunity_check('${o}', '${LOC.a}')`);
      const pend = (await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${o}') as r`))[0].r;
      expect(pend.state).toBe("pending");
      expect(pend.pending.requested_by).toBe("salesA");
      expect(pend.live.summary[0]).toMatchObject({ status: "partial", needs_substitution: true });
      expect(pend.live.summary[0].alternatives).toHaveLength(1);
      expect(pend.live.summary[0].shortages).toHaveLength(1);
      await fails(U.salesB, `select inv_opportunity_availability('${o}')`, /not found/i);
      await fails(U.outsider, `select inv_opportunity_availability('${o}')`, /not found/i);
      expect((await q<{ r: Row }>(U.crmFounder, `select inv_opportunity_availability('${o}') as r`))[0].r.state).toBe("pending");
      expect((await q<{ r: Row }>(U.whA, `select inv_opportunity_availability('${o}') as r`))[0].r.state).toBe("pending");
    });
    it("exposes no cost, employee custody or unrelated project data to Sales, by function and by table", async () => {
      const item = await newItem("individual", { name: nm("Leaky item") });
      const u1 = await newUnit(item, { code: SECRET.unitCodeTag + "-A", serial: SECRET.serial });
      await newUnit(item, { custody: "employee", employee: EMP.emp });
      await db.seed(`insert into inv_costs (company_id, item_id, unit_id, unit_cost, currency) values ('${CO.uae}', '${item}', '${u1}', ${SECRET.cost}, 'AED')`);
      const secretReq = await mkRequest([{ item, qty: 1 }], { project: PRJ.secret, pm: U.pm3 });
      await reserve(U.founder, secretReq.lines[0], LOC.a, `, ${arr([u1])}`);
      const n = nm("Leaky tech");
      await mkTech(n, [{ item, qty: 1 }]);
      const o = await mkOpp(U.salesA, { techs: [{ name: n, qty: 1 }], start: "2030-06-10", end: "2030-06-12" });
      await commit(U.salesA, `select inv_request_opportunity_check('${o}', '${LOC.a}')`);
      await commit(U.whA, `select inv_record_opportunity_check('${o}', '${LOC.a}')`);
      const text = JSON.stringify((await q<{ r: Row }>(U.salesA, `select inv_opportunity_availability('${o}') as r`))[0].r);
      for (const s of [SECRET.employee, SECRET.project, SECRET.cost, SECRET.serial, SECRET.unitCodeTag, "Marta", "unit_code", "AED"]) expect(text).not.toContain(s);
      const checkRows = await q<Row>(U.salesA, `select * from inv_availability_checks where opportunity_id = '${o}'`);
      expect(JSON.stringify(checkRows)).not.toContain(SECRET.employee);
      expect(JSON.stringify(checkRows)).not.toContain(SECRET.project);
      for (const t of ["inv_units", "inv_balances", "inv_costs", "inv_reservations", "inv_requests", "inv_request_lines", "inv_movements", "inv_kit_contents", "inv_import_log", "inv_counts"]) {
        expect(await q(U.salesA, `select 1 from ${t}`), t).toHaveLength(0);
      }
      expect(await q(U.salesB, `select 1 from inv_availability_checks where opportunity_id = '${o}'`)).toHaveLength(0);
      expect(await q(U.outsider, `select 1 from inv_availability_checks`)).toHaveLength(0);
      expect((await q(U.crmFounder, `select 1 from inv_availability_checks where opportunity_id = '${o}'`)).length).toBeGreaterThan(0);
      expect(await q(U.salesA, `select 1 from proj_projects where name = '${SECRET.project}'`)).toHaveLength(0);
    });
    it("never reserves anything when an opportunity is won, or moves through any CRM stage", async () => {
      const wallN = nm("Won tech");
      const stock = await newItem("quantity");
      await newBalance(stock, 10);
      await mkTech(wallN, [{ item: stock, qty: 2 }]);
      const o = await mkOpp(U.salesA, { techs: [{ name: wallN, qty: 3 }], install: "2030-09-08", start: "2030-09-10", end: "2030-09-12" });
      await commit(U.salesA, `select inv_request_opportunity_check('${o}', '${LOC.a}')`);
      await commit(U.whA, `select inv_record_opportunity_check('${o}', '${LOC.a}')`);
      const snap = async () => JSON.stringify(await admin(`select (select count(*) from inv_reservations) r, (select count(*) from inv_requests) q, (select count(*) from inv_request_lines) l,
        (select coalesce(sum(qty), 0) from inv_balances) b, (select count(*) from inv_availability_checks) c`));
      const before = await snap();
      for (const stage of ["qualified", "proposal_prep", "quote_sent", "negotiation"]) {
        await commit(U.salesA, `select crm_move_stage('${o}', '${stage}')`).catch(() => undefined);
      }
      await winOpp(o, U.salesA);
      expect((await admin<Row>(`select stage from crm_opportunities where id = '${o}'`))[0].stage).toBe("won");
      expect(await snap()).toBe(before);
      expect(await num(`select count(*) n from inv_reservations`)).toBeGreaterThanOrEqual(0);
      expect(await num(`select count(*) n from inv_reservations r join inv_request_lines l on l.id = r.request_line_id join inv_requests q on q.id = l.request_id where q.source_ref = '${o}'`)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("Projects: handover import and equipment view", () => {
    let wallItem = "", frame = "", wallTech = "";
    const wallName = nm("Handover wall");
    let oppH1 = "", handover1 = "", projectH1 = "", requestH1 = "";

    it("sets up a template for the handover", async () => {
      wallItem = await newItem("quantity", { name: nm("Handover panel") });
      frame = await newItem("quantity", { name: nm("Handover frame") });
      await newBalance(wallItem, 100); await newBalance(frame, 50);
      wallTech = await mkTech(wallName, [{ item: wallItem, qty: 10, sort: 10 }, { item: frame, qty: 2, sort: 20, note: "check bolts" }]);
      oppH1 = await mkOpp(U.salesA, { techs: [{ name: wallName, qty: 3 }, { name: "Unknown laser", qty: 2 }], install: "2030-09-08", start: "2030-09-10", end: "2030-09-12", location: "Hall 9" });
      await winOpp(oppH1, U.salesA);
      handover1 = await handoverAccept(oppH1, U.salesA, U.pm);
      // fingerprints of everything outside Inventory, before the project exists and before any further planning call
      hrBefore = JSON.stringify(await admin(`select (select md5(string_agg(row(e.id, e.manager_id, e.employment_status, e.company_id)::text, ',' order by e.id)) from employees e) emps,
        (select count(*) from user_roles) roles, (select count(*) from assets) assets, (select count(*) from asset_assignments) assignments`));
      crmBefore = JSON.stringify(await admin(`select (select md5(string_agg(row(o.id, o.stage, o.owner_id, o.value, o.scope, o.technologies, o.availability_state, o.version)::text, ',' order by o.id)) from crm_opportunities o) opps,
        (select count(*) from crm_handovers) hand, (select count(*) from crm_opportunity_events) ev`));
      projBefore = JSON.stringify(await admin(`select (select md5(string_agg(row(p.id, p.status, p.pm_user_id, p.version, p.name)::text, ',' order by p.id)) from proj_projects p where p.id in ('${PRJ.p1}', '${PRJ.p2}', '${PRJ.p3}', '${PRJ.secret}')) projects,
        (select md5(string_agg(row(h.id, h.status, h.technologies)::text, ',' order by h.id)) from proj_handovers h) handovers,
        (select count(*) from proj_project_members) members`));
    });
    it("imports the frozen handover into ONE draft request when the PM accepts it (real accept flow), scaled by quantity", async () => {
      projectH1 = (await one<string>(U.pm, `proj_accept_handover('${handover1}')`));
      expect((await admin<Row>(`select kind, status from proj_projects where id = '${projectH1}'`))[0]).toMatchObject({ kind: "client", status: "planning" });
      const reqs = await admin<Row>(`select * from inv_requests where project_id = '${projectH1}'`);
      expect(reqs).toHaveLength(1);
      requestH1 = reqs[0].id;
      expect(reqs[0]).toMatchObject({ status: "draft", source: "sales_handover", source_ref: oppH1, kind: "project", company_id: CO.uae, timezone: "Asia/Dubai", requested_by: U.pm });
      expect(reqs[0].code).toMatch(/^UAE-R-\d{5}$/);
      expect(reqs[0].note).toContain("Unknown laser x2");
      expect(reqs[0].note).toContain("No complete technology template");
      const lines = await admin<Row>(`select item_id, qty, technology_snapshot, status from inv_request_lines where request_id = '${requestH1}' order by sort_order`);
      expect(lines.map((l) => [l.item_id, Number(l.qty)])).toEqual([[wallItem, 30], [frame, 6]]);              // template qty x technology qty (3)
      expect(lines[0].technology_snapshot).toMatchObject({ name: wallName, multiplier: 3 });
      expect(lines.length).toBe(2);                                                                             // the unmatched technology is never invented as a line
      const log = await admin<Row>(`select outcome, detail, source_ref from inv_import_log where project_id = '${projectH1}'`);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ outcome: "imported", source_ref: oppH1 });
      expect(log[0].detail).toContain("Unknown laser x2");
      // dates from the handover, whole days in the project's zone: install 8 Sep 00:00 to the end of 12 Sep (Dubai = UTC+4)
      const [w] = await admin<Row>(`select to_char(needed_from at time zone 'UTC', 'YYYY-MM-DD HH24:MI') f, to_char(needed_until at time zone 'UTC', 'YYYY-MM-DD HH24:MI') u from inv_requests where id = '${requestH1}'`);
      expect(w).toEqual({ f: "2030-09-07 20:00", u: "2030-09-12 20:00" });
    });
    it("is idempotent: retries and double clicks create nothing new, whoever retries", async () => {
      for (const user of [U.pm, U.pm, U.projFounder, U.founder]) {
        expect(await one<string>(user, `inv_import_handover_requirements('${projectH1}')`)).toBe(requestH1);
      }
      const results = await Promise.all([U.pm, U.pm, U.pm].map((u) => commit<{ v: string }>(u, `select inv_import_handover_requirements('${projectH1}') as v`)));
      expect(new Set(results.map((r) => r[0].v))).toEqual(new Set([requestH1]));
      expect(await num(`select count(*) n from inv_requests where project_id = '${projectH1}'`)).toBe(1);
      expect(await num(`select count(*) n from inv_request_lines where request_id = '${requestH1}'`)).toBe(2);
      expect(await num(`select count(*) n from inv_import_log where project_id = '${projectH1}'`)).toBe(1);
      // the handover is frozen: changing the template or the CRM opportunity afterwards imports nothing more
      await commit(U.cat, `select inv_save_technology_components('${wallTech}', ${j([{ item_id: wallItem, qty: 99 }])})`);
      await admin(`update crm_opportunities set technologies = '[]'::jsonb where id = '${oppH1}'`);
      expect(await one<string>(U.pm, `inv_import_handover_requirements('${projectH1}')`)).toBe(requestH1);
      expect(Number((await admin<Row>(`select qty from inv_request_lines where request_id = '${requestH1}' order by sort_order limit 1`))[0].qty)).toBe(30);
      await admin(`update crm_opportunities set technologies = ${j([{ name: wallName, qty: 3 }, { name: "Unknown laser", qty: 2 }])} where id = '${oppH1}'`);
      await commit(U.cat, `select inv_save_technology_components('${wallTech}', ${j([{ item_id: wallItem, qty: 10 }, { item_id: frame, qty: 2 }])})`);
    });
    it("limits the manual import to the project's PM and founders, and to a project that came from a handover", async () => {
      for (const user of [U.pm2, U.memberOnly, U.whA, U.viewer, U.salesA, U.outsider, U.ksaFounder]) {
        await fails(user, `select inv_import_handover_requirements('${projectH1}')`, /Only the project manager/);
      }
      await fails(U.pm, `select inv_import_handover_requirements('${PRJ.p1}')`, /Sales handover/);
      await fails(U.pm, `select inv_import_handover_requirements('${id()}')`, /Project not found/);
    });
    it("lets the PM work on the imported draft (adjust, add, submit) like any other request", async () => {
      const lines = await admin<Row>(`select id from inv_request_lines where request_id = '${requestH1}' order by sort_order`);
      await commit(U.pm, `select inv_update_request_line('${lines[0].id}', 28, 'client reduced the wall')`);
      await commit(U.pm, `select inv_cancel_request_line('${lines[1]!.id}', 'client supplies frames')`);
      await commit(U.pm, `select inv_submit_request('${requestH1}')`);
      expect((await admin<Row>(`select status from inv_requests where id = '${requestH1}'`))[0].status).toBe("submitted");
      await fails(U.pm2, `select inv_cancel_request('${requestH1}', 'x')`, /not found/i);
    });
    it("never blocks the handover when the import fails: the project is created, the failure is logged, and the PM can retry", async () => {
      const opp = await mkOpp(U.salesA, { techs: [{ name: wallName, qty: 1 }], install: "2030-10-08", start: "2030-10-10", end: "2030-10-12", location: "Hall 1" });
      await winOpp(opp, U.salesA);
      const h = await handoverAccept(opp, U.salesA, U.pm2);
      await admin(`create or replace function inv_test_fail_import() returns trigger language plpgsql as $$ begin raise exception 'import is broken today'; end; $$;
        create trigger inv_test_fail_import_trg before insert on inv_requests for each row execute function inv_test_fail_import();`);
      let project = "";
      try {
        project = await one<string>(U.pm2, `proj_accept_handover('${h}')`);
      } finally {
        await admin(`drop trigger inv_test_fail_import_trg on inv_requests; drop function inv_test_fail_import();`);
      }
      expect((await admin<Row>(`select status from proj_handovers where id = '${h}'`))[0].status).toBe("accepted");
      expect((await admin<Row>(`select kind from proj_projects where id = '${project}'`))[0].kind).toBe("client");
      expect(await num(`select count(*) n from inv_requests where project_id = '${project}'`)).toBe(0);
      const log = await admin<Row>(`select outcome, detail from inv_import_log where project_id = '${project}'`);
      expect(log).toHaveLength(1);
      expect(log[0].outcome).toBe("failed");
      expect(log[0].detail).toMatch(/import is broken today/);
      // the PM retries once the cause is gone, and a second click changes nothing
      const req = await one<string>(U.pm2, `inv_import_handover_requirements('${project}')`);
      expect(req).toBeTruthy();
      expect(await one<string>(U.pm2, `inv_import_handover_requirements('${project}')`)).toBe(req);
      expect(await num(`select count(*) n from inv_request_lines where request_id = '${req}'`)).toBe(2);
      expect((await admin<Row>(`select outcome from inv_import_log where project_id = '${project}' order by created_at`)).map((r) => r.outcome)).toEqual(["failed", "imported"]);
    });
    it("logs 'nothing_to_import' when the handover lists no technologies and creates no request", async () => {
      const opp = await mkOpp(U.salesA, { techs: [], install: "2030-10-08", start: "2030-10-10", end: "2030-10-12" });
      await winOpp(opp, U.salesA);
      const h = await handoverAccept(opp, U.salesA, U.pm3);
      const project = await one<string>(U.pm3, `proj_accept_handover('${h}')`);
      expect(await num(`select count(*) n from inv_requests where project_id = '${project}'`)).toBe(0);
      expect((await admin<Row>(`select outcome from inv_import_log where project_id = '${project}'`)).map((r) => r.outcome)).toEqual(["nothing_to_import"]);
      expect(await one<string | null>(U.pm3, `inv_import_handover_requirements('${project}')`)).toBeNull();
    });

    it("shows the project its requests, lines with progress, reservations, shortages and outstanding items, without cost or employee data", async () => {
      const item = await newItem("individual", { name: nm("Equipment view item") });
      const u1 = await newUnit(item, { code: "UAE-E-VIEW1", serial: "SN-VIEW-1" });
      await newUnit(item, { custody: "employee", employee: EMP.emp });
      await db.seed(`insert into inv_costs (company_id, item_id, unit_id, unit_cost, currency) values ('${CO.uae}', '${item}', '${u1}', ${SECRET.cost}, 'AED')`);
      const stock = await newItem("quantity", { name: nm("Equipment view stock") });
      await newBalance(stock, 3);
      const { req, lines } = await mkRequest([{ item, qty: 2 }, { item: stock, qty: 5 }], { project: PRJ.p2, pm: U.pm2 });
      await reserve(U.whA, lines[0], LOC.a);
      await reserve(U.whA, lines[1], LOC.a, `, null, null, 'need_to_buy'`);
      await admin(`update inv_reservations set dispatched_qty = 1, returned_qty = 0 where request_line_id = '${lines[0]}' and unit_id = '${u1}'`);
      const v = (await q<{ r: Row }>(U.pm2, `select inv_project_equipment('${PRJ.p2}') as r`))[0].r;
      const r = (v.requests as Row[]).find((x) => x.id === req) as Row;
      expect(r).toMatchObject({ status: "in_progress", timezone: "Asia/Dubai", source: "manual" });
      const l0 = (r.lines as Row[]).find((l) => l.id === lines[0]) as Row;
      expect(l0.progress).toMatchObject({ reserved: 1, dispatched: 1, returned: 0, outstanding: 1, shortage: 1 });
      expect(l0.reservations[0]).toMatchObject({ unit_code: "UAE-E-VIEW1", serial_number: "SN-VIEW-1", status: "active", covers_request_window: true });
      expect(l0.reservations[0].item_name).toContain("Equipment view item");
      const l1 = (r.lines as Row[]).find((l) => l.id === lines[1]) as Row;
      expect(l1.progress).toMatchObject({ reserved: 3, shortage: 2 });
      expect(l1).toMatchObject({ shortage_action: "need_to_buy" });
      expect((v.shortages as Row[]).filter((s) => s.request_code === r.code).map((s) => [s.item_name.includes("Equipment view stock") ? "stock" : "unit", Number(s.short_qty)]).sort()).toEqual([["stock", 2], ["unit", 1]]);
      expect((v.outstanding as Row[]).filter((o) => o.unit_code === "UAE-E-VIEW1")).toHaveLength(1);
      const text = JSON.stringify(v);
      for (const s of [SECRET.employee, SECRET.cost, "Marta", "AED", "unit_cost", SECRET.project, "Gamma gallery", "Alpha stage"]) expect(text).not.toContain(s);
      // another project's equipment is not in this view, and its people cannot open it
      expect((v.requests as Row[]).every((x) => x.id !== requestH1)).toBe(true);
      for (const user of [U.pm, U.pm3, U.outsider, U.salesA, U.browser, U.viewer, U.cat, U.ksaFounder]) {
        await fails(user, `select inv_project_equipment('${PRJ.p2}')`, /Project not found/);
      }
      for (const user of [U.whA, U.founder, U.projFounder]) expect((await q<{ r: Row }>(user, `select inv_project_equipment('${PRJ.p2}') as r`))[0].r.project_id).toBe(PRJ.p2);
      // a plain member of the project can see it as well
      expect((await q<{ r: Row }>(U.memberOnly, `select inv_project_equipment('${PRJ.p1}') as r`))[0].r.project_id).toBe(PRJ.p1);
    });
    it("hides requests of one project from the PM of another through the tables as well", async () => {
      const rows = await q<Row>(U.pm2, `select id, project_id from inv_requests`);
      const mine = (await admin<{ id: string }>(`select id from proj_projects where pm_user_id = '${U.pm2}'`)).map((x) => x.id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.project_id === null || mine.includes(r.project_id))).toBe(true);
      expect(await q(U.pm2, `select 1 from inv_requests where project_id = '${PRJ.p1}'`)).toHaveLength(0);
      expect(await q(U.pm2, `select 1 from inv_request_lines l join inv_requests r on r.id = l.request_id where r.project_id = '${PRJ.p1}'`)).toHaveLength(0);
      expect(await q(U.pm2, `select 1 from inv_units`)).toHaveLength(0);
      expect(await q(U.pm2, `select 1 from inv_costs`)).toHaveLength(0);
      expect(await q(U.pm2, `select 1 from inv_import_log where project_id = '${PRJ.p1}'`)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("access, company and role boundaries", () => {
    it("denies access the moment it is revoked, even for a page that was already open", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 5);
      const { lines } = await mkRequest([{ item, qty: 1 }, { item, qty: 1 }]);
      expect((await reserve(U.whRev, lines[0], LOC.a)).reserved_now).toBe(1);                 // the page works...
      await db.seed(`update inv_company_grants set revoked_at = now() where user_id = '${U.whRev}'`);
      await expect(commit(U.whRev, `select inv_reserve('${lines[1]}', '${LOC.a}') as r`)).rejects.toThrow(/Only warehouse staff|not found/i);   // ...and the second call fails
      await db.seed(`update inv_company_grants set revoked_at = null where user_id = '${U.whRev}'`);
    });
    it("denies a project manager whose Projects access is revoked after the page was opened", async () => {
      expect((await q<{ r: Row }>(U.pm3, `select inv_project_equipment('${PRJ.p3}') as r`))[0].r.project_id).toBe(PRJ.p3);
      const item = await newItem("quantity");
      const mine = await mkRequest([{ item, qty: 1 }], { project: PRJ.p3, pm: U.pm3, submit: false });
      await db.seed(`update proj_company_grants set revoked_at = now() where user_id = '${U.pm3}'`);
      try {
        await fails(U.pm3, `select inv_project_equipment('${PRJ.p3}')`, /Project not found/);
        await fails(U.pm3, `select inv_add_request_line('${mine.req}', '${item}', 1)`, /not found|cannot change/i);
        await fails(U.pm3, `select inv_create_request('project', '${PRJ.p3}', null, 'x', null, 'Asia/Dubai')`, /Only the project manager/);
        await fails(U.pm3, `select inv_decide_substitution('${mine.lines[0]}', true)`, /not found|Only the project manager/i);
      } finally {
        await db.seed(`update proj_company_grants set revoked_at = null where user_id = '${U.pm3}'`);
      }
    });
    it("denies writes while Inventory is switched off for the company, and keeps reads working", async () => {
      const item = await newItem("quantity");
      const mine = await mkRequest([{ item, qty: 1 }], { submit: false });
      await db.seed(`update inv_company_settings set is_enabled = false where company_id = '${CO.uae}'`);
      try {
        await fails(U.pm, `select inv_add_request_line('${mine.req}', '${item}', 1)`, /switched off/);
        await fails(U.pm, `select inv_create_request('project', '${PRJ.p1}', null, 'x', null, 'Asia/Dubai')`, /switched off/);
        await fails(U.cat, `select inv_save_technology('${CO.uae}', null, 'Off tech', null)`, /switched off/);
        await fails(U.salesA, `select inv_request_opportunity_check('${id()}')`, /not found/i);
        expect((await q<{ r: Row }>(U.pm, `select inv_project_equipment('${PRJ.p1}') as r`))[0].r.project_id).toBe(PRJ.p1);
        expect((await q<{ r: Row }>(U.browser, `select inv_availability('${item}', '${LOC.a}', '2030-06-10', '2030-06-15') as r`))[0].r.item_id).toBe(item);
      } finally {
        await db.seed(`update inv_company_settings set is_enabled = true where company_id = '${CO.uae}'`);
      }
    });
    it("keeps another company's staff out of this company's requests, reservations and templates", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 2);
      const mine = await mkRequest([{ item, qty: 1 }]);
      const t = await mkTech(nm("Company tech"), [{ item, qty: 1 }]);
      await fails(U.ksaFounder, `select inv_reserve('${mine.lines[0]}', '${LOC.ksa}')`, /not found/i);
      await fails(U.ksaFounder, `select inv_cancel_request('${mine.req}', 'x')`, /not found/i);
      await fails(U.ksaFounder, `select inv_expand_technology('${mine.req}', '${t}')`, /not found/i);
      await fails(U.ksaFounder, `select inv_set_technology_status('${t}', 'retired')`, /not found/i);
      await fails(U.ksaFounder, `select inv_save_technology_components('${t}', '[]'::jsonb)`, /not found/i);
      await fails(U.ksaFounder, `select inv_release_reservation('${id()}')`, /not found/i);
      expect(await q(U.ksaFounder, `select 1 from inv_requests`)).toHaveLength(0);
      expect(await q(U.ksaFounder, `select 1 from inv_technologies`)).toHaveLength(0);
      for (const user of [U.outsider, U.salesA]) {
        await fails(user, `select inv_reserve('${mine.lines[0]}', '${LOC.a}')`, /not found/i);
        await fails(user, `select inv_submit_request('${mine.req}')`, /not found/i);
      }
    });
    it("gives a warehouse operator no power over a location they are not assigned to", async () => {
      const item = await newItem("individual");
      const u = await newUnit(item, { loc: LOC.b });
      const { lines } = await mkRequest([{ item, qty: 1 }]);
      await fails(U.whA, `select inv_reserve('${lines[0]}', '${LOC.b}', ${arr([u])})`, /Only warehouse staff/);
      expect((await reserve(U.whB, lines[0], LOC.b, `, ${arr([u])}`)).reserved_now).toBe(1);
      await admin(`update inv_company_grants set capabilities = '{warehouse,cross_location}' where user_id = '${U.whC}'`);
      const second = await mkRequest([{ item, qty: 1 }], { project: PRJ.p2, pm: U.pm2, plan: W3 });
      expect((await reserve(U.whC, second.lines[0], LOC.b, `, ${arr([u])}`)).reserved_now).toBe(1);        // cross_location widens it
      await admin(`update inv_company_grants set capabilities = '{warehouse}' where user_id = '${U.whC}'`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("nothing outside Inventory changes", () => {
    it("leaves the HR rows and the Projects rows that existed before the planning calls exactly as they were, and the CRM availability fields untouched", async () => {
      const hr = JSON.stringify(await admin(`select (select md5(string_agg(row(e.id, e.manager_id, e.employment_status, e.company_id)::text, ',' order by e.id)) from employees e) emps,
        (select count(*) from user_roles) roles, (select count(*) from assets) assets, (select count(*) from asset_assignments) assignments`));
      expect(hr).toBe(hrBefore);
      const proj = await admin<Row>(`select md5(string_agg(row(p.id, p.status, p.pm_user_id, p.version, p.name)::text, ',' order by p.id)) projects from proj_projects p where p.id in ('${PRJ.p1}', '${PRJ.p2}', '${PRJ.p3}', '${PRJ.secret}')`);
      expect(proj[0].projects).toBe(JSON.parse(projBefore)[0].projects);
      expect(await num(`select count(*) n from crm_opportunities where availability_state <> 'unverified' or availability_covers is not null or availability_by is not null`)).toBe(0);
      expect(crmBefore).toBeTruthy();
    });
    it("changes no HR table and no CRM / Projects row when a planning call is made (before and after, row by row)", async () => {
      const snap = async () => JSON.stringify(await admin(`select
        (select md5(string_agg(row(e.*)::text, ',' order by e.id)) from employees e) emps,
        (select md5(string_agg(row(o.*)::text, ',' order by o.id)) from crm_opportunities o) opps,
        (select md5(string_agg(row(h.*)::text, ',' order by h.id)) from proj_handovers h) handovers,
        (select md5(string_agg(row(p.*)::text, ',' order by p.id)) from proj_projects p) projects,
        (select md5(string_agg(row(d.*)::text, ',' order by d.project_id)) from proj_project_details d) details,
        (select md5(string_agg(row(a.*)::text, ',' order by a.id)) from assets a) assets,
        (select count(*) from crm_opportunity_events) ev, (select count(*) from proj_change_log) chg`));
      const before = await snap();
      const item = await newItem("quantity");
      await newBalance(item, 5);
      const t = await mkTech(nm("Preserve tech"), [{ item, qty: 1 }]);
      const { req, lines } = await mkRequest([{ item, qty: 2 }]);
      await reserve(U.whA, lines[0], LOC.a);
      await commit(U.pm, `select inv_change_request_window('${req}', ${j(W2)})`);
      await q(U.pm, `select inv_project_equipment('${PRJ.p1}')`);
      await q(U.pm, `select inv_technology_availability('${t}', 1, '${LOC.a}', '2030-06-10', '2030-06-15')`);
      await commit(U.pm, `select inv_cancel_request('${req}', 'done')`);
      expect(await snap()).toBe(before);
    });
  });
});

function employeeNameLeak(text: string) {
  return text.includes(SECRET.employee) || text.includes("Marta");
}
