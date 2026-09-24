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
 * history, an FTE change mid-period, an unclassifiable historical ledger
 * row, or either lookup query itself failing — never silently treated as an
 * empty/clean history), returns a warning telling HR to review and post the
 * correct amount manually instead. Final Settlement's own independent
 * readiness check (checkPolandTerminationSettlementReadiness below) is what
 * actually blocks settlement preparation in every one of these cases — it
 * reads the completion marker this function's own RPC call writes, not a
 * recomputation, so the two can never silently disagree.
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
  const { data: contracts, error: contractsError } = await supabase
    .from("employment_contracts")
    .select("start_date, fte_fraction")
    .eq("employee_id", employeeId);
  if (contractsError) {
    return `Poland Annual Leave could not be automatically trued up for termination — the employment contract history couldn't be read (${contractsError.message}). Post the confirmed amount manually via a leave-ledger adjustment before preparing Final Settlement.`;
  }

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("leave_ledger")
    .select("id, employee_id, leave_type_code, entry_type, amount_days, reference_type, reversal_of_id")
    .eq("employee_id", employeeId)
    .eq("leave_type_code", "annual");
  if (ledgerError) {
    return `Poland Annual Leave could not be automatically trued up for termination — the existing Annual Leave ledger history couldn't be read (${ledgerError.message}). Post the confirmed amount manually via a leave-ledger adjustment before preparing Final Settlement.`;
  }

  const fteFractionHistory: FteFractionPeriod[] = (contracts ?? []).map((c) => ({ effectiveFrom: c.start_date, fteFraction: Number(c.fte_fraction) }));
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
    return `This employee had already used ${excess} day(s) more Annual Leave than their corrected termination entitlement allows. The automatic adjustment was capped rather than driving the balance further negative — the excess requires HR review and acknowledgment (see Final Settlement) before settlement can be prepared.`;
  }

  return null;
}

export interface PolandSettlementReadiness {
  ready: boolean;
  reason: string | null;
  excessRequiringReview: number;
}

/**
 * The actual gate Final Settlement (final-settlement-section.tsx) uses to
 * decide whether it's safe to render a Poland settlement figure. Reads the
 * poland_termination_leave_reconciliations completion marker
 * post_poland_termination_leave_adjustment() writes UNCONDITIONALLY
 * (including a zero-delta outcome) — never infers completion from a
 * successful recomputation of the entitlement (explainPolandTerminationEntitlementBlock
 * returning null proves the CALCULATION is possible, not that the RPC above
 * ever ran, or ran successfully, for this employee).
 *
 * Blocks whenever: the query itself fails; no marker exists yet (the
 * true-up has never completed, whether because it was blocked, errored, or
 * simply hasn't run); the marker is for a different termination_date than
 * the one Final Settlement is being asked to render (a stale/mismatched
 * reconciliation); or the marker has a positive, still-unacknowledged
 * excess_requiring_review_days (HR must explicitly acknowledge it via
 * acknowledgePolandTerminationLeaveExcess() first — see that table's own
 * migration header comment for why this can never be inferred or automatic).
 */
export async function checkPolandTerminationSettlementReadiness(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  terminationDate: string,
): Promise<PolandSettlementReadiness> {
  const { data, error } = await supabase
    .from("poland_termination_leave_reconciliations")
    .select("termination_date, excess_requiring_review_days, excess_reviewed_at")
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (error) {
    return { ready: false, reason: `Could not verify the Poland Annual Leave termination reconciliation (${error.message}).`, excessRequiringReview: 0 };
  }

  if (!data || data.termination_date !== terminationDate) {
    return {
      ready: false,
      reason:
        "The Poland Annual Leave termination true-up has not completed for this exact termination date yet. Run or retry the termination workflow, or post a manual leave-ledger adjustment, before preparing Final Settlement.",
      excessRequiringReview: 0,
    };
  }

  const excess = Number(data.excess_requiring_review_days ?? 0);
  if (excess > 0 && !data.excess_reviewed_at) {
    return {
      ready: false,
      reason: `This employee had already used ${excess} day(s) more Annual Leave than their corrected termination entitlement allows. HR must review and acknowledge this before Final Settlement can be prepared.`,
      excessRequiringReview: excess,
    };
  }

  return { ready: true, reason: null, excessRequiringReview: 0 };
}
