import { describe, expect, it } from "vitest";
import { equipmentSummary, workAttention, type AttentionInput, type AttentionTask, type EquipmentState } from "./work-attention";

const t = (over: Partial<AttentionTask>): AttentionTask => ({ id: "t1", title: "Hang truss", status: "in_progress", due_date: null, assignee_id: "tech", blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null, ...over });
const names: Record<string, string> = { tech: "Fictional Tom", pm: "Fictional Pia", head: "Fictional Hana" };
const noEquipment: EquipmentState = { status: "ok", drafts: [], waiting: [], importFailed: null, requests: 0 };
const input = (over: Partial<AttentionInput>): AttentionInput => ({
  tasks: [], reviewIds: [], lateMilestones: [], equipment: noEquipment, userId: "tech", manager: false, pmName: "Fictional Pia", today: "2026-11-11",
  nameOf: (u) => names[u ?? ""] ?? "Unknown", taskHref: (id) => `/t/${id}`, milestonesHref: "/ms", equipmentHref: (r) => `/eq${r ? `?request=${r}` : ""}`, ...over,
});

describe("what needs doing on a project", () => {
  it("a blocker names who can clear it: the named person sees it under Needs you, everyone else under Waiting, with the reason and the due date", () => {
    const blocked = t({ blocked_at: "2026-11-10", blocked_reason: "Power not ready", unblock_owner_id: "head", unblock_action: "Confirm the supply", due_date: "2026-11-12" });
    const asTech = workAttention(input({ tasks: [blocked] }));
    expect(asTech.needsYou).toEqual([]);
    expect(asTech.waiting[0]).toMatchObject({ label: "Blocked", owner: "Fictional Hana", due: "2026-11-12", href: "/t/t1", detail: "Reason: Power not ready · To clear it: Confirm the supply" });
    const asHead = workAttention(input({ tasks: [blocked], userId: "head" }));
    expect(asHead.needsYou[0]).toMatchObject({ label: "Blocked", owner: "You" });
    expect(asHead.waiting).toEqual([]);
  });
  it("a blocker with nobody named falls to whoever manages the project, and says that no one is named and no reason was recorded", () => {
    const blocked = t({ blocked_at: "2026-11-10" });
    expect(workAttention(input({ tasks: [blocked], userId: "pm", manager: true })).needsYou[0]!.owner).toMatch(/^You \(no one is named/);
    const w = workAttention(input({ tasks: [blocked] })).waiting[0]!;
    expect(w.owner).toBe("No one named; Fictional Pia manages the project");
    expect(w.detail).toBe("No reason recorded");
    expect(w.due).toBeNull();
  });
  it("a reviewer gets the review; the person who sent it sees it as waiting on someone else, never as their own action", () => {
    const sent = t({ status: "ready_for_review" });
    expect(workAttention(input({ tasks: [sent], reviewIds: ["t1"], userId: "head" })).needsYou[0]).toMatchObject({ label: "Review", owner: "You", detail: "Done by Fictional Tom. Accept it or send it back." });
    const mine = workAttention(input({ tasks: [sent] }));
    expect(mine.needsYou).toEqual([]);
    expect(mine.waiting[0]).toMatchObject({ label: "In review", detail: "You sent it for review." });
  });
  it("my own overdue and due-today tasks need me; someone else's, undated and finished ones do not", () => {
    const r = workAttention(input({ tasks: [
      t({ id: "a", title: "A", due_date: "2026-11-01" }), t({ id: "b", title: "B", due_date: "2026-11-11" }), t({ id: "c", title: "C", due_date: "2026-11-20" }), t({ id: "d", title: "D" }),
      t({ id: "e", title: "E", due_date: "2026-11-01", assignee_id: "head" }), t({ id: "f", title: "F", due_date: "2026-11-01", status: "done" }),
    ] }));
    expect(r.needsYou.map((x) => [x.title, x.label])).toEqual([["A", "Overdue"], ["B", "Due today"]]);
    expect(r.waiting).toEqual([]);
  });
  it("an overdue milestone is the manager's to act on and a wait for everyone else", () => {
    const late = [{ id: "m1", title: "Stand handover", due_date: "2026-11-01" }];
    expect(workAttention(input({ lateMilestones: late, manager: true, userId: "pm" })).needsYou[0]).toMatchObject({ label: "Milestone overdue", owner: "You", href: "/ms" });
    expect(workAttention(input({ lateMilestones: late })).waiting[0]).toMatchObject({ owner: "Fictional Pia" });
  });
  it("equipment: only confirmed states, with the three labels; submission is never done for the manager", () => {
    const equipment: EquipmentState = { status: "ok", drafts: [{ id: "r1", code: "EQ-1" }], waiting: [{ id: "r2", code: "EQ-2" }], importFailed: { at: "2026-11-10T08:00:00Z", detail: "No technology matched" }, requests: 2 };
    const pm = workAttention(input({ equipment, manager: true, userId: "pm" }));
    expect(pm.needsYou.map((x) => x.label)).toEqual(["Import failed — review", "Equipment draft needs submission"]);
    expect(pm.needsYou[0]).toMatchObject({ recovery: "import", detail: "No technology matched" });
    expect(pm.needsYou[1]).toMatchObject({ href: "/eq?request=r1", owner: "You" });
    expect(pm.waiting[0]).toMatchObject({ label: "Waiting for Warehouse", owner: "Warehouse", href: "/eq?request=r2" });
    const member = workAttention(input({ equipment }));
    expect(member.needsYou).toEqual([]);                                             // a member cannot submit or re-import
    expect(member.waiting.map((x) => x.label)).toEqual(["Equipment draft needs submission", "Waiting for Warehouse"]);
    expect(workAttention(input({ equipment: { status: "error" } })).needsYou).toEqual([]);   // a failed read invents nothing (the page says it could not load)
  });
  it("orders blockers first, then reviews, then overdue work", () => {
    const r = workAttention(input({ userId: "head", reviewIds: ["rv"], tasks: [
      t({ id: "od", title: "Overdue", assignee_id: "head", due_date: "2026-11-01" }), t({ id: "rv", title: "Review me", status: "ready_for_review" }), t({ id: "bl", title: "Blocked", blocked_at: "x", unblock_owner_id: "head" }),
    ] }));
    expect(r.needsYou.map((x) => x.label)).toEqual(["Blocked", "Review", "Overdue"]);
  });
});

describe("the equipment line of the delivery summary", () => {
  it("says what is confirmed, most urgent first, and never hides a failed read", () => {
    expect(equipmentSummary({ status: "error" })).toEqual({ text: "Could not load the equipment state", tone: "red" });
    expect(equipmentSummary({ ...noEquipment, importFailed: { at: "x", detail: null }, drafts: [{ id: "1", code: "a" }] } as EquipmentState).text).toBe("Import failed — review");
    expect(equipmentSummary({ ...noEquipment, drafts: [{ id: "1", code: "a" }], requests: 1 } as EquipmentState).text).toBe("Equipment draft needs submission");
    expect(equipmentSummary({ ...noEquipment, waiting: [{ id: "1", code: "a" }], requests: 1 } as EquipmentState).text).toBe("Waiting for Warehouse");
    expect(equipmentSummary(noEquipment).text).toBe("No equipment request yet");
    expect(equipmentSummary({ ...noEquipment, requests: 2 } as EquipmentState).text).toBe("No decision waiting");
  });
});

import type { EquipmentReadiness, EquipmentReview, RequestReadiness } from "./equipment-readiness-model";
describe("equipment readiness on the Work page", () => {
  const review = (over: Partial<EquipmentReview> = {}): EquipmentReview => ({ id: "v1", requestId: "q1", requestCode: "REQ-0101", field: "event_start", oldDate: "2026-11-21", newDate: "2026-11-23", changedAt: "2026-11-10T08:00:00Z", changedBy: "Fictional Pia", ...over });
  const request = (over: Partial<RequestReadiness> = {}): RequestReadiness => ({ id: "q1", code: "REQ-0101", status: "in_progress", state: "reserved", lines: 3, reservedLines: 3, partialLines: 0, shortLines: 0, shortBuy: 0, shortRent: 0,
    shortNoPlan: 0, dispatchedLines: 0, returnedLines: 0, unitsAsked: 6, unitsShort: 0, unitsDispatched: 0, unitsReturned: 0, unitsOut: 0, neededFrom: null, neededUntil: null, expectedReturnAt: null, returnOverdue: false, ...over });
  const ready = (over: Partial<EquipmentReadiness> = {}): EquipmentReadiness => ({ projectStatus: "active", requests: [request()], reviews: [], releaseFailed: null, ...over });

  it("a changed date is 'Review equipment booking': one line per request, the manager's to act on, linking to the Equipment tab", () => {
    const reviews = [review(), review({ id: "v2", field: "event_end", oldDate: "2026-11-24", newDate: "2026-11-26" }), review({ id: "v3", requestId: "q2", requestCode: "REQ-0102" })];
    const pm = workAttention(input({ equipmentReviews: reviews, manager: true, userId: "pm" }));
    expect(pm.needsYou.map((x) => [x.label, x.title, x.href, x.owner])).toEqual([["Review equipment booking", "Request REQ-0101", "/eq#equipment-review", "You"], ["Review equipment booking", "Request REQ-0102", "/eq#equipment-review", "You"]]);
    expect(pm.needsYou[0]!.detail).toBe("Event start: was 21 Nov 2026 · now 23 Nov 2026 · Event end: was 24 Nov 2026 · now 26 Nov 2026. The booking has not been changed.");
    const member = workAttention(input({ equipmentReviews: reviews }));
    expect(member.needsYou).toEqual([]);
    expect(member.waiting.map((x) => x.owner)).toEqual(["Fictional Pia", "Fictional Pia"]);
    // shown even when the older equipment read failed; none when there is no review
    expect(workAttention(input({ equipment: { status: "error" }, equipmentReviews: [review()], manager: true })).needsYou).toHaveLength(1);
    expect(workAttention(input({ equipmentReviews: [] })).waiting).toEqual([]);
  });
  it("the summary line uses the readiness state when it is available", () => {
    const sent = { ...noEquipment, requests: 1 } as EquipmentState;
    expect(equipmentSummary(sent, { state: "ok", readiness: ready({ requests: [request({ state: "short", reservedLines: 0, shortLines: 3, shortRent: 3 })] }) })).toEqual({ text: "Short", detail: "3 of 3 lines short: 3 to rent", tone: "red" });
    expect(equipmentSummary({ ...sent, waiting: [{ id: "q1", code: "REQ-0101" }] } as EquipmentState, { state: "ok", readiness: ready() }).text).toBe("Reserved");
    // a decision the manager owes still leads
    expect(equipmentSummary({ ...sent, drafts: [{ id: "d", code: "REQ-0100" }] } as EquipmentState, { state: "ok", readiness: ready() }).text).toBe("Equipment draft needs submission");
  });
  it("a failed readiness read says so, and is never 'No decision waiting'", () => {
    expect(equipmentSummary({ ...noEquipment, requests: 1 } as EquipmentState, { state: "error" })).toEqual({ text: "Equipment readiness could not be loaded", tone: "red" });
  });
  it("without the migration, or without access to readiness, the line is as before", () => {
    expect(equipmentSummary({ ...noEquipment, requests: 2 } as EquipmentState, { state: "not_installed" }).text).toBe("No decision waiting");
    expect(equipmentSummary({ ...noEquipment, waiting: [{ id: "1", code: "a" }], requests: 1 } as EquipmentState, { state: "denied" }).text).toBe("Waiting for Warehouse");
    expect(equipmentSummary({ status: "unavailable" }, { state: "denied" }).text).toBe("Not available to you here");
  });
});
