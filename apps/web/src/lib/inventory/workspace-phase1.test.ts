import { describe, expect, it } from "vitest";
import type { RequestModel } from "./planning-data";
import { jobItemsOf, pickDoneMessage, pickFlags, returnResultLine, scanForRequest, sendItemsOf, toPickOf } from "./workspace";

type Res = { id: string; unit_id: string | null; unit_code?: string | null; picked_qty?: number; qty: number; dispatched_qty: number; returned_qty: number; status: "active" | "completed" | "released" };
const line = (id: string, itemId: string, name: string, tracking: string, qty: number, reservations: Res[]) => ({
  id, itemId, itemName: name, itemModel: null, tracking, unit: "each", scale: 0, status: "open", qty, reservations,
});

describe("Inventory Phase 1: pick, the four quantities, scans and the result line", () => {
  const job = { request: { id: "r7" }, lines: [
    line("l1", "panel", "LED panel", "individual", 4, [
      { id: "a", unit_id: "u1", unit_code: "UAE-E-00001", qty: 1, dispatched_qty: 1, returned_qty: 0, status: "active" },
      { id: "b", unit_id: "u2", unit_code: "UAE-E-00002", qty: 1, dispatched_qty: 0, returned_qty: 0, status: "active", picked_qty: 1 },
      { id: "c", unit_id: "u3", unit_code: "UAE-E-00003", qty: 1, dispatched_qty: 0, returned_qty: 0, status: "active", picked_qty: 0 },
    ]),
    line("l2", "cable", "Power cable", "quantity", 8, [{ id: "d", unit_id: null, qty: 8, dispatched_qty: 2, returned_qty: 0, status: "active", picked_qty: 5 }]),
    line("l3", "truss", "Truss", "quantity", 6, []),
  ] } as unknown as RequestModel;
  const items = jobItemsOf(job);
  const panel = items.find((i) => i.itemId === "panel")!, cable = items.find((i) => i.itemId === "cable")!, truss = items.find((i) => i.itemId === "truss")!;

  it("gives every open item its requested, reserved, picked-and-waiting and sent quantities, also one with nothing reserved", () => {
    expect([panel.asked, panel.reserved, panel.pickedWaiting, panel.sent]).toEqual([4, 3, 1, 1]);
    expect([cable.asked, cable.reserved, cable.pickedWaiting, cable.sent]).toEqual([8, 8, 3, 2]);
    expect([truss.asked, truss.reserved, truss.pickedWaiting, truss.sent]).toEqual([6, 0, 0, 0]);
    expect(panel.units.map((u) => [u.code, u.picked])).toEqual([["UAE-E-00002", true], ["UAE-E-00003", false]]);
    expect([toPickOf(panel), toPickOf(cable), toPickOf(truss)]).toEqual([1, 3, 0]);
    // the Send step still lists only what is reserved
    expect(sendItemsOf(job).map((i) => i.itemId).sort()).toEqual(["cable", "panel"]);
  });

  it("a scan ticks a reserved unit, and says when it is a repeat, already sent, or the wrong item", () => {
    expect(scanForRequest(items, new Set(), ["UAE-E-00001"], "uae-e-00003")).toMatchObject({ kind: "ticked", unitId: "u3", code: "UAE-E-00003" });
    // a label's QR code holds an address ending in the code
    expect(scanForRequest(items, new Set(), [], "https://os.example/inventory/scan?c=UAE-E-00002")).toMatchObject({ kind: "ticked", unitId: "u2" });
    expect(scanForRequest(items, new Set(["u3"]), [], "UAE-E-00003")).toMatchObject({ kind: "duplicate" });
    expect(scanForRequest(items, new Set(), ["UAE-E-00001"], "UAE-E-00001")).toMatchObject({ kind: "sent" });
    const wrong = scanForRequest(items, new Set(), [], "UAE-E-00999", "picked");
    expect(wrong).toMatchObject({ kind: "wrong", code: "UAE-E-00999" });
    expect(wrong.kind === "wrong" && wrong.text).toMatch(/not reserved for this request, so it cannot be picked/);
    expect(scanForRequest(items, new Set(), [], "   ")).toMatchObject({ kind: "empty" });
  });

  it("blocks a code that is not reserved and more than is reserved, and only warns about a part pick", () => {
    expect(pickFlags(items, [], ["UAE-E-00999"]).map((f) => f.level)).toEqual(["block"]);
    expect(pickFlags(items, [{ itemId: "cable", units: [], counted: 7 }], []).map((f) => f.level)).toEqual(["block"]);
    const part = pickFlags(items, [{ itemId: "panel", units: ["u2"], counted: null }, { itemId: "cable", units: [], counted: 4 }], []);
    expect(part.map((f) => f.level)).toEqual(["warn", "warn"]);
    expect(part[0]!.text).toBe("LED panel: 1 of 2 reserved picked. The other 1 stays reserved and on the shelf.");
    expect(pickFlags(items, [{ itemId: "panel", units: ["u2", "u3"], counted: null }, { itemId: "cable", units: [], counted: 6 }], [])).toEqual([]);
  });

  it("says what a return did in one line", () => {
    expect(returnResultLine({ returned: 2, available: 1, held: 1, stillOut: 1 })).toBe("2 returned · 1 available · 1 held for inspection · 1 still out.");
    expect(returnResultLine({ returned: 3, available: 3, held: 0, stillOut: 0 })).toBe("3 returned · 3 available · nothing still out.");
    expect(returnResultLine({ returned: 1.5, available: 1.5, held: 0, stillOut: null })).toBe("1.5 returned · 1.5 available · what is still out could not be read.");
  });

  it("says what a pick recorded, what is outstanding and who acts next", () => {
    expect(pickDoneMessage({ picked_waiting: 7, reserved_not_picked: 4 })).toBe("Picked. 7 are picked and waiting to be sent; 4 reserved are still on the shelf. Next: the warehouse sends the equipment.");
    expect(pickDoneMessage({ picked_waiting: 1, reserved_not_picked: 0 })).toBe("Picked. 1 is picked and waiting to be sent. Next: the warehouse sends the equipment.");
  });
});
