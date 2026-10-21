import { describe, expect, it } from "vitest";
import { legacyCalendarTarget, legacyTimelineTarget, parsePlanParams, planHref } from "./plan-view";
import { activeTabHref, manageItems, projectTabs } from "./workspace-nav";

describe("parsePlanParams", () => {
  it("defaults to the Delivery list and never trusts the address", () => {
    expect(parsePlanParams({})).toEqual({ plan: "delivery", mode: "list" });
    expect(parsePlanParams({ plan: "site", mode: "timeline" })).toEqual({ plan: "site", mode: "timeline" });
    expect(parsePlanParams({ plan: "<script>", mode: "grid" })).toEqual({ plan: "delivery", mode: "list" });
    expect(parsePlanParams(new URLSearchParams("plan=site&mode=calendar"))).toEqual({ plan: "site", mode: "calendar" });
  });
});

describe("planHref", () => {
  it("keeps the calendar position while the plan or mode changes", () => {
    const cur = { plan: "delivery", mode: "calendar", view: "week", date: "2026-11-02" };
    expect(planHref("p1", cur, { plan: "site" })).toBe("/projects/p1/plan?plan=site&mode=calendar&view=week&date=2026-11-02");
  });
  it("can drop the calendar parameters when leaving the calendar", () => {
    const cur = { plan: "site", mode: "calendar", view: "week", date: "2026-11-02", check: "b1" };
    expect(planHref("p1", cur, { mode: "list" }, ["view", "date", "tz", "kind", "check"])).toBe("/projects/p1/plan?plan=site&mode=list");
  });
});

describe("legacy addresses", () => {
  it("sends the old Timelines & site page to the Delivery list, and a conflict check to the Site list", () => {
    expect(legacyTimelineTarget("p1", {})).toBe("/projects/p1/plan?plan=delivery&mode=list");
    expect(legacyTimelineTarget("p1", { check: "b9" })).toBe("/projects/p1/plan?plan=site&mode=list&check=b9");
  });
  it("sends the old project calendar to the Plan calendar and keeps its view, date, zone and filters", () => {
    expect(legacyCalendarTarget("p1", { view: "week", date: "2026-11-02", tz: "Europe/Warsaw" })).toBe("/projects/p1/plan?plan=delivery&mode=calendar&view=week&date=2026-11-02&tz=Europe%2FWarsaw");
    expect(legacyCalendarTarget("p1", { kind: "booking,dependency" })).toBe("/projects/p1/plan?plan=site&mode=calendar&kind=booking%2Cdependency");
    expect(legacyCalendarTarget("p1", { kind: "booking,task" })).toContain("plan=delivery");
  });
});

describe("workspace tabs and the Manage project menu", () => {
  it("has exactly four primary sections", () => {
    expect(projectTabs("/projects/p1", "3").map((t) => t.label)).toEqual(["Overview", "Work", "Plan", "Discussion"]);
    expect(projectTabs("/projects/p1", "3")[3]?.badge).toBe("3");
  });
  it("lights up the new home of every old section and none for the secondary pages", () => {
    const b = "/projects/p1";
    expect(activeTabHref(b, b)).toBe(b);
    expect(activeTabHref(`${b}/work/tasks/t1`, b)).toBe(`${b}/work`);
    expect(activeTabHref(`${b}/timeline`, b)).toBe(`${b}/plan`);
    expect(activeTabHref(`${b}/calendar`, b)).toBe(`${b}/plan`);
    expect(activeTabHref(`${b}/discussion`, b)).toBe(`${b}/discussion`);
    expect(activeTabHref(`${b}/people`, b)).toBeNull();
    expect(activeTabHref(`${b}/documents`, b)).toBeNull();
  });
  it("keeps every old section reachable for any member, and management actions for managers only", () => {
    const member = manageItems({ base: "/p", manager: false, live: true, canReopen: false, hasStatusMoves: false });
    expect(member.map((i) => i.key)).toEqual(["people", "changes", "documents", "history"]);
    const pm = manageItems({ base: "/p", manager: true, live: true, canReopen: false, hasStatusMoves: true });
    expect(pm.map((i) => i.key)).toEqual(["edit", "status", "people", "changes", "documents", "history", "complete"]);
    expect(pm.find((i) => i.key === "complete")?.href).toBe("/p/complete");
  });
  it("offers Reopen only to those holding the capability on a finished project, and no completion or edit on it", () => {
    const done = manageItems({ base: "/p", manager: true, live: false, canReopen: true, hasStatusMoves: true });
    expect(done.map((i) => i.key)).toEqual(["status", "people", "changes", "documents", "history", "reopen"]);
    expect(manageItems({ base: "/p", manager: true, live: false, canReopen: false, hasStatusMoves: false }).map((i) => i.key)).not.toContain("reopen");
  });
});
