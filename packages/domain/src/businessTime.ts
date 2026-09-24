/**
 * Business-timezone-aware date/time derivation — replaces UTC-based
 * `new Date().toISOString().slice(0, 10)` "today" patterns that silently
 * assume the server's UTC clock IS the business's local calendar day. A UAE
 * (Dubai, UTC+4) employee's calendar day begins 4 hours before UTC
 * midnight; a Poland (Warsaw, UTC+1 in winter / UTC+2 in summer) employee's
 * begins 1-2 hours after — near either boundary, a UTC-derived "today" is
 * wrong for one or both, e.g. a 25 September Dubai birthday showing as
 * "Tomorrow" between 00:00 and 03:59 Dubai time (20:00-23:59 UTC on the
 * 24th).
 *
 * Every function here is a pure function of (timeZone, instant) — instant
 * defaults to `new Date()` (the real wall-clock instant) but can always be
 * passed explicitly for deterministic testing. Timezone conversion uses the
 * runtime's own IANA tzdata via the standard `Intl` API — the only correct
 * way to handle a variable UTC offset across daylight-saving transitions;
 * this file never hardcodes a fixed offset, so Europe/Warsaw's DST switch
 * is handled automatically and correctly.
 *
 * Database timestamps are NEVER affected by this file — every timestamptz
 * column keeps storing (and every existing timestamp-comparison query keeps
 * comparing) plain UTC, exactly as before. This is purely about deriving
 * the correct LOCAL CALENDAR DATE (and, for display, local time) a given
 * business context — an employee, a company, or the cross-company
 * dashboard — should use.
 *
 * Pure TypeScript with no Node- or browser-only APIs, so this module is
 * safe to import from both server code (Server Components, Server Actions,
 * cron routes) and a "use client" component (e.g. a live-updating clock) —
 * see apps/web's dashboard header for the client-side use.
 */

/** ISO 3166-1 alpha-2 country code -> IANA timezone, for every country this system currently operates in. */
export const COUNTRY_TIMEZONES: Record<string, string> = {
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  PL: "Europe/Warsaw",
};

/** The cross-company CEO/HR dashboard has no single "employee's country" to key off — Dubai (Enginious's own reference timezone) is used for it, and as the fallback for any country code this system doesn't otherwise recognise. */
export const DASHBOARD_TIMEZONE = "Asia/Dubai";

/**
 * Resolves a country code to its IANA timezone. Falls back to
 * DASHBOARD_TIMEZONE for a null/unrecognised country code rather than
 * throwing — a missing mapping should degrade to a sensible default, never
 * break a page that's otherwise unrelated to timezone correctness.
 */
export function resolveCountryTimeZone(countryCode: string | null | undefined): string {
  if (countryCode && COUNTRY_TIMEZONES[countryCode]) return COUNTRY_TIMEZONES[countryCode];
  return DASHBOARD_TIMEZONE;
}

function partsFor(timeZone: string, instant: Date): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of formatted) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** The business-local calendar date, as 'YYYY-MM-DD', for the given IANA timezone at the given instant (defaults to now). */
export function getBusinessDateString(timeZone: string, instant: Date = new Date()): string {
  const p = partsFor(timeZone, instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The first day of the business-local calendar month containing `instant`, as 'YYYY-MM-01' — e.g. for a cron's "already accrued this month" window. */
export function getBusinessMonthStartString(timeZone: string, instant: Date = new Date()): string {
  const p = partsFor(timeZone, instant);
  return `${p.year}-${p.month}-01`;
}

/** The business-local hour of day (0-23) for the given IANA timezone at the given instant — used for a time-of-day-dependent greeting. */
export function getBusinessHour(timeZone: string, instant: Date = new Date()): number {
  return Number(partsFor(timeZone, instant).hour);
}

/**
 * "Friday, 25 September 2026" — a full, locale-formatted business-local date
 * string. Defaults to "en-GB" (day-before-month long-date order), not
 * "en-US", since "en-US" renders this as "Friday, September 25, 2026" —
 * the wrong word order for the dashboard header's specified format.
 */
export function formatBusinessDateLong(timeZone: string, instant: Date = new Date(), locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(instant);
}

/** "12:35 AM" — a locale-formatted business-local time-of-day string. */
export function formatBusinessTime(timeZone: string, instant: Date = new Date(), locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(instant);
}
