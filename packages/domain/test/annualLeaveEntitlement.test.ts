import { describe, expect, it } from "vitest";
import {
  completedMonthsBetween,
  computeAnnualLeaveEntitlementToDate,
  computePolandAnnualLeaveEntitlementDays,
  computePolandFirstYearAccruedDays,
  computePolandLeaveDaysFromHours,
  computeSaudiAnnualLeaveEntitlementDays,
  computeSaudiAnnualLeaveRateDaysPerYear,
  computeUaeAnnualLeaveEntitlementDays,
} from "../src/annualLeaveEntitlement";

describe("completedMonthsBetween", () => {
  it("only counts a month once the day-of-month has been reached", () => {
    expect(completedMonthsBetween("2025-01-15", "2025-02-14")).toBe(0);
    expect(completedMonthsBetween("2025-01-15", "2025-02-15")).toBe(1);
  });

  it("never returns negative for a date before hireDate", () => {
    expect(completedMonthsBetween("2026-01-01", "2025-01-01")).toBe(0);
  });
});

describe("computeUaeAnnualLeaveEntitlementDays", () => {
  it("accrues nothing in the first six months", () => {
    expect(computeUaeAnnualLeaveEntitlementDays("2026-01-01", "2026-06-30")).toBe(0);
  });

  it("accrues two calendar days per completed month after six months but before one year", () => {
    // 2026-01-01 -> 2026-07-01 is exactly 6 completed months.
    expect(computeUaeAnnualLeaveEntitlementDays("2026-01-01", "2026-07-01")).toBe(12);
    // 8 completed months.
    expect(computeUaeAnnualLeaveEntitlementDays("2026-01-01", "2026-09-01")).toBe(16);
  });

  it("grants 30 calendar days for each completed year once a full year is reached", () => {
    expect(computeUaeAnnualLeaveEntitlementDays("2025-01-01", "2026-01-01")).toBe(30);
    expect(computeUaeAnnualLeaveEntitlementDays("2023-01-01", "2026-01-01")).toBe(90);
  });

  it("does not grant a partial year's worth on top of the completed-years total", () => {
    // 2 completed years plus 5 extra months (not yet 6) -> still just 2*30.
    expect(computeUaeAnnualLeaveEntitlementDays("2023-01-01", "2026-06-01")).toBe(90);
  });
});

describe("computeSaudiAnnualLeaveRateDaysPerYear — five-year threshold", () => {
  it("is 21 days/year under five consecutive years", () => {
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2023-01-01", "2026-01-01")).toBe(21); // 3 years
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2022-01-01", "2026-12-31")).toBe(21); // just under 5 years
  });

  it("becomes 30 days/year exactly at five completed years, and stays 30 after", () => {
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2021-01-01", "2026-01-01")).toBe(30); // exactly 5 years
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2010-01-01", "2026-01-01")).toBe(30); // 16 years
  });
});

describe("computePolandAnnualLeaveEntitlementDays — 20/26-day threshold", () => {
  it("is 20 working days/year under 10 years of recognised service", () => {
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 3 })).toBe(20);
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 9 })).toBe(20);
  });

  it("becomes 26 working days/year at exactly 10 years and beyond", () => {
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 10 })).toBe(26);
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 20 })).toBe(26);
  });

  it("adds HR-recognised prior service toward the threshold", () => {
    // 6 years actual + 4 recognised prior service = 10 -> crosses into 26.
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 6, recognisedPriorServiceYears: 4 })).toBe(26);
  });

  it("prorates for part-time by fteFraction", () => {
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 3, fteFraction: 0.5 })).toBe(10);
    expect(computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 10, fteFraction: 0.5 })).toBe(13);
  });
});

describe("computePolandFirstYearAccruedDays", () => {
  it("accrues 1/12 of the annual entitlement per completed month", () => {
    expect(computePolandFirstYearAccruedDays(20, 1)).toBe(1.67); // 20/12 rounded to 2dp
    expect(computePolandFirstYearAccruedDays(20, 6)).toBe(10);
  });

  it("caps at the full annual amount at 12 completed months", () => {
    expect(computePolandFirstYearAccruedDays(20, 12)).toBe(20);
    expect(computePolandFirstYearAccruedDays(20, 18)).toBe(20);
  });

  it("accrues nothing before the first completed month", () => {
    expect(computePolandFirstYearAccruedDays(20, 0)).toBe(0);
  });
});

describe("computeSaudiAnnualLeaveEntitlementDays — cumulative, not just the current rate", () => {
  it("credits each of the first five years at 21 days/year", () => {
    expect(computeSaudiAnnualLeaveEntitlementDays("2023-01-01", "2026-01-01")).toBe(63); // 3 years * 21
  });

  it("credits years beyond the fifth at 30 days/year, on top of 5*21 for the first five", () => {
    expect(computeSaudiAnnualLeaveEntitlementDays("2018-01-01", "2026-01-01")).toBe(5 * 21 + 3 * 30); // 8 years
  });
});

describe("computeAnnualLeaveEntitlementToDate — the real accrual cron's single dispatcher", () => {
  it("routes UAE through the tiered calendar-day calculator", () => {
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "AE", hireDate: "2025-01-01", asOfDate: "2026-01-01" })).toBe(30);
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "AE", hireDate: "2026-01-01", asOfDate: "2026-06-30" })).toBe(0);
  });

  it("routes Saudi through the cumulative (not just current-rate) calculator", () => {
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "SA", hireDate: "2018-01-01", asOfDate: "2026-01-01" })).toBe(5 * 21 + 3 * 30);
  });

  describe("Poland — blocked (never guessed) when HR hasn't confirmed the required facts", () => {
    it("returns null when isFirstEverEmployment is undefined or null, even with a full FTE history", () => {
      const fteFractionHistory = [{ effectiveFrom: "2023-01-01", fteFraction: 1 }];
      expect(computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01", fteFractionHistory })).toBeNull();
      expect(
        computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01", isFirstEverEmployment: null, fteFractionHistory }),
      ).toBeNull();
    });

    it("returns null when fteFractionHistory is missing or empty, even with isFirstEverEmployment confirmed", () => {
      expect(computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01", isFirstEverEmployment: true })).toBeNull();
      expect(
        computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01", isFirstEverEmployment: true, fteFractionHistory: [] }),
      ).toBeNull();
    });
  });

  describe("Poland — first-ever employment (Art. 153 §1: progressive monthly proration)", () => {
    const fullTimeFromHire = (hireDate: string) => [{ effectiveFrom: hireDate, fteFraction: 1 }];

    it("prorates 1/12 per completed month within the first year", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2026-01-01",
          asOfDate: "2026-04-01", // 3 completed months
          isFirstEverEmployment: true,
          fteFractionHistory: fullTimeFromHire("2026-01-01"),
        }),
      ).toBe(5); // 20/12*3
    });

    it("credits each subsequent completed year in full, at that year's own (here, unchanging) rate", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2026-01-01", // 3 completed years
          isFirstEverEmployment: true,
          fteFractionHistory: fullTimeFromHire("2023-01-01"),
        }),
      ).toBe(60); // 20 (year 1) + 20 (year 2) + 20 (year 3)
    });

    it("10-year threshold: only the years actually at/after the threshold are credited at 26 — earlier years are never restated at the later rate", () => {
      // Hired 2015-01-01, evaluated 2026-01-01 -> 11 completed years, no
      // recognised prior service. Years 1-10 (completedServiceYears 0-9)
      // are all still under the 10-year threshold (20/year); only year 11
      // (completedServiceYears=10) crosses it. The OLD "deliberate
      // simplification" this replaces would have wrongly applied 26 to
      // years 2-11 just because the CURRENT completedYears (11) is over
      // the threshold.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-01-01",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: true,
          fteFractionHistory: fullTimeFromHire("2015-01-01"),
        }),
      ).toBe(226); // 10 years * 20 (years 1-10) + 1 year * 26 (year 11)
    });

    it("FTE change mid-tenure: only the years after the change are prorated at the new fraction", () => {
      // Full-time for years 1-2, drops to half-time from the year-3
      // anniversary onward. The OLD version would have applied whichever
      // FTE was passed in (a single scalar) to every year uniformly.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2026-01-01", // 3 completed years
          isFirstEverEmployment: true,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2025-01-01", fteFraction: 0.5 },
          ],
        }),
      ).toBe(50); // year1: 20*1=20, year2: 20*1=20, year3: 20*0.5=10
    });

    it("calendar-year transition: the anniversary-based math is continuous across a Dec-to-Jan boundary, with no special-casing needed", () => {
      const input = {
        countryCode: "PL" as const,
        hireDate: "2025-02-01",
        isFirstEverEmployment: true,
        fteFractionHistory: fullTimeFromHire("2025-02-01"),
      };
      // 10 completed months, still mid-first-year, evaluated just before the calendar year turns over.
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2025-12-01" })).toBe(16.67);
      // Exactly 12 completed months, evaluated just after the calendar year turns over: full year-1 amount, no discontinuity.
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2026-02-01" })).toBe(20);
    });
  });

  describe("Poland — prior employment (Art. 1551: calendar-year proportional entitlement, no Art. 153 proration)", () => {
    it("prorates only the remaining months of the hire's calendar year, then grants the full amount from each following 1 January", () => {
      // Hired mid-March 2024 (10 months remaining that calendar year:
      // Mar-Dec inclusive), evaluated 2026-01-01. Even though this is only
      // the employee's SECOND year at Enginious, they are NOT subject to
      // Art. 153's progressive monthly proration at all, because they have
      // worked before (isFirstEverEmployment: false) — distinguishing this
      // from "first year at Enginious" is exactly what this correction
      // round's new explicit field is for.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-03-15",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: false,
          fteFractionHistory: [{ effectiveFrom: "2024-03-15", fteFraction: 1 }],
        }),
      ).toBe(56.67); // 16.67 (10/12 of the 2024 hire-year) + 20 (2025) + 20 (2026)
    });

    it("10-year threshold: crosses partway through the calendar-year loop, affecting only years from that point on", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-06-01",
          asOfDate: "2026-01-01",
          recognisedPriorServiceYears: 5,
          isFirstEverEmployment: false,
          fteFractionHistory: [{ effectiveFrom: "2015-06-01", fteFraction: 1 }],
        }),
      ).toBe(267.67); // 11.67 (2015 hire-year) + 5*20 (2016-2020) + 6*26 (2021-2026)
    });
  });
});

describe("computePolandLeaveDaysFromHours — working-time deduction", () => {
  it("converts a full 8-hour day to exactly 1 day", () => {
    expect(computePolandLeaveDaysFromHours(8)).toBe(1);
  });

  it("prorates a part-time (shorter) scheduled day correctly", () => {
    // A 4-hour scheduled day: requesting the full day off is 1 day of THAT schedule.
    expect(computePolandLeaveDaysFromHours(4, 4)).toBe(1);
    // Requesting a full-time-equivalent 8 hours against a 4-hour scheduled day is 2 days.
    expect(computePolandLeaveDaysFromHours(8, 4)).toBe(2);
  });
});
