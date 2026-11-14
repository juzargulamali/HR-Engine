import { describe, expect, it } from "vitest";
import { currenciesOf, periodText, REPORT_GROUPS, REPORT_TEXT, scopeLine, type ReportId } from "./reports";

describe("report labels and grouping", () => {
  it("has two groups: what is true now, then the results of the selected period", () => {
    expect(REPORT_GROUPS.map((g) => g.title)).toEqual(["Current pipeline and follow-ups", "Results for the selected period"]);
    expect(REPORT_GROUPS[0]!.reports).toEqual(["pipeline_by_stage", "pipeline_by_owner", "follow_ups"]);
    expect(REPORT_GROUPS[1]!.reports).toEqual(["timeliness", "won_lost", "lost_reasons", "sources", "won_value", "won_references"]);
  });
  it("puts every report in exactly one group, each with a title and a definition", () => {
    const grouped = REPORT_GROUPS.flatMap((g) => g.reports);
    expect([...grouped].sort()).toEqual((Object.keys(REPORT_TEXT) as ReportId[]).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const id of grouped) { expect(REPORT_TEXT[id].title).not.toBe(""); expect(REPORT_TEXT[id].definition.length).toBeGreaterThan(20); }
  });
  it("keeps the meaning of the definitions the page always showed", () => {
    expect(REPORT_TEXT.won_lost.definition).toContain("Closed in the period, by closing date. Won means a Won stage with purchase-order or authorised-email evidence.");
    expect(REPORT_TEXT.pipeline_by_stage.definition).toContain("Each currency on its own line; never added together.");
    expect(REPORT_TEXT.timeliness.definition).toContain("The share within target needs both a response target and a working calendar");
    expect(REPORT_TEXT.won_references.definition).toContain("They are not read from Zoho Books and may be out of date.");
  });
  it("says what a figure rests on: how many, which company, which dates", () => {
    expect(scopeLine(12, "enquiry", "enquiries", "Enginious UAE", periodText({ from: "2026-08-01", to: "2026-10-30" }))).toBe("12 enquiries, Enginious UAE, 1 Aug to 30 Oct 2026");
    expect(scopeLine(1, "open enquiry", "open enquiries", "Enginious UAE", "as of now")).toBe("1 open enquiry, Enginious UAE, as of now");
    expect(scopeLine(0, "enquiry", "enquiries", "all your companies", "as of now")).toBe("0 enquiries, all your companies, as of now");
  });
  it("writes a period with the year once, or twice when it crosses a year", () => {
    expect(periodText({ from: "2026-08-01", to: "2026-10-30" })).toBe("1 Aug to 30 Oct 2026");
    expect(periodText({ from: "2026-12-15", to: "2027-01-14" })).toBe("15 Dec 2026 to 14 Jan 2027");
  });
  it("lists the currencies of several totals once each, A to Z, and never a sum", () => {
    expect(currenciesOf({ EUR: 10, AED: 5 }, { AED: 7 }, {})).toEqual(["AED", "EUR"]);
    expect(currenciesOf()).toEqual([]);
  });
});
