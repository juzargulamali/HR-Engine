import "server-only";
import { cache } from "react";
import { hasProjCapability, type ProjCapability, type ProjGrant } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "./errors";

/** Shown only when a company's name could not be read at all (never for a company the person is authorised for). */
export const COMPANY_NOT_SHOWN = "Company not shown";

export interface ProjCompanyInfo {
  id: string;
  name: string;
  countryCode: string;
  referenceCode: string | null;
}

export interface ProjPerson {
  id: string;
  name: string;
  companyIds: string[];
}

export interface ProjectsContext {
  userId: string;
  fullName: string | null;
  /** False when the Projects migrations have not been applied to this database: every page then says so instead of failing. */
  installed: boolean;
  grants: ProjGrant[];
  /** Projects this person is linked to as a Sales relationship (their own, active). */
  salesLinkedProjectIds: string[];
  /** Companies this person holds a Projects grant for (and only those). */
  companies: ProjCompanyInfo[];
  /** Everyone with Projects access in those companies (names only). */
  people: ProjPerson[];
  hasAnyAccess: boolean;
  personName: (id: string | null | undefined) => string;
  companyName: (id: string) => string;
}

/**
 * The one place that turns a signed-in session into the Projects view of it. Projects access is its own table
 * (proj_company_grants), never user_roles and never crm_company_grants: an HR admin, a CEO or a Sales user with no Projects
 * grant gets an empty `grants` list. A Sales user may still see their own linked projects (summary only); the database decides
 * that, this only shapes the UI. RLS is the real gate.
 */
export const getProjectsContext = cache(async (): Promise<ProjectsContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  const supabase = await createClient();
  const empty = (installed: boolean): ProjectsContext => ({
    userId: session.userId, fullName: session.fullName, installed, grants: [], salesLinkedProjectIds: [], companies: [], people: [], hasAnyAccess: false,
    personName: (id) => (id === session.userId ? (session.fullName ?? "You") : "Unknown"), companyName: () => COMPANY_NOT_SHOWN,
  });

  const [{ data: grantRows, error: grantError }, { data: linkRows, error: linkError }] = await Promise.all([
    supabase.from("proj_company_grants").select("company_id, capabilities").eq("user_id", session.userId).is("revoked_at", null),
    supabase.from("proj_sales_links").select("project_id").eq("user_id", session.userId).is("removed_at", null),
  ]);
  if (isNotInstalled(grantError) || isNotInstalled(linkError)) return empty(false);
  const grants: ProjGrant[] = (grantRows ?? []).map((g) => ({ companyId: g.company_id, capabilities: g.capabilities as ProjCapability[] }));
  const salesLinkedProjectIds = (linkRows ?? []).map((l) => l.project_id);
  if (grants.length === 0) {
    // A Sales colleague with a linked project has no Projects grant but is authorised to see that company's name on it.
    const labels = salesLinkedProjectIds.length > 0 ? await loadCompanyLabels(supabase) : new Map<string, string>();
    return { ...empty(true), salesLinkedProjectIds, hasAnyAccess: salesLinkedProjectIds.length > 0, companyName: (id) => labels.get(id) ?? COMPANY_NOT_SHOWN };
  }

  const companyIds = grants.map((g) => g.companyId);
  const [{ data: companyRows }, { data: settingsRows }, { data: peopleRows }, labels] = await Promise.all([
    supabase.from("companies").select("id, legal_name, country_code").in("id", companyIds).order("legal_name"),
    supabase.from("proj_company_settings").select("company_id, reference_code").in("company_id", companyIds),
    supabase.rpc("proj_people"),
    loadCompanyLabels(supabase),
  ]);
  const codeBy = new Map((settingsRows ?? []).map((s) => [s.company_id, s.reference_code]));
  const companies: ProjCompanyInfo[] = (companyRows ?? []).map((c) => ({ id: c.id, name: c.legal_name, countryCode: c.country_code, referenceCode: codeBy.get(c.id) ?? null }));
  const people: ProjPerson[] = (peopleRows ?? []).map((p) => ({
    id: p.user_id, name: p.full_name?.trim() || p.email?.split("@")[0] || "Unnamed user", companyIds: p.company_ids,
  }));
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const companyById = new Map([...labels, ...companies.map((c): [string, string] => [c.id, c.name])]);
  return {
    userId: session.userId,
    fullName: session.fullName,
    installed: true,
    grants,
    salesLinkedProjectIds,
    companies,
    people,
    hasAnyAccess: true,
    personName: (id) => (id ? (nameById.get(id) ?? (id === session.userId ? (session.fullName ?? "You") : "Former colleague")) : "Nobody"),
    companyName: (id) => companyById.get(id) ?? COMPANY_NOT_SHOWN,
  };
});

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Company names for exactly the companies this person is authorised to see in Projects: where they hold a grant, or where a
 * project they may open lives (a Sales colleague linked to a project). Decided by the database, not by this app.
 */
async function loadCompanyLabels(supabase: ServerClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("proj_company_labels");
  if (error || !data) return new Map();
  return new Map(data.map((r): [string, string] => [r.company_id, r.name]));
}

/**
 * What the app shell needs to decide whether to show the Projects module: Projects grants, a Sales link, and whether a
 * handover is waiting on this person. One light read; degrades to "no access" on any failure (including the tables not existing
 * yet), so the HR and Sales shell can never be broken by it.
 */
export async function loadProjectsNavAccess(userId: string): Promise<{ grants: ProjGrant[]; salesLinked: boolean; pendingHandovers: boolean }> {
  try {
    const supabase = await createClient();
    const [g, l, h] = await Promise.all([
      supabase.from("proj_company_grants").select("company_id, capabilities").eq("user_id", userId).is("revoked_at", null),
      supabase.from("proj_sales_links").select("project_id", { count: "exact", head: true }).eq("user_id", userId).is("removed_at", null),
      supabase.from("proj_handovers").select("company_id, status, pm_user_id").in("status", ["submitted", "pm_assigned"]).limit(100),
    ]);
    if (g.error) return { grants: [], salesLinked: false, pendingHandovers: false };
    const grants = (g.data ?? []).map((x) => ({ companyId: x.company_id, capabilities: x.capabilities as ProjCapability[] }));
    // "Waiting on me": a submitted handover needs a PM from someone who can assign one; an assigned one needs its PM to accept.
    const pending = (h.data ?? []).some((x) => (x.status === "submitted" && hasProjCapability(grants, x.company_id, "assign_pm")) || (x.status === "pm_assigned" && x.pm_user_id === userId));
    return { grants, salesLinked: (l.count ?? 0) > 0, pendingHandovers: !h.error && pending };
  } catch {
    return { grants: [], salesLinked: false, pendingHandovers: false };
  }
}
