import { addDays, CRM_TIME_ZONE, crmToday, timeOfDayIn, zonedDateTimeToIso } from "@enginious-hr/domain";

/**
 * One-tap choices for moving a follow-up (or planning the next one). Each is a plain calendar day on the clock of the follow-up's company (`timeZone`, Dubai when
 * none is given); the dialog shows the resulting date and time before anything is saved. Across a daylight-saving change "Tomorrow" is still the next calendar
 * date at the same clock time (23 or 25 hours later, not 24).
 */
export interface WhenShortcut {
  key: "tomorrow" | "two_days" | "next_week";
  label: string;
  /** YYYY-MM-DD, a calendar day of the company's zone. */
  date: string;
}

/** Tomorrow, in 2 days and the same weekday next week, counted from today's date in the company's zone (not from the old due date, which may be long past). */
export function whenShortcuts(now: Date = new Date(), timeZone: string = CRM_TIME_ZONE): WhenShortcut[] {
  const today = crmToday(now, timeZone);
  return [
    { key: "tomorrow", label: "Tomorrow", date: addDays(today, 1) },
    { key: "two_days", label: "In 2 days", date: addDays(today, 2) },
    { key: "next_week", label: "Next week", date: addDays(today, 7) },
  ];
}

/** The time of day ("15:00") of a stored moment on the company's clock: a rescheduled follow-up keeps its hour unless the person changes it. */
export function dubaiTimeOfDay(iso: string | null | undefined, fallback = "10:00", timeZone: string = CRM_TIME_ZONE): string {
  return timeOfDayIn(timeZone, iso) ?? fallback;
}

/**
 * The moment the server will store for a date and a time typed in a follow-up form. It mirrors `dueInZone` in lib/crm/follow-up-zone.ts on purpose (a missing
 * or malformed time is saved as 09:00; the same zone), so the preview never promises a different moment from the one saved. Null while the date is missing or
 * invalid, and null for a time that does not exist that day in that zone (the server refuses it too).
 */
export function resultingDue(date: string, time: string, timeZone: string = CRM_TIME_ZONE): string | null {
  if (!date) return null;
  return zonedDateTimeToIso(timeZone, date, /^\d{2}:\d{2}$/.test(time) ? time : "09:00");
}

/** "Mon, 16 Nov 2026, 15:00" on the company's clock: the weekday is shown because a shortcut can land on a weekend. */
export function formatDueExact(iso: string, timeZone: string = CRM_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}
