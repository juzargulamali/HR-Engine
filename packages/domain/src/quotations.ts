/**
 * Estimates & Quotations: the pure rules. No database, no clock, no I/O.
 *
 * ONE shared calculation, used by the builder (live totals), the server actions (validation) and the exports (which render the frozen snapshot
 * the database builds at issue). The database does the same arithmetic in `crm_quote_build_content` with exact `numeric`; the RLS test
 * `crm-quotations.rls.test.ts` proves both give identical figures.
 *
 * Rounding (documented once, here):
 *   - Money is never a JavaScript float. Inputs are decimal STRINGS read into scaled BigInt integers.
 *   - Line amount excl. VAT = round-half-up(quantity x unit selling price) to the currency's minor unit (2 for every allowed currency).
 *   - VAT amount = round-half-up(line amount x rate / 100) PER LINE, to the minor unit; "Out of scope" and "not yet chosen" count as no VAT.
 *   - Amount incl. VAT = line amount + line VAT.
 *   - Section subtotals and document totals are SUMS of the rounded line figures (never recalculated from unrounded values), so reordering
 *     sections or lines can never change a total.
 *   - Negative or non-numeric input is refused (quantity above zero, price zero or more; at most 3 and 4 decimals).
 */
import { estimateNumbering } from "./estimates";

/** The allowed currencies: one per quotation, always chosen explicitly (never inferred from the client's country). */
export const QUOTATION_CURRENCIES = ["AED", "SAR", "PLN", "EUR", "USD"] as const;
export type QuotationCurrency = (typeof QUOTATION_CURRENCIES)[number];
export const isQuotationCurrency = (v: unknown): v is QuotationCurrency => (QUOTATION_CURRENCIES as readonly unknown[]).includes(v);

/** Minor units (decimals) per currency. All five allowed currencies use 2. */
export function quotationMinorUnits(_currency: string): number {
  return 2;
}

export type QuotationVat = { kind: "rate"; rate: string; label: string } | { kind: "out_of_scope"; label: string };

export interface QuotationLineInput {
  id?: string;
  quantity: string | number;
  unitPrice: string | number;
  /** Per-line override as selected; null/undefined = the quotation's VAT. */
  vat?: QuotationVat | null;
}
export interface QuotationSectionInput { id?: string; title: string; /** The hidden default section of items that sit outside any section (see `estimates.ts`): numbered 1, 2, 3, never printed as a section. */ unsectioned?: boolean; lines: QuotationLineInput[] }
export interface QuotationInput {
  currency: string | null;
  /** The quotation's VAT selection; null = not chosen yet (draft only: nothing is charged or shown as chosen). */
  vat: QuotationVat | null;
  sections: QuotationSectionInput[];
}

export interface CalculatedLine {
  id?: string;
  /** Display number: `<section>.<line within the section>` ("1.1", "1.2", "2.1"), from `lineDisplayNumber`. */
  number: string;
  quantity: string;
  unitPrice: string;
  vat: QuotationVat | null;
  net: string;
  vatAmount: string;
  gross: string;
}
export interface CalculatedSection { id?: string; title: string; /** True for the hidden default section (items outside any section). */ unsectioned?: boolean; lines: CalculatedLine[]; net: string; vat: string; gross: string }
export interface CalculatedQuotation {
  currency: string | null;
  minorUnits: number;
  vatChosen: boolean;
  sections: CalculatedSection[];
  net: string;
  vat: string;
  gross: string;
}

/**
 * THE display numbering of a BOQ, used by the builder, the SQL snapshot (`crm_quote_build_content` mirrors it), the PDF and the XLSX so they cannot drift.
 * Sections are numbered 1, 2, 3 in order; a line is `<section number>.<position within its section>`. Every line belongs to a section (the table requires
 * it); an item the user adds outside any section lives in a hidden default section numbered by `estimateNumbering` (estimates.ts), which is identical to this
 * when there is no such section. Zero-based indexes in, text out (never a number: "1.10" must stay "1.10").
 */
export const sectionDisplayNumber = (sectionIndex: number): string => String(sectionIndex + 1);
export const lineDisplayNumber = (sectionIndex: number, lineIndex: number): string => `${sectionIndex + 1}.${lineIndex + 1}`;

export class QuotationInputError extends Error {}

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;
const PRICE_RE = /^\d{1,12}(\.\d{1,4})?$/;
const RATE_RE = /^\d{1,3}(\.\d{1,2})?$/;

function scaled(value: string | number, dp: number, re: RegExp, what: string): bigint {
  const s = typeof value === "number" ? (Number.isFinite(value) && !/e/i.test(String(value)) ? String(value) : "x") : String(value).trim();
  if (!re.test(s)) throw new QuotationInputError(`${what} is not a valid non-negative number`);
  const [i, f = ""] = s.split(".");
  return BigInt(i! + f.padEnd(dp, "0"));
}

/** Round-half-up integer division of non-negative integers. */
function divRound(n: bigint, d: bigint): bigint {
  return (n + d / 2n) / d;
}
const pow10 = (n: number) => 10n ** BigInt(n);

export function formatMinor(minor: bigint, minorUnits = 2): string {
  const s = minor.toString().padStart(minorUnits + 1, "0");
  return `${s.slice(0, s.length - minorUnits)}.${s.slice(s.length - minorUnits)}`;
}
export function parseMinor(amount: string, minorUnits = 2): bigint {
  const [i, f = ""] = amount.split(".");
  return BigInt(i! + f.padEnd(minorUnits, "0").slice(0, minorUnits));
}

/** The per-line figures, in minor units. */
export function calculateLine(quantity: string | number, unitPrice: string | number, vat: QuotationVat | null, minorUnits = 2): { net: bigint; vat: bigint } {
  const q = scaled(quantity, 3, QTY_RE, "Quantity");
  if (q === 0n) throw new QuotationInputError("Quantity must be above zero");
  const p = scaled(unitPrice, 4, PRICE_RE, "Unit price");
  // q has 3 decimals, p has 4: the product has 7; bring it to `minorUnits`.
  const net = divRound(q * p, pow10(7 - minorUnits));
  if (!vat || vat.kind === "out_of_scope") return { net, vat: 0n };
  const r = scaled(vat.rate, 2, RATE_RE, "VAT rate");
  if (r > 10000n) throw new QuotationInputError("VAT rate cannot be above 100");
  return { net, vat: divRound(net * r, 10000n) };
}

export function calculateQuotation(input: QuotationInput): CalculatedQuotation {
  const minorUnits = quotationMinorUnits(input.currency ?? "");
  const f = (n: bigint) => formatMinor(n, minorUnits);
  let totalNet = 0n;
  let totalVat = 0n;
  // Numbering: with no unsectioned section this is exactly lineDisplayNumber (1.1, 1.2, 2.1); items outside any section are 1, 2, 3 (estimateNumbering).
  const numbering = estimateNumbering(input.sections.map((s) => ({ unsectioned: !!s.unsectioned, lineCount: s.lines.length })));
  const sections = input.sections.map((s, si): CalculatedSection => {
    let sNet = 0n;
    let sVat = 0n;
    const lines = s.lines.map((l, li): CalculatedLine => {
      const vat = l.vat ?? input.vat;
      const { net, vat: v } = calculateLine(l.quantity, l.unitPrice, vat, minorUnits);
      sNet += net;
      sVat += v;
      const norm = (x: string | number) => String(x).trim().replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
      return { ...(l.id ? { id: l.id } : {}), number: numbering.lines[si]![li]!, quantity: norm(l.quantity), unitPrice: norm(l.unitPrice), vat, net: f(net), vatAmount: f(v), gross: f(net + v) };
    });
    totalNet += sNet;
    totalVat += sVat;
    return { ...(s.id ? { id: s.id } : {}), title: s.title, ...(s.unsectioned ? { unsectioned: true } : {}), lines, net: f(sNet), vat: f(sVat), gross: f(sNet + sVat) };
  });
  return { currency: input.currency, minorUnits, vatChosen: input.vat !== null, sections, net: f(totalNet), vat: f(totalVat), gross: f(totalNet + totalVat) };
}

/** What a person sees for a VAT choice. */
export const vatLabel = (v: QuotationVat | null): string => (v ? v.label : "Not chosen");

// ---------------------------------------------------------------------------------------------------------------------------------
// Payment milestones
// ---------------------------------------------------------------------------------------------------------------------------------
export interface PaymentMilestone { label: string; kind: "percent" | "amount"; value: string; due?: string | null }

/** Null when the schedule is consistent (empty is allowed), otherwise a sentence. Percentages add up to 100; amounts to the total incl. VAT. */
export function validateMilestones(milestones: readonly PaymentMilestone[], grossTotal: string, minorUnits = 2): string | null {
  if (milestones.length === 0) return null;
  if (new Set(milestones.map((m) => m.kind)).size > 1) return "Use either percentages or amounts for all milestones, not both.";
  for (const m of milestones) {
    if (!m.label.trim()) return "Every milestone needs a label.";
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(m.value) || Number(m.value) <= 0) return "Every milestone needs a percentage or an amount above zero.";
    if (m.kind === "percent" && Number(m.value) > 100) return "A milestone cannot be more than 100%.";
  }
  if (milestones[0]!.kind === "percent") {
    const sum = milestones.reduce((n, m) => n + parseMinor(m.value, 2), 0n);
    return sum === 10000n ? null : `Milestones add up to ${formatMinor(sum, 2)}%, not 100%.`;
  }
  const sum = milestones.reduce((n, m) => n + parseMinor(m.value, minorUnits), 0n);
  const total = parseMinor(grossTotal, minorUnits);
  return sum === total ? null : `Milestone amounts add up to ${formatMinor(sum, minorUnits)}, not the total including VAT (${grossTotal}).`;
}

/** Amount of each milestone in minor-unit text (percent of the total incl. VAT, rounded half up; amounts as entered). */
export function milestoneAmounts(milestones: readonly PaymentMilestone[], grossTotal: string, minorUnits = 2): string[] {
  const total = parseMinor(grossTotal, minorUnits);
  return milestones.map((m) => (m.kind === "percent" ? formatMinor(divRound(total * parseMinor(m.value, 2), 10000n), minorUnits) : formatMinor(parseMinor(m.value, minorUnits), minorUnits)));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Pictures beside an item
// ---------------------------------------------------------------------------------------------------------------------------------
export const QUOTATION_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const QUOTATION_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // keep in step with crm_quote_save_line

/** Name, declared type and size only. The bytes are inspected by the existing CRM upload flow; the database repeats these rules. */
export function validateQuotationImageMeta(file: { name: string; size: number; type: string }): string | null {
  if (!(QUOTATION_IMAGE_TYPES as readonly string[]).includes(file.type)) return "The picture must be a JPEG, PNG or WebP image.";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > QUOTATION_IMAGE_MAX_BYTES) return "The picture must be 5 MB or smaller.";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The frozen, client-facing snapshot (crm_quotation_snapshots.content). Part 2 (PDF / XLSX) renders exactly this and nothing else.
// ---------------------------------------------------------------------------------------------------------------------------------
/** A picture PINNED at issue: an immutable copy owned by this revision (bucket `quotation-assets`), with the SHA-256 of its bytes. Never the mutable source file. */
export interface QuotationPinnedAsset { bucket: "quotation-assets"; storage_path: string; sha256: string; mime_type: string }
export interface QuotationSnapshotLine {
  /** The display number `<section>.<line>` at issue. */
  number: string;
  description: string;
  image: (QuotationPinnedAsset & { file_id: string; original_name: string; size_bytes: number }) | null;
  unit: string | null;
  quantity: string;
  unit_price: string;
  vat: { kind: "rate" | "out_of_scope"; label: string; rate: string | null };
  amount_net: string;
  vat_amount: string;
  amount_gross: string;
}
export interface QuotationSnapshot {
  schema_version: 1;
  reference: string;
  revision: number;
  issue_date: string;
  validity_date: string | null;
  enquiry: { reference: string; title: string };
  issuer: { company_id: string; legal_name: string; trn: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logo: QuotationPinnedAsset | null; country_code: string };
  bill_to: { organisation_id: string; name: string; address: string | null; country_code: string | null; vat_trn: string | null; trade_licence_no: string | null };
  currency: QuotationCurrency;
  minor_units: number;
  vat: { kind: "rate" | "out_of_scope"; label: string; rate: string | null };
  sections: { number: string; title: string; lines: QuotationSnapshotLine[]; subtotal_net: string; subtotal_vat: string; subtotal_gross: string }[];
  totals: { net: string; vat: string; gross: string };
  milestones: { label: string; kind: "percent" | "amount"; value: string; due: string | null; amount: string }[];
  /** Exclusions are their own block, before the terms. Empty by default: the user adds the items. */
  exclusions: { title: string; body: string }[];
  terms: { label: string | null; clauses: { title: string; body: string }[] };
}
