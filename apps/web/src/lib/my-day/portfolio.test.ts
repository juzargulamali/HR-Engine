import { describe, expect, it } from "vitest";
import { buildDeliveryWeek, classifyProjects, healthCounts, itemDates } from "./portfolio";

const T = (project_id: string, status: string, due_date: string | null, blocked_at: string | null = null) => ({ project_id, status, due_date, blocked_at });
const M = (project_id: string, status: string, due_date: string | null) => ({ project_id, status, due_date });
const today = "2026-10-28"; // a Wednesday: the week is Mon 26 Oct to Sun 1 Nov

describe("grouping by deadlines and blockers", () => {
  it("is blocked when an open task is blocked, even if it is also late", () => {
    const h = classifyProjects(["a"], [T("a", "todo", "2026-10-01", "2026-10-02T00:00:00Z")], [], today);
    expect(h.get("a")).toBe("blocked");
  });
  it("is at risk for an open task or an open milestone past its date, and on track otherwise", () => {
    const h = classifyProjects(["late-task", "late-ms", "fine", "empty"], [T("late-task", "in_progress", "2026-10-27"), T("fine", "todo", "2026-10-29")], [M("late-ms", "planned", "2026-10-20"), M("fine", "accepted", "2026-09-01")], today);
    expect([...h]).toEqual([["late-task", "at_risk"], ["late-ms", "at_risk"], ["fine", "on_track"], ["empty", "on_track"]]);
  });
  it("ignores finished tasks, a due date of today and tasks without a date", () => {
    const h = classifyProjects(["a"], [T("a", "done", "2026-01-01", "2026-01-01T00:00:00Z"), T("a", "todo", today), T("a", "todo", null)], [], today);
    expect(h.get("a")).toBe("on_track");
  });
  it("counts each project once", () => {
    const h = classifyProjects(["a", "b", "c"], [T("a", "todo", "2026-10-01"), T("b", "todo", "2026-10-02", "x")], [], today);
    expect(healthCounts(h)).toEqual({ blocked: 1, at_risk: 1, on_track: 1 });
  });
});

describe("plan item dates", () => {
  it("reads a date item, a one-day item and a timed item in its own time zone", () => {
    expect(itemDates({ start_date: "2026-10-27", end_date: "2026-10-29", starts_at: null, ends_at: null, tz: null })).toEqual({ start: "2026-10-27", end: "2026-10-29" });
    expect(itemDates({ start_date: "2026-10-27", end_date: null, starts_at: null, ends_at: null, tz: null })).toEqual({ start: "2026-10-27", end: "2026-10-27" });
    expect(itemDates({ start_date: null, end_date: null, starts_at: "2026-10-27T21:00:00Z", ends_at: "2026-10-28T02:00:00Z", tz: "Asia/Dubai" })).toEqual({ start: "2026-10-28", end: "2026-10-28" });
    expect(itemDates({ start_date: null, end_date: null, starts_at: null, ends_at: null, tz: null })).toBeNull();
  });
});

describe("delivery this week", () => {
  const p = (id: string, name: string) => ({ id, name, reference: id.toUpperCase(), pmName: "PM" });
  const item = (projectId: string, id: string, start: string, end: string, status: "planned" | "in_progress" | "done" = "in_progress") => ({ projectId, id, title: id, start, end, status });

  it("lays bars on the days of this week, cuts them at the edges and ignores items outside the week", () => {
    const w = buildDeliveryWeek({ projects: [p("a", "Aurora")], today, items: [item("a", "early", "2026-10-20", "2026-10-27"), item("a", "mid", "2026-10-28", "2026-10-29"), item("a", "out", "2026-11-02", "2026-11-03"), item("a", "before", "2026-10-19", "2026-10-25")], milestones: [] });
    const bars = w.rows[0]!.bars;
    expect(bars.map((b) => [b.id, b.col, b.span, b.cutStart, b.cutEnd])).toEqual([["early", 0, 2, true, false], ["mid", 2, 2, false, false]]);
    expect(w.todayCol).toBe(2);
    expect(w.days.map((d) => d.iso)[0]).toBe("2026-10-26");
    expect(w.days).toHaveLength(7);
  });
  it("puts overlapping items on separate lanes", () => {
    const w = buildDeliveryWeek({ projects: [p("a", "Aurora")], today, items: [item("a", "x", "2026-10-26", "2026-10-28"), item("a", "y", "2026-10-27", "2026-10-30"), item("a", "z", "2026-10-29", "2026-10-30")], milestones: [] });
    const row = w.rows[0]!;
    expect(Object.fromEntries(row.bars.map((b) => [b.id, b.lane]))).toEqual({ x: 0, y: 1, z: 0 });
    expect(row.lanes).toBe(2);
  });
  it("marks milestones due this week: done, late (open and before today) or open", () => {
    const w = buildDeliveryWeek({ projects: [p("a", "Aurora")], today, items: [], milestones: [
      { projectId: "a", id: "m1", title: "m1", due: "2026-10-27", status: "planned" }, { projectId: "a", id: "m2", title: "m2", due: "2026-10-30", status: "in_progress" },
      { projectId: "a", id: "m3", title: "m3", due: "2026-10-28", status: "accepted" }, { projectId: "a", id: "m4", title: "m4", due: "2026-10-29", status: "cancelled" }, { projectId: "a", id: "m5", title: "m5", due: "2026-11-09", status: "planned" },
    ] });
    expect(w.rows[0]!.marks.map((m) => [m.id, m.col, m.state])).toEqual([["m1", 1, "late"], ["m3", 2, "done"], ["m2", 4, "open"]]);
  });
  it("lists only projects with something this week, soonest first, and says how many did not fit", () => {
    const projects = ["a", "b", "c", "d"].map((id) => p(id, id.toUpperCase()));
    const w = buildDeliveryWeek({ projects, today, maxRows: 2, items: [item("a", "1", "2026-10-30", "2026-10-30"), item("b", "2", "2026-10-26", "2026-10-26"), item("c", "3", "2026-10-28", "2026-10-28")], milestones: [] });
    expect(w.rows.map((r) => r.project.id)).toEqual(["b", "c"]);
    expect(w.moreProjects).toBe(1);
  });
  it("has no today column when today is not in the displayed week and no rows when nothing is scheduled", () => {
    const w = buildDeliveryWeek({ projects: [p("a", "A")], today, items: [], milestones: [] });
    expect(w.rows).toEqual([]);
    expect(w.moreProjects).toBe(0);
  });
});
