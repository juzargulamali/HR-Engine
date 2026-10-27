import "server-only";
import { cache } from "react";
import {
  canEditJobDetails, canManageAccountsAndRoles, canUsePeopleAccess, hasRoleAnyScope, managedAccess, normaliseCapabilities,
  type AccessModule, type AppRole, type ModuleGrantRef, type RoleGrant,
} from "@enginious-hr/domain";
import type { AccountStatus } from "@/types/database.types";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * People & Access: what the signed-in person may see and manage on the one screen. Nothing here widens access: every query goes through
 * the same row-level security the old screens used (a person's own module grants, the module staff directories, the HR employee list,
 * the Users list for the System Administrator). What a viewer is not entitled to simply never loads, so it cannot be shown by mistake.
 */

export type PaModuleTable = "crm_company_grants" | "proj_company_grants" | "inv_company_grants" | "pbx_company_grants";
export const GRANT_TABLE: Record<AccessModule, PaModuleTable> = {
  sales: "crm_company_grants", projects: "proj_company_grants", inventory: "inv_company_grants", budget: "pbx_company_grants",
};

export interface PaCompany { id: string; name: string }
export interface PaManaged { module: AccessModule; companyId: string; isFounder: boolean; viewerCapabilities: string[] }
export interface PaRole { id: string; role: AppRole; companyId: string | null }
export interface PaGrant { module: AccessModule; companyId: string; userId: string; capabilities: string[]; grantedAt: string; grantedByName: string | null; note: string | null }

export interface PaPerson {
  /** `u:<userId>` for someone with a login, `e:<employeeId>` for an employee record that has none yet. */
  key: string;
  userId: string | null;
  employeeId: string | null;
  name: string;
  /** Only where this viewer is entitled to see the address (the System Administrator, or a founder, as the old screens did). */
  email: string | null;
  jobTitle: string | null;
  employeeCompanyId: string | null;
  accountStatus: AccountStatus | null;
  roles: PaRole[];
  grants: PaGrant[];
}

export interface PaEmployee {
  id: string;
  userId: string | null;
  companyId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  departmentId: string | null;
  managerId: string | null;
  status: string;
}

export interface PaJobView {
  companyName: string;
  departmentName: string | null;
  managerName: string | null;
  /** Only filled for someone who may edit (HR Admin of the company): the choices for the form. */
  departments: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}

export interface PaModuleContext {
  module: AccessModule;
  company: PaCompany;
  viewerCapabilities: string[];
  isFounder: boolean;
  /** Everyone holding access to this module in this company (the viewer is allowed to see this list: they manage it). */
  holders: { userId: string; capabilities: string[] }[];
  locations: { id: string; name: string; isActive: boolean }[];
}

export interface PaCompanySettings {
  projects: { company: PaCompany; referenceCode: string | null; isFounder: boolean }[];
  inventory: {
    company: PaCompany;
    isFounder: boolean;
    allows: { id: string; otherCompanyId: string; otherCompanyName: string; note: string | null; since: string }[];
    uses: { id: string; otherCompanyId: string; otherCompanyName: string; note: string | null; since: string }[];
    others: { id: string; name: string }[];
  }[];
}

export type PaTab = "account" | "job" | "roles" | "modules";

export interface PeopleAccessData {
  userId: string;
  isSysAdmin: boolean;
  isHrAdmin: boolean;
  companies: PaCompany[];
  managed: PaManaged[];
  people: PaPerson[];
  totalPeople: number;
  selected: PaPerson | null;
  tabs: PaTab[];
  employee: PaEmployee | null;
  canEditJob: boolean;
  jobView: PaJobView | null;
  moduleContexts: PaModuleContext[];
  operatorLocations: Record<string, string[]>;
  companySettings: PaCompanySettings;
}

export type PeopleAccessResult = { kind: "signed-out" } | { kind: "denied" } | { kind: "ok"; data: PeopleAccessData };

export interface PeopleAccessQuery { q?: string; company?: string; person?: string }

const LIMIT = 400;

const nameFromProfile = (p: { full_name: string | null; email: string | null }) => p.full_name?.trim() || p.email?.split("@")[0] || "Unnamed user";

async function ownModuleGrants(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<ModuleGrantRef[]> {
  const out: ModuleGrantRef[] = [];
  const results = await Promise.all((Object.keys(GRANT_TABLE) as AccessModule[]).map(async (module) => {
    // A module that is not installed in this database (or any failure) simply means no access to manage there.
    const { data, error } = await supabase.from(GRANT_TABLE[module]).select("company_id, capabilities").eq("user_id", userId).is("revoked_at", null);
    return { module, rows: error ? [] : (data ?? []) as { company_id: string; capabilities: string[] }[] };
  }));
  for (const r of results) for (const g of r.rows) out.push({ module: r.module, companyId: g.company_id, capabilities: g.capabilities });
  return out;
}

export const loadPeopleAccess = cache(async (query: PeopleAccessQuery): Promise<PeopleAccessResult> => {
  const session = await getCurrentSession();
  if (!session) return { kind: "signed-out" };
  const supabase = await createClient();
  const roles = session.grants;

  const own = await ownModuleGrants(supabase, session.userId);
  if (!canUsePeopleAccess(roles, own)) return { kind: "denied" };

  const sysAdmin = canManageAccountsAndRoles(roles);
  const hrAdmin = hasRoleAnyScope(roles, "hr_admin");
  const managed: PaManaged[] = managedAccess(own).map((m) => ({
    ...m,
    viewerCapabilities: own.find((g) => g.module === m.module && g.companyId === m.companyId)?.capabilities.slice() ?? [],
  }));

  // Companies the viewer deals with: every active company for the System Administrator and a company-less HR Admin, else the ones they manage or run HR for.
  const { data: companyRows } = await supabase.from("companies").select("id, legal_name").eq("is_active", true).is("deleted_at", null).order("legal_name");
  const allCompanies: PaCompany[] = (companyRows ?? []).map((c) => ({ id: c.id, name: c.legal_name }));
  const hrCompanyIds = new Set(roles.filter((g) => g.role === "hr_admin" && g.companyId).map((g) => g.companyId as string));
  const hrAll = roles.some((g) => g.role === "hr_admin" && !g.companyId);
  const relevant = new Set([...managed.map((m) => m.companyId), ...(hrAll ? allCompanies.map((c) => c.id) : [...hrCompanyIds])]);
  const companies = sysAdmin ? allCompanies : allCompanies.filter((c) => relevant.has(c.id));
  const companyName = new Map(allCompanies.map((c) => [c.id, c.name]));

  // The module grants of the companies the viewer manages (row-level security lets an access manager read exactly these).
  const grantRows: PaGrant[] = [];
  const holdersByModuleCompany = new Map<string, { userId: string; capabilities: string[] }[]>();
  const grantedByIds = new Set<string>();
  const rawGrants: { module: AccessModule; companyId: string; userId: string; capabilities: string[]; grantedAt: string; grantedBy: string | null; note: string | null }[] = [];
  await Promise.all((Object.keys(GRANT_TABLE) as AccessModule[]).map(async (module) => {
    const companyIds = managed.filter((m) => m.module === module).map((m) => m.companyId);
    if (companyIds.length === 0) return;
    const { data } = await supabase.from(GRANT_TABLE[module]).select("user_id, company_id, capabilities, granted_at, granted_by, note").in("company_id", companyIds).is("revoked_at", null).order("granted_at");
    for (const g of (data ?? []) as { user_id: string; company_id: string; capabilities: string[]; granted_at: string; granted_by: string | null; note: string | null }[]) {
      rawGrants.push({ module, companyId: g.company_id, userId: g.user_id, capabilities: normaliseCapabilities(module, g.capabilities), grantedAt: g.granted_at, grantedBy: g.granted_by, note: g.note });
      if (g.granted_by) grantedByIds.add(g.granted_by);
      const k = `${module}:${g.company_id}`;
      holdersByModuleCompany.set(k, [...(holdersByModuleCompany.get(k) ?? []), { userId: g.user_id, capabilities: normaliseCapabilities(module, g.capabilities) }]);
    }
  }));

  // Who the viewer may see. System Administrator: every account (the Users list). HR Admin: the employees of their companies. Module managers: the module's
  // staff directory (names; addresses only to founders, exactly as the module screens did) and the people already holding access.
  type Src = { userId: string | null; employeeId: string | null; name?: string; email?: string | null; accountStatus?: AccountStatus | null };
  const sources: Src[] = [];
  const roleRows: { id: string; user_id: string; role: AppRole; company_id: string | null }[] = [];
  const showEmail = new Set<string>();

  if (sysAdmin) {
    const [{ data: profiles }, { data: rr }] = await Promise.all([
      supabase.from("profiles").select("id, email, full_name, account_status").order("email"),
      supabase.from("user_roles").select("id, user_id, role, company_id").is("revoked_at", null).order("granted_at"),
    ]);
    for (const p of profiles ?? []) { sources.push({ userId: p.id, employeeId: null, name: nameFromProfile(p), email: p.email, accountStatus: p.account_status as AccountStatus }); showEmail.add(p.id); }
    for (const r of rr ?? []) roleRows.push({ id: r.id, user_id: r.user_id, role: r.role as AppRole, company_id: r.company_id });
  }

  const employees: PaEmployee[] = [];
  if (sysAdmin || hrAdmin) {
    const { data } = await supabase.from("employees").select("id, user_id, company_id, first_name, last_name, job_title, department_id, manager_id, employment_status").is("deleted_at", null).order("last_name");
    for (const e of data ?? []) {
      employees.push({ id: e.id, userId: e.user_id, companyId: e.company_id, firstName: e.first_name, lastName: e.last_name, jobTitle: e.job_title, departmentId: e.department_id, managerId: e.manager_id, status: e.employment_status });
      sources.push({ userId: e.user_id, employeeId: e.id, name: `${e.first_name} ${e.last_name}`.trim() });
    }
    if (!sysAdmin) {
      // An HR Admin sees account names for the logins linked to the employees they look after, never the addresses.
      const ids = employees.map((e) => e.userId).filter((x): x is string => !!x);
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, full_name, email, account_status").in("id", ids);
        for (const p of profiles ?? []) sources.push({ userId: p.id, employeeId: null, name: nameFromProfile(p), accountStatus: p.account_status as AccountStatus });
      }
    }
  }

  const dirCalls: { module: AccessModule; run: () => PromiseLike<{ data: { user_id: string; full_name: string | null; email: string | null }[] | null }> }[] = [];
  if (managed.some((m) => m.module === "sales")) dirCalls.push({ module: "sales", run: () => supabase.rpc("crm_staff_directory") });
  if (managed.some((m) => m.module === "projects")) dirCalls.push({ module: "projects", run: () => supabase.rpc("proj_staff_directory") });
  if (managed.some((m) => m.module === "inventory")) dirCalls.push({ module: "inventory", run: () => supabase.rpc("inv_staff_directory") });
  const dirs = await Promise.all(dirCalls.map((c) => c.run()));
  for (const d of dirs) for (const p of d.data ?? []) { sources.push({ userId: p.user_id, employeeId: null, name: p.full_name?.trim() || "Unnamed user", email: p.email }); if (p.email) showEmail.add(p.user_id); }
  if (managed.some((m) => m.module === "budget") && !sysAdmin) {
    // Budget has no staff directory of its own: active staff names, from the directory that every signed-in person can already read. No addresses.
    const { data } = await supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name");
    for (const p of data ?? []) sources.push({ userId: p.id, employeeId: null, name: nameFromProfile(p) });
  }

  // Names for the people who granted access (shown as "given by").
  const nameOf = new Map<string, string>();
  for (const s of sources) if (s.userId && s.name) nameOf.set(s.userId, s.name);
  const missingNames = [...grantedByIds].filter((id) => !nameOf.has(id));
  if (missingNames.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", missingNames);
    for (const p of data ?? []) nameOf.set(p.id, nameFromProfile(p));
  }
  for (const g of rawGrants) grantRows.push({ module: g.module, companyId: g.companyId, userId: g.userId, capabilities: g.capabilities, grantedAt: g.grantedAt, grantedByName: g.grantedBy ? (g.grantedBy === session.userId ? (session.fullName ?? "you") : (nameOf.get(g.grantedBy) ?? "a colleague")) : null, note: g.note });

  // Merge into one row per person.
  const byKey = new Map<string, PaPerson>();
  const empByUser = new Map(employees.filter((e) => e.userId).map((e) => [e.userId as string, e]));
  const touch = (userId: string | null, employeeId: string | null): PaPerson => {
    const key = userId ? `u:${userId}` : `e:${employeeId}`;
    let p = byKey.get(key);
    if (!p) { p = { key, userId, employeeId, name: "", email: null, jobTitle: null, employeeCompanyId: null, accountStatus: null, roles: [], grants: [] }; byKey.set(key, p); }
    return p;
  };
  for (const s of sources) {
    const p = touch(s.userId, s.userId ? null : s.employeeId);
    if (s.name && !p.name) p.name = s.name;
    if (s.email && showEmail.has(p.userId ?? "")) p.email = s.email;
    if (s.accountStatus) p.accountStatus = s.accountStatus;
    if (s.employeeId) p.employeeId = s.employeeId;
  }
  for (const g of grantRows) {
    const p = touch(g.userId, null);
    if (!p.name) p.name = g.userId === session.userId ? (session.fullName ?? "You") : "Inactive or former colleague";
    p.grants.push(g);
  }
  for (const r of roleRows) { const p = byKey.get(`u:${r.user_id}`); if (p) p.roles.push({ id: r.id, role: r.role, companyId: r.company_id }); }
  for (const p of byKey.values()) {
    const e = p.userId ? empByUser.get(p.userId) : employees.find((x) => x.id === p.employeeId);
    if (e) { p.employeeId = e.id; p.jobTitle = e.jobTitle; p.employeeCompanyId = e.companyId; if (!p.name) p.name = `${e.firstName} ${e.lastName}`.trim(); }
    if (!p.name) p.name = "Unnamed user";
  }

  let people = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalPeople = people.length;
  const q = (query.q ?? "").trim().toLowerCase();
  if (q) people = people.filter((p) => p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q) || (p.jobTitle ?? "").toLowerCase().includes(q));
  if (query.company) people = people.filter((p) => p.employeeCompanyId === query.company || p.grants.some((g) => g.companyId === query.company));
  people = people.slice(0, LIMIT);

  const selected = query.person ? ([...byKey.values()].find((p) => p.key === query.person) ?? null) : null;

  // The selected person's tabs: each only for what the viewer is entitled to.
  const employee = selected ? ((selected.userId ? empByUser.get(selected.userId) : employees.find((e) => e.id === selected.employeeId)) ?? null) : null;
  const tabs: PaTab[] = [];
  if (selected) {
    if (sysAdmin && selected.userId) tabs.push("account");
    if (employee) tabs.push("job");
    if (sysAdmin && selected.userId) tabs.push("roles");
    if (managed.length > 0 && selected.userId) tabs.push("modules");
  }
  const canEditJob = !!employee && canEditJobDetails(roles as RoleGrant[], employee.companyId);

  let jobView: PaJobView | null = null;
  if (employee) {
    const { data: deps } = await supabase.from("departments").select("id, name").eq("company_id", employee.companyId).is("deleted_at", null).order("name");
    const departments = (deps ?? []).map((d) => ({ id: d.id, name: d.name }));
    const mgr = employee.managerId ? employees.find((e) => e.id === employee.managerId) : null;
    jobView = {
      companyName: companyName.get(employee.companyId) ?? "Company",
      departmentName: departments.find((d) => d.id === employee.departmentId)?.name ?? null,
      managerName: mgr ? `${mgr.firstName} ${mgr.lastName}`.trim() : null,
      departments: canEditJob ? departments : [],
      managers: canEditJob ? employees.filter((e) => e.companyId === employee.companyId && e.id !== employee.id).map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() })) : [],
    };
  }

  // Inventory locations (a warehouse operator works at assigned locations) and the people already assigned to them.
  const invCompanyIds = managed.filter((m) => m.module === "inventory").map((m) => m.companyId);
  let invLocations: { id: string; company_id: string; name: string; is_active: boolean }[] = [];
  const operatorLocations: Record<string, string[]> = {};
  if (invCompanyIds.length > 0) {
    const [{ data: locs }, { data: ops }] = await Promise.all([
      supabase.from("inv_locations").select("id, company_id, name, is_active").in("company_id", invCompanyIds).order("name"),
      selected?.userId ? supabase.from("inv_operator_locations").select("location_id, company_id").eq("user_id", selected.userId).in("company_id", invCompanyIds).is("removed_at", null) : Promise.resolve({ data: [] as { location_id: string; company_id: string }[] }),
    ]);
    invLocations = (locs ?? []) as typeof invLocations;
    for (const o of (ops ?? []) as { location_id: string; company_id: string }[]) operatorLocations[o.company_id] = [...(operatorLocations[o.company_id] ?? []), o.location_id];
  }

  const moduleContexts: PaModuleContext[] = managed
    .map((m) => ({
      module: m.module,
      company: { id: m.companyId, name: companyName.get(m.companyId) ?? "Company" },
      viewerCapabilities: m.viewerCapabilities,
      isFounder: m.isFounder,
      holders: holdersByModuleCompany.get(`${m.module}:${m.companyId}`) ?? [],
      locations: m.module === "inventory" ? invLocations.filter((l) => l.company_id === m.companyId).map((l) => ({ id: l.id, name: l.name, isActive: l.is_active })) : [],
    }))
    .sort((a, b) => a.company.name.localeCompare(b.company.name) || a.module.localeCompare(b.module));

  // Company-level settings that used to sit on the Projects and Inventory Access screens (reference code, equipment sharing between companies).
  const companySettings: PaCompanySettings = { projects: [], inventory: [] };
  const projManaged = managed.filter((m) => m.module === "projects");
  if (projManaged.length > 0) {
    const { data } = await supabase.from("proj_company_settings").select("company_id, reference_code").in("company_id", projManaged.map((m) => m.companyId));
    const codeBy = new Map((data ?? []).map((s) => [s.company_id, s.reference_code]));
    companySettings.projects = projManaged.map((m) => ({ company: { id: m.companyId, name: companyName.get(m.companyId) ?? "Company" }, referenceCode: codeBy.get(m.companyId) ?? null, isFounder: m.isFounder }));
  }
  const invManaged = managed.filter((m) => m.module === "inventory");
  if (invManaged.length > 0) {
    const { data: sharing } = await supabase.from("inv_company_sharing").select("*").or(invManaged.map((m) => `company_id.eq.${m.companyId},use_company_id.eq.${m.companyId}`).join(",")).is("revoked_at", null).order("authorised_at");
    const rows = (sharing ?? []) as { id: string; company_id: string; use_company_id: string; note: string | null; authorised_at: string }[];
    companySettings.inventory = invManaged.map((m) => ({
      company: { id: m.companyId, name: companyName.get(m.companyId) ?? "Company" },
      isFounder: m.isFounder,
      allows: rows.filter((r) => r.company_id === m.companyId).map((r) => ({ id: r.id, otherCompanyId: r.use_company_id, otherCompanyName: companyName.get(r.use_company_id) ?? "Another company", note: r.note, since: r.authorised_at })),
      uses: rows.filter((r) => r.use_company_id === m.companyId).map((r) => ({ id: r.id, otherCompanyId: r.company_id, otherCompanyName: companyName.get(r.company_id) ?? "Another company", note: r.note, since: r.authorised_at })),
      others: allCompanies.filter((c) => c.id !== m.companyId),
    }));
  }

  return {
    kind: "ok",
    data: {
      userId: session.userId, isSysAdmin: sysAdmin, isHrAdmin: hrAdmin, companies, managed, people, totalPeople, selected, tabs, employee, canEditJob, jobView,
      moduleContexts, operatorLocations, companySettings,
    },
  };
});
