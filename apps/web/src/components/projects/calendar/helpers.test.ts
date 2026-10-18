import { describe, expect, it } from "vitest";
import { fetchRange, barLayout, barRange, calendarHref, entryWhen, filterKinds, isValidTimeZone, mapCompanyRows, mapMyRows, mapProjectRows, neighbourDates, parseCalendarParams, rangeTitle, visibleRange } from "./helpers";
import { groupByDay } from "@enginious-hr/domain";

const TODAY = "2026-10-18";

describe("parseCalendarParams", () => {
  it("falls back to month, today and Dubai for anything missing or invalid", () => {
    expect(parseCalendarParams({}, TODAY)).toEqual({ view: "month", date: TODAY, tz: "Asia/Dubai", kinds: [] });
    expect(parseCalendarParams({ view: "year", date: "2026-02-31x", tz: "Mars/Phobos" }, TODAY)).toEqual({ view: "month", date: TODAY, tz: "Asia/Dubai", kinds: [] });
  });
  it("rejects impossible dates such as 30 February", () => {
    expect(parseCalendarParams({ date: "2026-02-30" }, TODAY).date).toBe(TODAY);
  });
  it("keeps valid values, takes the first of repeated parameters and limits kinds to the known ones", () => {
    const p = parseCalendarParams({ view: ["week", "agenda"], date: "2026-03-29", tz: "Europe/Warsaw", kind: "task,booking,bogus" }, TODAY, ["task", "booking", "milestone"]);
    expect(p).toEqual({ view: "week", date: "2026-03-29", tz: "Europe/Warsaw", kinds: ["task", "booking"] });
  });
  it("validates time zones", () => {
    expect(isValidTimeZone("Asia/Dubai")).toBe(true);
    expect(isValidTimeZone("Nope/Zone")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe("visible range and navigation", () => {
  it("covers a whole month, a Monday-first week, and 30 days of agenda", () => {
    expect(visibleRange("month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(visibleRange("month", "2096-02-14")).toEqual({ from: "2096-02-01", to: "2096-02-29" });
    expect(visibleRange("week", "2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(visibleRange("agenda", "2026-12-20")).toEqual({ from: "2026-12-20", to: "2027-01-18" });
  });
  it("moves by a month, a week or 30 days", () => {
    expect(neighbourDates("month", "2026-01-31")).toEqual({ prev: "2025-12-01", next: "2026-02-01" });
    expect(neighbourDates("week", "2026-10-18")).toEqual({ prev: "2026-10-11", next: "2026-10-25" });
    expect(neighbourDates("agenda", "2026-10-18")).toEqual({ prev: "2026-09-18", next: "2026-11-17" });
  });
  it("titles the period in words", () => {
    expect(rangeTitle("month", "2026-10-18")).toBe("October 2026");
    expect(rangeTitle("week", "2026-10-21")).toBe("19 Oct 2026 to 25 Oct 2026");
  });
  it("builds links that keep set parameters and drop empty ones", () => {
    expect(calendarHref("/projects/calendar", { view: "week", date: "2026-10-18", tz: null, kind: [] })).toBe("/projects/calendar?view=week&date=2026-10-18");
    expect(calendarHref("/x", { kind: ["task", "booking"] })).toBe("/x?kind=task%2Cbooking");
  });
});

describe("fetch range", () => {
  it("fetches whole weeks for a month so the grid's edge cells are complete, and exactly the period otherwise", () => {
    expect(fetchRange("month", "2026-10-18")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(fetchRange("week", "2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(fetchRange("agenda", "2026-10-18")).toEqual({ from: "2026-10-18", to: "2026-11-16" });
  });
});

describe("row mapping", () => {
  const my = [
    { kind: "task", item_id: "t1", project_id: "p1", project_reference: "UAE-P-2026-0001", project_name: "Floor", title: "Shader", on_date: "2099-02-15", end_date: "2099-02-15", starts_at: null, ends_at: null, tz: null, status: "in_progress", detail: null },
    { kind: "booking", item_id: "b1", project_id: "p1", project_reference: "UAE-P-2026-0001", project_name: "Floor", title: "Site: Warsaw hall", on_date: null, end_date: null, starts_at: "2099-03-28T21:00:00Z", ends_at: "2099-03-29T04:00:00Z", tz: "Europe/Warsaw", status: "confirmed", detail: null },
  ];
  it("maps my-calendar rows with project links, kind and status in words", () => {
    const [task, booking] = mapMyRows(my);
    expect(task).toMatchObject({ kindLabel: "Task deadline", statusLabel: "In progress", href: "/projects/p1/work", onDate: "2099-02-15" });
    expect(booking).toMatchObject({ kindLabel: "Site booking", statusLabel: "Confirmed", href: "/projects/p1/timeline" });
  });
  it("keeps a date-only deadline on its day in every viewing zone, and an overnight booking on both nights", () => {
    const entries = mapMyRows(my);
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Dubai"]) expect(groupByDay(entries, tz).get("2099-02-15")?.map((e) => e.kind)).toEqual(["task"]);
    const warsaw = groupByDay(entries, "Europe/Warsaw");
    expect(warsaw.get("2099-03-28")?.map((e) => e.kind)).toEqual(["booking"]);
    expect(warsaw.get("2099-03-29")?.map((e) => e.kind)).toEqual(["booking"]);
  });
  it("shows the site's time first and the viewer's own time when it differs, across the DST change", () => {
    const [, booking] = mapMyRows(my);
    const w = entryWhen(booking!, "Europe/Warsaw")!;
    expect(w.viewer).toBeNull();
    expect(w.source).toContain("22:00");
    expect(w.source).toContain("06:00");
    const d = entryWhen(booking!, "Asia/Dubai")!;
    expect(d.viewer).toContain("(your time)");
    expect(d.source).toContain("22:00");
    expect(entryWhen(mapMyRows(my)[0]!, "Asia/Dubai")).toBeNull();
  });
  it("maps project rows including dependencies with their site-time clock", () => {
    const rows = [{ kind: "dependency", item_id: "d1", title: "Power ready", on_date: "2099-03-04", end_date: "2099-03-04", starts_at: null, ends_at: null, tz: null, status: "pending", who: "Expo Builders", detail: "09:00:00" }];
    const [e] = mapProjectRows(rows, "p1", "REF", "Floor");
    expect(e).toMatchObject({ kindLabel: "Dependency on others", statusLabel: "Not yet confirmed", href: "/projects/p1/timeline" });
    expect(e!.detail).toBe("Expo Builders · at 09:00 site time");
  });
  it("maps company rows to spans carrying summary fields only and drops undated projects", () => {
    const rows = [
      { project_id: "p1", reference: "UAE-P-2026-0001", name: "Floor", kind: "client", status: "in_progress", start_date: "2099-02-01", end_date: null },
      { project_id: "p2", reference: "UAE-P-2026-0002", name: "Undated", kind: "internal", status: "planning", start_date: null, end_date: null },
    ];
    const entries = mapCompanyRows(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ onDate: "2099-02-01", endDate: "2099-02-01", href: "/projects/p1", detail: "Client project" });
  });
  it("filters by kind, and returns everything when no kind is chosen", () => {
    const e = mapMyRows(my);
    expect(filterKinds(e, [])).toHaveLength(2);
    expect(filterKinds(e, ["booking"]).map((x) => x.kind)).toEqual(["booking"]);
  });
});

describe("bar chart range", () => {
  it("covers min start to max end and places bars as percentages", () => {
    const layout = barLayout([
      { id: "a", title: "A", start: "2099-03-01", end: "2099-03-02" },
      { id: "b", title: "B", start: "2099-03-09", end: "2099-03-10" },
    ])!;
    expect(layout.range).toEqual({ start: "2099-03-01", end: "2099-03-10" });
    expect(layout.days).toBe(10);
    expect(layout.bars[1]!.left).toBeCloseTo(80);
    expect(layout.bars[0]!.width).toBeCloseTo(20);
  });
  it("has no range without dated items", () => {
    expect(barRange([])).toBeNull();
    expect(barLayout([])).toBeNull();
  });
});
