import { crmSourceLabel, crmStageLabel } from "@enginious-hr/domain";
import { findProtectedContent } from "../protected";
import type { FactLine } from "../provider/types";

/**
 * EXPLICIT FIELD PROJECTIONS for the Sales lookups, summaries and the provider.
 *
 * Two rules, both structural:
 *   1. Every JARVIS read of a Sales record names its columns from the lists below. No list contains a financial column, so a stored value, currency, budget note,
 *      payment term, estimate or evidence reference is never even read for these capabilities. `select("*")` is not used.
 *   2. What may go to the AI provider is built here, field by field, as fact lines (a fixed label and a plain value). A whole record is never serialised, and a field that is
 *      not named in a builder below cannot be sent, whatever the row carries.
 * Free-text values (a title, a location, a name) go as written, financial figures included (owner policy); one that carries protected material (a personal ID, a
 * credential, pay) is replaced by a marker. Email addresses and phone numbers are not projected at all.
 */
export const ENQUIRY_COLUMNS = "id, reference, title, stage, owner_id, agency_org_id, client_org_id, source, event_start, event_end, install_start, location, created_at, closed_at, stage_changed_at, hold_review_date, first_response_at, event_edition_id, waiting_on";
/** The free text of ONE enquiry, read only for its own summary or a scope draft, and only through redactAppText (which keeps figures and removes protected material). */
export const ENQUIRY_TEXT_COLUMNS = "id, brief, scope, exclusions, technologies, lost_reason, hold_reason";
export const FOLLOW_UP_COLUMNS = "id, title, kind, due_at, status, opportunity_id, assigned_to";
export const ACTIVITY_COLUMNS = "id, opportunity_id, kind, occurred_at";
export const ACTIVITY_TEXT_COLUMNS = "id, opportunity_id, kind, occurred_at, body";

/** Columns that hold financial information. They must not appear in any column list of this file (a test checks every list against it). */
export const FINANCIAL_COLUMNS = ["value", "currency", "budget_note", "payment_terms", "evidence_type", "evidence_reference", "evidence_date", "amount", "total", "subtotal", "price", "rate", "cost", "margin", "discount", "tax"] as const;

export interface EnquiryRow {
  id: string; reference: string; title: string; stage: string; owner_id: string; agency_org_id: string | null; client_org_id: string | null; source: string | null;
  event_start: string | null; event_end: string | null; install_start: string | null; location: string | null; created_at: string; closed_at: string | null;
  stage_changed_at: string | null; hold_review_date: string | null; first_response_at: string | null; event_edition_id: string | null; waiting_on: string | null;
}

export const WITHHELD = "[kept inside Enginious OS]";
/** A short free-text value for the provider: unchanged when clean, the marker when it carries protected material (an ID, a credential, pay). A figure in it is kept. */
export function safeValue(v: string | null | undefined, max = 160): string | null {
  const t = (v ?? "").replace(/[<>]/g, " ").replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  if (!t) return null;
  return findProtectedContent(t).length > 0 ? WITHHELD : t;
}

/** One enquiry as fact lines for the provider. `names` are the organisations and the event the requester's own session could read. */
export function enquiryFacts(row: EnquiryRow, names: { agency?: string | null; client?: string | null; event?: string | null; owner?: string | null }): FactLine[] {
  const out: FactLine[] = [];
  const add = (label: string, value: string | number | null | undefined) => { if (value !== null && value !== undefined && value !== "") out.push({ label, value }); };
  add("Enquiry reference", row.reference);
  add("Enquiry title", safeValue(row.title));
  add("Stage", crmStageLabel(row.stage));
  add("Agency", safeValue(names.agency));
  add("End client", safeValue(names.client));
  add("Linked event", safeValue(names.event));
  add("Location", safeValue(row.location));
  add("Event start date", row.event_start);
  add("Event end date", row.event_end);
  add("Installation start date", row.install_start);
  add("Source", row.source ? crmSourceLabel(row.source) : null);
  add("Created on", row.created_at.slice(0, 10));
  add("Closed on", row.closed_at ? row.closed_at.slice(0, 10) : null);
  add("Hold review date", row.hold_review_date);
  add("Waiting on", row.waiting_on === "client" ? "the client" : row.waiting_on === "internal" ? "the Enginious team" : null);
  add("Owner", safeValue(names.owner, 80));
  return out;
}

/** The most ids one "in (...)" filter carries. A longer list is read in batches, so the request address stays short whatever the number of records. */
export const ID_BATCH = 100;
/** Runs `read` once per batch of ids and returns all rows; `null` when any batch failed (the caller reports a failed read, never a partial list as if it were whole). */
export async function inBatches<T>(ids: readonly string[], read: (batch: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const r = await read(ids.slice(i, i + ID_BATCH));
    if (r.error) return null;
    out.push(...(r.data ?? []));
  }
  return out;
}

/** Rows asked for per page of a complete read, and the most pages one read will take. */
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 10;
type Page<T> = { data: T[] | null; error: unknown; count?: number | null };
/**
 * A COMPLETE read, or an honest "incomplete". The hosted API caps how many rows one response returns, so a single request can silently hide rows; "nothing came back for
 * this enquiry" would then be a false absence. Each page is asked for with an exact count; reading continues from the number of rows received until that count is
 * reached, whatever the server's cap is. `complete` is false when the count is missing, a page comes back empty before the count is reached, or MAX_PAGES is not enough.
 * Returns null when a read fails. The caller must not treat an incomplete result as proof that something does not exist.
 */
export async function readComplete<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<{ rows: T[]; complete: boolean } | null> {
  const rows: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const r = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (r.error) return null;
    const got = r.data ?? [];
    rows.push(...got);
    if (typeof r.count !== "number") return { rows, complete: false };
    if (rows.length >= r.count) return { rows, complete: true };
    if (got.length === 0) return { rows, complete: false };
  }
  return { rows, complete: false };
}
/** `readComplete` for each batch of ids (never one request per record). Incomplete if any batch is; null if any read fails. */
export async function inBatchesComplete<T>(ids: readonly string[], page: (batch: string[], from: number, to: number) => PromiseLike<Page<T>>): Promise<{ rows: T[]; complete: boolean } | null> {
  const out: T[] = [];
  let complete = true;
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const r = await readComplete<T>((from, to) => page(batch, from, to));
    if (!r) return null;
    out.push(...r.rows);
    if (!r.complete) complete = false;
  }
  return { rows: out, complete };
}
