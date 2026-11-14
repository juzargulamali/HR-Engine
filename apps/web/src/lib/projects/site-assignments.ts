import { activityWhen, EFFECTIVE_LABELS, formatAt, type ActivityEffective, type ActivityKind, type ActivityReadiness, type CrewRole, type EffectiveReadiness, type SiteActivity } from "@/lib/projects/phase2/model";
import { dateRangeText } from "@/lib/projects/format";
import type { SitePhaseInfo } from "@/lib/projects/site-state";

/**
 * What a person is assigned to on site, for themselves only (`proj_my_site_assignments`). It is deliberately small: the activity, their role, the venue, the call time, the
 * instructions and a brief readiness. It carries no task, file, chat, review, budget or client record, so a site-only technician can be shown exactly this and nothing more.
 */
export interface SiteAssignment {
  assignment_id: string; activity_id: string; project_name: string; title: string; run_label: string | null; kind: ActivityKind | null; state: "tentative" | "confirmed"; role: CrewRole;
  location: string | null; start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null; tz: string | null;
  call_at: string | null; call_tz: string | null; instructions: string | null; crew_instructions: string | null; ready: ActivityReadiness; hardware_state: string | null; effective?: ActivityEffective; ready_effective?: EffectiveReadiness;
  /** From the database: the phase (a passed date is never "started"), the named contact (site lead, else Project Manager) and the reporting details still missing. */
  phase?: SitePhaseInfo; contact?: { name: string | null; role: string }; reporting?: { complete: boolean; missing: ("date" | "venue" | "call_time")[] }; site_only: boolean;
}

/** The window in words, exact, in the activity's own zone ("11 Nov, 09:00–18:00 Asia/Dubai"). */
export const assignmentWhen = (a: SiteAssignment): string => {
  const own = a.start_date || a.starts_at;
  const e = a.effective;
  if (!own && e?.start_date && e.date_source === "project") return `${dateRangeText(e.start_date, e.end_date)} (from the project dates; the time is not set yet)`;
  if (!own) return "Date not set yet: your Project Manager will confirm it";
  return activityWhen(a as unknown as Pick<SiteActivity, "start_date" | "end_date" | "starts_at" | "ends_at" | "tz">, a.tz);
};
/** Personal and explicit: nothing is invented when none was set. */
export const callWord = (a: SiteAssignment): string => (a.call_at ? formatAt(a.call_at, a.call_tz ?? a.tz) : "Not set yet: your Project Manager will confirm it");
/** The venue: the activity's own, else the project's recorded venue (and it says so), else not recorded. */
export const venueWord = (a: SiteAssignment): string => {
  const v = a.effective?.venue ?? a.location;
  return v ? `${v}${a.effective?.venue_source === "project" ? " (the project's venue)" : ""}` : "Not recorded yet";
};
/** Inventory's own word for the equipment request state, in plain English (read, never entered here). */
export const HARDWARE_STATE_WORDS: Record<string, string> = {
  draft: "Not sent to the warehouse yet", empty: "No equipment lines yet", reserved: "Reserved", partially_ready: "Partly ready", short: "Short of stock", partially_dispatched: "Partly dispatched",
  dispatched: "Dispatched", still_out: "Out on site", returned: "Returned", cancelled: "Cancelled",
};
export const hardwareStateWord = (s: string | null): string | null => (s ? (HARDWARE_STATE_WORDS[s] ?? null) : null);

/** Who to ask: "Site lead: Cara" / "Project Manager: Sam". Nothing invented when the database named nobody. */
export const contactWord = (a: SiteAssignment): string | null => (a.contact ? `${a.contact.role}: ${a.contact.name ?? "not named yet"}` : null);

/** What is still missing from the reporting details, in the person's words. */
export const REPORTING_WORDS: Record<"date" | "venue" | "call_time", string> = { date: "the date", venue: "the venue", call_time: "your call time" };
export const reportingText = (a: SiteAssignment): { complete: boolean; text: string } => {
  const r = a.reporting;
  if (!r) return { complete: false, text: "" };
  if (r.complete) return { complete: true, text: "Reporting details complete: date, venue and call time are set" };
  return { complete: false, text: `Still to come: ${r.missing.map((m) => REPORTING_WORDS[m]).join(", ")}` };
};
/** A tentative assignment whose date has passed, with details still missing: the person is told who to contact rather than left guessing. */
export const needsProvisionalNote = (a: SiteAssignment): boolean => a.state === "tentative" && a.phase?.phase === "date_passed" && a.reporting?.complete === false;

/** The project-wide counts as ONE labelled line. Never the run's own readiness: it is shown separately and says "Project-wide". */
export function projectReadyText(r: EffectiveReadiness | undefined): string | null {
  const p = r?.project;
  if (!p) return null;
  const one = (label: string, x: { state: keyof typeof EFFECTIVE_LABELS; detail?: string | null }) => `${label} ${EFFECTIVE_LABELS[x.state].toLowerCase()}${x.detail ? ` (${x.detail.charAt(0).toLowerCase()}${x.detail.slice(1)})` : ""}`;
  return `Project-wide readiness: ${[one("hardware", p.hardware), one("content", p.content), one("app", p.app)].join(", ")}`;
}

/** An unread crew notice for one activity (type project_site_change): what moved, from what to what. */
export interface SiteChangeNote { field: string; from: string; to: string }
/** The unread notices' payloads, grouped by activity. Anything that is not a well-formed site-change payload is ignored. */
export function siteChangesByActivity(rows: { payload: unknown }[]): Record<string, SiteChangeNote[]> {
  const out: Record<string, SiteChangeNote[]> = {};
  for (const r of rows) {
    const pl = r.payload as { activity_id?: unknown; changes?: unknown } | null;
    if (!pl || typeof pl.activity_id !== "string" || !Array.isArray(pl.changes)) continue;
    const list = pl.changes.filter((c): c is SiteChangeNote => !!c && typeof (c as SiteChangeNote).field === "string" && typeof (c as SiteChangeNote).from === "string" && typeof (c as SiteChangeNote).to === "string");
    if (list.length > 0) out[pl.activity_id] = [...(out[pl.activity_id] ?? []), ...list];
  }
  return out;
}
