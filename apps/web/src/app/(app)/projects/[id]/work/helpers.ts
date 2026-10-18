import { canCreateTaskFor, daysBetween, isOpenTask, taskActorRole, TASK_STATUSES, type ProjectStanding, type TaskStatus } from "@enginious-hr/domain";
import type { ProjDeliverableRow, ProjProjectPersonRow, ProjTaskEventRow, ProjTaskRow, ProjTeamRow } from "@/types/projects";

/** Pure helpers for the milestones and tasks pages: filtering, ordering, overdue words, review queue and form options. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export interface TaskFilters {
  assignee: string | null;
  /** "open" (to do, in progress, ready for review: the default), "all", or one exact status. */
  status: "open" | "all" | TaskStatus;
  team: string | null;
  deliverable: string | null;
  mine: boolean;
  overdue: boolean;
  blocked: boolean;
}

export const DEFAULT_TASK_FILTERS: TaskFilters = { assignee: null, status: "open", team: null, deliverable: null, mine: false, overdue: false, blocked: false };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | string[] | undefined) => {
  const s = one(v);
  return s && UUID.test(s) ? s : null;
};
const flag = (v: string | string[] | undefined) => one(v) === "1";

/** Reads the filters from the query string. Anything unrecognised falls back to the default: a hand-edited URL never breaks the page. */
export function parseTaskFilters(sp: Params): TaskFilters {
  const raw = one(sp.status);
  const status: TaskFilters["status"] = raw === "all" ? "all" : raw && (TASK_STATUSES as readonly string[]).includes(raw) ? (raw as TaskStatus) : "open";
  return { assignee: id(sp.assignee), status, team: id(sp.team), deliverable: id(sp.deliverable), mine: flag(sp.mine), overdue: flag(sp.overdue), blocked: flag(sp.blocked) };
}

/** True when the filters differ from the default view (to show a "Clear filters" link). */
export const hasActiveFilters = (f: TaskFilters) =>
  f.assignee !== null || f.status !== "open" || f.team !== null || f.deliverable !== null || f.mine || f.overdue || f.blocked;

/** Plain-date overdue test: an open task whose due date is before today. No time zone, no Date objects. */
export const isTaskOverdue = (t: Pick<ProjTaskRow, "status" | "due_date">, today: string) => isOpenTask(t.status) && !!t.due_date && t.due_date < today;

export function filterTasks(tasks: readonly ProjTaskRow[], f: TaskFilters, userId: string, today: string): ProjTaskRow[] {
  return tasks.filter((t) => {
    if (f.status === "open" ? !isOpenTask(t.status) : f.status !== "all" && t.status !== f.status) return false;
    if (f.assignee && t.assignee_id !== f.assignee) return false;
    if (f.mine && t.assignee_id !== userId) return false;
    if (f.team && t.team_id !== f.team) return false;
    if (f.deliverable && t.deliverable_id !== f.deliverable) return false;
    if (f.blocked && !t.blocked_at) return false;
    if (f.overdue && !isTaskOverdue(t, today)) return false;
    return true;
  });
}

/** Due date first (undated last), then priority, then title: the order people plan their day in. */
export function sortTasks(tasks: readonly ProjTaskRow[]): ProjTaskRow[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : a.due_date < b.due_date ? -1 : 1;
    const p = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    return p !== 0 ? p : a.title.localeCompare(b.title);
  });
}

/** A due date in words, with its state: never colour alone. */
export function dueWords(due: string | null, open: boolean, today: string, format: (d: string) => string): { text: string; overdue: boolean } {
  if (!due) return { text: "No due date", overdue: false };
  if (!open) return { text: format(due), overdue: false };
  const late = daysBetween(due, today);
  if (late > 0) return { text: `${format(due)} · overdue by ${late} day${late === 1 ? "" : "s"}`, overdue: true };
  if (late === 0) return { text: `${format(due)} · due today`, overdue: false };
  return { text: format(due), overdue: false };
}

export interface TaskRowFields {
  id: string;
  title: string;
  assignee: string;
  team: string | null;
  deliverable: string | null;
  due: { text: string; overdue: boolean };
  status: string;
  priority: string;
  blocked: boolean;
  needsReview: boolean;
}

/** One mapping for both the desktop table and the phone cards, so they can never disagree. */
export function taskRowFields(
  t: ProjTaskRow,
  lookup: { nameOf: (id: string) => string; teams: readonly ProjTeamRow[]; deliverables: readonly Pick<ProjDeliverableRow, "id" | "title">[]; today: string; format: (d: string) => string },
): TaskRowFields {
  return {
    id: t.id,
    title: t.title,
    assignee: lookup.nameOf(t.assignee_id),
    team: t.team_id ? (lookup.teams.find((x) => x.id === t.team_id)?.name ?? null) : null,
    deliverable: t.deliverable_id ? (lookup.deliverables.find((x) => x.id === t.deliverable_id)?.title ?? null) : null,
    due: dueWords(t.due_date, isOpenTask(t.status), lookup.today, lookup.format),
    status: t.status,
    priority: t.priority,
    blocked: !!t.blocked_at,
    needsReview: t.requires_review,
  };
}

/** Tasks waiting for a review this person may give: PM / founder, or the head of the task's team, and never the assignee. */
export function reviewQueue(tasks: readonly ProjTaskRow[], standing: ProjectStanding, userId: string): ProjTaskRow[] {
  return sortTasks(
    tasks.filter((t) => {
      if (t.status !== "ready_for_review" || t.assignee_id === userId) return false;
      const role = taskActorRole(standing, userId, { assigneeId: t.assignee_id, teamId: t.team_id, requiresReview: t.requires_review, status: t.status, blocked: !!t.blocked_at });
      return role === "manager" || role === "head";
    }),
  );
}

export interface PickOption {
  id: string;
  name: string;
}

export interface NewTaskOptions {
  /** Team choices ("" = no team is always offered by the form). */
  teams: PickOption[];
  /** Who this person may assign to, keyed by the chosen team ("" for no team). */
  assigneesByTeam: Record<string, PickOption[]>;
  /** Deliverables the task may be filed under, keyed by team ("" for no team) so the form never offers one the database would refuse. */
  deliverablesByTeam: Record<string, PickOption[]>;
  canRequireReview: boolean;
}

/**
 * What the new-task form may offer this person, derived from canCreateTaskFor (which mirrors proj_create_task): the PM / founder can
 * assign anyone anywhere; a department head distributes to their own team (or themself); any other member creates for themself, in their
 * own team or none. The database re-checks everything.
 */
export function newTaskOptions(input: {
  standing: ProjectStanding;
  userId: string;
  myTeamId: string | null;
  people: readonly ProjProjectPersonRow[];
  teams: readonly ProjTeamRow[];
  deliverables: readonly Pick<ProjDeliverableRow, "id" | "title" | "team_id" | "status">[];
  manager: boolean;
}): NewTaskOptions {
  const { standing, userId, myTeamId, people, teams, deliverables, manager } = input;
  const name = (p: ProjProjectPersonRow) => p.full_name ?? "Unnamed";
  const teamChoices = manager
    ? teams
    : teams.filter((t) => standing.headOfTeamIds.includes(t.id) || t.id === myTeamId);
  const allowedTeamIds = ["", ...teamChoices.map((t) => t.id)];
  const assigneesByTeam: Record<string, PickOption[]> = {};
  for (const key of allowedTeamIds) {
    const teamId = key || null;
    assigneesByTeam[key] = people
      .filter((p) => canCreateTaskFor(standing, userId, p.user_id, teamId, myTeamId))
      // A head distributes to people in the team (or themself), not to anyone on the project.
      .filter((p) => manager || !teamId || !standing.headOfTeamIds.includes(teamId) || p.team_id === teamId || p.user_id === userId)
      // Outside a headed team a non-manager only ever assigns to themself.
      .filter((p) => manager || (teamId && standing.headOfTeamIds.includes(teamId)) || p.user_id === userId)
      .map((p) => ({ id: p.user_id, name: name(p) }));
  }
  const live = deliverables.filter((d) => d.status !== "accepted" && d.status !== "cancelled");
  const deliverablesByTeam: Record<string, PickOption[]> = {};
  for (const key of allowedTeamIds) {
    deliverablesByTeam[key] = live.filter((d) => manager || !d.team_id || d.team_id === key || (key === "" && !d.team_id) || d.team_id === myTeamId || standing.headOfTeamIds.includes(d.team_id ?? "")).map((d) => ({ id: d.id, name: d.title }));
    // A deliverable's team becomes the task's team: with no team chosen, only a manager may pick a team-owned one.
    if (key === "" && !manager) deliverablesByTeam[key] = live.filter((d) => !d.team_id).map((d) => ({ id: d.id, name: d.title }));
    if (key !== "" && !manager) deliverablesByTeam[key] = live.filter((d) => !d.team_id || d.team_id === key).map((d) => ({ id: d.id, name: d.title }));
  }
  return {
    teams: teamChoices.map((t) => ({ id: t.id, name: t.name })),
    assigneesByTeam,
    deliverablesByTeam,
    canRequireReview: manager || standing.headOfTeamIds.length > 0,
  };
}

export interface StatusOption {
  to: string;
  label: string;
  needsNote: boolean;
}

/** Milestone moves offered (mirrors proj_set_milestone_status): accepted / cancelled can only be reopened, with a reason. */
export function milestoneMoves(status: string): StatusOption[] {
  if (status === "accepted" || status === "cancelled") return [{ to: "in_progress", label: "Reopen as In progress", needsNote: true }];
  const all: StatusOption[] = [
    { to: "planned", label: "Planned", needsNote: false },
    { to: "in_progress", label: "In progress", needsNote: false },
    { to: "ready_for_acceptance", label: "Ready for acceptance", needsNote: false },
    { to: "accepted", label: "Accepted", needsNote: false },
    { to: "deferred", label: "Deferred", needsNote: true },
    { to: "cancelled", label: "Cancelled", needsNote: true },
  ];
  return all.filter((m) => m.to !== status);
}

/** Deliverable moves offered (mirrors proj_set_deliverable_status). */
export function deliverableMoves(status: string): StatusOption[] {
  if (status === "accepted" || status === "cancelled") return [{ to: "in_progress", label: "Reopen as In progress", needsNote: true }];
  const all: StatusOption[] = [
    { to: "open", label: "Open", needsNote: false },
    { to: "in_progress", label: "In progress", needsNote: false },
    { to: "ready_for_review", label: "Ready for review", needsNote: false },
    { to: "accepted", label: "Accepted", needsNote: false },
    { to: "deferred", label: "Deferred", needsNote: true },
    { to: "cancelled", label: "Cancelled", needsNote: true },
  ];
  return all.filter((m) => m.to !== status);
}

/** Deliverables grouped by milestone in milestone order; unlinked ones last. */
export function groupDeliverables<M extends { id: string }>(milestones: readonly M[], deliverables: readonly ProjDeliverableRow[]): { milestone: M | null; deliverables: ProjDeliverableRow[] }[] {
  const groups = milestones.map((m) => ({ milestone: m as M | null, deliverables: deliverables.filter((d) => d.milestone_id === m.id) })).filter((g) => g.deliverables.length > 0);
  const known = new Set(milestones.map((m) => m.id));
  const loose = deliverables.filter((d) => !d.milestone_id || !known.has(d.milestone_id));
  if (loose.length > 0) groups.push({ milestone: null, deliverables: loose });
  return groups;
}

/** Open / total task counts per deliverable, from the real task list (cancelled and deferred tasks are not counted as open). */
export function taskCountsByDeliverable(tasks: readonly ProjTaskRow[]): Map<string, { open: number; total: number }> {
  const map = new Map<string, { open: number; total: number }>();
  for (const t of tasks) {
    if (!t.deliverable_id) continue;
    const c = map.get(t.deliverable_id) ?? { open: 0, total: 0 };
    c.total += 1;
    if (isOpenTask(t.status)) c.open += 1;
    map.set(t.deliverable_id, c);
  }
  return map;
}

const STATUS_WORDS: Record<string, string> = { todo: "To do", in_progress: "In progress", ready_for_review: "Ready for review", done: "Done", cancelled: "Cancelled", deferred: "Deferred" };

/** One history line for the task timeline. `date` formats a plain YYYY-MM-DD; `nameOf` resolves an actor. */
export function describeTaskEvent(e: Pick<ProjTaskEventRow, "kind" | "from_value" | "to_value" | "note">, date: (d: string | null) => string): string {
  const note = e.note ? ` Reason: ${e.note}` : "";
  switch (e.kind) {
    case "created": return `Created and assigned to ${e.to_value ?? "someone"}.`;
    case "reassigned": return `Reassigned from ${e.from_value ?? "nobody"} to ${e.to_value ?? "nobody"}.${note}`;
    case "due_date_changed": return `Due date changed from ${date(e.from_value)} to ${date(e.to_value)}.${note}`;
    case "start_date_changed": return `Start date changed from ${date(e.from_value)} to ${date(e.to_value)}.${note}`;
    case "status_changed": return `Status changed from ${STATUS_WORDS[e.from_value ?? ""] ?? e.from_value ?? "unset"} to ${STATUS_WORDS[e.to_value ?? ""] ?? e.to_value}.${note}`;
    case "blocked": return `Blocked: ${e.to_value ?? ""}.${e.note ? ` To unblock: ${e.note}` : ""}`;
    case "unblocked": return `Blocker cleared (was: ${e.from_value ?? "unknown"}).${note}`;
    case "review_rule_changed": return `Review ${e.to_value === "true" ? "is now required" : "is no longer required"}.`;
    default: return `${e.kind.replace(/_/g, " ")}.${note}`;
  }
}
