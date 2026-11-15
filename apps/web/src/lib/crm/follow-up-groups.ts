import { followUpTiming } from "@enginious-hr/domain";
import { DUBAI_ZONE, type ZoneOf } from "./time-zone";

export interface GroupableFollowUp {
  followUp: { due_at: string; status: string; company_id?: string | null };
}

export interface FollowUpGroups<T> {
  overdue: T[];
  today: T[];
  upcoming: T[];
}

/**
 * Open follow-ups split into Overdue / Today / Upcoming, each soonest first. Done and cancelled ones are ignored. Each follow-up is judged on the calendar day of
 * ITS OWN company (`zoneOf` maps a company to its Sales time zone; Dubai when none is given), so a list that mixes companies puts each row in its own "today".
 */
export function groupOpenFollowUps<T extends GroupableFollowUp>(items: readonly T[], now: Date = new Date(), zoneOf: ZoneOf = DUBAI_ZONE): FollowUpGroups<T> {
  const out: FollowUpGroups<T> = { overdue: [], today: [], upcoming: [] };
  for (const i of items) {
    if (i.followUp.status !== "open") continue;
    const t = followUpTiming(i.followUp.due_at, now, zoneOf(i.followUp.company_id));
    (t === "overdue" ? out.overdue : t === "due_today" ? out.today : out.upcoming).push(i);
  }
  const byDue = (a: T, b: T) => a.followUp.due_at.localeCompare(b.followUp.due_at);
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.upcoming.sort(byDue);
  return out;
}
