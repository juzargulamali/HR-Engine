import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A12 / D-10. Deactivating an account now makes the person inactive for access and routing (profiles.is_active), not just unable to sign in:
//   * set_account_status sets profiles.is_active in the same transaction (false on deactivate, true on reactivate);
//   * resolve_approver / resolve_approver_for_company / resolve_role_holders / the Recovery Leave routing skip inactive people, so a NEW request goes to
//     the next holder (and a request with nobody else left says so);
//   * the sole CEO / CTO budget approver, the sole CEO / CTO of a company and the last active System Administrator cannot be deactivated;
//   * only a System Administrator can deactivate, and can read what the person still holds; a person cannot flip their own is_active;
//   * approvals ALREADY pending on the person are left exactly as they are (no automatic re-routing).

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = {
  sys1: id(), sys2: id(), hr: id(), ceoA: id(), ctoA: id(), mgr: id(), emp: id(), fin1: id(), fin2: id(), pm: id(), lead: id(),
  ksaCeo: id(), ksaCto: id(), ksaApprover: id(), outsider: id(),
};
const E = { mgr: id(), emp: id(), ceoA: id(), ctoA: id(), hr: id(), lead: id(), ksaCeo: id(), fin1: id(), fin2: id(), pm: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Deactivation makes people inactive for routing and role checks (A12)", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const as = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (q) => (await q(sql)).rows as T[]);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (q) => (await q(sql)).rows as T[]);
  const deactivate = (by: string, target: string, reason = "left the company") => commit(by, `select set_account_status('${target}', 'deactivated', '${reason}')`);
  const reactivate = (by: string, target: string) => commit(by, `select set_account_status('${target}', 'active', 'returned')`);
  const isActive = async (u: string) => (await admin<{ is_active: boolean; account_status: string }>(`select is_active, account_status from profiles where id = '${u}'`))[0]!;
  const approver = async (type: string, emp: string) => (await admin<{ a: string | null }>(`select resolve_approver('${type}', '${emp}') as a`))[0]!.a;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@deact.ae')`).join(", ")};
      update profiles set account_status = 'active';
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.mgr}', '${U.mgr}', 'D-1', '${CO.uae}', 'AE', 'Mona', 'Manager', '2024-01-01'),
        ('${E.emp}', '${U.emp}', 'D-2', '${CO.uae}', 'AE', 'Erin', 'Employee', '2024-01-01'),
        ('${E.ceoA}', '${U.ceoA}', 'D-3', '${CO.uae}', 'AE', 'Cara', 'Ceo', '2024-01-01'),
        ('${E.ctoA}', '${U.ctoA}', 'D-4', '${CO.uae}', 'AE', 'Carl', 'Cto', '2024-01-01'),
        ('${E.hr}', '${U.hr}', 'D-5', '${CO.uae}', 'AE', 'Hana', 'Hr', '2024-01-01'),
        ('${E.lead}', '${U.lead}', 'D-6', '${CO.uae}', 'AE', 'Leo', 'Lead', '2024-01-01'),
        ('${E.ksaCeo}', '${U.ksaCeo}', 'D-7', '${CO.ksa}', 'SA', 'Kaz', 'Ceo', '2024-01-01'),
        ('${E.fin1}', '${U.fin1}', 'D-8', '${CO.uae}', 'AE', 'Fin', 'One', '2024-01-01'),
        ('${E.fin2}', '${U.fin2}', 'D-9', '${CO.uae}', 'AE', 'Fin', 'Two', '2024-01-01'),
        ('${E.pm}', '${U.pm}', 'D-10', '${CO.uae}', 'AE', 'Pia', 'Pm', '2024-01-01');
      update employees set manager_id = '${E.mgr}' where id = '${E.emp}';
      insert into user_roles (user_id, role, company_id, granted_at) values
        ('${U.sys1}', 'sys_admin', null, now() - interval '9 days'), ('${U.sys2}', 'sys_admin', null, now() - interval '8 days'),
        ('${U.hr}', 'hr_admin', '${CO.uae}', now() - interval '7 days'),
        ('${U.ceoA}', 'ceo', '${CO.uae}', now() - interval '6 days'), ('${U.ctoA}', 'cto', '${CO.uae}', now() - interval '5 days'),
        ('${U.mgr}', 'line_manager', '${CO.uae}', now() - interval '4 days'),
        ('${U.fin1}', 'finance', '${CO.uae}', now() - interval '3 days'), ('${U.fin2}', 'finance', '${CO.uae}', now() - interval '2 days'),
        ('${U.ksaCeo}', 'ceo', '${CO.ksa}', now() - interval '1 days'),
        ('${U.ksaCto}', 'cto', '${CO.ksa}', now() - interval '1 days');
      insert into pbx_company_grants (user_id, company_id, capabilities) values
        ('${U.ceoA}', '${CO.uae}', '{executive_approver}'), ('${U.ctoA}', '${CO.uae}', '{executive_approver}'),
        ('${U.ksaApprover}', '${CO.ksa}', '{executive_approver}');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.pm}', '${CO.uae}', '{}');
      insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values
        ('${CO.uae}', 'UAE-P-D1', 'Leaver project', 'internal', 'in_progress', '${U.pm}', '${U.pm}');
    `);
  }, 60_000);
  afterAll(async () => db.teardown());

  describe("the account flag", () => {
    it("deactivating sets profiles.is_active to false in the same step, and reactivating restores it", async () => {
      expect(await isActive(U.hr)).toMatchObject({ is_active: true, account_status: "active" });
      await deactivate(U.sys1, U.hr);
      expect(await isActive(U.hr)).toMatchObject({ is_active: false, account_status: "deactivated" });
      await reactivate(U.sys1, U.hr);
      expect(await isActive(U.hr)).toMatchObject({ is_active: true, account_status: "active" });
    });

    it("only a System Administrator can deactivate, and a person cannot deactivate themselves", async () => {
      for (const who of [U.hr, U.ceoA, U.outsider]) {
        await expect(commit(who, `select set_account_status('${U.emp}', 'deactivated', 'x')`), who).rejects.toThrow(/Only a System Administrator/);
      }
      await expect(commit(U.sys1, `select set_account_status('${U.sys1}', 'deactivated', 'x')`)).rejects.toThrow(/own account status/);
      expect((await isActive(U.emp)).is_active).toBe(true);
    });

    it("a signed-in person cannot flip their own is_active (the flag now gates access)", async () => {
      await expect(commit(U.emp, `update profiles set is_active = false where id = '${U.emp}'`)).rejects.toThrow(/is_active|System Administrator|self-updated/i);
      await deactivate(U.sys1, U.emp);
      await expect(commit(U.emp, `update profiles set is_active = true where id = '${U.emp}'`)).rejects.toThrow(/is_active|System Administrator|self-updated/i);
      expect((await isActive(U.emp)).is_active).toBe(false);
      await reactivate(U.sys1, U.emp);
      // what a person may still change about themselves
      await commit(U.emp, `update profiles set full_name = 'Erin E' where id = '${U.emp}'`);
      expect((await admin(`select full_name from profiles where id = '${U.emp}'`))[0]!.full_name).toBe("Erin E");
    });
  });

  describe("routing skips inactive people (new requests only)", () => {
    it("direct_manager: a deactivated manager is no longer resolved; reactivation restores", async () => {
      expect(await approver("direct_manager", E.emp)).toBe(U.mgr);
      await deactivate(U.sys1, U.mgr);
      expect(await approver("direct_manager", E.emp)).toBeNull();
      await reactivate(U.sys1, U.mgr);
      expect(await approver("direct_manager", E.emp)).toBe(U.mgr);
    });

    it("role:finance and role:ceo go to the next holder, and back when the first is reactivated", async () => {
      expect(await approver("role:finance", E.emp)).toBe(U.fin1);
      await deactivate(U.sys1, U.fin1);
      expect(await approver("role:finance", E.emp)).toBe(U.fin2);
      expect((await admin<{ a: string }>(`select resolve_approver_for_company('role:finance', '${CO.uae}') as a`))[0]!.a).toBe(U.fin2);
      await reactivate(U.sys1, U.fin1);
      expect(await approver("role:finance", E.emp)).toBe(U.fin1);

      expect(await approver("role:ceo", E.emp)).toBe(U.ceoA);
      await deactivate(U.sys1, U.ceoA);
      expect(await approver("role:ceo", E.emp)).toBe(U.ctoA);
      await reactivate(U.sys1, U.ceoA);
      expect(await approver("role:ceo", E.emp)).toBe(U.ceoA);
    });

    it("the managerless fallback (any other CEO / CTO) skips an inactive executive", async () => {
      await deactivate(U.sys1, U.ceoA);
      expect(await approver("direct_manager", E.lead)).toBe(U.ctoA);
      await reactivate(U.sys1, U.ceoA);
    });

    it("resolve_role_holders no longer lists an inactive holder", async () => {
      const holders = async () => (await admin<{ h: string }>(`select resolve_role_holders('finance', '${CO.uae}') as h`)).map((r) => r.h);
      expect(await holders()).toEqual([U.fin1, U.fin2]);
      await deactivate(U.sys1, U.fin1);
      expect(await holders()).toEqual([U.fin2]);
      await reactivate(U.sys1, U.fin1);
    });

    it("a NEW claim routes to the next executive; the claim already pending on the deactivated person stays exactly where it is", async () => {
      const submit = (u: string, e: string) => db.asUserCommit(u, async (q) => {
        const c = await q(`insert into reimbursement_claims (employee_id, currency) values ('${e}', 'AED') returning id`);
        await q(`update reimbursement_claims set status = 'submitted' where id = '${c.rows[0].id}'`);
        return (await q(`select create_initial_approval('reimbursement_claim', '${c.rows[0].id}') as id`)).rows[0].id as string;
      });
      const holder = async (approval: string) => (await admin<{ approver_id: string; decision: string }>(`select approver_id, decision from approvals where id = '${approval}'`))[0]!;
      // nobody manages these two, so a claim goes to the first other CEO / CTO (the CEO, who was granted first)
      const pending = await submit(U.lead, E.lead);
      expect(await holder(pending)).toEqual({ approver_id: U.ceoA, decision: "pending" });
      await deactivate(U.sys1, U.ceoA);
      expect(await holder(pending)).toEqual({ approver_id: U.ceoA, decision: "pending" }); // NO automatic re-routing
      const fresh = await submit(U.hr, E.hr);
      expect(await holder(fresh)).toEqual({ approver_id: U.ctoA, decision: "pending" });
      await reactivate(U.sys1, U.ceoA);
    });
  });

  describe("people who cannot be deactivated", () => {
    it("the last active System Administrator is protected; the earlier wording is unchanged", async () => {
      await deactivate(U.sys1, U.sys2);
      // sys2 is now inactive, so sys1 is the last active System Administrator (the guard counts active accounts, not grants)
      await expect(commit(U.sys2, `select set_account_status('${U.sys1}', 'deactivated', 'x')`)).rejects.toThrow(/last active System Administrator/);
      expect((await isActive(U.sys1)).is_active).toBe(true);
      await reactivate(U.sys1, U.sys2);
      await deactivate(U.sys2, U.sys1); // with two active administrators either may be deactivated by the other
      await reactivate(U.sys2, U.sys1);
    });

    it("the only CEO / CTO budget approver of a company cannot be deactivated, and the message names the company; with a second approver it can", async () => {
      await db.seed(`insert into pbx_company_grants (user_id, company_id, capabilities) values ('${U.ksaCeo}', '${CO.ksa}', '{executive_approver}')`);
      await deactivate(U.sys1, U.ksaApprover); // ksaCeo remains an approver
      await expect(commit(U.sys1, `select set_account_status('${U.ksaCeo}', 'deactivated', 'x')`)).rejects.toThrow(/only CEO \/ CTO approver of project budgets for Enginious KSA/);
      expect((await isActive(U.ksaCeo)).is_active).toBe(true);
      await reactivate(U.sys1, U.ksaApprover);
      await deactivate(U.sys1, U.ksaCeo); // now ksaApprover is a second approver (and ksaCto a second C-level)
      await reactivate(U.sys1, U.ksaCeo);
    });

    it("the only CEO / CTO of a company cannot be deactivated (new requests from managerless people would have nobody)", async () => {
      await db.seed(`delete from pbx_company_grants where user_id in ('${U.ksaCeo}', '${U.ksaApprover}')`);
      await deactivate(U.sys1, U.ksaCto); // the CEO remains
      await expect(commit(U.sys1, `select set_account_status('${U.ksaCeo}', 'deactivated', 'x')`)).rejects.toThrow(/only CEO or CTO of Enginious KSA/);
      expect((await isActive(U.ksaCeo)).is_active).toBe(true);
      await reactivate(U.sys1, U.ksaCto);
    });
  });

  describe("what the person still holds (System Administrator only)", () => {
    it("lists pending approvals, projects managed, roles and module access; refuses everyone else when called directly", async () => {
      const claim = id();
      await db.seed(`
        insert into reimbursement_claims (id, employee_id, currency, status) values ('${claim}', '${E.emp}', 'AED', 'submitted');
        insert into approvals (entity_type, entity_id, step_order, approver_id) values ('reimbursement_claim', '${claim}', 1, '${U.pm}');`);
      const held = (await as<{ h: Row }>(U.sys1, `select account_holdings('${U.pm}') as h`))[0]!.h;
      expect(held.pending_approvals).toEqual([{ entity_type: "reimbursement_claim", count: 1 }]);
      expect(held.projects_managed.map((p: Row) => p.reference)).toEqual(["UAE-P-D1"]);
      expect(held.blockers).toEqual([]);
      await deactivate(U.sys1, U.ksaCto);
      const sole = (await as<{ h: Row }>(U.sys1, `select account_holdings('${U.ksaCeo}') as h`))[0]!.h;
      expect(sole.blockers.join(" ")).toMatch(/only CEO or CTO of Enginious KSA/);
      await reactivate(U.sys1, U.ksaCto);
      for (const who of [U.hr, U.ceoA, U.pm, U.outsider]) await expect(as(who, `select account_holdings('${U.pm}')`), who).rejects.toThrow(/Only a System Administrator/);
      await expect(as(null, `select account_holdings('${U.pm}')`)).rejects.toThrow();
    });

    it("the internal blocker and activity helpers are not callable by signed-in users", async () => {
      await expect(as(U.sys1, `select account_deactivation_blockers('${U.pm}')`)).rejects.toThrow(/permission denied/);
      await expect(as(U.sys1, `select user_is_active('${U.pm}')`)).rejects.toThrow(/permission denied/);
    });
  });

  describe("Recovery Leave routing skips inactive people", () => {
    it("recovery_eligible_approver_exists ignores an inactive holder", async () => {
      const exists = async () => (await admin<{ x: boolean }>(`select recovery_eligible_approver_exists('${CO.uae}', array['hr_admin']::app_role[], null) as x`))[0]!.x;
      expect(await exists()).toBe(true);
      await deactivate(U.sys1, U.hr);
      expect(await exists()).toBe(false);
      await reactivate(U.sys1, U.hr);
      expect(await exists()).toBe(true);
    });
  });
});
