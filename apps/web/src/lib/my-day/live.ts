/**
 * Live clock status for the "People today" card: who has an OPEN clock session right now, and in which work mode. This is not the recorded
 * daily attendance (attendance_records): a person can be clocked in with nothing recorded yet, and a day can be recorded without a clock.
 * Pure: the page reads the open sessions and open segments through the signed-in person's session (RLS decides which people they see)
 * and this only counts them, limited to the people the overview covers.
 */
export interface OpenSession { employee_id: string }
export interface OpenSegment { employee_id: string; work_mode: string }

export interface LiveSummary {
  clockedIn: number;
  /** Work mode of each person's current segment, most common first; a person clocked in with no open segment is counted under "Not stated". */
  byMode: { mode: string; count: number }[];
}

export function summariseLive(sessions: readonly OpenSession[], segments: readonly OpenSegment[], scope: ReadonlySet<string>): LiveSummary {
  const people = [...new Set(sessions.map((s) => s.employee_id).filter((id) => scope.has(id)))];
  const modeOf = new Map<string, string>();
  for (const s of segments) if (scope.has(s.employee_id) && !modeOf.has(s.employee_id)) modeOf.set(s.employee_id, s.work_mode);
  const counts = new Map<string, number>();
  for (const id of people) {
    const mode = modeOf.get(id) ?? "not_stated";
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return { clockedIn: people.length, byMode: [...counts].map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count || a.mode.localeCompare(b.mode)) };
}
