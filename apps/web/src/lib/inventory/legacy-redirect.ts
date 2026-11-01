/**
 * `/inventory` used to be the stock list, and every older link (a printed label's QR code, a bookmarked panel, a link from a request) points at
 * it with `?action=`, `?open=`, `?unit=` and the like. The stock list now lives at `/inventory/stock`; `/inventory` is Today. A request that
 * carries any of the stock list's own parameters goes to the stock list with every parameter kept, so nothing breaks.
 */
export const LEGACY_STOCK_PARAMS = [
  "action", "open", "unit", "codes", "bin", "employee", "project", "request", "transfer", "mode", "q", "category", "tracking", "condition", "company", "status", "sort", "cols",
] as const;

type Params = Record<string, string | string[] | undefined>;

/** The address to send an old `/inventory?…` link to, or null when the request is for Today itself. */
export function legacyStockTarget(sp: Params): string | null {
  if (!LEGACY_STOCK_PARAMS.some((k) => sp[k] !== undefined && sp[k] !== "")) return null;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  }
  return `/inventory/stock?${qs.toString()}`;
}

/** Old `/inventory/movements?…` and `/inventory/employees?…` links keep their parameters on the new address. */
export function carryParams(path: string, sp: Params, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(sp)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
