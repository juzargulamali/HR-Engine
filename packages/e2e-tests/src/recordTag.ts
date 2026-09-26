/**
 * Every record this suite creates in Production must be traceable back to a
 * single test run, so it can be reported (tests/reconcile) and, if the
 * person operating Supabase afterward chooses to, found and removed
 * directly. There is no schema support for a dedicated "created by e2e"
 * column, so the tag is embedded in whatever free-text field the record
 * already has (a leave request's reason, a reimbursement's description,
 * etc.) — never in a field a real user would read as part of an approval
 * decision.
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
 * import could also land on.
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

/** A generic synthetic future date, with no weekday guarantee — safe for
 * fields the app doesn't validate against working-day/weekend rules (e.g.
 * a reimbursement's expense date). `offsetDays` distinguishes multiple test
 * dates within the same run. Do NOT use this for leave or attendance dates
 * — see testWorkday()/testWeekendDay() below for why. */
export function testDate(runId: string, offsetDays = 0): string {
  const dayOffset = (hashRunId(runId) % TEST_DATE_SPAN_DAYS) + offsetDays;
  const ms = TEST_DATE_BASE + dayOffset * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Leave and attendance dates ARE validated against real working-day rules,
 * verified directly from source:
 *
 * - `apps/web/src/lib/actions/leave.ts` rejects a request whose date range
 *   has no working day at all ("weekends/holidays only").
 * - `record_attendance_and_recovery()` (schema/schema.sql) derives a
 *   "recovery day" (weekend or holiday) from each country's
 *   `working_weekdays`/`week_start_day`, and — this is the important part —
 *   automatically creates a `recovery_credit_requests` row (with its own
 *   approval) whenever an attendance row is saved with `status = 'present'`
 *   on a day it considers a recovery day. There is no separate UI control
 *   for this; it is a pure function of the date and status. Landing a
 *   "plain" attendance/leave test on a real recovery day would silently
 *   create a misleading recovery-credit record instead of a plain one.
 *
 * This suite's three seeded countries use two weekend patterns (verified
 * against supabase/seed.sql's `countries` rows, both currently with no
 * `working_weekdays` override, so both fall back to the `week_start_day`
 * derivation): UAE/Saudi Arabia (week_start_day=0, Sunday) => Friday+
 * Saturday off; Poland (week_start_day=1, Monday) => Saturday+Sunday off.
 * Since which of the three the Employee test account belongs to isn't
 * knowable from source alone, every date below is chosen to be correct
 * under BOTH patterns rather than assuming one.
 *
 * Anchors are fixed weekdays in 2099 (verified: 2099-01-06 is a Tuesday,
 * 2099-01-10 is a Saturday); only whole WEEKS are added per run/offset, so
 * the weekday — and therefore which of these two rules applies — never
 * shifts no matter which run or offset picks the date.
 */
const WORKDAY_ANCHOR = Date.UTC(2099, 0, 6); // Tuesday — a working day under every seeded country's weekend rule.
const WEEKEND_ANCHOR = Date.UTC(2099, 0, 10); // Saturday — a weekend day under every seeded country's weekend rule.
const DATE_SPAN_WEEKS = 40;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** A synthetic future date guaranteed to be an ordinary working day
 * (Tuesday) for every seeded country — use for attendance/leave dates that
 * must NOT trigger recovery-day handling or a "no working days" rejection.
 * `offsetWeeks` distinguishes multiple such dates within the same run. */
export function testWorkday(runId: string, offsetWeeks = 0): string {
  const weekOffset = (hashRunId(runId) % DATE_SPAN_WEEKS) + offsetWeeks;
  const ms = WORKDAY_ANCHOR + weekOffset * MS_PER_WEEK;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A synthetic future date guaranteed to be a weekend day (Saturday) for
 * every seeded country — use to deliberately, reliably exercise the
 * automatic recovery-credit path in record_attendance_and_recovery().
 * `offsetWeeks` distinguishes multiple such dates within the same run. */
export function testWeekendDay(runId: string, offsetWeeks = 0): string {
  const weekOffset = (hashRunId(runId) % DATE_SPAN_WEEKS) + offsetWeeks;
  const ms = WEEKEND_ANCHOR + weekOffset * MS_PER_WEEK;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every tagged string this suite generates starts with `[E2E-...]` — `[`
 * and `]` (and the tag's own `-` runs) are regex metacharacters. Any spec
 * that builds a `new RegExp(...)` from a tagged reason/description MUST
 * escape it through this first, or a run ID like `E2E-20260925-013045` can
 * parse as an invalid/reversed character-class range and throw at runtime
 * instead of matching the literal text. */
export function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
