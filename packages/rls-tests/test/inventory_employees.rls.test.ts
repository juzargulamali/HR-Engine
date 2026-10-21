import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Inventory migration 6 (employees and the earlier HR asset register). Proves, against a real Postgres built from every migration:
//   * the restricted employee lookup (exact columns, no private data, capability-gated, active employees of one company only);
//   * inv_my_equipment (own equipment only, no costs), HR's outstanding view (inactive employees included, no private data);
//   * inv_reassign_unit (employee <-> pool, history, idempotency, reservation conflict, unavailable for projects while assigned);
//   * legacy preview / import (idempotent, one unit per asset, draft, no cost leak, HR tables untouched);
//   * inv_mirror_legacy keeps asset_assignments / assets.status in step; the guard triggers refuse direct edits of linked assets and
//     leave unlinked assets exactly as before; no other HR table changes; revoked access and wrong-company callers are refused.
// Inventory rows are created with admin SQL, so this file does not depend on the stock (migration 4) or planning (migration 5) functions.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FIRST_INV_MIGRATION = "20261201000000_inv_access_audit_settings.sql";
const LAST_INV_MIGRATION = "20261201000500_inv_employee_legacy.sql";
// Everything from the first Inventory migration up to this one (other migrations in between are applied too, so name clashes show up).
const INV_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f >= FIRST_INV_MIGRATION && f <= LAST_INV_MIGRATION && f.endsWith(".sql")).sort();

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = {
  founder: id(), ksaFounder: id(), op1: id(), op2: id(), opCross: id(), opNoLoc: id(), hrCust: id(), deptHead: id(), basic: id(), viewStock: id(),
  costReader: id(), sales: id(), projects: id(), hrAdmin: id(), outsider: id(),
  alice: id(), bob: id(), carl: id(), eve: id(), kara: id(), noEmployee: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-emp-test.ae')`).join(", ");
const E = { mona: id(), alice: id(), bob: id(), carl: id(), dora: id(), eve: id(), fred: id(), gina: id(), kara: id() };
const DEPT_OPS = id();
const DENIED = /permission denied|row-level security|Only |not signed in|do not have|cannot|can no longer|switched off|managed in Inventory/i;
const MANAGED_MSG = "This item is managed in Inventory. Use Inventory to issue or return it.";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HR_TABLES = ["employees", "departments", "user_roles", "employment_contracts", "compensation_details", "attendance_records", "leave_requests",
  "leave_ledger", "comp_day_ledger", "payroll_export_lines", "employee_documents", "identity_documents", "employee_career_events"];

describe("Inventory: employees and the legacy asset register", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string, params: unknown[] = []) => db.asUser(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const fails = (user: string | null, sql: string, re: RegExp = DENIED) => expect(q(user, sql)).rejects.toThrow(re);
  const keys = (r: Row) => Object.keys(r).sort();
  // date columns come back from pg as JS Dates at local midnight
  const ymd = (v: unknown) => (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v));

  let locA = "", locB = "", locKsa = "", locOff = "";
  let itemLaptop = "", itemCable = "", itemKsa = "";
  let unitSeq = 90000;
  let hrBefore = "";
  const A: Record<string, string> = {};   // legacy asset ids by name
  let unitAlice = "";                      // seeded unit held by Alice (movement history)
  let unitCarl = "";                       // seeded unit held by terminated Carl

  const fingerprint = async (tables: string[]) => {
    const out: Record<string, string> = {};
    for (const t of tables) out[t] = (await admin<{ fp: string }>(`select md5(coalesce(string_agg(x::text, ',' order by x::text), '')) fp from ${t} x`))[0].fp;
    return JSON.stringify(out);
  };

  async function mkUnit(o: { company?: string; item?: string; custody?: string; location?: string | null; employee?: string | null; lifecycle?: string;
    condition?: string; repair?: string | null; legacy?: string | null; expectedReturn?: string | null }): Promise<string> {
    const uid = id();
    const custody = o.custody ?? "warehouse";
    const loc = o.location === undefined ? locA : o.location;
    await admin(`insert into inv_units (id, company_id, item_id, code, lifecycle, condition, custody_kind, location_id, employee_id, repair_reference,
        legacy_asset_id, expected_return_at, retired_at)
      values ('${uid}', '${o.company ?? CO.uae}', '${o.item ?? itemLaptop}', 'UAE-E-${++unitSeq}', '${o.lifecycle ?? "active"}', '${o.condition ?? "good"}', '${custody}',
        ${loc ? `'${loc}'` : "null"}, ${o.employee ? `'${o.employee}'` : "null"}, ${o.repair ? `'${o.repair}'` : "null"},
        ${o.legacy ? `'${o.legacy}'` : "null"}, ${o.expectedReturn ? `'${o.expectedReturn}'` : "null"}, ${o.lifecycle === "retired" ? "now()" : "null"})`);
    return uid;
  }

  async function mkAsset(tag: string, o: { company?: string; status?: string; purchase?: string; value?: number; deleted?: boolean } = {}): Promise<string> {
    const aid = id();
    await admin(`insert into assets (id, company_id, asset_tag, category, description, purchase_date, value, status, deleted_at)
      values ('${aid}', '${o.company ?? CO.uae}', '${tag}', 'laptop', 'DESC-${tag}', ${o.purchase ? `'${o.purchase}'` : "null"}, ${o.value ?? "null"},
        '${o.status ?? "in_stock"}', ${o.deleted ? "now()" : "null"})`);
    return aid;
  }

  const assign = (asset: string, emp: string, issued: string, returned: string | null = null) =>
    admin(`insert into asset_assignments (asset_id, employee_id, issued_date, returned_date, issued_by) values ('${asset}', '${emp}', '${issued}', ${returned ? `'${returned}'` : "null"}, '${U.hrAdmin}')`);

  const reassign = (user: string, unit: string, to: string, emp: string | null, reason: string | null, key: string) =>
    commit<{ r: Row }>(user, `select inv_reassign_unit('${unit}', '${to}', ${emp ? `'${emp}'` : "null"}, ${reason === null ? "null" : `'${reason}'`}, '${key}') as r`);
  const reassignSql = (unit: string, to: string, emp: string | null, reason: string, key: string) =>
    `select inv_reassign_unit('${unit}', '${to}', ${emp ? `'${emp}'` : "null"}, '${reason}', '${key}') as r`;
  const openRows = (asset: string) => admin<Row>(`select employee_id, issued_date, returned_date from asset_assignments where asset_id = '${asset}' and returned_date is null order by issued_date`);
  const assetStatus = async (asset: string) => (await admin<{ status: string }>(`select status from assets where id = '${asset}'`))[0].status;
  const free = async (unit: string, loc = locA) =>
    (await admin<{ f: boolean }>(`select inv_unit_free('${unit}', now() + interval '5 days', now() + interval '6 days', '${loc}') f`))[0].f;
  const mirror = (unit: string) => admin(`select inv_mirror_legacy('${unit}')`);

  beforeAll(async () => {
    await db.setupBefore(FIRST_INV_MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hrAdmin}', 'hr_admin');
    `);
    // What a real Supabase project does for every new object in public: broad default grants. The migrations must undo them themselves.
    await db.seed(`
      alter default privileges in schema public grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
      alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    for (const f of INV_MIGRATIONS) await db.applyMigration(f);
    // The HR pages work on these through row-level security; the older tables got their grants from the platform.
    await db.seed(`
      grant select, insert, update, delete on assets, asset_assignments to authenticated;
      grant select on employees, departments, user_roles, profiles to authenticated;
    `);

    // ---- HR data (including the private columns Inventory must never reveal)
    await db.seed(`
      insert into departments (id, company_id, name) values ('${DEPT_OPS}', '${CO.uae}', 'Operations');
      insert into employees (id, user_id, employee_number, company_id, country_code, department_id, first_name, last_name, personal_email, phone, date_of_birth, hire_date, employment_status, termination_date, deleted_at, job_title) values
        ('${E.mona}',  null,         'AE-005', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Mona',  'Manager', 'mona.private@gmail.example',  '+971500000005', '1980-01-01', '2020-01-01', 'active',     null,         null, 'Head of Ops'),
        ('${E.alice}', '${U.alice}', 'AE-001', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Alice', 'Anders',  'alice.private@gmail.example', '+971500000001', '1990-04-04', '2023-01-01', 'active',     null,         null, 'Engineer'),
        ('${E.bob}',   '${U.bob}',   'AE-002', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Bob',   'Brown',   'bob.private@gmail.example',   '+971500000002', '1991-05-05', '2023-01-01', 'active',     null,         null, 'Technician'),
        ('${E.carl}',  '${U.carl}',  'AE-003', '${CO.uae}', 'AE', null,          'Carl',  'Clark',   'carl.private@gmail.example',  '+971500000003', '1985-06-06', '2021-01-01', 'terminated', '2026-09-30', null, 'Technician'),
        ('${E.dora}',  null,         'AE-004', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Dora',  'Dunn',    'dora.private@gmail.example',  '+971500000004', '1992-07-07', '2024-01-01', 'active',     null,         null, 'Designer'),
        ('${E.eve}',   '${U.eve}',   'AE-006', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Eve',   'Evans',   'eve.private@gmail.example',   '+971500000006', '1993-08-08', '2024-01-01', 'on_leave',   null,         null, 'Designer'),
        ('${E.fred}',  null,         'AE-007', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Fred',  'Ford',    'fred.private@gmail.example',  '+971500000007', '1990-09-09', '2019-01-01', 'active',     '2026-01-01', null, 'Designer'),
        ('${E.gina}',  null,         'AE-008', '${CO.uae}', 'AE', '${DEPT_OPS}', 'Gina',  'Grant',   'gina.private@gmail.example',  '+971500000008', '1990-10-10', '2019-01-01', 'active',     null,         now(), 'Designer'),
        ('${E.kara}',  '${U.kara}',  'SA-001', '${CO.ksa}', 'SA', null,          'Kara',  'Khan',    'kara.private@gmail.example',  '+966500000001', '1990-11-11', '2022-01-01', 'active',     null,         null, 'Engineer');
      update employees set manager_id = '${E.mona}' where id in ('${E.alice}', '${E.bob}');
      insert into employment_contracts (employee_id, contract_type, start_date, version_no, is_current, created_by) values ('${E.alice}', 'permanent', '2023-01-01', 1, true, '${U.hrAdmin}');
      insert into compensation_details (employee_id, effective_from, base_salary, currency, created_by) values ('${E.alice}', '2023-01-01', 98765.43, 'AED', '${U.hrAdmin}');
      insert into attendance_records (employee_id, work_date, status) values ('${E.alice}', '2026-01-05', 'present');
    `);
    for (let n = 1; n <= 25; n++) {
      await db.seed(`insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date)
        values ('AE-1${String(n).padStart(2, "0")}', '${CO.uae}', 'AE', 'Zed', 'Clone${String(n).padStart(2, "0")}', '2024-01-01')`);
    }
    hrBefore = await fingerprint(HR_TABLES);

    // ---- Inventory data (admin SQL: independent of the stock and planning functions)
    locA = id(); locB = id(); locKsa = id(); locOff = id();
    itemLaptop = id(); itemCable = id(); itemKsa = id();
    await db.seed(`
      insert into inv_company_settings (company_id, reference_code) values ('${CO.uae}', 'UAE'), ('${CO.ksa}', 'KSA');
      insert into inv_locations (id, company_id, code, name, timezone) values
        ('${locA}', '${CO.uae}', 'DXB1', 'Dubai warehouse 1', 'Asia/Dubai'), ('${locB}', '${CO.uae}', 'DXB2', 'Dubai warehouse 2', 'Asia/Dubai'),
        ('${locKsa}', '${CO.ksa}', 'RUH1', 'Riyadh warehouse', 'Asia/Riyadh');
      insert into inv_locations (id, company_id, code, name, timezone, is_active) values ('${locOff}', '${CO.uae}', 'OLD1', 'Closed warehouse', 'Asia/Dubai', false);
      insert into inv_items (id, company_id, name, tracking, status) values
        ('${itemLaptop}', '${CO.uae}', 'Laptop 14', 'individual', 'active'), ('${itemCable}', '${CO.uae}', 'HDMI cable 5m', 'quantity', 'active'),
        ('${itemKsa}', '${CO.ksa}', 'Laptop KSA', 'individual', 'active');
      insert into inv_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}'),
        ('${U.op1}', '${CO.uae}', '{warehouse}'), ('${U.op2}', '${CO.uae}', '{warehouse}'), ('${U.opCross}', '${CO.uae}', '{warehouse,cross_location}'),
        ('${U.opNoLoc}', '${CO.uae}', '{warehouse}'), ('${U.hrCust}', '${CO.uae}', '{view_employee_custody}'),
        ('${U.deptHead}', '${CO.uae}', '{request_for_employees}'), ('${U.basic}', '${CO.uae}', '{}'), ('${U.viewStock}', '${CO.uae}', '{view_stock}'),
        ('${U.costReader}', '${CO.uae}', '{view_costs}');
      insert into inv_operator_locations (company_id, user_id, location_id) values ('${CO.uae}', '${U.op1}', '${locA}'), ('${CO.uae}', '${U.op2}', '${locB}');
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.uae}', '{founder}');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.projects}', '${CO.uae}', '{founder}');
    `);

    // Alice holds a laptop issued by a recorded movement; Carl (terminated) holds a laptop and 5 cables; Bob holds 2 cables.
    unitAlice = await mkUnit({ custody: "employee", employee: E.alice });
    unitCarl = await mkUnit({ custody: "employee", employee: E.carl });
    const mv = id(), mv2 = id();
    const balBob = id(), balCarl = id();
    await db.seed(`
      insert into inv_movements (id, company_id, code, kind, occurred_at, performed_by, recipient_employee_id, employee_id)
        values ('${mv}', '${CO.uae}', 'UAE-M-90001', 'issue_employee', '2026-05-01T08:00:00Z', '${U.founder}', '${E.alice}', '${E.alice}');
      insert into inv_movement_lines (movement_id, company_id, item_id, unit_id, qty, from_kind, to_kind, from_location_id, to_employee_id)
        values ('${mv}', '${CO.uae}', '${itemLaptop}', '${unitAlice}', 1, 'warehouse', 'employee', '${locA}', '${E.alice}');
      insert into inv_balances (id, company_id, item_id, holder_kind, employee_id, condition, qty, expected_return_at) values
        ('${balBob}', '${CO.uae}', '${itemCable}', 'employee', '${E.bob}', 'good', 2, now() - interval '3 days'),
        ('${balCarl}', '${CO.uae}', '${itemCable}', 'employee', '${E.carl}', 'good', 5, null);
      insert into inv_movements (id, company_id, code, kind, occurred_at, performed_by, recipient_employee_id, employee_id)
        values ('${mv2}', '${CO.uae}', 'UAE-M-90002', 'issue_employee', '2026-06-10T08:00:00Z', '${U.founder}', '${E.bob}', '${E.bob}');
      insert into inv_movement_lines (movement_id, company_id, item_id, qty, from_kind, to_kind, from_location_id, to_employee_id, to_balance_id)
        values ('${mv2}', '${CO.uae}', '${itemCable}', 2, 'warehouse', 'employee', '${locA}', '${E.bob}', '${balBob}');
      insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency) values ('${CO.uae}', '${itemLaptop}', '${unitAlice}', '2025-02-02', 1234.56, 'AED');
    `);
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("privileges", () => {
    it("keeps internal helpers closed to browser sessions and opens the client functions", async () => {
      const rows = await admin<{ proname: string; anon: boolean; auth: boolean }>(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
        has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
        'inv_mirror_legacy', 'inv_is_warehouse_operator', 'inv_employee_active', 'inv_legacy_guard', 'inv_asset_is_linked', 'inv_employee_lookup', 'inv_my_equipment',
        'inv_employee_outstanding', 'inv_reassign_unit', 'inv_preview_legacy_assets', 'inv_import_legacy_assets')`);
      const by = Object.fromEntries(rows.map((r) => [r.proname, r]));
      for (const n of ["inv_mirror_legacy", "inv_is_warehouse_operator", "inv_employee_active", "inv_legacy_guard"]) expect([n, by[n]!.anon, by[n]!.auth]).toEqual([n, false, false]);
      for (const n of ["inv_employee_lookup", "inv_my_equipment", "inv_employee_outstanding", "inv_reassign_unit", "inv_preview_legacy_assets", "inv_import_legacy_assets", "inv_asset_is_linked"]) {
        expect([n, by[n]!.anon, by[n]!.auth]).toEqual([n, false, true]);
      }
    });
    it("denies anonymous callers every client function and refuses a browser session the mirror", async () => {
      await expect(q(null, `select * from inv_employee_lookup('${CO.uae}', 'ali')`)).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select * from inv_my_equipment()`)).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select * from inv_employee_outstanding('${CO.uae}')`)).rejects.toThrow(/permission denied/i);
      await expect(q(U.founder, `select inv_mirror_legacy('${unitAlice}')`)).rejects.toThrow(/permission denied/i);
      await expect(q(U.founder, `select inv_employee_active('${E.alice}')`)).rejects.toThrow(/permission denied/i);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("restricted employee lookup", () => {
    const lookup = (user: string, query: string, company = CO.uae) => q<Row>(user, `select * from inv_employee_lookup('${company}', '${query}')`);

    it("returns exactly id, display name, employee number and department name", async () => {
      const rows = await lookup(U.founder, "ali");
      expect(rows).toHaveLength(1);
      expect(keys(rows[0])).toEqual(["department_name", "display_name", "employee_id", "employee_number"]);
      expect(rows[0]).toEqual({ employee_id: E.alice, display_name: "Alice Anders", employee_number: "AE-001", department_name: "Operations" });
    });
    it("is available to founders, warehouse operators (assigned or cross-location) and request_for_employees holders", async () => {
      for (const u of [U.founder, U.op1, U.op2, U.opCross, U.deptHead]) expect((await lookup(u, "alice")).map((r) => r.employee_id), String(u)).toEqual([E.alice]);
    });
    it("is refused to basic access, stock readers, HR custody readers, cost readers, an operator with no location, and Sales / Projects / HR-only users", async () => {
      for (const u of [U.basic, U.viewStock, U.hrCust, U.costReader, U.opNoLoc, U.sales, U.projects, U.hrAdmin, U.outsider, U.alice]) {
        await fails(u, `select * from inv_employee_lookup('${CO.uae}', 'ali')`, /Only warehouse operators|permission denied/i);
      }
    });
    it("cannot be used to find anyone by private data or to see the manager", async () => {
      for (const probe of ["alice.private", "gmail", "+9715000", "1990-04", "Engineer", "98765"]) expect(await lookup(U.founder, probe).catch(() => [])).toEqual([]);
      const all = await lookup(U.founder, "AE-00");
      expect(JSON.stringify(all)).not.toMatch(/private@|\+9715|1990-|Engineer|Head of Ops|98765\./);
    });
    it("matches by employee number and by several words, and treats % and _ literally", async () => {
      expect((await lookup(U.founder, "AE-002")).map((r) => r.display_name)).toEqual(["Bob Brown"]);
      expect((await lookup(U.founder, "anders ali")).map((r) => r.display_name)).toEqual(["Alice Anders"]);
      expect((await lookup(U.founder, "%%")).length).toBe(0);
      expect((await lookup(U.founder, "__")).length).toBe(0);
    });
    it("lists only active employees: terminated, past termination date and removed employees are excluded, on-leave stays", async () => {
      const rows = await lookup(U.founder, "AE-00");
      expect(rows.map((r) => r.display_name)).toEqual(["Alice Anders", "Bob Brown", "Dora Dunn", "Eve Evans", "Mona Manager"]);
      expect(rows.map((r) => r.employee_number)).not.toContain("AE-003");
      expect(rows.map((r) => r.employee_number)).not.toContain("AE-007");
      expect(rows.map((r) => r.employee_number)).not.toContain("AE-008");
    });
    it("needs two characters and returns at most 20 rows", async () => {
      expect(await lookup(U.founder, "a")).toEqual([]);
      expect(await lookup(U.founder, " ")).toEqual([]);
      expect((await lookup(U.founder, "zed")).length).toBe(20);
    });
    it("never crosses companies, in either direction", async () => {
      expect(await lookup(U.founder, "kara")).toEqual([]);
      await fails(U.ksaFounder, `select * from inv_employee_lookup('${CO.uae}', 'ali')`, /Only warehouse operators/);
      expect(await lookup(U.ksaFounder, "ali", CO.ksa)).toEqual([]);
      expect((await lookup(U.ksaFounder, "kara", CO.ksa)).map((r) => r.employee_number)).toEqual(["SA-001"]);
      await fails(U.op1, `select * from inv_employee_lookup('${CO.ksa}', 'kara')`, /Only warehouse operators/);
    });
    it("stops working the moment the grant is revoked, in the same session", async () => {
      await db.asUser(U.op1, async (query) => {
        expect((await query(`select * from inv_employee_lookup('${CO.uae}', 'ali')`)).rows).toHaveLength(1);
        await query("reset role");
        await query(`update inv_company_grants set revoked_at = now() where user_id = '${U.op1}'`);
        await query("set local role authenticated");
        await expect(query(`select * from inv_employee_lookup('${CO.uae}', 'ali')`)).rejects.toThrow(/Only warehouse operators/);
      });
    });
    it("is not available through the table either: employees stay invisible to Inventory callers", async () => {
      expect((await q<Row>(U.founder, "select id from employees")).length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("inv_my_equipment", () => {
    it("shows only the caller's own units and quantity items, with the issued date from the latest movement", async () => {
      const rows = await q<Row>(U.alice, "select * from inv_my_equipment()");
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("unit");
      expect(rows[0].unit_id).toBe(unitAlice);
      expect(rows[0].item_name).toBe("Laptop 14");
      expect(rows[0].code).toMatch(/^UAE-E-/);
      expect(rows[0].serial_number).toBeNull();
      expect(new Date(rows[0].issued_at).toISOString()).toBe("2026-05-01T08:00:00.000Z");
      expect(rows[0].condition).toBe("good");
      const bob = await q<Row>(U.bob, "select * from inv_my_equipment()");
      expect(bob).toHaveLength(1);
      expect(bob[0]).toMatchObject({ kind: "quantity", item_name: "HDMI cable 5m", is_overdue: true });
      expect(Number(bob[0].qty)).toBe(2);
      expect(new Date(bob[0].issued_at).toISOString()).toBe("2026-06-10T08:00:00.000Z");
      expect(bob[0].code).toBeNull();
    });
    it("returns no costs, no other column than the documented ones, and nothing for the other people's equipment", async () => {
      const rows = await q<Row>(U.alice, "select * from inv_my_equipment()");
      expect(keys(rows[0])).toEqual(["balance_id", "code", "company_id", "condition", "expected_return_at", "is_overdue", "issued_at", "item_id", "item_name", "kind",
        "lifecycle", "qty", "serial_number", "unit_id", "unit_of_measure"]);
      expect(JSON.stringify(rows)).not.toMatch(/1234\.56|cost|price/i);
      expect(JSON.stringify(rows)).not.toContain(unitCarl);
    });
    it("returns nothing for a signed-in user with no employee link, for Inventory founders, and for an employee who holds nothing", async () => {
      for (const u of [U.noEmployee, U.founder, U.eve, U.kara, U.hrAdmin]) expect(await q<Row>(u, "select * from inv_my_equipment()"), String(u)).toEqual([]);
    });
    it("works without any Inventory capability and not for anonymous callers", async () => {
      expect((await admin<Row>(`select 1 from inv_company_grants where user_id = '${U.alice}'`)).length).toBe(0);
      await expect(q(null, "select * from inv_my_equipment()")).rejects.toThrow(/permission denied/i);
    });
    it("a terminated employee's own account still sees what they hold", async () => {
      const carl = await q<Row>(U.carl, "select * from inv_my_equipment()");
      expect(carl.map((r) => r.kind).sort()).toEqual(["quantity", "unit"]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("inv_employee_outstanding (HR / warehouse view)", () => {
    const outstanding = (user: string, extra = "", company = CO.uae) => q<Row>(user, `select * from inv_employee_outstanding('${company}'${extra})`);

    it("lists every holder including the terminated employee, flagging status and termination date", async () => {
      const rows = await outstanding(U.hrCust);
      const byEmp = (n: string) => rows.filter((r) => r.employee_number === n);
      expect(byEmp("AE-001")).toHaveLength(1);
      expect(byEmp("AE-002")).toHaveLength(1);
      const carl = byEmp("AE-003");
      expect(carl.map((r) => r.holding_kind).sort()).toEqual(["quantity", "unit"]);
      for (const r of carl) expect(r).toMatchObject({ employment_status: "terminated", is_active: false, display_name: "Carl Clark" });
      expect(ymd(carl[0]!.termination_date)).toBe("2026-09-30");
      expect(byEmp("AE-001")[0]).toMatchObject({ is_active: true, employment_status: "active", termination_date: null, unit_id: unitAlice });
      expect(Number(carl.find((r) => r.holding_kind === "quantity")!.qty)).toBe(5);
    });
    it("can leave out inactive employees, or show one employee", async () => {
      const active = await outstanding(U.hrCust, ", null, false");
      expect(active.map((r) => r.employee_number)).not.toContain("AE-003");
      expect(active.map((r) => r.employee_number)).toContain("AE-001");
      const one = await outstanding(U.hrCust, `, '${E.carl}'`);
      expect(one.every((r) => r.employee_id === E.carl)).toBe(true);
      expect(one).toHaveLength(2);
      expect(await outstanding(U.hrCust, `, '${E.dora}'`)).toEqual([]);
    });
    it("exposes no salary, leave, document or personal data: exact column list and no private values anywhere", async () => {
      const rows = await outstanding(U.hrCust);
      expect(keys(rows[0])).toEqual(["balance_id", "code", "condition", "display_name", "employee_id", "employee_number", "employment_status", "expected_return_at",
        "holding_kind", "is_active", "is_overdue", "is_removed", "issued_at", "item_id", "item_name", "lifecycle", "qty", "serial_number", "termination_date",
        "unit_id", "unit_of_measure"]);
      expect(JSON.stringify(rows)).not.toMatch(/private@|\+9715|1990-|1985-|Technician|Engineer|Mona|98765\.|salary|manager|1234\.56/i);
    });
    it("requires founder, view_employee_custody or warehouse operator access", async () => {
      for (const u of [U.founder, U.hrCust, U.op1, U.opCross]) expect((await outstanding(u)).length, String(u)).toBeGreaterThan(0);
      for (const u of [U.basic, U.viewStock, U.deptHead, U.costReader, U.opNoLoc, U.sales, U.projects, U.hrAdmin, U.outsider, U.alice]) {
        await fails(u, `select * from inv_employee_outstanding('${CO.uae}')`, /Only a founder|permission denied/i);
      }
    });
    it("is limited to the company's own equipment and the company the caller has access to", async () => {
      await fails(U.hrCust, `select * from inv_employee_outstanding('${CO.ksa}')`, /Only a founder/);
      await fails(U.ksaFounder, `select * from inv_employee_outstanding('${CO.uae}')`, /Only a founder/);
      expect(await outstanding(U.ksaFounder, "", CO.ksa)).toEqual([]);
    });
    it("shows a soft-deleted employee's equipment as removed, and stops at once when access is revoked", async () => {
      const unit = await mkUnit({ custody: "employee", employee: E.gina });
      const rows = await outstanding(U.hrCust, `, '${E.gina}'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ is_removed: true, is_active: false, unit_id: unit });
      await db.asUser(U.hrCust, async (query) => {
        expect((await query(`select * from inv_employee_outstanding('${CO.uae}')`)).rows.length).toBeGreaterThan(0);
        await query("reset role");
        await query(`update inv_company_grants set revoked_at = now() where user_id = '${U.hrCust}'`);
        await query("set local role authenticated");
        await expect(query(`select * from inv_employee_outstanding('${CO.uae}')`)).rejects.toThrow(/Only a founder/);
      });
      await admin(`delete from inv_units where id = '${unit}'`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("inv_reassign_unit", () => {
    it("moves a pool unit to an employee with a ledger movement, makes it unavailable for projects, and moves it back to the pool", async () => {
      const unit = await mkUnit({});
      expect(await free(unit)).toBe(true);
      const r = (await reassign(U.op1, unit, "employee", E.alice, "Permanent laptop for Alice", "key-assign-0001"))[0].r;
      expect(r).toMatchObject({ unit_id: unit, to: "employee", employee_id: E.alice, replayed: false });
      const u = (await admin<Row>(`select custody_kind, employee_id, expected_return_at, location_id, version from inv_units where id = '${unit}'`))[0];
      expect(u).toMatchObject({ custody_kind: "employee", employee_id: E.alice, location_id: locA, expected_return_at: null, version: 2 });
      expect(await free(unit)).toBe(false);
      const mv = (await admin<Row>(`select m.kind, m.reason, m.performed_by, m.recipient_employee_id, m.idempotency_key, l.from_kind, l.to_kind, l.to_employee_id, l.from_employee_id, l.from_location_id, l.qty
        from inv_movements m join inv_movement_lines l on l.movement_id = m.id where m.id = '${r.movement_id}'`))[0];
      expect(mv).toMatchObject({ kind: "reassign_employee", reason: "Permanent laptop for Alice", performed_by: U.op1, recipient_employee_id: E.alice,
        idempotency_key: "key-assign-0001", from_kind: "warehouse", to_kind: "employee", to_employee_id: E.alice, from_employee_id: null, from_location_id: locA });
      expect(r.movement_code).toMatch(/^UAE-M-\d{5}$/);
      expect((await q<Row>(U.alice, "select unit_id from inv_my_equipment()")).map((x) => x.unit_id)).toContain(unit);
      // back to the pool
      const back = (await reassign(U.op1, unit, "pool", null, "Alice no longer needs it", "key-pool-00001"))[0].r;
      expect(back).toMatchObject({ to: "pool", employee_id: null, replayed: false });
      expect((await admin<Row>(`select custody_kind, employee_id, location_id from inv_units where id = '${unit}'`))[0]).toMatchObject({ custody_kind: "warehouse", employee_id: null, location_id: locA });
      expect(await free(unit)).toBe(true);
      const pool = (await admin<Row>(`select m.kind, l.from_kind, l.to_kind, l.from_employee_id, l.to_employee_id, l.to_location_id from inv_movements m join inv_movement_lines l on l.movement_id = m.id where m.id = '${back.movement_id}'`))[0];
      expect(pool).toMatchObject({ kind: "pool_change", from_kind: "employee", to_kind: "warehouse", from_employee_id: E.alice, to_employee_id: null, to_location_id: locA });
      expect((await q<Row>(U.alice, "select unit_id from inv_my_equipment()")).map((x) => x.unit_id)).not.toContain(unit);
    });
    it("moves a unit from one employee to another and keeps full history", async () => {
      const unit = await mkUnit({ custody: "employee", employee: E.alice });
      await reassign(U.founder, unit, "employee", E.dora, "Alice moved teams", "key-swap-00001");
      const rows = await admin<Row>(`select m.kind, l.from_employee_id, l.to_employee_id from inv_movements m join inv_movement_lines l on l.movement_id = m.id where l.unit_id = '${unit}'`);
      expect(rows).toEqual([{ kind: "reassign_employee", from_employee_id: E.alice, to_employee_id: E.dora }]);
      expect((await admin<Row>(`select employee_id from inv_units where id = '${unit}'`))[0].employee_id).toBe(E.dora);
    });
    it("is idempotent by key: a retry returns the first result and records nothing new", async () => {
      const unit = await mkUnit({});
      const first = (await reassign(U.op1, unit, "employee", E.bob, "Spare laptop", "key-retry-0001"))[0].r;
      const again = (await reassign(U.op1, unit, "employee", E.bob, "Spare laptop", "key-retry-0001"))[0].r;
      expect(again).toMatchObject({ movement_id: first.movement_id, replayed: true, to: "employee", employee_id: E.bob });
      expect(Number((await admin<{ n: string }>(`select count(*) n from inv_movements where idempotency_key = 'key-retry-0001'`))[0].n)).toBe(1);
      expect(Number((await admin<{ n: string }>(`select count(*) n from inv_movement_lines where unit_id = '${unit}'`))[0].n)).toBe(1);
      expect((await admin<Row>(`select version from inv_units where id = '${unit}'`))[0].version).toBe(2);
      // same key, different content or different caller: refused
      await expect(reassign(U.op1, unit, "employee", E.dora, "Spare laptop", "key-retry-0001")).rejects.toThrow(/already used/);
      await expect(reassign(U.op1, unit, "pool", null, "Spare laptop", "key-retry-0001")).rejects.toThrow(/already used/);
      await expect(reassign(U.op1, unit, "employee", E.bob, "Another reason", "key-retry-0001")).rejects.toThrow(/already used/);
      await expect(reassign(U.opCross, unit, "employee", E.bob, "Spare laptop", "key-retry-0001")).rejects.toThrow(/already used/);
    });
    it("validates the input in plain words", async () => {
      const unit = await mkUnit({});
      await fails(U.op1, reassignSql(unit, "employee", E.alice, "   ", "key-input-0001"), /Give a reason/);
      await fails(U.op1, `select inv_reassign_unit('${unit}', 'employee', '${E.alice}', null, 'key-input-0001')`, /Give a reason/);
      await fails(U.op1, reassignSql(unit, "employee", E.alice, "x", "short"), /8 to 120/);
      await fails(U.op1, reassignSql(unit, "somewhere", E.alice, "x", "key-input-0002"), /to an employee or back to the pool/);
      await fails(U.op1, reassignSql(unit, "employee", null, "x", "key-input-0003"), /Choose the employee/);
      await fails(U.op1, reassignSql(unit, "pool", E.alice, "x", "key-input-0004"), /Do not choose an employee/);
      await fails(U.op1, reassignSql(unit, "pool", null, "x", "key-input-0005"), /already in the warehouse pool/);
      await fails(U.op1, reassignSql(unit, "employee", id(), "x", "key-input-0006"), /Unknown employee/);
      expect((await admin<Row>(`select version from inv_units where id = '${unit}'`))[0].version).toBe(1);
    });
    it("refuses employees who are not active, who belong to another company, or who already hold the unit", async () => {
      const unit = await mkUnit({});
      await fails(U.op1, reassignSql(unit, "employee", E.carl, "x", "key-emp-000001"), /no longer active/);
      await fails(U.op1, reassignSql(unit, "employee", E.fred, "x", "key-emp-000002"), /no longer active/);
      await fails(U.op1, reassignSql(unit, "employee", E.gina, "x", "key-emp-000003"), /Unknown employee/);
      await fails(U.op1, reassignSql(unit, "employee", E.kara, "x", "key-emp-000004"), /does not belong to the company/);
      const held = await mkUnit({ custody: "employee", employee: E.alice });
      await fails(U.op1, reassignSql(held, "employee", E.alice, "x", "key-emp-000005"), /already assigned to that employee/);
    });
    it("is for founders and warehouse operators at the unit's location only, and refuses other companies and unknown units alike", async () => {
      const unit = await mkUnit({});
      const sql = (k: string) => reassignSql(unit, "employee", E.alice, "x", k);
      for (const [u, k] of [[U.basic, "k1"], [U.viewStock, "k2"], [U.hrCust, "k3"], [U.deptHead, "k4"], [U.costReader, "k5"], [U.op2, "k6"], [U.opNoLoc, "k7"],
        [U.sales, "k8"], [U.projects, "k9"], [U.hrAdmin, "k10"], [U.outsider, "k11"], [U.alice, "k12"], [U.ksaFounder, "k13"]] as const) {
        await fails(u, sql(`key-perm-${k.padStart(6, "0")}`), /Only a founder or a warehouse operator/);
      }
      await fails(U.founder, reassignSql(id(), "employee", E.alice, "x", "key-perm-unknown"), /Only a founder or a warehouse operator/);
      await fails(null, sql("key-perm-anon000"), /permission denied/i);
      // cross-location operators and founders work everywhere; a KSA founder cannot touch UAE equipment and a UAE founder cannot touch KSA equipment
      await reassign(U.opCross, unit, "employee", E.alice, "ok", "key-perm-cross01");
      const ksaUnit = await mkUnit({ company: CO.ksa, item: itemKsa, location: locKsa });
      await fails(U.founder, reassignSql(ksaUnit, "employee", E.kara, "x", "key-perm-ksa0001"), /Only a founder or a warehouse operator/);
    });
    it("a unit at the operator's other location is refused, at their own location allowed", async () => {
      const unitB = await mkUnit({ location: locB });
      await fails(U.op1, reassignSql(unitB, "employee", E.alice, "x", "key-loc-0000001"), /Only a founder or a warehouse operator/);
      await reassign(U.op2, unitB, "employee", E.alice, "ok", "key-loc-0000002");
    });
    it("refuses a unit that is retired, missing, damaged, on repair, or has no location to return to", async () => {
      const retired = await mkUnit({ lifecycle: "retired" });
      await fails(U.op1, reassignSql(retired, "employee", E.alice, "x", "key-state-00001"), /Retired or missing/);
      const missing = await mkUnit({ lifecycle: "missing" });
      await fails(U.op1, reassignSql(missing, "employee", E.alice, "x", "key-state-00002"), /Retired or missing/);
      const damaged = await mkUnit({ condition: "damaged" });
      await fails(U.op1, reassignSql(damaged, "employee", E.alice, "x", "key-state-00003"), /good or fair condition/);
      const repair = await mkUnit({ custody: "repair", repair: "RMA-1" });
      await fails(U.op1, reassignSql(repair, "employee", E.alice, "x", "key-state-00004"), /not in the warehouse or with an employee/);
      const noLoc = await mkUnit({ custody: "employee", employee: E.alice, location: null });
      await fails(U.op1, reassignSql(noLoc, "pool", null, "x", "key-state-00005"), /Only a founder or a warehouse operator/);
      await fails(U.founder, reassignSql(noLoc, "pool", null, "x", "key-state-00005"), /no recorded storage location/);
      const closed = await mkUnit({ custody: "employee", employee: E.alice, location: locOff });
      await fails(U.founder, reassignSql(closed, "pool", null, "x", "key-state-00006"), /no longer active/);
      // a damaged unit can still be taken back from an employee
      const dmg = await mkUnit({ custody: "employee", employee: E.alice, condition: "damaged" });
      await reassign(U.op1, dmg, "pool", null, "Returned broken", "key-state-00007");
      expect((await admin<Row>(`select custody_kind, condition from inv_units where id = '${dmg}'`))[0]).toEqual({ custody_kind: "warehouse", condition: "damaged" });
    });
    it("refuses an assignment that would break an active reservation, and allows it once the reservation is released", async () => {
      const unit = await mkUnit({});
      const req = id(), line = id(), res = id();
      await admin(`
        insert into inv_requests (id, company_id, code, kind, employee_id, requested_by, timezone) values ('${req}', '${CO.uae}', 'UAE-R-90001', 'employee', '${E.alice}', '${U.deptHead}', 'Asia/Dubai');
        insert into inv_request_lines (id, request_id, company_id, item_id, qty) values ('${line}', '${req}', '${CO.uae}', '${itemLaptop}', 1);
        insert into inv_reservations (id, company_id, request_line_id, item_id, unit_id, qty, reserved_during, made_by)
          values ('${res}', '${CO.uae}', '${line}', '${itemLaptop}', '${unit}', 1, tstzrange(now() + interval '2 days', now() + interval '4 days'), '${U.deptHead}');`);
      await expect(reassign(U.op1, unit, "employee", E.bob, "x", "key-resv-000001")).rejects.toThrow(/reserved for UAE-R-90001/);
      expect((await admin<Row>(`select custody_kind from inv_units where id = '${unit}'`))[0].custody_kind).toBe("warehouse");
      expect(Number((await admin<{ n: string }>(`select count(*) n from inv_movements where idempotency_key = 'key-resv-000001'`))[0].n)).toBe(0);
      await admin(`update inv_reservations set status = 'released', released_at = now() where id = '${res}'`);
      await reassign(U.op1, unit, "employee", E.bob, "x", "key-resv-000002");
      expect((await admin<Row>(`select custody_kind, employee_id from inv_units where id = '${unit}'`))[0]).toMatchObject({ custody_kind: "employee", employee_id: E.bob });
    });
    it("does not count an employee-assigned unit as available while a past reservation does not matter", async () => {
      const unit = await mkUnit({ custody: "employee", employee: E.alice });
      expect(await free(unit)).toBe(false);
      const req = id(), line = id();
      await admin(`
        insert into inv_requests (id, company_id, code, kind, employee_id, requested_by, timezone) values ('${req}', '${CO.uae}', 'UAE-R-90002', 'employee', '${E.alice}', '${U.deptHead}', 'Asia/Dubai');
        insert into inv_request_lines (id, request_id, company_id, item_id, qty) values ('${line}', '${req}', '${CO.uae}', '${itemLaptop}', 1);
        insert into inv_reservations (company_id, request_line_id, item_id, unit_id, qty, reserved_during, status, released_at, made_by)
          values ('${CO.uae}', '${line}', '${itemLaptop}', '${unit}', 1, tstzrange(now() - interval '9 days', now() - interval '8 days'), 'completed', null, '${U.deptHead}');`);
      await reassign(U.op1, unit, "employee", E.bob, "Finished reservation does not block", "key-resv-000003");
    });
    it("stops at once when the caller's access is revoked mid-session, and when Inventory is switched off", async () => {
      const unit = await mkUnit({});
      await db.asUser(U.op1, async (query) => {
        await query("reset role");
        await query(`update inv_company_grants set revoked_at = now() where user_id = '${U.op1}'`);
        await query("set local role authenticated");
        await expect(query(reassignSql(unit, "employee", E.alice, "x", "key-revoke-00001"))).rejects.toThrow(/Only a founder or a warehouse operator/);
      });
      await db.asUser(U.founder, async (query) => {
        await query(`select inv_set_enabled('${CO.uae}', false)`);
        await expect(query(reassignSql(unit, "employee", E.alice, "x", "key-revoke-00002"))).rejects.toThrow(/switched off/);
      });
      expect((await admin<Row>(`select custody_kind from inv_units where id = '${unit}'`))[0].custody_kind).toBe("warehouse");
    });
    it("leaves the ledger consistent: one movement per change, immutable, and no HR row touched for an unlinked unit", async () => {
      const unit = await mkUnit({});
      const assetsBefore = await fingerprint(["assets", "asset_assignments"]);
      await reassign(U.op1, unit, "employee", E.alice, "x", "key-ledger-0001");
      expect(await fingerprint(["assets", "asset_assignments"])).toBe(assetsBefore);
      await expect(admin(`update inv_movements set reason = 'edited' where idempotency_key = 'key-ledger-0001'`)).rejects.toThrow(/never edited or deleted/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("legacy reconciliation: preview and import", () => {
    let assetsFp = "";
    let importResult: Row;
    let rows: { asset_id: string; item_id: string; location_id: string }[];

    beforeAll(async () => {
      A.a1 = await mkAsset("LAP-001", { status: "issued", purchase: "2025-01-15", value: 3500 });
      A.a2 = await mkAsset("LAP-002");
      A.a3 = await mkAsset("LAP-003", { status: "retired" });
      A.a4 = await mkAsset("LAP-004");
      A.a5 = await mkAsset("LAP-005", { status: "under_repair" });
      A.a6 = await mkAsset("LAP-006", { status: "issued" });
      A.a7 = await mkAsset("LAP-007", { deleted: true });
      A.k1 = await mkAsset("KSA-001", { company: CO.ksa });
      await assign(A.a1, E.alice, "2026-02-01");
      await assign(A.a4, E.bob, "2025-03-01", "2025-09-01");
      await assign(A.a6, E.dora, "2026-01-01");
      await assign(A.a6, E.bob, "2026-03-01");
    });

    it("previews every live asset of the company with its open assignment and link state, and nothing else", async () => {
      const prev = await q<Row>(U.founder, `select * from inv_preview_legacy_assets('${CO.uae}')`);
      expect(prev.map((r) => r.asset_tag)).toEqual(["LAP-001", "LAP-002", "LAP-003", "LAP-004", "LAP-005", "LAP-006"]);
      expect(keys(prev[0])).toEqual(["already_linked", "asset_id", "asset_tag", "category", "description", "employee_active", "employee_id", "employee_name",
        "employee_number", "issued_date", "open_assignment_count", "purchase_date", "status", "unit_code", "unit_id", "value"]);
      const get = (t: string) => prev.find((r) => r.asset_tag === t)!;
      expect(get("LAP-001")).toMatchObject({ employee_id: E.alice, employee_name: "Alice Anders", employee_number: "AE-001", employee_active: true, already_linked: false, open_assignment_count: 1, status: "issued" });
      expect(Number(get("LAP-001").value)).toBe(3500);
      expect(get("LAP-002")).toMatchObject({ employee_id: null, open_assignment_count: 0, already_linked: false });
      expect(get("LAP-004")).toMatchObject({ employee_id: null, open_assignment_count: 0 });
      expect(get("LAP-006")).toMatchObject({ employee_id: E.bob, open_assignment_count: 2 });
      expect(JSON.stringify(prev)).not.toMatch(/private@|KSA-001|98765\./);
    });
    it("is for the company's Inventory founders only", async () => {
      for (const u of [U.op1, U.opCross, U.hrCust, U.basic, U.viewStock, U.costReader, U.hrAdmin, U.sales, U.projects, U.outsider, U.ksaFounder]) {
        await fails(u, `select * from inv_preview_legacy_assets('${CO.uae}')`, /Only an Inventory founder|permission denied/i);
      }
      await fails(null, `select * from inv_preview_legacy_assets('${CO.uae}')`, /permission denied/i);
      expect((await q<Row>(U.ksaFounder, `select asset_tag from inv_preview_legacy_assets('${CO.ksa}')`)).map((r) => r.asset_tag)).toEqual(["KSA-001"]);
    });
    it("is read only: previewing changes nothing", async () => {
      const before = await fingerprint(["assets", "asset_assignments", "inv_units", "inv_costs", "inv_movements"]);
      await q(U.founder, `select * from inv_preview_legacy_assets('${CO.uae}')`);
      expect(await fingerprint(["assets", "asset_assignments", "inv_units", "inv_costs", "inv_movements"])).toBe(before);
    });
    it("refuses a non-founder, another company's founder, bad input and a switched-off company", async () => {
      const ok = [{ asset_id: A.a2, item_id: itemLaptop, location_id: locA }];
      const call = (rowsArg: unknown) => `select inv_import_legacy_assets('${CO.uae}', '${JSON.stringify(rowsArg)}'::jsonb)`;
      for (const u of [U.op1, U.opCross, U.hrCust, U.costReader, U.hrAdmin, U.sales, U.outsider, U.ksaFounder]) await fails(u, call(ok), /Only an Inventory founder|permission denied/i);
      await fails(U.founder, call([]), /at least one asset/);
      await fails(U.founder, call({}), /at least one asset/);
      await fails(U.founder, call([{ asset_id: A.a2 }]), /asset_id, an item_id and a location_id/);
      await fails(U.founder, call([{ asset_id: "nope", item_id: itemLaptop, location_id: locA }]), /asset_id, an item_id and a location_id/);
      await fails(U.founder, call(Array.from({ length: 501 }, () => ok[0])), /at most 500/);
      await db.asUser(U.founder, async (query) => {
        await query(`select inv_set_enabled('${CO.uae}', false)`);
        await expect(query(call(ok))).rejects.toThrow(/switched off/);
      });
      expect(Number((await admin<{ n: string }>("select count(*) n from inv_units where legacy_asset_id is not null"))[0].n)).toBe(0);
    });

    it("imports the chosen assets as draft units, never guessing, and reports every skipped row with a reason", async () => {
      assetsFp = await fingerprint(["assets", "asset_assignments"]);
      rows = [
        { asset_id!: A.a1, item_id: itemLaptop, location_id: locA },
        { asset_id!: A.a2, item_id: itemLaptop, location_id: locB },
        { asset_id!: A.a3, item_id: itemLaptop, location_id: locA },       // retired
        { asset_id!: A.a4, item_id: itemKsa, location_id: locA },          // other company's item
        { asset_id!: A.a5, item_id: itemCable, location_id: locA },        // quantity item
        { asset_id!: A.a6, item_id: itemLaptop, location_id: locOff },     // inactive location
        { asset_id!: A.a2, item_id: itemLaptop, location_id: locA },       // same asset twice
        { asset_id!: A.k1, item_id: itemLaptop, location_id: locA },       // other company's asset
        { asset_id!: A.a7, item_id: itemLaptop, location_id: locA },       // deleted asset
        { asset_id: id(), item_id: itemLaptop, location_id: locA },       // unknown asset
      ];
      importResult = (await commit<{ r: Row }>(U.founder, `select inv_import_legacy_assets('${CO.uae}', '${JSON.stringify(rows)}'::jsonb) as r`))[0].r;
      expect(importResult.created).toBe(2);
      expect(importResult.skipped).toBe(8);
      const reasons = (importResult.results as Row[]).map((x) => x.reason ?? x.outcome);
      expect(reasons).toEqual(["created", "created", "retired_asset", "item_not_usable", "item_not_usable", "location_not_usable", "duplicate_in_request",
        "asset_not_found", "asset_not_found", "asset_not_found"]);
      const units = await admin<Row>(`select u.*, a.asset_tag from inv_units u join assets a on a.id = u.legacy_asset_id order by a.asset_tag`);
      expect(units).toHaveLength(2);
      const [u1, u2] = units;
      expect(u1).toMatchObject({ asset_tag: "LAP-001", lifecycle: "draft", serial_number: null, company_id: CO.uae, item_id: itemLaptop, custody_kind: "employee",
        employee_id: E.alice, location_id: locA, condition: "good", ownership: "owned", verified_at: null, created_by: U.founder });
      expect(u1.notes).toContain("LAP-001");
      expect(u1.code).toMatch(/^UAE-E-\d{5}$/);
      expect(u2).toMatchObject({ asset_tag: "LAP-002", lifecycle: "draft", serial_number: null, custody_kind: "warehouse", employee_id: null, location_id: locB });
      expect((importResult.results as Row[])[0]).toMatchObject({ asset_id: A.a1, unit_id: u1.id, unit_code: u1.code });
    });
    it("never changes the HR register itself", async () => {
      expect(await fingerprint(["assets", "asset_assignments"])).toBe(assetsFp);
    });
    it("copies cost data only into inv_costs, and only a cost reader (founders hold it) can see it", async () => {
      const costs = await admin<Row>(`select c.*, a.asset_tag from inv_costs c join inv_units u on u.id = c.unit_id join assets a on a.id = u.legacy_asset_id`);
      expect(costs).toHaveLength(1);
      expect(costs[0]).toMatchObject({ asset_tag: "LAP-001", currency: "AED", entered_by: U.founder });
      expect(Number(costs[0].unit_cost)).toBe(3500);
      expect(new Date(costs[0].purchase_date).toISOString().slice(0, 10)).toBe("2025-01-15");
      for (const u of [U.op1, U.viewStock, U.hrCust, U.basic]) expect((await q<Row>(u, "select * from inv_costs")).length, String(u)).toBe(0);
      expect((await q<Row>(U.costReader, "select * from inv_costs")).length).toBeGreaterThan(0);
      // nothing about costs in the import result or in the unit rows other callers can read
      expect(JSON.stringify(importResult)).not.toMatch(/3500\.|"value"|cost|purchase/i);
      expect(JSON.stringify(await q<Row>(U.op1, "select * from inv_units where legacy_asset_id is not null"))).not.toMatch(/3500\.|2025-01-15/);
      expect(JSON.stringify(await q<Row>(U.hrCust, `select * from inv_employee_outstanding('${CO.uae}')`))).not.toMatch(/3500\.|2025-01-15/);
    });
    it("is idempotent: running it again creates nothing and reports every row as already linked", async () => {
      const unitsBefore = await fingerprint(["inv_units", "inv_costs"]);
      const again = (await commit<{ r: Row }>(U.founder, `select inv_import_legacy_assets('${CO.uae}', '${JSON.stringify(rows.slice(0, 2))}'::jsonb) as r`))[0].r;
      expect(again).toMatchObject({ created: 0, skipped: 2 });
      expect((again.results as Row[]).map((x) => x.reason)).toEqual(["already_linked", "already_linked"]);
      expect((again.results as Row[])[0].unit_code).toMatch(/^UAE-E-/);
      expect(await fingerprint(["inv_units", "inv_costs"])).toBe(unitsBefore);
      expect(await fingerprint(["assets", "asset_assignments"])).toBe(assetsFp);
    });
    it("keeps one register: a second unit for the same asset is impossible, and the preview shows the link", async () => {
      await expect(mkUnit({ legacy: A.a1 })).rejects.toThrow(/duplicate key|unique/i);
      const prev = await q<Row>(U.founder, `select * from inv_preview_legacy_assets('${CO.uae}')`);
      expect(prev.filter((r) => r.already_linked).map((r) => r.asset_tag)).toEqual(["LAP-001", "LAP-002"]);
      expect(prev.filter((r) => r.already_linked).every((r) => r.unit_id && /^UAE-E-/.test(r.unit_code))).toBe(true);
    });
    it("the imported employee custody shows in HR's outstanding view and in the employee's own list, issued date from the HR assignment", async () => {
      const mine = (await q<Row>(U.alice, "select * from inv_my_equipment()")).filter((r) => r.lifecycle === "draft");
      expect(mine).toHaveLength(1);
      expect(ymd(new Date(mine[0]!.issued_at))).toBe("2026-02-01");
      expect(mine[0]!.code).toMatch(/^UAE-E-/);
      const hr = (await q<Row>(U.hrCust, `select * from inv_employee_outstanding('${CO.uae}', '${E.alice}')`)).filter((r) => r.lifecycle === "draft");
      expect(hr).toHaveLength(1);
      expect(hr[0]).toMatchObject({ unit_id: mine[0]!.unit_id, is_active: true });
    });
    it("imports the next batch alongside: assets with problems can be fixed and imported later without touching the first ones", async () => {
      const r = (await commit<{ r: Row }>(U.founder, `select inv_import_legacy_assets('${CO.uae}', '${JSON.stringify([
        { asset_id: A.a5, item_id: itemLaptop, location_id: locA }, { asset_id: A.a6, item_id: itemLaptop, location_id: locA }, { asset_id: A.a1, item_id: itemLaptop, location_id: locA }])}'::jsonb) as r`))[0].r;
      expect(r).toMatchObject({ created: 2, skipped: 1 });
      const u5 = (await admin<Row>(`select condition, custody_kind, employee_id, notes from inv_units where legacy_asset_id = '${A.a5}'`))[0];
      expect(u5).toMatchObject({ condition: "needs_inspection", custody_kind: "warehouse", employee_id: null });
      const u6 = (await admin<Row>(`select custody_kind, employee_id, notes from inv_units where legacy_asset_id = '${A.a6}'`))[0];
      expect(u6).toMatchObject({ custody_kind: "employee", employee_id: E.bob });
      expect(u6.notes).toMatch(/2 open assignments/);
      expect(await fingerprint(["assets", "asset_assignments"])).toBe(assetsFp);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("inv_mirror_legacy keeps the HR register in step", () => {
    let asset = "", unit = "";
    beforeAll(async () => {
      asset = await mkAsset("MIR-001");
      unit = await mkUnit({ legacy: asset });
    });
    const setCustody = (u: string, sql: string) => admin(`update inv_units set ${sql} where id = '${u}'`);

    it("does nothing for a unit that is not linked, and for an unknown unit", async () => {
      const plain = await mkUnit({ custody: "employee", employee: E.alice });
      const before = await fingerprint(["assets", "asset_assignments"]);
      await mirror(plain);
      await mirror(id());
      expect(await fingerprint(["assets", "asset_assignments"])).toBe(before);
    });
    it("issuing to an employee creates exactly one open assignment, dated from the latest movement, and marks the asset issued", async () => {
      const mv = id();
      await admin(`
        insert into inv_movements (id, company_id, code, kind, occurred_at, performed_by, recipient_employee_id, employee_id) values ('${mv}', '${CO.uae}', 'UAE-M-90101', 'issue_employee', '2026-03-05T10:00:00Z', '${U.op1}', '${E.dora}', '${E.dora}');
        insert into inv_movement_lines (movement_id, company_id, item_id, unit_id, qty, from_kind, to_kind, from_location_id, to_employee_id) values ('${mv}', '${CO.uae}', '${itemLaptop}', '${unit}', 1, 'warehouse', 'employee', '${locA}', '${E.dora}');`);
      await setCustody(unit, `custody_kind = 'employee', employee_id = '${E.dora}'`);
      await mirror(unit);
      let open = await openRows(asset);
      expect(open).toHaveLength(1);
      expect(open[0].employee_id).toBe(E.dora);
      expect(ymd(open[0].issued_date)).toBe("2026-03-05");
      expect(await assetStatus(asset)).toBe("issued");
      const row = (await admin<Row>(`select issued_by, condition_on_issue from asset_assignments where asset_id = '${asset}'`))[0];
      expect(row).toMatchObject({ issued_by: U.op1, condition_on_issue: "good" });
      // running it again changes nothing
      await mirror(unit);
      open = await openRows(asset);
      expect(open).toHaveLength(1);
      expect(Number((await admin<{ n: string }>(`select count(*) n from asset_assignments where asset_id = '${asset}'`))[0].n)).toBe(1);
    });
    it("a different employee closes the earlier open row with the movement's date and opens exactly one for the new holder", async () => {
      const mv = id();
      await admin(`
        insert into inv_movements (id, company_id, code, kind, occurred_at, performed_by, recipient_employee_id, employee_id, reason) values ('${mv}', '${CO.uae}', 'UAE-M-90102', 'reassign_employee', '2026-04-01T09:00:00Z', '${U.op1}', '${E.bob}', '${E.bob}', 'moved');
        insert into inv_movement_lines (movement_id, company_id, item_id, unit_id, qty, from_kind, to_kind, from_employee_id, to_employee_id) values ('${mv}', '${CO.uae}', '${itemLaptop}', '${unit}', 1, 'employee', 'employee', '${E.dora}', '${E.bob}');`);
      await setCustody(unit, `employee_id = '${E.bob}'`);
      await mirror(unit);
      const open = await openRows(asset);
      expect(open.map((r) => r.employee_id)).toEqual([E.bob]);
      const closed = await admin<Row>(`select employee_id, returned_date, issued_date from asset_assignments where asset_id = '${asset}' and returned_date is not null`);
      expect(closed).toHaveLength(1);
      expect(closed[0].employee_id).toBe(E.dora);
      expect(ymd(closed[0].returned_date)).toBe("2026-04-01");
      expect(await assetStatus(asset)).toBe("issued");
    });
    it("repairs a duplicate open row for the same employee instead of adding another", async () => {
      await admin(`do $$ begin perform set_config('inv.mirror', 'on', true); insert into asset_assignments (asset_id, employee_id, issued_date, issued_by) values ('${asset}', '${E.bob}', current_date, '${U.hrAdmin}'); end $$`);
      expect((await openRows(asset)).length).toBe(2);
      await mirror(unit);
      expect((await openRows(asset)).map((r) => r.employee_id)).toEqual([E.bob]);
    });
    it("back at the warehouse closes the open row and sets in_stock; repair sets under_repair; retired sets retired", async () => {
      await setCustody(unit, `custody_kind = 'warehouse', employee_id = null`);
      await mirror(unit);
      expect(await openRows(asset)).toHaveLength(0);
      expect(await assetStatus(asset)).toBe("in_stock");
      expect(Number((await admin<{ n: string }>(`select count(*) n from asset_assignments where asset_id = '${asset}' and employee_id = '${E.bob}' and condition_on_return = 'good'`))[0].n)).toBeGreaterThanOrEqual(1);
      await setCustody(unit, `custody_kind = 'repair', repair_reference = 'RMA-77'`);
      await mirror(unit);
      expect(await assetStatus(asset)).toBe("under_repair");
      expect(await openRows(asset)).toHaveLength(0);
      await setCustody(unit, `custody_kind = 'employee', employee_id = '${E.alice}', repair_reference = null`);
      await mirror(unit);
      expect(await assetStatus(asset)).toBe("issued");
      expect((await openRows(asset)).map((r) => r.employee_id)).toEqual([E.alice]);
      await setCustody(unit, `lifecycle = 'retired', retired_at = now()`);
      await mirror(unit);
      expect(await assetStatus(asset)).toBe("retired");
      expect(await openRows(asset)).toHaveLength(0);
      // history of every holder stays in asset_assignments
      expect(Number((await admin<{ n: string }>(`select count(*) n from asset_assignments where asset_id = '${asset}'`))[0].n)).toBeGreaterThanOrEqual(4);
    });
    it("leaves the HR register alone for a missing unit (the register has no such state)", async () => {
      const a = await mkAsset("MIR-002", { status: "in_stock" });
      const u = await mkUnit({ legacy: a, lifecycle: "missing" });
      await mirror(u);
      expect(await assetStatus(a)).toBe("in_stock");
    });
    it("switches the flag back off afterwards, so the same transaction cannot edit linked assets directly", async () => {
      const a = await mkAsset("MIR-003");
      const u = await mkUnit({ legacy: a });
      await admin(`do $$ begin perform inv_mirror_legacy('${u}'); if coalesce(current_setting('inv.mirror', true), '') = 'on' then raise exception 'flag left on'; end if; end $$`);
      await expect(admin(`select inv_mirror_legacy('${u}'); update assets set status = 'issued' where id = '${a}'`)).rejects.toThrow(MANAGED_MSG);
    });
    it("works end to end through inv_reassign_unit: assign, move to another employee, back to the pool", async () => {
      const a = await mkAsset("MIR-004");
      const u = await mkUnit({ legacy: a });
      await reassign(U.op1, u, "employee", E.alice, "Issued", "key-mirror-0001");
      expect((await openRows(a)).map((r) => r.employee_id)).toEqual([E.alice]);
      expect(await assetStatus(a)).toBe("issued");
      await reassign(U.op1, u, "employee", E.bob, "Handed over", "key-mirror-0002");
      expect((await openRows(a)).map((r) => r.employee_id)).toEqual([E.bob]);
      await reassign(U.op1, u, "pool", null, "Returned", "key-mirror-0003");
      expect(await openRows(a)).toHaveLength(0);
      expect(await assetStatus(a)).toBe("in_stock");
      // a retry changes nothing in the register either
      const before = await fingerprint(["assets", "asset_assignments"]);
      await reassign(U.op1, u, "pool", null, "Returned", "key-mirror-0003");
      expect(await fingerprint(["assets", "asset_assignments"])).toBe(before);
      const counts = await admin<{ n: string }>(`select count(*) n from asset_assignments where asset_id = '${a}'`);
      expect(Number(counts[0].n)).toBe(2);
      // HR's own view of Bob's page: the earlier assignment rows are still readable by HR
      expect((await q<Row>(U.hrAdmin, `select employee_id from asset_assignments where asset_id = '${a}'`)).length).toBe(2);
    });
    it("a linked unit that is reassigned shows the new holder to the HR asset page and to the employee", async () => {
      const a = await mkAsset("MIR-005");
      const u = await mkUnit({ legacy: a });
      await reassign(U.founder, u, "employee", E.alice, "Issued", "key-mirror-0010");
      const hr = await q<Row>(U.hrAdmin, `select employee_id from asset_assignments where asset_id = '${a}' and returned_date is null`);
      expect(hr.map((r) => r.employee_id)).toEqual([E.alice]);
      expect((await q<Row>(U.alice, `select id from assets where id = '${a}'`)).length).toBe(1);   // the existing "what is issued to me" policy still works
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("no other HR table changes", () => {
    it("leaves employees (including the reporting line), departments, roles, contracts, pay, attendance, leave, payroll and documents untouched after lookup, outstanding, reassignment, import and mirror", async () => {
      expect(await fingerprint(HR_TABLES)).toBe(hrBefore);
    });
    it("keeps the reporting line as it was", async () => {
      const mgr = await admin<Row>(`select id, manager_id from employees where manager_id is not null order by id`);
      expect(mgr.map((r) => r.manager_id)).toEqual([E.mona, E.mona]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("guard triggers on the HR register", () => {
    let linked = "", linkedUnit = "", linkedAssignment = "";
    beforeAll(async () => {
      linked = await mkAsset("GRD-001");
      linkedUnit = await mkUnit({ legacy: linked });
      await reassign(U.op1, linkedUnit, "employee", E.alice, "Issued", "key-guard-00001");
      linkedAssignment = (await admin<{ id: string }>(`select id from asset_assignments where asset_id = '${linked}' and returned_date is null`))[0].id;
    });
    const hr = (sql: string) => q(U.hrAdmin, sql);

    it("refuses direct HR edits of a linked asset in plain words (status, tag, soft delete, hard delete)", async () => {
      await expect(hr(`update assets set status = 'retired' where id = '${linked}'`)).rejects.toThrow(MANAGED_MSG);
      await expect(hr(`update assets set asset_tag = 'NEW-TAG' where id = '${linked}'`)).rejects.toThrow(MANAGED_MSG);
      await expect(hr(`update assets set deleted_at = now() where id = '${linked}'`)).rejects.toThrow(MANAGED_MSG);
      await expect(hr(`delete from assets where id = '${linked}'`)).rejects.toThrow(MANAGED_MSG);
      expect(await assetStatus(linked)).toBe("issued");
    });
    it("refuses direct HR edits of the assignments of a linked asset (insert, return, change, delete)", async () => {
      await expect(hr(`insert into asset_assignments (asset_id, employee_id, issued_by) values ('${linked}', '${E.bob}', '${U.hrAdmin}')`)).rejects.toThrow(MANAGED_MSG);
      await expect(hr(`update asset_assignments set returned_date = current_date where id = '${linkedAssignment}'`)).rejects.toThrow(MANAGED_MSG);
      await expect(hr(`update asset_assignments set employee_id = '${E.bob}' where id = '${linkedAssignment}'`)).rejects.toThrow(MANAGED_MSG);
      await expect(hr(`delete from asset_assignments where id = '${linkedAssignment}'`)).rejects.toThrow(MANAGED_MSG);
      expect((await openRows(linked)).map((r) => r.employee_id)).toEqual([E.alice]);
    });
    it("refuses moving an unlinked asset's assignment onto a linked asset", async () => {
      const free = await mkAsset("GRD-002");
      await assign(free, E.bob, "2026-01-01");
      const id1 = (await admin<{ id: string }>(`select id from asset_assignments where asset_id = '${free}'`))[0].id;
      await expect(hr(`update asset_assignments set asset_id = '${linked}' where id = '${id1}'`)).rejects.toThrow(MANAGED_MSG);
    });
    it("cannot be switched off by a signed-in user setting the flag themselves", async () => {
      await expect(db.asUser(U.hrAdmin, async (query) => {
        await query(`select set_config('inv.mirror', 'on', true)`);
        await query(`update assets set status = 'retired' where id = '${linked}'`);
      })).rejects.toThrow(MANAGED_MSG);
      await expect(db.asUser(U.hrAdmin, async (query) => {
        await query(`select set_config('inv.mirror', 'on', true)`);
        await query(`delete from asset_assignments where id = '${linkedAssignment}'`);
      })).rejects.toThrow(MANAGED_MSG);
    });
    it("refuses even a direct database edit that does not come from the Inventory mirror, and allows one under the mirror flag", async () => {
      await expect(admin(`update assets set status = 'retired' where id = '${linked}'`)).rejects.toThrow(MANAGED_MSG);
      await admin(`select set_config('inv.mirror', 'on', true); update assets set description = 'fixed by mirror flag' where id = '${linked}'`);
      expect((await admin<Row>(`select description from assets where id = '${linked}'`))[0].description).toBe("fixed by mirror flag");
    });
    it("lets HR read linked assets and assignments exactly as before", async () => {
      expect((await hr(`select id from assets where id = '${linked}'`) as Row[]).length).toBe(1);
      expect((await q<Row>(U.hrAdmin, `select id from asset_assignments where asset_id = '${linked}'`)).length).toBeGreaterThan(0);
    });
    it("leaves assets that were never imported exactly as today: create, assign, return, retire all work", async () => {
      const aid = id();
      await db.asUser(U.hrAdmin, async (query) => {
        // createAsset
        await query(`insert into assets (id, company_id, asset_tag, category) values ('${aid}', '${CO.uae}', 'FREE-001', 'phone')`);
        // assignAsset: assignment row, then the asset's own status
        await query(`insert into asset_assignments (asset_id, employee_id, issued_date, condition_on_issue, issued_by) values ('${aid}', '${E.alice}', '2026-06-01', 'new', '${U.hrAdmin}')`);
        await query(`update assets set status = 'issued' where id = '${aid}'`);
        expect((await query(`select status from assets where id = '${aid}'`)).rows[0].status).toBe("issued");
        // returnAsset: close the assignment, then the status
        await query(`update asset_assignments set returned_date = '2026-07-01', condition_on_return = 'ok' where asset_id = '${aid}' and returned_date is null`);
        await query(`update assets set status = 'in_stock' where id = '${aid}'`);
        // retireAsset
        await query(`update assets set status = 'retired' where id = '${aid}'`);
        expect((await query(`select status from assets where id = '${aid}'`)).rows[0].status).toBe("retired");
        // editing the assignment row and deleting a closed assignment (permanently_delete_employee does this) are untouched too
        await query(`update asset_assignments set condition_on_return = 'fine' where asset_id = '${aid}'`);
        await query(`delete from asset_assignments where asset_id = '${aid}'`);
      });
    });
    it("an asset only becomes protected when a founder imports it; the very same HR edits work before", async () => {
      const a = await mkAsset("GRD-003");
      await db.asUser(U.hrAdmin, async (query) => { await query(`update assets set status = 'issued' where id = '${a}'`); });
      await commit(U.founder, `select inv_import_legacy_assets('${CO.uae}', '${JSON.stringify([{ asset_id: a, item_id: itemLaptop, location_id: locA }])}'::jsonb)`);
      await expect(hr(`update assets set status = 'in_stock' where id = '${a}'`)).rejects.toThrow(MANAGED_MSG);
    });
    it("still leaves every other HR table untouched after the guard scenarios", async () => {
      expect(await fingerprint(HR_TABLES)).toBe(hrBefore);
    });
    it("keeps permanently_delete_employee working for employees whose assets were never imported, and unchanged for the rest", async () => {
      const mk = async (n: string, deleted: boolean) => {
        const eid = id();
        await db.seed(`
          insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, deleted_at)
            values ('${eid}', 'PD-${n}', '${CO.uae}', 'AE', 'Purge', 'Me${n}', '2024-01-01', ${deleted ? "now()" : "null"});
          insert into employment_contracts (employee_id, contract_type, start_date, version_no, is_current, created_by) values ('${eid}', 'permanent', '2024-01-01', 1, true, '${U.hrAdmin}');
          insert into compensation_details (employee_id, effective_from, base_salary, currency, created_by) values ('${eid}', '2024-01-01', 5000, 'AED', '${U.hrAdmin}');`);
        return eid;
      };
      const empty = await mk("1", true);
      await db.asUserCommit(U.hrAdmin, (query) => query(`select permanently_delete_employee('${empty}')`));
      expect((await admin(`select 1 from employees where id = '${empty}'`)).length).toBe(0);
      // an employee with an assignment of an unlinked asset gets the same history message as before this migration
      const withUnlinked = await mk("2", true);
      const freeAsset = await mkAsset("PD-FREE");
      await assign(freeAsset, withUnlinked, "2026-01-01");
      await expect(q(U.hrAdmin, `select permanently_delete_employee('${withUnlinked}')`)).rejects.toThrow(/1 asset assignment\(s\)/);
      // an employee holding Inventory-managed equipment is protected the same way (the HR history check runs first)
      const withLinked = await mk("3", false);
      const linkedHere = await mkAsset("PD-LINKED");
      const lu = await mkUnit({ legacy: linkedHere });
      await reassign(U.op1, lu, "employee", withLinked, "Issued", "key-purge-00001");
      await admin(`update employees set deleted_at = now() where id = '${withLinked}'`);
      await expect(q(U.hrAdmin, `select permanently_delete_employee('${withLinked}')`)).rejects.toThrow(/1 asset assignment\(s\)/);
      // an employee who only appears in Inventory records cannot be erased either (foreign keys), and nothing is half-deleted
      const withInv = await mk("4", true);
      await mkUnit({ custody: "employee", employee: withInv });
      await expect(q(U.hrAdmin, `select permanently_delete_employee('${withInv}')`)).rejects.toThrow(/foreign key|violates/i);
      expect((await admin(`select 1 from employees where id in ('${withLinked}', '${withInv}')`)).length).toBe(2);
      expect((await admin(`select 1 from employment_contracts where employee_id = '${withInv}'`)).length).toBe(1);
    });
  });
});
