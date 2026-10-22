import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// supabase/manual-sql/inv_80_safe_disable_and_restore.sql, run as the owner would run it (the real file; each section is switched on by
// removing the two dashes of its statement lines, exactly as the file's header says), against a real Postgres built from every
// migration with a real founder, real stock and an imported HR asset. Proves:
//   * with the switch off, every Inventory function that changes something refuses in plain words, the database enforces it
//     (no table row changes), and reading keeps working (tables, availability, My equipment, HR's outstanding view, ledger check);
//   * access management stays usable so a founder can always switch it back on;
//   * restoring re-enables writes, nothing was lost or changed, per-company switching works, the audit-based restore leaves a company
//     that a founder switched off in the app alone, and "restore all" brings it back;
//   * what the header promises stays true while off: an imported HR asset stays managed by Inventory; finishing a project still frees its
//     unused reservations; the status list is read-only.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const FIRST_INV_MIGRATION = "20261201000000_inv_access_audit_settings.sql";
const INV_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f >= FIRST_INV_MIGRATION && f.startsWith("20261201") && f.endsWith(".sql")).sort();
const ADMIN_URL = process.env.RLS_TEST_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const DISABLE_SQL = readFileSync(path.join(REPO_ROOT, "supabase", "manual-sql", "inv_80_safe_disable_and_restore.sql"), "utf8");
const BOOTSTRAP_SQL = readFileSync(path.join(REPO_ROOT, "supabase", "manual-sql", "inv_30_bootstrap_founders.sql"), "utf8");

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), ksaFounder: id(), op: id(), alice: id(), hrAdmin: id(), pm: id() };
const E = { alice: id() };
const A = { laptop: id() };
const PRJ = { open: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k.toLowerCase()}@inv-disable-test.ae')`).join(", ");
const SWITCHED_OFF = /switched off/i;

/** The statement lines of one section of inv_80: the lines directly after its header that start with "--" and four spaces. */
function section(prefix: string, tweak: (s: string) => string = (s) => s): string {
  const lines = DISABLE_SQL.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`-- ${prefix} `));
  expect(start, `section ${prefix} exists`).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = /^--    (.*)$/.exec(l);
    if (!m) break;
    out.push(m[1]!);
  }
  expect(out.length, `section ${prefix} has statement lines`).toBeGreaterThan(0);
  return tweak(out.join("\n"));
}

describe("Inventory safe disable and restore (inv_80)", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as Rows<T>);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as Rows<T>);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const call = async <T = Row>(user: string, sql: string): Promise<T> => (await commit<{ r: T }>(user, `select ${sql} as r`))[0].r;
  const fails = (user: string, sql: string, re: RegExp = SWITCHED_OFF) => expect(q(user, sql)).rejects.toThrow(re);
  const key = () => `key-${id()}`;
  const j = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  const enabled = async (co: string) => (await admin<{ e: boolean }>(`select is_enabled e from inv_company_settings where company_id = '${co}'`))[0].e;
  /** the status list of the file itself (section 3 is the last statement of the file and always runs) */
  const statusList = async () => {
    const sql = DISABLE_SQL.slice(DISABLE_SQL.indexOf("select c.legal_name as company,"));
    return admin<Row>(sql.replace(/;\s*$/, ""));
  };
  /** every Inventory row except the switch itself and the audit log (which records the switch) */
  const fingerprint = async () => {
    const tables = (await admin<{ relname: string }>(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'inv\\_%'
      and relname not in ('inv_company_settings', 'inv_audit_log') order by relname`)).map((r) => r.relname);
    const out: Record<string, string> = {};
    for (const t of tables) out[t] = (await admin<{ fp: string }>(`select count(*) || ':' || md5(coalesce(string_agg(x::text, ',' order by x::text), '')) fp from ${t} x`))[0].fp;
    return JSON.stringify(out);
  };
  const hrFingerprint = async () =>
    JSON.stringify(await admin(`select (select md5(string_agg(a::text, ',' order by a.id::text)) from assets a) assets,
      (select md5(string_agg(a::text, ',' order by a.id::text)) from asset_assignments a) assignments,
      (select md5(string_agg(e::text, ',' order by e.id::text)) from employees e) employees,
      (select md5(string_agg(p::text, ',' order by p.id::text)) from proj_projects p where p.id <> '${PRJ.open}') projects`));
  const readOnly = async (sql: string) => {
    const url = new URL(ADMIN_URL);
    url.pathname = `/${db.dbName}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query("begin read only");
      try {
        const res = (await c.query(sql)) as unknown as { rows: Row[] };
        return res.rows;
      } finally {
        await c.query("rollback");
      }
    } finally {
      await c.end();
    }
  };

  let locA = "", item = "", cable = "", unitId = "", countId = "", reqId = "", asset = "";
  let before = "";

  beforeAll(async () => {
    await db.setupBefore(FIRST_INV_MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into user_roles (user_id, role) values ('${U.hrAdmin}', 'hr_admin');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status) values
        ('${E.alice}', '${U.alice}', 'AE-001', '${CO.uae}', 'AE', 'Alice', 'Anders', '2023-01-01', 'active');
      insert into assets (id, company_id, asset_tag, category, description, purchase_date, value, status) values
        ('${A.laptop}', '${CO.uae}', 'LAP-001', 'laptop', 'Laptop A', '2024-01-01', 4000, 'in_stock');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.uae}', '{}');
      insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${PRJ.open}', '${CO.uae}', 'UAE-P-T1', 'Alpha stage', 'internal', 'in_progress', '${U.pm}', '${U.pm}');
      insert into proj_project_details (project_id, site_timezone) values ('${PRJ.open}', 'Asia/Dubai');
      alter default privileges in schema public grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
      alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;
    `);
    for (const f of INV_MIGRATIONS) await db.applyMigration(f);
    // founders by the REAL bootstrap script (no other way to create the first founder)
    const ph = "    'REPLACE-WITH-FOUNDER-EMAIL@yourcompany.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID'\n";
    expect(BOOTSTRAP_SQL).toContain(ph);
    await db.seed(BOOTSTRAP_SQL
      .replace(ph, () => `    '${"founder"}@inv-disable-test.ae => Enginious UAE',\n    'ksafounder@inv-disable-test.ae => Enginious KSA'\n`)
      .replace("v_codes constant text[] := array[]::text[];", () => "v_codes constant text[] := array['Enginious UAE => UAE', 'Enginious KSA => KSA'];"));
    await db.seed(`insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.op}', '${CO.uae}', '{warehouse,cross_location}')`);

    // real setup through the app functions
    locA = await call<string>(U.founder, `inv_save_location('${CO.uae}', null, 'DXB', 'Dubai warehouse', 'Asia/Dubai')`);
    item = await call<string>(U.founder, `inv_save_item('${CO.uae}', null, ${j({ name: "Laptop 14", tracking: "individual", status: "active" })})`);
    cable = await call<string>(U.founder, `inv_save_item('${CO.uae}', null, ${j({ name: "HDMI cable", tracking: "quantity", status: "active" })})`);
    unitId = (await call<Row>(U.founder, `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${item}', p_serial_number => 'SN-1', p_location_id => '${locA}')`)).unit_id
      ?? (await admin<{ id: string }>(`select id from inv_units limit 1`))[0].id;
    countId = (await call<Row>(U.founder, `inv_start_count('${CO.uae}', '${locA}', 'opening')`)).count_id;
    await commit(U.founder, `select inv_save_count_line('${countId}', 1, p_unit_id => '${unitId}')`);
    await commit(U.founder, `select inv_save_count_line('${countId}', 40, p_item_id => '${cable}')`);
    await call(U.founder, `inv_confirm_count('${CO.uae}', '${countId}', '${key()}')`);
    await call(U.founder, `inv_issue_to_employee('${CO.uae}', '${locA}', '${E.alice}', '${key()}', ${j([{ unit_id: unitId }])})`);
    asset = A.laptop;
    // a draft planning request for the open project, to prove the project triggers
    const [r] = await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone, needed_from, needed_until, expected_return_at)
      values ('${CO.uae}', 'UAE-R-90001', 'project', '${PRJ.open}', '${U.pm}', 'draft', 'Asia/Dubai', now() + interval '5 days', now() + interval '9 days', now() + interval '9 days') returning id`);
    reqId = r.id;
    before = await fingerprint();
  }, 180_000);

  afterAll(async () => {
    await db.teardown();
  });

  it("starts with Inventory on for both companies and real stock on record", async () => {
    expect(await enabled(CO.uae)).toBe(true);
    expect(await enabled(CO.ksa)).toBe(true);
    expect((await admin<{ n: string }>(`select count(*) n from inv_units where lifecycle = 'active'`))[0].n).toBe("1");
    expect((await admin<{ q: string }>(`select qty q from inv_balances where item_id = '${cable}' and holder_kind = 'warehouse'`))[0].q).toBe("40.000");
    // a control: a write works while on
    await call(U.founder, `inv_save_category('${CO.uae}', null, 'Cabling')`);
    before = await fingerprint();
  });

  it("the file as shipped changes nothing: only the status list runs, and it is read-only", async () => {
    const settingsBefore = JSON.stringify(await admin(`select * from inv_company_settings order by company_id`));
    const rows = await readOnly(DISABLE_SQL.slice(DISABLE_SQL.indexOf("select c.legal_name as company,")));
    expect(rows.map((r) => `${r.company}|${r.code}|${r.state}`)).toEqual(["Enginious KSA|KSA|ON", "Enginious UAE|UAE|ON"]);
    expect(JSON.stringify(await admin(`select * from inv_company_settings order by company_id`))).toBe(settingsBefore);
    // no statement line is active outside the final select: everything else in the file is a comment
    const active = DISABLE_SQL.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("--"));
    expect(active.join("\n").trimStart().startsWith("select c.legal_name as company,")).toBe(true);
    expect(active.every((l) => !/^\s*(update|delete|insert|drop|alter|truncate)\b/i.test(l))).toBe(true);
  });

  describe("section 1: switch off every company", () => {
    it("switches both companies off and the status list says so", async () => {
      await admin(section("1."));
      expect(await enabled(CO.uae)).toBe(false);
      expect(await enabled(CO.ksa)).toBe(false);
      const rows = await statusList();
      expect(rows.map((r) => `${r.company}|${r.state.split(" ")[0]}`)).toEqual(["Enginious KSA|OFF", "Enginious UAE|OFF"]);
      expect(rows.every((r) => /by the owner in the SQL Editor/.test(r.last_switch))).toBe(true);
    });

    it("every Inventory function that changes something refuses, in plain words, for a founder", async () => {
      const calls: string[] = [
        `inv_save_location('${CO.uae}', null, 'POZ', 'Second warehouse', 'Europe/Warsaw')`,
        `inv_save_bin('${locA}', null, 'A-01', 'Shelf A1')`,
        `inv_save_category('${CO.uae}', null, 'Audio')`,
        `inv_save_item('${CO.uae}', null, ${j({ name: "Rope", tracking: "quantity" })})`,
        `inv_replace_item('${item}', ${j({ name: 'Laptop 15' })}, 'x')`,
        `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${item}', p_serial_number => 'SN-2', p_location_id => '${locA}')`,
        `inv_ensure_bin_label('${CO.uae}', '${cable}', '${locA}', null)`,
        `inv_start_count('${CO.uae}', '${locA}', 'cycle')`,
        `inv_save_count_line('${countId}', 1, p_item_id => '${cable}')`,
        `inv_confirm_count('${CO.uae}', '${countId}', '${key()}')`,
        `inv_cancel_count('${CO.uae}', '${countId}', 'x')`,
        `inv_receive_stock('${CO.uae}', '${locA}', '${key()}', ${j([{ item_id: cable, qty: 5 }])}, null)`,
        `inv_issue_to_employee('${CO.uae}', '${locA}', '${E.alice}', '${key()}', ${j([{ item_id: cable, qty: 1 }])})`,
        `inv_return_from_employee('${CO.uae}', '${locA}', '${E.alice}', '${key()}', ${j([{ unit_id: unitId }])})`,
        `inv_dispatch_to_project('${CO.uae}', '${locA}', '${PRJ.open}', '${key()}', ${j([{ item_id: cable, qty: 1 }])}, null, now() + interval '3 days')`,
        `inv_return_from_project('${CO.uae}', '${locA}', '${PRJ.open}', '${key()}', ${j([{ item_id: cable, qty: 1 }])})`,
        `inv_consume('${CO.uae}', '${locA}', '${key()}', ${j([{ item_id: cable, qty: 1 }])}, null, null, null, 'x')`,
        `inv_repair_out('${CO.uae}', '${locA}', '${key()}', ${j([{ unit_id: unitId }])}, 'REF', null, 'x')`,
        `inv_adjust_stock('${CO.uae}', '${locA}', '${key()}', 'missing', ${j([{ unit_id: unitId }])}, 'x')`,
        `inv_check_condition('${CO.uae}', '${locA}', '${key()}', ${j([{ unit_id: unitId, condition: "good" }])}, 'x')`,
        `inv_pack_kit('${CO.uae}', '${locA}', '${key()}', '${unitId}', ${j([])}, 'x')`,
        `inv_reassign_unit('${unitId}', 'pool', null, 'x', '${key()}')`,
        `inv_save_technology('${CO.uae}', null, 'Wall', 'recipe')`,
        `inv_create_request('project', '${PRJ.open}', null, 'x', null, 'Asia/Dubai')`,
        `inv_submit_request('${reqId}')`,
        `inv_cancel_request('${reqId}', 'x')`,
        `inv_add_request_line('${reqId}', '${cable}', 2, 'x')`,
        `inv_set_operator_locations('${CO.uae}', '${U.op}', array['${locA}']::uuid[])`,
        `inv_set_company_sharing('${CO.uae}', '${CO.ksa}', true, 'x')`,
        `inv_import_legacy_assets('${CO.uae}', ${j([{ asset_id: asset, item_id: item, location_id: locA }])})`,
      ];
      for (const c of calls) {
        // each is attempted as the founder; the message must say the switch is off (not a different, accidental, error)
        await expect(q(U.founder, `select ${c}`), c).rejects.toThrow(SWITCHED_OFF);
      }
    });

    it("a warehouse operator is refused too, and nothing in any Inventory table changed", async () => {
      await fails(U.op, `select inv_receive_stock('${CO.uae}', '${locA}', '${key()}', ${j([{ item_id: cable, qty: 5 }])}, null)`);
      await fails(U.op, `select inv_start_count('${CO.uae}', '${locA}', 'cycle')`);
      expect(await fingerprint()).toBe(before);
    });

    it("reading keeps working: tables, availability, My equipment, HR's outstanding view, the ledger check", async () => {
      expect((await q<{ n: string }>(U.founder, `select count(*) n from inv_units`))[0].n).toBe("1");
      expect(Number((await q<{ n: string }>(U.founder, `select count(*) n from inv_balances`))[0].n)).toBeGreaterThanOrEqual(1);
      expect(Number((await q<{ n: string }>(U.founder, `select count(*) n from inv_movements`))[0].n)).toBeGreaterThan(0);
      expect((await q<{ n: string }>(U.op, `select count(*) n from inv_items`))[0].n).toBe("2");
      const mine = await q(U.alice, `select code, item_name, kind from inv_my_equipment()`);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ item_name: "Laptop 14", kind: "unit" });
      expect((await q(U.founder, `select * from inv_employee_outstanding('${CO.uae}', null, true)`)).length).toBeGreaterThanOrEqual(1);
      expect(await q(U.founder, `select * from inv_availability('${item}', '${locA}', now() + interval '10 days', now() + interval '11 days')`)).toBeTruthy();
      expect(await q(U.founder, `select * from inv_ledger_problems()`).catch(() => [])).toEqual([]);
      expect((await q(U.founder, `select * from inv_preview_legacy_assets('${CO.uae}')`))).toHaveLength(1);
    });

    it("access management stays usable, so a founder is never locked out of switching it back on", async () => {
      const g = await call<string>(U.founder, `inv_grant_access('${U.pm}', '${CO.uae}', '{view_stock}', 'while off')`);
      expect(g).toBeTruthy();
      await call(U.founder, `inv_revoke_access('${U.pm}', '${CO.uae}')`);
      await call(U.founder, `inv_set_company_code('${CO.uae}', 'UAE')`);
      expect(await enabled(CO.uae)).toBe(false);
    });

    it("an HR asset a founder imported stays managed by Inventory while off, and unlinked assets are untouched", async () => {
      // import while on (in section 4 below the switch is on again); here the first part: nothing is linked yet, HR edits work
      const hr = await hrFingerprint();
      await admin(`update assets set description = 'Laptop A (edited by HR)' where id = '${asset}'`);
      await admin(`update assets set description = 'Laptop A' where id = '${asset}'`);
      expect(await hrFingerprint()).toBe(hr);
    });

    it("finishing a project still frees its unused reservations, and the project itself completes", async () => {
      await admin(`update proj_projects set status = 'completed', completed_at = now() where id = '${PRJ.open}'`);
      expect((await admin<{ status: string }>(`select status from proj_projects where id = '${PRJ.open}'`))[0].status).toBe("completed");
      expect((await admin<{ status: string }>(`select status from inv_requests where id = '${reqId}'`))[0].status).toBe("cancelled");
      before = await fingerprint();
    });
  });

  describe("section 2: switch back on exactly what the script switched off", () => {
    it("re-enables both companies; the stock books are exactly as they were; writes work again", async () => {
      const hr = await hrFingerprint();
      await admin(section("2."));
      expect(await enabled(CO.uae)).toBe(true);
      expect(await enabled(CO.ksa)).toBe(true);
      expect(await fingerprint()).toBe(before);
      expect(await hrFingerprint()).toBe(hr);
      expect((await statusList()).map((r) => r.state)).toEqual(["ON", "ON"]);
      await call(U.founder, `inv_save_location('${CO.uae}', null, 'POZ', 'Second warehouse', 'Europe/Warsaw')`);
      await call(U.op, `inv_receive_stock('${CO.uae}', '${locA}', '${key()}', ${j([{ item_id: cable, qty: 5 }])}, null)`);
      expect((await admin<{ q: string }>(`select qty q from inv_balances where item_id = '${cable}' and holder_kind = 'warehouse'`))[0].q).toBe("45.000");
      expect((await admin<{ n: string }>(`select count(*) n from inv_audit_log a where a.table_name = 'inv_company_settings' and a.action = 'update' and a.actor_id is null`))[0].n).toBe("4");
      before = await fingerprint();
    });

    it("ledger and audit history from before the pause are intact and still reconcile", async () => {
      expect(await q(U.founder, `select * from inv_ledger_problems()`)).toEqual([]);
      expect(Number((await admin<{ n: string }>(`select count(*) n from inv_movements`))[0].n)).toBeGreaterThanOrEqual(3);
      expect((await admin<{ n: string }>(`select count(*) n from inv_units where code = (select code from inv_units limit 1)`))[0].n).toBe("1");
    });
  });

  describe("section 1b / 2c: one company at a time", () => {
    it("switches off only the named company and leaves the other fully working", async () => {
      await admin(section("1b.", (s) => s.replace("REPLACE-WITH-COMPANY-LEGAL-NAME", "Enginious KSA")));
      expect(await enabled(CO.ksa)).toBe(false);
      expect(await enabled(CO.uae)).toBe(true);
      await fails(U.ksaFounder, `select inv_save_location('${CO.ksa}', null, 'RUH', 'Riyadh', 'Asia/Riyadh')`);
      await call(U.founder, `inv_save_category('${CO.uae}', null, 'Lighting')`);
      before = await fingerprint();
    });
    it("section 2c switches that one company back on", async () => {
      await admin(section("2c.", (s) => s.replace("REPLACE-WITH-COMPANY-LEGAL-NAME", "Enginious KSA")));
      expect(await enabled(CO.ksa)).toBe(true);
      await call(U.ksaFounder, `inv_save_location('${CO.ksa}', null, 'RUH', 'Riyadh', 'Asia/Riyadh')`);
    });
    it("an unknown company name changes nothing", async () => {
      await admin(section("1b.", (s) => s.replace("REPLACE-WITH-COMPANY-LEGAL-NAME", "Atlantis")));
      expect(await enabled(CO.ksa)).toBe(true);
      expect(await enabled(CO.uae)).toBe(true);
      await admin(section("2c.", (s) => s.replace("REPLACE-WITH-COMPANY-LEGAL-NAME", "Atlantis")));
      expect(await enabled(CO.uae)).toBe(true);
    });
  });

  describe("a company switched off by a founder in the app is not touched by the owner's restore (section 2), but section 2b brings it back", () => {
    it("the founder switches UAE off in the app; the owner pauses KSA with the script", async () => {
      await call(U.founder, `inv_set_enabled('${CO.uae}', false)`);
      await admin(section("1b.", (s) => s.replace("REPLACE-WITH-COMPANY-LEGAL-NAME", "Enginious KSA")));
      expect(await enabled(CO.uae)).toBe(false);
      expect(await enabled(CO.ksa)).toBe(false);
      const rows = await statusList();
      const uae = rows.find((r) => r.company === "Enginious UAE")!;
      const ksa = rows.find((r) => r.company === "Enginious KSA")!;
      expect(uae.last_switch).toContain("founder@inv-disable-test.ae");
      expect(ksa.last_switch).toContain("by the owner in the SQL Editor");
    });
    it("section 2 restores only the company the script paused", async () => {
      await admin(section("2."));
      expect(await enabled(CO.ksa)).toBe(true);
      expect(await enabled(CO.uae)).toBe(false);
      await fails(U.founder, `select inv_save_category('${CO.uae}', null, 'Rigging')`);
    });
    it("section 2b restores every company that is off, whoever switched it off", async () => {
      await admin(section("2b."));
      expect(await enabled(CO.uae)).toBe(true);
      expect(await enabled(CO.ksa)).toBe(true);
      await call(U.founder, `inv_save_category('${CO.uae}', null, 'Rigging')`);
    });
  });

  describe("a linked HR asset while off", () => {
    it("is imported while on, and stays managed by Inventory (the HR guard still refuses) while Inventory is off and after it is back on", async () => {
      const res = await call<Row>(U.founder, `inv_import_legacy_assets('${CO.uae}', ${j([{ asset_id: asset, item_id: item, location_id: locA }])})`);
      expect(res).toMatchObject({ created: 1, skipped: 0 });
      const refused = /managed in Inventory/;
      await expect(admin(`update assets set description = 'x' where id = '${asset}'`)).rejects.toThrow(refused);
      await admin(section("1."));
      await expect(admin(`update assets set description = 'x' where id = '${asset}'`)).rejects.toThrow(refused);
      await expect(admin(`insert into asset_assignments (asset_id, employee_id, issued_date, issued_by) values ('${asset}', '${E.alice}', current_date, '${U.hrAdmin}')`)).rejects.toThrow(refused);
      await admin(section("2."));
      await expect(admin(`update assets set description = 'x' where id = '${asset}'`)).rejects.toThrow(refused);
      // the status list is a read-only query
      expect((await readOnly(DISABLE_SQL.slice(DISABLE_SQL.indexOf("select c.legal_name as company,")))).length).toBe(2);
    });
  });

  describe("known limitation (documented in docs/inventory-deployment.md): HR's permanent delete of an employee who only has Inventory records", () => {
    it("fails with a raw foreign-key error and deletes nothing (it does not know about Inventory records)", async () => {
      // Alice holds a unit issued through Inventory and has no other HR history; she is first removed (soft delete), as permanent delete requires.
      await admin(`update employees set deleted_at = now() where id = '${E.alice}'`);
      const heldBefore = (await admin<{ n: string }>(`select count(*) n from inv_units where employee_id = '${E.alice}'`))[0].n;
      expect(Number(heldBefore)).toBeGreaterThanOrEqual(1);
      let message = "";
      try {
        await commit(U.hrAdmin, `select permanently_delete_employee('${E.alice}')`);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/violates foreign key constraint/);
      expect(message).toMatch(/inv_/);
      expect(message).not.toMatch(/Cannot permanently delete/);   // HR's own plain-words refusal does not fire: it does not list Inventory
      expect((await admin<{ n: string }>(`select count(*) n from employees where id = '${E.alice}'`))[0].n).toBe("1");
      expect((await admin<{ n: string }>(`select count(*) n from inv_units where employee_id = '${E.alice}'`))[0].n).toBe(heldBefore);
      await admin(`update employees set deleted_at = null where id = '${E.alice}'`);
    });
  });
});
