import { shortDay, type ActivityKind } from "@/lib/projects/phase2/model";

/**
 * One way to say where a site activity stands, used by the Site schedule, Work, Calendar, My Day / My site assignments and Operations. It comes from `proj_site_phase_json` (the database), so
 * every screen reads the same facts:
 *   - a SUGGESTED project date is the project header's installation or event date borrowed by an activity that has none of its own (`basis: "project_header"`);
 *   - a SCHEDULED activity has its own date or time window (`basis: "activity"`), tentative or confirmed;
 *   - an ACTUAL START is only ever an explicit record (`started`): a date that has passed never means the work started.
 */
export type SitePhase = "started" | "scheduled" | "due_today" | "date_passed" | "no_date";
export interface SitePhaseInfo {
  phase: SitePhase; basis: "activity" | "project_header" | "none"; first_day: string | null; last_day: string | null; started_at: string | null; started_by?: string | null;
  kind: ActivityKind | null; state: "tentative" | "confirmed"; today: string; choice_pending?: boolean;
}
export interface SiteStateText { label: string; detail: string | null; tone: "green" | "amber" | "blue" | "quiet"; started: boolean; fromHeader: boolean }

const KIND_SHORT: Record<ActivityKind, string> = { setup: "Setup", show: "Show", dismantling: "Dismantling", mockup: "Mockup", other: "Activity" };
const KIND_WORD: Record<ActivityKind, string> = { setup: "installation", show: "show", dismantling: "dismantling", mockup: "mockup", other: "activity" };
export const kindShort = (k: ActivityKind | null | undefined) => KIND_SHORT[k ?? "other"] ?? "Activity";
export const kindWord = (k: ActivityKind | null | undefined) => KIND_WORD[k ?? "other"] ?? "activity";

const dayText = (a: string | null, b: string | null) => (!a ? "" : !b || b === a ? shortDay(a) : `${shortDay(a)} to ${shortDay(b)}`);
const startedDay = (iso: string | null) => (iso ? shortDay(new Date(iso).toISOString().slice(0, 10)) : "");

/** The words for a phase. `started` only with an explicit record; a passed date reads "date passed · start unconfirmed". */
export function describeSitePhase(p: SitePhaseInfo | null | undefined): SiteStateText {
  if (!p) return { label: "No date", detail: null, tone: "quiet", started: false, fromHeader: false };
  const header = p.basis === "project_header";
  const where = header ? " (from the project header)" : "";
  const tent = p.state === "confirmed" ? "Confirmed" : "Tentative";
  switch (p.phase) {
    case "started": return { label: `${kindShort(p.kind)} started ${startedDay(p.started_at)}`.replace(/^Setup /, "Installation "), detail: p.started_by ? `Recorded by ${p.started_by}` : "Recorded start", tone: "green", started: true, fromHeader: header };
    case "scheduled": return { label: `${tent} ${kindShort(p.kind)} on ${dayText(p.first_day, p.last_day)}${where}`, detail: header ? "A suggested date: nobody has scheduled this activity yet" : null, tone: p.state === "confirmed" ? "green" : "amber", started: false, fromHeader: header };
    case "due_today": return { label: `${tent} ${kindShort(p.kind)} today${where}`, detail: "Not recorded as started", tone: "blue", started: false, fromHeader: header };
    case "date_passed": return { label: `Scheduled ${kindWord(p.kind)} date passed · start unconfirmed`, detail: `${dayText(p.first_day, p.last_day)}${header ? " (project header date)" : ""}; nobody has recorded that it started`, tone: "amber", started: false, fromHeader: header };
    default: return { label: p.choice_pending ? "No date · choose which run" : "No date", detail: null, tone: "quiet", started: false, fromHeader: false };
  }
}

/** For a crew member on a tentative activity whose date has passed and whose reporting details are incomplete: who to ask. */
export const provisionalPassedText = (contactName: string | null | undefined): string => `Provisional date passed · contact ${contactName ?? "your Project Manager"} for updated details`;
