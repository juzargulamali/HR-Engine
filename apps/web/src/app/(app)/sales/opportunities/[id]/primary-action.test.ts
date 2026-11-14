import { describe, expect, it } from "vitest";
import type { GuideFacts, HandoverGuide } from "@/lib/crm/enquiry-guide";
import { primaryAction, summaryBlockers, type PrimaryFacts } from "./primary-action";

// Fictional data only.
const NOW = new Date("2026-11-11T08:00:00Z");
const guide: GuideFacts = {
  stage: "qualified", stageBeforeHold: null, holdReason: null, holdReviewDate: null, lostReason: null, waitingOn: null, firstResponseAt: "2026-11-01T08:00:00Z",
  followUps: { failed: false, next: { title: "Call the client", dueAt: "2026-11-20T06:00:00Z", assigneeName: "Fictional Sami" } },
  sentProposal: null, sentEstimate: null, quoteRef: null, estimates: { finalisedUnsent: 0, drafts: 0 }, canEdit: true, today: "2026-11-11",
};
const moves = (...blocked: string[]) => ["new", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation"].map((id) => ({ id, label: { new: "New", proposal_prep: "Proposal prep", proposal_sent: "Proposal sent", estimate_sent: "Estimate sent", quote_sent: "Quote sent", negotiation: "Negotiation" }[id]!, requirement: blocked.includes(id) ? "needs something first" : null }));
const facts = (g: Partial<GuideFacts> = {}, o: Partial<PrimaryFacts> = {}): PrimaryFacts => ({ opportunityId: "o1", guide: { ...guide, ...g }, canActOnNext: true, availability: "unverified", moves: moves("proposal_sent", "estimate_sent", "quote_sent"), handover: null, ...o });
const kind = (g: Partial<GuideFacts> = {}, o: Partial<PrimaryFacts> = {}) => primaryAction(facts(g, o), NOW)?.kind ?? null;
const overdue = { failed: false as const, next: { title: "Call", dueAt: "2026-11-05T06:00:00Z", assigneeName: "X" } };
const today = { failed: false as const, next: { title: "Call", dueAt: "2026-11-11T12:00:00Z", assigneeName: "X" } };

describe("the one main button, for each stage and blocker", () => {
  it("no next action on an active enquiry: Add next action, for anyone (in every working stage)", () => {
    for (const stage of ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation"]) {
      expect(primaryAction(facts({ stage, followUps: { failed: false, next: null } }, { canActOnNext: false }), NOW), stage).toMatchObject({ kind: "add_next_action", label: "Add next action" });
    }
  });
  it("an overdue or due-today follow-up comes first for someone who may complete it", () => {
    expect(primaryAction(facts({ followUps: overdue, estimates: { finalisedUnsent: 1, drafts: 0 } }), NOW)).toMatchObject({ kind: "complete_follow_up", label: "Complete follow-up", why: "The next action is overdue." });
    expect(primaryAction(facts({ followUps: today }), NOW)).toMatchObject({ kind: "complete_follow_up", why: "The next action is due today." });
    // Someone who may not complete it is not offered it; what they can do is log an update.
    expect(kind({ followUps: overdue, canEdit: false }, { canActOnNext: false })).toBe("log_activity");
  });
  it("a finalised estimate not recorded as sent: Record estimate as sent (owner or founder only), on the Estimates tab", () => {
    expect(primaryAction(facts({ estimates: { finalisedUnsent: 1, drafts: 0 } }), NOW)).toMatchObject({ kind: "record_estimate_sent", label: "Record estimate as sent", tab: "quotations" });
    expect(kind({ estimates: { finalisedUnsent: 1, drafts: 0 }, canEdit: false })).toBe("complete_follow_up");
    expect(kind({ estimates: "unknown" })).toBe("complete_follow_up");
  });
  it("the record is ahead of the stage: Move to that stage, only when the move is allowed and nothing is still required", () => {
    const sentProposal = { version: 2, sentOn: "2026-11-05" };
    expect(primaryAction(facts({ stage: "proposal_prep", sentProposal }, { moves: moves("estimate_sent", "quote_sent") }), NOW)).toMatchObject({ kind: "move_stage", label: "Move to Proposal sent", stage: "proposal_sent" });
    expect(primaryAction(facts({ stage: "estimate_sent", quoteRef: { ref: "QT-1001", sentOn: null } }, { moves: moves("proposal_sent") }), NOW)).toMatchObject({ kind: "move_stage", label: "Move to Quote sent", stage: "quote_sent" });
    // Already there or past it, still blocked, facts not loaded, or not the owner: not proposed.
    expect(kind({ stage: "proposal_sent", sentProposal }, { moves: moves() })).toBe("complete_follow_up");
    expect(kind({ stage: "negotiation", quoteRef: { ref: "QT-1001", sentOn: null } }, { moves: moves() })).toBe("complete_follow_up");
    expect(kind({ stage: "proposal_prep", sentProposal }, { moves: moves("proposal_sent") })).toBe("complete_follow_up");
    expect(kind({ stage: "proposal_prep", sentProposal }, { moves: null })).toBe("complete_follow_up");
    expect(kind({ stage: "proposal_prep", sentProposal, canEdit: false }, { moves: moves() })).toBe("complete_follow_up");
    // An estimate recorded as sent never proposes the move: its own form offers it.
    expect(kind({ stage: "qualified", sentEstimate: { reference: "EST-QA-2026-0001", revision: 1, sentOn: "2026-11-06" } }, { moves: moves() })).toBe("complete_follow_up");
  });
  it("availability that must be repeated: Request availability check on the Commercial tab, for the owner or a founder", () => {
    expect(primaryAction(facts({}, { availability: "needs_recheck" }), NOW)).toMatchObject({ kind: "request_availability", label: "Request availability check", tab: "commercial" });
    expect(kind({ canEdit: false }, { availability: "needs_recheck" })).toBe("complete_follow_up");
    expect(kind({}, { availability: "confirmed" })).toBe("complete_follow_up");
  });
  it("no first response recorded: Log first response; otherwise the planned follow-up, or Log activity for someone who may not complete it", () => {
    expect(primaryAction(facts({ stage: "new", firstResponseAt: null }), NOW)).toMatchObject({ kind: "log_first_response", tab: "activity" });
    expect(primaryAction(facts(), NOW)).toMatchObject({ kind: "complete_follow_up", why: "The next action is planned." });
    expect(primaryAction(facts({ canEdit: false }, { canActOnNext: false }), NOW)).toMatchObject({ kind: "log_activity", tab: "activity" });
  });
  it("on hold: Resume for the owner or a founder, nothing for anyone else", () => {
    expect(primaryAction(facts({ stage: "on_hold", followUps: { failed: false, next: null } }), NOW)).toMatchObject({ kind: "resume", label: "Resume" });
    expect(kind({ stage: "on_hold", canEdit: false, followUps: { failed: false, next: null } })).toBeNull();
  });
  it("follow-ups that could not be read: no button at all (nothing is known to be the next action)", () => {
    expect(kind({ followUps: { failed: true } })).toBeNull();
  });
  it("won: the handover's own action, or the project once it exists; lost: nothing", () => {
    const h = (o: Partial<HandoverGuide>): HandoverGuide => ({ tone: "amber", state: "Handover needed", nextOwner: "Fictional Fiona", lines: [], action: { label: "Prepare the handover", primary: true }, project: null, ...o });
    expect(primaryAction(facts({ stage: "won" }, { handover: h({}) }), NOW)).toMatchObject({ kind: "handover", label: "Prepare the handover", href: "/sales/opportunities/o1/handover" });
    expect(primaryAction(facts({ stage: "won" }, { handover: h({ state: "Project created", project: { id: "p1", reference: "PRJ-QA-2026-0003" } }) }), NOW)).toMatchObject({ kind: "open_project", label: "Open project PRJ-QA-2026-0003", href: "/projects/p1" });
    expect(kind({ stage: "won" }, { handover: h({ action: null }) })).toBeNull();
    expect(kind({ stage: "won" })).toBeNull();
    expect(kind({ stage: "lost" })).toBeNull();
  });
});

describe("blockers shown in the summary", () => {
  const b = (g: Partial<GuideFacts> = {}, o: Partial<Parameters<typeof summaryBlockers>[0]> = {}) => summaryBlockers({ guide: { ...guide, ...g }, availability: "unverified", policy: "not_configured", latestApproval: null, ownerName: "Fictional Fiona", ...o });
  it("none when nothing stands in the way, and none on a closed enquiry", () => {
    expect(b()).toEqual([]);
    expect(b({ stage: "won" }, { availability: "needs_recheck" })).toEqual([]);
    expect(b({ stage: "lost", canEdit: false })).toEqual([]);
  });
  it("a hold says its reason and review date, and when the date has arrived", () => {
    expect(b({ stage: "on_hold", holdReason: "Client postponed event", holdReviewDate: "2026-12-01" })[0]).toMatchObject({ tone: "amber", text: "On hold. Reason: Client postponed event. Review date 1 Dec 2026." });
    expect(b({ stage: "on_hold", holdReason: "Client postponed event", holdReviewDate: "2026-11-10" })[0]!.text).toMatch(/the date has arrived/);
  });
  it("availability to repeat (amber) or not available (red) points to Commercial; a founder's requested changes are named", () => {
    expect(b({}, { availability: "needs_recheck" })[0]).toMatchObject({ tone: "amber", tab: "commercial" });
    expect(b({}, { availability: "unavailable" })[0]).toMatchObject({ tone: "red", tab: "commercial" });
    expect(b({}, { policy: "required", latestApproval: "changes_requested" })[0]).toMatchObject({ tone: "amber", tab: "commercial" });
    expect(b({}, { policy: "required", latestApproval: "unknown" })).toEqual([]);
    expect(b({}, { policy: "not_required", latestApproval: "changes_requested" })).toEqual([]);
  });
  it("someone who is not the owner or a founder is told what they can and cannot do", () => {
    expect(b({ canEdit: false })[0]).toMatchObject({ tone: "neutral", text: expect.stringContaining("Only the owner (Fictional Fiona) or a founder") });
  });
});
