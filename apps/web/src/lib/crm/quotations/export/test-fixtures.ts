import sharp from "sharp";
import { createHash } from "node:crypto";
import { ESTIMATE_FORMAT_MARKER, UNSECTIONED_TITLE, calculateQuotation, isUnsectionedTitle, notesToClauses, type QuotationSnapshot } from "@enginious-hr/domain";
import type { QuotationBundle } from "../data";
import type { QuotationHeader, QuotationLineRow, QuotationSectionRow } from "../model";

/** Fictional data only, generated here. */
export const INTERNAL_MARKER = "INTERNAL-MARGIN-NOTE-7f3a9c";
export const PROPOSAL = "11111111-1111-4111-8111-111111111111";
export const COMPANY = "22222222-2222-4222-8222-222222222222";
export const OPP = "33333333-3333-4333-8333-333333333333";
export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
export const png = (color = "#cc3322", w = 60, h = 40) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

const rate = (r: string) => ({ kind: "rate" as const, rate: r, label: `${r}%` });
export const LONG_NOTE = (label: string, n = 4) => Array.from({ length: n }, (_, i) => `${label} paragraph ${i + 1}. The estimate is based on the scope described in the enquiry and on drawings supplied so far, and the figures will move if the scope, the venue or the programme changes before the work is confirmed in writing by both parties.`).join("\n\n");
export interface SnapOpts { /** Historical quotation (no format marker, old terms) instead of an estimate. */ legacy?: boolean; /** Items outside any section first, then the sections. */ loose?: boolean; assumptions?: string; nextSteps?: string; noMilestones?: boolean; noReviewDate?: boolean; agency?: boolean; revision?: number; trn?: string | null; lines60?: boolean; longDescription?: boolean; withImages?: { lineNumber: string; sha: string }[]; logoSha?: string; exclusions?: boolean; billName?: string; issuerName?: string; label?: string }

/** A snapshot shaped exactly like crm_quote_build_content's output, computed with the shared calculation. */
export function snapshotFixture(o: SnapOpts = {}): QuotationSnapshot {
  const long = "Custom stage deck in powder-coated aluminium with integrated cable management, rigging points and a printed fascia, delivered, installed and struck on site. ".repeat(6).trim();
  const base = o.lines60
    ? [{ title: "Fabrication", lines: Array.from({ length: 60 }, (_, i) => ({ quantity: String(i + 1), unitPrice: "10.50", description: `Item ${i + 1} ${o.longDescription && i === 5 ? long : "panel"}` })) }]
    : [
        { title: "Fabrication", lines: [{ quantity: "3", unitPrice: "33.33", description: o.longDescription ? long : "Stage deck" }, { quantity: "1.5", unitPrice: "19.99", description: "Fascia panels", vat: rate("15") }] },
        { title: "AV", lines: [{ quantity: "7", unitPrice: "0.35", description: "LED wall", vat: { kind: "out_of_scope" as const, label: "Out of scope" } }] },
      ];
  const sections: { title: string; lines: { quantity: string; unitPrice: string; description: string; vat?: ReturnType<typeof rate> | { kind: "out_of_scope"; label: string } }[] }[] = o.loose
    ? [{ title: UNSECTIONED_TITLE, lines: [{ quantity: "2", unitPrice: "50", description: "Loose item one" }, { quantity: "1", unitPrice: "75.5", description: "Loose item two" }] }, ...base]
    : base;
  const calc = calculateQuotation({ currency: "EUR", vat: rate("5"), sections: sections.map((s) => ({ title: s.title, ...(isUnsectionedTitle(s.title) ? { unsectioned: true } : {}), lines: s.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, ...("vat" in l ? { vat: l.vat } : {}) })) })) });
  const img = (num: string) => o.withImages?.find((w) => w.lineNumber === num);
  const est = !o.legacy;
  const sqlNumber = (si: number, li: number) => `${si + 1}.${li + 1}`;   // what the (unchanged) snapshot SQL writes: section position . line position
  return {
    schema_version: 1,
    reference: "QUO-FIX-2026-0001",
    revision: o.revision ?? 1,
    issue_date: "2026-11-02",
    validity_date: o.noReviewDate ? null : "2026-12-31",
    enquiry: { reference: "ENQ-FIX-2026-0007", title: o.agency ? "Fictional agency gala" : "Fictional direct fit-out" },
    issuer: { company_id: COMPANY, legal_name: o.issuerName ?? "Fictional Enginious UAE LLC", trn: o.trn === undefined ? "100200300400003" : o.trn, address: "Fictional Tower, Dubai", phone: "+971 4 000 0000", email: "quotes@fictional.example", website: "fictional.example",
      logo: o.logoSha ? { bucket: "quotation-assets", storage_path: `${PROPOSAL}/logo-${o.logoSha}.png`, sha256: o.logoSha, mime_type: "image/png" } : null, country_code: "AE" },
    bill_to: { organisation_id: "org-1", name: o.billName ?? (o.agency ? "Fictional Aurora Agency" : "Fictional Harbour Client"), address: "Fictional Quay 1, Dubai", country_code: "AE", vat_trn: "000123450001", trade_licence_no: "0045" },
    currency: "EUR", minor_units: 2, vat: { kind: "rate", label: "5%", rate: "5" },
    sections: calc.sections.map((cs, si) => ({
      number: String(si + 1), title: cs.title,
      lines: cs.lines.map((cl, li) => {
        const src = sections[si]!.lines[li]!; const im = img(cl.number);
        return {
          number: est ? sqlNumber(si, li) : cl.number, description: src.description, unit: "m2", quantity: cl.quantity, unit_price: cl.unitPrice,
          image: im ? { bucket: "quotation-assets" as const, storage_path: `${PROPOSAL}/line-${cl.number}-${im.sha}.png`, sha256: im.sha, mime_type: "image/png", file_id: `file-${cl.number}`, original_name: "photo.png", size_bytes: 100 } : null,
          vat: cl.vat!.kind === "rate" ? { kind: "rate" as const, label: cl.vat!.label, rate: cl.vat!.rate } : { kind: "out_of_scope" as const, label: cl.vat!.label, rate: null },
          amount_net: cl.net, vat_amount: cl.vatAmount, amount_gross: cl.gross,
        };
      }),
      subtotal_net: cs.net, subtotal_vat: cs.vat, subtotal_gross: cs.gross,
    })),
    totals: { net: calc.net, vat: calc.vat, gross: calc.gross },
    milestones: o.noMilestones ? [] : [{ label: "Instalment 1", kind: "percent", value: "40", due: est ? "Before mobilisation" : "On acceptance", amount: ((Number(calc.gross) * 40) / 100).toFixed(2) }, { label: "Instalment 2", kind: "percent", value: "60", due: "On completion", amount: ((Number(calc.gross) * 60) / 100).toFixed(2) }],
    exclusions: o.exclusions === false ? [] : [{ title: "Civil works", body: "Civil and MEPFS works are not included." }],
    terms: est
      ? { label: o.label ?? ESTIMATE_FORMAT_MARKER, clauses: notesToClauses({ assumptions: o.assumptions ?? "Prices assume a single delivery and one site visit.", nextSteps: o.nextSteps ?? "Confirm the scope in writing so the figures can be reviewed." }) }
      : { label: o.label ?? "Standard terms (working draft, pending legal review)", clauses: [{ title: "Changes", body: "Changes to scope may affect the price." }, { title: "Confidentiality", body: "Provided for evaluation only." }] },
  };
}


const H: QuotationHeader = {
  proposal_id: PROPOSAL, opportunity_id: OPP, company_id: COMPANY, reference: "QUO-FIX-2026-0001", revision: 1, previous_proposal_id: null,
  currency: null, vat_choice_id: null, vat_kind: null, vat_label: null, vat_rate: null, bill_to_org_id: "org-1", validity_date: null, issue_date: null,
  milestones: [], terms_label: ESTIMATE_FORMAT_MARKER, terms: [{ title: "Next steps", body: "Review the budget together." }], exclusions: [],
  internal_notes: null, content_changed_at: "2026-11-01T00:00:00Z", issued_at: null, issued_by: null,
};

/** What loadQuotation returns. `live` values differ on purpose from any snapshot: an issued export must ignore them. */
export function bundleFixture(o: { snapshot?: QuotationSnapshot | null; draft?: boolean; internalNotes?: string; liveIssuerName?: string; liveBillName?: string; liveTrn?: string } = {}): QuotationBundle {
  const issued = !o.draft;
  const header: QuotationHeader = { ...H, internal_notes: o.internalNotes ?? INTERNAL_MARKER, revision: o.snapshot?.revision ?? 1,
    ...(o.draft ? { currency: "EUR", vat_kind: "rate" as const, vat_label: "5%", vat_rate: 5, validity_date: "2026-12-31", exclusions: [{ title: "Civil works", body: "Not included." }],
        milestones: [{ label: "Instalment 1", kind: "percent" as const, value: "100", due: null }] } : { issued_at: "2026-11-02T08:00:00Z", issue_date: "2026-11-02" }) };
  const sections: QuotationSectionRow[] = [{ id: "s1", proposal_id: PROPOSAL, position: 1, title: "Fabrication" }];
  const lines: QuotationLineRow[] = [{ id: "l1", proposal_id: PROPOSAL, section_id: "s1", position: 1, description: "Stage deck", image_file_id: null, unit: "m2", quantity: "3", unit_price: "33.33", vat_choice_id: null, vat_kind: null, vat_label: null, vat_rate: null }];
  return {
    header, proposal: { id: PROPOSAL } as never, sections, lines, vatChoices: [], files: [], imageUrls: {}, logoUrl: null, approvals: [], contentHash: null, revisions: [],
    issuer: { id: COMPANY, legal_name: o.liveIssuerName ?? "LIVE Issuer Name Ltd", trn: o.liveTrn ?? "999999999999999", address: "Live Address", phone: null, email: null, website: null, logo_path: `${COMPANY}/live-logo.png` },
    organisations: [], billTo: { id: "org-1", name: o.liveBillName ?? "LIVE Bill-To Name", country_code: "AE", place: "Live Place", vat_trn: "777", trade_licence_no: "888" },
    snapshot: issued && o.snapshot ? { content: o.snapshot, content_hash: "x", issued_at: "2026-11-02T08:00:00Z" } : null,
  };
}
