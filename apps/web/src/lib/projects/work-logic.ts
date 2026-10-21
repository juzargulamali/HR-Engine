import { addDays } from "@enginious-hr/domain";

/** Pure helpers for My Work and the Projects overview. Dates are plain YYYY-MM-DD strings, compared as strings, never through a time zone. */
export interface DatedTask {
  id: string;
  due_date: string | null;
}

export interface TaskGroups<T> {
  overdue: T[];
  soon: T[];
  later: T[];
  undated: T[];
}

/** Overdue (before today), due within the next 7 days (today included), later, and no date. Each group is ordered by date. */
export function groupTasksByDue<T extends DatedTask>(tasks: readonly T[], today: string): TaskGroups<T> {
  const horizon = addDays(today, 6);
  const byDate = (a: T, b: T) => (a.due_date ?? "").localeCompare(b.due_date ?? "");
  const sorted = [...tasks].sort(byDate);
  return {
    overdue: sorted.filter((t) => t.due_date !== null && t.due_date < today),
    soon: sorted.filter((t) => t.due_date !== null && t.due_date >= today && t.due_date <= horizon),
    later: sorted.filter((t) => t.due_date !== null && t.due_date > horizon),
    undated: sorted.filter((t) => t.due_date === null),
  };
}

export interface ReviewContext {
  userId: string;
  /** Founder of the project's company. */
  isFounder: boolean;
  /** The project's accountable PM. */
  isPm: boolean;
  /** Unexpired temporary leadership. */
  isActingPm: boolean;
  /** Teams of the project that this person heads. */
  headOfTeamIds: readonly string[];
}

/** A task waits on this person's review when it is ready for review, they did not do it, and they lead the project or the task's team (proj_set_task_status). */
export function isWaitingOnMyReview(task: { status: string; assignee_id: string; team_id: string | null }, ctx: ReviewContext): boolean {
  if (task.status !== "ready_for_review" || task.assignee_id === ctx.userId) return false;
  if (ctx.isFounder || ctx.isPm || ctx.isActingPm) return true;
  return task.team_id !== null && ctx.headOfTeamIds.includes(task.team_id);
}

export interface DirectoryFilters {
  q: string;
  company: string;
  kind: string;
  status: string;
  view: "live" | "finished";
}

export interface DirectoryItem {
  company_id: string;
  reference: string;
  name: string;
  kind: string;
  status: string;
  pm_name: string | null;
  end_date: string | null;
  start_date: string | null;
}

const FINISHED = ["completed", "archived"];

export function filterDirectory<T extends DirectoryItem>(rows: readonly T[], f: DirectoryFilters): T[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if ((f.view === "finished") !== FINISHED.includes(r.status)) return false;
    if (f.company && r.company_id !== f.company) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.status && r.status !== f.status) return false;
    if (q && !`${r.reference} ${r.name} ${r.pm_name ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** The handover rule used by the navigation: a submitted handover waits on people who can assign a PM; an assigned one waits on its PM. */
export function handoverWaitsOnMe(h: { status: string; pm_user_id: string | null; company_id: string }, userId: string, canAssign: (companyId: string) => boolean): boolean {
  return (h.status === "submitted" && canAssign(h.company_id)) || ((h.status === "pm_assigned") && h.pm_user_id === userId);
}

// ---- My Work: which tasks the table shows ---------------------------------------------------------------------------

export const MY_WORK_SHOWS = ["mine", "team", "overdue", "review"] as const;
export type MyWorkShow = (typeof MY_WORK_SHOWS)[number];
export const MY_WORK_LABELS: Record<MyWorkShow, string> = { mine: "My tasks", team: "My team", overdue: "Overdue", review: "Waiting for review" };

/** Only the four known choices; "My team" is also refused (back to My tasks) for someone who leads nothing, whatever the address says. */
export function parseMyWorkShow(raw: string, canSeeTeam: boolean): MyWorkShow {
  const v = (MY_WORK_SHOWS as readonly string[]).includes(raw) ? (raw as MyWorkShow) : "mine";
  return v === "team" && !canSeeTeam ? "mine" : v;
}

export interface MyWorkSets<T> {
  mine: readonly T[];
  team: readonly T[];
  reviews: readonly T[];
}

/** The rows for the chosen filter. Overdue is the person's own open tasks whose due date is before today (plain dates). */
export function selectMyWorkRows<T extends { dueDate: string | null; open: boolean }>(sets: MyWorkSets<T>, show: MyWorkShow, today: string): T[] {
  switch (show) {
    case "team": return [...sets.team];
    case "review": return [...sets.reviews];
    case "overdue": return sets.mine.filter((t) => t.open && t.dueDate !== null && t.dueDate < today);
    default: return [...sets.mine];
  }
}

/** Text search over task and project names, then an optional single project. */
export function narrowMyWork<T extends { title: string; projectName: string; projectReference: string; projectId: string }>(rows: readonly T[], q: string, projectId: string): T[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => (!projectId || r.projectId === projectId) && (!needle || `${r.title} ${r.projectName} ${r.projectReference}`.toLowerCase().includes(needle)));
}
