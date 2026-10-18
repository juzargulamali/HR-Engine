import type { ProjectsAttention } from "./my-work";

export interface ProjectDayRow {
  key: string;
  label: string;
  count: number;
  href: string;
  /** Counts toward "Needs you today" (late or waiting on a decision), as opposed to "good to know". */
  needsYou: boolean;
}

/** The Projects rows of My Day, from real counts only. Zero rows are dropped; the order is the order shown. */
export function projectDayRows(a: ProjectsAttention): ProjectDayRow[] {
  const plural = (n: number, one: string, many: string) => `${n === 1 ? one : many}`;
  const rows: ProjectDayRow[] = [
    { key: "proj-handovers", count: a.handoversWaiting, needsYou: true, href: "/projects/handovers", label: plural(a.handoversWaiting, "Project handover waiting on you", "Project handovers waiting on you") },
    { key: "proj-reviews", count: a.reviewsWaiting, needsYou: true, href: "/projects/work#reviews", label: plural(a.reviewsWaiting, "Project task waiting for your review", "Project tasks waiting for your review") },
    { key: "proj-overdue", count: a.overdueTasks, needsYou: true, href: "/projects/work", label: plural(a.overdueTasks, "Project task overdue", "Project tasks overdue") },
    { key: "proj-soon", count: a.dueSoonTasks, needsYou: false, href: "/projects/work", label: plural(a.dueSoonTasks, "Project task due in the next 7 days", "Project tasks due in the next 7 days") },
    { key: "proj-unread", count: a.unreadMessages, needsYou: false, href: "/projects", label: plural(a.unreadMessages, "Unread project discussion message", "Unread project discussion messages") },
  ];
  return rows.filter((r) => r.count > 0);
}
