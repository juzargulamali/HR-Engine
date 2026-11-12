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
  id: string; code: string; status: string; state: "draft" | "cancelled" | "empty" | "reserved" | "partially_ready" | "short" | "partially_dispatched" | "dispatched" | "still_out" | "returned";
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
  event_end: string | null; edition: string | null; tasks_open: number; tasks_overdue: number; reviews_waiting: number; reviews_overdue: number;
  /** Up to five blocked tasks, oldest first; `blockers_total` is how many there are in all. */
  blockers: OverviewBlocker[]; blockers_total: number;
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
  draft: "Not sent to the warehouse yet", cancelled: "Cancelled", empty: "No lines", reserved: "Reserved", partially_ready: "Partly ready", short: "Short", partially_dispatched: "Partly dispatched",
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
  // "N of M lines reserved" is said only while the request is with the warehouse and nothing has gone out: a draft has nothing reserved, and once stock is out
  // the question is what is out and what is short.
  const reserved = ["reserved", "partially_ready", "short"].includes(q.state) ? ` ${q.reserved_lines} of ${plural(q.lines, "line")} reserved.` : q.state === "draft" && q.lines > 0 ? ` ${plural(q.lines, "line")} on the draft, nothing reserved yet.` : "";
  return `${q.code}: ${STATE_WORDS[q.state] ?? q.state}.${reserved}${short}${out}`.trim();
}
/** How many tasks are blocked in all (the list carries at most five of them). */
export const blockedCount = (p: Pick<OverviewProject, "blockers" | "blockers_total">) => Math.max(n(p.blockers_total), p.blockers.length);
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
  // From 14 days before the start until the event ends: a shortage matters most once installation has begun. A project whose end is not recorded drops out
  // the day after its start.
  const over = day(p.event_end) ? daysBetween(today, day(p.event_end)!) < 0 : days < 0;
  if (days > AT_RISK_WINDOW_DAYS || over) return [];
  const out: string[] = [];
  const short = p.equipment.filter((q) => q.short_lines > 0);
  if (short.length > 0) out.push(`equipment short on ${short.map((q) => q.code).join(", ")}`);
  if (p.equipment.some((q) => q.state === "draft")) out.push("an equipment request has not been sent to the warehouse");
  if (blockedCount(p) > 0) out.push(plural(blockedCount(p), "blocked task"));
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
    const start = day(p.install_start) ?? day(p.event_start)!;
    if (reasons.length > 0) out.push({ kind: "at_risk_installation", key: `risk:${p.id}`, title: `${p.reference} ${p.name}`, detail: `${p.install_start ? "Installation" : "The event"} ${start < today ? "started" : "starts"} ${start}: ${reasons.join("; ")}.`, owner: p.pm, date: day(p.install_start) ?? day(p.event_start), href: `/projects/${p.id}/work`, action: "Open the project" });
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

// ---- Project health (rule-based), the summary figures, the delivery timeline and the week chart ---------------------------------------------------------------------
//
// Health is a label read from recorded facts, never a score and never a judgement of the Project Manager. The rules, in order:
//   at_risk          a recorded problem on a project whose installation (or show, when no installation date is recorded) starts within 14 days or is under way
//                    (`riskReasons`), or unused reservations that were not released at completion, or equipment past its recorded return date.
//   needs_attention  a blocked task, a missing owner (no Project Manager, or a blocker nobody is named to unblock), a recorded shortage, an open booking
//                    review, an overdue task or milestone, or a finished project whose equipment is still out.
//   not_enough_info  none of the above, and neither an installation nor a show date is recorded: there is nothing to measure "on track" against.
//   on_track         dates are recorded and nothing above is recorded against the project.
// A read that failed has no label at all: the screen says it could not load.
export type Health = "on_track" | "needs_attention" | "at_risk" | "not_enough_info";
export const HEALTH_WORDS: Record<Health, string> = { on_track: "On track", needs_attention: "Needs attention", at_risk: "At risk", not_enough_info: "Not enough information" };
export const HEALTH_ORDER: Health[] = ["at_risk", "needs_attention", "not_enough_info", "on_track"];
export interface Evidence { text: string; href: string }
export interface ProjectHealth { health: Health; evidence: Evidence[] }

export function projectHealth(p: OverviewProject, today: string): ProjectHealth {
  const work = `/projects/${p.id}/work`; const equip = `/projects/${p.id}/equipment`; const people = `/projects/${p.id}/people`;
  const risk: Evidence[] = []; const attention: Evidence[] = [];
  const start = day(p.install_start) ?? day(p.event_start);
  const windowed = riskReasons(p, today);
  if (windowed.length > 0 && start) {
    const lead = `${p.install_start ? "Installation" : "The show"} ${start < today ? "started" : "starts"} ${start}`;
    for (const r of windowed) risk.push({ text: `${lead}: ${r}`, href: /equipment|warehouse/.test(r) ? equip : /delivery plan/.test(r) ? `/projects/${p.id}/delivery` : work });
  }
  if (p.release_failed) risk.push({ text: "Unused reservations were not released at completion", href: equip });
  for (const q of p.equipment) if (q.return_overdue) risk.push({ text: `Equipment from ${q.code} was due back ${day(q.expected_return_at) ?? "on a date that is not recorded"} and is not returned`, href: equip });

  if (!p.pm_id && !isFinished(p.status)) attention.push({ text: "No Project Manager is recorded", href: people });
  if (windowed.length === 0) {
    for (const b of p.blockers) attention.push({ text: `Blocked since ${day(b.since)}: ${b.title}${b.unblock_owner ? ` (waiting on ${b.unblock_owner})` : " (nobody is named to unblock it)"}`, href: `${work}?task=${b.task_id}` });
    if (blockedCount(p) > p.blockers.length) attention.push({ text: `${plural(blockedCount(p) - p.blockers.length, "more blocked task")}`, href: work });
    for (const q of p.equipment) if (q.short_lines > 0) attention.push({ text: `Equipment short on ${q.code}: ${plural(q.short_lines, "line")}`, href: equip });
    if (p.tasks_overdue > 0) attention.push({ text: plural(p.tasks_overdue, "overdue task"), href: work });
    if (p.milestones_overdue > 0) attention.push({ text: plural(p.milestones_overdue, "overdue milestone"), href: work });
  } else {
    for (const b of p.blockers) if (!b.unblock_owner) attention.push({ text: `Nobody is named to unblock "${b.title}"`, href: `${work}?task=${b.task_id}` });
  }
  if (p.equipment_reviews > 0) attention.push({ text: `${plural(p.equipment_reviews, "equipment booking")} to review after a date change (with ${p.pm_id ? p.pm : "the Project Manager"})`, href: equip });
  if (completeButOut(p)) attention.push({ text: `Delivery complete, ${plural(unitsOut(p), "unit")} still out`, href: equip });

  if (risk.length > 0) return { health: "at_risk", evidence: [...risk, ...attention] };
  if (attention.length > 0) return { health: "needs_attention", evidence: attention };
  if (!start) return { health: "not_enough_info", evidence: [{ text: "Neither an installation date nor a show date is recorded", href: work }] };
  return { health: "on_track", evidence: [{ text: "Dates are recorded; no blocker, shortage, overdue task, overdue milestone or booking review is recorded", href: work }] };
}
export function healthCounts(o: Overview, today: string): Record<Health, number> {
  const c: Record<Health, number> = { on_track: 0, needs_attention: 0, at_risk: 0, not_enough_info: 0 };
  for (const p of o.projects) if (!isFinished(p.status) || unitsOut(p) > 0 || p.release_failed) c[projectHealth(p, today).health] += 1;
  return c;
}

/** Equipment lines ready out of the lines asked for, on requests that are with the warehouse and not yet out. Null when there is no such line: no bar is drawn without a real denominator. */
export function readiness(p: Pick<OverviewProject, "equipment">): { ready: number; total: number } | null {
  const live = p.equipment.filter((q) => ["reserved", "partially_ready", "short"].includes(q.state));
  const total = live.reduce((a, q) => a + n(q.lines), 0);
  return total > 0 ? { ready: live.reduce((a, q) => a + n(q.reserved_lines), 0), total } : null;
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Unfinished projects whose installation (or show, when no installation date is recorded) starts today or within `days` days, soonest first. */
export function installationsWithin(o: Overview, today: string, days = AT_RISK_WINDOW_DAYS): (OverviewProject & { start: string; in_days: number; by: "installation" | "show" })[] {
  return o.projects.flatMap((p) => {
    const start = day(p.install_start) ?? day(p.event_start);
    if (!start || isFinished(p.status)) return [];
    const d = daysBetween(today, start);
    return d >= 0 && d <= days ? [{ ...p, start, in_days: d, by: p.install_start ? "installation" as const : "show" as const }] : [];
  }).sort((a, b) => a.start.localeCompare(b.start) || a.reference.localeCompare(b.reference));
}

export type EquipmentIssueKind = "shortage" | "booking_review" | "overdue_return" | "release_failed" | "not_sent" | "still_out";
export const EQUIPMENT_ISSUE_WORDS: Record<EquipmentIssueKind, string> = {
  shortage: "Shortage", booking_review: "Booking to review", overdue_return: "Return overdue", release_failed: "Reservations not released", not_sent: "Request not sent", still_out: "Complete, still out",
};
export interface EquipmentIssue { kind: EquipmentIssueKind; key: string; project: string; text: string; owner: string; href: string }
/** Recorded equipment problems, most pressing kind first. "Request not sent" is listed only inside the 14-day window: a draft far ahead of its dates is not a problem. */
export function equipmentIssues(o: Overview, today: string): EquipmentIssue[] {
  const out: EquipmentIssue[] = [];
  const soon = new Set(installationsWithin(o, today).map((p) => p.id));
  for (const p of o.projects) {
    const href = `/projects/${p.id}/equipment`; const project = `${p.reference} ${p.name}`;
    for (const q of p.equipment) {
      if (q.short_lines > 0) out.push({ kind: "shortage", key: `short:${q.id}`, project, text: equipmentLine(q), owner: "Warehouse", href });
      if (q.return_overdue) out.push({ kind: "overdue_return", key: `return:${q.id}`, project, text: `${plural(n(q.units_out), "unit")} from ${q.code} due back ${day(q.expected_return_at) ?? "on a date that is not recorded"}`, owner: "Warehouse", href });
      if (q.state === "draft" && soon.has(p.id)) out.push({ kind: "not_sent", key: `draft:${q.id}`, project, text: `${q.code} has not been sent to the warehouse`, owner: p.pm, href });
    }
    if (p.equipment_reviews > 0) out.push({ kind: "booking_review", key: `review:${p.id}`, project, text: `${plural(p.equipment_reviews, "booking")} to review after a committed date changed`, owner: p.pm, href });
    if (p.release_failed) out.push({ kind: "release_failed", key: `release:${p.id}`, project, text: "Unused reservations were not released at completion", owner: "Warehouse", href });
    if (completeButOut(p) && !p.equipment.some((q) => q.return_overdue)) out.push({ kind: "still_out", key: `out:${p.id}`, project, text: `Delivery complete, ${plural(unitsOut(p), "unit")} still out`, owner: "Warehouse", href });
  }
  const order: EquipmentIssueKind[] = ["shortage", "release_failed", "overdue_return", "booking_review", "not_sent", "still_out"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.project.localeCompare(b.project));
}

export type TimelineKind = "installation" | "show" | "dismantling";
export const TIMELINE_WORDS: Record<TimelineKind, string> = { installation: "Installation", show: "Show", dismantling: "Dismantling" };
export interface TimelineEntry { key: string; kind: TimelineKind; date: string; until: string | null; title: string; who: string; href: string; tentative: boolean }
export const TIMELINE_DAYS = 30;
/**
 * The next 30 days in date order: installation and show dates of live projects, and the installation, show and dismantling dates Sales recorded on flagged
 * enquiries that have no project yet (marked tentative until won). A project carries no dismantling date, so dismantling appears only for enquiries.
 */
export function timeline(o: Overview, upcoming: readonly UpcomingRow[] | null, today: string, days = TIMELINE_DAYS): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const inWindow = (d: string | null, until?: string | null) => !!d && daysBetween(today, d) <= days && daysBetween(today, until ?? d) >= 0;
  for (const p of o.projects) {
    if (isFinished(p.status)) continue;
    const title = `${p.reference} ${p.name}`; const href = `/projects/${p.id}/work`;
    if (inWindow(day(p.install_start))) out.push({ key: `i:${p.id}`, kind: "installation", date: day(p.install_start)!, until: null, title, who: p.pm, href, tentative: false });
    if (inWindow(day(p.event_start), day(p.event_end))) out.push({ key: `s:${p.id}`, kind: "show", date: day(p.event_start)!, until: day(p.event_end), title, who: p.pm, href, tentative: false });
  }
  for (const r of upcoming ?? []) {
    if (r.handover?.project_id) continue;
    const title = `${r.reference} ${r.title}`; const href = `/operations/upcoming?company=${r.company_id}&q=${encodeURIComponent(r.reference)}`; const tentative = !r.won;
    const who = r.handover?.pm ?? (r.planning?.provisional_pm ? `${r.planning.provisional_pm} (provisional)` : r.owner);
    if (inWindow(day(r.install_start))) out.push({ key: `i:${r.id}`, kind: "installation", date: day(r.install_start)!, until: null, title, who, href, tentative });
    if (inWindow(day(r.event_start), day(r.event_end))) out.push({ key: `s:${r.id}`, kind: "show", date: day(r.event_start)!, until: day(r.event_end), title, who, href, tentative });
    if (inWindow(day(r.dismantle_date))) out.push({ key: `d:${r.id}`, kind: "dismantling", date: day(r.dismantle_date)!, until: null, title, who, href, tentative });
  }
  const order: TimelineKind[] = ["installation", "show", "dismantling"];
  return out.sort((a, b) => a.date.localeCompare(b.date) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title));
}

export interface WeekBucket { key: string; label: string; from: string | null; to: string | null; projects: OverviewProject[] }
export const CHART_WEEKS = 6;
/** Monday of the week a date falls in. */
export const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
/**
 * Upcoming delivery by week: unfinished projects by the week their installation (or show) starts, this week and the five after it, then "Later", "Already started"
 * and "No date recorded". Every bucket carries its projects, so the chart and the list under it are the same records and the counts cannot differ.
 */
export function deliveryByWeek(o: Overview, today: string, weeks = CHART_WEEKS): WeekBucket[] {
  const first = weekStart(today);
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => {
    const from = addDays(first, i * 7);
    return { key: from, label: i === 0 ? "This week" : i === 1 ? "Next week" : `Week of ${from}`, from, to: addDays(from, 6), projects: [] };
  });
  const later: WeekBucket = { key: "later", label: "Later", from: addDays(first, weeks * 7), to: null, projects: [] };
  const started: WeekBucket = { key: "started", label: "Already started", from: null, to: addDays(first, -1), projects: [] };
  const none: WeekBucket = { key: "none", label: "No date recorded", from: null, to: null, projects: [] };
  for (const p of o.projects) {
    if (isFinished(p.status)) continue;
    const start = day(p.install_start) ?? day(p.event_start);
    if (!start) { none.projects.push(p); continue; }
    const i = Math.floor(daysBetween(first, start) / 7);
    (i < 0 ? started : i >= weeks ? later : buckets[i]!).projects.push(p);
  }
  for (const b of [...buckets, later, started, none]) b.projects.sort((a, c) => (day(a.install_start) ?? day(a.event_start) ?? "9999").localeCompare(day(c.install_start) ?? day(c.event_start) ?? "9999") || a.reference.localeCompare(c.reference));
  return [started, ...buckets, later, none].filter((b) => b.projects.length > 0 || (b.from !== null && b.to !== null && b.key !== "started"));
}

/** The next unresolved item of a flagged enquiry, in a few words, for the scannable Upcoming Work row. */
export function nextUnresolved(r: UpcomingRow): string {
  const next = nextResponsible(r);
  return `${next.who}${next.person ? ` (${next.person})` : ""}: ${next.what}`;
}
/** What a flagged enquiry is for, as "event · venue": the edition when one is linked, otherwise the enquiry's own title and place. */
export function eventLine(r: Pick<UpcomingRow, "edition" | "title" | "location">): { event: string; venue: string | null } {
  return { event: r.edition?.label ?? r.edition?.event_name ?? r.title, venue: [r.edition?.venue, r.edition?.city ?? r.location].filter(Boolean).join(", ") || null };
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
