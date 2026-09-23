import { describe, expect, it } from "vitest";
import { computeFinalSettlement, type EosbPolicyPayload } from "../src/finalSettlement";

const UAE_STYLE_TIERS: EosbPolicyPayload = {
  tiers: [
    { upToYears: 5, daysPerYear: 21 },
    { upToYears: null, daysPerYear: 30 },
  ],
};

describe("computeFinalSettlement", () => {
  it("returns zero EOSB when no policy is configured, but still encashes leave and pending claims", () => {
    const result = computeFinalSettlement({
      hireDate: "2020-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: 10,
      pendingApprovedReimbursements: 250,
      outstandingLoans: 0,
      eosbPolicy: null,
    });
    expect(result.eosbAmount).toBe(0);
    expect(result.leaveEncashmentAmount).toBe(1000);
    expect(result.pendingReimbursementsAmount).toBe(250);
    expect(result.totalAmount).toBe(1250);
  });

  it("applies only the first tier's rate for service entirely within it", () => {
    // Exactly 3 years of service, well under the 5-year threshold.
    const result = computeFinalSettlement({
      hireDate: "2023-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: 0,
      pendingApprovedReimbursements: 0,
      outstandingLoans: 0,
      eosbPolicy: UAE_STYLE_TIERS,
    });
    // ~3 years * 21 days/year * 100/day
    expect(result.eosbAmount).toBeCloseTo(3 * 21 * 100, -1);
  });

  it("blends tier rates for service that crosses the threshold", () => {
    // 8 years: 5 years at 21 days/year + 3 years at 30 days/year.
    const result = computeFinalSettlement({
      hireDate: "2018-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: 0,
      pendingApprovedReimbursements: 0,
      outstandingLoans: 0,
      eosbPolicy: UAE_STYLE_TIERS,
    });
    const expected = (5 * 21 + 3 * 30) * 100;
    expect(result.eosbAmount).toBeCloseTo(expected, -1);
  });

  it("never produces a negative amount for a termination date before the hire date (data error)", () => {
    const result = computeFinalSettlement({
      hireDate: "2026-01-01",
      terminationDate: "2020-01-01",
      dailyRate: 100,
      unusedLeaveDays: 0,
      pendingApprovedReimbursements: 0,
      outstandingLoans: 0,
      eosbPolicy: UAE_STYLE_TIERS,
    });
    expect(result.eosbAmount).toBe(0);
    expect(result.yearsOfService).toBe(0);
  });

  it("floors a negative unused-leave balance (over-drawn) at zero encashment rather than paying negative", () => {
    const result = computeFinalSettlement({
      hireDate: "2020-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: -5,
      pendingApprovedReimbursements: 0,
      outstandingLoans: 0,
      eosbPolicy: null,
    });
    expect(result.leaveEncashmentAmount).toBe(0);
  });

  it("sums all three components into totalAmount", () => {
    const result = computeFinalSettlement({
      hireDate: "2020-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 50,
      unusedLeaveDays: 4,
      pendingApprovedReimbursements: 300,
      outstandingLoans: 0,
      eosbPolicy: UAE_STYLE_TIERS,
    });
    expect(result.totalAmount).toBeCloseTo(result.leaveEncashmentAmount + result.eosbAmount + result.pendingReimbursementsAmount, 5);
  });

  it("nets outstanding loans/cash advances against the payout instead of adding them", () => {
    const withoutLoan = computeFinalSettlement({
      hireDate: "2020-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: 10,
      pendingApprovedReimbursements: 0,
      outstandingLoans: 0,
      eosbPolicy: null,
    });
    const withLoan = computeFinalSettlement({
      hireDate: "2020-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: 10,
      pendingApprovedReimbursements: 0,
      outstandingLoans: 400,
      eosbPolicy: null,
    });
    expect(withLoan.loanDeductionsAmount).toBe(400);
    expect(withLoan.totalAmount).toBe(withoutLoan.totalAmount - 400);
  });

  it("never lets a negative outstandingLoans value (data error) increase the payout", () => {
    const result = computeFinalSettlement({
      hireDate: "2020-01-01",
      terminationDate: "2026-01-01",
      dailyRate: 100,
      unusedLeaveDays: 0,
      pendingApprovedReimbursements: 0,
      outstandingLoans: -100,
      eosbPolicy: null,
    });
    expect(result.loanDeductionsAmount).toBe(0);
  });
});
