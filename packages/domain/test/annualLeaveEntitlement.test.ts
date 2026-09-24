import { describe, expect, it } from "vitest";
import {
  completedMonthsBetween,
  computeAnnualLeaveEntitlementToDate,
  computePolandAnnualLeaveEntitlementDays,
  computePolandLeaveDaysFromHours,
  computeSaudiAnnualLeaveEntitlementDays,
  computeSaudiAnnualLeaveRateDaysPerYear,
  computeUaeAnnualLeaveEntitlementDays,
  explainPolandEntitlementBlock,
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

describe("computeUaeAnnualLeaveEntitlementDays — unaffected by the Poland flat-benefit correction", () => {
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

describe("computeSaudiAnnualLeaveRateDaysPerYear — five-year threshold, unaffected by the Poland correction", () => {
  it("is 21 days/year under five consecutive years", () => {
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2023-01-01", "2026-01-01")).toBe(21); // 3 years
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2022-01-01", "2026-12-31")).toBe(21); // just under 5 years
  });

  it("becomes 30 days/year exactly at five completed years, and stays 30 after", () => {
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2021-01-01", "2026-01-01")).toBe(30); // exactly 5 years
    expect(computeSaudiAnnualLeaveRateDaysPerYear("2010-01-01", "2026-01-01")).toBe(30); // 16 years
  });
});

describe("computeSaudiAnnualLeaveEntitlementDays — cumulative, not just the current rate, unaffected by the Poland correction", () => {
  it("credits each of the first five years at 21 days/year", () => {
    expect(computeSaudiAnnualLeaveEntitlementDays("2023-01-01", "2026-01-01")).toBe(63); // 3 years * 21
  });

  it("credits years beyond the fifth at 30 days/year, on top of 5*21 for the first five", () => {
    expect(computeSaudiAnnualLeaveEntitlementDays("2018-01-01", "2026-01-01")).toBe(5 * 21 + 3 * 30); // 8 years
  });
});

describe("computePolandAnnualLeaveEntitlementDays — flat 26-day Enginious company benefit (no threshold, no service-years input)", () => {
  it("is 26 working days/year full-time, regardless of tenure", () => {
    expect(computePolandAnnualLeaveEntitlementDays()).toBe(26);
    expect(computePolandAnnualLeaveEntitlementDays({})).toBe(26);
    expect(computePolandAnnualLeaveEntitlementDays({ fteFraction: 1 })).toBe(26);
  });

  it("prorates for part-time by fteFraction, rounded UP to a whole day", () => {
    expect(computePolandAnnualLeaveEntitlementDays({ fteFraction: 0.5 })).toBe(13);
    expect(computePolandAnnualLeaveEntitlementDays({ fteFraction: 0.75 })).toBe(20); // ceil(19.5)
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

  it("returns 0 (never negative, never an error) for every country when asOfDate is before hireDate", () => {
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "AE", hireDate: "2026-06-01", asOfDate: "2026-01-01" })).toBe(0);
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "SA", hireDate: "2026-06-01", asOfDate: "2026-01-01" })).toBe(0);
    expect(
      computeAnnualLeaveEntitlementToDate({
        countryCode: "PL",
        hireDate: "2026-06-01",
        asOfDate: "2026-01-01",
        fteFractionHistory: [{ effectiveFrom: "2026-06-01", fteFraction: 1 }],
      }),
    ).toBe(0);
  });

  describe("Poland — flat 26-day Enginious company benefit (supersedes the statutory 20/26 threshold, Art. 153 first-ever-employment proration, and Art. 154 supplementary leave)", () => {
    it("every full-time Poland employee receives 26 days for a complete calendar year", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2023-12-31",
          fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1 }],
        }),
      ).toBe(26);
    });

    it("credits each subsequent completed calendar year in full, at the same flat 26-day rate — no 10-year threshold, ever", () => {
      // Hired 2015-01-01 (11 subsequent calendar years: 2016..2026), evaluated
      // 2026-01-01. Under the OLD statutory rules this employee would have
      // crossed the 10-year threshold partway through and be credited 26
      // only from 2025 onward; the flat company benefit makes every single
      // year — including the hire year and every year before 2025 — 26.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-01-01",
          asOfDate: "2026-01-01",
          fteFractionHistory: [{ effectiveFrom: "2015-01-01", fteFraction: 1 }],
        }),
      ).toBe(26 * 12); // hire year (2015) + 11 subsequent years (2016-2026), all at 26
    });

    it("recognisedPriorServiceYears and isFirstEverEmployment are no longer part of this function's input — passing them (as legacy/reference-only employee columns) has no effect on the result", () => {
      // These fields are retained on the employees table as optional HR
      // reference data only (requirement: "keep the columns to avoid an
      // unnecessary schema reversal"), but computeAnnualLeaveEntitlementToDate
      // no longer accepts or reads them at all for Poland. A caller that
      // still has these values sitting on an employee record (e.g. the cron
      // route, before this correction, used to forward them) and passes them
      // through anyway must see the identical result as a caller that omits
      // them entirely.
      const withoutLegacyFields = {
        countryCode: "PL" as const,
        hireDate: "2023-01-01",
        asOfDate: "2023-12-31",
        fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1 }],
      };
      const withLegacyFieldsSetOne = { ...withoutLegacyFields, isFirstEverEmployment: true, recognisedPriorServiceYears: 0 };
      const withLegacyFieldsSetTwo = { ...withoutLegacyFields, isFirstEverEmployment: false, recognisedPriorServiceYears: 15 };
      const withLegacyFieldsUnconfirmed = { ...withoutLegacyFields, isFirstEverEmployment: null, recognisedPriorServiceYears: undefined };

      const baseline = computeAnnualLeaveEntitlementToDate(withoutLegacyFields);
      expect(baseline).toBe(26);
      expect(computeAnnualLeaveEntitlementToDate(withLegacyFieldsSetOne)).toBe(baseline);
      expect(computeAnnualLeaveEntitlementToDate(withLegacyFieldsSetTwo)).toBe(baseline);
      expect(computeAnnualLeaveEntitlementToDate(withLegacyFieldsUnconfirmed)).toBe(baseline);
    });

    it("new starter: prorates the 26-day benefit for the remaining WHOLE calendar months of the hire year (partial month counts in full), rounded UP to a whole day", () => {
      // Hired 15 March 2024: 10 whole calendar months remain in 2024
      // (March-December inclusive). ceil(26/12*10) = ceil(21.667) = 22.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-03-15",
          asOfDate: "2024-12-31",
          fteFractionHistory: [{ effectiveFrom: "2024-03-15", fteFraction: 1 }],
        }),
      ).toBe(22);

      // Carried into the following two full calendar years: 22 (2024) + 26
      // (2025) + 26 (2026) = 74. Do NOT reintroduce first-ever-employment
      // progressive monthly accrual here — this is the same calendar-month
      // proration path used for every Poland employee.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-03-15",
          asOfDate: "2026-01-01",
          fteFractionHistory: [{ effectiveFrom: "2024-03-15", fteFraction: 1 }],
        }),
      ).toBe(74);
    });

    it("leaver / a mid-year asOfDate in a later, fully-reached calendar year still returns that whole year's entitlement, already fully credited from 1 January", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-01-01",
          asOfDate: "2026-03-15",
          fteFractionHistory: [{ effectiveFrom: "2015-01-01", fteFraction: 1 }],
        }),
      ).toBe(26 * 12); // identical total to the 2026-01-01 case above
    });

    it("stable part-time employee: prorates the flat 26-day benefit by a constant FTE across a full calendar year", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2023-12-31",
          fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 0.5 }],
        }),
      ).toBe(13); // ceil(26 * 0.5)

      // Stable part-time across multiple full years too.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2025-01-01",
          fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 0.5 }],
        }),
      ).toBe(39); // 13 (2023) + 13 (2024) + 13 (2025)
    });

    it("a part-time new starter is prorated by both the calendar-month remainder AND the FTE fraction", () => {
      // Hired 1 July 2024 at half-time: 6 whole calendar months remain.
      // ceil(26/12*6*0.5) = ceil(6.5) = 7.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-07-01",
          asOfDate: "2024-12-31",
          fteFractionHistory: [{ effectiveFrom: "2024-07-01", fteFraction: 0.5 }],
        }),
      ).toBe(7);
    });

    it("an FTE change during the relevant calendar year BLOCKS automatic posting for that year and requires an audited HR adjustment — this system deliberately does not split or price a mixed-FTE period", () => {
      // Full-time through 2023; drops to a quarter mid-2024. 2023 alone
      // would compute fine, but the cumulative to-date figure this function
      // returns covers the whole tenure, and 2024 (the year being priced as
      // of asOfDate) contains two different FTE fractions.
      const input = {
        countryCode: "PL" as const,
        hireDate: "2023-01-01",
        asOfDate: "2024-12-31",
        fteFractionHistory: [
          { effectiveFrom: "2023-01-01", fteFraction: 1 },
          { effectiveFrom: "2024-07-01", fteFraction: 0.25 },
        ],
      };
      expect(computeAnnualLeaveEntitlementToDate(input)).toBeNull();
      expect(explainPolandEntitlementBlock(input)).toMatch(/FTE changes during/);
    });

    it("mid-calendar-year FTE increase also blocks that year, symmetrically with a decrease", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-12-31",
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 0.5 },
            { effectiveFrom: "2024-04-01", fteFraction: 1 },
          ],
        }),
      ).toBeNull();
    });

    it("an FTE change effective exactly on 1 January (a year boundary, not mid-year) does NOT block — each year individually still has one constant FTE throughout", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-12-31",
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2024-01-01", fteFraction: 0.5 },
          ],
        }),
      ).toBe(39); // 26 (2023, full-time) + 13 (2024, half-time)
    });

    it("contract history ambiguity still blocks — missing FTE history, a gap, an overlapping/conflicting row, or an out-of-range fraction", () => {
      expect(computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01" })).toBeNull();
      expect(computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01", fteFractionHistory: [] })).toBeNull();
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-01-01",
          asOfDate: "2024-06-01",
          fteFractionHistory: [{ effectiveFrom: "2024-06-01", fteFraction: 1 }], // starts AFTER hireDate
        }),
      ).toBeNull();
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-01-01",
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2023-01-01", fteFraction: 0.5 },
          ],
        }),
      ).toBeNull();
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2023-06-01",
          fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1.5 }],
        }),
      ).toBeNull();
    });
  });
});

describe("explainPolandEntitlementBlock — surfaces the specific HR configuration requirement behind a null result, with no reference to the removed threshold/first-employment machinery", () => {
  it("returns null (not blocked) for AE/SA and for a Poland calculation that completes successfully", () => {
    expect(explainPolandEntitlementBlock({ countryCode: "AE", hireDate: "2020-01-01", asOfDate: "2026-01-01" })).toBeNull();
    expect(
      explainPolandEntitlementBlock({
        countryCode: "PL",
        hireDate: "2023-01-01",
        asOfDate: "2026-01-01",
        fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1 }],
      }),
    ).toBeNull();
  });

  it("names the specific reason for each remaining block condition — never is_first_ever_employment or recognisedPriorServiceYears, since those no longer gate anything", () => {
    expect(explainPolandEntitlementBlock({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01" })).toMatch(/employment_contracts history/);
    expect(explainPolandEntitlementBlock({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01" })).not.toMatch(/is_first_ever_employment/);
    expect(
      explainPolandEntitlementBlock({
        countryCode: "PL",
        hireDate: "2023-01-01",
        asOfDate: "2024-12-31",
        fteFractionHistory: [
          { effectiveFrom: "2023-01-01", fteFraction: 1 },
          { effectiveFrom: "2024-07-01", fteFraction: 0.25 },
        ],
      }),
    ).toMatch(/FTE changes during/);
  });
});

describe("computePolandLeaveDaysFromHours — working-time deduction, unaffected by the entitlement-base correction", () => {
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
