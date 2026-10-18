import { isWeekend } from "./leaveDays";

/**
 * What a calendar day is for someone, by the SAME rule the attendance register and record_attendance_and_recovery use: a public
 * holiday for the person's own country, otherwise the weekly rest days of that country's workweek (`working_weekdays` when set,
 * else the contiguous five days from `week_start_day`). It decides only how a missing attendance record is described; it never
 * changes any count, evidence, recovery calculation or policy.
 *
 * "unknown" is returned when the country's workweek row is not available, so a caller can say "no attendance recorded" without
 * claiming the day was or was not a scheduled workday. Individual rosters, shifts and part-time patterns are not modelled by the
 * system, so "workday" means "a scheduled day of the country workweek", nothing finer.
 */
export type ScheduledDayKind = "workday" | "weekly_rest" | "public_holiday" | "unknown";

export interface ScheduledDayInput {
  /** The person's own local date, YYYY-MM-DD (see getBusinessDateString with the person's own country time zone). */
  date: string;
  /** The person's country workweek, or null when it could not be read. */
  workweek: { weekStartDay: number; workingWeekdays: readonly number[] | null } | null;
  /** The name of a public holiday on `date` in the person's own country, or null. */
  holidayName: string | null;
}

export function classifyScheduledDay(input: ScheduledDayInput): { kind: ScheduledDayKind; holidayName: string | null } {
  if (input.holidayName) return { kind: "public_holiday", holidayName: input.holidayName };
  if (!input.workweek) return { kind: "unknown", holidayName: null };
  const rest = isWeekend(input.date, input.workweek.weekStartDay, input.workweek.workingWeekdays);
  return { kind: rest ? "weekly_rest" : "workday", holidayName: null };
}

/** Plain words for a day kind, for dashboards. */
export function describeScheduledDay(kind: ScheduledDayKind, holidayName: string | null): string {
  switch (kind) {
    case "workday":
      return "Scheduled workday";
    case "weekly_rest":
      return "Weekly rest day";
    case "public_holiday":
      return holidayName ? `Public holiday: ${holidayName}` : "Public holiday";
    case "unknown":
      return "Day type not known";
  }
}
