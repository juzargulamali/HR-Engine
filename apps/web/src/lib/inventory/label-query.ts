/** Reads the address of the labels page: which codes (or all units of an item or a location), and the label size. Pure. */
import { parseInventoryScan } from "@enginious-hr/domain";
import type { LabelSize } from "@/components/inventory/label-sheet";

export const MAX_LABELS = 300;
export const LABEL_SIZE_VALUES: readonly LabelSize[] = ["small", "medium", "large"];
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface LabelQuery {
  /** Valid, canonical, de-duplicated codes in the order given. */
  codes: string[];
  /** What was typed but is not an Inventory code (at most 10 kept, for the message). */
  invalid: string[];
  size: LabelSize;
  itemId: string | null;
  locationId: string | null;
  /** The address named an item or location that is not a valid id. */
  badId: boolean;
  /** More codes were given than one sheet may hold; the extra ones are left out. */
  truncated: boolean;
}

type Param = string | string[] | undefined;
const first = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseLabelSize(raw: string): LabelSize {
  return (LABEL_SIZE_VALUES as readonly string[]).includes(raw) ? (raw as LabelSize) : "medium";
}

export function parseLabelQuery(sp: { codes?: Param; size?: Param; item?: Param; location?: Param }): LabelQuery {
  const codes: string[] = [];
  const invalid: string[] = [];
  let truncated = false;
  for (const piece of first(sp.codes).split(/[\s,;]+/)) {
    if (!piece) continue;
    const parsed = parseInventoryScan(piece);
    if (!parsed.ok) {
      if (invalid.length < 10) invalid.push(piece.slice(0, 40));
      continue;
    }
    if (codes.includes(parsed.code)) continue;
    if (codes.length >= MAX_LABELS) { truncated = true; continue; }
    codes.push(parsed.code);
  }
  const item = first(sp.item).trim();
  const location = first(sp.location).trim();
  return {
    codes, invalid, truncated, size: parseLabelSize(first(sp.size)),
    itemId: UUID_RE.test(item) ? item : null,
    locationId: UUID_RE.test(location) ? location : null,
    badId: (item !== "" && !UUID_RE.test(item)) || (location !== "" && !UUID_RE.test(location)),
  };
}

/** The address of the same sheet with another size (keeps codes, item and location). */
export function labelsHref(q: Pick<LabelQuery, "codes" | "itemId" | "locationId">, size: LabelSize): string {
  const p = new URLSearchParams();
  if (q.codes.length) p.set("codes", q.codes.join(","));
  if (q.itemId) p.set("item", q.itemId);
  if (q.locationId) p.set("location", q.locationId);
  p.set("size", size);
  return `/inventory/labels?${p.toString().replace(/%2C/g, ",")}`;
}
