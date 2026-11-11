import { crmStageLabel, followUpTiming, isCrmActive } from "@enginious-hr/domain";

/**
 * What the top of an enquiry says: where it stands, the next action, and what moves it forward. PURE and built ONLY from recorded facts: it never infers a
 * client reply, a document being sent or an action nobody recorded. It grants nothing: every link leads to an existing screen whose own rules (and the
 * database's) decide what the person may do. Unit-tested in enquiry-guide.test.ts.
 */
export type GuideTone = "red" | "amber" | "blue" | "green" | "neutral";
export type GuideTab = "overview" | "scope" | "activity" | "proposals" | "quotations" | "commercial";
export interface GuideLink { label: string; tab?: GuideTab; href?: string; primary?: boolean }

export interface GuideFacts {
  stage: string;
  stageBeforeHold: string | null;
  holdReason: string | null;
  holdReviewDate: string | null;
  lostReason: string | null;
  waitingOn: "client" | "internal" | null;
  firstResponseAt: string | null;
  /** The next open follow-up; `failed` = the follow-ups could not be read (nothing is then claimed about them). */
  followUps: { failed: true } | { failed: false; next: { title: string; dueAt: string; assigneeName: string } | null };
  /** Evidence for the "sent" stages; `unknown` = its read failed. */
  sentProposal: { version: number; sentOn: string | null } | null | "unknown";
  sentEstimate: { reference: string; revision: number; sentOn: string } | null | "unknown";
  quoteRef: { ref: string; sentOn: string | null } | null | "unknown";
  /** Estimates of this enquiry: how many are finalised (not replaced) and not yet recorded as sent, and how many are still drafts. */
  estimates: { finalisedUnsent: number; drafts: number } | "unknown";
  /** Owner or founder: may move the stage, edit, record sends. */
  canEdit: boolean;
  today: string;
}

export interface NextAction { tone: GuideTone; label: string; title: string; detail: string | null; missing: boolean }
export interface StageGuide { tone: GuideTone; headline: string; lines: string[]; links: GuideLink[] }

const d = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date not recorded");

/** The next action: the real open follow-up (who and when), or plainly that none is recorded. */
export function nextAction(f: GuideFacts, now: Date = new Date()): NextAction {
  if (f.stage === "won" || f.stage === "lost") return { tone: "neutral", label: "Closed", title: "No next action: the enquiry is closed", detail: null, missing: false };
  if (f.followUps.failed) return { tone: "red", label: "Could not load", title: "The follow-ups could not be loaded", detail: "Nothing is said about the next action until they load. Reload the page.", missing: false };
  const next = f.followUps.next;
  if (!next) {
    if (f.stage === "on_hold") return { tone: "neutral", label: "On hold", title: "No next action while on hold", detail: f.holdReviewDate ? `Review date ${d(f.holdReviewDate)}.` : null, missing: false };
    return { tone: "amber", label: "No next action", title: "No next action is recorded", detail: "Every active enquiry needs one, so it is not forgotten.", missing: true };
  }
  const timing = followUpTiming(next.dueAt, now);
  return {
    tone: timing === "overdue" ? "red" : timing === "due_today" ? "amber" : "blue",
    label: timing === "overdue" ? "Overdue" : timing === "due_today" ? "Due today" : "Planned",
    title: next.title, detail: next.assigneeName, missing: false,
  };
}

const sentLines = (f: GuideFacts): string[] => {
  const out: string[] = [];
  if (f.sentEstimate === "unknown") out.push("Could not load which estimates were recorded as sent.");
  else if (f.sentEstimate) out.push(`Estimate ${f.sentEstimate.reference}, revision ${f.sentEstimate.revision}, recorded as sent on ${d(f.sentEstimate.sentOn)}.`);
  if (f.sentProposal === "unknown") out.push("Could not load the proposal versions.");
  else if (f.sentProposal) out.push(`Proposal version ${f.sentProposal.version} recorded as sent on ${d(f.sentProposal.sentOn)}.`);
  if (f.quoteRef === "unknown") out.push("Could not load the Zoho Books references.");
  else if (f.quoteRef) out.push(`Zoho Books quote ${f.quoteRef.ref}${f.quoteRef.sentOn ? ` sent on ${d(f.quoteRef.sentOn)}` : ""}.`);
  return out;
};
const waiting = (f: GuideFacts): string | null => (f.waitingOn === "client" ? "Recorded as waiting on the client." : f.waitingOn === "internal" ? "Recorded as waiting on our own team." : null);

/** Where it stands and what moves it forward, for the current stage. */
export function stageGuide(f: GuideFacts): StageGuide {
  const lines: string[] = [];
  const links: GuideLink[] = [];
  const w = waiting(f);
  if (f.stage === "lost") return { tone: "neutral", headline: "Lost", lines: [f.lostReason ? `Reason recorded: ${f.lostReason}.` : "No reason is recorded.", "It is read-only until a founder reopens it."], links: [{ label: "See the history", tab: "activity" }] };
  if (f.stage === "on_hold") {
    const passed = !!f.holdReviewDate && f.holdReviewDate <= f.today;
    return {
      tone: passed ? "amber" : "neutral", headline: passed ? "On hold: the review date has arrived" : "On hold",
      lines: [`Reason recorded: ${f.holdReason ?? "none"}.`, `Review date ${d(f.holdReviewDate)}. Resuming returns it to ${f.stageBeforeHold ? crmStageLabel(f.stageBeforeHold) : "its earlier stage"}.`, ...(f.canEdit ? [] : ["Only the owner or a founder can resume or close it."])],
      links: [{ label: "See the history", tab: "activity" }],
    };
  }
  if (f.stage === "won") return { tone: "green", headline: "Won", lines: ["The handover to delivery is shown beside this."], links: [] };
  if (!isCrmActive(f.stage)) return { tone: "neutral", headline: crmStageLabel(f.stage), lines: [], links: [] };

  // First response: only its absence is stated, and only how to record it.
  if (!f.firstResponseAt) {
    lines.push("No first response is recorded yet. Logging the first call, email or meeting records it.");
    links.push({ label: "Log the first response", tab: "activity", primary: f.stage === "new" });
  }
  const est = f.estimates;
  const hasEstimateToRecord = est !== "unknown" && est.finalisedUnsent > 0;
  const estimateHint = () => {
    if (est === "unknown") lines.push("Could not load the estimates.");
    else if (est.finalisedUnsent > 0) lines.push(`${est.finalisedUnsent === 1 ? "A finalised estimate is" : `${est.finalisedUnsent} finalised estimates are`} not recorded as sent. After you send it to the client, record it on the Estimates tab.`);
    else if (est.drafts > 0) lines.push(`${est.drafts === 1 ? "A draft estimate is" : `${est.drafts} draft estimates are`} not finalised yet.`);
  };

  switch (f.stage) {
    case "new":
    case "qualified":
    case "proposal_prep": {
      const sent = sentLines(f);
      lines.push(...sent);
      estimateHint();
      if (sent.length === 0 && (est === "unknown" || (est.finalisedUnsent === 0 && est.drafts === 0))) lines.push("Nothing is recorded as sent yet. If the client asked for a price, build an estimate; if they asked for a proposal, add it under Proposals & files.");
      links.push({ label: hasEstimateToRecord ? "Record estimate as sent" : "Estimates", tab: "quotations", primary: hasEstimateToRecord }, { label: "Proposals & files", tab: "proposals" });
      if (w) lines.push(w);
      return { tone: hasEstimateToRecord ? "amber" : "blue", headline: f.stage === "new" ? "New enquiry: qualify it and respond" : f.stage === "qualified" ? "Qualified: prepare what the client asked for" : "Preparing the proposal or estimate", lines, links };
    }
    case "proposal_sent":
    case "estimate_sent":
    case "quote_sent":
    case "negotiation": {
      const sent = sentLines(f);
      lines.push(...(sent.length ? sent : ["Nothing is recorded as sent for this enquiry."]));
      estimateHint();
      lines.push(w ?? "No client reply is assumed: log it under Activity when it arrives.");
      if (f.stage === "proposal_sent" || f.stage === "estimate_sent") lines.push("Quote sent needs the Zoho Books quote reference (Commercial tab).");
      links.push({ label: "Log the client's reply", tab: "activity" }, { label: hasEstimateToRecord ? "Record estimate as sent" : "Estimates", tab: "quotations", primary: hasEstimateToRecord }, { label: "Commercial", tab: "commercial" });
      return { tone: hasEstimateToRecord ? "amber" : "blue", headline: f.stage === "negotiation" ? "Negotiation" : `${crmStageLabel(f.stage)}: awaiting the client`, lines, links };
    }
  }
  return { tone: "neutral", headline: crmStageLabel(f.stage), lines, links };
}

// ---------------------------------------------------------------------------------------------------------------
// Won: the handover to delivery
// ---------------------------------------------------------------------------------------------------------------

export type HandoverRead =
  | { status: "none" }                    // Projects is not installed here
  | { status: "error" }                   // the read failed
  | { status: "ok"; handover: { status: string; pmName: string | null; projectId: string | null; projectReference: string | null; clarificationNote: string | null } | null };

export interface HandoverGuide { tone: GuideTone; state: string; nextOwner: string | null; lines: string[]; action: { label: string; primary: boolean } | null; project: { id: string; reference: string } | null }

/**
 * The state of the single Sales-to-Projects handover of a WON enquiry and who acts next. The project's reference is present only when the database decided this
 * person may see the project's summary (proj_handover_for_opportunity); without it the project is said to exist and nothing else about it is shown.
 */
export function handoverGuide(read: HandoverRead, who: { ownerName: string; canEdit: boolean }): HandoverGuide {
  const none = { nextOwner: null, action: null, project: null };
  if (read.status === "none") return { ...none, tone: "neutral", state: "Handover not available", lines: ["Projects & Tasks is not set up here, so there is no delivery handover to track."] };
  if (read.status === "error") return { ...none, tone: "red", state: "Could not check the handover", lines: ["Its state is not known right now. Open the handover package or reload."], action: { label: "Open the handover package", primary: false } };
  const h = read.handover;
  const pm = h?.pmName && h.pmName !== "—" ? h.pmName : null;
  if (!h || h.status === "draft") {
    return {
      ...none, tone: "amber", state: "Handover needed", nextOwner: who.ownerName,
      lines: [h ? "A handover draft exists but is not submitted." : "No handover is open for this enquiry (none was started, or an earlier one was withdrawn).", "Nobody in delivery is told until it is submitted."],
      action: who.canEdit ? { label: h ? "Continue the handover" : "Prepare the handover", primary: true } : { label: "See the handover package", primary: false },
    };
  }
  if (h.status === "submitted") return { ...none, tone: "blue", state: "Waiting for PM assignment", nextOwner: "A Projects founder", lines: ["Submitted to delivery. A Projects founder assigns the Project Manager."], action: { label: "See the handover package", primary: false } };
  if (h.status === "pm_assigned") return { ...none, tone: "blue", state: "Waiting for PM acceptance", nextOwner: pm ?? "The Project Manager", lines: [`${pm ?? "The Project Manager"} has it and accepts it to create the project.`], action: { label: "See the handover package", primary: false } };
  if (h.status === "clarification_requested") {
    return {
      ...none, tone: "amber", state: "PM asked a question", nextOwner: who.ownerName,
      lines: [h.clarificationNote ? `${pm ?? "The Project Manager"} asked: ${h.clarificationNote}` : `${pm ?? "The Project Manager"} asked a question.`, "Answer it in the handover and resubmit."],
      action: { label: who.canEdit ? "Answer and resubmit" : "See the question", primary: who.canEdit },
    };
  }
  if (h.status === "accepted") {
    const project = h.projectId && h.projectReference ? { id: h.projectId, reference: h.projectReference } : null;
    return {
      tone: "green", state: "Project created", nextOwner: pm ?? "The Project Manager", project,
      lines: [project ? `${pm ?? "The Project Manager"} accepted the handover. The delivery project is ${project.reference}; its discussion and history are on the project's own tabs, for the people working on it.` : `${pm ?? "The Project Manager"} accepted the handover and the delivery project exists. You do not have access to the project itself.`],
      action: { label: "See the handover package", primary: false },
    };
  }
  return { ...none, tone: "neutral", state: "Handover", lines: [`Its recorded state is "${h.status}".`], action: { label: "Open the handover package", primary: false } };
}
