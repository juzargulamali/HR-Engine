import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// B12 / U-13. module_access_managers(module) names who can manage a module's access in the CALLER'S OWN company, for a person who holds no grant. It returns an
// identifier and a display name only: no emails, no grant rows, no other company, no inactive person, nothing for a signed-out caller.

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = {
  staff: id(),            // plain employee of UAE with no grants at all
  staffKsa: id(),         // plain employee of KSA
  noEmployee: id(),       // signed in, no employee record
  salesFounder: id(), salesManager: id(), salesPlain: id(), salesInactive: id(), salesKsaFounder: id(), salesRevoked: id(),
  projFounder: id(), projManager: id(),
  invFounder: id(),
  budgetManager: id(), budgetFinance: id(), budgetKsaManager: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k.toLowerCase()}@mod-access.example')`).join(", ");
const NAMES: Record<string, string> = {
  salesFounder: "Sara Lead", salesManager: "Sam Manager", salesPlain: "Paula Plain", salesInactive: "Ines Inactive", salesKsaFounder: "Khalid Ksa", salesRevoked: "Rita Revoked",
  projFounder: "Pia Lead", projManager: "Paul Manager", invFounder: "Ivan Lead", budgetManager: "Bea Manager", budgetFinance: "Fiona Finance", budgetKsaManager: "Karim Ksa",
};
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("module_access_managers: who to ask for access (U-13)", () => {
  const db = new RlsTestDatabase();
  const call = (user: string | null, module: string) => db.asUser(user, async (q) => (await q(`select * from module_access_managers('${module}')`)).rows as Row[]);
  const names = async (user: string | null, module: string) => (await call(user, module)).map((r) => r.display_name);

  beforeAll(async () => {
    await db.setup();
    const emp = (user: string, n: number, company: string, country: string) =>
      `insert into employees (user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values ('${user}', 'E${n}', '${company}', '${country}', 'First${n}', 'Last${n}', '2024-01-01');`;
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      grant select, insert, update, delete on all tables in schema public to authenticated;
      ${Object.entries(NAMES).map(([k, n]) => `update profiles set full_name = '${n}' where id = '${U[k as keyof typeof U]}';`).join("\n")}
      ${emp(U.staff, 1, CO.uae, "AE")} ${emp(U.staffKsa, 2, CO.ksa, "SA")}
      -- the grant holders are employees of the company they hold (not required by the function; only the caller needs an employee record)
      insert into crm_company_grants (user_id, company_id, capabilities, revoked_at) values
        ('${U.salesFounder}', '${CO.uae}', '{founder}', null), ('${U.salesManager}', '${CO.uae}', '{manage_access}', null), ('${U.salesPlain}', '${CO.uae}', '{assign_owner}', null),
        ('${U.salesInactive}', '${CO.uae}', '{founder}', null), ('${U.salesKsaFounder}', '${CO.ksa}', '{founder}', null), ('${U.salesRevoked}', '${CO.uae}', '{founder}', now());
      update profiles set is_active = false where id = '${U.salesInactive}';
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.projFounder}', '${CO.uae}', '{founder}'), ('${U.projManager}', '${CO.uae}', '{manage_access}');
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.invFounder}', '${CO.uae}', '{founder}');
      insert into pbx_company_grants (user_id, company_id, capabilities) values
        ('${U.budgetManager}', '${CO.uae}', '{manage_access}'), ('${U.budgetFinance}', '${CO.uae}', '{finance}'), ('${U.budgetKsaManager}', '${CO.ksa}', '{manage_access}');
    `);
  });
  afterAll(async () => db.teardown());

  it("a person with NO grant at all gets the names of their own company's Sales founders and access managers, nothing more", async () => {
    expect(await names(U.staff, "sales")).toEqual(["Sam Manager", "Sara Lead"]);
  });

  it("returns only an identifier and a display name: no email, no grant row, no capabilities", async () => {
    const rows = await call(U.staff, "sales");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["display_name", "user_id"]);
      expect(JSON.stringify(r)).not.toMatch(/@|capabilit|founder|manage_access/i);
    }
  });

  it("never returns another company's holders (and the same module answers differently for another company's employee)", async () => {
    expect(await names(U.staff, "sales")).not.toContain("Khalid Ksa");
    expect(await names(U.staffKsa, "sales")).toEqual(["Khalid Ksa"]);
    expect(await names(U.staff, "budget")).toEqual(["Bea Manager"]);
    expect(await names(U.staffKsa, "budget")).toEqual(["Karim Ksa"]);
  });

  it("lists only people who can manage access: not a plain grant holder, not a Finance-only budget holder, not a revoked grant, not an inactive person", async () => {
    const sales = await names(U.staff, "sales");
    for (const n of ["Paula Plain", "Rita Revoked", "Ines Inactive"]) expect(sales).not.toContain(n);
    expect(await names(U.staff, "budget")).not.toContain("Fiona Finance");
  });

  it("uses each module's own rule: Projects and Inventory founders and manage_access; Budget manage_access only", async () => {
    expect(await names(U.staff, "projects")).toEqual(["Paul Manager", "Pia Lead"]);
    expect(await names(U.staff, "inventory")).toEqual(["Ivan Lead"]);
    expect(await names(U.staff, "budget")).toEqual(["Bea Manager"]);
  });

  it("a person who holds no employee record gets nothing (no company to derive), not another company's list", async () => {
    expect(await call(U.noEmployee, "sales")).toEqual([]);
  });

  it("an inactive caller gets nothing", async () => {
    await db.seed(`update profiles set is_active = false where id = '${U.staff}'`);
    expect(await call(U.staff, "sales")).toEqual([]);
    await db.seed(`update profiles set is_active = true where id = '${U.staff}'`);
  });

  it("an unknown module is refused, and a signed-out caller is refused when calling it directly", async () => {
    await expect(call(U.staff, "payroll")).rejects.toThrow(/Unknown module/);
    await expect(call(null, "sales")).rejects.toThrow();
  });

  it("the grant tables themselves stay closed to a person with no grant (the function does not widen the tables)", async () => {
    expect(await db.asUser(U.staff, async (q) => (await q(`select * from crm_company_grants`)).rows)).toEqual([]);
    expect(await db.asUser(U.staff, async (q) => (await q(`select * from pbx_company_grants`)).rows)).toEqual([]);
  });

  it("anonymous has no execute privilege on the function", async () => {
    const r = await db.seed(`select has_function_privilege('anon', 'module_access_managers(text)', 'execute') as a, has_function_privilege('authenticated', 'module_access_managers(text)', 'execute') as b`);
    expect(r.rows[0]).toEqual({ a: false, b: true });
  });
});
