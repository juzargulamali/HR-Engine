import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { opsCompanyIds } from "@enginious-hr/domain";
import { isNotInstalled } from "@/lib/projects/errors";
import { getProjectsContext, type ProjectsContext } from "@/lib/projects/context";
import { createClient } from "@/lib/supabase/server";
import type { SiteActivityRead } from "@/lib/projects/phase2/model";
import { choosePermittedCompany, OPS_COMPANY_COOKIE } from "./company";
import { SITE_ACTIVITY_LIMIT, type Overview, type UpcomingRow } from "./model";

/**
 * The Operations view of a signed-in session. Operations Manager is a Projects capability ("operations") held per company; a founder holds it too. This only shapes
 * the screens: every read below is a database function that checks the capability itself for the company asked for, so a revoked manager gets a refusal on the next
 * read whatever this context said a moment ago.
 */
export interface OperationsContext { projects: ProjectsContext; companies: { id: string; name: string }[]; loadFailed: boolean; installed: boolean }
export const getOperationsContext = cache(async (): Promise<OperationsContext | null> => {
  const projects = await getProjectsContext();
  if (!projects) return null;
  const ids = new Set(opsCompanyIds(projects.grants));
  return { projects, companies: projects.companies.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, name: projects.companyName(c.id) })), loadFailed: !!projects.loadFailed, installed: projects.installed };
});

/** The company the person used last, from the cookie the Operations pages leave (never trusted: `pickCompany` checks it against the companies they manage today). */
async function rememberedCompany(): Promise<string | undefined> {
  try { return (await cookies()).get(OPS_COMPANY_COOKIE)?.value; } catch { return undefined; }
}
/**
 * The company a page shows: the one asked for when the person is its Operations Manager, else the one they used last while it is still theirs, else their default
 * (their first company by name).
 */
export async function pickCompany(ctx: OperationsContext, asked: string | undefined) {
  return choosePermittedCompany(ctx.companies, asked, await rememberedCompany()).company;
}

export type OpsResult<T> = { state: "ok"; data: T } | { state: "not_installed" } | { state: "denied" } | { state: "error" };
function fail(error: { code?: string; message?: string }, what: string): OpsResult<never> {
  if (isNotInstalled(error)) return { state: "not_installed" };
  if (error.code === "42501" || error.code === "P0002") return { state: "denied" };
  console.error(`[operations] ${what} failed`, error.message);
  return { state: "error" };
}

/** Four separate answers: the data (possibly empty), not installed here, refused (not this company's Operations Manager any more), or the read failed. */
export async function loadOverview(companyId: string): Promise<OpsResult<Overview>> {
  const { data, error } = await (await createClient()).rpc("ops_overview", { p_company_id: companyId });
  if (error) return fail(error, "overview");
  return data && typeof data === "object" && Array.isArray((data as { projects?: unknown }).projects) ? { state: "ok", data: data as unknown as Overview } : { state: "error" };
}
export async function loadUpcoming(companyId: string): Promise<OpsResult<UpcomingRow[]>> {
  const { data, error } = await (await createClient()).rpc("ops_upcoming_work", { p_company_id: companyId });
  if (error) return fail(error, "upcoming work");
  return Array.isArray(data) ? { state: "ok", data: data as unknown as UpcomingRow[] } : { state: "error" };
}

/**
 * The dated site activities of the company's live projects, once each, from the same database function the Site schedule, Work and Calendar use (bounded to 300 rows, under the
 * viewer's own access). Read ONCE per page: Next on site, the timeline and team pressure all use this one answer, so they cannot disagree about an activity. When it is not
 * installed or fails, the page falls back to the project header dates and says so.
 */
export async function loadSiteActivities(companyId: string): Promise<OpsResult<SiteActivityRead[]>> {
  const { data, error } = await (await createClient()).rpc("proj_site_activities_read", { p_company_id: companyId, p_limit: SITE_ACTIVITY_LIMIT });
  if (error) return fail(error, "site activities");
  return Array.isArray(data) ? { state: "ok", data: data as unknown as SiteActivityRead[] } : { state: "error" };
}
