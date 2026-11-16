import { describe, expect, it } from "vitest";
import { ackKey, aiSuggestionItems, attendanceHref, attendanceItems, contractItems, countByState, documentItems, makeViewer, recoveryAlertItems, sortItems, whenPhrase } from "./queue";

const TODAY = "2026-11-16";
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const d = (id: string, type: string, expiry: string | null, employee = "e1", createdAt = "2026-01-01T00:00:00Z") => ({ id, employee_id: employee, document_type: type, expiry_date: expiry, created_at: createdAt });
const ctx = (over: Partial<Parameters<typeof contractItems>[1]> = {}, hrFor: string[] = ["c1"]) => ({
  today: TODAY, viewer: makeViewer((c) => hrFor.includes(c)),
  employees: new Map([["e1", { name: "Omar Ali", companyId: "c1" }], ["e2", { name: "Lena Nowak", companyId: "c2" }]]),
  companies: new Map([["c1", "Aurora Trading"], ["c2", "Birch Works"]]), acks: new Map(), ...over,
});

describe("HR queue model", () => {
  it("one phrase for a date: past, today, future", () => {
    expect(whenPhrase(-3, "expire")).toBe("expired 3 days ago");
    expect(whenPhrase(-1, "end")).toBe("ended 1 day ago");
    expect(whenPhrase(0, "expire")).toBe("expires today");
    expect(whenPhrase(12, "expire")).toBe("expires in 12 days");
    expect(whenPhrase(0, "be due")).toBe("is due today");
  });

  it("documents: expired needs action, expiring soon is due soon, far-off and undated are not in the queue", () => {
    const items = documentItems("employee_document", [
      d("a", "visa", day(-3), "e1"),
      d("b", "labor_card", day(20), "e1"),
      d("c", "certificate", day(200), "e1"),
      d("d", "other", null, "e1"),
    ], ctx());
    expect(items.map((i) => [i.sourceId, i.state, i.urgency])).toEqual([["a", "needs_action", "overdue"], ["b", "due_soon", "due_soon"]]);
    expect(items[0]!.issue).toBe("Visa expired: expired 3 days ago");
  });

  it("the CURRENT version of a type is the newest row, and expiry is judged on that row only: a renewal with a LATER date clears the type", () => {
    const rows = [d("old", "visa", day(-30), "e1", "2026-01-01T00:00:00Z"), d("new", "visa", day(400), "e1", "2026-06-01T00:00:00Z")];
    expect(documentItems("employee_document", rows, ctx())).toEqual([]);
    expect(documentItems("employee_document", [...rows].reverse(), ctx())).toEqual([]); // the order the rows arrive in does not matter
  });

  it("a NEWER document with a SHORTER expiry decides: it can expire sooner than the earlier one and is flagged on its own date", () => {
    const rows = [d("old", "visa", day(400), "e1", "2026-01-01T00:00:00Z"), d("newer", "visa", day(-5), "e1", "2026-06-01T00:00:00Z")];
    for (const order of [rows, [...rows].reverse()]) {
      const items = documentItems("employee_document", order, ctx());
      expect(items.map((i) => [i.sourceId, i.state, i.dueDate])).toEqual([["newer", "needs_action", day(-5)]]);
    }
    const soon = documentItems("employee_document", [d("old", "visa", day(400), "e1", "2026-01-01T00:00:00Z"), d("newer", "visa", day(20), "e1", "2026-06-01T00:00:00Z")], ctx());
    expect(soon.map((i) => [i.sourceId, i.state])).toEqual([["newer", "due_soon"]]);
  });

  it("a NEWER document with NO expiry date is the current version: it clears the type, even when an earlier version had expired", () => {
    const rows = [d("old", "visa", day(-30), "e1", "2026-01-01T00:00:00Z"), d("newer", "visa", null, "e1", "2026-06-01T00:00:00Z")];
    for (const order of [rows, [...rows].reverse()]) expect(documentItems("employee_document", order, ctx())).toEqual([]);
    // the reverse: a NEWER row with a date over an earlier undated one is judged on its date
    const dated = documentItems("employee_document", [d("old", "visa", null, "e1", "2026-01-01T00:00:00Z"), d("newer", "visa", day(-2), "e1", "2026-06-01T00:00:00Z")], ctx());
    expect(dated.map((i) => i.sourceId)).toEqual(["newer"]);
  });

  it("the same rule on both stores and across people: a removed newest row falls back to the previous one, a tie goes to the later id, and two people's rows are never mixed", () => {
    const removed = { ...d("gone", "visa", day(400), "e1", "2026-06-01T00:00:00Z"), deleted_at: "2026-06-02T00:00:00Z" };
    expect(documentItems("employee_document", [d("kept", "visa", day(-4), "e1", "2026-01-01T00:00:00Z"), removed], ctx()).map((i) => i.sourceId)).toEqual(["kept"]);
    const tie = documentItems("identity_document", [d("a", "passport", day(-4), "e1", "2026-03-01T00:00:00Z"), d("b", "passport", day(300), "e1", "2026-03-01T00:00:00Z")], ctx());
    expect(tie).toEqual([]);
    const two = documentItems("identity_document", [d("p1", "passport", day(-4), "e1", "2026-01-01T00:00:00Z"), d("p2", "passport", day(300), "e2", "2026-06-01T00:00:00Z")], ctx());
    expect(two.map((i) => i.sourceId)).toEqual(["p1"]);
  });

  it("an acknowledgement belongs to one date: it moves the item to Acknowledged, keeps it open, and stops applying when the date changes", () => {
    const acked = new Map([[ackKey("employee_document", "a", day(-3)), { at: "2026-11-15T10:00:00Z", note: "Renewal booked" }]]);
    const [i] = documentItems("employee_document", [d("a", "visa", day(-3), "e1")], ctx({ acks: acked }));
    expect(i).toMatchObject({ state: "acknowledged", urgency: "overdue", canAcknowledge: false, acknowledged: { note: "Renewal booked" } });
    const [moved] = documentItems("employee_document", [d("a", "visa", day(-1), "e1")], ctx({ acks: acked }));
    expect(moved).toMatchObject({ state: "needs_action", canAcknowledge: true });
  });

  it("acknowledging is offered only to HR Admin of the item's company; everyone else is told who acts next", () => {
    const rows = [d("a", "visa", day(-3), "e2")];
    expect(documentItems("employee_document", rows, ctx({}, ["c1"]))[0]).toMatchObject({ canAcknowledge: false, actsNext: "HR Admin of Birch Works" });
    expect(documentItems("employee_document", rows, ctx({}, ["c2"]))[0]).toMatchObject({ canAcknowledge: true, actsNext: "You (HR Admin)" });
  });

  it("an employee outside the viewer's read is never listed (the employees read decides)", () => {
    expect(documentItems("employee_document", [d("a", "visa", day(-3), "ghost")], ctx())).toEqual([]);
  });

  it("contract end and probation use the 30-day horizon; probation due today is overdue, a contract ending in 40 days is not listed", () => {
    const items = contractItems([
      { id: "k1", employee_id: "e1", contract_type: "fixed_term", end_date: day(10), probation_end_date: day(0) },
      { id: "k2", employee_id: "e1", contract_type: "fixed_term", end_date: day(40), probation_end_date: null },
    ], ctx());
    expect(items.map((i) => [i.kind, i.state])).toEqual([["contract_end", "due_soon"], ["probation", "needs_action"]]);
    expect(items[1]!.issue).toBe("Probation review is due today");
    expect(items[0]!.href).toBe("/employees/e1?tab=employment");
  });

  it("attendance exceptions open the register on that company, date and employee, filtered to what needs review", () => {
    const [a, w] = attendanceItems([{ id: "r1", employee_id: "e1", work_date: day(-1) }], [{ id: "w1", employee_id: "e1", starting_local_date: day(-2) }], ctx());
    expect(a).toMatchObject({ kind: "attendance", state: "needs_action", issue: "Manual entry and clock records differ" });
    expect(a!.href).toBe(attendanceHref("c1", day(-1), "e1"));
    expect(new URL(`http://x${a!.href}`).searchParams.get("employee")).toBe("e1");
    expect(w!.issue).toBe("Recovery window waiting for HR verification");
  });

  it("recovery alerts keep their own acknowledgement: open needs action, acknowledged is listed as seen", () => {
    const items = recoveryAlertItems([
      { id: "x1", company_id: "c1", employee_id: "e1", alert_type: "long_work", triggered_at: "2026-11-15T10:00:00Z", status: "open", acknowledged_at: null, acknowledgement_note: null },
      { id: "x2", company_id: "c1", employee_id: "e1", alert_type: "window_rollover", triggered_at: "2026-11-14T10:00:00Z", status: "acknowledged", acknowledged_at: "2026-11-15T09:00:00Z", acknowledgement_note: "Spoke to them" },
    ], ctx(), (t) => t, (iso) => iso.slice(0, 10));
    expect(items.map((i) => [i.sourceId, i.state, i.canAcknowledge])).toEqual([["x1", "needs_action", true], ["x2", "acknowledged", false]]);
  });

  it("AI suggestions carry no payload and link to the existing review screen at that draft", () => {
    const [i] = aiSuggestionItems([{ id: "d1", entity_type: "leave_ledger", proposed_action: "adjust_balance", created_by_agent: "helper", created_at: "2026-11-16T08:00:00Z" }], ctx());
    expect(i).toMatchObject({ state: "needs_action", href: "/ai-suggestions#draft-d1", canAcknowledge: false, actsNext: "HR Admin or System Administrator" });
    expect(JSON.stringify(i)).not.toContain("helper");
  });

  it("sorts needs action first, most overdue first, and counts by state", () => {
    const items = sortItems([
      ...documentItems("employee_document", [d("a", "visa", day(-1), "e1"), d("b", "other", day(-9), "e1"), d("c", "certificate", day(5), "e1")], ctx()),
    ]);
    expect(items.map((i) => i.sourceId)).toEqual(["b", "a", "c"]);
    expect(countByState(items)).toEqual({ needs_action: 2, due_soon: 1, acknowledged: 0 });
  });
});
