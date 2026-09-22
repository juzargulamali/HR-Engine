import { describe, expect, it } from "vitest";
import { resolveDeductionSources, type DeductionRule } from "../src/leaveDeduction";

const COMP_FIRST: DeductionRule[] = [
  { sourceLedger: "comp_day", priorityOrder: 1 },
  { sourceLedger: "leave_ledger", priorityOrder: 2 },
];

describe("resolveDeductionSources", () => {
  it("draws entirely from comp-day when the balance covers the full request", () => {
    expect(resolveDeductionSources(COMP_FIRST, 5, 3)).toEqual([{ sourceLedger: "comp_day", days: 3 }]);
  });

  it("splits across comp-day then leave_ledger when comp-day balance is insufficient", () => {
    expect(resolveDeductionSources(COMP_FIRST, 2, 3)).toEqual([
      { sourceLedger: "comp_day", days: 2 },
      { sourceLedger: "leave_ledger", days: 1 },
    ]);
  });

  it("never draws comp-day when the balance is zero", () => {
    expect(resolveDeductionSources(COMP_FIRST, 0, 3)).toEqual([{ sourceLedger: "leave_ledger", days: 3 }]);
  });

  it("defaults entirely to leave_ledger when no rules are configured", () => {
    expect(resolveDeductionSources([], 10, 3)).toEqual([{ sourceLedger: "leave_ledger", days: 3 }]);
  });

  it("respects priority_order even if rules are passed out of order", () => {
    const reversed: DeductionRule[] = [
      { sourceLedger: "leave_ledger", priorityOrder: 2 },
      { sourceLedger: "comp_day", priorityOrder: 1 },
    ];
    expect(resolveDeductionSources(reversed, 5, 2)).toEqual([{ sourceLedger: "comp_day", days: 2 }]);
  });

  it("never over-draws comp-day beyond the requested amount", () => {
    expect(resolveDeductionSources(COMP_FIRST, 10, 2)).toEqual([{ sourceLedger: "comp_day", days: 2 }]);
  });
});
