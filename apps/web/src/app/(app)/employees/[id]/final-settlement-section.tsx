import { computeFinalSettlement, type EosbPolicyPayload } from "@enginious-hr/domain";
import { checkPolandTerminationSettlementReadiness } from "@/lib/actions/polandTermination";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { SettlementRateForm } from "./settlement-rate-form";
import { AcknowledgePolandExcessButton } from "./acknowledge-poland-excess-button";

// UAE settles at basic salary (computeFinalSettlement's default — no
// override needed). Saudi and Poland require a different, statutory wage
// basis this system has no way to compute automatically; §5 of the Phase 2b
// correction round requires blocking rather than guessing it.
const COUNTRIES_REQUIRING_STATUTORY_RATE = new Set(["SA", "PL"]);

export async function FinalSettlementSection({
  employeeId,
  countryCode,
  hireDate,
  terminationDate,
}: {
  employeeId: string;
  countryCode: string;
  hireDate: string;
  terminationDate: string;
}) {
  const supabase = await createClient();

  const needsStatutoryRate = COUNTRIES_REQUIRING_STATUTORY_RATE.has(countryCode);
  const isPoland = countryCode === "PL";

  // Poland only — the actual gate is whether the termination true-up
  // (lib/actions/polandTermination.ts, run right after terminate_employee())
  // has COMPLETED for this exact termination date, read from the
  // poland_termination_leave_reconciliations marker it writes. Deliberately
  // NOT inferred from a live recomputation of the entitlement: a successful
  // recomputation only proves the calculation is possible, never that the
  // true-up actually ran (or ran successfully) and reconciled the ledger —
  // see checkPolandTerminationSettlementReadiness's own doc comment.
  const readiness = isPoland ? await checkPolandTerminationSettlementReadiness(supabase, employeeId, terminationDate) : null;
  if (readiness && !readiness.ready) {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">{readiness.reason}</Alert>
        {readiness.excessRequiringReview > 0 ? <AcknowledgePolandExcessButton employeeId={employeeId} /> : null}
      </div>
    );
  }

  const [{ data: compensation }, { data: leaveBalance }, { data: approvedClaims }, { data: eosbPolicy }, { data: loans }, { data: settlementInput }] =
    await Promise.all([
      supabase
        .from("compensation_details")
        .select("base_salary, currency")
        .eq("employee_id", employeeId)
        .eq("is_current", true)
        .maybeSingle(),
      supabase.from("leave_balances").select("balance_days").eq("employee_id", employeeId).eq("leave_type_code", "annual").maybeSingle(),
      supabase.from("reimbursement_claims").select("total_amount").eq("employee_id", employeeId).eq("status", "approved"),
      supabase.rpc("resolve_policy", { p_country_code: countryCode, p_policy_type: "end_of_service_benefit", p_as_of: terminationDate }),
      // Every employee_loans row is treated as still outstanding — there's no
      // "settled" status (HR deletes a record once it's repaid/netted, per
      // that table's own add/delete-only design), so this is a live figure,
      // not a point-in-time snapshot.
      supabase.from("employee_loans").select("amount").eq("employee_id", employeeId),
      // Recovery Leave never appears here — leaveBalance above is scoped to
      // leave_type_code = 'annual' only, and Recovery Leave has no leave_ledger
      // row at all (it's comp_day_ledger-only), so it was already excluded
      // from cash settlement before this correction; forfeit_recovery_leave_on_termination()
      // (via terminate_employee()) is what actually clears its balance,
      // without cash conversion, at termination.
      needsStatutoryRate
        ? supabase.from("termination_settlement_inputs").select("leave_encashment_daily_rate").eq("employee_id", employeeId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (!compensation) {
    return <Alert>No current compensation record on file — can&apos;t compute a settlement figure.</Alert>;
  }

  if (needsStatutoryRate && !settlementInput) {
    return (
      <div className="space-y-3">
        <Alert variant="destructive">
          This country requires a statutory leave-encashment wage basis for final settlement — Enginious cannot compute it
          automatically. Settlement preparation is blocked until HR/Finance enters it below.
        </Alert>
        <SettlementRateForm employeeId={employeeId} />
      </div>
    );
  }

  const dailyRate = Number(compensation.base_salary) / 30; // simple monthly-to-daily approximation, not a country-specific working-day convention
  const leaveEncashmentDailyRate = needsStatutoryRate ? Number(settlementInput?.leave_encashment_daily_rate) : undefined;
  const pendingApprovedReimbursements = (approvedClaims ?? []).reduce((sum, c) => sum + Number(c.total_amount), 0);
  const outstandingLoans = (loans ?? []).reduce((sum, l) => sum + Number(l.amount), 0);

  const result = computeFinalSettlement({
    hireDate,
    terminationDate,
    dailyRate,
    leaveEncashmentDailyRate,
    unusedLeaveDays: Number(leaveBalance?.balance_days ?? 0),
    pendingApprovedReimbursements,
    outstandingLoans,
    eosbPolicy: (eosbPolicy as EosbPolicyPayload | null) ?? null,
  });

  return (
    <div className="space-y-3">
      {!eosbPolicy ? (
        <Alert>
          No active end-of-service-benefit policy is configured for this country — the EOSB component below is $0 until HR
          Admin activates one.
        </Alert>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted-foreground">Years of service</dt>
          <dd className="text-lg font-medium">{result.yearsOfService}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Leave encashment</dt>
          <dd className="text-lg font-medium">
            {compensation.currency} {result.leaveEncashmentAmount}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">End-of-service benefit</dt>
          <dd className="text-lg font-medium">
            {compensation.currency} {result.eosbAmount}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Pending approved reimbursements</dt>
          <dd className="text-lg font-medium">
            {compensation.currency} {result.pendingReimbursementsAmount}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Outstanding loans / cash advances</dt>
          <dd className="text-lg font-medium text-destructive">
            −{compensation.currency} {result.loanDeductionsAmount}
          </dd>
        </div>
      </dl>
      <div className="border-t border-border pt-3">
        <span className="text-sm text-muted-foreground">Total settlement</span>
        <div className="text-2xl font-semibold">
          {compensation.currency} {result.totalAmount}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Estimate only — verify against local labor law before processing final payment (see
        docs/05-automation-rules.md §5.2).
      </p>
    </div>
  );
}
