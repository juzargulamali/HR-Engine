import type { CrmOutreachEventRow, CrmOutreachKind, CrmOutreachOutcome, CrmOutreachRow, CrmOutreachStatus } from "@/types/crm";

/**
 * Pre-inquiry outreach: the pure rules the screens share (labels, overdue, filters, sort). The database owns who may do what and every status
 * change (migration 20261219000100 section 8); nothing here infers a reply or moves a status.
 */

export const OUTREACH_STATUSES: readonly CrmOutreachStatus[] = ["not_started", "in_progress", "waiting_for_reply", "meeting_booked", "inquiry_raised", "closed"];
export const OUTREACH_STATUS_LABEL: Record<CrmOutreachStatus, string> = {
  not_started: "Not started", in_progress: "In progress", waiting_for_reply: "Waiting for reply", meeting_booked: "Meeting booked", inquiry_raised: "Inquiry raised", closed: "Closed",
};
/** What a person may choose by hand. Inquiry raised comes only from linking an inquiry; Closed needs a reason. */
export const OUTREACH_SETTABLE_STATUSES: readonly CrmOutreachStatus[] = ["not_started", "in_progress", "waiting_for_reply", "meeting_booked", "closed"];

export const OUTREACH_KINDS: readonly CrmOutreachKind[] = ["call", "email", "meeting"];
export const OUTREACH_KIND_LABEL: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting" };
/**
 * The outcomes a person may choose for each kind of activity: the ONE definition used by the form, the server action and (as the same lists, kept in step by a test)
 * the database function crm_outreach_log. "Replied" exists only for e-mail and "Spoke" only for calls; nothing is ever inferred from a recorded activity.
 */
export const OUTREACH_OUTCOMES_BY_KIND: Record<CrmOutreachKind, readonly CrmOutreachOutcome[]> = {
  call: ["no_answer", "left_message", "spoke", "call_back_requested", "not_interested"],
  email: ["sent", "replied", "bounced", "not_interested"],
  meeting: ["meeting_booked", "meeting_held", "rescheduled", "no_show", "not_interested"],
};
/** Every value that may be stored: the lists above plus the outcomes of the original single list, which stay readable on rows already recorded. */
export const OUTREACH_OUTCOMES: readonly CrmOutreachOutcome[] = [
  "no_answer", "spoke", "left_message", "sent", "replied", "meeting_held", "not_interested", "call_back_requested", "bounced", "meeting_booked", "rescheduled", "no_show",
];
export const OUTREACH_OUTCOME_LABEL: Record<CrmOutreachOutcome, string> = {
  no_answer: "No answer", spoke: "Spoke", left_message: "Left message", sent: "Sent", replied: "Replied", meeting_held: "Meeting held", not_interested: "Not interested",
  call_back_requested: "Call back requested", bounced: "Bounced / wrong address", meeting_booked: "Meeting booked", rescheduled: "Rescheduled", no_show: "No show",
};
/** The choices for a kind (empty for an unknown kind). */
export const outcomesForKind = (kind: string): readonly CrmOutreachOutcome[] => OUTREACH_OUTCOMES_BY_KIND[kind as CrmOutreachKind] ?? [];
/** A NEW entry's outcome must fit its kind. Rows already stored are never checked against this: they display as they are. */
export const isOutcomeValidForKind = (kind: string, outcome: string): boolean => (outcomesForKind(kind) as readonly string[]).includes(outcome);
/** Keeps the chosen outcome when it fits the (new) kind, else clears it so the person must choose again. */
export const outcomeAfterKindChange = (kind: string, outcome: string): string => (isOutcomeValidForKind(kind, outcome) ? outcome : "");
export const OUTREACH_EVENT_LABEL: Record<CrmOutreachEventRow["kind"], string> = {
  assigned: "Assigned", reassigned: "Reassigned", call: "Call", email: "Email", meeting: "Meeting", status: "Status", next_action: "Next action", inquiry_linked: "Inquiry linked",
};
export const ASSIGN_RESULT_LABEL: Record<string, string> = {
  assigned: "Assigned", reassigned: "Reassigned (it already had open outreach for someone else; history kept)", already: "Already has open outreach for that person: nothing changed", not_found: "Account not found",
};

/** The date the person is waiting on: the next action's due date, else the target date. */
export const dueOn = (o: Pick<CrmOutreachRow, "next_due" | "target_date">): string => o.next_due ?? o.target_date;
/** Finished from the salesperson's side: no overdue marker for an outreach that raised an inquiry or was closed. */
export const isOutreachOpen = (o: Pick<CrmOutreachRow, "status">): boolean => o.status !== "closed" && o.status !== "inquiry_raised";
/** Overdue = still being worked and its due date (Dubai calendar date, YYYY-MM-DD) is before today. */
export const isOverdue = (o: Pick<CrmOutreachRow, "status" | "next_due" | "target_date">, today: string): boolean => isOutreachOpen(o) && dueOn(o) < today;

export interface OutreachFilters { assignee: string; status: string; overdue: boolean }

export function outreachFiltersFromParams(sp: Record<string, string | string[] | undefined>): OutreachFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const status = one("status");
  return {
    assignee: /^[0-9a-f-]{36}$/i.test(one("assignee")) ? one("assignee") : "",
    status: (OUTREACH_STATUSES as readonly string[]).includes(status) ? status : "",
    overdue: one("overdue") === "1",
  };
}

/** Filters, then sorts by next due date (earliest first; the target date stands in when there is no next action). Closed outreach is hidden unless asked for. */
export function filterOutreach<T extends CrmOutreachRow>(rows: readonly T[], f: OutreachFilters, today: string): T[] {
  return rows
    .filter((o) => (f.assignee ? o.assigned_to === f.assignee : true))
    .filter((o) => (f.status === "" ? o.status !== "closed" : o.status === f.status))
    .filter((o) => (f.overdue ? isOverdue(o, today) : true))
    .sort((a, b) => dueOn(a).localeCompare(dueOn(b)) || a.id.localeCompare(b.id));
}

/** Per-account outcome of a bulk assignment, in the order the accounts were chosen. */
export function summariseAssignResults(results: readonly { organisation_id: string; result: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1;
  return counts;
}

/** One history line in words. `who` names people, `inquiry` names a linked inquiry. */
export function describeEvent(e: CrmOutreachEventRow, who: (id: string | null) => string, inquiry: (id: string | null) => string): string {
  const label = OUTREACH_EVENT_LABEL[e.kind];
  switch (e.kind) {
    case "assigned": return `${label} to ${who(e.to_user)}${e.note ? `: ${e.note}` : ""}`;
    case "reassigned": return `${label} from ${who(e.from_user)} to ${who(e.to_user)}`;
    case "call": case "email": case "meeting": return `${label}${e.outcome ? ` · ${OUTREACH_OUTCOME_LABEL[e.outcome]}` : ""}${e.note ? `: ${e.note}` : ""}`;
    case "status": return `${label}: ${OUTREACH_STATUS_LABEL[(e.from_status ?? "not_started") as CrmOutreachStatus] ?? e.from_status} to ${OUTREACH_STATUS_LABEL[(e.to_status ?? "not_started") as CrmOutreachStatus] ?? e.to_status}${e.note ? ` (${e.note})` : ""}`;
    case "next_action": return `${label}: ${e.note ?? ""}${e.due_on ? ` · due ${e.due_on}` : ""}`;
    case "inquiry_linked": return `${label}: ${inquiry(e.opportunity_id)}`;
  }
}
