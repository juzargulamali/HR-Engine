import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
const inserts: { table: string; row: Record<string, unknown> }[] = [];
let selects: Record<string, Result> = {};
let insertResults: Record<string, Result> = {};
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];

function from(table: string) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ["select", "eq", "is", "neq", "limit", "in"]) q[m] = chain;
  q.maybeSingle = async () => selects[table] ?? { data: null, error: null };
  q.insert = async (row: Record<string, unknown>) => { inserts.push({ table, row }); return insertResults[table] ?? { error: null }; };
  q.then = (resolve: (v: Result) => unknown) => resolve(selects[`${table}:list`] ?? { data: [], error: null });
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "user-1", grants, employeeId: null }) }));

import { createEmployee } from "./employeeOnboarding";

const CO = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const base = { employeeId: EMP, companyId: CO, firstName: "Riya", lastName: "Rigger", hireDate: "2026-11-01" };
const run = async (o: Record<string, string>) => { try { return { state: await createEmployee({ error: null }, fd({ ...base, ...o })), redirect: null as string | null }; } catch (e) { const m = String((e as Error).message); if (m.startsWith("REDIRECT:")) return { state: null, redirect: m.slice(9) }; throw e; } };
const wrote = (t: string) => inserts.filter((i) => i.table === t);

beforeEach(() => {
  inserts.length = 0;
  grants = [{ role: "hr_admin", companyId: CO, countryCode: null }];
  selects = { companies: { data: { id: CO, country_code: "SA", default_currency: "SAR" }, error: null } };
  insertResults = {};
});

describe("createEmployee", () => {
  it("is refused for someone who is not an HR Admin of the company, and writes nothing", async () => {
    grants = [{ role: "hr_admin", companyId: "other", countryCode: null }];
    expect((await run({})).state?.error).toBe("You cannot add employees to this company.");
    expect(inserts).toHaveLength(0);
  });
  it("takes the country from the company on the server and uses the posted id as the employee's id", async () => {
    const r = await run({ countryCode: "PL" });
    expect(wrote("employees")[0]!.row).toMatchObject({ id: EMP, company_id: CO, country_code: "SA" });
    // no employee number is sent: the database gives the new hire the next number of the one shared series
    expect(wrote("employees")[0]!.row).not.toHaveProperty("employee_number");
    expect(r.redirect).toBe(`/employees/${EMP}/onboarding?created=1`);
  });
  it("asks for the country only when the company has none, and then uses the posted one", async () => {
    selects.companies = { data: { id: CO, country_code: "", default_currency: "SAR" }, error: null };
    expect((await run({})).state?.error).toMatch(/no country set/);
    expect(inserts).toHaveLength(0);
    await run({ countryCode: "PL" });
    expect(wrote("employees")[0]!.row.country_code).toBe("PL");
  });
  it("writes contract, pay and opening balances only when asked, and a contract with no start date starts on the hire date", async () => {
    const r = await run({ contractType: "permanent", basicSalary: "5000", otherAllowance: "500", openingAnnualLeaveDays: "3", openingCompDays: "1" });
    expect(wrote("employment_contracts")[0]!.row).toMatchObject({ employee_id: EMP, contract_type: "permanent", start_date: "2026-11-01", version_no: 1 });
    expect(wrote("compensation_details")[0]!.row).toMatchObject({ base_salary: 5000, currency: "SAR", effective_from: "2026-11-01", allowances: { other: 500 } });
    expect(wrote("leave_ledger")).toHaveLength(1);
    expect(wrote("comp_day_ledger")).toHaveLength(1);
    expect(r.redirect).toBe(`/employees/${EMP}/onboarding?created=1`);
  });
  it("leaving everything optional out writes only the employee, and the profile opens on its Overview with the setup checklist", async () => {
    const r = await run({});
    expect(inserts.map((i) => i.table)).toEqual(["employees"]);
    expect(r.redirect).toBe(`/employees/${EMP}/onboarding?created=1`);
  });
  it("a repeated send hits the primary key: it opens the existing profile and writes nothing else", async () => {
    insertResults.employees = { error: { code: "23505", message: 'duplicate key value violates unique constraint "employees_pkey"' } };
    selects.employees = { data: { id: EMP }, error: null };
    const r = await run({ contractType: "permanent", basicSalary: "5000", openingAnnualLeaveDays: "3" });
    expect(r.redirect).toBe(`/employees/${EMP}`);
    expect(inserts.map((i) => i.table)).toEqual(["employees"]);
  });
  it("a number typed into the request is ignored: the number always comes from the database's series, never from the browser", async () => {
    const r = await run({ employeeNumber: "E002" });
    expect(wrote("employees")[0]!.row).not.toHaveProperty("employee_number");
    expect(r.redirect).toBe(`/employees/${EMP}/onboarding?created=1`);
  });
  it("a number conflict (not expected, the database skips held numbers) saves nothing and asks to try again, with no raw constraint name", async () => {
    insertResults.employees = { error: { code: "23505", message: 'duplicate key value violates unique constraint "employees_employee_number_canonical_unique"' } };
    const r = await run({});
    expect(r.state).toEqual({ error: "The employee number could not be assigned. Nothing was saved. Try again." });
    expect(inserts.map((i) => i.table)).toEqual(["employees"]);
  });
  it("a failed optional part opens the profile with what failed, never a raw database message, and never repeats the employee", async () => {
    insertResults.employment_contracts = { error: { code: "42501", message: "new row violates row-level security policy" } };
    insertResults.compensation_details = { error: { message: "boom" } };
    const r = await run({ contractType: "permanent", basicSalary: "5000" });
    expect(r.redirect).toContain("created=1");
    expect(r.redirect).toContain("notice=contract%2Cpay");
    expect(r.redirect).not.toMatch(/violates|boom/);
    expect(wrote("employees")).toHaveLength(1);
  });
  it("an opening balance already on record is not posted again, and the unique index's refusal counts as already recorded", async () => {
    selects["leave_ledger:list"] = { data: [{ id: "x" }], error: null };
    await run({ openingAnnualLeaveDays: "3" });
    expect(wrote("leave_ledger")).toHaveLength(0);
    selects["leave_ledger:list"] = { data: [], error: null };
    insertResults.leave_ledger = { error: { code: "23505", message: "duplicate" } };
    const r = await run({ openingAnnualLeaveDays: "3" });
    expect(r.redirect).not.toContain("notice");
  });
  it("checks a department and a manager belong to the company", async () => {
    selects.departments = { data: null, error: null };
    expect((await run({ departmentId: "33333333-3333-4333-8333-333333333333" })).state?.error).toBe("Choose a department of this company.");
    selects.departments = { data: { id: "d" }, error: null };
    selects.employees = { data: null, error: null };
    expect((await run({ managerId: "44444444-4444-4444-8444-444444444444" })).state?.error).toBe("Choose a manager from this company.");
    expect(inserts).toHaveLength(0);
  });
});
