import { describe, expect, it } from "vitest";
import { requestNextStep, shipmentsByRun } from "./equipment-next-step";

const base = { neededFrom: "2026-11-10T08:00:00Z", neededUntil: "2026-11-15T20:00:00Z", openLines: 3 };
const r = (state: string, over: Record<string, unknown> = {}) => ({ state, unitsOut: 0, returnOverdue: false, shortLines: 0, reservedLines: 3, lines: 3, ...over }) as never;

describe("requestNextStep", () => {
  it("a draft with no planning dates says to set them before submitting to Warehouse", () => {
    const s = requestNextStep({ status: "draft", neededFrom: null, neededUntil: null, openLines: 2 });
    expect(s.action).toBe("Set planning dates before submitting to Warehouse.");
    expect(s.missing).toEqual(["No start date (when the equipment is needed)", "No end date (when it is needed until)"]);
    expect(s.owner).toBe("Project Manager");
    expect(s.warning).toBe(true);
  });
  it("a complete draft is submitted by the Project Manager", () => {
    const s = requestNextStep({ status: "draft", ...base });
    expect(s).toMatchObject({ current: "Submit", owner: "Project Manager", warning: false, missing: [] });
  });
  it("walks reserve, dispatch and return in order, warning on short stock and overdue returns", () => {
    expect(requestNextStep({ status: "submitted", ...base, readiness: r("short", { shortLines: 1 }) })).toMatchObject({ current: "Reserve", warning: true, done: ["Submit"] });
    expect(requestNextStep({ status: "in_progress", ...base, readiness: r("reserved") })).toMatchObject({ current: "Dispatch", owner: "Warehouse", done: ["Submit", "Reserve"] });
    expect(requestNextStep({ status: "in_progress", ...base, readiness: r("still_out", { unitsOut: 4, returnOverdue: true }) })).toMatchObject({ current: "Return", warning: true });
  });
  it("finished and cancelled requests have no next step", () => {
    expect(requestNextStep({ status: "closed", ...base }).current).toBeNull();
    expect(requestNextStep({ status: "cancelled", ...base }).action).toMatch(/Cancelled/);
  });
});

describe("shipmentsByRun", () => {
  it("puts each shipment under its run and keeps untied ones last", () => {
    const acts = [{ id: "a1", title: "Setup", run_label: "Run 1" }, { id: "a2", title: "Setup", run_label: "Run 2" }];
    const g = shipmentsByRun([{ id: "s1", label: "Truck A", plan_item_id: "a2" }, { id: "s2", label: "Courier", plan_item_id: null }, { id: "s3", label: "Truck B", plan_item_id: "a1" }], acts);
    expect(g.map((x) => [x.heading, x.shipments.map((s) => s.label)])).toEqual([["Run 1 · Setup", ["Truck B"]], ["Run 2 · Setup", ["Truck A"]], ["Not tied to a site run", ["Courier"]]]);
  });
});
