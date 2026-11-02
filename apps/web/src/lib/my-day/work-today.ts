import { addDays } from "@enginious-hr/domain";

/** The few task fields My Day needs (a subset of a project task row joined with its project). */
export interface WorkTodayTask {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  unblock_owner_id: string | null;
  unblock_action: string | null;
  projectReference: string;
  projectName: string;
}

export type WorkGroup = "overdue" | "today" | "blocked" | "later";

export interface WorkTodayRow {
  id: string;
  title: string;
  project: string;
  group: WorkGroup;
  /** "Overdue since 28 Oct", "Due today", "Due 6 Nov", or "No due date". */
  dueText: string;
  overdue: boolean;
  /** What blocks it and who can unblock it, when the task is blocked. */
  blocked: { reason: string; unblockBy: string | null } | null;
  href: string;
}

export interface WorkToday {
  rows: WorkTodayRow[];
  /** Open tasks of mine that are mine to do now (a task sent for review waits on someone else and is not counted). */
  total: number;
  overdue: number;
  dueToday: number;
  blocked: number;
}

const GROUP_ORDER: WorkGroup[] = ["overdue", "today", "blocked", "later"];
export const WORK_TODAY_LIMIT = 8;

/**
 * "My work today" from the person's open tasks (assigned to them or shared with them as a collaborator): what is overdue, what is due today, what is
 * blocked, and what comes next. Each task appears once, in the first group that fits. A task already sent for review is waiting on someone else, so it is
 * left out here (it is listed under "Waiting on others"). Dates are plain YYYY-MM-DD strings compared as strings; `formatDate` formats them without a time zone.
 */
export function buildWorkToday(tasks: readonly WorkTodayTask[], today: string, nameOf: (id: string) => string, formatDate: (d: string) => string, limit = WORK_TODAY_LIMIT): WorkToday {
  const horizon = addDays(today, 6);
  const mine = tasks.filter((t) => t.status !== "ready_for_review");
  const rows: (WorkTodayRow & { sort: string })[] = mine.map((t) => {
    const overdue = t.due_date !== null && t.due_date < today;
    const isToday = t.due_date === today;
    const blocked = t.blocked_at ? t : null;
    const group: WorkGroup = overdue ? "overdue" : isToday ? "today" : blocked ? "blocked" : "later";
    const owner = t.unblock_owner_id ? nameOf(t.unblock_owner_id) : null;
    const dueText = overdue ? `Overdue since ${formatDate(t.due_date!)}` : isToday ? "Due today" : t.due_date ? `Due ${formatDate(t.due_date)}` : "No due date";
    return {
      id: t.id,
      title: t.title,
      project: `${t.projectReference} · ${t.projectName}`,
      group,
      dueText,
      overdue,
      blocked: blocked ? { reason: (blocked.blocked_reason ?? "").trim() || "No reason given", unblockBy: owner && owner !== "Unknown" ? owner : null } : null,
      href: `/projects/work?task=${t.id}`,
      // Oldest first inside a group; tasks with no date last. Later tasks past the next 7 days sort after the ones due this week.
      sort: t.due_date === null ? "9999-99-99" : t.due_date > horizon ? `5-${t.due_date}` : t.due_date,
    };
  });
  rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.sort.localeCompare(b.sort) || a.title.localeCompare(b.title));
  return {
    rows: rows.slice(0, limit).map(({ sort: _sort, ...r }) => r),
    total: mine.length,
    overdue: rows.filter((r) => r.group === "overdue").length,
    dueToday: rows.filter((r) => r.group === "today").length,
    blocked: rows.filter((r) => r.blocked !== null).length,
  };
}

/** How many of the person's own open tasks were sent for review and now wait on someone else. */
export function tasksInReview(tasks: readonly Pick<WorkTodayTask, "status">[]): number {
  return tasks.filter((t) => t.status === "ready_for_review").length;
}
