import { describe, expect, it } from "vitest";
import type { RequestModel } from "./planning-data";
import { countedHeldFromEquipment, heldTotals, outstandingView, requestItemTotals, returnOutcome, sendFlags, sendItemsOf, unitHolder, withCountedZeros } from "./workspace";

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

// ---------------------------------------------------------------------------------------------------------------
// The existing request panel and Project → Equipment use the same rules
// ---------------------------------------------------------------------------------------------------------------
const withRequest = (id: string, code: string, lines: ReturnType<typeof line>[]): RequestModel => ({ request: { id, code }, lines } as unknown as RequestModel);
const out = (lineId: string, name: string, qty: number, over: Record<string, unknown> = {}) => ({ request_code: "R", line_id: lineId, item_name: name, unit_code: null, qty_outstanding: qty, expected_return_at: null, overdue: false, ...over });

describe("what the project holds, read from the project equipment answer (no stock access needed)", () => {
  const m1 = withRequest("r1", "UAE-R-1", [line("l1", "cable", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 10, dispatched_qty: 10, returned_qty: 4, status: "active" }]), line("lp", "proj", "Projector", "individual", [])]);
  it("sums the counted quantity out on request lines and adds stock held without a request; units are not counted here", () => {
    const eq = { outstanding: [out("l1", "Cable", 6), out("lp", "Projector", 1, { unit_code: "PJ-1" })], unlinked: [{ item_name: "Cable", qty_outstanding: 3, unit_code: null }, { item_name: "Tripod", qty_outstanding: 2, unit_code: null }] };
    const { held, unclear } = countedHeldFromEquipment(eq, [m1]);
    expect(held.get("cable")).toBe(9);
    expect(held.has("proj")).toBe(false);
    expect(held.has("tripod")).toBe(false);
    expect(unclear.size).toBe(0);
  });
  it("an item the project holds none of is 0, not unknown", () => {
    expect(countedHeldFromEquipment({ outstanding: [], unlinked: [] }, [m1]).held.get("cable")).toBe(0);
    expect(withCountedZeros(new Map(), [m1]).get("cable")).toBe(0);
  });
  it("unnamed stock under a name two catalogue items share is not attributed to either", () => {
    const m = withRequest("r1", "R1", [line("l1", "c1", "Cable", "quantity", [{ id: "a", unit_id: null, qty: 5, dispatched_qty: 5, returned_qty: 0, status: "active" }]), line("l2", "c2", "Cable", "quantity", [{ id: "b", unit_id: null, qty: 5, dispatched_qty: 5, returned_qty: 0, status: "active" }])]);
    const { unclear } = countedHeldFromEquipment({ outstanding: [out("l1", "Cable", 5), out("l2", "Cable", 5)], unlinked: [{ item_name: "Cable", qty_outstanding: 2, unit_code: null }] }, [m]);
    expect([...unclear].sort()).toEqual(["c1", "c2"]);
    const t = requestItemTotals(m, [m], new Map([["c1", 5], ["c2", 5]]), unclear);
    expect(t.every((x) => x.level === "project" && x.stillOut === null && x.returned === null)).toBe(true);
    expect(t[0]!.note).toContain("matches more than one catalogue item");
  });
});

describe("Project → Equipment: counted stock is merged to one project row only where a request cannot be named", () => {
  const cable = (id: string, code: string, lineId: string, sent: number, ret: number) => withRequest(id, code, [line(lineId, "cable", "Cable", "quantity", [{ id: `x${id}`, unit_id: null, qty: sent, dispatched_qty: sent, returned_qty: ret, status: "active" }]), line(`${lineId}u`, "proj", "Projector", "individual", [{ id: `p${id}`, unit_id: "u1", unit_code: "PJ-1", qty: 1, dispatched_qty: 1, returned_qty: 0, status: "active" }])]);
  it("two requests sent the same cable: the per-line rows become one row for the project, with where it was sent for; the unit row is untouched", () => {
    const a = cable("r1", "R-1", "la", 10, 4); const b = cable("r2", "R-2", "lb", 5, 0);
    const eq = { outstanding: [out("la", "Cable", 6, { expected_return_at: "2030-04-03T06:00:00Z" }), out("lb", "Cable", 5, { expected_return_at: "2030-04-01T06:00:00Z", overdue: true }), out("lau", "Projector", 1, { unit_code: "PJ-1" })], unlinked: [] };
    const { held, unclear } = countedHeldFromEquipment(eq, [a, b]);
    const totals = new Map([[a.request.id, requestItemTotals(a, [a, b], held, unclear)], [b.request.id, requestItemTotals(b, [a, b], held, unclear)]]);
    const v = outstandingView(eq, [a, b], totals);
    expect(v.outstanding.map((o) => o.unit_code)).toEqual(["PJ-1"]);
    expect(v.projectLevel).toHaveLength(1);
    expect(v.projectLevel[0]).toMatchObject({ name: "Cable", qty: 11, overdue: true, expectedReturnAt: "2030-04-01T06:00:00Z", requestCodes: ["R-1", "R-2"] });
  });
  it("a single request that can be named keeps the database's own rows (no merge, nothing hidden)", () => {
    const a = cable("r1", "R-1", "la", 10, 4);
    const eq = { outstanding: [out("la", "Cable", 6)], unlinked: [] };
    const { held, unclear } = countedHeldFromEquipment(eq, [a]);
    const v = outstandingView(eq, [a], new Map([["r1", requestItemTotals(a, [a], held, unclear)]]));
    expect(v.projectLevel).toEqual([]);
    expect(v.outstanding).toHaveLength(1);
  });
  it("unnamed stock of the same item (sent without a request) is folded into the project row instead of listed twice", () => {
    const a = cable("r1", "R-1", "la", 10, 0);
    const eq = { outstanding: [out("la", "Cable", 10)], unlinked: [{ item_name: "Cable", unit_code: null, qty_outstanding: 3, expected_return_at: null, overdue: false }] };
    const { held, unclear } = countedHeldFromEquipment(eq, [a]);
    const v = outstandingView(eq, [a], new Map([["r1", requestItemTotals(a, [a], held, unclear)]]));
    expect(v.unlinked).toEqual([]);
    expect(v.projectLevel[0]).toMatchObject({ name: "Cable", qty: 13 });
  });
  it("when everything is back at project level nothing is listed as out", () => {
    const a = cable("r1", "R-1", "la", 10, 10); const b = cable("r2", "R-2", "lb", 5, 5);
    const eq = { outstanding: [], unlinked: [] };
    const { held, unclear } = countedHeldFromEquipment(eq, [a, b]);
    const v = outstandingView(eq, [a, b], new Map([["r1", requestItemTotals(a, [a, b], held, unclear)], ["r2", requestItemTotals(b, [a, b], held, unclear)]]));
    expect(v.projectLevel).toEqual([]);
  });
});
