import { describe, expect, it } from "vitest";
import { CRM_PIPELINE_STAGES, CRM_STAGES, crmAllowedMoves, crmStageLabel, isCrmActive, isCrmClosed } from "../src";

describe("CRM stages", () => {
  it("has stable ids and labels", () => {
    expect(CRM_STAGES.map((s) => s.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(crmStageLabel("proposal_prep")).toBe("Proposal preparation");
    expect(crmStageLabel("mystery")).toBe("mystery");
  });
  it("allows one step back or any step forward, never to the same stage", () => {
    expect(crmAllowedMoves("new")).toEqual(["qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("proposal_sent")).toEqual(["proposal_prep", "quote_sent", "negotiation"]);
    expect(crmAllowedMoves("negotiation")).toEqual(["quote_sent"]);
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
