import "server-only";
import { getOperationsContext, loadOverview, loadUpcoming } from "@/lib/operations/data";
import { getProjectsContext } from "@/lib/projects/context";
import { isNotInstalled } from "@/lib/projects/errors";
import { createClient } from "@/lib/supabase/server";
import type { MyEquipmentReview, OpsDay } from "./operations";

/**
 * The Operations reads behind My Day, for the companies the person is Operations Manager of. They are the same two database functions the Operations pages
 * call (ops_overview, ops_upcoming_work); each checks the capability for the company asked for, so the counts and links can only come from those companies and a
 * revoked manager's company simply drops out. Null: the person has no Operations access (nothing is read or shown). Throws when the access lookup failed, so
 * My Day says Operations could not be loaded and never shows it as nothing.
 */
export async function loadOperationsDay(): Promise<OpsDay | null> {
  const ctx = await getOperationsContext();
  if (!ctx || !ctx.installed) return null;
  if (ctx.loadFailed) throw new Error("Operations access could not be loaded");
  if (ctx.companies.length === 0) return null;
  const reads = await Promise.all(ctx.companies.map(async (company) => {
    const [overview, upcoming] = await Promise.all([loadOverview(company.id), loadUpcoming(company.id)]);
    return { company, overview, upcoming };
  }));
  // Not installed here, or refused for every company (revoked since the page started loading): there is nothing to show.
  const usable = reads.filter((r) => r.overview.state === "ok" || r.overview.state === "error");
  return usable.length === 0 ? null : { reads: usable };
}

const FINISHED = "(completed,archived)";
/**
 * Open "Review equipment booking" entries on the live projects this person is Project Manager of, one row per project. Row-level security decides what is
 * readable. Null: no Projects access. An environment without the table returns an empty list. Throws when a read fails.
 */
export async function loadMyEquipmentReviews(): Promise<MyEquipmentReview[] | null> {
  const ctx = await getProjectsContext();
  if (!ctx || !ctx.installed || ctx.loadFailed || ctx.grants.length === 0) return null;
  const supabase = await createClient();
  const mine = await supabase.from("proj_projects").select("id, reference, name").eq("pm_user_id", ctx.userId).not("status", "in", FINISHED).limit(500);
  if (mine.error) throw new Error(mine.error.message);
  const projects = mine.data ?? [];
  if (projects.length === 0) return [];
  const open = await supabase.from("proj_equipment_reviews").select("project_id, changed_at").in("project_id", projects.map((p) => p.id)).is("resolved_at", null).limit(1000);
  if (isNotInstalled(open.error)) return [];
  if (open.error) throw new Error(open.error.message);
  const by = new Map<string, { count: number; since: string }>();
  for (const v of open.data ?? []) {
    const have = by.get(v.project_id);
    by.set(v.project_id, { count: (have?.count ?? 0) + 1, since: have && have.since < v.changed_at ? have.since : v.changed_at });
  }
  return projects.filter((p) => by.has(p.id)).map((p) => ({ projectId: p.id, reference: p.reference, name: p.name, ...by.get(p.id)! }));
}
