"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CLIENT_NOTE_MAX, ESTIMATE_FORMAT_MARKER, QUOTATION_CURRENCIES, UNSECTIONED_TITLE, clausesToNotes, isUnsectionedTitle, notesToClauses } from "@enginious-hr/domain";
import { loadQuotation } from "@/lib/crm/quotations/data";
import { calculate } from "@/lib/crm/quotations/model";
import { estimateWording } from "@/lib/crm/quotations/wording";
import { pinAssets } from "@/lib/crm/quotations/pin-assets";
import { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "@/lib/crm/errors";
import type { ActionState } from "./companies";

/**
 * Estimate server actions. Thin wrappers over the crm_quote_* database functions (migration 20261220000100, applied and unchanged): the function, not
 * this file, decides who may edit or finalise (the enquiry owner or a founder, company scoped), refuses edits to a finalised estimate and applies
 * the approval gate, so a forged request gets the same refusal. This layer parses the input, writes the estimate format marker, and turns database
 * errors into sentences that say Estimate (the functions still say quotation: `estimateWording`).
 */

const uuid = z.string().uuid();
const fail = (message: string): ActionState => ({ error: estimateWording(friendlyCrmError(message)) });
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
  const client = await db();
  const { data, error } = await client.rpc("crm_quote_create", { p_opportunity: p.data.opportunityId });
  if (error || !data) return fail(error?.message ?? "Could not create the estimate.");
  // The database copies the company's standard terms into every new draft; an estimate prints none of them. Mark the draft as an estimate and clear the copy now.
  // Best effort: saving the draft, requesting approval and finalising all repeat this (`ensureEstimateFormat`), so a failure here loses nothing.
  const marked = await client.rpc("crm_quote_save_header", { p_proposal: data as string, p_patch: { terms_label: ESTIMATE_FORMAT_MARKER, terms: [] } });
  if (marked.error) console.error("[estimates] could not mark the new draft as an estimate", marked.error.message);
  refresh(p.data.opportunityId);
  redirect(`/sales/opportunities/${p.data.opportunityId}/quotations/${data as string}`);
}

/** Marks a draft as an estimate and drops everything but the two client notes from its `terms` (the historical standard terms never reach a client file). */
async function ensureEstimateFormat(proposalId: string): Promise<string | null> {
  const client = await db();
  const cur = await client.from("crm_quotations").select("terms_label, terms").eq("proposal_id", proposalId).maybeSingle();
  if (cur.error || !cur.data) return "Could not check the estimate, so nothing was changed. Try again.";
  const row = cur.data as { terms_label: string | null; terms: { title: string; body: string }[] };
  const clauses = notesToClauses(clausesToNotes(row.terms));
  if (row.terms_label === ESTIMATE_FORMAT_MARKER && JSON.stringify(clauses) === JSON.stringify(row.terms)) return null;
  const { error } = await client.rpc("crm_quote_save_header", { p_proposal: proposalId, p_patch: { terms_label: ESTIMATE_FORMAT_MARKER, terms: clauses } });
  return error ? fail(error.message).error : null;
}

const nullableId = z.preprocess(blankToNull, uuid.nullable());
const clauseSchema = z.array(z.object({ title: z.string().trim().min(1, "Every exclusion needs a title").max(120), body: z.string().trim().min(1, "Every exclusion needs text").max(3000) })).max(40);
const milestoneSchema = z.array(z.object({ label: z.string().trim().min(1, "Every payment line needs a label"), kind: z.enum(["percent", "amount"]), value: z.string().trim(), due: z.string().trim().max(200).optional().nullable() })).max(20);

const draftLineSchema = z.object({
  key: z.string().min(1).max(64), id: nullableId, sectionId: nullableId,
  description: z.string().trim().min(1, "Describe the item").max(4000, "The description is too long"),
  unit: z.string().trim().max(20, "The unit is too long"),
  quantity: z.string().trim().regex(/^\d{1,11}(\.\d{1,3})?$/, "Quantity must be a number above zero (at most 3 decimals)").refine((v) => Number(v) > 0, "Quantity must be above zero"),
  unitPrice: z.string().trim().regex(/^\d{1,12}(\.\d{1,4})?$/, "The unit price must be zero or more (at most 4 decimals), not negative"),
  vatChoiceId: nullableId,
});
const draftSchema = z.object({
  opportunityId: uuid, proposalId: uuid,
  details: z.object({
    billToOrgId: nullableId,
    currency: z.preprocess(blankToNull, z.enum(QUOTATION_CURRENCIES, { message: "Choose one of AED, SAR, PLN, EUR or USD." }).nullable()),
    vatChoiceId: nullableId,
    reviewPricingAfter: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullable()),
  }),
  notes: z.object({
    internalNotes: z.string().max(4000, "Internal notes are too long."),
    assumptions: z.string().max(CLIENT_NOTE_MAX, `Assumptions are too long (${CLIENT_NOTE_MAX} characters at most).`),
    nextSteps: z.string().max(CLIENT_NOTE_MAX, `Next steps are too long (${CLIENT_NOTE_MAX} characters at most).`),
    exclusions: clauseSchema,
    milestones: milestoneSchema,
  }),
  lines: z.array(draftLineSchema).max(500),
});
export type EstimateDraftInput = z.input<typeof draftSchema>;
export interface EstimateSaveResult { error: string | null; /** client key -> saved item id, for every item written before any failure (so a retry never creates it twice) */ created: Record<string, string> }

/**
 * THE save of the builder ("Save draft"): the details, the optional notes and every changed or new item, in this order. Everything is validated first, so bad input
 * saves nothing. The result says `error: null` ONLY when every write succeeded (the screen then says Saved); on a failure it says what could not be saved, and the ids
 * of the items already written, so pressing Save again never duplicates an item. An item with no section goes into the hidden default section (created on demand,
 * never printed). Who may save, the freeze and every limit are enforced by the database functions.
 */
export async function saveEstimateDraft(input: EstimateDraftInput): Promise<EstimateSaveResult> {
  const p = draftSchema.safeParse(input);
  if (!p.success) {
    const issue = p.error.issues[0];
    const at = issue?.path[0] === "lines" && typeof issue.path[1] === "number" ? ((input as { lines?: { description?: string }[] }).lines?.[issue.path[1]]?.description ?? "").trim().slice(0, 40) : "";
    return { error: `${at ? `Item “${at}”: ` : issue?.path[0] === "lines" ? "An item: " : ""}${issue?.message ?? "Invalid input."}`, created: {} };
  }
  const d = p.data;
  const client = await db();
  const header = await client.rpc("crm_quote_save_header", {
    p_proposal: d.proposalId,
    p_patch: {
      currency: d.details.currency, vat_choice_id: d.details.vatChoiceId, bill_to_org_id: d.details.billToOrgId, validity_date: d.details.reviewPricingAfter,
      internal_notes: d.notes.internalNotes,
      milestones: d.notes.milestones.map((m) => ({ ...m, due: m.due || null })),
      exclusions: d.notes.exclusions,
      terms: notesToClauses({ assumptions: d.notes.assumptions, nextSteps: d.notes.nextSteps }),
      terms_label: ESTIMATE_FORMAT_MARKER,
    },
  });
  if (header.error) return { error: fail(header.error.message).error, created: {} };
  const created: Record<string, string> = {};
  let looseSection: string | null = null;
  for (const l of d.lines) {
    let section = l.sectionId;
    if (!section) {
      if (!looseSection) {
        const found = await client.from("crm_quotation_sections").select("id, title").eq("proposal_id", d.proposalId);
        if (found.error) return { error: "Could not check the sections, so the remaining items were not saved. Try again.", created };
        looseSection = ((found.data ?? []) as { id: string; title: string }[]).find((x) => isUnsectionedTitle(x.title))?.id ?? null;
        if (!looseSection) {
          const made = await client.rpc("crm_quote_save_section", { p_proposal: d.proposalId, p_section: null, p_title: UNSECTIONED_TITLE });
          if (made.error || !made.data) return { error: fail(made.error?.message ?? "Could not add the item.").error, created };
          looseSection = made.data as string;
        }
      }
      section = looseSection;
    }
    const r = await client.rpc("crm_quote_save_line", {
      p_proposal: d.proposalId, p_line: l.id, p_section: section,
      p_patch: { description: l.description, unit: l.unit, quantity: l.quantity, unit_price: l.unitPrice, vat_choice_id: l.vatChoiceId },
    });
    if (r.error) return { error: `Item “${l.description.slice(0, 40)}” could not be saved: ${fail(r.error.message).error}`, created };
    created[l.key] = (r.data as string | null) ?? l.id ?? "";
  }
  refresh(d.opportunityId, d.proposalId);
  return { error: null, created };
}

export async function saveQuotationSection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ opportunityId: uuid, proposalId: uuid, sectionId: nullable(uuid), title: z.string().trim().min(1, "Give the section a name").max(120, "The section name is too long") }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: firstIssue(p.error) };
  if (isUnsectionedTitle(p.data.title)) return { error: "That name is reserved. Choose another section name." };
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

/** Removes an empty hidden default section once its last item is deleted (the database refuses to finalise an empty section). */
async function dropEmptyLooseSection(proposalId: string): Promise<void> {
  const client = await db();
  const secs = await client.from("crm_quotation_sections").select("id, title").eq("proposal_id", proposalId);
  const lines = await client.from("crm_quotation_lines").select("section_id").eq("proposal_id", proposalId);
  if (secs.error || lines.error) return;
  const used = new Set(((lines.data ?? []) as { section_id: string }[]).map((l) => l.section_id));
  for (const s of (secs.data ?? []) as { id: string; title: string }[]) if (isUnsectionedTitle(s.title) && !used.has(s.id)) await client.rpc("crm_quote_delete_section", { p_section: s.id });
}

export async function deleteQuotationLine(opportunityId: string, proposalId: string, lineId: string): Promise<ActionState> {
  if (![opportunityId, proposalId, lineId].every((x) => uuid.safeParse(x).success)) return { error: "Missing item." };
  const { error } = await (await db()).rpc("crm_quote_delete_line", { p_line: lineId });
  if (error) return fail(error.message);
  await dropEmptyLooseSection(proposalId);
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

/** Requests approval of THIS version (crm_quote_request_approval). A waiting request for an older version is withdrawn first. */
export async function requestQuotationApproval(opportunityId: string, proposalId: string): Promise<ActionState> {
  if (![opportunityId, proposalId].every((x) => uuid.safeParse(x).success)) return { error: "Missing estimate." };
  // An old draft is brought into the estimate format BEFORE its version is fingerprinted, so the approval is bound to what will actually be finalised.
  const formatError = await ensureEstimateFormat(proposalId);
  if (formatError) return { error: formatError };
  const { error } = await (await db()).rpc("crm_quote_request_approval", { p_proposal: proposalId });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/**
 * A founder's decision from the reviewer screen. `seenHash` is the version fingerprint the screen was rendered with: approving a version that changed after the
 * screen was opened is refused by the database ("This quotation changed after you opened it ...").
 */
export async function decideQuotationApproval(opportunityId: string, proposalId: string, approvalId: string, decision: "approved" | "changes_requested", instruction: string, seenHash: string): Promise<ActionState> {
  if (![opportunityId, proposalId, approvalId].every((x) => uuid.safeParse(x).success) || !["approved", "changes_requested"].includes(decision)) return { error: "Missing estimate." };
  const { error } = await (await db()).rpc("crm_quote_decide_approval", { p_approval: approvalId, p_state: decision, p_instruction: instruction.trim() || null, p_seen_hash: seenHash });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/**
 * Finalise: pins the logo and item pictures (immutable copies owned by this revision), then freezes the client-facing copy. Finalising reserves nothing, records
 * nothing as sent, moves no enquiry stage and creates no follow-up: the database function only freezes this revision (and supersedes earlier ones of the same
 * reference). Nothing is sent to anyone from here.
 */
export async function issueQuotation(opportunityId: string, proposalId: string): Promise<ActionState> {
  if (![opportunityId, proposalId].every((x) => uuid.safeParse(x).success)) return { error: "Missing estimate." };
  let bundle: Awaited<ReturnType<typeof loadQuotation>>;
  try { bundle = await loadQuotation(proposalId); } catch { return { error: "Could not load this estimate, so nothing was finalised. Try again." }; }
  if (!bundle || bundle.header.opportunity_id !== opportunityId) return { error: "Estimate not found." };
  const formatError = await ensureEstimateFormat(proposalId);
  if (formatError) return { error: formatError };
  const numbers = new Map<string, string>();
  for (const sec of calculate(bundle.header, bundle.sections, bundle.lines).sections) for (const l of sec.lines) if (l.id) numbers.set(l.id, l.number);
  const files = new Map(bundle.files.map((f) => [f.id, f]));
  const pinned = await pinAssets({
    proposalId,
    logo: bundle.issuer.logo_path ? { bucket: "company-logos", path: bundle.issuer.logo_path } : null,
    lines: bundle.lines.flatMap((l) => { const f = l.image_file_id ? files.get(l.image_file_id) : undefined; return f?.storage_path ? [{ lineId: l.id, position: numbers.get(l.id) ?? "", bucket: "crm-files" as const, path: f.storage_path }] : []; }),
  });
  if ("error" in pinned) return { error: pinned.error };
  const { error } = await (await db()).rpc("crm_quote_issue", { p_proposal: proposalId, p_assets: pinned.assets });
  if (error) return fail(error.message);
  refresh(opportunityId, proposalId);
  return { error: null };
}

/** A new draft copy of a finalised estimate (same reference, next revision). */
export async function createQuotationRevision(opportunityId: string, proposalId: string): Promise<ActionState & { proposalId?: string }> {
  if (![opportunityId, proposalId].every((x) => uuid.safeParse(x).success)) return { error: "Missing estimate." };
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
