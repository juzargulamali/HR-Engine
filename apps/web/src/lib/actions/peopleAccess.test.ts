import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
type Tables = Record<string, Record<string, unknown>[]>;
let tables: Tables = {};
let updated: { table: string; patch: Record<string, unknown> }[] = [];
let updateResult: Record<string, unknown>[] = [{ id: "x" }];
let inserted: { table: string; row: Record<string, unknown> }[] = [];
let insertRefused = false;
let listError = false;
const NEW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** A tiny query builder: select().eq().is().maybeSingle(), and update().eq().select(). Filters are applied for real so the code under test cannot cheat. */
function from(table: string) {
  const filters: [string, unknown][] = [];
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
    is: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
    maybeSingle: async () => ({ data: rows()[0] ?? null }),
    // awaiting the chain itself is a list read
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(listError && table === "departments" ? { data: null, error: { message: "down" } } : { data: rows(), error: null }).then(resolve),
    insert: (row: Record<string, unknown>) => { inserted.push({ table, row }); return { select: () => ({ maybeSingle: async () => (insertRefused ? { data: null, error: { message: "new row violates row-level security policy" } } : { data: { id: NEW, ...row }, error: null }) }) }; },
    update: (patch: Record<string, unknown>) => { updated.push({ table, patch }); return { eq: () => ({ select: async () => ({ data: updateResult, error: null }) }) }; },
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));
let sessionGrants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "me", email: null, fullName: null, grants: sessionGrants, employeeId: null }) }));

import { addDepartment, applyModuleAccess, revokeModuleAccess, updateJobDetails } from "./peopleAccess";

const U = "33333333-3333-4333-8333-333333333333";
const C = "11111111-1111-4111-8111-111111111111";
const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const E2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const E3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CO2 = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const idle = { error: null };

beforeEach(() => {
  tables = {};
  updated = [];
  inserted = []; insertRefused = false; listError = false;
  updateResult = [{ id: "x" }];
  sessionGrants = [{ role: "hr_admin", companyId: C, countryCode: null }];
  rpc.mockReset().mockResolvedValue({ data: "ok", error: null });
});

describe("applyModuleAccess", () => {
  it("calls the module's own grant function with the rights in the module's order, once each", async () => {
    const r = await applyModuleAccess(idle, fd({ module: "projects", userId: U, companyId: C, capabilities: ["view_commercial", "assign_pm", "assign_pm"] }));
    expect(r.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("proj_grant_access", { p_user_id: U, p_company_id: C, p_capabilities: ["assign_pm", "view_commercial"], p_note: null });
  });

  it("saves the Operations Manager right through the Projects grant function: a Projects capability, not a module of its own", async () => {
    const r = await applyModuleAccess(idle, fd({ module: "projects", userId: U, companyId: C, capabilities: ["operations", "assign_pm"] }));
    expect(r.error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("proj_grant_access", { p_user_id: U, p_company_id: C, p_capabilities: ["assign_pm", "operations"], p_note: null });
    rpc.mockClear();
    expect((await applyModuleAccess(idle, fd({ module: "operations", userId: U, companyId: C, capabilities: ["operations"] }))).error).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the right function for each module", async () => {
    for (const [module, fn] of [["sales", "crm_grant_access"], ["projects", "proj_grant_access"], ["inventory", "inv_grant_access"], ["budget", "pbx_grant_access"]] as const) {
      rpc.mockClear();
      await applyModuleAccess(idle, fd({ module, userId: U, companyId: C, capabilities: module === "budget" ? ["view"] : [] }));
      expect(rpc).toHaveBeenCalledWith(fn, expect.objectContaining({ p_user_id: U, p_company_id: C }));
    }
  });

  it("refuses a right that is not one of the module's rights, without calling the database", async () => {
    const r = await applyModuleAccess(idle, fd({ module: "sales", userId: U, companyId: C, capabilities: ["assign_owner", "superuser"] }));
    expect(r.error).toMatch(/not one of this module/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a budget grant with nothing in it", async () => {
    const r = await applyModuleAccess(idle, fd({ module: "budget", userId: U, companyId: C }));
    expect(r.error).toMatch(/at least one right/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops a stale form: the grant functions REPLACE the set, so a right given in the meantime must not be dropped silently", async () => {
    tables = { crm_company_grants: [{ user_id: U, company_id: C, revoked_at: null, capabilities: ["assign_owner", "view_audit"] }] };
    const stale = await applyModuleAccess(idle, fd({ module: "sales", userId: U, companyId: C, before: "assign_owner", capabilities: ["assign_owner", "reopen_closed"] }));
    expect(stale.error).toMatch(/changed by someone else/);
    expect(rpc).not.toHaveBeenCalled();
    const fresh = await applyModuleAccess(idle, fd({ module: "sales", userId: U, companyId: C, before: "assign_owner,view_audit", capabilities: ["assign_owner", "view_audit", "reopen_closed"] }));
    expect(fresh.error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("treats 'no access' and 'basic access' as different starting points for the stale check", async () => {
    tables = { inv_company_grants: [{ user_id: U, company_id: C, revoked_at: null, capabilities: [] }] };
    expect((await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, before: "", capabilities: ["warehouse"] }))).error).toMatch(/changed by someone else/);
    expect((await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, before: "-", capabilities: ["warehouse"] }))).error).toBeNull();
    tables = {};
    rpc.mockClear();
    expect((await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, before: "-", capabilities: ["warehouse"] }))).error).toMatch(/changed by someone else/);
  });

  it("shows the database's refusal in plain words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only a Projects founder can grant founder or access-management rights" } });
    const r = await applyModuleAccess(idle, fd({ module: "projects", userId: U, companyId: C, capabilities: ["manage_access"] }));
    expect(r.error).toMatch(/founder/);
  });

  it("a forged request for a right the viewer may not grant is still refused by the grant function, and no location is saved after a refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only an Inventory founder can grant founder, access-management or cost rights" } });
    const r = await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, capabilities: ["warehouse", "view_costs"], withLocations: "1", locationIds: [] }));
    expect(r.error).toMatch(/founder/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith("inv_set_operator_locations", expect.anything());
  });

  it("saves a warehouse operator's locations only when the form carried them", async () => {
    await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, capabilities: ["warehouse"] }));
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear();
    await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, capabilities: ["warehouse"], withLocations: "1", locationIds: [E1, "not-a-uuid"] }));
    expect(rpc).toHaveBeenLastCalledWith("inv_set_operator_locations", { p_company_id: C, p_user_id: U, p_location_ids: [E1] });
  });

  it("says when access was saved but the locations were not", async () => {
    rpc.mockResolvedValueOnce({ data: "ok", error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const r = await applyModuleAccess(idle, fd({ module: "inventory", userId: U, companyId: C, capabilities: ["warehouse"], withLocations: "1", locationIds: [E1] }));
    expect(r.error).toMatch(/Access was saved, but the locations were not/);
  });
});

describe("revokeModuleAccess", () => {
  it("calls the module's own revoke function", async () => {
    expect((await revokeModuleAccess(idle, fd({ module: "budget", userId: U, companyId: C }))).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("pbx_revoke_access", { p_user_id: U, p_company_id: C });
  });
  it("shows the refusal when the last access manager would be removed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Cannot revoke the last person who manages access to project budgets for this company" } });
    expect((await revokeModuleAccess(idle, fd({ module: "budget", userId: U, companyId: C }))).error).toMatch(/last person/);
  });
});

describe("updateJobDetails", () => {
  const employees = () => [
    { id: E1, company_id: C, job_title: "Technician", department_id: null, manager_id: null, deleted_at: null },
    { id: E2, company_id: C, job_title: "Lead", department_id: null, manager_id: null, deleted_at: null },
    { id: E3, company_id: CO2, job_title: "Other company", department_id: null, manager_id: null, deleted_at: null },
  ];
  beforeEach(() => { tables = { employees: employees(), departments: [{ id: D1, company_id: C, deleted_at: null }] }; });

  it("changes only the title, department and manager of the employee row", async () => {
    const r = await updateJobDetails(idle, fd({ employeeId: E1, jobTitle: " Senior technician ", departmentId: D1, managerId: E2 }));
    expect(r.error).toBeNull();
    expect(updated).toEqual([{ table: "employees", patch: { job_title: "Senior technician", department_id: D1, manager_id: E2 } }]);
  });

  it("is for the HR Admin of the employee's company only", async () => {
    sessionGrants = [{ role: "hr_admin", companyId: CO2, countryCode: null }];
    expect((await updateJobDetails(idle, fd({ employeeId: E1, jobTitle: "x" }))).error).toMatch(/Only an HR Admin of this employee's company/);
    sessionGrants = [{ role: "sys_admin", companyId: null, countryCode: null }];
    expect((await updateJobDetails(idle, fd({ employeeId: E1, jobTitle: "x" }))).error).toMatch(/Only an HR Admin/);
    expect(updated).toEqual([]);
  });

  it("refuses a manager from another company, the person themselves, and a department of another company", async () => {
    expect((await updateJobDetails(idle, fd({ employeeId: E1, managerId: E3 }))).error).toMatch(/same company/);
    expect((await updateJobDetails(idle, fd({ employeeId: E1, managerId: E1 }))).error).toMatch(/own manager/);
    tables.departments = [{ id: D1, company_id: CO2, deleted_at: null }];
    expect((await updateJobDetails(idle, fd({ employeeId: E1, departmentId: D1 }))).error).toMatch(/department of this employee's company/);
    expect(updated).toEqual([]);
  });

  it("refuses a reporting circle", async () => {
    // E2 reports to E1; making E1 report to E2 would close the loop.
    tables.employees = [{ ...employees()[0]! }, { ...employees()[1]!, manager_id: E1 }, employees()[2]!];
    expect((await updateJobDetails(idle, fd({ employeeId: E1, managerId: E2 }))).error).toMatch(/reporting circle/);
    expect(updated).toEqual([]);
  });

  it("does nothing, and says nothing is wrong, when nothing changed", async () => {
    expect((await updateJobDetails(idle, fd({ employeeId: E1, jobTitle: "Technician" }))).error).toBeNull();
    expect(updated).toEqual([]);
  });

  it("does not claim success when the database changed no row", async () => {
    updateResult = [];
    expect((await updateJobDetails(idle, fd({ employeeId: E1, jobTitle: "New title" }))).error).toMatch(/not saved/);
  });

  it("clears a field that is left empty", async () => {
    tables.employees = [{ ...employees()[0]!, department_id: D1, manager_id: E2 }, employees()[1]!, employees()[2]!];
    await updateJobDetails(idle, fd({ employeeId: E1, jobTitle: "", departmentId: "", managerId: "" }));
    expect(updated[0]?.patch).toEqual({ job_title: null, department_id: null, manager_id: null });
  });
});

describe("addDepartment", () => {
  const emp = (company = C) => [{ id: E1, company_id: company, deleted_at: null }];
  beforeEach(() => { tables = { employees: emp(), departments: [{ id: D1, company_id: C, name: "Engineering", deleted_at: null }, { id: "d-other", company_id: CO2, name: "Warehouse", deleted_at: null }] }; });

  it("adds the trimmed name to the employee's own company and returns the new department so it can be offered at once", async () => {
    const r = await addDepartment(idle, fd({ employeeId: E1, name: "  Site   Operations " }));
    expect(r).toEqual({ error: null, id: NEW, name: "Site Operations" });
    expect(inserted).toEqual([{ table: "departments", row: { company_id: C, name: "Site Operations" } }]);
  });

  it("takes the company from the employee record, never from the form", async () => {
    await addDepartment(idle, fd({ employeeId: E1, name: "Content", companyId: CO2, company_id: CO2 }));
    expect(inserted[0]!.row.company_id).toBe(C);
  });

  it("refuses a blank name and a name already used in that company, whatever its capitals or spaces", async () => {
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "   " }))).error).toBe("Enter the department's name.");
    expect((await addDepartment(idle, fd({ employeeId: E1, name: " ENGINEERING " }))).error).toMatch(/already has a department called "ENGINEERING"/);
    expect(inserted).toEqual([]);
    // the same name in another company is not a duplicate here
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Warehouse" }))).error).toBeNull();
    // a removed department's name can be used again
    tables.departments = [{ id: D1, company_id: C, name: "Engineering", deleted_at: "2026-01-01" }];
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Engineering" }))).error).toBeNull();
  });

  it("refuses an HR Admin of another company, a person with no HR Admin role, and an employee they cannot see", async () => {
    tables.employees = emp(CO2);
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Content" }))).error).toBe("Only an HR Admin of this employee's company can add a department.");
    tables.employees = emp();
    sessionGrants = [{ role: "employee", companyId: C, countryCode: null }];
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Content" }))).error).toMatch(/Only an HR Admin/);
    sessionGrants = [{ role: "hr_admin", companyId: C, countryCode: null }];
    tables.employees = [];
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Content" }))).error).toBe("You cannot see this employee record.");
    expect(inserted).toEqual([]);
  });

  it("adds nothing when the existing departments cannot be checked, and says so when the database refuses the insert", async () => {
    listError = true;
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Content" }))).error).toMatch(/could not be checked, so nothing was added/);
    expect(inserted).toEqual([]);
    listError = false; insertRefused = true;
    expect((await addDepartment(idle, fd({ employeeId: E1, name: "Content" }))).error).toMatch(/not allowed to add departments for this company/);
  });
});
