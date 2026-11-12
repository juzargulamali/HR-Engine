/**
 * The "Handover" family of attention rows for Sales (My Day and Follow-ups): what the Sales owner or preparer must act on or know about the
 * single Sales-to-Projects handover. Pure, no database and no clock of its own, so every rule is unit-tested. The handover process itself is unchanged.
 *
 *   won_no_handover     a won enquiry the person owns whose handover has not been submitted (none yet, or still a draft) - from the moment of the win;
 *                       Sales founders also see it for other owners' enquiries once the win is older than FOUNDER_REMINDER_DAYS.
 *   handover_question   the Project Manager asked a question (status clarification_requested): for the owner and the preparer, until it is resubmitted.
 *   handover_accepted   the Project Manager accepted it: for the owner and the preparer, for ACCEPTED_NOTICE_DAYS days or until that person dismisses it.
 *                       It is news, not an action. Dismissing is per person: it marks that person's own "handover accepted" notice as read (the notice the
 *                       acceptance already sends them), so it holds on every device and changes nothing for the other person or on the handover.
 *                       Someone who accepted the handover themselves is not told their own news.
 */
export type HandoverRowKind = "won_no_handover" | "handover_question" | "handover_accepted";

export interface HandoverRow {
  kind: HandoverRowKind;
  opportunityId: string;
  reference: string;
  title: string;
  /** Plain words shown under the title. */
  detail: string;
  /** The row concerns the person's own enquiry ("mine") or, for a Sales founder, someone else's in their company ("company"). */
  scope: "mine" | "company";
  /** When it began (win, question or acceptance), for ordering. */
  at: string | null;
  /** Only on "handover_accepted": the person's own unread notice, which Dismiss marks as read. Absent when there is none to mark (the row then only expires). */
  noticeId?: string;
}

/** A Sales founder is shown a won enquiry that is still without a submitted handover after this many days (a fixed default: no settings screen). */
export const FOUNDER_REMINDER_DAYS = 2;
/** Nobody is asked about a win older than this, so wins recorded long before the handover existed do not keep asking. */
export const WON_LOOKBACK_DAYS = 90;
/** "Handover accepted" is shown for this many days. */
export const ACCEPTED_NOTICE_DAYS = 7;
/** Statuses from which the handover is in delivery's hands (submitted or later): the Sales side has nothing left to prepare. */
export const SUBMITTED_OR_LATER = new Set(["submitted", "pm_assigned", "clarification_requested", "accepted"]);

export const HANDOVER_KIND_LABEL: Record<HandoverRowKind, string> = {
  won_no_handover: "Won, handover not submitted",
  handover_question: "Handover: the PM asked a question",
  handover_accepted: "Handover accepted",
};

export interface WonOpportunity { id: string; reference: string; title: string; ownerId: string; companyId: string; wonAt: string }
export interface OwnHandover {
  crmOpportunityId: string; reference: string; title: string; status: string; clarificationNote: string | null; acceptedAt: string | null; updatedAt: string;
  /** Who accepted it (absent on older callers). */
  acceptedBy?: string | null;
  /**
   * The person's own "handover accepted" notice for this handover: "unread" with its id (Dismiss marks it read), "read" when they dismissed it or read it in
   * Project notices, or absent when there is no such notice.
   */
  notice?: { state: "unread"; id: string } | { state: "read" };
}

const DAY_MS = 86_400_000;
const ageDays = (iso: string, now: Date) => Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);

/**
 * `own` is the person's own handovers (they are owner or preparer); `wonOpportunities` the won enquiries they can see. `founderStatus` holds, for
 * other owners' won enquiries in a company where the person is a Sales founder, the handover status read from the database (null = no handover yet).
 */
export function handoverRows(input: {
  userId: string;
  wonOpportunities: readonly WonOpportunity[];
  own: readonly OwnHandover[];
  founderCompanies: ReadonlySet<string>;
  founderStatus: ReadonlyMap<string, string | null>;
  now?: Date;
}): HandoverRow[] {
  const now = input.now ?? new Date();
  const out: HandoverRow[] = [];
  const ownByOpp = new Map(input.own.map((h) => [h.crmOpportunityId, h]));

  for (const h of input.own) {
    if (h.status === "clarification_requested") {
      out.push({ kind: "handover_question", opportunityId: h.crmOpportunityId, reference: h.reference, title: h.title, detail: h.clarificationNote ? `The Project Manager asked: ${h.clarificationNote}` : "The Project Manager asked a question. Update the brief if needed, then resubmit.", scope: "mine", at: h.updatedAt });
    } else if (h.status === "accepted" && h.acceptedAt && ageDays(h.acceptedAt, now) < ACCEPTED_NOTICE_DAYS) {
      if (h.notice?.state === "read" || (h.acceptedBy && h.acceptedBy === input.userId)) continue;
      out.push({ kind: "handover_accepted", opportunityId: h.crmOpportunityId, reference: h.reference, title: h.title, detail: "The Project Manager accepted it. The project exists.", scope: "mine", at: h.acceptedAt, ...(h.notice?.state === "unread" ? { noticeId: h.notice.id } : {}) });
    }
  }

  for (const o of input.wonOpportunities) {
    if (ageDays(o.wonAt, now) > WON_LOOKBACK_DAYS) continue;
    if (o.ownerId === input.userId) {
      const h = ownByOpp.get(o.id);
      if (h && SUBMITTED_OR_LATER.has(h.status)) continue;
      out.push({ kind: "won_no_handover", opportunityId: o.id, reference: o.reference, title: o.title, detail: "Won. Prepare the handover so delivery can start; nobody in delivery is told until you submit it.", scope: "mine", at: o.wonAt });
    } else if (input.founderCompanies.has(o.companyId) && input.founderStatus.has(o.id)) {
      const status = input.founderStatus.get(o.id) ?? null;
      if (status && SUBMITTED_OR_LATER.has(status)) continue;
      const days = ageDays(o.wonAt, now);
      if (days < FOUNDER_REMINDER_DAYS) continue;
      out.push({ kind: "won_no_handover", opportunityId: o.id, reference: o.reference, title: o.title, detail: `Won ${days} days ago and the owner has not submitted the handover.`, scope: "company", at: o.wonAt });
    }
  }
  const rank: Record<HandoverRowKind, number> = { handover_question: 0, won_no_handover: 1, handover_accepted: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.at ?? "").localeCompare(b.at ?? ""));
}

/** Won enquiries a Sales founder should have checked: other owners', in the founder's companies, won long enough ago and not too long ago. */
export function founderCandidates(
  input: { userId: string; wonOpportunities: readonly WonOpportunity[]; founderCompanies: ReadonlySet<string>; now?: Date },
): WonOpportunity[] {
  const now = input.now ?? new Date();
  return input.wonOpportunities.filter((o) => {
    if (o.ownerId === input.userId || !input.founderCompanies.has(o.companyId)) return false;
    const days = ageDays(o.wonAt, now);
    return days >= FOUNDER_REMINDER_DAYS && days <= WON_LOOKBACK_DAYS;
  });
}
