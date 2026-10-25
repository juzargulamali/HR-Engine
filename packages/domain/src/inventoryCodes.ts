/**
 * Inventory codes and QR payloads. A label carries a stable record code, never a name, a price, a person or a credential:
 *   UAE-E-00042   one physical unit or kit (equipment ID)
 *   UAE-S-00007   one item in one bin (quantity stock label): scanning it never means "everything in the bin"
 * The QR on a label is a web address that ends in the code, so a phone's own camera opens the sign-in page of the app and the
 * in-app scanner can read the same thing. Scanning never bypasses sign-in or access checks: the address only names a record.
 * Mirrors inv_next_code in supabase/migrations/20261201000000_inv_access_audit_settings.sql.
 */

export type InventoryCodeKind = "unit" | "stock";

const CODE_RE = /^([A-Z]{2,5})-([ES])-(\d{5,9})$/;

export interface ParsedInventoryCode {
  ok: true;
  kind: InventoryCodeKind;
  /** Canonical upper-case code, e.g. UAE-E-00042. */
  code: string;
  companyCode: string;
}

export type InventoryCodeProblem = "empty" | "too_long" | "not_inventory";

/** Normalises what a person typed: trims, upper-cases, swaps look-alike dashes and removes spaces around them. */
export function normaliseTypedCode(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .trim()
    .toUpperCase();
}

/**
 * Reads a scanned or typed value: a bare code, or an address whose `c` (or `code`) parameter or last path segment is a code.
 * Anything else (another QR code, a product barcode, free text) is "not_inventory": the app says so and never guesses.
 */
export function parseInventoryScan(raw: string | null | undefined): ParsedInventoryCode | { ok: false; problem: InventoryCodeProblem } {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, problem: "empty" };
  if (text.length > 500) return { ok: false, problem: "too_long" };
  const candidates: string[] = [text];
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get("c") ?? url.searchParams.get("code");
    if (fromQuery) candidates.unshift(fromQuery);
    const last = url.pathname.split("/").filter(Boolean).pop();
    if (last) candidates.push(decodeURIComponent(last));
  } catch {
    // not an address: treat the value as a typed code
  }
  for (const c of candidates) {
    const m = CODE_RE.exec(normaliseTypedCode(c));
    if (m) return { ok: true, kind: m[2] === "E" ? "unit" : "stock", code: m[0], companyCode: m[1]! };
  }
  return { ok: false, problem: "not_inventory" };
}

/** The text a label's QR carries: the app's scan address plus the code. Valid for the life of the record, whatever its name or place. */
export function labelPayload(siteUrl: string, code: string): string {
  const parsed = parseInventoryScan(code);
  if (!parsed.ok) throw new Error(`Not an Inventory code: ${code}`);
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/inventory/scan?c=${encodeURIComponent(parsed.code)}`;
}

export interface PendingScanLine {
  code: string;
  kind: InventoryCodeKind;
}

/**
 * Adds a scanned code to a pending pick or return list. A second scan of the same individual unit never adds it twice (it is reported
 * as already on the list); a quantity label may be listed once per bin and its quantity is typed deliberately by the person.
 */
export function addToPendingList(list: readonly PendingScanLine[], scan: ParsedInventoryCode): { list: PendingScanLine[]; added: boolean } {
  if (list.some((l) => l.code === scan.code)) return { list: [...list], added: false };
  return { list: [...list, { code: scan.code, kind: scan.kind }], added: true };
}
