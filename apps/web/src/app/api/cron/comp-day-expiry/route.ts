import { NextResponse } from "next/server";
import { computeCompDayExpiry, getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest, SYSTEM_ACTOR_ID } from "@/lib/cron/auth";
import { chunk } from "@/lib/cron/batch";

const INSERT_BATCH_SIZE = 500;

/**
 * Daily comp-day expiry sweep (docs/05-automation-rules.md §5.1). Re-derives
 * expiry from the FULL ledger history every run via computeCompDayExpiry()
 * (packages/domain, unit-tested) rather than tracking "have I swept this
 * entry" state — a run's own 'expired' postings become part of next run's
 * consumption pool, so re-running (including a retried/duplicate cron hit)
 * naturally posts nothing further for an entry already fully accounted for.
 *
 * That self-correction only holds for runs that don't overlap: two
 * invocations racing each other both read the ledger before either has
 * posted, so both compute the same "remaining" balance for an earned entry
 * and would both post its full expiry — double-expiring it. idempotency_key
 * (unique in the database, one per earned entry ever) is what actually
 * closes that race.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  // Recovery Leave (comp_day_ledger) expiry is a per-employee, country-
  // sensitive "has this day already passed?" check — a single UTC `today`
  // wrongly treats it as not-yet-expired (or already-expired) for up to a
  // few hours around a country's own midnight, depending on the direction.
  const { data: employeeCountries, error: employeeCountriesError } = await admin.from("employees").select("id, country_code");
  // A failed query here must never fall through to an empty map — every
  // employee would then silently resolve to DASHBOARD_TIMEZONE (Dubai) via
  // resolveCountryTimeZone's unrecognised-country fallback, which is wrong
  // for every non-UAE employee rather than a visible failure.
  if (employeeCountriesError) return NextResponse.json({ error: employeeCountriesError.message }, { status: 500 });
  const countryByEmployee = new Map((employeeCountries ?? []).map((e) => [e.id, e.country_code]));
  const businessDateForCountry = (countryCode: string | null | undefined) => getBusinessDateString(resolveCountryTimeZone(countryCode), now);
  // Used only for the response payload's `ranAt` — an approximate,
  // human-readable "when did this run happen" figure, never a per-employee
  // calculation input.
  const today = getBusinessDateString(resolveCountryTimeZone(null), now);

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

  // One bulk insert for the whole run rather than one round trip per
  // posting — at realistic headcount (hundreds of employees, each
  // potentially posting several expiry entries) a sequential per-row
  // insert risks a serverless function timeout; a single batched insert
  // keeps this a constant number of round trips regardless of headcount.
  const rows: {
    employee_id: string;
    txn_date: string;
    entry_type: "expired";
    days: number;
    reference_type: string;
    reference_id: string;
    created_by: string;
    idempotency_key: string;
  }[] = [];
  let skipped = 0;

  for (const [employeeId, employeeEntries] of byEmployee) {
    const employeeToday = businessDateForCountry(countryByEmployee.get(employeeId));
    const postings = computeCompDayExpiry(
      employeeEntries.map((e) => ({
        id: e.id,
        entryType: e.entry_type,
        days: Number(e.days),
        txnDate: e.txn_date,
        expiryDate: e.expiry_date,
      })),
      employeeToday,
    );

    for (const posting of postings) {
      // A malformed `days` value somewhere in this employee's history could
      // in principle carry a NaN through computeCompDayExpiry()'s running
      // totals — NaN fails every comparison, so it wouldn't be caught by
      // any check inside that pure function. Guard it here instead of
      // letting it reach the insert as a NaN `days` column.
      if (!Number.isFinite(posting.expiredDays) || posting.expiredDays <= 0) {
        skipped += 1;
        continue;
      }
      rows.push({
        employee_id: employeeId,
        txn_date: employeeToday,
        entry_type: "expired",
        days: -posting.expiredDays,
        reference_type: "comp_day_expiry_sweep",
        reference_id: posting.earnedEntryId,
        created_by: SYSTEM_ACTOR_ID,
        idempotency_key: `expiry:${posting.earnedEntryId}`,
      });
    }
  }

  // One chunk at a time (not one giant insert): a single bad row rejected
  // by the database would otherwise fail the entire run's insert and post
  // nothing at all, for anyone. Chunking bounds that blast radius to the
  // other rows in the same chunk.
  let posted = 0;
  const failures: string[] = [];
  for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
    // upsert + ignoreDuplicates (not insert): idempotency_key is unique, so
    // a row that lost the race to a concurrent invocation is silently
    // dropped instead of failing the whole batch.
    const { error: insertError, count } = await admin
      .from("comp_day_ledger")
      .upsert(batch, { onConflict: "idempotency_key", ignoreDuplicates: true, count: "exact" });
    if (insertError) failures.push(insertError.message);
    else posted += count ?? batch.length;
  }

  // A non-2xx status is what makes a real failure visible to Vercel Cron's
  // own monitoring/alerting — returning 200 while `failures` is non-empty
  // would report this run as healthy even though it dropped rows.
  return NextResponse.json(
    { ranAt: today, employeesSwept: byEmployee.size, entriesPosted: posted, skipped, failures },
    { status: failures.length > 0 ? 500 : 200 },
  );
}
