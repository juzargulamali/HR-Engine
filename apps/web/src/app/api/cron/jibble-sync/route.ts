import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";
import { fetchJibbleTimeEntries } from "@/lib/jibble/client";

const LOOKBACK_HOURS = 26;

/**
 * Pulls completed Jibble time entries since the last run and imports each
 * one via import_jibble_time_entry() — one atomic call per entry, so a
 * single malformed entry never blocks the rest of the batch (same
 * per-item-isolation reasoning as the comp-day-expiry cron's per-employee
 * loop). Every entry maps to a COMPANY via JIBBLE_COMPANY_ID: this system
 * has no per-tenant Jibble workspace mapping yet, so a single Jibble
 * organization is assumed for now — a company with multiple Jibble
 * workspaces (or multiple companies sharing one) needs this route extended
 * before it can be trusted, which is exactly why it's not wired into
 * vercel.json's cron list yet (see the PR description's "still unverified"
 * section) — running it requires setting JIBBLE_COMPANY_ID/
 * JIBBLE_CLIENT_ID/JIBBLE_CLIENT_SECRET and adding it to vercel.json by
 * hand once those are confirmed against a real tenant.
 *
 * LOOKBACK_HOURS is intentionally wider than the presumed run cadence
 * (hourly) — Jibble entries can be submitted or edited after the fact (an
 * employee clocking in late, a manager backdating a correction), so a
 * narrow window keyed only to "since the last successful run" would miss
 * them. Overlap is exactly what makes this idempotent: import_jibble_time_entry()
 * is a no-op for anything unchanged.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = process.env.JIBBLE_COMPANY_ID;
  if (!companyId) {
    return NextResponse.json({ error: "JIBBLE_COMPANY_ID is not configured." }, { status: 500 });
  }

  const until = new Date();
  const since = new Date(until.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  let entries: Awaited<ReturnType<typeof fetchJibbleTimeEntries>>;
  try {
    entries = await fetchJibbleTimeEntries(since.toISOString(), until.toISOString());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Jibble fetch failed." }, { status: 502 });
  }

  const admin = createAdminClient();
  let imported = 0;
  let needsReview = 0;
  const failures: { jibbleEntryId: string; error: string }[] = [];

  for (const entry of entries.mapped) {
    const { data, error } = await admin.rpc("import_jibble_time_entry", {
      p_company_id: companyId,
      p_jibble_entry_id: entry.id,
      p_jibble_person_id: entry.personId,
      p_entry_start: entry.start,
      p_entry_end: entry.end,
      p_note: entry.note,
      p_break_minutes: entry.breakMinutes,
      p_raw_payload: entry.raw,
    });
    if (error) {
      failures.push({ jibbleEntryId: entry.id, error: error.message });
      continue;
    }
    imported += 1;
    if (data?.[0]?.needs_review) needsReview += 1;
  }

  // A non-2xx status is what makes a real failure visible to Vercel Cron's
  // own monitoring — returning 200 while `failures` is non-empty would
  // report this run as healthy even though it dropped entries.
  return NextResponse.json(
    { ranAt: until.toISOString(), fetched: entries.mapped.length, skippedUnmapped: entries.skipped, imported, needsReview, failures },
    { status: failures.length > 0 ? 500 : 200 },
  );
}
