import { computeFinalSettlement, type EosbPolicyPayload } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";

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

  const [{ data: compensation }, { data: leaveBalance }, { data: approvedClaims }, { data: eosbPolicy }] = await Promise.all([
    supabase
      .from("compensation_details")
      .select("base_salary, currency")
      .eq("employee_id", employeeId)
      .eq("is_current", true)
      .maybeSingle(),
    supabase.from("leave_balances").select("balance_days").eq("employee_id", employeeId).eq("leave_type_code", "annual").maybeSingle(),
    supabase.from("reimbursement_claims").select("total_amount").eq("employee_id", employeeId).eq("status", "approved"),
    supabase.rpc("resolve_policy", { p_country_code: countryCode, p_policy_type: "end_of_service_benefit", p_as_of: terminationDate }),
  ]);

  if (!compensation) {
    return <Alert>No current compensation record on file — can&apos;t compute a settlement figure.</Alert>;
  }

  const dailyRate = Number(compensation.base_salary) / 30; // simple monthly-to-daily approximation, not a country-specific working-day convention
  const pendingApprovedReimbursements = (approvedClaims ?? []).reduce((sum, c) => sum + Number(c.total_amount), 0);

  const result = computeFinalSettlement({
    hireDate,
    terminationDate,
    dailyRate,
    unusedLeaveDays: Number(leaveBalance?.balance_days ?? 0),
    pendingApprovedReimbursements,
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
