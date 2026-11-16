/**
 * One effective-dated change process for job title and pay, and how its records are read back.
 *
 * Existing records: `employee_career_events` (the audit row: effective date, previous and new title and pay) and `compensation_details` (the pay versions; payroll and
 * every other reader take the version flagged current). A change whose effective date is today or earlier is applied now. A change dated later is SCHEDULED: its event is
 * saved unapplied (`applied_at` null) and the daily job applies it on its date, so a future raise is never paid early and never shown as already in force.
 * The write is one database transaction (record_employment_change): job title and pay save together or not at all, so there is no half-saved state to report.
 */
export type ChangeKind = "job" | "pay" | "both";

export interface ChangeInput {
  effectiveDate: string;
  /** Today's calendar date in the employee's country. */
  today: string;
  newJobTitle?: string | null;
  currentJobTitle?: string | null;
  newBasic?: number | null;
  newOther?: number | null;
  currentBasic?: number | null;
  currentOther?: number | null;
}

export interface ChangePlan { ok: true; kind: ChangeKind; titleChanged: boolean; payChanged: boolean; when: "now" | "scheduled" }
export interface ChangeRefusal { ok: false; error: string }

/** Decides what a submitted change is, or why it cannot be saved. The server action and the form both call it, so the sentence is the same. */
export function planChange(i: ChangeInput): ChangePlan | ChangeRefusal {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.effectiveDate)) return { ok: false, error: "Enter the date the change takes effect." };
  const titleChanged = Boolean(i.newJobTitle && i.newJobTitle.trim() && i.newJobTitle.trim() !== (i.currentJobTitle ?? "").trim());
  const basicChanged = i.newBasic != null && i.newBasic !== (i.currentBasic ?? NaN);
  const otherChanged = i.newOther != null && i.newOther !== (i.currentOther ?? 0);
  const payChanged = basicChanged || otherChanged;
  if (!titleChanged && !payChanged) return { ok: false, error: "Nothing changed. Enter a new job title and/or new pay." };
  if (i.newBasic != null && !(i.newBasic > 0)) return { ok: false, error: "Basic salary must be more than zero." };
  if (i.newOther != null && i.newOther < 0) return { ok: false, error: "Others cannot be negative." };
  return { ok: true, kind: titleChanged && payChanged ? "both" : titleChanged ? "job" : "pay", titleChanged, payChanged, when: i.effectiveDate > i.today ? "scheduled" : "now" };
}

export interface CareerEventRow {
  id: string;
  effective_date: string;
  event_type: string;
  previous_job_title: string | null;
  new_job_title: string | null;
  previous_base_salary: number | null;
  new_base_salary: number | null;
  currency: string | null;
  note: string | null;
  /** Null: scheduled, not yet in force. Existing rows were all applied when written. */
  applied_at: string | null;
}

export interface Timeline { scheduled: CareerEventRow[]; history: CareerEventRow[] }

/** Scheduled (not yet applied) changes, soonest first, and applied history, newest first. */
export function splitTimeline(events: readonly CareerEventRow[]): Timeline {
  const scheduled = events.filter((e) => e.applied_at === null).sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const history = events.filter((e) => e.applied_at !== null).sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  return { scheduled, history };
}
