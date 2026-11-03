import { describe, expect, it } from "vitest";
import { formDestination, formTransferFrom, mapDestination, mapTrace, mapUnit, ownedByText, traceSteps, xUnitStatus, type Raw } from "./xshare";

const head: Raw = {
  transfer_id: "t1", code: "UAE-T-00001", status: "in_transit", sender_company_id: "c1", sender_company_name: "Enginious UAE", from_location_id: "l1", from_location_name: "Dubai warehouse",
  to_location_id: "l2", to_location_name: "Riyadh warehouse", to_company_id: "c2", to_company_name: "Enginious KSA", dispatched_at: "2026-11-01T08:00:00Z", expected_at: "2026-11-04T08:00:00Z",
  received_at: null, carrier: "DHL", reference: "WB-9", dispatched_by_name: "Sara", received_by_name: null,
};
const raw = (status = "in_transit"): Raw => ({
  transfer: { ...head, status },
  units: [{ unit_id: "u1", code: "UAE-E-00042", serial_number: "SN-1", item_id: "i1", item_name: "LED panel", category: "Screens", ownership: "owned", owner_company_id: "c1", owner_company_name: "Enginious UAE",
    on_the_way: status === "in_transit", at_destination: status === "received", condition: "good", custody_kind: status === "received" ? "warehouse" : "transit" }],
  quantities: [{ item_id: "i2", item_name: "HDMI cable", category: null, unit_of_measure: "each", owner_company_id: "c1", owner_company_name: "Enginious UAE", qty_sent: 4, qty_on_the_way: 4, on_the_way: [{ condition: "good", qty: 4, rented: false }] }],
  events: [
    { movement_code: "UAE-M-1", kind: "transfer_dispatch", occurred_at: "2026-11-01T08:00:00Z", by_name: "Sara", filed_under_company_id: "c1", filed_under_company_name: "Enginious UAE", lines: [{ unit_id: "u1", code: "UAE-E-00042", item_id: "i1", item_name: "LED panel", qty: 1, condition_from: "good", condition_to: "good" }] },
    ...(status === "received" ? [{ movement_code: "KSA-M-1", kind: "transfer_receive", occurred_at: "2026-11-03T09:00:00Z", by_name: "Omar", filed_under_company_id: "c2", filed_under_company_name: "Enginious KSA", lines: [{ unit_id: "u1", code: "UAE-E-00042", item_id: "i1", item_name: "LED panel", qty: 1, condition_from: "good", condition_to: "good" }] }] : []),
  ],
});

describe("cross-company receiving: mapping what the database functions return", () => {
  it("turns an in-transit trace into the Receive transfer form's transfer, naming both warehouses with their company and the owner of every line", () => {
    const f = formTransferFrom(mapTrace(raw()), { from: "Dubai warehouse · Enginious UAE", to: "Riyadh warehouse · Enginious KSA" });
    expect(f).toMatchObject({ id: "t1", code: "UAE-T-00001", toLocationId: "l2", fromName: "Dubai warehouse · Enginious UAE", toName: "Riyadh warehouse · Enginious KSA", carrier: "DHL", reference: "WB-9" });
    expect(f.held).toHaveLength(2);
    expect(f.held[0]).toMatchObject({ type: "unit", unitId: "u1", code: "UAE-E-00042", serial: "SN-1", custody: "transit", ownedBy: "Owned by Enginious UAE" });
    expect(f.held[1]).toMatchObject({ type: "counted", itemName: "HDMI cable", qty: 4, condition: "good", custody: "transit" });
  });
  it("lists nothing to receive once everything arrived", () => {
    expect(formTransferFrom(mapTrace({ ...raw("received"), quantities: [] }), { from: "a", to: "b" }).held).toEqual([]);
  });
  it("a Send destination of another company carries the owner that authorised it", () => {
    const d = mapDestination({ location_id: "l2", location_code: "RUH", location_name: "Riyadh warehouse", timezone: "Asia/Riyadh", company_id: "c2", company_name: "Enginious KSA", owner_company_id: "c1", owner_company_name: "Enginious UAE" });
    expect(formDestination(d)).toMatchObject({ id: "l2", companyId: "c2", companyName: "Enginious KSA", sharedFrom: "c1", bins: [] });
  });
  it("says where a unit is, and why it is held back, in plain words", () => {
    const base: Raw = { unit_id: "u1", code: "UAE-E-00042", serial_number: null, item_id: "i1", item_name: "LED panel", category_name: null, condition: "good", custody_kind: "transit", ownership: "rental", owner_company_id: "c1", owner_company_name: "Enginious UAE",
      location_id: "l2", location_name: "Riyadh warehouse", location_company_id: "c2", bin_id: null, bin_code: null, transfer_id: "t1", transfer_code: "UAE-T-00001", usable_here: false };
    expect(xUnitStatus(mapUnit(base))).toBe("On the way to Riyadh warehouse (UAE-T-00001)");
    expect(mapUnit(base).rented).toBe(true);
    expect(xUnitStatus(mapUnit({ ...base, custody_kind: "warehouse", transfer_id: null, usable_here: true }))).toBe("Available at Riyadh warehouse");
    expect(xUnitStatus(mapUnit({ ...base, custody_kind: "warehouse", condition: "needs_inspection", transfer_id: null }))).toBe("At Riyadh warehouse, held back (needs checking)");
    expect(ownedByText("Enginious UAE")).toBe("Owned by Enginious UAE");
  });
  it("the trace reads dispatch, in transit, receipt the same for both sides, and shows the receipt only when it happened", () => {
    const fmt = (iso: string) => iso.slice(0, 10);
    const open = traceSteps(mapTrace(raw()), fmt);
    expect(open.map((s) => [s.key, s.state])).toEqual([["dispatched", "done"], ["in_transit", "current"], ["received", "waiting"]]);
    expect(open[2]!.detail).toBe("Not received yet at Riyadh warehouse");
    const done = traceSteps(mapTrace(raw("received")), fmt);
    expect(done.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(done[2]!.detail).toBe("2026-11-03 at Riyadh warehouse (Enginious KSA), by Omar");
    expect(done[0]!.detail).toContain("Dubai warehouse (Enginious UAE), by Sara");
  });
});
