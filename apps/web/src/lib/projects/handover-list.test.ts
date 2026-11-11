import { describe, expect, it } from "vitest";
import { closedHandovers, handoverHref, parseHistoryPage, splitOpenHandovers, type HandoverLite } from "./handover-list";

const h = (id: string, status: string, over: Partial<HandoverLite> = {}): HandoverLite => ({ id, status, pm_user_id: null, company_id: "c1", submitted_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z", ...over });
const canAssign = (c: string) => c === "c1";

describe("which handovers wait on whom", () => {
  it("the named Project Manager gets the ones assigned to them (and the one they asked Sales about); an assigner gets the submitted ones", () => {
    const rows = [h("a", "pm_assigned", { pm_user_id: "me" }), h("b", "clarification_requested", { pm_user_id: "me" }), h("c", "submitted"), h("d", "pm_assigned", { pm_user_id: "other" }), h("e", "submitted", { company_id: "c2" }), h("f", "accepted", { pm_user_id: "me" })];
    const s = splitOpenHandovers(rows, "me", canAssign);
    expect(s.mine.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.toAssign.map((x) => x.id)).toEqual(["c"]);
    expect(s.otherOpen.map((x) => x.id)).toEqual(["d", "e"]);          // open, but someone else's step
    expect(closedHandovers(rows).map((x) => x.id)).toEqual(["f"]);
  });
  it("the longest wait leads, so an old pending handover is first, not last", () => {
    const rows = [h("new", "pm_assigned", { pm_user_id: "me", submitted_at: "2026-11-10T08:00:00Z" }), h("old", "pm_assigned", { pm_user_id: "me", submitted_at: "2026-03-01T08:00:00Z" })];
    expect(splitOpenHandovers(rows, "me", canAssign).mine.map((x) => x.id)).toEqual(["old", "new"]);
  });
  it("reads the history page from the address safely and builds the link to one brief", () => {
    expect([parseHistoryPage("3"), parseHistoryPage("0"), parseHistoryPage("x"), parseHistoryPage(undefined), parseHistoryPage("2.5")]).toEqual([3, 1, 1, 1, 1]);
    expect(handoverHref("h-1")).toBe("/projects/handovers?handover=h-1#handover-h-1");
  });
});
