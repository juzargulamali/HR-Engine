import { activityWhen, formatAt, type ActivityEffective, type ActivityKind, type ActivityReadiness, type CrewRole, type EffectiveReadiness, type SiteActivity } from "@/lib/projects/phase2/model";
import { dateRangeText } from "@/lib/projects/format";

/**
 * What a person is assigned to on site, for themselves only (`proj_my_site_assignments`). It is deliberately small: the activity, their role, the venue, the call time, the
 * instructions and a brief readiness. It carries no task, file, chat, review, budget or client record, so a site-only technician can be shown exactly this and nothing more.
 */
export interface SiteAssignment {
  assignment_id: string; activity_id: string; project_name: string; title: string; run_label: string | null; kind: ActivityKind | null; state: "tentative" | "confirmed"; role: CrewRole;
  location: string | null; start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null; tz: string | null;
  call_at: string | null; call_tz: string | null; instructions: string | null; crew_instructions: string | null; ready: ActivityReadiness; hardware_state: string | null; effective?: ActivityEffective; ready_effective?: EffectiveReadiness; site_only: boolean;
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
