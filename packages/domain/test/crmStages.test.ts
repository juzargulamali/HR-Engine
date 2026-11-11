import { describe, expect, it } from "vitest";
import { canAdvanceToEstimateSent, CRM_PIPELINE_STAGES, CRM_STAGES, crmAllowedMoves, crmStageLabel, crmStageStep, isCrmActive, isCrmClosed } from "../src";

describe("CRM stages", () => {
  it("has stable ids and labels", () => {
    expect(CRM_STAGES.map((s) => s.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(crmStageLabel("estimate_sent")).toBe("Estimate sent");
    expect(crmStageLabel("proposal_prep")).toBe("Proposal preparation");
    expect(crmStageLabel("mystery")).toBe("mystery");
  });
  it("allows one step back or any step forward, never to the same stage", () => {
    expect(crmAllowedMoves("new")).toEqual(["qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("negotiation")).toEqual(["quote_sent"]);
  });
  it("treats Proposal sent and Estimate sent as alternative milestones at the same step", () => {
    expect(crmStageStep("proposal_sent")).toBe(4);
    expect(crmStageStep("estimate_sent")).toBe(4);
    expect([crmStageStep("new"), crmStageStep("qualified"), crmStageStep("proposal_prep"), crmStageStep("quote_sent"), crmStageStep("negotiation")]).toEqual([1, 2, 3, 5, 6]);
    for (const s of ["on_hold", "won", "lost", "mystery"]) expect(crmStageStep(s)).toBeNull();
    // Estimate sent is reachable directly from Qualified and from Proposal preparation (and from New, as any forward step is).
    for (const from of ["new", "qualified", "proposal_prep"]) expect(crmAllowedMoves(from)).toContain("estimate_sent");
    // Across, either way; one step back from each is Proposal preparation; Quote sent steps back to either.
    expect(crmAllowedMoves("proposal_sent")).toEqual(["proposal_prep", "estimate_sent", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("estimate_sent")).toEqual(["proposal_prep", "proposal_sent", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("quote_sent")).toEqual(["proposal_sent", "estimate_sent", "negotiation"]);
    // Negotiation steps back one step only (Quote sent): never to either "sent" milestone.
    expect(crmAllowedMoves("negotiation")).not.toContain("estimate_sent");
    expect(isCrmActive("estimate_sent")).toBe(true);
  });
  it("offers the move to Estimate sent only when it is not a step backwards", () => {
    for (const s of ["new", "qualified", "proposal_prep", "proposal_sent"]) expect(canAdvanceToEstimateSent(s), s).toBe(true);
    for (const s of ["estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]) expect(canAdvanceToEstimateSent(s), s).toBe(false);
  });
  it("never offers plain moves from on hold, won or lost, nor to them", () => {
    for (const s of ["on_hold", "won", "lost"]) expect(crmAllowedMoves(s)).toEqual([]);
    for (const s of CRM_PIPELINE_STAGES) expect(crmAllowedMoves(s)).not.toEqual(expect.arrayContaining(["won"]));
  });
  it("classifies active, open and closed", () => {
    expect(isCrmActive("new")).toBe(true);
    expect(isCrmActive("on_hold")).toBe(false);
    expect(isCrmClosed("won")).toBe(true);
    expect(isCrmClosed("on_hold")).toBe(false);
  });
});
