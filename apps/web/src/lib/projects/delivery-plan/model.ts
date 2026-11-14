/**
 * The Delivery Plan of one project, as the database function `proj_dp_plan` returns it, plus the pure rules the screens and the Excel import share. No database, no React.
 * One row is a deliverable in a zone; under it are breakdown lines in the sections that apply. Progress is never stored in the plan: it is read from the task or the
 * equipment line a released line is linked to. Permissions are the database's; `canEditItem` / `canEditSection` only decide which controls to draw.
 */
/** Every section the database accepts. The first five are what a plan offers today; the last three exist only so plans made before Release 1 keep their lines. */
export const DP_SECTIONS = ["hardware", "content", "apps", "engineering", "site", "programming", "installation", "testing"] as const;
export type DpSection = (typeof DP_SECTIONS)[number];
/** The sections a person can choose when adding a line or delegating. */
export const DP_CURRENT_SECTIONS = ["hardware", "content", "apps", "engineering", "site"] as const satisfies readonly DpSection[];
export const DP_SECTION_LABELS: Record<DpSection, string> = {
  hardware: "Hardware", content: "Content", apps: "Apps", engineering: "Engineering & integration", site: "Site work",
  programming: "Programming (earlier plan)", installation: "Installation (earlier plan)", testing: "Testing (earlier plan)",
};
/** The short names used in the workbook (and accepted back, in any case). */
export const DP_SECTION_SHEET_NAMES: Record<DpSection, string> = {
  hardware: "Hardware", content: "Content", apps: "Apps", engineering: "Engineering", site: "Site work", programming: "Programming", installation: "Installation", testing: "Testing",
};
/** A person delegated an earlier section keeps editing the matching current one (programming -> apps; installation and testing -> site work). Same rule as the database. */
export const sectionFamily = (s: DpSection): DpSection => (s === "programming" ? "apps" : s === "installation" || s === "testing" ? "site" : s);

export type SupplyRoute = "inventory" | "buy" | "rent" | "client";
export const SUPPLY_ROUTES: readonly SupplyRoute[] = ["inventory", "buy", "rent", "client"];
export const SUPPLY_ROUTE_LABELS: Record<SupplyRoute, string> = { inventory: "Inventory", buy: "Buy", rent: "Rent", client: "Client supplied" };

/** The small structured part of a line. Which keys exist depends on the section (the database refuses any other). */
export interface DpDetail {
  source?: string; expected_date?: string;
  deliverable_type?: string; count?: number; format?: string; resolution?: string; orientation?: string;
  purpose?: string; platform?: string; app_count?: number; device_count?: number;
  kind?: string;
}

export interface DpTaskDep { task_id: string; title: string; status: string; due_date: string | null; line_key?: string | null }
export interface DpPlanDep { line_id: string; line_key: string; title: string; task_id: string | null; status: string | null; due_date: string | null }
export interface DpTask {
  id: string; title: string; status: string; due_date: string | null; blocked: boolean; assignee_name: string;
  start_date?: string | null; blocked_reason?: string | null; unblock_action?: string | null; milestone_id?: string | null; assignee_id?: string | null; depends_on?: DpTaskDep[];
}
export interface DpEquipment { request_id?: string; request_code?: string; request_status?: string; line_status?: string; qty?: number; reserved?: number; dispatched?: number; returned?: number; missing?: boolean }
export interface DpTaskPending { fields: { assignee_id?: string; due_date?: string; start_date?: string; milestone_id?: string }; reason?: string | null; at?: string }
export interface DpLine {
  id: string; key: string; section: DpSection; description: string; qty: number | null; inv_item_id: string | null; /** The chosen stock item's name (null when none is chosen or the name could not be read). */ inv_item_name?: string | null; assignee_id: string | null; assignee_name: string | null;
  needed_by: string | null; notes: string | null; released_at: string | null; version: number; task: DpTask | null; equipment: DpEquipment | null;
  start_date?: string | null; supply_route?: SupplyRoute | null; detail?: DpDetail; milestone_id?: string | null; task_pending?: DpTaskPending | null; plan_depends_on?: DpPlanDep[];
}
export interface DpItem {
  id: string; key: string; zone: string; title: string; specs: string | null; owner_id: string | null; owner_name: string | null; needed_by: string | null; image_file_id: string | null;
  released_at: string | null; version: number; sort_order: number; lines: DpLine[]; qty?: number | null;
}
export interface DpCorrection {
  id: string; target_type: "deliverable" | "line" | "task" | "scope"; target_id: string | null; target_label: string; body: string; raised_by: string; raised_by_name: string; raised_at: string;
  routed_to: string | null; routed_to_name: string | null; status: "open" | "accepted" | "declined"; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
}
export interface DpChange {
  id: string; item_id: string | null; line_id: string | null; changes: Record<string, { from: unknown; to: unknown }>; reason: string | null; source: "screen" | "excel"; proposed_by: string; proposed_by_name: string;
  proposed_at: string; status: "proposed" | "approved" | "rejected" | "withdrawn"; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
}
export interface DpMilestoneTask { task_id: string; title: string; status: string; due_date: string | null; blocked: boolean; assignee_name: string; line_key?: string | null; item_key?: string | null }
export interface DpMilestonePlanned { line_id: string; line_key: string; title: string; item_key: string; needed_by: string | null; assignee_name: string | null }
export interface DpMilestone { id: string; title: string; due_date: string | null; status: string; is_required: boolean; tasks: DpMilestoneTask[]; planned: DpMilestonePlanned[] }
export interface DpScope { brief: string | null; technologies: { name?: string; qty?: number | string | null }[]; pending: { name?: string; qty?: number | string | null }[] }
export interface DeliveryPlan {
  rev: number; can_manage: boolean; my_sections: DpSection[]; delegations: { section: DpSection; user_id: string; name: string }[];
  items: DpItem[]; corrections: DpCorrection[]; changes: DpChange[];
  /** Absent on a database that has not applied Release 1: the screens then draw the plan as before. */
  scope?: DpScope; site_dates?: { install_start: string | null; event_start: string | null; event_end: string | null }; milestones?: DpMilestone[];
}

export const canEditSection = (plan: Pick<DeliveryPlan, "can_manage" | "my_sections">, section: DpSection): boolean =>
  plan.can_manage || plan.my_sections.some((s) => sectionFamily(s) === sectionFamily(section));

/** Where a released line stands, in words, from the record it is linked to. `unknown` = the linked record could not be read (never shown as "not started"). */
export type LineProgress = { state: "draft" | "todo" | "in_progress" | "review" | "done" | "closed" | "blocked" | "requested" | "with_warehouse" | "reserved" | "dispatched" | "returned" | "unknown"; text: string; tone: "quiet" | "blue" | "amber" | "green" | "red" };

const fmt = (n: number | undefined) => (n === undefined ? "0" : Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

export function lineProgress(l: Pick<DpLine, "released_at" | "task" | "equipment" | "section">): LineProgress {
  if (!l.released_at) return { state: "draft", text: "Draft: not released", tone: "quiet" };
  if (l.section === "hardware") {
    const e = l.equipment;
    if (!e || e.missing) return { state: "unknown", text: "Equipment line could not be read", tone: "red" };
    const qty = e.qty ?? 0, reserved = e.reserved ?? 0, dispatched = e.dispatched ?? 0, returned = e.returned ?? 0;
    if (e.line_status === "cancelled" || e.request_status === "cancelled") return { state: "closed", text: "Equipment line cancelled", tone: "quiet" };
    // Delivered and returned are separate facts: both are stated while anything is still out.
    if (dispatched > 0 && returned >= dispatched) return { state: "returned", text: `Returned ${fmt(returned)} of ${fmt(dispatched)} sent`, tone: "green" };
    if (dispatched > 0) return { state: "dispatched", text: `Sent ${fmt(dispatched)} of ${fmt(qty)}${returned > 0 ? `, ${fmt(returned)} returned, ${fmt(dispatched - returned)} still out` : `, ${fmt(dispatched)} still out`}`, tone: "blue" };
    if (reserved > 0) return { state: "reserved", text: `Reserved ${fmt(reserved)} of ${fmt(qty)}`, tone: "blue" };
    if (e.request_status === "draft") return { state: "requested", text: `On draft request ${e.request_code ?? ""}: not submitted to Warehouse`.replace("  ", " "), tone: "amber" };
    return { state: "with_warehouse", text: `Waiting for Warehouse (${e.request_code ?? "request"})`, tone: "quiet" };
  }
  const t = l.task;
  if (!t) return { state: "unknown", text: "Task could not be read", tone: "red" };
  if (t.blocked && ["todo", "in_progress", "ready_for_review"].includes(t.status)) return { state: "blocked", text: "Task blocked", tone: "red" };
  switch (t.status) {
    case "todo": return { state: "todo", text: "Task not started", tone: "quiet" };
    case "in_progress": return { state: "in_progress", text: "Task in progress", tone: "blue" };
    case "ready_for_review": return { state: "review", text: "Task in review", tone: "blue" };
    case "done": return { state: "done", text: "Task done", tone: "green" };
    default: return { state: "closed", text: t.status === "cancelled" ? "Task cancelled" : "Task deferred", tone: "quiet" };
  }
}

/** A deliverable's progress in one line: how many of its released lines are finished (work done, equipment sent), and how many are still drafts. */
export function itemProgress(item: Pick<DpItem, "lines">): { total: number; released: number; finished: number; drafts: number; text: string } {
  const total = item.lines.length;
  const p = item.lines.map(lineProgress);
  const drafts = p.filter((x) => x.state === "draft").length;
  const finished = p.filter((x) => x.state === "done" || x.state === "dispatched" || x.state === "returned").length;
  const released = total - drafts;
  const text = total === 0 ? "No breakdown yet" : released === 0 ? `${total} draft ${total === 1 ? "line" : "lines"}, nothing released` : `${finished} of ${released} released ${released === 1 ? "line" : "lines"} finished${drafts ? `, ${drafts} still draft` : ""}`;
  return { total, released, finished, drafts, text };
}

/** Deliverables grouped by zone, in plan order (a zone appears where its first deliverable is). An empty zone is "No zone". */
export function byZone<T extends Pick<DpItem, "zone">>(items: readonly T[]): { zone: string; items: T[] }[] {
  const out: { zone: string; items: T[] }[] = [];
  for (const i of items) {
    const zone = i.zone.trim() || "No zone";
    const g = out.find((x) => x.zone.toLowerCase() === zone.toLowerCase());
    if (g) g.items.push(i); else out.push({ zone, items: [i] });
  }
  return out;
}

const FIELD_WORDS: Record<string, string> = { zone: "Zone", title: "Deliverable", specs: "Specifications", owner_id: "Accountable owner", needed_by: "Needed by", description: "Description", qty: "Quantity", inv_item_id: "Stock item", assignee_id: "Assigned to", start_date: "Planned start", milestone_id: "Milestone" };
/** A proposed change in words, one line per field. Ids are resolved by the caller's `nameOf`; a value that is absent reads "not set". */
export function describeChange(ch: Pick<DpChange, "changes">, nameOf: (field: string, value: string) => string = (_f, v) => v): string[] {
  const show = (field: string, v: unknown) => (v === null || v === undefined || v === "" ? "not set" : nameOf(field, String(v)));
  return Object.entries(ch.changes).map(([field, d]) => `${FIELD_WORDS[field] ?? field}: ${show(field, d.from)} to ${show(field, d.to)}`);
}

/** What release would do, so the confirmation can say it before anything is created. Hardware supplied by buying, renting or the client is followed in the plan, not requested. */
/** A line a release will leave waiting, with where it is (`label`: the deliverable and the line) and the one thing that unblocks it (`fix`), so the dialog can link straight to it. */
export type ReleaseWaiting = { key: string; reason: string; label: string; fix: string };
export function releasePreview(items: readonly DpItem[]): { tasks: number; equipment: number; external: number; waiting: ReleaseWaiting[] } {
  let tasks = 0, equipment = 0, external = 0;
  const waiting: ReleaseWaiting[] = [];
  for (const it of items) for (const l of it.lines) {
    if (l.released_at) continue;
    if (l.section === "hardware") {
      if ((l.supply_route ?? "inventory") !== "inventory") external += 1;
      else if (l.inv_item_id) equipment += 1;
      else waiting.push({ key: l.key, reason: "needs a stock match", label: `${it.title}: ${l.description}`, fix: "Choose the stock item for this line, or mark it bought, rented or client supplied." });
    } else if (l.assignee_id || it.owner_id) tasks += 1;
    else waiting.push({ key: l.key, reason: "nobody named, and the deliverable has no accountable owner", label: `${it.title}: ${l.description}`, fix: "Name who does this line, or give the deliverable an accountable owner." });
  }
  return { tasks, equipment, external, waiting };
}
