/**
 * Zoho Books references: which fields did the person actually change?
 *
 * The form is built from the values loaded with the page (the "seen" values, sent back as hidden inputs). Only a field that differs from what
 * the person saw is sent to the database: an untouched field is left out (so another person's change to it is never overwritten) and a field
 * the person emptied is sent as `null` (an intentional clear). The seen value of each changed field travels too, so the database can refuse
 * a stale edit of that same field. Pure and framework-free so it can be tested alone.
 */

export const ZOHO_FIELDS = ["quote_ref", "quote_sent_on", "invoice_ref", "invoice_issued_on", "payment_received_on", "paid_amount"] as const;
export type ZohoField = (typeof ZOHO_FIELDS)[number];
/** Form field names (camelCase) for each database column. */
export const ZOHO_FORM_NAMES: Record<ZohoField, string> = {
  quote_ref: "quoteRef", quote_sent_on: "quoteSentOn", invoice_ref: "invoiceRef", invoice_issued_on: "invoiceIssuedOn", payment_received_on: "paymentReceivedOn", paid_amount: "paidAmount",
};
/** The prefix of the hidden input that carries the value the person saw. */
export const ZOHO_SEEN_PREFIX = "seen_";

export type ZohoValue = string | number | null;
export interface ZohoChange {
  /** Only the fields that changed; `null` = clear. */
  fields: Partial<Record<ZohoField, ZohoValue>>;
  /** What the person saw for each changed field (`null` = it was empty). */
  expected: Partial<Record<ZohoField, ZohoValue>>;
}

/** Blank text is "empty". Amounts compare as numbers (12.5 equals 12.50), text compares trimmed. */
function normalise(field: ZohoField, raw: unknown): ZohoValue {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  if (field === "paid_amount") { const n = Number(text); return Number.isFinite(n) ? n : text; }
  return text;
}

export function diffZohoForm(form: Record<string, unknown>): ZohoChange | null {
  const change: ZohoChange = { fields: {}, expected: {} };
  let any = false;
  for (const f of ZOHO_FIELDS) {
    const name = ZOHO_FORM_NAMES[f];
    const now = normalise(f, form[name]);
    const seen = normalise(f, form[ZOHO_SEEN_PREFIX + name]);
    if (now === seen) continue;
    change.fields[f] = now;
    change.expected[f] = seen;
    any = true;
  }
  return any ? change : null;
}

/** Plain-language names for messages. */
export const ZOHO_LABELS: Record<ZohoField, string> = {
  quote_ref: "the quote reference", quote_sent_on: "the quote sent date", invoice_ref: "the invoice reference", invoice_issued_on: "the invoice date", payment_received_on: "the payment date", paid_amount: "the amount paid",
};

/**
 * Used ONLY against a database that has not got `crm_save_zoho_reference` yet: the changed fields whose stored value is no longer the one the
 * person saw (somebody else changed that same field meanwhile).
 */
export function staleFields(change: ZohoChange, current: Partial<Record<ZohoField, unknown>> | null): ZohoField[] {
  return (Object.keys(change.fields) as ZohoField[]).filter((f) => normalise(f, change.expected[f]) !== normalise(f, current?.[f] ?? null));
}
