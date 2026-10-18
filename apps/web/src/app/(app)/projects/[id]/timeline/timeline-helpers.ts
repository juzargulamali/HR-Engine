import { dayInZone, describeTimedEvent, localInputValue } from "@enginious-hr/domain";
import type { ProjProjectPersonRow, ProjPlanItemRow, ProjSiteBookingRow } from "@/types/projects";
import { dateRangeText } from "@/lib/projects/format";
import type { BarItem } from "@/components/projects/calendar/helpers";

/** Pure helpers for the Timelines & site page. */

export type ItemMode = "undated" | "dates" | "timed";

export const itemMode = (i: Pick<ProjPlanItemRow, "start_date" | "starts_at">): ItemMode => (i.starts_at ? "timed" : i.start_date ? "dates" : "undated");

/** The text of an item's dates: a plain date range, or a timed range in the item's own zone with the viewer's time when it differs. */
export function planItemWhen(i: ProjPlanItemRow, viewTz: string): { source: string; viewer: string | null } {
  if (i.starts_at && i.ends_at && i.tz) return describeTimedEvent(i.starts_at, i.ends_at, i.tz, viewTz);
  if (i.start_date) return { source: dateRangeText(i.start_date, i.end_date), viewer: null };
  return { source: "Not scheduled yet", viewer: null };
}

/** The first and last day an item occupies (date-only, or the days a timed item touches in its own zone), or null when undated. */
export function planItemDays(i: ProjPlanItemRow): { start: string; end: string } | null {
  if (i.start_date) return { start: i.start_date, end: i.end_date ?? i.start_date };
  if (i.starts_at && i.ends_at && i.tz) {
    const start = dayInZone(i.starts_at, i.tz);
    const end = dayInZone(new Date(new Date(i.ends_at).getTime() - 1 > new Date(i.starts_at).getTime() ? new Date(i.ends_at).getTime() - 1 : new Date(i.ends_at).getTime()), i.tz);
    return { start, end: end < start ? start : end };
  }
  return null;
}

export const planBarItems = (items: readonly ProjPlanItemRow[]): BarItem[] =>
  items.filter((i) => i.status !== "cancelled").flatMap((i) => {
    const d = planItemDays(i);
    return d ? [{ id: i.id, title: i.title, start: d.start, end: d.end }] : [];
  });

/** Dated first (earliest first), undated last, otherwise by the saved order. */
export function sortPlanItems(items: readonly ProjPlanItemRow[]): ProjPlanItemRow[] {
  const key = (i: ProjPlanItemRow) => planItemDays(i)?.start ?? "9999-12-31";
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || a.sort_order - b.sort_order || a.title.localeCompare(b.title));
}

export interface BookingActors {
  canManage: boolean;
  headOfTeamIds: readonly string[];
}

/** proj_can_book: the PM / founder books anyone; a department head books the people of their own team. */
export function canBookPerson(a: BookingActors, person: Pick<ProjProjectPersonRow, "team_id">): boolean {
  return a.canManage || (!!person.team_id && a.headOfTeamIds.includes(person.team_id));
}

export const bookablePeople = (a: BookingActors, people: readonly ProjProjectPersonRow[]) => people.filter((p) => canBookPerson(a, p));

export function bookingAllowanceText(b: Pick<ProjSiteBookingRow, "lead_minutes" | "trail_minutes">): string {
  const part = (m: number) => (m % 60 === 0 && m > 0 ? `${m / 60} h` : `${m} min`);
  if (!b.lead_minutes && !b.trail_minutes) return "No preparation or travel allowance";
  return [b.lead_minutes ? `${part(b.lead_minutes)} preparation / travel before` : null, b.trail_minutes ? `${part(b.trail_minutes)} travel after` : null].filter(Boolean).join(", ");
}

/** Wall-clock default for a datetime-local input, in the booking's own zone. */
export const localDefault = (instant: string | null, tz: string | null) => (instant && tz ? localInputValue(instant, tz) : "");

/** Splits the conflict list into those the viewer may see in detail and a count of those they may not. Hidden ones carry no detail at all. */
export function splitConflicts<T extends { is_visible: boolean }>(rows: readonly T[]): { visible: T[]; hidden: number } {
  const visible = rows.filter((r) => r.is_visible);
  return { visible, hidden: rows.length - visible.length };
}

export const hiddenConflictText = (n: number) => `${n} booking${n === 1 ? "" : "s"} on projects you cannot see`;

/** True when a refusal message is the overlap refusal (so the override form is the right next step). */
export const isOverlapRefusal = (message: string | null | undefined) => !!message && /overlap/i.test(message);
