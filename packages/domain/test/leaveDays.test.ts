import { describe, expect, it } from "vitest";
import { computeLeaveDays } from "../src/leaveDays";

describe("computeLeaveDays", () => {
  it("counts a plain work week correctly for a Sun-Thu week (UAE/KSA, weekStartDay=0)", () => {
    // Sunday 2026-03-01 through Thursday 2026-03-05 — 5 working days, no weekend inside.
    expect(computeLeaveDays({ startDate: "2026-03-01", endDate: "2026-03-05", weekStartDay: 0, holidays: [] })).toBe(5);
  });

  it("excludes the weekend for a Sun-Thu work week", () => {
    // 2026-03-01 (Sun) through 2026-03-07 (Sat) — a full week: Fri/Sat (03-06, 03-07) are weekend.
    expect(computeLeaveDays({ startDate: "2026-03-01", endDate: "2026-03-07", weekStartDay: 0, holidays: [] })).toBe(5);
  });

  it("excludes the weekend for a Mon-Fri work week (Poland, weekStartDay=1)", () => {
    // 2026-03-02 (Mon) through 2026-03-08 (Sun) — Sat/Sun are weekend.
    expect(computeLeaveDays({ startDate: "2026-03-02", endDate: "2026-03-08", weekStartDay: 1, holidays: [] })).toBe(5);
  });

  it("does not consume a leave day for a public holiday inside the range", () => {
    const withoutHoliday = computeLeaveDays({ startDate: "2026-03-01", endDate: "2026-03-05", weekStartDay: 0, holidays: [] });
    const withHoliday = computeLeaveDays({
      startDate: "2026-03-01",
      endDate: "2026-03-05",
      weekStartDay: 0,
      holidays: ["2026-03-03"],
    });
    expect(withHoliday).toBe(withoutHoliday - 1);
  });

  it("treats a single-day request with either half-day flag as 0.5, not 0", () => {
    expect(computeLeaveDays({ startDate: "2026-03-02", endDate: "2026-03-02", weekStartDay: 0, halfDayStart: true, holidays: [] })).toBe(0.5);
    expect(computeLeaveDays({ startDate: "2026-03-02", endDate: "2026-03-02", weekStartDay: 0, halfDayEnd: true, holidays: [] })).toBe(0.5);
  });

  it("applies half-day discounts independently at the start and end of a multi-day range", () => {
    // Sun-Tue (3 working days), half day at the start and half day at the end -> 3 - 0.5 - 0.5 = 2
    expect(
      computeLeaveDays({
        startDate: "2026-03-01",
        endDate: "2026-03-03",
        weekStartDay: 0,
        halfDayStart: true,
        halfDayEnd: true,
        holidays: [],
      }),
    ).toBe(2);
  });

  it("returns 0 for a range that's entirely weekend", () => {
    expect(computeLeaveDays({ startDate: "2026-03-06", endDate: "2026-03-07", weekStartDay: 0, holidays: [] })).toBe(0);
  });
});
