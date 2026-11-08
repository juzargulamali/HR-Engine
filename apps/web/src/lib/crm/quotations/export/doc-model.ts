import {
  BUDGETARY_NOTICE, ESTIMATE_NOTICES, calculateQuotation, clausesToNotes, estimateFormatVersion, estimateNumbering, isUnsectionedTitle, milestoneAmounts, noteParagraphs,
  unsectionedFirst, type CalculatedQuotation, type PaymentMilestone, type QuotationSnapshot,
} from "@enginious-hr/domain";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { calcInput, type QuotationHeader, type QuotationLineRow, type QuotationSectionRow } from "../model";

/**
 * The ONE document model both exports (PDF and XLSX) are rendered from. It is built either from the FROZEN snapshot of an issued revision (never from any live
 * account, company or template row) or, for a draft, from the live draft through the same shared `calculateQuotation`. It contains only client-facing fields:
 * there is deliberately no field for internal notes, costs, margin or supplier prices, so an export cannot print what the model cannot hold.
 *
 * Two formats, decided per document, never per wording flag:
 *   - "estimate": every draft, and every snapshot finalised after the estimates-only change (its `terms.label` carries the server-set format marker). It prints the
 *     mandatory budgetary notice, "Estimate" wording, "Review pricing after", optional client notes and an indicative payment schedule, and none of the old terms.
 *   - "legacy": a snapshot WITHOUT the marker (a quotation issued before the change). It renders exactly as it was issued: same wording, same numbering stored in
 *     the snapshot, same terms. Historical documents are never rewritten.
 */
export interface DocImageRef { key: string; storagePath: string; bucket: "crm-files" | "quotation-assets" | "company-logos"; mime: string; sha256: string | null }
export interface DocLine {
  number: string; description: string; unit: string | null; quantity: string; unitPrice: string;
  /** Percent as text ("5", "15.5") when a rate applies; null for "Out of scope" / not chosen. */
  vatRate: string | null; vatLabel: string;
  net: string; vatAmount: string; gross: string;
  image: DocImageRef | null;
}
/** `number` and `title` are null for the hidden default section (items outside any section): no heading and no subtotal are printed for it. */
export interface DocSection { number: string | null; title: string | null; lines: DocLine[]; subtotalNet: string; subtotalVat: string; subtotalGross: string }
export interface DocMilestone { label: string; value: string; kind: "percent" | "amount"; due: string | null; amount: string }
export type DocFormat = "estimate" | "legacy";
export interface QuotationDocModel {
  /** "estimate" for drafts and for everything finalised after the estimates-only change; "legacy" for a quotation issued before it (rendered as issued). */
  format: DocFormat;
  /** The mandatory budgetary notice (estimate format only; null for a legacy document). Printed on page one above the BOQ and at the top of the Excel sheet. */
  notice: string | null;
  /** Optional client notes as paragraphs (estimate format only). Empty = the heading is not printed at all. */
  clientNotes: { assumptions: string[]; nextSteps: string[] };
  /** True only for an unfinalised draft: every export of it is marked Draft. */
  draft: boolean;
  reference: string;
  revision: number;
  issuer: { legalName: string; trn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logo: DocImageRef | null };
  billTo: { name: string; place: string | null; country: string | null; vatTrn: string | null; tradeLicence: string | null };
  enquiryTitle: string;
  enquiryReference: string;
  issueDate: string | null;
  validityDate: string | null;
  /** Currency code, or null on a draft that has none chosen yet. */
  currency: string | null;
  sections: DocSection[];
  totals: { net: string; vat: string; gross: string };
  milestones: DocMilestone[];
  /** Their own block (before the terms in a legacy document; under the Exclusions heading of an estimate). */
  exclusions: { title: string; body: string }[];
  /** Legacy documents only: the historical standard terms. An estimate has none (always empty). */
  terms: { label: string | null; clauses: { title: string; body: string }[] };
}

const blank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

export function modelFromSnapshot(s: QuotationSnapshot): QuotationDocModel {
  const version = estimateFormatVersion(s.terms?.label);
  const base = {
    reference: s.reference,
    revision: s.revision,
    issuer: { legalName: s.issuer.legal_name, trn: blank(s.issuer.trn), address: blank(s.issuer.address), phone: blank(s.issuer.phone), email: blank(s.issuer.email), website: blank(s.issuer.website), logo: s.issuer.logo ? { key: "logo", storagePath: s.issuer.logo.storage_path, bucket: s.issuer.logo.bucket, mime: s.issuer.logo.mime_type, sha256: s.issuer.logo.sha256 } : null },
    billTo: { name: s.bill_to.name, place: blank(s.bill_to.address), country: s.bill_to.country_code ? countryLabel(s.bill_to.country_code) : null, vatTrn: blank(s.bill_to.vat_trn), tradeLicence: blank(s.bill_to.trade_licence_no) },
    enquiryTitle: s.enquiry.title,
    enquiryReference: s.enquiry.reference,
    issueDate: s.issue_date,
    validityDate: s.validity_date,
    currency: s.currency,
    totals: { net: s.totals.net, vat: s.totals.vat, gross: s.totals.gross },
    milestones: s.milestones.map((m) => ({ label: m.label, kind: m.kind, value: m.value, due: blank(m.due), amount: m.amount })),
    exclusions: s.exclusions ?? [],
  };
  const line = (l: QuotationSnapshot["sections"][number]["lines"][number], number: string): DocLine => ({
    number, description: l.description, unit: blank(l.unit), quantity: l.quantity, unitPrice: l.unit_price,
    vatRate: l.vat.kind === "rate" ? l.vat.rate : null, vatLabel: l.vat.label,
    net: l.amount_net, vatAmount: l.vat_amount, gross: l.amount_gross,
    image: l.image ? { key: l.image.file_id, storagePath: l.image.storage_path, bucket: l.image.bucket, mime: l.image.mime_type, sha256: l.image.sha256 } : null,
  });
  if (version === null) {
    // A quotation issued before the estimates-only change: exactly as issued (stored numbers, stored terms, "Quotation" wording).
    return {
      ...base, format: "legacy", notice: null, clientNotes: { assumptions: [], nextSteps: [] }, draft: false,
      sections: s.sections.map((sec) => ({
        number: sec.number, title: sec.title, lines: sec.lines.map((l) => line(l, l.number)),
        subtotalNet: sec.subtotal_net, subtotalVat: sec.subtotal_vat, subtotalGross: sec.subtotal_gross,
      })),
      terms: { label: s.terms.label, clauses: s.terms.clauses },
    };
  }
  // An estimate: the notice of the version it was finalised under; numbers recomputed from the structure (items outside any section are 1, 2, 3).
  const ordered = unsectionedFirst(s.sections);
  const num = estimateNumbering(ordered.map((sec) => ({ unsectioned: isUnsectionedTitle(sec.title), lineCount: sec.lines.length })));
  const notes = clausesToNotes(s.terms.clauses);
  return {
    ...base, format: "estimate", notice: ESTIMATE_NOTICES[version]!, draft: false,
    clientNotes: { assumptions: noteParagraphs(notes.assumptions), nextSteps: noteParagraphs(notes.nextSteps) },
    sections: ordered.map((sec, si) => {
      const loose = isUnsectionedTitle(sec.title);
      return {
        number: num.section[si]!, title: loose ? null : sec.title, lines: sec.lines.map((l, li) => line(l, num.lines[si]![li]!)),
        subtotalNet: sec.subtotal_net, subtotalVat: sec.subtotal_vat, subtotalGross: sec.subtotal_gross,
      };
    }),
    terms: { label: null, clauses: [] },
  };
}

export interface DraftSource {
  header: QuotationHeader;
  sections: readonly QuotationSectionRow[];
  lines: readonly QuotationLineRow[];
  issuer: { legal_name: string; trn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logo_path: string | null };
  billTo: { name: string; place: string | null; country_code: string | null; vat_trn: string | null; trade_licence_no: string | null } | null;
  /** image file id -> stored file (only the fields an export needs). */
  files: readonly { id: string; storage_path: string | null; mime_type: string | null }[];
  enquiry: { reference: string; title: string };
}

/** The draft, computed with the same shared function the builder and the database mirror. Same shape as an issued one, flagged `draft`. */
export function modelFromDraft(d: DraftSource): QuotationDocModel {
  const h = d.header;
  const calc: CalculatedQuotation = calculateQuotation(calcInput(h, d.sections, d.lines));
  const byLine = new Map(d.lines.map((l) => [l.id, l]));
  const fileOf = new Map(d.files.map((f) => [f.id, f]));
  const num = estimateNumbering(calc.sections.map((cs) => ({ unsectioned: !!cs.unsectioned, lineCount: cs.lines.length })));
  const sections: DocSection[] = calc.sections.map((cs, si) => ({
    number: num.section[si]!,
    title: cs.unsectioned ? null : cs.title,
    lines: cs.lines.map((cl): DocLine => {
      const row = byLine.get(cl.id ?? "")!;
      const file = row.image_file_id ? fileOf.get(row.image_file_id) : undefined;
      return {
        number: cl.number, description: row.description, unit: blank(row.unit), quantity: cl.quantity, unitPrice: cl.unitPrice,
        vatRate: cl.vat?.kind === "rate" ? cl.vat.rate : null, vatLabel: cl.vat ? cl.vat.label : "Not chosen",
        net: cl.net, vatAmount: cl.vatAmount, gross: cl.gross,
        image: file?.storage_path ? { key: file.id, storagePath: file.storage_path, bucket: "crm-files", mime: file.mime_type ?? "", sha256: null } : null,
      };
    }),
    subtotalNet: cs.net, subtotalVat: cs.vat, subtotalGross: cs.gross,
  }));
  const milestones: PaymentMilestone[] = h.milestones ?? [];
  const amounts = milestoneAmounts(milestones, calc.gross, calc.minorUnits);
  const notes = clausesToNotes(h.terms);
  return {
    format: "estimate",
    notice: BUDGETARY_NOTICE,
    clientNotes: { assumptions: noteParagraphs(notes.assumptions), nextSteps: noteParagraphs(notes.nextSteps) },
    draft: true,
    reference: h.reference,
    revision: h.revision,
    issuer: { legalName: d.issuer.legal_name, trn: blank(d.issuer.trn), address: blank(d.issuer.address), phone: blank(d.issuer.phone), email: blank(d.issuer.email), website: blank(d.issuer.website), logo: blank(d.issuer.logo_path) ? { key: "logo", storagePath: d.issuer.logo_path!, bucket: "company-logos", mime: "", sha256: null } : null },
    billTo: d.billTo
      ? { name: d.billTo.name, place: blank(d.billTo.place), country: d.billTo.country_code ? countryLabel(d.billTo.country_code) : null, vatTrn: blank(d.billTo.vat_trn), tradeLicence: blank(d.billTo.trade_licence_no) }
      : { name: "(not chosen yet)", place: null, country: null, vatTrn: null, tradeLicence: null },
    enquiryTitle: d.enquiry.title,
    enquiryReference: d.enquiry.reference,
    issueDate: null,
    validityDate: h.validity_date,
    currency: h.currency,
    sections,
    totals: { net: calc.net, vat: calc.vat, gross: calc.gross },
    milestones: milestones.map((m, i) => ({ label: m.label, kind: m.kind, value: m.value, due: blank(m.due ?? null), amount: amounts[i]! })),
    exclusions: h.exclusions ?? [],
    terms: { label: null, clauses: [] },
  };
}

/** `<reference>-rev<n>[-DRAFT]`, safe for a file name. */
export function exportBaseName(m: Pick<QuotationDocModel, "reference" | "revision" | "draft">): string {
  const ref = m.reference.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "estimate";
  return `${ref}-rev${m.revision}${m.draft ? "-DRAFT" : ""}`;
}

/** Thousands separators for an exact decimal string (never a float). */
export function groupMoney(amount: string): string {
  const [i = "0", f] = amount.split(".");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${f !== undefined ? `.${f}` : ""}`;
}

/** A VAT rate as a short percent text for print ("5%", "15.5%"); a line without a rate shows its label ("Out of scope"). */
export function vatRateText(l: Pick<DocLine, "vatRate" | "vatLabel">): string {
  if (l.vatRate == null) return l.vatLabel;
  const n = l.vatRate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${n}%`;
}

export function milestoneValueText(m: DocMilestone, currency: string | null): string {
  return m.kind === "percent" ? `${m.value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}%` : `${currency ? `${currency} ` : ""}${groupMoney(m.amount)}`;
}

/** Visible identifiers of the document, in order, for a text search in tests and for the title line. */
export const docTitle = (m: Pick<QuotationDocModel, "format" | "draft" | "reference" | "revision">): string => `${m.format === "legacy" ? "Quotation" : "Estimate"} ${m.reference} revision ${m.revision}${m.draft ? " (DRAFT)" : ""}`;
