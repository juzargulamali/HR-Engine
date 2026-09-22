/**
 * Deterministic mirror of the deduction loop inside `decide_leave_approval()`
 * (supabase/migrations/20260926000000_phase3_leave_and_approvals.sql) — used
 * for the UI preview ("this request will draw 2 comp-days, then 1 from
 * annual leave") shown before submission. The actual posting happens
 * atomically inside that Postgres function, not here; this function is
 * kept deliberately simple and cross-referenced so the two can't quietly
 * drift apart. The RLS test suite exercises the real (SQL) path.
 */
export interface DeductionRule {
  sourceLedger: "comp_day" | "leave_ledger";
  priorityOrder: number;
}

export interface DeductionPlanStep {
  sourceLedger: "comp_day" | "leave_ledger";
  days: number;
}

export function resolveDeductionSources(
  rules: readonly DeductionRule[],
  compDayBalance: number,
  requestedDays: number,
): DeductionPlanStep[] {
  const sortedRules = [...rules].sort((a, b) => a.priorityOrder - b.priorityOrder);
  const plan: DeductionPlanStep[] = [];
  let remaining = requestedDays;

  for (const rule of sortedRules) {
    if (remaining <= 0) break;
    if (rule.sourceLedger === "comp_day") {
      const draw = Math.min(remaining, Math.max(compDayBalance, 0));
      if (draw > 0) {
        plan.push({ sourceLedger: "comp_day", days: draw });
        remaining -= draw;
      }
    } else {
      plan.push({ sourceLedger: "leave_ledger", days: remaining });
      remaining = 0;
    }
  }

  // No rule configured for this leave type at all, or the rules didn't
  // cover the full amount — default behavior: the rest comes from the
  // leave type's own ledger (matches decide_leave_approval()'s fallback).
  if (remaining > 0) {
    plan.push({ sourceLedger: "leave_ledger", days: remaining });
  }

  return plan;
}
