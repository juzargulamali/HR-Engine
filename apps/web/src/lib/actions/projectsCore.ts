"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PROJ_CAPABILITIES } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { friendlyProjectError } from "@/lib/projects/errors";
import { checkbox, fail, firstIssue, linesOf, ok, optionalDate, optionalText, optionalUuid, patchOf, refreshProjects, staleMessage, textPatch, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/**
 * Projects & Tasks server actions: access, Sales handover, project creation and lifecycle, people and departments. Each is a
 * thin wrapper over a proj_* database function. The function (not this file) decides who may do what, so a forged request gets
 * the same refusal a normal one would; this layer parses the form and turns database errors into plain sentences.
 */
type S = ProjectActionState;

// ---------------------------------------------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------------------------------------------
export async function setProjectReferenceCode(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ companyId: uuid, code: z.string().trim().toUpperCase() }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_company_code", { p_company_id: p.data.companyId, p_reference_code: p.data.code });
  if (error) return fail(error.message);
  refreshProjects();
  return ok();
}

// ---------------------------------------------------------------------------------------------------------------
// Handover from Sales to the Project Manager
// ---------------------------------------------------------------------------------------------------------------
const technologiesSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.trim() === "") return undefined;
    try { return JSON.parse(v); } catch { return "invalid"; }
  },
  z.array(z.object({ name: z.string().trim().min(1, "Each technology needs a name"), qty: z.coerce.number().int().min(1, "Quantity must be at least 1") })).optional(),
);

/** Saves the delivery brief and returns its id, or the plain-language failure. Shared by "Save draft" and "Save and submit". */
async function saveHandoverCore(fd: FormData): Promise<{ id: string; opportunityId: string } | { state: S }> {
  const p = z.object({
    opportunityId: uuid, expectedVersion: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional()),
    technologies: technologiesSchema,
  }).safeParse({ opportunityId: fd.get("opportunityId"), expectedVersion: fd.get("expectedVersion"), technologies: fd.get("technologies") });
  if (!p.success) return { state: { error: firstIssue(p.error) } };
  const tz = String(fd.get("siteTimezone") ?? "").trim();
  const fields = patchOf({
    title: String(fd.get("title") ?? "").trim() || undefined,
    client_name: textPatch(fd, "clientName"),
    location: textPatch(fd, "location"),
    site_timezone: tz || undefined,
    install_start: textPatch(fd, "installStart"),
    event_start: textPatch(fd, "eventStart"),
    event_end: textPatch(fd, "eventEnd"),
    scope: textPatch(fd, "scope"),
    exclusions: textPatch(fd, "exclusions"),
    notes: textPatch(fd, "notes"),
    risks: fd.has("risks") ? linesOf(String(fd.get("risks") ?? "")) : undefined,
    technologies: p.data.technologies,
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_save_handover", { p_opportunity_id: p.data.opportunityId, p_fields: fields, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return { state: fail(error.message) };
  refreshProjects();
  revalidateOpportunity(p.data.opportunityId);
  return { id: data as string, opportunityId: p.data.opportunityId };
}

/** Sales prepares (or edits) the member-safe delivery brief. Nothing commercial is read or copied. */
export async function saveHandover(_prev: S, fd: FormData): Promise<S> {
  const saved = await saveHandoverCore(fd);
  return "state" in saved ? saved.state : ok(saved.id);
}

/**
 * "Save and submit" in one step: the brief is saved exactly as "Save draft" would, then submitted with the same function and the same checks as
 * "Submit the handover" (the scope is still required). The form's `intent` is "draft" to stop after saving. If the submission is refused the brief
 * stays saved as a draft and the message says so; nothing about the handover process itself changes.
 */
export async function saveAndSubmitHandover(_prev: S, fd: FormData): Promise<S> {
  const saved = await saveHandoverCore(fd);
  if ("state" in saved) return saved.state;
  if (fd.get("intent") === "draft") return ok(saved.id);
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_submit_handover", { p_handover_id: saved.id });
  if (error) return { error: `Your changes are saved as a draft, but it was not submitted: ${friendlyProjectError(error.message)}` };
  refreshProjects();
  revalidateOpportunity(saved.opportunityId);
  return ok(saved.id);
}

function revalidateOpportunity(id: string) {
  revalidatePath(`/sales/opportunities/${id}`, "layout");
}

export async function submitHandover(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ handoverId: uuid, opportunityId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_submit_handover", { p_handover_id: p.data.handoverId });
  if (error) return fail(error.message);
  refreshProjects();
  if (p.data.opportunityId) revalidateOpportunity(p.data.opportunityId);
  return ok();
}

export async function withdrawHandover(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ handoverId: uuid, opportunityId: optionalUuid, reason: z.string().trim().min(1, "Give a reason for withdrawing") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_withdraw_handover", { p_handover_id: p.data.handoverId, p_reason: p.data.reason });
  if (error) return fail(error.message);
  refreshProjects();
  if (p.data.opportunityId) revalidateOpportunity(p.data.opportunityId);
  return ok();
}

export async function assignHandoverPm(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ handoverId: uuid, pmUserId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Choose the Project Manager." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_assign_handover_pm", { p_handover_id: p.data.handoverId, p_pm_user_id: p.data.pmUserId });
  if (error) return fail(error.message);
  refreshProjects();
  return ok();
}

export async function requestHandoverClarification(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ handoverId: uuid, note: z.string().trim().min(1, "Say what needs clarifying") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_request_handover_clarification", { p_handover_id: p.data.handoverId, p_note: p.data.note });
  if (error) return fail(error.message);
  refreshProjects();
  return ok();
}

/** Acceptance creates exactly one project (the database serialises concurrent and repeated clicks) and opens it. */
export async function acceptHandover(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ handoverId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_accept_handover", { p_handover_id: p.data.handoverId });
  if (error) return fail(error.message);
  refreshProjects();
  // The new project's Project Plan: where the Project Manager starts planning (the Work overview is one click away). A repeated accept returns the same project (the database creates one only), so a retry lands here too.
  redirect(`/projects/${data}/delivery?from=handover`);
}

// ---------------------------------------------------------------------------------------------------------------
// Projects: creation, edits, lifecycle, ownership
// ---------------------------------------------------------------------------------------------------------------
const internalSchema = z.object({
  companyId: uuid, name: z.string().trim().min(1, "Give the project a name").max(200), ownerId: uuid,
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), isOngoing: checkbox,
  startDate: optionalDate, endDate: optionalDate, summary: optionalText, siteTimezone: z.string().trim().default("Asia/Dubai"),
});

export async function createInternalProject(_prev: S, fd: FormData): Promise<S> {
  const p = internalSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_create_internal_project", {
    p_company_id: d.companyId, p_name: d.name, p_owner_user_id: d.ownerId, p_is_ongoing: d.isOngoing, p_priority: d.priority,
    p_start_date: d.startDate ?? null, p_end_date: d.endDate ?? null, p_summary: d.summary ?? null, p_site_timezone: d.siteTimezone,
  });
  if (error) return fail(error.message);
  refreshProjects();
  redirect(`/projects/${data}`);
}

export async function updateProject(_prev: S, fd: FormData): Promise<S> {
  const id = uuid.safeParse(fd.get("projectId"));
  if (!id.success) return { error: "Missing project." };
  const version = Number(fd.get("expectedVersion") ?? "") || null;
  const tz = String(fd.get("siteTimezone") ?? "").trim();
  const patch = patchOf({
    name: String(fd.get("name") ?? "").trim() || undefined,
    priority: String(fd.get("priority") ?? "") || undefined,
    start_date: textPatch(fd, "startDate"),
    end_date: textPatch(fd, "endDate"),
    client_name: textPatch(fd, "clientName"),
    location: textPatch(fd, "location"),
    site_timezone: tz || undefined,
    install_start: textPatch(fd, "installStart"),
    event_start: textPatch(fd, "eventStart"),
    event_end: textPatch(fd, "eventEnd"),
    scope: textPatch(fd, "scope"),
    exclusions: textPatch(fd, "exclusions"),
    is_ongoing: fd.has("isOngoingPresent") ? fd.get("isOngoing") === "on" : undefined,
  });
  const supabase = await createClient();
  { const stale = await staleMessage(supabase, "project", id.data, version); if (stale) return { error: stale }; }
  const { error } = await supabase.rpc("proj_update_project", { p_project_id: id.data, p_patch: patch, p_expected_version: version });
  if (error) return fail(error.message);
  refreshProjects(id.data);
  return ok();
}

export async function setProjectStatus(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, to: z.string().min(1), reason: optionalText, reviewDate: optionalDate }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_status", { p_project_id: p.data.projectId, p_to: p.data.to, p_reason: p.data.reason ?? null, p_review_date: p.data.reviewDate ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function assignProjectPm(_prev: S, fd: FormData): Promise<S> {
  // A reassignment carries its reason: it goes into the project's history and to the outgoing Project Manager. The database refuses one without it.
  const p = z.object({ projectId: uuid, pmUserId: uuid, reason: z.string().trim().min(3, "Give the reason for changing the Project Manager.").max(500, "Keep the reason under 500 characters.") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues.some((i) => i.path[0] === "reason") ? firstIssue(p.error) : "Choose the Project Manager." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_assign_pm", { p_project_id: p.data.projectId, p_pm_user_id: p.data.pmUserId, p_reason: p.data.reason });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function setActingPm(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, userId: uuid, until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the end date") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_acting_pm", { p_project_id: p.data.projectId, p_user_id: p.data.userId, p_until: p.data.until });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function endActingPm(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, userId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_end_acting_pm", { p_project_id: p.data.projectId, p_user_id: p.data.userId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function setSalesLink(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, userId: uuid, linked: checkbox }).safeParse({ ...Object.fromEntries(fd), linked: fd.get("linked") === "true" });
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_sales_link", { p_project_id: p.data.projectId, p_user_id: p.data.userId, p_linked: p.data.linked });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---------------------------------------------------------------------------------------------------------------
// People and departments
// ---------------------------------------------------------------------------------------------------------------
export async function addProjectMember(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, userId: uuid, teamId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Choose the person to add." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_add_member", { p_project_id: p.data.projectId, p_user_id: p.data.userId, p_team_id: p.data.teamId ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function setMemberTeam(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, userId: uuid, teamId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_member_team", { p_project_id: p.data.projectId, p_user_id: p.data.userId, p_team_id: p.data.teamId ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function removeProjectMember(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, userId: uuid, reason: optionalText, reassignTo: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_remove_member", { p_project_id: p.data.projectId, p_user_id: p.data.userId, p_reason: p.data.reason ?? null, p_reassign_to: p.data.reassignTo ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function saveProjectTeam(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, teamId: optionalUuid, name: z.string().trim().min(1, "Name the project team"), headUserId: uuid, departmentId: optionalUuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.path[0] === "headUserId" ? "Choose the team lead." : firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_save_team", { p_project_id: p.data.projectId, p_team_id: p.data.teamId ?? null, p_name: p.data.name, p_head_user_id: p.data.headUserId, p_department_id: p.data.departmentId ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok(data);
}

export async function removeProjectTeam(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, teamId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_remove_team", { p_project_id: p.data.projectId, p_team_id: p.data.teamId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}
