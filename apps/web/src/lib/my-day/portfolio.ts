import { isOpenTask } from "@enginious-hr/domain";
import { addDaysIso, daysBetweenIso, weekWindow } from "@/lib/projects/week";

/**
 * Pure logic for the project parts of My Day: how live projects are grouped by deadlines and blockers, and the "Delivery this week" grid.
 * Everything is built from rows the signed-in person was already allowed to read (the caller loads them through their own session),
 * so nothing here widens access; it only counts and lays out what it is given.
 */

// ------------------------------------------------------------------------------------------------------------------------------
// Grouping by deadlines and blockers
// ------------------------------------------------------------------------------------------------------------------------------
export type ProjectHealth = "blocked" | "at_risk" | "on_track";

export interface HealthTask { project_id: string; status: string; due_date: string | null; blocked_at: string | null }
export interface HealthMilestone { project_id: string; status: string; due_date: string | null }

const OPEN_MILESTONE = ["planned", "in_progress", "ready_for_acceptance"];

/**
 * The rule, in full (it is also printed on the card): a project is **Blocked** when it has an open task that is marked blocked; else **At risk**
 * when an open task or an open milestone is past its due date; else **On track**. It is a count by those two facts, never a score or a forecast.
 */
export function classifyProjects(projectIds: readonly string[], tasks: readonly HealthTask[], milestones: readonly HealthMilestone[], today: string): Map<string, ProjectHealth> {
  const blocked = new Set<string>();
  const late = new Set<string>();
  for (const t of tasks) {
    if (!isOpenTask(t.status)) continue;
    if (t.blocked_at) blocked.add(t.project_id);
    if (t.due_date && t.due_date < today) late.add(t.project_id);
  }
  for (const m of milestones) if (OPEN_MILESTONE.includes(m.status) && m.due_date && m.due_date < today) late.add(m.project_id);
  return new Map(projectIds.map((id) => [id, blocked.has(id) ? "blocked" : late.has(id) ? "at_risk" : "on_track"] as const));
}

export function healthCounts(health: ReadonlyMap<string, ProjectHealth>): Record<ProjectHealth, number> {
  const out: Record<ProjectHealth, number> = { blocked: 0, at_risk: 0, on_track: 0 };
  for (const h of health.values()) out[h] += 1;
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------
// Delivery this week
// ------------------------------------------------------------------------------------------------------------------------------
export interface DeliveryProject { id: string; name: string; reference: string; pmName: string | null }
export interface DeliveryItem { projectId: string; id: string; title: string; start: string; end: string; status: "planned" | "in_progress" | "done" }
export interface DeliveryMilestone { projectId: string; id: string; title: string; due: string; status: string }

export interface DeliveryBar {
  id: string; title: string; status: DeliveryItem["status"];
  /** 0 = Monday ... 6 = Sunday. */
  col: number; span: number; lane: number;
  /** The item starts before Monday or ends after Sunday, so the bar is cut at the edge of the week. */
  cutStart: boolean; cutEnd: boolean;
}
export interface DeliveryMark { id: string; title: string; col: number; state: "open" | "late" | "done" }
export interface DeliveryRow { project: DeliveryProject; bars: DeliveryBar[]; marks: DeliveryMark[]; lanes: number }
export interface DeliveryWeek {
  days: { iso: string; col: number }[];
  todayCol: number | null;
  rows: DeliveryRow[];
  /** Projects that have something this week but did not fit in the rows shown. */
  moreProjects: number;
}

/** Plan items on a plain date may have no end (a one-day item). Items with no date at all are not on the calendar. */
export function itemDates(i: { start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null; tz: string | null }): { start: string; end: string } | null {
  if (i.start_date) return { start: i.start_date, end: i.end_date ?? i.start_date };
  if (i.starts_at && i.ends_at && i.tz) {
    const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: i.tz as string }).format(new Date(iso));
    return { start: day(i.starts_at), end: day(i.ends_at) };
  }
  return null;
}

export function buildDeliveryWeek(a: { projects: readonly DeliveryProject[]; items: readonly DeliveryItem[]; milestones: readonly DeliveryMilestone[]; today: string; maxRows?: number }): DeliveryWeek {
  const week = weekWindow(a.today);
  const days = Array.from({ length: 7 }, (_, col) => ({ iso: addDaysIso(week.start, col), col }));
  const todayCol = a.today >= week.start && a.today <= week.end ? daysBetweenIso(week.start, a.today) : null;
  const colOf = (iso: string) => daysBetweenIso(week.start, iso);

  const rows: (DeliveryRow & { first: number })[] = [];
  for (const project of a.projects) {
    const bars: DeliveryBar[] = [];
    for (const i of a.items) {
      if (i.projectId !== project.id || i.end < week.start || i.start > week.end) continue;
      const startCol = Math.max(0, colOf(i.start));
      const endCol = Math.min(6, colOf(i.end));
      bars.push({ id: i.id, title: i.title, status: i.status, col: startCol, span: endCol - startCol + 1, lane: 0, cutStart: i.start < week.start, cutEnd: i.end > week.end });
    }
    bars.sort((x, y) => x.col - y.col || y.span - x.span || x.title.localeCompare(y.title));
    // Lanes: the first lane whose last bar ends before this one starts, so overlapping items sit on separate lines.
    const laneEnds: number[] = [];
    for (const b of bars) {
      let lane = laneEnds.findIndex((end) => end < b.col);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(-1); }
      laneEnds[lane] = b.col + b.span - 1;
      b.lane = lane;
    }
    const marks: DeliveryMark[] = a.milestones
      .filter((m) => m.projectId === project.id && m.due >= week.start && m.due <= week.end && m.status !== "cancelled" && m.status !== "deferred")
      .map((m) => ({ id: m.id, title: m.title, col: colOf(m.due), state: m.status === "accepted" ? ("done" as const) : m.due < a.today ? ("late" as const) : ("open" as const) }))
      .sort((x, y) => x.col - y.col || x.title.localeCompare(y.title));
    if (bars.length === 0 && marks.length === 0) continue;
    const first = Math.min(...bars.map((b) => b.col), ...marks.map((m) => m.col));
    rows.push({ project, bars, marks, lanes: Math.max(1, laneEnds.length), first });
  }
  rows.sort((x, y) => x.first - y.first || x.project.name.localeCompare(y.project.name));
  const max = a.maxRows ?? 5;
  return { days, todayCol, rows: rows.slice(0, max).map(({ first: _first, ...r }) => r), moreProjects: Math.max(0, rows.length - max) };
}
