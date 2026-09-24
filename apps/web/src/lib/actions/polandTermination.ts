import { computePolandAnnualLeaveEntitlementAtTermination, explainPolandTerminationEntitlementBlock, type FteFractionPeriod } from "@enginious-hr/domain";
import { classifyLedgerRows, type AnnualLeaveLedgerRow } from "@/lib/leaveLedger/classifyLedgerRows";
import { createClient } from "@/lib/supabase/server";

/**
 * Poland-only: true up the 'annual' leave_ledger balance to the employee's
 * actual prorated entitlement through their termination date, called
 * immediately after terminate_employee() flips their status (see
 * updateEmployee() in lib/actions/employees.ts) — BEFORE Final Settlement
 * (final-settlement-section.tsx) ever reads the balance. The monthly
 * accrual cron may already have posted a full calendar year's 26 days for
 * an employee who then leaves mid-year; this reconciles that against
 * computePolandAnnualLeaveEntitlementAtTermination's exit-date-prorated
 * figure.
 *
 * Runs as its own, separately idempotent/lock-protected database operation
 * (post_poland_termination_leave_adjustment) rather than inside
 * terminate_employee()'s own transaction — see that function's own header
 * comment (schema.sql) for why: the FTE-interval resolution and ledger-
 * grant classification behind the computed amount are complex, already
 * independently tested TypeScript this system deliberately does not
 * re-derive in PL/pgSQL. "Atomic where feasible" is satisfied by both
 * halves (status+forfeiture; this leave adjustment) each being internally
 * atomic and idempotent, invoked back-to-back within one Server Action
 * call, rather than forcing a single cross-language transaction.
 *
 * Never blocks the termination itself — only the automatic Annual Leave
 * true-up. When the entitlement can't be determined (no/gappy/ambiguous FTE
 * history, an FTE change mid-period, or an unclassifiable historical ledger
 * row), returns a warning telling HR to review and post the correct amount
 * manually instead; Final Settlement's own live recheck (see
 * final-settlement-section.tsx) independently refuses to show a settlement
 * figure in that same situation, so the two can never silently disagree.
 *
 * Returns null (no warning) when everything posted cleanly or there was
 * nothing to post (the cron had already granted exactly the right amount).
 */
export async function applyPolandTerminationLeaveTrueUp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  hireDate: string,
  terminationDate: string,
): Promise<string | null> {
  const { data: contracts } = await supabase.from("employment_contracts").select("start_date, fte_fraction").eq("employee_id", employeeId);
  const fteFractionHistory: FteFractionPeriod[] = (contracts ?? []).map((c) => ({ effectiveFrom: c.start_date, fteFraction: Number(c.fte_fraction) }));

  const { data: ledgerRows } = await supabase
    .from("leave_ledger")
    .select("id, employee_id, leave_type_code, entry_type, amount_days, reference_type, reversal_of_id")
    .eq("employee_id", employeeId)
    .eq("leave_type_code", "annual");

  const input = { hireDate, terminationDate, fteFractionHistory };
  const entitlementThroughTermination = computePolandAnnualLeaveEntitlementAtTermination(input);

  if (entitlementThroughTermination === null) {
    const reason = explainPolandTerminationEntitlementBlock(input) ?? "the entitlement could not be determined";
    return `Poland Annual Leave could not be automatically trued up for termination (${reason}). Post the confirmed amount manually via a leave-ledger adjustment before preparing Final Settlement.`;
  }

  const key = `${employeeId}:annual`;
  const { grantTotalByKey, ambiguousKeys } = classifyLedgerRows((ledgerRows ?? []) as unknown as AnnualLeaveLedgerRow[]);
  if (ambiguousKeys.has(key)) {
    return "Poland Annual Leave could not be automatically trued up for termination — this employee's historical Annual Leave ledger contains an unclassified adjustment, so the already-granted baseline can't be trusted. Post the confirmed amount manually via a leave-ledger adjustment before preparing Final Settlement.";
  }

  const grantTotal = grantTotalByKey.get(key) ?? 0;
  const rawDelta = entitlementThroughTermination - grantTotal;

  const { data: result, error } = await supabase
    .rpc("post_poland_termination_leave_adjustment", {
      p_employee_id: employeeId,
      p_amount_days: rawDelta,
      p_note: `Termination true-up: entitled to ${entitlementThroughTermination} day(s) through ${terminationDate}, ${grantTotal} already granted.`,
    })
    .single();
  if (error) {
    return `Could not post the Poland Annual Leave termination adjustment automatically (${error.message}). Post it manually via a leave-ledger adjustment before preparing Final Settlement.`;
  }

  const excess = Number(result?.excess_requiring_review ?? 0);
  if (excess > 0) {
    return `This employee had already used ${excess} day(s) more Annual Leave than their corrected termination entitlement allows. The automatic adjustment was capped rather than driving the balance further negative — the excess requires HR review (a possible overpayment).`;
  }

  return null;
}
