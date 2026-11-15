/**
 * "Operations asked a question" for Sales. When an Operations Manager saves a new or changed question on a flagged enquiry, the database sends ONE in-app notice to
 * the enquiry's owner (or to the company's Sales founders when the owner cannot act, or is the person who asked): migration 20270113000200_ops_question_notice.sql.
 * The notice is cleared by the database when Sales answers or Operations withdraws the question, and by the person when they dismiss it. Pure: no database here.
 */

/** The notification type. It starts with "project_" so the existing Project notices read and "mark as read" work for it unchanged. */
export const OPS_QUESTION_TYPE = "project_ops_question";

/** The element on the enquiry's Operations planning panel that holds the question (Overview tab). */
export const OPS_QUESTION_ANCHOR = "ops-question";

/** The exact place to answer: the enquiry's Overview tab, at the question. */
export const opsQuestionHref = (opportunityId: string) => `/sales/opportunities/${opportunityId}?tab=overview#${OPS_QUESTION_ANCHOR}`;

export interface OpsQuestionNotice {
  /** The person's own unread notice (Dismiss marks it read). */
  noticeId: string;
  opportunityId: string;
  reference: string;
  /** The enquiry's title, when this person can still read the enquiry; otherwise the reference stands alone. */
  title: string | null;
  at: string;
}

/** "none": no Sales access. "error": the notices could not be read (said as that, never "no questions"). */
export type OpsQuestionCheck = { status: "none" } | { status: "error" } | { status: "ok"; rows: OpsQuestionNotice[] };

export const OPS_QUESTION_WHAT = "Operations asked a question";

/** One row per enquiry (the database keeps one unread notice per enquiry and person; this guards the list against any older duplicate), oldest first. */
export function opsQuestionRows(
  notices: readonly { id: string; payload: unknown; created_at: string }[],
  enquiries: ReadonlyMap<string, { reference: string; title: string }>,
): OpsQuestionNotice[] {
  const byOpp = new Map<string, OpsQuestionNotice>();
  for (const n of notices) {
    const p = (n.payload && typeof n.payload === "object" ? n.payload : {}) as Record<string, unknown>;
    const opportunityId = typeof p.opportunity_id === "string" ? p.opportunity_id : null;
    if (!opportunityId) continue;
    const known = enquiries.get(opportunityId);
    const row: OpsQuestionNotice = { noticeId: n.id, opportunityId, reference: known?.reference ?? (typeof p.reference === "string" ? p.reference : "An enquiry"), title: known?.title ?? null, at: n.created_at };
    const had = byOpp.get(opportunityId);
    if (!had || n.created_at > had.at) byOpp.set(opportunityId, row);
  }
  return [...byOpp.values()].sort((a, b) => a.at.localeCompare(b.at));
}
