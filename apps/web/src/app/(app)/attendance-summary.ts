/**
 * The sentence about attendance under the My Day greeting, from the dashboard's own totals. It talks about RECORDS only, and only
 * describes a missing record as a gap for someone who was scheduled to work (in their own country's calendar); someone on a weekly
 * rest day or public holiday is not expected to record, and someone whose day could not be classified is described neutrally.
 * Present, on leave and clocked in stay separate ideas: nothing here says anyone "is in".
 */
export interface AttendanceTotals {
  totalEmployees: number;
  notRecordedCount: number;
  notRecordedScheduledCount: number;
  notRecordedRestCount: number;
  notRecordedUnknownCount: number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function attendanceSentence(t: AttendanceTotals): string {
  const recorded = t.totalEmployees - t.notRecordedCount;
  return (
    `Attendance is recorded for ${recorded} of ${t.totalEmployees} ${plural(t.totalEmployees, "employee", "employees")} today.` +
    (t.notRecordedScheduledCount > 0
      ? ` ${t.notRecordedScheduledCount} scheduled to work ${plural(t.notRecordedScheduledCount, "has", "have")} no attendance recorded yet.`
      : "") +
    (t.notRecordedRestCount > 0
      ? ` ${t.notRecordedRestCount} ${plural(t.notRecordedRestCount, "is", "are")} on a weekly rest day or public holiday, so no attendance is expected.`
      : "") +
    (t.notRecordedUnknownCount > 0 ? ` ${t.notRecordedUnknownCount} could not be classified for today (no workweek data for their country).` : "")
  );
}

/** The explanation under the "No attendance recorded" figure. The figure counts only people scheduled to work, so this says who else has no record and why that is not a gap. */
export function noRecordHint(t: Pick<AttendanceTotals, "notRecordedScheduledCount" | "notRecordedRestCount" | "notRecordedUnknownCount">): string {
  const scheduled = t.notRecordedScheduledCount;
  const rest = t.notRecordedRestCount;
  const unknown = t.notRecordedUnknownCount;
  const parts: string[] = [];
  if (scheduled > 0) parts.push("Scheduled to work, nothing recorded yet");
  else if (rest === 0 && unknown === 0) parts.push("Everyone scheduled to work has a record");
  else parts.push("No one scheduled to work is without a record");
  if (rest > 0) parts.push(`${rest} ${scheduled > 0 ? "more " : ""}on a weekly rest day or public holiday (no attendance expected)`);
  if (unknown > 0) parts.push(`${unknown} ${scheduled > 0 || rest > 0 ? "more " : ""}not classified (no workweek data for their country)`);
  return parts.join(". ");
}

/** Said wherever "no attendance recorded" is explained: what counts as expected follows the country calendar only. */
export const CALENDAR_NOTE =
  "Attendance expectations follow each employee's country calendar (weekly rest days and public holidays), not individual rosters or shifts.";
