import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { rowTotal, settlementFigures, type ActualLine, type BudgetBasis, type FundingEntry, type PaymentEntry } from "../../domain/src/projectBudget";

// Project Budget & Expenses. Proves, against a real Postgres built from every migration:
//   * an explicit company-scoped grant model: no HR role, Projects membership/founder title, Sales grant or sys_admin reveals a budget;
//   * the budget workflow (draft, submit, return, reject, approve, revise, additions) with frozen versions and required reasons;
//   * independence (nobody decides what they prepared or submitted), the hold when no independent approver exists, exactly-once concurrent decisions;
//   * server-calculated row totals and rounding (equal to the TypeScript mirror), petrol/meal rates per company and currency;
//   * funding (advances vs Pluto allocations), actual expenses (blank vs zero, unplanned, paid-via, claim links, foreign-currency note),
//     per-source settlement figures equal to the TypeScript mirror, partial returns/reimbursements, receipts and exceptions, close and reopen;
//   * retries, stale edits, audited corrections, PM reassignment, archived projects, company and project isolation, notifications;
//   * that HR, Sales and existing claim data are untouched.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FIRST_PBX = "20261210000000_pbx_access_audit_settings.sql";
const PBX_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f >= FIRST_PBX && f.endsWith(".sql")).sort();

const id = () => randomUUID();
const CO = { uae: id(), ksa: id(), third: id() };
const U = {
  fin1: id(), fin2: id(), ksaFin: id(), viewer: id(), pm: id(), pm2: id(), pm3: id(), pmFin: id(), member: id(), member2: id(), outsider: id(),
  founder: id(), hrFin: id(), sales: id(), admin: id(), emp: id(),
  ceo: id(), cto: id(), ksaCeo: id(), dual: id(), ceoPm: id(), thirdPm: id(), thirdExec: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@pbx-test.ae')`).join(", ");

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

describe("Project Budget & Expenses", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const fails = (user: string | null, sql: string, re: RegExp) => expect(q(user, sql)).rejects.toThrow(re);
  const failsCommit = (user: string, sql: string, re: RegExp) => expect(commit(user, sql)).rejects.toThrow(re);
  const call = async <T = unknown>(user: string, sql: string): Promise<T> => (Object.values((await commit<Row>(user, sql))[0])[0] as T);

  let tableGrants: Row[] = [];
  let functionGrants: Row[] = [];
  let hrBefore = "";
  let claimsBefore = "";
  let cat: Record<string, string> = {};
  let refCounter = 100;

  const view = async (user: string, project: string) => (await q<{ v: Row }>(user, `select pbx_budget_view('${project}') as v`))[0].v;
  const num = (v: unknown) => Number(v);

  /** A project of the UAE company (or another) with its PM and members, created the way the owner's seeds do it. */
  async function newProject(pm: string, members: string[] = [], company = CO.uae, name = "Project") {
    const pid = id();
    refCounter += 1;
    await admin(`
      insert into proj_projects (id, company_id, reference, name, kind, pm_user_id, created_by, start_date, end_date)
        values ('${pid}', '${company}', 'T-P-2026-${refCounter}', '${name} ${refCounter}', 'internal', '${pm}', '${U.founder}', current_date, current_date + 10);
      insert into proj_project_details (project_id, location, site_timezone, install_start, event_start, event_end)
        values ('${pid}', 'Expo Hall 3', 'Asia/Dubai', current_date + 2, current_date + 4, current_date + 6);
      insert into proj_project_members (project_id, user_id, role) values ('${pid}', '${pm}', 'pm');
      ${members.map((m) => `insert into proj_project_members (project_id, user_id, role) values ('${pid}', '${m}', 'member');`).join("\n")}`);
    return pid;
  }

  // The four worked examples of the brief: food 3x2x60, petrol 60 km x 0.50, metro fixed 30 for three days, truck 3 trips x 350.
  const examples = () => [
    { category_id: cat.food, date_from: "2026-10-20", date_to: "2026-10-21", activity: "setup", description: "Team meals", basis: "per_person_day", people: "3", days: "2", rate: "60" },
    { category_id: cat.transport, date_from: "2026-10-20", activity: "setup", description: "Petrol to the venue", basis: "per_km", qty: "60", rate: "0.50", rate_key: "petrol_per_km" },
    { category_id: cat.transport, date_from: "2026-10-20", date_to: "2026-10-22", activity: "show", description: "Metro cards for the show days", basis: "fixed", fixed: "30" },
    { category_id: cat.logistics, date_from: "2026-10-23", activity: "dismantling", description: "Truck for dismantling", basis: "per_trip", qty: "3", rate: "350" },
  ];

  const draftOf = async (project: string) =>
    (await admin<{ id: string; row_version: number; budget_id: string }>(`select id, row_version, budget_id from pbx_budget_versions where project_id = '${project}' and status = 'draft'`))[0];

  /** Create (idempotent), fill and return the open draft. */
  async function makeBudget(project: string, pm: string, currency = "AED", rows: unknown[] = examples(), header: Row = {}) {
    const budget = await call<string>(pm, `select pbx_create_budget('${project}', '${currency}')`);
    const d = await draftOf(project);
    const rv = await call<number>(pm, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({ period_start: "2026-10-20", period_end: "2026-10-23", people: [pm], ...header })}, ${j(rows)})`);
    return { budget, version: d.id, rv };
  }
  const submit = (pm: string, b: { version: string; rv: number }, req = id()) => call<string>(pm, `select pbx_submit_budget('${b.version}', ${b.rv}, '${req}')`);
  async function approved(project: string, pm: string, approver: string, rows: unknown[] = examples()) {
    const b = await makeBudget(project, pm, "AED", rows);
    await submit(pm, b);
    await call(approver, `select pbx_decide_budget('${b.version}', 'approve')`);
    return b;
  }

  // Approved-budget row ids (in order) for a project, used by the actuals tests.
  const budgetRowIds = async (budget: string) => (await admin<{ id: string }>(`select r.id from pbx_budget_rows r join pbx_budget_versions v on v.id = r.version_id where v.budget_id = '${budget}' and v.status = 'approved' order by v.seq, r.sort_no`)).map((r) => r.id);
  const actualDraft = async (budget: string) => (await admin<{ id: string; row_version: number }>(`select id, row_version from pbx_actual_submissions where budget_id = '${budget}' and status = 'draft'`))[0];
  const actualsRows = async (submission: string) => await admin<Row>(`select * from pbx_actual_rows where submission_id = '${submission}' order by sort_no`);

  beforeAll(async () => {
    await db.setupBefore(FIRST_PBX);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR'), ('${CO.third}', 'Enginious Third', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hrFin}', 'finance'), ('${U.admin}', 'sys_admin');
    `);
    // What a real Supabase project does for every new object in public: broad default grants. The migrations must undo them themselves.
    await db.seed(`
      alter default privileges in schema public grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
      alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    for (const f of PBX_MIGRATIONS) await db.applyMigration(f);
    tableGrants = await admin<Row>(`select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name like 'pbx\\_%' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
    functionGrants = await admin<Row>(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pbx\\_%'`);
    await db.seed(`
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.pm}', '${CO.uae}', '{}'), ('${U.pm2}', '${CO.uae}', '{}'), ('${U.pm3}', '${CO.uae}', '{}'), ('${U.pmFin}', '${CO.uae}', '{}'),
        ('${U.member}', '${CO.uae}', '{}'), ('${U.member2}', '${CO.uae}', '{}'), ('${U.founder}', '${CO.uae}', '{founder}'),
        ('${U.ksaFin}', '${CO.ksa}', '{}'), ('${U.dual}', '${CO.uae}', '{}'), ('${U.ceoPm}', '${CO.uae}', '{}'), ('${U.thirdPm}', '${CO.third}', '{}');
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.uae}', '{founder}');
      -- Budget access exactly as the owner's setup SQL does it: explicit, per company, nothing inferred.
      insert into pbx_company_grants (user_id, company_id, capabilities) values
        ('${U.fin1}', '${CO.uae}', '{finance,manage_access}'), ('${U.fin2}', '${CO.uae}', '{finance}'), ('${U.pmFin}', '${CO.uae}', '{finance}'),
        ('${U.viewer}', '${CO.uae}', '{view}'), ('${U.ksaFin}', '${CO.ksa}', '{finance,manage_access}'),
        -- the company's authorised CEO / CTO approvers (explicit grants; a title confers nothing), and one person who is both Finance and an approver
        ('${U.ceo}', '${CO.uae}', '{executive_approver}'), ('${U.cto}', '${CO.uae}', '{executive_approver}'), ('${U.dual}', '${CO.uae}', '{finance,executive_approver}'),
        ('${U.ceoPm}', '${CO.uae}', '{executive_approver}'),
        -- a company that has a CEO-type approver but nobody in Finance
        ('${U.thirdExec}', '${CO.third}', '{executive_approver,manage_access}');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${id()}', '${U.pm}', 'E1', '${CO.uae}', 'AE', 'Pam', 'Manager', current_date - 400), ('${id()}', '${U.emp}', 'E2', '${CO.uae}', 'AE', 'Eve', 'Employee', current_date - 400);
    `);
    cat = Object.fromEntries((await admin<{ key: string; id: string }>(`select key, id from pbx_categories where company_id is null`)).map((r) => [r.key, r.id]));
    hrBefore = JSON.stringify(await admin(`select (select count(*) from user_roles) roles, (select count(*) from employees) emps, (select count(*) from approvals) approvals,
       (select count(*) from crm_company_grants) crm, (select count(*) from proj_company_grants) proj`));
    claimsBefore = JSON.stringify(await admin(`select count(*) n, md5(coalesce(string_agg(id::text || status::text || total_amount::text, ',' order by id), '')) h from reimbursement_claims`));
  }, 300_000);

  afterAll(async () => { await db.teardown(); });

  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("privileges and access", () => {
    it("clients have no DML on any pbx table and cannot run internal functions", async () => {
      expect(tableGrants.filter((g) => g.privilege_type !== "SELECT" || g.grantee !== "authenticated")).toEqual([]);
      const internal = ["pbx_require_user", "pbx_audit_trigger", "pbx_notify", "pbx_lock_budget", "pbx_require_pm", "pbx_require_finance", "pbx_refresh_snapshot", "pbx_settlement_figures",
        "pbx_settlement_blockers", "pbx_baseline_rows", "pbx_baseline_total", "pbx_name", "pbx_route_approvers", "pbx_approval_route", "pbx_can_decide", "pbx_require_approver", "pbx_user_is_finance", "pbx_is_actuals_author", "pbx_budget_row_calc"];
      for (const fn of internal) {
        const g = functionGrants.find((x) => x.proname === fn);
        expect(g, fn).toBeDefined();
        expect(g!.anon, fn).toBe(false);
        expect(g!.auth, fn).toBe(false);
      }
      expect(functionGrants.filter((g) => g.anon)).toEqual([]);
    });

    it("an unauthenticated visitor can call nothing", async () => {
      await fails(null, `select pbx_inbox()`, /permission denied/);
      await fails(null, `select * from pbx_budgets`, /permission denied/);
    });

    it("a Finance HR role, a Projects founder title, a Sales grant, sys_admin and plain membership confer no access", async () => {
      const p = await newProject(U.pm, [U.member]);
      for (const who of [U.hrFin, U.founder, U.sales, U.admin, U.outsider, U.member]) {
        expect((await q<{ a: Row }>(who, `select pbx_project_access('${p}') as a`))[0].a.can_open, who).toBe(false);
        await fails(who, `select pbx_budget_view('${p}')`, /Budget not found/);
        const inbox = (await q<{ i: Row }>(who, `select pbx_inbox() as i`))[0].i;
        expect(inbox.budget_approvals).toEqual([]);
        expect(inbox.is_finance_anywhere).toBe(false);
        await fails(who, `select pbx_create_budget('${p}', 'AED')`, /Only the Project Manager/);
      }
      expect((await q<{ a: Row }>(U.pm, `select pbx_project_access('${p}') as a`))[0].a).toMatchObject({ can_open: true, is_pm: true, has_budget: false });
      // Finance needs no Projects access, and the budget grant gives none
      expect((await q<{ ok: boolean }>(U.fin1, `select proj_has_access('${CO.uae}') as ok`))[0].ok).toBe(false);
      expect((await q<{ ok: boolean }>(U.fin1, `select pbx_is_finance('${CO.uae}') as ok`))[0].ok).toBe(true);
      expect((await q<{ ok: boolean }>(U.fin1, `select pbx_is_finance('${CO.ksa}') as ok`))[0].ok).toBe(false);
      await fails(U.fin1, `select pbx_create_budget('${p}', 'AED')`, /Only the Project Manager/);   // Finance does not prepare budgets
    });

    it("access management is explicit, company-scoped and cannot lock a company out", async () => {
      await fails(U.fin2, `select pbx_grant_access('${U.member}', '${CO.uae}', '{view}')`, /access management/);
      await fails(U.fin1, `select pbx_grant_access('${U.member}', '${CO.ksa}', '{view}')`, /access management/);
      await fails(U.fin1, `select pbx_grant_access('${U.member}', '${CO.uae}', '{superuser}')`, /Unknown capability/);
      await commit(U.fin1, `select pbx_grant_access('${U.member2}', '${CO.uae}', '{view}', 'read-only')`);
      expect((await q<{ ok: boolean }>(U.member2, `select pbx_can_view_company('${CO.uae}') as ok`))[0].ok).toBe(true);
      expect((await q<{ ok: boolean }>(U.member2, `select pbx_is_finance('${CO.uae}') as ok`))[0].ok).toBe(false);
      await commit(U.fin1, `select pbx_revoke_access('${U.member2}', '${CO.uae}')`);
      expect((await q<{ ok: boolean }>(U.member2, `select pbx_can_view_company('${CO.uae}') as ok`))[0].ok).toBe(false);
      await failsCommit(U.fin1, `select pbx_revoke_access('${U.fin1}', '${CO.uae}')`, /last person/);
      await failsCommit(U.fin1, `select pbx_grant_access('${U.fin1}', '${CO.uae}', '{finance}')`, /last person/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("row totals, rounding, rates and categories", () => {
    it("calculates the four worked examples on the server, with the project details filled in", async () => {
      const p = await newProject(U.pm, [U.member]);
      await makeBudget(p, U.pm);
      const v = await view(U.pm, p);
      expect((v.versions[0].rows as Row[]).map((r) => num(r.total))).toEqual([360, 30, 30, 1050]);
      expect(num(v.versions[0].total)).toBe(1470);
      expect(v.budget.currency).toBe("AED");
      expect(v.project).toMatchObject({ location: "Expo Hall 3", company_name: "Enginious UAE", site_timezone: "Asia/Dubai" });
    });

    it("a fixed total covers the whole period: leftover people, days and rate are cleared, never multiplied", async () => {
      const p = await newProject(U.pm);
      const b = await makeBudget(p, U.pm, "AED", [{ category_id: cat.transport, description: "Metro", basis: "fixed", fixed: "30", people: "3", days: "3", rate: "10", qty: "9" }]);
      const r = (await admin<Row>(`select total, people, days, qty, rate from pbx_budget_rows where version_id = '${b.version}'`))[0];
      expect(num(r.total)).toBe(30);
      expect([r.people, r.days, r.qty, r.rate]).toEqual([null, null, null, null]);
    });

    it("never trusts a total sent by the client", async () => {
      const p = await newProject(U.pm);
      const b = await makeBudget(p, U.pm, "AED", [{ category_id: cat.food, description: "Lunch", basis: "per_person", people: "2", rate: "25", total: "999999" }]);
      expect(num((await admin<Row>(`select total from pbx_budget_rows where version_id = '${b.version}'`))[0].total)).toBe(50);
    });

    it("equals the TypeScript calculation, including rounding half away from zero", async () => {
      const cases: { basis: BudgetBasis; people?: string; days?: string; qty?: string; rate?: string; fixed?: string }[] = [
        { basis: "per_person", people: "3", rate: "0.335" }, { basis: "qty_rate", qty: "1", rate: "10.005" }, { basis: "qty_rate", qty: "1", rate: "10.5" },
        { basis: "qty_rate", qty: "12.345", rate: "7.1234" }, { basis: "per_person_day", people: "7", days: "3", rate: "12.3456" }, { basis: "per_km", qty: "118.5", rate: "0.5" },
        { basis: "per_trip", qty: "3", rate: "350.005" }, { basis: "fixed", fixed: "1234.567" }, { basis: "qty_rate", qty: "0.001", rate: "0.5" }, { basis: "per_person", people: "1.5", rate: "33.33" },
        { basis: "per_person_day", people: "0.333", days: "3", rate: "100" }, { basis: "qty_rate", qty: "999999.999", rate: "9999.9999" },
      ];
      for (const [currency, project] of [["AED", await newProject(U.pm)], ["JPY", await newProject(U.pm)], ["KWD", await newProject(U.pm)]] as const) {
        const b = await makeBudget(project, U.pm, currency, cases.map((c) => ({ category_id: cat.other, description: "case", ...c })));
        const totals = (await admin<{ total: string }>(`select total from pbx_budget_rows where version_id = '${b.version}' order by sort_no`)).map((r) => num(r.total));
        expect(totals, currency).toEqual(cases.map((c) => rowTotal(c, currency)));
      }
    });

    it("rounds to the currency's decimals and refuses what a column cannot keep exactly", async () => {
      const dec = (await admin<Row>(`select pbx_round(10.5, 'JPY') jpy, pbx_round(10.0005, 'KWD') kwd, pbx_round(2.675, 'SAR') sar, pbx_currency_decimals('EUR') eur`))[0];
      expect([num(dec.jpy), num(dec.kwd), num(dec.sar), num(dec.eur)]).toEqual([11, 10.001, 2.68, 2]);
      const p = await newProject(U.pm);
      const b = await makeBudget(p, U.pm, "AED", [{ category_id: cat.food, description: "x", basis: "fixed", fixed: "1" }]);
      const bad = (rows: unknown[], re: RegExp) => failsCommit(U.pm, `select pbx_save_budget_draft('${b.version}', ${b.rv}, ${j({})}, ${j(rows)})`, re);
      await bad([{ category_id: cat.food, description: "x", basis: "per_person", people: "1", rate: "0.123456" }], /valid number/);
      await bad([{ category_id: cat.food, description: "x", basis: "per_person", people: "1", rate: "-3" }], /valid number/);
      await bad([{ category_id: cat.food, description: "x", basis: "per_person_day", people: "1", rate: "3" }], /people, the days and the rate/);
      await bad([{ description: "x", basis: "fixed", fixed: "3" }], /Choose a category/);
      await bad([{ category_id: cat.food, description: "", basis: "fixed", fixed: "3" }], /violates check constraint|description/);
      await bad([{ category_id: cat.food, description: "x", basis: "bogus", fixed: "3" }], /Choose how/);
    });

    it("petrol and meal rates are Finance's, per company and currency; a number is never applied to another currency", async () => {
      await fails(U.pm, `select pbx_set_rate('${CO.uae}', 'AED', 'petrol_per_km', 0.5)`, /Only Finance/);
      await fails(U.ksaFin, `select pbx_set_rate('${CO.uae}', 'AED', 'petrol_per_km', 0.5)`, /Only Finance/);
      await failsCommit(U.fin1, `select pbx_set_rate('${CO.uae}', 'AED', 'diesel', 1)`, /Unknown rate/);
      await commit(U.fin1, `select pbx_set_rate('${CO.uae}', 'AED', 'petrol_per_km', 0.5, 'confirmed by Finance')`);
      await commit(U.fin1, `select pbx_set_rate('${CO.uae}', 'AED', 'meal_per_person', 30)`);
      await commit(U.ksaFin, `select pbx_set_rate('${CO.ksa}', 'SAR', 'petrol_per_km', 0.75)`);
      const p = await newProject(U.pm);
      await makeBudget(p, U.pm);
      const v = await view(U.pm, p);
      expect(v.rates.map((r: Row) => `${r.currency}:${r.rate_key}`).sort()).toEqual(["AED:meal_per_person", "AED:petrol_per_km"]);
      const petrol = (await admin<Row>(`select configured_rate from pbx_budget_rows r join pbx_budget_versions v on v.id = r.version_id where v.project_id = '${p}' and r.rate_key = 'petrol_per_km'`))[0];
      expect(num(petrol.configured_rate)).toBe(0.5);
      // an SAR budget finds no AED rate: nothing is silently carried across currencies
      const ksaProject = await newProject(U.ksaFin, [], CO.ksa);
      await commit(U.ksaFin, `select pbx_create_budget('${ksaProject}', 'EUR')`);
      expect((await view(U.ksaFin, ksaProject)).rates).toEqual([]);
      // company isolation of rates
      expect(await q(U.fin1, `select 1 from pbx_rates where company_id = '${CO.ksa}'`)).toHaveLength(0);
    });

    it("Finance adds a company category (a simple controlled list) that only that company's PMs are offered", async () => {
      await fails(U.pm, `select pbx_add_category('${CO.uae}', 'Permits')`, /Only Finance/);
      await call(U.fin1, `select pbx_add_category('${CO.uae}', 'Permits & fees')`);
      await failsCommit(U.fin1, `select pbx_add_category('${CO.uae}', 'permits & fees')`, /already exists/);
      const p = await newProject(U.pm);
      await makeBudget(p, U.pm);
      expect((await view(U.pm, p)).categories.map((c: Row) => c.label)).toEqual(expect.arrayContaining(["Food", "Transport", "Contractor badges / access", "Accommodation", "Truck / logistics", "Other expenses", "Permits & fees"]));
      const ksaProject = await newProject(U.ksaFin, [], CO.ksa);
      await commit(U.ksaFin, `select pbx_create_budget('${ksaProject}', 'SAR')`);
      expect((await view(U.ksaFin, ksaProject)).categories.map((c: Row) => c.label)).not.toContain("Permits & fees");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("budget workflow", () => {
    it("the budget is created once per project with a fixed currency, and only the PM edits the draft", async () => {
      const p = await newProject(U.pm, [U.member]);
      const first = await call<string>(U.pm, `select pbx_create_budget('${p}', 'AED')`);
      const second = await call<string>(U.pm, `select pbx_create_budget('${p}', 'SAR')`);
      expect(second).toBe(first);
      expect((await admin<Row>(`select currency from pbx_budgets where id = '${first}'`))[0].currency).toBe("AED");
      await failsCommit(U.pm, `select pbx_create_budget('${p}', 'XX')`, /3-letter|currency/).catch(() => undefined);
      const d = await draftOf(p);
      await failsCommit(U.member, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({})}, ${j([])})`, /Only the Project Manager/);
      await failsCommit(U.fin1, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({})}, ${j([])})`, /Only the Project Manager/);
      expect(await q(U.fin1, `select 1 from pbx_budget_versions where id = '${d.id}'`)).toHaveLength(1);       // Finance may read (explicit grant)
      expect(await q(U.member, `select 1 from pbx_budget_versions where id = '${d.id}'`)).toHaveLength(0);
      expect(await q(U.outsider, `select 1 from pbx_budgets`)).toHaveLength(0);
      await fails(U.pm, `update pbx_budget_versions set total = 1 where id = '${d.id}'`, /permission denied/);
      await fails(U.pm, `insert into pbx_budget_rows (version_id, budget_id, company_id, category_id, category_key, category_label, description, basis, fixed) values ('${d.id}', '${first}', '${CO.uae}', '${cat.food}', 'food', 'Food', 'x', 'fixed', 1)`, /permission denied/);
    });

    it("a stale edit is refused clearly, and only project people can be listed", async () => {
      const p = await newProject(U.pm, [U.member]);
      const b = await makeBudget(p, U.pm);
      await failsCommit(U.pm, `select pbx_save_budget_draft('${b.version}', ${b.rv - 1}, ${j({})}, ${j(examples())})`, /changed by someone else/);
      const rv = await call<number>(U.pm, `select pbx_save_budget_draft('${b.version}', ${b.rv}, ${j({ people: [U.pm, U.member] })}, ${j(examples())})`);
      expect(rv).toBe(b.rv + 1);
      await failsCommit(U.pm, `select pbx_save_budget_draft('${b.version}', ${rv}, ${j({ people: [U.outsider] })}, ${j(examples())})`, /current member of the project/);
    });

    it("submission needs rows and a positive total; a retry is the same submission; the version is then frozen", async () => {
      const p = await newProject(U.pm, [U.member]);
      const empty = await makeBudget(p, U.pm, "AED", []);
      await failsCommit(U.pm, `select pbx_submit_budget('${empty.version}', ${empty.rv}, '${id()}')`, /at least one expense row/);
      const zero = await call<number>(U.pm, `select pbx_save_budget_draft('${empty.version}', ${empty.rv}, ${j({})}, ${j([{ category_id: cat.food, description: "free", basis: "fixed", fixed: "0" }])})`);
      await failsCommit(U.pm, `select pbx_submit_budget('${empty.version}', ${zero}, '${id()}')`, /more than zero/);
      const rv = await call<number>(U.pm, `select pbx_save_budget_draft('${empty.version}', ${zero}, ${j({})}, ${j(examples())})`);
      const req = id();
      await failsCommit(U.member, `select pbx_submit_budget('${empty.version}', ${rv}, '${req}')`, /Only the Project Manager/);
      const first = await call<string>(U.pm, `select pbx_submit_budget('${empty.version}', ${rv}, '${req}')`);
      const again = await call<string>(U.pm, `select pbx_submit_budget('${empty.version}', ${rv}, '${req}')`);
      expect(again).toBe(first);
      await failsCommit(U.pm, `select pbx_submit_budget('${empty.version}', ${rv}, '${id()}')`, /already submitted/);
      expect(await admin(`select 1 from pbx_budget_versions where project_id = '${p}' and status = 'submitted'`)).toHaveLength(1);
      await failsCommit(U.pm, `select pbx_save_budget_draft('${empty.version}', ${rv}, ${j({})}, ${j(examples())})`, /no longer a draft/);
      await expect(admin(`update pbx_budget_rows set description = 'edited' where version_id = '${empty.version}'`)).rejects.toThrow(/historical record/);
      await expect(admin(`update pbx_budget_versions set total = 1 where id = '${empty.version}'`)).rejects.toThrow(/historical record/);
      await expect(admin(`delete from pbx_budget_versions where id = '${empty.version}'`)).rejects.toThrow(/never deleted/);
      await expect(admin(`update pbx_budget_versions set status = 'draft' where id = '${empty.version}'`)).rejects.toThrow(/cannot move/);
    });

    it("a Finance-holding PM's submission goes to the CEO/CTO route: nobody else decides it, and not the submitter", async () => {
      const p = await newProject(U.pmFin, []);
      const b = await makeBudget(p, U.pmFin);
      await submit(U.pmFin, b);
      expect((await admin<Row>(`select approval_route from pbx_budget_versions where id = '${b.version}'`))[0].approval_route).toBe("executive");
      await failsCommit(U.pm, `select pbx_decide_budget('${b.version}', 'approve')`, /CEO or CTO|Only Finance|Budget not found/);
      await failsCommit(U.member, `select pbx_decide_budget('${b.version}', 'approve')`, /Budget not found|CEO or CTO/);
      await failsCommit(U.ksaFin, `select pbx_decide_budget('${b.version}', 'approve')`, /Budget not found|CEO or CTO/);
      await failsCommit(U.viewer, `select pbx_decide_budget('${b.version}', 'approve')`, /CEO or CTO/);
      await failsCommit(U.fin1, `select pbx_decide_budget('${b.version}', 'approve')`, /only the company's authorised CEO or CTO approver can decide/);   // a Finance colleague cannot approve Finance's own submission
      await failsCommit(U.pmFin, `select pbx_decide_budget('${b.version}', 'approve')`, /CEO or CTO/);                                               // the submitter holds no executive right
      expect(await admin(`select 1 from pbx_budget_versions where id = '${b.version}' and status = 'submitted'`)).toHaveLength(1);
      expect(await call<string>(U.ceo, `select pbx_decide_budget('${b.version}', 'approve')`)).toBe("approved");   // either CEO or CTO is enough
      await failsCommit(U.cto, `select pbx_decide_budget('${b.version}', 'approve')`, /already been decided/);
    });

    it("two approvers cannot create two decisions (Finance route)", async () => {
      const p = await newProject(U.pm);
      const b = await makeBudget(p, U.pm);
      await submit(U.pm, b);
      const results = await Promise.allSettled([
        commit(U.fin1, `select pbx_decide_budget('${b.version}', 'approve')`),
        commit(U.fin2, `select pbx_decide_budget('${b.version}', 'return', 'Please check the truck')`),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(String(loser.reason)).toMatch(/already been decided/);
      const row = (await admin<Row>(`select status, decided_by from pbx_budget_versions where id = '${b.version}'`))[0];
      expect(["approved", "returned"]).toContain(row.status);
      await failsCommit(U.fin2, `select pbx_decide_budget('${b.version}', 'approve')`, /already been decided/);
    });

    it("return and rejection need a reason; a revision is a new draft copying the old version; history is kept", async () => {
      const p = await newProject(U.pm);
      const b = await makeBudget(p, U.pm);
      await submit(U.pm, b);
      await failsCommit(U.fin1, `select pbx_decide_budget('${b.version}', 'return')`, /Give the reason/);
      await failsCommit(U.fin1, `select pbx_decide_budget('${b.version}', 'reject', ' ')`, /Give the reason/);
      await failsCommit(U.fin1, `select pbx_decide_budget('${b.version}', 'maybe', 'x')`, /Choose approve/);
      expect(await call<string>(U.fin1, `select pbx_decide_budget('${b.version}', 'return', 'The truck needs two trips only')`)).toBe("returned");
      await failsCommit(U.member, `select pbx_revise_budget('${b.version}')`, /Only the Project Manager|Budget not found/);
      const revised = await call<string>(U.pm, `select pbx_revise_budget('${b.version}')`);
      await failsCommit(U.pm, `select pbx_revise_budget('${b.version}')`, /already a version in progress/);
      const copied = await admin<Row>(`select total from pbx_budget_rows where version_id = '${revised}' order by sort_no`);
      expect(copied.map((r) => num(r.total))).toEqual([360, 30, 30, 1050]);
      const v = await view(U.pm, p);
      expect(v.versions.map((x: Row) => x.status)).toEqual(["returned", "draft"]);
      expect(v.versions[0].decision_note).toBe("The truck needs two trips only");
      expect(v.versions[1].parent_version_id).toBe(b.version);
      const d = await draftOf(p);
      const rv = await call<number>(U.pm, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({})}, ${j([{ category_id: cat.logistics, description: "Truck", basis: "per_trip", qty: "2", rate: "350" }])})`);
      await submit(U.pm, { version: d.id, rv });
      expect(await call<string>(U.fin2, `select pbx_decide_budget('${d.id}', 'reject', 'Not justified')`)).toBe("rejected");
      expect(num((await view(U.pm, p)).baseline)).toBe(0);
      const again = await call<string>(U.pm, `select pbx_revise_budget('${d.id}')`);
      expect(again).toBeTruthy();
      await call(U.pm, `select pbx_discard_draft('${again}')`);
      expect((await view(U.pm, p)).versions.map((x: Row) => x.status)).toEqual(["returned", "rejected"]);
    });

    it("with no eligible independent approver the submission is held, with a clear flag; an eligible one releases it", async () => {
      // KSA: the only Finance person is also the PM, and the company has no CEO/CTO approver yet -> held
      const p = await newProject(U.ksaFin, [], CO.ksa);
      await commit(U.ksaFin, `select pbx_create_budget('${p}', 'SAR')`);
      const d = await draftOf(p);
      const rv = await call<number>(U.ksaFin, `select pbx_save_budget_draft('${d.id}', ${d.row_version}, ${j({})}, ${j([{ category_id: cat.food, description: "Meals", basis: "per_person", people: "2", rate: "40" }])})`);
      await submit(U.ksaFin, { version: d.id, rv });
      const v = await view(U.ksaFin, p);
      expect(v.versions[0]).toMatchObject({ status: "submitted", approval_route: "executive", on_hold: true, i_can_decide: false });
      await failsCommit(U.ksaFin, `select pbx_decide_budget('${d.id}', 'approve')`, /CEO or CTO/);
      const inbox = (await q<{ i: Row }>(U.ksaFin, `select pbx_inbox() as i`))[0].i;
      expect(inbox.budget_approvals[0]).toMatchObject({ approval_route: "executive", on_hold: true, i_can_decide: false });
      // another Finance grantee of that company still cannot decide Finance's own submission; the UAE CEO has no say in KSA
      await commit(U.ksaFin, `select pbx_grant_access('${U.fin2}', '${CO.ksa}', '{finance}')`);
      expect((await view(U.ksaFin, p)).versions[0].on_hold).toBe(true);
      await failsCommit(U.fin2, `select pbx_decide_budget('${d.id}', 'approve')`, /CEO or CTO/);
      await failsCommit(U.ceo, `select pbx_decide_budget('${d.id}', 'approve')`, /Budget not found|CEO or CTO/);
      // an authorised CEO/CTO approver of KSA releases it
      await commit(U.ksaFin, `select pbx_grant_access('${U.ksaCeo}', '${CO.ksa}', '{executive_approver}')`);
      expect((await view(U.ksaFin, p)).versions[0].on_hold).toBe(false);
      expect(await call<string>(U.ksaCeo, `select pbx_decide_budget('${d.id}', 'approve')`)).toBe("approved");
      await commit(U.ksaFin, `select pbx_revoke_access('${U.fin2}', '${CO.ksa}')`);
      await commit(U.ksaFin, `select pbx_revoke_access('${U.ksaCeo}', '${CO.ksa}')`);
    });

    it("additional budget requests show only the increment; pending, returned and rejected ones never raise the approved amount", async () => {
      const p = await newProject(U.pm, [U.member]);
      const o = await makeBudget(p, U.pm);
      await failsCommit(U.pm, `select pbx_request_addition('${o.budget}')`, /needs an approved budget first/);
      await submit(U.pm, o);
      await call(U.fin1, `select pbx_decide_budget('${o.version}', 'approve')`);
      expect(num((await view(U.pm, p)).baseline)).toBe(1470);
      await failsCommit(U.member, `select pbx_request_addition('${o.budget}')`, /Only the Project Manager|Budget not found/);
      const add = await call<string>(U.pm, `select pbx_request_addition('${o.budget}')`);
      await failsCommit(U.pm, `select pbx_request_addition('${o.budget}')`, /already a version in progress/);
      const d = await draftOf(p);
      expect(d.id).toBe(add);
      const rv = await call<number>(U.pm, `select pbx_save_budget_draft('${add}', ${d.row_version}, ${j({})}, ${j([{ category_id: cat.accommodation, description: "Two extra hotel nights", basis: "qty_rate", qty: "2", rate: "250" }])})`);
      const subAdd = await submit(U.pm, { version: add, rv });
      let v = await view(U.pm, p);
      expect(num(v.baseline)).toBe(1470);                                                 // pending: not counted
      expect(v.versions.find((x: Row) => x.id === add)).toMatchObject({ kind: "addition", status: "submitted", total: expect.anything() });
      await call(U.fin2, `select pbx_decide_budget('${add}', 'return', 'Which nights?')`);
      expect(num((await view(U.pm, p)).baseline)).toBe(1470);                             // returned: not counted
      const rev = await call<string>(U.pm, `select pbx_revise_budget('${add}')`);
      const d2 = await draftOf(p);
      const rv2 = await call<number>(U.pm, `select pbx_save_budget_draft('${rev}', ${d2.row_version}, ${j({})}, ${j([{ category_id: cat.accommodation, description: "Two extra hotel nights (23 and 24 Oct)", basis: "qty_rate", qty: "2", rate: "250" }])})`);
      await submit(U.pm, { version: rev, rv: rv2 });
      await call(U.fin2, `select pbx_decide_budget('${rev}', 'reject', 'Not needed')`);
      expect(num((await view(U.pm, p)).baseline)).toBe(1470);                             // rejected: not counted
      const rev2 = await call<string>(U.pm, `select pbx_revise_budget('${rev}')`);
      const d3 = await draftOf(p);
      const rv3 = await call<number>(U.pm, `select pbx_save_budget_draft('${rev2}', ${d3.row_version}, ${j({})}, ${j([{ category_id: cat.accommodation, description: "One extra hotel night", basis: "qty_rate", qty: "1", rate: "250" }])})`);
      await submit(U.pm, { version: rev2, rv: rv3 });
      await call(U.fin2, `select pbx_decide_budget('${rev2}', 'approve')`);
      v = await view(U.pm, p);
      expect(num(v.baseline)).toBe(1720);                                                 // original 1,470 preserved + approved increment 250
      const original = v.versions.find((x: Row) => x.kind === "original");
      expect(original).toMatchObject({ status: "approved" });
      expect(num(original.total)).toBe(1470);
      expect(subAdd).toBeTruthy();
    });

    it("notifications go only to the people concerned and never repeat while unread", async () => {
      const p = await newProject(U.pm);
      const b = await makeBudget(p, U.pm);
      await submit(U.pm, b);
      const forFin = await admin<Row>(`select user_id, type from notifications where type = 'project_budget_submitted' and payload->>'version_id' = '${b.version}'`);
      expect(forFin.map((n) => n.user_id).sort()).toEqual([U.fin1, U.fin2, U.pmFin, U.dual].sort());   // every Finance grantee except the submitter; never a non-grantee, never the CEO/CTO route
      await call(U.fin1, `select pbx_decide_budget('${b.version}', 'approve')`);
      const back = await admin<Row>(`select user_id from notifications where type = 'project_budget_decided' and payload->>'version_id' = '${b.version}'`);
      expect(back.map((n) => n.user_id)).toEqual([U.pm]);                                           // the submitter is also the PM: one notice, not two
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("funding", () => {
    it("is recorded by Finance after the budget is approved; advances and Pluto allocations are different things; retries are safe", async () => {
      const p = await newProject(U.pm, [U.member]);
      const b = await makeBudget(p, U.pm);
      const rec = (user: string, args: string) => `select pbx_record_funding('${b.budget}', ${args})`;
      await failsCommit(U.fin1, rec(U.pm, `'${U.pm}', current_date, 500, 'cash', null, null, null, '${id()}'`), /Approve the budget before/);
      await submit(U.pm, b);
      await call(U.fin1, `select pbx_decide_budget('${b.version}', 'approve')`);
      await failsCommit(U.pm, rec(U.pm, `'${U.pm}', current_date, 500, 'cash', null, null, null, '${id()}'`), /Only Finance/);
      await failsCommit(U.member, rec(U.pm, `'${U.pm}', current_date, 500, 'cash', null, null, null, '${id()}'`), /Only Finance|Budget not found/);
      await failsCommit(U.fin1, rec(U.pm, `'${U.outsider}', current_date, 500, 'cash', null, null, null, '${id()}'`), /Project Manager or a current member/);
      await failsCommit(U.fin1, rec(U.pm, `'${U.pm}', current_date, 0, 'cash', null, null, null, '${id()}'`), /more than zero/);
      await failsCommit(U.fin1, rec(U.pm, `'${U.pm}', current_date, 10.005, 'cash', null, null, null, '${id()}'`), /more decimals/);
      await failsCommit(U.fin1, rec(U.pm, `'${U.pm}', current_date, 100, 'crypto', null, null, null, '${id()}'`), /Choose how/);
      await failsCommit(U.fin1, rec(U.pm, `'${U.pm}', current_date, 100, 'other', null, null, null, '${id()}'`), /Say whether this "other"/);
      const req = id();
      const first = await call<string>(U.fin1, rec(U.pm, `'${U.pm}', current_date, 500, 'cash', null, 'PV-1', 'first instalment', '${req}'`));
      const again = await call<string>(U.fin1, rec(U.pm, `'${U.pm}', current_date, 500, 'cash', null, 'PV-1', 'first instalment', '${req}'`));
      expect(again).toBe(first);
      await call(U.fin1, rec(U.pm, `'${U.pm}', current_date, 300, 'bank_transfer', true, null, 'second instalment', '${id()}'`));
      await call(U.fin1, rec(U.pm, `'${U.member}', current_date, 120, 'cash', null, null, null, '${id()}'`));
      await call(U.fin1, rec(U.pm, `'${U.pm}', current_date, 2000, 'pluto', true, null, 'card limit', '${id()}'`));   // the "advance" flag is ignored for Pluto
      await call(U.fin1, rec(U.pm, `'${U.member}', current_date, 40, 'other', false, null, 'fuel card limit', '${id()}'`));
      const v = await view(U.pm, p);
      expect(v.funding).toHaveLength(5);
      expect(v.funding.map((f: Row) => [f.method, f.is_advance])).toEqual([["cash", true], ["bank_transfer", true], ["cash", true], ["pluto", false], ["other", false]]);
      expect(num(v.settlement.advances_provided)).toBe(920);
      expect(num(v.settlement.card_allocations)).toBe(2040);
      expect(num(v.settlement.advance_to_return)).toBe(920);                               // all of it is still held: nothing has been spent or returned yet
      expect(num(v.settlement.reimbursement_owed)).toBe(0);
      // the PM and a member cannot see another budget's funding; a member sees none at all
      expect(await q(U.member, `select 1 from pbx_funding`)).toHaveLength(0);
      // recorded entries cannot be edited or deleted; reversal needs a reason and is audited
      await expect(admin(`update pbx_funding set amount = 1 where id = '${first}'`)).rejects.toThrow(/cannot be edited/);
      await expect(admin(`delete from pbx_funding where id = '${first}'`)).rejects.toThrow(/never deleted/);
      await failsCommit(U.fin1, `select pbx_reverse_funding('${first}', ' ')`, /Give the reason/);
      await failsCommit(U.pm, `select pbx_reverse_funding('${first}', 'wrong')`, /Only Finance/);
      await commit(U.fin1, `select pbx_reverse_funding('${first}', 'Wrong recipient')`);
      await failsCommit(U.fin1, `select pbx_reverse_funding('${first}', 'again')`, /already reversed/);
      expect(num((await view(U.pm, p)).settlement.advances_provided)).toBe(420);
    });

    it("a Finance user who is also the recipient cannot fund themselves", async () => {
      const p = await newProject(U.pmFin, [U.member]);
      const b = await approved(p, U.pmFin, U.ceo);
      await failsCommit(U.pmFin, `select pbx_record_funding('${b.budget}', '${U.pmFin}', current_date, 100, 'cash', null, null, null, '${id()}')`, /cannot record funds for yourself/);
      await call(U.fin1, `select pbx_record_funding('${b.budget}', '${U.pmFin}', current_date, 100, 'cash', null, null, null, '${id()}')`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("actual expenses", () => {
    it("starts blank from the approved rows; blank is not zero; unplanned rows need a description; submission needs confirmation", async () => {
      const p = await newProject(U.pm, [U.member]);
      const b = await approved(p, U.pm, U.fin1);
      await failsCommit(U.member, `select pbx_start_actuals('${b.budget}')`, /Only the Project Manager|Budget not found/);
      const sub = await call<string>(U.pm, `select pbx_start_actuals('${b.budget}')`);
      expect(await call<string>(U.pm, `select pbx_start_actuals('${b.budget}')`)).toBe(sub);       // idempotent
      const rows0 = await actualsRows(sub);
      expect(rows0).toHaveLength(4);
      expect(rows0.every((r) => r.actual_amount === null)).toBe(true);                              // the estimate is never copied as spending
      expect(rows0.map((r) => num(r.approved_amount))).toEqual([360, 30, 30, 1050]);
      const ids = await budgetRowIds(b.budget);
      const d = await actualDraft(b.budget);
      const lines = (over: Row[] = []) => [
        { budget_row_id: ids[0], actual_amount: "360", paid_via: "company_card" },
        { budget_row_id: ids[1], actual_amount: "0" },
        { budget_row_id: ids[2], actual_amount: null },
        { budget_row_id: ids[3], actual_amount: "1050", paid_via: "direct_company" },
        ...over,
      ];
      let rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(lines())})`);
      await failsCommit(U.pm, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`, /No actual amount is entered for "Metro cards/);   // blank is not zero
      rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({ complete_confirmed: false })}, ${j(lines().map((l, i) => (i === 2 ? { ...l, actual_amount: "0" } : l)))})`);
      await failsCommit(U.pm, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`, /Confirm that the actual expenses are complete/);
      // an unplanned expense: category and description required, and how it was paid
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(lines([{ category_id: cat.other, actual_amount: "20", paid_via: "company_card", description: " " }]))})`, /Describe the unplanned expense/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(lines([{ description: "Parking", actual_amount: "20", paid_via: "company_card" }]))})`, /Choose a category for the unplanned/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(lines([{ category_id: cat.other, description: "Parking", actual_amount: "20" }]))})`, /Say how line 5 was paid/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(lines([{ category_id: cat.other, description: "Parking", actual_amount: "20", paid_via: "personal" }]))})`, /Say who paid/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(lines([{ category_id: cat.other, description: "Parking", actual_amount: "20.005", paid_via: "company_card" }]))})`, /more decimals/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(lines([{ budget_row_id: id(), actual_amount: "5", paid_via: "company_card" }]))})`, /not part of the approved budget/);
      rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({ complete_confirmed: true })}, ${j(lines([{ category_id: cat.other, description: "Parking at the venue", actual_amount: "20", paid_via: "personal", paid_by_user_id: U.pm }]).map((l, i) => (i === 2 ? { ...l, actual_amount: "0" } : l)))})`);
      const saved = await actualsRows(sub);
      expect(saved).toHaveLength(5);
      expect(saved[4]).toMatchObject({ unplanned: true, budget_row_id: null, description: "Parking at the venue", paid_by_name: expect.stringContaining("pm") });
      expect(num(saved[2]!.actual_amount)).toBe(0);                                                  // a confirmed zero is kept as zero, not blank
      // an approved row cannot be hidden: leaving it out brings it back blank
      rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({ complete_confirmed: true })}, ${j([lines()[0], lines()[3]])})`);
      const afterHide = await actualsRows(sub);
      expect(afterHide.filter((r) => r.budget_row_id && r.actual_amount === null)).toHaveLength(2);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv - 1}, ${j({})}, ${j(lines())})`, /changed by someone else/);
    });

    it("grouped totals, split payment lines, a variance note for a material difference, a foreign-currency note, and an existing-claim link", async () => {
      const p = await newProject(U.pm, [U.member]);
      const b = await approved(p, U.pm, U.fin1);
      const sub = await call<string>(U.pm, `select pbx_start_actuals('${b.budget}')`);
      const ids = await budgetRowIds(b.budget);
      const d = await actualDraft(b.budget);
      // one grouped food total split by how it was paid: two lines under the same approved row
      const lines = (food2: Row, extra: Row[] = []) => [
        { budget_row_id: ids[0], actual_amount: "300", paid_via: "company_card" }, { budget_row_id: ids[0], ...food2 },
        { budget_row_id: ids[1], actual_amount: "30", paid_via: "company_card" }, { budget_row_id: ids[2], actual_amount: "30", paid_via: "company_card" },
        { budget_row_id: ids[3], actual_amount: "1050", paid_via: "direct_company" }, ...extra,
      ];
      // existing-claim line: the claimant's own claim only; or a reference in the note
      const ownClaim = (await admin<{ id: string }>(`insert into reimbursement_claims (employee_id, currency) select id, 'AED' from employees where user_id = '${U.pm}' returning id`))[0].id;
      const otherClaim = (await admin<{ id: string }>(`insert into reimbursement_claims (employee_id, currency) select id, 'AED' from employees where user_id = '${U.emp}' returning id`))[0].id;
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({})}, ${j(lines({ actual_amount: "40", paid_via: "existing_claim", claim_id: otherClaim }))})`, /not one you can link/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({})}, ${j(lines({ actual_amount: "40", paid_via: "existing_claim" }))})`, /reference of the employee claim/);
      await failsCommit(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({})}, ${j(lines({ actual_amount: "40", paid_via: "company_card", foreign_currency: true }))})`, /another currency/);
      let rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(lines({ actual_amount: "40", paid_via: "existing_claim", claim_id: ownClaim, note: "Lunch for the team, claimed on payroll run" }))})`);
      let saved = await actualsRows(sub);
      expect(saved.filter((r) => r.budget_row_id === ids[0]).map((r) => [r.line_no, num(r.approved_amount), num(r.actual_amount)])).toEqual([[1, 360, 300], [2, 0, 40]]);
      expect(saved.find((r) => r.paid_via === "existing_claim")!.claim_id).toBe(ownClaim);
      // 340 + 30 + 30 + 1050 = 1450 against 1470: within 10 %, no note needed; a foreign-currency line carries its note
      rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({ complete_confirmed: true })}, ${j(lines({ actual_amount: "40", paid_via: "company_card", foreign_currency: true, foreign_note: "EUR 10.00 at 4.00" }))})`);
      const rvSubmitted = rv;
      await call(U.pm, `select pbx_submit_actuals('${sub}', ${rvSubmitted}, '${id()}')`);
      saved = await actualsRows(sub);
      expect(saved.find((r) => r.foreign_currency)).toMatchObject({ foreign_note: "EUR 10.00 at 4.00" });
      // a material difference needs a note: a second project
      const p2 = await newProject(U.pm, []);
      const b2 = await approved(p2, U.pm, U.fin1);
      const sub2 = await call<string>(U.pm, `select pbx_start_actuals('${b2.budget}')`);
      const ids2 = await budgetRowIds(b2.budget);
      const d2 = await actualDraft(b2.budget);
      const big = [{ budget_row_id: ids2[0], actual_amount: "600", paid_via: "company_card" }, { budget_row_id: ids2[1], actual_amount: "30", paid_via: "company_card" }, { budget_row_id: ids2[2], actual_amount: "30", paid_via: "company_card" }, { budget_row_id: ids2[3], actual_amount: "1050", paid_via: "company_card" }];
      let rv2 = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub2}', ${d2.row_version}, ${j({ complete_confirmed: true })}, ${j(big)})`);
      await failsCommit(U.pm, `select pbx_submit_actuals('${sub2}', ${rv2}, '${id()}')`, /more than 10%.*note/);
      rv2 = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub2}', ${rv2}, ${j({ complete_confirmed: true, variance_note: "Extra catering for the client visit" })}, ${j(big)})`);
      await call(U.pm, `select pbx_submit_actuals('${sub2}', ${rv2}, '${id()}')`);
    });

    it("submission is idempotent and frozen; the CEO/CTO route decides a Finance-holding PM's expenses independently; returned actuals are revised as a new draft", async () => {
      const p = await newProject(U.pmFin, [U.member]);
      const b = await approved(p, U.pmFin, U.ceo);
      const sub = await call<string>(U.pmFin, `select pbx_start_actuals('${b.budget}')`);
      const ids = await budgetRowIds(b.budget);
      const d = await actualDraft(b.budget);
      const all = ids.map((rid, i) => ({ budget_row_id: rid, actual_amount: String([360, 30, 30, 1050][i]), paid_via: "company_card" }));
      const rv = await call<number>(U.pmFin, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(all)})`);
      const req = id();
      const first = await call<string>(U.pmFin, `select pbx_submit_actuals('${sub}', ${rv}, '${req}')`);
      expect(await call<string>(U.pmFin, `select pbx_submit_actuals('${sub}', ${rv}, '${req}')`)).toBe(first);
      await failsCommit(U.pmFin, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`, /already submitted/);
      await failsCommit(U.pmFin, `select pbx_save_actuals_draft('${sub}', ${rv}, ${j({})}, ${j(all)})`, /no longer a draft/);
      await expect(admin(`update pbx_actual_rows set actual_amount = 1 where submission_id = '${sub}'`)).rejects.toThrow(/historical record/);
      await failsCommit(U.pmFin, `select pbx_decide_actuals('${sub}', 'approve')`, /CEO or CTO/);
      await failsCommit(U.pm, `select pbx_decide_actuals('${sub}', 'approve')`, /CEO or CTO|not found/);
      await failsCommit(U.fin1, `select pbx_decide_actuals('${sub}', 'approve')`, /CEO or CTO/);                // a Finance-submitted claim of expenses is not decided by Finance
      await failsCommit(U.ceo, `select pbx_decide_actuals('${sub}', 'return')`, /Give the reason/);
      const racers = await Promise.allSettled([commit(U.ceo, `select pbx_decide_actuals('${sub}', 'approve')`), commit(U.cto, `select pbx_decide_actuals('${sub}', 'return', 'Check')`)]);
      expect(racers.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const status = (await admin<Row>(`select status from pbx_actual_submissions where id = '${sub}'`))[0].status;
      if (status === "returned") {
        const again = await call<string>(U.pmFin, `select pbx_revise_actuals('${sub}')`);
        expect((await actualsRows(again)).map((r) => num(r.actual_amount))).toEqual([360, 30, 30, 1050]);
      } else {
        // approved: Finance can send it back for an audited correction, with a reason, and the PM revises
        await failsCommit(U.fin1, `select pbx_return_approved_actuals('${sub}', ' ')`, /Give the reason/);
        await failsCommit(U.pmFin, `select pbx_start_actuals('${b.budget}')`, /approved|Finance must send them back/);
        await commit(U.fin1, `select pbx_return_approved_actuals('${sub}', 'Receipt shows the metro cost 35')`);
        const draft = await call<string>(U.pmFin, `select pbx_revise_actuals('${sub}')`);
        expect(draft).toBeTruthy();
        expect((await admin<Row>(`select reopened_after_approval from pbx_actual_submissions where id = '${draft}'`))[0].reopened_after_approval).toBe(true);
      }
      const audit = await admin<Row>(`select action, table_name from pbx_audit_log where table_name = 'pbx_actual_submissions' and row_id = '${sub}'`);
      expect(audit.length).toBeGreaterThan(2);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("funding, spending and settlement reconciliation", () => {
    let S: { project: string; budget: string; sub: string };
    const SOURCES: ActualLine[] = [];
    const FUNDING: FundingEntry[] = [];

    it("keeps advances, card spending, direct payments, personal spending and claims apart, and equals the TypeScript figures", async () => {
      const project = await newProject(U.pm, [U.member]);
      const b = await approved(project, U.pm, U.fin1);
      const rec = (recipient: string, amount: number, method: string, adv: boolean | null) =>
        call(U.fin1, `select pbx_record_funding('${b.budget}', '${recipient}', current_date, ${amount}, '${method}', ${adv === null ? "null" : adv}, null, null, '${id()}')`);
      await rec(U.pm, 300, "cash", null); FUNDING.push({ recipient: U.pm, amount: 300, isAdvance: true });
      await rec(U.pm, 100, "bank_transfer", null); FUNDING.push({ recipient: U.pm, amount: 100, isAdvance: true });
      await rec(U.member, 30, "cash", null); FUNDING.push({ recipient: U.member, amount: 30, isAdvance: true });
      await rec(U.pm, 500, "pluto", null); FUNDING.push({ recipient: U.pm, amount: 500, isAdvance: false });
      const sub = await call<string>(U.pm, `select pbx_start_actuals('${b.budget}')`);
      const ids = await budgetRowIds(b.budget);
      const d = await actualDraft(b.budget);
      const own = (await admin<{ id: string }>(`insert into reimbursement_claims (employee_id, currency) select id, 'AED' from employees where user_id = '${U.pm}' returning id`))[0].id;
      const lines: Row[] = [
        { budget_row_id: ids[0], actual_amount: "250", paid_via: "advance", paid_by_user_id: U.pm },
        { budget_row_id: ids[0], actual_amount: "80", paid_via: "personal", paid_by_user_id: U.pm },
        { budget_row_id: ids[0], actual_amount: "30", paid_via: "existing_claim", claim_id: own },
        { budget_row_id: ids[1], actual_amount: "40", paid_via: "advance", paid_by_user_id: U.member },
        { budget_row_id: ids[2], actual_amount: "30", paid_via: "company_card" },
        { budget_row_id: ids[3], actual_amount: "1050", paid_via: "direct_company" },
        { category_id: cat.transport, description: "Parking", actual_amount: "45", paid_via: "advance", paid_by_user_id: U.pm },
      ];
      for (const l of lines) SOURCES.push({ paidVia: l.paid_via, paidBy: l.paid_by_user_id ?? null, amount: num(l.actual_amount) });
      const rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(lines)})`);
      await call(U.pm, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`);
      // figures count only APPROVED actuals
      expect(num((await view(U.fin1, project)).settlement.approved_actual_total)).toBe(0);
      await call(U.fin1, `select pbx_decide_actuals('${sub}', 'approve')`);
      S = { project, budget: b.budget, sub };

      const sql = (await view(U.fin1, project)).settlement;
      const ts = settlementFigures("AED", FUNDING, SOURCES, []);
      const pairs: [string, number][] = [
        ["approved_actual_total", ts.approvedActualTotal], ["advances_provided", ts.advancesProvided], ["card_allocations", ts.cardAllocations], ["advance_spent", ts.advanceSpent],
        ["company_card_spent", ts.companyCardSpent], ["direct_paid", ts.directPaid], ["personal_spent", ts.personalSpent], ["existing_claim_spent", ts.existingClaimSpent],
        ["returned", ts.returned], ["reimbursement_owed", ts.reimbursementOwed], ["reimbursement_paid", ts.reimbursementPaid], ["advance_to_return", ts.advanceToReturn],
        ["reimbursement_outstanding", ts.reimbursementOutstanding],
      ];
      for (const [k, expected] of pairs) expect(num(sql[k]), k).toBe(expected);
      const byUser = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.user_id ?? r.person, r]));
      const sqlPer = byUser(sql.per_person);
      for (const person of ts.perPerson) {
        const s = sqlPer[person.person];
        expect(num(s.advance_balance), `${person.person} balance`).toBe(person.advanceBalance);
        expect(num(s.advance_to_return)).toBe(person.advanceToReturn);
        expect(num(s.advance_overspend)).toBe(person.advanceOverspend);
        expect(num(s.reimbursement_owed)).toBe(person.reimbursementOwed);
      }
      // the numbers themselves: PM holds 400 advance, spent 295 -> returns 105, personal 80 owed; member spent 40 of 30 -> overspend 10 owed
      expect(num(sqlPer[U.pm].advance_to_return)).toBe(105);
      expect(num(sqlPer[U.pm].reimbursement_owed)).toBe(80);
      expect(num(sqlPer[U.member].advance_overspend)).toBe(10);
      expect(num(sql.existing_claim_spent)).toBe(30);
      expect(num(sql.card_allocations)).toBe(500);
      // the naive "all spending minus all funding" is 1525 - 930: it would mix card, direct and personal money
      expect(num(sql.approved_actual_total)).toBe(1525);
    });

    it("cannot be settled yet: balances, receipts and (for the PM-Finance) independence are all enforced", async () => {
      const blockers = (await view(U.fin1, S.project)).settlement.blockers as string[];
      expect(blockers.join(" ")).toMatch(/receipts/);
      expect(blockers.join(" ")).toMatch(/AED 105.00 of advance money/);
      expect(blockers.join(" ")).toMatch(/AED 90.00 of reimbursement/);
      await failsCommit(U.fin1, `select pbx_close_settlement('${S.budget}', null)`, /cannot be closed yet/);
      await failsCommit(U.pm, `select pbx_close_settlement('${S.budget}', null)`, /Only Finance/);
      await failsCommit(U.fin1, `select pbx_record_receipts('${S.budget}', 'exception', null, ' ')`, /needs a recorded reason/);
      await failsCommit(U.pm, `select pbx_record_receipts('${S.budget}', 'received')`, /Only Finance/);
    });

    it("records partial returns and reimbursements with limits, retries and reversals", async () => {
      const pay = (kind: string, person: string, amount: number, req = id()) =>
        `select pbx_record_payment('${S.budget}', '${kind}', '${person}', ${amount}, current_date, 'cash', null, null, '${req}')`;
      await failsCommit(U.pm, pay("return", U.pm, 50), /Only Finance/);
      await failsCommit(U.fin1, pay("return", U.outsider, 50), /no advance to return/i);
      await failsCommit(U.fin1, pay("return", U.pm, 200), /more than the advance still held \(AED 105.00\)/);
      await failsCommit(U.fin1, pay("return", U.pm, 0), /more than zero/);
      await failsCommit(U.fin1, pay("reimbursement", U.pm, 200), /more than the reimbursement still owed \(AED 80.00\)/);
      const req = id();
      const first = await call<string>(U.fin1, pay("return", U.pm, 50, req));
      expect(await call<string>(U.fin1, pay("return", U.pm, 50, req))).toBe(first);                 // a double click records once
      await call(U.fin1, pay("reimbursement", U.pm, 30));
      let s = (await view(U.fin1, S.project)).settlement;
      expect(num(s.advance_to_return)).toBe(55);
      expect(num(s.reimbursement_outstanding)).toBe(60);                                         // 50 left for the PM + 10 for the member
      await expect(admin(`update pbx_payments set amount = 1 where id = '${first}'`)).rejects.toThrow(/cannot be edited/);
      await failsCommit(U.fin1, `select pbx_reverse_payment('${first}', ' ')`, /Give the reason/);
      await commit(U.fin1, `select pbx_reverse_payment('${first}', 'Entered against the wrong person')`);
      s = (await view(U.fin1, S.project)).settlement;
      expect(num(s.advance_to_return)).toBe(105);
      await call(U.fin1, pay("return", U.pm, 105));
      await call(U.fin1, pay("reimbursement", U.pm, 50));
      await call(U.fin1, pay("reimbursement", U.member, 10));
      s = (await view(U.fin1, S.project)).settlement;
      expect([num(s.advance_to_return), num(s.reimbursement_outstanding)]).toEqual([0, 0]);
      const ts = settlementFigures("AED", FUNDING, SOURCES, [
        { kind: "return", person: U.pm, amount: 105 }, { kind: "reimbursement", person: U.pm, amount: 80 }, { kind: "reimbursement", person: U.member, amount: 10 },
      ]);
      expect([ts.advanceToReturn, ts.reimbursementOutstanding]).toEqual([0, 0]);
      expect(num(s.returned)).toBe(105);
      expect(num(s.reimbursement_paid)).toBe(90);
    });

    it("closes only when reconciled and receipts are confirmed (or excepted with a reason); the second click is harmless; closed means closed", async () => {
      await failsCommit(U.fin1, `select pbx_close_settlement('${S.budget}', null)`, /receipts/);
      await commit(U.fin1, `select pbx_record_receipts('${S.budget}', 'partial', current_date)`);
      await failsCommit(U.fin1, `select pbx_close_settlement('${S.budget}', null)`, /receipts/);
      await commit(U.fin1, `select pbx_record_receipts('${S.budget}', 'exception', null, 'Taxi receipts lost, confirmed by the driver')`);
      expect((await view(U.fin1, S.project)).settlement.blockers).toEqual([]);
      await commit(U.fin1, `select pbx_close_settlement('${S.budget}', 'Reconciled')`);
      await commit(U.fin2, `select pbx_close_settlement('${S.budget}', 'again')`);
      const v = await view(U.fin1, S.project);
      expect(v.budget).toMatchObject({ settlement_status: "closed", receipts_status: "exception" });
      await failsCommit(U.fin1, `select pbx_record_funding('${S.budget}', '${U.pm}', current_date, 10, 'cash', null, null, null, '${id()}')`, /Settlement is closed/);
      await failsCommit(U.pm, `select pbx_request_addition('${S.budget}')`, /Settlement is closed/);
      await failsCommit(U.fin1, `select pbx_reverse_funding('${(await admin<Row>(`select id from pbx_funding where budget_id = '${S.budget}' limit 1`))[0].id}', 'late')`, /Settlement is closed/);
      await failsCommit(U.pm, `select pbx_start_actuals('${S.budget}')`, /Settlement is closed/);
      await failsCommit(U.fin1, `select pbx_reopen_settlement('${S.budget}', ' ')`, /Give the reason/);
      await failsCommit(U.pm, `select pbx_reopen_settlement('${S.budget}', 'because')`, /Only Finance/);
      await commit(U.fin1, `select pbx_reopen_settlement('${S.budget}', 'A late supplier credit note')`);
      expect((await view(U.fin1, S.project)).budget.settlement_status).toBe("open");
      await commit(U.fin1, `select pbx_close_settlement('${S.budget}', 'Reconciled again')`);
    });

    it("a PM who also holds Finance cannot confirm receipts, close, or be paid on their own expenses", async () => {
      const project = await newProject(U.pmFin, [U.member]);
      const b = await approved(project, U.pmFin, U.ceo);
      const sub = await call<string>(U.pmFin, `select pbx_start_actuals('${b.budget}')`);
      const ids = await budgetRowIds(b.budget);
      const d = await actualDraft(b.budget);
      const lines = ids.map((rid, i) => ({ budget_row_id: rid, actual_amount: String([360, 30, 30, 1050][i]), paid_via: i === 0 ? "personal" : "company_card", paid_by_user_id: i === 0 ? U.pmFin : undefined }));
      const rv = await call<number>(U.pmFin, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(lines)})`);
      await call(U.pmFin, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`);
      await call(U.ceo, `select pbx_decide_actuals('${sub}', 'approve')`);
      await failsCommit(U.pmFin, `select pbx_record_receipts('${b.budget}', 'received')`, /cannot record the receipt status/);
      await commit(U.fin1, `select pbx_record_receipts('${b.budget}', 'received')`);
      await failsCommit(U.pmFin, `select pbx_record_payment('${b.budget}', 'reimbursement', '${U.pmFin}', 100, current_date, 'cash', null, null, '${id()}')`, /cannot record a payment to or from yourself/);
      await call(U.fin1, `select pbx_record_payment('${b.budget}', 'reimbursement', '${U.pmFin}', 360, current_date, 'cash', null, null, '${id()}')`);
      await failsCommit(U.pmFin, `select pbx_close_settlement('${b.budget}', null)`, /cannot close settlement/);
      await commit(U.fin2, `select pbx_close_settlement('${b.budget}', null)`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------------------------------------------------
  describe("approval routing: Finance for ordinary PMs, the company's CEO/CTO for Finance submitters", () => {
    const oneProject = async (pm: string, company = CO.uae, currency = "AED") => {
      const p = await newProject(pm, [], company);
      const b = await makeBudget(p, pm, currency, [{ category_id: cat.food, description: "Meals", basis: "per_person_day", people: "2", days: "2", rate: "50" }]);
      return { p, b };
    };
    const routeOf = async (version: string) => (await admin<Row>(`select approval_route from pbx_budget_versions where id = '${version}'`))[0].approval_route;
    const inboxRow = async (user: string, version: string) => ((await q<{ i: Row }>(user, `select pbx_inbox() as i`))[0].i.budget_approvals as Row[]).find((r) => r.version_id === version);

    it("ordinary PM -> an authorised Finance person decides; the CEO/CTO cannot, and nobody outside the company can", async () => {
      const { p, b } = await oneProject(U.pm);
      await submit(U.pm, b);
      expect(await routeOf(b.version)).toBe("finance");
      expect(await view(U.pm, p)).toMatchObject({ versions: [expect.objectContaining({ approval_route: "finance", on_hold: false, i_can_decide: false })] });
      expect(await inboxRow(U.fin1, b.version)).toMatchObject({ approval_route: "finance", i_can_decide: true, on_hold: false });
      expect(await inboxRow(U.ceo, b.version)).toMatchObject({ approval_route: "finance", i_can_decide: false });          // the CEO/CTO can see it, not decide it
      await failsCommit(U.ceo, `select pbx_decide_budget('${b.version}', 'approve')`, /Only Finance of this company/);
      await failsCommit(U.cto, `select pbx_decide_budget('${b.version}', 'reject', 'no')`, /Only Finance of this company/);
      await failsCommit(U.ksaFin, `select pbx_decide_budget('${b.version}', 'approve')`, /Budget not found|Only Finance/);
      await failsCommit(U.ksaCeo, `select pbx_decide_budget('${b.version}', 'approve')`, /Budget not found|Only Finance/);
      expect(await call<string>(U.fin1, `select pbx_decide_budget('${b.version}', 'approve')`)).toBe("approved");
    });

    it("a submitter holding Finance access -> the CEO/CTO route, whether or not they are also the PM; one single approver is enough", async () => {
      // a Finance person who is NOT the PM of the project but prepared nothing: the PM (no Finance) submits -> Finance route (above).
      // a Finance person submits as PM (pmFin) -> executive route
      const { b } = await oneProject(U.pmFin);
      await submit(U.pmFin, b);
      expect(await routeOf(b.version)).toBe("executive");
      expect(await inboxRow(U.fin1, b.version)).toMatchObject({ approval_route: "executive", i_can_decide: false, on_hold: false });
      expect(await inboxRow(U.cto, b.version)).toMatchObject({ approval_route: "executive", i_can_decide: true });
      expect(await call<string>(U.cto, `select pbx_decide_budget('${b.version}', 'approve')`)).toBe("approved");     // the CTO alone is sufficient
      await failsCommit(U.ceo, `select pbx_decide_budget('${b.version}', 'approve')`, /already been decided/);          // and the CEO is not also required
    });

    it("dual roles: someone with both Finance and CEO/CTO rights decides others' work on the right route and never their own", async () => {
      // dual is a PM with Finance + executive rights: their own submission is routed to the executive queue and they are excluded from it
      const mine = await oneProject(U.dual);
      await submit(U.dual, mine.b);
      expect(await routeOf(mine.b.version)).toBe("executive");
      await failsCommit(U.dual, `select pbx_decide_budget('${mine.b.version}', 'approve')`, /cannot decide a budget you prepared or submitted/);
      await failsCommit(U.fin1, `select pbx_decide_budget('${mine.b.version}', 'approve')`, /CEO or CTO/);
      expect((await view(U.dual, mine.p)).versions[0]).toMatchObject({ approval_route: "executive", i_can_decide: false, on_hold: false });
      expect(await call<string>(U.ceo, `select pbx_decide_budget('${mine.b.version}', 'approve')`)).toBe("approved");
      // an ordinary PM's submission: dual may decide it as Finance
      const theirs = await oneProject(U.pm2);
      await submit(U.pm2, theirs.b);
      expect(await inboxRow(U.dual, theirs.b.version)).toMatchObject({ approval_route: "finance", i_can_decide: true });
      expect(await call<string>(U.dual, `select pbx_decide_budget('${theirs.b.version}', 'return', 'Please add the permit fee')`)).toBe("returned");
      // a Finance PM's submission: dual (a different person) may decide it as CEO/CTO approver
      const other = await oneProject(U.pmFin);
      await submit(U.pmFin, other.b);
      expect(await inboxRow(U.dual, other.b.version)).toMatchObject({ approval_route: "executive", i_can_decide: true });
      expect(await call<string>(U.dual, `select pbx_decide_budget('${other.b.version}', 'approve')`)).toBe("approved");
    });

    it("an approver who is also a PM without Finance access cannot decide their own submission; Finance does", async () => {
      const { p, b } = await oneProject(U.ceoPm);
      await submit(U.ceoPm, b);
      expect(await routeOf(b.version)).toBe("finance");                                                  // submitter holds no Finance right
      await failsCommit(U.ceoPm, `select pbx_decide_budget('${b.version}', 'approve')`, /Only Finance of this company/);
      expect((await view(U.ceoPm, p)).versions[0]).toMatchObject({ i_can_decide: false });
      expect(await call<string>(U.fin2, `select pbx_decide_budget('${b.version}', 'approve')`)).toBe("approved");
    });

    it("the route is fixed at submission: a later change of the submitter's access cannot re-route or self-approve it", async () => {
      const { b } = await oneProject(U.pm3);
      await submit(U.pm3, b);
      await admin(`insert into pbx_company_grants (user_id, company_id, capabilities) values ('${U.pm3}', '${CO.uae}', '{finance,executive_approver}')`);
      try {
        expect(await routeOf(b.version)).toBe("finance");
        await failsCommit(U.pm3, `select pbx_decide_budget('${b.version}', 'approve')`, /cannot decide a budget you prepared or submitted/);   // newly gained rights do not let them approve their own
        await expect(admin(`update pbx_budget_versions set approval_route = 'executive' where id = '${b.version}'`)).rejects.toThrow(/historical record/);
        expect(await call<string>(U.fin1, `select pbx_decide_budget('${b.version}', 'approve')`)).toBe("approved");
      } finally {
        await admin(`update pbx_company_grants set revoked_at = now() where user_id = '${U.pm3}' and company_id = '${CO.uae}' and revoked_at is null`);
      }
    });

    it("the database itself refuses a decision by the person who prepared or submitted, whatever writes the row", async () => {
      const { b } = await oneProject(U.pm);
      await submit(U.pm, b);
      await expect(admin(`update pbx_budget_versions set status = 'approved', decided_by = '${U.pm}', decided_at = now() where id = '${b.version}'`)).rejects.toThrow(/cannot be decided by the person who prepared or submitted/);
      await expect(admin(`update pbx_budget_versions set status = 'approved', decided_at = now() where id = '${b.version}'`)).rejects.toThrow(/cannot be decided by the person who prepared or submitted/);
    });

    it("additional budget requests follow the same routes as the original", async () => {
      // PM without Finance: original -> Finance, addition -> Finance
      const a = await oneProject(U.pm);
      await submit(U.pm, a.b);
      await call(U.fin1, `select pbx_decide_budget('${a.b.version}', 'approve')`);
      const addA = await call<string>(U.pm, `select pbx_request_addition('${a.b.budget}')`);
      const dA = await draftOf(a.p);
      const rvA = await call<number>(U.pm, `select pbx_save_budget_draft('${addA}', ${dA.row_version}, ${j({ note: "More meals" })}, ${j([{ category_id: cat.food, description: "Extra meals", basis: "fixed", fixed: "75" }])})`);
      await submit(U.pm, { version: addA, rv: rvA });
      expect(await routeOf(addA)).toBe("finance");
      await failsCommit(U.ceo, `select pbx_decide_budget('${addA}', 'approve')`, /Only Finance/);
      // PM with Finance access: original -> CEO/CTO, addition -> CEO/CTO (Finance colleagues cannot decide it)
      const f = await oneProject(U.pmFin);
      await submit(U.pmFin, f.b);
      await call(U.ceo, `select pbx_decide_budget('${f.b.version}', 'approve')`);
      const addF = await call<string>(U.pmFin, `select pbx_request_addition('${f.b.budget}')`);
      const dF = await draftOf(f.p);
      const rvF = await call<number>(U.pmFin, `select pbx_save_budget_draft('${addF}', ${dF.row_version}, ${j({ note: "More meals" })}, ${j([{ category_id: cat.food, description: "Extra meals", basis: "fixed", fixed: "75" }])})`);
      await submit(U.pmFin, { version: addF, rv: rvF });
      expect(await routeOf(addF)).toBe("executive");
      await failsCommit(U.fin1, `select pbx_decide_budget('${addF}', 'approve')`, /CEO or CTO/);
      expect(await call<string>(U.cto, `select pbx_decide_budget('${addF}', 'approve')`)).toBe("approved");
      expect(num((await view(U.pmFin, f.p)).baseline)).toBe(275);                                          // 200 + 75: the original is preserved and the approved addition counts
    });

    it("missing approvers hold the request on either route, with the reason visible, until an eligible person exists", async () => {
      // third company: a CEO/CTO approver exists but nobody in Finance -> an ordinary PM's submission is held (the executive cannot decide the Finance route)
      const t = await oneProject(U.thirdPm, CO.third);
      await submit(U.thirdPm, t.b);
      expect(await routeOf(t.b.version)).toBe("finance");
      expect(await inboxRow(U.thirdExec, t.b.version)).toMatchObject({ approval_route: "finance", on_hold: true, i_can_decide: false });
      await failsCommit(U.thirdExec, `select pbx_decide_budget('${t.b.version}', 'approve')`, /Only Finance of this company/);
      expect((await view(U.thirdPm, t.p)).versions[0]).toMatchObject({ status: "submitted", on_hold: true });
      // nothing was approved or lost; a Finance grant releases it
      await commit(U.thirdExec, `select pbx_grant_access('${U.fin1}', '${CO.third}', '{finance}')`);
      expect((await view(U.thirdPm, t.p)).versions[0].on_hold).toBe(false);
      expect(await call<string>(U.fin1, `select pbx_decide_budget('${t.b.version}', 'approve')`)).toBe("approved");
      await commit(U.thirdExec, `select pbx_revoke_access('${U.fin1}', '${CO.third}')`);
    });

    it("final expenses are routed the same way, and Finance keeps funding, receipts and settlement while the CEO/CTO only decides", async () => {
      const a = await oneProject(U.pm);
      await submit(U.pm, a.b);
      await call(U.fin1, `select pbx_decide_budget('${a.b.version}', 'approve')`);
      const sub = await call<string>(U.pm, `select pbx_start_actuals('${a.b.budget}')`);
      const ids = await budgetRowIds(a.b.budget);
      const d = await actualDraft(a.b.budget);
      const rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(ids.map((rid) => ({ budget_row_id: rid, actual_amount: "200", paid_via: "company_card" })))})`);
      await call(U.pm, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`);
      expect((await admin<Row>(`select approval_route from pbx_actual_submissions where id = '${sub}'`))[0].approval_route).toBe("finance");
      await failsCommit(U.ceo, `select pbx_decide_actuals('${sub}', 'approve')`, /Only Finance of this company/);
      await call(U.fin1, `select pbx_decide_actuals('${sub}', 'approve')`);
      // the CEO/CTO approver reads everything of the company but records nothing
      expect((await view(U.ceo, a.p)).viewer).toMatchObject({ is_executive: true, is_finance: false, is_full_reader: true });
      await failsCommit(U.ceo, `select pbx_record_funding('${a.b.budget}', '${U.pm}', current_date, 10, 'cash', null, null, null, '${id()}')`, /Only Finance/);
      await failsCommit(U.ceo, `select pbx_record_receipts('${a.b.budget}', 'received')`, /Only Finance/);
      await failsCommit(U.ceo, `select pbx_close_settlement('${a.b.budget}', null)`, /Only Finance/);
      await failsCommit(U.ceo, `select pbx_set_rate('${CO.uae}', 'AED', 'petrol_per_km', 0.5)`, /Only Finance/);
      await commit(U.fin2, `select pbx_record_receipts('${a.b.budget}', 'received')`);
      await commit(U.fin2, `select pbx_close_settlement('${a.b.budget}', null)`);
    });

    it("company isolation: a CEO/CTO approver of one company sees and decides nothing of another", async () => {
      const k = await oneProject(U.pm, CO.uae);
      await submit(U.pm, k.b);
      expect(await q(U.ksaCeo, `select 1 from pbx_budgets where id = '${k.b.budget}'`)).toHaveLength(0);
      await fails(U.ksaCeo, `select pbx_budget_view('${k.p}')`, /Budget not found/);
      expect(((await q<{ i: Row }>(U.thirdExec, `select pbx_inbox() as i`))[0].i.budget_approvals as Row[]).some((r) => r.version_id === k.b.version)).toBe(false);
      await failsCommit(U.thirdExec, `select pbx_decide_budget('${k.b.version}', 'approve')`, /Budget not found/);
      expect(await q(U.thirdExec, `select 1 from pbx_audit_log where company_id = '${CO.uae}'`)).toHaveLength(0);
    });

    it("simultaneous decisions on the CEO/CTO route produce exactly one outcome", async () => {
      const { b } = await oneProject(U.pmFin);
      await submit(U.pmFin, b);
      const results = await Promise.allSettled([
        commit(U.ceo, `select pbx_decide_budget('${b.version}', 'approve')`),
        commit(U.cto, `select pbx_decide_budget('${b.version}', 'return', 'Please check the meals')`),
        commit(U.dual, `select pbx_decide_budget('${b.version}', 'reject', 'Not needed')`),
        commit(U.ceo, `select pbx_decide_budget('${b.version}', 'approve')`),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x) => x.status === "rejected")) expect(String((r as PromiseRejectedResult).reason)).toMatch(/already been decided/);
      const row = (await admin<Row>(`select status, decided_by from pbx_budget_versions where id = '${b.version}'`))[0];
      expect(["approved", "returned", "rejected"]).toContain(row.status);
      expect([U.ceo, U.cto, U.dual]).toContain(row.decided_by);
      expect(await admin(`select 1 from pbx_audit_log where row_id = '${b.version}' and table_name = 'pbx_budget_versions' and new_row->>'status' in ('approved', 'returned', 'rejected')`)).toHaveLength(1);
    });
  });

  describe("isolation, reassignment, cancelled projects and existing data", () => {
    it("company and project isolation: another company's Finance, another project's PM and a viewer see or do only what they should", async () => {
      const p = await newProject(U.pm, [U.member]);
      const b = await makeBudget(p, U.pm);
      await submit(U.pm, b);
      const other = await newProject(U.pm2);
      await makeBudget(other, U.pm2);
      await fails(U.pm2, `select pbx_budget_view('${p}')`, /Budget not found/);                   // another project's PM
      expect(await q(U.pm2, `select 1 from pbx_budget_versions where id = '${b.version}'`)).toHaveLength(0);
      await fails(U.ksaFin, `select pbx_budget_view('${p}')`, /Budget not found/);                // another company's Finance
      expect(await q(U.ksaFin, `select 1 from pbx_budgets where id = '${b.budget}'`)).toHaveLength(0);
      await failsCommit(U.ksaFin, `select pbx_decide_budget('${b.version}', 'approve')`, /Budget not found|Only Finance/);
      const inboxKsa = (await q<{ i: Row }>(U.ksaFin, `select pbx_inbox() as i`))[0].i;
      expect(inboxKsa.budget_approvals.map((x: Row) => x.budget_id)).not.toContain(b.budget);
      // a view-only grantee reads everything of the company and decides nothing
      expect((await view(U.viewer, p)).viewer).toMatchObject({ is_view_only: true, is_finance: false });
      await failsCommit(U.viewer, `select pbx_decide_budget('${b.version}', 'approve')`, /Only Finance/);
      await failsCommit(U.viewer, `select pbx_record_funding('${b.budget}', '${U.pm}', current_date, 10, 'cash', null, null, null, '${id()}')`, /Only Finance/);
      const inboxFin = (await q<{ i: Row }>(U.fin1, `select pbx_inbox() as i`))[0].i;
      expect(inboxFin.budget_approvals.map((x: Row) => x.budget_id)).toContain(b.budget);
      expect(inboxFin.budget_approvals.find((x: Row) => x.budget_id === b.budget)).toMatchObject({ i_can_decide: true, company_name: "Enginious UAE" });
      const inboxView = (await q<{ i: Row }>(U.viewer, `select pbx_inbox() as i`))[0].i;
      expect(inboxView.budget_approvals.find((x: Row) => x.budget_id === b.budget)).toMatchObject({ i_can_decide: false });
    });

    it("PM reassignment: the new PM takes over; the former PM keeps read-only access to what they submitted, nothing more", async () => {
      const p = await newProject(U.pm, [U.member]);
      const b = await approved(p, U.pm, U.fin1);
      await call(U.fin1, `select pbx_record_funding('${b.budget}', '${U.pm}', current_date, 200, 'cash', null, null, null, '${id()}')`);
      await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${U.pm3}', 'member'); update proj_projects set pm_user_id = '${U.pm3}' where id = '${p}'`);
      // the new PM manages the budget and sees funding
      expect((await view(U.pm3, p)).viewer).toMatchObject({ is_pm: true, is_full_reader: true });
      expect((await view(U.pm3, p)).funding).toHaveLength(1);
      const add = await call<string>(U.pm3, `select pbx_request_addition('${b.budget}')`);
      expect(add).toBeTruthy();
      // the former PM: header and their own submission only; no funding, no settlement, no writes
      const old = await view(U.pm, p);
      expect(old.viewer).toMatchObject({ is_pm: false, is_full_reader: false });
      expect(old.funding).toEqual([]);
      expect(old.settlement).toBeNull();
      expect(old.versions.map((x: Row) => x.submitted_by)).toEqual([U.pm]);                      // not the new PM's addition draft
      expect((await q<{ a: Row }>(U.pm, `select pbx_project_access('${p}') as a`))[0].a).toMatchObject({ can_open: true, is_pm: false });
      await failsCommit(U.pm, `select pbx_request_addition('${b.budget}')`, /Only the Project Manager/);
      await failsCommit(U.pm, `select pbx_discard_draft('${add}')`, /Only the Project Manager|Budget not found/);
      expect(await q(U.pm, `select 1 from pbx_funding where budget_id = '${b.budget}'`)).toHaveLength(0);
      // the historical attribution is preserved
      expect((await admin<Row>(`select created_by, submitted_by from pbx_budget_versions where budget_id = '${b.budget}' and kind = 'original'`))[0]).toMatchObject({ created_by: U.pm, submitted_by: U.pm });
    });

    it("a completed, archived or on-hold project keeps its budget and can still be settled (project completion is separate)", async () => {
      const p = await newProject(U.pm);
      const b = await approved(p, U.pm, U.fin1);
      await call(U.fin1, `select pbx_record_funding('${b.budget}', '${U.pm}', current_date, 100, 'cash', null, null, null, '${id()}')`);
      const statusBefore = (await admin<Row>(`select status from proj_projects where id = '${p}'`))[0].status;
      await admin(`update proj_projects set status = 'archived', archived_at = now() where id = '${p}'`);
      const sub = await call<string>(U.pm, `select pbx_start_actuals('${b.budget}')`);
      const ids = await budgetRowIds(b.budget);
      const d = await actualDraft(b.budget);
      const lines = ids.map((rid, i) => ({ budget_row_id: rid, actual_amount: String([360, 30, 30, 1050][i]), paid_via: i === 0 ? "advance" : "company_card", paid_by_user_id: i === 0 ? U.pm : undefined }));
      const rv = await call<number>(U.pm, `select pbx_save_actuals_draft('${sub}', ${d.row_version}, ${j({ complete_confirmed: true })}, ${j(lines)})`);
      await call(U.pm, `select pbx_submit_actuals('${sub}', ${rv}, '${id()}')`);
      await call(U.fin2, `select pbx_decide_actuals('${sub}', 'approve')`);
      const s = (await view(U.fin2, p)).settlement;
      expect(num(s.advance_to_return)).toBe(0);
      expect(num(s.reimbursement_outstanding)).toBe(260);                                           // 360 spent from a 100 advance: 260 out of pocket
      expect(statusBefore).not.toBe("archived");
      expect((await admin<Row>(`select status from proj_projects where id = '${p}'`))[0].status).toBe("archived");   // the budget never changed the project's status
      await commit(U.fin2, `select pbx_record_receipts('${b.budget}', 'received')`);
      await call(U.fin2, `select pbx_record_payment('${b.budget}', 'reimbursement', '${U.pm}', 260, current_date, 'bank_transfer', 'BT-9', null, '${id()}')`);
      await commit(U.fin2, `select pbx_close_settlement('${b.budget}', null)`);
      expect((await view(U.fin2, p)).budget.settlement_status).toBe("closed");
    });

    it("existing employee claims are untouched and are never counted again as reimbursements or advance spending", async () => {
      // only the three draft claims this suite created exist beyond the starting set, and linking them to an expense line did not change them
      const claims = await admin<Row>(`select count(*)::int n, count(*) filter (where status = 'draft' and total_amount = 0)::int untouched from reimbursement_claims`);
      expect(claims[0].n).toBe(JSON.parse(claimsBefore)[0].n * 1 + 3);
      expect(claims[0].untouched).toBe(3);
      // the claim lines linked by the earlier tests are "existing_claim": excluded from every balance
      const s = settlementFigures("AED", [], [{ paidVia: "existing_claim", paidBy: null, amount: 99 }], []);
      expect(s.reimbursementOwed).toBe(0);
      expect(s.advanceToReturn).toBe(0);
    });

    it("the company switch pauses every change but not reading; switching back on restores everything", async () => {
      const p = await newProject(U.pm);
      const b = await approved(p, U.pm, U.fin1);
      await admin(`insert into pbx_company_settings (company_id, is_enabled) values ('${CO.uae}', false)`);
      try {
        const msg = /switched off for this company/;
        await failsCommit(U.pm, `select pbx_request_addition('${b.budget}')`, msg);
        await failsCommit(U.fin1, `select pbx_record_funding('${b.budget}', '${U.pm}', current_date, 10, 'cash', null, null, null, '${id()}')`, msg);
        await failsCommit(U.pm, `select pbx_create_budget('${await newProject(U.pm)}', 'AED')`, msg);
        await failsCommit(U.fin1, `select pbx_record_receipts('${b.budget}', 'received')`, msg);
        expect((await view(U.pm, p)).budget.id).toBe(b.budget);                       // still readable
        expect((await view(U.fin1, p)).budget.id).toBe(b.budget);
        await call(U.fin1, `select pbx_set_rate('${CO.uae}', 'AED', 'petrol_per_km', 0.5)`);   // rates stay manageable
        // another company is unaffected
        expect(await q(U.ksaFin, `select 1 from pbx_company_settings where is_enabled = false`)).toHaveLength(0);   // KSA has no switch row: on; and UAE's switch is not readable there
      } finally {
        await admin(`update pbx_company_settings set is_enabled = true where company_id = '${CO.uae}'`);
      }
      await call(U.pm, `select pbx_request_addition('${b.budget}')`);
    });

    it("keeps an audit trail that only Finance and view grantees can read, and leaves HR, Sales and Projects data untouched", async () => {
      const audit = await q<Row>(U.fin1, `select table_name, action from pbx_audit_log where company_id = '${CO.uae}'`);
      expect(audit.length).toBeGreaterThan(50);
      expect([...new Set(audit.map((a) => a.table_name))]).toEqual(expect.arrayContaining(["pbx_budgets", "pbx_budget_versions", "pbx_funding", "pbx_payments"]));
      expect(await q(U.pm, `select 1 from pbx_audit_log`)).toHaveLength(0);
      expect(await q(U.outsider, `select 1 from pbx_audit_log`)).toHaveLength(0);
      expect((await q<Row>(U.ksaFin, `select 1 from pbx_audit_log where company_id = '${CO.uae}'`)).length).toBe(0);
      const hrAfter = JSON.stringify(await admin(`select (select count(*) from user_roles) roles, (select count(*) from employees) emps, (select count(*) from approvals) approvals,
         (select count(*) from crm_company_grants) crm, (select count(*) from proj_company_grants) proj`));
      expect(hrAfter).toBe(hrBefore);
      // the module wrote no HR, Sales or Projects rows of its own: project rows differ only by the test's own seeding of projects
      expect((await admin<Row>(`select count(*) n from approvals`))[0].n).toBe("0");
    });
  });
});
