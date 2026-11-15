import { describe, expect, it } from "vitest";
import { CRM_PIPELINE_STAGES, CRM_RETIRED_STAGES, CRM_STAGE_IDS, CRM_STAGES, CRM_WORKING_STAGE_IDS, crmAllowedMoves, crmStageLabel, crmStageStep, isCrmActive, isCrmClosed, isCrmRetiredStage } from "../src";

describe("CRM stages", () => {
  it("has stable ids and labels", () => {
    expect(CRM_STAGES.map((s) => s.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(crmStageLabel("proposal_prep")).toBe("Proposal preparation");
    expect(crmStageLabel("mystery")).toBe("mystery");
  });
  it("allows one step back or any step forward, never to the same stage", () => {
    expect(crmAllowedMoves("new")).toEqual(["qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("proposal_sent")).toEqual(["proposal_prep", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("quote_sent")).toEqual(["proposal_sent", "negotiation"]);
    expect(crmAllowedMoves("negotiation")).toEqual(["quote_sent"]);
    expect([crmStageStep("new"), crmStageStep("qualified"), crmStageStep("proposal_prep"), crmStageStep("proposal_sent"), crmStageStep("quote_sent"), crmStageStep("negotiation")]).toEqual([1, 2, 3, 4, 5, 6]);
    for (const s of ["on_hold", "won", "lost", "mystery"]) expect(crmStageStep(s)).toBeNull();
  });
  it("Estimate sent is retired: never a target, never a lane or a filter, but still labelled, open and movable OUT", () => {
    expect(CRM_STAGE_IDS).toContain("estimate_sent");                       // the id stays valid: history and unmoved enquiries hold it
    expect(CRM_STAGES.map((s) => s.id)).not.toContain("estimate_sent");
    expect(CRM_PIPELINE_STAGES).not.toContain("estimate_sent");
    expect(CRM_RETIRED_STAGES.map((s) => s.id)).toEqual(["estimate_sent"]);
    expect(isCrmRetiredStage("estimate_sent")).toBe(true);
    expect(isCrmRetiredStage("proposal_sent")).toBe(false);
    expect(crmStageLabel("estimate_sent")).toBe("Estimate sent (stage no longer used)");
    for (const from of [...CRM_PIPELINE_STAGES, "estimate_sent"]) expect(crmAllowedMoves(from), from).not.toContain("estimate_sent");
    // An enquiry still holding it is not stranded: it keeps step 4, stays active (needs a next action) and can move one step back or forward.
    expect(crmStageStep("estimate_sent")).toBe(4);
    expect(isCrmActive("estimate_sent")).toBe(true);
    expect(crmAllowedMoves("estimate_sent")).toEqual(["proposal_prep", "proposal_sent", "quote_sent", "negotiation"]);
    expect(CRM_WORKING_STAGE_IDS).toEqual([...CRM_PIPELINE_STAGES, "estimate_sent"]);
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
