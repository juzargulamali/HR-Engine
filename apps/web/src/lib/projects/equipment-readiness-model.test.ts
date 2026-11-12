import { describe, expect, it } from "vitest";
import {
  parseReadiness, READINESS_LABEL, readinessLine, readinessSummary, requestHref, REVIEW_FIELD_LABEL, reviewChangeText, shortBreakdown, stillOutAfterDelivery, stillOutText,
  type EquipmentReadiness, type RequestReadiness,
} from "./equipment-readiness-model";

// Fictional data only.
const row = (over: Record<string, unknown> = {}) => ({
  id: "q1", code: "REQ-0101", status: "in_progress", state: "reserved", lines: 5, reserved_lines: 5, partial_lines: 0, short_lines: 0, short_buy: 0, short_rent: 0, short_no_plan: 0, dispatched_lines: 0,
  returned_lines: 0, units_asked: 12, units_short: 0, units_dispatched: 0, units_returned: 0, units_out: 0, needed_from: "2026-11-20T04:00:00Z", needed_until: "2026-11-25T16:00:00Z", expected_return_at: null,
  return_overdue: false, ...over,
});
const raw = (over: Record<string, unknown> = {}) => ({ project_status: "active", requests: [row()], reviews: [], release_failed: null, ...over });
const one = (over: Record<string, unknown>): RequestReadiness => parseReadiness(raw({ requests: [row(over)] }))!.requests[0]!;
const parsed = (over: Record<string, unknown> = {}): EquipmentReadiness => parseReadiness(raw(over))!;

describe("reading the database's answer", () => {
  it("keeps the counts and dates as given", () => {
    const e = parsed({ reviews: [{ id: "v1", request_id: "q1", request_code: "REQ-0101", field: "event_start", old_date: "2026-11-21", new_date: "2026-11-23", changed_at: "2026-11-10T08:00:00Z", changed_by: "Fictional Pia" }] });
    expect(e.requests[0]).toMatchObject({ id: "q1", code: "REQ-0101", state: "reserved", lines: 5, reservedLines: 5, unitsAsked: 12, returnOverdue: false });
    expect(e.reviews[0]).toMatchObject({ requestId: "q1", field: "event_start", oldDate: "2026-11-21", newDate: "2026-11-23", changedBy: "Fictional Pia" });
    expect(e.releaseFailed).toBeNull();
  });
  it("an unexpected shape or an unknown state is not guessed at: it is a failed read, never 'no equipment'", () => {
    expect(parseReadiness(null)).toBeNull();
    expect(parseReadiness([])).toBeNull();
    expect(parseReadiness({ requests: [] })).toBeNull();
    expect(parseReadiness(raw({ requests: [row({ state: "sort_of_ready" })] }))).toBeNull();
    expect(parseReadiness(raw({ reviews: [{ id: "v", request_id: "q1", field: "teardown" }] }))).toBeNull();
    expect(parseReadiness(raw({ requests: [] }))).toMatchObject({ requests: [], reviews: [] });
  });
});

describe("readiness in words", () => {
  it("uses the agreed labels", () => {
    expect(READINESS_LABEL).toMatchObject({ reserved: "Reserved", partially_ready: "Partly ready", short: "Short", partially_dispatched: "Partly dispatched", dispatched: "Dispatched", still_out: "Still out",
      returned: "Returned", draft: "Not sent to the warehouse yet" });
  });
  it("Short says how many lines are to buy, to rent or have no plan yet", () => {
    expect(shortBreakdown({ shortBuy: 2, shortRent: 1, shortNoPlan: 1 })).toBe("2 to buy, 1 to rent, 1 with no plan yet");
    expect(shortBreakdown({ shortBuy: 0, shortRent: 0, shortNoPlan: 0 })).toBe("");
    expect(readinessLine(one({ state: "short", lines: 4, reserved_lines: 0, short_lines: 4, short_buy: 2, short_rent: 1, short_no_plan: 1 }))).toEqual({ label: "Short", detail: "4 of 4 lines short: 2 to buy, 1 to rent, 1 with no plan yet", tone: "red" });
  });
  it("Partly ready never counts a line to buy or rent as reserved", () => {
    expect(readinessLine(one({ state: "partially_ready", lines: 5, reserved_lines: 3, short_lines: 2, short_buy: 1, short_rent: 1 }))).toEqual({ label: "Partly ready", detail: "3 of 5 lines reserved · 2 lines short: 1 to buy, 1 to rent", tone: "amber" });
  });
  it("says what is reserved, dispatched, still out and returned", () => {
    expect(readinessLine(one({}))).toEqual({ label: "Reserved", detail: "All 5 lines are reserved for the request dates", tone: "quiet" });
    expect(readinessLine(one({ state: "draft", status: "draft" }))).toMatchObject({ label: "Not sent to the warehouse yet", tone: "amber" });
    expect(readinessLine(one({ state: "partially_dispatched", dispatched_lines: 2, units_out: 6 })).detail).toBe("2 of 5 lines dispatched · 6 units out");
    expect(readinessLine(one({ state: "dispatched", units_out: 12, return_overdue: true }))).toEqual({ label: "Dispatched", detail: "12 units out · return overdue", tone: "red" });
    expect(readinessLine(one({ state: "still_out", units_dispatched: 12, units_returned: 9, units_out: 3 }))).toEqual({ label: "Still out", detail: "9 of 12 units returned · 3 units still out", tone: "amber" });
    expect(readinessLine(one({ state: "returned", units_dispatched: 12, units_returned: 12 }))).toMatchObject({ label: "Returned", tone: "quiet" });
  });
});

describe("Review equipment booking", () => {
  it("names the date that changed and what it was and is", () => {
    expect(REVIEW_FIELD_LABEL).toEqual({ install_start: "Installation start", event_start: "Event start", event_end: "Event end" });
    expect(reviewChangeText({ oldDate: "2026-11-21", newDate: "2026-11-23" })).toBe("was 21 Nov 2026 · now 23 Nov 2026");
    expect(reviewChangeText({ oldDate: null, newDate: "2026-11-23" })).toBe("was not set · now 23 Nov 2026");
    expect(requestHref("q1")).toBe("/inventory/requests/q1");
  });
});

describe("a finished project with equipment still out", () => {
  const out = row({ state: "still_out", units_dispatched: 12, units_returned: 9, units_out: 3, expected_return_at: "2026-11-01T08:00:00Z", return_overdue: true });
  it("lists what is out, when it is expected back and that it is overdue", () => {
    const s = stillOutAfterDelivery(parsed({ project_status: "completed", requests: [out, row({ id: "q2", code: "REQ-0102", state: "returned" })] }))!;
    expect(s).toMatchObject({ units: 3, overdue: true });
    expect(s.requests).toHaveLength(1);
    expect(stillOutText(s.requests[0]!)).toMatch(/^3 units out · expected back .*2026.* · overdue$/);
    expect(stillOutText({ id: "q", code: "c", unitsOut: 1, expectedReturnAt: null, overdue: false })).toBe("1 unit out · no expected return recorded");
  });
  it("says nothing while the project is live, or when everything is back", () => {
    expect(stillOutAfterDelivery(parsed({ project_status: "active", requests: [out] }))).toBeNull();
    expect(stillOutAfterDelivery(parsed({ project_status: "archived", requests: [row({ state: "returned" })] }))).toBeNull();
    expect(stillOutAfterDelivery(parsed({ project_status: "archived", requests: [out] }))).not.toBeNull();
  });
});

describe("the delivery summary's equipment line", () => {
  it("is the one request's state, with its counts", () => {
    expect(readinessSummary(parsed({ requests: [row({ state: "short", reserved_lines: 0, short_lines: 5, short_no_plan: 5 })] }))).toEqual({ text: "Short", detail: "5 of 5 lines short: 5 with no plan yet", tone: "red" });
  });
  it("counts each state when there are several requests, worst first", () => {
    expect(readinessSummary(parsed({ requests: [row(), row({ id: "q2", state: "short", short_lines: 5, short_buy: 5 }), row({ id: "q3" })] }))).toEqual({ text: "1 short · 2 reserved", detail: "3 requests with the warehouse", tone: "red" });
  });
  it("mentions a booking to review, and leaves drafts to the page's own line", () => {
    const review = { id: "v1", request_id: "q1", request_code: "REQ-0101", field: "install_start", old_date: "2026-11-19", new_date: "2026-11-18", changed_at: "2026-11-10T08:00:00Z", changed_by: null };
    expect(readinessSummary(parsed({ reviews: [review] }))).toMatchObject({ text: "Reserved", tone: "amber", detail: expect.stringContaining("Review equipment booking") });
    expect(readinessSummary(parsed({ requests: [row({ state: "draft", status: "draft" })] }))).toBeNull();
    expect(readinessSummary(parsed({ requests: [] }))).toBeNull();
  });
});
