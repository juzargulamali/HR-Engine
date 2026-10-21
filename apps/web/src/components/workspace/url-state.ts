/**
 * List state lives in the URL, so it survives opening a record, editing it and coming back, works with the browser's Back
 * button, and can be shared. Pure functions only (no React, no Next): used by server pages and client components alike.
 */

export type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams;
export type ViewMode = "table" | "board";

/** The first value of a query parameter as a string ("" when absent). */
export function firstParam(sp: SearchParamsLike, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Every parameter with a non-empty value, as plain strings (first value wins). */
export function paramsToRecord(sp: SearchParamsLike): Record<string, string> {
  const out: Record<string, string> = {};
  if (sp instanceof URLSearchParams) {
    for (const [k, v] of sp.entries()) if (v !== "" && !(k in out)) out[k] = v;
    return out;
  }
  for (const [k, raw] of Object.entries(sp)) {
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/**
 * The address of `path` with `patch` applied on top of `current`: a value of null/undefined/"" removes that parameter, anything
 * else sets it. Parameters named in `drop` are removed as well. Parameter order is stable (as in `current`, new ones appended).
 */
export function withParams(path: string, current: SearchParamsLike, patch: Record<string, string | null | undefined> = {}, drop: readonly string[] = []): string {
  const next = paramsToRecord(current);
  for (const k of drop) delete next[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") delete next[k];
    else next[k] = v;
  }
  const qs = new URLSearchParams(next).toString();
  return qs ? `${path}?${qs}` : path;
}

export function parseView(raw: string, fallback: ViewMode = "table"): ViewMode {
  return raw === "board" || raw === "table" ? raw : fallback;
}

export type SortDir = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** `sort` is "key" or "key:desc"; anything not in `allowed` falls back to the default (a URL is never trusted). */
export function parseSort<K extends string>(raw: string, allowed: readonly K[], fallback: SortState<K>): SortState<K> {
  const [k, d] = raw.split(":");
  const key = allowed.find((a) => a === k);
  if (!key) return fallback;
  return { key, dir: d === "desc" ? "desc" : "asc" };
}

export const sortToParam = <K extends string>(s: SortState<K>): string => (s.dir === "desc" ? `${s.key}:desc` : s.key);

/** Clicking a column: a new column sorts ascending, the same column flips direction. */
export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
}

/**
 * Optional columns chosen with the Columns menu: a comma list in `cols`. Unknown names are dropped; no (valid) choice means
 * the defaults. Order always follows `all`, never the URL, so the table stays predictable.
 */
export function parseColumns<K extends string>(raw: string, all: readonly K[], defaults: readonly K[]): K[] {
  const wanted = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  const picked = all.filter((c) => wanted.has(c));
  return picked.length > 0 ? picked : [...defaults];
}

/** The `cols` value to store: nothing when the choice is the default (keeps URLs short and clean). */
export function columnsToParam<K extends string>(cols: readonly K[], all: readonly K[], defaults: readonly K[]): string | null {
  const ordered = all.filter((c) => cols.includes(c));
  const same = ordered.length === defaults.length && defaults.every((d) => ordered.includes(d));
  return same || ordered.length === 0 ? null : ordered.join(",");
}

/** A record id taken from the URL: only a well-formed UUID is accepted. */
export function parseRecordId(raw: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

/** Compares two nullable strings for sorting, with the missing ones always last whatever the direction. */
export function compareNullable(a: string | null | undefined, b: string | null | undefined, dir: SortDir): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const c = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return dir === "asc" ? c : -c;
}
