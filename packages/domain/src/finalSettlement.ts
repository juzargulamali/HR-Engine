/**
 * computeFinalSettlement() — docs/05-automation-rules.md §5.2. Composes
 * unused-leave encashment, pending approved reimbursements, and an
 * end-of-service/severance amount into one settlement figure at
 * termination. Every number that varies by country lives in the resolved
 * `end_of_service_benefit` policy payload (docs/02-database-schema.md
 * §2.4), never in this function — a Poland-only notice-pay rule and a
 * UAE-style tiered gratuity rule are both just a different `tiers` array.
 *
 * Deliberately simple and country-agnostic: the tiered "N days of the daily
 * rate per year of service, up to a threshold, then a different rate after
 * it" shape covers UAE-style gratuity structurally, but is NOT a verified
 * implementation of any specific country's law — same disclaimer as the
 * seeded draft policies in supabase/seed.sql. Legal review before go-live.
 */

export interface EosbTier {
  /** Years of service this tier's rate applies up to, or null for the open-ended final tier. */
  upToYears: number | null;
  daysPerYear: number;
}

export interface EosbPolicyPayload {
  tiers: readonly EosbTier[];
}

export interface FinalSettlementInput {
  hireDate: string;
  terminationDate: string;
  /** One day's pay, derived from compensation_details.base_salary by the caller. */
  dailyRate: number;
  /**
   * The wage basis used for unused-leave encashment specifically. Enginious
   * settles unused Annual Leave using basic salary where legally
   * permitted (UAE); where mandatory local law requires another wage
   * basis or statutory formula (e.g. Poland's pecuniary-equivalent
   * calculation, or Saudi's statutory wage basis), the caller resolves
   * that figure and passes it here instead. Defaults to `dailyRate` —
   * every existing call site (basic-salary-only) is unaffected by this
   * field's addition.
   */
  leaveEncashmentDailyRate?: number;
  /** Unused leave balance at termination (leave_balances), in days. */
  unusedLeaveDays: number;
  /** Sum of reimbursement_claims.total_amount for claims already approved but not yet paid. */
  pendingApprovedReimbursements: number;
  /** Sum of employee_loans.amount still outstanding — netted against the payout, not added to it. */
  outstandingLoans: number;
  /** Resolved end_of_service_benefit policy payload as of terminationDate, or null if unconfigured. */
  eosbPolicy: EosbPolicyPayload | null;
}

export interface FinalSettlementResult {
  yearsOfService: number;
  leaveEncashmentAmount: number;
  eosbAmount: number;
  pendingReimbursementsAmount: number;
  loanDeductionsAmount: number;
  totalAmount: number;
}

const DAYS_PER_YEAR = 365.25;

function computeYearsOfService(hireDate: string, terminationDate: string): number {
  const days = (Date.parse(terminationDate) - Date.parse(hireDate)) / (24 * 60 * 60 * 1000);
  return Math.max(0, days / DAYS_PER_YEAR);
}

function computeEosbAmount(yearsOfService: number, dailyRate: number, policy: EosbPolicyPayload | null): number {
  if (!policy || policy.tiers.length === 0) return 0;

  let remainingYears = yearsOfService;
  let yearsConsumed = 0;
  let totalDays = 0;

  for (const tier of policy.tiers) {
    if (remainingYears <= 0) break;
    const tierCapacity = tier.upToYears === null ? remainingYears : Math.max(0, tier.upToYears - yearsConsumed);
    const yearsInTier = Math.min(remainingYears, tierCapacity);
    totalDays += yearsInTier * tier.daysPerYear;
    remainingYears -= yearsInTier;
    yearsConsumed += yearsInTier;
  }

  return round2(totalDays * dailyRate);
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function computeFinalSettlement(input: FinalSettlementInput): FinalSettlementResult {
  const yearsOfService = computeYearsOfService(input.hireDate, input.terminationDate);
  const leaveEncashmentAmount = round2(Math.max(0, input.unusedLeaveDays) * (input.leaveEncashmentDailyRate ?? input.dailyRate));
  const eosbAmount = computeEosbAmount(yearsOfService, input.dailyRate, input.eosbPolicy);
  const pendingReimbursementsAmount = round2(Math.max(0, input.pendingApprovedReimbursements));
  const loanDeductionsAmount = round2(Math.max(0, input.outstandingLoans));

  return {
    yearsOfService: Math.round(yearsOfService * 100) / 100,
    leaveEncashmentAmount,
    eosbAmount,
    pendingReimbursementsAmount,
    loanDeductionsAmount,
    totalAmount: round2(leaveEncashmentAmount + eosbAmount + pendingReimbursementsAmount - loanDeductionsAmount),
  };
}
