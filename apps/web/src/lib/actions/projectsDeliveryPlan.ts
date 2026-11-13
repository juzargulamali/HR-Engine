"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalDate, optionalText, optionalUuid, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";
import { DP_SECTIONS } from "@/lib/projects/delivery-plan/model";

/**
 * Project Plan server actions (migrations 20261231000100 and 20270104000100). Thin wrappers over the proj_dp_* database functions: the function, not this file, decides who may change a
 * deliverable row, a section's lines, release the plan or decide a correction or a proposed change. This layer parses the form and turns errors into sentences.
 */
type S = ProjectActionState & { notice?: string | null };
const version = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());
const section = z.enum(DP_SECTIONS);
/** A form field that is present but empty clears the value (null); an absent field leaves it alone. */
const patch = (fd: FormData, keys: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (fd.has(k)) { const v = String(fd.get(k) ?? "").trim(); out[k] = v === "" ? null : v; }
  return out;
};
const outcome = (data: unknown): S => {
  const r = (data ?? {}) as { id?: string; proposed?: string; existing?: boolean };
  if (r.proposed) return { error: null, id: r.id, notice: "This is already released, so your change was sent to the Project Manager as a proposal. Nothing changed yet." };
  if (r.existing) return { error: null, id: r.id, notice: "That is already in the plan, so nothing was added twice." };
  return ok(r.id);
};

export async function saveDeliverable(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, itemId: optionalUuid, title: optionalText, neededBy: optionalDate, ownerId: optionalUuid, expectedVersion: version,
    qty: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("The quantity must be more than zero").max(999_999_999).optional()),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patch(fd, ["zone", "title", "specs", "reason"]);
  if (fd.has("qty")) fields.qty = p.data.qty ?? null;
  if (fd.has("ownerId")) fields.owner_id = p.data.ownerId ?? null;
  if (fd.has("neededBy")) fields.needed_by = p.data.neededBy ?? null;
  if (fd.has("imageFileId")) fields.image_file_id = String(fd.get("imageFileId") ?? "").trim() || null;
  if (!p.data.itemId && !p.data.title) return { error: "Give the deliverable a name." };
  const { data, error } = await (await createClient()).rpc("proj_dp_save_item", { p_project_id: p.data.projectId, p_item_id: p.data.itemId ?? null, p_fields: fields, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return outcome(data);
}

export async function removeDeliverable(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_dp_remove_item", { p_item_id: p.data.itemId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

/** The detail keys a form may carry, by name: d_<key>. The database keeps only the keys of the line's section and refuses the rest. */
const DETAIL_KEYS = ["source", "expected_date", "deliverable_type", "count", "format", "resolution", "orientation", "purpose", "platform", "app_count", "device_count", "kind"] as const;
const detailFrom = (fd: FormData): Record<string, string | null> | undefined => {
  const out: Record<string, string | null> = {};
  let any = false;
  for (const k of DETAIL_KEYS) if (fd.has(`d_${k}`)) { any = true; const v = String(fd.get(`d_${k}`) ?? "").trim(); out[k] = v === "" ? null : v; }
  return any ? out : undefined;
};

export async function savePlanLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, itemId: uuid, lineId: optionalUuid, section: section.optional(), assigneeId: optionalUuid, invItemId: optionalUuid, neededBy: optionalDate, startDate: optionalDate,
    milestoneId: optionalUuid, supplyRoute: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["inventory", "buy", "rent", "client"]).optional()), expectedVersion: version,
    qty: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("The quantity must be more than zero").max(1_000_000).optional()),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patch(fd, ["description", "notes", "reason"]);
  if (!p.data.lineId) fields.section = p.data.section ?? null;
  if (fd.has("assigneeId")) fields.assignee_id = p.data.assigneeId ?? null;
  if (fd.has("invItemId")) fields.inv_item_id = p.data.invItemId ?? null;
  if (fd.has("neededBy")) fields.needed_by = p.data.neededBy ?? null;
  if (fd.has("startDate")) fields.start_date = p.data.startDate ?? null;
  if (fd.has("milestoneId")) fields.milestone_id = p.data.milestoneId ?? null;
  if (fd.has("supplyRoute") && p.data.supplyRoute) fields.supply_route = p.data.supplyRoute;
  if (fd.has("qty")) fields.qty = p.data.qty ?? null;
  const detail = detailFrom(fd);
  if (detail) fields.detail = detail;
  // "Waits for": the form lists the other lines of the project; every ticked one is sent (none ticked clears it) when the field set is present.
  if (fd.has("dependsOnPresent")) {
    const ids = fd.getAll("dependsOn").map(String).filter(Boolean);
    if (!ids.every((x) => uuid.safeParse(x).success)) return { error: "Choose the lines this one waits for from the list." };
    fields.depends_on = ids;
  }
  const { data, error } = await (await createClient()).rpc("proj_dp_save_line", { p_item_id: p.data.itemId, p_line_id: p.data.lineId ?? null, p_fields: fields, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return outcome(data);
}

/** A chain of lines, each waiting for the one before: the steps (names, owners, dates) are whatever the form carries. */
export async function addPlanSequence(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: uuid, section, milestoneId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const names = fd.getAll("stepDescription").map((x) => String(x).trim());
  const owners = fd.getAll("stepOwner").map(String), starts = fd.getAll("stepStart").map(String), dues = fd.getAll("stepDue").map(String);
  const steps: Record<string, unknown>[] = [];
  for (let n = 0; n < names.length; n++) {
    if (!names[n]) continue;
    const o = owners[n] ?? "", st = starts[n] ?? "", du = dues[n] ?? "";
    if (o && !uuid.safeParse(o).success) return { error: "Choose each owner from the list." };
    if (st && !optionalDate.safeParse(st).success) return { error: `Check the start date of "${names[n]}".` };
    if (du && !optionalDate.safeParse(du).success) return { error: `Check the due date of "${names[n]}".` };
    steps.push({ description: names[n], assignee_id: o || null, start_date: st || null, needed_by: du || null, ...(p.data.milestoneId ? { milestone_id: p.data.milestoneId } : {}) });
  }
  if (steps.length === 0) return { error: "Add at least one step." };
  if (steps.length > 12) return { error: "A sequence has at most 12 steps." };
  const { data, error } = await (await createClient()).rpc("proj_dp_add_sequence", { p_item_id: p.data.itemId, p_section: p.data.section, p_steps: steps });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const created = Number((data as { created?: number } | null)?.created ?? 0);
  return { error: null, notice: created === steps.length ? `${created} step${created === 1 ? "" : "s"} added, each waiting for the one before.` : `${created} new step${created === 1 ? "" : "s"} added; ${steps.length - created} already existed and were left as they are.` };
}

/**
 * Quick add: several requirements of one section in one save. Each row goes through the same database function as a single add, so the same permission, validation and
 * "same name in the same section is the same line" rule apply: retrying or double-submitting the save adds nothing. One refused row refuses the whole batch and says which.
 */
export async function addPlanLines(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: uuid, section, milestoneId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const names = fd.getAll("rowName").map((x) => String(x).trim());
  const qtys = fd.getAll("rowQty").map(String), owners = fd.getAll("rowOwner").map(String), starts = fd.getAll("rowStart").map(String), dues = fd.getAll("rowDue").map(String);
  const rows: Record<string, unknown>[] = [];
  for (let n = 0; n < names.length; n++) {
    if (!names[n]) continue;
    const q = (qtys[n] ?? "").trim(), o = owners[n] ?? "", st = starts[n] ?? "", du = dues[n] ?? "";
    if (q && !(Number(q) > 0 && Number(q) <= 1_000_000)) return { error: `The quantity of "${names[n]}" must be more than zero.` };
    if (o && !uuid.safeParse(o).success) return { error: "Choose each owner from the list." };
    if (st && !optionalDate.safeParse(st).success) return { error: `Check the start date of "${names[n]}".` };
    if (du && !optionalDate.safeParse(du).success) return { error: `Check the due date of "${names[n]}".` };
    rows.push({ description: names[n], ...(q ? { qty: Number(q) } : {}), assignee_id: o || null, start_date: st || null, needed_by: du || null, ...(p.data.milestoneId ? { milestone_id: p.data.milestoneId } : {}) });
  }
  if (rows.length === 0) return { error: "Name at least one row." };
  if (rows.length > 50) return { error: "Quick add takes at most 50 rows at a time." };
  const { data, error } = await (await createClient()).rpc("proj_dp_add_lines", { p_item_id: p.data.itemId, p_section: p.data.section, p_rows: rows, p_chain: fd.get("chain") === "on" });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { created?: number; existing?: number };
  const created = Number(r.created ?? 0), existing = Number(r.existing ?? 0);
  return { error: null, notice: existing === 0 ? `${created} row${created === 1 ? "" : "s"} added.` : `${created} new row${created === 1 ? "" : "s"} added; ${existing} already in the plan ${existing === 1 ? "was" : "were"} left as ${existing === 1 ? "it is" : "they are"}, so nothing was added twice.` };
}

/** Persist the order of requirements within a technology. The whole new order of the rows shown is sent; sending the same order again changes nothing. */
export async function reorderPlanLines(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const ids = fd.getAll("lineId").map(String);
  if (ids.length === 0 || !ids.every((x) => uuid.safeParse(x).success)) return { error: "Nothing to reorder." };
  const { data, error } = await (await createClient()).rpc("proj_dp_reorder_lines", { p_item_id: p.data.itemId, p_line_ids: ids });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, notice: Number((data as { moved?: number } | null)?.moved ?? 0) === 0 ? "The order was already saved." : "Order saved." };
}

/** Bring the accepted handover's technologies into the plan once. Repeating it adds nothing and never touches what the Project Manager edited. */
export async function seedPlanScope(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_dp_seed_scope", { p_project_id: p.data.projectId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const added = Number((data as { added?: number } | null)?.added ?? 0);
  return { error: null, notice: added === 0 ? "Everything accepted is already in the plan." : `${added} accepted technolog${added === 1 ? "y" : "ies"} added to the plan.` };
}

/** A change the linked task could not take: retry it, or keep the task as it is. Only a manager of the project can. */
export async function reconcilePlanTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, lineId: uuid, action: z.enum(["retry", "keep_task"]) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_dp_reconcile_task", { p_line_id: p.data.lineId, p_action: p.data.action });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const status = String((data as { status?: string } | null)?.status ?? "");
  return { error: null, notice: status === "pending" ? "The task still cannot take the change. It stays flagged; you can keep the task as it is instead." : status === "kept_task" ? "The plan now follows the task." : status === "nothing_pending" ? "Nothing was waiting." : "The task was updated." };
}

export async function removePlanLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, lineId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_dp_remove_line", { p_line_id: p.data.lineId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function delegatePlanSection(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, section, userId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_dp_delegate", { p_project_id: p.data.projectId, p_section: p.data.section, p_user: p.data.userId ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

/** Release: tasks for work lines, draft equipment lines for hardware. Repeating it creates nothing twice. The equipment request is NOT submitted here. */
export async function releaseDeliveryPlan(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_dp_release", { p_project_id: p.data.projectId, p_item_ids: p.data.itemId ? [p.data.itemId] : null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  const r = (data ?? {}) as { tasks?: number; equipment?: number; external?: number; skipped?: { line: string; reason: string }[] };
  const tasks = r.tasks ?? 0, equipment = r.equipment ?? 0, external = r.external ?? 0, skipped = r.skipped ?? [];
  const parts = [
    tasks + equipment === 0 ? "Nothing new to release." : `Released: ${tasks} task${tasks === 1 ? "" : "s"} created${equipment ? `, ${equipment} line${equipment === 1 ? "" : "s"} added to the draft equipment request` : ""}.`,
    equipment > 0 ? "The equipment request is still a draft: review it on the Equipment tab and submit it to the warehouse there." : "",
    external > 0 ? `${external} hardware line${external === 1 ? " is" : "s are"} bought, rented or client supplied: followed in the plan, not sent to the warehouse.` : "",
    skipped.length > 0 ? `${skipped.length} line${skipped.length === 1 ? " was" : "s were"} not released: ${skipped.map((s) => `${s.line} (${s.reason})`).join("; ")}.` : "",
  ].filter(Boolean);
  return { error: null, notice: parts.join(" ") };
}

export async function raisePlanCorrection(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, targetType: z.enum(["deliverable", "line", "task", "scope"]), targetId: optionalUuid, body: z.string().trim().min(1, "Say what needs correcting").max(2000) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { data, error } = await (await createClient()).rpc("proj_dp_raise_correction", { p_project_id: p.data.projectId, p_target_type: p.data.targetType, p_target_id: p.data.targetId ?? null, p_body: p.data.body });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, id: typeof data === "string" ? data : undefined, notice: "Correction sent. The lead and the Project Manager were told; you will see the decision on the Delivery plan." };
}

export async function decidePlanCorrection(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, correctionId: uuid, decision: z.enum(["accepted", "declined"]), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_dp_decide_correction", { p_correction_id: p.data.correctionId, p_decision: p.data.decision, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function decidePlanChange(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, changeId: uuid, decision: z.enum(["approved", "rejected", "withdrawn"]), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_dp_decide_change", { p_change_id: p.data.changeId, p_decision: p.data.decision, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}
