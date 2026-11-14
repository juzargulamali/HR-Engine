import { describeSitePhase, kindShort } from "@/lib/projects/site-state";
import type { SiteActivityRead } from "@/lib/projects/phase2/model";
import { describeChange, type ChangeRow } from "@/app/(app)/projects/[id]/history/change-log";

/**
 * Pure helpers for the Projects list: the next commitment of each project (from the same site activities every other screen reads, else the next
 * milestone), whether the team has leads, and the combined recent-activity preview. No database, no React.
 */

export interface MilestoneDue { title: string; due: string }
export interface Commitment {
  kind: "site" | "milestone";
  /** One line: what and when, in the words the other screens use. */
  text: string;
  /** Further words under it (for example that nobody has recorded a start), or null. */
  detail: string | null;
  /** The day it is about, for ordering. */
  date: string | null;
  href: string;
  /** A date that has passed with no start recorded, or an activity with no date at all: the Project Manager must act. */
  needsAction: boolean;
}

const shortDate = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const siteRowHref = (projectId: string, activityId: string) => `/projects/${projectId}/plan?plan=site&mode=list#site-${activityId}`;

function siteCommitment(a: SiteActivityRead): Commitment {
  const t = describeSitePhase(a.phase);
  const run = a.run_label ? ` · ${a.run_label}` : "";
  return {
    kind: "site", text: `${t.label}${run}`, detail: t.detail, date: a.phase.first_day ?? a.start_date ?? null, href: siteRowHref(a.project_id, a.id),
    needsAction: a.phase.phase === "date_passed" || a.phase.phase === "no_date",
  };
}

/**
 * The project's next commitment. A dated site activity that is today or later (or started) beats a milestone only if it is earlier; an activity whose date passed with no
 * recorded start is still the thing to act on, so it is offered ahead of later dates and labelled "date passed · start unconfirmed". Undated activities never count as dated.
 */
export function pickNextCommitment(projectId: string, activities: readonly SiteActivityRead[], milestone: MilestoneDue | undefined, today: string): Commitment | null {
  const mine = activities.filter((a) => a.project_id === projectId && a.phase.phase !== "no_date");
  const upcoming = mine.filter((a) => a.phase.phase === "scheduled" || a.phase.phase === "due_today" || a.phase.phase === "started")
    .sort((a, b) => (a.phase.first_day ?? "9999").localeCompare(b.phase.first_day ?? "9999"));
  const passed = mine.filter((a) => a.phase.phase === "date_passed").sort((a, b) => (a.phase.first_day ?? "").localeCompare(b.phase.first_day ?? ""));
  const site = passed[0] ?? upcoming[0] ?? null;
  const ms: Commitment | null = milestone && milestone.due >= today ? { kind: "milestone", text: `Milestone: ${milestone.title}`, detail: `Due ${shortDate(milestone.due)}`, date: milestone.due, href: `/projects/${projectId}/work`, needsAction: false } : null;
  const sc = site ? siteCommitment(site) : null;
  if (sc && ms) return sc.needsAction || (sc.date ?? "9999") <= (ms.date ?? "9999") ? sc : ms;
  return sc ?? ms;
}

/** What to say when there is nothing dated, and who sets it. */
export const noCommitmentText = (pmName: string | null) => ({ text: "No dated commitment", detail: `${pmName ?? "The Project Manager"} sets dates in the Site schedule or as milestones.` });

export type TeamStanding = { state: "leads_not_set" | "no_members" | "ok"; label: string | null };
/**
 * "Team leads not set" (the project has no team with a named lead: nobody leads the work yet) is a different fact from an empty membership (nobody besides the Project Manager has
 * been added). Both are shown with a Manage team link by the caller; a project with leads and members shows nothing.
 */
export function teamStanding(teamsWithLead: number, memberCount: number): TeamStanding {
  if (teamsWithLead === 0) return { state: "leads_not_set", label: "Team leads not set" };
  if (memberCount <= 1) return { state: "no_members", label: "No other members yet" };
  return { state: "ok", label: null };
}

export interface ActivityPreview { projectId: string; lines: { key: string; text: string }[]; more: number }
/**
 * The latest few events per project merged into one preview (the newest first), with how many more there are, so the list carries ONE History link per project instead of one per event.
 * `rows` are proj_change_log rows, newest first.
 */
export function buildActivityPreviews(rows: readonly (ChangeRow & { id: number; project_id: string })[], nameOf: (id: string | null | undefined) => string, perProject = 2): Map<string, ActivityPreview> {
  const out = new Map<string, ActivityPreview>();
  for (const r of rows) {
    const p = out.get(r.project_id) ?? { projectId: r.project_id, lines: [], more: 0 };
    if (p.lines.length < perProject) {
      const d = describeChange(r, { entityName: () => null, nameOf });
      p.lines.push({ key: String(r.id), text: `${d.subject}: ${d.sentence}` });
    } else p.more += 1;
    out.set(r.project_id, p);
  }
  return out;
}

export { kindShort };
