/**
 * Deterministic day-count calculator used both by the leave-request
 * submission Server Action (before insert) and the UI preview — the same
 * function, so what an employee sees before submitting is exactly what
 * gets stored. Never re-implemented ad hoc elsewhere (docs/05-automation-rules.md §5.2).
 *
 * Weekend days are derived from `countries.week_start_day` (0=Sunday..
 * 6=Saturday): the five days starting there are the work week, the other
 * two are the weekend — Sun-Thu work week (weekStartDay=0) means Fri/Sat
 * weekend (UAE, KSA); Mon-Fri work week (weekStartDay=1) means Sat/Sun
 * weekend (Poland). Dates are plain 'YYYY-MM-DD' strings, parsed as UTC
 * midnight so day-of-week arithmetic never shifts across a local timezone.
 */
export interface ComputeLeaveDaysParams {
  startDate: string;
  endDate: string;
  weekStartDay: number;
  holidays: readonly string[];
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
  /**
   * 'workingDays' (default — unchanged from before this field existed):
   * weekends and holidays are excluded from the count entirely, matching
   * Poland's "20/26 working days" entitlement.
   *
   * 'calendarDays': every day in the range counts, including weekends —
   * matching the UAE's "30 calendar days" and Saudi's "21/30 calendar
   * days" entitlements. Combine with `extendForHolidays` for Saudi's rule
   * that an official holiday inside the leave period doesn't consume a
   * leave day.
   */
  deductionMode?: "workingDays" | "calendarDays";
  /**
   * calendarDays only. When true, a public holiday inside the range is
   * excluded from the count (the same way a working-day calculation
   * already excludes it) rather than counted as a leave day — Saudi's
   * "official holidays falling inside annual leave extend the leave"
   * rule. Ignored (has no effect) in 'workingDays' mode, since holidays
   * are already excluded there. Defaults to false: plain calendar-day
   * counting, matching the UAE rule set, which specifies no holiday
   * interaction.
   */
  extendForHolidays?: boolean;
}

function isWorkingDay(date: Date, weekStartDay: number): boolean {
  const dayOfWeek = date.getUTCDay();
  return (dayOfWeek - weekStartDay + 7) % 7 < 5;
}

/** Same weekend/work-week rule as computeLeaveDays, exposed for callers that just need a yes/no for one date (e.g. flagging attendance). */
export function isWeekend(dateISO: string, weekStartDay: number): boolean {
  return !isWorkingDay(new Date(`${dateISO}T00:00:00Z`), weekStartDay);
}

export function computeLeaveDays(params: ComputeLeaveDaysParams): number {
  const {
    startDate,
    endDate,
    weekStartDay,
    holidays,
    halfDayStart = false,
    halfDayEnd = false,
    deductionMode = "workingDays",
    extendForHolidays = false,
  } = params;
  const holidaySet = new Set(holidays);

  let total = 0;
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    const excludedAsHoliday = holidaySet.has(iso) && (deductionMode === "workingDays" || extendForHolidays);
    const counted = deductionMode === "workingDays" ? isWorkingDay(cursor, weekStartDay) && !excludedAsHoliday : !excludedAsHoliday;

    if (counted) {
      const isFirst = iso === startDate;
      const isLast = iso === endDate;
      if (isFirst && isLast) {
        total += halfDayStart || halfDayEnd ? 0.5 : 1;
      } else {
        let value = 1;
        if (isFirst && halfDayStart) value -= 0.5;
        if (isLast && halfDayEnd) value -= 0.5;
        total += value;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return total;
}
