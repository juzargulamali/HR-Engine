import { addDays, CRM_TIME_ZONE, crmToday, dubaiDateTimeToIso } from "@enginious-hr/domain";

/** One-tap choices for moving a follow-up (or planning the next one). Each is a plain calendar day in the Sales time zone; the dialog shows the resulting date and time before anything is saved. */
export interface WhenShortcut {
  key: "tomorrow" | "two_days" | "next_week";
  label: string;
  /** YYYY-MM-DD, a Dubai calendar day. */
  date: string;
}

/** Tomorrow, in 2 days and the same weekday next week, counted from today's date in Dubai (not from the old due date, which may be long past). */
export function whenShortcuts(now: Date = new Date()): WhenShortcut[] {
  const today = crmToday(now);
  return [
    { key: "tomorrow", label: "Tomorrow", date: addDays(today, 1) },
    { key: "two_days", label: "In 2 days", date: addDays(today, 2) },
    { key: "next_week", label: "Next week", date: addDays(today, 7) },
  ];
}

/** The time of day ("15:00") of a stored moment, in Dubai: a rescheduled follow-up keeps its hour unless the person changes it. */
export function dubaiTimeOfDay(iso: string | null | undefined, fallback = "10:00"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CRM_TIME_ZONE }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Some engines write midnight as 24:00 in this format.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return /^\d{2}$/.test(hour) && /^\d{2}$/.test(get("minute")) ? `${hour}:${get("minute")}` : fallback;
}

/**
 * The moment the server will store for a date and a time typed in a follow-up form. It mirrors `dueIso` in lib/actions/crm.ts on purpose (a missing or
 * malformed time is saved as 09:00), so the preview never promises a different moment from the one saved. Null while the date is missing or invalid.
 */
export function resultingDue(date: string, time: string): string | null {
  if (!date) return null;
  return dubaiDateTimeToIso(date, /^\d{2}:\d{2}$/.test(time) ? time : "09:00");
}

/** "Mon, 16 Nov 2026, 15:00" in Dubai time: the weekday is shown because a shortcut can land on a weekend. */
export function formatDueExact(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: CRM_TIME_ZONE }).format(new Date(iso));
}
