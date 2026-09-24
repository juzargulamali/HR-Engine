import { describe, expect, it } from "vitest";
import { classifyLedgerRows, type AnnualLeaveLedgerRow } from "./classifyLedgerRows";

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const KEY = `${EMPLOYEE_ID}:annual`;

function row(overrides: Partial<AnnualLeaveLedgerRow> & Pick<AnnualLeaveLedgerRow, "id" | "entry_type">): AnnualLeaveLedgerRow {
  return {
    employee_id: EMPLOYEE_ID,
    leave_type_code: "annual",
    amount_days: 0,
    reference_type: null,
    reversal_of_id: null,
    ...overrides,
  };
}

describe("classifyLedgerRows — Round G/H: a system-generated 'termination_settlement' adjustment must be deterministic, not ambiguous", () => {
  it("includes a POSITIVE termination_settlement adjustment in the grant baseline with its signed amount", () => {
    const rows = [
      row({ id: "a1", entry_type: "accrual", amount_days: 13, reference_type: "policy_run" }),
      row({ id: "t1", entry_type: "adjustment", amount_days: 5, reference_type: "termination_settlement" }),
    ];
    const { grantTotalByKey, ambiguousKeys } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(KEY)).toBe(false);
    expect(grantTotalByKey.get(KEY)).toBe(18);
  });

  it("includes a NEGATIVE termination_settlement adjustment (a clawback) in the grant baseline with its signed amount", () => {
    // The realistic case: the cron already granted a full 26, the employee
    // left mid-year with a true entitlement of 13, so the true-up posts -13.
    const rows = [
      row({ id: "a1", entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }),
      row({ id: "t1", entry_type: "adjustment", amount_days: -13, reference_type: "termination_settlement" }),
    ];
    const { grantTotalByKey, ambiguousKeys } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(KEY)).toBe(false);
    expect(grantTotalByKey.get(KEY)).toBe(13);
  });

  it("an arbitrary manual adjustment (not opening_balance or termination_settlement) still flags the key ambiguous", () => {
    // The key still ends up in ambiguousKeys — the caller (the cron,
    // applyPolandTerminationLeaveTrueUp) must check that set BEFORE trusting
    // grantTotalByKey at all; grantTotalByKey itself still accumulates
    // whatever unambiguous rows exist (the accrual here), unaffected by the
    // presence of an unrelated ambiguous row for the same key.
    const rows = [
      row({ id: "a1", entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }),
      row({ id: "m1", entry_type: "adjustment", amount_days: 7, reference_type: "manual_adjustment" }),
    ];
    const { ambiguousKeys } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(KEY)).toBe(true);
  });

  it("an adjustment with a null reference_type still flags the key ambiguous (never silently treated as deterministic)", () => {
    const rows = [row({ id: "n1", entry_type: "adjustment", amount_days: 3, reference_type: null })];
    const { ambiguousKeys } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(KEY)).toBe(true);
  });

  it("a reversal of a termination_settlement adjustment nets against it correctly, leaving zero net grant", () => {
    const rows = [
      row({ id: "a1", entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }),
      row({ id: "t1", entry_type: "adjustment", amount_days: -13, reference_type: "termination_settlement" }),
      row({ id: "r1", entry_type: "reversal", amount_days: 13, reference_type: "termination_settlement", reversal_of_id: "t1" }),
    ];
    const { grantTotalByKey, ambiguousKeys } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(KEY)).toBe(false);
    // 26 (accrual) - 13 (the clawback) + 13 (the clawback reversed) = 26 net.
    expect(grantTotalByKey.get(KEY)).toBe(26);
  });

  it("retrying the termination orchestration after a successful adjustment reaches the database idempotency check — the prior termination_settlement row is never itself reported as ambiguous", () => {
    // Mirrors exactly what applyPolandTerminationLeaveTrueUp() re-reads on a
    // retry: an accrual plus the already-posted termination_settlement
    // adjustment from the first, successful call. Before this correction,
    // that adjustment row (reference_type !== 'opening_balance') would have
    // flagged the key ambiguous, so a RETRY would incorrectly report "an
    // unclassified adjustment exists" instead of ever reaching
    // post_poland_termination_leave_adjustment()'s own idempotency check.
    const rows = [
      row({ id: "a1", entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }),
      row({ id: "t1", entry_type: "adjustment", amount_days: -13, reference_type: "termination_settlement" }),
    ];
    const { ambiguousKeys } = classifyLedgerRows(rows);
    expect(ambiguousKeys.has(KEY)).toBe(false);
  });

  it("the accrual cron's own delta math (entitlement - grantTotal) correctly reflects a termination clawback, so it never re-grants days the true-up removed", () => {
    // If a terminated employee were ever reactivated, the cron's own
    // grantTotalByKey (lifetime, not per-year) must already reflect the
    // clawback so entitlementToDate - grantTotal doesn't re-post the
    // reclaimed days a second time.
    const rows = [
      row({ id: "a1", entry_type: "accrual", amount_days: 26, reference_type: "policy_run" }),
      row({ id: "t1", entry_type: "adjustment", amount_days: -13, reference_type: "termination_settlement" }),
    ];
    const { grantTotalByKey } = classifyLedgerRows(rows);
    const entitlementToDate = 13; // what computeAnnualLeaveEntitlementToDate would say for this same partial year
    const delta = entitlementToDate - (grantTotalByKey.get(KEY) ?? 0);
    expect(delta).toBe(0); // nothing left to (re-)grant
  });
});
