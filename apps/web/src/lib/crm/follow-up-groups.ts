import { followUpTiming } from "@enginious-hr/domain";

export interface GroupableFollowUp {
  followUp: { due_at: string; status: string };
}

export interface FollowUpGroups<T> {
  overdue: T[];
  today: T[];
  upcoming: T[];
}

/** Open follow-ups split into Overdue / Today / Upcoming (Dubai-day rules from the domain), each soonest first. Done and cancelled ones are ignored. */
export function groupOpenFollowUps<T extends GroupableFollowUp>(items: readonly T[], now: Date = new Date()): FollowUpGroups<T> {
  const out: FollowUpGroups<T> = { overdue: [], today: [], upcoming: [] };
  for (const i of items) {
    if (i.followUp.status !== "open") continue;
    const t = followUpTiming(i.followUp.due_at, now);
    (t === "overdue" ? out.overdue : t === "due_today" ? out.today : out.upcoming).push(i);
  }
  const byDue = (a: T, b: T) => a.followUp.due_at.localeCompare(b.followUp.due_at);
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.upcoming.sort(byDue);
  return out;
}
