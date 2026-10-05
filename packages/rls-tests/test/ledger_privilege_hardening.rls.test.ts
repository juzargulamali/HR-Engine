import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// leave_ledger / comp_day_ledger carried Supabase's broad default grants. TRUNCATE, TRIGGER and
// REFERENCES (and MAINTAIN on PostgreSQL 17) are NOT governed by row-level security. Migration
// 20261113000000 removes them: anon holds nothing, authenticated holds SELECT + INSERT only.
//
// This suite builds the database the way production got it (every migration before the fix, then
// Supabase-style grants INCLUDING truncate/trigger/references, with update/delete already revoked as
// migration 20260926000000 did), proves the privileges exist, applies ONLY the fix, then proves they
// are gone while every legitimate read, HR adjustment and approval posting still works unchanged.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = "20261113000000_ledger_privilege_hardening.sql";
const GRANTS = readFileSync(path.resolve(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8");

const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const id = () => randomUUID();
const U = { emp: id(), mgr: id(), peer: id(), hrA: id(), finA: id(), ceoA: id(), empB: id(), hrB: id() };
const E = { emp: id(), mgr: id(), peer: id(), hrA: id(), finA: id(), ceoA: id(), empB: id(), hrB: id() };
const POLICY = id();

const TABLES = ["leave_ledger", "comp_day_ledger"] as const;
const ownersOf = (rows: Array<{ employee_id: string }>) => [...new Set(rows.map((r) => r.employee_id))].sort();

describe("ledger privilege hardening", () => {
  const db = new RlsTestDatabase();
  let before: Record<string, { leave: string[]; comp: string[] }> = {};
  let balancesBefore: unknown;

  const read = (userId: string | null) =>
    db.asUser(userId, async (q) => ({
      leave: ownersOf((await q("select employee_id from leave_ledger")).rows),
      comp: ownersOf((await q("select employee_id from comp_day_ledger")).rows),
    }));

  async function privileges(role: string, table: string): Promise<string[]> {
    const { rows } = await db.seed(
      `select x.privilege_type from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
       where c.oid = 'public.${table}'::regclass and x.grantee = (select oid from pg_roles where rolname = '${role}') order by 1`,
    );
    return rows.map((r) => r.privilege_type as string);
  }

  beforeAll(async () => {
    await db.setupBefore(FIX);
    await db.seed(GRANTS);
    // Production's state on the ledgers: broad default grants, update/delete already revoked.
    await db.seed(`
      grant truncate, trigger, references on leave_ledger, comp_day_ledger to anon, authenticated;
      revoke update, delete on leave_ledger, comp_day_ledger from anon, authenticated;
    `);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_A}', 'Company A', 'AE', 'AED'), ('${COMPANY_B}', 'Company B', 'AE', 'AED');
      insert into auth.users (id, email) values
        ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@ledger-test.ae')`).join(",\n        ")};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.emp}',  '${U.emp}',  'L-EMP',  '${COMPANY_A}', 'AE', 'Emp',  'A', '2024-01-01'),
        ('${E.mgr}',  '${U.mgr}',  'L-MGR',  '${COMPANY_A}', 'AE', 'Mgr',  'A', '2024-01-01'),
        ('${E.peer}', '${U.peer}', 'L-PEER', '${COMPANY_A}', 'AE', 'Peer', 'A', '2024-01-01'),
        ('${E.hrA}',  '${U.hrA}',  'L-HRA',  '${COMPANY_A}', 'AE', 'Hr',   'A', '2024-01-01'),
        ('${E.finA}', '${U.finA}', 'L-FINA', '${COMPANY_A}', 'AE', 'Fin',  'A', '2024-01-01'),
        ('${E.ceoA}', '${U.ceoA}', 'L-CEOA', '${COMPANY_A}', 'AE', 'Ceo',  'A', '2024-01-01'),
        ('${E.empB}', '${U.empB}', 'L-EMPB', '${COMPANY_B}', 'AE', 'Emp',  'B', '2024-01-01'),
        ('${E.hrB}',  '${U.hrB}',  'L-HRB',  '${COMPANY_B}', 'AE', 'Hr',   'B', '2024-01-01');
      update employees set manager_id = '${E.mgr}' where id = '${E.emp}';
      insert into user_roles (user_id, role, company_id) values
        ('${U.mgr}', 'line_manager', '${COMPANY_A}'), ('${U.hrA}', 'hr_admin', '${COMPANY_A}'), ('${U.finA}', 'finance', '${COMPANY_A}'),
        ('${U.ceoA}', 'ceo', '${COMPANY_A}'), ('${U.hrB}', 'hr_admin', '${COMPANY_B}');
      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
        values ('${POLICY}', 'AE', 'leave_rules', 1, '2020-01-01', 'active', '{}'::jsonb, '${U.hrA}', '${U.ceoA}', now());
      insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method)
        values ('${POLICY}', 'annual', 'Annual Leave', 'monthly_accrual');
      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values
        ('${E.emp}',  'annual', '2026-01-01', 'accrual', 10, '${U.hrA}'),
        ('${E.peer}', 'annual', '2026-01-01', 'accrual', 12, '${U.hrA}'),
        ('${E.empB}', 'annual', '2026-01-01', 'accrual', 20, '${U.hrB}');
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, created_by) values
        ('${E.emp}',  '2026-03-01', 'earned', 1.5, '${U.hrA}'),
        ('${E.empB}', '2026-03-01', 'earned', 3,   '${U.hrB}');
    `);
    for (const [k, v] of Object.entries(U)) before[k] = await read(v);
    balancesBefore = (await db.seed("select employee_id, leave_type_code, balance_days from leave_balances order by 1, 2")).rows;
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("BEFORE the fix (production state)", () => {
    for (const t of TABLES) {
      it(`${t}: anon and authenticated hold TRUNCATE, TRIGGER and REFERENCES`, async () => {
        for (const role of ["anon", "authenticated"]) {
          expect(await privileges(role, t)).toEqual(expect.arrayContaining(["TRUNCATE", "TRIGGER", "REFERENCES"]));
        }
      });
    }

    it("exposure: an ordinary signed-in employee can empty a ledger (rolled back by the test harness)", async () => {
      const remaining = await db.asUser(U.emp, async (q) => {
        await q("truncate table leave_ledger");
        return (await q("select count(*)::int as n from leave_ledger")).rows[0].n;
      });
      expect(remaining).toBe(0);
      expect(Number((await db.seed("select count(*) as n from leave_ledger")).rows[0].n)).toBe(3);
    });
  });

  describe("AFTER the fix", () => {
    beforeAll(async () => {
      await db.applyMigration(FIX);
    });

    for (const t of TABLES) {
      it(`${t}: anon holds nothing; authenticated holds exactly SELECT and INSERT`, async () => {
        expect(await privileges("anon", t)).toEqual([]);
        expect(await privileges("authenticated", t)).toEqual(["INSERT", "SELECT"]);
      });
    }

    it("a signed-in user can no longer TRUNCATE either ledger or attach a trigger to it", async () => {
      for (const t of TABLES) {
        await expect(db.asUser(U.emp, (q) => q(`truncate table ${t}`))).rejects.toThrow(/permission denied/);
        await expect(db.asUser(U.hrA, (q) => q(`truncate table ${t}`))).rejects.toThrow(/permission denied/);
        await expect(
          db.asUser(U.hrA, (q) => q(`create trigger t_probe after insert on ${t} for each row execute function pg_catalog.suppress_redundant_updates_trigger()`)),
        ).rejects.toThrow(/permission denied|must be owner/);
      }
    });

    it("anon cannot read or write either ledger", async () => {
      for (const t of TABLES) {
        await expect(db.asUser(null, (q) => q(`select 1 from ${t}`))).rejects.toThrow(/permission denied/);
      }
      await expect(
        db.asUser(null, (q) => q(`insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ('${E.emp}', 'annual', '2026-04-01', 'accrual', 1, '${U.emp}')`)),
      ).rejects.toThrow(/permission denied/);
    });

    it("update and delete stay denied for signed-in users, HR included", async () => {
      await expect(db.asUser(U.hrA, (q) => q("update leave_ledger set amount_days = 99"))).rejects.toThrow(/permission denied/);
      await expect(db.asUser(U.hrA, (q) => q("delete from comp_day_ledger"))).rejects.toThrow(/permission denied/);
    });

    it("every legitimate reader sees exactly what they saw before (employee, manager, HR, Finance, CEO, other company)", async () => {
      for (const [k, v] of Object.entries(U)) expect(await read(v)).toEqual(before[k]);
    });

    it("HR can still post an adjustment for its own company's employee, to both ledgers", async () => {
      await db.asUser(U.hrA, async (q) => {
        await q(`insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ('${E.emp}', 'annual', '2026-04-01', 'adjustment', 2, '${U.hrA}')`);
        await q(`insert into comp_day_ledger (employee_id, txn_date, entry_type, days, created_by) values ('${E.emp}', '2026-04-01', 'adjustment', 1, '${U.hrA}')`);
        expect(Number((await q("select count(*) as n from leave_ledger where employee_id = $1", [E.emp])).rows[0].n)).toBe(2);
      });
    });

    it("the row-level policies still stop the wrong people from inserting", async () => {
      const ins = (u: string, e: string) =>
        db.asUser(u, (q) => q(`insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values ('${e}', 'annual', '2026-04-01', 'adjustment', 5, '${u}')`));
      await expect(ins(U.emp, E.emp)).rejects.toThrow(/row-level security/);
      await expect(ins(U.mgr, E.emp)).rejects.toThrow(/row-level security/);
      await expect(ins(U.hrB, E.emp)).rejects.toThrow(/row-level security/); // another company's HR
    });

    it("approval posting (SECURITY DEFINER) still writes the deduction, and the balance is right", async () => {
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

    it("balances are untouched by the migration itself", async () => {
      // The adjustments above were rolled back by the harness; the committed ledgers are as seeded,
      // except the approval seeded above (committed request, never decided outside its rolled-back txn).
      const now = (await db.seed("select employee_id, leave_type_code, balance_days from leave_balances order by 1, 2")).rows;
      expect(now).toEqual(balancesBefore);
    });
  });
});
