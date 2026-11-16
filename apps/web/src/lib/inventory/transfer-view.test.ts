import { describe, expect, it } from "vitest";
import { nextAction, ownerNote, progressWords, receiptResultWords, transferProgress, viewFromTrace } from "./transfer-view";
import { mapTrace } from "./xshare";
import { lineFrom, lineTo, type LineLike, type Resolver } from "./movement-view";
import { transferRows } from "./today";
import { unitAnswers } from "./unit-answers";

const raw = (over: { status?: string; units?: unknown[]; quantities?: unknown[] } = {}) => ({
  transfer: { transfer_id: "t1", code: "UAE-T-00001", status: over.status ?? "in_transit", sender_company_id: "c-uae", sender_company_name: "Enginious UAE", from_location_id: "l-dxb", from_location_name: "Dubai",
    to_location_id: "l-eu-dxb", to_location_name: "Dubai", to_company_id: "c-eu", to_company_name: "Enginious Europe", dispatched_at: "2026-11-01T08:00:00Z", expected_at: null, received_at: null, carrier: null, reference: null,
    dispatched_by_name: "Omar", received_by_name: null, line_count: 3, still_on_the_way: 2, sharing_revoked: false },
  units: over.units ?? [
    { unit_id: "u1", code: "UAE-E-00001", serial_number: null, item_id: "i1", item_name: "Truss 3 m", category: null, ownership: "owned", owner_company_id: "c-uae", owner_company_name: "Enginious UAE", on_the_way: false, at_destination: true, condition: "damaged", custody_kind: "warehouse" },
    { unit_id: "u2", code: "UAE-E-00002", serial_number: null, item_id: "i1", item_name: "Truss 3 m", category: null, ownership: "owned", owner_company_id: "c-uae", owner_company_name: "Enginious UAE", on_the_way: true, at_destination: false, condition: "good", custody_kind: "transit" },
  ],
  quantities: over.quantities ?? [{ item_id: "i2", item_name: "HDMI cable", category: null, unit_of_measure: "each", owner_company_id: "c-uae", owner_company_name: "Enginious UAE", qty_sent: 4, qty_on_the_way: 1, on_the_way: [] }],
  events: [],
});

describe("a transfer as both sides read it", () => {
  const v = viewFromTrace(mapTrace(raw()));

  it("always names the company with the warehouse, so two warehouses called Dubai are never mixed up", () => {
    expect(v.from.label).toBe("Dubai · Enginious UAE");
    expect(v.to.label).toBe("Dubai · Enginious Europe");
    expect(v.crossCompany).toBe(true);
  });

  it("counts received as sent minus what is still in transit: nothing is assumed to have arrived", () => {
    expect(transferProgress(v)).toEqual({ sent: 6, received: 4, inTransit: 2 });
    expect(progressWords(transferProgress(v))).toBe("6 sent · 4 received · 2 still in transit");
    expect(v.units.map((u) => u.state)).toEqual(["received", "in_transit"]);
  });

  it("says the receiving warehouse acts next while anything is in transit, and nobody once it is complete", () => {
    expect(nextAction(v)).toEqual({ waitingOn: "receiver", text: "Dubai · Enginious Europe acts next: 2 still in transit are received there when they arrive." });
    const fresh = viewFromTrace(mapTrace(raw({ units: [], quantities: [{ item_id: "i2", item_name: "HDMI cable", category: null, unit_of_measure: "each", owner_company_id: "c-uae", owner_company_name: "Enginious UAE", qty_sent: 4, qty_on_the_way: 4, on_the_way: [] }] })));
    expect(nextAction(fresh).text).toBe("Dubai · Enginious Europe acts next: it records the transfer as received when it arrives.");
    const done = viewFromTrace(mapTrace(raw({ status: "received", units: [], quantities: [{ item_id: "i2", item_name: "HDMI cable", category: null, unit_of_measure: "each", owner_company_id: "c-uae", owner_company_name: "Enginious UAE", qty_sent: 4, qty_on_the_way: 0, on_the_way: [] }] })));
    expect(nextAction(done)).toEqual({ waitingOn: "nobody", text: "Complete. Everything was received at Dubai · Enginious Europe." });
  });

  it("names the stock owner only where it differs from the company that runs the destination", () => {
    expect(ownerNote(v.units[0]!, v)).toBe("Owned by Enginious UAE");
    expect(ownerNote({ ownerCompanyId: "c-eu", ownerName: "Enginious Europe" }, v)).toBeNull();
  });

  it("puts a receipt in practical words from what the database returned", () => {
    expect(receiptResultWords({ still_on_the_way: 1, lines: [{ unit_id: "u1", available: true }, { unit_id: "u2", available: true }, { unit_id: "u3", available: false }] })).toBe("3 received · 1 held for inspection · 1 line still in transit.");
    expect(receiptResultWords({ still_on_the_way: 0, lines: [{ item_id: "i2", qty: 4, available: true }] })).toBe("4 received · nothing left in transit.");
    expect(receiptResultWords({})).toBeNull();
  });
});

describe("History shows the real source and destination of a transfer", () => {
  const r: Resolver = { location: (id) => (id === "l1" ? "Dubai · Enginious UAE" : id === "l2" ? "Riyadh · Enginious Saudi Arabia" : "—"), bin: () => null, employee: () => "Sara", project: () => "P" };
  const line = (over: Partial<LineLike>): LineLike => ({ item_id: "i", unit_id: "u", qty: 1, from_kind: "warehouse", to_kind: "warehouse", from_location_id: null, to_location_id: null, from_bin_id: null, to_bin_id: null, from_employee_id: null, to_employee_id: null, from_project_id: null, to_project_id: null, ...over });
  it("a dispatch line goes from the sending warehouse to 'in transit to' the receiving one", () => {
    const l = line({ from_location_id: "l1", to_kind: "transit", to_location_id: "l2" });
    expect(lineFrom(l, r)).toBe("Dubai · Enginious UAE");
    expect(lineTo(l, r)).toBe("In transit to Riyadh · Enginious Saudi Arabia");
  });
  it("a receipt line comes 'in transit from' the sending warehouse into the receiving one", () => {
    const l = line({ from_kind: "transit", from_location_id: "l1", to_location_id: "l2" });
    expect(lineFrom(l, r)).toBe("In transit from Dubai · Enginious UAE");
    expect(lineTo(l, r)).toBe("Riyadh · Enginious Saudi Arabia");
  });
});

describe("Today: a transfer this warehouse sent waits on the other warehouse", () => {
  const now = { now: new Date("2026-10-19T09:30:00+04:00") };
  const t = { id: "t1", code: "UAE-T-00001", fromName: "Dubai · Enginious UAE", toName: "Riyadh · Enginious Saudi Arabia", expectedAt: null, zone: "Asia/Dubai", items: 2, sent: 5 };
  it("says who acts and what is still outstanding, opens the transfer, and offers nothing that changes stock", () => {
    const [row] = transferRows([{ ...t, direction: "out" }], now, { here: true });
    expect(row!.title).toBe("Transfer UAE-T-00001 to Riyadh · Enginious Saudi Arabia: in transit");
    expect(row!.forWhom).toBe("From Dubai · Enginious UAE · 2 items still in transit");
    expect(row!.waitingOn).toBe("Riyadh · Enginious Saudi Arabia");
    expect(row!.responsible).toBe("Riyadh · Enginious Saudi Arabia records it as received");
    expect(row!.facts.map((f) => f.text)).toEqual(["3 of 5 already received"]);
    expect(row!.href).toBe("/inventory/transfers/t1");
    expect(row!.operates).toBe(false);
  });
  it("an incoming transfer that was partly received says so and still opens Receive transfer against it", () => {
    const [row] = transferRows([t], now, { here: true });
    expect(row!.facts.map((f) => f.text)).toEqual(["3 of 5 already received"]);
    expect(row!.href).toBe("/inventory/stock?action=transfer&mode=receive&transfer=t1");
    expect(row!.waitingOn).toBeUndefined();
  });
});

describe("where is it, who has it, is it available, what next", () => {
  const base = { lifecycle: "active", custody: "warehouse", condition: "good", inKit: false, where: "In the warehouse: Dubai", employeeName: null, projectName: null, overdue: false };
  it("a good unit on the shelf is available", () => {
    const a = unitAnswers(base);
    expect(a.available).toBe(true);
    expect(a.availability).toBe("Available (good)");
    expect(a.nextAction).toBe("give");
  });
  it("a damaged or inspection-held unit is NOT available until it is inspected", () => {
    for (const condition of ["damaged", "needs_inspection", "unserviceable"]) {
      const a = unitAnswers({ ...base, condition });
      expect(a.available).toBe(false);
      expect(a.availability).toMatch(/^Not available: .*held for inspection$/);
      expect(a.nextAction).toBe("inspect");
    }
  });
  it("names the holder and what to do when it is out, in transit, at the repairer or missing", () => {
    expect(unitAnswers({ ...base, custody: "employee", employeeName: "Riya Rigger", overdue: true })).toMatchObject({ who: "Riya Rigger", available: false, availability: "Not available: with Riya Rigger, overdue", nextAction: "receive_return" });
    expect(unitAnswers({ ...base, custody: "transit" })).toMatchObject({ available: false, nextAction: "receive_transfer" });
    expect(unitAnswers({ ...base, custody: "repair" })).toMatchObject({ who: "The repairer", nextAction: "repair_in" });
    expect(unitAnswers({ ...base, lifecycle: "missing" })).toMatchObject({ available: false, nextAction: "found" });
    expect(unitAnswers({ ...base, lifecycle: "draft" })).toMatchObject({ available: false, availability: "Not available: not counted yet" });
  });
});
