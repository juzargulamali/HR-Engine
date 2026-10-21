"use server";

import { z } from "zod";
import { planTemplate } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { checkbox, fail, firstIssue, ok, optionalDate, optionalInt, optionalLocal, optionalText, optionalUuid, patchOf, refreshProjects, staleMessage, textPatch, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/** Timelines, external dependencies, site bookings, client timeline issuing. */
type S = ProjectActionState;
const version = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());

export async function applyTimelineTemplate(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, plan: z.enum(["delivery", "site"]), baseDate: optionalDate }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_apply_plan_template", { p_project_id: p.data.projectId, p_plan: p.data.plan, p_items: planTemplate(p.data.plan) as unknown as Record<string, unknown>[], p_base_date: p.data.baseDate ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function savePlanItem(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, itemId: optionalUuid, plan: z.enum(["delivery", "site"]).optional(), title: optionalText, mode: z.enum(["undated", "dates", "timed"]).default("dates"),
    startDate: optionalDate, endDate: optionalDate, startsLocal: optionalLocal, endsLocal: optionalLocal, tz: optionalText, status: optionalText, clientFacing: checkbox, expectedVersion: version,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!d.itemId && (!d.plan || !d.title)) return { error: "Choose the timeline and give the item a title." };
  const fields: Record<string, unknown> = patchOf({
    plan: d.plan, title: d.title, status: d.status, client_facing: fd.has("clientFacingPresent") ? d.clientFacing : undefined,
    notes: textPatch(fd, "notes"), milestone_id: textPatch(fd, "milestoneId"), reason: textPatch(fd, "reason") ?? undefined, expected_version: d.expectedVersion,
  });
  if (d.mode === "dates") { fields.start_date = d.startDate ?? null; fields.end_date = d.endDate ?? null; }
  if (d.mode === "undated") { fields.start_date = null; fields.end_date = null; }
  if (d.mode === "timed") {
    if (!d.startsLocal) return { error: "Give the start date and time." };
    fields.starts_local = d.startsLocal.replace("T", " ");
    fields.ends_local = (d.endsLocal ?? d.startsLocal).replace("T", " ");
    if (d.tz) fields.tz = d.tz;
  }
  const supabase = await createClient();
  { const stale = await staleMessage(supabase, "plan_item", d.itemId, d.expectedVersion); if (stale) return { error: stale }; }
  const { data, error } = await supabase.rpc("proj_save_plan_item", { p_project_id: d.projectId, p_item_id: d.itemId ?? null, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return ok(data);
}

export async function deletePlanItem(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, itemId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_delete_plan_item", { p_item_id: p.data.itemId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function saveExternalDependency(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, dependencyId: optionalUuid, kind: z.enum(["structure_ready", "power_network", "access_permitted", "standbuilder_complete", "other"]).optional(),
    label: optionalText, expectedDate: optionalDate, expectedTime: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{2}:\d{2}$/, "Use a valid time").optional()),
    confirmation: z.enum(["pending", "confirmed", "not_possible"]).optional(), clientFacing: checkbox, expectedVersion: version,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!d.dependencyId && !d.label) return { error: "Describe what you are waiting for." };
  const fields = patchOf({
    kind: d.kind, label: d.label, expected_date: textPatch(fd, "expectedDate"), expected_time: textPatch(fd, "expectedTime"),
    organisation: textPatch(fd, "organisation"), contact: textPatch(fd, "contact"), confirmation: d.confirmation, milestone_id: textPatch(fd, "milestoneId"),
    client_facing: fd.has("clientFacingPresent") ? d.clientFacing : undefined, notes: textPatch(fd, "notes"), reason: textPatch(fd, "reason") ?? undefined, expected_version: d.expectedVersion,
  });
  const supabase = await createClient();
  { const stale = await staleMessage(supabase, "dependency", d.dependencyId, d.expectedVersion); if (stale) return { error: stale }; }
  const { data, error } = await supabase.rpc("proj_save_external_dependency", { p_project_id: d.projectId, p_dependency_id: d.dependencyId ?? null, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return ok(data);
}

export async function deleteExternalDependency(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, dependencyId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_delete_external_dependency", { p_dependency_id: p.data.dependencyId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---- Site bookings -----------------------------------------------------------------------------------------------
export async function saveSiteBooking(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({
    projectId: uuid, bookingId: optionalUuid, userId: optionalUuid, location: optionalText, startsLocal: optionalLocal, endsLocal: optionalLocal, tz: optionalText,
    leadMinutes: optionalInt, trailMinutes: optionalInt, planItemId: optionalUuid, expectedVersion: version,
  }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!d.bookingId && (!d.userId || !d.location || !d.startsLocal || !d.endsLocal)) return { error: "Choose who is booked, the site, and the start and end time." };
  const fields = patchOf({
    user_id: d.userId, location: d.location, starts_local: d.startsLocal?.replace("T", " "), ends_local: d.endsLocal?.replace("T", " "), tz: d.tz,
    lead_minutes: d.leadMinutes, trail_minutes: d.trailMinutes, plan_item_id: d.planItemId, notes: textPatch(fd, "notes"), reason: textPatch(fd, "reason") ?? undefined, expected_version: d.expectedVersion,
  });
  const supabase = await createClient();
  { const stale = await staleMessage(supabase, "booking", d.bookingId, d.expectedVersion); if (stale) return { error: stale }; }
  const { data, error } = await supabase.rpc("proj_save_booking", { p_project_id: d.projectId, p_booking_id: d.bookingId ?? null, p_fields: fields });
  if (error) return fail(error.message);
  refreshProjects(d.projectId);
  return ok(data);
}

/** Confirms a booking. An overlap is reported in words (never naming a project the caller cannot see); an authorised person can confirm anyway with a reason. */
export async function confirmSiteBooking(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, bookingId: uuid, overrideReason: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_confirm_booking", { p_booking_id: p.data.bookingId, p_override_reason: p.data.overrideReason ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, warning: data?.overridden ? "Confirmed with a recorded override of an overlapping booking." : null };
}

export async function cancelSiteBooking(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, bookingId: uuid, reason: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_cancel_booking", { p_booking_id: p.data.bookingId, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

// ---- Issued client timeline -------------------------------------------------------------------------------------
export async function issueClientTimeline(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, clientReference: optionalText, note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_issue_plan", { p_project_id: p.data.projectId, p_client_reference: p.data.clientReference ?? null, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok(data);
}

export async function recordTimelineSent(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, planId: uuid, note: z.string().trim().min(1, "Record how and to whom it was sent") }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_record_plan_sent", { p_plan_id: p.data.planId, p_note: p.data.note });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function recordTimelineAccepted(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, planId: uuid, acceptedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date the client accepted"), contact: z.string().trim().min(1, "Record who at the client accepted it"), note: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_record_plan_accepted", { p_plan_id: p.data.planId, p_accepted_on: p.data.acceptedOn, p_contact: p.data.contact, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}
