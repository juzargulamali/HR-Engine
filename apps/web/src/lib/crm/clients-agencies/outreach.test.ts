import { describe, expect, it } from "vitest";
import type { CrmOutreachEventRow, CrmOutreachRow } from "@/types/crm";
import { describeEvent, filterOutreach, isOverdue, outreachFiltersFromParams, OUTREACH_OUTCOMES, OUTREACH_SETTABLE_STATUSES, summariseAssignResults } from "./outreach";

const TODAY = "2026-11-07";
const row = (o: Partial<CrmOutreachRow> & { id: string }): CrmOutreachRow => ({
  organisation_id: "org", company_id: "co", assigned_to: "sara", assigned_by: "lead", assigned_at: "2026-11-01T00:00:00Z", target_date: "2026-11-30", objective: null, status: "not_started",
  closed_reason: null, closed_at: null, last_contact_on: null, last_contact_kind: null, last_outcome: null, next_action: null, next_due: null, opportunity_id: null, created_at: "", updated_at: "", ...o,
});

describe("overdue", () => {
  it("uses the next action's due date, else the target date, and only for outreach still being worked", () => {
    expect(isOverdue(row({ id: "a", target_date: "2026-11-06" }), TODAY)).toBe(true);
    expect(isOverdue(row({ id: "a", target_date: "2026-11-07" }), TODAY)).toBe(false);
    expect(isOverdue(row({ id: "a", target_date: "2026-11-01", next_due: "2026-11-20" }), TODAY)).toBe(false);
    expect(isOverdue(row({ id: "a", next_due: "2026-11-02" }), TODAY)).toBe(true);
    expect(isOverdue(row({ id: "a", target_date: "2026-01-01", status: "closed" }), TODAY)).toBe(false);
    expect(isOverdue(row({ id: "a", target_date: "2026-01-01", status: "inquiry_raised" }), TODAY)).toBe(false);
  });
});

describe("filters and sort", () => {
  const rows = [
    row({ id: "1", assigned_to: "sara", target_date: "2026-12-01", status: "in_progress" }),
    row({ id: "2", assigned_to: "omar", target_date: "2026-11-01", status: "waiting_for_reply" }),
    row({ id: "3", assigned_to: "sara", target_date: "2026-11-30", next_due: "2026-11-05", status: "meeting_booked" }),
    row({ id: "4", assigned_to: "sara", status: "closed", closed_reason: "No" }),
  ];
  const none = { assignee: "", status: "", overdue: false };
  it("sorts by next due (target date when there is no next action) and hides closed by default", () => {
    expect(filterOutreach(rows, none, TODAY).map((r) => r.id)).toEqual(["2", "3", "1"]);
  });
  it("filters by assignee, status and overdue, and can show closed", () => {
    expect(filterOutreach(rows, { ...none, assignee: "sara" }, TODAY).map((r) => r.id)).toEqual(["3", "1"]);
    expect(filterOutreach(rows, { ...none, status: "closed" }, TODAY).map((r) => r.id)).toEqual(["4"]);
    expect(filterOutreach(rows, { ...none, overdue: true }, TODAY).map((r) => r.id)).toEqual(["2", "3"]);
    expect(filterOutreach(rows, { assignee: "omar", status: "waiting_for_reply", overdue: true }, TODAY).map((r) => r.id)).toEqual(["2"]);
  });
  it("ignores unknown values in the address", () => {
    expect(outreachFiltersFromParams({ assignee: "x", status: "bogus", overdue: "yes" })).toEqual(none);
    expect(outreachFiltersFromParams({ status: "closed", overdue: "1" })).toEqual({ assignee: "", status: "closed", overdue: true });
  });
});

describe("definitions", () => {
  it("offers exactly the seven outcomes and never lets a person pick Inquiry raised by hand", () => {
    expect([...OUTREACH_OUTCOMES]).toEqual(["no_answer", "spoke", "left_message", "sent", "replied", "meeting_held", "not_interested"]);
    expect(OUTREACH_SETTABLE_STATUSES).not.toContain("inquiry_raised");
  });
  it("counts bulk results per kind", () => {
    expect(summariseAssignResults([{ organisation_id: "a", result: "assigned" }, { organisation_id: "b", result: "assigned" }, { organisation_id: "c", result: "already" }])).toEqual({ assigned: 2, already: 1 });
  });
  it("words a history line", () => {
    const ev = (e: Partial<CrmOutreachEventRow>) => ({ id: "e", outreach_id: "o", company_id: "c", organisation_id: "g", kind: "call", occurred_on: "2026-11-06", outcome: null, note: null, from_user: null, to_user: null, from_status: null, to_status: null, due_on: null, opportunity_id: null, created_by: "u", created_at: "", ...e }) as CrmOutreachEventRow;
    const who = (id: string | null) => (id === "s" ? "Sara" : "Omar");
    expect(describeEvent(ev({ kind: "email", outcome: "sent", note: "Portfolio" }), who, () => "")).toBe("Email · Sent: Portfolio");
    expect(describeEvent(ev({ kind: "reassigned", from_user: "s", to_user: "o" }), who, () => "")).toBe("Reassigned from Sara to Omar");
    expect(describeEvent(ev({ kind: "status", from_status: "not_started", to_status: "in_progress", note: "First activity logged" }), who, () => "")).toBe("Status: Not started to In progress (First activity logged)");
    expect(describeEvent(ev({ kind: "inquiry_linked", opportunity_id: "x" }), who, () => "UAE-1: Gala")).toBe("Inquiry linked: UAE-1: Gala");
  });
});
