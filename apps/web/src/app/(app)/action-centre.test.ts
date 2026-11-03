import { describe, expect, it } from "vitest";
import { attentionSentence, budgetWaitingDetail, buildActionItems, commercialApprovalItems, handoverItems, projectNoteItems } from "./action-centre";
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

describe("My Day dispatch and return notes (C4)", () => {
  const now = new Date("2026-11-16T09:00:00Z");
  const note = (id: string, project: string, kind: "dispatch" | "return", since: string) => ({ noteId: id, noteNo: `ENG-${kind === "dispatch" ? "D" : "RT"}-${id}`, kind, projectId: project, projectRef: `P-${project}`, projectName: `Project ${project}`, waitingSince: since });
  it("one row per project, oldest waiting, a single note links straight to it and several to the project's notes", () => {
    const items = projectNoteItems({ status: "ok", notes: [note("1", "a", "dispatch", "2026-11-13T09:00:00Z"), note("2", "b", "dispatch", "2026-11-15T09:00:00Z"), note("3", "b", "return", "2026-11-14T09:00:00Z")] }, now);
    expect(items.map((i) => [i.label, i.count, i.href])).toEqual([
      ["Dispatch note waiting for you: Project a", 1, "/projects/a/equipment?note=1#notes"],
      ["Dispatch and return notes waiting for you: Project b", 2, "/projects/b/equipment#notes"],
    ]);
    expect(items[0]!.detail).toMatch(/3 days/);
  });
  it("is 'Needs me' (a decision row) and counts in the sentence", () => {
    const items = projectNoteItems({ status: "ok", notes: [note("1", "a", "return", "2026-11-16T08:00:00Z")] }, now);
    expect(items[0]!.label).toBe("Returned equipment, please confirm: Project a");
    expect(splitActions(items).decision).toHaveLength(1);
    expect(attentionSentence(buildActionItems({ myPendingApprovals: 0, extraItems: items }))).toMatch(/1 item needs your attention/);
  });
  it("nothing waiting adds no row; a failed read is an error row, never 'nothing waiting'", () => {
    expect(projectNoteItems({ status: "none" }, now)).toEqual([]);
    const failed = projectNoteItems({ status: "error" }, now);
    expect(failed).toEqual([expect.objectContaining({ key: "inv-notes", label: "Dispatch and return notes could not be loaded", error: true })]);
    expect(attentionSentence(buildActionItems({ myPendingApprovals: 0, extraItems: failed }))).toMatch(/could not be loaded/);
  });
});

describe("My Day waiting age and who decides", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("the approvals row says how long the longest-waiting decision has waited; no age when unknown", () => {
    expect(buildActionItems({ myPendingApprovals: 2, myPendingOldest: "2026-10-30T09:00:00Z", now })[0]).toMatchObject({ detail: "Oldest waiting 3 days" });
    expect(buildActionItems({ myPendingApprovals: 2, now })[0]!.detail).toBeUndefined();
  });
  it("a budget the person submitted waits with a named shared queue", () => {
    expect(budgetWaitingDetail({ oldest: "2026-10-30T09:00:00Z", queues: ["Finance"] }, now)).toBe("Oldest waiting 3 days · with the Finance queue");
    expect(budgetWaitingDetail({ oldest: null, queues: ["Finance", "the CEO or CTO"] }, now)).toBe("with the Finance queue and the CEO or CTO queue");
    expect(budgetWaitingDetail(undefined, now)).toBeUndefined();
  });
});
