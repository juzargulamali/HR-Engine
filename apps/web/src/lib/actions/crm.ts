"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dubaiDateTimeToIso, findLikelyDuplicates, validateCrmLink, type DuplicateCandidate, type DuplicateMatch, CRM_CAPABILITIES } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { friendlyCrmError } from "@/lib/crm/errors";

/**
 * Sales & CRM server actions. Every one is a thin wrapper over a crm_* database function: the function (not this file)
 * decides who may do what and enforces the stage rules, so a forged request gets the same refusal a normal one would.
 * This layer parses the form, converts Dubai wall-clock times to UTC, and turns database errors into plain sentences.
 */

const uuid = z.string().uuid();
const optionalText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());
const optionalUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional());
const optionalNumber = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().nonnegative("Must be zero or more").optional());
const optionalInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());

const fail = (message: string): ActionState => ({ error: friendlyCrmError(message) });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";

function refresh(id?: string) {
  revalidatePath("/sales", "layout");
  if (id) revalidatePath(`/sales/opportunities/${id}`);
}

function dueIso(date: string | undefined, time: string | undefined): string | null {
  if (!date) return null;
  return dubaiDateTimeToIso(date, time && /^\d{2}:\d{2}$/.test(time) ? time : "09:00");
}

const technologiesSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.trim() === "") return [];
    try { return JSON.parse(v); } catch { return "invalid"; }
  },
  z.array(z.object({ name: z.string().trim().min(1, "Each technology needs a name"), qty: z.coerce.number().int().min(1, "Quantity must be at least 1") })),
);

// ---------------------------------------------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------------------------------------------

const createOpportunitySchema = z.object({
  companyId: uuid,
  title: z.string().trim().min(1, "Give the enquiry a title").max(200),
  source: z.string().min(1, "Choose where the enquiry came from"),
  agencyOrgId: optionalUuid,
  clientOrgId: optionalUuid,
  ownerId: optionalUuid,
  currency: z.preprocess((v) => (v === "" ? undefined : v), z.string().length(3, "Currency must be a 3-letter code").optional()),
  value: optionalNumber,
  budgetNote: optionalText,
  brief: optionalText,
  eventStart: optionalDate,
  eventEnd: optionalDate,
  installStart: optionalDate,
  location: optionalText,
  scope: optionalText,
  waitingOn: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["client", "internal"]).optional()),
  nextTitle: z.string().trim().min(1, "Say what the next action is"),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of the next action"),
  nextTime: optionalText,
  nextKind: z.enum(["call", "email", "meeting", "proposal", "other"]).default("other"),
  technologies: technologiesSchema,
  contactIds: z.array(uuid).default([]),
});

export async function createOpportunity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = { ...Object.fromEntries(formData), contactIds: formData.getAll("contactIds").filter((x) => x !== "") };
  const parsed = createOpportunitySchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  if (!d.agencyOrgId && !d.clientOrgId) return { error: "Choose an agency, an end client, or both." };
  const nextDue = dueIso(d.nextDate, d.nextTime);
  if (!nextDue) return { error: "The next action needs a valid date and time." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_create_opportunity", {
    p_company_id: d.companyId,
    p_title: d.title,
    p_source: d.source,
    p_next_title: d.nextTitle,
    p_next_due: nextDue,
    p_next_kind: d.nextKind,
    p_agency_org_id: d.agencyOrgId ?? null,
    p_client_org_id: d.clientOrgId ?? null,
    p_owner_id: d.ownerId ?? null,
    p_currency: d.currency ?? null,
    p_value: d.value ?? null,
    p_budget_note: d.budgetNote ?? null,
    p_brief: d.brief ?? null,
    p_event_start: d.eventStart ?? null,
    p_event_end: d.eventEnd ?? null,
    p_install_start: d.installStart ?? null,
    p_location: d.location ?? null,
    p_technologies: d.technologies,
    p_scope: d.scope ?? null,
    p_waiting_on: d.waitingOn ?? null,
    p_contacts: d.contactIds.map((contact_id) => ({ contact_id })),
  });
  if (error) return fail(error.message);
  refresh();
  redirect(`/sales/opportunities/${data}`);
}

const patchFields = {
  title: "text", brief: "text", agency_org_id: "uuid", client_org_id: "uuid", source: "text", currency: "text", value: "number",
  budget_note: "text", payment_terms: "text", event_start: "date", event_end: "date", install_start: "date", location: "text",
  scope: "text", exclusions: "text", waiting_on: "text",
} as const;

/** Edits the fields present in the form (a missing field is left alone; an empty one clears it). */
export async function updateOpportunity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "Missing opportunity." };
  const version = Number(formData.get("expectedVersion"));
  const patch: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(patchFields)) {
    if (!formData.has(key)) continue;
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") { patch[key] = null; continue; }
    if (kind === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: "The value must be zero or more." };
      patch[key] = n;
    } else patch[key] = raw;
  }
  if (formData.has("technologies")) {
    const t = technologiesSchema.safeParse(formData.get("technologies"));
    if (!t.success) return { error: firstIssue(t.error) };
    patch.technologies = t.data;
  }
  if (formData.has("risks")) {
    patch.risks = String(formData.get("risks") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  }
  if (Object.keys(patch).length === 0) return { error: "Nothing to save." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_update_opportunity", { p_id: id.data, p_expected_version: Number.isFinite(version) ? version : null, p_patch: patch });
  if (error) return fail(error.message);
  refresh(id.data);
  return { error: null };
}

export async function moveStage(id: string, to: string, expectedVersion: number): Promise<ActionState> {
  if (!uuid.safeParse(id).success) return { error: "Missing opportunity." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_move_stage", { p_id: id, p_to: to, p_expected_version: expectedVersion });
  if (error) return fail(error.message);
  refresh(id);
  return { error: null };
}

const holdSchema = z.object({
  id: uuid, reason: z.string().trim().min(1, "A reason is required"), reviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a review date"),
  expectedVersion: z.coerce.number().int().optional(),
});
export async function holdOpportunity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = holdSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_hold_opportunity", { p_id: p.data.id, p_reason: p.data.reason, p_review_date: p.data.reviewDate, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

const resumeSchema = z.object({
  id: uuid, nextTitle: z.string().trim().min(1, "Say what the next action is"), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  nextTime: optionalText, nextKind: z.enum(["call", "email", "meeting", "proposal", "other"]).default("other"), expectedVersion: z.coerce.number().int().optional(),
});
export async function resumeOpportunity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = resumeSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const due = dueIso(p.data.nextDate, p.data.nextTime);
  if (!due) return { error: "The next action needs a valid date and time." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_resume_opportunity", { p_id: p.data.id, p_next_title: p.data.nextTitle, p_next_due: due, p_next_kind: p.data.nextKind, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

const wonSchema = z.object({
  id: uuid, evidenceType: z.enum(["purchase_order", "authorised_email"], { message: "Choose the type of confirmation" }),
  evidenceReference: z.string().trim().min(1, "Enter the PO number or the email reference"),
  evidenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date on the document"), note: optionalText, expectedVersion: z.coerce.number().int().optional(),
});
export async function markWon(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = wonSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_mark_won", { p_id: p.data.id, p_evidence_type: p.data.evidenceType, p_evidence_reference: p.data.evidenceReference, p_evidence_date: p.data.evidenceDate, p_note: p.data.note ?? null, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  redirect(`/sales/opportunities/${p.data.id}`);
}

const lostSchema = z.object({ id: uuid, reason: z.string().trim().min(1, "A reason is required"), expectedVersion: z.coerce.number().int().optional() });
export async function markLost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = lostSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_mark_lost", { p_id: p.data.id, p_reason: p.data.reason, p_expected_version: p.data.expectedVersion ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  redirect(`/sales/opportunities/${p.data.id}`);
}

const assignSchema = z.object({ id: uuid, newOwner: uuid, reason: optionalText });
export async function assignOwner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = assignSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Choose the new owner." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_assign_owner", { p_id: p.data.id, p_new_owner: p.data.newOwner, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Organisations and contacts, duplicate checks
// ---------------------------------------------------------------------------------------------------------------

const orgSchema = z.object({ name: z.string().trim().min(1, "Enter the name").max(200), kind: z.enum(["agency", "client", "direct"]), place: optionalText, note: optionalText });
export async function createOrganisation(_prev: ActionState & { id?: string }, formData: FormData): Promise<ActionState & { id?: string }> {
  const p = orgSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_create_organisation", { p_name: p.data.name, p_kind: p.data.kind, p_place: p.data.place ?? null, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null, id: data };
}

const contactSchema = z.object({
  organisationId: optionalUuid, name: z.string().trim().min(1, "Enter the name").max(200), roleTitle: optionalText,
  email: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().email("That email address does not look right").optional()), phone: optionalText,
});
export async function createContact(_prev: ActionState & { id?: string }, formData: FormData): Promise<ActionState & { id?: string }> {
  const p = contactSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_create_contact", { p_organisation_id: p.data.organisationId ?? null, p_name: p.data.name, p_role_title: p.data.roleTitle ?? null, p_email: p.data.email ?? null, p_phone: p.data.phone ?? null });
  if (error) return fail(error.message);
  refresh();
  return { error: null, id: data };
}

export async function findSimilarOrganisations(name: string): Promise<{ id: string; name: string; kind: string; place: string | null }[]> {
  if (name.trim().length < 3) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("crm_find_similar_organisations", { p_name: name });
  return data ?? [];
}

/** Candidate duplicates for an enquiry being entered, scored in the domain package (organisation overlap alone never flags). */
export async function checkDuplicates(subject: {
  agencyOrgId?: string | null; clientOrgId?: string | null; title?: string; eventStart?: string | null; installStart?: string | null; location?: string | null;
  technologies?: { name: string; qty: number }[];
}): Promise<DuplicateMatch[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("crm_find_duplicate_candidates", {
    p_agency_org_id: subject.agencyOrgId || null, p_client_org_id: subject.clientOrgId || null,
    p_event_start: subject.eventStart || null, p_install_start: subject.installStart || null, p_location: subject.location || null,
  });
  const candidates: DuplicateCandidate[] = (data ?? []).map((r) => ({
    id: r.opportunity_id, reference: r.reference, stage: r.stage, agencyOrgId: r.agency_org_id, clientOrgId: r.client_org_id, title: r.title,
    eventStart: r.event_start, installStart: r.install_start, location: r.location, technologies: r.technologies, createdAt: r.created_at,
  }));
  return findLikelyDuplicates(subject, candidates);
}

// ---------------------------------------------------------------------------------------------------------------
// Activities and follow-ups
// ---------------------------------------------------------------------------------------------------------------

const activitySchema = z.object({ id: uuid, kind: z.enum(["call", "email", "meeting", "note", "client_response"]), body: z.string().trim().min(1, "Write what happened"), internal: z.string().optional() });
export async function addActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = activitySchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_add_activity", { p_id: p.data.id, p_kind: p.data.kind, p_body: p.data.body, p_internal: p.data.internal === "on" });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

const followUpSchema = z.object({
  id: uuid, title: z.string().trim().min(1, "Say what to do"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"), time: optionalText,
  kind: z.enum(["call", "email", "meeting", "proposal", "other"]).default("other"), assignedTo: optionalUuid,
});
export async function createFollowUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = followUpSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const due = dueIso(p.data.date, p.data.time);
  if (!due) return { error: "Enter a valid date and time." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_create_follow_up", { p_id: p.data.id, p_title: p.data.title, p_due_at: due, p_kind: p.data.kind, p_assigned_to: p.data.assignedTo ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

const completeSchema = z.object({
  followUpId: uuid, opportunityId: optionalUuid, outcome: z.string().trim().min(1, "Record what came of it"),
  next: z.enum(["follow_up", "hold", "none"]).default("none"),
  nextTitle: optionalText, nextDate: optionalDate, nextTime: optionalText, nextKind: z.enum(["call", "email", "meeting", "proposal", "other"]).default("other"),
  holdReason: optionalText, holdReview: optionalDate,
});
/** Completes a follow-up; the database insists on a next action (or a hold) when it was the last one. */
export async function completeFollowUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = completeSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  let nextDue: string | null = null;
  if (d.next === "follow_up") {
    if (!d.nextTitle || !d.nextDate) return { error: "Say what the next action is and when." };
    nextDue = dueIso(d.nextDate, d.nextTime);
    if (!nextDue) return { error: "The next action needs a valid date and time." };
  }
  if (d.next === "hold" && (!d.holdReason || !d.holdReview)) return { error: "Give a reason and a review date to put it on hold." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_complete_follow_up", {
    p_follow_up_id: d.followUpId, p_outcome: d.outcome,
    p_next_title: d.next === "follow_up" ? (d.nextTitle ?? null) : null, p_next_due: nextDue, p_next_kind: d.nextKind,
    p_hold_reason: d.next === "hold" ? (d.holdReason ?? null) : null, p_hold_review_date: d.next === "hold" ? (d.holdReview ?? null) : null,
  });
  if (error) return fail(error.message);
  refresh(d.opportunityId);
  return { error: null };
}

const rescheduleSchema = z.object({ followUpId: uuid, opportunityId: optionalUuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"), time: optionalText });
export async function rescheduleFollowUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = rescheduleSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const due = dueIso(p.data.date, p.data.time);
  if (!due) return { error: "Enter a valid date and time." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_reschedule_follow_up", { p_follow_up_id: p.data.followUpId, p_due_at: due });
  if (error) return fail(error.message);
  refresh(p.data.opportunityId);
  return { error: null };
}

const cancelSchema = z.object({ followUpId: uuid, opportunityId: optionalUuid, reason: z.string().trim().min(1, "Say why it is being cancelled") });
export async function cancelFollowUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = cancelSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_cancel_follow_up", { p_follow_up_id: p.data.followUpId, p_reason: p.data.reason });
  if (error) return fail(error.message);
  refresh(p.data.opportunityId);
  return { error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Proposals, links, Zoho references
// ---------------------------------------------------------------------------------------------------------------

const proposalSchema = z.object({ id: uuid, note: optionalText, fileId: optionalUuid });
export async function addProposal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = proposalSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_add_proposal", { p_opportunity_id: p.data.id, p_note: p.data.note ?? null, p_file_id: p.data.fileId ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

const proposalStatusSchema = z.object({ proposalId: uuid, opportunityId: uuid, status: z.enum(["sent", "accepted", "superseded"]), sentOn: optionalDate });
export async function setProposalStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = proposalStatusSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_set_proposal_status", { p_proposal_id: p.data.proposalId, p_status: p.data.status, p_sent_on: p.data.sentOn ?? null });
  if (error) return fail(error.message);
  refresh(p.data.opportunityId);
  return { error: null };
}

const linkSchema = z.object({ id: uuid, url: z.string().trim().min(1, "Paste the link"), label: optionalText, purpose: z.enum(["proposal", "purchase_order", "authorised_email", "brief", "other"]).default("other") });
export async function addLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = linkSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const bad = validateCrmLink(p.data.url);
  if (bad) return { error: bad };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_register_file", { p_opportunity_id: p.data.id, p_kind: "link", p_purpose: p.data.purpose, p_label: p.data.label ?? null, p_url: p.data.url });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

const zohoSchema = z.object({
  id: uuid, quoteRef: optionalText, quoteSentOn: optionalDate, invoiceRef: optionalText, invoiceIssuedOn: optionalDate, paymentReceivedOn: optionalDate, paidAmount: optionalNumber,
});
export async function saveZohoReference(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = zohoSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_upsert_zoho_reference", {
    p_opportunity_id: d.id, p_quote_ref: d.quoteRef ?? null, p_quote_sent_on: d.quoteSentOn ?? null, p_invoice_ref: d.invoiceRef ?? null,
    p_invoice_issued_on: d.invoiceIssuedOn ?? null, p_payment_received_on: d.paymentReceivedOn ?? null, p_paid_amount: d.paidAmount ?? null,
  });
  if (error) return fail(error.message);
  refresh(d.id);
  return { error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Equipment availability, commercial approval, handover
// ---------------------------------------------------------------------------------------------------------------

export async function requestAvailability(id: string): Promise<ActionState> {
  if (!uuid.safeParse(id).success) return { error: "Missing opportunity." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_request_availability", { p_opportunity_id: id });
  if (error) return fail(error.message);
  refresh(id);
  return { error: null };
}

const availabilitySchema = z.object({ id: uuid, state: z.enum(["confirmed", "unavailable"]), notes: z.string().trim().min(1, "Add a note: what was checked, or the alternative") });
export async function confirmAvailability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = availabilitySchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_confirm_availability", { p_opportunity_id: p.data.id, p_state: p.data.state, p_notes: p.data.notes });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

export async function requestApproval(opportunityId: string, proposalId?: string): Promise<ActionState> {
  if (!uuid.safeParse(opportunityId).success) return { error: "Missing opportunity." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_request_approval", { p_opportunity_id: opportunityId, p_proposal_id: proposalId ?? null });
  if (error) return fail(error.message);
  refresh(opportunityId);
  return { error: null };
}

const decideSchema = z.object({ approvalId: uuid, opportunityId: uuid, state: z.enum(["approved", "changes_requested"]), instruction: optionalText });
export async function decideApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = decideSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_decide_approval", { p_approval_id: p.data.approvalId, p_state: p.data.state, p_instruction: p.data.instruction ?? null });
  if (error) return fail(error.message);
  refresh(p.data.opportunityId);
  return { error: null };
}

const handoverSchema = z.object({ id: uuid, status: z.enum(["draft", "ready", "handed_over"]), pmUserId: optionalUuid, notes: optionalText });
export async function updateHandover(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = handoverSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_update_handover", { p_opportunity_id: p.data.id, p_status: p.data.status, p_pm_user_id: p.data.pmUserId ?? null, p_notes: p.data.notes ?? null });
  if (error) return fail(error.message);
  refresh(p.data.id);
  return { error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Access, settings, reminders
// ---------------------------------------------------------------------------------------------------------------

const grantSchema = z.object({ userId: uuid, companyId: uuid, note: optionalText });
export async function grantCrmAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = grantSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Choose a person and a company." };
  const caps = formData.getAll("capabilities").map(String).filter((c): c is (typeof CRM_CAPABILITIES)[number] => (CRM_CAPABILITIES as readonly string[]).includes(c));
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_grant_access", { p_user_id: p.data.userId, p_company_id: p.data.companyId, p_capabilities: caps, p_note: p.data.note ?? null });
  if (error) return fail(error.message);
  revalidatePath("/sales/access");
  revalidatePath("/sales", "layout");
  return { error: null };
}

export async function revokeCrmAccess(userId: string, companyId: string): Promise<ActionState> {
  if (!uuid.safeParse(userId).success || !uuid.safeParse(companyId).success) return { error: "Missing details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_revoke_access", { p_user_id: userId, p_company_id: companyId });
  if (error) return fail(error.message);
  revalidatePath("/sales/access");
  revalidatePath("/sales", "layout");
  return { error: null };
}

const settingsSchema = z.object({
  companyId: uuid, referenceCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "Reference code: 2 to 5 capital letters"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency: a 3-letter code such as AED"),
  responseTargetHours: optionalInt, duplicateWindowDays: z.coerce.number().int().min(1).max(1095).default(180),
  ownerEmailEnabled: z.string().optional(),
  approvalPolicy: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["not_configured", "not_required", "required"]).optional()), approvalNote: optionalText,
  workdays: z.array(z.coerce.number().int().min(0).max(6)).default([]), workStart: optionalText, workEnd: optionalText, holidays: optionalText,
});
export async function saveCrmSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = settingsSchema.safeParse({ ...Object.fromEntries(formData), workdays: formData.getAll("workdays") });
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  // A calendar is stored only when every part is given; otherwise it stays "not configured".
  const holidays = (d.holidays ?? "").split(/[\s,]+/).filter(Boolean);
  if (holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h))) return { error: "Holidays must be dates like 2026-12-02, separated by commas or spaces." };
  const calendar = d.workdays.length > 0 && d.workStart && d.workEnd ? { workdays: d.workdays, start: d.workStart, end: d.workEnd, holidays } : null;
  if (calendar && calendar.end <= calendar.start) return { error: "Working hours must end after they start." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("crm_upsert_settings", {
    p_company_id: d.companyId, p_reference_code: d.referenceCode, p_default_quote_currency: d.currency, p_response_target_hours: d.responseTargetHours ?? null,
    p_working_calendar: calendar, p_duplicate_window_days: d.duplicateWindowDays, p_owner_email_enabled: d.ownerEmailEnabled === "on",
    p_approval_policy: d.approvalPolicy ?? null, p_approval_note: d.approvalNote ?? null,
  });
  if (error) return fail(error.message);
  refresh();
  return { error: null };
}

export async function markRemindersRead(reminderId?: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("crm_mark_reminder_read", { p_reminder_id: reminderId ?? null });
  revalidatePath("/sales", "layout");
}
