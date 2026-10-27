import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let rpcs: Record<string, Row[]> = {};
let calls: string[] = [];
let session: { userId: string; email: string | null; fullName: string | null; grants: { role: string; companyId: string | null; countryCode: string | null }[]; employeeId: string | null } | null = null;

/** A recording fake of the query builder: filters are applied for real, and every table or function touched is remembered so a test can prove what was NOT asked for. */
function from(table: string) {
  calls.push(`from:${table}`);
  const filters: ((r: Row) => boolean)[] = [];
  const q: Record<string, unknown> = {
    select: () => q,
    order: () => q,
    limit: () => q,
    or: () => q,
    not: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    maybeSingle: async () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
  };
  return q;
}
const rpc = (name: string) => { calls.push(`rpc:${name}`); return Promise.resolve({ data: rpcs[name] ?? [], error: null }); };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => session }));

import { loadPeopleAccess, type PeopleAccessData } from "./data";

const ME = "00000000-0000-4000-8000-000000000001";
const AMINA = "00000000-0000-4000-8000-000000000002";
const OMAR = "00000000-0000-4000-8000-000000000003";
const CA = "10000000-0000-4000-8000-000000000001";
const CB = "10000000-0000-4000-8000-000000000002";
const role = (r: string, companyId: string | null = null) => ({ role: r, companyId, countryCode: null });
const ok = async (query = {}): Promise<PeopleAccessData> => {
  const r = await loadPeopleAccess(query);
  if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
  return r.data;
};

beforeEach(() => {
  calls = [];
  session = { userId: ME, email: null, fullName: "Me", grants: [], employeeId: null };
  rpcs = {};
  tables = {
    companies: [{ id: CA, legal_name: "Enginious A", is_active: true, deleted_at: null }, { id: CB, legal_name: "Enginious B", is_active: true, deleted_at: null }],
    profiles: [
      { id: ME, email: "me@x.ae", full_name: "Me", account_status: "active", is_active: true },
      { id: AMINA, email: "amina@x.ae", full_name: "Amina", account_status: "active", is_active: true },
      { id: OMAR, email: "omar@x.ae", full_name: "Omar", account_status: "invited", is_active: true },
    ],
    user_roles: [{ id: "r1", user_id: AMINA, role: "hr_admin", company_id: CA, revoked_at: null }],
    employees: [
      { id: "e1", user_id: AMINA, company_id: CA, first_name: "Amina", last_name: "Khan", job_title: "HR lead", department_id: null, manager_id: null, employment_status: "active", deleted_at: null },
      { id: "e2", user_id: null, company_id: CA, first_name: "Karim", last_name: "Noor", job_title: "Driver", department_id: null, manager_id: null, employment_status: "active", deleted_at: null },
    ],
    departments: [],
    crm_company_grants: [], proj_company_grants: [], inv_company_grants: [], pbx_company_grants: [],
    proj_company_settings: [], inv_company_sharing: [], inv_locations: [], inv_operator_locations: [],
  };
});

describe("who may open People & Access", () => {
  it("is closed to a CEO, CTO, Finance person or employee with no module access to manage", async () => {
    session!.grants = [role("ceo"), role("cto"), role("finance"), role("employee")];
    tables.pbx_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["finance", "executive_approver"], revoked_at: null }];
    expect((await loadPeopleAccess({})).kind).toBe("denied");
  });

  it("is closed to someone who holds module rights other than access management", async () => {
    tables.crm_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["assign_owner", "manage_settings"], revoked_at: null }];
    tables.proj_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["assign_pm"], revoked_at: null }];
    expect((await loadPeopleAccess({})).kind).toBe("denied");
  });

  it("says signed-out when there is no session", async () => {
    session = null;
    expect((await loadPeopleAccess({})).kind).toBe("signed-out");
  });
});

describe("System Administrator (option A: accounts and HR roles, no module power by title)", () => {
  beforeEach(() => { session!.grants = [role("sys_admin")]; });

  it("sees every account and its address, HR roles and job titles", async () => {
    const d = await ok();
    expect(d.people.map((p) => p.name).sort()).toEqual(["Amina", "Karim Noor", "Me", "Omar"].sort());
    expect(d.people.find((p) => p.userId === AMINA)?.email).toBe("amina@x.ae");
    expect(d.people.find((p) => p.userId === AMINA)?.roles.map((r) => r.role)).toEqual(["hr_admin"]);
    expect(d.people.find((p) => p.userId === AMINA)?.jobTitle).toBe("HR lead");
    expect(d.isSysAdmin).toBe(true);
  });

  it("gets no Module access tab and no module data unless it also holds the access-management right", async () => {
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.tabs).toEqual(["account", "job", "roles"]);
    expect(d.managed).toEqual([]);
    expect(d.moduleContexts).toEqual([]);
    // it never asked for any module's staff directory or grants beyond its own grants
    expect(calls.filter((c) => c.startsWith("rpc:"))).toEqual([]);
  });

  it("can read but not edit a job: only an HR Admin of the company can", async () => {
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.employee?.jobTitle).toBe("HR lead");
    expect(d.canEditJob).toBe(false);
    expect(d.jobView?.departments).toEqual([]);
    expect(d.jobView?.managers).toEqual([]);
  });

  it("shows an employee who has no login only under Job & department", async () => {
    const d = await ok({ person: "e:e2" });
    expect(d.selected?.userId).toBeNull();
    expect(d.tabs).toEqual(["job"]);
  });

  it("searches by name, address and job title, and filters by company", async () => {
    expect((await ok({ q: "driver" })).people.map((p) => p.name)).toEqual(["Karim Noor"]);
    expect((await ok({ q: "omar@" })).people.map((p) => p.name)).toEqual(["Omar"]);
    expect((await ok({ company: CB })).people).toEqual([]);
  });
});

describe("HR Admin", () => {
  beforeEach(() => { session!.grants = [role("hr_admin", CA)]; });

  it("sees employees and their job details, but no addresses and no HR roles", async () => {
    const d = await ok({ person: `u:${AMINA}` });
    const amina = d.people.find((p) => p.userId === AMINA)!;
    expect(amina.email).toBeNull();
    expect(amina.roles).toEqual([]);
    expect(d.tabs).toEqual(["job"]);
    expect(calls).not.toContain("from:user_roles");
  });

  it("can edit the jobs of their own company and gets the choices for the form", async () => {
    tables.departments = [{ id: "d1", company_id: CA, name: "Operations", deleted_at: null }];
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.canEditJob).toBe(true);
    expect(d.jobView?.departments).toEqual([{ id: "d1", name: "Operations" }]);
    expect(d.jobView?.managers).toEqual([{ id: "e2", name: "Karim Noor" }]);
  });

  it("cannot edit the job of an employee of another company", async () => {
    tables.employees = [{ ...tables.employees![0]!, company_id: CB }];
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.canEditJob).toBe(false);
  });
});

describe("module access managers", () => {
  it("a Sales founder sees names and addresses from the Sales staff directory, only their companies' grants, and no accounts, roles or jobs", async () => {
    tables.crm_company_grants = [
      { user_id: ME, company_id: CA, capabilities: ["founder"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null },
      { user_id: AMINA, company_id: CA, capabilities: ["assign_owner"], revoked_at: null, granted_at: "2026-10-02", granted_by: ME, note: "sales" },
      { user_id: OMAR, company_id: CB, capabilities: ["assign_owner"], revoked_at: null, granted_at: "2026-10-02", granted_by: ME, note: null },
    ];
    rpcs.crm_staff_directory = [{ user_id: AMINA, full_name: "Amina", email: "amina@x.ae" }, { user_id: OMAR, full_name: "Omar", email: "omar@x.ae" }];
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.isSysAdmin).toBe(false);
    expect(d.tabs).toEqual(["modules"]);
    expect(d.managed).toEqual([{ module: "sales", companyId: CA, isFounder: true, viewerCapabilities: ["founder"] }]);
    expect(d.selected?.grants.map((g) => [g.module, g.companyId, g.capabilities, g.grantedByName])).toEqual([["sales", CA, ["assign_owner"], "Me"]]);
    expect(d.people.find((p) => p.userId === AMINA)?.email).toBe("amina@x.ae");
    expect(d.people.find((p) => p.userId === AMINA)?.roles).toEqual([]);
    expect(d.people.find((p) => p.userId === AMINA)?.jobTitle).toBeNull();
    expect(calls).not.toContain("from:user_roles");
    expect(calls).not.toContain("from:employees");
    // another company's grant of someone is not requested at all: the query is limited to the companies this person manages
    expect(d.people.find((p) => p.userId === OMAR)?.grants).toEqual([]);
  });

  it("a non-founder access manager gets names but never addresses (the directory returns none)", async () => {
    tables.crm_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["manage_access"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    rpcs.crm_staff_directory = [{ user_id: AMINA, full_name: "Amina", email: null }];
    const d = await ok();
    expect(d.people.find((p) => p.userId === AMINA)?.email).toBeNull();
    expect(d.managed[0]).toMatchObject({ module: "sales", isFounder: false });
  });

  it("a budget access manager sees active staff names only, and no addresses", async () => {
    tables.pbx_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["manage_access"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.tabs).toEqual(["modules"]);
    expect(d.people.map((p) => p.name).sort()).toEqual(["Amina", "Me", "Omar"]);
    expect(d.people.every((p) => p.email === null)).toBe(true);
    expect(d.moduleContexts.map((m) => [m.module, m.company.name, m.isFounder])).toEqual([["budget", "Enginious A", false]]);
    expect(calls.filter((c) => c.startsWith("rpc:"))).toEqual([]);
  });

  it("sees only the (module, company) pairs they manage", async () => {
    tables.crm_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["founder"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    tables.inv_company_grants = [{ user_id: ME, company_id: CB, capabilities: ["manage_access"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }, { user_id: ME, company_id: CA, capabilities: ["warehouse"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    const d = await ok();
    expect(d.moduleContexts.map((m) => `${m.module}:${m.company.name}`)).toEqual(["sales:Enginious A", "inventory:Enginious B"]);
    expect(d.companies.map((c) => c.name)).toEqual(["Enginious A", "Enginious B"]);
  });

  it("someone who is both HR Admin and an access manager gets both sets of tabs, for exactly what they are entitled to", async () => {
    session!.grants = [role("hr_admin", CA)];
    tables.pbx_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["manage_access"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    const d = await ok({ person: `u:${AMINA}` });
    expect(d.tabs).toEqual(["job", "modules"]);
  });
});

describe("company settings that used to sit on the Access screens", () => {
  it("shows the project reference code to Projects access managers, editable only by a founder", async () => {
    tables.proj_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["manage_access"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    tables.proj_company_settings = [{ company_id: CA, reference_code: "ENG" }];
    const d = await ok();
    expect(d.companySettings.projects).toEqual([{ company: { id: CA, name: "Enginious A" }, referenceCode: "ENG", isFounder: false }]);
    expect(d.companySettings.inventory).toEqual([]);
  });

  it("shows equipment sharing to Inventory access managers", async () => {
    tables.inv_company_grants = [{ user_id: ME, company_id: CA, capabilities: ["founder"], revoked_at: null, granted_at: "2026-10-01", granted_by: null, note: null }];
    const d = await ok();
    expect(d.companySettings.inventory[0]).toMatchObject({ company: { id: CA }, isFounder: true, allows: [], uses: [], others: [{ id: CB, name: "Enginious B" }] });
    expect(d.companySettings.projects).toEqual([]);
  });
});
