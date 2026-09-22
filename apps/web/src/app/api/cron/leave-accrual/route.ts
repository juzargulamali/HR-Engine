import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest, SYSTEM_ACTOR_ID } from "@/lib/cron/auth";

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000));
}

/**
 * Monthly leave accrual run (docs/05-automation-rules.md §5.1). Only
 * accrual_method = 'monthly_accrual' is implemented — a fixed number of
 * days posted per run, respecting min_service_days_to_accrue and capped at
 * max_balance_days. 'annual_grant' and 'per_service_year' need an
 * anniversary/period concept this phase's policy data doesn't define yet
 * (docs/06-implementation-phases.md Phase 3 scope) — they're skipped, not
 * silently mis-accrued, and worth revisiting once a country's real policy
 * needs one of them.
 *
 * Idempotent per calendar month: an employee/leave-type pair that already
 * has a 'policy_run' accrual posted this month is skipped, so a retried or
 * manually re-triggered run this same month can't double-pay.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const { data: activePolicies, error: policiesError } = await admin
    .from("policy_versions")
    .select("id, country_code")
    .eq("policy_type", "leave_rules")
    .eq("status", "active");
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
    .select("id, country_code, hire_date")
    .eq("employment_status", "active")
    .is("deleted_at", null);
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 });

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

  let posted = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const employee of employees ?? []) {
    const leaveTypes = leaveTypesByCountry.get(employee.country_code) ?? [];
    for (const leaveType of leaveTypes) {
      if (leaveType.accrual_method !== "monthly_accrual") continue;

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

      const rate = leaveType.accrual_rate_per_period ? Number(leaveType.accrual_rate_per_period) : 0;
      if (rate <= 0) {
        skipped += 1;
        continue;
      }

      const maxBalance = leaveType.max_balance_days ? Number(leaveType.max_balance_days) : null;
      const currentBalance = balanceByKey.get(key) ?? 0;
      const amount = maxBalance !== null ? Math.min(rate, Math.max(0, maxBalance - currentBalance)) : rate;
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      const { error: insertError } = await admin.from("leave_ledger").insert({
        employee_id: employee.id,
        leave_type_code: leaveType.leave_type_code,
        txn_date: today,
        entry_type: "accrual",
        amount_days: amount,
        reference_type: "policy_run",
        created_by: SYSTEM_ACTOR_ID,
      });
      if (insertError) failures.push(`${key}: ${insertError.message}`);
      else posted += 1;
    }
  }

  return NextResponse.json({ ranAt: today, entriesPosted: posted, skipped, failures });
}
