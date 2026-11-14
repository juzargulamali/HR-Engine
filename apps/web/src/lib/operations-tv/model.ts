import { describeSitePhase, kindShort } from "@/lib/projects/site-state";
import { CREW_ROLE_LABELS } from "@/lib/projects/phase2/model";
import type { TvActivity, TvBoard, TvHandover, TvProject, TvReadiness, TvShipment } from "./types";

/**
 * Pure rules for the office board (Phase 3): every sentence on the screen is built here from the allowlisted board JSON, so it is tested without a browser.
 * The board never says more than the facts say: a passed date is "Start unconfirmed", never "Started"; unknown crew, call time or readiness says what is missing.
 */
export const REFRESH_MS = 60_000;
export const ROTATE_MS = 25_000;
/** A board older than this (no successful read for two and a half refresh cycles) is shown as stale even if the browser never reported a failure. */
export const STALE_AFTER_MS = 150_000;
export const DEFAULT_OFFICE_TZ = "Asia/Dubai";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ------------------------------------------------------------------------------------------------ time in a zone
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function parts(iso: string, tz: string): Record<string, string> | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  let f = dtfCache.get(tz);
  if (!f) {
    try { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    catch { f = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
    dtfCache.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(t))) out[p.type] = p.value;
  return out;
}
/** The calendar day (YYYY-MM-DD) of an instant in a zone. */
export function dayInZone(iso: string, tz: string): string { const p = parts(iso, tz); return p ? `${p.year}-${p.month}-${p.day}` : iso.slice(0, 10); }
export function clockInZone(iso: string, tz: string, seconds = false): string { const p = parts(iso, tz); return p ? `${p.hour}:${p.minute}${seconds ? `:${p.second}` : ""}` : ""; }
/** "Mon 17 Nov" for a plain date. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
/** "GMT+4": the zone, said only where it differs from the office's. */
export function zoneLabel(tz: string, at: string): string {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? tz; } catch { return tz; }
}
/** A string that sorts in time order across instants and plain dates, in office time. */
const sortKeyOf = (instant: string | null, date: string | null, tz: string): string => (instant ? `${dayInZone(instant, tz)}T${clockInZone(instant, tz)}` : date ? `${date}T00:00` : "9999-12-31T00:00");

export interface TvWhen { day: string; time: string | null; zone: string | null; text: string }
/** What and when, in the order the room reads it: the day, the time window (or that none is set), and the zone only if it differs from the office's. */
export function whenOf(a: Pick<TvActivity, "start_date" | "end_date" | "starts_at" | "ends_at" | "tz" | "phase">, officeTz: string): TvWhen {
  const siteTz = a.tz || officeTz;
  const zone = a.starts_at && siteTz !== officeTz ? zoneLabel(siteTz, a.starts_at) : null;
  if (a.starts_at) {
    const d1 = dayInZone(a.starts_at, siteTz);
    const d2 = a.ends_at ? dayInZone(a.ends_at, siteTz) : d1;
    const t1 = clockInZone(a.starts_at, siteTz); const t2 = a.ends_at ? clockInZone(a.ends_at, siteTz) : null;
    const day = d1 === d2 ? dayLabel(d1) : `${dayLabel(d1)} to ${dayLabel(d2)}`;
    const time = d1 === d2 ? (t2 ? `${t1}–${t2}` : t1) : `${t1} → ${t2 ?? "…"}`;
    return { day, time, zone, text: `${day} · ${time}${zone ? ` ${zone}` : ""}` };
  }
  const first = a.start_date ?? a.phase.first_day; const last = a.end_date ?? a.phase.last_day ?? first;
  if (!first) return { day: "No date", time: null, zone: null, text: "No date" };
  const day = !last || last === first ? dayLabel(first) : `${dayLabel(first)} to ${dayLabel(last)}`;
  return { day, time: null, zone: null, text: `${day} · time not set` };
}

// ------------------------------------------------------------------------------------------------ wording
export interface TvPhaseText { label: string; detail: string | null; tone: "green" | "amber" | "blue" | "quiet"; started: boolean }
/** Phase 2's wording, exactly: Started only from an explicit record; a passed date is "start unconfirmed"; a project-date fallback says so. */
export function phaseText(a: TvActivity, today: string): TvPhaseText {
  const t = describeSitePhase({ ...a.phase, kind: a.kind, state: a.state, today });
  return { label: t.label, detail: t.detail, tone: t.tone, started: t.started };
}
export const activityName = (a: Pick<TvActivity, "kind" | "title" | "run_label">): string => `${a.run_label ? `${a.run_label} · ` : ""}${a.title || kindShort(a.kind)}`;
export const crewRoleLabel = (r: string): string => (CREW_ROLE_LABELS as Record<string, string>)[r] ?? r;

export type TvBlockerKey = "crew_missing" | "shipment_after_setup" | "start_unconfirmed" | "call_pending" | "equipment_short" | "return_overdue" | "not_ready" | "readiness_unrecorded";
export interface TvBlocker { key: TvBlockerKey; label: string; detail: string; action: string; rank: number; attention: boolean }
const B = (key: TvBlockerKey, rank: number, label: string, detail: string, action: string, attention = true): TvBlocker => ({ key, rank, label, detail, action, attention });

const lowerRef = (s: string | null | undefined) => (s ?? "").toLowerCase();
const READY_AREAS: [keyof TvReadiness, string][] = [["hardware", "Equipment"], ["content", "Content"], ["app", "App"]];
export const readyWord = (v: string | null | undefined): string => ({ ready: "Ready", not_ready: "Not ready", not_applicable: "Not applicable", not_recorded: "Not recorded" } as Record<string, string>)[v ?? "not_recorded"] ?? "Not recorded";

/** When does an arrival fall after the start of the setup it should serve? Compared as instants when both are known, else as days. */
export function arrivesAfterSetup(s: Pick<TvShipment, "arrives_at" | "tz">, a: Pick<TvActivity, "starts_at" | "start_date" | "tz">, officeTz: string): boolean {
  if (!s.arrives_at) return false;
  if (s.arrives_at && a.starts_at) return Date.parse(s.arrives_at) > Date.parse(a.starts_at);
  const day = a.start_date; if (!day) return false;
  return dayInZone(s.arrives_at, s.tz || a.tz || officeTz) > day;
}
/** Shipments that serve an activity: linked to it, or (not linked to any run) bound for the project's earliest setup. */
export function shipmentsFor(a: TvActivity, board: TvBoard): TvShipment[] {
  const own = board.shipments.filter((s) => s.activity_id === a.id);
  if (a.kind !== "setup") return own;
  const earliest = board.activities.filter((x) => x.project_id === a.project_id && x.kind === "setup" && x.phase.phase !== "no_date").sort((x, y) => sortKeyOf(x.starts_at, x.start_date ?? x.phase.first_day, board.office_tz).localeCompare(sortKeyOf(y.starts_at, y.start_date ?? y.phase.first_day, board.office_tz)))[0];
  return earliest?.id === a.id ? [...own, ...board.shipments.filter((s) => s.project_id === a.project_id && !s.activity_id)] : own;
}

/** Everything that could hold a run up, in the order to act on it: crew, the shipment, the unconfirmed start, call time, equipment, readiness. */
export function blockersFor(a: TvActivity, board: TvBoard): TvBlocker[] {
  const out: TvBlocker[] = []; const tz = board.office_tz;
  const crewWork = a.kind !== "mockup" && a.phase.phase !== "no_date";
  if (crewWork && a.crew_total === 0) out.push(B("crew_missing", 1, "Crew missing", "Nobody is assigned to this run yet", "Assign crew"));
  const ships = shipmentsFor(a, board);
  for (const s of ships) {
    if (a.kind === "setup" && arrivesAfterSetup(s, a, tz)) {
      const arr = `${dayLabel(dayInZone(s.arrives_at!, s.tz || tz))} ${clockInZone(s.arrives_at!, s.tz || tz)}`;
      out.push(B("shipment_after_setup", 2, "Shipment arrival after setup", `${s.label || "Shipment"} arrives ${arr}; setup starts ${whenOf(a, tz).text}`, "Move the arrival or the setup"));
    }
  }
  if (a.phase.phase === "date_passed") out.push(B("start_unconfirmed", 3, "Start unconfirmed", "The scheduled date has passed and nobody has recorded that it started", "Record the start or move the date"));
  if (crewWork && a.crew_total > 0 && a.call_missing > 0) out.push(B("call_pending", 4, "Call time pending", `${a.call_missing} of ${a.crew_total} crew without a call time`, "Set call times"));
  for (const s of ships) {
    const r = s.request;
    if (r && (r.state === "short" || r.state === "partially_ready" || (r.units_short ?? 0) > 0)) out.push(B("equipment_short", 5, "Equipment short", `${r.code}: ${r.units_short ? `${r.units_short} unit${r.units_short === 1 ? "" : "s"} short` : lowerRef(r.state).replace(/_/g, " ")}`, "Resolve the Inventory shortage"));
    if (r && r.return_overdue) out.push(B("return_overdue", 5, "Equipment return overdue", `${r.code} was due back ${r.expected_return_at ? dayLabel(dayInZone(r.expected_return_at, tz)) : "earlier"}`, "Chase the return"));
  }
  if ((a.kind === "setup" || a.kind === "show") && a.phase.phase !== "no_date" && a.phase.phase !== "started") {
    const rd = a.readiness;
    const notReady = rd ? READY_AREAS.filter(([k]) => rd[k] === "not_ready").map(([, l]) => l) : [];
    if (notReady.length) out.push(B("not_ready", 6, "Not ready", `${notReady.join(", ")} not ready for this run`, "Close the readiness gap"));
    else if (!rd || READY_AREAS.every(([k]) => !rd[k] || rd[k] === "not_recorded")) out.push(B("readiness_unrecorded", 7, "Readiness not recorded", "Nobody has recorded equipment, content or app readiness for this run", "Record readiness", false));
  }
  return out.sort((x, y) => x.rank - y.rank);
}

// ------------------------------------------------------------------------------------------------ the rail (what + when, where + who, blocker)
export interface TvRailItem {
  id: string; kind: "activity" | "shipment"; activityId: string | null; projectId: string; sortKey: string;
  projectRef: string; projectName: string; title: string; when: TvWhen; phase: TvPhaseText | null; badge: "next" | "attention" | "quiet";
  where: string | null; whereNote: string | null; who: string; crewNames: string[]; lead: string | null; blocker: TvBlocker | null; blockerCount: number;
}
export const crewSummary = (a: Pick<TvActivity, "crew" | "crew_total" | "lead">): { text: string; names: string[]; lead: string | null } => {
  const names = a.crew.map((c) => c.name);
  const lead = a.lead?.name ?? null;
  if (a.crew_total === 0) return { text: lead ? `Lead ${lead} · crew not assigned` : "Crew not assigned", names, lead };
  const shown = names.slice(0, 4);
  const more = a.crew_total - shown.length;
  return { text: `${a.crew_total} going: ${shown.join(", ")}${more > 0 ? ` +${more} more` : ""}`, names, lead };
};
export const venueOf = (a: Pick<TvActivity, "venue" | "venue_source">): { text: string | null; note: string | null } =>
  !a.venue ? { text: null, note: "Venue not set" } : { text: a.venue, note: a.venue_source === "project" ? "from the project" : null };

const shipWhen = (iso: string, tz: string, officeTz: string): TvWhen => {
  const day = dayLabel(dayInZone(iso, tz)); const time = clockInZone(iso, tz); const zone = tz !== officeTz ? zoneLabel(tz, iso) : null;
  return { day, time, zone, text: `${day} · ${time}${zone ? ` ${zone}` : ""}` };
};
const SHIP_MOVES: { field: "departs_at" | "arrives_at" | "returns_at"; verb: string }[] = [{ field: "departs_at", verb: "leaves" }, { field: "arrives_at", verb: "arrives" }, { field: "returns_at", verb: "returns" }];

/** The schedule rail: site activities and shipment movements in date order. Passed-date and started runs stay (attention first reads from the badge); the first upcoming item is "Next". */
export function buildRail(board: TvBoard, limit = 14): { items: TvRailItem[]; hidden: number } {
  const tz = board.office_tz; const today = dayInZone(board.generated_at, tz);
  const items: TvRailItem[] = [];
  for (const a of board.activities) {
    if (a.phase.phase === "no_date") continue;
    const bl = blockersFor(a, board); const when = whenOf(a, tz); const v = venueOf(a); const cs = crewSummary(a);
    items.push({
      id: a.id, kind: "activity", activityId: a.id, projectId: a.project_id, sortKey: sortKeyOf(a.starts_at, a.start_date ?? a.phase.first_day, tz), projectRef: a.project_ref, projectName: a.project_name,
      title: activityName(a), when, phase: phaseText(a, today), badge: "quiet", where: v.text, whereNote: v.note, who: cs.text, crewNames: cs.names, lead: cs.lead, blocker: bl[0] ?? null, blockerCount: bl.length,
    });
  }
  for (const s of board.shipments) {
    const stz = s.tz || tz; const linked = s.activity_id ? board.activities.find((x) => x.id === s.activity_id) : null;
    for (const m of SHIP_MOVES) {
      const at = s[m.field]; if (!at) continue;
      if (dayInZone(at, stz) < today) continue;
      const bl = m.field === "arrives_at" ? shipmentArrivalBlockers(s, board) : [];
      items.push({
        id: `${s.id}:${m.field}`, kind: "shipment", activityId: s.activity_id, projectId: s.project_id, sortKey: sortKeyOf(at, null, tz), projectRef: s.project_ref, projectName: s.project_name,
        title: `Shipment ${m.verb}${s.label ? ` · ${s.label}` : ""}${linked ? ` (for ${activityName(linked)})` : s.run_label ? ` (for ${s.run_label})` : ""}`,
        when: shipWhen(at, stz, tz), phase: null, badge: "quiet", where: null, whereNote: s.request ? `Inventory ${s.request.code}: ${s.request.state.replace(/_/g, " ")}` : (s.state === "tentative" ? "Tentative" : "Confirmed"), who: "", crewNames: [], lead: null, blocker: bl[0] ?? null, blockerCount: bl.length,
      });
    }
  }
  items.sort((x, y) => x.sortKey.localeCompare(y.sortKey) || x.id.localeCompare(y.id));
  let nextMarked = false;
  for (const it of items) {
    if (it.blocker?.attention) it.badge = "attention";
    if (!nextMarked && it.kind === "activity" && it.sortKey.slice(0, 10) >= today) { if (it.badge !== "attention") it.badge = "next"; nextMarked = true; }
  }
  const shown = items.slice(0, limit);
  return { items: shown, hidden: items.length - shown.length };
}
function shipmentArrivalBlockers(s: TvShipment, board: TvBoard): TvBlocker[] {
  const tz = board.office_tz;
  const serves = s.activity_id ? board.activities.find((x) => x.id === s.activity_id) : board.activities.filter((x) => x.project_id === s.project_id && x.kind === "setup" && x.phase.phase !== "no_date").sort((x, y) => sortKeyOf(x.starts_at, x.start_date, tz).localeCompare(sortKeyOf(y.starts_at, y.start_date, tz)))[0];
  if (!serves || serves.kind !== "setup" || !arrivesAfterSetup(s, serves, tz)) return [];
  return [B("shipment_after_setup", 2, "Shipment arrival after setup", `Arrives after ${activityName(serves)} starts (${whenOf(serves, tz).text})`, "Move the arrival or the setup")];
}

// ------------------------------------------------------------------------------------------------ project rows
export interface TvRun { id: string; name: string; when: TvWhen; phase: TvPhaseText; where: string | null; whereNote: string | null; who: string; blocker: TvBlocker | null }
export interface TvProjectRow {
  project: TvProject; runs: TvRun[]; moreRuns: number; noSiteWork: boolean; statement: string; blocker: TvBlocker | null; blockerRunId: string | null;
  crewText: string; activations: string[]; equipmentText: string | null; readinessText: string; nextKey: string;
}
/** A project's equipment, in Inventory's words, not a summary of our own. */
export function equipmentText(p: TvProject): string | null {
  const e = p.equipment; if (!e || !e.requests) return null;
  return `${e.requests} request${e.requests === 1 ? "" : "s"}${e.worst_state ? ` · ${e.worst_state.replace(/_/g, " ")}` : ""}`;
}
/** Project-wide readiness, labelled as such (a run's own readiness is on the run). */
export function projectReadinessText(r: TvReadiness | null): string {
  if (!r) return "Project-wide readiness not recorded";
  return `Project-wide: ${READY_AREAS.map(([k, l]) => `${l} ${readyWord(r[k] as string | null).toLowerCase()}`).join(" · ")}`;
}
/** The TV page shows the next three runs of a project (room is fixed and rows must stay a stable height); laptops, tablets and phones scroll, so they show every run. */
export const TV_RUNS_PER_PROJECT = 3;
export const ALL_RUNS = 12;
export function buildProjectRows(board: TvBoard, maxRuns: number = TV_RUNS_PER_PROJECT): TvProjectRow[] {
  const tz = board.office_tz; const today = dayInZone(board.generated_at, tz);
  const rows = board.projects.map((p): TvProjectRow => {
    const dated = board.activities.filter((a) => a.project_id === p.id && a.phase.phase !== "no_date").sort((x, y) => sortKeyOf(x.starts_at, x.start_date ?? x.phase.first_day, tz).localeCompare(sortKeyOf(y.starts_at, y.start_date ?? y.phase.first_day, tz)));
    const runs = dated.slice(0, maxRuns).map((a): TvRun => { const v = venueOf(a); return { id: a.id, name: activityName(a), when: whenOf(a, tz), phase: phaseText(a, today), where: v.text, whereNote: v.note, who: crewSummary(a).text, blocker: blockersFor(a, board)[0] ?? null }; });
    let blocker: TvBlocker | null = null; let blockerRunId: string | null = null;
    for (const a of dated) { const b = blockersFor(a, board)[0]; if (b) { blocker = b; blockerRunId = a.id; break; } }
    const next = dated.find((a) => a.phase.phase !== "started") ?? dated[0];
    const crew = next ? crewSummary(next).text : "";
    return {
      project: p, runs, moreRuns: Math.max(0, dated.length - runs.length), noSiteWork: dated.length === 0, statement: dated.length === 0 ? "No scheduled site work" : "",
      blocker, blockerRunId, crewText: crew, activations: p.activations.map((x) => x.title), equipmentText: equipmentText(p), readinessText: projectReadinessText(p.project_readiness),
      nextKey: next ? sortKeyOf(next.starts_at, next.start_date ?? next.phase.first_day, tz) : "9999-12-31T00:00",
    };
  });
  return rows.sort((x, y) => x.nextKey.localeCompare(y.nextKey) || x.project.name.localeCompare(y.project.name));
}

// ------------------------------------------------------------------------------------------------ handovers
export const HANDOVER_STATUS: Record<string, string> = { submitted: "Awaiting acceptance", pm_assigned: "PM assigned", clarification_requested: "Clarification requested" };
export interface TvHandoverRow { id: string; title: string; reference: string; status: string; pm: string; location: string | null; install: string | null }
export const handoverRows = (board: TvBoard): TvHandoverRow[] => board.handovers.map((h: TvHandover) => ({
  id: h.id, title: h.title, reference: h.reference, status: HANDOVER_STATUS[h.status] ?? h.status.replace(/_/g, " "), pm: h.pm_name ? `PM ${h.pm_name}` : "PM not named yet", location: h.location,
  install: h.install_start ? dayLabel(h.install_start.slice(0, 10)) : null,
}));

// ------------------------------------------------------------------------------------------------ pages
export function paginate<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size)); const pages: T[][] = [];
  for (let i = 0; i < items.length; i += n) pages.push(items.slice(i, i + n));
  return pages;
}
/** Rows per page by screen width: TV 1920 shows what the room can read; 4K uses larger type, not more rows. */
export const rowsPerPage = (width: number): number => (width >= 1536 ? 5 : 8);
export const clampPage = (page: number, count: number): number => (count <= 0 ? 0 : Math.min(Math.max(0, Math.floor(page)), count - 1));
export const nextPage = (page: number, count: number): number => (count <= 1 ? 0 : (page + 1) % count);

// ------------------------------------------------------------------------------------------------ freshness
export const boardAgeMs = (board: Pick<TvBoard, "generated_at">, now: number): number => Math.max(0, now - Date.parse(board.generated_at));
/** "Last updated 14:32:05" in office time, with a date if it is not today. */
export function lastUpdatedText(iso: string, officeTz: string, now: number): string {
  const sameDay = dayInZone(iso, officeTz) === dayInZone(new Date(now).toISOString(), officeTz);
  return `${sameDay ? "" : `${dayLabel(dayInZone(iso, officeTz))} `}${clockInZone(iso, officeTz, true)}`;
}
export const isEmptyBoard = (b: TvBoard): boolean => b.activities.every((a) => a.phase.phase === "no_date") && b.shipments.length === 0;
