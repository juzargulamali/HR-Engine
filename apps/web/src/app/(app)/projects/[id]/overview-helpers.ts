/** Pure summaries for the project overview. Dates are plain YYYY-MM-DD strings compared as strings, never through a time zone. */
export interface TaskLite { id: string; title: string; status: string; due_date: string | null; blocked_at: string | null; blocked_reason: string | null; assignee_id: string; unblock_owner_id: string | null; unblock_action: string | null }
export interface MilestoneLite { id: string; title: string; status: string; due_date: string | null; is_required: boolean }
export interface DeliverableLite { id: string; title: string; status: string; due_date: string | null }
export interface FeedbackLite { status: string }
export interface BookingLite { state: string; ends_at: string }

const OPEN_TASK = ["todo", "in_progress", "ready_for_review"];
const OPEN_MILESTONE = ["planned", "in_progress", "ready_for_acceptance"];
const OPEN_DELIVERABLE = ["open", "in_progress", "ready_for_review"];

export function workCounts(a: { tasks: TaskLite[]; milestones: MilestoneLite[]; feedback: FeedbackLite[]; bookings: BookingLite[]; today: string; nowIso: string }) {
  const openTasks = a.tasks.filter((t) => OPEN_TASK.includes(t.status));
  return {
    openTasks: openTasks.length,
    blockedTasks: openTasks.filter((t) => t.blocked_at).length,
    overdueTasks: openTasks.filter((t) => t.due_date && t.due_date < a.today).length,
    unacceptedMilestones: a.milestones.filter((m) => OPEN_MILESTONE.includes(m.status)).length,
    openFeedback: a.feedback.filter((f) => f.status === "open" || f.status === "in_progress").length,
    upcomingBookings: a.bookings.filter((b) => (b.state === "tentative" || b.state === "confirmed") && b.ends_at > a.nowIso).length,
  };
}

export interface NextUpItem { kind: "Milestone" | "Deliverable"; id: string; title: string; due: string; overdue: boolean }

/** The next dated milestones and deliverables that are not finished, soonest first (overdue ones lead). */
export function nextUp(milestones: MilestoneLite[], deliverables: DeliverableLite[], today: string, limit = 5): NextUpItem[] {
  const items: NextUpItem[] = [];
  for (const m of milestones) if (m.due_date && OPEN_MILESTONE.includes(m.status)) items.push({ kind: "Milestone", id: m.id, title: m.title, due: m.due_date, overdue: m.due_date < today });
  for (const d of deliverables) if (d.due_date && OPEN_DELIVERABLE.includes(d.status)) items.push({ kind: "Deliverable", id: d.id, title: d.title, due: d.due_date, overdue: d.due_date < today });
  return items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.title.localeCompare(b.title))).slice(0, limit);
}

export function blockers(tasks: TaskLite[]): TaskLite[] {
  return tasks.filter((t) => t.blocked_at && OPEN_TASK.includes(t.status));
}

/** "2 cancelled, 1 deferred" from the resolutions recorded at completion. */
export function resolutionSummary(resolutions: { kind: string; action: string }[]): string {
  if (resolutions.length === 0) return "Nothing was left unfinished.";
  const count = (a: string) => resolutions.filter((r) => r.action === a).length;
  const parts = [["cancel", "cancelled"], ["defer", "deferred"], ["resolve", "resolved"], ["decline", "declined"]]
    .map(([a, w]) => [count(a!), w] as const)
    .filter(([n]) => n > 0)
    .map(([n, w]) => `${n} ${w}`);
  return `${resolutions.length} unfinished item${resolutions.length === 1 ? "" : "s"} decided at completion: ${parts.join(", ")}.`;
}

export function holdReviewState(reviewDate: string | null, today: string): "overdue" | "today" | "upcoming" | "none" {
  if (!reviewDate) return "none";
  return reviewDate < today ? "overdue" : reviewDate === today ? "today" : "upcoming";
}
