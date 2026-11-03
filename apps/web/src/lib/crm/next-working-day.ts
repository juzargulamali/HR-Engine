import { addDays, parseWorkingCalendar } from "@enginious-hr/domain";

/**
 * The date suggested for a next follow-up: the next working day after `today` (a Dubai calendar day, YYYY-MM-DD) under the company's own working
 * calendar (working weekdays and holidays) when Sales settings hold one, otherwise Monday to Friday. It is only a suggestion the person can change.
 */
export function nextWorkingDay(today: string, workingCalendar: unknown): string {
  const cal = parseWorkingCalendar(workingCalendar);
  const workdays = cal?.workdays ?? [1, 2, 3, 4, 5];
  const holidays = new Set(cal?.holidays ?? []);
  for (let i = 1; i <= 14; i++) {
    const day = addDays(today, i);
    if (workdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay()) && !holidays.has(day)) return day;
  }
  return addDays(today, 1);
}
