import { describe, expect, it } from "vitest";
import { act, board, proj, ship } from "./fixtures";
import { blockersFor, buildProjectRows, buildRail, clampPage, dayInZone, handoverRows, isEmptyBoard, lastUpdatedText, nextPage, paginate, phaseText, rowsPerPage, whenOf } from "./model";

describe("time and zones", () => {
  it("reads days and clocks in the office zone", () => {
    expect(dayInZone("2026-11-17T21:00:00Z", "Asia/Dubai")).toBe("2026-11-18");
    expect(whenOf(act(), "Asia/Dubai").text).toBe("Tue 17 Nov · 07:00–19:00");
  });
  it("names the zone only when the site's differs from the office's", () => {
    const w = whenOf(act({ tz: "Europe/London" }), "Asia/Dubai");
    expect(w.zone).toBeTruthy();
    expect(w.text).toContain("03:00–15:00");
    expect(whenOf(act(), "Asia/Dubai").zone).toBeNull();
  });
  it("says the time is not set when only a date exists", () => {
    expect(whenOf(act({ starts_at: null, ends_at: null }), "Asia/Dubai").text).toBe("Tue 17 Nov · time not set");
  });
});

describe("phase wording (Phase 2 rules)", () => {
  it("never says Started for a passed date", () => {
    const t = phaseText(act({ phase: { phase: "date_passed", basis: "activity", first_day: "2026-11-10", last_day: "2026-11-10", started_at: null } }), "2026-11-14");
    expect(t.started).toBe(false);
    expect(t.label).toMatch(/start unconfirmed/i);
  });
  it("says Started only with a start record", () => {
    const t = phaseText(act({ phase: { phase: "started", basis: "activity", first_day: "2026-11-14", last_day: "2026-11-14", started_at: "2026-11-14T04:00:00Z" } }), "2026-11-14");
    expect(t.started).toBe(true);
  });
  it("keeps the project-header fallback distinguishable", () => {
    const t = phaseText(act({ phase: { phase: "scheduled", basis: "project_header", first_day: "2026-11-17", last_day: "2026-11-17", started_at: null }, state: "tentative" }), "2026-11-14");
    expect(t.label).toMatch(/Tentative/);
    expect(t.label).toMatch(/from the project header/);
  });
});

describe("blockers, in the order to act on them", () => {
  it("crew missing comes first", () => {
    const a = act({ crew: [], crew_total: 0, call_missing: 0, readiness: null });
    const b = blockersFor(a, board({ activities: [a] }));
    expect(b[0]!.key).toBe("crew_missing");
    expect(b.map((x) => x.key)).toContain("readiness_unrecorded");
  });
  it("a missing call time is said, with how many", () => {
    const a = act({ crew_total: 3, call_missing: 2 });
    const b = blockersFor(a, board({ activities: [a] }));
    expect(b[0]).toMatchObject({ key: "call_pending", detail: "2 of 3 crew without a call time" });
  });
  it("a shipment arriving after setup starts is raised, one arriving before is not", () => {
    const late = ship({ arrives_at: "2026-11-17T06:00:00Z" });
    expect(blockersFor(act(), board({ shipments: [late] })).map((x) => x.key)).toContain("shipment_after_setup");
    expect(blockersFor(act(), board({ shipments: [ship()] })).map((x) => x.key)).not.toContain("shipment_after_setup");
  });
  it("uses Inventory's shortage and overdue states", () => {
    const s = ship({ request: { code: "REQ-9", state: "short", units_short: 2, return_overdue: true } });
    const keys = blockersFor(act(), board({ shipments: [s] })).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["equipment_short", "return_overdue"]));
  });
  it("a completed task alone is not readiness: unrecorded readiness is flagged, not-ready is named", () => {
    expect(blockersFor(act({ readiness: { hardware: "not_recorded", content: "not_recorded", app: "not_recorded" } }), board()).map((x) => x.key)).toContain("readiness_unrecorded");
    const nr = blockersFor(act({ readiness: { hardware: "not_ready", content: "ready", app: "ready" } }), board());
    expect(nr.find((x) => x.key === "not_ready")?.detail).toMatch(/Equipment/);
  });
  it("a started run raises no readiness or setup warning", () => {
    const a = act({ phase: { phase: "started", basis: "activity", first_day: "2026-11-14", last_day: "2026-11-14", started_at: "2026-11-14T04:00:00Z" }, readiness: null });
    expect(blockersFor(a, board({ activities: [a] }))).toEqual([]);
  });
});

describe("the schedule rail", () => {
  const raf = board({
    activities: [
      act({ id: "dis", title: "Dismantle", kind: "dismantling", run_label: "Run 1", start_date: "2026-11-21", starts_at: "2026-11-21T03:00:00Z", ends_at: "2026-11-21T15:00:00Z", phase: { phase: "scheduled", basis: "activity", first_day: "2026-11-21", last_day: "2026-11-21", started_at: null } }),
      act({ id: "show", title: "Show", kind: "show", run_label: "Run 1", start_date: "2026-11-19", starts_at: "2026-11-19T05:00:00Z", ends_at: "2026-11-19T13:00:00Z", phase: { phase: "scheduled", basis: "activity", first_day: "2026-11-19", last_day: "2026-11-19", started_at: null } }),
      act({ id: "setup", title: "Installation", run_label: "Run 1" }),
      act({ id: "nod", title: "Undated", phase: { phase: "no_date", basis: "none", first_day: null, last_day: null, started_at: null }, start_date: null, end_date: null, starts_at: null, ends_at: null }),
    ],
    shipments: [ship({ activity_id: "setup" })],
  });
  it("is in date order across activities and shipment movements, separate runs distinct", () => {
    const { items } = buildRail(raf);
    expect(items.map((i) => i.id)).toEqual(["s1:departs_at", "s1:arrives_at", "setup", "show", "dis"]);
    expect(items.some((i) => i.title.startsWith("Run 1"))).toBe(true);
  });
  it("marks the first upcoming activity as next and drops undated ones", () => {
    const { items } = buildRail(raf);
    expect(items.find((i) => i.id === "setup")!.badge).toBe("next");
    expect(items.find((i) => i.id === "nod")).toBeUndefined();
  });
  it("limits and says how many are hidden", () => { expect(buildRail(raf, 2)).toMatchObject({ hidden: 3 }); });
  it("puts the shipment-after-setup blocker on the arrival", () => {
    const b = board({ activities: [act()], shipments: [ship({ arrives_at: "2026-11-17T06:00:00Z" })] });
    expect(buildRail(b).items.find((i) => i.id === "s1:arrives_at")!.blocker?.key).toBe("shipment_after_setup");
  });
  it("says venue and crew gaps", () => {
    const b = board({ activities: [act({ venue: null, venue_source: null, crew: [], crew_total: 0 })] });
    const it = buildRail(b).items[0]!;
    expect(it.whereNote).toBe("Venue not set");
    expect(it.who).toBe("Lead Mona Manager · crew not assigned");
  });
});

describe("project rows", () => {
  it("states 'No scheduled site work' and sorts those last", () => {
    const b = board({ projects: [proj({ id: "p2", name: "Quiet project" }), proj()], activities: [act()] });
    const rows = buildProjectRows(b);
    expect(rows[0]!.project.id).toBe("p1");
    expect(rows[1]).toMatchObject({ noSiteWork: true, statement: "No scheduled site work" });
  });
  it("shows up to three runs, counts the rest, and labels project-wide readiness", () => {
    const acts = [1, 2, 3, 4].map((n) => act({ id: `a${n}`, title: `Run ${n}`, start_date: `2026-11-1${n}`, starts_at: `2026-11-1${n}T03:00:00Z`, phase: { phase: "scheduled", basis: "activity", first_day: `2026-11-1${n}`, last_day: `2026-11-1${n}`, started_at: null } }));
    const row = buildProjectRows(board({ activities: acts }))[0]!;
    expect(row.runs).toHaveLength(3);
    expect(row.moreRuns).toBe(1);
    expect(row.readinessText).toMatch(/^Project-wide:/);
    const all = buildProjectRows(board({ activities: acts }), 12)[0]!;
    expect(all.runs).toHaveLength(4);
    expect(all.moreRuns).toBe(0);
  });
  it("picks the earliest run's top blocker", () => {
    const a = act({ crew: [], crew_total: 0 });
    expect(buildProjectRows(board({ activities: [a] }))[0]!.blocker?.label).toBe("Crew missing");
  });
});

describe("handovers, pages, freshness", () => {
  it("says who is missing", () => {
    const rows = handoverRows(board({ handovers: [{ id: "h", reference: "HO-1", title: "T", status: "submitted", pm_name: null, install_start: "2026-12-01", location: "Hall", submitted_at: null }] }));
    expect(rows[0]).toMatchObject({ status: "Awaiting acceptance", pm: "PM not named yet", install: "Tue 1 Dec" });
  });
  it("paginates, rotates and clamps", () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(nextPage(2, 3)).toBe(0); expect(nextPage(0, 1)).toBe(0); expect(clampPage(9, 3)).toBe(2); expect(clampPage(-1, 3)).toBe(0);
    expect(rowsPerPage(1920)).toBeLessThan(rowsPerPage(1024));
  });
  it("last updated carries seconds and the date when not today", () => {
    expect(lastUpdatedText("2026-11-14T08:00:05Z", "Asia/Dubai", Date.parse("2026-11-14T09:00:00Z"))).toBe("12:00:05");
    expect(lastUpdatedText("2026-11-13T08:00:05Z", "Asia/Dubai", Date.parse("2026-11-14T09:00:00Z"))).toBe("Fri 13 Nov 12:00:05");
  });
  it("detects an empty board", () => { expect(isEmptyBoard(board({ activities: [], shipments: [] }))).toBe(true); expect(isEmptyBoard(board())).toBe(false); });
});
