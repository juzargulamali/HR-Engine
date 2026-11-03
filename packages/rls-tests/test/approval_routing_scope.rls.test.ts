import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Completion pass, section 3: approval routing and the COUNTRY on a role grant.
//
// The rule (docs/02-database-schema.md, `user_roles`: "optionally scoped to a company/country, e.g. HR Admin for Poland only"; has_role(): a grant applies when
// its company is null or the company asked about AND its country is null or the country asked about): a role grant limited to a country applies only to
// people / companies of that country. resolve_approver() and resolve_approver_for_company() honoured the company limit but ignored the country limit, so a
// CEO limited to one country was resolved as the approver of every company that has no company-limited grant. The fix honours the country, using the
// employee's own country (resolve_approver) or the company's country (resolve_approver_for_company).
//
// Unchanged and tested here: grants with no country limit (company-only, global), inactive holders, approvals already pending, and the shared-queue checks.

const id = () => randomUUID();
const CO = { uae: id(), uae2: id(), ksa: id() };
const U = { ceoScopedSA: id(), ceoScopedAE: id(), ceoKsaCompany: id(), ceoKsaBoth: id(), ceoGlobal: id(), ceoUaeCompany: id(), emp: id(), ksaEmp: id(), uae2Emp: id(), sys: id() };
const E = { emp: id(), ksaEmp: id(), uae2Emp: id(), top: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Approval routing honours the country limit on a role grant", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const grant = (user: string, role: string, company: string | null, country: string | null, ageDays = 1) =>
    admin(`insert into user_roles (user_id, role, company_id, country_code, granted_at) values ('${user}', '${role}', ${company ? `'${company}'` : "null"}, ${country ? `'${country}'` : "null"}, now() - interval '${ageDays} days')`);
  const approver = async (type: string, emp: string) => (await admin<{ a: string | null }>(`select resolve_approver('${type}', '${emp}') as a`))[0]!.a;
  const forCompany = async (type: string, company: string) => (await admin<{ a: string | null }>(`select resolve_approver_for_company('${type}', '${company}') as a`))[0]!.a;
  const clear = () => admin(`delete from user_roles where role in ('ceo', 'cto', 'finance')`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values
        ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.uae2}', 'Enginious UAE Two', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@scope.ae')`).join(", ")};
      update profiles set account_status = 'active';
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.emp}', '${U.emp}', 'S-1', '${CO.uae}', 'AE', 'Erin', 'Employee', '2024-01-01'),
        ('${E.ksaEmp}', '${U.ksaEmp}', 'S-2', '${CO.ksa}', 'SA', 'Kaz', 'Employee', '2024-01-01'),
        ('${E.uae2Emp}', '${U.uae2Emp}', 'S-3', '${CO.uae2}', 'AE', 'Una', 'Employee', '2024-01-01'),
        ('${E.top}', null, 'S-4', '${CO.ksa}', 'SA', 'Top', 'Of Chart', '2024-01-01');
      insert into user_roles (user_id, role, company_id) values ('${U.sys}', 'sys_admin', null);
    `);
  }, 60_000);
  afterAll(async () => db.teardown());
  afterEach(async () => { await clear(); });

  describe("a role limited to one COUNTRY (no company limit)", () => {
    it("is resolved for people of that country only, not for any other company", async () => {
      await grant(U.ceoScopedSA, "ceo", null, "SA");
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoScopedSA);
      expect(await approver("role:ceo", E.emp)).toBeNull();
      expect(await approver("role:ceo", E.uae2Emp)).toBeNull();
      expect(await forCompany("role:ceo", CO.ksa)).toBe(U.ceoScopedSA);
      expect(await forCompany("role:ceo", CO.uae)).toBeNull();
    });

    it("applies to every company of its own country", async () => {
      await grant(U.ceoScopedAE, "ceo", null, "AE");
      expect(await approver("role:ceo", E.emp)).toBe(U.ceoScopedAE);
      expect(await approver("role:ceo", E.uae2Emp)).toBe(U.ceoScopedAE);
      expect(await approver("role:ceo", E.ksaEmp)).toBeNull();
    });

    it("the next eligible holder is used, not the out-of-scope one that is older", async () => {
      await grant(U.ceoScopedSA, "ceo", null, "SA", 30);
      await grant(U.ceoGlobal, "cto", null, null, 1);
      expect(await approver("role:ceo", E.emp)).toBe(U.ceoGlobal);
      expect(await forCompany("role:ceo", CO.uae)).toBe(U.ceoGlobal);
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoScopedSA);
    });

    it("the managerless CEO / CTO fallback (direct_manager, manager_of_manager) honours the country too", async () => {
      await grant(U.ceoScopedAE, "ceo", null, "AE", 30);
      await grant(U.ceoKsaCompany, "cto", CO.ksa, null, 1);
      // a KSA employee with no manager: the AE-limited CEO is not an approver for them
      expect(await approver("direct_manager", E.ksaEmp)).toBe(U.ceoKsaCompany);
      expect(await approver("manager_of_manager", E.ksaEmp)).toBe(U.ceoKsaCompany);
      // a UAE employee with no manager: the AE-limited CEO is
      expect(await approver("direct_manager", E.emp)).toBe(U.ceoScopedAE);
    });

    it("another role is limited the same way", async () => {
      await grant(U.ceoScopedSA, "finance", null, "SA");
      expect(await approver("role:finance", E.ksaEmp)).toBe(U.ceoScopedSA);
      expect(await approver("role:finance", E.emp)).toBeNull();
    });
  });

  describe("grants without a country limit behave exactly as before", () => {
    it("a company-only grant resolves for that company and no other", async () => {
      await grant(U.ceoKsaCompany, "ceo", CO.ksa, null);
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoKsaCompany);
      expect(await approver("role:ceo", E.emp)).toBeNull();
      expect(await forCompany("role:ceo", CO.ksa)).toBe(U.ceoKsaCompany);
      expect(await forCompany("role:ceo", CO.uae)).toBeNull();
    });

    it("a global grant (no company, no country) resolves for everyone", async () => {
      await grant(U.ceoGlobal, "ceo", null, null);
      for (const e of [E.emp, E.ksaEmp, E.uae2Emp]) expect(await approver("role:ceo", e)).toBe(U.ceoGlobal);
      for (const c of [CO.uae, CO.uae2, CO.ksa]) expect(await forCompany("role:ceo", c)).toBe(U.ceoGlobal);
    });

    it("a grant limited to a company AND a country needs both to match", async () => {
      await grant(U.ceoKsaBoth, "ceo", CO.ksa, "SA");
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoKsaBoth);
      expect(await approver("role:ceo", E.emp)).toBeNull();
      // a company limit that disagrees with the country on the grant matches nobody
      await clear();
      await grant(U.ceoKsaBoth, "ceo", CO.ksa, "AE");
      expect(await approver("role:ceo", E.ksaEmp)).toBeNull();
      expect(await approver("role:ceo", E.emp)).toBeNull();
    });

    it("an inactive holder is skipped whatever their scope", async () => {
      await grant(U.ceoScopedSA, "ceo", null, "SA", 30);
      await grant(U.ceoKsaCompany, "ceo", CO.ksa, null, 20);
      await grant(U.ceoGlobal, "ceo", null, null, 10);
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoScopedSA);
      await admin(`update profiles set is_active = false where id = '${U.ceoScopedSA}'`);
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoKsaCompany);
      await admin(`update profiles set is_active = false where id = '${U.ceoKsaCompany}'`);
      expect(await approver("role:ceo", E.ksaEmp)).toBe(U.ceoGlobal);
      await admin(`update profiles set is_active = false where id = '${U.ceoGlobal}'`);
      expect(await approver("role:ceo", E.ksaEmp)).toBeNull();
      await admin(`update profiles set is_active = true where id in ('${U.ceoScopedSA}', '${U.ceoKsaCompany}', '${U.ceoGlobal}')`);
    });

    it("a revoked grant is skipped", async () => {
      await grant(U.ceoScopedSA, "ceo", null, "SA");
      await admin(`update user_roles set revoked_at = now() where user_id = '${U.ceoScopedSA}'`);
      expect(await approver("role:ceo", E.ksaEmp)).toBeNull();
    });
  });

  describe("approvals already pending are not touched by the rule", () => {
    it("a pending approval assigned to a now out-of-scope holder keeps its approver; only NEW requests route by the corrected rule", async () => {
      await grant(U.ceoScopedSA, "ceo", null, "SA", 30);
      await grant(U.ceoGlobal, "cto", null, null, 1);
      // Make a claim for a UAE employee and route it as the old behaviour would have (to the SA-limited CEO): written directly, as it was when it was routed.
      const claim = (await admin<{ id: string }>(`insert into reimbursement_claims (employee_id, currency, status) values ('${E.emp}', 'AED', 'submitted') returning id`))[0]!.id;
      await admin(`
        insert into approvals (entity_type, entity_id, step_order, approver_id, decision)
        values ('reimbursement_claim', '${claim}', 1, '${U.ceoScopedSA}', 'pending')`);
      const before = await admin(`select id, approver_id, decision, decided_at from approvals where entity_id = '${claim}' order by id`);
      // the corrected lookup now says the UAE employee's CEO is the global one ...
      expect(await approver("role:ceo", E.emp)).toBe(U.ceoGlobal);
      // ... but the existing approval row is untouched, still pending on its assigned person
      const after = await admin(`select id, approver_id, decision, decided_at from approvals where entity_id = '${claim}' order by id`);
      expect(after).toEqual(before);
      expect(after[0]).toMatchObject({ approver_id: U.ceoScopedSA, decision: "pending" });
    });
  });

  describe("the checks on the caller are unchanged", () => {
    it("has_role() for a country-limited grant still answers by the country asked about", async () => {
      await grant(U.ceoScopedSA, "ceo", null, "SA");
      const r = await db.asUser(U.ceoScopedSA, async (q) => (await q(`select has_role('ceo', null, 'SA') as sa, has_role('ceo', null, 'AE') as ae, has_role('ceo', '${CO.ksa}') as plain`)).rows[0]);
      expect(r).toEqual({ sa: true, ae: false, plain: false });
    });
  });
});
