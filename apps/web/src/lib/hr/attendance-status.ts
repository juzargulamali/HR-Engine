/**
 * One set of words for what an attendance day says, used by the register, the employee profile and anything else that shows a day. The rules are the existing ones, only named:
 *   Absent      HR (or an approved process) recorded the day as absent. A missing record is NEVER read as absence.
 *   On leave    an approved leave covers the day, or the day was recorded as leave.
 *   Present     recorded present, or clock sessions exist for the day (it stays Present after clocking out).
 *   Partial day recorded as a partial day.
 *   Rest day    nothing recorded, and the day is a weekly rest day or public holiday for the employee's country (the same working-week rule leave uses).
 *   No record   nothing recorded on a working day. It says only that nothing exists; it does not say the person was absent.
 * The LIVE clock state (Clocked in / Clocked out / Not started) is a different fact and is always shown separately.
 */
export type DayLabel = "Absent" | "On leave" | "Present" | "Partial day" | "Rest day" | "No record";

export interface DayFacts {
  /** attendance_records.status, or the register's attendance_status; "not_recorded" when no record exists. */
  status: string | null | undefined;
  onLeave?: boolean;
  /** At least one clock session started on the day. */
  hasClockEvidence?: boolean;
  /** The day is a weekly rest day or a public holiday for the employee's country. */
  isRestDay: boolean;
}

export function attendanceDayLabel(f: DayFacts): DayLabel {
  if (f.status === "absent") return "Absent";
  if (f.onLeave || f.status === "leave") return "On leave";
  if (f.status === "present" || f.hasClockEvidence) return "Present";
  if (f.status === "partial_day") return "Partial day";
  return f.isRestDay ? "Rest day" : "No record";
}

/** Badge variant for a label (shared so the same word looks the same everywhere). */
export const DAY_LABEL_TONE: Record<DayLabel, "default" | "secondary" | "outline" | "destructive"> = {
  Absent: "destructive", "On leave": "secondary", Present: "default", "Partial day": "secondary", "Rest day": "outline", "No record": "outline",
};
