import { formatDateTime } from "@/components/sales/format";
import type { CrmActivityRow, CrmFollowUpRow, CrmOpportunityEventRow } from "@/types/crm";
import { describeHistoryEvent } from "./closure-helpers";
import { describeEvent } from "./helpers";

/**
 * ONE chronological list of what happened on an enquiry, newest first, built only from recorded rows:
 *   staff entries   what a person wrote: a call, email, meeting, note or client response (crm_activities);
 *   system entries  what the app recorded: stage and owner changes, estimate and proposal records, handover status, files, contacts (crm_opportunity_events),
 *                   and follow-ups planned, completed or cancelled (crm_follow_ups).
 * Nothing is threaded or inferred: an entry is one row. The first call, email or meeting that set the enquiry's first response carries a "First response" mark.
 */
export interface TimelineItem {
  id: string;
  at: string;
  /** "staff" = written by a person (the Comments and notes view); "system" = recorded by the app. */
  type: "staff" | "system";
  /** Short label before the text: "Call", "Note", "Stage", "Follow-up"... */
  label: string;
  internal: boolean;
  firstResponse: boolean;
  text: string;
  who: string;
  when: string;
  /** Where the record this entry is about can be opened. */
  link: { href: string; label: string } | null;
}

const ACTIVITY_LABEL: Record<CrmActivityRow["kind"], string> = { call: "Call", email: "Email", meeting: "Meeting", note: "Note", client_response: "Client response" };
const EVENT_LABEL: Record<string, string> = {
  created: "Created", stage_changed: "Stage", held: "On hold", resumed: "Resumed", won: "Won", lost: "Lost", reopened: "Reopened", owner_changed: "Owner", value_changed: "Value",
  details_changed: "Details", availability: "Availability", approval: "Approval", handover: "Handover", proposal: "Proposal", file: "File", contact: "Contact",
};

export function timelineItems(
  input: { opportunityId: string; activities: readonly CrmActivityRow[]; events: readonly CrmOpportunityEventRow[]; followUps: readonly CrmFollowUpRow[]; firstResponseAt: string | null },
  personName: (id: string | null | undefined) => string,
): TimelineItem[] {
  const base = `/sales/opportunities/${input.opportunityId}`;
  const out: TimelineItem[] = [];
  // The activity that set the first response: the earliest call, email or meeting at that exact moment (crm_add_activity sets first_response_at from it).
  const first = input.firstResponseAt
    ? [...input.activities].filter((a) => a.kind !== "note" && a.kind !== "client_response" && new Date(a.occurred_at).getTime() === new Date(input.firstResponseAt!).getTime()).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    : undefined;
  for (const a of input.activities) {
    out.push({ id: `a-${a.id}`, at: a.occurred_at, type: "staff", label: ACTIVITY_LABEL[a.kind], internal: a.is_internal, firstResponse: a.id === first?.id, text: a.body, who: personName(a.created_by), when: formatDateTime(a.occurred_at), link: null });
  }
  for (const e of input.events) {
    const sentEstimate = e.kind === "proposal" && /^Estimate \S+ rev \d+ recorded as sent on /.test(e.to_value ?? "");
    // Every line the estimate functions write (drafted, finalised, recorded as sent) is labelled Estimate, not Proposal.
    const estimate = sentEstimate || (e.kind === "proposal" && /^(v\d+ estimate draft|\S+ rev \d+ (issued|draft))$/.test(e.to_value ?? ""));
    const link = sentEstimate && e.reason ? { href: `${base}/quotations/${e.reason}`, label: "Open that estimate revision" }
      : e.kind === "handover" ? { href: `${base}/handover`, label: "Open the handover" } : null;
    out.push({
      id: `e-${e.id}`, at: e.created_at, type: "system", label: estimate ? "Estimate" : EVENT_LABEL[e.kind] ?? "Change", internal: false, firstResponse: false,
      text: describeHistoryEvent(e) ?? describeEvent(e, personName), who: e.actor_id ? personName(e.actor_id) : "System", when: formatDateTime(e.created_at), link,
    });
  }
  for (const f of input.followUps) {
    out.push({ id: `fp-${f.id}`, at: f.created_at, type: "system", label: "Follow-up", internal: false, firstResponse: false, text: `Follow-up planned: ${f.title}. Due ${formatDateTime(f.due_at)}, for ${personName(f.assigned_to)}.`, who: personName(f.created_by), when: formatDateTime(f.created_at), link: null });
    if (f.status === "done" && f.completed_at) {
      out.push({ id: `fd-${f.id}`, at: f.completed_at, type: "system", label: "Follow-up", internal: false, firstResponse: false, text: `Follow-up completed: ${f.title}.${f.outcome ? ` Outcome: ${f.outcome}` : ""}`, who: personName(f.completed_by), when: formatDateTime(f.completed_at), link: null });
    } else if (f.status === "cancelled") {
      out.push({ id: `fc-${f.id}`, at: f.updated_at, type: "system", label: "Follow-up", internal: false, firstResponse: false, text: `Follow-up cancelled: ${f.title}.`, who: "Not recorded", when: formatDateTime(f.updated_at), link: null });
    }
  }
  return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime() || x.id.localeCompare(y.id));
}

/** The data service returns at most this many rows per read: a list this long may be missing its oldest entries, and the page says so. */
export const TIMELINE_READ_LIMIT = 1000;
