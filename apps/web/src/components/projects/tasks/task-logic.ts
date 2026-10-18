import { allowedTaskMoves, isFinishedProject, isOpenTask, taskActorRole, TASK_STATUS_LABELS, type ProjectStanding, type TaskActorRole, type TaskStatus } from "@enginious-hr/domain";
import { compareNullable, parseSort, type SortState } from "@/components/workspace/url-state";
import type { ProjProjectPersonRow, ProjTaskRow, ProjTeamRow } from "@/types/projects";

/**
 * Pure logic shared by the task table, the task board, My Work and the project Work section: what each person may change on
 * each task (derived from the same domain rules the database mirrors), how rows are sorted and grouped, which board column a
 * task sits in. Nothing here reads a database or a request, so it can be tested directly.
 */

export interface PickOption {
  id: string;
  name: string;
}

// ---- Moves ---------------------------------------------------------------------------------------------------------

export interface TaskMoveSpec {
  to: string;
  label: string;
  needsNote: boolean;
  /**
   * "direct": a plain change that can be saved the moment it is chosen (Start, Back to To do, Mark done on a routine task).
   * "dialog": needs a reason, a confirmation or a decision first (sending for review, accepting a reviewed task, requesting changes,
   * reopening, deferring, cancelling). Never saved inline.
   */
  mode: "direct" | "dialog";
}

/** Which moves may be saved straight from a table cell or a board drop, and which must open a small form. */
export function moveMode(task: { requiresReview: boolean }, move: { to: string; needsNote: boolean }): "direct" | "dialog" {
  if (move.needsNote) return "dialog";
  if (move.to === "ready_for_review" || move.to === "deferred" || move.to === "cancelled") return "dialog";
  if (move.to === "done" && task.requiresReview) return "dialog"; // accepting reviewed work is a decision, never a cell edit
  return "direct";
}

export function taskMoveSpecs(role: TaskActorRole, userId: string, task: { assigneeId: string; teamId: string | null; requiresReview: boolean; status: string; blocked: boolean }): TaskMoveSpec[] {
  return allowedTaskMoves(role, userId, task).map((m) => ({ to: m.to, label: m.label, needsNote: m.needsNote, mode: moveMode(task, m) }));
}

// ---- Rows ----------------------------------------------------------------------------------------------------------

export interface TaskRowData {
  id: string;
  projectId: string;
  projectReference: string;
  projectName: string;
  title: string;
  assigneeId: string;
  assigneeName: string;
  teamId: string | null;
  teamName: string | null;
  /** The milestone set on the task itself, if any. */
  milestoneId: string | null;
  /** The task's own milestone, else the one of its deliverable: the only link there is, never invented. */
  effectiveMilestoneId: string | null;
  milestoneTitle: string | null;
  deliverableTitle: string | null;
  status: string;
  priority: string;
  blocked: boolean;
  needsReview: boolean;
  startDate: string | null;
  dueDate: string | null;
  due: { text: string; overdue: boolean };
  version: number;
  open: boolean;
  /** Moves the viewer may make (empty when they have no right, the project is finished, or the task is closed to them). */
  moves: TaskMoveSpec[];
  /** Whether the viewer may change the due date (assignee, head or PM: the same rule as editing the task). */
  canChangeDue: boolean;
  /** Reassigning is for the PM / founder and the head of the task's team only: a task owner never gets it. */
  canReassign: boolean;
  reassignOptions: PickOption[];
}

export interface ProjectLookup {
  project: { id: string; reference: string; name: string; status: string };
  standing: ProjectStanding;
  teams: readonly Pick<ProjTeamRow, "id" | "name">[];
  deliverables: readonly { id: string; title: string; milestone_id: string | null }[];
  milestones: readonly { id: string; title: string }[];
  /** Only needed (and only loaded) for projects where the viewer can reassign. */
  people: readonly Pick<ProjProjectPersonRow, "user_id" | "full_name" | "team_id">[];
}

export interface RowContext {
  userId: string;
  today: string;
  nameOf: (id: string) => string;
  formatDate: (d: string) => string;
}

function dueWordsLocal(due: string | null, open: boolean, today: string, format: (d: string) => string): { text: string; overdue: boolean } {
  if (!due) return { text: "No due date", overdue: false };
  if (!open) return { text: format(due), overdue: false };
  if (due < today) {
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
    return { text: `${format(due)} · overdue by ${days} day${days === 1 ? "" : "s"}`, overdue: true };
  }
  if (due === today) return { text: `${format(due)} · due today`, overdue: false };
  return { text: format(due), overdue: false };
}

/** One task as a row, with exactly what this viewer may do to it. The database re-checks every one of these. */
export function buildTaskRow(t: ProjTaskRow, look: ProjectLookup, rc: RowContext): TaskRowData {
  const readOnly = isFinishedProject(look.project.status);
  const ref = { assigneeId: t.assignee_id, teamId: t.team_id, requiresReview: t.requires_review, status: t.status, blocked: !!t.blocked_at };
  const role = readOnly ? null : taskActorRole(look.standing, rc.userId, ref);
  const open = isOpenTask(t.status);
  const leader = role === "manager" || role === "head";
  const deliverable = t.deliverable_id ? (look.deliverables.find((d) => d.id === t.deliverable_id) ?? null) : null;
  const effectiveMilestoneId = t.milestone_id ?? deliverable?.milestone_id ?? null;
  const reassignOptions: PickOption[] = leader && open
    ? look.people
        .filter((p) => role === "manager" || p.team_id === t.team_id || p.user_id === rc.userId)
        .map((p) => ({ id: p.user_id, name: p.full_name ?? "Unnamed" }))
    : [];
  return {
    id: t.id,
    projectId: look.project.id,
    projectReference: look.project.reference,
    projectName: look.project.name,
    title: t.title,
    assigneeId: t.assignee_id,
    assigneeName: rc.nameOf(t.assignee_id),
    teamId: t.team_id,
    teamName: t.team_id ? (look.teams.find((x) => x.id === t.team_id)?.name ?? null) : null,
    milestoneId: t.milestone_id,
    effectiveMilestoneId,
    milestoneTitle: effectiveMilestoneId ? (look.milestones.find((m) => m.id === effectiveMilestoneId)?.title ?? null) : null,
    deliverableTitle: deliverable?.title ?? null,
    status: t.status,
    priority: t.priority,
    blocked: !!t.blocked_at,
    needsReview: t.requires_review,
    startDate: t.start_date,
    dueDate: t.due_date,
    due: dueWordsLocal(t.due_date, open, rc.today, rc.formatDate),
    version: t.version,
    open,
    moves: taskMoveSpecs(role, rc.userId, ref),
    canChangeDue: role !== null && open,
    canReassign: leader && open && reassignOptions.length > 1,
    reassignOptions,
  };
}

// ---- Sorting -------------------------------------------------------------------------------------------------------

export const TASK_SORT_KEYS = ["task", "project", "assignee", "due", "status", "priority"] as const;
export type TaskSortKey = (typeof TASK_SORT_KEYS)[number];
export const DEFAULT_TASK_SORT: SortState<TaskSortKey> = { key: "due", dir: "asc" };
export const parseTaskSort = (raw: string): SortState<TaskSortKey> => parseSort(raw, TASK_SORT_KEYS, DEFAULT_TASK_SORT);

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_RANK: Record<string, number> = { todo: 0, in_progress: 1, ready_for_review: 2, done: 3, deferred: 4, cancelled: 5 };

/** Sorts by the chosen column; ties fall back to due date then title so the order is always stable and predictable. */
export function sortTaskRows<T extends TaskRowData>(rows: readonly T[], sort: SortState<TaskSortKey>): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const primary = (a: T, b: T): number => {
    switch (sort.key) {
      case "task": return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) * sign;
      case "project": return `${a.projectReference} ${a.projectName}`.localeCompare(`${b.projectReference} ${b.projectName}`, undefined, { numeric: true }) * sign;
      case "assignee": return a.assigneeName.localeCompare(b.assigneeName, undefined, { sensitivity: "base" }) * sign;
      case "due": return compareNullable(a.dueDate, b.dueDate, sort.dir);
      case "status": return ((STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)) * sign;
      case "priority": return ((PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)) * sign;
    }
  };
  return [...rows].sort((a, b) => primary(a, b) || compareNullable(a.dueDate, b.dueDate, "asc") || a.title.localeCompare(b.title));
}

// ---- Optional columns ----------------------------------------------------------------------------------------------

export const TASK_COLUMNS = [
  { id: "priority", label: "Priority" },
  { id: "team", label: "Department" },
  { id: "milestone", label: "Milestone" },
  { id: "deliverable", label: "Deliverable" },
] as const;
export type TaskColumnId = (typeof TASK_COLUMNS)[number]["id"];
export const TASK_COLUMN_IDS = TASK_COLUMNS.map((c) => c.id) as readonly TaskColumnId[];
export const DEFAULT_TASK_COLUMNS: readonly TaskColumnId[] = [];

// ---- Board ---------------------------------------------------------------------------------------------------------

export const BOARD_STATUSES = ["todo", "in_progress", "ready_for_review", "done"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_COLUMNS: readonly { id: BoardStatus; label: string }[] = BOARD_STATUSES.map((s) => ({ id: s, label: TASK_STATUS_LABELS[s as TaskStatus] }));

/** The board column of a task: its status. Deferred and cancelled tasks are not on the board (they are in the table), and Blocked is a flag, never a column. */
export const boardColumnOf = (status: string): BoardStatus | null => ((BOARD_STATUSES as readonly string[]).includes(status) ? (status as BoardStatus) : null);

/** Columns a card may be moved to: only statuses the viewer's own moves lead to (the board never offers a move the table would refuse). */
export function boardTargets(row: Pick<TaskRowData, "moves">): BoardStatus[] {
  return [...new Set(row.moves.map((m) => boardColumnOf(m.to)).filter((c): c is BoardStatus => c !== null))];
}

/**
 * The move a drop or a "Move to" choice means: the single move to that status if there is one. When two moves lead to the same
 * status (for example "Request changes" and "Withdraw from review" both go back to In progress, only one of which is ever offered
 * to a given person) the one needing no reason is preferred.
 */
export function moveFor(row: Pick<TaskRowData, "moves">, to: string): TaskMoveSpec | null {
  const matches = row.moves.filter((m) => m.to === to);
  return matches.find((m) => !m.needsNote) ?? matches[0] ?? null;
}

// ---- Grouping ------------------------------------------------------------------------------------------------------

export const GROUP_BY = ["none", "team", "milestone", "status", "assignee"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export const GROUP_LABELS: Record<GroupBy, string> = { none: "No grouping", team: "Department", milestone: "Milestone", status: "Status", assignee: "Assignee" };
export const parseGroupBy = (raw: string): GroupBy => ((GROUP_BY as readonly string[]).includes(raw) ? (raw as GroupBy) : "none");

export interface TaskGroup<T> {
  key: string;
  label: string;
  rows: T[];
  /** True for the honest catch-all ("Unlinked", "No department", "Unassigned"): tasks that have no such link. */
  none?: boolean;
}

/**
 * Groups rows for the project Work section. A task belongs to a milestone through its own milestone or its deliverable's; if it has
 * neither it is shown under "Unlinked", never forced into a milestone. Group order: milestones in plan order, statuses in workflow
 * order, departments and people alphabetically; the catch-all group is always last.
 */
export function groupTaskRows<T extends TaskRowData>(rows: readonly T[], by: GroupBy, order: { milestones: readonly string[] } = { milestones: [] }): TaskGroup<T>[] {
  if (by === "none") return [{ key: "all", label: "All tasks", rows: [...rows] }];
  const buckets = new Map<string, TaskGroup<T>>();
  const put = (key: string, label: string, row: T, none = false) => {
    const g = buckets.get(key) ?? { key, label, rows: [], ...(none ? { none: true } : {}) };
    g.rows.push(row);
    buckets.set(key, g);
  };
  for (const r of rows) {
    if (by === "team") r.teamId ? put(r.teamId, r.teamName ?? "Department", r) : put("none", "No department", r, true);
    else if (by === "milestone") r.effectiveMilestoneId ? put(r.effectiveMilestoneId, r.milestoneTitle ?? "Milestone", r) : put("none", "Unlinked", r, true);
    else if (by === "status") put(r.status, TASK_STATUS_LABELS[r.status as TaskStatus] ?? r.status, r);
    else r.assigneeId ? put(r.assigneeId, r.assigneeName, r) : put("none", "Unassigned", r, true);
  }
  const groups = [...buckets.values()];
  const rank = (g: TaskGroup<T>): number => {
    if (g.none) return Number.MAX_SAFE_INTEGER;
    if (by === "milestone") { const i = order.milestones.indexOf(g.key); return i === -1 ? 10_000 : i; }
    if (by === "status") return STATUS_RANK[g.key] ?? 99;
    return 0;
  };
  return groups.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
