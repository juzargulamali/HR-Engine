import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Supabase grants every public table's full privilege set to anon / authenticated / service_role. TRUNCATE,
// TRIGGER, REFERENCES (and MAINTAIN on PostgreSQL 17) are NOT governed by row-level security. Migration
// 20261114000000 removes them from anon / authenticated / PUBLIC on EVERY public table and in the default
// privileges for future tables.
//
// This suite builds production's state (every migration before the fix, then Supabase-style grants incl. the four
// dangerous privileges and matching default privileges), snapshots the complete privilege matrix, applies ONLY the
// fix, and proves: the four privileges are gone everywhere, every other privilege of every role is byte-for-byte
// unchanged, service_role keeps everything, future tables inherit the safe defaults, normal app flows still work,
// and no function reachable by anon/authenticated can expose the removed privileges.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = "20261114000000_public_privilege_hardening.sql";
const GRANTS = readFileSync(path.resolve(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8");
const DANGEROUS = ["TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN"];

const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const id = () => randomUUID();
const U = { emp: id(), mgr: id(), hrA: id(), ceoA: id(), empB: id(), hrB: id() };
const E = { emp: id(), mgr: id(), hrA: id(), ceoA: id(), empB: id(), hrB: id() };
const POLICY = id();

type Matrix = Record<string, string[]>; // "table|grantee" -> sorted privileges

describe("public schema privilege hardening", () => {
  const db = new RlsTestDatabase();
  let before: Matrix;

  async function matrix(): Promise<Matrix> {
    const { rows } = await db.seed(`
      select c.relname || '|' || case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as k,
             string_agg(x.privilege_type, ',' order by x.privilege_type) as privs
      from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      group by 1`);
    return Object.fromEntries(rows.map((r) => [r.k as string, (r.privs as string).split(",")]));
  }
  const strip = (privs: string[]) => privs.filter((p) => !DANGEROUS.includes(p));

  beforeAll(async () => {
    await db.setupBefore(FIX);
    await db.seed(GRANTS);
    // Supabase's defaults on a real project: ALL on every table to anon / authenticated / service_role, and the
    // same default for tables created later.
    await db.seed(`
      grant all on all tables in schema public to anon, authenticated, service_role;
      alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    `);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_A}', 'Company A', 'AE', 'AED'), ('${COMPANY_B}', 'Company B', 'AE', 'AED');
      insert into auth.users (id, email) values
        ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@priv-test.ae')`).join(",\n        ")};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.emp}',  '${U.emp}',  'P-EMP',  '${COMPANY_A}', 'AE', 'Emp',  'A', '2024-01-01'),
        ('${E.mgr}',  '${U.mgr}',  'P-MGR',  '${COMPANY_A}', 'AE', 'Mgr',  'A', '2024-01-01'),
        ('${E.hrA}',  '${U.hrA}',  'P-HRA',  '${COMPANY_A}', 'AE', 'Hr',   'A', '2024-01-01'),
        ('${E.ceoA}', '${U.ceoA}', 'P-CEOA', '${COMPANY_A}', 'AE', 'Ceo',  'A', '2024-01-01'),
        ('${E.empB}', '${U.empB}', 'P-EMPB', '${COMPANY_B}', 'AE', 'Emp',  'B', '2024-01-01'),
        ('${E.hrB}',  '${U.hrB}',  'P-HRB',  '${COMPANY_B}', 'AE', 'Hr',   'B', '2024-01-01');
      update employees set manager_id = '${E.mgr}' where id = '${E.emp}';
      insert into user_roles (user_id, role, company_id) values
        ('${U.mgr}', 'line_manager', '${COMPANY_A}'), ('${U.hrA}', 'hr_admin', '${COMPANY_A}'),
        ('${U.ceoA}', 'ceo', '${COMPANY_A}'), ('${U.hrB}', 'hr_admin', '${COMPANY_B}');
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('${POLICY}', 'AE', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${U.hrA}', '${U.ceoA}', now());
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
        values ('${POLICY}', 'annual', 'Annual Leave', 'monthly_accrual');
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by)
        values ('${E.emp}', 'annual', '2026-01-01', 'accrual', 10, '${U.hrA}');
    `);
    before = await matrix();
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("BEFORE the fix (production state)", () => {
    it("many public tables grant TRUNCATE, TRIGGER and REFERENCES to anon and authenticated", async () => {
      const bad = Object.entries(before).filter(([k, v]) => /\|(anon|authenticated)$/.test(k) && v.includes("TRUNCATE"));
      expect(bad.length).toBeGreaterThan(40);
      expect(before["audit_log|authenticated"]).toEqual(expect.arrayContaining(["TRUNCATE", "TRIGGER", "REFERENCES"]));
      expect(before["user_roles|anon"]).toEqual(expect.arrayContaining(["TRUNCATE", "TRIGGER", "REFERENCES"]));
      // PostgreSQL 17 (production) also has MAINTAIN; CI's PostgreSQL may be older, where it does not exist.
      const { rows } = await db.seed("select current_setting('server_version_num')::int >= 170000 as pg17");
      if (rows[0].pg17) expect(before["audit_log|authenticated"]).toContain("MAINTAIN");
    });

    it("exposure: an ordinary signed-in employee can empty audit_log and user_roles (rolled back by the harness)", async () => {
      const n = await db.asUser(U.emp, async (q) => {
        await q("truncate table audit_log");
        return (await q("select count(*)::int as n from audit_log")).rows[0].n;
      });
      expect(n).toBe(0);
      await expect(db.asUser(null, (q) => q("truncate table user_roles"))).resolves.toBeDefined(); // anon too
    });

    it("future tables inherit the dangerous privileges (default privileges)", async () => {
      await db.seed("create table public.zz_future_before (id int)");
      const { rows } = await db.seed("select has_table_privilege('authenticated', 'public.zz_future_before', 'TRUNCATE') as t");
      expect(rows[0].t).toBe(true);
      await db.seed("drop table public.zz_future_before");
    });
  });

  describe("AFTER the fix", () => {
    let after: Matrix;
    beforeAll(async () => {
      await db.applyMigration(FIX);
      after = await matrix();
    });

    it("no public table grants TRUNCATE, TRIGGER, REFERENCES or MAINTAIN to anon, authenticated or PUBLIC", () => {
      const bad = Object.entries(after).filter(([k, v]) => /\|(anon|authenticated|PUBLIC)$/.test(k) && v.some((p) => DANGEROUS.includes(p)));
      expect(bad).toEqual([]);
    });

    it("every other privilege of every role on every table is exactly what it was (only the four were removed)", () => {
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      for (const [k, privs] of Object.entries(before)) {
        const grantee = k.split("|")[1];
        const expected = grantee === "anon" || grantee === "authenticated" || grantee === "PUBLIC" ? strip(privs) : privs;
        expect(after[k], k).toEqual(expected);
      }
    });

    it("anon and authenticated still hold exactly SELECT, INSERT, UPDATE, DELETE where they held them (spot check)", () => {
      expect(after["employees|authenticated"]).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      expect(after["audit_log|anon"]).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    });

    it("service_role and postgres keep EVERYTHING they had on every table", () => {
      for (const [k, privs] of Object.entries(before)) {
        if (/\|(service_role|postgres)$/.test(k)) expect(after[k], k).toEqual(privs);
      }
      expect(after["audit_log|service_role"]).toEqual(expect.arrayContaining(["TRUNCATE", "TRIGGER", "REFERENCES", "SELECT", "INSERT", "UPDATE", "DELETE"]));
    });

    it("a signed-in user and anon can no longer TRUNCATE, attach a trigger to, or reference any table", async () => {
      for (const t of ["audit_log", "user_roles", "employees", "approvals"]) {
        await expect(db.asUser(U.emp, (q) => q(`truncate table ${t}`)), t).rejects.toThrow(/permission denied/);
        await expect(db.asUser(null, (q) => q(`truncate table ${t}`)), t).rejects.toThrow(/permission denied/);
        await expect(db.asUser(U.hrA, (q) => q(`truncate table ${t}`)), t).rejects.toThrow(/permission denied/);
      }
      await expect(
        db.asUser(U.hrA, (q) => q("create trigger t_probe after insert on employees for each row execute function pg_catalog.suppress_redundant_updates_trigger()")),
      ).rejects.toThrow(/permission denied|must be owner/);
    });

    it("service_role can still TRUNCATE (a scratch table) and write to real tables", async () => {
      await db.seed("create table public.zz_scratch (id int)");
      await db.seed("begin; set local role service_role; truncate table public.zz_scratch; rollback;");
      await db.seed(
        `begin; set local role service_role;
         insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ('${E.emp}', 'annual', '2026-02-01', 'accrual', 1, '${U.hrA}');
         rollback;`,
      );
      await db.seed("drop table public.zz_scratch");
    });

    it("FUTURE tables created by postgres no longer grant the four privileges, but keep the normal ones and service_role's", async () => {
      await db.seed("create table public.zz_future_after (id int)");
      const { rows } = await db.seed(`
        select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs from (
          select pg_get_userbyid(x.grantee) as grantee, x.privilege_type
          from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
          where c.oid = 'public.zz_future_after'::regclass) s group by grantee`);
      const by = Object.fromEntries(rows.map((r) => [r.grantee, r.privs as string]));
      expect(by.anon).toBe("DELETE,INSERT,SELECT,UPDATE");
      expect(by.authenticated).toBe("DELETE,INSERT,SELECT,UPDATE");
      expect(by.service_role).toContain("TRUNCATE");
      await db.seed("drop table public.zz_future_after");
    });

    it("running the migration a second time changes nothing (idempotent)", async () => {
      await db.applyMigration(FIX);
      expect(await matrix()).toEqual(after);
    });

    it("normal access still works: employee reads own record, HR adjusts a ledger, manager approves leave and the balance drops", async () => {
      const own = await db.asUser(U.emp, (q) => q("select id from employees where id = $1", [E.emp]));
      expect(own.rows).toHaveLength(1);
      const other = await db.asUser(U.empB, (q) => q("select id from employees where id = $1", [E.emp]));
      expect(other.rows).toHaveLength(0); // row-level security is untouched

      await db.asUser(U.hrA, async (q) => {
        await q(`insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ('${E.emp}', 'annual', '2026-04-01', 'adjustment', 2, '${U.hrA}')`);
        const bal = await q("select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'", [E.emp]);
        expect(Number(bal.rows[0].balance_days)).toBe(12);
      });

      const requestId = randomUUID();
      const approvalId = randomUUID();
      const wf = (await db.seed(`select id from approval_workflows where company_id = '${COMPANY_A}' and entity_type = 'leave_request'`)).rows[0].id;
      await db.seed(`
        insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days)
          values ('${requestId}', '${E.emp}', 'annual', '2026-05-04', '2026-05-06', 3);
        insert into approvals (id, entity_type, entity_id, workflow_id, step_order, approver_id)
          values ('${approvalId}', 'leave_request', '${requestId}', '${wf}', 1, '${U.mgr}');
      `);
      await db.asUser(U.mgr, async (q) => {
        await q("select decide_leave_approval($1, 'approved', 'enjoy')", [approvalId]);
        const bal = await q("select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'", [E.emp]);
        expect(Number(bal.rows[0].balance_days)).toBe(7); // 10 accrued - 3 deducted
      });
    });
  });

  describe("functions reachable by anon / authenticated", () => {
    // A function that TRUNCATEs, or builds dynamic SQL, could expose or bypass these privileges. Any new such
    // function must be reviewed on purpose: this list is the reviewed set (fixed strings, no caller input).
    it("none of them mentions TRUNCATE or runs DDL (create/alter/drop/grant/revoke ... on a table)", async () => {
      const { rows } = await db.seed(`
        select p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
          and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          and (p.prosrc ~* '\\mtruncate\\M' or p.prosrc ~* '\\m(create|alter|drop)\\s+(table|trigger)\\M' or p.prosrc ~* '\\m(create|alter|drop)\\s+policy\\s+\\S+\\s+on\\M' or p.prosrc ~* '\\m(grant|revoke)\\s+[a-z, ]+\\s+on\\s+')`);
      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it("the only ones using dynamic SQL (EXECUTE) are the reviewed scheduler checks, which run fixed strings", async () => {
      const { rows } = await db.seed(`
        select p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
          and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          and p.prosrc ~* '\\mexecute\\s' order by 1`);
      expect(rows.map((r) => r.proname)).toEqual(["recovery_scheduler_status"]);
      const { rows: src } = await db.seed("select prosrc from pg_proc where proname = 'recovery_scheduler_status'");
      const dyn = [...(src[0].prosrc as string).matchAll(/execute\s+\$q\$([\s\S]*?)\$q\$/gi)].map((m) => m[1]);
      expect(dyn.length).toBeGreaterThan(0);
      for (const s of dyn) expect(s).toMatch(/^select /i);
    });

    it("every SECURITY DEFINER function pins its search_path", async () => {
      const { rows } = await db.seed(`
        select proname from pg_proc p where pronamespace = 'public'::regnamespace and prokind = 'f' and prosecdef
          and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%') order by 1`);
      expect(rows.map((r) => r.proname)).toEqual([]);
    });
  });
});
