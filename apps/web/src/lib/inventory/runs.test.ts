import { describe, expect, it } from "vitest";
import { CHECK_NOT_RESERVED, checkCoversRange, projectCheckView, reviewSentence, salesCheckView } from "./planning";
import { coverOfRuns, groupByRun, parseRunCover, runOption, runProblemWords, runStateWords, staysOutSentence, suggestWindow } from "./runs";

const A = runOption({ id: "a", title: "Run A", start_date: "2031-06-11", end_date: "2031-06-12" }, "Asia/Dubai");
const B = runOption({ id: "b", title: "Run B", starts_at: "2031-06-17T05:00:00Z", ends_at: "2031-06-18T14:00:00Z" }, "Asia/Dubai");
const U = runOption({ id: "u", title: "Undated run" }, "Asia/Dubai");

describe("site runs a request serves", () => {
  it("reads a run's days in the request's time zone, dated or timed, and says so in words", () => {
    expect(A).toMatchObject({ startDay: "2031-06-11", endDay: "2031-06-12", when: "11 Jun 2031 to 12 Jun 2031" });
    expect(B).toMatchObject({ startDay: "2031-06-17", endDay: "2031-06-18" });
    // 22:30 UTC is already the next day in Dubai
    expect(runOption({ id: "x", title: "Late", starts_at: "2031-06-16T22:30:00Z", ends_at: "2031-06-17T02:00:00Z" }, "Asia/Dubai")).toMatchObject({ startDay: "2031-06-17", when: "17 Jun 2031" });
    expect(U).toMatchObject({ startDay: null, when: "No date yet" });
  });
  it("suggests leaving the day before the first ticked run and due back the day after the last, and nothing without a dated run", () => {
    expect(suggestWindow([A, B, U], ["a", "b"])).toEqual({ dispatch: "2031-06-10T09:00", returnDue: "2031-06-19T18:00", firstRun: "Run A", lastRun: "Run B" });
    expect(suggestWindow([A, B, U], ["b"])).toMatchObject({ dispatch: "2031-06-16T09:00", returnDue: "2031-06-19T18:00" });
    expect(suggestWindow([A, B, U], ["u"])).toBeNull();
    expect(suggestWindow([A, B, U], [])).toBeNull();
    // month ends are real dates
    expect(suggestWindow([runOption({ id: "m", title: "M", start_date: "2031-03-01", end_date: "2031-03-31" }, "UTC")], ["m"])).toMatchObject({ dispatch: "2031-02-28T09:00", returnDue: "2031-04-01T18:00" });
  });
  it("says which ticked runs the dates cover, why not, and that the same equipment stays out between two runs", () => {
    const ok = coverOfRuns([A, B, U], ["a", "b"], "2031-06-10T09:00", "2031-06-19T18:00");
    expect(ok.map((c) => c.covered)).toEqual([true, true]);
    expect(staysOutSentence(ok)).toBe("The same equipment stays out from Run A to Run B: it is sent once and comes back once, and stays with the project between the runs.");
    const early = coverOfRuns([A, B], ["a", "b"], "2031-06-10T09:00", "2031-06-15T18:00");
    expect(early.map((c) => [c.run.id, c.covered])).toEqual([["a", true], ["b", false]]);
    expect(early[1]!.reason).toBe("The equipment is due back on 15 Jun 2031, before this run ends.");
    expect(coverOfRuns([A], ["a"], "2031-06-12T09:00", "2031-06-19T18:00")[0]).toMatchObject({ covered: false, reason: "The equipment leaves the warehouse on 12 Jun 2031, after this run starts." });
    expect(coverOfRuns([A, U], ["a", "u"], "", "").map((c) => c.covered)).toEqual([null, null]);
    expect(staysOutSentence(coverOfRuns([A], ["a"], "2031-06-10T09:00", "2031-06-19T18:00"))).toBeNull();
  });
});

describe("run-specific status in words", () => {
  const raw = [
    { project_id: "p", request_id: "r1", request_code: "UAE-R-00009", request_status: "in_progress", run_id: "a", run_title: "Run A", run_start: "2031-06-10T20:00:00Z", run_end: "2031-06-12T20:00:00Z",
      leaves_at: "2031-06-10T05:00:00Z", due_back_at: "2031-06-19T14:00:00Z", timezone: "Asia/Dubai", state: "partially_dispatched", units_asked: 12, units_short: 1, units_dispatched: 8, units_returned: 0, units_out: 8,
      short_buy: 0, short_rent: 1, short_no_plan: 0, problems: ["short", "something_new"] },
    { project_id: "p", request_id: "r1", request_code: "UAE-R-00009", request_status: "in_progress", run_id: "b", run_title: "Run B", state: "partially_dispatched", units_asked: 12, units_short: 1, units_dispatched: 8,
      units_returned: 0, units_out: 8, short_rent: 1, problems: ["short", "due_back_before_run_ends", "run_not_dated"], timezone: "Asia/Dubai" },
    { nonsense: true },
  ];
  it("keeps only what it understands, groups the rows under their run and says how many and who acts", () => {
    const rows = parseRunCover(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.problems).toEqual(["short"]);
    const groups = groupByRun(rows);
    expect(groups.map((g) => g.runTitle)).toEqual(["Run A", "Run B"]);
    expect(groups[0]!.exceptions).toEqual(["1 short on request UAE-R-00009: whoever arranges the rental rents it."]);
    // a run without a date is a note, not an exception
    expect(groups[1]!.exceptions).toEqual(["1 short on request UAE-R-00009: whoever arranges the rental rents it.", "Request UAE-R-00009 is due back before this run ends. The Project Manager changes the dates."]);
    expect(parseRunCover(null)).toEqual([]);
  });
  it("uses the warehouse's own words for a state and names the owner of each exception", () => {
    expect([runStateWords("partially_dispatched"), runStateWords("still_out"), runStateWords("draft")]).toEqual(["Partly sent", "Still out", "Not sent to the warehouse yet"]);
    const r = { unitsShort: 3, shortBuy: 1, shortRent: 0, shortNoPlan: 2, unitsOut: 2, requestCode: "R-1" };
    expect(runProblemWords("short", r)).toBe("3 short on request R-1: the warehouse reserves it or marks it to buy or rent; the buyer buys it.");
    expect(runProblemWords("return_overdue", r)).toBe("2 still out on request R-1 after its due-back date. The warehouse receives the return.");
    expect(runProblemWords("not_sent", r)).toMatch(/The warehouse sends it/);
    expect(runProblemWords("run_not_dated", r)).toBeNull();
  });
});

describe("the availability check, for Sales and for the project", () => {
  const latest = { check_id: "c", result: "partial", checked_at: "2031-05-01T08:00:00Z", checked_by: "Hana Warehouse", location_name: "Dubai warehouse", note: null,
    summary: [{ technology: "Laptop kit", qty: 1, status: "partial", shortages: [{ item_name: "Laptop", short: 1 }] }],
    covers: { install_start: "2031-09-08", event_start: "2031-09-10", event_end: "2031-09-12", technologies: [{ name: "Laptop kit", qty: 1 }] } };
  it("says the dated range a check covered", () => {
    expect(CHECK_NOT_RESERVED).toBe("Availability checked · stock not reserved.");
    expect(checkCoversRange(latest.covers)).toBe("8 Sep 2031 to 12 Sep 2031");
    expect(checkCoversRange({ event_start: "2031-09-10" })).toBe("10 Sep 2031");
    expect(checkCoversRange({})).toBeNull();
    expect(salesCheckView({ state: "checked", needs_recheck: false, latest })!.coversRange).toBe("8 Sep 2031 to 12 Sep 2031");
    expect(salesCheckView({ state: "none" })!.coversRange).toBeNull();
  });
  it("gives the project the same result, and a sentence for each thing that changed since", () => {
    const v = projectCheckView({ state: "checked", enquiry_reference: "UAE-O-2031-0007", latest, review: [
      { field: "install_start", checked: "2031-09-08", now: "2031-09-07" },
      { field: "quantities", checked: [{ name: "Laptop kit", qty: 1 }], now: [{ name: "Laptop kit", qty: 2 }] },
      { field: "warehouse", checked: "Dubai warehouse", now: "Abu Dhabi store", request_code: "UAE-R-00012" },
      { field: "unknown" },
    ] })!;
    expect(v).toMatchObject({ state: "checked", enquiryReference: "UAE-O-2031-0007", headline: "Partly available", tone: "warn", locationName: "Dubai warehouse", coversRange: "8 Sep 2031 to 12 Sep 2031" });
    expect(v.rows[0]).toMatchObject({ name: "Laptop kit", qty: "1", shortages: ["Laptop: short by 1"] });
    expect(v.review).toEqual([
      "The installation start was 8 Sep 2031 when the check was made and is now 7 Sep 2031.",
      "The equipment or its quantities changed: the check covered Laptop kit × 1; the project now has Laptop kit × 2.",
      "The check was made against Dubai warehouse, but request UAE-R-00012 asks Abu Dhabi store.",
    ]);
    expect(reviewSentence({ field: "event_end", checked: null, now: "2031-09-13" })).toBe("The event end was not set when the check was made and is now 13 Sep 2031.");
    // an available check with something to review is not green
    expect(projectCheckView({ state: "checked", latest: { ...latest, result: "available", summary: [] }, review: [{ field: "event_end", checked: "2031-09-12", now: "2031-09-13" }] })!.tone).toBe("warn");
    expect(projectCheckView({ state: "checked", latest: { ...latest, result: "available", summary: [] }, review: [] })!.tone).toBe("good");
    expect(projectCheckView({ state: "no_enquiry", review: [] })).toMatchObject({ state: "no_enquiry", rows: [], review: [] });
    expect(projectCheckView({ state: "bogus" })).toBeNull();
  });
});
