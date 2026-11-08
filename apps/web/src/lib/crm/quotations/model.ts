import { QUOTATION_CURRENCIES, calculateQuotation, isUnsectionedTitle, unsectionedFirst, validateMilestones, type CalculatedQuotation, type PaymentMilestone, type QuotationInput, type QuotationVat } from "@enginious-hr/domain";

/** Row shapes of the quotation tables (migration 20261220000100). Hand-written like types/crm.ts; every write is a crm_quote_* function. */
export interface QuotationHeader {
  proposal_id: string; opportunity_id: string; company_id: string; reference: string; revision: number; previous_proposal_id: string | null;
  currency: string | null; vat_choice_id: string | null; vat_kind: "rate" | "out_of_scope" | null; vat_label: string | null; vat_rate: number | string | null;
  bill_to_org_id: string | null; validity_date: string | null; issue_date: string | null;
  milestones: PaymentMilestone[]; terms_label: string | null; terms: { title: string; body: string }[]; exclusions: { title: string; body: string }[];
  /** INTERNAL ONLY: never printed, never in the snapshot, never exported. */
  internal_notes: string | null;
  content_changed_at: string; issued_at: string | null; issued_by: string | null;
}
export interface QuotationSectionRow { id: string; proposal_id: string; position: number; title: string }
export interface QuotationLineRow {
  id: string; proposal_id: string; section_id: string; position: number; description: string; image_file_id: string | null; unit: string | null;
  quantity: number | string; unit_price: number | string; vat_choice_id: string | null; vat_kind: "rate" | "out_of_scope" | null; vat_label: string | null; vat_rate: number | string | null;
}
export interface VatChoiceRow { id: string; company_id: string; label: string; kind: "rate" | "out_of_scope"; rate: number | string | null; position: number; active: boolean }

export type QuotationState = "draft" | "awaiting_approval" | "issued" | "superseded";
/** What a person reads. The internal key `issued` is the frozen state; the word on screen is Finalised (estimate only). */
export const QUOTATION_STATE_LABEL: Record<QuotationState, string> = { draft: "Draft", awaiting_approval: "Draft, awaiting approval", issued: "Finalised", superseded: "Superseded" };

export function quotationState(h: Pick<QuotationHeader, "issued_at">, proposalStatus: string, hasPendingApproval: boolean): QuotationState {
  if (h.issued_at) return proposalStatus === "superseded" ? "superseded" : "issued";
  return hasPendingApproval ? "awaiting_approval" : "draft";
}

export const toVat = (kind: string | null, label: string | null, rate: number | string | null): QuotationVat | null =>
  kind === "out_of_scope" ? { kind, label: label ?? "Out of scope" } : kind === "rate" && rate != null ? { kind, rate: String(rate), label: label ?? `${rate}%` } : null;

/** The calculation input of a loaded quotation, in display order: the SAME function the database mirrors and the exports render from. */
export function calcInput(h: QuotationHeader, sections: readonly QuotationSectionRow[], lines: readonly QuotationLineRow[]): QuotationInput {
  return {
    currency: h.currency,
    vat: toVat(h.vat_kind, h.vat_label, h.vat_rate),
    // The hidden default section (items outside any section) always comes first; it is numbered 1, 2, 3 and never printed as a section.
    sections: unsectionedFirst([...sections].sort((a, b) => a.position - b.position)).map((s) => ({
      id: s.id, title: s.title, ...(isUnsectionedTitle(s.title) ? { unsectioned: true } : {}),
      lines: lines.filter((l) => l.section_id === s.id).sort((a, b) => a.position - b.position).map((l) => ({ id: l.id, quantity: l.quantity, unitPrice: l.unit_price, vat: toVat(l.vat_kind, l.vat_label, l.vat_rate) })),
    })),
  };
}

export function calculate(h: QuotationHeader, sections: readonly QuotationSectionRow[], lines: readonly QuotationLineRow[]): CalculatedQuotation {
  return calculateQuotation(calcInput(h, sections, lines));
}

export interface ApprovalLite { id?: string; quote_content_hash?: string | null; proposal_id: string | null; state: "pending" | "approved" | "changes_requested"; decided_at: string | null; requested_at: string }
export type ApprovalPolicy = "not_configured" | "not_required" | "required";

/**
 * Whether an approval of THIS exact version exists: decided 'approved' and bound (when it was requested from the quotation page) to the content hash the
 * quotation has NOW. An edit after the request or the decision changes the hash and voids it. Mirrors crm_quote_issue.
 */
export function hasValidApproval(h: Pick<QuotationHeader, "proposal_id">, approvals: readonly ApprovalLite[], contentHash: string | null): boolean {
  return !!contentHash && approvals.some((a) => a.proposal_id === h.proposal_id && a.state === "approved" && a.quote_content_hash === contentHash);
}

/** A waiting request that was bound to an older version (the quotation changed since): it can no longer be approved; a fresh request is needed. */
export function pendingApprovalIsStale(h: Pick<QuotationHeader, "proposal_id">, approvals: readonly ApprovalLite[], contentHash: string | null): boolean {
  return approvals.some((a) => a.proposal_id === h.proposal_id && a.state === "pending" && a.quote_content_hash !== contentHash);
}

/** What still stands between this draft and finalising it (the database repeats every check). Empty = ready. */
export function issueBlockers(h: QuotationHeader, sections: readonly QuotationSectionRow[], lines: readonly QuotationLineRow[], approvals: readonly ApprovalLite[], policy: ApprovalPolicy, today: string, contentHash: string | null = null): string[] {
  const out: string[] = [];
  if (!h.currency) out.push("Choose the currency.");
  if (!h.vat_kind) out.push("Choose the VAT treatment.");
  if (!h.bill_to_org_id) out.push("Choose and confirm who this estimate is addressed to.");
  if (lines.length === 0) out.push("Add at least one item.");
  if (sections.some((s) => !lines.some((l) => l.section_id === s.id))) out.push("A section has no items: add items or delete it.");
  if (h.validity_date && h.validity_date < today) out.push("The review-pricing date is in the past.");
  if (h.currency && h.vat_kind && lines.length > 0 && h.milestones.length > 0) {
    const msg = validateMilestones(h.milestones, calculate(h, sections, lines).gross);
    if (msg) out.push(msg);
  }
  if (policy === "required" && !hasValidApproval(h, approvals, contentHash)) {
    const waiting = approvals.some((a) => a.proposal_id === h.proposal_id && a.state === "pending");
    out.push(waiting && !pendingApprovalIsStale(h, approvals, contentHash) ? "Waiting for approval." : "Request approval of the current version (an edit after a request or an approval voids it).");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Builder helpers (estimates only)
// ---------------------------------------------------------------------------------------------------------------------------------
export type RecipientParty = { id: string; name: string };
export type RecipientSuggestion =
  | { kind: "single"; orgId: string; role: "agency" | "client"; reason: string }
  | { kind: "choose"; reason: string }
  | { kind: "none"; reason: string };

/**
 * Who this estimate is addressed to, as a SUGGESTION only: exactly one linked party is pre-selected with the reason shown; when both an agency and an end
 * client are linked there is no default and the person must choose; the person still confirms the recipient before finalising.
 */
export function suggestRecipient(agency: RecipientParty | null, client: RecipientParty | null): RecipientSuggestion {
  if (agency && client) return { kind: "choose", reason: "An agency and an end client are both linked to this enquiry. Choose who this estimate is addressed to." };
  if (agency) return { kind: "single", orgId: agency.id, role: "agency", reason: "Only the agency is linked to this enquiry." };
  if (client) return { kind: "single", orgId: client.id, role: "client", reason: "Only the end client is linked to this enquiry." };
  return { kind: "none", reason: "No agency or end client is linked to this enquiry. Choose an organisation." };
}

/** The enquiry's currency when it is one an estimate can use (never guessed from a country); the person can change it. */
export function prefillCurrency(enquiryCurrency: string | null | undefined): string {
  const c = (enquiryCurrency ?? "").trim().toUpperCase();
  return (QUOTATION_CURRENCIES as readonly string[]).includes(c) ? c : "";
}
