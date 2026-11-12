/**
 * Operations: what the two database reads return (ops_overview, ops_upcoming_work) and what the screens derive from them. Pure: no database, no React.
 *
 * Everything shown is derived from recorded facts. There is no score, no capacity figure and no second progress tracker: an item is on "Needs my decision" because a
 * record says so (a handover has no Project Manager, a task is blocked, a date changed while equipment is booked), and each item names its owner, its date and the
 * screen where the authorised person acts. What is not recorded is said to be not recorded.
 */
export const NOT_RECORDED = "Not recorded";

export interface EditionSnapshot { edition_id?: string; event_name: string | null; label: string | null; venue: string | null; city: string | null; start_date: string | null; end_date: string | null }
export interface UpcomingPlanning {
  provisional_pm_id: string | null; provisional_pm: string | null; risk: "unknown" | "low" | "medium" | "high"; risk_note: string | null; capacity_conflict: boolean; capacity_note: string | null;
  question: string | null; question_at: string | null; question_by: string | null; answer: string | null; answered_at: string | null;
}
export interface UpcomingRow {
  id: string; company_id: string; reference: string; title: string; stage: string; owner_id: string; owner: string; flagged_at: string; decision_date: string | null;
  dates_tentative: boolean; won: boolean; location: string | null; install_start: string | null; event_start: string | null; event_end: string | null; dismantle_date: string | null;
  edition: EditionSnapshot | null; teams: string[]; equipment: { name: string | null; qty: number | string | null }[]; to_confirm: string | null; note: string | null;
  planning: UpcomingPlanning | null; handover: null | { id: string; status: string; submitted_at: string | null; pm: string | null; project_id: string | null };
}
export interface RequestState {
  id: string; code: string; status: string; state: "draft" | "cancelled" | "reserved" | "partially_ready" | "short" | "partially_dispatched" | "dispatched" | "still_out" | "returned";
  lines: number; reserved_lines: number; partial_lines: number; short_lines: number; short_buy: number; short_rent: number; short_no_plan: number; dispatched_lines: number; returned_lines: number;
  units_asked: number; units_short: number; units_dispatched: number; units_returned: number; units_out: number; needed_from: string | null; needed_until: string | null;
  expected_return_at: string | null; return_overdue: boolean;
}
export interface OverviewHandover {
  id: string; sales_reference: string; title: string; status: "submitted" | "pm_assigned" | "clarification_requested"; submitted_at: string | null; pm_id: string | null; pm: string | null;
  pm_assigned_at: string | null; install_start: string | null; event_start: string | null; event_end: string | null; venue: string | null; edition: string | null; clarification_requested_at: string | null;
}
export interface OverviewBlocker { task_id: string; title: string; since: string; reason: string | null; assignee: string; unblock_owner: string | null; cross_team: boolean }
export interface OverviewProject {
  id: string; reference: string; name: string; kind: string; status: string; pm_id: string | null; pm: string; chat_group_id: string | null; venue: string | null; install_start: string | null; event_start: string | null;
  event_end: string | null; edition: string | null; tasks_open: number; tasks_overdue: number; reviews_waiting: number; reviews_overdue: number; blockers: OverviewBlocker[];
  next_milestone: null | { id: string; title: string; due_date: string | null; status: string }; milestones_overdue: number; corrections_open: number; plan_changes_open: number;
  plan_unreleased: number; equipment: RequestState[]; equipment_reviews: number; release_failed: boolean;
}
export interface OverviewOverlap { user_id: string; person: string; a: string; a_id: string; b: string; b_id: string; from: string; to: string }
export interface Overview { company_id: string; taken_at: string; handovers: OverviewHandover[]; projects: OverviewProject[]; overlaps: OverviewOverlap[] }

export const STAGE_WORDS: Record<string, string> = {
  new: "New", qualified: "Qualified", proposal_prep: "Preparing proposal", proposal_sent: "Proposal sent", estimate_sent: "Estimate sent", quote_sent: "Quote sent", negotiation: "Negotiation",
  on_hold: "On hold", won: "Won", lost: "Lost",
};
export const TEAM_WORDS: Record<string, string> = { engineering: "Engineering", content: "Content", programming: "Programming", installation: "Installation", warehouse: "Warehouse" };
export const RISK_WORDS: Record<UpcomingPlanning["risk"], string> = { unknown: "Not assessed", low: "Low", medium: "Medium", high: "High" };
export const HANDOVER_WORDS: Record<string, string> = { draft: "Being prepared by Sales", submitted: "Waiting for a Project Manager", pm_assigned: "Waiting for the Project Manager to accept", clarification_requested: "Question sent back to Sales", accepted: "Accepted" };
export const STATE_WORDS: Record<RequestState["state"], string> = {
  draft: "Not sent to the warehouse yet", cancelled: "Cancelled", reserved: "Reserved", partially_ready: "Partly ready", short: "Short", partially_dispatched: "Partly dispatched",
  dispatched: "Dispatched", still_out: "Still out", returned: "Returned",
};

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${day(to)}T00:00:00Z`) - Date.parse(`${day(from)}T00:00:00Z`)) / 86_400_000);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Tentative" until Sales wins the enquiry; the database already clears the flag for a won enquiry, and this says so in words. */
export function datesWord(r: Pick<UpcomingRow, "dates_tentative" | "won">): { text: string; tentative: boolean } {
  if (r.won) return { text: "Confirmed: this enquiry is won", tentative: false };
  return r.dates_tentative ? { text: "Tentative", tentative: true } : { text: "Dates confirmed by Sales; the enquiry is not won yet", tentative: false };
}

/** Who has the next step on a flagged enquiry, from its recorded state. `who` is "Sales", "Operations" or "Project Manager"; `person` is a name when one is recorded. */
export function nextResponsible(r: UpcomingRow): { who: "Sales" | "Operations" | "Project Manager"; person: string | null; what: string } {
  const h = r.handover;
  if (h?.status === "clarification_requested") return { who: "Sales", person: r.owner, what: "Answer the Project Manager's question on the handover" };
  if (h?.status === "pm_assigned") return { who: "Project Manager", person: h.pm, what: "Accept the handover" };
  if (h?.status === "submitted") return { who: "Operations", person: null, what: "Assign a Project Manager" };
  if (r.won) return { who: "Sales", person: r.owner, what: h ? "Submit the handover" : "Prepare the handover" };
  if (r.planning?.question && !r.planning.answer) return { who: "Sales", person: r.owner, what: "Answer the question from Operations" };
  if (r.to_confirm?.trim()) return { who: "Sales", person: r.owner, what: "Confirm the open details" };
  if (!r.planning?.provisional_pm) return { who: "Operations", person: null, what: "Name a provisional Project Manager" };
  return { who: "Sales", person: r.owner, what: r.decision_date ? `Decision expected ${day(r.decision_date)}` : "Waiting for the client's decision (no date recorded)" };
}

/** One line on equipment for a request, from the Inventory records. A buy or rent shortage is short, never reserved. */
export function equipmentLine(q: RequestState): string {
  const short = q.short_lines > 0
    ? ` ${plural(q.short_lines, "line")} short (${[q.short_buy > 0 ? `${q.short_buy} to buy` : null, q.short_rent > 0 ? `${q.short_rent} to rent` : null, q.short_no_plan > 0 ? `${q.short_no_plan} with no plan yet` : null].filter(Boolean).join(", ")}).`
    : "";
  const out = n(q.units_out) > 0 ? ` ${plural(n(q.units_out), "unit")} out${q.expected_return_at ? `, due back ${day(q.expected_return_at)}` : ", no return date recorded"}${q.return_overdue ? " (overdue)" : ""}.` : "";
  return `${q.code}: ${STATE_WORDS[q.state] ?? q.state}. ${q.reserved_lines} of ${plural(q.lines, "line")} reserved.${short}${out}`.trim();
}
export const unitsOut = (p: Pick<OverviewProject, "equipment">) => p.equipment.reduce((a, q) => a + n(q.units_out), 0);
export const isFinished = (status: string) => status === "completed" || status === "archived";
/** A finished project whose equipment is still out: two separate facts, both shown. */
export const completeButOut = (p: Pick<OverviewProject, "status" | "equipment">) => isFinished(p.status) && unitsOut(p) > 0;

export type DecisionKind = "pm_unassigned" | "handover_stalled" | "blocker" | "at_risk_installation" | "equipment_review" | "release_failed";
export interface DecisionItem { kind: DecisionKind; key: string; title: string; detail: string; owner: string; date: string | null; href: string; action: string }
export const DECISION_WORDS: Record<DecisionKind, string> = {
  pm_unassigned: "Project Manager not assigned", handover_stalled: "Handover stalled", blocker: "Blocker not resolved", at_risk_installation: "Installation at risk",
  equipment_review: "Review equipment booking", release_failed: "Unused reservations not released",
};
/** A handover that has waited this many days for its next step is "stalled". A blocker this old, or one that waits on someone other than the assignee, is listed. */
export const STALLED_DAYS = 3;
export const BLOCKER_DAYS = 2;
export const AT_RISK_WINDOW_DAYS = 14;

/** Why an installation is at risk, from records only. Empty = nothing recorded that puts it at risk. */
export function riskReasons(p: OverviewProject, today: string): string[] {
  const start = day(p.install_start) ?? day(p.event_start);
  if (!start || isFinished(p.status)) return [];
  const days = daysBetween(today, start);
  if (days < 0 || days > AT_RISK_WINDOW_DAYS) return [];
  const out: string[] = [];
  const short = p.equipment.filter((q) => q.short_lines > 0);
  if (short.length > 0) out.push(`equipment short on ${short.map((q) => q.code).join(", ")}`);
  if (p.equipment.some((q) => q.state === "draft")) out.push("an equipment request has not been sent to the warehouse");
  if (p.blockers.length > 0) out.push(plural(p.blockers.length, "blocked task"));
  if (p.tasks_overdue > 0) out.push(plural(p.tasks_overdue, "overdue task"));
  if (p.milestones_overdue > 0) out.push(plural(p.milestones_overdue, "overdue milestone"));
  if (p.plan_unreleased > 0) out.push(`${plural(p.plan_unreleased, "delivery plan line")} not released to the teams`);
  return out;
}

/** "Needs my decision": each item is a recorded fact with its owner, its date and the screen where the authorised person acts. */
export function decisions(o: Overview, today: string): DecisionItem[] {
  const out: DecisionItem[] = [];
  for (const h of o.handovers) {
    const href = `/projects/handovers?handover=${h.id}`;
    if (h.status === "submitted") {
      out.push({ kind: "pm_unassigned", key: `pm:${h.id}`, title: `${h.sales_reference} ${h.title}`, detail: `Handover submitted${h.submitted_at ? ` ${day(h.submitted_at)}` : ""}. No Project Manager is assigned.`, owner: "Operations", date: day(h.submitted_at), href, action: "Assign a Project Manager" });
    } else {
      const since = h.status === "pm_assigned" ? h.pm_assigned_at : h.clarification_requested_at;
      const waited = since ? daysBetween(since, today) : null;
      if (waited === null || waited >= STALLED_DAYS) {
        out.push({ kind: "handover_stalled", key: `stalled:${h.id}`, title: `${h.sales_reference} ${h.title}`,
          detail: h.status === "pm_assigned" ? `Waiting ${waited === null ? "(since a date that is not recorded)" : `${plural(waited, "day")}`} for ${h.pm ?? "the Project Manager"} to accept.` : `A question went back to Sales ${waited === null ? "on a date that is not recorded" : `${plural(waited, "day")} ago`} and the handover has not been resubmitted.`,
          owner: h.status === "pm_assigned" ? (h.pm ?? "Project Manager") : "Sales", date: day(since), href, action: h.status === "pm_assigned" ? "Open the handover (you can reassign)" : "Open the handover" });
      }
    }
  }
  for (const p of o.projects) {
    for (const b of p.blockers) {
      if (!b.cross_team && daysBetween(b.since, today) < BLOCKER_DAYS) continue;
      out.push({ kind: "blocker", key: `blocker:${b.task_id}`, title: `${p.reference} ${p.name}`, detail: `"${b.title}" is blocked since ${day(b.since)}${b.reason ? `: ${b.reason}` : ""}. ${b.unblock_owner ? `Waiting on ${b.unblock_owner}` : "Nobody is named to unblock it"}.`,
        owner: b.unblock_owner ?? p.pm, date: day(b.since), href: `/projects/${p.id}/work?task=${b.task_id}`, action: "Open the task" });
    }
    const reasons = riskReasons(p, today);
    if (reasons.length > 0) out.push({ kind: "at_risk_installation", key: `risk:${p.id}`, title: `${p.reference} ${p.name}`, detail: `${p.install_start ? "Installation" : "The event"} starts ${day(p.install_start) ?? day(p.event_start)}: ${reasons.join("; ")}.`, owner: p.pm, date: day(p.install_start) ?? day(p.event_start), href: `/projects/${p.id}/work`, action: "Open the project" });
    if (p.equipment_reviews > 0) out.push({ kind: "equipment_review", key: `review:${p.id}`, title: `${p.reference} ${p.name}`, detail: `A committed date changed while equipment is booked. ${plural(p.equipment_reviews, "booking")} to review. The booking itself has not been changed.`, owner: p.pm, date: null, href: `/projects/${p.id}/equipment`, action: "Review equipment booking" });
    if (p.release_failed) out.push({ kind: "release_failed", key: `release:${p.id}`, title: `${p.reference} ${p.name}`, detail: "Releasing unused reservations failed when the project finished. The warehouse releases them on the request.", owner: "Warehouse", date: null, href: `/projects/${p.id}/equipment`, action: "Open the Equipment tab" });
  }
  const order: DecisionKind[] = ["pm_unassigned", "handover_stalled", "blocker", "at_risk_installation", "equipment_review", "release_failed"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.title.localeCompare(b.title));
}

/** The single most relevant unresolved issue of a project, or null when nothing is recorded against it. */
export function topIssue(p: OverviewProject, today: string): string | null {
  if (p.release_failed) return "Unused reservations were not released at completion";
  if (completeButOut(p)) return `Delivery complete · equipment still out (${plural(unitsOut(p), "unit")})`;
  if (p.blockers.length > 0) return `Blocked: ${p.blockers[0]!.title}`;
  if (p.equipment_reviews > 0) return "Review equipment booking: a committed date changed";
  const short = p.equipment.find((q) => q.short_lines > 0);
  if (short) return `Equipment short on ${short.code}`;
  const overdueReturn = p.equipment.find((q) => q.return_overdue);
  if (overdueReturn) return `Equipment return overdue on ${overdueReturn.code}`;
  if (p.tasks_overdue > 0) return plural(p.tasks_overdue, "overdue task");
  if (p.milestones_overdue > 0) return plural(p.milestones_overdue, "overdue milestone");
  if (p.corrections_open + p.plan_changes_open > 0) return `${plural(p.corrections_open + p.plan_changes_open, "delivery plan decision")} waiting`;
  if (p.reviews_waiting > 0) return `${plural(p.reviews_waiting, "task")} waiting for review`;
  void today;
  return null;
}

/** Upcoming delivery: live projects by their next recorded date; a project with no recorded date is listed last and says so. */
export function upcomingDelivery(o: Overview): OverviewProject[] {
  const key = (p: OverviewProject) => day(p.install_start) ?? day(p.event_start) ?? "9999";
  return o.projects.filter((p) => !isFinished(p.status) || unitsOut(p) > 0 || p.release_failed || p.equipment_reviews > 0).sort((a, b) => key(a).localeCompare(key(b)) || a.reference.localeCompare(b.reference));
}

export interface PressureItem { kind: "overlap" | "reviews_overdue" | "shortage" | "partial_dispatch" | "overdue_return"; key: string; text: string; href: string }
/** Team and warehouse pressure, where it is recorded. Overlaps need both projects to have dates; nothing is estimated. */
export function pressure(o: Overview): PressureItem[] {
  const out: PressureItem[] = [];
  for (const x of o.overlaps) out.push({ kind: "overlap", key: `overlap:${x.user_id}:${x.a_id}:${x.b_id}`, text: `${x.person} is on ${x.a} and ${x.b}, whose delivery dates overlap ${day(x.from)} to ${day(x.to)}.`, href: `/projects/${x.a_id}/people` });
  for (const p of o.projects) {
    if (p.reviews_overdue > 0) out.push({ kind: "reviews_overdue", key: `reviews:${p.id}`, text: `${p.reference}: ${plural(p.reviews_overdue, "review")} past the task's due date.`, href: `/projects/${p.id}/work` });
    for (const q of p.equipment) {
      if (q.short_lines > 0) out.push({ kind: "shortage", key: `short:${q.id}`, text: `${p.reference}: ${equipmentLine(q)}`, href: `/projects/${p.id}/equipment` });
      if (q.state === "partially_dispatched") out.push({ kind: "partial_dispatch", key: `partial:${q.id}`, text: `${p.reference}: ${q.code} is partly dispatched (${q.dispatched_lines} of ${plural(q.lines, "line")}).`, href: `/projects/${p.id}/equipment` });
      if (q.return_overdue) out.push({ kind: "overdue_return", key: `return:${q.id}`, text: `${p.reference}: ${plural(n(q.units_out), "unit")} from ${q.code} due back ${day(q.expected_return_at)} and not returned${isFinished(p.status) ? " (the project is complete)" : ""}.`, href: `/projects/${p.id}/equipment` });
    }
  }
  return out;
}

/** Upcoming Work filters. `q` matches reference, title, owner, location and the edition label. */
export function filterUpcoming(rows: readonly UpcomingRow[], f: { q?: string; stage?: string; next?: string }): UpcomingRow[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (q && ![r.reference, r.title, r.owner, r.location ?? "", r.edition?.label ?? ""].some((x) => x.toLowerCase().includes(q))) return false;
    if (f.stage === "won" && !r.won) return false;
    if (f.stage === "open" && r.won) return false;
    if (f.next && nextResponsible(r).who.toLowerCase().replace(/\s+/g, "-") !== f.next) return false;
    return true;
  });
}
