import { addDays, addMonths, barPosition, daysBetween, describeTimedEvent, monthEnd, monthStart, startOfWeek, isDateOnly, type CalendarEntry } from "@enginious-hr/domain";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import type { ProjCompanyCalendarRow, ProjMyCalendarRow, ProjProjectCalendarRow } from "@/types/projects";

/** Pure helpers for the Projects calendars: query-string parsing, visible range, row mapping, filtering and text. */

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const DEFAULT_VIEW_TZ = "Asia/Dubai";
export const AGENDA_DAYS = 30;

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface CalendarParams {
  view: CalendarView;
  /** Any day inside the visible period (YYYY-MM-DD). */
  date: string;
  tz: string;
  kinds: string[];
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads and clamps view, date, time zone and kinds from the query string. Anything invalid falls back to a safe default. */
export function parseCalendarParams(sp: SP, today: string, knownKinds?: readonly string[]): CalendarParams {
  const view = (CALENDAR_VIEWS as readonly string[]).includes(one(sp.view) ?? "") ? (one(sp.view) as CalendarView) : "month";
  const rawDate = one(sp.date);
  const date = rawDate && isDateOnly(rawDate) && !Number.isNaN(Date.parse(`${rawDate}T00:00:00Z`)) && addDays(rawDate, 0) === rawDate ? rawDate : today;
  const rawTz = one(sp.tz);
  const tz = isValidTimeZone(rawTz) ? rawTz : DEFAULT_VIEW_TZ;
  const rawKinds = Array.isArray(sp.kind) ? sp.kind : sp.kind ? String(sp.kind).split(",") : [];
  const kinds = rawKinds.map((k) => k.trim()).filter((k) => k && (!knownKinds || knownKinds.includes(k)));
  return { view, date, tz, kinds: [...new Set(kinds)] };
}

/** The first and last day shown: a month, a Monday-first week, or the next 30 days from the chosen date. */
export function visibleRange(view: CalendarView, date: string): { from: string; to: string } {
  if (view === "month") return { from: monthStart(date), to: monthEnd(date) };
  if (view === "week") {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6) };
  }
  return { from: date, to: addDays(date, AGENDA_DAYS - 1) };
}

/**
 * What to fetch for a view: a month fetches whole weeks (the grid shows the days either side of the month), so entries that fall
 * on those cells are not missing from them. The agenda and the lists still show only the visible period.
 */
export function fetchRange(view: CalendarView, date: string): { from: string; to: string } {
  const { from, to } = visibleRange(view, date);
  if (view !== "month") return { from, to };
  return { from: startOfWeek(from), to: addDays(startOfWeek(to), 6) };
}

/** Previous / next period for the navigation links. */
export function neighbourDates(view: CalendarView, date: string): { prev: string; next: string } {
  if (view === "month") return { prev: addMonths(date, -1), next: addMonths(date, 1) };
  if (view === "week") return { prev: addDays(date, -7), next: addDays(date, 7) };
  return { prev: addDays(date, -AGENDA_DAYS), next: addDays(date, AGENDA_DAYS) };
}

export function rangeTitle(view: CalendarView, date: string): string {
  const { from, to } = visibleRange(view, date);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const d = (s: string) => `${Number(s.slice(8))} ${MONTHS[Number(s.slice(5, 7)) - 1]!.slice(0, 3)} ${s.slice(0, 4)}`;
  if (view === "month") return `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  return `${d(from)} to ${d(to)}`;
}

/** Builds a calendar URL keeping every other parameter. */
export function calendarHref(base: string, params: Record<string, string | string[] | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : v);
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

// ------------------------------------------------------------------------------------------------------------------
export interface DisplayEntry extends CalendarEntry {
  kindLabel: string;
  status: string | null;
  statusLabel: string | null;
  projectRef: string | null;
  projectName: string | null;
  href: string;
  /** Free text such as the assignee or the organisation. */
  detail: string | null;
}

const KIND_LABELS: Record<string, string> = {
  task: "Task deadline", review: "Review requested", milestone: "Milestone", deliverable: "Deliverable", booking: "Site booking",
  plan_delivery: "Delivery timeline", plan_site: "Site timeline", dependency: "Dependency on others", project: "Project",
};
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k;

const STATUS_LABELS: Record<string, string> = {
  todo: "To do", in_progress: "In progress", ready_for_review: "Ready for review", done: "Done", cancelled: "Cancelled", deferred: "Deferred",
  planned: "Planned", ready_for_acceptance: "Ready for acceptance", accepted: "Accepted", open: "Open",
  tentative: "Tentative", confirmed: "Confirmed", pending: "Not yet confirmed", not_possible: "Not possible",
  planning: "Planning", ready_for_installation: "Ready for installation", on_site: "On site", on_hold: "On hold", completed: "Completed", archived: "Archived",
};
export const statusText = (s: string | null | undefined) => (s ? (STATUS_LABELS[s] ?? s.replace(/_/g, " ")) : null);

export function mapMyRows(rows: readonly ProjMyCalendarRow[]): DisplayEntry[] {
  return rows.map((r) => ({
    kind: r.kind, id: `${r.kind}:${r.item_id}`, title: r.title, onDate: r.on_date, endDate: r.end_date ?? r.on_date, startsAt: r.starts_at, endsAt: r.ends_at, tz: r.tz,
    kindLabel: kindLabel(r.kind), status: r.status, statusLabel: statusText(r.status), projectRef: r.project_reference, projectName: r.project_name,
    href: r.kind === "booking" ? `/projects/${r.project_id}/plan?plan=site` : `/projects/${r.project_id}/work`,
    detail: r.detail,
  }));
}

/** Where an entry of the project calendar leads: timeline items, bookings and dependencies are in the Plan section, the rest in Work. */
function planEntryHref(projectId: string, kind: string): string {
  if (kind === "plan_delivery") return `/projects/${projectId}/plan?plan=delivery`;
  if (kind === "booking" || kind === "plan_site" || kind === "dependency") return `/projects/${projectId}/plan?plan=site`;
  return `/projects/${projectId}/work`;
}

export function mapProjectRows(rows: readonly ProjProjectCalendarRow[], projectId: string, reference: string, name: string): DisplayEntry[] {
  return rows.map((r) => ({
    kind: r.kind, id: `${r.kind}:${r.item_id}`, title: r.title, onDate: r.on_date, endDate: r.end_date ?? r.on_date, startsAt: r.starts_at, endsAt: r.ends_at, tz: r.tz,
    kindLabel: kindLabel(r.kind), status: r.status, statusLabel: statusText(r.status), projectRef: reference, projectName: name,
    href: planEntryHref(projectId, r.kind),
    detail: [r.who, r.kind === "dependency" && r.detail ? `at ${r.detail.slice(0, 5)} site time` : r.detail].filter(Boolean).join(" · ") || null,
  }));
}

/** Company calendar: one span per project, summary fields only. */
export function mapCompanyRows(rows: readonly ProjCompanyCalendarRow[]): DisplayEntry[] {
  return rows
    .filter((r) => r.start_date)
    .map((r) => ({
      kind: "project", id: `project:${r.project_id}`, title: r.name, onDate: r.start_date, endDate: r.end_date ?? r.start_date, startsAt: null, endsAt: null, tz: null,
      kindLabel: kindLabel("project"), status: r.status, statusLabel: statusText(r.status), projectRef: r.reference, projectName: r.name, href: `/projects/${r.project_id}`, detail: r.kind === "client" ? "Client project" : "Internal project",
    }));
}

export function filterKinds<T extends { kind: string }>(entries: readonly T[], kinds: readonly string[]): T[] {
  return kinds.length === 0 ? [...entries] : entries.filter((e) => kinds.includes(e.kind));
}

/** Entry text without any colour or icon meaning. Timed entries: the site's time first, the viewer's own as well when it differs. */
export function entryWhen(e: CalendarEntry, viewTz: string): { source: string; viewer: string | null } | null {
  if (e.startsAt && e.endsAt) return describeTimedEvent(e.startsAt, e.endsAt, e.tz ?? viewTz, viewTz);
  return null;
}

export function entryDateText(e: CalendarEntry): string | null {
  if (!e.onDate) return null;
  return e.endDate && e.endDate !== e.onDate ? `${e.onDate} to ${e.endDate}` : e.onDate;
}

// ------------------------------------------------------------------------------------------------------------------
export interface BarItem {
  id: string;
  title: string;
  start: string;
  end: string;
}

/** The range (min start .. max end) the bar chart covers, padded by nothing; null when there is no dated item. */
export function barRange(items: readonly { start: string; end: string }[]): { start: string; end: string } | null {
  if (items.length === 0) return null;
  let start = items[0]!.start;
  let end = items[0]!.end;
  for (const i of items) {
    if (i.start < start) start = i.start;
    if (i.end > end) end = i.end;
  }
  return { start, end };
}

export function barLayout(items: readonly BarItem[]): { range: { start: string; end: string }; days: number; bars: (BarItem & { left: number; width: number })[] } | null {
  const range = barRange(items);
  if (!range) return null;
  return {
    range,
    days: daysBetween(range.start, range.end) + 1,
    bars: items.map((i) => ({ ...i, ...barPosition(i.start, i.end, range.start, range.end) })),
  };
}

export { COMMON_TIME_ZONES };
