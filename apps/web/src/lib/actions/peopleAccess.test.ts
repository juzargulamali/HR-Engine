import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
type Tables = Record<string, Record<string, unknown>[]>;
let tables: Tables = {};
let updated: { table: string; patch: Record<string, unknown> }[] = [];
let updateResult: Record<string, unknown>[] = [{ id: "x" }];

/** A tiny query builder: select().eq().is().maybeSingle(), and update().eq().select(). Filters are applied for real so the code under test cannot cheat. */
function from(table: string) {
  const filters: [string, unknown][] = [];
  const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
    is: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
    maybeSingle: async () => ({ data: rows()[0] ?? null }),
    update: (patch: Record<string, unknown>) => { updated.push({ table, patch }); return { eq: () => ({ select: async () => ({ data: updateResult, error: null }) }) }; },
  };
  return chain;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));
let sessionGrants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "me", email: null, fullName: null, grants: sessionGrants, employeeId: null }) }));

import { applyModuleAccess, revokeModuleAccess, updateJobDetails } from "./peopleAccess";

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
