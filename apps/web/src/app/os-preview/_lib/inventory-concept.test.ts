import { describe, expect, it } from "vitest";
import {
  QUEUE, REQUESTS, bookingWindow, bucketOf, initialState, queueFor, reserveOutcome, returnOutcome, sendFlags, sentOf, reservedOf, returnedOf, shortOf, stillOutOf, toSendOf, daysFromToday,
  type SendDraftLine,
} from "./inventory-concept";

const totals = (id: string) => {
  const r = REQUESTS[id]!;
  const st = Object.fromEntries(r.lines.map((l) => [l.id, initialState(l)]));
  const sum = (f: (l: (typeof r.lines)[number], s: ReturnType<typeof initialState>) => number) => r.lines.reduce((n, l) => n + f(l, st[l.id]!), 0);
  return { needed: r.lines.reduce((n, l) => n + l.needed, 0), reserved: sum(reservedOf), sent: sum(sentOf), returned: sum(returnedOf), out: sum(stillOutOf), short: sum(shortOf), toSend: sum(toSendOf) };
};

describe("inventory concept sample data stays consistent with its Today rows", () => {
  it("Gulf Bank Summit: reserved and short figures", () => {
    const t = totals("gulf");
    expect(t.reserved).toBe(66);
    expect(t.short).toBe(18);
    expect(QUEUE.find((q) => q.id === "q-gulf")!.facts[0]!.text).toBe(`Reserved ${t.reserved} of ${t.needed} · ${t.short} short`);
  });
  it("Al Khail Roadshow: sent and waiting", () => {
    const t = totals("alkhail");
    expect(QUEUE.find((q) => q.id === "q-alkhail")!.facts[0]!.text).toBe(`Sent ${t.sent} of ${t.reserved} · ${t.toSend} reserved and waiting`);
  });
  it("Marina Gala Dinner: all reserved, none sent", () => {
    const t = totals("marina");
    expect(t.sent).toBe(0);
    expect(QUEUE.find((q) => q.id === "q-marina")!.facts[0]!.text).toBe(`${t.reserved} reserved · none sent yet`);
  });
  it("Dubai Expo Pavilion: Sent / Returned / Still out", () => {
    const t = totals("expo");
    expect(QUEUE.find((q) => q.id === "q-expo")!.facts[0]!.text).toBe(`Sent ${t.sent} · Returned ${t.returned} · Still out ${t.out}`);
  });
  it("every request's booking window includes its preparation and inspection dates", () => {
    for (const r of Object.values(REQUESTS)) {
      const w = bookingWindow(r.plan);
      expect(w.from).toBe(r.plan.prep_start);
      expect(w.to).toBe(r.plan.inspect_until);
    }
  });
});

describe("Today grouping uses each record's own date", () => {
  it("fixes 'now' at Mon 19 Oct 2026, Dubai time", () => {
    expect(daysFromToday("2026-10-19T23:59:00+04:00")).toBe(0);
    expect(daysFromToday("2026-10-16T18:00:00+04:00")).toBe(-3);
  });
  it("late, today, next 7 days, later, and no date", () => {
    expect(bucketOf("2026-10-16T18:00:00+04:00")).toBe("late");
    expect(bucketOf("2026-10-19T17:00:00+04:00")).toBe("today");
    expect(bucketOf("2026-10-22T08:00:00+04:00")).toBe("week");
    expect(bucketOf("2026-11-02T08:00:00+04:00")).toBe("later");
    expect(bucketOf(null)).toBe("none");
  });
  it("a Sales check is never given a deadline", () => {
    for (const q of QUEUE.filter((x) => x.kind === "sales")) expect(q.when).toBeNull();
  });
  it("a record that names no warehouse is shown at every warehouse; others only at theirs", () => {
    expect(queueFor("auh").map((q) => q.id)).toEqual(["q-sales2"]);
    expect(queueFor("dxb").map((q) => q.id)).toContain("q-sales2");
    expect(queueFor("dxb").map((q) => q.id)).not.toContain("q-nothing");
  });
});

describe("reserve (mirrors the existing function: partial results accepted)", () => {
  const gulf = REQUESTS.gulf!;
  it("takes the free units there are and reports what is still short", () => {
    const mic = gulf.lines.find((l) => l.id === "g2")!;
    expect(reserveOutcome(mic, initialState(mic), 2)).toEqual({ reserved: 1, short: 1 });
  });
  it("never reserves more than is still needed", () => {
    const truss = gulf.lines.find((l) => l.id === "g4")!;
    expect(reserveOutcome(truss, initialState(truss), 99)).toEqual({ reserved: 6, short: 8 });
  });
  it("nothing free means everything asked is short", () => {
    const laptop = gulf.lines.find((l) => l.id === "g5")!;
    expect(reserveOutcome(laptop, initialState(laptop), 2)).toEqual({ reserved: 0, short: 2 });
  });
});

describe("Send out flags before confirmation", () => {
  const alk = REQUESTS.alkhail!;
  const states = Object.fromEntries(alk.lines.map((l) => [l.id, initialState(l)]));
  const draft = (id: string, ticked: string[], counted: number | null): SendDraftLine => ({ line: alk.lines.find((l) => l.id === id)!, ticked, counted });
  it("an unreserved code blocks", () => {
    const f = sendFlags([], states, ["WM-0099"]);
    expect(f).toHaveLength(1);
    expect(f[0]!.level).toBe("block");
  });
  it("a partial dispatch warns but does not block", () => {
    const f = sendFlags([draft("a1", ["PJ-0403"], null)], states, []);
    expect(f).toEqual([{ level: "warn", text: "Video projector 6000 lm: sending 1 of 2. 1 stay reserved and unsent." }]);
  });
  it("sending every remaining unit raises nothing", () => {
    expect(sendFlags([draft("a1", ["PJ-0403", "PJ-0404"], null)], states, [])).toEqual([]);
  });
  it("more counted than reserved and unsent blocks", () => {
    const f = sendFlags([draft("a3", [], 7)], states, []);
    expect(f[0]!.level).toBe("block");
  });
  it("nothing is assumed: an untouched line raises nothing", () => {
    expect(sendFlags([draft("a1", [], null), draft("a3", [], null)], states, [])).toEqual([]);
  });
});

describe("Receive back", () => {
  it("good or fair individual units are available again; the rest are held", () => {
    expect(returnOutcome("good", "individual")).toBe("available");
    expect(returnOutcome("fair", "individual")).toBe("available");
    expect(returnOutcome("needs_inspection", "individual")).toBe("held");
    expect(returnOutcome("damaged", "individual")).toBe("held");
    expect(returnOutcome("unserviceable", "individual")).toBe("held");
  });
  it("counted stock is available again only when good", () => {
    expect(returnOutcome("good", "counted")).toBe("available");
    expect(returnOutcome("fair", "counted")).toBe("held");
  });
  it("no condition chosen means nothing is assumed", () => {
    expect(returnOutcome("", "individual")).toBe("unset");
  });
});
