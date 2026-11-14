import { isCrmActive } from "@enginious-hr/domain";
import type { CrmReminderRow } from "@/types/crm";

/**
 * What the person is shown for their unread reminders: one current reminder per thing, never one per database row.
 *
 * Why this exists: the reminder job (crm_generate_reminders) writes a "due" row to the assignee when a follow-up falls due and, a day later, an "overdue" row
 * to the enquiry owner. When one person is both, they hold two unread rows about the same follow-up, and the page used to list both. Hold reviews and
 * "no next action" are keyed by date, so those can pile up for one enquiry as well. The rows are an audit trail and stay in the table: this only decides
 * what is shown, and which rows "Dismiss" marks read (every row behind the one shown).
 *
 * Pure: the caller passes the facts it has already read. A reminder is left out only when those facts say it no longer applies; when they cannot tell
 * (the enquiry is not among the ones read, the reminder has no due time), it is kept.
 */
export interface ReminderFacts {
  /** Every OPEN follow-up the person can see, by id (the Follow-ups page reads them all). */
  openFollowUps: ReadonlyMap<string, { due_at: string; opportunity_id: string | null }>;
  /** The enquiries the caller has read, by id. An enquiry that is not here is not judged. */
  opportunities?: ReadonlyMap<string, { stage: string }>;
}

export interface CurrentReminder {
  /** Stable identity of what the reminder is about (the follow-up, or the enquiry and the kind). */
  key: string;
  /** The row shown: overdue wins over due, then the newest. */
  reminder: CrmReminderRow;
  /** Every unread row about the same thing, the shown one included. Dismissing the reminder marks all of these read. */
  ids: string[];
  /** The follow-up it is about, when it is about one. */
  followUpId: string | null;
}

const RANK: Record<CrmReminderRow["kind"], number> = { follow_up_overdue: 0, follow_up_due: 1, hold_review_due: 2, no_next_action: 3 };
const sameMoment = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();

/** True when the facts say this reminder no longer applies. */
function isStale(r: CrmReminderRow, facts: ReminderFacts): boolean {
  if (r.kind === "follow_up_due" || r.kind === "follow_up_overdue") {
    if (!r.follow_up_id) return false;
    const f = facts.openFollowUps.get(r.follow_up_id);
    // Completed, cancelled, or no longer visible to this person: nothing left to do about it here.
    if (!f) return true;
    // The reminder was written for a due time the follow-up no longer has (it was rescheduled).
    return !!r.due_at && !sameMoment(r.due_at, f.due_at);
  }
  const opp = facts.opportunities?.get(r.opportunity_id);
  if (r.kind === "hold_review_due") return !!opp && opp.stage !== "on_hold";
  // no_next_action: a next action has been planned since, or the enquiry is no longer in a working stage.
  for (const f of facts.openFollowUps.values()) if (f.opportunity_id === r.opportunity_id) return true;
  return !!opp && !isCrmActive(opp.stage);
}

function keyOf(r: CrmReminderRow): string {
  if (r.kind === "follow_up_due" || r.kind === "follow_up_overdue") return r.follow_up_id ? `followup:${r.follow_up_id}` : `reminder:${r.id}`;
  return `${r.kind}:${r.opportunity_id}`;
}

/** Collapses unread reminder rows to one per follow-up (overdue over due) or per enquiry and kind, leaving out the ones that no longer apply. Most urgent first. */
export function currentReminders(rows: readonly CrmReminderRow[], facts: ReminderFacts): CurrentReminder[] {
  const byKey = new Map<string, CurrentReminder>();
  for (const r of rows) {
    if (r.read_at || isStale(r, facts)) continue;
    const key = keyOf(r);
    const had = byKey.get(key);
    if (!had) {
      byKey.set(key, { key, reminder: r, ids: [r.id], followUpId: key.startsWith("followup:") ? r.follow_up_id : null });
      continue;
    }
    had.ids.push(r.id);
    const better = RANK[r.kind] < RANK[had.reminder.kind] || (RANK[r.kind] === RANK[had.reminder.kind] && r.created_at > had.reminder.created_at);
    if (better) had.reminder = r;
  }
  const when = (c: CurrentReminder) => c.reminder.due_at ?? c.reminder.created_at;
  return [...byKey.values()].sort((a, b) => RANK[a.reminder.kind] - RANK[b.reminder.kind] || when(a).localeCompare(when(b)) || a.key.localeCompare(b.key));
}
