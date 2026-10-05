import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// public.leave_balances / public.comp_day_balances were SECURITY DEFINER views (owned by
// `postgres`): they bypassed row-level security, so anon and every signed-in user could read
// every employee's balance in every company. Migration 20261112000000 makes them
// SECURITY INVOKER (+ additive CEO/CTO/Finance ledger policies, + least privilege).
//
// This suite builds the database exactly the way production got it — every migration BEFORE
// the fix, then Supabase's default grants (anon/authenticated get ALL on new objects), then
// the data — proves the exposure, applies ONLY the fix migration, and proves: the exposure is
// gone, every legitimate reader still sees what they saw, and every balance is unchanged.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = "20261112000000_balance_views_security_invoker.sql";
const GRANTS = readFileSync(path.resolve(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8");

const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const id = () => randomUUID();
const U = { emp: id(), mgr: id(), peer: id(), hrA: id(), finA: id(), ceoA: id(), ctoA: id(), empB: id(), hrB: id() };
const E = { emp: id(), mgr: id(), peer: id(), hrA: id(), finA: id(), ceoA: id(), ctoA: id(), empB: id(), hrB: id() };

type Row = { employee_id: string; leave_type_code?: string; balance_days: string };

describe("balance views: security_invoker fix", () => {
  const db = new RlsTestDatabase();
  let baseline: { leave: Row[]; comp: Row[] };

  async function leaveView(userId: string | null) {
    return db.asUser(userId, async (q) => (await q("select employee_id, leave_type_code, balance_days from leave_balances order by employee_id, leave_type_code")).rows as Row[]);
  }
  async function compView(userId: string | null) {
    return db.asUser(userId, async (q) => (await q("select employee_id, balance_days from comp_day_balances order by employee_id")).rows as Row[]);
  }
  const owners = (rows: Row[]) => [...new Set(rows.map((r) => r.employee_id))].sort();
  const ids = (...keys: Array<keyof typeof E>) => keys.map((k) => E[k]).sort();

  beforeAll(async () => {
    await db.setupBefore(FIX);
    // Supabase grants ALL on every new public object to anon/authenticated at creation time.
    await db.seed(GRANTS);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${COMPANY_A}', 'Company A', 'AE', 'AED'), ('${COMPANY_B}', 'Company B', 'AE', 'AED');
      insert into auth.users (id, email) values
        ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@balance-test.ae')`).join(",\n        ")};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.emp}',  '${U.emp}',  'B-EMP',  '${COMPANY_A}', 'AE', 'Emp',  'A', '2024-01-01'),
        ('${E.mgr}',  '${U.mgr}',  'B-MGR',  '${COMPANY_A}', 'AE', 'Mgr',  'A', '2024-01-01'),
        ('${E.peer}', '${U.peer}', 'B-PEER', '${COMPANY_A}', 'AE', 'Peer', 'A', '2024-01-01'),
        ('${E.hrA}',  '${U.hrA}',  'B-HRA',  '${COMPANY_A}', 'AE', 'Hr',   'A', '2024-01-01'),
        ('${E.finA}', '${U.finA}', 'B-FINA', '${COMPANY_A}', 'AE', 'Fin',  'A', '2024-01-01'),
        ('${E.ceoA}', '${U.ceoA}', 'B-CEOA', '${COMPANY_A}', 'AE', 'Ceo',  'A', '2024-01-01'),
        ('${E.ctoA}', '${U.ctoA}', 'B-CTOA', '${COMPANY_A}', 'AE', 'Cto',  'A', '2024-01-01'),
        ('${E.empB}', '${U.empB}', 'B-EMPB', '${COMPANY_B}', 'AE', 'Emp',  'B', '2024-01-01'),
        ('${E.hrB}',  '${U.hrB}',  'B-HRB',  '${COMPANY_B}', 'AE', 'Hr',   'B', '2024-01-01');
      update employees set manager_id = '${E.mgr}' where id = '${E.emp}';
      insert into user_roles (user_id, role, company_id) values
        ('${U.mgr}', 'line_manager', '${COMPANY_A}'), ('${U.hrA}', 'hr_admin', '${COMPANY_A}'), ('${U.finA}', 'finance', '${COMPANY_A}'),
        ('${U.ceoA}', 'ceo', '${COMPANY_A}'), ('${U.ctoA}', 'cto', '${COMPANY_A}'), ('${U.hrB}', 'hr_admin', '${COMPANY_B}');

      insert into leave_ledger (employee_id, leave_type_code, txn_date, entry_type, amount_days, created_by) values
        ('${E.emp}',  'annual', '2026-01-01', 'accrual',   10, '${U.hrA}'),
        ('${E.emp}',  'annual', '2026-02-01', 'deduction', -3, '${U.hrA}'),
        ('${E.emp}',  'sick',   '2026-01-01', 'accrual',    5, '${U.hrA}'),
        ('${E.peer}', 'annual', '2026-01-01', 'accrual',   12, '${U.hrA}'),
        ('${E.mgr}',  'annual', '2026-01-01', 'accrual',   15, '${U.hrA}'),
        ('${E.empB}', 'annual', '2026-01-01', 'accrual',   20, '${U.hrB}');
      insert into comp_day_ledger (employee_id, txn_date, entry_type, days, created_by) values
        ('${E.emp}',  '2026-03-01', 'earned', 1.5, '${U.hrA}'),
        ('${E.emp}',  '2026-03-02', 'earned', 0.5, '${U.hrA}'),
        ('${E.peer}', '2026-03-01', 'earned', 2,   '${U.hrA}'),
        ('${E.empB}', '2026-03-01', 'earned', 3,   '${U.hrB}');
    `);
    baseline = {
      leave: (await db.seed("select employee_id, leave_type_code, balance_days from leave_balances order by employee_id, leave_type_code")).rows as Row[],
      comp: (await db.seed("select employee_id, balance_days from comp_day_balances order by employee_id")).rows as Row[],
    };
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("BEFORE the fix (the production state the advisor flagged)", () => {
    it("the views have no options (SECURITY DEFINER) and are owned by the table owner", async () => {
      const { rows } = await db.seed(`select relname, reloptions, pg_get_userbyid(relowner) as owner from pg_class where relname in ('leave_balances','comp_day_balances') order by 1`);
      expect(rows.map((r) => [r.relname, r.reloptions, r.owner])).toEqual([["comp_day_balances", null, "postgres"], ["leave_balances", null, "postgres"]]);
    });

    it("exposure: anon, an unrelated employee and another company's HR can ALL read every employee's balances", async () => {
      expect(owners(await leaveView(null))).toEqual(ids("emp", "peer", "mgr", "empB"));
      expect(owners(await compView(null))).toEqual(ids("emp", "peer", "empB"));
      expect(owners(await leaveView(U.empB))).toEqual(ids("emp", "peer", "mgr", "empB"));
      expect(owners(await leaveView(U.hrB))).toEqual(ids("emp", "peer", "mgr", "empB"));
    });
  });

  describe("AFTER the fix", () => {
    beforeAll(async () => {
      await db.applyMigration(FIX);
    });

    it("both views are now SECURITY INVOKER", async () => {
      const { rows } = await db.seed(`select relname, reloptions::text as o from pg_class where relname in ('leave_balances','comp_day_balances') order by 1`);
      expect(rows).toEqual([{ relname: "comp_day_balances", o: "{security_invoker=true}" }, { relname: "leave_balances", o: "{security_invoker=true}" }]);
    });

    it("every balance is unchanged (the view definitions and the ledgers are untouched)", async () => {
      const leave = (await db.seed("select employee_id, leave_type_code, balance_days from leave_balances order by employee_id, leave_type_code")).rows;
      const comp = (await db.seed("select employee_id, balance_days from comp_day_balances order by employee_id")).rows;
      expect(leave).toEqual(baseline.leave);
      expect(comp).toEqual(baseline.comp);
      // and the arithmetic itself: 10 accrued - 3 deducted = 7; 1.5 + 0.5 = 2
      expect(Number(leave.find((r) => r.employee_id === E.emp && r.leave_type_code === "annual")!.balance_days)).toBe(7);
      expect(Number(comp.find((r) => r.employee_id === E.emp)!.balance_days)).toBe(2);
    });

    it("anonymous: no access at all to either view", async () => {
      await expect(leaveView(null)).rejects.toThrow(/permission denied/);
      await expect(compView(null)).rejects.toThrow(/permission denied/);
    });

    it("an employee sees only their OWN balances, with the same numbers as before", async () => {
      const l = await leaveView(U.emp);
      expect(owners(l)).toEqual([E.emp]);
      expect(l.map((r) => [r.leave_type_code, Number(r.balance_days)])).toEqual([["annual", 7], ["sick", 5]]);
      const c = await compView(U.emp);
      expect(c.map((r) => [r.employee_id, Number(r.balance_days)])).toEqual([[E.emp, 2]]);
    });

    it("an unrelated colleague sees only their own, never another employee's", async () => {
      expect(owners(await leaveView(U.peer))).toEqual([E.peer]);
      expect(owners(await compView(U.peer))).toEqual([E.peer]);
    });

    it("a line manager sees their own and their direct report's balances, nobody else's", async () => {
      expect(owners(await leaveView(U.mgr))).toEqual(ids("emp", "mgr"));
      expect(owners(await compView(U.mgr))).toEqual(ids("emp"));
    });

    it("HR Admin sees their own company's employees and NOT another company's", async () => {
      expect(owners(await leaveView(U.hrA))).toEqual(ids("emp", "peer", "mgr"));
      expect(owners(await compView(U.hrA))).toEqual(ids("emp", "peer"));
      expect(owners(await leaveView(U.hrB))).toEqual(ids("empB"));
      expect(owners(await compView(U.hrB))).toEqual(ids("empB"));
    });

    it("Finance sees both ledgers for their own company only (Recovery balances were not visible to Finance before — now they are, as through the old view)", async () => {
      expect(owners(await leaveView(U.finA))).toEqual(ids("emp", "peer", "mgr"));
      expect(owners(await compView(U.finA))).toEqual(ids("emp", "peer"));
    });

    it.each([["CEO", "ceoA"], ["CTO", "ctoA"]] as const)("%s sees both ledgers for their own company only", async (_n, key) => {
      expect(owners(await leaveView(U[key]))).toEqual(ids("emp", "peer", "mgr"));
      expect(owners(await compView(U[key]))).toEqual(ids("emp", "peer"));
    });

    it("another company's employee sees nothing of this company", async () => {
      expect(owners(await leaveView(U.empB))).toEqual([E.empB]);
      expect(owners(await compView(U.empB))).toEqual([E.empB]);
    });

    it("nobody can write through the views (aggregate views were never writable; the privileges are now revoked too)", async () => {
      for (const sql of [
        "insert into leave_balances (employee_id, leave_type_code, balance_days) values (gen_random_uuid(), 'annual', 1)",
        "update leave_balances set balance_days = 99",
        "delete from comp_day_balances",
      ]) {
        await expect(db.asUser(U.hrA, async (q) => q(sql))).rejects.toThrow(/permission denied|cannot (insert into|update|delete from) view/);
      }
    });

    it("the raw ledgers keep their own policies: an employee still cannot read a colleague's ledger rows", async () => {
      const rows = await db.asUser(U.peer, async (q) => (await q("select distinct employee_id from leave_ledger")).rows);
      expect(rows.map((r) => r.employee_id)).toEqual([E.peer]);
    });

    it("the approval flow still works end to end: a manager approves a report's leave and reads the reduced balance through the view", async () => {
      const policyId = randomUUID();
      const requestId = randomUUID();
      await db.seed(`
        insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by, approved_by, approved_at)
          values ('${policyId}', 'AE', 'leave_rules', 90, '2020-01-01', 'active', '{}'::jsonb, '${U.hrA}', '${U.ceoA}', now());
        insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method) values ('${policyId}', 'annual', 'Annual Leave', 'monthly_accrual');
        insert into leave_requests (id, employee_id, leave_type_code, start_date, end_date, total_days, status)
          values ('${requestId}', '${E.emp}', 'annual', '2026-06-01', '2026-06-02', 2, 'pending_approval');
        insert into approvals (entity_type, entity_id, step_order, approver_id, decision) values ('leave_request', '${requestId}', 1, '${U.mgr}', 'pending');
      `);
      const { rows: appr } = await db.seed(`select id from approvals where entity_id = '${requestId}'`);
      await db.asUserCommit(U.mgr, async (q) => q("select decide_leave_approval($1, 'approved', 'ok')", [appr[0].id]));
      const after = await db.asUser(U.mgr, async (q) => (await q("select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'", [E.emp])).rows);
      expect(Number(after[0].balance_days)).toBe(5); // 7 - 2
      const asEmployee = await db.asUser(U.emp, async (q) => (await q("select balance_days from leave_balances where employee_id = $1 and leave_type_code = 'annual'", [E.emp])).rows);
      expect(Number(asEmployee[0].balance_days)).toBe(5);
    });

    it("re-applying the migration is harmless (idempotent)", async () => {
      await db.applyMigration(FIX);
      const { rows } = await db.seed(`select reloptions::text as o from pg_class where relname = 'leave_balances'`);
      expect(rows[0].o).toBe("{security_invoker=true}");
    });
  });
});
