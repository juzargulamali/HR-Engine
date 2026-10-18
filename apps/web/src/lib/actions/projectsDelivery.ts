"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkbox, fail, firstIssue, ok, optionalDate, optionalText, optionalUuid, patchOf, refreshProjects, textPatch, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/** Milestones, deliverables and tasks. Role rules (PM, department head, assignee, reviewer) live in the database functions. */
type S = ProjectActionState;

// ---- Milestones ------------------------------------------------------------------------------------------------
export async function saveMilestone(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, milestoneId: optionalUuid, title: z.string().trim().min(1, "Give the milestone a title"), expectedVersion: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional()) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patchOf({
    title: p.data.title, description: textPatch(fd, "description"), due_date: textPatch(fd, "dueDate"),
    is_required: fd.has("isRequiredPresent") ? fd.get("isRequired") === "on" : undefined,
    client_facing: fd.has("clientFacingPresent") ? fd.get("clientFacing") === "on" : undefined,
    reason: textPatch(fd, "reason") ?? undefined, expected_version: p.data.expectedVersion,
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_save_milestone", { p_project_id: p.data.projectId, p_milestone_id: p.data.milestoneId ?? null, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok(data);
}

export async function setMilestoneStatus(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, milestoneId: uuid, to: z.string().min(1), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_milestone_status", { p_milestone_id: p.data.milestoneId, p_to: p.data.to, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---- Deliverables ----------------------------------------------------------------------------------------------
export async function saveDeliverable(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, deliverableId: optionalUuid, title: optionalText, expectedVersion: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional()) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  if (!p.data.deliverableId && !p.data.title) return { error: "Give the deliverable a title." };
  const fields = patchOf({
    title: p.data.title, description: textPatch(fd, "description"), due_date: textPatch(fd, "dueDate"),
    team_id: textPatch(fd, "teamId"), milestone_id: textPatch(fd, "milestoneId"), reason: textPatch(fd, "reason") ?? undefined, expected_version: p.data.expectedVersion,
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_save_deliverable", { p_project_id: p.data.projectId, p_deliverable_id: p.data.deliverableId ?? null, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok(data);
}

export async function setDeliverableStatus(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, deliverableId: uuid, to: z.string().min(1), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_deliverable_status", { p_deliverable_id: p.data.deliverableId, p_to: p.data.to, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---- Tasks -----------------------------------------------------------------------------------------------------
const ids = (fd: FormData, key: string) => fd.getAll(key).map(String).filter(Boolean);

export async function createProjectTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, title: z.string().trim().min(1, "Give the task a title"), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), requiresReview: checkbox }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patchOf({
    title: p.data.title, description: textPatch(fd, "description") ?? undefined, priority: p.data.priority,
    assignee_id: textPatch(fd, "assigneeId") ?? undefined, start_date: textPatch(fd, "startDate") ?? undefined, due_date: textPatch(fd, "dueDate") ?? undefined,
    deliverable_id: textPatch(fd, "deliverableId") ?? undefined, milestone_id: textPatch(fd, "milestoneId") ?? undefined, team_id: textPatch(fd, "teamId") ?? undefined,
    requires_review: p.data.requiresReview, depends_on: ids(fd, "dependsOn"), collaborator_ids: ids(fd, "collaboratorIds"),
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_create_task", { p_project_id: p.data.projectId, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok(data);
}

export async function updateProjectTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, expectedVersion: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional()) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const title = String(fd.get("title") ?? "").trim();
  const fields = patchOf({
    title: title || undefined, description: textPatch(fd, "description"), priority: String(fd.get("priority") ?? "") || undefined,
    start_date: textPatch(fd, "startDate"), due_date: textPatch(fd, "dueDate"), reason: textPatch(fd, "reason") ?? undefined,
    requires_review: fd.has("requiresReviewPresent") ? fd.get("requiresReview") === "on" : undefined,
    deliverable_id: textPatch(fd, "deliverableId"), milestone_id: textPatch(fd, "milestoneId"), team_id: textPatch(fd, "teamId"),
    depends_on: fd.has("dependsOnPresent") ? ids(fd, "dependsOn") : undefined, collaborator_ids: fd.has("collaboratorIdsPresent") ? ids(fd, "collaboratorIds") : undefined,
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_update_task", { p_task_id: p.data.taskId, p_fields: fields, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  // The number of dependent tasks the new date touches: nothing was moved; a person decides.
  const affected = Number(data ?? 0);
  return { error: null, warning: affected > 0 ? `${affected} dependent task${affected === 1 ? "" : "s"} now start${affected === 1 ? "s" : ""} before this one finishes. Nothing was moved: review them on the task.` : null };
}

export async function reassignProjectTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, assigneeId: uuid, note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Choose who takes the task." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_reassign_task", { p_task_id: p.data.taskId, p_assignee_id: p.data.assigneeId, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function setProjectTaskStatus(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, to: z.string().min(1), note: optionalText, expectedVersion: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional()) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_task_status", { p_task_id: p.data.taskId, p_to: p.data.to, p_note: p.data.note ?? null, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function blockProjectTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, reason: z.string().trim().min(1, "Say what is blocking the task"), unblockOwner: optionalUuid, unblockAction: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_block_task", { p_task_id: p.data.taskId, p_reason: p.data.reason, p_unblock_owner: p.data.unblockOwner ?? null, p_unblock_action: p.data.unblockAction ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function unblockProjectTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_unblock_task", { p_task_id: p.data.taskId, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function commentOnTask(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, taskId: uuid, body: z.string().trim().min(1, "Write a comment").max(4000) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_comment_task", { p_task_id: p.data.taskId, p_body: p.data.body });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---- Date helper: the dependent tasks a date change would touch, for the confirmation step (read only) ------------
export async function previewTaskDateChange(taskId: string, newDue: string): Promise<{ title: string; assignee: string | null; start: string | null; due: string | null }[]> {
  if (!uuid.safeParse(taskId).success || !/^\d{4}-\d{2}-\d{2}$/.test(newDue)) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("proj_task_affected", { p_task_id: taskId, p_new_due: newDue });
  return (data ?? []).map((r) => ({ title: r.title, assignee: r.assignee_name, start: r.start_date, due: r.due_date }));
}
