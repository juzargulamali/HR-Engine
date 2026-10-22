import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { resolveScan } from "./scan-lookup";

type Row = Record<string, unknown> | null;
/** A fake data client: tables answer from `tables`, and `rpc` is a spy that must never be called. */
function fakeDb(tables: Record<string, Row>, failing: string[] = []) {
  const rpc = vi.fn();
  const from = vi.fn((table: string) => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => (failing.includes(table) ? { data: null, error: { message: "boom" } } : { data: tables[table] ?? null, error: null }) };
    return chain;
  });
  return { db: { from, rpc } as unknown as SupabaseClient<Database>, from, rpc };
}

const unit = { id: "u1", code: "UAE-E-00042", item_id: "i1", lifecycle: "draft", custody_kind: "warehouse", location_id: "l1", bin_id: null };
const item = { name: "Laptop", model: "X1", specification: null };

describe("resolveScan", () => {
  it("finds a unit the person may see and opens its record", async () => {
    const { db, rpc } = fakeDb({ inv_units: unit, inv_items: item, inv_locations: { name: "Dubai" } });
    const r = await resolveScan(db, "https://os.example.com/inventory/scan?c=UAE-E-00042");
    expect(r).toMatchObject({ status: "found", kind: "unit", id: "u1", itemName: "Laptop · X1", openHref: "/inventory?unit=u1" });
    expect(r.status === "found" && r.facts).toEqual(["Not counted yet", "In the warehouse", "Dubai"]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("opens the item for a bin label", async () => {
    const { db, rpc } = fakeDb({ inv_balances: { id: "b1", label_code: "UAE-S-00007", item_id: "i9", location_id: "l1", bin_id: "bin1" }, inv_items: item, inv_locations: { name: "Dubai" }, inv_bins: { code: "A-12" } });
    const r = await resolveScan(db, "UAE-S-00007");
    expect(r).toMatchObject({ status: "found", kind: "stock", openHref: "/inventory?open=i9" });
    expect(r.status === "found" && r.facts).toEqual(["Item in a bin", "Bin A-12", "Dubai"]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("answers an unknown code and a hidden code in exactly the same way", async () => {
    const hidden = await resolveScan(fakeDb({}).db, "UAE-E-00042");
    const unknown = await resolveScan(fakeDb({ inv_units: null }).db, "UAE-E-99999");
    expect(hidden).toEqual({ status: "unavailable" });
    expect(unknown).toEqual(hidden);
  });
  it("never reads the database for something that is not an Inventory code", async () => {
    const { db, from, rpc } = fakeDb({});
    expect(await resolveScan(db, "https://example.com")).toEqual({ status: "not_inventory", problem: "not_inventory" });
    expect(await resolveScan(db, " ")).toEqual({ status: "not_inventory", problem: "empty" });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("says it could not look up, instead of 'not available', when the data service fails", async () => {
    expect(await resolveScan(fakeDb({}, ["inv_units"]).db, "UAE-E-00042")).toEqual({ status: "error" });
  });
  it("reads only the tables it needs and never an employee or project table", async () => {
    const { db, from } = fakeDb({ inv_units: { ...unit, custody_kind: "employee" }, inv_items: item });
    const r = await resolveScan(db, "UAE-E-00042");
    expect(r.status === "found" && r.facts).toEqual(["Not counted yet", "With an employee"]);
    const tables = from.mock.calls.map((c) => c[0]);
    expect(new Set(tables)).toEqual(new Set(["inv_units", "inv_items", "inv_locations"]));
  });
});
