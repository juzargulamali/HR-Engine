/**
 * Every record this suite creates in Production must be traceable back to a
 * single test run, so the dry-run cleanup script (scripts/dry-run-cleanup.ts)
 * can list — and, on a later authorized run, safely remove — exactly what
 * this suite made, and nothing else. There is no schema support for a
 * dedicated "created by e2e" column, so the tag is embedded in whatever
 * free-text field the record already has (a leave request's reason, a
 * reimbursement's description, an uploaded file's name, etc.) — never in a
 * field a real user would read as part of an approval decision.
 */

/** Prefix embedded in every free-text field this suite writes. */
export function tag(runId: string, label: string): string {
  return `[${runId}] ${label}`;
}

/** True if a piece of text carries this run's tag — used by the dry-run
 * cleanup script to positively identify suite-created records rather than
 * inferring from a date range or "looks like a test". */
export function isTagged(text: string | null | undefined, runId: string): boolean {
  if (!text) return false;
  return text.startsWith(`[${runId}]`);
}

/** A short, human-legible, collision-resistant suffix for names/emails/etc.
 * that must be unique per test (not just per run) — e.g. two leave requests
 * created by the same spec file back to back. Not cryptographically random;
 * only needs to avoid colliding within one suite run. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Builds a tagged, per-test-unique reason/description string, e.g.
 * `tagNote(runId, "annual-leave-submit", "Requesting 2 days")` ->
 * `"[E2E-20260925-0130] annual-leave-submit-a1b2c3 Requesting 2 days"`. */
export function tagNote(runId: string, testKey: string, detail?: string): string {
  const base = `${testKey}-${uniqueSuffix()}`;
  return tag(runId, detail ? `${base} ${detail}` : base);
}

/**
 * Some tables this suite touches (attendance_records, recovery_credit_requests)
 * have no free-text field to embed a run tag in — they're keyed by
 * (employee_id, work_date) instead. For those, identity comes from a
 * synthetic, always-in-the-future date derived deterministically from the
 * run ID, never from "today" or a real historical date a real attendance
 * import could also land on. The dry-run cleanup script matches on this
 * same derivation, scoped to known test employee IDs — never a bare date
 * range — so it can never pick up a real employee's real attendance record.
 *
 * Base year 2099 is arbitrary except for being far past any real payroll or
 * attendance data this system could plausibly hold.
 */
const TEST_DATE_BASE = Date.UTC(2099, 0, 1);
const TEST_DATE_SPAN_DAYS = 300;

function hashRunId(runId: string): number {
  let h = 0;
  for (let i = 0; i < runId.length; i++) {
    h = (h * 31 + runId.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** `offsetDays` distinguishes multiple test dates within the same run
 * (e.g. one for an attendance spec, another for a leave-overlap spec). */
export function testDate(runId: string, offsetDays = 0): string {
  const dayOffset = (hashRunId(runId) % TEST_DATE_SPAN_DAYS) + offsetDays;
  const ms = TEST_DATE_BASE + dayOffset * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
