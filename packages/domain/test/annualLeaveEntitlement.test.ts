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

  it("returns 0 (never negative, never an error) for every country when asOfDate is before hireDate", () => {
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "AE", hireDate: "2026-06-01", asOfDate: "2026-01-01" })).toBe(0);
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "SA", hireDate: "2026-06-01", asOfDate: "2026-01-01" })).toBe(0);
    expect(
      computeAnnualLeaveEntitlementToDate({
        countryCode: "PL",
        hireDate: "2026-06-01",
        asOfDate: "2026-01-01",
        isFirstEverEmployment: true,
        fteFractionHistory: [{ effectiveFrom: "2026-06-01", fteFraction: 1 }],
      }),
    ).toBe(0);
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

    it("blocks on any non-zero recognisedPriorServiceYears — this system has no effective-dated record of it yet, so applying one current value across multi-year history is exactly the guess this correction round forbids", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2026-01-01",
          recognisedPriorServiceYears: 3,
          isFirstEverEmployment: true,
          fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1 }],
        }),
      ).toBeNull();
    });

    it("blocks when no contract covers the required period (the first known contract starts after hireDate)", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-01-01",
          asOfDate: "2024-06-01",
          isFirstEverEmployment: true,
          fteFractionHistory: [{ effectiveFrom: "2024-06-01", fteFraction: 1 }], // starts AFTER hireDate
        }),
      ).toBeNull();
    });

    it("blocks on overlapping/conflicting employment_contracts rows (same effectiveFrom, different FTE)", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-01-01",
          isFirstEverEmployment: true,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2023-01-01", fteFraction: 0.5 },
          ],
        }),
      ).toBeNull();
    });

    it("blocks on an invalid FTE fraction — zero, negative, or above 1", () => {
      const base = { countryCode: "PL" as const, hireDate: "2023-01-01", asOfDate: "2023-06-01", isFirstEverEmployment: true };
      expect(computeAnnualLeaveEntitlementToDate({ ...base, fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 0 }] })).toBeNull();
      expect(computeAnnualLeaveEntitlementToDate({ ...base, fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: -0.5 }] })).toBeNull();
      expect(computeAnnualLeaveEntitlementToDate({ ...base, fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1.5 }] })).toBeNull();
    });

    it("blocks when the 10-year recognised-service threshold crosses mid-calendar-year — this system does not implement Art. 154's mid-year 'urlop uzupełniający'", () => {
      // Hired 2015-06-01 with 5 recognised prior years: completedYearsBetween
      // reaches 5 (=10 total with recognised) exactly at the 2020-06-01
      // anniversary, so calendar year 2020 itself starts under the
      // threshold (Jan 1: 4+5=9) and ends over it (Dec 31: 5+5=10) — a
      // genuine mid-year crossing, not a boundary-aligned one.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-06-01",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: false,
          fteFractionHistory: [{ effectiveFrom: "2015-06-01", fteFraction: 1 }],
        }),
      ).toBeNull();
    });
  });

  describe("Poland — first-ever employment (Art. 153 §1: progressive monthly proration, hire-calendar-year only)", () => {
    const fullTimeFromHire = (hireDate: string) => [{ effectiveFrom: hireDate, fteFraction: 1 }];

    it("first-ever job beginning in January: prorates 1/12 per completed month within the first year", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2026-01-01",
          asOfDate: "2026-04-01", // 3 completed months
          isFirstEverEmployment: true,
          fteFractionHistory: fullTimeFromHire("2026-01-01"),
        }),
      ).toBe(5); // 20/12*3 = 5 exactly. NOT rounded up to a whole day (GIP: optional here, unlike every other Poland rounding in this file).
    });

    it("first-ever job beginning 1 October: accrues through October-December, then transitions to full subsequent-year treatment on 1 January — never continuing first-job monthly accrual until the personal anniversary in October", () => {
      // The exact scenario this correction round's QA specified. Per
      // GIP/PIP worked-example guidance, a period starting 1 October
      // completes its first "miesiąc pracy" on 31 October (the hire day
      // counts as day 1) — three such months (Oct, Nov, Dec) complete by
      // 31 December.
      const input = {
        countryCode: "PL" as const,
        hireDate: "2026-10-01",
        isFirstEverEmployment: true,
        fteFractionHistory: fullTimeFromHire("2026-10-01"),
      };
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2026-12-31" })).toBe(5); // 3 months * 20/12 = 5
      // 1 January: the hire-year's Art. 153 contribution is now FIXED at 5
      // (never re-derived from the personal Oct anniversary), PLUS the full
      // 2027 annual entitlement, available immediately from 1 January.
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2027-01-01" })).toBe(25); // 5 + 20
      // Still 25 months later in 2027 — proves 2027's grant was NOT accrued
      // progressively (which would still be climbing toward 20 by October
      // 2027 under the old, incorrect anniversary-continuous model).
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2027-06-01" })).toBe(25);
    });

    it("first-ever job beginning 15 December: zero months complete in the hire year, then the full transition still happens on 1 January", () => {
      const input = {
        countryCode: "PL" as const,
        hireDate: "2026-12-15",
        isFirstEverEmployment: true,
        fteFractionHistory: fullTimeFromHire("2026-12-15"),
      };
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2026-12-31" })).toBe(0); // less than 1 completed "miesiąc pracy" by year end
      expect(computeAnnualLeaveEntitlementToDate({ ...input, asOfDate: "2027-01-01" })).toBe(20); // 0 (locked in) + full 2027 grant
    });

    it("credits each subsequent completed calendar year in full, at that year's own (here, unchanging) rate", () => {
      // Hired 2023-01-01: 2023 (Art. 153, 12 months) = 20; 2024, 2025, 2026
      // each get the FULL annual entitlement immediately from their own
      // 1 January — 2026 counts in full because asOfDate has reached it,
      // even though asOfDate is 2026's very first day.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: true,
          fteFractionHistory: fullTimeFromHire("2023-01-01"),
        }),
      ).toBe(80); // 20 (2023) + 20 (2024) + 20 (2025) + 20 (2026)
    });

    it("10-year threshold: only the years actually at/after the threshold are credited at 26 — earlier years are never restated at the later rate", () => {
      // Hired 2015-01-01 (so every anniversary aligns exactly with a
      // calendar year, avoiding a mid-year crossing): 2015 (Art. 153) = 20;
      // 2016-2024 (completedServiceYears 1-9, all <10) = 20 each; 2025-2026
      // (completedServiceYears 10-11) = 26 each. The OLD "deliberate
      // simplification" this replaces would have wrongly applied 26 to
      // every year just because the CURRENT completedYears is over the
      // threshold.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-01-01",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: true,
          fteFractionHistory: fullTimeFromHire("2015-01-01"),
        }),
      ).toBe(252); // 20 (2015) + 9*20 (2016-2024) + 2*26 (2025-2026)
    });

    it("mid-tenure FTE decrease at a year boundary: only the years after the change are prorated at the new fraction", () => {
      // Full-time through 2024, drops to half-time from 2025-01-01. The OLD
      // version would have applied whichever FTE was passed in (a single
      // scalar) to every year uniformly.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: true,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2025-01-01", fteFraction: 0.5 },
          ],
        }),
      ).toBe(60); // 20 (2023) + 20 (2024) + 10 (2025, half-time) + 10 (2026, half-time)
    });
  });

  describe("Poland — prior employment (Art. 1551 + Art. 1553 §1: calendar-year proportional entitlement, mandatory whole-day rounding UP, no Art. 153 proration)", () => {
    it("prorates only the remaining WHOLE calendar months of the hire's calendar year (rounded UP to a whole day), then grants the full amount from each following 1 January", () => {
      // Hired mid-March 2024 (10 whole calendar months remaining: Mar-Dec
      // inclusive — the partial hire month counts in full), evaluated
      // 2026-01-01. Even though this is only the employee's SECOND year at
      // Enginious, they are NOT subject to Art. 153's progressive monthly
      // proration at all, because they have worked before
      // (isFirstEverEmployment: false) — distinguishing this from "first
      // year at Enginious" is exactly what this correction round's
      // explicit field is for. ceil(20/12*10) = ceil(16.667) = 17, NOT the
      // 16.67 a generic round-to-2-decimals would give — Art. 1553 §1
      // requires whole-day rounding up here, unlike Art. 153.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2024-03-15",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: false,
          fteFractionHistory: [{ effectiveFrom: "2024-03-15", fteFraction: 1 }],
        }),
      ).toBe(57); // 17 (2024 hire-year, ceiling-rounded) + 20 (2025) + 20 (2026)
    });

    it("10-year threshold, no mid-year crossing (hired 1 January so every anniversary aligns with a calendar year): computes normally", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-01-01",
          asOfDate: "2026-01-01",
          isFirstEverEmployment: false,
          fteFractionHistory: [{ effectiveFrom: "2015-01-01", fteFraction: 1 }],
        }),
      ).toBe(252); // identical structure to the first-ever case above once the hire month is January — 20 (2015) + 9*20 + 2*26
    });

    it("mid-calendar-year FTE change: BLOCKS the year it falls in, rather than splitting and pricing it — this system deliberately does not compute a mixed-FTE period", () => {
      // Hired 2023-01-01 full-time; evaluated 2024-12-31, with FTE dropping
      // to a quarter from 2024-07-01. 2023 (constant FTE throughout) would
      // still compute fine on its own, but the cumulative entitlement-to-
      // date this function returns is a single figure for the whole
      // tenure, and 2024 (the year actually being priced as of asOfDate)
      // has two different FTE fractions within it — HR must post the
      // confirmed 2024 amount manually via postLeaveLedgerAdjustment()
      // instead of this system computing (or approximating) it.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-12-31",
          isFirstEverEmployment: false,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2024-07-01", fteFraction: 0.25 },
          ],
        }),
      ).toBeNull();
      expect(
        explainPolandEntitlementBlock({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-12-31",
          isFirstEverEmployment: false,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2024-07-01", fteFraction: 0.25 },
          ],
        }),
      ).toMatch(/FTE changes during/);
    });

    it("mid-calendar-year FTE increase also blocks that year, symmetrically with a decrease", () => {
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-12-31",
          isFirstEverEmployment: false,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 0.5 },
            { effectiveFrom: "2024-04-01", fteFraction: 1 },
          ],
        }),
      ).toBeNull();
    });

    it("an FTE change effective exactly on 1 January (a year boundary, not mid-year) does NOT block — each year individually still has one constant FTE throughout", () => {
      // Full-time in 2023, half-time from 2024-01-01 onward — every
      // calendar year on its own has exactly one FTE for its entire span.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2023-01-01",
          asOfDate: "2024-12-31",
          isFirstEverEmployment: false,
          fteFractionHistory: [
            { effectiveFrom: "2023-01-01", fteFraction: 1 },
            { effectiveFrom: "2024-01-01", fteFraction: 0.5 },
          ],
        }),
      ).toBe(30); // 20 (2023, full-time) + 10 (2024, half-time)
    });

    it("termination-adjacent boundary: a mid-year asOfDate in a later, fully-reached calendar year still returns that whole year's entitlement, already fully credited — this function assumes continued employment and must NOT be used directly for a terminating employee's own prorated exit-year settlement", () => {
      // Same scenario as the 10-year-threshold test above, but asOfDate is
      // 2026-03-15 (e.g. a hypothetical last working day) instead of
      // 2026-01-01 — the total is identical, because 2026's full
      // entitlement was already available from 2026-01-01, per Art. 1551's
      // "immediately, not accrued progressively" principle for a
      // continuing employee. A REAL termination settlement needs its own,
      // separate proportional-exit-year calculation (see terminate_employee()
      // / forfeit_recovery_leave_on_termination elsewhere in this codebase);
      // this calculator does not perform one.
      expect(
        computeAnnualLeaveEntitlementToDate({
          countryCode: "PL",
          hireDate: "2015-01-01",
          asOfDate: "2026-03-15",
          isFirstEverEmployment: false,
          fteFractionHistory: [{ effectiveFrom: "2015-01-01", fteFraction: 1 }],
        }),
      ).toBe(252);
    });
  });
});

describe("explainPolandEntitlementBlock — surfaces the specific HR configuration requirement behind a null result", () => {
  it("returns null (not blocked) for AE/SA and for a Poland calculation that completes successfully", () => {
    expect(explainPolandEntitlementBlock({ countryCode: "AE", hireDate: "2020-01-01", asOfDate: "2026-01-01" })).toBeNull();
    expect(
      explainPolandEntitlementBlock({
        countryCode: "PL",
        hireDate: "2023-01-01",
        asOfDate: "2026-01-01",
        isFirstEverEmployment: true,
        fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1 }],
      }),
    ).toBeNull();
  });

  it("names the specific reason for each distinct block condition", () => {
    expect(explainPolandEntitlementBlock({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01" })).toMatch(/is_first_ever_employment/);
    expect(
      explainPolandEntitlementBlock({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01", isFirstEverEmployment: true }),
    ).toMatch(/employment_contracts history/);
    expect(
      explainPolandEntitlementBlock({
        countryCode: "PL",
        hireDate: "2023-01-01",
        asOfDate: "2026-01-01",
        recognisedPriorServiceYears: 2,
        isFirstEverEmployment: true,
        fteFractionHistory: [{ effectiveFrom: "2023-01-01", fteFraction: 1 }],
      }),
    ).toMatch(/reference data only/);
    expect(
      explainPolandEntitlementBlock({
        countryCode: "PL",
        hireDate: "2015-06-01",
        asOfDate: "2026-01-01",
        isFirstEverEmployment: false,
        fteFractionHistory: [{ effectiveFrom: "2015-06-01", fteFraction: 1 }],
      }),
    ).toMatch(/urlop uzupełniający/);
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
