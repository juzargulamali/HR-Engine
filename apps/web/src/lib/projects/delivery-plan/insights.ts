import {
  lineProgress, SUPPLY_ROUTE_LABELS, type DeliveryPlan, type DpItem, type DpLine, type DpMilestone, type SupplyRoute,
} from "./model";

/**
 * What the Project Plan says about itself, worked out from the plan the database returned and nothing else: where a hardware line stands, what holds a line up, the
 * next-step summary, how complete a milestone is, and the rows of the Timeline. No database, no React, no clock (the caller passes today as YYYY-MM-DD), so the same
 * rules draw Breakdown, Timeline, the summary and the milestone panel, and they are tested without a screen.
 */
export type Tone = "quiet" | "blue" | "amber" | "green" | "red";
const OPEN_TASK = new Set(["todo", "in_progress", "ready_for_review"]);
const FINISHED_TASK = new Set(["done", "cancelled"]);

export const isWork = (l: Pick<DpLine, "section">) => l.section !== "hardware";
export const routeOf = (l: Pick<DpLine, "section" | "supply_route">): SupplyRoute | null => (l.section === "hardware" ? (l.supply_route ?? "inventory") : null);

/** Who, when: the linked task is the source once the line is released; before that the plan's own values (a line with no owner or date takes the deliverable's). */
export function lineSchedule(item: Pick<DpItem, "owner_name" | "needed_by">, l: DpLine): { owner: string | null; ownerInherited: boolean; start: string | null; due: string | null; fromTask: boolean } {
  if (isWork(l) && l.task) return { owner: l.task.assignee_name, ownerInherited: false, start: l.task.start_date ?? null, due: l.task.due_date, fromTask: true };
  const owner = l.assignee_name ?? item.owner_name;
  return { owner, ownerInherited: !l.assignee_name && !!item.owner_name, start: l.start_date ?? null, due: l.needed_by ?? item.needed_by, fromTask: false };
}

/** The state of a hardware line in words. A line without a stock match stays visible with a state that says what it needs; nothing else is held up by it. */
export function hardwareState(l: DpLine): { text: string; tone: Tone; needsAction: boolean } | null {
  if (l.section !== "hardware") return null;
  const route = routeOf(l)!;
  if (l.released_at) { const p = lineProgress(l); return { text: p.text, tone: p.tone, needsAction: p.state === "requested" || p.state === "unknown" }; }
  const specMissing = !(l.notes ?? "").trim();
  if (route === "inventory") {
    if (l.inv_item_id) return { text: "Matched to stock: ready to release", tone: "blue", needsAction: false };
    return specMissing ? { text: "Specification pending", tone: "amber", needsAction: true } : { text: "Needs stock match", tone: "amber", needsAction: true };
  }
  const expected = l.detail?.expected_date;
  if (route === "client") return { text: expected ? `Client supplied, expected ${expected}` : "Client supplied: expected date not recorded", tone: expected ? "quiet" : "amber", needsAction: !expected };
  if (specMissing) return { text: "Specification pending", tone: "amber", needsAction: true };
  if (!l.assignee_id || !expected) return { text: `Needs sourcing (${SUPPLY_ROUTE_LABELS[route]}): ${!l.assignee_id ? "no owner" : "no expected date"}`, tone: "amber", needsAction: true };
  return { text: `${SUPPLY_ROUTE_LABELS[route]}: expected ${expected}`, tone: "quiet", needsAction: false };
}

/** One thing that holds a line up, with where to look. `rank` orders the next-step summary: open blockers first, then missing owners, overdue dependencies, hardware to source, drafts to submit. */
export interface Attention { kind: "blocker" | "no_owner" | "late_dependency" | "overdue" | "sourcing" | "draft_ready" | "task_pending" | "unread"; rank: number; text: string; itemId: string; itemKey: string; lineId: string; lineKey: string }

const RANK: Record<Attention["kind"], number> = { blocker: 1, no_owner: 2, late_dependency: 3, overdue: 4, sourcing: 5, draft_ready: 6, task_pending: 7, unread: 8 };
const d = (v: string | null | undefined) => (v ? Date.parse(`${v.slice(0, 10)}T00:00:00Z`) : NaN);

/** A predecessor that is not finished and ends after this line starts (or, with no start, after it is due): the impact of a late storyboard on its first draft. */
export function lateDependency(item: Pick<DpItem, "needed_by" | "owner_name">, l: DpLine): string | null {
  const s = lineSchedule(item, l);
  const edge = s.start ?? s.due;
  if (!edge) return null;
  const deps = l.task ? (l.task.depends_on ?? []).map((x) => ({ title: x.title, status: x.status, due: x.due_date })) : (l.plan_depends_on ?? []).map((x) => ({ title: x.title, status: x.status ?? "todo", due: x.due_date }));
  for (const x of deps) {
    if (FINISHED_TASK.has(x.status) || !x.due) continue;
    if (d(x.due) > d(edge)) return `${x.title.replace(/^[^:]*: /, "")} is due ${x.due}, after ${s.start ? "this starts" : "this is due"} on ${edge}`;
  }
  return null;
}

export function lineAttention(item: DpItem, l: DpLine, today: string): Attention[] {
  const out: Attention[] = [];
  const base = { itemId: item.id, itemKey: item.key, lineId: l.id, lineKey: l.key };
  const push = (kind: Attention["kind"], text: string) => out.push({ kind, rank: RANK[kind], text, ...base });
  const name = `${l.key} ${l.description}`;
  const s = lineSchedule(item, l);
  if (isWork(l)) {
    if (l.released_at && !l.task) push("unread", `${name}: its task could not be read`);
    if (l.task && l.task.blocked && OPEN_TASK.has(l.task.status)) push("blocker", `${name} is blocked: ${l.task.blocked_reason ?? "reason not recorded"}${l.task.unblock_action ? `. Next: ${l.task.unblock_action}` : ""}`);
    if (!l.released_at && !s.owner) push("no_owner", `${name} has no owner`);
    if (l.task && OPEN_TASK.has(l.task.status) && s.due && d(s.due) < d(today)) push("overdue", `${name} was due ${s.due}`);
    const late = lateDependency(item, l);
    if (late) push("late_dependency", `${name}: ${late}`);
    if (l.task_pending) push("task_pending", `${name}: task update pending (${l.task_pending.reason ?? "the task could not take it"})`);
  } else {
    const hs = hardwareState(l);
    if (l.released_at && l.equipment?.missing) push("unread", `${name}: its equipment line could not be read`);
    else if (hs?.needsAction && !l.released_at) push("sourcing", `${name}: ${hs.text}`);
    if (l.released_at && l.equipment?.request_status === "draft") push("draft_ready", `${name} is on a draft equipment request: review it and send it to Warehouse`);
  }
  return out;
}

export function planAttention(plan: DeliveryPlan, today: string): Attention[] {
  return plan.items.flatMap((i) => i.lines.flatMap((l) => lineAttention(i, l, today))).sort((a, b) => a.rank - b.rank || a.lineKey.localeCompare(b.lineKey));
}

/** A short readiness sentence for one activation, from its lines: how many are done, what is held up. */
export function activationReadiness(item: DpItem, today: string): { text: string; tone: Tone; blockers: number; attention: Attention[] } {
  const attention = item.lines.flatMap((l) => lineAttention(item, l, today)).sort((a, b) => a.rank - b.rank);
  const open = item.lines.filter((l) => !(l.task && FINISHED_TASK.has(l.task.status)));
  const done = item.lines.length - open.length;
  const blockers = attention.filter((a) => a.kind === "blocker" || a.kind === "late_dependency" || a.kind === "overdue").length;
  if (item.lines.length === 0) return { text: "No requirements yet", tone: "quiet", blockers: 0, attention };
  const bits = [`${done} of ${item.lines.length} lines done`];
  if (attention.length > 0) bits.push(`${attention.length} need${attention.length === 1 ? "s" : ""} attention`);
  return { text: bits.join(" · "), tone: blockers > 0 ? "red" : attention.length > 0 ? "amber" : done === item.lines.length ? "green" : "blue", blockers, attention };
}

export interface PlanSummary {
  nextSite: { date: string; label: string } | null;
  siteRecorded: boolean;
  attention: Attention[];
  counts: Record<Attention["kind"], number>;
  next: Attention | null;
  /** Lines in the plan, and how many are released: the summary says "nothing to do" only when there is something to have done. */
  lines: number;
  released: number;
  unreleased: number;
  pendingScope: number;
}

/** The next-step summary at the top: the next recorded site date, what needs attention (most urgent first) and the one next action. */
export function planSummary(plan: DeliveryPlan, today: string): PlanSummary {
  const sd = plan.site_dates;
  const dates: { date: string; label: string }[] = [];
  if (sd?.install_start) dates.push({ date: sd.install_start, label: "Installation starts" });
  if (sd?.event_start) dates.push({ date: sd.event_start, label: "Event starts" });
  if (sd?.event_end) dates.push({ date: sd.event_end, label: "Event ends" });
  const upcoming = dates.filter((x) => d(x.date) >= d(today)).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const attention = planAttention(plan, today);
  const counts = { blocker: 0, no_owner: 0, late_dependency: 0, overdue: 0, sourcing: 0, draft_ready: 0, task_pending: 0, unread: 0 } as Record<Attention["kind"], number>;
  for (const a of attention) counts[a.kind] += 1;
  const lines = plan.items.reduce((n, i) => n + i.lines.length, 0);
  const released = plan.items.reduce((n, i) => n + i.lines.filter((l) => l.released_at).length, 0);
  return { nextSite: upcoming, siteRecorded: dates.length > 0, attention, counts, next: attention[0] ?? null, lines, released, unreleased: lines - released, pendingScope: plan.scope?.pending?.length ?? 0 };
}

export const ATTENTION_LABELS: Record<Attention["kind"], string> = {
  blocker: "Open blockers", no_owner: "Missing owners", late_dependency: "Late dependencies", overdue: "Overdue tasks", sourcing: "Hardware to source", draft_ready: "Equipment drafts to send", task_pending: "Task updates pending", unread: "Could not be read",
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface MilestoneProgress {
  total: number; done: number; label: string;
  outstanding: { key: string; title: string; who: string | null; due: string | null; status: string; blocked: boolean; planned: boolean }[];
  /** Every task linked to it is complete. This is READINESS; confirming the milestone is a separate, existing action. */
  ready: boolean;
  confirmed: boolean;
  /** The latest outstanding date is after the milestone's own date. */
  atRisk: string | null;
}

export function milestoneProgress(m: DpMilestone): MilestoneProgress {
  const tasks = m.tasks ?? [], planned = m.planned ?? [];
  const done = tasks.filter((t) => t.status === "done").length;
  const outstanding = [
    ...tasks.filter((t) => t.status !== "done").map((t) => ({ key: t.task_id, title: t.title, who: t.assignee_name, due: t.due_date, status: t.status, blocked: t.blocked, planned: false })),
    ...planned.map((p) => ({ key: p.line_id, title: p.title, who: p.assignee_name, due: p.needed_by, status: "not released", blocked: false, planned: true })),
  ];
  const total = tasks.length + planned.length;
  const latest = outstanding.map((o) => o.due).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const atRisk = m.due_date && latest && d(latest) > d(m.due_date) ? `${latest} is after the milestone date ${m.due_date}` : null;
  return { total, done, label: total === 0 ? "No tasks linked yet" : `${done} of ${total} complete`, outstanding, ready: total > 0 && outstanding.length === 0, confirmed: m.status === "accepted", atRisk };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface TimelineRow {
  key: string; kind: "activation" | "line"; label: string; sub: string; owner: string | null; status: string; tone: Tone;
  /** The dates drawn and written: the linked task's current dates once released, else the plan's effective dates (a requirement with no due date of its own takes the activation's). */
  start: string | null; due: string | null;
  /** How the item is drawn: a range, one day, only a due date, only a start date, or not at all. */
  shape: "range" | "single" | "due" | "start" | "none";
  /** The due date is the activation's, not the requirement's own (said under the dates). */
  inherited: boolean;
  /** Neither a start nor a due date: shown as "No dates" and listed under the chart, never dropped. */
  unscheduled: boolean;
  late: string | null; blocked: boolean; anchor: string; itemKey: string;
}
export interface TimelineScale {
  /** `day`: a labelled column and a gridline for every day (short schedules). `week`: labels once a week, exact dates on every row (long schedules). */
  mode: "day" | "week";
  /** Every day of the visible range, first to last (at least a week, so one date still has context). */
  days: string[];
  /** Header labels: one per day in day mode, one per week in week mode. `index` is the day it sits on. */
  labels: { date: string; index: number }[];
  /** A comfortable width for the drawing area, so labels never collide; the screen scrolls sideways when it is wider than the space. */
  widthPx: number;
}
export interface TimelineModel { rows: TimelineRow[]; range: { start: string; end: string } | null; scale: TimelineScale | null; unscheduled: TimelineRow[] }

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;
/** Up to this many days a schedule starts in Day view (a column for every day); a longer one starts in Week view. The person can switch either way. */
export const DAY_MODE_MAX_DAYS = 31;
/** Day view: every day is at least this wide, so "Mon / 14 / Nov" stays readable. A plan of seven days is 392px, so it fits when there is room and never needs to scroll. */
export const DAY_PX = 56;
/** Week view: about 18px a day, which still leaves a weekly label (about 125px) clear of the next. */
export const WEEK_PX_PER_DAY = 18;
export type TimelineMode = "day" | "week";
/** The mode a schedule of this many days opens in. */
export const autoMode = (dayCount: number): TimelineMode => (dayCount <= DAY_MODE_MAX_DAYS ? "day" : "week");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const part = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });

/**
 * The dates of one row in words, exact, for reading without hovering: "14–16 Nov", "17 Nov" (one day), "28 Nov – 2 Dec" (across a month), "Due 16 Nov" (only a due date),
 * "Starts 14 Nov" (only a start) and "No dates". The year appears only when it is not the current year, or when the dates cross into another.
 */
export function formatSpan(start: string | null, due: string | null, today: string): string {
  const cur = Number(today.slice(0, 4));
  const one = (iso: string, withYear: boolean) => { const x = part(iso); return `${x.d} ${MONTHS[x.m - 1]}${withYear ? ` ${x.y}` : ""}`; };
  if (!start && !due) return "No dates";
  if (start && !due) return `Starts ${one(start, part(start).y !== cur)}`;
  if (!start && due) return `Due ${one(due, part(due).y !== cur)}`;
  const a = part(start!), b = part(due!);
  if (start === due) return one(start!, a.y !== cur);
  const crossYear = a.y !== b.y;
  if (!crossYear && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]}${a.y !== cur ? ` ${a.y}` : ""}`;
  if (!crossYear) return `${one(start!, false)} – ${one(due!, a.y !== cur)}`;
  return `${one(start!, true)} – ${one(due!, true)}`;
}

/** `mode` overrides the automatic choice (the Day / Week switch); without it the length of the schedule decides. */
export function timelineScale(range: { start: string; end: string }, mode?: TimelineMode): TimelineScale {
  const s = d(range.start), e = Math.max(d(range.end), s + 6 * DAY);
  const days: string[] = [];
  for (let t = s; t <= e; t += DAY) days.push(dayStr(t));
  const m = mode ?? autoMode(days.length);
  const day = m === "day";
  const labels: TimelineScale["labels"] = day ? days.map((date, index) => ({ date, index })) : days.flatMap((date, index) => (index % 7 === 0 ? [{ date, index }] : []));
  return { mode: m, days, labels, widthPx: day ? days.length * DAY_PX : Math.max(days.length * WEEK_PX_PER_DAY, 360) };
}

/**
 * Where to scroll so today's column sits in the middle of the visible chart. All widths in pixels: `chartW` the drawing area, `labelW` the pinned name column, `viewportW` the
 * scrolling box and `scrollW` its whole content. Clamped to what can scroll. Null when today is not in the range.
 */
export function todayScrollTarget(scale: TimelineScale, today: string, m: { chartW: number; labelW: number; viewportW: number; scrollW: number }): number | null {
  const i = dayIndex(scale, today);
  if (i < 0) return null;
  const centre = ((i + 0.5) / scale.days.length) * m.chartW;
  const target = centre - (m.viewportW - m.labelW) / 2;
  return Math.round(Math.min(Math.max(target, 0), Math.max(m.scrollW - m.viewportW, 0)));
}

/** Where a bar sits, aligned to the day columns: left and width in percent of the drawing area. One day is exactly one column; only a due (or only a start) date is one column too. */
export function barPosition(scale: TimelineScale, start: string | null, due: string | null): { left: number; width: number } | null {
  const a = start ?? due, b = due ?? start;
  if (!a || !b) return null;
  const n = scale.days.length;
  const idx = (iso: string) => Math.min(Math.max(scale.days.indexOf(iso) >= 0 ? scale.days.indexOf(iso) : Math.round((d(iso) - d(scale.days[0]!)) / DAY), 0), n - 1);
  const from = idx(a), to = Math.max(idx(b), from);
  return { left: (from / n) * 100, width: ((to - from + 1) / n) * 100 };
}
export const dayIndex = (scale: TimelineScale, iso: string): number => scale.days.indexOf(iso);

/** Rows for the Timeline from the SAME records as Breakdown: activations with their lines under them, dates from the task once released, the plan's effective dates before. */
export function timelineModel(plan: DeliveryPlan, today: string): TimelineModel {
  const rows: TimelineRow[] = [];
  for (const it of plan.items) {
    const lineRows: TimelineRow[] = it.lines.map((l) => {
      const s = lineSchedule(it, l);
      const prog = lineProgress(l);
      const hs = hardwareState(l);
      const att = lineAttention(it, l, today);
      const inherited = !s.fromTask && !l.needed_by && !!s.due;
      const shape: TimelineRow["shape"] = s.start && s.due ? (s.start === s.due ? "single" : "range") : s.due ? "due" : s.start ? "start" : "none";
      return {
        key: l.id, kind: "line", label: l.description, sub: `${l.key}${s.owner ? ` · ${s.owner}` : " · no owner"}`, owner: s.owner,
        status: hs ? hs.text : prog.text, tone: hs ? hs.tone : prog.tone, start: s.start, due: s.due, shape, inherited, unscheduled: shape === "none",
        late: lateDependency(it, l), blocked: att.some((a) => a.kind === "blocker"), anchor: `dp-${l.key}`, itemKey: it.key,
      };
    });
    const dates = [...lineRows.flatMap((r) => [r.start, r.due]), it.needed_by].filter((x): x is string => !!x).sort();
    const r = readinessOf(it, today);
    const start = dates[0] ?? null, due = dates.at(-1) ?? null;
    rows.push({
      key: it.id, kind: "activation", label: it.title, sub: `${it.key}${it.qty ? ` · × ${it.qty}` : ""}${it.zone ? ` · ${it.zone}` : ""}`, owner: it.owner_name, status: r.text, tone: r.tone,
      start, due, shape: !start ? "none" : start === due ? "single" : "range", inherited: false, unscheduled: dates.length === 0, late: null, blocked: r.blockers > 0, anchor: `dp-${it.key}`, itemKey: it.key,
    });
    rows.push(...lineRows);
  }
  const all = rows.flatMap((r) => [r.start, r.due]).filter((x): x is string => !!x).sort();
  const range = all.length === 0 ? null : { start: all[0]!, end: all.at(-1)! };
  const unscheduled = rows.filter((r) => r.kind === "line" && r.unscheduled);
  return { rows, range, scale: range ? timelineScale(range) : null, unscheduled };
}
const readinessOf = (it: DpItem, today: string) => activationReadiness(it, today);

/** The structured details of a line as one short phrase for the row ("Animation × 4 · MP4 · 1080x1920 · Portrait", "1 app · Android tablet · 6 devices"). Empty when nothing is recorded. */
export function detailText(l: Pick<DpLine, "section" | "detail">): string {
  const x = l.detail ?? {};
  const n = (v: number | undefined, one: string, many: string) => (v ? `${v} ${v === 1 ? one : many}` : null);
  const parts: (string | null | undefined)[] =
    l.section === "content" ? [x.deliverable_type ? `${x.deliverable_type}${x.count ? ` × ${x.count}` : ""}` : n(x.count, "item", "items"), x.format, x.resolution, x.orientation]
    : l.section === "apps" || l.section === "programming" ? [x.purpose, n(x.app_count, "app", "apps"), x.platform, n(x.device_count, "device", "devices")]
    : l.section === "hardware" ? [x.source ? `Supplier: ${x.source}` : null, x.expected_date ? `expected ${x.expected_date}` : null]
    : [x.kind];
  return parts.filter(Boolean).join(" · ");
}
