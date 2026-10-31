import { describe, expect, it } from "vitest";
import type { RequestModel } from "./planning-data";
import { heldTotals, requestItemTotals, returnOutcome, sendFlags, sendItemsOf, unitHolder } from "./workspace";

type Res = { id: string; unit_id: string | null; unit_code?: string | null; qty: number; dispatched_qty: number; returned_qty: number; status: "active" | "completed" | "released" };
const line = (id: string, itemId: string, name: string, tracking: string, reservations: Res[], status = "open") => ({
  id, itemId, itemName: name, itemModel: null, tracking, unit: "each", scale: 0, status, reservations,
});
const model = (id: string, lines: ReturnType<typeof line>[]): RequestModel => ({ request: { id }, lines } as unknown as RequestModel);

const request = model("r1", [
  line("l1", "proj", "Video projector", "individual", [
    { id: "a", unit_id: "u1", unit_code: "PJ-1", qty: 1, dispatched_qty: 1, returned_qty: 0, status: "active" },
    { id: "b", unit_id: "u2", unit_code: "PJ-2", qty: 1, dispatched_qty: 0, returned_qty: 0, status: "active" },
    { id: "c", unit_id: "u3", unit_code: "PJ-3", qty: 1, dispatched_qty: 0, returned_qty: 0, status: "active" },
  ]),
  line("l2", "cable", "HDMI cable", "quantity", [{ id: "d", unit_id: null, qty: 10, dispatched_qty: 4, returned_qty: 0, status: "active" }]),
  line("l3", "cable", "HDMI cable", "quantity", [{ id: "e", unit_id: null, qty: 6, dispatched_qty: 0, returned_qty: 0, status: "active" }]),
  line("l4", "gone", "Old item", "individual", [{ id: "f", unit_id: "u9", qty: 1, dispatched_qty: 0, returned_qty: 0, status: "released" }]),
]);

describe("what is reserved and still to send", () => {
  const items = sendItemsOf(request);
  it("lists only reserved equipment, one entry per item, never per line", () => {
    expect(items.map((i) => i.name)).toEqual(["HDMI cable", "Video projector"]);
  });
  it("offers the reserved units that have not been sent, not the one already out", () => {
    const pj = items.find((i) => i.itemId === "proj")!;
    expect(pj.units.map((u) => u.code)).toEqual(["PJ-2", "PJ-3"]);
    expect(pj.sent).toBe(1);
  });
  it("adds counted stock over lines of the same item", () => {
    const cable = items.find((i) => i.itemId === "cable")!;
    expect(cable.countedToSend).toBe(12);
    expect(cable.sent).toBe(4);
  });
  it("never offers a released reservation", () => {
    expect(items.some((i) => i.itemId === "gone")).toBe(false);
  });
});

describe("flags before confirmation", () => {
  const items = sendItemsOf(request);
  it("a code that is not reserved blocks", () => {
    const f = sendFlags(items, [], ["WM-0099"]);
    expect(f).toHaveLength(1);
    expect(f[0]!.level).toBe("block");
    expect(f[0]!.text).toContain("will not fulfil this request");
  });
  it("sending some of the reserved units warns and does not block", () => {
    expect(sendFlags(items, [{ itemId: "proj", units: ["u2"], counted: null }], [])).toEqual([{ level: "warn", text: "Video projector: sending 1 of 2 reserved. The other 1 stay reserved and unsent." }]);
  });
  it("sending every remaining unit raises nothing", () => {
    expect(sendFlags(items, [{ itemId: "proj", units: ["u2", "u3"], counted: null }], [])).toEqual([]);
  });
  it("counting more than is reserved and unsent blocks; fewer warns", () => {
    expect(sendFlags(items, [{ itemId: "cable", units: [], counted: 13 }], [])[0]!.level).toBe("block");
    expect(sendFlags(items, [{ itemId: "cable", units: [], counted: 5 }], [])[0]!.level).toBe("warn");
    expect(sendFlags(items, [{ itemId: "cable", units: [], counted: 12 }], [])).toEqual([]);
  });
  it("an untouched item is never assumed", () => {
    expect(sendFlags(items, [{ itemId: "proj", units: [], counted: null }, { itemId: "cable", units: [], counted: null }], [])).toEqual([]);
  });
});

describe("Sent / Returned / Still out at the level the data supports", () => {
  it("units are exact for the request", () => {
    const m = model("r1", [line("l1", "proj", "Projector", "individual", [
      { id: "a", unit_id: "u1", qty: 1, dispatched_qty: 1, returned_qty: 1, status: "completed" },
      { id: "b", unit_id: "u2", qty: 1, dispatched_qty: 1, returned_qty: 0, status: "active" },
    ])]);
    expect(requestItemTotals(m, [m], new Map())).toEqual([{ itemId: "proj", name: "Projector", individual: true, sent: 2, returned: 1, stillOut: 1, level: "request", note: null }]);
  });
  it("counted stock is exact for the request only when nothing else could have been returned in its place", () => {
    const m = model("r1", [line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 10, returned_qty: 4, status: "active" }])]);
    const t = requestItemTotals(m, [m], heldTotals([{ itemId: "cable", type: "counted", qty: 6 }]))[0]!;
    expect(t).toMatchObject({ level: "request", sent: 10, returned: 4, stillOut: 6 });
  });
  it("counted stock sent for two requests is shown for the project, with the reason, and returned is never guessed", () => {
    const m1 = model("r1", [line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 10, returned_qty: 4, status: "active" }])]);
    const m2 = model("r2", [line("l2", "cable", "Cable", "quantity", [{ id: "b", unit_id: null, qty: 5, dispatched_qty: 5, returned_qty: 0, status: "active" }])]);
    const t = requestItemTotals(m1, [m1, m2], heldTotals([{ itemId: "cable", type: "counted", qty: 11 }]))[0]!;
    expect(t.level).toBe("project");
    expect(t.returned).toBeNull();
    expect(t.stillOut).toBe(11);
    expect(t.sent).toBe(10);
    expect(t.note).toContain("more than one request");
  });
  it("two lines of one request with the same counted item are not split by line", () => {
    const m = model("r1", [
      line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 10, returned_qty: 0, status: "active" }]),
      line("l2", "cable", "Cable", "quantity", [{ id: "b", unit_id: null, qty: 5, dispatched_qty: 5, returned_qty: 0, status: "active" }]),
    ]);
    const t = requestItemTotals(m, [m], heldTotals([{ itemId: "cable", type: "counted", qty: 15 }]));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ level: "project", sent: 15, returned: null, stillOut: 15 });
  });
  it("what the project holds differing from what was sent (an unlinked dispatch or return) falls back to project level", () => {
    const m = model("r1", [line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 10, returned_qty: 0, status: "active" }])]);
    const t = requestItemTotals(m, [m], heldTotals([{ itemId: "cable", type: "counted", qty: 13 }]))[0]!;
    expect(t).toMatchObject({ level: "project", returned: null, stillOut: 13 });
  });
  it("when what the project holds could not be loaded, nothing is claimed about what is still out", () => {
    const m = model("r1", [line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 10, returned_qty: 0, status: "active" }])]);
    const t = requestItemTotals(m, [m], null)[0]!;
    expect(t).toMatchObject({ level: "project", returned: null, stillOut: null });
  });
  it("items never sent are not listed", () => {
    const m = model("r1", [line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 0, returned_qty: 0, status: "active" }])]);
    expect(requestItemTotals(m, [m], new Map())).toEqual([]);
  });
});

describe("whose request a held unit belongs to", () => {
  const mine = model("r1", [line("l1", "proj", "P", "individual", [{ id: "a", unit_id: "u1", qty: 1, dispatched_qty: 1, returned_qty: 0, status: "active" }])]);
  const other = model("r2", [line("l2", "proj", "P", "individual", [{ id: "b", unit_id: "u2", qty: 1, dispatched_qty: 1, returned_qty: 0, status: "active" }])]);
  it("this request, another request, or none", () => {
    expect(unitHolder("u1", mine, [mine, other])).toBe("this");
    expect(unitHolder("u2", mine, [mine, other])).toBe("other");
    expect(unitHolder("u3", mine, [mine, other])).toBe("none");
  });
});

describe("what a return does to availability", () => {
  it("good or fair units are available again; the rest are held; nothing chosen is nothing assumed", () => {
    expect(returnOutcome("good", true)).toBe("available");
    expect(returnOutcome("fair", true)).toBe("available");
    expect(returnOutcome("damaged", true)).toBe("held");
    expect(returnOutcome("needs_inspection", true)).toBe("held");
    expect(returnOutcome("", true)).toBe("unset");
  });
  it("counted stock is available again only when good", () => {
    expect(returnOutcome("good", false)).toBe("available");
    expect(returnOutcome("needs_inspection", false)).toBe("held");
  });
});
