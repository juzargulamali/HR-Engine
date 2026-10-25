import { describe, expect, it } from "vitest";
import {
  cancelMessage, expandChoices, expandMessage, filterHoldings, filterRequests, formatInZone, formatLocalPlan, groupOutstanding, isLineDone, itemAvailabilityWords,
  leftLabel, lineProgress, normaliseLocal, parsePlanInput, parseRange, planOrderWarning, planToFormValues, progressFromDb, reserveMessage, salesCheckView,
  sortRequests, substitutionInfo, summariseRequest, technologyAvailabilityWords, templateSlots, windowChangeMessages, windowLabel, zonedLocalToUtcIso,
  type OutstandingLike, type RequestListRow, type ReservationLite,
} from "./planning";

const WINDOW = { needed_from: "2030-03-30T08:00:00.000Z", needed_until: "2030-04-02T20:00:00.000Z" };
const live = { status: "submitted", ...WINDOW };

function res(over: Partial<ReservationLite> & { id: string }): ReservationLite {
  return { request_line_id: "L1", unit_id: null, qty: 1, dispatched_qty: 0, returned_qty: 0, status: "active", from: WINDOW.needed_from, until: WINDOW.needed_until, ...over };
}

describe("planning dates", () => {
  it("accepts a local time written with a space or a T, drops seconds, and reads a bare date as midnight", () => {
    expect(normaliseLocal("2030-03-30 12:00")).toBe("2030-03-30T12:00");
    expect(normaliseLocal("2030-03-30T12:00:45")).toBe("2030-03-30T12:00");
    expect(normaliseLocal("2030-03-30")).toBe("2030-03-30T00:00");
  });

  it("refuses dates that do not exist, times out of range and anything carrying an offset", () => {
    expect(normaliseLocal("2030-02-31T10:00")).toBeNull();
    expect(normaliseLocal("2030-03-30T25:00")).toBeNull();
    expect(normaliseLocal("2030-03-30T12:60")).toBeNull();
    expect(normaliseLocal("2030-03-30T12:00+04:00")).toBeNull();
    expect(normaliseLocal("30/03/2030")).toBeNull();
  });

  it("turns the plan form into exactly the jsonb the function expects: filled fields only, local time, known keys only", () => {
    const r = parsePlanInput({ prep_start: "2030-03-28T09:00", dispatch: "", show_start: "2030-03-31 18:00", return_due: "2030-04-03T10:00", requestId: "x", timezone: "Asia/Dubai" });
    expect(r).toEqual({ error: null, plan: { prep_start: "2030-03-28T09:00", show_start: "2030-03-31T18:00", return_due: "2030-04-03T10:00" } });
    expect(parsePlanInput({}).plan).toEqual({});
  });

  it("names the field that is wrong, in the words the person sees", () => {
    const r = parsePlanInput({ dispatch: "2030-03-30T10:00", show_end: "2030-13-40T10:00" });
    expect(r.error).toContain("Show or event ends");
    expect(r.plan).toEqual({});
  });

  it("puts a saved plan back in the form, ignoring anything that is not a real local time", () => {
    const v = planToFormValues({ dispatch: "2030-03-30T12:00", show_start: "garbage", extra: "x" });
    expect(v.dispatch).toBe("2030-03-30T12:00");
    expect(v.show_start).toBe("");
    expect(v.return_due).toBe("");
  });

  it("warns, never blocks, when the dates look out of order", () => {
    expect(planOrderWarning({ dispatch: "2030-03-30T10:00", show_start: "2030-03-29T10:00" })).toContain("earlier than");
    expect(planOrderWarning({ dispatch: "2030-03-29T10:00", show_start: "2030-03-30T10:00" })).toBeNull();
    expect(planOrderWarning({})).toBeNull();
  });

  it("converts a local wall-clock time to the right instant, daylight saving included", () => {
    expect(zonedLocalToUtcIso("2030-03-30T12:00", "Asia/Dubai")).toBe("2030-03-30T08:00:00.000Z");
    // Warsaw: winter time (UTC+1) on 30 March 2030, summer time (UTC+2) from 31 March.
    expect(zonedLocalToUtcIso("2030-03-30T12:00", "Europe/Warsaw")).toBe("2030-03-30T11:00:00.000Z");
    expect(zonedLocalToUtcIso("2030-04-01T12:00", "Europe/Warsaw")).toBe("2030-04-01T10:00:00.000Z");
    expect(zonedLocalToUtcIso("2030-03-30T12:00", "UTC")).toBe("2030-03-30T12:00:00.000Z");
    expect(zonedLocalToUtcIso("not a date", "UTC")).toBeNull();
  });

  it("shows an instant in the request's own zone and says which zone", () => {
    expect(formatInZone("2030-03-30T08:00:00.000Z", "Asia/Dubai")).toBe("30 Mar 2030, 12:00");
    expect(formatLocalPlan("2030-03-30T12:00")).toBe("30 Mar 2030, 12:00");
    expect(formatLocalPlan(null)).toBe("—");
    expect(windowLabel({ ...WINDOW, timezone: "Asia/Dubai" })).toBe("30 Mar 2030, 12:00 to 3 Apr 2030, 00:00 (Asia/Dubai)");
    expect(windowLabel({ needed_from: null, needed_until: null, timezone: "Asia/Dubai" })).toBe("Dates not set");
    expect(windowLabel({ needed_from: WINDOW.needed_from, needed_until: null, timezone: "Asia/Dubai" })).toContain("no end date yet");
  });

  it("reads the database's range text", () => {
    expect(parseRange('["2030-03-30 08:00:00+00","2030-04-02 20:00:00+00")')).toEqual({ from: "2030-03-30T08:00:00.000Z", until: "2030-04-02T20:00:00.000Z" });
    expect(parseRange(null)).toEqual({ from: null, until: null });
    expect(parseRange("nonsense")).toEqual({ from: null, until: null });
  });
});

describe("request line progress and outstanding", () => {
  const line = { id: "L1", qty: 10, status: "open" as const };

  it("adds up reserved, dispatched, returned and what is still out, and counts a shortage against the whole window", () => {
    const p = lineProgress(line, live, [
      res({ id: "a", qty: 6, dispatched_qty: 4, returned_qty: 1 }),
      res({ id: "b", qty: 2, until: "2030-04-01T00:00:00.000Z" }), // does not cover the whole window
      res({ id: "c", qty: 5, status: "released" }),
    ]);
    expect(p).toMatchObject({ reserved: 8, reservedForWindow: 6, dispatched: 4, returned: 1, outstanding: 3, toReserve: 2, shortage: 4 });
  });

  it("counts equipment already out as covering the window when it stays until the end", () => {
    const p = lineProgress(line, live, [res({ id: "a", qty: 10, dispatched_qty: 10, from: "2030-03-30T09:00:00.000Z" })]);
    expect(p.reservedForWindow).toBe(10);
    expect(p.shortage).toBe(0);
  });

  it("has no shortage for a draft, a closed request or a cancelled line, but never forgets what is outstanding", () => {
    const out = [res({ id: "a", qty: 4, dispatched_qty: 4, returned_qty: 1 })];
    expect(lineProgress(line, { ...live, status: "draft" }, []).shortage).toBe(0);
    expect(lineProgress({ ...line, status: "cancelled" }, live, out)).toMatchObject({ shortage: 0, outstanding: 3 });
    expect(lineProgress(line, { ...live, status: "cancelled" }, out).outstanding).toBe(3);
  });

  it("never reports a negative outstanding or amount left to reserve", () => {
    const p = lineProgress({ ...line, qty: 2 }, live, [res({ id: "a", qty: 3, dispatched_qty: 1, returned_qty: 2 })]);
    expect(p.outstanding).toBe(0);
    expect(p.toReserve).toBe(0);
  });

  it("ignores reservations of other lines and understands the range text", () => {
    const p = lineProgress(line, live, [res({ id: "x", request_line_id: "other", qty: 9 }), { ...res({ id: "y", qty: 10 }), from: undefined, until: undefined, reserved_during: '["2030-03-30 08:00:00+00","2030-04-02 20:00:00+00")' }]);
    expect(p.reserved).toBe(10);
    expect(p.reservedForWindow).toBe(10);
  });

  it("takes the database's own numbers when it supplies them", () => {
    expect(progressFromDb({ reserved: 3, reserved_for_window: 2, dispatched: 1, returned: 0, outstanding: 1, shortage: 8 }, 10)).toEqual({ reserved: 3, reservedForWindow: 2, dispatched: 1, returned: 0, outstanding: 1, toReserve: 7, shortage: 8 });
    expect(progressFromDb(null, 10)).toBeNull();
  });

  it("counts lines done out of total (cancelled lines are not counted) and flags shortages", () => {
    const lines = [
      { id: "L1", qty: 2, status: "open" as const },
      { id: "L2", qty: 5, status: "open" as const },
      { id: "L3", qty: 1, status: "cancelled" as const },
    ];
    const reservations = [
      res({ id: "a", request_line_id: "L1", qty: 2, dispatched_qty: 2 }),
      res({ id: "b", request_line_id: "L2", qty: 3, until: "2030-04-01T00:00:00.000Z" }),
      res({ id: "c", request_line_id: "L3", qty: 1, dispatched_qty: 1 }),
    ];
    expect(summariseRequest(live, lines, reservations)).toEqual({ done: 1, total: 2, shortageLines: 1, outstanding: 3 });
    expect(summariseRequest({ ...live, status: "fulfilled" }, lines, reservations)).toMatchObject({ done: 2, total: 2, shortageLines: 0 });
  });

  it("only calls a line done when everything asked for has gone out", () => {
    const p = lineProgress({ id: "L1", qty: 4, status: "open" }, live, [res({ id: "a", qty: 4, dispatched_qty: 3 })]);
    expect(isLineDone({ id: "L1", qty: 4, status: "open" }, live, p)).toBe(false);
    expect(isLineDone({ id: "L1", qty: 4, status: "cancelled" }, { ...live, status: "fulfilled" }, p)).toBe(false);
  });
});

describe("substitutions", () => {
  it("marks a proposed substitute as not yet accepted and says what the warehouse keeps preparing", () => {
    const s = substitutionInfo({ substitution_status: "proposed", original_item_name: "Barco UDX-4K32", item_name: "Panasonic RZ31K" });
    expect(s.label).toBe("Substitute — not yet accepted");
    expect(s.tone).toBe("warn");
    expect(s.detail).toContain("keeps preparing Barco UDX-4K32");
  });
  it("has words for accepted and declined, and nothing for a line without one", () => {
    expect(substitutionInfo({ substitution_status: "accepted", item_name: "B", original_item_name: "A" }).label).toBe("Substitute accepted");
    expect(substitutionInfo({ substitution_status: "declined", original_item_name: "A" }).detail).toContain("A stays");
    expect(substitutionInfo({ substitution_status: "none" })).toMatchObject({ state: "none", label: null });
  });
});

describe("technology templates", () => {
  const comps = [
    { id: "c3", item_id: "cable", qty: 4, alt_group: null, is_optional: true, sort_order: 30 },
    { id: "c2", item_id: "projB", qty: 1, alt_group: "projector", is_optional: false, sort_order: 20 },
    { id: "c1", item_id: "projA", qty: 1, alt_group: "projector", is_optional: false, sort_order: 10 },
    { id: "c4", item_id: "screen", qty: 1, alt_group: null, is_optional: false, sort_order: 5 },
  ];
  const names: Record<string, string> = { cable: "HDMI cable", projA: "Projector A", projB: "Projector B", screen: "Screen" };
  const slots = templateSlots(comps, (id) => names[id] ?? "?");

  it("groups alternatives into one slot with the standard choice first", () => {
    expect(slots.map((s) => s.key)).toEqual(["component:c4", "projector", "component:c3"]);
    expect(slots[1]?.options.map((o) => o.name)).toEqual(["Projector A", "Projector B"]);
    expect(slots[2]?.optional).toBe(true);
  });
  it("sends only the choices that belong to the template", () => {
    expect(expandChoices(slots, { projector: "projB", nonsense: "x" })).toEqual({ projector: "projB" });
    expect(expandChoices(slots, { projector: "not-in-template" })).toEqual({});
    expect(expandChoices(slots, {})).toEqual({});
  });
});

describe("what the functions answer, in words", () => {
  it("reports moved lines and, separately, each line that could not move, and says nobody else was touched", () => {
    const m = windowChangeMessages({
      extended: [{ line_id: "a", reservations: 2 }],
      conflicts: [{ line_id: "b", item_name: "Moving head", shortage: 2, kept_window: { from: WINDOW.needed_from, until: WINDOW.needed_until }, reason: "MH-0007 is already reserved from 1 Apr to 5 Apr" }],
    }, "Asia/Dubai");
    expect(m.hasConflicts).toBe(true);
    expect(m.summary).toContain("The new dates are saved.");
    expect(m.summary).toContain("1 line has its reservations moved");
    expect(m.summary).toContain("1 line could not move");
    expect(m.conflicts[0]).toContain("Moving head was not moved to the new dates (2 short)");
    expect(m.conflicts[0]).toContain("keeps its earlier dates (30 Mar 2030, 12:00 to 3 Apr 2030, 00:00)");
    expect(m.conflicts[0]).toContain("MH-0007 is already reserved");
    expect(m.conflicts[0]).toContain("Nobody else's reservation was touched");
    expect(windowChangeMessages({ extended: [], conflicts: [] }, "UTC")).toMatchObject({ hasConflicts: false, conflicts: [] });
  });

  it("accepts a partial reservation and explains the rest", () => {
    const r = reserveMessage({ item_name: "Laptop", requested: 5, reserved_now: 3, shortage: 2, still_needed: 2, reservations: [{ unit_code: "UAE-E-00001" }, { unit_code: "UAE-E-00002" }, { unit_code: "UAE-E-00003" }], need: { action: "need_to_rent", qty: 2, rental_reference: "Q-77" } });
    expect(r.partial).toBe(true);
    expect(r.reservedNow).toBe(3);
    expect(r.text).toContain("Reserved 3 of 5 Laptop (UAE-E-00001, UAE-E-00002, UAE-E-00003)");
    expect(r.text).toContain("Partial fulfilment is fine");
    expect(r.text).toContain("Marked: Need to rent (reference Q-77)");
  });
  it("says plainly when nothing could be reserved, and stays quiet about a full reservation", () => {
    expect(reserveMessage({ item_name: "Truss", requested: 4, reserved_now: 0, shortage: 4, still_needed: 4 }).text).toContain("Nothing could be reserved");
    const full = reserveMessage({ item_name: "Truss", requested: 4, reserved_now: 4, shortage: 0, still_needed: 0 });
    expect(full.partial).toBe(false);
    expect(full.text).toBe("Reserved 4 of 4 Truss.");
  });
  it("says that dispatched equipment stays outstanding after a cancellation", () => {
    expect(cancelMessage({ released_qty: 2, outstanding_qty: 3 }, "request")).toContain("3 already dispatched stay outstanding until they are returned");
    expect(cancelMessage({ released_qty: 0, outstanding_qty: 0 }, "line")).toBe("The line is cancelled. Nothing reserved was waiting to be released.");
  });
  it("calls expanded template lines a snapshot", () => {
    const m = expandMessage({ line_ids: ["1", "2", "3"], offered_alternatives: [{}] }, "LED tunnel", 2);
    expect(m).toContain('Added 3 lines from "LED tunnel" × 2');
    expect(m).toContain("snapshot");
    expect(m).toContain("1 line has listed alternatives");
  });
});

describe("availability wording", () => {
  const base = {
    item_name: "Moving head", location_name: "Dubai warehouse", unit_of_measure: "each", from: "2030-04-10T05:00:00.000Z", until: "2030-04-12T17:00:00.000Z", basis: "future",
    physical_at_location: 10, usable_now: 6, awaiting_inspection: 1, damaged_repair_missing: 1, dispatched_to_projects: 2, assigned_to_employees: 0, in_transit: 0,
    draft_unverified: 0, free_for_range: 8, returning_on_time: 2, reserved_in_range: 3, overdue: 0, rental_free_for_range: 0,
  };
  it("keeps 'right now' and 'for those dates' apart and labels the dates with their zone", () => {
    const w = itemAvailabilityWords(base, "Asia/Dubai");
    expect(w.title).toBe("Moving head at Dubai warehouse");
    expect(w.now.find((l) => l.label === "Usable now")?.value).toBe("6");
    expect(w.range[0]?.value).toBe("10 Apr 2030, 09:00 to 12 Apr 2030, 21:00 (Asia/Dubai)");
    expect(w.range.find((l) => l.label === "Free for these dates")).toMatchObject({ value: "8", tone: "good" });
    expect(w.range.find((l) => l.label === "Free for these dates")?.note).toContain("2 expected back on time");
    expect(w.now.some((l) => l.label.includes("Free for these dates"))).toBe(false);
    expect(w.basisNote).toContain("in the future");
  });
  it("flags overdue equipment and never counts it as ready", () => {
    const w = itemAvailabilityWords({ ...base, overdue: 2 }, "Asia/Dubai");
    expect(w.overdue?.text).toContain("2 are overdue");
    expect(w.overdue?.text).toContain("never counted as ready");
    expect(itemAvailabilityWords(base, "Asia/Dubai").overdue).toBeNull();
  });
  it("marks nothing free as a bad result, and a 'now' range as free today", () => {
    const w = itemAvailabilityWords({ ...base, free_for_range: 0, basis: "now" }, "Asia/Dubai");
    expect(w.range.find((l) => l.label === "Free for these dates")?.tone).toBe("bad");
    expect(w.basisNote).toContain("free today");
  });
  it("lists units only when the function sent them (stock people), otherwise counts only", () => {
    expect(itemAvailabilityWords(base, "UTC").units).toEqual([]);
    const withUnits = itemAvailabilityWords({ ...base, units: [{ unit_id: "u1", code: "UAE-E-00001", serial_number: "S1", free: false, reason: "UAE-E-00001 is overdue back from a project and is not counted as ready" }] }, "UTC");
    expect(withUnits.units[0]).toMatchObject({ code: "UAE-E-00001", free: false });
  });

  it("explains a technology check row by row, with alternatives as substitutes the project must accept", () => {
    const w = technologyAvailabilityWords({
      result: "partial", needs_substitution: true,
      rows: [
        { item_name: "Projector A", needed: 4, free: 1, short: 3, status: "alternative", alternative_item_id: "b", alternatives: [{ item_id: "b", item_name: "Projector B" }] },
        { item_name: "Screen", needed: 4, free: 4, short: 0, status: "available" },
        { item_name: "Cable", needed: 8, free: 0, short: 8, status: "short", is_optional: true },
      ],
      shortages: [{ item_name: "Projector A", short: 3, covered_by_alternative: true }],
    });
    expect(w.headline).toBe("Partly available");
    expect(w.tone).toBe("warn");
    expect(w.rows[0]?.status).toContain("Projector B would cover it (a substitute the project must accept)");
    expect(w.rows[1]?.tone).toBe("good");
    expect(w.rows[2]?.note).toContain("Optional");
    expect(w.shortages[0]).toBe("Projector A: short by 3 (a listed alternative would cover it)");
  });
  it("never reads a template without a complete recipe as available", () => {
    const w = technologyAvailabilityWords({ result: "check_required", message: "Warehouse check required", rows: [] });
    expect(w.headline).toBe("Warehouse check required");
    expect(w.tone).toBe("warn");
  });
});

describe("Sales availability check", () => {
  const checked = (over: Record<string, unknown> = {}, latest: Record<string, unknown> = {}) => ({
    state: "checked", needs_recheck: false,
    latest: { result: "available", checked_by: "Amal", checked_at: "2030-01-05T09:00:00Z", location_name: "Dubai warehouse", summary: [{ technology: "LED tunnel", qty: 2, status: "available", shortages: [], alternatives: [] }], ...latest },
    ...over,
  });

  it("is green only for a current, complete 'available'", () => {
    const v = salesCheckView(checked());
    expect(v).toMatchObject({ tone: "good", headline: "Available", outOfDate: false, warehouseCheckRequired: false, checkedBy: "Amal" });
  });
  it("is never green once it is out of date", () => {
    const v = salesCheckView(checked({ needs_recheck: true }));
    expect(v?.outOfDate).toBe(true);
    expect(v?.tone).toBe("warn");
  });
  it("is never green when a technology has no complete template, even if the overall result says available", () => {
    const v = salesCheckView(checked({}, { summary: [{ technology: "LED tunnel", qty: 2, status: "available" }, { technology: "Kinetic rig", qty: 1, status: "check_required", message: "Warehouse check required" }] }));
    expect(v?.warehouseCheckRequired).toBe(true);
    expect(v?.tone).toBe("warn");
    expect(v?.rows[1]).toMatchObject({ status: "Warehouse check required", tone: "warn" });
  });
  it("reads check_required as 'Warehouse check required' and short as a bad result with its shortage and alternatives", () => {
    expect(salesCheckView(checked({}, { result: "check_required", summary: [] }))).toMatchObject({ headline: "Warehouse check required", tone: "warn" });
    const v = salesCheckView(checked({}, { result: "short", summary: [{ technology: "Wall", qty: 1, status: "short", shortages: [{ item_name: "Panel", short: 6 }], alternatives: [{ instead_of: "Panel A", use: "Panel B" }] }] }));
    expect(v?.tone).toBe("bad");
    expect(v?.rows[0]?.shortages).toEqual(["Panel: short by 6"]);
    expect(v?.rows[0]?.alternatives[0]).toContain("Panel B instead of Panel A");
  });
  it("says 'Warehouse check required' when nothing was ever checked, and shows who asked when it is pending", () => {
    expect(salesCheckView({ state: "none", message: "Warehouse check required", needs_recheck: false })).toMatchObject({ headline: "Warehouse check required", tone: "warn", warehouseCheckRequired: true });
    expect(salesCheckView({ state: "pending", pending: { requested_by: "Sam", requested_at: "2030-01-05T09:00:00Z" } })).toMatchObject({ headline: "Warehouse check asked for", pendingBy: "Sam" });
  });
  it("gives nothing for an answer it does not understand", () => {
    expect(salesCheckView(null)).toBeNull();
    expect(salesCheckView({ state: "weird" })).toBeNull();
  });
});

describe("requests list", () => {
  const row = (over: Partial<RequestListRow>): RequestListRow => ({
    id: "1", code: "UAE-R-00001", kind: "project", title: null, status: "submitted", forLabel: "Mall activation", projectId: "p", employeeId: null, destination: null, timezone: "Asia/Dubai",
    needed_from: "2030-03-30T08:00:00.000Z", needed_until: "2030-04-02T20:00:00.000Z", pickup_location_id: "loc1", requestedByName: "Amal", done: 0, total: 3, shortageLines: 0, created_at: "2030-01-01T00:00:00Z", ...over,
  });
  const rows = [
    row({ id: "1", code: "UAE-R-00001" }),
    row({ id: "2", code: "UAE-R-00002", status: "draft", kind: "employee", forLabel: "Noor Khan", projectId: null, employeeId: "e", needed_from: null, needed_until: null, pickup_location_id: "loc2" }),
    row({ id: "3", code: "UAE-R-00003", status: "cancelled", needed_from: "2030-05-01T08:00:00.000Z", needed_until: "2030-05-03T08:00:00.000Z" }),
    row({ id: "4", code: "UAE-R-00010", status: "closed", forLabel: "Old job", needed_from: "2029-01-01T08:00:00.000Z", needed_until: "2029-01-03T08:00:00.000Z" }),
  ];
  const none = { q: "", status: "", kind: "", location: "", from: "", until: "" };

  it("shows what is still in play by default and everything on request", () => {
    expect(filterRequests(rows, none).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterRequests(rows, { ...none, status: "all" })).toHaveLength(4);
    expect(filterRequests(rows, { ...none, status: "cancelled" }).map((r) => r.id)).toEqual(["3"]);
  });
  it("filters by kind, pickup location and search text", () => {
    expect(filterRequests(rows, { ...none, kind: "employee" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRequests(rows, { ...none, location: "loc2" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRequests(rows, { ...none, q: "noor" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRequests(rows, { ...none, q: "00001" }).map((r) => r.id)).toEqual(["1"]);
  });
  it("filters by date range in the request's own zone and leaves out requests with no dates", () => {
    expect(filterRequests(rows, { ...none, status: "all", from: "2030-04-02", until: "2030-04-30" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterRequests(rows, { ...none, status: "all", until: "2029-12-31" }).map((r) => r.id)).toEqual(["4"]);
  });
  it("sorts by needed date with undated requests always last, and by code naturally", () => {
    expect(sortRequests(rows, { key: "needed", dir: "asc" }).map((r) => r.id)).toEqual(["4", "1", "3", "2"]);
    expect(sortRequests(rows, { key: "needed", dir: "desc" }).map((r) => r.id)).toEqual(["3", "1", "4", "2"]);
    expect(sortRequests(rows, { key: "code", dir: "desc" }).map((r) => r.id)).toEqual(["4", "3", "2", "1"]);
    expect(sortRequests(rows, { key: "status", dir: "asc" })[0]?.id).toBe("1");
  });
});

describe("equipment held by employees", () => {
  const r = (over: Partial<OutstandingLike>): OutstandingLike => ({
    employee_id: "e1", display_name: "Noor Khan", employee_number: "E-001", employment_status: "active", termination_date: null, is_active: true, is_removed: false, holding_kind: "unit",
    code: "UAE-E-00001", item_name: "Laptop", serial_number: "SN1", qty: 1, unit_of_measure: "each", issued_at: "2030-01-10T08:00:00Z", expected_return_at: null, condition: "good", is_overdue: false, ...over,
  });
  const rows = [
    r({}),
    r({ code: "UAE-E-00002", item_name: "Headset", issued_at: "2029-12-01T08:00:00Z", expected_return_at: "2030-02-01T08:00:00Z", is_overdue: true }),
    r({ employee_id: "e2", display_name: "Ali Reza", employee_number: "E-002", employment_status: "terminated", termination_date: "2030-01-31", is_active: false, code: "UAE-E-00003", item_name: "Phone", serial_number: null }),
    r({ employee_id: "e3", display_name: "Zed", employee_number: "E-003", holding_kind: "quantity", code: null, item_name: "HDMI cable", qty: "3.000", serial_number: null }),
  ];
  const groups = groupOutstanding(rows);

  it("groups by person with the earliest since, the next return and the overdue count", () => {
    const noor = groups.find((g) => g.employeeId === "e1")!;
    expect(noor.items).toHaveLength(2);
    expect(noor.since).toBe("2029-12-01T08:00:00Z");
    expect(noor.nextReturn).toBe("2030-02-01T08:00:00Z");
    expect(noor.overdueCount).toBe(1);
    expect(groups.find((g) => g.employeeId === "e3")?.items[0]?.qty).toBe("3");
  });
  it("lists people who have left first, then overdue, then by name", () => {
    expect(groups.map((g) => g.employeeId)).toEqual(["e2", "e1", "e3"]);
    expect(groups[0]?.left).toBe(true);
  });
  it("keeps people who left visible and filters by them", () => {
    expect(filterHoldings(groups, { q: "", onlyLeft: true }).map((g) => g.employeeId)).toEqual(["e2"]);
    expect(filterHoldings(groups, { q: "", onlyLeft: false, overdueOnly: true }).map((g) => g.employeeId)).toEqual(["e1"]);
  });
  it("searches name, employee number, item, ID and serial", () => {
    expect(filterHoldings(groups, { q: "e-002", onlyLeft: false }).map((g) => g.employeeId)).toEqual(["e2"]);
    expect(filterHoldings(groups, { q: "headset", onlyLeft: false }).map((g) => g.employeeId)).toEqual(["e1"]);
    expect(filterHoldings(groups, { q: "uae-e-00003", onlyLeft: false }).map((g) => g.employeeId)).toEqual(["e2"]);
    expect(filterHoldings(groups, { q: "sn1", onlyLeft: false }).map((g) => g.employeeId)).toEqual(["e1"]);
    expect(filterHoldings(groups, { q: "zzz", onlyLeft: false })).toEqual([]);
  });
  it("words why a person is flagged, truthfully for a removed record and a past termination date", () => {
    expect(leftLabel({ removed: true, status: "active", terminationDate: null })).toBe("Record removed");
    expect(leftLabel({ removed: false, status: "terminated", terminationDate: "2030-01-31" })).toBe("Left on 31 Jan 2030");
    expect(leftLabel({ removed: false, status: "terminated", terminationDate: null })).toBe("Has left");
  });
});
