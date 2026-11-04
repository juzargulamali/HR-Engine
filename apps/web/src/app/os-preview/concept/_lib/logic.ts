import {
  OTHER_BOOKING, PEOPLE, TASK_STATUSES, TODAY, daysBetween, fmtDay, personFirst, projectById,
  type EquipmentLine, type Persona, type Project, type Stage, type Task, type TaskStatus, type TimelineItem,
} from "./sample";

/** Who may do what to a task. It mirrors the existing rules; the concept invents no new authority. */
export function canManageTask(p: Persona, t: Task): boolean {
  if (p.kind === "founder" || p.kind === "pm") return true;
  if (p.kind === "head") return PEOPLE.find((x) => x.id === p.personId)?.team === t.team;
  return false;
}
export const isOwnTask = (p: Persona, t: Task) => !!p.personId && t.assignee === p.personId;
export const canEditStatus = (p: Persona, t: Task) => p.kind !== "directory" && (canManageTask(p, t) || isOwnTask(p, t));
export const canAssign = (p: Persona, t: Task) => p.kind !== "directory" && canManageTask(p, t);
/** A person who did the work never accepts it themselves. */
export const canAcceptReview = (p: Persona, t: Task) => canManageTask(p, t) && t.status === "review" && t.submittedBy !== p.personId;
export const canAddTask = (p: Persona) => p.kind !== "directory";

export interface StatusChoice { value: TaskStatus; label: string; disabled?: boolean }
export function statusChoices(p: Persona, t: Task): StatusChoice[] {
  return TASK_STATUSES.map((s) => {
    // Done is only reachable from review for work that needs a review, and only by someone who may accept it.
    const needsAcceptance = t.needsReview && s.id === "done" && t.status !== "done";
    const mayAccept = t.status === "review" && canAcceptReview(p, t);
    const review = s.id === "review" && !t.needsReview;
    return { value: s.id, label: s.label, disabled: (needsAcceptance && !mayAccept) || review };
  });
}

/** Why a status change is refused, in words; null when it is allowed. */
export function statusRefusal(p: Persona, t: Task, to: TaskStatus): string | null {
  if (!canEditStatus(p, t)) return "You can only change the status of your own tasks. A manager can change any task.";
  if (to === "review" && !t.needsReview) return "This task does not need a review.";
  if (to === "done" && t.needsReview && t.status !== "done") {
    if (t.status !== "review") return "This task is reviewed before it is done: send it for review first.";
    if (!canAcceptReview(p, t)) return t.submittedBy === p.personId ? "You cannot accept your own work. A head or the Project Manager reviews it." : "Only a department head or the Project Manager accepts a review.";
  }
  if (t.blocked && (to === "doing" || to === "done")) return "This task is blocked. Resolve the blocker first, then move it.";
  return null;
}

export interface Attention { id: string; tone: "warn" | "info" | "bad"; text: string; tab: "work" | "timeline" | "equipment"; taskId?: string; milestoneId?: string }

export function overdueMilestones(items: readonly TimelineItem[]) {
  return items.filter((i) => i.kind !== "site" && !i.done && i.date < TODAY);
}
export function equipmentShort(lines: readonly EquipmentLine[]) {
  return lines.filter((l) => !l.draft && l.reserved < l.requested);
}

/** What needs attention in a project, computed from its own records so the list, the header and the tabs always agree. */
export function attentionOf(project: Project, tasks: readonly Task[], items: readonly TimelineItem[], lines: readonly EquipmentLine[]): Attention[] {
  if (tasks.length === 0 && items.length === 0 && lines.length === 0) {
    return (project.attention ?? []).map((text, i) => ({ id: `p${i}`, tone: /overdue/i.test(text) ? "bad" as const : /short|blocked/i.test(text) ? "warn" as const : "info" as const, text, tab: "work" as const }));
  }
  const out: Attention[] = [];
  const blocked = tasks.filter((t) => t.blocked && t.status !== "done");
  for (const t of blocked) out.push({ id: `b-${t.id}`, tone: "warn", text: "Blocked task", tab: "work", taskId: t.id });
  const review = tasks.filter((t) => t.status === "review");
  for (const t of review) out.push({ id: `r-${t.id}`, tone: "info", text: "Waiting for review", tab: "work", taskId: t.id });
  const unassigned = tasks.filter((t) => !t.assignee && t.status !== "done");
  for (const t of unassigned) out.push({ id: `u-${t.id}`, tone: "info", text: "Unassigned task", tab: "work", taskId: t.id });
  for (const m of overdueMilestones(items)) out.push({ id: `o-${m.id}`, tone: "bad", text: "Milestone overdue", tab: "timeline", milestoneId: m.id });
  for (const l of equipmentShort(lines)) out.push({ id: `e-${l.id}`, tone: "warn", text: "Equipment short", tab: "equipment" });
  return out;
}

/** The short phrase used in the list: counts, never paragraphs. */
export function attentionSummary(a: readonly Attention[]): string[] {
  const count = (pre: string) => a.filter((x) => x.id.startsWith(pre)).length;
  const bits: string[] = [];
  if (count("o-")) bits.push(count("o-") > 1 ? `${count("o-")} milestones overdue` : "Milestone overdue");
  if (count("b-")) bits.push(count("b-") > 1 ? `${count("b-")} tasks blocked` : "1 task blocked");
  if (count("r-")) bits.push(count("r-") > 1 ? `${count("r-")} to review` : "1 task to review");
  if (count("u-")) bits.push(count("u-") > 1 ? `${count("u-")} unassigned` : "1 unassigned");
  if (count("e-")) bits.push("Equipment short");
  if (bits.length === 0) return a.map((x) => x.text);
  return bits;
}

export interface NextAction { id: string; label: string; detail: string; tab: "work" | "timeline" | "equipment"; taskId?: string; milestoneId?: string }
/** The one thing to do next, in the order that matters: unblock, review, assign, then the equipment and the calendar. */
export function nextActions(p: Persona, tasks: readonly Task[], items: readonly TimelineItem[], lines: readonly EquipmentLine[]): NextAction[] {
  const out: NextAction[] = [];
  for (const t of tasks.filter((x) => x.blocked && x.status !== "done" && (canManageTask(p, x) || isOwnTask(p, x)))) {
    out.push({ id: `b-${t.id}`, label: "Resolve a blocker", detail: `${t.title}: ${t.blocked?.reason ?? ""}`, tab: "work", taskId: t.id });
  }
  for (const t of tasks.filter((x) => canAcceptReview(p, x))) {
    out.push({ id: `r-${t.id}`, label: "Review a submitted task", detail: `${t.title}, sent by ${personFirst(t.submittedBy ?? t.assignee)}`, tab: "work", taskId: t.id });
  }
  if (p.kind === "founder" || p.kind === "pm" || p.kind === "head") {
    for (const t of tasks.filter((x) => !x.assignee && x.status !== "done" && canManageTask(p, x))) {
      out.push({ id: `u-${t.id}`, label: "Assign unassigned work", detail: `${t.title}, due ${dueWords(t.due)}`, tab: "work", taskId: t.id });
    }
    for (const l of equipmentShort(lines)) {
      out.push({ id: `e-${l.id}`, label: "Review an equipment shortage", detail: `${l.item}: ${l.reserved} of ${l.requested} reserved`, tab: "equipment" });
    }
    for (const m of overdueMilestones(items)) {
      out.push({ id: `o-${m.id}`, label: "Look at an overdue milestone", detail: `${m.title} was due ${dueWords(m.date)}`, tab: "timeline", milestoneId: m.id });
    }
  }
  return out;
}

export function dueWords(due: string): string {
  const d = daysBetween(TODAY, due);
  const date = fmtDay(due);
  if (d === 0) return `today (${date})`;
  if (d === 1) return `tomorrow (${date})`;
  if (d === -1) return `yesterday (${date})`;
  return date;
}
export const isOverdue = (due: string, done: boolean) => !done && due < TODAY;

// ---------------------------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------------------------
export type Params = Pick<URLSearchParams, "get">;

export function visibleProjects(p: Persona, all: readonly Project[]): Project[] {
  return all.filter((x) => p.companies.includes(x.company));
}

export interface ProjectFilter { q: string; stage: string; pm: string; kind: string; company: string; show: string; attention: string }
export const readProjectFilter = (sp: Params): ProjectFilter => ({
  q: sp.get("q") ?? "", stage: sp.get("stage") ?? "", pm: sp.get("pm") ?? "", kind: sp.get("kind") ?? "", company: sp.get("company") ?? "", show: sp.get("show") ?? "", attention: sp.get("attn") ?? "",
});
export function filterProjects(list: readonly Project[], f: ProjectFilter, attention: (p: Project) => number): Project[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((p) => {
    // Without a choice the list shows ongoing work; "Completed" is an explicit choice.
    if (f.show === "completed" ? p.stage !== "completed" : f.show === "all" ? false : p.stage === "completed") return false;
    if (f.stage && p.stage !== f.stage) return false;
    if (f.pm && p.pm !== f.pm) return false;
    if (f.kind && p.kind !== f.kind) return false;
    if (f.company && p.company !== f.company) return false;
    if (f.attention === "1" && attention(p) === 0) return false;
    if (q && ![p.ref, p.name, p.client ?? "internal", p.pm].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
export const nextOrder = (p: Project) => p.nextMilestone?.due ?? "9999";
export const sortProjects = (list: readonly Project[]) => [...list].sort((a, b) => nextOrder(a).localeCompare(nextOrder(b)) || a.ref.localeCompare(b.ref));

export interface TaskFilter { q: string; who: string; status: string; team: string; show: string }
export const readTaskFilter = (sp: Params): TaskFilter => ({ q: sp.get("q") ?? "", who: sp.get("who") ?? "", status: sp.get("status") ?? "", team: sp.get("team") ?? "", show: sp.get("show") ?? "" });
export function filterTasks(list: readonly Task[], f: TaskFilter, me: Persona): Task[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((t) => {
    if (f.who === "none" ? !!t.assignee : f.who ? t.assignee !== f.who : false) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.team && t.team !== f.team) return false;
    if (f.show === "open" && t.status === "done") return false;
    if (f.show === "mine" && t.assignee !== me.personId) return false;
    // Needs attention: blocked, without an owner, or overdue. Work waiting for review has its own count ("Awaiting review").
    if (f.show === "attention" && !((t.blocked && t.status !== "done") || (!t.assignee && t.status !== "done") || isOverdue(t.due, t.status === "done"))) return false;
    if (q && ![t.title, personFirst(t.assignee), t.team].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
/** The week the concept's "today" falls in, Monday to Sunday. */
export const WEEK_START = "2026-10-26";
export const WEEK_END = "2026-11-01";
/** "This week": due Monday to Sunday of this week, plus anything still open that is overdue. Never hides a task from "All tasks". */
export const isThisWeek = (t: Task) => (t.due >= WEEK_START && t.due <= WEEK_END) || (t.status !== "done" && t.due < WEEK_START);

export const sortTasks = (list: readonly Task[]) => [...list].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.due.localeCompare(b.due) || a.title.localeCompare(b.title));

// ---------------------------------------------------------------------------------------------------------------
// Site bookings: only a PHYSICAL overlap is a conflict. Several office tasks in one day never is.
// ---------------------------------------------------------------------------------------------------------------
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export function overlapMinutes(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }, allowance = 60): number {
  // Travel and preparation before and after a booking are protected time as well.
  const a0 = minutes(a.startTime) - allowance, a1 = minutes(a.endTime) + allowance;
  const b0 = minutes(b.startTime) - allowance, b1 = minutes(b.endTime) + allowance;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}
export function siteClashFor(item: TimelineItem, persona: Persona): { who: string; minutes: number; other: string } | null {
  if (item.kind !== "site" || item.id !== "sb1" || !item.startTime || !item.endTime) return null;
  const m = overlapMinutes({ startTime: item.startTime, endTime: item.endTime }, OTHER_BOOKING);
  if (m === 0) return null;
  // Only a person who can see the other project may be told its name; everyone else is told it exists.
  const canSee = persona.kind === "founder" || (projectById("harbour")?.pm === persona.personId);
  return { who: "tomasz", minutes: m, other: canSee ? OTHER_BOOKING.project : "another booking you cannot see" };
}

/** Parallel office work for one person: several tasks due the same day is ordinary and is never a warning. */
export function parallelDays(tasks: readonly Task[]): { who: string; day: string; count: number }[] {
  const seen = new Map<string, number>();
  for (const t of tasks) if (t.assignee && t.status !== "done") seen.set(`${t.assignee}|${t.due}`, (seen.get(`${t.assignee}|${t.due}`) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k, count]) => ({ who: k.split("|")[0]!, day: k.split("|")[1]!, count }));
}

export const STAGE_ORDER: Stage[] = ["planning", "in_progress", "ready_for_installation", "on_site", "on_hold"];

/** Who is working on a project: the Project Manager, anyone with a task in it, a head of a team that has one, and the founder. */
export function isMember(p: Persona, project: Project, tasks: readonly Task[]): boolean {
  if (p.kind === "directory") return false;
  if (p.kind === "founder") return true;
  if (project.pm === p.personId) return true;
  if (tasks.some((t) => t.assignee === p.personId)) return true;
  if (p.kind === "head") {
    const team = PEOPLE.find((x) => x.id === p.personId)?.team;
    return tasks.some((t) => t.team === team);
  }
  return false;
}
