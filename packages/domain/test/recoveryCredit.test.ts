import { describe, expect, it } from "vitest";
import { computeOvernightRecoveryCredit, computeStandardRecoveryCredit, selectOldestFirstConsumption } from "../src/recoveryCredit";

describe("computeStandardRecoveryCredit", () => {
  it("grants nothing on a routine working day, regardless of hours", () => {
    expect(
      computeStandardRecoveryCredit({ isScheduledRestDay: false, isPublicHoliday: false, activeHoursWorked: 10 }),
    ).toEqual({ days: 0, reason: "none" });
  });

  it("grants 0.5 day for up to and including 4 hours on a scheduled rest day", () => {
    expect(computeStandardRecoveryCredit({ isScheduledRestDay: true, isPublicHoliday: false, activeHoursWorked: 4 })).toEqual({
      days: 0.5,
      reason: "rest_day_worked",
    });
  });

  it("grants 1 day for more than 4 hours on a public holiday", () => {
    expect(computeStandardRecoveryCredit({ isScheduledRestDay: false, isPublicHoliday: true, activeHoursWorked: 4.5 })).toEqual({
      days: 1,
      reason: "public_holiday_worked",
    });
  });

  it("grants nothing for zero active hours even on an eligible day", () => {
    expect(computeStandardRecoveryCredit({ isScheduledRestDay: true, isPublicHoliday: false, activeHoursWorked: 0 })).toEqual({
      days: 0,
      reason: "none",
    });
  });
});

describe("computeOvernightRecoveryCredit — exceptional overnight extension", () => {
  it("grants nothing when work ends exactly at midnight", () => {
    expect(
      computeOvernightRecoveryCredit({ completedNormalScheduledDay: true, workContinuedPastMidnight: false, activeHoursAfterMidnight: 0 }),
    ).toEqual({ days: 0, reason: "none" });
  });

  it("grants 0.5 day for work continuing to 2:00am (2 active hours after midnight)", () => {
    expect(
      computeOvernightRecoveryCredit({ completedNormalScheduledDay: true, workContinuedPastMidnight: true, activeHoursAfterMidnight: 2 }),
    ).toEqual({ days: 0.5, reason: "overnight_extension" });
  });

  it("grants 0.5 day for work continuing to exactly 4:00am (4 active hours — the inclusive boundary)", () => {
    expect(
      computeOvernightRecoveryCredit({ completedNormalScheduledDay: true, workContinuedPastMidnight: true, activeHoursAfterMidnight: 4 }),
    ).toEqual({ days: 0.5, reason: "overnight_extension" });
  });

  it("grants 1 day for work continuing to 5:00am (5 active hours — over the threshold)", () => {
    expect(
      computeOvernightRecoveryCredit({ completedNormalScheduledDay: true, workContinuedPastMidnight: true, activeHoursAfterMidnight: 5 }),
    ).toEqual({ days: 1, reason: "overnight_extension" });
  });

  it("requires the normal scheduled day to have been completed first", () => {
    expect(
      computeOvernightRecoveryCredit({ completedNormalScheduledDay: false, workContinuedPastMidnight: true, activeHoursAfterMidnight: 5 }),
    ).toEqual({ days: 0, reason: "none" });
  });
});

describe("selectOldestFirstConsumption", () => {
  it("draws from the entry expiring soonest first", () => {
    const entries = [
      { id: "later", entryType: "earned" as const, days: 1, txnDate: "2026-01-01", expiryDate: "2026-07-01" },
      { id: "sooner", entryType: "earned" as const, days: 1, txnDate: "2026-02-01", expiryDate: "2026-06-01" },
    ];
    expect(selectOldestFirstConsumption(entries, 1)).toEqual([{ earnedEntryId: "sooner", days: 1 }]);
  });

  it("spans multiple earned entries when one alone isn't enough", () => {
    const entries = [
      { id: "a", entryType: "earned" as const, days: 0.5, txnDate: "2026-01-01", expiryDate: "2026-06-01" },
      { id: "b", entryType: "earned" as const, days: 1, txnDate: "2026-02-01", expiryDate: "2026-07-01" },
    ];
    expect(selectOldestFirstConsumption(entries, 1)).toEqual([
      { earnedEntryId: "a", days: 0.5 },
      { earnedEntryId: "b", days: 0.5 },
    ]);
  });

  it("accounts for already-consumed/expired/reversed amounts before drawing", () => {
    const entries = [
      { id: "a", entryType: "earned" as const, days: 1, txnDate: "2026-01-01", expiryDate: "2026-06-01" },
      { id: "b", entryType: "earned" as const, days: 1, txnDate: "2026-02-01", expiryDate: "2026-07-01" },
      { id: "r1", entryType: "redeemed" as const, days: -1, txnDate: "2026-03-01", expiryDate: null },
    ];
    // "a" is fully spoken for by the redemption; the next request should draw from "b".
    expect(selectOldestFirstConsumption(entries, 1)).toEqual([{ earnedEntryId: "b", days: 1 }]);
  });

  it("never allows drawing more than the available balance — returns null instead of going negative", () => {
    const entries = [{ id: "a", entryType: "earned" as const, days: 0.5, txnDate: "2026-01-01", expiryDate: "2026-06-01" }];
    expect(selectOldestFirstConsumption(entries, 1)).toBeNull();
  });

  it("treats an expired entry's remaining balance as unavailable", () => {
    const entries = [
      { id: "a", entryType: "earned" as const, days: 1, txnDate: "2026-01-01", expiryDate: "2026-02-01" },
      { id: "exp1", entryType: "expired" as const, days: -1, txnDate: "2026-02-01", expiryDate: null },
    ];
    expect(selectOldestFirstConsumption(entries, 0.5)).toBeNull();
  });
});
