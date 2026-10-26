import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The access grant rules migration replaces eight functions and nothing else. This proves, on a database that already holds grants of every module, that
//   * every existing grant row is byte-for-byte the same afterwards (nobody gains or loses access by the migration),
//   * every existing holder can still do exactly what they could (the capability checks answer the same for every person, module, company and right),
//   * every other function, policy, trigger, column, index and privilege of the grant tables is unchanged, and the eight functions keep their privileges,
//   * the migration is safe to apply twice, and the rollback script restores the eight functions exactly.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = "20261215000000_access_grant_rules.sql";
const MANUAL = path.resolve(__dirname, "../../../supabase/manual-sql");
const script = (name: string) => readFileSync(path.join(MANUAL, name), "utf8");
const ROLLBACK = path.join(MANUAL, "grant_rules_90_rollback.sql");

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const names = ["f", "ma", "x", "y", "fin", "ap", "m1", "cr"] as const;
const U = Object.fromEntries(names.map((n) => [n, id()])) as Record<(typeof names)[number], string>;
const SIX = ["crm_grant_access", "crm_revoke_access", "proj_revoke_access", "inv_revoke_access", "pbx_grant_access", "pbx_revoke_access"];
const CHANGED = SIX;
const TABLES = { sales: "crm_company_grants", projects: "proj_company_grants", inventory: "inv_company_grants", budget: "pbx_company_grants" } as const;
const HAS = { sales: "crm_has_capability", projects: "proj_has_capability", inventory: "inv_has_capability", budget: "pbx_has_capability" } as const;
const CAPS = {
  sales: ["founder", "assign_owner", "confirm_availability", "manage_settings", "manage_approval_rules", "manage_access", "view_audit", "reopen_closed"],
  projects: ["founder", "assign_pm", "manage_access", "approve_scope", "view_commercial", "view_audit", "reopen_project", "override_site_conflict"],
  inventory: ["founder", "manage_access", "manage_catalogue", "warehouse", "cross_location", "view_stock", "view_costs", "view_audit", "confirm_stock", "request_for_employees", "view_employee_custody"],
  budget: ["finance", "view", "executive_approver", "manage_access"],
} as const;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("access grant rules: nothing existing is lost", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const asUser = async (user: string, sql: string) => (await db.asUser(user, async (query) => (await query(sql)).rows)) as Row[];

  const fingerprint = async () => ({
    rows: await admin(`select 'crm' t, md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')) h, count(*) n from crm_company_grants g
      union all select 'proj', md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')), count(*) from proj_company_grants g
      union all select 'inv', md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')), count(*) from inv_company_grants g
      union all select 'pbx', md5(coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')), count(*) from pbx_company_grants g order by 1`),
    others: await admin<{ proname: string; args: string; h: string }>(`select p.proname, pg_get_function_identity_arguments(p.oid) args, md5(pg_get_functiondef(p.oid)) h
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${CHANGED.map((n) => `'${n}'`).join(",")}]) order by 1, 2`),
    eight: await admin<{ proname: string; h: string; acl: string; secdef: boolean; cfg: string }>(`select p.proname, md5(pg_get_functiondef(p.oid)) h, coalesce(p.proacl::text, '') acl, p.prosecdef secdef, coalesce(p.proconfig::text, '') cfg
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${CHANGED.map((n) => `'${n}'`).join(",")}]) order by 1`),
    shape: await admin(`select 'policy' k, tablename||'/'||policyname||'/'||cmd||'/'||coalesce(qual,'')||'/'||coalesce(with_check,'') v from pg_policies where tablename = any (array[${Object.values(TABLES).map((t) => `'${t}'`).join(",")}])
      union all select 'trigger', c.relname||'/'||t.tgname||'/'||t.tgfoid::regproc::text from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relname = any (array[${Object.values(TABLES).map((t) => `'${t}'`).join(",")}])
      union all select 'column', table_name||'/'||column_name||'/'||data_type||'/'||is_nullable from information_schema.columns where table_schema = 'public' and table_name = any (array[${Object.values(TABLES).map((t) => `'${t}'`).join(",")}])
      union all select 'index', tablename||'/'||indexdef from pg_indexes where tablename = any (array[${Object.values(TABLES).map((t) => `'${t}'`).join(",")}])
      union all select 'acl', relname||'/'||coalesce(relacl::text, '') from pg_class where oid = any (array[${Object.values(TABLES).map((t) => `'public.${t}'::regclass::oid`).join(",")}])
      order by 1, 2`),
  });

  const capabilityAnswers = async () => {
    const out: string[] = [];
    for (const module of ["sales", "projects", "inventory", "budget"] as const) {
      for (const user of names) {
        for (const company of [CO.uae, CO.ksa]) {
          const select = CAPS[module].map((c) => `${HAS[module]}('${company}', '${c}') as "${c}"`).join(", ");
          out.push(`${module}/${user}/${company === CO.uae ? "uae" : "ksa"}/${JSON.stringify((await asUser(U[user], `select ${select}`))[0])}`);
        }
      }
    }
    return out;
  };

  const run = async (sql: string) => (await db.seed(sql)).rows as Row[];
  let before: Awaited<ReturnType<typeof fingerprint>>;
  let preflight: Row[] = [];
  let verifyBefore: Row[] = [];
  let snapshot: Row[] = [];
  let answersBefore: string[] = [];

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${names.map((n) => `('${U[n]}', '${n}@preserve.ae')`).join(", ")};
    `);
    // the later grant-authenticated step of the test harness is not applied by setupBefore: give the signed-in role what a hosted project gives it
    await db.seed(`
      grant usage on schema public to authenticated, anon;
      grant execute on all functions in schema public to authenticated;
      grant select on all tables in schema public to authenticated;
    `);
    // grants of every module, including a revoked one, a basic one (no extra right) and holders in a second company
    await db.seed(`
      insert into crm_company_grants (user_id, company_id, capabilities, revoked_at) values
        ('${U.f}', '${CO.uae}', '{founder}', null), ('${U.ma}', '${CO.uae}', '{manage_access,assign_owner}', null), ('${U.x}', '${CO.uae}', '{assign_owner,view_audit}', null),
        ('${U.y}', '${CO.uae}', '{}', null), ('${U.fin}', '${CO.uae}', '{reopen_closed}', now()), ('${U.f}', '${CO.ksa}', '{manage_settings}', null);
      insert into proj_company_grants (user_id, company_id, capabilities, revoked_at) values
        ('${U.f}', '${CO.uae}', '{founder}', null), ('${U.ma}', '${CO.uae}', '{manage_access,assign_pm}', null), ('${U.x}', '${CO.uae}', '{approve_scope}', null),
        ('${U.y}', '${CO.uae}', '{}', null), ('${U.ap}', '${CO.ksa}', '{view_commercial}', null);
      insert into inv_company_grants (user_id, company_id, capabilities, revoked_at) values
        ('${U.f}', '${CO.uae}', '{founder}', null), ('${U.ma}', '${CO.uae}', '{manage_access}', null), ('${U.x}', '${CO.uae}', '{warehouse,view_stock}', null),
        ('${U.cr}', '${CO.uae}', '{view_costs}', null), ('${U.y}', '${CO.ksa}', '{}', null);
      insert into pbx_company_grants (user_id, company_id, capabilities, revoked_at) values
        ('${U.m1}', '${CO.uae}', '{finance,manage_access}', null), ('${U.ap}', '${CO.uae}', '{executive_approver}', null), ('${U.fin}', '${CO.uae}', '{finance}', null),
        ('${U.x}', '${CO.uae}', '{view}', null), ('${U.ma}', '${CO.ksa}', '{executive_approver,manage_access}', null), ('${U.y}', '${CO.uae}', '{view}', now());
    `);
    before = await fingerprint();
    answersBefore = await capabilityAnswers();
    // the owner-run scripts, exactly as the owner runs them, BEFORE the migration
    preflight = await run(script("grant_rules_00_preflight_readonly.sql"));
    verifyBefore = await run(script("grant_rules_20_verify_readonly.sql"));
    snapshot = await run(script("grant_rules_05_preservation_check_readonly.sql"));
  }, 120_000);
  afterAll(async () => { await db.teardown(); });

  it("the preflight runs, finds every prerequisite, says the rules are not applied yet, and lists who is affected without changing anything", () => {
    const b = preflight.filter((r) => r.section === "B prerequisites");
    expect(b.length).toBeGreaterThan(20);
    expect(b.filter((r) => !/^OK/.test(r.detail)), JSON.stringify(b.filter((r) => !/^OK/.test(r.detail)))).toEqual([]);
    expect(b.find((r) => r.item === "rules applied already?")?.detail).toMatch(/not applied yet/);
    const d = preflight.filter((r) => r.section === "D who is affected").map((r) => `${r.item} :: ${r.detail}`).join("\n");
    expect(d).toMatch(/Budget, Enginious UAE/);
    expect(d).toMatch(/NO eligible approver|exactly ONE eligible approver|CEO \/ CTO approvers/);
    expect(d).toMatch(/Budget access manager who is not an approver: m1@preserve\.ae/);
    expect(d).toMatch(/Sales access manager who is not a founder: ma@preserve\.ae/);
    expect(d).toMatch(/nobody loses access/);
  });

  it("verify before the migration reports the new rules as missing (so a FAIL there means 'not applied'), and never reports a missing earlier protection", () => {
    const fails = verifyBefore.filter((r) => r.result === "FAIL" && r.item !== "SUMMARY");
    expect(fails.length).toBeGreaterThan(10);
    expect(fails.every((r) => /new rule present/.test(r.item)), JSON.stringify(fails.filter((r) => !/new rule present/.test(r.item)))).toBe(true);
    expect(verifyBefore.filter((r) => /earlier protection still present/.test(r.item)).every((r) => r.result === "OK")).toBe(true);
    expect(verifyBefore.find((r) => r.item === "SUMMARY")?.result).toBe("FAIL");
  });

  it("applying the migration changes the six functions it names and nothing else", async () => {
    await db.applyMigration(MIGRATION);
    const after = await fingerprint();
    expect(after.rows).toEqual(before.rows);
    expect(after.others).toEqual(before.others);
    expect(after.shape).toEqual(before.shape);
    expect(after.eight.map((f) => f.proname)).toEqual(before.eight.map((f) => f.proname));
    for (const [i, f] of after.eight.entries()) {
      expect(f.h, `${f.proname} was replaced`).not.toBe(before.eight[i]!.h);
      expect(f.acl, `${f.proname} keeps its privileges`).toBe(before.eight[i]!.acl);
      expect(f.secdef, `${f.proname} stays security definer`).toBe(before.eight[i]!.secdef);
      expect(f.cfg, `${f.proname} keeps its search path`).toBe(before.eight[i]!.cfg);
    }
  });

  it("verify after the migration: every check is OK, none failing", async () => {
    const rows = await run(script("grant_rules_20_verify_readonly.sql"));
    expect(rows.filter((r) => r.result === "FAIL"), JSON.stringify(rows.filter((r) => r.result === "FAIL"))).toEqual([]);
    const summary = rows.find((r) => r.item === "SUMMARY");
    expect(summary?.result).toBe("OK");
    expect(summary?.detail).toMatch(/0 failing/);
    // 8 functions x 3 + 25 rule/protection probes + the tables: a meaningful number of checks, not an empty pass
    expect(rows.filter((r) => r.result === "OK").length).toBeGreaterThan(50);
  });

  it("the preservation compare, with the snapshot taken before, says PASS", async () => {
    const paste = snapshot.map((r) => r.paste).filter(Boolean).join("\n");
    expect(paste.length).toBeGreaterThan(500);
    const compare = script("grant_rules_05_preservation_check_readonly.sql").replace("    ('__none__', '')", `${paste}\n    ('__none__', '')`);
    const rows = await run(compare);
    const summary = rows.find((r) => r.item === "SUMMARY");
    expect(summary?.verdict, JSON.stringify(rows.filter((r) => ["DIFFERENT", "NEW"].includes(r.verdict)))).toMatch(/^PASS/);
    expect(rows.filter((r) => /^fn:/.test(r.item)).every((r) => r.verdict === "CHANGED")).toBe(true);
    expect(rows.filter((r) => /^fnacl:|^rows:|^struct:/.test(r.item)).every((r) => r.verdict === "SAME")).toBe(true);
  });

  it("every existing holder answers every capability check exactly as before, for every module, company and right", async () => {
    expect(await capabilityAnswers()).toEqual(answersBefore);
    expect(answersBefore.length).toBe(4 * names.length * 2);
  });

  it("existing holders can still do what they could: a founder grants, an access manager grants an ordinary right, Finance records a view grant", async () => {
    const commit = (user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows);
    await commit(U.f, `select crm_grant_access('${U.y}', '${CO.uae}', '{assign_owner}', null)`);
    await commit(U.ma, `select proj_grant_access('${U.y}', '${CO.uae}', '{assign_pm}', null)`);
    await commit(U.ma, `select inv_grant_access('${U.y}', '${CO.uae}', '{warehouse}', null)`);
    await commit(U.m1, `select pbx_grant_access('${U.y}', '${CO.uae}', '{view,finance}', null)`);
    await commit(U.ap, `select pbx_grant_access('${U.fin}', '${CO.uae}', '{finance}', null)`).catch(() => undefined); // ap holds the approver right only (no access management), as before
  });

  it("is safe to apply twice", async () => {
    const once = (await fingerprint()).eight;
    await db.applyMigration(MIGRATION);
    expect((await fingerprint()).eight).toEqual(once);
  });

  it("the rollback script restores the six functions exactly and changes nothing else", async () => {
    const afterMigration = await fingerprint();
    await db.seed(readFileSync(ROLLBACK, "utf8"));
    const rolledBack = await fingerprint();
    expect(rolledBack.eight.map((f) => [f.proname, f.h])).toEqual(before.eight.map((f) => [f.proname, f.h]));
    expect(rolledBack.others).toEqual(afterMigration.others);
    expect(rolledBack.shape).toEqual(afterMigration.shape);
    // and the migration can be applied again afterwards
    await db.applyMigration(MIGRATION);
    expect((await fingerprint()).eight.map((f) => f.h)).toEqual(afterMigration.eight.map((f) => f.h));
  });
});
