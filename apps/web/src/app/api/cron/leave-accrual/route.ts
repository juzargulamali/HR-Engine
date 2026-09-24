import { NextResponse } from "next/server";
import { computeAnnualLeaveEntitlementToDate } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest, SYSTEM_ACTOR_ID } from "@/lib/cron/auth";
import { chunk } from "@/lib/cron/batch";

const INSERT_BATCH_SIZE = 500;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000));
}

const ENTITLEMENT_TO_DATE_COUNTRIES = new Set(["AE", "SA", "PL"]);

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
 * the TOTAL of every 'accrual' entry ever posted for that employee/leave
 * type (not the net balance, which consumption would otherwise wrongly
 * suppress), and posts only the positive difference. This reproduces UAE's
 * "2 days per completed month between 6-12 months, then 30 at each
 * anniversary" and Poland's first-year monthly proration naturally, as
 * whatever the calculator's month-over-month delta implies, without this
 * cron needing its own anniversary-detection logic. Only implemented for
 * AE/SA/PL specifically (the three countries this rule set targets) —
 * any other country using these accrual methods is skipped with a review
 * flag rather than guessing a formula for it.
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
    .select("id, country_code, hire_date, recognised_prior_service_years")
    .eq("employment_status", "active")
    .is("deleted_at", null);
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 });

  // Poland's entitlement proration needs the CURRENT contract's FTE
  // fraction — employment_contracts is append-only version history, so
  // is_current is the only reliable way to pick the one that applies now.
  const { data: currentContracts } = await admin.from("employment_contracts").select("employee_id, fte_fraction").eq("is_current", true);
  const fteFractionByEmployee = new Map((currentContracts ?? []).map((c) => [c.employee_id, Number(c.fte_fraction)]));

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

  // The TOTAL ever accrued (not the net balance, which consumption would
  // wrongly suppress) — computeAnnualLeaveEntitlementToDate's result is
  // cumulative-to-date, so the delta this run posts must be measured
  // against everything already granted, not what's left unspent.
  const { data: accrualHistory } = await admin
    .from("leave_ledger")
    .select("employee_id, leave_type_code, amount_days")
    .eq("entry_type", "accrual")
    .eq("reference_type", "policy_run");
  const totalAccruedByKey = new Map<string, number>();
  for (const row of accrualHistory ?? []) {
    const key = `${row.employee_id}:${row.leave_type_code}`;
    totalAccruedByKey.set(key, (totalAccruedByKey.get(key) ?? 0) + Number(row.amount_days));
  }

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
        const entitlementToDate = computeAnnualLeaveEntitlementToDate({
          countryCode: employee.country_code as "AE" | "SA" | "PL",
          hireDate: employee.hire_date,
          asOfDate: today,
          recognisedPriorServiceYears: employee.recognised_prior_service_years ?? undefined,
          fteFraction: fteFractionByEmployee.get(employee.id) ?? undefined,
        });
        const totalAccruedSoFar = totalAccruedByKey.get(key) ?? 0;
        const delta = entitlementToDate - totalAccruedSoFar;
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
  return NextResponse.json({ ranAt: today, entriesPosted: posted, skipped, failures }, { status: failures.length > 0 ? 500 : 200 });
}
