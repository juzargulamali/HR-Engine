import { formatDate, formatDateTime } from "@/components/sales/format";

export { formatDate, formatDateTime };

/** Today's date (YYYY-MM-DD) in Dubai: the company's working calendar. Date-only deadlines are compared as plain dates. */
export const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());

export const isOverdue = (due: string | null | undefined, open: boolean) => Boolean(open && due && due < todayIso());

/** "12 Mar 2026" for a plain date, "—" when none. Never routed through a time zone. */
export const dateText = (d: string | null | undefined) => (d ? formatDate(d) : "—");

export const dateRangeText = (a: string | null | undefined, b: string | null | undefined) =>
  !a && !b ? "Not set" : a && b && a !== b ? `${formatDate(a)} to ${formatDate(b)}` : formatDate(a ?? b);

/** A readable list of IANA zones for forms (the site's zone drives installation and show bookings). */
export const COMMON_TIME_ZONES = ["Asia/Dubai", "Asia/Riyadh", "Europe/Warsaw", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Istanbul", "Asia/Qatar", "Asia/Kuwait", "Asia/Bahrain", "Africa/Cairo", "Asia/Kolkata", "America/New_York", "UTC"];
