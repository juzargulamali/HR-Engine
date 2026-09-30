/**
 * clock_in()/switch_work_segment()/clock_out() always stamp segment_start/
 * segment_end with the server's own now() — there is no way to ask them to
 * backdate a shift onto a synthetic weekend/holiday the way the LEGACY
 * manual attendance register's testWorkday()/testWeekendDay() (src/
 * recordTag.ts) can for a p_work_date parameter. The self-clock RPCs have no
 * such parameter at all.
 *
 * sync_attendance_recovery_for_day() credits the 'overnight' event on ANY
 * ordinary (non-recovery-day) date too, though — only the hours worked past
 * LOCAL midnight, regardless of day-of-week. That path needs no synthetic
 * calendar fixture at all, just a shift that genuinely straddles a real
 * local midnight — which this suite gets by waiting for one, for real,
 * using the server's own real clock. This is the "controlled fixture
 * without weakening the application's server timestamps" this suite's
 * standing authorization requires for the self-clock 4-tier routing tests.
 *
 * Default target timezone is Asia/Dubai — country_timezone()'s own fallback
 * for any country code other than AE ('Asia/Dubai'), SA ('Asia/Riyadh'), or
 * PL ('Europe/Warsaw'). Set E2E_ATTENDANCE_CLOCK_TIMEZONE to whichever of
 * those three IANA zones actually matches the E2E_EMPLOYEE/E2E_MANAGER/
 * E2E_HR test accounts' real company's country once confirmed.
 */
export function targetTimezone(): string {
  return process.env.E2E_ATTENDANCE_CLOCK_TIMEZONE || "Asia/Dubai";
}

/** Minutes remaining until the next local midnight in `timezone`, computed
 * from the real current instant — never faked, never offset. */
export function minutesUntilLocalMidnight(timezone: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const secondsSinceLocalMidnight = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.ceil((24 * 3600 - secondsSinceLocalMidnight) / 60);
}

/** How many whole minutes have passed since the most recent local midnight —
 * used after waiting, to confirm the wait actually crossed it (defends
 * against a clock-in that started AFTER midnight by mistake, which would
 * silently produce a 'standard'-vs-'overnight' mislabel rather than a
 * failure). */
export function minutesSinceLocalMidnight(timezone: string, now: Date = new Date()): number {
  return 24 * 60 - minutesUntilLocalMidnight(timezone, now);
}
