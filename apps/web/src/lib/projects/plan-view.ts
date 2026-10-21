import { firstParam, withParams, type SearchParamsLike } from "@/components/workspace/url-state";

/**
 * The Plan section of a project: Delivery or Site, shown as a List, a Calendar or a Timeline. Choosing a view only changes links:
 * it never writes anything, so it can never change or duplicate a date.
 */
export const PLAN_KINDS = ["delivery", "site"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const PLAN_MODES = ["list", "calendar", "timeline"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

export const PLAN_KIND_LABELS: Record<PlanKind, string> = { delivery: "Delivery", site: "Site" };
export const PLAN_MODE_LABELS: Record<PlanMode, string> = { list: "List", calendar: "Calendar", timeline: "Timeline" };

export function parsePlanParams(sp: SearchParamsLike): { plan: PlanKind; mode: PlanMode } {
  const plan = PLAN_KINDS.find((p) => p === firstParam(sp, "plan")) ?? "delivery";
  const mode = PLAN_MODES.find((m) => m === firstParam(sp, "mode")) ?? "list";
  return { plan, mode };
}

/** Which calendar entries belong to which plan: delivery is the build, site is what happens on site. */
export const PLAN_CALENDAR_KINDS: Record<PlanKind, { id: string; label: string }[]> = {
  delivery: [
    { id: "milestone", label: "Milestones" }, { id: "deliverable", label: "Deliverables" }, { id: "task", label: "Task deadlines" }, { id: "plan_delivery", label: "Delivery timeline" },
  ],
  site: [
    { id: "plan_site", label: "Site timeline" }, { id: "booking", label: "Site bookings" }, { id: "dependency", label: "Dependencies" },
  ],
};

export const planPath = (projectId: string) => `/projects/${projectId}/plan`;

/** A link inside the Plan section that keeps whatever else is in the address (calendar date, filters…). */
export function planHref(projectId: string, current: SearchParamsLike, patch: Record<string, string | null>, drop: readonly string[] = []): string {
  return withParams(planPath(projectId), current, patch, drop);
}

/** The pieces of the calendar's own address that survive a switch of plan or mode. */
const CALENDAR_ONLY = ["view", "date", "tz", "kind"] as const;

/** The old Timelines & site address, forwarded to the Plan section (a booking conflict check opens the Site plan). */
export function legacyTimelineTarget(projectId: string, sp: SearchParamsLike): string {
  const check = firstParam(sp, "check");
  return withParams(planPath(projectId), {}, { plan: check ? "site" : "delivery", mode: "list", check: check || null });
}

/** The old project Calendar address, forwarded to the Plan section with its view, date, zone and filters kept. A site-only filter opens the Site plan. */
export function legacyCalendarTarget(projectId: string, sp: SearchParamsLike): string {
  const kinds = (firstParam(sp, "kind") ? firstParam(sp, "kind").split(",") : []).map((k) => k.trim()).filter(Boolean);
  const siteIds = PLAN_CALENDAR_KINDS.site.map((k) => k.id);
  const onlySite = kinds.length > 0 && kinds.every((k) => siteIds.includes(k));
  const patch: Record<string, string | null> = { plan: onlySite ? "site" : "delivery", mode: "calendar" };
  for (const k of CALENDAR_ONLY) patch[k] = firstParam(sp, k) || null;
  return withParams(planPath(projectId), {}, patch);
}
