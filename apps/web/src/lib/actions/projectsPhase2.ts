"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setupNotice } from "@/lib/projects/teams/model";
import { fail, firstIssue, ok, optionalDate, optionalText, optionalUuid, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/**
 * Projects Phase 2 server actions (migration 20270106000100): thin wrappers over the proj_* database functions. The function, not this file, decides who may do what and what is allowed;
 * this layer parses the form, keeps the person's input when something is refused (the message comes back, the form keeps its values) and turns errors into sentences.
 */
type S = ProjectActionState & { notice?: string | null };
const pos = (max: number) => z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(1).max(max).optional());
const key = z.string().trim().min(8).max(80);

export async function saveTaskOutput(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, label: optionalText, qty: pos(999), expectedVersion: pos(1_000_000) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_set_task_output", { p_task_id: p.data.taskId, p_label: p.data.label ?? null, p_qty: p.data.qty ?? null, p_required: fd.get("required") === "on", p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, notice: (data as { unchanged?: boolean } | null)?.unchanged ? "Nothing changed." : p.data.label ? "Expected output saved." : "Expected output removed." };
}

/**
 * Submit a version. The material is an existing project file (`fileId`), or a link given here (`url`, added as a project link first: the same rule as every link). The client key
 * identifies this ATTEMPT: pressing Submit twice, or retrying after a dropped connection, makes one version.
 */
export async function submitTaskOutput(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, taskId: uuid, clientKey: key, fileId: optionalUuid, snapshotFileId: optionalUuid, itemCount: pos(999), note: optionalText, expectedCurrent: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).optional()),
    url: z.preprocess((v) => (v === "" || v == null ? undefined : String(v).trim()), z.string().url("Enter the whole link, starting with https://").refine((u) => /^https:\/\//i.test(u), "Links must start with https://").optional()), linkLabel: optionalText,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  let fileId = p.data.fileId ?? null;
  const mutable = fd.get("mutableLink") === "on" || (!!p.data.url && fd.get("mutableLink") !== "off");
  if (!fileId && !p.data.url) return { error: "Choose a file, upload one, or add a link." };
  if (!fileId && p.data.url) {
    // A retried attempt must not add the link a second time: if this attempt already made its version, report it and stop.
    const { data: made } = await supabase.from("proj_task_output_versions").select("version_no").eq("task_id", p.data.taskId).eq("client_key", p.data.clientKey).maybeSingle();
    if (made) return { error: null, notice: `Version ${made.version_no} was already submitted.` };
    const added = await supabase.rpc("proj_add_link", { p_project_id: p.data.projectId, p_label: p.data.linkLabel ?? "Task output", p_url: p.data.url, p_purpose: "document", p_restricted: false });
    if (added.error) return fail(added.error.message);
    fileId = added.data as string;
  }
  const { data, error } = await supabase.rpc("proj_submit_task_output", {
    p_task_id: p.data.taskId, p_file_id: fileId!, p_snapshot_file_id: p.data.snapshotFileId ?? null, p_item_count: p.data.itemCount ?? 1, p_note: p.data.note ?? null, p_mutable_link: mutable, p_client_key: p.data.clientKey, p_expected_current: p.data.expectedCurrent ?? null,
  });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { version_no?: number; existing?: boolean };
  return { error: null, notice: r.existing ? `Version ${r.version_no} was already submitted, so nothing was added twice.` : `Version ${r.version_no} submitted. ${mutable ? "It is a link to a document that can change: add a snapshot or a version-specific link if the exact material must be retrievable." : "It is waiting for review."}` };
}

/** Approve or ask for changes on ONE version. The version id is the one on the person's screen: if a newer version exists the database refuses and says which to review. */
export async function decideTaskOutput(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, versionId: uuid, decision: z.enum(["approved", "changes_requested"]), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_decide_task_output", { p_version_id: p.data.versionId, p_decision: p.data.decision, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { unchanged?: boolean; version_no?: number };
  return { error: null, notice: r.unchanged ? `Version ${r.version_no} already had that decision.` : p.data.decision === "approved" ? `Version ${r.version_no} approved.` : `Changes requested on version ${r.version_no}. The assignee submits a new version.` };
}

export async function linkFeedbackToOutput(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, feedbackId: uuid, versionId: optionalUuid, activationId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_link_feedback_output", { p_feedback_id: p.data.feedbackId, p_version_id: p.data.versionId ?? null, p_activation_id: p.data.activationId ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ------------------------------------------------------------------------------------------------ site schedule
const kind = z.enum(["mockup", "setup", "show", "dismantling", "other"]);
const state = z.enum(["tentative", "confirmed"]);
const localDt = z.preprocess((v) => (v === "" || v == null ? undefined : String(v)), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter the date and time").optional());
const hhmm = z.preprocess((v) => (v === "" || v == null ? undefined : String(v)), z.string().regex(/^\d{2}:\d{2}$/, "Enter the time as 09:00").optional());
const zone = z.preprocess((v) => (v === "" || v == null ? undefined : String(v)), z.string().max(64).optional());

/** Fields common to one activity and to a Quick add row, as the database function takes them. */
function activityFields(o: { kind?: string; title?: string; run?: string; location?: string; owner?: string; state?: string; start?: string; end?: string; startsLocal?: string; endsLocal?: string; tz?: string; notes?: string; reason?: string }): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (o.kind) f.activity_kind = o.kind;
  if (o.title !== undefined) f.title = o.title;
  if (o.run !== undefined) f.run_label = o.run;
  if (o.location !== undefined) f.location = o.location;
  if (o.owner !== undefined) f.owner_id = o.owner || null;
  if (o.state) f.activity_state = o.state;
  if (o.startsLocal) { f.starts_local = o.startsLocal; f.ends_local = o.endsLocal ?? o.startsLocal; if (o.tz) f.tz = o.tz; }
  else if (o.start !== undefined || o.end !== undefined) { f.start_date = o.start || null; f.end_date = o.end || o.start || null; }
  if (o.notes !== undefined) f.notes = o.notes;
  if (o.reason) f.reason = o.reason;
  return f;
}

export async function saveSiteActivity(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, itemId: optionalUuid, kind: kind.optional(), title: optionalText, run: optionalText, location: optionalText, owner: optionalUuid, state: state.optional(), start: optionalDate, end: optionalDate,
    startsLocal: localDt, endsLocal: localDt, startTime: hhmm, endTime: hhmm, tz: zone, notes: optionalText, reason: optionalText, expectedVersion: pos(1_000_000), clientKey: key.optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  if (!p.data.itemId && !p.data.kind) return { error: "Choose the kind of activity." };
  const d = p.data;
  // A time window needs a day: "09:00" to "18:00" on the start day (to the end day when it is different). Without times the activity is a plain date (time to confirm).
  if (d.startTime && !d.start) return { error: "Choose the day the time window is on." };
  const startsLocal = d.startsLocal ?? (d.startTime && d.start ? `${d.start}T${d.startTime}` : undefined);
  const endsLocal = d.endsLocal ?? (d.startTime && d.start ? `${d.end ?? d.start}T${d.endTime ?? d.startTime}` : undefined);
  const fields = activityFields({ kind: d.kind, title: d.title ?? undefined, run: d.run ?? "", location: d.location ?? "", owner: d.owner ?? "", state: d.state, start: fd.has("start") ? (d.start ?? "") : undefined, end: fd.has("end") ? (d.end ?? "") : undefined, startsLocal, endsLocal, tz: d.tz, notes: d.notes ?? "", reason: d.reason ?? undefined });
  if (d.expectedVersion) fields.expected_version = d.expectedVersion;
  if (d.clientKey) fields.client_key = d.clientKey;
  const { data, error } = await (await createClient()).rpc("proj_save_site_activity", { p_project_id: d.projectId, p_item_id: d.itemId ?? null, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return { error: null, id: (data as { id?: string } | null)?.id, notice: (data as { existing?: boolean } | null)?.existing ? "That activity was already saved, so nothing was added twice." : "Activity saved." };
}

/** Quick add: several activities in one save (up to 25). A row matching an existing activity (kind, name, start day) is left alone. */
export async function addSiteActivities(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const g = (k: string) => fd.getAll(k).map(String);
  const kinds = g("rowKind"), titles = g("rowTitle"), runs = g("rowRun"), locs = g("rowLocation"), owners = g("rowOwner"), states = g("rowState"), starts = g("rowStart"), ends = g("rowEnd"), times = g("rowTime"), tzs = g("rowTz");
  const rows: Record<string, unknown>[] = [];
  for (let n = 0; n < kinds.length; n++) {
    const hasAny = (starts[n] ?? "") || (titles[n] ?? "").trim() || (runs[n] ?? "").trim() || (locs[n] ?? "").trim();
    if (!hasAny) continue;
    if (!kind.safeParse(kinds[n]).success) return { error: `Row ${n + 1}: choose the kind of activity.` };
    if (owners[n] && !uuid.safeParse(owners[n]).success) return { error: `Row ${n + 1}: choose the owner from the list.` };
    if (starts[n] && !optionalDate.safeParse(starts[n]).success) return { error: `Row ${n + 1}: check the start date.` };
    if (ends[n] && !optionalDate.safeParse(ends[n]).success) return { error: `Row ${n + 1}: check the end date.` };
    const time = (times[n] ?? "").trim(), hasTime = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(time);
    if (time && !hasTime) return { error: `Row ${n + 1}: write the time as 09:00-18:00, or leave it empty while it is to be confirmed.` };
    const base = activityFields({ kind: kinds[n], title: (titles[n] ?? "").trim() || undefined, run: (runs[n] ?? "").trim(), location: (locs[n] ?? "").trim(), owner: owners[n] ?? "", state: states[n] === "confirmed" ? "confirmed" : "tentative",
      ...(hasTime && starts[n] ? { startsLocal: `${starts[n]}T${time.slice(0, 5)}`, endsLocal: `${ends[n] || starts[n]}T${time.slice(6)}`, tz: (tzs[n] ?? "").trim() || undefined } : { start: starts[n] ?? "", end: ends[n] ?? "" }) });
    rows.push(base);
  }
  if (rows.length === 0) return { error: "Fill in at least one row." };
  if (rows.length > 25) return { error: "Quick add takes at most 25 rows at a time." };
  const { data, error } = await (await createClient()).rpc("proj_add_site_activities", { p_project_id: p.data.projectId, p_rows: rows });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { created?: number; existing?: number };
  const created = Number(r.created ?? 0), existing = Number(r.existing ?? 0);
  return { error: null, notice: existing === 0 ? `${created} activit${created === 1 ? "y" : "ies"} added.` : `${created} new activit${created === 1 ? "y" : "ies"} added; ${existing} already on the schedule ${existing === 1 ? "was" : "were"} left as ${existing === 1 ? "it is" : "they are"}, so nothing was added twice.` };
}

export async function setSiteCrew(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: uuid, overrideReason: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const users = fd.getAll("crewUser").map(String), roles = fd.getAll("crewRole").map(String), calls = fd.getAll("crewCall").map(String), notes = fd.getAll("crewNote").map(String);
  const rows: { user_id: string; role: string; call_local?: string; instructions?: string }[] = [];
  for (let n = 0; n < users.length; n++) {
    if (!users[n]) continue;
    if (!uuid.safeParse(users[n]).success || !z.enum(["installation", "standby", "backup", "dismantling"]).safeParse(roles[n]).success) return { error: "Choose each person and role from the lists." };
    const call = (calls[n] ?? "").trim(), note = (notes[n] ?? "").trim();
    if (call && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(call)) return { error: "Enter the call time as a date and time." };
    if (note.length > 1000) return { error: "Instructions are limited to 1000 characters." };
    rows.push({ user_id: users[n]!, role: roles[n]!, ...(call ? { call_local: call } : {}), ...(note ? { instructions: note } : {}) });
  }
  const { data, error } = await (await createClient()).rpc("proj_set_site_crew", { p_item_id: p.data.itemId, p_rows: rows, p_override_reason: p.data.overrideReason ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { added?: number; removed?: number; updated?: number; overlaps?: number; overlap_names?: string | null };
  const changed = (r.added ?? 0) + (r.removed ?? 0) + (r.updated ?? 0);
  const base = changed === 0 ? "The crew was already saved." : `Crew saved: ${r.added ?? 0} added, ${r.removed ?? 0} removed${(r.updated ?? 0) > 0 ? `, ${r.updated} updated` : ""}.`;
  return { error: null, notice: (r.overlaps ?? 0) > 0 ? `${base} Check the overlap: ${r.overlap_names} already has a confirmed commitment at this time.` : base };
}

/** The crew's brief: hardware / content / app readiness and instructions every assigned person can read. */
export async function setActivityReadiness(_prev: S, fd: FormData): Promise<S> {
  const level = z.enum(["unknown", "not_ready", "ready"]);
  const p = z.object({ projectId: uuid, itemId: uuid, hardware: level, content: level, app: level, note: optionalText, crewInstructions: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_set_activity_readiness", { p_item_id: p.data.itemId, p_fields: { hardware: p.data.hardware, content: p.data.content, app: p.data.app, note: p.data.note ?? "", crew_instructions: p.data.crewInstructions ?? "" } });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, notice: (data as { unchanged?: boolean } | null)?.unchanged ? "Nothing changed." : "Readiness and instructions saved." };
}

/** Choose the project teams in one go, each with an optional lead. The database never duplicates a team or replaces a lead, and asks for explicit confirmation before it adds a lead to the project. */
export async function setupProjectTeams(_prev: S, fd: FormData): Promise<S> {
  const row = z.object({ name: z.string().trim().min(1).max(80), preset: z.enum(["content", "programming", "engineering", "site_installation"]).optional(), lead_user_id: z.string().uuid().optional() });
  const p = z.object({ projectId: uuid, teams: z.string().min(2) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Choose at least one team." };
  let parsed: unknown;
  try { parsed = JSON.parse(p.data.teams); } catch { return { error: "The team list could not be read. Reload and try again." }; }
  const rows = z.array(row).min(1, "Choose at least one team.").max(12, "At most 12 teams in one save.").safeParse(parsed);
  if (!rows.success) return { error: firstIssue(rows.error) };
  const { data, error } = await (await createClient()).rpc("proj_setup_teams", { p_project_id: p.data.projectId, p_teams: rows.data, p_confirm_access: fd.get("confirmAccess") === "on" });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, notice: setupNotice((data ?? {}) as Parameters<typeof setupNotice>[0]) };
}

/** Assign (or release) the Operations reviewer of a version waiting for review. The Project Manager or an Operations Manager; the database checks who may be the reviewer. */
export async function assignOutputReviewer(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, versionId: uuid, reviewerId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_assign_output_reviewer", { p_version_id: p.data.versionId, p_reviewer: p.data.reviewerId ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { unchanged?: boolean };
  return { error: null, notice: r.unchanged ? "That was already the case." : p.data.reviewerId ? "Reviewer assigned and told." : "Released to the Operations queue." };
}

export async function saveShipment(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, shipmentId: optionalUuid, label: optionalText, planItemId: optionalUuid, requestId: optionalUuid, carrier: optionalText, reference: optionalText, notes: optionalText, state: state.optional(), reason: optionalText,
    departsLocal: localDt, departsTz: zone, arrivesLocal: localDt, arrivesTz: zone, returnsLocal: localDt, returnsTz: zone, expectedVersion: pos(1_000_000), clientKey: key.optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!d.shipmentId && !d.label) return { error: "Name the shipment." };
  const f: Record<string, unknown> = {};
  if (d.label) f.label = d.label;
  if (fd.has("planItemId")) f.plan_item_id = d.planItemId ?? null;
  if (fd.has("requestId")) f.request_id = d.requestId ?? null;
  for (const [k, v] of [["carrier", d.carrier], ["reference", d.reference], ["notes", d.notes]] as const) if (fd.has(k)) f[k] = v ?? "";
  if (d.state) f.state = d.state;
  if (d.reason) f.reason = d.reason;
  for (const [k, v] of [["departs_local", d.departsLocal], ["arrives_local", d.arrivesLocal], ["returns_local", d.returnsLocal]] as const) if (fd.has(k.replace("_local", "Local").replace("departs", "departs").replace(/_(\w)/g, (_, c) => c.toUpperCase()))) f[k] = v ?? "";
  for (const [k, v] of [["departs_tz", d.departsTz], ["arrives_tz", d.arrivesTz], ["returns_tz", d.returnsTz]] as const) if (v) f[k] = v;
  if (d.expectedVersion) f.expected_version = d.expectedVersion;
  if (d.clientKey) f.client_key = d.clientKey;
  const { data, error } = await (await createClient()).rpc("proj_save_shipment", { p_project_id: d.projectId, p_shipment_id: d.shipmentId ?? null, p_fields: f });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return { error: null, notice: (data as { existing?: boolean } | null)?.existing ? "That shipment was already saved, so nothing was added twice." : "Shipment saved." };
}

export async function removeShipment(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, shipmentId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_remove_shipment", { p_shipment_id: p.data.shipmentId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}
