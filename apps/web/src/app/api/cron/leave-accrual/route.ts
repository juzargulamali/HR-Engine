import { NextResponse } from "next/server";
import { computeAnnualLeaveEntitlementToDate, type FteFractionPeriod } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest, SYSTEM_ACTOR_ID } from "@/lib/cron/auth";
import { chunk } from "@/lib/cron/batch";

const INSERT_BATCH_SIZE = 500;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000));
}

const ENTITLEMENT_TO_DATE_COUNTRIES = new Set(["AE", "SA", "PL"]);

// The only leave_ledger entry_types that may ever unambiguously count toward
// an employee's lifetime Annual Leave "already granted" baseline. 'accrual'
// and 'carryover' are exclusively written by automated, self-describing
// mechanisms (this cron; a future carryover-expiry cron), so their presence
// alone is proof of a grant. 'adjustment' is NOT in this set — it's also
// used for arbitrary, unclassified manual corrections (postLeaveLedgerAdjustment),
// so an 'adjustment' row only counts when its reference_type says specifically
// 'opening_balance' (see isUnambiguousGrantRow below). 'deduction' and
// 'encashment' are consumption, never a grant. 'reversal' is resolved by
// looking up what it reverses (see classifyLedgerRows).
const UNCONDITIONAL_GRANT_ENTRY_TYPES = new Set(["accrual", "carryover"]);

export interface AnnualLeaveLedgerRow {
  id: string;
  employee_id: string;
  leave_type_code: string;
  entry_type: string;
  amount_days: number;
  reference_type: string | null;
  reversal_of_id: string | null;
}

export interface AmbiguousBaseline {
  employeeId: string;
  leaveTypeCode: string;
  reason: string;
}

function isUnambiguousGrantRow(row: AnnualLeaveLedgerRow): boolean {
  if (UNCONDITIONAL_GRANT_ENTRY_TYPES.has(row.entry_type)) return true;
  return row.entry_type === "adjustment" && row.reference_type === "opening_balance";
}

function isAmbiguousGrantCandidateRow(row: AnnualLeaveLedgerRow): boolean {
  // Any 'adjustment' NOT tagged 'opening_balance' could be a genuine opening
  // grant recorded before that tag existed, or could be a wholly unrelated
  // correction (a mistake fix, a policy-transition true-up, anything) —
  // there is no way to tell which from the stored schema, so it can never
  // safely be counted as a grant, but its mere existence also means the
  // employee's true lifetime baseline can't be trusted either way.
  return row.entry_type === "adjustment" && row.reference_type !== "opening_balance";
}

/**
 * Inventories every historical Annual Leave ledger row for the given
 * employee/leave-type keys and classifies each one as: an unambiguous grant
 * (counts toward the "already granted" baseline), an ambiguous candidate
 * (the whole key is flagged and excluded from automatic accrual), or
 * irrelevant (deduction/encashment — consumption, never a grant).
 *
 * 'reversal' rows are resolved by looking up the entry_type of the row they
 * reverse (via reversal_of_id): reversing a grant nets out of that grant's
 * total (e.g. an accrual posted then corrected); reversing a deduction is a
 * consumption-side correction (e.g. cancel_leave_request restoring a used
 * day) and must NOT inflate the grant baseline; reversing an ambiguous
 * adjustment, or a reversal whose target can't be found, flags the key
 * ambiguous rather than guessing.
 *
 * Never infers a baseline from the net balance (leave_balances) — deductions
 * and reversals make that unreliable per Phase 2b's correction brief.
 */
export function classifyLedgerRows(rows: AnnualLeaveLedgerRow[]): {
  grantTotalByKey: Map<string, number>;
  ambiguousKeys: Set<string>;
} {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const grantTotalByKey = new Map<string, number>();
  const ambiguousKeys = new Set<string>();

  const addGrant = (key: string, amount: number) => grantTotalByKey.set(key, (grantTotalByKey.get(key) ?? 0) + amount);

  for (const row of rows) {
    const key = `${row.employee_id}:${row.leave_type_code}`;

    if (row.entry_type === "reversal") {
      const original = row.reversal_of_id ? rowsById.get(row.reversal_of_id) : undefined;
      if (!original) {
        // An orphan reversal (target not found in this fetch) can't be
        // classified safely — treat the key as ambiguous rather than assume
        // either direction.
        ambiguousKeys.add(key);
      } else if (isUnambiguousGrantRow(original)) {
        addGrant(key, Number(row.amount_days));
      } else if (isAmbiguousGrantCandidateRow(original)) {
        ambiguousKeys.add(key);
      }
      // else: reverses a deduction/encashment — consumption-side, correctly excluded.
      continue;
    }

    if (isUnambiguousGrantRow(row)) {
      addGrant(key, Number(row.amount_days));
    } else if (isAmbiguousGrantCandidateRow(row)) {
      ambiguousKeys.add(key);
    }
    // else: deduction/encashment — consumption, not a grant, ignored.
  }

  return { grantTotalByKey, ambiguousKeys };
}

/**
 * Monthly leave accrual run (docs/05-automation-rules.md §5.1).
 *
 * 'monthly_accrual' posts a fixed number of days per run, respecting
 * min_service_days_to_accrue and capped at max_balance_days — unchanged.
 *
 * 'per_service_year' (UAE/Saudi) and 'annual_grant' (Poland) are
 * delta-based: each run computes the employee's cumulative Annual Leave
 * entitlement AS OF TODAY via computeAnnualLeaveEntitlementToDate (the
 * regional tiered/first-year rules in packages/domain), compares it against
 * an unambiguous inventory of every historical Annual Leave grant ever
 * posted for that employee/leave type — not just this cron's own
 * 'policy_run' entries, and never inferred from the net balance, which
 * deductions and reversals would make unreliable (see classifyLedgerRows) —
 * and posts only the positive difference. This reproduces UAE's "2 days per
 * completed month between 6-12 months, then 30 at each anniversary" and
 * Poland's first-year monthly proration naturally, as whatever the
 * calculator's month-over-month delta implies, without this cron needing
 * its own anniversary-detection logic. Only implemented for AE/SA/PL
 * specifically (the three countries this rule set targets) — any other
 * country using these accrual methods is skipped with a review flag rather
 * than guessing a formula for it.
 *
 * If an employee/leave-type's historical baseline can't be determined
 * unambiguously (an 'adjustment' row exists that isn't tagged
 * 'opening_balance' — e.g. a legacy opening-balance grant recorded before
 * that tag existed, or any other unclassified manual correction), that key
 * is skipped entirely and reported rather than guessed. Existing balances
 * are never rewritten by this cron either way.
 *
 * Call with ?mode=preflight to run the full computation read-only: no rows
 * are inserted, and the response reports how many would post, how many
 * would be skipped, and exactly which employee/leave-type keys have an
 * ambiguous baseline so HR/engineering can review before it ever blocks (or
 * silently would have mis-posted) real accrual.
 *
 * Idempotent per calendar month: an employee/leave-type pair that already
 * has a 'policy_run' accrual posted this month is skipped, so a retried or
 * manually re-triggered run this same month can't double-pay. That
 * app-level check alone can't stop two overlapping invocations (a Vercel
 * Cron retry racing the original request) from both passing it before
 * either has inserted — idempotency_key (unique in the database) is what
 * actually closes that race; the check above just avoids the redundant
 * work in the ordinary sequential case.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isPreflight = new URL(request.url).searchParams.get("mode") === "preflight";
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  // Mirrors resolve_policy()'s own filter (schema.sql): 'active' status
  // alone isn't enough — a policy can be activated ahead of time with a
  // future effective_from (or left with a past effective_to after being
  // superseded), and the exclusion constraint on this table only stops
  // *overlapping* active ranges per country, not multiple non-overlapping
  // active rows existing at once. Without this date window, a future-dated
  // policy started accruing at its new rate the moment someone activated
  // it, months before it was supposed to take effect.
  const { data: activePolicies, error: policiesError } = await admin
    .from("policy_versions")
    .select("id, country_code")
    .eq("policy_type", "leave_rules")
    .eq("status", "active")
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);
  if (policiesError) return NextResponse.json({ error: policiesError.message }, { status: 500 });
  if (!activePolicies || activePolicies.length === 0) {
    return NextResponse.json({ ranAt: today, note: "No active leave_rules policy anywhere — nothing to accrue.", entriesPosted: 0 });
  }

  const { data: leaveTypeRows, error: leaveTypesError } = await admin
    .from("policy_leave_types")
    .select("policy_version_id, leave_type_code, accrual_method, accrual_rate_per_period, max_balance_days, min_service_days_to_accrue")
    .in(
      "policy_version_id",
      activePolicies.map((p) => p.id),
    );
  if (leaveTypesError) return NextResponse.json({ error: leaveTypesError.message }, { status: 500 });

  const leaveTypesByCountry = new Map<string, typeof leaveTypeRows>();
  for (const policy of activePolicies) {
    const types = (leaveTypeRows ?? []).filter((t) => t.policy_version_id === policy.id);
    leaveTypesByCountry.set(policy.country_code, types);
  }

  const { data: employees, error: employeesError } = await admin
    .from("employees")
    .select("id, country_code, hire_date, recognised_prior_service_years, is_first_ever_employment")
    .eq("employment_status", "active")
    .is("deleted_at", null);
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 });

  // Poland's entitlement calculation needs the employee's WHOLE effective-
  // dated FTE history (every employment_contracts row's start_date +
  // fte_fraction, not just is_current's single current value) so a
  // mid-service FTE change prices only the years it actually affects — see
  // computeAnnualLeaveEntitlementToDate's fteFractionHistory input.
  const { data: allContracts } = await admin.from("employment_contracts").select("employee_id, start_date, fte_fraction");
  const fteFractionHistoryByEmployee = new Map<string, FteFractionPeriod[]>();
  for (const contract of allContracts ?? []) {
    const periods = fteFractionHistoryByEmployee.get(contract.employee_id) ?? [];
    periods.push({ effectiveFrom: contract.start_date, fteFraction: Number(contract.fte_fraction) });
    fteFractionHistoryByEmployee.set(contract.employee_id, periods);
  }

  const { data: alreadyAccrued } = await admin
    .from("leave_ledger")
    .select("employee_id, leave_type_code")
    .eq("entry_type", "accrual")
    .eq("reference_type", "policy_run")
    .gte("txn_date", monthStart)
    .lte("txn_date", today);
  const alreadyAccruedKeys = new Set((alreadyAccrued ?? []).map((r) => `${r.employee_id}:${r.leave_type_code}`));

  const { data: balances } = await admin.from("leave_balances").select("employee_id, leave_type_code, balance_days");
  const balanceByKey = new Map((balances ?? []).map((b) => [`${b.employee_id}:${b.leave_type_code}`, Number(b.balance_days)]));

  // Every historical Annual Leave ledger row for the leave-type codes that
  // use entitlement-to-date accrual — not just this cron's own 'policy_run'
  // accruals — so the "already granted" baseline reflects EVERY grant
  // mechanism that has ever posted to this employee (onboarding opening
  // balances, this cron, any future carryover run), never just a slice of
  // them. Never inferred from leave_balances (the net balance): deductions
  // and reversals make a net figure unusable as a lifetime grant total.
  const entitlementToDateLeaveTypeCodes = [
    ...new Set((leaveTypeRows ?? []).filter((t) => t.accrual_method === "per_service_year" || t.accrual_method === "annual_grant").map((t) => t.leave_type_code)),
  ];
  const { data: historyRows, error: historyError } =
    entitlementToDateLeaveTypeCodes.length > 0
      ? await admin
          .from("leave_ledger")
          .select("id, employee_id, leave_type_code, entry_type, amount_days, reference_type, reversal_of_id")
          .in("leave_type_code", entitlementToDateLeaveTypeCodes)
      : { data: [] as AnnualLeaveLedgerRow[], error: null };
  if (historyError) return NextResponse.json({ error: historyError.message }, { status: 500 });

  const { grantTotalByKey, ambiguousKeys } = classifyLedgerRows((historyRows ?? []) as AnnualLeaveLedgerRow[]);
  const ambiguousReport: AmbiguousBaseline[] = [...ambiguousKeys].map((key) => {
    const separatorIndex = key.indexOf(":");
    return {
      employeeId: key.slice(0, separatorIndex),
      leaveTypeCode: key.slice(separatorIndex + 1),
      reason: "an 'adjustment' ledger row exists for this employee/leave-type that isn't tagged 'opening_balance' — the historical baseline can't be trusted, so automatic accrual is blocked until HR confirms it",
    };
  });

  // Collect rows and insert them in one bulk call at the end rather than
  // one round trip per employee/leave-type pair — at realistic headcount
  // (hundreds of employees across several leave types) a sequential
  // per-row insert risks a serverless function timeout; a single batched
  // insert keeps this a constant number of round trips regardless of
  // headcount.
  const accrualMonth = today.slice(0, 7); // YYYY-MM
  const rows: {
    employee_id: string;
    leave_type_code: string;
    txn_date: string;
    entry_type: "accrual";
    amount_days: number;
    reference_type: string;
    created_by: string;
    idempotency_key: string;
  }[] = [];
  let skipped = 0;
  // Poland-only: employees whose entitlement can't be computed because HR
  // hasn't confirmed is_first_ever_employment (or there's no FTE history at
  // all) — a distinct, separately-reported reason from ambiguousReport
  // above (which is about historical ledger provenance, not configuration).
  const blockedEntitlementConfig: AmbiguousBaseline[] = [];

  for (const employee of employees ?? []) {
    const leaveTypes = leaveTypesByCountry.get(employee.country_code) ?? [];
    for (const leaveType of leaveTypes) {
      const key = `${employee.id}:${leaveType.leave_type_code}`;
      if (alreadyAccruedKeys.has(key)) {
        skipped += 1;
        continue;
      }

      const minServiceDays = leaveType.min_service_days_to_accrue;
      if (minServiceDays !== null && daysBetween(employee.hire_date, today) < minServiceDays) {
        skipped += 1;
        continue;
      }

      const maxBalance = leaveType.max_balance_days ? Number(leaveType.max_balance_days) : null;
      const currentBalance = balanceByKey.get(key) ?? 0;

      let amount: number;
      if (leaveType.accrual_method === "monthly_accrual") {
        const rate = leaveType.accrual_rate_per_period ? Number(leaveType.accrual_rate_per_period) : 0;
        if (rate <= 0) {
          skipped += 1;
          continue;
        }
        amount = maxBalance !== null ? Math.min(rate, Math.max(0, maxBalance - currentBalance)) : rate;
      } else if (
        (leaveType.accrual_method === "per_service_year" || leaveType.accrual_method === "annual_grant") &&
        ENTITLEMENT_TO_DATE_COUNTRIES.has(employee.country_code)
      ) {
        if (ambiguousKeys.has(key)) {
          // This employee/leave-type has at least one historical ledger row
          // whose grant-or-not status can't be determined unambiguously —
          // never guess an accrual against an unknown baseline. Reported in
          // ambiguousReport (always) and surfaced prominently in preflight mode.
          skipped += 1;
          continue;
        }
        const entitlementToDate = computeAnnualLeaveEntitlementToDate({
          countryCode: employee.country_code as "AE" | "SA" | "PL",
          hireDate: employee.hire_date,
          asOfDate: today,
          recognisedPriorServiceYears: employee.recognised_prior_service_years ?? undefined,
          isFirstEverEmployment: employee.is_first_ever_employment,
          fteFractionHistory: fteFractionHistoryByEmployee.get(employee.id),
        });
        if (entitlementToDate === null) {
          // Poland only: HR hasn't confirmed is_first_ever_employment (or
          // there's no employment_contracts history at all to resolve FTE
          // from) — block automatic accrual for this employee rather than
          // guess, and surface exactly that configuration requirement.
          skipped += 1;
          blockedEntitlementConfig.push({
            employeeId: employee.id,
            leaveTypeCode: leaveType.leave_type_code,
            reason:
              employee.is_first_ever_employment === null || employee.is_first_ever_employment === undefined
                ? "employees.is_first_ever_employment has not been confirmed by HR yet"
                : "no employment_contracts history exists to resolve an FTE fraction from",
          });
          continue;
        }
        const alreadyGranted = grantTotalByKey.get(key) ?? 0;
        const delta = entitlementToDate - alreadyGranted;
        // Capped the same way a monthly_accrual amount is: never post past
        // max_balance_days regardless of what the entitlement curve implies.
        amount = maxBalance !== null ? Math.min(delta, Math.max(0, maxBalance - currentBalance)) : delta;
      } else {
        // 'per_service_year'/'annual_grant' for a country outside AE/SA/PL,
        // or any other accrual_method — not silently mis-accrued; skipped
        // for HR/engineering to review, same as before this correction.
        skipped += 1;
        continue;
      }

      // NaN fails every comparison (including `<= 0`), so a malformed
      // accrual_rate_per_period/max_balance_days would otherwise slip past
      // that check and reach the insert as a NaN amount_days — rejecting
      // that one row at the database, and (pre-chunking) the whole batch
      // with it. Catch it here instead: skip just this one row, with a
      // reason, and keep going.
      if (!Number.isFinite(amount) || amount <= 0) {
        skipped += 1;
        continue;
      }

      rows.push({
        employee_id: employee.id,
        leave_type_code: leaveType.leave_type_code,
        txn_date: today,
        entry_type: "accrual",
        amount_days: amount,
        reference_type: "policy_run",
        created_by: SYSTEM_ACTOR_ID,
        idempotency_key: `accrual:${employee.id}:${leaveType.leave_type_code}:${accrualMonth}`,
      });
    }
  }

  // Read-only mode: report exactly what a real run would do — including
  // every ambiguous-baseline employee/leave-type it would refuse to touch —
  // without inserting anything. Lets HR/engineering review before (or
  // instead of) ever running for real.
  if (isPreflight) {
    return NextResponse.json({
      ranAt: today,
      mode: "preflight",
      wouldPost: rows.length,
      skipped,
      ambiguousBaselines: ambiguousReport,
      blockedEntitlementConfig,
    });
  }

  // One chunk at a time (not one giant insert): a single bad row rejected
  // by the database — a stale employee_id, say — would otherwise fail the
  // entire run's insert and post nothing at all, for anyone. Chunking
  // bounds that blast radius to the other rows in the same chunk.
  let posted = 0;
  const failures: string[] = [];
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    // upsert + ignoreDuplicates (not insert): idempotency_key is unique, so
    // a row that lost the race to a concurrent invocation is silently
    // dropped instead of failing the whole batch.
    const { error: insertError, count } = await admin
      .from("leave_ledger")
      .upsert(batch, { onConflict: "idempotency_key", ignoreDuplicates: true, count: "exact" });
    if (insertError) failures.push(insertError.message);
    else posted += count ?? batch.length;
  }

  // A non-2xx status is what makes a real failure visible to Vercel Cron's
  // own monitoring/alerting — returning 200 while `failures` is non-empty
  // would report this run as healthy even though it dropped rows.
  return NextResponse.json(
    { ranAt: today, entriesPosted: posted, skipped, ambiguousBaselines: ambiguousReport, blockedEntitlementConfig, failures },
    { status: failures.length > 0 ? 500 : 200 },
  );
}
