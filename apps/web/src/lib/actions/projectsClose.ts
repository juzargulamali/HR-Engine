"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalDate, optionalText, optionalUuid, patchOf, refreshProjects, textPatch, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/** Client feedback, scope changes, completion and reopening. */
type S = ProjectActionState;
const version = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());

export async function recordFeedback(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, targetType: z.enum(["project", "milestone", "deliverable", "task"]).default("project"), targetId: optionalUuid, source: z.string().trim().min(1, "Say who the feedback came from and how"),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date it was received"), requestText: z.string().trim().min(1, "Write what the client asked for").max(4000),
    kind: z.enum(["in_scope_correction", "proposed_change"], { message: "Say whether this corrects what was agreed or proposes a change" }), responsibleUserId: optionalUuid, dueDate: optionalDate,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_record_feedback", {
    p_project_id: d.projectId,
    p_fields: patchOf({ target_type: d.targetType, target_id: d.targetId, source: d.source, received_on: d.receivedOn, request_text: d.requestText, kind: d.kind, responsible_user_id: d.responsibleUserId, due_date: d.dueDate }),
  });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return ok(data);
}

export async function updateFeedback(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, feedbackId: uuid, status: z.enum(["open", "in_progress", "resolved", "declined", "deferred"]).optional(), expectedVersion: version }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const fields = patchOf({
    status: p.data.status, resolution: textPatch(fd, "resolution"), evidence_note: textPatch(fd, "evidenceNote"),
    responsible_user_id: textPatch(fd, "responsibleUserId"), due_date: textPatch(fd, "dueDate"), expected_version: p.data.expectedVersion,
  });
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_update_feedback", { p_feedback_id: p.data.feedbackId, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function proposeScopeChange(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, title: z.string().trim().min(1, "Give the change a title"), proposedScope: z.string().trim().min(1, "Write the proposed scope"), effectOnDates: optionalText,
    feedbackId: optionalUuid, costNote: optionalText, currency: z.preprocess((v) => (v === "" || v == null ? undefined : String(v).toUpperCase()), z.string().length(3, "Currency is a 3-letter code").optional()),
    amount: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().nonnegative("Amount must be zero or more").optional()),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_propose_scope_change", {
    p_project_id: d.projectId,
    p_fields: patchOf({ title: d.title, proposed_scope: d.proposedScope, effect_on_dates: d.effectOnDates, feedback_id: d.feedbackId, cost_note: d.costNote, currency: d.currency, amount: d.amount }),
  });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return ok(data);
}

export async function decideScopeChange(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, scopeChangeId: uuid, decision: z.enum(["approve", "reject"]), note: z.string().trim().min(1, "Record the reason for the decision") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_decide_scope_change", { p_scope_change_id: p.data.scopeChangeId, p_decision: p.data.decision, p_note: p.data.note });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function withdrawScopeChange(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, scopeChangeId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_withdraw_scope_change", { p_scope_change_id: p.data.scopeChangeId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function setScopeChangeCommercial(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, scopeChangeId: uuid, currency: z.preprocess((v) => (v === "" || v == null ? null : String(v).toUpperCase()), z.string().length(3, "Currency is a 3-letter code").nullable()),
    amount: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nonnegative().nullable()), note: optionalText,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_scope_change_commercial", { p_scope_change_id: p.data.scopeChangeId, p_currency: p.data.currency, p_amount: p.data.amount, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---- Completion ----------------------------------------------------------------------------------------------------
export async function completeProject(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, evidenceType: optionalText, evidenceReference: optionalText, fileId: optionalUuid, confirmedOn: optionalDate, clientContact: optionalText,
    completionNote: z.string().trim().min(1, "Write the completion note"), resolutions: z.string().default("[]"),
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  let resolutions: unknown;
  try { resolutions = JSON.parse(p.data.resolutions); } catch { return { error: "The decisions on unfinished work could not be read. Reload and try again." }; }
  const parsed = z.array(z.object({ kind: z.string(), id: uuid, action: z.string(), note: z.string() })).safeParse(resolutions);
  if (!parsed.success) return { error: "The decisions on unfinished work could not be read. Reload and try again." };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_complete_project", {
    p_project_id: d.projectId,
    p_fields: patchOf({ evidence_type: d.evidenceType, evidence_reference: d.evidenceReference, file_id: d.fileId, confirmed_on: d.confirmedOn, client_contact: d.clientContact, completion_note: d.completionNote }),
    p_resolutions: parsed.data,
  });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return ok(data);
}

export async function reopenProject(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, reason: z.string().trim().min(1, "Give the reason for reopening") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_reopen_project", { p_project_id: p.data.projectId, p_reason: p.data.reason });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}
