import { describe, expect, it } from "vitest";
import { budgetWaitingDetail, handoverNotice, waitingOnOthersItems } from "./action-centre";
import type { HandoverRow } from "@/lib/crm/handover-attention";

describe("My Day 'handover accepted' notice", () => {
  const row = (kind: HandoverRow["kind"], id: string): HandoverRow => ({ kind, opportunityId: id, reference: `R-${id}`, title: `Job ${id}`, detail: "", scope: "mine", at: null });
  it("is news, not an action: only the accepted rows, linking to the handover (one) or Follow-ups (several)", () => {
    expect(handoverNotice({ status: "ok", rows: [row("handover_question", "a"), row("won_no_handover", "b"), row("handover_accepted", "d")] })).toEqual([expect.objectContaining({ key: "handover-accepted", count: 1, href: "/sales/opportunities/d/handover" })]);
    expect(handoverNotice({ status: "ok", rows: [row("handover_accepted", "d"), row("handover_accepted", "e")] })[0]).toMatchObject({ count: 2, href: "/sales/follow-ups" });
  });
  it("nothing when there is none, or when the check could not be made (the attention list reports that failure)", () => {
    expect(handoverNotice({ status: "ok", rows: [] })).toEqual([]);
    expect(handoverNotice({ status: "error" })).toEqual([]);
    expect(handoverNotice({ status: "none" })).toEqual([]);
  });
});

describe("My Day 'Waiting on others' (never counted as attention)", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("lists what the person submitted themselves, with the oldest wait and who decides; a failed source is its own error row", () => {
    const items = waitingOnOthersItems({ leave: { status: "ok", count: 2, oldest: "2026-10-30T09:00:00Z", with: "Pia Manager" }, claims: { status: "error" }, recovery: { status: "ok", count: 0, oldest: null } }, 1, now);
    expect(items.map((i) => [i.key, i.count, !!i.error])).toEqual([["waiting-leave", 2, false], ["waiting-claims", 0, true], ["waiting-review", 1, false]]);
    expect(items[0]!.detail).toBe("Oldest waiting 3 days · with Pia Manager");
  });
});

describe("My Day waiting age and who decides", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("a budget the person submitted waits with a named shared queue", () => {
    expect(budgetWaitingDetail({ oldest: "2026-10-30T09:00:00Z", queues: ["Finance"] }, now)).toBe("Oldest waiting 3 days · with the Finance queue");
    expect(budgetWaitingDetail({ oldest: null, queues: ["Finance", "the CEO or CTO"] }, now)).toBe("with the Finance queue and the CEO or CTO queue");
    expect(budgetWaitingDetail(undefined, now)).toBeUndefined();
  });
});
