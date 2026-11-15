import { crmStageLabel, crmStageStep, followUpTiming, isCrmActive, type ApprovalPolicy, type ApprovalState, type AvailabilityDisplay } from "@enginious-hr/domain";
import type { GuideFacts, GuideTab, HandoverGuide } from "@/lib/crm/enquiry-guide";

/**
 * The ONE main button at the top of an enquiry, and the blockers shown beside it. PURE: decided only from recorded facts (the same GuideFacts the guide's
 * sentences are built from), so the button and the words can never disagree. It grants nothing: each kind opens an existing form or tab, whose own rules and
 * the database decide what the person may do. Unit-tested in primary-action.test.ts.
 */
export type PrimaryKind = "complete_follow_up" | "add_next_action" | "resume" | "record_estimate_sent" | "move_stage" | "request_availability" | "log_first_response" | "handover" | "open_project" | "log_activity";

export interface PrimaryAction {
  kind: PrimaryKind;
  label: string;
  /** One short line: why this is the next thing to do. */
  why: string;
  /** For the kinds that open a tab. */
  tab?: GuideTab;
  /** For the kinds that open another page. */
  href?: string;
  /** move_stage: the stage it proposes. */
  stage?: string;
}

export interface MoveChoice { id: string; label: string; requirement: string | null }

export interface PrimaryFacts {
  opportunityId: string;
  guide: GuideFacts;
  /** The signed-in person may complete the next follow-up (its assignee, the enquiry's owner or a founder). */
  canActOnNext: boolean;
  availability: AvailabilityDisplay;
  /** The stage moves this person may make now, each with what the database still requires; null when they may not move it or the facts behind the requirements could not be read. */
  moves: readonly MoveChoice[] | null;
  /** Won only: the delivery handover's state (null while it is not won). */
  handover: HandoverGuide | null;
}

/** A stage the record has already reached in fact: a proposal recorded as sent, or a Zoho Books quote reference, while the stage is still behind it. */
function stageBehindTheRecord(f: PrimaryFacts): MoveChoice | null {
  const { guide } = f;
  const here = crmStageStep(guide.stage);
  if (here === null || !f.moves) return null;
  // An estimate recorded as sent proposes no stage: it is a fact about one estimate revision, and neither a sent proposal nor a Zoho Books quote reference.
  const reached = [guide.quoteRef !== "unknown" && guide.quoteRef ? "quote_sent" : null, guide.sentProposal !== "unknown" && guide.sentProposal ? "proposal_sent" : null];
  for (const id of reached) {
    if (!id) continue;
    const move = f.moves.find((m) => m.id === id);
    if (move && !move.requirement && (crmStageStep(id) ?? 0) > here) return move;
  }
  return null;
}

export function primaryAction(f: PrimaryFacts, now: Date = new Date()): PrimaryAction | null {
  const { guide } = f;
  const base = `/sales/opportunities/${f.opportunityId}`;
  if (guide.stage === "lost") return null;
  if (guide.stage === "won") {
    const h = f.handover;
    if (!h) return null;
    if (h.project) return { kind: "open_project", label: `Open project ${h.project.reference}`, why: "The delivery project exists.", href: `/projects/${h.project.id}` };
    return h.action ? { kind: "handover", label: h.action.label, why: h.state, href: `${base}/handover` } : null;
  }
  // Nothing is proposed about follow-ups that could not be read.
  if (guide.followUps.failed) return null;
  if (guide.stage === "on_hold") return guide.canEdit ? { kind: "resume", label: "Resume", why: "It is on hold. Resuming asks for the next action." } : null;
  if (!isCrmActive(guide.stage)) return null;

  const next = guide.followUps.next;
  if (!next) return { kind: "add_next_action", label: "Add next action", why: "No next action is recorded." };
  const timing = followUpTiming(next.dueAt, now);
  if (timing !== "upcoming" && f.canActOnNext) return { kind: "complete_follow_up", label: "Complete follow-up", why: timing === "overdue" ? "The next action is overdue." : "The next action is due today." };
  if (guide.canEdit && guide.estimates !== "unknown" && guide.estimates.finalisedUnsent > 0) {
    return { kind: "record_estimate_sent", label: "Record estimate as sent", why: "A finalised estimate is not recorded as sent.", tab: "quotations" };
  }
  const behind = guide.canEdit ? stageBehindTheRecord(f) : null;
  if (behind) return { kind: "move_stage", label: `Move to ${behind.label}`, why: `${behind.id === "quote_sent" ? "A Zoho Books quote reference" : "A proposal recorded as sent"} is on record, and the stage is still ${crmStageLabel(guide.stage)}.`, stage: behind.id };
  if (guide.canEdit && f.availability === "needs_recheck") return { kind: "request_availability", label: "Request availability check", why: "The dates, quantities or equipment changed after the last check.", tab: "commercial" };
  if (!guide.firstResponseAt) return { kind: "log_first_response", label: "Log first response", why: "No first response is recorded yet.", tab: "activity" };
  if (f.canActOnNext) return { kind: "complete_follow_up", label: "Complete follow-up", why: "The next action is planned." };
  return { kind: "log_activity", label: "Log activity", why: "The next action is with its assignee.", tab: "activity" };
}

export interface Blocker { tone: "red" | "amber" | "neutral"; text: string; tab?: GuideTab; linkLabel?: string }

const d = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "not recorded");

/** What stands in the way right now, in words, each beside where it is resolved. Recorded facts only; a fact that could not be read is not turned into a blocker. */
export function summaryBlockers(f: {
  guide: GuideFacts; availability: AvailabilityDisplay; policy: ApprovalPolicy; latestApproval: ApprovalState | null | "unknown"; ownerName: string;
}): Blocker[] {
  const { guide } = f;
  const out: Blocker[] = [];
  if (guide.stage === "won" || guide.stage === "lost") return out;
  if (guide.stage === "on_hold") {
    const passed = !!guide.holdReviewDate && guide.holdReviewDate <= guide.today;
    out.push({ tone: "amber", text: `On hold. Reason: ${guide.holdReason ?? "not recorded"}. Review date ${d(guide.holdReviewDate)}${passed ? " (the date has arrived: decide whether to resume or close it)" : ""}.` });
  }
  if (f.availability === "needs_recheck") out.push({ tone: "amber", text: "Availability must be checked again: the dates, quantities or equipment changed after the last check.", tab: "commercial", linkLabel: "Open Commercial" });
  else if (f.availability === "unavailable") out.push({ tone: "red", text: "Equipment was recorded as not available for these dates and quantities.", tab: "commercial", linkLabel: "Open Commercial" });
  if (f.policy === "required" && f.latestApproval === "changes_requested") out.push({ tone: "amber", text: "A founder asked for changes before approving.", tab: "commercial", linkLabel: "See what was asked" });
  if (!guide.canEdit) out.push({ tone: "neutral", text: `Only the owner (${f.ownerName}) or a founder can change the stage, edit the details or close this enquiry. You can add notes, files and follow-ups.` });
  return out;
}
