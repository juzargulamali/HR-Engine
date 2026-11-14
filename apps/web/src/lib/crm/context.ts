import "server-only";
import { cache } from "react";
import type { CrmCapability, CrmGrant } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CrmCompanySettingsRow } from "@/types/crm";

export interface CrmCompanyInfo {
  id: string;
  name: string;
  countryCode: string;
  settings: CrmCompanySettingsRow | null;
}

export interface CrmPerson {
  id: string;
  name: string;
  companyIds: string[];
}

export interface CrmContext {
  userId: string;
  fullName: string | null;
  grants: CrmGrant[];
  /** Companies this user holds a CRM grant for (and only those). */
  companies: CrmCompanyInfo[];
  /** CRM staff in those companies (owner / assignee pickers). */
  people: CrmPerson[];
  personName: (id: string | null | undefined) => string;
  companyName: (id: string) => string;
  /**
   * The company the person is employed by, when it is one of `companies` (a reliable default for forms; see lib/crm/active-company.ts). Null when they
   * have no employee record, are employed by a company they hold no Sales access to, or the lookup failed (then nothing is assumed).
   */
  homeCompanyId?: string | null;
  /** True when the grants could not be read (the data service did not answer): nothing is granted, and the page says it could not load rather than "no access". */
  loadFailed?: boolean;
}

export const displayNameFor = (p: { full_name: string | null; email: string | null }) =>
  p.full_name?.trim() || p.email?.split("@")[0] || "Unknown";

/**
 * The one place that turns a signed-in session into the CRM view of it: which companies the user has Sales access to,
 * with which capabilities. CRM access is its own table (crm_company_grants), never user_roles — an HR admin or CEO
 * with no CRM grant gets an empty `grants` list and sees no Sales data at all. RLS is the real gate; this only shapes UI.
 * Returns null when signed out.
 */
export const getCrmContext = cache(async (): Promise<CrmContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  const supabase = await createClient();

  const { data: grantRows, error: grantError } = await supabase
    .from("crm_company_grants")
    .select("company_id, capabilities")
    .eq("user_id", session.userId)
    .is("revoked_at", null);
  if (grantError) return { userId: session.userId, fullName: session.fullName, grants: [], companies: [], people: [], personName: () => "Unknown", companyName: () => "Unknown", loadFailed: true };
  const grants: CrmGrant[] = (grantRows ?? []).map((g) => ({ companyId: g.company_id, capabilities: g.capabilities as CrmCapability[] }));

  if (grants.length === 0) {
    return { userId: session.userId, fullName: session.fullName, grants, companies: [], people: [], personName: () => "Unknown", companyName: () => "Unknown" };
  }

  const companyIds = grants.map((g) => g.companyId);
  const [{ data: companyRows, error: companyError }, { data: settingsRows, error: settingsError }, { data: peopleRows, error: peopleError }, { data: employeeRow }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, country_code").in("id", companyIds).order("legal_name"),
    supabase.from("crm_company_settings").select("*").in("company_id", companyIds),
    supabase.rpc("crm_people"),
    // The person's own employing company: only a default for the active company. A failed or empty read means "no default", never an error for the page.
    supabase.from("employees").select("company_id").eq("user_id", session.userId).is("deleted_at", null).maybeSingle(),
  ]);
  // A failed read here would show "no Sales settings", an empty company list or "Former colleague": say it could not load instead.
  if (companyError || settingsError || peopleError) return { userId: session.userId, fullName: session.fullName, grants: [], companies: [], people: [], personName: () => "Unknown", companyName: () => "Unknown", loadFailed: true };
  const settingsBy = new Map((settingsRows ?? []).map((s) => [s.company_id, s]));
  const companies: CrmCompanyInfo[] = (companyRows ?? []).map((c) => ({
    id: c.id,
    name: c.legal_name,
    countryCode: c.country_code,
    settings: settingsBy.get(c.id) ?? null,
  }));
  const people: CrmPerson[] = (peopleRows ?? []).map((p) => ({
    id: p.user_id,
    name: p.full_name?.trim() || p.email?.split("@")[0] || "Unnamed user",
    companyIds: p.company_ids,
  }));
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const companyById = new Map(companies.map((c) => [c.id, c.name]));

  return {
    userId: session.userId,
    fullName: session.fullName,
    grants,
    companies,
    people,
    personName: (id) => (id ? (nameById.get(id) ?? (id === session.userId ? (session.fullName ?? "You") : "Former colleague")) : "Nobody"),
    companyName: (id) => companyById.get(id) ?? "Unknown company",
    homeCompanyId: employeeRow?.company_id && companyById.has(employeeRow.company_id) ? employeeRow.company_id : null,
  };
});
