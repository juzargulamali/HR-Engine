import { NextResponse } from "next/server";
import { computeCompDayExpiry } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest, SYSTEM_ACTOR_ID } from "@/lib/cron/auth";

/**
 * Daily comp-day expiry sweep (docs/05-automation-rules.md §5.1). Re-derives
 * expiry from the FULL ledger history every run via computeCompDayExpiry()
 * (packages/domain, unit-tested) rather than tracking "have I swept this
 * entry" state — a run's own 'expired' postings become part of next run's
 * consumption pool, so re-running (including a retried/duplicate cron hit)
 * naturally posts nothing further for an entry already fully accounted for.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: entries, error } = await admin
    .from("comp_day_ledger")
    .select("id, employee_id, entry_type, days, txn_date, expiry_date");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byEmployee = new Map<string, typeof entries>();
  for (const entry of entries ?? []) {
    const list = byEmployee.get(entry.employee_id) ?? [];
    list.push(entry);
    byEmployee.set(entry.employee_id, list);
  }

  let posted = 0;
  const failures: string[] = [];

  for (const [employeeId, employeeEntries] of byEmployee) {
    const postings = computeCompDayExpiry(
      employeeEntries.map((e) => ({
        id: e.id,
        entryType: e.entry_type,
        days: Number(e.days),
        txnDate: e.txn_date,
        expiryDate: e.expiry_date,
      })),
      today,
    );

    for (const posting of postings) {
      const { error: insertError } = await admin.from("comp_day_ledger").insert({
        employee_id: employeeId,
        txn_date: today,
        entry_type: "expired",
        days: -posting.expiredDays,
        reference_type: "comp_day_expiry_sweep",
        reference_id: posting.earnedEntryId,
        created_by: SYSTEM_ACTOR_ID,
      });
      if (insertError) failures.push(`${employeeId}/${posting.earnedEntryId}: ${insertError.message}`);
      else posted += 1;
    }
  }

  return NextResponse.json({ ranAt: today, employeesSwept: byEmployee.size, entriesPosted: posted, failures });
}
