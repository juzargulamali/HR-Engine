import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";
import { fetchJibbleTimeEntries, type ParsedJibbleEntry } from "@/lib/jibble/client";
import { redactValue } from "@/lib/jibble/redact";

const DEFAULT_WINDOW_HOURS = 48;
const MAX_SAMPLES = 5;

interface ShiftSummary {
  jibbleEntryId: string;
  personId: string;
  employeeMapped: boolean;
  entryStatus: "completed" | "in_progress";
  needsReview: boolean;
  reviewReason: string | null;
  start: string | null;
  end: string | null;
  localWorkDate: string | null;
  crossesMidnightLocally: boolean | null;
  durationHours: number | null;
  breakMinutes: number;
  netHours: number | null;
  note: string;
}

/**
 * READ-ONLY dry run: fetches real Jibble data for a window and reports a
 * redacted, human-checkable summary — same parsing path as the real sync
 * (fetchJibbleTimeEntries/parseJibbleEntry), but NEVER calls
 * import_jibble_time_entry() and never advances the sync checkpoint. Meant
 * to be run once against a real tenant, by hand, BEFORE the real cron is
 * ever enabled — to confirm field names, timezones, and the shape of a
 * complete shift (clock-in → break → clock-out) look right before anything
 * gets written to the database.
 *
 * Query params (all optional):
 *   ?hours=48          — how far back to look (default DEFAULT_WINDOW_HOURS)
 *   ?since=&until=     — explicit ISO range instead of ?hours
 *   ?personId=         — narrow the summary to one Jibble person id, e.g. to
 *                        walk through a single employee's shift for review
 *                        (fetches the same full window either way; only the
 *                        summary/samples below are filtered)
 *
 * Notes are redacted to their first 40 characters — long enough to spot a
 * project name, short enough not to leak the rest of a personal note into
 * a log or a screen share.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const since = searchParams.get("since")
    ? new Date(searchParams.get("since")!)
    : new Date(now.getTime() - Number(searchParams.get("hours") ?? DEFAULT_WINDOW_HOURS) * 60 * 60 * 1000);
  const until = searchParams.get("until") ? new Date(searchParams.get("until")!) : now;
  const personIdFilter = searchParams.get("personId");

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
    return NextResponse.json({ error: "Invalid or empty since/until range." }, { status: 400 });
  }

  const fetched = await fetchJibbleTimeEntries(since.toISOString(), until.toISOString());
  const result = personIdFilter
    ? { ...fetched, parsed: fetched.parsed.filter((e) => e.personId === personIdFilter) }
    : fetched;
  const admin = createAdminClient();

  // Read-only employee lookup (jibble_person_id -> employee/country), the
  // exact same mapping import_jibble_time_entry() uses server-side, but
  // queried directly here so the preview can compute a real local work
  // date without writing anything.
  const personIds = Array.from(new Set(result.parsed.map((e) => e.personId)));
  const { data: employees } = personIds.length
    ? await admin.from("employees").select("jibble_person_id, country_code").in("jibble_person_id", personIds)
    : { data: [] as { jibble_person_id: string | null; country_code: string }[] };
  const countryByPerson = new Map((employees ?? []).filter((e) => e.jibble_person_id).map((e) => [e.jibble_person_id as string, e.country_code]));

  const tzCache = new Map<string, string>();
  async function timezoneFor(countryCode: string): Promise<string> {
    if (tzCache.has(countryCode)) return tzCache.get(countryCode)!;
    const { data } = await admin.rpc("country_timezone", { p_country_code: countryCode });
    const tz = typeof data === "string" ? data : "Asia/Dubai";
    tzCache.set(countryCode, tz);
    return tz;
  }

  function localDate(iso: string, tz: string): string {
    return new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
  }

  const shifts: ShiftSummary[] = [];
  for (const entry of result.parsed) {
    const countryCode = countryByPerson.get(entry.personId) ?? null;
    let localWorkDate: string | null = null;
    let crossesMidnightLocally: boolean | null = null;
    if (countryCode && entry.start) {
      const tz = await timezoneFor(countryCode);
      localWorkDate = localDate(entry.start, tz);
      if (entry.end) crossesMidnightLocally = localDate(entry.end, tz) !== localWorkDate;
    }

    const durationHours = entry.start && entry.end ? (Date.parse(entry.end) - Date.parse(entry.start)) / 3600000 : null;
    const netHours = durationHours !== null && !entry.needsReview ? Math.round((durationHours - entry.breakMinutes / 60) * 100) / 100 : null;

    shifts.push({
      jibbleEntryId: entry.jibbleEntryId,
      personId: entry.personId,
      employeeMapped: countryCode !== null,
      entryStatus: entry.entryStatus,
      needsReview: entry.needsReview,
      reviewReason: entry.reviewReason,
      start: entry.start,
      end: entry.end,
      localWorkDate,
      crossesMidnightLocally,
      durationHours: durationHours !== null ? Math.round(durationHours * 100) / 100 : null,
      breakMinutes: entry.breakMinutes,
      netHours,
      note: entry.note ? (entry.note.length > 40 ? `${entry.note.slice(0, 40)}…` : entry.note) : "(none)",
    });
  }

  const exampleCompleteShift = shifts.find((s) => s.entryStatus === "completed" && !s.needsReview) ?? null;
  const exampleOvernightShift = shifts.find((s) => s.crossesMidnightLocally === true && !s.needsReview) ?? null;

  const byReviewCategory: Record<string, number> = {};
  for (const entry of result.parsed as ParsedJibbleEntry[]) {
    if (!entry.needsReview) continue;
    const key = entry.reviewReason ?? "(unspecified)";
    byReviewCategory[key] = (byReviewCategory[key] ?? 0) + 1;
  }

  return NextResponse.json({
    mode: "preview — read-only, nothing was imported or checkpointed",
    since: since.toISOString(),
    until: until.toISOString(),
    personIdFilter,
    pagesFetched: result.pagesFetched,
    fetched: result.parsed.length,
    unparseableCount: result.unparseable.length,
    unparseableSamples: result.unparseable.slice(0, MAX_SAMPLES).map((e) => ({ reason: e.reason, raw: redactValue(e.raw) })),
    completedCount: shifts.filter((s) => s.entryStatus === "completed").length,
    inProgressCount: shifts.filter((s) => s.entryStatus === "in_progress").length,
    unmappedPersonCount: shifts.filter((s) => !s.employeeMapped).length,
    needsReviewCount: shifts.filter((s) => s.needsReview).length,
    needsReviewByReason: byReviewCategory,
    exampleCompleteShift,
    exampleOvernightShift,
    sampleShifts: shifts.slice(0, MAX_SAMPLES),
  });
}
