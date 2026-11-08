"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { QUOTATION_CURRENCIES } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "@/lib/crm/errors";
import type { ActionState } from "./companies";

/**
 * Estimates & Quotations server actions. Thin wrappers over the crm_quote_* database functions (migration 20261220000100): the function, not
 * this file, decides who may edit or issue (the enquiry owner or a founder, company scoped), refuses edits to an issued quotation and applies
 * the approval gate, so a forged request gets the same refusal. This layer parses the form and turns database errors into sentences.
 */

const uuid = z.string().uuid();
const fail = (message: string): ActionState => ({ error: friendlyCrmError(message) });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";
const db = async () => (await createClient()) as unknown as SupabaseClient;
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);
const nullable = <T extends z.ZodTypeAny>(t: T) => z.preprocess(blankToNull, t.nullable());

function refresh(opportunityId: string, proposalId?: string) {
  revalidatePath("/sales", "layout");
  revalidatePath(`/sales/opportunities/${opportunityId}`);
  if (proposalId) revalidatePath(`/sales/opportunities/${opportunityId}/quotations/${proposalId}`);
}

/** Starts a draft estimate and opens its editor. */
export async function createQuotation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ opportunityId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "Missing enquiry." };
  const { data, error } = await (await db()).rpc("crm_quote_create", { p_opportunity: p.data.opportunityId });
  if (error || !data) return fail(error?.message ?? "Could not create the estimate.");
  refresh(p.data.opportunityId);
  redirect(`/sales/opportunities/${p.data.opportunityId}/quotations/${data as string}`);
}

const headerSchema = z.object({
  opportunityId: uuid, proposalId: uuid,
  currency: nullable(z.enum(QUOTATION_CURRENCIES, { message: "Choose one of AED, SAR, PLN, EUR or USD." })),
  vatChoiceId: nullable(uuid), billToOrgId: nullable(uuid),
  validityDate: nullable(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")),
  internalNotes: z.string().max(4000, "Internal notes are too long."),
});

/** Details: bill-to, currency, VAT, validity and the internal notes. Any of them may stay empty on a draft. */
export async function saveQuotationDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = headerSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const { error } = await (await db()).rpc("crm_quote_save_header", {
    p_proposal: d.proposalId,
    p_patch: { currency: d.currency, vat_choice_id: d.vatChoiceId, bill_to_org_id: d.billToOrgId, validity_date: d.validityDate, internal_notes: d.internalNotes },
  });
  if (error) return fail(error.message);
  refresh(d.opportunityId, d.proposalId);
  return { error: null };
}

const milestoneSchema = z.array(z.object({ label: z.string().trim().min(1, "Every milestone needs a label"), kind: z.enum(["percent", "amount"]), value: z.string().trim(), due: z.string().trim().max(200).optional() }));
const clauseSchema = z.array(z.object({ title: z.string().trim().min(1, "Every clause needs a title").max(120), body: z.string().trim().min(1, "Every clause needs text").max(3000) })).max(40);
const json = (v: unknown) => { try { return JSON.parse(String(v ?? "[]")); } catch { return "invalid"; } };

/** Payment milestones and the terms clauses (both editable lists, saved together). A schedule that does not add up is refused at issue. */
export async function saveQuotationTerms(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ids = z.object({ opportunityId: uuid, proposalId: uuid, termsLabel: z.string().max(120).optional() }).safeParse(Object.fromEntries(formData));
  const ms = milestoneSchema.safeParse(json(formData.get("milestones")));
  const cl = clauseSchema.safeParse(json(formData.get("clauses")));
  if (!ids.success) return { error: "Missing quotation." };
  if (!ms.success) return { error: firstIssue(ms.error) };
  if (!cl.success) return { error: firstIssue(cl.error) };
  const { error } = await (await db()).rpc("crm_quote_save_header", {
    p_proposal: ids.data.proposalId,
    p_patch: { milestones: ms.data.map((m) => ({ ...m, due: m.due || null })), terms: cl.data, terms_label: ids.data.termsLabel ?? null },
  });
  if (error) return fail(error.message);
  refresh(ids.data.opportunityId, ids.data.proposalId);
  return { error: null };
}

export async function saveQuotationSection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ opportunityId: uuid, proposalId: uuid, sectionId: nullable(uuid), title: z.string().trim().min(1, "Give the section a name").max(120, "The section name is too long") }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await db()).rpc("crm_quote_save_section", { p_proposal: p.data.proposalId, p_section: p.data.sectionId, p_title: p.data.title });
  if (error) return fail(error.message);
  refresh(p.data.opportunityId, p.data.proposalId);
  return { error: null };
}

export async function deleteQuotationSection(opportunityId: string, proposalId: string, sectionId: string): Promise<ActionState> {
  if (![opportunityId, proposalId, sectionId].every((x) => uuid.safeParse(x).success)) return { error: "Missing section." };
  const { error } = await (await db()).rpc("crm_quote_delete_section", { p_section: sectionId });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

const lineSchema = z.object({
  opportunityId: uuid, proposalId: uuid, sectionId: uuid, lineId: nullable(uuid),
  description: z.string().trim().min(1, "Describe the item").max(4000, "The description is too long"),
  unit: z.string().trim().max(20, "The unit is too long"),
  quantity: z.string().trim().regex(/^\d{1,11}(\.\d{1,3})?$/, "Quantity must be a number above zero (at most 3 decimals)").refine((v) => Number(v) > 0, "Quantity must be above zero"),
  unitPrice: z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "The unit price must be zero or more (at most 4 decimals), not negative"),
  vatChoiceId: nullable(uuid),
});

/** Adds or changes one item (the number is automatic). The picture is attached separately so a failed upload never loses the typed text. */
export async function saveQuotationLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = lineSchema.safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const { error } = await (await db()).rpc("crm_quote_save_line", {
    p_proposal: d.proposalId, p_line: d.lineId, p_section: d.sectionId,
    p_patch: { description: d.description, unit: d.unit, quantity: d.quantity, unit_price: d.unitPrice, vat_choice_id: d.vatChoiceId },
  });
  if (error) return fail(error.message);
  refresh(d.opportunityId, d.proposalId);
  return { error: null };
}

export async function deleteQuotationLine(opportunityId: string, proposalId: string, lineId: string): Promise<ActionState> {
  if (![opportunityId, proposalId, lineId].every((x) => uuid.safeParse(x).success)) return { error: "Missing item." };
  const { error } = await (await db()).rpc("crm_quote_delete_line", { p_line: lineId });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/** Attaches (or, with no file, removes) the picture of one item. The file must already have passed the CRM upload checks; the database repeats the type and size limits. */
export async function setQuotationLineImage(opportunityId: string, proposalId: string, lineId: string, sectionId: string, fileId: string | null): Promise<ActionState> {
  if (![opportunityId, proposalId, lineId, sectionId].every((x) => uuid.safeParse(x).success) || (fileId !== null && !uuid.safeParse(fileId).success)) return { error: "Missing item." };
  const { error } = await (await db()).rpc("crm_quote_save_line", { p_proposal: proposalId, p_line: lineId, p_section: sectionId, p_patch: { image_file_id: fileId } });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/** Moves a section (kind "sections") or an item inside its section (kind "lines", scope = the section) to the given order. */
export async function reorderQuotation(opportunityId: string, proposalId: string, kind: "sections" | "lines", scope: string | null, ids: string[]): Promise<ActionState> {
  if (![opportunityId, proposalId, ...ids].every((x) => uuid.safeParse(x).success) || (kind === "lines" && !uuid.safeParse(scope).success)) return { error: "Missing list." };
  const { error } = await (await db()).rpc("crm_quote_reorder", { p_proposal: proposalId, p_kind: kind, p_scope: scope, p_ids: ids });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/** The existing commercial approval request (crm_request_approval), tied to this quotation. */
export async function requestQuotationApproval(opportunityId: string, proposalId: string): Promise<ActionState> {
  if (![opportunityId, proposalId].every((x) => uuid.safeParse(x).success)) return { error: "Missing quotation." };
  const { error } = await (await db()).rpc("crm_request_approval", { p_opportunity_id: opportunityId, p_proposal_id: proposalId });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/** Issue: freezes the client-facing copy. Nothing is sent to anyone from here. */
export async function issueQuotation(opportunityId: string, proposalId: string): Promise<ActionState> {
  if (![opportunityId, proposalId].every((x) => uuid.safeParse(x).success)) return { error: "Missing quotation." };
  const { error } = await (await db()).rpc("crm_quote_issue", { p_proposal: proposalId });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/** A new draft copy of an issued quotation (same reference, next revision). */
export async function createQuotationRevision(opportunityId: string, proposalId: string): Promise<ActionState & { proposalId?: string }> {
  if (![opportunityId, proposalId].every((x) => uuid.safeParse(x).success)) return { error: "Missing quotation." };
  const { data, error } = await (await db()).rpc("crm_quote_create_revision", { p_proposal: proposalId });
  if (error || !data) return fail(error?.message ?? "Could not create the revision.");
  refresh(opportunityId, proposalId);
  return { error: null, proposalId: data as string };
}

// ---- Company-level defaults (Sales settings) ----------------------------------------------------------------------------------------

export async function saveVatChoice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({
    companyId: uuid, id: nullable(uuid), label: z.string().trim().min(1, "Give the choice a name").max(60), kind: z.enum(["rate", "out_of_scope"]),
    rate: z.string().trim().optional(), active: z.string().optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (d.kind === "rate" && !/^\d{1,3}(\.\d{1,2})?$/.test(d.rate ?? "")) return { error: "Enter the VAT rate as a number, e.g. 5 or 7.5." };
  if (d.kind === "rate" && Number(d.rate) > 100) return { error: "A VAT rate cannot be above 100." };
  const { error } = await (await db()).rpc("crm_save_vat_choice", { p_company: d.companyId, p_id: d.id, p_label: d.label, p_kind: d.kind, p_rate: d.kind === "rate" ? Number(d.rate) : null, p_active: d.active !== "off" });
  if (error) return fail(error.message);
  revalidatePath("/sales/settings");
  return { error: null };
}

export async function saveTermsTemplate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ids = z.object({ companyId: uuid, label: z.string().trim().max(120) }).safeParse(Object.fromEntries(formData));
  const cl = clauseSchema.min(1, "Keep at least one clause").safeParse(json(formData.get("clauses")));
  if (!ids.success) return { error: "Missing company." };
  if (!cl.success) return { error: firstIssue(cl.error) };
  const { error } = await (await db()).rpc("crm_save_terms_template", { p_company: ids.data.companyId, p_label: ids.data.label, p_clauses: cl.data });
  if (error) return fail(error.message);
  revalidatePath("/sales/settings");
  return { error: null };
}

