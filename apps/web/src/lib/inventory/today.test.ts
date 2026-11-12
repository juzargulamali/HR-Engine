import { eventRow, noteRow, noteView, statusRow } from "@/test/note-fixtures";
import { describe, expect, it } from "vitest";
import {
  bucketOf, daysFromToday, filterCounts, filterRows, fmtDay, groupRows, differenceRows, heldRows, isQueueEmpty, parseShow, requestRow, requestRows, waitingRow, returnRows, salesCheckInScope, salesRows,
  settleSources, transferRows, type HeldEntry, type QueueRow, type RequestInput, type RequestLineInput, type SalesInput, type SourceKey,
} from "./today";

const DXB = "Asia/Dubai";
/** Monday 19 Oct 2026, 09:30 in Dubai (05:30 UTC). */
const NOW = new Date("2026-10-19T09:30:00+04:00");
const ctx = { now: NOW };

const line = (over: Partial<RequestLineInput> = {}): RequestLineInput => ({ status: "open", reserved: 0, dispatched: 0, toReserve: 0, ...over });
const request = (over: Partial<RequestInput> = {}): RequestInput => ({
  id: "r1", code: "REQ-0047", kind: "project", forLabel: "Gulf Bank Summit", timezone: DXB, plan: { dispatch: "2026-10-22T08:00" }, neededFrom: null, lines: [], ...over,
});

describe("calendar days in the warehouse's time zone", () => {
  it("counts calendar days, not 24-hour spans", () => {
    expect(daysFromToday("2026-10-19T23:30:00+04:00", DXB, NOW)).toBe(0);
    expect(daysFromToday("2026-10-20T00:10:00+04:00", DXB, NOW)).toBe(1);
    expect(daysFromToday("2026-10-18T23:59:00+04:00", DXB, NOW)).toBe(-1);
  });

  it("puts a UTC date that is the next local day under the next day, not today", () => {
    // 20:30 UTC on the 19th is 00:30 on the 20th in Dubai.
    const iso = "2026-10-19T20:30:00Z";
    expect(bucketOf(iso, DXB, NOW)).toBe("week");
    expect(bucketOf(iso, "UTC", NOW)).toBe("today");
    // and the reverse: 21:00 UTC on the 18th is 01:00 on the 19th in Dubai, so it is today, not late.
    expect(bucketOf("2026-10-18T21:00:00Z", DXB, NOW)).toBe("today");
    expect(bucketOf("2026-10-18T21:00:00Z", "UTC", NOW)).toBe("late");
  });

  it("groups Late / Today / Next 7 days / Later / no date", () => {
    expect(bucketOf("2026-10-16T18:00:00+04:00", DXB, NOW)).toBe("late");
    expect(bucketOf("2026-10-19T08:00:00+04:00", DXB, NOW)).toBe("today"); // earlier today is still today, not late
    expect(bucketOf("2026-10-26T08:00:00+04:00", DXB, NOW)).toBe("week"); // 7 days ahead
    expect(bucketOf("2026-10-27T08:00:00+04:00", DXB, NOW)).toBe("later"); // 8 days ahead
    expect(bucketOf(null, DXB, NOW)).toBe("none");
    expect(bucketOf("not a date", DXB, NOW)).toBe("none");
  });

  it("writes days the same way in Node and the browser (no comma)", () => {
    expect(fmtDay("2026-10-16T18:00:00+04:00", DXB)).toBe("Fri 16 Oct");
  });

  it("does not break on an unknown zone name", () => {
    expect(bucketOf("2026-10-19T08:00:00Z", "Not/AZone", NOW)).toBe("today");
  });
});

describe("one row per request, and the Send / Prepare rule", () => {
  it("Send equipment when something reserved is unsent and the dispatch date is today or earlier, even if lines still need reserving", () => {
    const r = requestRow(request({ plan: { dispatch: "2026-10-19T14:00" }, lines: [line({ reserved: 4, toReserve: 0 }), line({ reserved: 0, toReserve: 3 })] }), ctx)!;
    expect(r.kind).toBe("send");
    expect(r.actionLabel).toBe("Send equipment");
    expect(r.href).toBe("/inventory/requests/r1?step=send");
    expect(r.operates).toBe(true);
    expect(r.whenLabel).toBe("Dispatch today, 14:00");
    // the unfinished reserving is said on the same row, not as a second row
    expect(r.facts.map((f) => f.text)).toEqual(["1 line has reserved stock to send", "1 line still to reserve"]);
  });

  it("an overdue dispatch is Late and says how many days", () => {
    const r = requestRow(request({ plan: { dispatch: "2026-10-16T08:00" }, lines: [line({ reserved: 2, dispatched: 0 })] }), ctx)!;
    expect(r.kind).toBe("send");
    expect(r.late).toBe(true);
    expect(r.whenLabel).toBe("Dispatch was Fri 16 Oct, 08:00 · 3 days late");
    expect(bucketOf(r.when, r.zone, NOW)).toBe("late");
  });

  it("Prepare equipment when the dispatch is still ahead and a line still has something to reserve, even if some is already reserved and unsent", () => {
    const r = requestRow(request({ plan: { dispatch: "2026-10-22T08:00" }, lines: [line({ reserved: 4 }), line({ reserved: 1, toReserve: 2 }), line({ reserved: 6, dispatched: 6 })] }), ctx)!;
    expect(r.kind).toBe("prepare");
    expect(r.actionLabel).toBe("Prepare equipment");
    expect(r.href).toBe("/inventory/requests/r1?step=prepare");
    expect(r.operates).toBe(false);
    expect(r.whenLabel).toBe("Dispatch Thu 22 Oct, 08:00");
    expect(r.title).toBe("Gulf Bank Summit needs its equipment prepared");
  });

  it("Send equipment ahead of its date when everything is reserved and some of it is unsent", () => {
    const r = requestRow(request({ plan: { dispatch: "2026-10-20T08:00" }, lines: [line({ reserved: 22 }), line({ reserved: 4 })] }), ctx)!;
    expect(r.kind).toBe("send");
    expect(r.title).toBe("Gulf Bank Summit is ready to send");
    expect(r.facts[0]!.text).toBe("2 lines have reserved stock to send");
  });

  it("no row when nothing is left to reserve or send, and cancelled or closed lines are ignored", () => {
    expect(requestRow(request({ lines: [line({ reserved: 5, dispatched: 5 }), line({ status: "open", reserved: 0, toReserve: 0 })] }), ctx)).toBeNull();
    expect(requestRow(request({ lines: [line({ status: "cancelled", reserved: 3, toReserve: 3 }), line({ status: "closed", toReserve: 2 })] }), ctx)).toBeNull();
    expect(requestRow(request({ lines: [] }), ctx)).toBeNull();
  });

  it("reads the plan's dispatch time in the request's own zone: just after midnight local is tomorrow, not today", () => {
    // 00:30 on the 20th in Dubai is 20:30 UTC on the 19th: reading it as UTC would make a Prepare row a Send row.
    const r = requestRow(request({ plan: { dispatch: "2026-10-20T00:30" }, lines: [line({ reserved: 2 }), line({ toReserve: 1 })] }), ctx)!;
    expect(r.kind).toBe("prepare");
    expect(r.when).toBe("2026-10-19T20:30:00.000Z");
    expect(bucketOf(r.when, r.zone, NOW)).toBe("week");
  });

  it("falls back to the needed-from date, and shows no invented date when there is none", () => {
    const withFallback = requestRow(request({ plan: {}, neededFrom: "2026-10-21T04:00:00Z", lines: [line({ toReserve: 1 })] }), ctx)!;
    expect(withFallback.when).toBe("2026-10-21T04:00:00Z");
    const none = requestRow(request({ plan: null, neededFrom: null, lines: [line({ reserved: 3 })] }), ctx)!;
    expect(none.when).toBeNull();
    expect(none.whenLabel).toBe("No dispatch date set");
    expect(bucketOf(none.when, none.zone, NOW)).toBe("none");
    expect(none.kind).toBe("send"); // without a date it cannot be "due", so the unsent equipment is sent ahead of any date
  });

  it("a request with both unsent equipment and lines to reserve is ONE row", () => {
    const rows = requestRows([request({ lines: [line({ reserved: 2 }), line({ toReserve: 4 })] }), request({ id: "r2", code: "REQ-0048", lines: [line({ reserved: 1, dispatched: 1 })] })], ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("request:r1");
  });

  it("describes work in lines, never by adding quantities of different units", () => {
    const prep = requestRow(request({ lines: [line({ reserved: 40 }), line({ reserved: 12 }), line({ reserved: 24 }), line({ toReserve: 6, reserved: 10 }), line({ toReserve: 2 })] }), ctx)!;
    expect(prep.facts[0]!.text).toBe("3 of 5 lines fully reserved · 2 still to reserve");
    const send = requestRow(request({ plan: { dispatch: "2026-10-19T08:00" }, lines: [line({ reserved: 6 }), line({ reserved: 10 }), line({ reserved: 4, dispatched: 4 })] }), ctx)!;
    expect(send.facts[0]!.text).toBe("2 lines have reserved stock to send, 1 sent");
    expect(send.title).toBe("Gulf Bank Summit still has equipment to send");
    expect(JSON.stringify([prep, send])).not.toMatch(/\b(40|52|76)\b/); // no summed quantity
  });

  it("a request for an employee says who it is for and goes to the same workspace", () => {
    const r = requestRow(request({ kind: "employee", forLabel: "Sara Khan", plan: { dispatch: "2026-10-19T10:00" }, lines: [line({ reserved: 2 })] }), ctx)!;
    expect(r.title).toBe("Equipment for Sara Khan is ready to send");
    expect(r.forWhom).toBe("Employee Sara Khan · request REQ-0047");
    expect(r.href).toBe("/inventory/requests/r1?step=send");
    const p = requestRow(request({ kind: "employee", forLabel: "Sara Khan", lines: [line({ toReserve: 1 })] }), ctx)!;
    expect(p.title).toBe("Equipment for Sara Khan needs to be prepared");
  });
});

describe("returns", () => {
  const held = (over: Partial<HeldEntry>): HeldEntry => ({ holderKind: "project", holderId: "p1", dueAt: "2026-10-16T18:00:00+04:00", zone: DXB, key: "unit:1", ...over });
  const names = { project: new Map([["p1", "Dubai Expo Pavilion"], ["p2", "Marina Gala Dinner"]]), employee: new Map([["e1", "Sara Khan"]]) };
  const links = new Map([["p1", { requestId: "r44", code: "REQ-0044" }]]);

  it("one row per project and one per employee, with the earliest date and a count of items", () => {
    const rows = returnRows([
      held({ key: "unit:1" }), held({ key: "unit:2", dueAt: "2026-10-17T18:00:00+04:00" }), held({ key: "item:9", dueAt: "2026-10-18T12:00:00+04:00" }),
      held({ holderKind: "employee", holderId: "e1", dueAt: "2026-10-19T17:00:00+04:00", key: "unit:7" }), held({ holderKind: "employee", holderId: "e1", dueAt: "2026-10-20T09:00:00+04:00", key: "unit:8" }),
    ], names, links, ctx);
    expect(rows).toHaveLength(2);
    const project = rows.find((r) => r.id === "returns:project:p1")!;
    expect(project.title).toBe("3 items are overdue from Dubai Expo Pavilion");
    expect(project.when).toBe("2026-10-16T18:00:00+04:00");
    expect(project.whenLabel).toBe("Was due Fri 16 Oct, 18:00 · 3 days late");
    expect(project.late).toBe(true);
    expect(project.forWhom).toBe("Project Dubai Expo Pavilion · request REQ-0044");
    expect(project.href).toBe("/inventory/requests/r44?step=back");
    const person = rows.find((r) => r.id === "returns:employee:e1")!;
    expect(person.title).toBe("Sara Khan has 2 items due back");
    expect(person.whenLabel).toBe("Due today, 17:00");
    expect(person.href).toBe("/inventory/stock?action=return&employee=e1");
    expect(person.actionLabel).toBe("Receive returns");
    expect(person.operates).toBe(true);
    expect(rows.map((r) => bucketOf(r.when, r.zone, NOW)).sort()).toEqual(["late", "today"]);
  });

  it("the same unit is counted once", () => {
    const [row] = returnRows([held({ key: "unit:1" }), held({ key: "unit:1" })], names, links, ctx);
    expect(row!.title).toBe("1 item is overdue from Dubai Expo Pavilion");
  });

  it("never lists equipment without a recorded date, or due more than 7 days ahead", () => {
    const rows = returnRows([held({ dueAt: null }), held({ holderId: "p2", dueAt: "2026-10-27T10:00:00+04:00", key: "unit:3" })], names, links, ctx);
    expect(rows).toEqual([]);
    const kept = returnRows([held({ holderId: "p2", dueAt: "2026-10-26T10:00:00+04:00", key: "unit:3" })], names, links, ctx);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.title).toBe("1 item is due back from Marina Gala Dinner");
  });

  it("falls back to the Stock return panel when no request has equipment out for the project", () => {
    const [row] = returnRows([held({ holderId: "p2", dueAt: "2026-10-20T10:00:00+04:00", key: "unit:3" })], names, links, ctx);
    expect(row!.href).toBe("/inventory/stock?action=return&project=p2");
    expect(row!.forWhom).toBe("Project Marina Gala Dinner");
  });

  it("an overdue row counts only what is overdue and says how much more is due soon", () => {
    const [row] = returnRows([held({ key: "unit:1" }), held({ key: "unit:2", dueAt: "2026-10-21T10:00:00+04:00" })], names, links, ctx);
    expect(row!.title).toBe("1 item is overdue from Dubai Expo Pavilion");
    expect(row!.facts[0]!.text).toBe("1 more item due within 7 days");
  });

  it("an unnamed holder gets a general name, not a blank", () => {
    const [row] = returnRows([held({ holderKind: "employee", holderId: "someone" })], names, links, ctx);
    expect(row!.title).toBe("An employee has 1 item overdue");
  });
});

describe("transfers", () => {
  const t = { id: "t1", code: "TRF-0112", fromName: "Abu Dhabi: Mussafah", toName: "Dubai: Al Quoz", expectedAt: "2026-10-20T12:00:00+04:00", zone: DXB, items: 6 };
  it("says it is on its way here, from where, how many items and when", () => {
    const [row] = transferRows([t], ctx, { here: true });
    expect(row!.title).toBe("Transfer TRF-0112 is on its way here");
    expect(row!.forWhom).toBe("From Abu Dhabi: Mussafah · 6 items");
    expect(row!.whenLabel).toBe("Expected Tue 20 Oct");
    expect(row!.href).toBe("/inventory/stock?action=transfer&mode=receive&transfer=t1");
    expect(row!.actionLabel).toBe("Receive transfer");
  });
  it("names the destination when every warehouse is shown, and never invents an expected date", () => {
    const [row] = transferRows([{ ...t, expectedAt: null, items: null }], ctx, { here: false });
    expect(row!.title).toBe("Transfer TRF-0112 is on its way to Dubai: Al Quoz");
    expect(row!.forWhom).toBe("From Abu Dhabi: Mussafah");
    expect(row!.when).toBeNull();
    expect(bucketOf(row!.when, row!.zone, NOW)).toBe("none");
  });
  it("an overdue transfer is Late", () => {
    const [row] = transferRows([{ ...t, expectedAt: "2026-10-18T12:00:00+04:00" }], ctx, { here: true });
    expect(row!.late).toBe(true);
    expect(row!.whenLabel).toBe("Was expected Sun 18 Oct · 1 day late");
  });
});

describe("Sales checks", () => {
  const sales: SalesInput = {
    checkId: "c1", opportunityId: "o1", companyId: "co1", reference: "ENQ-0188", requestedAt: "2026-10-17T11:20:00+04:00", locationId: "l1", locationName: "Dubai: Al Quoz",
    installStart: "2026-11-10", eventStart: "2026-11-12", eventEnd: "2026-11-14", technologies: [{ name: "LED wall panel", qty: 24 }, { name: "Line array speaker", qty: "8" }], zone: DXB,
  };
  it("never gets a date, so it always waits under 'no date set'", () => {
    const [row] = salesRows([sales], ctx);
    expect(row!.when).toBeNull();
    expect(row!.late).toBe(false);
    expect(groupRows([row!], NOW).map((g) => g.bucket)).toEqual(["none"]);
    expect(row!.title).toBe("Sales asks whether equipment is free for enquiry ENQ-0188");
    expect(row!.whenLabel).toContain("Asked Sat 17 Oct");
    expect(row!.whenLabel).toContain("Event 12 Nov 2026 to 14 Nov 2026");
    expect(row!.facts.map((f) => f.text)).toEqual(["LED wall panel × 24, Line array speaker × 8", "Nothing is reserved by a check"]);
    expect(row!.href).toBeNull();
    expect(row!.operates).toBe(false);
    expect(row!.check).toEqual({ opportunityId: "o1", reference: "ENQ-0188", companyId: "co1", locationId: "l1" });
  });
  it("carries no client, value, notes or title even if the data service sent them", () => {
    const leaky = { ...sales, title: "Secret pitch", client_name: "Acme Holdings", account_name: "Acme", value: 987654, amount: 55555, notes: "Call the CEO", owner: "Rana", contact_email: "ceo@acme.test" } as unknown as SalesInput;
    const json = JSON.stringify(salesRows([leaky], ctx));
    for (const secret of ["Secret pitch", "Acme", "987654", "55555", "Call the CEO", "Rana", "ceo@acme.test"]) expect(json).not.toContain(secret);
  });
  it("says so when no warehouse is named", () => {
    const [row] = salesRows([{ ...sales, locationId: null, locationName: null }], ctx);
    expect(row!.forWhom).toBe("Enquiry ENQ-0188 · no warehouse named, you choose");
  });
  it("a check is in scope for the working warehouse or when it names none; every warehouse sees all", () => {
    expect(salesCheckInScope({ location_id: "l1" }, "l1")).toBe(true);
    expect(salesCheckInScope({ location_id: null }, "l1")).toBe(true);
    expect(salesCheckInScope({ location_id: "l2" }, "l1")).toBe(false);
    expect(salesCheckInScope({ location_id: "l2" }, null)).toBe(true);
  });
});

describe("sources that fail", () => {
  const ok = (rows: QueueRow[]): PromiseFulfilledResult<QueueRow[]> => ({ status: "fulfilled", value: rows });
  const bad: PromiseRejectedResult = { status: "rejected", reason: new Error("boom") };
  const rowOf = (kind: QueueRow["kind"], id: string): QueueRow => ({ id, kind, title: id, forWhom: "", when: null, zone: DXB, whenLabel: "", late: false, facts: [], href: "/x", actionLabel: "Go", operates: false });
  const prepare = rowOf("prepare", "a"), send = rowOf("send", "b"), returns = rowOf("returns", "c"), sales = rowOf("sales", "e");

  it("one failing source is named and the others still show", () => {
    const { rows, failed } = settleSources({ requests: ok([prepare, send]), returns: ok([returns]), transfers: bad, sales: ok([sales]) });
    expect(failed).toEqual(["transfers"]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "e"]);
  });

  it("a failed source's count is unknown (null), never zero; the others keep their counts", () => {
    const { rows, failed } = settleSources({ requests: ok([prepare, send]), returns: ok([returns]), transfers: bad, sales: ok([]) });
    const counts = filterCounts(rows, failed);
    expect(counts.transfer).toBeNull();
    expect(counts.all).toBeNull(); // a partial total is not the queue
    expect(counts.prepare).toBe(1);
    expect(counts.send).toBe(1);
    expect(counts.returns).toBe(1);
    expect(counts.sales).toBe(0); // loaded, and really nothing
  });

  it("the requests source covers both Prepare and Send", () => {
    const counts = filterCounts([returns], ["requests" satisfies SourceKey]);
    expect(counts.prepare).toBeNull();
    expect(counts.send).toBeNull();
    expect(counts.returns).toBe(1);
  });

  it("all sources answered: counts are numbers and Everything is the total", () => {
    const counts = filterCounts([prepare, send, returns], []);
    expect(counts).toEqual({ all: 3, prepare: 1, send: 1, returns: 1, transfer: 0, sales: 0, waiting: 0, held: 0, difference: 0 });
  });

  it("an empty queue is 'nothing waiting' only when every source answered", () => {
    expect(isQueueEmpty([], [])).toBe(true);
    expect(isQueueEmpty([], ["transfers"])).toBe(false);
    expect(isQueueEmpty([prepare], [])).toBe(false);
    const all = settleSources({ requests: bad, returns: bad, transfers: bad, sales: bad, held: bad, differences: bad });
    expect(all.rows).toEqual([]);
    expect(all.failed).toEqual(["requests", "returns", "transfers", "sales", "held", "differences"]);
    expect(isQueueEmpty(all.rows, all.failed)).toBe(false);
  });
});

describe("groups and filters", () => {
  it("orders groups Late, Today, Next 7 days, Later, no date, and rows by their own date", () => {
    const mk = (id: string, when: string | null): QueueRow => ({ id, kind: "send", title: id, forWhom: "", when, zone: DXB, whenLabel: "", late: false, facts: [], href: "/x", actionLabel: "Go", operates: true });
    const groups = groupRows([mk("none", null), mk("later", "2026-12-01T09:00:00+04:00"), mk("wk2", "2026-10-22T09:00:00+04:00"), mk("wk1", "2026-10-20T09:00:00+04:00"), mk("today", "2026-10-19T15:00:00+04:00"), mk("late", "2026-10-10T09:00:00+04:00")], NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["late", "today", "week", "later", "none"]);
    expect(groups.find((g) => g.bucket === "week")!.rows.map((r) => r.id)).toEqual(["wk1", "wk2"]);
  });

  it("filters by kind and ignores a show value it does not know", () => {
    const rows = [{ kind: "send" }, { kind: "sales" }, { kind: "send" }] as QueueRow[];
    expect(filterRows(rows, "send")).toHaveLength(2);
    expect(filterRows(rows, "all")).toHaveLength(3);
    expect(parseShow("sales")).toBe("sales");
    expect(parseShow("<script>")).toBe("all");
    expect(parseShow("")).toBe("all");
  });
});


describe("Waiting / Shortages: unresolved shortages stay visible, with who acts and the next action", () => {
  const buy = line({ toReserve: 2, shortageAction: "need_to_buy", itemName: "Truss 3 m", qty: 2 });
  const rent = line({ toReserve: 4, shortageAction: "need_to_rent", itemName: "LED wall panel", qty: 4, rentalReference: "RNT-9" });

  it("a line marked to buy or rent is no longer work to prepare, but it is not hidden: it becomes a Waiting / Shortages row", () => {
    const req = request({ lines: [buy, rent] });
    expect(requestRow(req, ctx)).toBeNull(); // nothing the warehouse can finish by preparing
    const w = waitingRow(req, ctx)!;
    expect(w.kind).toBe("waiting");
    expect(w.title).toBe("2 lines of Gulf Bank Summit are waiting for stock to be bought or rented");
    expect(w.facts.map((f) => f.text)).toEqual(["Truss 3 m × 2: to buy", "LED wall panel × 4: to rent (rental RNT-9)"]);
    expect(w.responsible).toMatch(/To buy: the buyer .* To rent: whoever arranges the rental/);
    expect(w.next).toMatch(/Receive the stock when it arrives/);
    expect(w.href).toBe("/inventory/requests/r1?step=prepare");
    expect(w.operates).toBe(false);
    expect(groupRows([w], NOW).map((g) => g.bucket)).toEqual(["waiting"]);
  });

  it("a request with a shortage mark and something else to reserve gets both: a Prepare row (without the waiting line) and a Waiting row", () => {
    const req = request({ lines: [buy, line({ toReserve: 3 })] });
    const prep = requestRow(req, ctx)!;
    expect(prep.kind).toBe("prepare");
    // the line to buy is short, not reserved: nothing on this request is fully reserved yet
    expect(prep.facts[0]!.text).toBe("0 of 2 lines fully reserved · 1 still to reserve · 1 to buy or rent");
    expect(waitingRow(req, ctx)!.facts).toHaveLength(1);
    expect(requestRows([req], ctx).map((r) => r.kind)).toEqual(["prepare", "waiting"]);
  });

  describe("a line to buy or rent is short, never fully reserved", () => {
    it("only buy/rent shortages: the reserved lines can go in part, and the count says what is waiting", () => {
      const req = request({ plan: { dispatch: "2026-10-22T08:00" }, lines: [line({ reserved: 5 }), line({ reserved: 2 }), buy, rent] });
      const send = requestRow(req, ctx)!;
      expect(send.kind).toBe("send");
      expect(send.title).toBe("Gulf Bank Summit is ready to send in part");
      expect(send.facts.map((f) => [f.text, f.tone])).toEqual([["2 lines have reserved stock to send", undefined], ["2 lines to buy or rent", "warn"]]);
      expect(requestRows([req], ctx).map((r) => r.kind)).toEqual(["send", "waiting"]);
      const person = requestRow(request({ kind: "employee", forLabel: "Sara Khan", lines: [line({ reserved: 1 }), rent] }), ctx)!;
      expect(person.title).toBe("Equipment for Sara Khan is ready to send in part");
    });
    it("only buy/rent shortages and nothing reserved: no Send or Prepare row at all, only the Waiting row", () => {
      expect(requestRows([request({ lines: [buy, rent] })], ctx).map((r) => r.kind)).toEqual(["waiting"]);
    });
    it("mixed: fully reserved, still to reserve from stock, and waiting to buy or rent are three separate counts that add up", () => {
      const req = request({ lines: [line({ reserved: 5 }), line({ reserved: 2 }), line({ toReserve: 3 }), buy, rent] });
      const prep = requestRow(req, ctx)!;
      expect(prep.kind).toBe("prepare");
      expect(prep.facts[0]!.text).toBe("2 of 5 lines fully reserved · 1 still to reserve · 2 to buy or rent");
      expect(waitingRow(req, ctx)!.title).toBe("2 lines of Gulf Bank Summit are waiting for stock to be bought or rented");
    });
    it("mixed and due today: sent in part, with both kinds of shortage said", () => {
      const send = requestRow(request({ plan: { dispatch: "2026-10-19T14:00" }, lines: [line({ reserved: 5 }), line({ toReserve: 3 }), buy] }), ctx)!;
      expect(send.title).toBe("Gulf Bank Summit is ready to send in part");
      expect(send.facts.map((f) => f.text)).toEqual(["1 line has reserved stock to send", "1 line still to reserve", "1 line to buy or rent"]);
    });
    it("none: the sentence and the title are as before", () => {
      const prep = requestRow(request({ lines: [line({ reserved: 5 }), line({ toReserve: 3 })] }), ctx)!;
      expect(prep.facts[0]!.text).toBe("1 of 2 lines fully reserved · 1 still to reserve");
      const send = requestRow(request({ lines: [line({ reserved: 5 }), line({ reserved: 3 })] }), ctx)!;
      expect(send.title).toBe("Gulf Bank Summit is ready to send");
      expect(send.facts.map((f) => f.text)).toEqual(["2 lines have reserved stock to send"]);
      // a mark on a line that is already fully reserved is not a shortage
      const marked = requestRow(request({ lines: [line({ reserved: 5 }), { ...buy, reserved: 2, toReserve: 0 }] }), ctx)!;
      expect(marked.title).toBe("Gulf Bank Summit is ready to send");
    });
  });

  it("a marked line that is already fully reserved, cancelled or unmarked adds no Waiting row", () => {
    expect(waitingRow(request({ lines: [{ ...buy, toReserve: 0 }, { ...rent, status: "cancelled" }, line({ toReserve: 2, shortageAction: "none" })] }), ctx)).toBeNull();
  });

  it("an overdue dispatch is said on the waiting row too", () => {
    const w = waitingRow(request({ plan: { dispatch: "2026-10-16T08:00" }, lines: [buy] }), ctx)!;
    expect(w.late).toBe(true);
    expect(w.facts[0]!.tone).toBe("bad");
  });

  it("each kind has its own filter and counts, and a failed requests source makes the waiting count unknown, never zero", () => {
    const w = waitingRow(request({ lines: [buy] }), ctx)!;
    expect(filterCounts([w], []).waiting).toBe(1);
    expect(filterCounts([w], ["requests"]).waiting).toBeNull();
    expect(filterCounts([w], ["held"]).waiting).toBe(1);
    expect(filterCounts([w], ["held"]).held).toBeNull();
    expect(parseShow("waiting")).toBe("waiting");
    expect(parseShow("held")).toBe("held");
  });
});

describe("units held for checking", () => {
  it("a held unit appears as a row with who acts and the next action, in its own group, with no invented date", () => {
    const [r] = heldRows([{ id: "u1", code: "UAE-E-00012", itemName: "Projector", condition: "damaged", locationName: "Dubai warehouse", reservedFor: [] }]);
    expect(r!.kind).toBe("held");
    expect(r!.title).toBe("Projector UAE-E-00012 is held for checking");
    expect(r!.forWhom).toContain("Damaged");
    expect(r!.when).toBeNull();
    expect(r!.responsible).toMatch(/warehouse checks it/);
    expect(r!.next).toBe("Open the unit and record the check.");
    expect(r!.href).toBe("/inventory/stock?unit=u1");
    expect(groupRows([r!], NOW).map((g) => g.bucket)).toEqual(["held"]);
  });
  it("flags a unit that became held while a live request still holds a reservation on it", () => {
    const [r] = heldRows([{ id: "u1", code: "UAE-E-00012", itemName: "Projector", condition: "needs_inspection", locationName: null, reservedFor: [{ requestId: "r2", code: "REQ-0051" }] }]);
    expect(r!.facts[0]).toEqual({ text: "Reserved for request REQ-0051: it needs a replacement before it can be sent", tone: "warn" });
    expect(r!.next).toMatch(/reserve another unit/);
  });
  it("says it could not tell about reservations rather than saying there are none", () => {
    const [r] = heldRows([{ id: "u1", code: "X-1", itemName: "Cable", condition: "damaged", locationName: null, reservedFor: null }]);
    expect(r!.facts[0]!.text).toMatch(/could not be read/);
  });
});

describe("differences the Project Manager reported on a dispatch note or return checklist (C5)", () => {
  const open = (over: { reportedAt?: string; reason?: string; lines?: number[]; comment?: string | null } = {}) => noteView(
    noteRow(),
    statusRow({ state: "difference_open", awaiting: "warehouse", difference_state: "open", difference_reason: over.reason ?? "quantity_differs", difference_lines: over.lines ?? [2], difference_reported_at: over.reportedAt ?? "2026-10-16T06:00:00Z" }),
    [eventRow({ event: "difference_reported", reason: over.reason ?? "quantity_differs", lines: over.lines ?? [2], comment: over.comment === undefined ? "Only 10 arrived" : over.comment, at: over.reportedAt ?? "2026-10-16T06:00:00Z" })],
  );

  it("is one row per note, with its age, who must act, the next action and the lines the Project Manager named", () => {
    const [r] = differenceRows([open()], { now: NOW });
    expect(r).toMatchObject({ id: "difference:n1", kind: "difference", title: "ENG-D-00017: the Project Manager reports a difference", operates: true, href: null });
    expect(r!.forWhom).toContain("Dispatch note · ENG-P-2026-0007 Mall activation · Dubai warehouse");
    expect(r!.whenLabel).toMatch(/^Reported Fri 16 Oct, 10:00 · waiting 3 days$/);
    expect(r!.facts.map((f) => f.text)).toEqual(["Quantity differs", "1 line", "Custody and availability are unchanged"]);
    expect(r!.responsible).toBe("The warehouse at Dubai warehouse answers it.");
    expect(r!.difference).toMatchObject({ noteNo: "ENG-D-00017", reportedBy: "M. Manager", comment: "Only 10 arrived", reason: "quantity_differs" });
    expect(r!.difference!.lines.map((l) => l.n)).toEqual([2]);
  });

  it("sits in its own group, first, whatever the date, and has its own filter", () => {
    const [d] = differenceRows([open()], { now: NOW });
    const send: QueueRow = { id: "s", kind: "send", title: "s", forWhom: "", when: "2026-10-10T09:00:00+04:00", zone: DXB, whenLabel: "", late: true, facts: [], href: "/x", actionLabel: "Go", operates: true };
    expect(groupRows([send, d!], NOW).map((g) => g.bucket)).toEqual(["difference", "late"]);
    expect(filterRows([send, d!], "difference").map((r) => r.id)).toEqual(["difference:n1"]);
    expect(parseShow("difference")).toBe("difference");
  });

  it("a failed read of the differences is its own failure, never an empty queue", () => {
    const r = settleSources({ differences: { status: "rejected", reason: new Error("down") } as PromiseRejectedResult });
    expect(r.failed).toEqual(["differences"]);
    expect(filterCounts([], ["differences"]).difference).toBeNull();
    expect(isQueueEmpty(r.rows, r.failed)).toBe(false);
  });
});
