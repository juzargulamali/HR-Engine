import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The owner's Inventory scripts (supabase/manual-sql/inv_*.sql), run unmodified against a throwaway database that looks like
// production BEFORE the Inventory install: every earlier migration applied, real HR / Sales / Projects data, Supabase-style default
// privileges. Proves:
//   * preflight (inv_00): read-only, reports prerequisites, companies, the HR asset register, candidate founders as information only;
//   * preservation (inv_05): snapshot BEFORE, install the real Inventory migrations (setupBefore + applyMigration), compare AFTER:
//     every row SAME except the documented intended items (the four triggers), legitimate HR / Projects activity between the two runs
//     is not flagged, and real changes ARE caught (policy, column, asset edit, extra trigger, dropped intended trigger, bucket...);
//   * verify (inv_20): every row OK on a fresh install, read-only, and it FAILS for each kind of drift;
//   * bootstrap (inv_30): refuses placeholders and bad input, grants only what was typed, idempotent, creates no stock/location/category;
//   * rollback (inv_90): on a fresh install it removes everything and a snapshot taken before the install matches again; with data it
//     refuses, and needs both switches to destroy it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const MANUAL_DIR = path.join(REPO_ROOT, "supabase", "manual-sql");
const FIRST_INV_MIGRATION = "20261201000000_inv_access_audit_settings.sql";
const INV_MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f >= FIRST_INV_MIGRATION && f.startsWith("20261201") && f.endsWith(".sql")).sort();
const ADMIN_URL = process.env.RLS_TEST_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const script = (name: string) => readFileSync(path.join(MANUAL_DIR, name), "utf8");
const PREFLIGHT = script("inv_00_preflight_readonly.sql");
const PRESERVATION = script("inv_05_preservation_check_readonly.sql");
const VERIFY = script("inv_20_verify_readonly.sql");
const BOOTSTRAP = script("inv_30_bootstrap_founders.sql");
const ROLLBACK = script("inv_90_rollback.sql");

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { ceo: id(), salesFounder: id(), projFounder: id(), founderOne: id(), founderTwo: id(), worker: id(), hrAdmin: id(), pm: id(), outsider: id() };
const E = { alice: id(), carl: id() };
const A = { laptop1: id(), laptop2: id(), phone: id(), ksaLaptop: id() };
const PRJ = { early: id(), later: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k.toLowerCase()}@inv-owner-test.ae')`).join(", ");
const EMAIL = (k: keyof typeof U) => `${k.toLowerCase()}@inv-owner-test.ae`;

const SEED_HR = `
  insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
  insert into companies (id, legal_name, country_code, default_currency) values
    ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
  insert into auth.users (id, email) values ${SQL_USERS};
  insert into user_roles (user_id, role) values ('${U.ceo}', 'ceo'), ('${U.hrAdmin}', 'hr_admin');
  insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status, termination_date) values
    ('${E.alice}', '${U.worker}', 'AE-001', '${CO.uae}', 'AE', 'Alice', 'Anders', '2023-01-01', 'active', null),
    ('${E.carl}', null, 'AE-002', '${CO.uae}', 'AE', 'Carl', 'Clark', '2021-01-01', 'terminated', '2026-01-01');
  insert into assets (id, company_id, asset_tag, category, description, purchase_date, value, status) values
    ('${A.laptop1}', '${CO.uae}', 'LAP-001', 'laptop', 'Laptop A', '2024-01-01', 4000, 'issued'),
    ('${A.laptop2}', '${CO.uae}', 'LAP-002', 'laptop', 'Laptop B', '2024-01-01', 4100, 'issued'),
    ('${A.phone}', '${CO.uae}', 'PHN-001', 'phone', 'Phone', '2024-03-01', 900, 'in_stock'),
    ('${A.ksaLaptop}', '${CO.ksa}', 'LAP-901', 'laptop', 'Laptop K', '2024-01-01', 3900, 'in_stock');
  insert into asset_assignments (asset_id, employee_id, issued_date, returned_date, issued_by) values
    ('${A.laptop1}', '${E.alice}', '2025-01-01', null, '${U.hrAdmin}'),
    ('${A.laptop2}', '${E.carl}', '2024-06-01', null, '${U.hrAdmin}');
  insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'ENG', 'AED');
  insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.salesFounder}', '${CO.uae}', '{founder}');
  insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.projFounder}', '${CO.uae}', '{founder}'), ('${U.pm}', '${CO.uae}', '{}');
  insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
    ('${PRJ.early}', '${CO.uae}', 'UAE-P-T1', 'Alpha stage', 'internal', 'in_progress', '${U.pm}', '${U.pm}');
  insert into proj_project_details (project_id, site_timezone) values ('${PRJ.early}', 'Asia/Dubai');
`;
// What a real Supabase project does for every new object in public: broad default grants. The migrations must undo them themselves.
const SUPABASE_DEFAULTS = `
  alter default privileges in schema public grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
  alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

async function newClient(db: RlsTestDatabase): Promise<Client> {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${db.dbName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}
/** Runs a script (possibly several statements) and returns the rows of its LAST statement, plus the notices it raised. */
async function run(client: Client, sql: string): Promise<{ rows: Row[]; notices: string[] }> {
  const notices: string[] = [];
  const onNotice = (n: { message?: string }) => notices.push(String(n.message));
  client.on("notice", onNotice);
  try {
    const res = (await client.query(sql)) as unknown as { rows: Row[] } | { rows: Row[] }[];
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    return { rows: last?.rows ?? [], notices };
  } finally {
    client.off("notice", onNotice);
  }
}
async function withClient<T>(db: RlsTestDatabase, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await newClient(db);
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
/** Runs a script inside `begin read only` (the database itself refuses any write) and rolls back. */
const readOnly = (db: RlsTestDatabase, sql: string) =>
  withClient(db, async (c) => {
    await c.query("begin read only");
    try {
      return (await run(c, sql)).rows;
    } finally {
      await c.query("rollback");
    }
  });
/** Applies `change` and runs `sql` inside one transaction, then rolls the change back. */
const withChange = (db: RlsTestDatabase, change: string, sql: string) =>
  withClient(db, async (c) => {
    await c.query("begin");
    try {
      await c.query(change);
      return (await run(c, sql)).rows;
    } finally {
      await c.query("rollback");
    }
  });
const withPaste = (sql: string, snapshot: Row[]) => {
  const needle = "    ('__none__', '')";
  expect(sql).toContain(needle);
  const lines = snapshot.map((r) => r.paste).filter((p): p is string => typeof p === "string" && p.startsWith("(")).join("\n    ");
  return sql.replace(needle, () => `${lines}\n${needle}`);
};
const verdicts = (rows: Row[]) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.verdict] = (out[r.verdict] ?? 0) + 1;
  return out;
};
const summary = (rows: Row[]) => String(rows.find((r) => r.item === "SUMMARY")?.verdict ?? "");
const notSame = (rows: Row[]) => rows.filter((r) => r.verdict !== "SAME" && r.item !== "SUMMARY").map((r) => `${r.item}=${r.verdict}`);
const counts = async (db: RlsTestDatabase, withoutInventory = false) =>
  JSON.stringify((await db.seed(`select c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname), false, true, '')))[1]::text as n
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' ${withoutInventory ? "and c.relname !~ '^inv_'" : ""} order by c.relname`)).rows);

async function prepare(db: RlsTestDatabase): Promise<void> {
  await db.setupBefore(FIRST_INV_MIGRATION);
  await db.seed(SEED_HR);
  await db.seed(SUPABASE_DEFAULTS);
}
const installInventory = async (db: RlsTestDatabase) => {
  for (const f of INV_MIGRATIONS) await db.applyMigration(f);
};

describe("Inventory owner scripts: preflight, preservation, verify, bootstrap, rollback", () => {
  const db = new RlsTestDatabase();
  let snapshotRows: Row[] = [];
  let compareSql = "";
  let tablesBefore = "";

  beforeAll(async () => {
    await prepare(db);
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("preflight (inv_00), before the install", () => {
    it("is read-only: it runs inside a read-only transaction and no table count changes", async () => {
      tablesBefore = await counts(db);
      const rows = await readOnly(db, PREFLIGHT);
      expect(rows.length).toBeGreaterThan(40);
      expect(await counts(db)).toBe(tablesBefore);
    });

    it("reports every prerequisite as OK and no existing Inventory object", async () => {
      const rows = await readOnly(db, PREFLIGHT);
      const b = rows.filter((r) => r.section === "B prerequisites");
      expect(b.length).toBeGreaterThanOrEqual(55);
      expect(b.filter((r) => !String(r.detail).startsWith("OK"))).toEqual([]);
      expect(rows.filter((r) => String(r.section).startsWith("C ")).map((r) => r.detail)).toEqual(["OK - no Inventory tables or functions exist yet"]);
    });

    it("lists the companies, the candidate founders as information only, and the HR asset register", async () => {
      const rows = await readOnly(db, PREFLIGHT);
      const sec = (prefix: string) => rows.filter((r) => String(r.section).startsWith(prefix));
      expect(sec("D companies").map((r) => r.item).sort()).toEqual(["Enginious KSA (SA)", "Enginious UAE (AE)"]);
      const codes = sec("D reference codes").find((r) => r.item === "Enginious UAE")!;
      expect(codes.detail).toContain("Sales code: ENG");
      expect(codes.detail).toContain("nothing is copied");
      expect(sec("E Projects founders").map((r) => r.item).join(" ")).toContain(EMAIL("projFounder"));
      expect(sec("E Sales founders").map((r) => r.item).join(" ")).toContain(EMAIL("salesFounder"));
      expect(sec("E CEO / CTO").map((r) => r.item).join(" ")).toContain(EMAIL("ceo"));
      // never a default: nobody in the founder lists is "granted", and the note says so
      expect(sec("E candidate founders")[0]!.detail).toMatch(/INFORMATION ONLY/);
      expect(rows.some((r) => /GRANT|will be given|default founder/i.test(String(r.detail)) && String(r.section).startsWith("E "))).toBe(false);
      // HR asset register
      const byStatus = sec("F HR assets by company and status").map((r) => `${r.item}: ${r.detail}`);
      expect(byStatus.join("\n")).toContain("Enginious UAE / issued: 2 asset(s)");
      expect(byStatus.join("\n")).toContain("Enginious UAE / in_stock: 1 asset(s)");
      expect(byStatus.join("\n")).toContain("Enginious KSA / in_stock: 1 asset(s)");
      expect(sec("F HR assets: open assignments").map((r) => r.detail)).toEqual(["2", "2", "0"]);
      const inactive = sec("F HR assets: held by people no longer active").filter((r) => r.item !== "(end of list)");
      expect(inactive).toHaveLength(1);
      expect(inactive[0]!.item).toContain("LAP-002");
      expect(inactive[0]!.detail).toContain("Carl Clark");
      expect(sec("I HR, Sales and Projects row counts").find((r) => r.item === "assets")!.detail).toBe("4");
      expect(sec("F default privileges").length + sec("G default privileges").length).toBeGreaterThan(0);
    });
  });

  describe("preservation (inv_05): snapshot, install, compare", () => {
    it("snapshot mode: read-only, every row SNAPSHOT, one paste line per fingerprint, the four triggers shown as not present", async () => {
      snapshotRows = await readOnly(db, PRESERVATION);
      expect(summary(snapshotRows)).toMatch(/^SNAPSHOT TAKEN/);
      const pasted = snapshotRows.filter((r) => typeof r.paste === "string" && r.paste.startsWith("("));
      expect(pasted.length).toBeGreaterThan(60);
      expect(pasted[0]!.paste).toMatch(/^\('cutoff', /);
      expect(snapshotRows.filter((r) => String(r.item).startsWith("struct:")).every((r) => r.verdict === "SNAPSHOT")).toBe(true);
      // the HR asset register has no creation dates, so ALL rows are fingerprinted
      for (const k of ["data:assets:ids", "data:assets:content", "data:asset_assignments:ids", "data:asset_assignments:content"]) {
        expect(snapshotRows.find((r) => r.item === k), k).toBeTruthy();
      }
      // Projects and Sales tables are covered too (everything not named inv_)
      expect(snapshotRows.some((r) => String(r.item).startsWith("data:proj_projects:"))).toBe(true);
      expect(snapshotRows.some((r) => String(r.item).startsWith("data:crm_audit_log:content"))).toBe(true);
      expect(snapshotRows.some((r) => String(r.item).startsWith("data:proj_audit_log:content"))).toBe(true);
      expect(snapshotRows.find((r) => r.item === "intended:four_triggers")!.now_value).toBe("0 present (Inventory is not installed)");
      expect(await counts(db)).toBe(tablesBefore);
    });

    it("legitimate HR and Projects activity between the two runs is not flagged, then the real Inventory migrations are applied", async () => {
      await db.seed(`
        insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date) values ('${id()}', 'AE-900', '${CO.uae}', 'AE', 'New', 'Hire', '2026-10-01');
        update employees set first_name = 'Alicia' where id = '${E.alice}';
        insert into proj_projects (id, company_id, reference, name, kind, status, pm_user_id, created_by) values
          ('${PRJ.later}', '${CO.uae}', 'UAE-P-T2', 'Beta arena', 'internal', 'in_progress', '${U.pm}', '${U.pm}');
        insert into proj_project_details (project_id, site_timezone) values ('${PRJ.later}', 'Asia/Dubai');
      `);
      await installInventory(db);
      expect(INV_MIGRATIONS.length).toBeGreaterThanOrEqual(7);
    });

    it("compare mode after the install: every row SAME except the documented intended items; summary PASS", async () => {
      compareSql = withPaste(PRESERVATION, snapshotRows);
      const rows = await readOnly(db, compareSql);
      const v = verdicts(rows);
      expect(v.DIFFERENT ?? 0).toBe(0);
      expect(v.NEW ?? 0).toBe(0);
      expect(summary(rows)).toMatch(/^PASS: nothing HR, Sales, Projects or the HR asset register own changed \(\d+ fingerprints identical\); the only additions to existing tables are the 4 intended Inventory triggers/);
      // everything that is not SAME is documented: the cutoff, the "rows created after" information, nothing else
      const other = rows.filter((r) => r.verdict !== "SAME" && r.item !== "SUMMARY" && r.verdict !== "INFO");
      expect(other).toEqual([]);
      const info = rows.filter((r) => r.verdict === "INFO").map((r) => r.item);
      expect(info.every((i) => i === "cutoff" || i.startsWith("info:"))).toBe(true);
      // the legitimate activity shows up as information, not as a difference
      expect(Number(rows.find((r) => r.item === "info:employees:rows_created_after_cutoff")!.now_value)).toBeGreaterThanOrEqual(1);
      expect(Number(rows.find((r) => r.item === "info:proj_projects:rows_created_after_cutoff")!.now_value)).toBeGreaterThanOrEqual(1);
      // the struct:triggers fingerprint (without inv_) is SAME and the intended block lists exactly the four triggers
      expect(rows.find((r) => r.item === "struct:triggers")!.verdict).toBe("SAME");
      const intended = rows.filter((r) => String(r.item).startsWith("intended:trigger:"));
      expect(intended.map((r) => r.item).sort()).toEqual([
        "intended:trigger:asset_assignments.inv_legacy_guard_assignments",
        "intended:trigger:assets.inv_legacy_guard_assets",
        "intended:trigger:proj_projects.inv_proj_projects_import",
        "intended:trigger:proj_projects.inv_proj_projects_release",
      ]);
      expect(intended.every((r) => r.verdict === "SAME")).toBe(true);
      expect(intended.every((r) => String(r.now_value).startsWith("CREATE TRIGGER inv_"))).toBe(true);
      const four = rows.find((r) => r.item === "intended:four_triggers")!;
      expect(four.verdict).toBe("SAME");
      expect(four.now_value).toBe("4 present");
      // all non-Inventory fingerprints, counted
      expect(v.SAME).toBeGreaterThan(80);
    });

    it("an extra Inventory object cannot hide: the real install added nothing outside inv_ except the four triggers (catalogue check)", async () => {
      const t = (await db.seed(`select c.relname, g.tgname from pg_trigger g join pg_class c on c.oid = g.tgrelid
        where not g.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname !~ '^inv_' and g.tgname ~ '^inv_' order by 1, 2`)).rows;
      expect(t).toHaveLength(4);
      // every public object that is not named inv_ and appeared after the snapshot would have made a struct row DIFFERENT; double check by name
      const stray = (await db.seed(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname ~ '^inv' and relname !~ '^inv_'`)).rows;
      expect(stray).toEqual([]);
    });

    const catches: [string, string, RegExp][] = [
      ["a new policy on an HR table", "create policy x_test on employees for select using (true);", /struct:policies=DIFFERENT/],
      ["a changed policy on a Projects table", "alter policy proj_projects_select on proj_projects using (true);", /struct:policies=DIFFERENT/],
      ["a new column on an HR table", "alter table employees add column x_new text;", /struct:columns=DIFFERENT/],
      ["a new column on a Projects table", "alter table proj_tasks add column zzz int;", /struct:columns=DIFFERENT/],
      ["a new column on the HR assets table", "alter table assets add column inv_marker text;", /struct:columns=DIFFERENT/],
      ["a changed HR function", "create or replace function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;", /struct:functions=DIFFERENT/],
      ["a privilege change on an HR table", "grant select on assets to authenticated;", /struct:table_privileges=DIFFERENT/],
      ["RLS switched off on a Sales table", "alter table crm_opportunities disable row level security;", /struct:rls_flags=DIFFERENT/],
      ["an edited asset row", `update assets set description = 'changed' where id = '${A.laptop1}'`, /data:assets:content=DIFFERENT/],
      ["a deleted asset assignment", `delete from asset_assignments where employee_id = '${E.alice}'`, /data:asset_assignments:ids=DIFFERENT/],
      ["an extra trigger on an HR table (not named inv_)", "create function t_x() returns trigger language plpgsql as $$ begin return new; end $$; create trigger sneaky before update on employees for each row execute function t_x();", /struct:triggers=DIFFERENT/],
      ["an extra inv_ trigger on an HR table (a fifth trigger)", "create function t_x() returns trigger language plpgsql as $$ begin return new; end $$; create trigger inv_sneaky before update on employees for each row execute function t_x();", /intended:four_triggers=DIFFERENT/],
      ["one of the four intended triggers dropped", "drop trigger inv_proj_projects_release on proj_projects;", /intended:four_triggers=DIFFERENT/],
      ["an intended trigger of a different kind", "drop trigger inv_legacy_guard_assets on assets; create trigger inv_legacy_guard_assets before insert on assets for each row execute function inv_legacy_guard();", /intended:trigger:assets\.inv_legacy_guard_assets=DIFFERENT/],
      ["a new storage bucket", "insert into storage.buckets (id, name, public) values ('inv-photos', 'inv-photos', false);", /struct:storage_buckets=DIFFERENT/],
      ["an old Projects row deleted", `delete from proj_project_details where project_id = '${PRJ.early}'; delete from proj_projects where id = '${PRJ.early}'`, /data:proj_projects:members_at_cutoff=DIFFERENT/],
    ];
    for (const [name, change, expected] of catches) {
      it(`catches ${name}`, async () => {
        const rows = await withChange(db, change, compareSql);
        expect(summary(rows)).toMatch(/^STOP/);
        expect(notSame(rows).filter((s) => !s.endsWith("=INFO")).join(" ")).toMatch(expected);
      });
    }

    it("is still all SAME after those rolled-back experiments", async () => {
      const rows = await readOnly(db, compareSql);
      expect(summary(rows)).toMatch(/^PASS/);
    });
  });

  describe("verify (inv_20), after the install and before any bootstrap", () => {
    it("is read-only and every row says OK (INFO rows are information), the summary says OK", async () => {
      const before = await counts(db);
      const rows = await readOnly(db, VERIFY);
      expect(await counts(db)).toBe(before);
      const bad = rows.filter((r) => !["OK", "INFO"].includes(r.result));
      expect(bad).toEqual([]);
      expect(rows.find((r) => r.check_name === "SUMMARY")!.result).toBe("OK");
      const ok = rows.filter((r) => r.result === "OK" && r.check_name !== "SUMMARY");
      expect(ok.length).toBeGreaterThanOrEqual(35);
      // the "what you should see next" block is there
      expect(rows.filter((r) => String(r.check_name).startsWith("WHAT YOU SHOULD SEE NEXT")).length).toBeGreaterThanOrEqual(5);
      // the counts of HR / Sales / Projects are shown for comparison with the preflight
      expect(rows.find((r) => r.check_name === "INFO: row count assets")!.detail).toBe("4");
      expect(rows.find((r) => r.check_name === "INFO: row count proj_projects")!.detail).toBe("2");
    });

    it("the empty-install checks really are enforced: no grant, no setting, no data row in any Inventory table", async () => {
      const total = (await db.seed(`select sum((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', c.relname), false, true, '')))[1]::text::int) as n
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'inv\\_%'`)).rows[0]!.n;
      expect(Number(total)).toBe(0);
      expect((await db.seed(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'inv\\_%'`)).rows[0]!.n).toBe(29);
    });

    const drifts: [string, string, RegExp][] = [
      ["INSERT granted to signed-in users on an Inventory table", "grant insert on inv_units to authenticated;", /INSERT \/ UPDATE \/ DELETE \/ TRUNCATE/],
      ["TRUNCATE granted to PUBLIC on an Inventory table", "grant truncate on inv_movements to public;", /INSERT \/ UPDATE \/ DELETE \/ TRUNCATE/],
      ["a privilege granted to anon on an Inventory table", "grant select on inv_items to anon;", /anon holds NO privilege/],
      ["the idempotency table opened to signed-in users", "grant select on inv_idempotency to authenticated;", /idempotency records and reference-code counters/],
      ["an Inventory sequence opened to signed-in users", "grant usage on sequence inv_audit_log_id_seq to authenticated;", /Inventory sequence/],
      ["row-level security switched off", "alter table inv_balances disable row level security;", /row-level security is ON/],
      ["a write policy added", "create policy inv_x_write on inv_items for insert with check (true);", /no INSERT \/ UPDATE \/ DELETE policy/],
      ["an internal helper opened to signed-in users", "grant execute on function inv_next_code(uuid, text) to authenticated;", /cannot execute any of the 65 internal helpers/],
      ["a plain internal helper opened to signed-in users", "grant execute on function inv_unit_move(uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid, timestamptz, text) to authenticated;", /cannot execute any of the 65 internal helpers/],
      ["a function opened to anon", "grant execute on function inv_has_access(uuid) to anon;", /anon and PUBLIC cannot execute/],
      ["a function opened to PUBLIC", "grant execute on function inv_grant_access(uuid, uuid, text[], text) to public;", /anon and PUBLIC cannot execute/],
      ["an app function closed to signed-in users", "revoke execute on function inv_save_item(uuid, uuid, jsonb) from authenticated;", /can execute all 83 functions/],
      ["a function without SECURITY DEFINER", "alter function inv_grant_access(uuid, uuid, text[], text) security invoker;", /SECURITY DEFINER with search_path pinned/],
      ["a function without a pinned search_path", "alter function inv_set_enabled(uuid, boolean) reset search_path;", /SECURITY DEFINER with search_path pinned/],
      ["an unknown Inventory function", "create function inv_sneaky() returns int language sql as 'select 1';", /one of the 148 expected/],
      ["a missing Inventory function", "drop function inv_user_name(uuid);", /one of the 148 expected/],
      ["the ledger immutability trigger dropped", "drop trigger inv_movements_immutable on inv_movements;", /ledger is immutable/],
      ["the unit rule trigger disabled", "alter table inv_units disable trigger inv_units_guard_trg;", /rule triggers on units and items/],
      ["an audit trigger dropped", "drop trigger inv_costs_audit on inv_costs;", /audit trigger exists/],
      ["the exclusion constraint dropped", "alter table inv_reservations drop constraint inv_reservations_no_overlap;", /exclusion constraint/],
      ["one of the four intended triggers dropped", "drop trigger inv_legacy_guard_assignments on asset_assignments;", /four intended triggers/],
      ["a fifth inv_ trigger on an HR table", "create function t_x() returns trigger language plpgsql as $$ begin return new; end $$; create trigger inv_sneaky before update on employees for each row execute function t_x();", /no other inv_ trigger/],
      ["an automatic grant to somebody", `insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.hrAdmin}', '${CO.uae}', '{}')`, /NO automatic grants/],
      ["a row created for you in an Inventory table", `insert into inv_locations (company_id, code, name, timezone) values ('${CO.uae}', 'DXB1', 'Dubai', 'Asia/Dubai')`, /NO data created for you/],
      ["a stock row that disagrees with the ledger", `insert into inv_locations (id, company_id, code, name, timezone) values ('${A.laptop2}', '${CO.uae}', 'DXB1', 'Dubai', 'Asia/Dubai');
        insert into inv_items (id, company_id, name, tracking, status) values ('${A.phone}', '${CO.uae}', 'Cable', 'quantity', 'active');
        insert into inv_balances (company_id, item_id, holder_kind, location_id, condition, qty) values ('${CO.uae}', '${A.phone}', 'warehouse', '${A.laptop2}', 'good', 7)`, /equals the sum of the ledger lines/],
      ["an Inventory function that writes an HR table", "create function inv_sneaky_writer() returns void language plpgsql as $$ begin update employees set first_name = first_name; end $$; select 1", /only Inventory function that writes/],
      ["an Inventory column on the HR assets table", "alter table assets add column inv_marker text;", /carry no Inventory column/],
      ["an Inventory row in the shared HR audit log", `insert into audit_log (table_name, record_id, action) values ('inv_units', '${id()}', 'insert')`, /shared HR audit log/],
    ];
    for (const [name, change, expected] of drifts) {
      it(`fails (and says what) when there is ${name}`, async () => {
        let rows: Row[];
        try {
          rows = await withChange(db, change, VERIFY);
        } catch (e) {
          // a few experiments need columns we do not know; the experiment itself is not the subject: report clearly
          throw new Error(`experiment could not be applied: ${name}: ${(e as Error).message}`);
        }
        const failed = rows.filter((r) => r.result === "FAIL");
        expect(failed.length, name).toBeGreaterThanOrEqual(1);
        expect(failed.map((r) => r.check_name).join(" | ")).toMatch(expected);
        expect(rows.find((r) => r.check_name === "SUMMARY")!.result).toBe("STOP");
      });
    }

    it("is clean again after those rolled-back experiments", async () => {
      const rows = await readOnly(db, VERIFY);
      expect(rows.find((r) => r.check_name === "SUMMARY")!.result).toBe("OK");
    });
  });

  describe("preflight (inv_00), run again after the install", () => {
    it("shows the Inventory objects as already existing (so it cannot be mistaken for a first-install pass)", async () => {
      const rows = await readOnly(db, PREFLIGHT);
      const c = rows.filter((r) => String(r.section).startsWith("C "));
      expect(c.find((r) => r.item === "(summary)")!.detail).toBe("Inventory objects exist - see rows above");
      expect(c.filter((r) => String(r.detail).startsWith("ALREADY EXISTS")).length).toBeGreaterThan(150);
    });
  });

  describe("bootstrap (inv_30)", () => {
    const ph = "    'REPLACE-WITH-FOUNDER-EMAIL@yourcompany.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID'\n";
    const withGrants = (grants: string, codes = "array[]::text[]") => {
      expect(BOOTSTRAP).toContain(ph);
      return BOOTSTRAP.replace(ph, () => grants).replace("v_codes constant text[] := array[]::text[];", () => `v_codes constant text[] := ${codes};`);
    };
    const attempt = (sql: string) => withClient(db, async (c) => run(c, sql));
    const invCounts = async (t: string) => Number((await db.seed(`select count(*)::int n from ${t}`)).rows[0]!.n);
    let hrBefore = "";
    let otherGrantsBefore = "";

    it("refuses the placeholder exactly as shipped and writes nothing", async () => {
      await expect(attempt(BOOTSTRAP)).rejects.toThrow(/placeholder is still there/);
      expect(await invCounts("inv_company_grants")).toBe(0);
      expect(await invCounts("inv_company_settings")).toBe(0);
    });

    it("refuses bad input (example addresses, unknown users, unknown or ambiguous companies, bad codes, empty list) and writes nothing", async () => {
      await expect(attempt(withGrants(`    '${EMAIL("founderOne")} => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID'\n`))).rejects.toThrow(/placeholder is still there/);
      await expect(attempt(withGrants("    'someone@yourcompany.example => Enginious UAE'\n"))).rejects.toThrow(/Not a real login email/);
      await expect(attempt(withGrants("    'nobody@nowhere.com => Enginious UAE'\n"))).rejects.toThrow(/No active user has the email/);
      await expect(attempt(withGrants(`    '${EMAIL("founderOne")} => Atlantis LLC'\n`))).rejects.toThrow(/No active company matches/);
      await expect(attempt(withGrants(`    '${EMAIL("founderOne")}  Enginious UAE'\n`))).rejects.toThrow(/must look like/);
      await expect(attempt(withGrants(`    '${EMAIL("founderOne")} => Enginious UAE'\n`, "array['Enginious UAE => uae']"))).rejects.toThrow(/2 to 5 capital letters/);
      await expect(attempt(withGrants(`    '${EMAIL("founderOne")} => Enginious UAE'\n`, "array['Enginious KSA => KSA']"))).rejects.toThrow(/has no Inventory founder/);
      expect(BOOTSTRAP).toContain(`array[\n${ph}  ];`);
      await expect(attempt(BOOTSTRAP.replace(`array[\n${ph}  ];`, () => "array[]::text[];"))).rejects.toThrow(/Nothing to do/);
      // one bad line stops the WHOLE run: the good first line must not have been written
      await expect(attempt(withGrants(`    '${EMAIL("founderOne")} => Enginious UAE',\n    'nobody@nowhere.com => Enginious UAE'\n`))).rejects.toThrow(/No active user/);
      expect(await invCounts("inv_company_grants")).toBe(0);
      expect(await invCounts("inv_company_settings")).toBe(0);
    });

    it("grants exactly what was typed (a company by name, another by id), sets the optional code, and creates no stock, location, category or item", async () => {
      hrBefore = await counts(db, true);
      otherGrantsBefore = JSON.stringify((await db.seed(`select 'crm' k, count(*) n from crm_company_grants union all select 'proj', count(*) from proj_company_grants union all select 'roles', count(*) from user_roles order by 1`)).rows);
      const sql = withGrants(`    '${EMAIL("founderOne")} => Enginious UAE',\n    '${EMAIL("founderTwo").toUpperCase()} => ${CO.ksa}'\n`, "array['Enginious UAE => UAE']");
      const { notices, rows } = await attempt(sql);
      expect(notices.join("\n")).toMatch(/founder GRANTED: founderone@inv-owner-test.ae -> Enginious UAE/);
      expect(notices.join("\n")).toMatch(/reference code SET: Enginious UAE -> UAE/);
      expect(notices.join("\n")).toMatch(/founder grants created: 2; already existing \(founder right ensured\): 0; reference codes set: 1/);
      expect(rows.map((r) => `${r.what}|${r.company}|${r.person_or_code}`).sort()).toEqual([
        "access|Enginious KSA|founderone@inv-owner-test.ae".replace("founderone", "foundertwo"),
        "access|Enginious UAE|founderone@inv-owner-test.ae",
        "settings|Enginious UAE|UAE",
      ]);
      const grants = (await db.seed(`select g.capabilities, g.note, g.granted_by, c.legal_name, p.email from inv_company_grants g join companies c on c.id = g.company_id join profiles p on p.id = g.user_id order by 4`)).rows;
      expect(grants).toHaveLength(2);
      for (const g of grants) {
        expect(g.capabilities).toEqual(["founder"]);
        expect(g.note).toBe("Bootstrap by owner (manual SQL)");
        expect(g.granted_by).toBeNull();
      }
      expect(grants.map((g) => `${g.legal_name}:${g.email}`)).toEqual([`Enginious KSA:${EMAIL("founderTwo")}`, `Enginious UAE:${EMAIL("founderOne")}`]);
      const settings = (await db.seed(`select reference_code, is_enabled from inv_company_settings`)).rows;
      expect(settings).toEqual([{ reference_code: "UAE", is_enabled: true }]);
      for (const t of ["inv_locations", "inv_categories", "inv_items", "inv_units", "inv_balances", "inv_movements", "inv_movement_lines", "inv_counts", "inv_requests", "inv_reservations", "inv_bins", "inv_technologies", "inv_costs"]) {
        expect(await invCounts(t), t).toBe(0);
      }
      // nobody else got anything, and no HR / Sales / Projects row changed
      expect(JSON.stringify((await db.seed(`select 'crm' k, count(*) n from crm_company_grants union all select 'proj', count(*) from proj_company_grants union all select 'roles', count(*) from user_roles order by 1`)).rows)).toBe(otherGrantsBefore);
      expect(await counts(db, true)).toBe(hrBefore);
      for (const k of ["ceo", "salesFounder", "projFounder", "hrAdmin", "worker", "pm", "outsider"] as const) {
        expect(await invCounts(`inv_company_grants where user_id = '${U[k]}'`), k).toBe(0);
      }
    });

    it("is idempotent: a second run changes nothing and says so; an existing grant keeps its other rights and gains the founder right", async () => {
      const sql = withGrants(`    '${EMAIL("founderOne")} => Enginious UAE',\n    '${EMAIL("founderTwo")} => Enginious KSA'\n`, "array['Enginious UAE => UAE']");
      const before = JSON.stringify((await db.seed(`select id, capabilities, granted_at from inv_company_grants order by id`)).rows);
      const { notices } = await attempt(sql);
      expect(notices.join("\n")).toMatch(/founder grants created: 0; already existing \(founder right ensured\): 2; reference codes set: 0/);
      expect(JSON.stringify((await db.seed(`select id, capabilities, granted_at from inv_company_grants order by id`)).rows)).toBe(before);
      expect(await invCounts("inv_company_grants")).toBe(2);
      // a worker who already holds warehouse access in the UAE is made a founder by name; the other capability is kept
      await db.seed(`insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.worker}', '${CO.uae}', '{warehouse}')`);
      await attempt(withGrants(`    '${EMAIL("worker")} => Enginious UAE'\n`));
      expect((await db.seed(`select capabilities from inv_company_grants where user_id = '${U.worker}' and revoked_at is null`)).rows[0]!.capabilities.slice().sort()).toEqual(["founder", "warehouse"]);
      await db.seed(`delete from inv_company_grants where user_id = '${U.worker}'`);
    });

    it("makes real founders: a bootstrapped founder can grant access through the app function, an outsider cannot", async () => {
      const ok = await db.asUserCommit(U.founderOne, async (q) => (await q(`select inv_grant_access('${U.worker}', '${CO.uae}', '{warehouse}', 'test') as id`)).rows);
      expect(ok[0].id).toBeTruthy();
      await expect(db.asUser(U.outsider, async (q) => (await q(`select inv_grant_access('${U.worker}', '${CO.uae}', '{warehouse}', 'x')`)).rows)).rejects.toThrow(/Only a founder/);
      await db.seed(`delete from inv_company_grants where user_id = '${U.worker}'`);
    });

    it("verify with expect_fresh = true now FAILS (it detects grants and a settings row), and with expect_fresh = false it is OK", async () => {
      const fresh = await readOnly(db, VERIFY);
      expect(fresh.filter((r) => r.result === "FAIL").map((r) => r.check_name).join(" | ")).toMatch(/NO automatic grants.*|NO data created for you/);
      const later = VERIFY.replace("select true as expect_fresh", "select false as expect_fresh");
      expect(later).not.toBe(VERIFY);
      const rows = await readOnly(db, later);
      expect(rows.filter((r) => !["OK", "INFO"].includes(r.result))).toEqual([]);
      expect(rows.find((r) => r.check_name.startsWith("Inventory settings"))!.detail).toContain("Enginious UAE -> UAE (on)");
    });
  });

  describe("compare after bootstrap", () => {
    it("granting founders changes nothing outside Inventory: the preservation compare still passes", async () => {
      const rows = await readOnly(db, compareSql);
      expect(summary(rows)).toMatch(/^PASS/);
    });
  });
});

describe("Inventory rollback (inv_90) against a fresh install", () => {
  const db = new RlsTestDatabase();
  let snapshotRows: Row[] = [];
  let compareSql = "";

  beforeAll(async () => {
    await prepare(db);
  }, 120_000);
  afterAll(async () => {
    await db.teardown();
  });

  const invObjects = async () =>
    (await db.seed(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'inv\\_%')::int as rel,
      (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'inv\\_%')::int as fn,
      (select count(*) from pg_trigger where not tgisinternal and tgname like 'inv\\_%')::int as trg,
      (select count(*) from pg_policies where tablename like 'inv\\_%')::int as pol,
      (select count(*) from pg_type where typnamespace = 'public'::regnamespace and typname like 'inv\\_%')::int as typ`)).rows[0] as Row;
  const clearData = async () => {
    await db.seed(`delete from inv_locations; delete from inv_reference_counters; delete from inv_audit_log where table_name not in ('inv_company_grants', 'inv_company_settings')`);
  };
  const rollback = (sql = ROLLBACK) => withClient(db, (c) => run(c, sql));
  const bootstrap = () =>
    withClient(db, (c) => run(c, BOOTSTRAP.replace("    'REPLACE-WITH-FOUNDER-EMAIL@yourcompany.example => REPLACE-WITH-COMPANY-LEGAL-NAME-OR-ID'\n", () => `    '${EMAIL("founderOne")} => Enginious UAE'\n`)
      .replace("v_codes constant text[] := array[]::text[];", () => "v_codes constant text[] := array['Enginious UAE => UAE'];")));

  it("takes the snapshot, installs Inventory and bootstraps one founder (so the grants and the settings row exist, which do not count as data)", async () => {
    snapshotRows = await readOnly(db, PRESERVATION);
    expect(summary(snapshotRows)).toMatch(/^SNAPSHOT TAKEN/);
    compareSql = withPaste(PRESERVATION, snapshotRows);
    await installInventory(db);
    await bootstrap();
    expect((await invObjects()).rel).toBeGreaterThan(60);
    expect(summary(await readOnly(db, compareSql))).toMatch(/^PASS: .*4 intended Inventory triggers/);
  });

  it("refuses to run when switched wrongly: the destructive part needs BOTH switches (flag without the phrase, phrase without the flag)", async () => {
    // no data yet, so first prove the refusal with data
    await db.seed(`insert into inv_locations (id, company_id, code, name, timezone) values ('${id()}', '${CO.uae}', 'DXB1', 'Dubai warehouse', 'Asia/Dubai')`);
    const before = await invObjects();
    // the location is data, and so is the audit row that the database wrote about it
    await expect(rollback()).rejects.toThrow(/Inventory data exists \(2 rows: inv_locations=1, inv_audit_log \(rows about stock, catalogue or plans\)=1\)/);
    await expect(rollback(ROLLBACK.replace("v_allow_data_loss boolean := false;", "v_allow_data_loss boolean := true;"))).rejects.toThrow(/Inventory data exists/);
    await expect(rollback(ROLLBACK.replace("v_confirm text := '';", "v_confirm text := 'DELETE ALL INVENTORY HISTORY';"))).rejects.toThrow(/Inventory data exists/);
    await expect(rollback(ROLLBACK.replace("v_allow_data_loss boolean := false;", "v_allow_data_loss boolean := true;").replace("v_confirm text := '';", "v_confirm text := 'delete all inventory history';"))).rejects.toThrow(/Inventory data exists/);
    expect(await invObjects()).toEqual(before);
    expect((await db.seed(`select count(*)::int n from inv_locations`)).rows[0]!.n).toBe(1);
    await clearData();
  });

  it("counts every kind of business data: a code counter that already issued a label, a stock row, an audit row about stock", async () => {
    const co = CO.uae;
    await db.seed(`insert into inv_reference_counters (company_id, kind, last_value) values ('${co}', 'unit', 3)`);
    await expect(rollback()).rejects.toThrow(/inv_reference_counters=1/);
    await db.seed(`delete from inv_reference_counters`);
    await db.seed(`insert into inv_audit_log (table_name, company_id, action) values ('inv_units', '${co}', 'insert')`);
    await expect(rollback()).rejects.toThrow(/^error: Inventory data exists \(1 rows: inv_audit_log \(rows about stock, catalogue or plans\)=1\)|Inventory data exists \(1 rows: inv_audit_log \(rows about stock, catalogue or plans\)=1\)/);
    await clearData();
  });

  it("on a fresh install (founder grant and settings only) removes every table, function, trigger and policy, and nothing else", async () => {
    const tablesOutsideInv = JSON.stringify((await db.seed(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname !~ '^inv_' order by 1`)).rows);
    const { notices, rows } = await rollback();
    expect(notices.join("\n")).toContain("Inventory objects removed.");
    expect(rows.map((r) => `${r.what}=${r.number}`)).toEqual(["Inventory tables left=0", "Inventory functions left=0", "inv_ triggers left on any table=0", "inv_ policies left=0"]);
    expect(await invObjects()).toEqual({ rel: 0, fn: 0, trg: 0, pol: 0, typ: 0 });
    expect(JSON.stringify((await db.seed(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname !~ '^inv_' order by 1`)).rows)).toBe(tablesOutsideInv);
    // the four triggers are gone from the existing tables
    expect((await db.seed(`select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname in ('assets', 'asset_assignments', 'proj_projects') and not g.tgisinternal and g.tgname like 'inv_%'`)).rows[0]!.n).toBe(0);
    // HR assets are editable again
    await db.seed(`update assets set description = 'edited after rollback' where id = '${A.laptop1}'`);
    await db.seed(`update assets set description = 'Laptop A' where id = '${A.laptop1}'`);
  });

  it("a snapshot taken before the install matches again after the rollback (summary PASS, 0 of the 4 triggers, every fingerprint SAME)", async () => {
    const rows = await readOnly(db, compareSql);
    expect(summary(rows)).toMatch(/^PASS: nothing HR, Sales, Projects or the HR asset register own changed \(\d+ fingerprints identical\); Inventory is not installed \(0 of the 4 intended triggers present/);
    expect(rows.filter((r) => r.verdict === "DIFFERENT" || r.verdict === "NEW")).toEqual([]);
    expect(rows.find((r) => r.item === "intended:four_triggers")!.now_value).toBe("0 present (Inventory is not installed)");
    // the preflight is back to a first-install state
    const pre = await readOnly(db, PREFLIGHT);
    expect(pre.find((r) => String(r.section).startsWith("C ") && r.item === "(summary)")!.detail).toBe("OK - no Inventory tables or functions exist yet");
  });

  it("running the rollback a second time is harmless", async () => {
    const { notices } = await rollback();
    expect(notices.join("\n")).toContain("Nothing to remove");
  });

  it("the migrations install cleanly again afterwards (a rollback leaves nothing behind that blocks a re-install)", async () => {
    await installInventory(db);
    expect((await invObjects()).rel).toBeGreaterThan(60);
    const rows = await readOnly(db, VERIFY);
    expect(rows.filter((r) => !["OK", "INFO"].includes(r.result))).toEqual([]);
  });

  it("with data and both switches the rollback destroys it, and the database is back to the snapshot", async () => {
    await bootstrap();
    await db.seed(`insert into inv_locations (id, company_id, code, name, timezone) values ('${id()}', '${CO.uae}', 'DXB1', 'Dubai warehouse', 'Asia/Dubai')`);
    await db.seed(`delete from inv_audit_log where table_name = 'inv_locations'`);
    const open = ROLLBACK.replace("v_allow_data_loss boolean := false;", "v_allow_data_loss boolean := true;").replace("v_confirm text := '';", "v_confirm text := 'DELETE ALL INVENTORY HISTORY';");
    const { notices } = await rollback(open);
    expect(notices.join("\n")).toMatch(/ALLOWED TO DESTROY 1 rows of Inventory data \(inv_locations=1\)/);
    expect(await invObjects()).toEqual({ rel: 0, fn: 0, trg: 0, pol: 0, typ: 0 });
    expect(summary(await readOnly(db, compareSql))).toMatch(/^PASS: .*Inventory is not installed/);
  });
});
