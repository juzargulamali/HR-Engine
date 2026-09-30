import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";
import { fetchJibbleTimeEntries } from "@/lib/jibble/client";
import { redactValue } from "@/lib/jibble/redact";

/** Added on top of the saved checkpoint (never used to replace it) so a
 * Jibble-side correction made just before the last run's cutoff is still
 * re-picked-up on the next run, rather than permanently falling just
 * outside the window. */
const OVERLAP_HOURS = 2;

/** Only used the very FIRST time a company has no checkpoint on file yet —
 * every run after that is anchored to the checkpoint, not to "now". */
const INITIAL_BACKFILL_DAYS = 3;

/** How many redacted raw payloads to include in the response for entries
 * that couldn't even be parsed (no recognizable id/person id) — enough to
 * diagnose a field-name mismatch without dumping the whole batch (which may
 * contain employee notes) into cron logs. */
const MAX_REDACTED_SAMPLES = 5;

/**
 * Pulls completed Jibble time entries since the last successful checkpoint
 * (with an overlap window, see OVERLAP_HOURS) and imports each one via
 * import_jibble_time_entry() — one atomic call per entry, so a single
 * malformed entry never blocks the rest of the batch. Every entry maps to a
 * COMPANY via JIBBLE_COMPANY_ID: this system has no per-tenant Jibble
 * workspace mapping yet, so a single Jibble organization is assumed for
 * now — a company with multiple Jibble workspaces (or multiple companies
 * sharing one) needs this route extended before it can be trusted, which is
 * exactly why it's not wired into vercel.json's cron list yet (see the PR
 * description's "still unverified" section).
 *
 * Sync checkpointing: jibble_sync_checkpoints (schema.sql) persists how far
 * this company's sync has successfully reached. A normal run reads it,
 * applies OVERLAP_HOURS, fetches through "now", and — only if every page
 * fetched successfully — advances the checkpoint to "now". If a page fails
 * partway (network error, non-2xx, bad JSON), whatever was fetched before
 * the failure is still imported (safe: import_jibble_time_entry() is
 * idempotent), but the checkpoint is left at its PREVIOUS value (or the
 * window's own start, on a first-ever run) rather than advanced — so the
 * next run retries the same range instead of silently skipping the part
 * that failed. This is what "recovers after a missed sync" without relying
 * on a fixed lookback window: however long the gap since the last success,
 * the next run picks up exactly where it left off.
 *
 * Controlled backfill/reconciliation: an explicit ?since=&until= (ISO
 * timestamps) overrides the checkpoint-derived window entirely and does
 * NOT touch the stored checkpoint either way — a deliberate, bounded
 * re-fetch of a specific range (e.g. to pull in an older Jibble-side
 * correction, or to fill a gap a previous 'partial' run's failures report
 * pointed at) that never risks moving the main cursor backward or forward
 * by accident. Still requires the same cron secret as a normal run.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = process.env.JIBBLE_COMPANY_ID;
  if (!companyId) {
    return NextResponse.json({ error: "JIBBLE_COMPANY_ID is not configured." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const paramSince = searchParams.get("since");
  const paramUntil = searchParams.get("until");
  const isBackfill = Boolean(paramSince || paramUntil);

  const admin = createAdminClient();
  const now = new Date();

  let since: Date;
  if (paramSince) {
    since = new Date(paramSince);
  } else {
    const { data: checkpoint } = await admin
      .from("jibble_sync_checkpoints")
      .select("last_synced_until")
      .eq("company_id", companyId)
      .maybeSingle();
    since = checkpoint
      ? new Date(new Date(checkpoint.last_synced_until).getTime() - OVERLAP_HOURS * 60 * 60 * 1000)
      : new Date(now.getTime() - INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  }
  const until = paramUntil ? new Date(paramUntil) : now;

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
    return NextResponse.json({ error: "Invalid or empty since/until range." }, { status: 400 });
  }

  const fetchResult = await fetchJibbleTimeEntries(since.toISOString(), until.toISOString());

  let imported = 0;
  let needsReview = 0;
  const failures: { jibbleEntryId: string; error: string }[] = [];

  for (const entry of fetchResult.parsed) {
    const { data, error } = await admin.rpc("import_jibble_time_entry", {
      p_company_id: companyId,
      p_jibble_entry_id: entry.jibbleEntryId,
      p_jibble_person_id: entry.personId,
      p_entry_start: entry.start,
      p_entry_end: entry.end,
      p_note: entry.note,
      p_break_minutes: entry.breakMinutes,
      p_raw_payload: entry.raw,
      p_client_needs_review: entry.needsReview,
      p_client_review_reason: entry.reviewReason,
    });
    if (error) {
      failures.push({ jibbleEntryId: entry.jibbleEntryId, error: error.message });
      continue;
    }
    imported += 1;
    if (data?.[0]?.needs_review) needsReview += 1;
  }

  const status: "ok" | "partial" | "failed" =
    fetchResult.failedPage && fetchResult.pagesFetched === 0 && fetchResult.parsed.length === 0
      ? "failed"
      : fetchResult.failedPage || failures.length > 0
        ? "partial"
        : "ok";

  if (!isBackfill) {
    // On a failure, checkpoint stays at `since` (this window's own start —
    // itself already the previous checkpoint minus the overlap, or the
    // first-run backfill start) so the NEXT run's window still covers
    // everything this one was supposed to but couldn't confirm. Only a
    // fully successful page-fetch (failedPage === false) advances the
    // cursor to `until`; per-entry RPC failures still advance it, since the
    // full window WAS seen — those specific failures are surfaced in
    // `failures` below for manual reconciliation via the ?since=&until=
    // backfill path.
    const newCheckpoint = fetchResult.failedPage ? since : until;
    await admin.rpc("record_jibble_sync_checkpoint", {
      p_company_id: companyId,
      p_synced_until: newCheckpoint.toISOString(),
      p_status: status,
      p_note: fetchResult.failureMessage ?? (failures.length > 0 ? `${failures.length} entr${failures.length === 1 ? "y" : "ies"} failed to import.` : null),
    });
  }

  return NextResponse.json(
    {
      mode: isBackfill ? "backfill" : "incremental",
      since: since.toISOString(),
      until: until.toISOString(),
      status,
      pagesFetched: fetchResult.pagesFetched,
      fetched: fetchResult.parsed.length,
      unparseableCount: fetchResult.unparseable.length,
      unparseableSamples: fetchResult.unparseable.slice(0, MAX_REDACTED_SAMPLES).map((e) => ({ reason: e.reason, raw: redactValue(e.raw) })),
      imported,
      needsReview,
      failedPage: fetchResult.failedPage,
      failureMessage: fetchResult.failureMessage,
      failures,
    },
    // A non-2xx status is what makes a real failure visible to Vercel
    // Cron's own monitoring — returning 200 while the run was 'partial' or
    // 'failed' would report this run as healthy even though it dropped
    // entries or made no progress at all.
    { status: status === "ok" ? 200 : status === "partial" ? 207 : 500 },
  );
}
