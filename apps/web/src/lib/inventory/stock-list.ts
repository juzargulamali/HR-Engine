import { compareNullable, type SortDir, type SortState } from "@/components/workspace/url-state";
import type { InvBalanceRow, InvCategoryRow, InvItemRow, InvReservationRow, InvTracking, InvUnitRow } from "@/types/inventory";

/**
 * Pure helpers for the Inventory page (table of catalogue items). No React, no server-only imports, so they are unit tested.
 * Nothing here is a permission or a business rule: the database decides who sees units and balances (RLS) and every number the
 * warehouse acts on. These functions only turn rows the person was allowed to read into one line per catalogue item.
 */

// ---------------------------------------------------------------------------------------------------------------
// Columns and sorting
// ---------------------------------------------------------------------------------------------------------------

export type StockColumn = "item" | "category" | "tracking" | "usable" | "warehouse" | "out" | "reserved" | "draft" | "company" | "cost";

export const STOCK_COLUMNS: readonly { id: StockColumn; label: string; required?: boolean }[] = [
  { id: "item", label: "Item", required: true },
  { id: "category", label: "Category" },
  { id: "tracking", label: "How it is tracked" },
  { id: "usable", label: "Usable now" },
  { id: "warehouse", label: "In the warehouse" },
  { id: "out", label: "Out" },
  { id: "reserved", label: "Reserved (future)" },
  { id: "draft", label: "Not counted yet" },
  { id: "company", label: "Company" },
  { id: "cost", label: "Latest cost" },
];
export const STOCK_ALL_COLUMNS: readonly StockColumn[] = STOCK_COLUMNS.map((c) => c.id);
export const STOCK_DEFAULT_COLUMNS: readonly StockColumn[] = ["item", "category", "tracking", "usable", "warehouse", "out", "reserved"];
/** Columns that show where equipment is or who holds it: never offered (and never rendered) to someone who cannot view stock. */
export const STOCK_ONLY_COLUMNS: readonly StockColumn[] = ["warehouse", "out", "reserved", "draft"];

export type StockSortKey = StockColumn;
export const STOCK_SORT_KEYS: readonly StockSortKey[] = STOCK_ALL_COLUMNS;
export const STOCK_DEFAULT_SORT: SortState<StockSortKey> = { key: "item", dir: "asc" };

// ---------------------------------------------------------------------------------------------------------------
// The one line per item
// ---------------------------------------------------------------------------------------------------------------

export type UnitLite = Pick<InvUnitRow, "item_id" | "code" | "serial_number" | "lifecycle" | "condition" | "custody_kind" | "location_id" | "in_kit_id" | "ownership">;
export type BalanceLite = Pick<InvBalanceRow, "item_id" | "holder_kind" | "location_id" | "condition" | "qty" | "label_code" | "rental_id">;
export type ReservationLite = Pick<InvReservationRow, "item_id" | "unit_id" | "location_id" | "qty" | "dispatched_qty" | "reserved_during" | "status">;

export interface StockRow {
  id: string;
  companyId: string;
  name: string;
  model: string | null;
  specification: string | null;
  manufacturer: string | null;
  categoryId: string | null;
  categoryName: string | null;
  tracking: InvTracking;
  uom: string;
  scale: number;
  status: InvItemRow["status"];
  /** True when the person may read units and balances of this item's company; false means the catalogue summary only. */
  detail: boolean;
  /** Counts. null means "not shown to this person" (never zero: zero is a real answer). */
  usable: number | null;
  warehouse: number | null;
  outProjects: number | null;
  outEmployees: number | null;
  inTransit: number | null;
  reserved: number | null;
  draftUnits: number | null;
  /** Needs checking, damaged, cannot be used, out for repair or missing. */
  attention: number | null;
  conditions: string[];
  locationIds: string[];
  search: string;
  cost: { amount: number; currency: string } | null;
}

export const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The end of a Postgres range text such as `["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")`; null when it has none. */
export function rangeEnd(range: string | null | undefined): Date | null {
  if (!range) return null;
  const m = /^[[(]\s*"?([^",]*)"?\s*,\s*"?([^")\]]*)"?\s*[)\]]$/.exec(range.trim());
  const raw = m?.[2]?.trim();
  if (!raw) return null;
  // Postgres writes the offset as "+00" or "+05:30"; JavaScript needs "+00:00".
  const iso = raw.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function categoryPath(categories: readonly InvCategoryRow[], id: string | null): string | null {
  if (!id) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 10; guard++) {
    names.unshift(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return names.length > 0 ? names.join(" / ") : null;
}

/** The category and every category below it (so choosing "Audio" also finds "Audio / Cables"). */
export function categoryAndChildren(categories: readonly InvCategoryRow[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

export interface BuildInput {
  items: readonly InvItemRow[];
  categories: readonly InvCategoryRow[];
  units: readonly UnitLite[];
  balances: readonly BalanceLite[];
  reservations: readonly ReservationLite[];
  /** Companies whose units and balances the person may read. Items of other companies get the summary treatment. */
  detailCompanyIds: ReadonlySet<string>;
  /** "" = all locations. */
  locationId: string;
  now: Date;
  costs?: ReadonlyMap<string, { amount: number; currency: string }>;
}

export function buildStockRows(input: BuildInput): StockRow[] {
  const { items, categories, detailCompanyIds, locationId, now } = input;
  const unitsBy = new Map<string, UnitLite[]>();
  for (const u of input.units) (unitsBy.get(u.item_id) ?? unitsBy.set(u.item_id, []).get(u.item_id)!).push(u);
  const balsBy = new Map<string, BalanceLite[]>();
  for (const b of input.balances) (balsBy.get(b.item_id) ?? balsBy.set(b.item_id, []).get(b.item_id)!).push(b);
  const resBy = new Map<string, ReservationLite[]>();
  for (const r of input.reservations) (resBy.get(r.item_id) ?? resBy.set(r.item_id, []).get(r.item_id)!).push(r);
  const here = (loc: string | null) => locationId === "" || loc === locationId;

  return items.map((item): StockRow => {
    const detail = detailCompanyIds.has(item.company_id);
    const categoryName = categoryPath(categories, item.category_id);
    const base = {
      id: item.id, companyId: item.company_id, name: item.name, model: item.model, specification: item.specification, manufacturer: item.manufacturer,
      categoryId: item.category_id, categoryName, tracking: item.tracking, uom: item.unit_of_measure, scale: item.quantity_scale, status: item.status, detail,
      cost: input.costs?.get(item.id) ?? null,
    };
    const words = [item.name, item.model, item.specification, item.manufacturer, categoryName];
    if (!detail) {
      return { ...base, usable: null, warehouse: null, outProjects: null, outEmployees: null, inTransit: null, reserved: null, draftUnits: null, attention: null, conditions: [], locationIds: [], search: words.filter(Boolean).join(" ").toLowerCase() };
    }
    let usable = 0, warehouse = 0, outProjects = 0, outEmployees = 0, inTransit = 0, draftUnits = 0, attention = 0;
    const conditions = new Set<string>();
    const locationIds = new Set<string>();
    for (const u of unitsBy.get(item.id) ?? []) {
      words.push(u.code, u.serial_number);
      if (u.location_id) locationIds.add(u.location_id);
      if (u.lifecycle === "retired") continue;
      conditions.add(u.condition);
      if (!here(u.location_id)) continue;
      if (u.lifecycle === "draft") { draftUnits += 1; continue; }
      if (u.lifecycle === "missing") { attention += 1; continue; }
      if (u.custody_kind === "warehouse") {
        warehouse += 1;
        if ((u.condition === "good" || u.condition === "fair") && !u.in_kit_id) usable += 1;
        else attention += 1;
      } else if (u.custody_kind === "project") outProjects += 1;
      else if (u.custody_kind === "employee") outEmployees += 1;
      else if (u.custody_kind === "transit") inTransit += 1;
      else if (u.custody_kind === "repair") attention += 1;
    }
    for (const b of balsBy.get(item.id) ?? []) {
      const q = num(b.qty);
      if (b.label_code) words.push(b.label_code);
      if (q <= 0) continue;
      if (b.location_id) locationIds.add(b.location_id);
      conditions.add(b.condition);
      // Rented stock never adds to what the company owns (same rule as the database's availability numbers).
      if (b.rental_id) continue;
      if (b.holder_kind === "warehouse") {
        if (!here(b.location_id)) continue;
        warehouse += q;
        if (b.condition === "good") usable += q;
        else attention += q;
      } else if (locationId === "") {
        // Out-of-warehouse quantities have no location of their own, so they are only counted when every location is shown.
        if (b.holder_kind === "project") outProjects += q;
        else if (b.holder_kind === "employee") outEmployees += q;
        else if (b.holder_kind === "transit") inTransit += q;
        else if (b.holder_kind === "repair") attention += q;
      }
    }
    let reserved = 0;
    for (const r of resBy.get(item.id) ?? []) {
      if (r.status !== "active") continue;
      const end = rangeEnd(r.reserved_during);
      if (end && end.getTime() <= now.getTime()) continue;
      if (r.location_id && !here(r.location_id)) continue;
      reserved += Math.max(0, num(r.qty) - num(r.dispatched_qty));
    }
    return {
      ...base, usable, warehouse, outProjects, outEmployees, inTransit, reserved, draftUnits, attention,
      conditions: [...conditions], locationIds: [...locationIds], search: words.filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------------------------

export type StatusFilter = "" | "retired" | "draft" | "all";
export const STATUS_FILTERS: readonly StatusFilter[] = ["", "retired", "draft", "all"];
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  "": "In use (not retired)",
  retired: "Retired",
  draft: "Not counted yet",
  all: "Everything",
};

export interface StockFilter {
  q: string;
  category: string;
  location: string;
  tracking: string;
  condition: string;
  company: string;
  status: StatusFilter;
}

export const NO_STOCK_FILTER: StockFilter = { q: "", category: "", location: "", tracking: "", condition: "", company: "", status: "" };

export const isFilterActive = (f: StockFilter) => f.q !== "" || f.category !== "" || f.location !== "" || f.tracking !== "" || f.condition !== "" || f.company !== "" || f.status !== "";

export function filterStockRows(rows: readonly StockRow[], f: StockFilter, categories: readonly InvCategoryRow[]): StockRow[] {
  const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const categoryIds = f.category ? categoryAndChildren(categories, f.category) : null;
  return rows.filter((r) => {
    if (f.status === "") {
      if (r.status === "retired") return false;
    } else if (f.status === "retired") {
      if (r.status !== "retired") return false;
    } else if (f.status === "draft") {
      if (!(r.status === "draft" || (r.draftUnits ?? 0) > 0)) return false;
    }
    if (f.company && r.companyId !== f.company) return false;
    if (f.tracking && r.tracking !== f.tracking) return false;
    if (categoryIds && !(r.categoryId && categoryIds.has(r.categoryId))) return false;
    // A location or a condition can only be judged for items whose stock the person may read.
    if (f.location && r.detail && !r.locationIds.includes(f.location)) return false;
    if (f.condition && !(r.detail && r.conditions.includes(f.condition))) return false;
    if (tokens.length > 0 && !tokens.every((t) => r.search.includes(t))) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------------------------------------------

const outTotal = (r: StockRow): number | null => (r.outProjects === null || r.outEmployees === null ? null : r.outProjects + r.outEmployees);

function numberValue(r: StockRow, key: StockSortKey): number | null {
  switch (key) {
    case "usable": return r.usable;
    case "warehouse": return r.warehouse;
    case "out": return outTotal(r);
    case "reserved": return r.reserved;
    case "draft": return r.draftUnits;
    case "cost": return r.cost?.amount ?? null;
    default: return null;
  }
}

const NUMERIC: readonly StockSortKey[] = ["usable", "warehouse", "out", "reserved", "draft", "cost"];

/** A stable copy in the requested order. Missing values always sort last, whatever the direction. Costs sort by currency first: amounts in different currencies are never compared. */
export function sortStockRows<T extends StockRow>(rows: readonly T[], sort: SortState<StockSortKey>): T[] {
  const copy = [...rows];
  const byName = (a: T, b: T) => compareNullable(a.name, b.name, "asc") || compareNullable(a.model, b.model, "asc") || compareNullable(a.specification, b.specification, "asc");
  if (NUMERIC.includes(sort.key)) {
    return copy.sort((a, b) => {
      const x = numberValue(a, sort.key), y = numberValue(b, sort.key);
      if (x === null && y === null) return byName(a, b);
      if (x === null) return 1;
      if (y === null) return -1;
      if (sort.key === "cost") {
        const c = compareNullable(a.cost?.currency, b.cost?.currency, "asc");
        if (c !== 0) return c;
      }
      const d = sort.dir === "asc" ? x - y : y - x;
      return d !== 0 ? d : byName(a, b);
    });
  }
  const text = (r: StockRow): string | null => {
    switch (sort.key) {
      case "item": return r.name;
      case "category": return r.categoryName;
      case "tracking": return r.tracking;
      case "company": return r.companyId;
      default: return null;
    }
  };
  return copy.sort((a, b) => compareNullable(text(a), text(b), sort.dir as SortDir) || byName(a, b));
}

/** What the "Out" cell says in words: "2 on projects, 1 with employees". */
export function outText(r: Pick<StockRow, "outProjects" | "outEmployees">): string {
  if (r.outProjects === null || r.outEmployees === null) return "—";
  const parts: string[] = [];
  if (r.outProjects > 0) parts.push(`${fmt(r.outProjects)} on projects`);
  if (r.outEmployees > 0) parts.push(`${fmt(r.outEmployees)} with employees`);
  return parts.length > 0 ? parts.join(", ") : "None";
}

export function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
