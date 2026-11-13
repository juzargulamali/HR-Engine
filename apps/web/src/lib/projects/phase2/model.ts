/**
 * Projects Phase 2, pure rules shared by the screens and the register export: task deliverables (expected outputs, versions, reviews), the Site schedule and the Work overview.
 * No database, no React. The data shapes are what the database functions `proj_deliverables_register`, `proj_site_schedule` and `proj_work_overview` return.
 */

// ------------------------------------------------------------------------------------------------ time zones
/** Used when a project has no (valid) time zone. The screen says so next to the time; a time is never shown without its zone. */
export const FALLBACK_TZ = "UTC";

export function resolveZone(tz: string | null | undefined): { zone: string; fellBack: boolean } {
  if (tz) { try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return { zone: tz, fellBack: false }; } catch { /* fall through */ } }
  return { zone: FALLBACK_TZ, fellBack: true };
}

const zoneName = (z: string) => z.replace(/_/g, " ");
/** "13 Nov 2026, 14:05 Asia/Dubai". When the project has no usable zone: "13 Nov 2026, 10:05 UTC (project time zone not set)". "—" for no time. */
export function formatAt(iso: string | null | undefined, tz: string | null | undefined): string {
  if (!iso) return "—";
  const { zone, fellBack } = resolveZone(tz);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return `${f.replace(",", ",")} ${zoneName(zone)}${fellBack ? " (project time zone not set)" : ""}`;
}
/** "14:05" in a zone, and the plain day "13 Nov" in it. */
export const timeIn = (iso: string, tz: string | null | undefined) => new Intl.DateTimeFormat("en-GB", { timeZone: resolveZone(tz).zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const dateOnly = (iso: string, tz: string | null | undefined) => new Intl.DateTimeFormat("en-CA", { timeZone: resolveZone(tz).zone }).format(new Date(iso));
export const dayIn = (iso: string, tz: string | null | undefined) => new Intl.DateTimeFormat("en-CA", { timeZone: resolveZone(tz).zone }).format(new Date(iso));
/** An instant as the value of a datetime-local input, in a zone: "2027-11-11T09:00". Empty for none. */
export function toLocalInput(iso: string | null | undefined, tz: string | null | undefined): string {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: resolveZone(tz).zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

// ------------------------------------------------------------------------------------------------ deliverables register
export type OutputState = "missing" | "partial" | "awaiting_review" | "changes_requested" | "approved";
export type FileRef = { id: string | null; accessible: boolean; restricted?: boolean; removed?: boolean; kind?: "file" | "link"; name?: string; url?: string | null; mime?: string | null; size?: number | null } | null;
export interface OutputVersion {
  id: string; version_no: number; status: "awaiting" | "changes_requested" | "approved" | "superseded"; item_count: number; mutable_link: boolean; note: string | null;
  submitted_by: string; submitted_by_name: string | null; attached_at: string; decided_at: string | null; decided_by_name: string | null; decision_note: string | null;
  approved_at: string | null; approved_by_name: string | null; file: FileRef; snapshot: FileRef;
  feedback: { id: string; status: string; kind: string; source: string; text: string; received_on: string }[];
}
export interface RegisterRow {
  task_id: string; task_title: string; task_status: string; task_due: string | null; blocked: boolean; requires_review: boolean; team_id: string | null; assignee_id: string; assignee_name: string | null;
  output_label: string; output_qty: number | null; output_required: boolean;
  activation: { id: string; key: string; title: string } | null; milestone: { id: string; title: string; status: string } | null;
  state: OutputState; versions_count: number; current: OutputVersion | null; versions: OutputVersion[];
}
export interface Register { tz: string | null; rows: RegisterRow[] }

export const OUTPUT_STATE_LABELS: Record<OutputState, string> = { missing: "Missing", partial: "Incomplete", awaiting_review: "Awaiting review", changes_requested: "Changes requested", approved: "Approved" };
export const OUTPUT_STATE_TONE: Record<OutputState, "red" | "amber" | "blue" | "green"> = { missing: "red", partial: "amber", awaiting_review: "blue", changes_requested: "amber", approved: "green" };
export const VERSION_STATUS_LABELS: Record<OutputVersion["status"], string> = { awaiting: "Awaiting review", changes_requested: "Changes requested", approved: "Approved", superseded: "Replaced by a newer version" };

export type RegisterFilter = "all" | "missing" | "awaiting" | "changes" | "approved";
export const REGISTER_FILTERS: { key: RegisterFilter; label: string }[] = [{ key: "all", label: "All" }, { key: "missing", label: "Missing" }, { key: "awaiting", label: "Awaiting review" }, { key: "changes", label: "Changes requested" }, { key: "approved", label: "Approved" }];
export const parseRegisterFilter = (v: string | string[] | undefined): RegisterFilter => { const s = Array.isArray(v) ? v[0] : v; return REGISTER_FILTERS.some((f) => f.key === s) ? (s as RegisterFilter) : "all"; };
const matches = (s: OutputState, f: RegisterFilter) => f === "all" || (f === "missing" && (s === "missing" || s === "partial")) || (f === "awaiting" && s === "awaiting_review") || (f === "changes" && s === "changes_requested") || (f === "approved" && s === "approved");
export const filterRegister = (rows: readonly RegisterRow[], f: RegisterFilter) => rows.filter((r) => matches(r.state, f));
export const registerCounts = (rows: readonly RegisterRow[]): Record<RegisterFilter, number> => ({
  all: rows.length, missing: filterRegister(rows, "missing").length, awaiting: filterRegister(rows, "awaiting").length, changes: filterRegister(rows, "changes").length, approved: filterRegister(rows, "approved").length,
});
/** Rows grouped by activation (those without one last), in the order given. */
export function groupByActivation(rows: readonly RegisterRow[]): { key: string; title: string; rows: RegisterRow[] }[] {
  const out: { key: string; title: string; rows: RegisterRow[] }[] = [];
  for (const r of rows) {
    const key = r.activation?.key ?? "—", title = r.activation ? `${r.activation.key} · ${r.activation.title}` : "Not part of an activation";
    const g = out.find((x) => x.key === key); if (g) g.rows.push(r); else out.push({ key, title, rows: [r] });
  }
  return out.sort((a, b) => (a.key === "—" ? 1 : b.key === "—" ? -1 : a.key.localeCompare(b.key)));
}
/** What a version holds against what was expected: "1 of 3 provided". */
export const quantityText = (r: Pick<RegisterRow, "output_qty">, v: Pick<OutputVersion, "item_count"> | null) =>
  (r.output_qty ?? 1) > 1 || (v && v.item_count !== (r.output_qty ?? 1)) ? (v ? `${v.item_count} of ${r.output_qty ?? 1} provided` : `${r.output_qty ?? 1} expected`) : null;
/** One sentence for the person who has to act next, in words (colour is only a cue). */
export function nextOutputAction(r: RegisterRow, who: { isAssignee: boolean; isReviewer: boolean }): string {
  const what = `${r.output_qty && r.output_qty > 1 ? `${r.output_qty} × ` : ""}${r.output_label}`;
  switch (r.state) {
    case "missing": return who.isAssignee ? `Add the expected output: ${what}.${r.output_required ? " The task cannot be sent for review or completed without it." : ""}` : `Waiting for ${r.assignee_name ?? "the assignee"} to add ${what}.`;
    case "partial": return who.isAssignee ? `Only ${r.current?.item_count} of ${r.output_qty} provided. Submit a version with all of them.` : `${r.assignee_name ?? "The assignee"} has provided ${r.current?.item_count} of ${r.output_qty}.`;
    case "awaiting_review": return who.isReviewer ? `Version ${r.current?.version_no} is waiting for your review.` : `Version ${r.current?.version_no} is waiting for review.`;
    case "changes_requested": return who.isAssignee ? `Changes were requested on version ${r.current?.version_no}${r.current?.decision_note ? `: ${r.current.decision_note}` : ""}. Submit a new version.` : `Changes were requested on version ${r.current?.version_no}. ${r.assignee_name ?? "The assignee"} submits the next version.`;
    case "approved": return `Version ${r.current?.version_no} was approved.`;
  }
}
/** A version's file or link in words, never revealing a restricted one the reader cannot open. */
export const fileLabel = (f: FileRef): string => !f ? "No file" : f.removed ? "File removed" : !f.accessible ? "Restricted file (the Project Manager can open it)" : `${f.kind === "link" ? "Link: " : ""}${f.name ?? "File"}`;

/** The register as CSV rows, built ONLY from what the register function returned for this reader (so the export can never contain more than the screen). */
export function registerCsv(reg: Register): string {
  const q = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Activation", "Task", "Deliverable", "Expected", "Required", "Task status", "Owner", "State", "Current version", "Attached at", "Submitted by", "Approved at", "Approved by", "Review note", "File or link", "Link address", "Mutable link", "Milestone"];
  const lines = [head.map(q).join(",")];
  for (const r of reg.rows) {
    const c = r.current, f = c?.file;
    lines.push([r.activation ? `${r.activation.key} ${r.activation.title}` : "", r.task_title, r.output_label, r.output_qty ?? 1, r.output_required ? "Yes" : "No", r.task_status, r.assignee_name ?? "", OUTPUT_STATE_LABELS[r.state],
      c ? `v${c.version_no}` : "", c ? formatAt(c.attached_at, reg.tz) : "", c?.submitted_by_name ?? "", c?.approved_at ? formatAt(c.approved_at, reg.tz) : "", c?.approved_by_name ?? "", c?.decision_note ?? "",
      c ? fileLabel(f ?? null) : "", f?.accessible && f.kind === "link" ? (f.url ?? "") : "", c?.mutable_link ? "Yes" : "", r.milestone?.title ?? ""].map(q).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// ------------------------------------------------------------------------------------------------ site schedule
export type ActivityKind = "mockup" | "setup" | "show" | "dismantling" | "other";
export type CrewRole = "installation" | "standby" | "backup" | "dismantling";
export const ACTIVITY_KINDS: ActivityKind[] = ["mockup", "setup", "show", "dismantling", "other"];
export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = { mockup: "Mockup", setup: "Setup / installation", show: "Show", dismantling: "Dismantling", other: "Other" };
export const CREW_ROLES: CrewRole[] = ["installation", "standby", "backup", "dismantling"];
export const CREW_ROLE_LABELS: Record<CrewRole, string> = { installation: "Installation", standby: "Standby", backup: "Backup", dismantling: "Dismantling" };
export type Missing = "date" | "time" | "crew";
export const MISSING_LABELS: Record<Missing, string> = { date: "No date", time: "Time to confirm", crew: "No crew" };
export interface SiteActivity {
  id: string; title: string; kind: ActivityKind | null; run_label: string | null; location: string | null; status: string; owner_id: string | null; owner_name: string | null; state: "tentative" | "confirmed"; confirmed_at: string | null;
  start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null; tz: string | null; notes: string | null; version: number; milestone_id: string | null; client_facing: boolean;
  crew: { user_id: string; name: string | null; role: CrewRole }[]; missing: Missing[];
}
export interface SiteShipment {
  id: string; label: string; plan_item_id: string | null; activity_title: string | null; carrier: string | null; reference: string | null; notes: string | null; state: "tentative" | "confirmed"; version: number;
  departs_at: string | null; departs_tz: string | null; arrives_at: string | null; arrives_tz: string | null; returns_at: string | null; returns_tz: string | null;
  request: { id: string; code: string; state: string; needed_from: string | null; needed_until: string | null; units_asked?: number; units_dispatched?: number; units_returned?: number; units_out?: number; units_short?: number } | null;
  missing: ("arrival" | "departure")[]; conflict: { type: "late"; setup_title: string; setup_start: string; setup_has_time: boolean } | null;
}
export interface SiteSchedule { tz: string | null; committed: { install_start: string | null; event_start: string | null; event_end: string | null }; activities: SiteActivity[]; shipments: SiteShipment[] }

/** The activity's own date or time window in words, exact: "11 Nov, 09:00–18:00 Asia/Dubai", "14–15 Nov (time to confirm)", "No date". */
export function activityWhen(a: Pick<SiteActivity, "start_date" | "end_date" | "starts_at" | "ends_at" | "tz">, projectTz: string | null): string {
  const tz = a.tz ?? projectTz;
  if (a.starts_at) {
    const sd = dayIn(a.starts_at, tz), ed = a.ends_at ? dayIn(a.ends_at, tz) : sd;
    const span = ed === sd ? `${shortDay(sd)}, ${timeIn(a.starts_at, tz)}${a.ends_at ? `–${timeIn(a.ends_at, tz)}` : ""}` : `${shortDay(sd)}, ${timeIn(a.starts_at, tz)} – ${shortDay(ed)}, ${timeIn(a.ends_at!, tz)}`;
    const { zone, fellBack } = resolveZone(tz);
    return `${span} ${zoneName(zone)}${fellBack ? " (project time zone not set)" : ""}`;
  }
  if (a.start_date) {
    const e = a.end_date && a.end_date !== a.start_date ? a.end_date : null;
    const same = e && e.slice(0, 7) === a.start_date.slice(0, 7);
    return `${e ? (same ? `${Number(a.start_date.slice(8, 10))}–${shortDay(e)}` : `${shortDay(a.start_date)} – ${shortDay(e)}`) : shortDay(a.start_date)} (time to confirm)`;
  }
  return "No date";
}
/** Activities grouped by their run ("Run 1", "Run 2"), so two runs read as two runs and nothing implies the kit stays installed between them. */
export function runGroups(acts: readonly SiteActivity[]): { run: string; activities: SiteActivity[] }[] {
  const out: { run: string; activities: SiteActivity[] }[] = [];
  for (const a of acts) { const run = a.run_label ?? "Other activities"; const g = out.find((x) => x.run === run); if (g) g.activities.push(a); else out.push({ run, activities: [a] }); }
  return out;
}
/** The day range of everything dated on the site schedule (for the timeline strip), or null. */
export function siteRange(s: Pick<SiteSchedule, "activities" | "shipments" | "tz">): { start: string; end: string } | null {
  const days: string[] = [];
  for (const a of s.activities) { const tz = a.tz ?? s.tz; if (a.starts_at) { days.push(dayIn(a.starts_at, tz)); if (a.ends_at) days.push(dayIn(a.ends_at, tz)); } else { if (a.start_date) days.push(a.start_date); if (a.end_date) days.push(a.end_date); } }
  for (const sh of s.shipments) { if (sh.departs_at) days.push(dayIn(sh.departs_at, sh.departs_tz ?? s.tz)); if (sh.arrives_at) days.push(dayIn(sh.arrives_at, sh.arrives_tz ?? s.tz)); if (sh.returns_at) days.push(dayIn(sh.returns_at, sh.returns_tz ?? s.tz)); }
  if (days.length === 0) return null;
  days.sort(); return { start: days[0]!, end: days[days.length - 1]! };
}
export const activityDays = (a: SiteActivity, tz: string | null): { start: string | null; end: string | null } =>
  a.starts_at ? { start: dayIn(a.starts_at, a.tz ?? tz), end: a.ends_at ? dayIn(a.ends_at, a.tz ?? tz) : dayIn(a.starts_at, a.tz ?? tz) } : { start: a.start_date, end: a.end_date ?? a.start_date };
/** A shipment leg in words with its own zone: "arrives 11 Nov, 15:00 Asia/Dubai". */
export const legText = (verb: string, iso: string | null, tz: string | null) => (iso ? `${verb} ${formatAt(iso, tz).replace(/^(\d+ \w+) \d{4}, /, "$1, ")}` : `${verb}: not set`);
export const requestStateText = (r: SiteShipment["request"]): string | null => (!r ? null : ({
  draft: "Not submitted to the warehouse", reserved: "Reserved", partially_ready: "Partly reserved", short: "Short of stock", dispatched: "Sent", partially_dispatched: "Partly sent", still_out: "Sent, part returned", returned: "Returned", cancelled: "Cancelled", empty: "No lines",
} as Record<string, string>)[r.state] ?? r.state);

// ------------------------------------------------------------------------------------------------ Work overview
export interface OverviewAttention { kind: "output_missing" | "changes_requested" | "review_waiting" | "site_missing" | "shipment_conflict"; task_id?: string; activity_id?: string; shipment_id?: string; title: string; detail: string; who: string[] }
export interface OverviewRecent { at: string; actor: string | null; entity: "task_output" | "site_activity" | "shipment"; entity_id: string; field: string; from: string | null; to: string | null; note: string | null; title: string | null }
export interface WorkOverview { tz: string; today: string; next_on_site: SiteActivity | null; attention: OverviewAttention[]; recent: OverviewRecent[] }
export const ATTENTION_KIND_LABELS: Record<OverviewAttention["kind"], string> = { output_missing: "Output missing", changes_requested: "Changes requested", review_waiting: "Review waiting", site_missing: "Site plan incomplete", shipment_conflict: "Shipment arrives too late" };
/** Where to go to fix an attention line, as a path under /projects/[id]. */
/** At most `perKind` lines of each kind, in the original order, so one busy kind (many missing outputs) can never hide another (a late shipment). `more` counts what was left out. */
export function pickAttention(all: OverviewAttention[], perKind = 2): { shown: OverviewAttention[]; more: number } {
  const seen = new Map<string, number>();
  const shown = all.filter((a) => { const n = (seen.get(a.kind) ?? 0) + 1; seen.set(a.kind, n); return n <= perKind; });
  return { shown, more: all.length - shown.length };
}

export function attentionHref(projectId: string, a: OverviewAttention): string {
  const base = `/projects/${projectId}`;
  if (a.task_id) return `${base}/work?task=${a.task_id}`;
  if (a.activity_id) return `${base}/plan?plan=site&mode=list#site-${a.activity_id}`;
  if (a.shipment_id) return `${base}/plan?plan=site&mode=list#ship-${a.shipment_id}`;
  return `${base}/work`;
}
/** A recent change in words. */
export function recentText(r: OverviewRecent): string {
  const who = r.actor ?? "Someone", what = r.title ?? "an item";
  if (r.entity === "task_output") {
    if (r.field === "version") return `${who} submitted ${r.to} of ${what}`;
    if (r.field.startsWith("review of ")) return `${who} ${r.to === "approved" ? "approved" : "asked for changes on"} ${r.field.replace("review of ", "")} of ${what}`;
    return `${who} set the expected output of ${what}`;
  }
  if (r.entity === "site_activity") {
    if (r.field === "state" && r.to === "confirmed") return `${who} confirmed ${what}`;
    if (r.field === "date") return `${who} changed the date of ${what}${r.note ? ` (${r.note})` : ""}`;
    if (r.field === "crew") return `${who} updated the crew of ${what}`;
    if (r.field === "added") return `${who} added ${r.to}`;
    return `${who} changed ${what}`;
  }
  if (r.field === "arrival") return `${who} changed the arrival of ${what}`;
  if (r.field === "added") return `${who} added the shipment ${r.to}`;
  if (r.field === "removed") return `${who} removed the shipment ${r.from}`;
  return `${who} ${r.to === "confirmed" ? "confirmed" : "updated"} the shipment ${what}`;
}
