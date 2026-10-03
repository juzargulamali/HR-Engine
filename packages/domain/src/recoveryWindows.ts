/**
 * Recovery Leave — working periods and 24-elapsed-hour recovery windows.
 * Pure functions only (no I/O): the database engine in
 * supabase/migrations/20261108000000_recovery_windows_attendance_redesign.sql
 * implements the SAME rules inside one atomic transaction, and the two are
 * pinned to each other by shared boundary scenarios (see
 * packages/domain/test/recoveryWindows.test.ts and
 * packages/rls-tests/test/recovery_windows_engine.rls.test.ts).
 *
 * Three concepts are kept deliberately separate, in code and in wording:
 *
 *  1. A clock SESSION — one actual clock-in to clock-out (made of mode
 *     segments). Raw evidence; never rewritten by any calculation here.
 *  2. A working PERIOD — one or more sessions joined by clocked-out gaps
 *     SHORTER than the rest threshold (8 h). It is "work without a real
 *     rest". A gap of exactly 8 h or more ends it.
 *  3. A recovery WINDOW — at most 24 REAL elapsed hours, anchored to the
 *     period's first clock-in and then to each previous window boundary.
 *     Entitlement is decided per window; the cap is 1 day PER window.
 *
 * Recorded time is clocked-in duration only (lunch while clocked in counts;
 * clocked-out gaps never do). Durations are kept as precise seconds and
 * compared exactly — nothing is rounded into a different band.
 */

export const SECONDS_PER_HOUR = 3600;
const MS_PER_HOUR = 3_600_000;

export type RecoveryDayClassification = "normal_day" | "rest_day" | "public_holiday";
export type RecoveryEntitlementDays = 0 | 0.5 | 1;

export interface RecoveryWindowRules {
  /** Real elapsed hours in one recovery window (not worked hours, not a calendar day). */
  windowHours: number;
  /** A clocked-out gap of at least this many hours ends a working period. */
  restGapHours: number;
  /** HR is alerted when accumulated recorded work reaches this many hours without a rest. Warning only. */
  alertWorkHours: number;
  /** Normal daily requirement in recorded hours (informational: never causes a deduction). */
  normalDayRequiredHours: number;
  /** Normal working day: <= zeroMaxHours earns nothing; (zeroMax, halfMax] earns 0.5; > halfMax earns 1. */
  normalDay: { zeroMaxHours: number; halfMaxHours: number };
  /** Rest day / public holiday: < zeroBelowHours earns nothing; [zeroBelow, halfMax] earns 0.5; > halfMax earns 1. */
  restDay: { zeroBelowHours: number; halfMaxHours: number };
  /** Maximum recovery days one window can earn. Fixed at 1 by the policy; kept explicit so it is snapshotted. */
  maxDaysPerWindow: 1;
  /** Days after earning that unused credit expires. */
  expiryDays: number;
}

export const DEFAULT_RECOVERY_WINDOW_RULES: RecoveryWindowRules = {
  windowHours: 24,
  restGapHours: 8,
  alertWorkHours: 20,
  normalDayRequiredHours: 9,
  normalDay: { zeroMaxHours: 13, halfMaxHours: 17 },
  restDay: { zeroBelowHours: 2, halfMaxHours: 6 },
  maxDaysPerWindow: 1,
  expiryDays: 180,
};

export interface RecoveryEntitlement {
  days: RecoveryEntitlementDays;
  /** Which row of the policy table applied — shown to HR/approvers as the "rule". */
  band: "none" | "half" | "full";
}

/**
 * The ONE place the hours -> days bands are expressed. `recordedSeconds` is
 * compared exactly: 13 h 0 s earns nothing, 13 h 1 s earns 0.5 day; 6 h 0 s
 * earns 0.5, 6 h 1 s earns 1; 1 h 59 m 59 s earns nothing, 2 h earns 0.5.
 */
export function computeWindowEntitlement(
  classification: RecoveryDayClassification,
  recordedSeconds: number,
  rules: RecoveryWindowRules = DEFAULT_RECOVERY_WINDOW_RULES,
): RecoveryEntitlement {
  if (!Number.isFinite(recordedSeconds) || recordedSeconds <= 0) return { days: 0, band: "none" };
  if (classification === "normal_day") {
    if (recordedSeconds <= rules.normalDay.zeroMaxHours * SECONDS_PER_HOUR) return { days: 0, band: "none" };
    if (recordedSeconds <= rules.normalDay.halfMaxHours * SECONDS_PER_HOUR) return { days: 0.5, band: "half" };
    return { days: 1, band: "full" };
  }
  if (recordedSeconds < rules.restDay.zeroBelowHours * SECONDS_PER_HOUR) return { days: 0, band: "none" };
  if (recordedSeconds <= rules.restDay.halfMaxHours * SECONDS_PER_HOUR) return { days: 0.5, band: "half" };
  return { days: 1, band: "full" };
}

/**
 * A public holiday that falls on a weekly rest day is ONE benefit, never
 * two: the classification is a single value, so it can only ever map to a
 * single band row.
 */
export function classifyRecoveryDay(params: { isPublicHoliday: boolean; isWeeklyRestDay: boolean }): RecoveryDayClassification {
  if (params.isPublicHoliday) return "public_holiday";
  if (params.isWeeklyRestDay) return "rest_day";
  return "normal_day";
}

/**
 * Mirrors the database's is_recovery_eligible_day(): a date is a weekly rest
 * day when its weekday is not one of the country's configured working
 * weekdays (0 = Sunday ... 6 = Saturday). `localDate` is the employee's
 * LOCAL calendar date of the window START ('YYYY-MM-DD') — the caller
 * derives it from the employment country's timezone, never from the
 * viewer's browser or device location.
 */
export function isWeeklyRestDay(localDate: string, workingWeekdays: readonly number[]): boolean {
  const dow = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return !workingWeekdays.includes(dow);
}

// ---------------------------------------------------------------------
// Working periods and windows
// ---------------------------------------------------------------------

export interface WorkInterval {
  /** Stable id of the raw evidence (an attendance segment). */
  id: string;
  startMs: number;
  /** null = still running; counted up to `asOfMs` as a clearly provisional figure. */
  endMs: number | null;
  /** Optional passthrough so callers can show contributing sessions/modes. */
  sessionId?: string;
  workMode?: string;
}

export interface WindowAllocation {
  intervalId: string;
  startMs: number;
  endMs: number;
  seconds: number;
}

export type RecoveryWindowClosedReason = "elapsed_window" | "rest";

export interface RecoveryWindowResult {
  /** 1-based position within the period (a window with no recorded work is never emitted, so indexes can skip). */
  index: number;
  startMs: number;
  endMs: number;
  recordedSeconds: number;
  closed: boolean;
  closedAtMs: number | null;
  closedReason: RecoveryWindowClosedReason | null;
  allocations: WindowAllocation[];
}

export interface RecoveryRolloverEvent {
  /** The window that rolled over (its 24 elapsed hours ran out while the period was still unrested). */
  windowIndex: number;
  atMs: number;
}

export interface RecoveryPeriodResult {
  startMs: number;
  lastWorkEndMs: number;
  /** Real elapsed time from the first clock-in to the last recorded work instant — distinct from recorded hours when gaps exist. */
  elapsedSeconds: number;
  recordedSeconds: number;
  /** True while a clock session is still running as of `asOfMs`. */
  hasOpenInterval: boolean;
  /** When 8 h of rest completes after the last work instant (null while a session is running). */
  restCompletesAtMs: number | null;
  /** True once the rest threshold has actually been reached as of `asOfMs`. */
  ended: boolean;
  /** Clocked-out gaps inside the period (each shorter than the rest threshold). */
  gaps: { startMs: number; endMs: number }[];
  windows: RecoveryWindowResult[];
  /** Instant accumulated recorded work reached the alert threshold, or null if it has not. */
  longWorkTriggerMs: number | null;
  rollovers: RecoveryRolloverEvent[];
}

interface NormalisedInterval extends WorkInterval {
  endMs: number;
  open: boolean;
}

/**
 * Groups raw work intervals into working periods and splits each into
 * 24-elapsed-hour windows. Every recorded second belongs to exactly one
 * window (intervals are split mathematically at boundaries; the raw
 * evidence is never altered), and the sum of window seconds always equals
 * the sum of the interval durations.
 */
export function buildRecoveryPeriods(
  intervals: readonly WorkInterval[],
  asOfMs: number,
  rules: RecoveryWindowRules = DEFAULT_RECOVERY_WINDOW_RULES,
): RecoveryPeriodResult[] {
  const restMs = rules.restGapHours * MS_PER_HOUR;
  const windowMs = rules.windowHours * MS_PER_HOUR;
  const alertSeconds = rules.alertWorkHours * SECONDS_PER_HOUR;

  const normalised: NormalisedInterval[] = intervals
    .map((i) => {
      const open = i.endMs === null;
      const endMs = open ? Math.max(asOfMs, i.startMs) : (i.endMs as number);
      return { ...i, endMs, open };
    })
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const groups: NormalisedInterval[][] = [];
  let currentEnd = Number.NEGATIVE_INFINITY;
  for (const interval of normalised) {
    const last = groups[groups.length - 1];
    if (!last || interval.startMs - currentEnd >= restMs) {
      groups.push([interval]);
      currentEnd = interval.endMs;
    } else {
      last.push(interval);
      currentEnd = Math.max(currentEnd, interval.endMs);
    }
  }

  return groups.map((group) => buildPeriod(group, asOfMs, restMs, windowMs, alertSeconds));
}

function buildPeriod(
  group: NormalisedInterval[],
  asOfMs: number,
  restMs: number,
  windowMs: number,
  alertSeconds: number,
): RecoveryPeriodResult {
  const startMs = group[0]!.startMs;
  const lastWorkEndMs = group.reduce((max, i) => Math.max(max, i.endMs), startMs);
  const hasOpenInterval = group.some((i) => i.open);
  const restCompletesAtMs = hasOpenInterval ? null : lastWorkEndMs + restMs;
  const ended = restCompletesAtMs !== null && restCompletesAtMs <= asOfMs;

  const gaps: { startMs: number; endMs: number }[] = [];
  let runningEnd = group[0]!.endMs;
  for (const interval of group.slice(1)) {
    if (interval.startMs > runningEnd) gaps.push({ startMs: runningEnd, endMs: interval.startMs });
    runningEnd = Math.max(runningEnd, interval.endMs);
  }

  const byIndex = new Map<number, RecoveryWindowResult>();
  let recordedSeconds = 0;
  let cumulative = 0;
  let longWorkTriggerMs: number | null = null;

  for (const interval of group) {
    let cursor = interval.startMs;
    while (cursor < interval.endMs) {
      const index = Math.floor((cursor - startMs) / windowMs) + 1;
      const windowStart = startMs + (index - 1) * windowMs;
      const windowEnd = windowStart + windowMs;
      const pieceEnd = Math.min(interval.endMs, windowEnd);
      const seconds = (pieceEnd - cursor) / 1000;

      if (longWorkTriggerMs === null && cumulative + seconds >= alertSeconds) {
        longWorkTriggerMs = cursor + (alertSeconds - cumulative) * 1000;
      }
      cumulative += seconds;
      recordedSeconds += seconds;

      let window = byIndex.get(index);
      if (!window) {
        window = {
          index,
          startMs: windowStart,
          endMs: windowEnd,
          recordedSeconds: 0,
          closed: false,
          closedAtMs: null,
          closedReason: null,
          allocations: [],
        };
        byIndex.set(index, window);
      }
      window.recordedSeconds += seconds;
      window.allocations.push({ intervalId: interval.id, startMs: cursor, endMs: pieceEnd, seconds });
      cursor = pieceEnd;
    }
  }

  const windows = [...byIndex.values()].sort((a, b) => a.index - b.index);
  for (const window of windows) {
    const boundaryPassed = window.endMs <= asOfMs;
    // The window closes at whichever comes first: its own 24 elapsed hours
    // running out, or the period actually ending by 8 h of rest.
    const candidates: { at: number; reason: RecoveryWindowClosedReason }[] = [];
    if (boundaryPassed) candidates.push({ at: window.endMs, reason: "elapsed_window" });
    if (ended && restCompletesAtMs !== null) candidates.push({ at: restCompletesAtMs, reason: "rest" });
    if (candidates.length > 0) {
      const first = candidates.reduce((a, b) => (b.at < a.at ? b : a));
      window.closed = true;
      window.closedAtMs = first.at;
      window.closedReason = first.reason;
    }
  }

  // A rollover is a 24-elapsed-hour boundary that arrives while the period
  // has NOT yet had a completed 8 h rest. It never counts as rest itself.
  const rollovers: RecoveryRolloverEvent[] = [];
  for (let k = 1; ; k += 1) {
    const boundary = startMs + k * windowMs;
    if (boundary > asOfMs) break;
    if (restCompletesAtMs !== null && restCompletesAtMs <= boundary) break;
    rollovers.push({ windowIndex: k, atMs: boundary });
  }

  return {
    startMs,
    lastWorkEndMs,
    elapsedSeconds: (lastWorkEndMs - startMs) / 1000,
    recordedSeconds,
    hasOpenInterval,
    restCompletesAtMs,
    ended,
    gaps,
    windows,
    longWorkTriggerMs,
    rollovers,
  };
}

// ---------------------------------------------------------------------
// Policy rule payload: parse/validate/wording
// ---------------------------------------------------------------------

export type RecoveryWindowRulesIssue = string;

/**
 * Reads the machine-readable `rules` object stored in a recovery-windows
 * policy payload (snake_case, as the database stores it). Returns either the
 * typed rules or a list of plain-English problems — never a half-valid object.
 */
export function parseRecoveryWindowRules(raw: unknown): { rules: RecoveryWindowRules } | { issues: RecoveryWindowRulesIssue[] } {
  const issues: string[] = [];
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const normal = (obj.normal_day && typeof obj.normal_day === "object" ? obj.normal_day : {}) as Record<string, unknown>;
  const rest = (obj.rest_day && typeof obj.rest_day === "object" ? obj.rest_day : {}) as Record<string, unknown>;

  const num = (value: unknown, label: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      issues.push(`${label} must be a positive number.`);
      return Number.NaN;
    }
    return value;
  };

  const windowHours = num(obj.window_hours, "window_hours");
  const restGapHours = num(obj.rest_gap_hours, "rest_gap_hours");
  const alertWorkHours = num(obj.alert_work_hours, "alert_work_hours");
  const normalDayRequiredHours = num(obj.normal_day_required_hours, "normal_day_required_hours");
  const nZero = num(normal.zero_max_hours, "normal_day.zero_max_hours");
  const nHalf = num(normal.half_max_hours, "normal_day.half_max_hours");
  const rZero = num(rest.zero_below_hours, "rest_day.zero_below_hours");
  const rHalf = num(rest.half_max_hours, "rest_day.half_max_hours");
  const expiryDays = num(obj.expiry_days, "expiry_days");
  if (obj.max_days_per_window !== 1) issues.push("max_days_per_window must be exactly 1.");

  if (issues.length === 0) {
    if (windowHours > 48) issues.push("window_hours must not exceed 48.");
    if (restGapHours >= windowHours) issues.push("rest_gap_hours must be shorter than window_hours.");
    if (alertWorkHours > windowHours) issues.push("alert_work_hours must not exceed window_hours.");
    if (nZero >= nHalf) issues.push("normal_day.zero_max_hours must be less than normal_day.half_max_hours.");
    if (rZero >= rHalf) issues.push("rest_day.zero_below_hours must be less than rest_day.half_max_hours.");
    if (nHalf > windowHours) issues.push("normal_day.half_max_hours must not exceed window_hours.");
  }
  if (issues.length > 0) return { issues };

  return {
    rules: {
      windowHours,
      restGapHours,
      alertWorkHours,
      normalDayRequiredHours,
      normalDay: { zeroMaxHours: nZero, halfMaxHours: nHalf },
      restDay: { zeroBelowHours: rZero, halfMaxHours: rHalf },
      maxDaysPerWindow: 1,
      expiryDays,
    },
  };
}

/** Inverse of parseRecoveryWindowRules(): the snake_case shape the database stores. */
export function recoveryWindowRulesToPayload(rules: RecoveryWindowRules): Record<string, unknown> {
  return {
    window_hours: rules.windowHours,
    rest_gap_hours: rules.restGapHours,
    alert_work_hours: rules.alertWorkHours,
    normal_day_required_hours: rules.normalDayRequiredHours,
    normal_day: { zero_max_hours: rules.normalDay.zeroMaxHours, half_max_hours: rules.normalDay.halfMaxHours },
    rest_day: { zero_below_hours: rules.restDay.zeroBelowHours, half_max_hours: rules.restDay.halfMaxHours },
    max_days_per_window: rules.maxDaysPerWindow,
    expiry_days: rules.expiryDays,
  };
}

const n = (value: number): string => String(value);

/**
 * Human-readable wording GENERATED from the machine rules, never typed
 * separately — so the policy text a person reads can never describe
 * different numbers from the ones the engine calculates with. The database
 * regenerates the stored `wording` with the identical template
 * (render_recovery_window_policy_wording()); the RLS suite asserts the two
 * outputs are byte-identical for the same rules.
 */
export function renderRecoveryWindowPolicyWording(rules: RecoveryWindowRules): string {
  return [
    "Recovery Leave is measured from recorded clocked-in time. Lunch while clocked in counts; clocked-out gaps never count; there is no assumed lunch deduction.",
    `Working period: work separated by clocked-out gaps shorter than ${n(rules.restGapHours)} hours is one working period. A gap of ${n(rules.restGapHours)} hours or more ends it, and the next clock-in starts a fresh period.`,
    `Recovery window: each window is ${n(rules.windowHours)} real elapsed hours, starting at the first clock-in of the working period and then at each previous window boundary, and earns at most ${n(rules.maxDaysPerWindow)} day. Windows roll over automatically without any rest and without a manual clock-out.`,
    `Normal working day (normal requirement ${n(rules.normalDayRequiredHours)} recorded hours, with no automatic deduction for a shorter day): up to and including ${n(rules.normalDay.zeroMaxHours)} recorded hours earns nothing; more than ${n(rules.normalDay.zeroMaxHours)} and up to and including ${n(rules.normalDay.halfMaxHours)} hours earns 0.5 day; more than ${n(rules.normalDay.halfMaxHours)} hours earns 1 day.`,
    `Weekly rest day or applicable public holiday: under ${n(rules.restDay.zeroBelowHours)} recorded hours earns nothing; from ${n(rules.restDay.zeroBelowHours)} up to and including ${n(rules.restDay.halfMaxHours)} hours earns 0.5 day; more than ${n(rules.restDay.halfMaxHours)} hours earns 1 day. A public holiday that falls on a rest day is counted once.`,
    "Each window is classified by the local date on which it starts, using the employee's employment country, its configured working week and its public holidays.",
    "Office, work from home, site work/installation and client meetings all qualify. Business travel is recorded and always reviewed by HR before any credit.",
    `HR is alerted when accumulated recorded work reaches ${n(rules.alertWorkHours)} hours without a ${n(rules.restGapHours)}-hour rest. This is a review signal only; it does not start a new recovery day.`,
    `Credit requires a closed window, the independent approval route for the applicant and HR verification of unusual cases. Unused credit expires ${n(rules.expiryDays)} days after it is earned and is never converted to cash, including on termination. This is an internal benefit and does not replace any mandatory statutory right.`,
  ].join("\n");
}

// ---------------------------------------------------------------------
// Presentation helpers shared by dashboard / register / approvals
// ---------------------------------------------------------------------

export type RecoveryProvisionalStatus = "none" | "awaiting_closure" | "awaiting_approval" | "approved" | "rejected";

/**
 * Plain-language state for a window's recovery amount. Provisional credit is
 * never presented as an available balance: only "approved" is real.
 */
export function describeRecoveryStatus(params: {
  windowClosed: boolean;
  entitlementDays: number;
  requestStatus: "submitted" | "pending_approval" | "approved" | "rejected" | "cancelled" | null;
}): { status: RecoveryProvisionalStatus; label: string } {
  if (params.requestStatus === "approved") return { status: "approved", label: "Approved" };
  if (params.requestStatus === "rejected") return { status: "rejected", label: "Not approved" };
  if (params.requestStatus === "submitted" || params.requestStatus === "pending_approval") {
    return { status: "awaiting_approval", label: "Awaiting approval" };
  }
  if (params.entitlementDays <= 0) return { status: "none", label: "No recovery day so far" };
  if (!params.windowClosed) return { status: "awaiting_closure", label: "Awaiting closure" };
  return { status: "awaiting_approval", label: "Awaiting approval" };
}

/** "13h 01m 05s" style label for exact durations (never rounded into a different band). */
export function formatRecordedDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}
