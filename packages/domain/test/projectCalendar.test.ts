import { describe, expect, it } from "vitest";
import { addDays, addMonths, barPosition, daysBetween, describeTimedEvent, entryDays, groupByDay, isDateOnly, localInputValue, monthGrid, startOfWeek, weekdayIndex } from "../src";

describe("date-only arithmetic (no time zone involved)", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2099-12-31", 1)).toBe("2100-01-01");
    expect(addDays("2096-02-28", 1)).toBe("2096-02-29");
    expect(addDays("2097-02-28", 1)).toBe("2097-03-01");
    expect(daysBetween("2099-03-28", "2099-03-30")).toBe(2);
  });
  it("is stable across a daylight-saving week in any zone (days are not 24-hour intervals)", () => {
    expect(addDays("2099-03-28", 1)).toBe("2099-03-29");
    expect(addDays("2099-10-24", 1)).toBe("2099-10-25");
    expect(daysBetween("2099-03-25", "2099-04-01")).toBe(7);
  });
  it("numbers weekdays Monday-first and finds the week start", () => {
    expect(weekdayIndex("2026-10-19")).toBe(0);   // a Monday
    expect(weekdayIndex("2026-10-25")).toBe(6);
    expect(startOfWeek("2026-10-22")).toBe("2026-10-19");
  });
  it("recognises date-only strings and rejects timestamps", () => {
    expect(isDateOnly("2026-10-19")).toBe(true);
    expect(isDateOnly("2026-10-19T00:00:00Z")).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
  it("builds a Monday-first month grid whose weeks are complete", () => {
    const g = monthGrid("2026-10-18");
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![0]!.day).toBe("2026-09-28");
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("timed events", () => {
  const night = { kind: "booking", id: "b", title: "Site", onDate: null, endDate: null, startsAt: "2099-03-28T21:00:00Z", endsAt: "2099-03-29T04:00:00Z", tz: "Europe/Warsaw" };
  it("places an overnight booking on both days in the viewing zone", () => {
    expect(entryDays(night, "Europe/Warsaw")).toEqual(["2099-03-28", "2099-03-29"]);
    expect(entryDays(night, "UTC")).toEqual(["2099-03-28", "2099-03-29"]);
  });
  it("does not spill an event that ends exactly at midnight onto the next day", () => {
    const e = { ...night, startsAt: "2099-06-01T08:00:00Z", endsAt: "2099-06-01T20:00:00Z" };
    expect(entryDays(e, "UTC")).toEqual(["2099-06-01"]);
  });
  it("keeps a date-only deadline on its own day whatever the viewing zone", () => {
    const e = { kind: "task", id: "t", title: "Due", onDate: "2099-02-15", endDate: "2099-02-15", startsAt: null, endsAt: null, tz: null };
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Dubai"]) expect(entryDays(e, tz)).toEqual(["2099-02-15"]);
  });
  it("spreads a multi-day date range and groups entries by day", () => {
    const span = { kind: "plan", id: "p", title: "Install", onDate: "2099-03-05", endDate: "2099-03-07", startsAt: null, endsAt: null, tz: null };
    expect(entryDays(span, "UTC")).toEqual(["2099-03-05", "2099-03-06", "2099-03-07"]);
    expect(groupByDay([span, night], "UTC").get("2099-03-06")).toEqual([span]);
  });
  it("shows the site's time first, and the viewer's own time only when it differs", () => {
    const same = describeTimedEvent("2099-06-01T05:00:00Z", "2099-06-01T13:00:00Z", "Asia/Dubai", "Asia/Dubai");
    expect(same.viewer).toBeNull();
    expect(same.source).toContain("09:00");
    const other = describeTimedEvent("2099-06-01T05:00:00Z", "2099-06-01T13:00:00Z", "Asia/Dubai", "Europe/Warsaw");
    expect(other.viewer).toContain("(your time)");
    expect(other.viewer).toContain("07:00");
  });
  it("round-trips an instant to the local wall-clock value of a zone across a DST change", () => {
    expect(localInputValue("2099-03-28T21:00:00Z", "Europe/Warsaw")).toBe("2099-03-28T22:00");
    expect(localInputValue("2099-03-29T04:00:00Z", "Europe/Warsaw")).toBe("2099-03-29T06:00");
  });
});

describe("timeline bars", () => {
  it("positions bars as percentages of the visible range and never collapses to nothing", () => {
    const b = barPosition("2099-03-02", "2099-03-03", "2099-03-01", "2099-03-10");
    expect(b.left).toBeCloseTo(10);
    expect(b.width).toBeCloseTo(20);
    expect(barPosition("2099-03-02", "2099-03-02", "2099-03-01", "2099-03-10").width).toBeGreaterThan(0);
  });
});
