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

  it("routes Poland through first-year monthly proration, ignoring recognised prior service/FTE parameters given for other countries", () => {
    // 3 completed months of a full-time, no-prior-service first year -> 20/12*3.
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2026-01-01", asOfDate: "2026-04-01" })).toBe(5);
  });

  it("routes Poland through the full annual grant plus one fresh grant per completed year after the first", () => {
    // 3 years full-time, no recognised prior service: year 1 fully vests at 20,
    // then 2 more full years at the (still 20, under-10-year) current rate.
    expect(computeAnnualLeaveEntitlementToDate({ countryCode: "PL", hireDate: "2023-01-01", asOfDate: "2026-01-01" })).toBe(60);
  });

  it("applies Poland's recognised prior service and FTE fraction to the cumulative total", () => {
    // 6 years actual + 4 recognised prior service crosses the 10-year threshold at part-time 0.5 FTE:
    // year 1 vests at 20*0.5=10 (not yet over the threshold with 0 completed years + 4 recognised = 4 < 10),
    // years 2-6 (5 more completed years) vest at the CURRENT (26*0.5=13) rate each.
    expect(
      computeAnnualLeaveEntitlementToDate({
        countryCode: "PL",
        hireDate: "2020-01-01",
        asOfDate: "2026-01-01",
        recognisedPriorServiceYears: 4,
        fteFraction: 0.5,
      }),
    ).toBe(10 + 5 * 13);
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
