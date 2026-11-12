"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalDate, optionalText, optionalUuid, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";
import { DP_SECTIONS } from "@/lib/projects/delivery-plan/model";

/**
 * Delivery Plan server actions (migration 20261231000100). Thin wrappers over the proj_dp_* database functions: the function, not this file, decides who may change a
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
  const p = z.object({ projectId: uuid, itemId: optionalUuid, title: optionalText, neededBy: optionalDate, ownerId: optionalUuid, expectedVersion: version }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patch(fd, ["zone", "title", "specs", "reason"]);
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

export async function savePlanLine(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, itemId: uuid, lineId: optionalUuid, section: section.optional(), assigneeId: optionalUuid, invItemId: optionalUuid, neededBy: optionalDate, expectedVersion: version,
    qty: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().positive("The quantity must be more than zero").max(1_000_000).optional()),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patch(fd, ["description", "notes", "reason"]);
  if (!p.data.lineId) fields.section = p.data.section ?? null;
  if (fd.has("assigneeId")) fields.assignee_id = p.data.assigneeId ?? null;
  if (fd.has("invItemId")) fields.inv_item_id = p.data.invItemId ?? null;
  if (fd.has("neededBy")) fields.needed_by = p.data.neededBy ?? null;
  if (fd.has("qty")) fields.qty = p.data.qty ?? null;
  const { data, error } = await (await createClient()).rpc("proj_dp_save_line", { p_item_id: p.data.itemId, p_line_id: p.data.lineId ?? null, p_fields: fields, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return outcome(data);
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
  const r = (data ?? {}) as { tasks?: number; equipment?: number; skipped?: { line: string; reason: string }[] };
  const tasks = r.tasks ?? 0, equipment = r.equipment ?? 0, skipped = r.skipped ?? [];
  const parts = [
    tasks + equipment === 0 ? "Nothing new to release." : `Released: ${tasks} task${tasks === 1 ? "" : "s"} created${equipment ? `, ${equipment} line${equipment === 1 ? "" : "s"} added to the draft equipment request` : ""}.`,
    equipment > 0 ? "The equipment request is still a draft: review it on the Equipment tab and submit it to the warehouse there." : "",
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
