/**
 * Mirrors Postgres's `date + 'N months'::interval` semantics exactly: same
 * day-of-month N months later, clamped to the last day of the target month
 * when that day doesn't exist there (e.g. 2024-01-31 + 1 month = 2024-02-29,
 * not an overflow into March). Used wherever a comp-day/leave expiry date is
 * computed in application code rather than inside a SQL statement, so both
 * paths agree on the same date for the same inputs.
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const parts = isoDate.split("-").map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12; // 0-indexed, handles negative `months`
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}
