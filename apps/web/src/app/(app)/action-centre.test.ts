import { describe, expect, it } from "vitest";
import { attentionSentence, buildActionItems, commercialApprovalItems, handoverItems } from "./action-centre";
import { splitActions } from "@/lib/my-day/groups";
import type { HandoverRow } from "@/lib/crm/handover-attention";

describe("My Day action centre when the approvals count could not be loaded", () => {
  it("keeps an error row instead of dropping the zero, and never says nothing needs attention", () => {
    const items = buildActionItems({ myPendingApprovals: "error" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "approvals", error: true, label: "Approvals could not be loaded" });
    const sentence = attentionSentence(items);
    expect(sentence).not.toMatch(/Nothing needs your attention/);
    expect(sentence).toMatch(/could not be loaded/);
  });
  it("still counts the items that did load next to the failed one", () => {
    const items = buildActionItems({ myPendingApprovals: "error", contractsEndingCount: 2 });
    expect(attentionSentence(items)).toMatch(/2 items need your attention/);
    expect(attentionSentence(items)).toMatch(/Approvals could not be loaded/);
  });
  it("a real zero is still dropped, and a healthy list is unchanged", () => {
    expect(buildActionItems({ myPendingApprovals: 0 })).toEqual([]);
    expect(attentionSentence([])).toBe("Nothing needs your attention right now.");
    expect(attentionSentence(buildActionItems({ myPendingApprovals: 3 }))).toBe("Your updates for today: 3 items need your attention.");
  });
});

describe("My Day handover rows (A9, A10)", () => {
  const row = (kind: HandoverRow["kind"], id: string): HandoverRow => ({ kind, opportunityId: id, reference: `R-${id}`, title: `Job ${id}`, detail: "", scope: "mine", at: null });
  it("one row per kind with a count; a single enquiry links to its handover page, several to Follow-ups", () => {
    const items = handoverItems({ status: "ok", rows: [row("handover_question", "a"), row("won_no_handover", "b"), row("won_no_handover", "c"), row("handover_accepted", "d")] });
    expect(items.map((i) => [i.key, i.count, i.href])).toEqual([
      ["handover-question", 1, "/sales/opportunities/a/handover"],
      ["handover-won", 2, "/sales/follow-ups"],
      ["handover-accepted", 1, "/sales/opportunities/d/handover"],
    ]);
  });
  it("what needs an answer or an action is in 'needs your decision'; the accepted notice is 'also open'", () => {
    const g = splitActions(handoverItems({ status: "ok", rows: [row("handover_question", "a"), row("won_no_handover", "b"), row("handover_accepted", "d")] }));
    expect(g.decision.map((i) => i.key)).toEqual(["handover-question", "handover-won"]);
    expect(g.other.map((i) => i.key)).toEqual(["handover-accepted"]);
  });
  it("a failed read is an error row, 'Could not check handovers', and it counts in the decisions list", () => {
    const items = handoverItems({ status: "error" });
    expect(items).toEqual([expect.objectContaining({ key: "handover-check", label: "Could not check handovers", error: true })]);
    expect(buildActionItems({ myPendingApprovals: 0, extraItems: items })).toHaveLength(1);
    expect(splitActions(items).decision).toHaveLength(1);
    expect(attentionSentence(buildActionItems({ myPendingApprovals: 0, extraItems: items }))).toMatch(/Could not check handovers/);
  });
  it("nothing to show when there are no rows or Projects is not installed", () => {
    expect(handoverItems({ status: "ok", rows: [] })).toEqual([]);
    expect(handoverItems({ status: "none" })).toEqual([]);
  });
});

describe("My Day commercial approval row (U-01)", () => {
  it("one request links to that enquiry's Commercial tab; several say so and link to the oldest", () => {
    expect(commercialApprovalItems({ status: "ok", count: 1, oldestOpportunityId: "o1" })).toEqual([expect.objectContaining({ key: "approval-commercial", count: 1, label: "Commercial approval waiting for your decision", href: "/sales/opportunities/o1?tab=commercial" })]);
    expect(commercialApprovalItems({ status: "ok", count: 3, oldestOpportunityId: "o1" })[0]).toMatchObject({ count: 3, label: "Commercial approvals waiting for your decision" });
  });
  it("belongs with the decisions", () => {
    expect(splitActions(commercialApprovalItems({ status: "ok", count: 1, oldestOpportunityId: "o1" })).decision).toHaveLength(1);
    expect(splitActions([{ key: "proj-scope", count: 1 }]).decision).toHaveLength(1);
  });
  it("a failed read is an error row; a person who does not decide, or no requests, shows nothing", () => {
    expect(commercialApprovalItems({ status: "error" })).toEqual([expect.objectContaining({ error: true, label: "Commercial approvals could not be loaded" })]);
    expect(commercialApprovalItems({ status: "none" })).toEqual([]);
    expect(commercialApprovalItems({ status: "ok", count: 0, oldestOpportunityId: "" })).toEqual([]);
  });
});
