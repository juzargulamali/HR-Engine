import { QUOTATION_CURRENCIES, calculateQuotation, isUnsectionedTitle, unsectionedFirst, QuotationInputError, type CalculatedQuotation, type PaymentMilestone, type QuotationVat } from "@enginious-hr/domain";
import type { EstimateDraftInput } from "@/lib/actions/quotations";
import { toVat, type QuotationHeader, type QuotationLineRow, type QuotationSectionRow, type VatChoiceRow } from "./model";

/**
 * The estimate builder's working copy (client side). Pure functions only, so the rules are unit-tested without a browser:
 * what is dirty, what is invalid, the live totals (the SAME `calculateQuotation` the database mirrors) and the payload of "Save draft".
 */
export interface RowState {
  /** Stable client key (a saved item keeps its id as its key; a new one gets `new-n`). */
  key: string;
  /** The saved item id, or null for a row that has never been saved. */
  id: string | null;
  /** The section id, or null for an item outside any section (the hidden default section is chosen by the server). */
  sectionId: string | null;
  description: string; unit: string; quantity: string; unitPrice: string; vatChoiceId: string;
  /** What the database holds for this row (null for a new row), to tell whether it changed. */
  saved: { description: string; unit: string; quantity: string; unitPrice: string; vatChoiceId: string } | null;
}
export interface DetailsState { billToOrgId: string; currency: string; vatChoiceId: string; reviewPricingAfter: string }
export interface NotesState { internalNotes: string; assumptions: string; nextSteps: string; exclusions: { title: string; body: string }[]; milestones: PaymentMilestone[] }

const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const PRICE = /^\d{1,12}(\.\d{1,4})?$/;

export function rowsFromServer(lines: readonly QuotationLineRow[], sections: readonly QuotationSectionRow[]): RowState[] {
  const bySection = new Map(sections.map((s) => [s.id, s]));
  const order = new Map(unsectionedFirst([...sections].sort((a, b) => a.position - b.position)).map((s, i) => [s.id, i]));
  return [...lines]
    .sort((a, b) => (order.get(a.section_id) ?? 0) - (order.get(b.section_id) ?? 0) || a.position - b.position)
    .map((l) => {
      const f = { description: l.description, unit: l.unit ?? "", quantity: String(l.quantity), unitPrice: String(l.unit_price), vatChoiceId: l.vat_choice_id ?? "" };
      const sec = bySection.get(l.section_id);
      return { key: l.id, id: l.id, sectionId: sec && isUnsectionedTitle(sec.title) ? null : l.section_id, ...f, saved: f };
    });
}

export const isBlankNewRow = (r: RowState): boolean => r.id === null && !r.description.trim() && !r.quantity.trim() && !r.unitPrice.trim();
export function isRowDirty(r: RowState): boolean {
  if (isBlankNewRow(r)) return false;
  if (!r.saved) return true;
  return r.description !== r.saved.description || r.unit !== r.saved.unit || r.quantity !== r.saved.quantity || r.unitPrice !== r.saved.unitPrice || r.vatChoiceId !== r.saved.vatChoiceId;
}
/** A sentence when the row cannot be saved as typed (the server repeats every check), otherwise null. */
export function rowIssue(r: RowState): string | null {
  if (isBlankNewRow(r)) return null;
  if (!r.description.trim()) return "Describe the item.";
  if (!QTY.test(r.quantity.trim()) || Number(r.quantity) <= 0) return "Quantity must be a number above zero.";
  if (!PRICE.test(r.unitPrice.trim())) return "Enter the unit price (zero or more).";
  return null;
}

export interface LiveSection { id: string | null; title: string; unsectioned: boolean }
/** Live figures from the typed values. A row that cannot be calculated yet counts as zero (it is flagged on screen); sections follow `sections` order, loose items first. */
export function liveCalc(rows: readonly RowState[], sections: readonly QuotationSectionRow[], currency: string, vat: QuotationVat | null, vatChoices: readonly VatChoiceRow[]): { calc: CalculatedQuotation; numbers: Map<string, string> } {
  const choice = (id: string) => { const v = vatChoices.find((x) => x.id === id); return v ? toVat(v.kind, v.label, v.rate) : null; };
  const loose = sections.find((s) => isUnsectionedTitle(s.title));
  const groups: { id: string | null; title: string; unsectioned: boolean; rows: RowState[] }[] = [
    { id: loose?.id ?? null, title: loose?.title ?? "(no section)", unsectioned: true, rows: rows.filter((r) => r.sectionId === null && !isBlankNewRow(r)) },
    ...[...sections].filter((s) => !isUnsectionedTitle(s.title)).sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, title: s.title, unsectioned: false, rows: rows.filter((r) => r.sectionId === s.id && !isBlankNewRow(r)) })),
  ].filter((g) => !g.unsectioned || g.rows.length > 0);
  let calc: CalculatedQuotation;
  try {
    calc = calculateQuotation({
      currency: QUOTATION_CURRENCIES.includes(currency as never) ? currency : null,
      vat,
      sections: groups.map((g) => ({ ...(g.id ? { id: g.id } : {}), title: g.title, ...(g.unsectioned ? { unsectioned: true } : {}),
        lines: g.rows.map((r) => (rowIssue(r)
          ? { id: r.key, quantity: "1", unitPrice: "0", vat: null }   // not calculable yet: counts as zero (and is flagged on screen)
          : { id: r.key, quantity: r.quantity.trim(), unitPrice: r.unitPrice.trim(), vat: r.vatChoiceId ? choice(r.vatChoiceId) : null })) })),
    });
  } catch (e) {
    if (!(e instanceof QuotationInputError)) throw e;
    calc = calculateQuotation({ currency: null, vat: null, sections: [] });
  }
  const numbers = new Map<string, string>();
  for (const s of calc.sections) for (const l of s.lines) if (l.id) numbers.set(l.id, l.number);
  return { calc, numbers };
}

export const initialDetails = (h: QuotationHeader, suggestedBillTo: string, suggestedCurrency: string): DetailsState => ({
  billToOrgId: h.bill_to_org_id ?? suggestedBillTo, currency: h.currency ?? suggestedCurrency, vatChoiceId: h.vat_choice_id ?? "", reviewPricingAfter: h.validity_date ?? "",
});
export const savedDetails = (h: QuotationHeader): DetailsState => ({ billToOrgId: h.bill_to_org_id ?? "", currency: h.currency ?? "", vatChoiceId: h.vat_choice_id ?? "", reviewPricingAfter: h.validity_date ?? "" });

/** The body of "Save draft": everything typed, and only the rows that changed or are new. */
export function buildDraftPayload(ids: { opportunityId: string; proposalId: string }, details: DetailsState, notes: NotesState, rows: readonly RowState[]): EstimateDraftInput {
  return {
    opportunityId: ids.opportunityId, proposalId: ids.proposalId,
    details: { billToOrgId: details.billToOrgId || null, currency: (details.currency || null) as never, vatChoiceId: details.vatChoiceId || null, reviewPricingAfter: details.reviewPricingAfter || null },
    notes: { internalNotes: notes.internalNotes, assumptions: notes.assumptions, nextSteps: notes.nextSteps, exclusions: notes.exclusions, milestones: notes.milestones.map((m) => ({ ...m, due: m.due ?? "" })) },
    lines: rows.filter((r) => !isBlankNewRow(r) && isRowDirty(r)).map((r) => ({
      key: r.key, id: r.id, sectionId: r.sectionId, description: r.description, unit: r.unit, quantity: r.quantity.trim(), unitPrice: r.unitPrice.trim(), vatChoiceId: r.vatChoiceId || null,
    })),
  };
}

/**
 * After a save (complete or partly failed): every row the server reports as written takes its saved id and its baseline becomes what was SENT (not what is typed now),
 * so an edit made while the save was running still counts as unsaved and is saved by the next run. A row keeps its client key (the screen does not remount it, so a
 * person typing in it never loses focus), and a blank new row is left alone. Only rows listed in `created` change: a row the server did not write stays unsaved.
 */
export function applyWritten(rows: readonly RowState[], sent: EstimateDraftInput["lines"], created: Record<string, string>): RowState[] {
  const sentByKey = new Map((sent ?? []).map((l) => [l.key, l]));
  return rows.map((r) => {
    const id = created[r.key];
    const l = sentByKey.get(r.key);
    if (!id || !l) return r;
    return { ...r, id, saved: { description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, vatChoiceId: String(l.vatChoiceId ?? "") } };
  });
}

/** Rows that can be saved as typed (complete) and rows kept on screen because they are incomplete; both count only rows that differ from what is saved. */
export function splitRows(rows: readonly RowState[]): { ready: RowState[]; incomplete: { row: RowState; issue: string }[] } {
  const incomplete = rows.flatMap((row) => { const issue = isRowDirty(row) ? rowIssue(row) : null; return issue ? [{ row, issue }] : []; });
  const bad = new Set(incomplete.map((x) => x.row.key));
  return { ready: rows.filter((r) => !bad.has(r.key)), incomplete };
}
