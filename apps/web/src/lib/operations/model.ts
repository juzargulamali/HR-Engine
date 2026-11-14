/**
 * Operations: what the two database reads return (ops_overview, ops_upcoming_work) and what the screens derive from them. Pure: no database, no React.
 *
 * Everything shown is derived from recorded facts. There is no score, no capacity figure and no second progress tracker: an item is on "Needs my decision" because a
 * record says so (a handover has no Project Manager, a task is blocked, a date changed while equipment is booked), and each item names its owner, its date and the
 * screen where the authorised person acts. What is not recorded is said to be not recorded.
 */
import { shortDay, type ActivityKind, type SiteActivityRead } from "@/lib/projects/phase2/model";
import { describeSitePhase } from "@/lib/projects/site-state";

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
/** A version the Project Manager submitted that waits for an Operations review (the existing overview read carries them; absent on a database without the follow-up migration). */
export interface OutputReviewItem {
  version_id: string; task_id: string; project_id: string; reference: string; project: string; task: string; label: string | null; version_no: number; attached_at: string; submitted_by_id: string; submitted_by: string;
  assignee_id: string; assignee: string; reviewer_id: string | null; reviewer: string | null; needs_reviewer: boolean; pm: string;
}
export interface Overview { company_id: string; taken_at: string; handovers: OverviewHandover[]; projects: OverviewProject[]; overlaps: OverviewOverlap[]; output_reviews?: OutputReviewItem[] }

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
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
/**
 * What a project's header dates say, in words that never claim work started. A passed date is "date passed · start unconfirmed" (nobody has recorded a start); only an explicit
 * start record on a site activity counts as started, and that comes from the site activity read, not from a date.
 */
export function headerDateText(p: Pick<OverviewProject, "install_start" | "event_start">, today: string): { start: string; passed: boolean; lead: string } | null {
  const start = day(p.install_start) ?? day(p.event_start);
  if (!start) return null;
  const word = p.install_start ? "installation" : "show";
  const passed = start < today;
  return { start, passed, lead: passed ? `Scheduled ${word} date passed · start unconfirmed (${start}, project header)` : `${cap(word)} planned ${start} (project header)` };
}
/** How many tasks are blocked in all (the list carries at most five of them). */
export const blockedCount = (p: Pick<OverviewProject, "blockers" | "blockers_total">) => Math.max(n(p.blockers_total), p.blockers.length);
export const unitsOut = (p: Pick<OverviewProject, "equipment">) => p.equipment.reduce((a, q) => a + n(q.units_out), 0);
export const isFinished = (status: string) => status === "completed" || status === "archived";
/** A finished project whose equipment is still out: two separate facts, both shown. */
export const completeButOut = (p: Pick<OverviewProject, "status" | "equipment">) => isFinished(p.status) && unitsOut(p) > 0;

export type DecisionKind = "pm_unassigned" | "handover_stalled" | "output_review" | "blocker" | "at_risk_installation" | "equipment_review" | "release_failed";
/** `ownerId` is the person the record names (assigned reviewer, named Project Manager); `mine` is true when that is the viewer. `ownerId` is null where the owner is a role ("Operations"), not a person. */
export interface DecisionItem { kind: DecisionKind; key: string; title: string; detail: string; owner: string; ownerId: string | null; mine: boolean; date: string | null; href: string; action: string }
export const DECISION_WORDS: Record<DecisionKind, string> = {
  pm_unassigned: "Project Manager not assigned", handover_stalled: "Handover stalled", output_review: "Output waiting for Operations review", blocker: "Blocker not resolved", at_risk_installation: "Installation at risk",
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
export function decisions(o: Overview, today: string, viewerId?: string | null): DecisionItem[] {
  const out: DecisionItem[] = [];
  const push = (d: Omit<DecisionItem, "mine" | "ownerId"> & { ownerId?: string | null }) => out.push({ ...d, ownerId: d.ownerId ?? null, mine: !!viewerId && d.ownerId === viewerId });
  for (const h of o.handovers) {
    const href = `/projects/handovers?handover=${h.id}`;
    if (h.status === "submitted") {
      push({ kind: "pm_unassigned", key: `pm:${h.id}`, title: `${h.sales_reference} ${h.title}`, detail: `Handover submitted${h.submitted_at ? ` ${day(h.submitted_at)}` : ""}. No Project Manager is assigned.`, owner: "Operations", date: day(h.submitted_at), href, action: "Assign a Project Manager" });
    } else {
      const since = h.status === "pm_assigned" ? h.pm_assigned_at : h.clarification_requested_at;
      const waited = since ? daysBetween(since, today) : null;
      if (waited === null || waited >= STALLED_DAYS) {
        push({ kind: "handover_stalled", key: `stalled:${h.id}`, title: `${h.sales_reference} ${h.title}`,
          detail: h.status === "pm_assigned" ? `Waiting ${waited === null ? "(since a date that is not recorded)" : `${plural(waited, "day")}`} for ${h.pm ?? "the Project Manager"} to accept.` : `A question went back to Sales ${waited === null ? "on a date that is not recorded" : `${plural(waited, "day")} ago`} and the handover has not been resubmitted.`,
          owner: h.status === "pm_assigned" ? (h.pm ?? "Project Manager") : "Sales", ownerId: h.status === "pm_assigned" ? h.pm_id : null, date: day(since), href, action: h.status === "pm_assigned" ? "Open the handover (you can reassign)" : "Open the handover" });
      }
    }
  }
  for (const p of o.projects) {
    for (const b of p.blockers) {
      if (!b.cross_team && daysBetween(b.since, today) < BLOCKER_DAYS) continue;
      push({ kind: "blocker", key: `blocker:${b.task_id}`, title: `${p.reference} ${p.name}`, detail: `"${b.title}" is blocked since ${day(b.since)}${b.reason ? `: ${b.reason}` : ""}. ${b.unblock_owner ? `Waiting on ${b.unblock_owner}` : "Nobody is named to unblock it"}.`,
        owner: b.unblock_owner ?? p.pm, ownerId: b.unblock_owner ? null : p.pm_id, date: day(b.since), href: `/projects/${p.id}/work?task=${b.task_id}`, action: "Open the task" });
    }
    const reasons = riskReasons(p, today);
    const hd = headerDateText(p, today);
    if (reasons.length > 0) push({ kind: "at_risk_installation", key: `risk:${p.id}`, title: `${p.reference} ${p.name}`, detail: `${hd ? hd.lead : "Project header dates"}: ${reasons.join("; ")}.`, owner: p.pm, ownerId: p.pm_id, date: day(p.install_start) ?? day(p.event_start), href: `/projects/${p.id}/work`, action: "Open the project" });
    if (p.equipment_reviews > 0) push({ kind: "equipment_review", key: `review:${p.id}`, title: `${p.reference} ${p.name}`, detail: `A committed date changed while equipment is booked. ${plural(p.equipment_reviews, "booking")} to review. The booking itself has not been changed.`, owner: p.pm, ownerId: p.pm_id, date: null, href: `/projects/${p.id}/equipment`, action: "Review equipment booking" });
    if (p.release_failed) push({ kind: "release_failed", key: `release:${p.id}`, title: `${p.reference} ${p.name}`, detail: "Releasing unused reservations failed when the project finished. The warehouse releases them on the request.", owner: "Warehouse", date: null, href: `/projects/${p.id}/equipment`, action: "Open the Equipment tab" });
  }
  for (const r of o.output_reviews ?? []) {
    push({ kind: "output_review", key: `output:${r.version_id}`, title: `${r.reference} ${r.project}`,
      detail: `${r.needs_reviewer ? "Needs an Operations reviewer: " : ""}Version ${r.version_no} of "${r.label ?? r.task}" (${r.task}) was submitted by ${r.submitted_by} and is assigned to ${r.assignee}. ${r.needs_reviewer ? `Nobody else holds the Operations role, so ${r.pm} needs someone with access to People & Access to give it to another person.` : r.reviewer ? `Reviewer: ${r.reviewer}.` : "Not assigned yet: any eligible Operations Manager can take it."}`,
      owner: r.reviewer ?? (r.needs_reviewer ? r.pm : "Operations"), ownerId: r.reviewer_id, date: day(r.attached_at), href: `/projects/${r.project_id}/work?task=${r.task_id}&version=${r.version_id}`, action: r.needs_reviewer ? "Open the version (ask for a reviewer)" : "Open the version to review it" });
  }
  const order: DecisionKind[] = ["pm_unassigned", "handover_stalled", "output_review", "blocker", "at_risk_installation", "equipment_review", "release_failed"];
  // Decisions assigned to the viewer lead; then the rest in the usual order.
  return out.sort((a, b) => Number(b.mine) - Number(a.mine) || order.indexOf(a.kind) - order.indexOf(b.kind) || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.title.localeCompare(b.title));
}

/** The decisions assigned to the viewer, and the follow-ups (each with the named owner it waits on) in the order `decisions` returned them. */
export const splitDecisions = (items: readonly DecisionItem[]): { mine: DecisionItem[]; followUps: DecisionItem[] } => ({ mine: items.filter((d) => d.mine), followUps: items.filter((d) => !d.mine) });

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

/** One thing a person or crew is committed to: the project, the activity (or the project header window it falls back to) and when. */
export interface Commitment { project: string; title: string; when: string; href: string; source: "activity" | "project_header" }
export interface PressureItem { kind: "overlap" | "crew_overlap" | "reviews_overdue" | "shortage" | "partial_dispatch" | "overdue_return"; key: string; text: string; href: string; /** Both sides of an overlap. */ commitments?: Commitment[]; who?: string }

/** The site schedule link of one activity: the exact row on the project's Site schedule. */
export const siteHref = (a: { project_id: string; id: string }) => `/projects/${a.project_id}/plan?plan=site&mode=list#site-${a.id}`;

const dayRange = (a: string | null, b: string | null) => (!a ? "no date" : !b || b === a ? shortDay(a) : `${shortDay(a)} to ${shortDay(b)}`);
const clock = (iso: string, tz: string | null) => new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
/** "14 Nov, 09:00–17:00" when the activity has a time window, otherwise the dates. */
export function activityWhen(a: Pick<SiteActivityRead, "phase" | "starts_at" | "ends_at" | "tz">): string {
  const first = a.phase.first_day; const last = a.phase.last_day;
  if (a.starts_at && first) {
    const to = a.ends_at ? clock(a.ends_at, a.tz) : null;
    return last && last !== first ? `${shortDay(first)} ${clock(a.starts_at, a.tz)} to ${shortDay(last)}${to ? ` ${to}` : ""}` : `${shortDay(first)}, ${clock(a.starts_at, a.tz)}${to ? `–${to}` : ""}`;
  }
  return dayRange(first, last);
}
/** The span an activity occupies, in milliseconds: its time window when it has one, otherwise whole days. Null when it has no date. */
function span(a: Pick<SiteActivityRead, "phase" | "starts_at" | "ends_at">): [number, number] | null {
  if (a.starts_at) { const s0 = Date.parse(a.starts_at); const e0 = a.ends_at ? Date.parse(a.ends_at) : s0 + 3_600_000; return [s0, Math.max(e0, s0 + 1)]; }
  if (!a.phase.first_day) return null;
  return [Date.parse(`${a.phase.first_day}T00:00:00Z`), Date.parse(`${a.phase.last_day ?? a.phase.first_day}T00:00:00Z`) + 86_400_000];
}
const overlaps = (x: [number, number], y: [number, number]) => x[0] < y[1] && y[0] < x[1];
const activityCommitment = (a: SiteActivityRead): Commitment => ({ project: `${a.reference} ${a.project_name}`, title: a.title, when: activityWhen(a), href: siteHref(a), source: "activity" });

/**
 * Team pressure, where it is recorded. Both sides of every overlap are shown (title, project, date or time window), never just two project names:
 *   - a PERSON on two live projects whose delivery windows overlap (the existing overview read); each side is named by the project's dated site activities that fall in the overlap, else by its
 *     header window, labelled as such;
 *   - two CONFIRMED site activities of different projects that overlap in time and both have crew places. This is the activity-level part of the existing conflict rule (a confirmed commitment
 *     that overlaps another); it cannot say WHICH person is on both, because the activity read carries crew counts, not people, so it asks for that check on the Site schedule.
 * Nothing is estimated.
 */
export function pressure(o: Overview, activities?: readonly SiteActivityRead[] | null): PressureItem[] {
  const out: PressureItem[] = [];
  const acts = activities ?? [];
  const byProject = new Map<string, SiteActivityRead[]>();
  for (const a of acts) { const l = byProject.get(a.project_id) ?? []; l.push(a); byProject.set(a.project_id, l); }
  const project = new Map(o.projects.map((p) => [p.id, p]));
  const covered = new Set<string>();
  const pairKey = (x: string, y: string) => [x, y].sort().join("|");
  for (const x of o.overlaps) {
    covered.add(pairKey(x.a_id, x.b_id));
    const win: [number, number] = [Date.parse(`${day(x.from)}T00:00:00Z`), Date.parse(`${day(x.to)}T00:00:00Z`) + 86_400_000];
    const side = (id: string, ref: string): Commitment[] => {
      const p = project.get(id);
      const inside = (byProject.get(id) ?? []).filter((a) => { const sp = span(a); return sp ? overlaps(sp, win) : false; });
      if (inside.length > 0) return inside.slice(0, 3).map(activityCommitment);
      const from = day(p?.install_start) ?? day(p?.event_start); const to = day(p?.event_end);
      return [{ project: p ? `${p.reference} ${p.name}` : ref, title: "Project delivery window (from the project header)", when: dayRange(from, to), href: `/projects/${id}/plan?plan=site&mode=list`, source: "project_header" }];
    };
    const commitments = [...side(x.a_id, x.a), ...side(x.b_id, x.b)];
    out.push({ kind: "overlap", key: `overlap:${x.user_id}:${x.a_id}:${x.b_id}`, who: x.person, commitments, href: commitments[0]?.href ?? `/projects/${x.a_id}/people`,
      text: `${x.person} is on ${x.a} and ${x.b}, whose delivery dates overlap ${day(x.from)} to ${day(x.to)}.` });
  }
  // Activity-level: confirmed crewed activities of different projects that overlap in time.
  const crewed = acts.filter((a) => a.state === "confirmed" && a.crew_total > 0 && span(a));
  let pairs = 0;
  for (let i = 0; i < crewed.length && pairs < 20; i += 1) {
    for (let j = i + 1; j < crewed.length && pairs < 20; j += 1) {
      const a = crewed[i]!; const b = crewed[j]!;
      if (a.project_id === b.project_id || covered.has(pairKey(a.project_id, b.project_id))) continue;
      if (!overlaps(span(a)!, span(b)!)) continue;
      pairs += 1;
      out.push({ kind: "crew_overlap", key: `crew:${a.id}:${b.id}`, commitments: [activityCommitment(a), activityCommitment(b)], href: siteHref(a),
        text: `${a.reference} ${a.title} and ${b.reference} ${b.title} are both confirmed with crew and overlap. Check on the Site schedule whether the same people are on both.` });
    }
  }
  for (const p of o.projects) {
    if (p.reviews_overdue > 0) out.push({ kind: "reviews_overdue", key: `reviews:${p.id}`, text: `${p.reference}: ${plural(p.reviews_overdue, "review")} past the task's due date.`, href: `/projects/${p.id}/work` });
    for (const q of p.equipment) {
      if (q.short_lines > 0) out.push({ kind: "shortage", key: `short:${q.id}`, text: `${p.reference}: ${equipmentLine(q)}`, href: requestHref(p.id, q.id) });
      if (q.state === "partially_dispatched") out.push({ kind: "partial_dispatch", key: `partial:${q.id}`, text: `${p.reference}: ${q.code} is partly dispatched (${q.dispatched_lines} of ${plural(q.lines, "line")}).`, href: requestHref(p.id, q.id) });
      if (q.return_overdue) out.push({ kind: "overdue_return", key: `return:${q.id}`, text: `${p.reference}: ${plural(n(q.units_out), "unit")} from ${q.code} due back ${day(q.expected_return_at)} and not returned${isFinished(p.status) ? " (the project is complete)" : ""}.`, href: requestHref(p.id, q.id) });
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
    const lead = headerDateText(p, today)!.lead;
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

export type EquipmentIssueKind = "shortage" | "booking_review" | "overdue_return" | "release_failed" | "partial_dispatch" | "not_sent" | "still_out";
export const EQUIPMENT_ISSUE_WORDS: Record<EquipmentIssueKind, string> = {
  shortage: "Shortage", booking_review: "Booking to review", overdue_return: "Return overdue", release_failed: "Reservations not released", partial_dispatch: "Partly dispatched", not_sent: "Request not sent", still_out: "Complete, still out",
};
/** `href` opens the exact request on the project's Equipment tab (`?request=<id>`), the same request Work shows; `code` is its reference (for example UAE-R-00005). `next` is the next action, in words. */
export interface EquipmentIssue { kind: EquipmentIssueKind; key: string; project: string; text: string; owner: string; href: string; code: string | null; requestId: string | null; next: string }
/** The exact request on the project's Equipment tab. */
export const requestHref = (projectId: string, requestId: string) => `/projects/${projectId}/equipment?request=${requestId}`;
/** A draft request is not ready to submit while its planning dates (needed from and until) are not set. */
export const missingPlanningDates = (q: Pick<RequestState, "state" | "needed_from" | "needed_until">) => q.state === "draft" && (!q.needed_from || !q.needed_until);
/** Recorded equipment problems, most pressing kind first. "Request not sent" is listed inside the 14-day window, and always when its planning dates are missing (it cannot be submitted without them). */
export function equipmentIssues(o: Overview, today: string): EquipmentIssue[] {
  const out: EquipmentIssue[] = [];
  const soon = new Set(installationsWithin(o, today).map((p) => p.id));
  for (const p of o.projects) {
    const href = `/projects/${p.id}/equipment`; const project = `${p.reference} ${p.name}`;
    for (const q of p.equipment) {
      const rh = requestHref(p.id, q.id);
      if (q.short_lines > 0) out.push({ kind: "shortage", key: `short:${q.id}`, project, text: equipmentLine(q), owner: "Warehouse", href: rh, code: q.code, requestId: q.id, next: "Warehouse buys, rents or re-plans the short lines; open the request" });
      if (q.return_overdue) out.push({ kind: "overdue_return", key: `return:${q.id}`, project, text: `${plural(n(q.units_out), "unit")} from ${q.code} due back ${day(q.expected_return_at) ?? "on a date that is not recorded"}`, owner: "Warehouse", href: rh, code: q.code, requestId: q.id, next: "Chase the return; open the request" });
      if (q.state === "partially_dispatched") out.push({ kind: "partial_dispatch", key: `partial:${q.id}`, project, text: `${q.code}: ${q.dispatched_lines} of ${plural(q.lines, "line")} dispatched`, owner: "Warehouse", href: rh, code: q.code, requestId: q.id, next: "Dispatch the remaining lines; open the request" });
      if (q.state === "draft" && (soon.has(p.id) || missingPlanningDates(q))) {
        const gap = missingPlanningDates(q);
        out.push({ kind: "not_sent", key: `draft:${q.id}`, project, text: `${q.code} has not been sent to the warehouse${gap ? "; its planning dates are not set" : ""}`, owner: p.pm, href: rh, code: q.code, requestId: q.id, next: gap ? "Set planning dates before submitting to Warehouse" : "Submit to Warehouse" });
      }
    }
    if (p.equipment_reviews > 0) out.push({ kind: "booking_review", key: `review:${p.id}`, project, text: `${plural(p.equipment_reviews, "booking")} to review after a committed date changed`, owner: p.pm, href, code: null, requestId: null, next: "Review the booking on the Equipment tab" });
    if (p.release_failed) out.push({ kind: "release_failed", key: `release:${p.id}`, project, text: "Unused reservations were not released at completion", owner: "Warehouse", href, code: null, requestId: null, next: "The warehouse releases them on the request" });
    if (completeButOut(p) && !p.equipment.some((q) => q.return_overdue)) out.push({ kind: "still_out", key: `out:${p.id}`, project, text: `Delivery complete, ${plural(unitsOut(p), "unit")} still out`, owner: "Warehouse", href, code: null, requestId: null, next: "Receive the equipment back" });
  }
  const order: EquipmentIssueKind[] = ["shortage", "release_failed", "overdue_return", "booking_review", "partial_dispatch", "not_sent", "still_out"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.project.localeCompare(b.project));
}

export type TimelineKind = "installation" | "show" | "dismantling" | "activity";
export const TIMELINE_WORDS: Record<TimelineKind, string> = { installation: "Installation", show: "Show", dismantling: "Dismantling", activity: "Activity" };
/** Where a dated entry comes from: a site activity (its own date, or a suggested project date it borrows), the project header of a project with no site activity, or a Sales enquiry with no project yet. */
export type EntrySource = "activity" | "project_header" | "sales";
export interface TimelineEntry {
  key: string; kind: TimelineKind; date: string; until: string | null; title: string; who: string; href: string; tentative: boolean; source: EntrySource;
  /** The words for where this stands ("Tentative Installation on 11 Nov", "Scheduled installation date passed · start unconfirmed", "Sales date · tentative"). Never "started" without a recorded start. */
  statusLabel: string; started: boolean; passed: boolean;
  /** Entries of one project run (or one enquiry) share a group, so they are listed under one row. */
  groupKey: string; groupTitle: string; groupHref: string; activityId?: string; activityTitle?: string; runLabel?: string | null; venue?: string | null; when?: string;
}
export const TIMELINE_DAYS = 30;
/** The most dated site activities one Operations page reads (one bounded read, shared by Next on site, the timeline and team pressure). */
export const SITE_ACTIVITY_LIMIT = 300;
export const NEXT_ON_SITE_DAYS = 14;
const ACTIVITY_KIND: Record<ActivityKind, TimelineKind> = { setup: "installation", show: "show", dismantling: "dismantling", mockup: "activity", other: "activity" };

/** The dated site activities of the live projects as entries, each once, worded by the shared site-state helper. Activities with no date are not entries (they have nothing to place). */
function activityEntries(o: Overview, acts: readonly SiteActivityRead[]): TimelineEntry[] {
  const pm = new Map(o.projects.map((p) => [p.id, p]));
  const out: TimelineEntry[] = [];
  for (const a of acts) {
    const first = a.phase?.first_day;
    if (!first) continue;
    const last = a.phase.last_day && a.phase.last_day !== first ? a.phase.last_day : null;
    const text = describeSitePhase(a.phase);
    const p = pm.get(a.project_id);
    out.push({
      key: `a:${a.id}`, kind: ACTIVITY_KIND[a.kind ?? "other"] ?? "activity", date: first, until: last, title: `${a.reference} ${a.project_name}`, who: a.owner_name ?? p?.pm ?? "Nobody named",
      href: siteHref(a), tentative: a.state === "tentative", source: "activity", statusLabel: text.label, started: text.started, passed: a.phase.phase === "date_passed",
      groupKey: `p:${a.project_id}:${a.run_label ?? ""}`, groupTitle: `${a.reference} ${a.project_name}${a.run_label ? ` · ${a.run_label}` : ""}`, groupHref: `/projects/${a.project_id}/plan?plan=site&mode=list`,
      activityId: a.id, activityTitle: a.title, runLabel: a.run_label, venue: a.effective?.venue ?? p?.venue ?? null, when: activityWhen(a),
    });
  }
  return out;
}

/**
 * Every dated entry Operations shows, each once:
 *   - the dated site activities of live projects (from the one site activity read);
 *   - a project's header installation / show date ONLY for a project that has no dated site activity (a labelled fallback: "from the project header"); a project that has dated activities
 *     never also gets a header row. When the activity read is unavailable (`acts` is null) every project falls back to its header and says so;
 *   - the dates Sales recorded on flagged enquiries that have no project yet, labelled as Sales dates and tentative until the enquiry is won. An enquiry that already has a project is dropped.
 * Date order, `until` set for a range. A passed date is `passed` and never `started`.
 */
function allEntries(o: Overview, upcoming: readonly UpcomingRow[] | null, acts: readonly SiteActivityRead[] | null | undefined, today: string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const fromActivities = acts ? activityEntries(o, acts) : [];
  out.push(...fromActivities);
  const withActivities = new Set(fromActivities.map((e) => e.groupKey.split(":")[1]));
  const showActivityProjects = new Set(fromActivities.filter((e) => e.kind === "show").map((e) => e.groupKey.split(":")[1]));
  for (const p of o.projects) {
    if (isFinished(p.status)) continue;
    const has = withActivities.has(p.id); const hasShow = showActivityProjects.has(p.id);
    const title = `${p.reference} ${p.name}`; const href = `/projects/${p.id}/work`; const gk = `h:${p.id}`;
    const base = { who: p.pm, href, tentative: false, source: "project_header" as const, started: false, groupKey: gk, groupTitle: title, groupHref: href, title, venue: p.venue };
    const inst = day(p.install_start);
    if (inst && !has) {
      const passed = inst < today;
      out.push({ ...base, key: `i:${p.id}`, kind: "installation", date: inst, until: null, passed, statusLabel: passed ? "Scheduled installation date passed · start unconfirmed" : "Installation date (from the project header)" });
    }
    const ev = day(p.event_start);
    // A project with dated activities never also gets a header installation row; its header show date is listed only while no show activity carries it.
    if (ev && !hasShow) out.push({ ...base, key: `s:${p.id}`, kind: "show", date: ev, until: day(p.event_end), passed: false, statusLabel: "Show date (from the project header)" });
  }
  for (const r of upcoming ?? []) {
    if (r.handover?.project_id || r.handover?.status === "accepted") continue;
    const title = `${r.reference} ${r.title}`; const href = `/operations/upcoming?company=${r.company_id}&q=${encodeURIComponent(r.reference)}`; const tentative = r.dates_tentative && !r.won;
    const who = r.handover?.pm ?? (r.planning?.provisional_pm ? `${r.planning.provisional_pm} (provisional)` : r.owner);
    const label = r.won ? "Sales date · enquiry won" : tentative ? "Sales date · tentative" : "Sales date · confirmed by Sales, not won";
    const base = { who, href, tentative, source: "sales" as const, started: false, passed: false, statusLabel: label, groupKey: `e:${r.id}`, groupTitle: title, groupHref: href, title };
    if (r.install_start) out.push({ ...base, key: `i:${r.id}`, kind: "installation", date: day(r.install_start)!, until: null });
    if (r.event_start) out.push({ ...base, key: `s:${r.id}`, kind: "show", date: day(r.event_start)!, until: day(r.event_end) });
    if (r.dismantle_date) out.push({ ...base, key: `d:${r.id}`, kind: "dismantling", date: day(r.dismantle_date)!, until: null });
  }
  const order: TimelineKind[] = ["installation", "show", "dismantling", "activity"];
  return out.sort((a, b) => a.date.localeCompare(b.date) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title));
}

/**
 * The next 30 days in date order (entries whose range touches the window and has not wholly passed). Where site activities are read they ARE the project dates; see `allEntries` for the
 * de-duplication rules. A project has no dismantling date of its own, so dismantling appears for a project only as a dated site activity.
 */
export function timeline(o: Overview, upcoming: readonly UpcomingRow[] | null, today: string, days = TIMELINE_DAYS, acts?: readonly SiteActivityRead[] | null): TimelineEntry[] {
  return allEntries(o, upcoming, acts, today).filter((e) => daysBetween(today, e.date) <= days && daysBetween(today, e.until ?? e.date) >= 0 && !e.passed);
}
/** Activities and project dates whose scheduled date has passed with no recorded start. They need a decision (record the start, or move the date), not a "started" label. */
export function passedEntries(o: Overview, acts: readonly SiteActivityRead[] | null | undefined, today: string): TimelineEntry[] {
  return allEntries(o, null, acts, today).filter((e) => e.passed && e.source !== "sales" && !e.started);
}
/**
 * Next on site: first the activities whose date has passed with no recorded start, then everything dated today or in the next 14 days that is a site activity or a labelled project-header
 * fallback (never an enquiry: those stay in the timeline as Sales dates). The timeline below lists the rest, so no activity appears in both.
 */
export function nextOnSite(o: Overview, acts: readonly SiteActivityRead[] | null | undefined, today: string, days = NEXT_ON_SITE_DAYS): TimelineEntry[] {
  const soon = allEntries(o, null, acts, today).filter((e) => e.source !== "sales" && !e.passed && daysBetween(today, e.date) <= days && daysBetween(today, e.until ?? e.date) >= 0);
  return [...passedEntries(o, acts, today), ...soon];
}
/** Entries in the timeline that Next on site does not already list (the activities after the next 14 days, project-header fallbacks after them, and Sales dates). */
export function laterEntries(o: Overview, upcoming: readonly UpcomingRow[] | null, acts: readonly SiteActivityRead[] | null | undefined, today: string, days = TIMELINE_DAYS): TimelineEntry[] {
  const shown = new Set(nextOnSite(o, acts, today).map((e) => e.key));
  return timeline(o, upcoming, today, days, acts).filter((e) => !shown.has(e.key));
}

export interface TimelineGroup { key: string; title: string; href: string; source: EntrySource; tentative: boolean; entries: TimelineEntry[] }
/** Installation, show and dismantling of one enquiry or one project run under one row, in date order; groups ordered by their first date. */
export function groupEntries(entries: readonly TimelineEntry[]): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();
  for (const e of entries) {
    const g = groups.get(e.groupKey) ?? { key: e.groupKey, title: e.groupTitle, href: e.groupHref, source: e.source, tentative: e.tentative, entries: [] };
    g.entries.push(e); groups.set(e.groupKey, g);
  }
  return [...groups.values()].map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => a.date.localeCompare(b.date)), tentative: g.entries.every((e) => e.tentative) }))
    .sort((a, b) => a.entries[0]!.date.localeCompare(b.entries[0]!.date) || a.title.localeCompare(b.title));
}

export interface WeekBucket { key: string; label: string; from: string | null; to: string | null; projects: OverviewProject[] }
export const CHART_WEEKS = 6;
/** Monday of the week a date falls in. */
export const weekStart = (iso: string) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
/**
 * Upcoming delivery by week: unfinished projects by the week their installation (or show) starts, this week and the five after it, then "Later", "Date passed · start unconfirmed"
 * and "No date recorded". A passed date never says the work started: only an explicit start record on a site activity does. Every bucket carries its projects, so the chart and the list under it are the same records and the counts cannot differ.
 */
export function deliveryByWeek(o: Overview, today: string, weeks = CHART_WEEKS): WeekBucket[] {
  const first = weekStart(today);
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => {
    const from = addDays(first, i * 7);
    return { key: from, label: i === 0 ? "This week" : i === 1 ? "Next week" : `Week of ${from}`, from, to: addDays(from, 6), projects: [] };
  });
  const later: WeekBucket = { key: "later", label: "Later", from: addDays(first, weeks * 7), to: null, projects: [] };
  const passed: WeekBucket = { key: "passed", label: "Date passed · start unconfirmed", from: null, to: addDays(first, -1), projects: [] };
  const none: WeekBucket = { key: "none", label: "No date recorded", from: null, to: null, projects: [] };
  for (const p of o.projects) {
    if (isFinished(p.status)) continue;
    const start = day(p.install_start) ?? day(p.event_start);
    if (!start) { none.projects.push(p); continue; }
    const i = Math.floor(daysBetween(first, start) / 7);
    (i < 0 ? passed : i >= weeks ? later : buckets[i]!).projects.push(p);
  }
  for (const b of [...buckets, later, passed, none]) b.projects.sort((a, c) => (day(a.install_start) ?? day(a.event_start) ?? "9999").localeCompare(day(c.install_start) ?? day(c.event_start) ?? "9999") || a.reference.localeCompare(c.reference));
  return [passed, ...buckets, later, none].filter((b) => b.projects.length > 0 || (b.from !== null && b.to !== null && b.key !== "passed"));
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
