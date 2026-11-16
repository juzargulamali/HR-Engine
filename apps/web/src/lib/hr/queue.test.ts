import { describe, expect, it } from "vitest";
import { ackKey, aiSuggestionItems, attendanceHref, attendanceItems, contractItems, countByState, documentItems, makeViewer, recoveryAlertItems, sortItems, whenPhrase } from "./queue";

const TODAY = "2026-11-16";
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
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
      { id: "a", employee_id: "e1", document_type: "visa", expiry_date: day(-3) },
      { id: "b", employee_id: "e1", document_type: "labor_card", expiry_date: day(20) },
      { id: "c", employee_id: "e1", document_type: "certificate", expiry_date: day(200) },
      { id: "d", employee_id: "e1", document_type: "other", expiry_date: null },
    ], ctx());
    expect(items.map((i) => [i.sourceId, i.state, i.urgency])).toEqual([["a", "needs_action", "overdue"], ["b", "due_soon", "due_soon"]]);
    expect(items[0]!.issue).toBe("Visa expired: expired 3 days ago");
  });

  it("only the newest version of a document type counts: a renewal clears the older row, a renewal that is itself expired does not", () => {
    const rows = [
      { id: "old", employee_id: "e1", document_type: "visa", expiry_date: day(-30) },
      { id: "new", employee_id: "e1", document_type: "visa", expiry_date: day(400) },
    ];
    expect(documentItems("employee_document", rows, ctx())).toEqual([]);
    expect(documentItems("employee_document", [rows[0]!, { id: "n2", employee_id: "e1", document_type: "visa", expiry_date: day(-5) }], ctx()).map((i) => i.sourceId)).toEqual(["n2"]);
    // a newer row with no expiry date never expires
    expect(documentItems("employee_document", [rows[0]!, { id: "n3", employee_id: "e1", document_type: "visa", expiry_date: null }], ctx())).toEqual([]);
  });

  it("an acknowledgement belongs to one date: it moves the item to Acknowledged, keeps it open, and stops applying when the date changes", () => {
    const acked = new Map([[ackKey("employee_document", "a", day(-3)), { at: "2026-11-15T10:00:00Z", note: "Renewal booked" }]]);
    const [i] = documentItems("employee_document", [{ id: "a", employee_id: "e1", document_type: "visa", expiry_date: day(-3) }], ctx({ acks: acked }));
    expect(i).toMatchObject({ state: "acknowledged", urgency: "overdue", canAcknowledge: false, acknowledged: { note: "Renewal booked" } });
    const [moved] = documentItems("employee_document", [{ id: "a", employee_id: "e1", document_type: "visa", expiry_date: day(-1) }], ctx({ acks: acked }));
    expect(moved).toMatchObject({ state: "needs_action", canAcknowledge: true });
  });

  it("acknowledging is offered only to HR Admin of the item's company; everyone else is told who acts next", () => {
    const rows = [{ id: "a", employee_id: "e2", document_type: "visa", expiry_date: day(-3) }];
    expect(documentItems("employee_document", rows, ctx({}, ["c1"]))[0]).toMatchObject({ canAcknowledge: false, actsNext: "HR Admin of Birch Works" });
    expect(documentItems("employee_document", rows, ctx({}, ["c2"]))[0]).toMatchObject({ canAcknowledge: true, actsNext: "You (HR Admin)" });
  });

  it("an employee outside the viewer's read is never listed (the employees read decides)", () => {
    expect(documentItems("employee_document", [{ id: "a", employee_id: "ghost", document_type: "visa", expiry_date: day(-3) }], ctx())).toEqual([]);
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
      ...documentItems("employee_document", [{ id: "a", employee_id: "e1", document_type: "visa", expiry_date: day(-1) }, { id: "b", employee_id: "e1", document_type: "other", expiry_date: day(-9) }, { id: "c", employee_id: "e1", document_type: "certificate", expiry_date: day(5) }], ctx()),
    ]);
    expect(items.map((i) => i.sourceId)).toEqual(["b", "a", "c"]);
    expect(countByState(items)).toEqual({ needs_action: 2, due_soon: 1, acknowledged: 0 });
  });
});
