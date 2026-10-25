import { describe, expect, it } from "vitest";
import { equipmentSummary, liveRequests, nextDispatch, type DispatchRequest } from "./dispatch";
import { actionGroupOf, splitActions, sumCounts } from "./groups";
import { summariseLive } from "./live";

describe("live clock status", () => {
  const scope = new Set(["a", "b", "c", "d"]);
  it("counts people with an open session who are in scope, once each", () => {
    const s = summariseLive([{ employee_id: "a" }, { employee_id: "a" }, { employee_id: "b" }, { employee_id: "z" }], [], scope);
    expect(s.clockedIn).toBe(2);
  });
  it("splits by the current work mode, and a person with no open segment is 'not stated'", () => {
    const s = summariseLive([{ employee_id: "a" }, { employee_id: "b" }, { employee_id: "c" }, { employee_id: "d" }], [{ employee_id: "a", work_mode: "office" }, { employee_id: "b", work_mode: "office" }, { employee_id: "c", work_mode: "wfh" }, { employee_id: "z", work_mode: "wfh" }], scope);
    expect(s.byMode).toEqual([{ mode: "office", count: 2 }, { mode: "not_stated", count: 1 }, { mode: "wfh", count: 1 }]);
  });
  it("is zero when nobody is clocked in", () => {
    expect(summariseLive([], [], scope)).toEqual({ clockedIn: 0, byMode: [] });
  });
});

describe("equipment", () => {
  const r = (over: Partial<DispatchRequest>): DispatchRequest => ({ id: "x", code: "R-1", title: null, forLabel: "Stand", status: "in_progress", needed_from: "2026-11-02T08:00:00Z", timezone: "Asia/Dubai", done: 1, total: 4, shortageLines: 0, ...over });
  it("only submitted and in-progress requests are live", () => {
    expect(liveRequests([r({ status: "draft" }), r({ status: "submitted" }), r({ status: "in_progress" }), r({ status: "closed" }), r({ status: "cancelled" })])).toHaveLength(2);
  });
  it("counts live requests and those with a shortage", () => {
    expect(equipmentSummary([r({}), r({ shortageLines: 2 }), r({ status: "draft", shortageLines: 3 })])).toEqual({ live: 2, withShortage: 1 });
  });
  it("picks the soonest live request that still has lines to dispatch; an overdue one comes first", () => {
    const rows = [r({ id: "late-needed", code: "R-3", needed_from: "2026-11-09T08:00:00Z" }), r({ id: "soon", code: "R-2", needed_from: "2026-11-02T08:00:00Z" }), r({ id: "done", code: "R-0", needed_from: "2026-10-01T08:00:00Z", done: 4 }), r({ id: "overdue", code: "R-4", needed_from: "2026-10-20T08:00:00Z" })];
    expect(nextDispatch(rows)?.id).toBe("overdue");
    expect(nextDispatch(rows.filter((x) => x.id !== "overdue"))?.id).toBe("soon");
  });
  it("is null with nothing to dispatch, and undated requests go last", () => {
    expect(nextDispatch([r({ done: 4 }), r({ status: "draft" })])).toBeNull();
    expect(nextDispatch([r({ id: "none", needed_from: null }), r({ id: "dated" })])?.id).toBe("dated");
  });
});

describe("where a needs-you row is shown", () => {
  it("sorts rows into the card about them, so each figure appears once", () => {
    const items = [{ key: "approvals", count: 2 }, { key: "proj-handovers", count: 1 }, { key: "proj-reviews", count: 3 }, { key: "proj-overdue", count: 4 }, { key: "sales-overdue", count: 5 }, { key: "contracts", count: 6 }, { key: "docs", count: 1 }];
    const g = splitActions(items);
    expect(g.decision.map((i) => i.key)).toEqual(["approvals", "proj-handovers", "proj-reviews"]);
    expect(g.other.map((i) => i.key)).toEqual(["proj-overdue"]);
    expect(g.sales.map((i) => i.key)).toEqual(["sales-overdue"]);
    expect(g.hr.map((i) => i.key)).toEqual(["contracts", "docs"]);
    expect(sumCounts(g.decision)).toBe(6);
    expect(actionGroupOf("something-new")).toBe("other");
  });
});
