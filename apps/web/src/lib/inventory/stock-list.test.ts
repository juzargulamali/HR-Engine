import { describe, expect, it } from "vitest";
import type { InvCategoryRow, InvItemRow } from "@/types/inventory";
import {
  NO_STOCK_FILTER, STOCK_DEFAULT_SORT, buildStockRows, categoryAndChildren, categoryPath, filterStockRows, outText, rangeEnd, sortStockRows,
  type BalanceLite, type ReservationLite, type StockRow, type UnitLite,
} from "./stock-list";

const NOW = new Date("2026-10-22T10:00:00Z");
const CO = "c1";
const L1 = "loc-dubai";
const L2 = "loc-riyadh";

function item(over: Partial<InvItemRow> & { id: string; name: string }): InvItemRow {
  return {
    company_id: CO, category_id: null, tracking: "individual", unit_of_measure: "each", quantity_scale: 0, manufacturer: null, model: null, specification: null,
    status: "active", replaced_by_item_id: null, notes: null, version: 1, created_by: null, created_at: "", updated_at: "", ...over,
  };
}
function unit(over: Partial<UnitLite> & { item_id: string; code: string }): UnitLite {
  return { id: `unit-${over.code}`, serial_number: null, lifecycle: "active", condition: "good", custody_kind: "warehouse", location_id: L1, in_kit_id: null, ownership: "owned", ...over };
}
function bal(over: Partial<BalanceLite> & { item_id: string }): BalanceLite {
  return { holder_kind: "warehouse", location_id: L1, condition: "good", qty: 0, label_code: null, rental_id: null, ...over };
}
const cats: InvCategoryRow[] = [
  { id: "audio", company_id: CO, name: "Audio", parent_id: null, sort_order: 0, is_active: true, created_at: "" },
  { id: "cables", company_id: CO, name: "Cables", parent_id: "audio", sort_order: 0, is_active: true, created_at: "" },
  { id: "video", company_id: CO, name: "Video", parent_id: null, sort_order: 0, is_active: true, created_at: "" },
];

const items = [
  item({ id: "laptop", name: "Laptop", model: "X1", category_id: "video" }),
  item({ id: "xlr", name: "XLR cable", specification: "5 m", tracking: "quantity", category_id: "cables" }),
  item({ id: "tape", name: "Gaffer tape", tracking: "consumable" }),
  item({ id: "old", name: "Old mixer", status: "retired", category_id: "audio" }),
  item({ id: "other", name: "Other company thing", company_id: "c2" }),
];
const units: UnitLite[] = [
  unit({ item_id: "laptop", code: "UAE-E-00001", serial_number: "SN-AAA" }),
  unit({ item_id: "laptop", code: "UAE-E-00002", condition: "damaged" }),
  unit({ item_id: "laptop", code: "UAE-E-00003", custody_kind: "project" }),
  unit({ item_id: "laptop", code: "UAE-E-00004", custody_kind: "employee" }),
  unit({ item_id: "laptop", code: "UAE-E-00005", lifecycle: "draft" }),
  unit({ item_id: "laptop", code: "UAE-E-00006", location_id: L2 }),
  unit({ item_id: "laptop", code: "UAE-E-00007", lifecycle: "retired" }),
];
const balances: BalanceLite[] = [
  bal({ item_id: "xlr", qty: "20", label_code: "UAE-S-00007" }),
  bal({ item_id: "xlr", qty: 3, condition: "damaged" }),
  bal({ item_id: "xlr", qty: 5, holder_kind: "project" }),
  bal({ item_id: "xlr", qty: 9, rental_id: "rent1" }),
  bal({ item_id: "xlr", qty: 7, location_id: L2 }),
];
const reservations: ReservationLite[] = [
  { item_id: "xlr", unit_id: null, location_id: L1, qty: 10, dispatched_qty: 4, reserved_during: '["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")', status: "active" },
  { item_id: "xlr", unit_id: null, location_id: L1, qty: 99, dispatched_qty: 0, reserved_during: '["2026-09-01 00:00:00+00","2026-09-05 00:00:00+00")', status: "active" },
  { item_id: "xlr", unit_id: null, location_id: L1, qty: 50, dispatched_qty: 0, reserved_during: '["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")', status: "released" },
];

function build(locationId = "", detail = new Set([CO])): StockRow[] {
  return buildStockRows({ items, categories: cats, units, balances, reservations, detailCompanyIds: detail, locationId, now: NOW });
}
const row = (rows: StockRow[], id: string) => rows.find((r) => r.id === id)!;

describe("rangeEnd", () => {
  it("reads the end of a Postgres range and ignores broken text", () => {
    expect(rangeEnd('["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")')?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(rangeEnd('["2026-11-01 00:00:00+00",)')).toBeNull();
    expect(rangeEnd("nonsense")).toBeNull();
    expect(rangeEnd(null)).toBeNull();
  });
});

describe("categories", () => {
  it("builds a path and finds children", () => {
    expect(categoryPath(cats, "cables")).toBe("Audio / Cables");
    expect(categoryPath(cats, null)).toBeNull();
    expect([...categoryAndChildren(cats, "audio")].sort()).toEqual(["audio", "cables"]);
  });
});

describe("buildStockRows (person who can view stock)", () => {
  const rows = build();
  it("counts units by where they are, never counting damaged, draft or retired ones as usable", () => {
    const l = row(rows, "laptop");
    expect(l.usable).toBe(2); // 00001 and 00006 (other location counts when all locations are shown)
    expect(l.warehouse).toBe(3); // 00001, 00002 (damaged but on the shelf), 00006
    expect(l.outProjects).toBe(1);
    expect(l.outEmployees).toBe(1);
    expect(l.draftUnits).toBe(1);
    expect(l.attention).toBe(1);
  });
  it("counts quantity stock as owned stock only and keeps held stock out of usable", () => {
    const x = row(rows, "xlr");
    expect(x.usable).toBe(27); // 20 + 7, not the damaged 3, not rented 9
    expect(x.warehouse).toBe(30);
    expect(x.outProjects).toBe(5);
    expect(x.attention).toBe(3);
  });
  it("counts only future, active reservations and subtracts what was already dispatched", () => {
    expect(row(rows, "xlr").reserved).toBe(6);
    expect(row(rows, "laptop").reserved).toBe(0);
  });
  it("narrows to one location", () => {
    const here = build(L1);
    expect(row(here, "laptop").usable).toBe(1);
    expect(row(here, "laptop").warehouse).toBe(2);
    expect(row(here, "xlr").usable).toBe(20);
    // counted stock out on a project has no location of its own: under a location filter that is unknown ("—"), never a partial number
    expect(row(here, "xlr").outProjects).toBeNull();
    expect(row(here, "xlr").outEmployees).toBeNull();
    expect(row(here, "xlr").inTransit).toBeNull();
    expect(row(build(L2), "xlr").outProjects).toBeNull();
    expect(row(build(L2), "xlr").usable).toBe(7);
    // individual units out are placed by their own location, so those numbers stay exact
    expect(row(here, "laptop").outProjects).toBe(1);
    expect(row(here, "laptop").outEmployees).toBe(1);
    expect(row(build(L2), "laptop").outProjects).toBe(0);
    // an item with nothing counted out keeps a real zero
    expect(row(here, "tape").outProjects).toBe(0);
  });
  it("keeps one location's reservations out of another location's total", () => {
    const res: ReservationLite[] = [
      { item_id: "xlr", unit_id: null, location_id: L1, qty: 4, dispatched_qty: 0, reserved_during: '["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")', status: "active" },
      { item_id: "xlr", unit_id: null, location_id: L2, qty: 2, dispatched_qty: 0, reserved_during: '["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")', status: "active" },
      // a unit reservation with no location of its own belongs to where the unit is (L2)
      { item_id: "laptop", unit_id: "unit-UAE-E-00006", location_id: null, qty: 1, dispatched_qty: 0, reserved_during: '["2026-11-01 00:00:00+00","2026-11-05 00:00:00+00")', status: "active" },
    ];
    const at = (loc: string) => buildStockRows({ items, categories: cats, units, balances, reservations: res, detailCompanyIds: new Set([CO]), locationId: loc, now: NOW });
    expect(row(at(L1), "xlr").reserved).toBe(4);
    expect(row(at(L2), "xlr").reserved).toBe(2);
    expect(row(at(""), "xlr").reserved).toBe(6);
    expect(row(at(L1), "laptop").reserved).toBe(0);
    expect(row(at(L2), "laptop").reserved).toBe(1);
  });
  it("makes unit codes, serials and bin labels searchable", () => {
    expect(row(rows, "laptop").search).toContain("sn-aaa");
    expect(row(rows, "laptop").search).toContain("uae-e-00003");
    expect(row(rows, "xlr").search).toContain("uae-s-00007");
  });
});

describe("buildStockRows (catalogue summary only)", () => {
  const rows = build("", new Set());
  it("never carries custody, employee, project or cost numbers", () => {
    for (const r of rows) {
      expect(r.detail).toBe(false);
      expect(r.warehouse).toBeNull();
      expect(r.outProjects).toBeNull();
      expect(r.outEmployees).toBeNull();
      expect(r.reserved).toBeNull();
      expect(r.draftUnits).toBeNull();
      expect(r.locationIds).toEqual([]);
    }
    expect(outText(row(rows, "laptop"))).toBe("—");
  });
  it("does not leak unit codes or serials into the search text", () => {
    expect(row(rows, "laptop").search).not.toContain("sn-aaa");
    expect(row(rows, "laptop").search).toContain("laptop");
  });
});

describe("filterStockRows", () => {
  const rows = build();
  const ids = (f: Partial<typeof NO_STOCK_FILTER>) => filterStockRows(rows, { ...NO_STOCK_FILTER, ...f }, cats).map((r) => r.id).sort();
  it("hides retired items unless asked", () => {
    expect(ids({})).toEqual(["laptop", "other", "tape", "xlr"]);
    expect(ids({ status: "retired" })).toEqual(["old"]);
    expect(ids({ status: "all" })).toEqual(["laptop", "old", "other", "tape", "xlr"]);
  });
  it("finds items not counted yet by their draft units or draft status", () => {
    expect(ids({ status: "draft" })).toEqual(["laptop"]);
  });
  it("searches name, model, serial, equipment ID and bin label, all words together", () => {
    expect(ids({ q: "laptop x1" })).toEqual(["laptop"]);
    expect(ids({ q: "sn-aaa" })).toEqual(["laptop"]);
    expect(ids({ q: "uae-e-00004" })).toEqual(["laptop"]);
    expect(ids({ q: "uae-s-00007" })).toEqual(["xlr"]);
    expect(ids({ q: "laptop xlr" })).toEqual([]);
  });
  it("filters by category including its sub-categories, tracking, company and condition", () => {
    expect(ids({ category: "audio" })).toEqual(["xlr"]);
    expect(ids({ category: "audio", status: "all" })).toEqual(["old", "xlr"]);
    expect(ids({ tracking: "consumable" })).toEqual(["tape"]);
    expect(ids({ company: "c2" })).toEqual(["other"]);
    expect(ids({ condition: "damaged" })).toEqual(["laptop", "xlr"]);
  });
  it("filters by location for items the person can read", () => {
    // (the other company's item is shown as a summary only, so its location cannot be judged and it is kept)
    expect(ids({ location: L2 })).toEqual(["laptop", "other", "xlr"]);
  });
  it("does not pretend to know the location or condition of items the person cannot read", () => {
    const summary = build("", new Set());
    const f = (p: Partial<typeof NO_STOCK_FILTER>) => filterStockRows(summary, { ...NO_STOCK_FILTER, ...p }, cats).map((r) => r.id);
    expect(f({ location: L1 })).toContain("laptop");
    expect(f({ condition: "damaged" })).toEqual([]);
  });
});

describe("sortStockRows", () => {
  const rows = build();
  const order = (key: Parameters<typeof sortStockRows>[1]["key"], dir: "asc" | "desc") => sortStockRows(rows, { key, dir }).map((r) => r.id);
  it("sorts by name by default and breaks ties by model", () => {
    expect(sortStockRows(rows, STOCK_DEFAULT_SORT).map((r) => r.name)).toEqual(["Gaffer tape", "Laptop", "Old mixer", "Other company thing", "XLR cable"]);
  });
  it("sorts numbers both ways", () => {
    expect(order("usable", "desc").slice(0, 2)).toEqual(["xlr", "laptop"]);
    expect(order("usable", "asc")[0]).toBe("tape");
  });
  it("always puts missing values last", () => {
    const mixed = [...rows, ...build("", new Set()).filter((r) => r.id === "other").map((r) => ({ ...r, id: "hidden" }))];
    expect(sortStockRows(mixed, { key: "warehouse", dir: "asc" }).at(-1)?.id).toBe("hidden");
    expect(sortStockRows(mixed, { key: "warehouse", dir: "desc" }).at(-1)?.id).toBe("hidden");
  });
  it("never compares costs in different currencies", () => {
    const costed = [
      { ...rows[0]!, id: "a", cost: { amount: 100, currency: "USD" } },
      { ...rows[1]!, id: "b", cost: { amount: 5, currency: "AED" } },
      { ...rows[2]!, id: "c", cost: { amount: 10, currency: "AED" } },
    ];
    expect(sortStockRows(costed, { key: "cost", dir: "asc" }).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("does not change the input", () => {
    const before = rows.map((r) => r.id);
    sortStockRows(rows, { key: "usable", dir: "desc" });
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("outText", () => {
  it("says where equipment is out in words", () => {
    expect(outText({ outProjects: 2, outEmployees: 1 })).toBe("2 on projects, 1 with employees");
    expect(outText({ outProjects: 0, outEmployees: 0 })).toBe("None");
    expect(outText({ outProjects: 2.5, outEmployees: 0 })).toBe("2.5 on projects");
  });
});
