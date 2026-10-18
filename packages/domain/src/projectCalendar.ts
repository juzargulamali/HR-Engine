/**
 * Calendar helpers for Projects. Date-only deadlines are plain YYYY-MM-DD strings and are never converted through a time
 * zone (no UTC shift). Timed events are instants plus the IANA zone of the site; the viewer's zone and the source zone are
 * both shown. Daylight-saving transitions are left to Intl and to Postgres.
 */

const DAY_MS = 86_400_000;

export const isDateOnly = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Parse YYYY-MM-DD as a UTC midnight (so arithmetic never depends on the machine's zone). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
export const formatDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => formatDay(new Date(parseDay(day).getTime() + n * DAY_MS));
export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (day: string) => (parseDay(day).getUTCDay() + 6) % 7;
export const startOfWeek = (day: string) => addDays(day, -weekdayIndex(day));
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
export function addMonths(day: string, n: number): string {
  const d = parseDay(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return formatDay(d);
}
export const monthEnd = (day: string) => addDays(addMonths(day, 1), -1);

export interface CalendarCell {
  day: string;
  inMonth: boolean;
}

/** Six-week-at-most grid, Monday first, covering the month containing `anyDay`. */
export function monthGrid(anyDay: string): CalendarCell[][] {
  const first = monthStart(anyDay);
  const last = monthEnd(anyDay);
  const weeks: CalendarCell[][] = [];
  let cursor = startOfWeek(first);
  while (cursor <= last) {
    const week: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i);
      week.push({ day, inMonth: day.slice(0, 7) === first.slice(0, 7) });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export interface CalendarEntry {
  kind: string;
  id: string;
  title: string;
  /** Date-only entries: the first and last day. Timed entries are placed on the days they touch in the viewing zone. */
  onDate: string | null;
  endDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  tz: string | null;
}

/** The YYYY-MM-DD an instant falls on in `timeZone`. */
export const dayInZone = (instant: string | Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

/** Every day an entry occupies, in the viewing zone (a multi-day or overnight booking occupies each day it touches). */
export function entryDays(e: CalendarEntry, viewTz: string): string[] {
  if (e.onDate) {
    const end = e.endDate && e.endDate >= e.onDate ? e.endDate : e.onDate;
    const out: string[] = [];
    for (let d = e.onDate; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }
  if (e.startsAt && e.endsAt) {
    const first = dayInZone(e.startsAt, viewTz);
    // An event that ends exactly at midnight does not occupy the next day.
    const last = dayInZone(new Date(new Date(e.endsAt).getTime() - 1), viewTz);
    const out: string[] = [];
    for (let d = first; d <= (last < first ? first : last) && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  }
  return [];
}

export function groupByDay<T extends CalendarEntry>(entries: readonly T[], viewTz: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const e of entries) for (const d of entryDays(e, viewTz)) (map.get(d) ?? map.set(d, []).get(d)!).push(e);
  return map;
}

/** "Thu 12 Mar, 09:00 GMT+4" in the given zone. */
export function formatInstant(instant: string, timeZone: string, withZone = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
    ...(withZone ? { timeZoneName: "short" } : {}),
  }).format(new Date(instant));
}

/**
 * A timed event as people need to read it: the SITE's local time first (the source), and, when the viewer is somewhere
 * else, their own time as well. Never hides which zone a time is in.
 */
export function describeTimedEvent(startsAt: string, endsAt: string, sourceTz: string, viewTz: string): { source: string; viewer: string | null } {
  const source = `${formatInstant(startsAt, sourceTz)} to ${formatInstant(endsAt, sourceTz)}`;
  if (sourceTz === viewTz) return { source, viewer: null };
  return { source, viewer: `${formatInstant(startsAt, viewTz)} to ${formatInstant(endsAt, viewTz)} (your time)` };
}

/** Local wall-clock "YYYY-MM-DDTHH:mm" of an instant in a zone, for datetime-local inputs. */
export function localInputValue(instant: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Position of a bar inside a range as percentages, for the timeline chart (the same data is always offered as a table). */
export function barPosition(start: string, end: string, rangeStart: string, rangeEnd: string): { left: number; width: number } {
  const total = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);
  const s = Math.max(0, daysBetween(rangeStart, start));
  const e = Math.min(total - 1, daysBetween(rangeStart, end));
  return { left: (s / total) * 100, width: (Math.max(1, e - s + 1) / total) * 100 };
}
