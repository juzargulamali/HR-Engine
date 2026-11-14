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
  /** Set on a follow-up completion that stands for more than one recorded row: how many rows it stands for (the rows themselves are kept, only shown once). */
  mergedRows?: number;
}

/**
 * Completing a follow-up is recorded more than once by design, and the timeline shows it ONCE:
 *   1. the follow-up row itself (completed_at, completed_by, outcome);
 *   2. the internal note crm_complete_follow_up writes in the same transaction: 'Follow-up done: <title>. <outcome>' (migration 20261219000100, the last
 *      statement of the function). crm_activities has no column pointing at the follow-up, so the note is recognised by its exact text, its author and its time;
 *   3. when the completion came from "Log activity" with a call, email, meeting or client response, the person's own update with the same words, written by a
 *      second call a moment later (addActivity in lib/actions/crm.ts).
 * Only rows that are that same completion are folded in: the same person, the same words, the same moment (a few seconds for the note, two minutes for the
 * update that follows). Anything else, including a second note someone wrote with different words, stays its own entry. Nothing is deleted or changed.
 */
const NOTE_TOLERANCE_MS = 5_000;
const UPDATE_WINDOW_MS = 120_000;
export const completionNoteBody = (f: Pick<CrmFollowUpRow, "title" | "outcome">) => `Follow-up done: ${f.title}. ${(f.outcome ?? "").trim()}`;

export interface CompletionMatch { note: CrmActivityRow | null; update: CrmActivityRow | null }

/** For each completed follow-up, the activity rows that record that same completion. An activity is matched to at most one follow-up (the nearest in time). */
export function matchCompletions(followUps: readonly CrmFollowUpRow[], activities: readonly CrmActivityRow[]): Map<string, CompletionMatch> {
  const used = new Set<string>();
  const out = new Map<string, CompletionMatch>();
  const ms = (iso: string) => new Date(iso).getTime();
  const done = followUps.filter((f) => f.status === "done" && f.completed_at).sort((a, b) => ms(a.completed_at!) - ms(b.completed_at!));
  const nearest = (f: CrmFollowUpRow, fits: (a: CrmActivityRow, gap: number) => boolean) => {
    const at = ms(f.completed_at!);
    let best: CrmActivityRow | null = null;
    for (const a of activities) {
      if (used.has(a.id) || (f.completed_by && a.created_by !== f.completed_by)) continue;
      const gap = ms(a.occurred_at) - at;
      if (!fits(a, gap)) continue;
      if (!best || Math.abs(gap) < Math.abs(ms(best.occurred_at) - at)) best = a;
    }
    if (best) used.add(best.id);
    return best;
  };
  for (const f of done) {
    const body = completionNoteBody(f);
    const outcome = (f.outcome ?? "").trim();
    const note = nearest(f, (a, gap) => a.kind === "note" && a.body === body && Math.abs(gap) <= NOTE_TOLERANCE_MS);
    const update = outcome ? nearest(f, (a, gap) => a.body.trim() === outcome && gap >= -NOTE_TOLERANCE_MS && gap <= UPDATE_WINDOW_MS) : null;
    out.set(f.id, { note, update });
  }
  return out;
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
  const completions = matchCompletions(input.followUps, input.activities);
  const folded = new Set<string>();
  for (const m of completions.values()) { if (m.note) folded.add(m.note.id); if (m.update) folded.add(m.update.id); }
  for (const a of input.activities) {
    if (folded.has(a.id)) continue;
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
      // One entry per completion, written by a person (it carries their outcome): the kind and marks of the update they logged with it, when there is one.
      const m = completions.get(f.id);
      const rows = 1 + (m?.note ? 1 : 0) + (m?.update ? 1 : 0);
      out.push({
        id: `fd-${f.id}`, at: f.completed_at, type: "staff", label: m?.update ? ACTIVITY_LABEL[m.update.kind] : "Follow-up", internal: m?.update?.is_internal ?? false, firstResponse: !!m?.update && m.update.id === first?.id,
        text: `Follow-up completed: ${f.title}.${f.outcome ? ` Outcome: ${f.outcome}` : ""}`, who: personName(f.completed_by), when: formatDateTime(f.completed_at), link: null, ...(rows > 1 ? { mergedRows: rows } : {}),
      });
    } else if (f.status === "cancelled") {
      out.push({ id: `fc-${f.id}`, at: f.updated_at, type: "system", label: "Follow-up", internal: false, firstResponse: false, text: `Follow-up cancelled: ${f.title}.`, who: "Not recorded", when: formatDateTime(f.updated_at), link: null });
    }
  }
  return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime() || x.id.localeCompare(y.id));
}

/** The data service returns at most this many rows per read: a list this long may be missing its oldest entries, and the page says so. */
export const TIMELINE_READ_LIMIT = 1000;
