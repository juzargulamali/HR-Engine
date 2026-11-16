import "server-only";
import { cache } from "react";
import type { InvCapability, InvGrant } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import type { InvLocationRow } from "@/types/inventory";
import { companyDisplayNames, sortCompaniesForDisplay } from "@/lib/company-display";

export interface InvCompanyInfo {
  id: string;
  /** The short name shown in selectors and on the screens ("Enginious UAE"): see lib/company-display.ts. */
  name: string;
  /** The legal name (`companies.legal_name`), for company settings and anything that names the legal entity. */
  legalName: string;
  referenceCode: string | null;
  isEnabled: boolean;
}

export interface InventoryContext {
  userId: string;
  fullName: string | null;
  /** False when the Inventory migrations have not been applied to this database: every page then says so instead of failing. */
  installed: boolean;
  /** True when the access lookup itself failed (the data service did not answer): nothing is granted and the page says it could not load. */
  loadFailed?: boolean;
  grants: InvGrant[];
  /** Companies this person holds an Inventory grant for (and only those), with their reference code and on/off state. */
  companies: InvCompanyInfo[];
  /** Locations of those companies (names only: summary-safe). */
  locations: InvLocationRow[];
  /** Locations this person is assigned to as a warehouse operator. */
  assignedLocationIds: string[];
  /** The employee record linked to this sign-in, if any (for "equipment assigned to me"). */
  employeeId: string | null;
  /** Project Manager / department head of a running project: may prepare equipment requirements without a stock grant. */
  managesProjects: boolean;
  /**
   * The short name of a company. For the person's own companies it is the selector name; for any other company (the owner of equipment received from
   * another company, the other side of a transfer) it is the same short name worked out from the company directory every signed-in person may read
   * (`companies_select`), so a transfer never shows a legal name on one side and a short name on the other. "Unknown" only when the company is not listed.
   */
  companyName: (id: string) => string;
  locationName: (id: string | null | undefined) => string;
  /**
   * A warehouse as it is said wherever stock is about to change or a movement is read: "Dubai · Enginious UAE". The company is always named when the person
   * works with more than one company (the same city can be a warehouse of two companies); with one company the plain name is enough.
   */
  placeName: (id: string | null | undefined) => string;
}

/**
 * The one place that turns a signed-in session into the Inventory view of it. Inventory access is its own table
 * (inv_company_grants), never user_roles, crm_company_grants or proj_company_grants. RLS and the database functions are the real
 * gate; this only shapes what the UI offers. Returns null when signed out.
 */
export const getInventoryContext = cache(async (): Promise<InventoryContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  const supabase = await createClient();
  const base = (installed: boolean, extra: Partial<InventoryContext> = {}): InventoryContext => ({
    userId: session.userId, fullName: session.fullName, installed, grants: [], companies: [], locations: [], assignedLocationIds: [],
    employeeId: null, managesProjects: false, companyName: () => "Unknown", locationName: () => "Unknown", placeName: () => "Unknown", ...extra,
  });

  const [{ data: grantRows, error: grantError }, emp, mgr] = await Promise.all([
    supabase.from("inv_company_grants").select("company_id, capabilities").eq("user_id", session.userId).is("revoked_at", null),
    supabase.from("employees").select("id").eq("user_id", session.userId).is("deleted_at", null).limit(1),
    supabase.from("proj_projects").select("id", { count: "exact", head: true }).eq("pm_user_id", session.userId).not("status", "in", "(completed,archived)"),
  ]);
  if (isNotInstalled(grantError)) return base(false);
  if (grantError) return base(true, { loadFailed: true });
  // Any other failed read is a load failure too: "no warehouse set up", "switched off" or "not a project manager" would all be false.
  // (A database without Projects tables just means the person manages no projects.)
  if (emp.error || (mgr.error && !isNotInstalled(mgr.error))) return base(true, { loadFailed: true });
  const employeeId = emp.data?.[0]?.id ?? null;
  const managesProjects = !mgr.error && (mgr.count ?? 0) > 0;
  const grants: InvGrant[] = (grantRows ?? []).map((g) => ({ companyId: g.company_id, capabilities: g.capabilities as InvCapability[] }));
  if (grants.length === 0) return base(true, { employeeId, managesProjects });

  const companyIds = grants.map((g) => g.companyId);
  const [{ data: allCompanyRows, error: companyError }, { data: settingsRows, error: settingsError }, { data: locationRows, error: locationError }, { data: assigned, error: assignedError }] = await Promise.all([
    // Every company of the directory (names and country only): the person's own are picked out below; the others are only ever named, as the owner of
    // received equipment or the other side of a transfer.
    supabase.from("companies").select("id, legal_name, country_code").order("legal_name").limit(200),
    supabase.from("inv_company_settings").select("company_id, reference_code, is_enabled").in("company_id", companyIds),
    supabase.from("inv_locations").select("*").in("company_id", companyIds).order("name"),
    supabase.from("inv_operator_locations").select("location_id").eq("user_id", session.userId).is("removed_at", null),
  ]);
  if (companyError || settingsError || locationError || assignedError) return base(true, { loadFailed: true });
  const settings = new Map((settingsRows ?? []).map((s) => [s.company_id, s]));
  const companyRows = (allCompanyRows ?? []).filter((c) => companyIds.includes(c.id));
  const named = sortCompaniesForDisplay(companyRows.map((c) => ({ id: c.id, legalName: c.legal_name, countryCode: c.country_code })));
  const display = companyDisplayNames(named);
  const companies: InvCompanyInfo[] = named.map((c) => ({
    id: c.id, name: display.get(c.id) ?? c.legalName, legalName: c.legalName, referenceCode: settings.get(c.id)?.reference_code ?? null, isEnabled: settings.get(c.id)?.is_enabled ?? false,
  }));
  const names = new Map(companies.map((c) => [c.id, c.name]));
  // Companies the person holds no grant for: the short name when it is theirs alone in the whole directory and no company of the person already carries it.
  const taken = new Set(names.values());
  for (const [id, name] of companyDisplayNames((allCompanyRows ?? []).map((c) => ({ id: c.id, legalName: c.legal_name, countryCode: c.country_code })))) {
    if (!names.has(id)) names.set(id, taken.has(name) ? ((allCompanyRows ?? []).find((c) => c.id === id)?.legal_name ?? name) : name);
  }
  const locations = (locationRows ?? []) as InvLocationRow[];
  const locNames = new Map(locations.map((l) => [l.id, l.name]));
  const locCompany = new Map(locations.map((l) => [l.id, l.company_id]));
  return base(true, {
    grants, companies, locations, employeeId, managesProjects,
    assignedLocationIds: (assigned ?? []).map((a) => a.location_id),
    companyName: (id) => names.get(id) ?? "Unknown",
    locationName: (id) => (id ? (locNames.get(id) ?? "Unknown") : "—"),
    placeName: (id) => {
      if (!id) return "—";
      const name = locNames.get(id);
      if (!name) return "A warehouse of another company";
      return companies.length > 1 ? `${name} · ${names.get(locCompany.get(id) ?? "") ?? "Unknown"}` : name;
    },
  });
});

/**
 * What the app shell needs to decide whether to show the Inventory module: grants, whether the person runs a project, and whether
 * they are an employee with a linked record. One light read; degrades to "nothing" on any failure (including the tables not existing
 * yet), so the HR, Sales and Projects shell can never be broken by it.
 */
export async function loadInventoryNavAccess(userId: string): Promise<{ grants: InvGrant[]; managesProjects: boolean; isEmployee: boolean; loadFailed?: boolean }> {
  try {
    const supabase = await createClient();
    const [g, e, m] = await Promise.all([
      supabase.from("inv_company_grants").select("company_id, capabilities").eq("user_id", userId).is("revoked_at", null),
      supabase.from("employees").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null),
      supabase.from("proj_projects").select("id", { count: "exact", head: true }).eq("pm_user_id", userId).not("status", "in", "(completed,archived)"),
    ]);
    const grants = g.error ? [] : (g.data ?? []).map((x) => ({ companyId: x.company_id, capabilities: x.capabilities as InvCapability[] }));
    // A plain employee sees "My equipment" only when Inventory is installed (the grants table answered); otherwise the roadmap row stays.
    return { grants, managesProjects: !m.error && (m.count ?? 0) > 0 && !g.error, isEmployee: !g.error && !e.error && (e.count ?? 0) > 0, ...((g.error && !isNotInstalled(g.error)) || e.error ? { loadFailed: true } : {}) };
  } catch {
    return { grants: [], managesProjects: false, isEmployee: false, loadFailed: true };
  }
}
