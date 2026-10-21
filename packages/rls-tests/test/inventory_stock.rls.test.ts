import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Inventory, migration 4 (stock core). Proves, against a real Postgres built from every migration:
//   * the four tracking methods, draft records that claim no stock, opening stock and existing assignments without double counting;
//   * every stock change is a function that writes the immutable ledger; no negative stock; precision per item; corrections keep the original;
//   * idempotent retries, the transaction-status lookup, and real parallel connections racing for the last quantity / unit;
//   * employee issue/return, project dispatch/return with partial returns, direct project-to-project transfer, warehouse transfer in three records;
//   * kits (no nesting, one kit per unit, missing/substituted recorded), consumables, repair, rentals, missing / found / retire;
//   * location, company and capability permissions, revoked access on the very next call, cost visibility, direct table writes denied;
//   * inv_ledger_problems() is empty after a long scenario (and does notice tampering), and no HR / CRM / Projects row changes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const FIRST_CRM_MIGRATION = "20261115000000_crm_access_audit_settings.sql";
const LATE_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f >= FIRST_CRM_MIGRATION && f.endsWith(".sql")).sort();

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = {
  founder: id(), ksaFounder: id(), opDubai: id(), opPoznan: id(), crossOp: id(), catalog: id(), costCatalog: id(), counter: id(), viewer: id(),
  accessMgr: id(), ksaOp: id(), pm: id(), pm2: id(), outsider: id(), employeeUser: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-test.ae')`).join(", ");
const DENIED = /permission denied|row-level security|not allowed|Only |not set up|do not have|cannot|authorise|You need|You are not|not signed in|Not signed in/i;

const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const fut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Inventory stock core", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string, params: unknown[] = []) => db.asUser(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const fails = (user: string | null, sql: string, re: RegExp = DENIED) => expect(q(user, sql)).rejects.toThrow(re);
  const key = () => `key-${id()}`;
  // call a function that returns jsonb and commit it
  const call = async <T = Row>(user: string, sql: string): Promise<T> => (await commit<{ r: T }>(user, `select ${sql} as r`))[0].r;
  const n = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0].n);

  const L: Record<string, string> = {};       // locations
  const IT: Record<string, string> = {};      // items
  const UN: Record<string, string> = {};      // units
  const EMP: Record<string, string> = {};     // employees
  const PRJ: Record<string, string> = {};     // projects
  let catRoot = "", catChild = "";
  let tableGrants: Row[] = [];
  let functionGrants: Row[] = [];
  let hrBefore = "", crmBefore = "", projBefore = "";

  const receive = (user: string, company: string, loc: string, lines: unknown[], rental: unknown = null, k = key()) =>
    call(user, `inv_receive_stock('${company}', '${loc}', '${k}', ${j(lines)}, ${rental ? j(rental) : "null"})`);
  const qtyOf = async (item: string, loc: string, cond = "good", holder = "warehouse") =>
    Number((await admin<{ s: string }>(`select coalesce(sum(qty), 0) s from inv_balances where item_id = '${item}' and holder_kind = '${holder}' and location_id ${holder === "warehouse" ? `= '${loc}'` : "is null"} and condition = '${cond}' and rental_id is null`))[0].s);
  const unit = async (u: string) => (await admin<Row>(`select * from inv_units where id = '${u}'`))[0];
  async function mkRequest(project: string, code: string, status = "submitted", from = 1, until = 20) {
    const [r] = await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone, needed_from, needed_until, expected_return_at)
      values ('${CO.uae}', '${code}', 'project', '${project}', '${U.pm}', '${status}', 'Asia/Dubai', now() + interval '${from} days', now() + interval '${until} days', now() + interval '${until} days') returning id`);
    return r.id;
  }
  async function mkLine(request: string, item: string, qty: number) {
    const [r] = await admin<{ id: string }>(`insert into inv_request_lines (request_id, company_id, item_id, qty) values ('${request}', '${CO.uae}', '${item}', ${qty}) returning id`);
    return r.id;
  }
  async function reserveUnit(request: string, item: string, unitId: string, fromDays: number, untilDays: number) {
    const line = await mkLine(request, item, 1);
    const [r] = await admin<{ id: string }>(`insert into inv_reservations (company_id, request_line_id, item_id, unit_id, qty, reserved_during, made_by)
      values ('${CO.uae}', '${line}', '${item}', '${unitId}', 1, tstzrange(now() + interval '${fromDays} days', now() + interval '${untilDays} days'), '${U.pm}') returning id`);
    return r.id;
  }
  async function reserveQty(request: string, item: string, loc: string, qty: number, fromDays: number, untilDays: number) {
    const line = await mkLine(request, item, qty);
    const [r] = await admin<{ id: string }>(`insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, reserved_during, made_by)
      values ('${CO.uae}', '${line}', '${item}', '${loc}', ${qty}, tstzrange(now() + interval '${fromDays} days', now() + interval '${untilDays} days'), '${U.pm}') returning id`);
    return r.id;
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
    tableGrants = await admin<Row>(`select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name like 'inv\\_%' and grantee in ('anon', 'authenticated', 'PUBLIC')`);
    functionGrants = await admin<Row>(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\\_%'`);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.uae}', '{}'), ('${U.pm2}', '${CO.uae}', '{}');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        (gen_random_uuid(), '${U.employeeUser}', 'E-001', '${CO.uae}', 'AE', 'Aisha', 'Khan', '2024-01-01'),
        (gen_random_uuid(), null, 'E-002', '${CO.uae}', 'AE', 'Omar', 'Said', '2024-01-01'),
        (gen_random_uuid(), null, 'E-003', '${CO.ksa}', 'SA', 'Fahad', 'Nasser', '2024-01-01');
      insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status, termination_date)
        values (gen_random_uuid(), 'E-004', '${CO.uae}', 'AE', 'Leila', 'Gone', '2020-01-01', 'terminated', '2025-01-01');
    `);
    for (const [k, num] of [["aisha", "E-001"], ["omar", "E-002"], ["fahad", "E-003"], ["gone", "E-004"]] as const) {
      EMP[k] = (await admin<{ id: string }>(`select id from employees where employee_number = '${num}'`))[0].id;
    }
    for (const [k, ref, status, co] of [["p1", "UAE-P-1", "in_progress", CO.uae], ["p2", "UAE-P-2", "in_progress", CO.uae], ["p3", "UAE-P-3", "in_progress", CO.uae],
      ["hold", "UAE-P-4", "on_hold", CO.uae], ["done", "UAE-P-5", "completed", CO.uae], ["ksa", "KSA-P-1", "in_progress", CO.ksa]] as const) {
      PRJ[k] = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by)
        values ('${co}', '${ref}', 'Project ${k}', 'internal', '${status}', '${U.pm}', '${U.pm}') returning id`))[0].id;
    }
    hrBefore = JSON.stringify(await admin(`select (select count(*) from employees) emps, (select md5(string_agg(row(e.id, e.company_id, e.employment_status, e.manager_id, e.first_name)::text, ',' order by e.id)) from employees e) fp,
       (select count(*) from user_roles) roles, (select count(*) from assets) assets, (select count(*) from asset_assignments) assignments`));
    crmBefore = JSON.stringify(await admin(`select (select count(*) from crm_opportunities) opps, (select count(*) from crm_handovers) hand`));
    projBefore = JSON.stringify(await admin(`select (select count(*) from proj_projects) n, (select md5(string_agg(row(p.id, p.status, p.pm_user_id, p.updated_at, p.version)::text, ',' order by p.id)) from proj_projects p) fp`));
  });

  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("installation and privileges", () => {
    it("seeds nothing: no location, category, item or unit exists until a founder creates it", async () => {
      for (const t of ["inv_locations", "inv_categories", "inv_items", "inv_units", "inv_balances", "inv_movements", "inv_company_sharing"]) {
        expect(await n(`select 1 from ${t}`), t).toBe(0);
      }
    });
    it("leaves anon with nothing and authenticated with SELECT only on every inv_ table (no DML), despite Supabase's broad defaults", async () => {
      expect(tableGrants.length).toBeGreaterThan(20);
      expect(tableGrants.filter((g) => g.grantee !== "authenticated")).toEqual([]);
      expect(tableGrants.filter((g) => g.privilege_type !== "SELECT")).toEqual([]);
      expect(tableGrants.find((g) => g.table_name === "inv_idempotency")).toBeUndefined();   // nobody reads the key table directly
      const policies = await admin<{ tablename: string }>(`select tablename from pg_policies where schemaname = 'public' and tablename like 'inv\\_%' and cmd <> 'SELECT'`);
      expect(policies).toHaveLength(0);
    });
    it("grants every client-facing function to signed-in users only, and keeps the internal helpers closed", async () => {
      const open = ["inv_save_location", "inv_save_bin", "inv_set_operator_locations", "inv_save_category", "inv_save_item", "inv_replace_item", "inv_set_company_sharing",
        "inv_register_unit", "inv_ensure_bin_label", "inv_record_label_print", "inv_start_count", "inv_save_count_line", "inv_confirm_count", "inv_cancel_count",
        "inv_confirm_opening_custody", "inv_receive_stock", "inv_issue_to_employee", "inv_return_from_employee", "inv_dispatch_to_project", "inv_return_from_project",
        "inv_transfer_between_projects", "inv_transfer_dispatch", "inv_transfer_receive", "inv_consume", "inv_return_unused", "inv_repair_out", "inv_repair_in",
        "inv_pack_kit", "inv_unpack_kit", "inv_set_kit_line", "inv_check_condition", "inv_adjust_stock", "inv_correct_movement", "inv_return_rental",
        "inv_transaction_status", "inv_ledger_problems"];
      for (const name of open) {
        const f = functionGrants.find((x) => x.proname === name);
        expect(f, name).toBeDefined();
        expect([name, f?.anon, f?.auth]).toEqual([name, false, true]);
      }
      const closed = ["inv_ctx", "inv_loc", "inv_check_sharing", "inv_bal_ensure", "inv_bal_change", "inv_take_qty", "inv_ml", "inv_unit_move", "inv_idem_begin",
        "inv_begin_movement", "inv_finish_movement", "inv_reservation_take", "inv_reservation_return", "inv_lock_item", "inv_next_code", "inv_mirror_legacy"];
      for (const name of closed) {
        const f = functionGrants.find((x) => x.proname === name);
        expect(f, name).toBeDefined();
        expect([name, f?.anon, f?.auth]).toEqual([name, false, false]);
      }
    });
    it("denies anonymous callers every table and function", async () => {
      await expect(q(null, "select 1 from inv_units")).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select inv_ledger_problems()`)).rejects.toThrow(/permission denied/i);
      await expect(q(null, `select inv_transaction_status('${CO.uae}', 'whatever-key-1')`)).rejects.toThrow(/permission denied/i);
    });
    it("refuses every direct write to every inv_ table, even where the harness grants DML", async () => {
      const tables = (await admin<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'inv\\_%'`)).map((r) => r.relname);
      expect(tables.length).toBeGreaterThan(25);
      for (const t of tables) {
        const del = await db.asUser(U.founder, async (query) => { try { return (await query(`delete from ${t}`)).rowCount; } catch (e) { return (e as Error).message; } });
        expect(del === 0 || (typeof del === "string" && DENIED.test(del)), `${t}: ${String(del)}`).toBe(true);
        const col = (await admin<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = '${t}' order by ordinal_position limit 1`))[0].column_name;
        const upd = await db.asUser(U.founder, async (query) => { try { return (await query(`update ${t} set ${col} = ${col}`)).rowCount; } catch (e) { return (e as Error).message; } });
        expect(upd === 0 || (typeof upd === "string" && DENIED.test(upd)), `${t}: ${String(upd)}`).toBe(true);
        const ins = await db.asUser(U.founder, async (query) => { try { return (await query(`insert into ${t} select * from ${t} where false`)).rowCount; } catch (e) { return (e as Error).message; } });
        expect(ins === 0 || (typeof ins === "string" && DENIED.test(ins)), `${t}: ${String(ins)}`).toBe(true);
      }
    });
    it("enables row-level security on every inv_ table", async () => {
      const rows = await admin<{ relname: string }>(`select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'inv\\_%' and not c.relrowsecurity`);
      expect(rows.map((r) => r.relname)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("configuration: codes, access, locations, categories, items", () => {
    it("lets a founder set the company codes, and gives access with the capabilities each role needs", async () => {
      await commit(U.founder, `select inv_set_company_code('${CO.uae}', 'UAE')`);
      await commit(U.ksaFounder, `select inv_set_company_code('${CO.ksa}', 'KSA')`);
      const grants: [string, string, string[]][] = [
        [U.opDubai, CO.uae, ["warehouse"]], [U.opPoznan, CO.uae, ["warehouse"]], [U.crossOp, CO.uae, ["warehouse", "cross_location"]],
        [U.catalog, CO.uae, ["manage_catalogue"]], [U.costCatalog, CO.uae, ["manage_catalogue", "view_costs"]], [U.counter, CO.uae, ["confirm_stock"]],
        [U.viewer, CO.uae, ["view_stock"]], [U.accessMgr, CO.uae, ["manage_access"]],
      ];
      for (const [who, co, caps] of grants) await commit(U.founder, `select inv_grant_access('${who}', '${co}', '{${caps.join(",")}}'::text[])`);
      await commit(U.ksaFounder, `select inv_grant_access('${U.ksaOp}', '${CO.ksa}', '{warehouse}'::text[])`);
      expect(await n(`select 1 from inv_company_settings`)).toBe(2);
    });
    it("lets only a founder create locations, with an IANA time zone each (Dubai, Poznan and Riyadh exist only because a founder saved them)", async () => {
      await fails(U.catalog, `select inv_save_location('${CO.uae}', null, 'DXB', 'Dubai', 'Asia/Dubai')`, /Only an Inventory founder/);
      await fails(U.opDubai, `select inv_save_location('${CO.uae}', null, 'DXB', 'Dubai', 'Asia/Dubai')`, /Only an Inventory founder/);
      await fails(U.ksaFounder, `select inv_save_location('${CO.uae}', null, 'DXB', 'Dubai', 'Asia/Dubai')`);
      await fails(U.founder, `select inv_save_location('${CO.uae}', null, 'DXB', 'Dubai', 'Not/AZone')`, /not a time zone/);
      await fails(U.founder, `select inv_save_location('${CO.uae}', null, 'd', 'Dubai', 'Asia/Dubai')`, /2 to 8 capital letters/);
      L.dubai = (await call<string>(U.founder, `inv_save_location('${CO.uae}', null, 'DXB', 'Dubai warehouse', 'Asia/Dubai')`));
      L.poznan = (await call<string>(U.founder, `inv_save_location('${CO.uae}', null, 'POZ', 'Poznan warehouse', 'Europe/Warsaw')`));
      L.riyadh = (await call<string>(U.ksaFounder, `inv_save_location('${CO.ksa}', null, 'RUH', 'Riyadh warehouse', 'Asia/Riyadh')`));
      const rows = await q<Row>(U.founder, `select code, timezone from inv_locations order by code`);
      expect(rows.map((r) => [r.code, r.timezone])).toEqual([["DXB", "Asia/Dubai"], ["POZ", "Europe/Warsaw"]]);
      await fails(U.founder, `select inv_save_location('${CO.uae}', null, 'DXB', 'Another', 'Asia/Dubai')`, /already exists/);
    });
    it("lets a catalogue manager create bins, and refuses everyone else", async () => {
      L.binA1 = await call<string>(U.catalog, `inv_save_bin('${L.dubai}', null, 'A1')`);
      L.binB2 = await call<string>(U.catalog, `inv_save_bin('${L.dubai}', null, 'B2')`);
      L.binP1 = await call<string>(U.catalog, `inv_save_bin('${L.poznan}', null, 'P1')`);
      await fails(U.opDubai, `select inv_save_bin('${L.dubai}', null, 'C3')`, /catalogue rights/);
      await fails(U.catalog, `select inv_save_bin('${L.dubai}', null, 'a1')`, /already has a bin/);
    });
    it("assigns warehouse operators to locations; only access managers and founders may", async () => {
      await fails(U.opDubai, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.dubai}}')`, /Only a founder/);
      await fails(U.catalog, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.dubai}}')`, /Only a founder/);
      await commit(U.accessMgr, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.dubai}}')`);
      await commit(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.opPoznan}', '{${L.poznan}}')`);
      await fails(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.outsider}', '{${L.dubai}}')`, /no Inventory access/);
      await fails(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.riyadh}}')`, /Unknown location/);
      await commit(U.ksaFounder, `select inv_set_operator_locations('${CO.ksa}', '${U.ksaOp}', '{${L.riyadh}}')`);
    });
    it("keeps categories as data (any name, nested), refuses duplicates and loops", async () => {
      catRoot = await call<string>(U.catalog, `inv_save_category('${CO.uae}', null, 'Lighting')`);
      catChild = await call<string>(U.catalog, `inv_save_category('${CO.uae}', null, 'LED panels', '${catRoot}')`);
      await call<string>(U.catalog, `inv_save_category('${CO.uae}', null, 'Cabling')`);
      await fails(U.catalog, `select inv_save_category('${CO.uae}', null, 'lighting')`, /already exists/);
      await fails(U.catalog, `select inv_save_category('${CO.uae}', '${catRoot}', 'Lighting', '${catChild}')`, /under itself/);
      await fails(U.opDubai, `select inv_save_category('${CO.uae}', null, 'Audio')`, /catalogue rights/);
      expect(await n(`select 1 from inv_categories`)).toBe(3);
    });
    it("creates items for all four tracking methods (drafts by default), refuses nonsense, and keeps whole-number units", async () => {
      const mk = async (key2: string, f: Record<string, unknown>) => { IT[key2] = await call<string>(U.catalog, `inv_save_item('${CO.uae}', null, ${j({ status: "active", ...f })})`); };
      await mk("led", { name: "LED panel P2.5", tracking: "individual", model: "P2.5", category_id: catChild });
      await mk("cable", { name: "HDMI cable", specification: "5 m", tracking: "quantity" });
      await mk("rope", { name: "Rigging rope", tracking: "quantity", unit_of_measure: "m", quantity_scale: 3 });
      await mk("tape", { name: "Gaffer tape", tracking: "consumable" });
      await mk("case", { name: "Flight case A", tracking: "kit" });
      await mk("adapter", { name: "Power adapter", model: "A", tracking: "individual" });
      await mk("adapterB", { name: "Power adapter", model: "B", tracking: "individual" });
      await mk("screws", { name: "Case screws", tracking: "quantity" });
      await mk("shackle", { name: "Shackle 5t", tracking: "quantity" });
      await mk("extra", { name: "Spare lens", tracking: "individual" });
      IT.draft = await call<string>(U.catalog, `inv_save_item('${CO.uae}', null, ${j({ name: "Draft thing", tracking: "quantity" })})`);
      expect((await admin<Row>(`select status from inv_items where id = '${IT.draft}'`))[0].status).toBe("draft");
      IT.ksaTruss = await call<string>(U.ksaFounder, `inv_save_item('${CO.ksa}', null, ${j({ name: "Truss 3m", tracking: "individual", status: "active" })})`);
      await fails(U.catalog, `select inv_save_item('${CO.uae}', null, ${j({ name: "HDMI cable", specification: "5 m", tracking: "quantity" })})`, /already exists/);
      await fails(U.catalog, `select inv_save_item('${CO.uae}', null, ${j({ name: "Odd", tracking: "individual", quantity_scale: 2 })})`, /whole numbers/);
      await fails(U.catalog, `select inv_save_item('${CO.uae}', null, ${j({ name: "Odd", tracking: "bulk" })})`, /how this item is tracked/);
      await fails(U.opDubai, `select inv_save_item('${CO.uae}', null, ${j({ name: "Odd", tracking: "quantity" })})`, /catalogue rights/);
      await fails(U.ksaFounder, `select inv_save_item('${CO.uae}', null, ${j({ name: "Odd", tracking: "quantity" })})`);
      // two different models of the same name are two items
      expect(IT.adapter).not.toBe(IT.adapterB);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("draft records, opening stock and existing assignments", () => {
    let count1 = "";
    const reg = (user: string, item: string, serial: string | null, loc: string | null, extra = "") =>
      call<Row>(user, `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${item}', p_serial_number => ${serial ? `'${serial}'` : "null"}, p_location_id => ${loc ? `'${loc}'` : "null"}${extra})`);

    it("registers units as DRAFTS: catalogued, with unique codes, claiming no verified stock and not usable", async () => {
      for (const k of ["led1", "led2", "led3", "led4", "led5"]) {
        const r = await reg(U.opDubai, IT.led, `SN-${k}`, L.dubai, `, p_bin_id => '${L.binA1}'`);
        UN[k] = r.unit_id;
        expect(r).toMatchObject({ lifecycle: "draft", custody_kind: "warehouse" });
      }
      const rows = await admin<Row>(`select code, lifecycle, verified_at, inv_unit_usable(u) usable from inv_units u order by code`);
      expect(rows).toHaveLength(5);
      expect(new Set(rows.map((r) => r.code)).size).toBe(5);
      for (const r of rows) {
        expect(r.code).toMatch(/^UAE-E-\d{5}$/);
        expect([r.lifecycle, r.verified_at, r.usable]).toEqual(["draft", null, false]);
      }
    });
    it("refuses a repeated serial number for the same item (same code is never issued twice)", async () => {
      await expect(reg(U.opDubai, IT.led, "sn-LED1", L.dubai)).rejects.toThrow(/Serial number sn-LED1 is already registered as UAE-E-\d{5}/);
      await expect(reg(U.opDubai, IT.led, " SN-led2 ", L.dubai)).rejects.toThrow(/already registered/);
      await expect(reg(U.opDubai, IT.cable, null, L.dubai)).rejects.toThrow(/tracked by quantity/);
      expect(await n(`select 1 from inv_units`)).toBe(5);
    });
    it("takes a cost only from someone allowed to see costs, and keeps costs out of everyone else's sight", async () => {
      await expect(reg(U.opDubai, IT.led, "SN-led6", L.dubai, `, p_cost => ${j({ unit_cost: 1200, currency: "AED", purchase_date: "2026-01-05" })}`)).rejects.toThrow(/may see costs/);
      const r = await reg(U.costCatalog, IT.led, "SN-led6", L.dubai, `, p_cost => ${j({ unit_cost: 1200, currency: "AED", purchase_date: "2026-01-05" })}`);
      UN.led6 = r.unit_id;
      expect(await q(U.costCatalog, `select unit_cost from inv_costs where unit_id = '${UN.led6}'`)).toEqual([{ unit_cost: "1200.00" }]);
      expect(await q(U.founder, `select 1 from inv_costs`)).toHaveLength(1);
      for (const who of [U.opDubai, U.counter, U.viewer, U.catalog, U.accessMgr, U.outsider]) expect(await q(who, `select 1 from inv_costs`)).toHaveLength(0);
    });
    it("refuses registration by people who may not work there, and by outsiders", async () => {
      await expect(reg(U.opPoznan, IT.led, "SN-x1", L.dubai)).rejects.toThrow(/not allowed to register/);
      await expect(reg(U.viewer, IT.led, "SN-x2", L.dubai)).rejects.toThrow(/not allowed to register/);
      await expect(reg(U.outsider, IT.led, "SN-x3", L.dubai)).rejects.toThrow(/not set up|not allowed/);
    });
    it("does not let a draft unit be issued, dispatched or counted as available, and a draft catalogue item cannot be received", async () => {
      await expect(call(U.opDubai, `inv_issue_to_employee('${CO.uae}', '${L.dubai}', '${EMP.aisha}', '${key()}', ${j([{ unit_id: UN.led6 }])})`)).rejects.toThrow(/has not been counted and confirmed yet/);
      await expect(call(U.opDubai, `inv_dispatch_to_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ unit_id: UN.led6 }])}, null, '${fut(3)}')`)).rejects.toThrow(/has not been counted and confirmed yet/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.draft, qty: 5 }])).rejects.toThrow(/still a draft catalogue item/);
    });

    it("opening stock is only claimed by a count: lines are written first, nothing is stock until an authorised person confirms", async () => {
      count1 = (await call<Row>(U.opDubai, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
      for (const k of ["led1", "led2", "led3", "led4", "led5"]) await commit(U.opDubai, `select inv_save_count_line('${count1}', 1, p_unit_id => '${UN[k]}')`);
      await commit(U.opDubai, `select inv_save_count_line('${count1}', 100, p_item_id => '${IT.cable}', p_bin_id => '${L.binA1}')`);
      await commit(U.opDubai, `select inv_save_count_line('${count1}', 50.5, p_item_id => '${IT.rope}', p_bin_id => '${L.binA1}')`);
      await commit(U.opDubai, `select inv_save_count_line('${count1}', 20, p_item_id => '${IT.tape}')`);
      // a line saved again replaces the earlier one
      await commit(U.opDubai, `select inv_save_count_line('${count1}', 20, p_item_id => '${IT.tape}', p_note => 'recounted')`);
      expect(await n(`select 1 from inv_count_lines where count_id = '${count1}'`)).toBe(8);
      expect(await n(`select 1 from inv_balances`)).toBe(0);
      expect(await n(`select 1 from inv_movements`)).toBe(0);
      expect(await n(`select 1 from inv_units where lifecycle = 'active'`)).toBe(0);
    });
    it("refuses count lines with bad precision, a unit twice on open counts, and a count by someone who does not work at the location", async () => {
      await fails(U.opDubai, `select inv_save_count_line('${count1}', 50.5555, p_item_id => '${IT.rope}', p_bin_id => '${L.binB2}')`, /at most 3 decimal/);
      await fails(U.opDubai, `select inv_save_count_line('${count1}', 1.5, p_item_id => '${IT.cable}', p_bin_id => '${L.binB2}')`, /at most 0 decimal/);
      await fails(U.opDubai, `select inv_save_count_line('${count1}', 1, p_item_id => '${IT.draft}')`, /still a draft catalogue item/);
      await fails(U.opDubai, `select inv_save_count_line('${count1}', 2, p_unit_id => '${UN.led6}')`, /counted as 1/);
      await fails(U.opPoznan, `select inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`, /not set up to work at this location/);
      await fails(U.outsider, `select inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`);
      const c2 = (await call<Row>(U.founder, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
      await fails(U.founder, `select inv_save_count_line('${c2}', 1, p_unit_id => '${UN.led1}')`, /already on the open count/);
      await fails(U.founder, `select inv_save_count_line('${c2}', 5, p_item_id => '${IT.cable}', p_bin_id => '${L.binA1}')`, /already on the open count/);
      await commit(U.founder, `select inv_cancel_count('${CO.uae}', '${c2}', 'started by mistake')`);
      await fails(U.founder, `select inv_save_count_line('${c2}', 1, p_unit_id => '${UN.led6}')`, /already cancelled/);
    });
    it("lets only someone who may confirm stock turn the count into stock, with who and when, as 'opening' movements from outside the books", async () => {
      await fails(U.opDubai, `select inv_confirm_count('${CO.uae}', '${count1}', '${key()}')`, /confirm/);
      await fails(U.viewer, `select inv_confirm_count('${CO.uae}', '${count1}', '${key()}')`, /confirm/);
      const k = key();
      const r = await call<Row>(U.counter, `inv_confirm_count('${CO.uae}', '${count1}', '${k}')`);
      expect(r).toMatchObject({ kind: "opening", units: 5, quantity_lines: 3 });
      const units = await admin<Row>(`select lifecycle, verified_by, verified_at from inv_units where id in ('${UN.led1}', '${UN.led5}')`);
      expect(units.every((u) => u.lifecycle === "active" && u.verified_by === U.counter && u.verified_at)).toBe(true);
      expect((await admin<Row>(`select lifecycle from inv_units where id = '${UN.led6}'`))[0].lifecycle).toBe("draft");
      expect(await qtyOf(IT.cable, L.dubai)).toBe(100);
      expect(await qtyOf(IT.rope, L.dubai)).toBe(50.5);
      expect(await qtyOf(IT.tape, L.dubai)).toBe(20);
      const lines = await admin<Row>(`select l.from_kind, l.to_kind, m.kind from inv_movement_lines l join inv_movements m on m.id = l.movement_id`);
      expect(lines).toHaveLength(8);
      expect(lines.every((l) => l.from_kind === "external" && l.to_kind === "warehouse" && l.kind === "opening")).toBe(true);
      expect(await n(`select 1 from inv_costs where movement_id is not null`)).toBe(0);              // opening stock never invents a cost or a purchase
      const status = (await admin<Row>(`select status, confirmed_by from inv_counts where id = '${count1}'`))[0];
      expect(status).toMatchObject({ status: "confirmed", confirmed_by: U.counter });
      // a retry with the same key changes nothing; a second confirmation under a new key is refused
      const again = await call<Row>(U.counter, `inv_confirm_count('${CO.uae}', '${count1}', '${k}')`);
      expect(again).toMatchObject({ movement_id: r.movement_id, replayed: true });
      await fails(U.counter, `select inv_confirm_count('${CO.uae}', '${count1}', '${key()}')`, /already confirmed/);
      expect(await qtyOf(IT.cable, L.dubai)).toBe(100);
    });
    it("never re-opens a verified unit or re-counts verified stock as opening stock, and the draft unit stays a draft", async () => {
      const c3 = (await call<Row>(U.opDubai, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
      await fails(U.opDubai, `select inv_save_count_line('${c3}', 1, p_unit_id => '${UN.led1}')`, /already been counted and verified/);
      await fails(U.opDubai, `select inv_save_count_line('${c3}', 30, p_item_id => '${IT.cable}', p_bin_id => '${L.binA1}')`, /already has verified stock/);
      await commit(U.opDubai, `select inv_cancel_count('${CO.uae}', '${c3}', 'check only')`);
    });
    it("handles equipment already with an employee or on a project as opening custody: one custody, never also on the shelf", async () => {
      const ledE = await call<Row>(U.opDubai, `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${IT.led}', p_serial_number => 'SN-ledE', p_location_id => '${L.dubai}',
        p_holder => ${j({ kind: "employee", employee_id: EMP.aisha })})`);
      const ledP = await call<Row>(U.opDubai, `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${IT.led}', p_serial_number => 'SN-ledP', p_location_id => '${L.dubai}',
        p_holder => ${j({ kind: "project", project_id: PRJ.p1, expected_return_at: fut(30) })})`);
      UN.ledE = ledE.unit_id; UN.ledP = ledP.unit_id;
      expect(ledE).toMatchObject({ custody_kind: "employee", lifecycle: "draft" });
      const c = (await call<Row>(U.opDubai, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
      await fails(U.opDubai, `select inv_save_count_line('${c}', 1, p_unit_id => '${UN.ledE}')`, /with an employee already.*never counted twice/);
      await fails(U.opDubai, `select inv_save_count_line('${c}', 1, p_unit_id => '${UN.ledP}')`, /out on a project already/);
      await commit(U.opDubai, `select inv_cancel_count('${CO.uae}', '${c}', 'done')`);
      const lines = [{ unit_id: UN.ledE }, { unit_id: UN.ledP }, { item_id: IT.cable, qty: 2, employee_id: EMP.omar }];
      await fails(U.opDubai, `select inv_confirm_opening_custody('${CO.uae}', '${key()}', ${j(lines)})`, /confirm/);
      await fails(U.counter, `select inv_confirm_opening_custody('${CO.uae}', '${key()}', ${j([{ unit_id: UN.led1 }])})`, /already been counted and verified/);
      await fails(U.counter, `select inv_confirm_opening_custody('${CO.uae}', '${key()}', ${j([{ item_id: IT.cable, qty: 1 }])})`, /employee or the project/);
      await fails(U.counter, `select inv_confirm_opening_custody('${CO.uae}', '${key()}', ${j([{ item_id: IT.cable, qty: 1, project_id: PRJ.done }])})`, /completed and cannot receive/);
      const r = await call<Row>(U.counter, `inv_confirm_opening_custody('${CO.uae}', '${key()}', ${j(lines)})`);
      expect(r).toMatchObject({ units: 2, quantity_lines: 1 });
      expect(await unit(UN.ledE)).toMatchObject({ lifecycle: "active", custody_kind: "employee", employee_id: EMP.aisha, verified_by: U.counter });
      expect(await unit(UN.ledP)).toMatchObject({ lifecycle: "active", custody_kind: "project", project_id: PRJ.p1 });
      expect(await qtyOf(IT.cable, L.dubai)).toBe(100);                 // the shelf is untouched: nothing counted twice
      expect(Number((await admin<Row>(`select sum(qty) s from inv_balances where item_id = '${IT.cable}' and holder_kind = 'employee'`))[0].s)).toBe(2);
      expect(await n(`select 1 from inv_movement_lines where unit_id = '${UN.ledE}'`)).toBe(1);
      // once verified, the custody cannot be opened again, and the unit cannot be counted on the shelf either
      await fails(U.counter, `select inv_confirm_opening_custody('${CO.uae}', '${key()}', ${j([{ unit_id: UN.ledE }])})`, /already been counted and verified/);
      const c4 = (await call<Row>(U.opDubai, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
      await fails(U.opDubai, `select inv_save_count_line('${c4}', 1, p_unit_id => '${UN.ledE}')`, /already been counted and verified/);
      await commit(U.opDubai, `select inv_cancel_count('${CO.uae}', '${c4}', 'done')`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("receipts, precision, costs and rentals", () => {
    it("receives quantity stock into a bin and returns the resulting quantity", async () => {
      const r = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 20, bin_id: L.binB2 }]);
      expect(r).toMatchObject({ kind: "receipt", lines: [{ qty: 20, qty_after: 20 }] });
      expect(await qtyOf(IT.cable, L.dubai)).toBe(120);
      expect(await n(`select 1 from inv_movement_lines where movement_id = '${r.movement_id}' and from_kind = 'external' and to_kind = 'warehouse'`)).toBe(1);
    });
    it("respects each item's precision: metres to 3 decimals, individual units and pieces whole, never zero or negative", async () => {
      await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.rope, qty: 10.125 }]);
      expect(await qtyOf(IT.rope, L.dubai)).toBe(60.625);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.rope, qty: 10.1234 }])).rejects.toThrow(/at most 3 decimal/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1.5 }])).rejects.toThrow(/at most 0 decimal/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.led, qty: 1.5, serials: ["a"] }])).rejects.toThrow(/Give a serial number for every unit|whole units/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.led, qty: 1.5 }])).rejects.toThrow(/whole units/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 0 }])).rejects.toThrow(/more than zero/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: -4 }])).rejects.toThrow(/more than zero/);
      expect(await qtyOf(IT.rope, L.dubai)).toBe(60.625);
    });
    it("receives individual units as active, verified by the receiver, with unique codes; repeated serials are refused", async () => {
      const r = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.extra, qty: 2, serials: ["LENS-1", "LENS-2"], bin_id: L.binA1 }]);
      const ids = r.lines.map((l: Row) => l.unit_id);
      UN.lens1 = ids[0]; UN.lens2 = ids[1];
      expect(r.lines[0].code).toMatch(/^UAE-E-\d{5}$/);
      expect(await unit(UN.lens1)).toMatchObject({ lifecycle: "active", ownership: "owned", verified_by: U.opDubai, custody_kind: "warehouse" });
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.extra, qty: 1, serials: ["lens-1"] }])).rejects.toThrow(/already registered as UAE-E-/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.extra, qty: 2, serials: ["only-one"] }])).rejects.toThrow(/serial number for every unit/);
      expect(await n(`select 1 from inv_units where item_id = '${IT.extra}'`)).toBe(2);
      expect(await n(`select distinct code from inv_units`)).toBe(await n(`select 1 from inv_units`));
    });
    it("takes a cost only from someone who may see costs, records it separately, and shows it only to cost readers", async () => {
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1, unit_cost: 5, currency: "AED" }])).rejects.toThrow(/may see costs/);
      await expect(receive(U.founder, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1, unit_cost: 5 }])).rejects.toThrow(/amount and a currency/);
      const r = await receive(U.founder, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 10, unit_cost: 4.5, currency: "AED", purchase_date: "2026-02-01" }]);
      expect(await n(`select 1 from inv_costs where movement_id = '${r.movement_id}'`)).toBe(1);
      expect(await q(U.founder, `select unit_cost from inv_costs where movement_id = '${r.movement_id}'`)).toEqual([{ unit_cost: "4.50" }]);
      expect(await q(U.opDubai, `select 1 from inv_costs`)).toHaveLength(0);
      expect(await q(U.costCatalog, `select 1 from inv_costs where movement_id = '${r.movement_id}'`)).toHaveLength(1);
    });
    it("refuses receipts by people who do not work at that location, for retired items, and by outsiders; cross_location may receive anywhere", async () => {
      await expect(receive(U.opPoznan, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }])).rejects.toThrow(/not set up to work at this location/);
      await expect(receive(U.viewer, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }])).rejects.toThrow(/not set up to work/);
      await expect(receive(U.outsider, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }])).rejects.toThrow(/not set up to work|not set up/);
      await expect(receive(U.catalog, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }])).rejects.toThrow(/not set up to work/);
      await expect(receive(U.ksaFounder, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }])).rejects.toThrow();
      await receive(U.crossOp, CO.uae, L.poznan, [{ item_id: IT.cable, qty: 7, bin_id: L.binP1 }]);
      expect(await qtyOf(IT.cable, L.poznan)).toBe(7);
      await receive(U.opPoznan, CO.uae, L.poznan, [{ item_id: IT.cable, qty: 3 }]);
      expect(await qtyOf(IT.cable, L.poznan)).toBe(10);
    });
    it("records a rental receipt as rental-owned stock tied to a rental (supplier, reference, deadline) and never adds to owned quantities", async () => {
      const ownedBefore = await qtyOf(IT.shackle, L.dubai);
      const unitsBefore = await n(`select 1 from inv_units where ownership = 'owned'`);
      const rental = { supplier_name: "Acme Rentals", external_reference: "RENT-77", return_deadline: fut(10) };
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.shackle, qty: 8 }], { ...rental, return_deadline: fut(-1) })).rejects.toThrow(/deadline in the future/);
      const r = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.shackle, qty: 8 }, { item_id: IT.adapterB, qty: 2, serials: ["R-AD-1", "R-AD-2"] }], rental);
      expect(r.kind).toBe("rental_receipt");
      const rentalRow = (await admin<Row>(`select * from inv_rentals where id = '${r.rental_id}'`))[0];
      expect(rentalRow).toMatchObject({ supplier_name: "Acme Rentals", external_reference: "RENT-77", status: "open" });
      expect(await qtyOf(IT.shackle, L.dubai)).toBe(ownedBefore);                       // owned quantity untouched
      expect(Number((await admin<Row>(`select sum(qty) s from inv_balances where item_id = '${IT.shackle}' and rental_id = '${r.rental_id}'`))[0].s)).toBe(8);
      expect(await n(`select 1 from inv_units where ownership = 'owned'`)).toBe(unitsBefore);
      const rentalUnits = await admin<Row>(`select id, ownership, rental_id from inv_units where item_id = '${IT.adapterB}'`);
      expect(rentalUnits.every((u) => u.ownership === "rental" && u.rental_id === r.rental_id)).toBe(true);
      UN.rentAd1 = rentalUnits[0].id; UN.rentalId = r.rental_id;
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.shackle, qty: 1 }], { ...rental, supplier_name: "Other Co" })).rejects.toThrow(/already used/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.shackle, qty: 1 }], { supplier_name: "", external_reference: "X1" })).rejects.toThrow(/rental supplier/);
    });
    it("returns rental stock to the supplier as a movement, retires the rented units, and closes the rental when nothing is left", async () => {
      await expect(call(U.opPoznan, `inv_return_rental('${CO.uae}', '${L.dubai}', '${key()}', '${UN.rentalId}')`)).rejects.toThrow(/not set up to work/);
      const r = await call<Row>(U.opDubai, `inv_return_rental('${CO.uae}', '${L.dubai}', '${key()}', '${UN.rentalId}')`);
      expect(r).toMatchObject({ kind: "rental_return", rental_status: "returned", still_out: 0 });
      expect((await unit(UN.rentAd1)).lifecycle).toBe("retired");
      expect(Number((await admin<Row>(`select coalesce(sum(qty), 0) s from inv_balances where rental_id = '${UN.rentalId}'`))[0].s)).toBe(0);
      expect((await admin<Row>(`select status, returned_at from inv_rentals where id = '${UN.rentalId}'`))[0].status).toBe("returned");
      await expect(call(U.opDubai, `inv_return_rental('${CO.uae}', '${L.dubai}', '${key()}', '${UN.rentalId}')`)).rejects.toThrow(/already been returned/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("duplicate submissions, the transaction status lookup and real parallel connections", () => {
    const issue = (user: string, loc: string, emp: string, lines: unknown[], k = key(), expected: string | null = null) =>
      call<Row>(user, `inv_issue_to_employee('${CO.uae}', '${loc}', '${emp}', '${k}', ${j(lines)}, ${expected ? `'${expected}'` : "null"})`);

    it("treats the same key from the same caller with the same content as one transaction: the original result, nothing changed", async () => {
      const k = key();
      const before = await qtyOf(IT.cable, L.dubai);
      const movementsBefore = await n(`select 1 from inv_movements`);
      const first = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 5 }], null, k);
      const second = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 5 }], null, k);
      expect(second).toMatchObject({ movement_id: first.movement_id, code: first.code, replayed: true });
      expect(first.replayed).toBeUndefined();
      expect(await qtyOf(IT.cable, L.dubai)).toBe(before + 5);
      expect(await n(`select 1 from inv_movements`)).toBe(movementsBefore + 1);
    });
    it("refuses the same key with different content, from another caller, or too short; a failed call leaves its key unused", async () => {
      const k = key();
      await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }], null, k);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 2 }], null, k)).rejects.toThrow(/different request/);
      await expect(receive(U.founder, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }], null, k)).rejects.toThrow(/used by someone else/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }], null, "short")).rejects.toThrow(/8 to 120/);
      await expect(receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }], null, "x".repeat(121))).rejects.toThrow(/8 to 120/);
      const bad = key();
      await expect(issue(U.opDubai, L.dubai, EMP.aisha, [{ item_id: IT.cable, qty: 100000 }], bad)).rejects.toThrow(/Only .* can be issued now/);
      expect(await n(`select 1 from inv_idempotency where idem_key = '${bad}'`)).toBe(0);
      // the same key is a different request for a different kind of movement
      const k2 = key();
      await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }], null, k2);
      await expect(call(U.opDubai, `inv_check_condition('${CO.uae}', '${L.dubai}', '${k2}', ${j([{ unit_id: UN.led1, condition: "fair" }])})`)).rejects.toThrow(/different request/);
    });
    it("answers 'did my request go through?' through the transaction status lookup, only to the caller or someone who may read stock", async () => {
      const k = key();
      const r = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.cable, qty: 1 }], null, k);
      const mine = await call<Row>(U.opDubai, `inv_transaction_status('${CO.uae}', '${k}')`);
      expect(mine).toMatchObject({ found: true, status: "recorded", kind: "receipt", movement_code: r.code, mine: true });
      expect(mine.result.movement_id).toBe(r.movement_id);
      expect(await call<Row>(U.viewer, `inv_transaction_status('${CO.uae}', '${k}')`)).toMatchObject({ found: true, mine: false });
      expect(await call<Row>(U.outsider, `inv_transaction_status('${CO.uae}', '${k}')`)).toMatchObject({ found: false, status: "not_recorded" });
      expect(await call<Row>(U.opDubai, `inv_transaction_status('${CO.uae}', 'never-used-key')`)).toMatchObject({ found: false });
      expect(await call<Row>(U.ksaFounder, `inv_transaction_status('${CO.uae}', '${k}')`)).toMatchObject({ found: false });
    });
    it("records one transaction when the same request arrives on two connections at once", async () => {
      const k = key();
      const before = await n(`select 1 from inv_movements`);
      const [a, b] = await Promise.all([
        receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.screws, qty: 9 }], null, k),
        receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.screws, qty: 9 }], null, k),
      ]);
      expect(a.movement_id).toBe(b.movement_id);
      expect(await n(`select 1 from inv_movements`)).toBe(before + 1);
      expect(await qtyOf(IT.screws, L.dubai)).toBe(9);
    });
    it("lets a retried registration with a key create one unit", async () => {
      const k = key();
      const args = `p_company_id => '${CO.uae}', p_item_id => '${IT.led}', p_serial_number => 'SN-retry', p_location_id => '${L.dubai}', p_key => '${k}'`;
      const a = await call<Row>(U.opDubai, `inv_register_unit(${args})`);
      const b = await call<Row>(U.opDubai, `inv_register_unit(${args})`);
      expect(b).toMatchObject({ unit_id: a.unit_id, replayed: true });
      expect(await n(`select 1 from inv_units where serial_number = 'SN-retry'`)).toBe(1);
      UN.retry = a.unit_id;
    });

    it("serialises two simultaneous issues of the last quantity: exactly one succeeds, nothing goes negative", async () => {
      await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.shackle, qty: 5 }]);
      const results = await Promise.allSettled([
        issue(U.opDubai, L.dubai, EMP.aisha, [{ item_id: IT.shackle, qty: 3 }]),
        issue(U.founder, L.dubai, EMP.omar, [{ item_id: IT.shackle, qty: 3 }]),
        issue(U.crossOp, L.dubai, EMP.omar, [{ item_id: IT.shackle, qty: 3 }]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason.message).toMatch(/Only 2 of Shackle 5t can be issued now/);
      expect(await qtyOf(IT.shackle, L.dubai)).toBe(2);
      expect(Number((await admin<Row>(`select sum(qty) s from inv_balances where item_id = '${IT.shackle}' and holder_kind = 'employee'`))[0].s)).toBe(3);
      expect(await n(`select 1 from inv_balances where qty < 0`)).toBe(0);
    });
    it("serialises two simultaneous issues of the last unit: one wins, the other is told where it is", async () => {
      const results = await Promise.allSettled([
        issue(U.opDubai, L.dubai, EMP.aisha, [{ unit_id: UN.lens2 }]),
        issue(U.founder, L.dubai, EMP.omar, [{ unit_id: UN.lens2 }]),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((results.find((x) => x.status === "rejected")) as PromiseRejectedResult).reason.message).toMatch(/not on the shelf: it is with an employee/);
      expect(await n(`select 1 from inv_movement_lines where unit_id = '${UN.lens2}' and to_kind = 'employee'`)).toBe(1);
      expect((await unit(UN.lens2)).custody_kind).toBe("employee");
    });
    it("stops a parallel dispatch and issue of the same unit from both taking it, whichever function is used", async () => {
      const results = await Promise.allSettled([
        issue(U.opDubai, L.dubai, EMP.aisha, [{ unit_id: UN.lens1 }]),
        call(U.founder, `inv_dispatch_to_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ unit_id: UN.lens1 }])}, null, '${fut(2)}')`),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const u1 = await unit(UN.lens1);
      expect(["employee", "project"]).toContain(u1.custody_kind);
      // put it back so later scenarios have it on the shelf
      if (u1.custody_kind === "employee") await call(U.opDubai, `inv_return_from_employee('${CO.uae}', '${L.dubai}', '${u1.employee_id}', '${key()}', ${j([{ unit_id: UN.lens1, condition: "good" }])})`);
      else await call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${u1.project_id}', '${key()}', ${j([{ unit_id: UN.lens1, condition: "good" }])})`);
      expect((await unit(UN.lens1)).custody_kind).toBe("warehouse");
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("employee issue and return", () => {
    const issue = (user: string, emp: string, lines: unknown[], expected: string | null = fut(30), loc = L.dubai) =>
      call<Row>(user, `inv_issue_to_employee('${CO.uae}', '${loc}', '${emp}', '${key()}', ${j(lines)}, ${expected ? `'${expected}'` : "null"})`);
    const back = (user: string, emp: string, lines: unknown[], loc = L.dubai) =>
      call<Row>(user, `inv_return_from_employee('${CO.uae}', '${loc}', '${emp}', '${key()}', ${j(lines)})`);

    it("issues a unit and a quantity to an employee: custody moves, the unit is no longer available, the ledger names both ends", async () => {
      const r = await issue(U.opDubai, EMP.aisha, [{ unit_id: UN.led1 }, { item_id: IT.cable, qty: 3 }]);
      expect(r.employee_id).toBe(EMP.aisha);
      expect(await unit(UN.led1)).toMatchObject({ custody_kind: "employee", employee_id: EMP.aisha });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.led1}'`))[0].ok).toBe(false);
      expect(Number((await admin<Row>(`select qty from inv_balances where item_id = '${IT.cable}' and employee_id = '${EMP.aisha}'`))[0].qty)).toBe(3);
      const m = (await admin<Row>(`select employee_id, kind from inv_movements where id = '${r.movement_id}'`))[0];
      expect(m).toMatchObject({ employee_id: EMP.aisha, kind: "issue_employee" });
      const l = await admin<Row>(`select from_kind, to_kind, to_employee_id from inv_movement_lines where movement_id = '${r.movement_id}' order by unit_id nulls last`);
      expect(l.every((x) => x.from_kind === "warehouse" && x.to_kind === "employee" && x.to_employee_id === EMP.aisha)).toBe(true);
    });
    it("refuses issuing what is not on the shelf, to someone who left, across companies, with a past return date, or consumables", async () => {
      await expect(issue(U.opDubai, EMP.omar, [{ unit_id: UN.led1 }])).rejects.toThrow(/not on the shelf: it is with an employee/);
      await expect(issue(U.opDubai, EMP.gone, [{ unit_id: UN.led3 }])).rejects.toThrow(/has left the company/);
      await expect(issue(U.opDubai, EMP.fahad, [{ unit_id: UN.led3 }])).rejects.toThrow(/belongs to another company/);
      await expect(issue(U.opDubai, EMP.omar, [{ unit_id: UN.led3 }], fut(-2))).rejects.toThrow(/in the future/);
      await expect(issue(U.opDubai, EMP.omar, [{ item_id: IT.tape, qty: 1 }])).rejects.toThrow(/consumable/);
      await expect(issue(U.opDubai, EMP.omar, [{ item_id: IT.led, qty: 1 }])).rejects.toThrow(/unit by unit/);
      await expect(issue(U.opDubai, EMP.omar, [{ unit_id: UN.led3 }, { unit_id: UN.led3 }])).rejects.toThrow(/listed twice/);
      await expect(issue(U.opDubai, EMP.omar, [{ item_id: IT.cable, qty: 1.5 }])).rejects.toThrow(/at most 0 decimal/);
      await expect(issue(U.opPoznan, EMP.omar, [{ unit_id: UN.led3 }])).rejects.toThrow(/not set up to work at this location/);
      await expect(issue(U.viewer, EMP.omar, [{ unit_id: UN.led3 }])).rejects.toThrow(/not set up to work/);
      await expect(issue(U.opDubai, id(), [{ unit_id: UN.led3 }])).rejects.toThrow(/Unknown employee/);
      expect((await unit(UN.led3)).custody_kind).toBe("warehouse");
    });
    it("keeps a unit reserved for a project from going to a person for that period", async () => {
      const r = await mkRequest(PRJ.p2, "UAE-R-9001");
      UN.reqP2 = r;
      UN.resLed2 = await reserveUnit(r, IT.led, UN.led2, 5, 10);
      await expect(issue(U.opDubai, EMP.omar, [{ unit_id: UN.led2 }], null)).rejects.toThrow(/reserved for UAE-R-9001/);
      await expect(issue(U.opDubai, EMP.omar, [{ unit_id: UN.led2 }], fut(8))).rejects.toThrow(/reserved for UAE-R-9001/);
    });
    it("returns only what is listed: the rest stays outstanding; a damaged unit is held, and returning to the wrong employee is refused", async () => {
      await expect(back(U.opDubai, EMP.omar, [{ unit_id: UN.led1, condition: "good" }])).rejects.toThrow(/not recorded with this employee/);
      await expect(back(U.opDubai, EMP.aisha, [{ unit_id: UN.led1 }])).rejects.toThrow(/Say the condition/);
      await expect(back(U.opDubai, EMP.aisha, [{ item_id: IT.cable, qty: 4, condition: "good" }])).rejects.toThrow(/Not enough HDMI cable with this employee: 3 available, 4 needed/);
      await expect(back(U.opDubai, EMP.omar, [{ item_id: IT.led, qty: 1, condition: "good" }])).rejects.toThrow();
      const r = await back(U.opDubai, EMP.aisha, [{ unit_id: UN.led1, condition: "damaged", bin_id: L.binB2 }, { item_id: IT.cable, qty: 1, condition: "good", bin_id: L.binB2 }]);
      expect(r.lines.find((l: Row) => l.unit_id === UN.led1)).toMatchObject({ condition: "damaged", available: false });
      expect(r.lines.find((l: Row) => l.qty === 1)).toMatchObject({ condition: "good", available: true });
      expect(await unit(UN.led1)).toMatchObject({ custody_kind: "warehouse", condition: "damaged", bin_id: L.binB2, employee_id: null });
      expect(Number((await admin<Row>(`select qty from inv_balances where item_id = '${IT.cable}' and employee_id = '${EMP.aisha}'`))[0].qty)).toBe(2);   // two still out
      // held, never released automatically: still not usable, cannot be issued
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.led1}'`))[0].ok).toBe(false);
      await expect(issue(U.opDubai, EMP.omar, [{ unit_id: UN.led1 }])).rejects.toThrow(/damaged and is held back/);
      const l = (await admin<Row>(`select m.employee_id, l.from_employee_id, l.to_kind from inv_movement_lines l join inv_movements m on m.id = l.movement_id where l.movement_id = '${r.movement_id}' and l.unit_id is not null`))[0];
      expect(l).toMatchObject({ employee_id: EMP.aisha, from_employee_id: EMP.aisha, to_kind: "warehouse" });
    });
    it("releases a held unit only through a recorded condition check", async () => {
      await expect(call(U.opPoznan, `inv_check_condition('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ unit_id: UN.led1, condition: "good" }])})`)).rejects.toThrow(/not set up to work/);
      await expect(call(U.opDubai, `inv_check_condition('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ unit_id: UN.led1, condition: "damaged" }])})`)).rejects.toThrow(/already damaged/);
      const r = await call<Row>(U.opDubai, `inv_check_condition('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ unit_id: UN.led1, condition: "good", note: "repaired panel" }])})`);
      expect(r.lines[0]).toMatchObject({ condition: "good", available: true });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.led1}'`))[0].ok).toBe(true);
      expect(await n(`select 1 from inv_movement_lines where unit_id = '${UN.led1}' and condition_from = 'damaged' and condition_to = 'good' and exception_note = 'repaired panel'`)).toBe(1);
    });
    it("completes the inspection in the same call when the unit comes back good, so it is available at the chosen bin at once", async () => {
      await issue(U.opDubai, EMP.omar, [{ unit_id: UN.led1 }]);
      const r = await back(U.opDubai, EMP.omar, [{ unit_id: UN.led1, condition: "good", bin_id: L.binA1 }]);
      expect(r.lines[0]).toMatchObject({ condition: "good", available: true });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.led1}'`))[0].ok).toBe(true);
      expect(await unit(UN.led1)).toMatchObject({ custody_kind: "warehouse", bin_id: L.binA1, condition: "good" });
      await back(U.opDubai, EMP.aisha, [{ item_id: IT.cable, qty: 2, condition: "needs_inspection" }]);
      expect(await qtyOf(IT.cable, L.dubai, "needs_inspection")).toBe(2);        // quantity held, not mixed into good stock
    });
    it("lets a unit that was returned for inspection be released for quantity stock only by a condition check", async () => {
      await call(U.opDubai, `inv_check_condition('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ item_id: IT.cable, qty: 2, from_condition: "needs_inspection", condition: "good" }])})`);
      expect(await qtyOf(IT.cable, L.dubai, "needs_inspection")).toBe(0);
      await expect(call(U.opDubai, `inv_check_condition('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ item_id: IT.cable, qty: 2, from_condition: "needs_inspection", condition: "good" }])})`)).rejects.toThrow(/Not enough HDMI cable/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("project dispatch and return", () => {
    const dispatch = (user: string, project: string, lines: unknown[], request: string | null = null, expected: string | null = fut(7), loc = L.dubai) =>
      call<Row>(user, `inv_dispatch_to_project('${CO.uae}', '${loc}', '${project}', '${key()}', ${j(lines)}, ${request ? `'${request}'` : "null"}, ${expected ? `'${expected}'` : "null"})`);
    const back = (user: string, project: string, lines: unknown[], loc = L.dubai) =>
      call<Row>(user, `inv_return_from_project('${CO.uae}', '${loc}', '${project}', '${key()}', ${j(lines)})`);
    let resCable = "";

    it("dispatches without a request only what is unreserved and free until the expected return; another reservation in that period stops it", async () => {
      resCable = await reserveQty(UN.reqP2, IT.cable, L.dubai, 20, 5, 10);
      await expect(dispatch(U.opDubai, PRJ.p1, [{ unit_id: UN.led2 }], null, fut(7))).rejects.toThrow(/reserved for UAE-R-9001 \(project UAE-P-2\)/);
      const shelf = await qtyOf(IT.cable, L.dubai);
      await expect(dispatch(U.opDubai, PRJ.p1, [{ item_id: IT.cable, qty: shelf - 19 }], null, fut(7))).rejects.toThrow(/Only \d+ of HDMI cable is free until/);
      await expect(dispatch(U.opDubai, PRJ.p1, [{ item_id: IT.cable, qty: shelf - 20 }], null, fut(7)).then(async (r) => { expect(r.lines).toHaveLength(1); })).resolves.toBeUndefined();
      // bring that back so the reservation tests below have stock
      await back(U.opDubai, PRJ.p1, [{ item_id: IT.cable, qty: shelf - 20, condition: "good", bin_id: L.binA1 }]);
      expect(await qtyOf(IT.cable, L.dubai)).toBe(shelf);
      // before the reservation starts, the same unit is free: a short dispatch that returns before day 5 is fine
      const r = await dispatch(U.opDubai, PRJ.p1, [{ unit_id: UN.led3 }], null, fut(3));
      expect(r.project_id).toBe(PRJ.p1);
      expect(await unit(UN.led3)).toMatchObject({ custody_kind: "project", project_id: PRJ.p1 });
      await expect(dispatch(U.opDubai, PRJ.p1, [{ unit_id: UN.led4 }], null, null)).rejects.toThrow(/Say when the equipment is expected back/);
      await expect(dispatch(U.opDubai, PRJ.p1, [{ unit_id: UN.led4 }], null, fut(-1))).rejects.toThrow(/in the future/);
    });
    it("dispatches against a request only what that request reserved, and counts it on the reservation without closing it", async () => {
      await expect(dispatch(U.opDubai, PRJ.p2, [{ unit_id: UN.led4 }], UN.reqP2)).rejects.toThrow(/not reserved for request UAE-R-9001/);
      await expect(dispatch(U.opDubai, PRJ.p1, [{ unit_id: UN.led2 }], UN.reqP2)).rejects.toThrow(/not for this project/);
      await expect(dispatch(U.opDubai, PRJ.hold, [{ unit_id: UN.led2 }], UN.reqP2)).rejects.toThrow(/not for this project|on hold/);
      await expect(dispatch(U.opDubai, PRJ.p2, [{ item_id: IT.cable, qty: 21 }], UN.reqP2)).rejects.toThrow(/Only 20 of HDMI cable is reserved for request UAE-R-9001/);
      const r = await dispatch(U.opDubai, PRJ.p2, [{ unit_id: UN.led2 }, { item_id: IT.cable, qty: 15 }], UN.reqP2);
      expect(r.request_id).toBe(UN.reqP2);
      const res = await admin<Row>(`select unit_id, qty, dispatched_qty, returned_qty, status from inv_reservations where request_line_id in (select id from inv_request_lines where request_id = '${UN.reqP2}') order by qty`);
      expect(res).toEqual([
        { unit_id: UN.led2, qty: "1.000", dispatched_qty: "1.000", returned_qty: "0.000", status: "active" },
        { unit_id: null, qty: "20.000", dispatched_qty: "15.000", returned_qty: "0.000", status: "active" },
      ]);
      expect((await admin<Row>(`select status from inv_requests where id = '${UN.reqP2}'`))[0].status).toBe("in_progress");
      await expect(dispatch(U.opDubai, PRJ.p2, [{ item_id: IT.cable, qty: 6 }], UN.reqP2)).rejects.toThrow(/Only 5 of HDMI cable is reserved/);
      expect(await unit(UN.led2)).toMatchObject({ custody_kind: "project", project_id: PRJ.p2 });
    });
    it("refuses dispatching to projects that are on hold or completed, to a cancelled request, and by people who do not work at the location", async () => {
      await expect(dispatch(U.opDubai, PRJ.hold, [{ unit_id: UN.led4 }])).rejects.toThrow(/on hold/);
      await expect(dispatch(U.opDubai, PRJ.done, [{ unit_id: UN.led4 }])).rejects.toThrow(/completed/);
      const cancelled = await mkRequest(PRJ.p3, "UAE-R-9002");
      await admin(`update inv_requests set status = 'cancelled', cancelled_at = now() where id = '${cancelled}'`);
      await expect(dispatch(U.opDubai, PRJ.p3, [{ unit_id: UN.led4 }], cancelled)).rejects.toThrow(/cancelled and cannot be dispatched/);
      await expect(dispatch(U.opPoznan, PRJ.p3, [{ unit_id: UN.led4 }])).rejects.toThrow(/not set up to work at this location/);
      await expect(dispatch(U.pm, PRJ.p3, [{ unit_id: UN.led4 }])).rejects.toThrow(/not set up to work|not set up/);
      await expect(dispatch(U.opDubai, PRJ.p3, [{ item_id: IT.tape, qty: 1 }])).rejects.toThrow(/consumable/);
      await expect(dispatch(U.opDubai, PRJ.ksa, [{ unit_id: UN.led4 }])).rejects.toThrow(/belongs to another company/);
    });
    it("handles partial returns: the rest stays outstanding, damaged is held, the reservation completes only when everything dispatched is back", async () => {
      const r1 = await back(U.opDubai, PRJ.p2, [{ item_id: IT.cable, qty: 10, condition: "good", bin_id: L.binB2 }, { item_id: IT.cable, qty: 3, condition: "damaged" }]);
      expect(r1.lines.map((l: Row) => [l.qty, l.available])).toEqual([[10, true], [3, false]]);
      expect(await qtyOf(IT.cable, L.dubai, "damaged")).toBe(3);
      let res = (await admin<Row>(`select returned_qty, dispatched_qty, status from inv_reservations where id = '${resCable}'`))[0];
      expect(res).toMatchObject({ returned_qty: "13.000", dispatched_qty: "15.000", status: "active" });
      expect(Number((await admin<Row>(`select qty from inv_balances where item_id = '${IT.cable}' and project_id = '${PRJ.p2}'`))[0].qty)).toBe(2);
      await expect(back(U.opDubai, PRJ.p2, [{ item_id: IT.cable, qty: 3, condition: "good" }])).rejects.toThrow(/Not enough HDMI cable on project UAE-P-2: 2 available, 3 needed/);
      await back(U.opDubai, PRJ.p2, [{ item_id: IT.cable, qty: 2, condition: "needs_inspection" }]);
      res = (await admin<Row>(`select returned_qty, status from inv_reservations where id = '${resCable}'`))[0];
      expect(res).toMatchObject({ returned_qty: "15.000", status: "completed" });
      expect(await qtyOf(IT.cable, L.dubai, "needs_inspection")).toBe(2);
      // the unit is still out: its reservation is still active
      expect((await admin<Row>(`select status from inv_reservations where id = '${UN.resLed2}'`))[0].status).toBe("active");
    });
    it("returns a unit with a condition, completes the reservation, and holds a damaged one", async () => {
      const r = await back(U.opDubai, PRJ.p2, [{ unit_id: UN.led2, condition: "needs_inspection", bin_id: L.binB2, note: "scratched frame" }]);
      expect(r.lines[0]).toMatchObject({ condition: "needs_inspection", available: false });
      expect(await unit(UN.led2)).toMatchObject({ custody_kind: "warehouse", condition: "needs_inspection", bin_id: L.binB2 });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.led2}'`))[0].ok).toBe(false);
      expect((await admin<Row>(`select status, returned_qty from inv_reservations where id = '${UN.resLed2}'`))[0]).toMatchObject({ status: "completed", returned_qty: "1.000" });
      // never released automatically
      await expect(dispatch(U.opDubai, PRJ.p2, [{ unit_id: UN.led2 }])).rejects.toThrow(/needs inspection and is held back/);
      await call(U.opDubai, `inv_check_condition('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ unit_id: UN.led2, condition: "good" }])})`);
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.led2}'`))[0].ok).toBe(true);
    });
    it("refuses a return of equipment that was never dispatched to that project, or that is somewhere else", async () => {
      await expect(back(U.opDubai, PRJ.p1, [{ unit_id: UN.led4, condition: "good" }])).rejects.toThrow(/was not dispatched to project UAE-P-1 \(it is on the shelf\)/);
      await expect(back(U.opDubai, PRJ.p2, [{ unit_id: UN.led3, condition: "good" }])).rejects.toThrow(/was not dispatched to project UAE-P-2 \(it is out on a project\)/);
      await expect(back(U.opDubai, PRJ.p3, [{ item_id: IT.cable, qty: 1, condition: "good" }])).rejects.toThrow(/never dispatched to project UAE-P-3/);
      await expect(back(U.opDubai, PRJ.p3, [{ unit_id: UN.led6, condition: "good" }])).rejects.toThrow(/was not dispatched/);
      await expect(back(U.opPoznan, PRJ.p1, [{ unit_id: UN.led3, condition: "good" }], L.dubai)).rejects.toThrow(/not set up to work/);
      await back(U.opDubai, PRJ.p1, [{ unit_id: UN.led3, condition: "fair" }]);
      expect(await unit(UN.led3)).toMatchObject({ custody_kind: "warehouse", condition: "fair" });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("direct project-to-project transfer", () => {
    let reqP3 = "";
    const dispatch = (project: string, lines: unknown[], expected = fut(10)) =>
      call<Row>(U.opDubai, `inv_dispatch_to_project('${CO.uae}', '${L.dubai}', '${project}', '${key()}', ${j(lines)}, null, '${expected}')`);
    const move = (user: string, from: string, to: string, lines: unknown[], request: string | null, expected: string | null = fut(10)) =>
      call<Row>(user, `inv_transfer_between_projects('${CO.uae}', '${from}', '${to}', '${key()}', ${j(lines)}, ${request ? `'${request}'` : "null"}, ${expected ? `'${expected}'` : "null"})`);

    it("moves a free unit from one project to another in ONE movement: the old custody closed, the new one opened and reserved for the destination request", async () => {
      reqP3 = await mkRequest(PRJ.p3, "UAE-R-9003", "submitted", 2, 12);
      await mkLine(reqP3, IT.led, 1);
      await dispatch(PRJ.p1, [{ unit_id: UN.led4 }]);
      const movementsBefore = await n(`select 1 from inv_movements`);
      const r = await move(U.pm, PRJ.p1, PRJ.p3, [{ unit_id: UN.led4 }], reqP3);
      expect(r).toMatchObject({ kind: "transfer_project", new_reservations: 1, from_project_id: PRJ.p1, to_project_id: PRJ.p3 });
      expect(await n(`select 1 from inv_movements`)).toBe(movementsBefore + 1);
      expect(await unit(UN.led4)).toMatchObject({ custody_kind: "project", project_id: PRJ.p3 });
      const m = (await admin<Row>(`select project_id, to_project_id, request_id from inv_movements where id = '${r.movement_id}'`))[0];
      expect(m).toMatchObject({ project_id: PRJ.p1, to_project_id: PRJ.p3, request_id: reqP3 });
      const l = (await admin<Row>(`select from_kind, to_kind, from_project_id, to_project_id from inv_movement_lines where movement_id = '${r.movement_id}'`));
      expect(l).toEqual([{ from_kind: "project", to_kind: "project", from_project_id: PRJ.p1, to_project_id: PRJ.p3 }]);
      const res = await admin<Row>(`select request_line_id, dispatched_qty, status from inv_reservations where unit_id = '${UN.led4}' and status = 'active'`);
      expect(res).toHaveLength(1);
      expect(res[0].dispatched_qty).toBe("1.000");
      // the first project can no longer return it: it is now on the other project
      await expect(call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ unit_id: UN.led4, condition: "good" }])})`)).rejects.toThrow(/was not dispatched to project UAE-P-1/);
    });
    it("moves a unit that is already reserved for the destination request, and counts it on that reservation", async () => {
      await dispatch(PRJ.p1, [{ unit_id: UN.led5 }]);
      const res = await reserveUnit(reqP3, IT.led, UN.led5, 2, 12);
      const r = await move(U.opDubai, PRJ.p1, PRJ.p3, [{ unit_id: UN.led5 }], reqP3);
      expect(r.new_reservations).toBe(0);
      expect((await admin<Row>(`select dispatched_qty, status from inv_reservations where id = '${res}'`))[0]).toMatchObject({ dispatched_qty: "1.000", status: "active" });
      expect(await unit(UN.led5)).toMatchObject({ custody_kind: "project", project_id: PRJ.p3 });
    });
    it("refuses when the destination window is reserved by someone else, and never displaces that reservation", async () => {
      await dispatch(PRJ.p1, [{ unit_id: UN.led3 }], fut(4));
      const other = await mkRequest(PRJ.p2, "UAE-R-9004", "submitted", 3, 20);
      const res = await reserveUnit(other, IT.led, UN.led3, 3, 20);
      await expect(move(U.pm, PRJ.p1, PRJ.p3, [{ unit_id: UN.led3 }], reqP3)).rejects.toThrow(/reserved for UAE-R-9004 \(project UAE-P-2\).*never displaced/);
      expect(await unit(UN.led3)).toMatchObject({ custody_kind: "project", project_id: PRJ.p1 });
      expect((await admin<Row>(`select status from inv_reservations where id = '${res}'`))[0].status).toBe("active");
      expect(await n(`select 1 from inv_movements where kind = 'transfer_project'`)).toBe(2);
      // the reserving project itself can have it
      await mkLine(other, IT.led, 1);
      const r = await move(U.pm, PRJ.p1, PRJ.p2, [{ unit_id: UN.led3 }], other);
      expect(r.new_reservations).toBe(0);
      expect(await unit(UN.led3)).toMatchObject({ project_id: PRJ.p2 });
      await call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p2}', '${key()}', ${j([{ unit_id: UN.led3, condition: "good" }])})`);
    });
    it("checks who may move it, that the destination is ongoing and has its request, and that the unit is where it is said to be", async () => {
      await dispatch(PRJ.p1, [{ unit_id: UN.lens1 }]);
      await mkLine(reqP3, IT.extra, 1);
      await expect(move(U.pm2, PRJ.p1, PRJ.p3, [{ unit_id: UN.lens1 }], reqP3)).rejects.toThrow(/Only the manager of the project/);
      await expect(move(U.outsider, PRJ.p1, PRJ.p3, [{ unit_id: UN.lens1 }], reqP3)).rejects.toThrow(/Only the manager|not set up/);
      await expect(move(U.opPoznan, PRJ.p1, PRJ.p3, [{ unit_id: UN.lens1 }], reqP3)).rejects.toThrow(/not allowed to move/);
      const holdReq = await mkRequest(PRJ.hold, "UAE-R-9005");
      await mkLine(holdReq, IT.extra, 1);
      await expect(move(U.pm, PRJ.p1, PRJ.hold, [{ unit_id: UN.lens1 }], holdReq)).rejects.toThrow(/on hold and cannot receive equipment/);
      await expect(move(U.pm, PRJ.p1, PRJ.p3, [{ unit_id: UN.lens1 }], null)).rejects.toThrow(/destination project's equipment request/);
      await expect(move(U.pm, PRJ.p1, PRJ.p2, [{ unit_id: UN.lens1 }], reqP3)).rejects.toThrow(/not for the destination project/);
      await expect(move(U.pm, PRJ.p1, PRJ.p1, [{ unit_id: UN.lens1 }], reqP3)).rejects.toThrow(/two different projects/);
      await expect(move(U.pm, PRJ.p2, PRJ.p3, [{ unit_id: UN.lens1 }], reqP3)).rejects.toThrow(/is not on project UAE-P-2/);
      await expect(move(U.pm, PRJ.p1, PRJ.p3, [{ unit_id: UN.lens1 }], reqP3, null)).resolves.toBeTruthy();   // request supplies the return date
      await expect(move(U.pm, PRJ.p1, PRJ.p3, [{ unit_id: UN.lens1 }, { unit_id: UN.lens1 }], reqP3)).rejects.toThrow();
      // the destination project completes: the next transfer is refused
      const doneReq = await mkRequest(PRJ.done, "UAE-R-9006", "submitted");
      await expect(move(U.pm, PRJ.p3, PRJ.done, [{ unit_id: UN.lens1 }], doneReq)).rejects.toThrow(/completed and cannot receive/);
    });
    it("moves quantities too, reserving the moved stock for the destination, and refuses when it would leave another project's reservation short", async () => {
      await dispatch(PRJ.p1, [{ item_id: IT.cable, qty: 10 }]);
      const shelf = await qtyOf(IT.cable, L.dubai);
      const reqLine = await mkLine(reqP3, IT.cable, 4);
      const blocker = await mkRequest(PRJ.p2, "UAE-R-9007", "submitted", 1, 30);
      const blockRes = await reserveQty(blocker, IT.cable, L.dubai, shelf + 1, 1, 30);
      await expect(move(U.pm, PRJ.p1, PRJ.p3, [{ item_id: IT.cable, qty: 4 }], reqP3)).rejects.toThrow(/would leave a reservation of another project short/);
      await admin(`update inv_reservations set status = 'released', released_at = now() where id = '${blockRes}'`);
      const r = await move(U.pm, PRJ.p1, PRJ.p3, [{ item_id: IT.cable, qty: 4 }], reqP3);
      expect(r.new_reservations).toBe(1);
      const held = await admin<Row>(`select project_id, qty from inv_balances where item_id = '${IT.cable}' and holder_kind = 'project' and qty > 0 order by project_id`);
      expect(Object.fromEntries(held.map((h) => [h.project_id, Number(h.qty)]))).toMatchObject({ [PRJ.p1]: 6, [PRJ.p3]: 4 });
      expect(reqLine).toBeTruthy();
      expect((await admin<Row>(`select qty, dispatched_qty, location_id from inv_reservations where request_line_id = '${reqLine}'`))[0]).toMatchObject({ qty: "4.000", dispatched_qty: "4.000", location_id: L.dubai });
      await call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ item_id: IT.cable, qty: 6, condition: "good" }])})`);
      await call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p3}', '${key()}', ${j([{ item_id: IT.cable, qty: 4, condition: "good" }])})`);
      // park everything that is still out so the next scenarios start clean
      for (const u of [UN.led4, UN.led5, UN.lens1]) {
        await call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p3}', '${key()}', ${j([{ unit_id: u, condition: "good" }])})`);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("transfer between locations: dispatch, transit and receipt are three records", () => {
    let transferId = "";
    const free = async (item: string, loc: string, fromSql: string, untilSql: string) =>
      Number((await admin<{ f: string }>(`select inv_qty_free('${item}', '${loc}', ${fromSql}, ${untilSql}) f`))[0].f);
    const dispatchT = (user: string, from: string, to: string, lines: unknown[], expected: string | null = fut(2), company = CO.uae) =>
      call<Row>(user, `inv_transfer_dispatch('${company}', '${from}', '${to}', '${key()}', ${j(lines)}, ${expected ? `'${expected}'` : "null"}, 'DHL', 'WB-1')`);
    const receiveT = (user: string, transfer: string, lines: unknown[] | null = null, company = CO.uae) =>
      call<Row>(user, `inv_transfer_receive('${company}', '${transfer}', '${key()}', ${lines ? j(lines) : "null"})`);

    it("sets up adapters, kits and substitutes as stock", async () => {
      const r = await receive(U.opDubai, CO.uae, L.dubai, [{ item_id: IT.adapter, qty: 4, serials: ["AD-1", "AD-2", "AD-3", "AD-4"], bin_id: L.binA1 },
        { item_id: IT.case, qty: 2, serials: ["K-1", "K-2"], bin_id: L.binA1 }, { item_id: IT.adapterB, qty: 2, serials: ["ADB-1", "ADB-2"] }]);
      const by = (item: string) => r.lines.filter((l: Row) => l.item_id === item).map((l: Row) => l.unit_id);
      [UN.ad1, UN.ad2, UN.ad3, UN.ad4] = by(IT.adapter);
      [UN.kit1, UN.kit2] = by(IT.case);
      [UN.adB1, UN.adB2] = by(IT.adapterB);
      expect(UN.kit2).toBeTruthy();
    });
    it("dispatches to another location: a transfer record, stock in transit, nothing available at the destination yet", async () => {
      await expect(dispatchT(U.opPoznan, L.dubai, L.poznan, [{ unit_id: UN.ad1 }])).rejects.toThrow(/not set up to work at this location/);
      await expect(dispatchT(U.opDubai, L.dubai, L.dubai, [{ unit_id: UN.ad1 }])).rejects.toThrow(/different location/);
      await expect(dispatchT(U.opDubai, L.dubai, id(), [{ unit_id: UN.ad1 }])).rejects.toThrow(/Unknown destination/);
      await expect(dispatchT(U.opDubai, L.dubai, L.poznan, [{ unit_id: UN.led6 }])).rejects.toThrow(/has not been counted/);
      await expect(dispatchT(U.opDubai, L.dubai, L.poznan, [{ item_id: IT.cable, qty: 100000 }])).rejects.toThrow(/Only \d+ of HDMI cable can be moved now/);
      const poznanBefore = await qtyOf(IT.cable, L.poznan);
      const dubaiBefore = await qtyOf(IT.cable, L.dubai);
      const nowFree = await free(IT.cable, L.poznan, "now()", "now() + interval '1 hour'");
      const r = await dispatchT(U.opDubai, L.dubai, L.poznan, [{ unit_id: UN.ad1 }, { unit_id: UN.ad2 }, { item_id: IT.cable, qty: 20 }]);
      transferId = r.transfer_id;
      expect(r).toMatchObject({ kind: "transfer_dispatch", status: "in_transit" });
      expect(r.transfer_code).toMatch(/^UAE-T-\d{5}$/);
      expect(await unit(UN.ad1)).toMatchObject({ custody_kind: "transit", transfer_id: transferId });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.ad1}'`))[0].ok).toBe(false);
      expect(await qtyOf(IT.cable, L.dubai)).toBe(dubaiBefore - 20);
      expect(await qtyOf(IT.cable, L.poznan)).toBe(poznanBefore);
      expect((await admin<Row>(`select qty from inv_balances where holder_kind = 'transit' and transfer_id = '${transferId}'`))[0].qty).toBe("20.000");
      expect((await admin<Row>(`select transfer_id from inv_movements where id = '${r.movement_id}'`))[0].transfer_id).toBe(transferId);
      // in transit it does not count as stock at the destination now; on time for a LATER window it does, still never as 'usable now'
      expect(await free(IT.cable, L.poznan, "now()", "now() + interval '1 hour'")).toBe(nowFree);
      expect(await free(IT.cable, L.poznan, "now() + interval '3 days'", "now() + interval '4 days'")).toBe(nowFree + 20);
      expect((await admin<Row>(`select inv_unit_free('${UN.ad1}', now(), now() + interval '1 hour', '${L.poznan}') f`))[0].f).toBe(false);
      expect((await admin<Row>(`select inv_unit_free('${UN.ad1}', now() + interval '3 days', now() + interval '4 days', '${L.poznan}') f`))[0].f).toBe(true);
      // it cannot be used from either end while in transit
      await expect(call(U.opPoznan, `inv_issue_to_employee('${CO.uae}', '${L.poznan}', '${EMP.omar}', '${key()}', ${j([{ unit_id: UN.ad1 }])})`)).rejects.toThrow(/in transit/);
      await expect(call(U.opDubai, `inv_issue_to_employee('${CO.uae}', '${L.dubai}', '${EMP.omar}', '${key()}', ${j([{ unit_id: UN.ad1 }])})`)).rejects.toThrow(/in transit/);
    });
    it("needs someone who works at the DESTINATION to receive, and allows partial receipts that keep the transfer open", async () => {
      await expect(receiveT(U.opDubai, transferId)).rejects.toThrow(/not set up to work at this location/);
      await expect(receiveT(U.viewer, transferId)).rejects.toThrow(/not set up to work/);
      await expect(receiveT(U.outsider, transferId)).rejects.toThrow(/not set up/);
      await expect(receiveT(U.opPoznan, transferId, [{ unit_id: UN.ad3, condition: "good" }])).rejects.toThrow(/not part of transfer/);
      await expect(receiveT(U.opPoznan, transferId, [{ item_id: IT.cable, qty: 21 }])).rejects.toThrow(/Not enough HDMI cable in transit/);
      const poznanBefore = await qtyOf(IT.cable, L.poznan);
      const r = await receiveT(U.opPoznan, transferId, [{ unit_id: UN.ad1, condition: "good", bin_id: L.binP1 }, { item_id: IT.cable, qty: 12, bin_id: L.binP1 }]);
      expect(r).toMatchObject({ status: "in_transit", still_on_the_way: 2 });
      expect(await unit(UN.ad1)).toMatchObject({ custody_kind: "warehouse", location_id: L.poznan, bin_id: L.binP1, transfer_id: null });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.ad1}'`))[0].ok).toBe(true);
      expect(await qtyOf(IT.cable, L.poznan)).toBe(poznanBefore + 12);
      expect((await admin<Row>(`select status, received_at from inv_transfers where id = '${transferId}'`))[0]).toMatchObject({ status: "in_transit", received_at: null });
      expect(await unit(UN.ad2)).toMatchObject({ custody_kind: "transit" });
    });
    it("completes the transfer when the rest arrives (a unit damaged on the way is held), and refuses a second receipt", async () => {
      const r = await receiveT(U.opPoznan, transferId, [{ unit_id: UN.ad2, condition: "damaged" }, { item_id: IT.cable, qty: 8 }]);
      expect(r).toMatchObject({ status: "received", still_on_the_way: 0 });
      expect((await admin<Row>(`select status, received_by from inv_transfers where id = '${transferId}'`))[0]).toMatchObject({ status: "received", received_by: U.opPoznan });
      expect(await unit(UN.ad2)).toMatchObject({ custody_kind: "warehouse", condition: "damaged", location_id: L.poznan });
      expect((await admin<Row>(`select inv_unit_usable(u) ok from inv_units u where id = '${UN.ad2}'`))[0].ok).toBe(false);
      await expect(receiveT(U.opPoznan, transferId)).rejects.toThrow(/already received/);
      expect(await n(`select 1 from inv_balances where holder_kind = 'transit' and qty > 0`)).toBe(0);
    });
    it("lets cross_location staff handle any location, and plain operators only their own", async () => {
      const r = await dispatchT(U.crossOp, L.poznan, L.dubai, [{ item_id: IT.cable, qty: 1 }]);
      await expect(receiveT(U.opPoznan, r.transfer_id)).rejects.toThrow(/not set up to work at this location/);
      await receiveT(U.opDubai, r.transfer_id);
      await call(U.crossOp, `inv_check_condition('${CO.uae}', '${L.poznan}', '${key()}', ${j([{ unit_id: UN.ad2, condition: "good" }])})`);
      await expect(call(U.opDubai, `inv_check_condition('${CO.uae}', '${L.poznan}', '${key()}', ${j([{ unit_id: UN.ad2, condition: "fair" }])})`)).rejects.toThrow(/not set up to work/);
      await expect(call(U.opDubai, `inv_adjust_stock('${CO.uae}', '${L.poznan}', '${key()}', 'missing', ${j([{ unit_id: UN.ad2 }])}, 'x')`)).rejects.toThrow(/not set up to work/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("cross-company use needs a founder of the owning company", () => {
    let truss = "";
    it("registers and confirms KSA equipment at Riyadh with KSA people only", async () => {
      const r = await call<Row>(U.ksaOp, `inv_register_unit(p_company_id => '${CO.ksa}', p_item_id => '${IT.ksaTruss}', p_serial_number => 'TR-1', p_location_id => '${L.riyadh}')`);
      truss = r.unit_id; UN.truss = truss;
      await expect(call(U.opDubai, `inv_register_unit(p_company_id => '${CO.ksa}', p_item_id => '${IT.ksaTruss}', p_serial_number => 'TR-2', p_location_id => '${L.riyadh}')`)).rejects.toThrow(/not set up|not allowed/);
      const c = (await call<Row>(U.ksaOp, `inv_start_count('${CO.ksa}', '${L.riyadh}', 'opening')`)).count_id;
      await commit(U.ksaOp, `select inv_save_count_line('${c}', 1, p_unit_id => '${truss}')`);
      await expect(call(U.founder, `inv_confirm_count('${CO.ksa}', '${c}', '${key()}')`)).rejects.toThrow(/confirm/);
      await call(U.ksaFounder, `inv_confirm_count('${CO.ksa}', '${c}', '${key()}')`);
      expect((await unit(truss)).lifecycle).toBe("active");
      expect(await q(U.opDubai, `select 1 from inv_units where id = '${truss}'`)).toHaveLength(0);          // another company's stock is not visible
    });
    it("refuses to send it to another company's location until a founder of the OWNING company authorises sharing", async () => {
      const send = () => call<Row>(U.ksaOp, `inv_transfer_dispatch('${CO.ksa}', '${L.riyadh}', '${L.dubai}', '${key()}', ${j([{ unit_id: truss }])}, '${fut(3)}')`);
      await expect(send()).rejects.toThrow(/belongs to another company.*authorise sharing/);
      await fails(U.founder, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', true)`, /Only a founder of the company that owns/);
      await fails(U.ksaOp, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', true)`, /Only a founder of the company that owns/);
      await fails(U.ksaFounder, `select inv_set_company_sharing('${CO.ksa}', '${CO.ksa}', true)`, /does not need to authorise itself/);
      await commit(U.ksaFounder, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', true, 'Truss for the UAE show')`);
      const r = await send();
      await call(U.opDubai, `inv_transfer_receive('${CO.uae}', '${r.transfer_id}', '${key()}')`);
      expect(await unit(truss)).toMatchObject({ company_id: CO.ksa, location_id: L.dubai, custody_kind: "warehouse" });     // moving never changes the owner
    });
    it("shows the sharing record to founders and access managers of the two companies only", async () => {
      expect(await q(U.ksaFounder, `select 1 from inv_company_sharing`)).toHaveLength(1);
      expect(await q(U.founder, `select 1 from inv_company_sharing`)).toHaveLength(1);
      expect(await q(U.accessMgr, `select 1 from inv_company_sharing`)).toHaveLength(1);
      for (const who of [U.opDubai, U.counter, U.viewer, U.outsider, U.ksaOp]) expect(await q(who, `select 1 from inv_company_sharing`)).toHaveLength(0);
      expect((await admin<Row>(`select authorised_by from inv_company_sharing`))[0].authorised_by).toBe(U.ksaFounder);
    });
    it("lets the UAE warehouse use the KSA unit on a UAE project while shared, and stops it on the very next call once sharing is revoked", async () => {
      await call(U.opDubai, `inv_dispatch_to_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ unit_id: truss }])}, null, '${fut(5)}')`);
      expect(await unit(truss)).toMatchObject({ custody_kind: "project", project_id: PRJ.p1 });
      await commit(U.ksaFounder, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', false)`);
      await expect(call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ unit_id: truss, condition: "good" }])})`)).rejects.toThrow(/belongs to another company/);
      await expect(call(U.opDubai, `inv_dispatch_to_project('${CO.uae}', '${L.dubai}', '${PRJ.p2}', '${key()}', ${j([{ unit_id: truss }])}, null, '${fut(5)}')`)).rejects.toThrow(/belongs to another company|not on the shelf/);
      expect(await n(`select 1 from inv_company_sharing where revoked_at is null`)).toBe(0);
      await commit(U.ksaFounder, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', true)`);
      await call(U.opDubai, `inv_return_from_project('${CO.uae}', '${L.dubai}', '${PRJ.p1}', '${key()}', ${j([{ unit_id: truss, condition: "good" }])})`);
      expect((await unit(truss)).custody_kind).toBe("warehouse");
      expect(await n(`select 1 from inv_company_sharing`)).toBe(2);                                    // the revoked row is kept as history
    });
    it("keeps UAE equipment off KSA projects and KSA employees without an authorisation from the UAE", async () => {
      await expect(call(U.opDubai, `inv_issue_to_employee('${CO.uae}', '${L.dubai}', '${EMP.fahad}', '${key()}', ${j([{ unit_id: UN.led1 }])})`)).rejects.toThrow(/belongs to another company/);
      await expect(call(U.opDubai, `inv_dispatch_to_project('${CO.uae}', '${L.dubai}', '${PRJ.ksa}', '${key()}', ${j([{ unit_id: UN.led1 }])}, null, '${fut(5)}')`)).rejects.toThrow(/belongs to another company/);
      // the same rule for people: a KSA-owned unit cannot go to a UAE employee while sharing is off
      await commit(U.ksaFounder, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', false)`);
      await expect(call(U.opDubai, `inv_issue_to_employee('${CO.uae}', '${L.dubai}', '${EMP.aisha}', '${key()}', ${j([{ unit_id: truss }])})`)).rejects.toThrow(/belongs to another company/);
      await commit(U.ksaFounder, `select inv_set_company_sharing('${CO.ksa}', '${CO.uae}', true)`);
      const r = await call<Row>(U.opDubai, `inv_issue_to_employee('${CO.uae}', '${L.dubai}', '${EMP.aisha}', '${key()}', ${j([{ unit_id: truss }])})`);
      expect(r.employee_id).toBe(EMP.aisha);
      await call(U.opDubai, `inv_return_from_employee('${CO.uae}', '${L.dubai}', '${EMP.aisha}', '${key()}', ${j([{ unit_id: truss, condition: "good" }])})`);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("access that is revoked stops working on the very next call", () => {
    const rec = (user: string, loc = L.dubai) => receive(user, CO.uae, loc, [{ item_id: IT.screws, qty: 1 }]);
    it("stops a signed-in session on its next statement, even inside one open transaction", async () => {
      await db.asUser(U.opDubai, async (query) => {
        await query(`select inv_receive_stock('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ item_id: IT.screws, qty: 1 }])})`);
        await commit(U.founder, `select inv_revoke_access('${U.opDubai}', '${CO.uae}')`);
        await expect(query(`select inv_receive_stock('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ item_id: IT.screws, qty: 1 }])})`)).rejects.toThrow(/not set up to work/);
      });
      expect(await q(U.opDubai, `select 1 from inv_units`)).toHaveLength(0);
      await expect(rec(U.opDubai)).rejects.toThrow(/not set up to work/);
      await commit(U.founder, `select inv_grant_access('${U.opDubai}', '${CO.uae}', '{warehouse}'::text[])`);
      await expect(rec(U.opDubai)).rejects.toThrow(/not set up to work/);                                         // revoking also ended the locations
      await commit(U.accessMgr, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.dubai}}')`);
      await rec(U.opDubai);
    });
    it("stops an operator whose location is taken away, and one whose account is deactivated", async () => {
      await commit(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.opPoznan}', '{}')`);
      await expect(rec(U.opPoznan, L.poznan)).rejects.toThrow(/not set up to work/);
      await commit(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.opPoznan}', '{${L.poznan}}')`);
      await rec(U.opPoznan, L.poznan);
      await admin(`update profiles set is_active = false where id = '${U.opPoznan}'`);
      await expect(rec(U.opPoznan, L.poznan)).rejects.toThrow(/not set up to work/);
      await admin(`update profiles set is_active = true where id = '${U.opPoznan}'`);
      await rec(U.opPoznan, L.poznan);
    });
    it("takes away cost visibility the same way, and a location switched off cannot be worked at", async () => {
      expect(await q(U.costCatalog, `select 1 from inv_costs`)).not.toHaveLength(0);
      await commit(U.founder, `select inv_grant_access('${U.costCatalog}', '${CO.uae}', '{manage_catalogue}'::text[])`);
      expect(await q(U.costCatalog, `select 1 from inv_costs`)).toHaveLength(0);
      await commit(U.founder, `select inv_grant_access('${U.costCatalog}', '${CO.uae}', '{manage_catalogue,view_costs}'::text[])`);
      expect(await q(U.costCatalog, `select 1 from inv_costs`)).not.toHaveLength(0);
      const spare = await call<string>(U.founder, `inv_save_location('${CO.uae}', null, 'TMP', 'Temporary', 'Asia/Dubai')`);
      await commit(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.dubai},${spare}}')`);
      await rec(U.opDubai, spare);
      await expect(call(U.founder, `inv_save_location('${CO.uae}', '${spare}', 'TMP', 'Temporary', 'Asia/Dubai', 'warehouse', null, false)`)).rejects.toThrow(/still holds stock/);
      await call(U.opDubai, `inv_adjust_stock('${CO.uae}', '${spare}', '${key()}', 'retire', ${j([{ item_id: IT.screws, qty: 1 }])}, 'test stock written off')`);
      await call(U.founder, `inv_save_location('${CO.uae}', '${spare}', 'TMP', 'Temporary', 'Asia/Dubai', 'warehouse', null, false)`);
      await expect(rec(U.opDubai, spare)).rejects.toThrow(/switched off/);
      await commit(U.founder, `select inv_set_operator_locations('${CO.uae}', '${U.opDubai}', '{${L.dubai}}')`);
    });
    it("lets a founder pause Inventory for a company: every write is refused, reads still work, then switching on restores it", async () => {
      await commit(U.founder, `select inv_set_enabled('${CO.uae}', false)`);
      await expect(rec(U.opDubai)).rejects.toThrow(/switched off/);
      await expect(call(U.counter, `inv_start_count('${CO.uae}', '${L.dubai}', 'cycle')`)).rejects.toThrow(/switched off/);
      expect(await q(U.opDubai, `select 1 from inv_units`)).not.toHaveLength(0);
      await commit(U.founder, `select inv_set_enabled('${CO.uae}', true)`);
      await rec(U.opDubai);
    });
  });
});
