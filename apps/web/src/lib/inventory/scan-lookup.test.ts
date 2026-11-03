import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { resolveScan } from "./scan-lookup";

type Row = Record<string, unknown> | null;
/** A fake data client: tables answer from `tables`. `rpc` is a spy: only a code the tables do not show may reach the read-only cross-company lookup (default: nothing found). */
function fakeDb(tables: Record<string, Row>, failing: string[] = [], xunits: Record<string, unknown>[] = []) {
  const rpc = vi.fn(async () => ({ data: xunits, error: null }));
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
    expect(r).toMatchObject({ status: "found", kind: "unit", id: "u1", itemName: "Laptop · X1", openHref: "/inventory/stock?unit=u1" });
    expect(r.status === "found" && r.facts).toEqual(["Not counted yet", "In the warehouse", "Dubai"]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("opens the item for a bin label", async () => {
    const { db, rpc } = fakeDb({ inv_balances: { id: "b1", label_code: "UAE-S-00007", item_id: "i9", location_id: "l1", bin_id: "bin1" }, inv_items: item, inv_locations: { name: "Dubai" }, inv_bins: { code: "A-12" } });
    const r = await resolveScan(db, "UAE-S-00007");
    expect(r).toMatchObject({ status: "found", kind: "stock", openHref: "/inventory/stock?open=i9" });
    expect(r.status === "found" && r.facts).toEqual(["Item in a bin", "Bin A-12", "Dubai"]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("answers an unknown code and a hidden code in exactly the same way", async () => {
    const hidden = await resolveScan(fakeDb({}).db, "UAE-E-00042");
    const unknown = await resolveScan(fakeDb({ inv_units: null }).db, "UAE-E-99999");
    expect(hidden).toEqual({ status: "unavailable" });
    expect(unknown).toEqual(hidden);
  });
  it("finds another company's unit that the person may handle (in transit to their warehouse) through the narrow function only", async () => {
    const x = { unit_id: "u9", code: "UAE-E-00042", serial_number: "SN1", item_id: "i1", item_name: "LED panel", category_name: null, condition: "good", custody_kind: "transit", ownership: "owned",
      owner_company_id: "c1", owner_company_name: "Enginious UAE", location_id: "l9", location_name: "Riyadh warehouse", location_company_id: "c2", bin_id: null, bin_code: null, transfer_id: "t1", transfer_code: "TR-1", usable_here: false };
    const { db, rpc } = fakeDb({}, [], [x]);
    const r = await resolveScan(db, "UAE-E-00042");
    expect(r).toMatchObject({ status: "found", kind: "unit", id: "u9", itemName: "LED panel", openHref: "/inventory/stock?unit=UAE-E-00042" });
    expect(r.status === "found" && r.facts).toEqual(["On the way to Riyadh warehouse (TR-1)", "Owned by Enginious UAE"]);
    expect(rpc).toHaveBeenCalledWith("inv_xshare_units", { p_location_id: null, p_code: "UAE-E-00042" });
  });
  it("adds the revoked message to a unit the owner has stopped sharing, which is still found (receiving and tracking are not blocked)", async () => {
    const x = { unit_id: "u9", code: "UAE-E-00042", serial_number: "SN1", item_id: "i1", item_name: "LED panel", category_name: null, condition: "good", custody_kind: "warehouse", ownership: "owned",
      owner_company_id: "c1", owner_company_name: "Enginious UAE", location_id: "l9", location_name: "Riyadh warehouse", location_company_id: "c2", bin_id: null, bin_code: null, transfer_id: null, transfer_code: null, usable_here: false, sharing_revoked: true };
    const r = await resolveScan(fakeDb({}, [], [x]).db, "UAE-E-00042");
    expect(r.status === "found" && r.facts).toEqual(["At Riyadh warehouse", "Owned by Enginious UAE", "Sharing revoked\u2014contact owner"]);
  });
  it("treats a missing cross-company function as an unknown code, and any other failure as could-not-look-up", async () => {
    const missing = fakeDb({});
    missing.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } } as never);
    expect(await resolveScan(missing.db, "UAE-E-00042")).toEqual({ status: "unavailable" });
    const broken = fakeDb({});
    broken.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } } as never);
    expect(await resolveScan(broken.db, "UAE-E-00042")).toEqual({ status: "error" });
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
