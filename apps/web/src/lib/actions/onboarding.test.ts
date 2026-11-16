import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };
const writes: { table: string; kind: "insert" | "update"; row: Record<string, unknown> }[] = [];
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let selects: Record<string, Result> = {};
let writeResults: Record<string, Result> = {};
let rpcResults: Record<string, Result> = {};
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
let moduleGrantRows: Record<string, { company_id: string; capabilities: string[] }[]> = {};
const invitations: string[] = [];
let inviteResult: { error: string | null; alreadyRegistered: boolean } = { error: null, alreadyRegistered: false };

function from(table: string) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ["select", "eq", "is", "neq", "limit", "in", "ilike", "order"]) q[m] = chain;
  q.maybeSingle = async () => selects[table] ?? { data: null, error: null };
  q.insert = async (row: Record<string, unknown>) => { writes.push({ table, kind: "insert", row }); return writeResults[table] ?? { error: null }; };
  q.update = (row: Record<string, unknown>) => { writes.push({ table, kind: "update", row }); const u: Record<string, unknown> = {}; u.eq = () => u; u.is = () => u; u.then = (r: (v: Result) => unknown) => r(writeResults[table] ?? { error: null }); return u; };
  q.then = (resolve: (v: Result) => unknown) => resolve(table.endsWith("_company_grants") ? { data: moduleGrantRows[table] ?? [], error: null } : (selects[`${table}:list`] ?? { data: [], error: null }));
  return q;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpcResults[name] ?? { data: null, error: null }; } }),
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "user-1", grants, employeeId: null }) }));
vi.mock("@/lib/auth/invite-email", () => ({ sendInvitation: async (email: string) => { invitations.push(email); return inviteResult; } }));

import { applyOnboardingAccess, inviteAndLinkEmployee, saveOnboardingPlan } from "./onboarding";

const CO = "11111111-1111-4111-8111-111111111111";
const CO2 = "33333333-3333-4333-8333-333333333333";
const EMP = "22222222-2222-4222-8222-222222222222";
const USER = "44444444-4444-4444-8444-444444444444";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const employee = (over: Record<string, unknown> = {}) => ({ data: { id: EMP, company_id: CO, first_name: "Riya", last_name: "Rigger", user_id: null, employment_status: "active", deleted_at: null, ...over }, error: null });
const g = (role: string, companyId: string | null = null) => ({ role, companyId, countryCode: null });
const planRow = (over: Record<string, unknown> = {}) => ({ data: { invite_email: "riya@example.test", hr_roles: [], module_grants: [], ...over }, error: null });
const snapshot = (over: Record<string, unknown> = {}) => ({ data: { account: { status: "invited", active: true, email: "riya@example.test" }, roles: [], modules: [], ...over }, error: null });

beforeEach(() => {
  writes.length = 0; rpcCalls.length = 0; invitations.length = 0;
  grants = [g("hr_admin", CO)];
  selects = { employees: employee(), companies: { data: null, error: null }, "companies:list": { data: [{ id: CO, legal_name: "Enginious UAE" }, { id: CO2, legal_name: "Enginious Europe" }], error: null } };
  writeResults = {}; rpcResults = {}; moduleGrantRows = {}; inviteResult = { error: null, alreadyRegistered: false };
});

describe("saveOnboardingPlan", () => {
  const plan = (p: object) => fd({ employeeId: EMP, plan: JSON.stringify(p) });
  it("is refused for someone who is neither an HR Admin of the company nor a System Administrator, and writes nothing", async () => {
    grants = [g("hr_admin", CO2)];
    const r = await saveOnboardingPlan({ error: null }, plan({ inviteEmail: null, hrRoles: [], modules: [] }));
    expect(r.error).toMatch(/Only an HR Admin of this employee's company or a System Administrator/);
    expect(writes).toHaveLength(0);
  });
  it("saves one plan row against the employee, keeps the company from the database, and resets the review", async () => {
    const r = await saveOnboardingPlan({ error: null }, plan({ inviteEmail: "Riya@Example.test", hrRoles: [{ role: "employee", companyId: CO }], modules: [{ module: "sales", companyId: CO, capabilities: ["assign_owner"] }] }));
    expect(r.error).toBeNull();
    const w = writes.find((x) => x.table === "employee_onboarding_plans")!;
    expect(w.kind).toBe("insert");
    expect(w.row).toMatchObject({ employee_id: EMP, company_id: CO, invite_email: "riya@example.test", reviewed_at: null, reviewed_by: null });
    expect(w.row.hr_roles).toEqual([{ role: "employee", companyId: CO }]);
  });
  it("updates the existing row on a repeat instead of adding a second", async () => {
    selects["employee_onboarding_plans"] = { data: { employee_id: EMP }, error: null };
    await saveOnboardingPlan({ error: null }, plan({ inviteEmail: null, hrRoles: [], modules: [] }));
    expect(writes.find((x) => x.table === "employee_onboarding_plans")!.kind).toBe("update");
  });
  it("refuses a company the person does not run HR for (the plan itself is limited to the companies they administer)", async () => {
    const r = await saveOnboardingPlan({ error: null }, plan({ inviteEmail: null, hrRoles: [{ role: "employee", companyId: CO2 }], modules: [] }));
    expect(r.error).toBe("You can plan access only for companies you run HR for.");
    expect(writes).toHaveLength(0);
    grants = [g("hr_admin", CO), g("sys_admin")];
    expect((await saveOnboardingPlan({ error: null }, plan({ inviteEmail: null, hrRoles: [{ role: "employee", companyId: CO2 }], modules: [] }))).error).toBeNull();
  });
  it("rejects a bad email, unreadable input and a Budget line with no right", async () => {
    expect((await saveOnboardingPlan({ error: null }, plan({ inviteEmail: "nope", hrRoles: [], modules: [] }))).error).toMatch(/valid email/);
    expect((await saveOnboardingPlan({ error: null }, fd({ employeeId: EMP, plan: "{" }))).error).toMatch(/could not be read/);
    expect((await saveOnboardingPlan({ error: null }, plan({ inviteEmail: null, hrRoles: [], modules: [{ module: "budget", companyId: CO, capabilities: [], note: null }] }))).error).toMatch(/Budget access needs at least one right/);
  });
  it("does not work on a record that has left", async () => {
    selects.employees = employee({ employment_status: "terminated" });
    expect((await saveOnboardingPlan({ error: null }, plan({ inviteEmail: null, hrRoles: [], modules: [] }))).error).toMatch(/not active/);
  });
});

describe("inviteAndLinkEmployee", () => {
  beforeEach(() => { selects.employee_onboarding_plans = planRow(); });
  it("does nothing when an account is already linked", async () => {
    selects.employees = employee({ user_id: USER });
    const r = await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }));
    expect(r.notice).toMatch(/already has a linked account/);
    expect(invitations).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
  it("needs the address in the plan", async () => {
    selects.employee_onboarding_plans = planRow({ invite_email: null });
    expect((await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }))).error).toMatch(/Add the work email address/);
  });
  it("links an account that already exists WITHOUT sending a second invitation (an HR Admin of the company can)", async () => {
    selects.profiles = { data: { id: USER }, error: null };
    const r = await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }));
    expect(r.error).toBeNull();
    expect(invitations).toHaveLength(0);
    expect(writes.find((w) => w.table === "employees")).toMatchObject({ kind: "update", row: { user_id: USER } });
  });
  it("refuses an HR Admin who is not a System Administrator when no account exists, and says the address stays in the plan", async () => {
    const r = await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }));
    expect(r.error).toMatch(/Only a System Administrator can send the invitation/);
    expect(invitations).toHaveLength(0);
  });
  it("a company-limited System Administrator is treated as NOT a System Administrator", async () => {
    grants = [g("hr_admin", CO), g("sys_admin", CO)];
    expect((await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }))).error).toMatch(/Only a System Administrator can send the invitation/);
    expect(invitations).toHaveLength(0);
  });
  it("an unrestricted System Administrator who is also HR Admin sends the invitation once and links the new account", async () => {
    grants = [g("hr_admin", CO), g("sys_admin")];
    let calls = 0;
    selects.profiles = { get data() { calls += 1; return calls === 1 ? null : { id: USER }; }, error: null } as never;
    const r = await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }));
    expect(invitations).toEqual(["riya@example.test"]);
    expect(r.notice).toMatch(/Invitation sent to riya@example.test and linked/);
    expect(writes.find((w) => w.table === "employees")).toMatchObject({ row: { user_id: USER } });
  });
  it("a System Administrator who is not HR Admin of the company sends the invitation and leaves the linking to an HR Admin", async () => {
    grants = [g("sys_admin")];
    let calls = 0;
    selects.profiles = { get data() { calls += 1; return calls === 1 ? null : { id: USER }; }, error: null } as never;
    const r = await inviteAndLinkEmployee({ error: null }, fd({ employeeId: EMP }));
    expect(invitations).toHaveLength(1);
    expect(r.notice).toMatch(/An HR Admin of this company links the new account/);
    expect(writes.find((w) => w.table === "employees")).toBeUndefined();
  });
});

describe("applyOnboardingAccess", () => {
  beforeEach(() => {
    selects.employees = employee({ user_id: USER });
    selects.employee_onboarding_plans = planRow({ hr_roles: [{ role: "line_manager", companyId: CO }], module_grants: [{ module: "sales", companyId: CO, capabilities: ["assign_owner"], note: null }] });
    rpcResults.onboarding_access_snapshot = snapshot();
  });
  it("needs the review box ticked and a linked account", async () => {
    expect((await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP }))).error).toMatch(/Tick the box/);
    selects.employees = employee({ user_id: null });
    expect((await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }))).error).toMatch(/Link the employee's account first/);
    expect(writes).toHaveLength(0);
  });
  it("an HR Admin alone applies NOTHING: the role and the module right are each reported with who can do them", async () => {
    const r = await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }));
    expect(r.results!.map((x) => x.outcome)).toEqual(["blocked", "blocked"]);
    expect(r.results![0]!.message).toMatch(/unrestricted System Administrator/);
    expect(r.results![1]!.message).toMatch(/founder or access manager/);
    expect(writes.filter((w) => w.table === "user_roles")).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.name.endsWith("_grant_access"))).toHaveLength(0);
  });
  it("an unrestricted System Administrator applies the role; the module right still needs a founder or access manager", async () => {
    grants = [g("hr_admin", CO), g("sys_admin")];
    const r = await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }));
    expect(r.results!.map((x) => x.outcome)).toEqual(["applied", "blocked"]);
    expect(writes.find((w) => w.table === "user_roles")).toMatchObject({ kind: "insert", row: { user_id: USER, role: "line_manager", company_id: CO } });
  });
  it("an access manager for that module and company applies the ordinary right, adding to what is held and never removing", async () => {
    moduleGrantRows.crm_company_grants = [{ company_id: CO, capabilities: ["manage_access"] }];
    rpcResults.onboarding_access_snapshot = snapshot({ modules: [{ module: "sales", companyId: CO, capabilities: ["reopen_closed"] }] });
    const r = await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }));
    expect(r.results!.find((x) => x.key.startsWith("module:"))!.outcome).toBe("applied");
    const call = rpcCalls.find((c) => c.name === "crm_grant_access")!;
    expect(call.args).toMatchObject({ p_user_id: USER, p_company_id: CO });
    expect([...(call.args.p_capabilities as string[])].sort()).toEqual(["assign_owner", "reopen_closed"]);
  });
  it("a retry skips what is already in place and writes nothing twice", async () => {
    grants = [g("hr_admin", CO), g("sys_admin")];
    moduleGrantRows.crm_company_grants = [{ company_id: CO, capabilities: ["manage_access"] }];
    rpcResults.onboarding_access_snapshot = snapshot({ roles: [{ role: "line_manager", companyId: CO }], modules: [{ module: "sales", companyId: CO, capabilities: ["assign_owner"] }] });
    const r = await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }));
    expect(r.results!.map((x) => x.outcome)).toEqual(["already", "already"]);
    expect(writes.filter((w) => w.table === "user_roles")).toHaveLength(0);
    expect(rpcCalls.filter((c) => c.name.endsWith("_grant_access"))).toHaveLength(0);
  });
  it("refuses to apply when what the person already holds could not be read", async () => {
    rpcResults.onboarding_access_snapshot = { data: null, error: { message: "boom" } };
    expect((await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }))).error).toMatch(/could not be read, so nothing was applied/);
  });
  it("a plain person is refused outright", async () => {
    grants = [g("employee", CO)];
    expect((await applyOnboardingAccess({ error: null }, fd({ employeeId: EMP, confirmReviewed: "on" }))).error).toMatch(/Only an HR Admin/);
  });
});
