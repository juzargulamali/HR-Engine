import { CRM_TIME_ZONE, timeZoneCity } from "@enginious-hr/domain";

/** Money with its own currency; never summed across currencies. A missing value reads "Value not set". */
export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value == null) return "Value not set";
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "19 Oct 2026" in Dubai time (for timestamps) or as written (for plain YYYY-MM-DD dates). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const plain = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(plain ? `${value}T00:00:00Z` : value);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: plain ? "UTC" : CRM_TIME_ZONE }).format(d);
}

/** "19 Oct 2026, 15:00" in Dubai time, or on the clock of `timeZone` when one is given (a follow-up deadline: its company's zone). */
export function formatDateTime(value: string | null | undefined, timeZone: string = CRM_TIME_ZONE): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(value));
}

/** A follow-up deadline with the clock it is on: "19 Oct 2026, 15:00 (Warsaw)". The place is always written, whichever company it is. */
export function formatDue(value: string | null | undefined, timeZone: string): string {
  return value ? `${formatDateTime(value, timeZone)} (${timeZoneCity(timeZone)})` : "—";
}

/** Today's date (YYYY-MM-DD) on the clock of `timeZone`: the earliest date a deadline of that company can be given. */
export const todayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

export const formatFileSize = (bytes: number | null | undefined) =>
  bytes == null ? "" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Date + time inputs default (Dubai "today"). */
export const todayInDubai = () => new Intl.DateTimeFormat("en-CA", { timeZone: CRM_TIME_ZONE }).format(new Date());
