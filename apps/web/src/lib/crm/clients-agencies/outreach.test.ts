import { describe, expect, it } from "vitest";
import type { CrmOutreachEventRow, CrmOutreachRow } from "@/types/crm";
import { readFileSync } from "node:fs";
import { outreachRowState, describeEvent, filterOutreach, isOutcomeValidForKind, isOverdue, outcomeAfterKindChange, outcomesForKind, outreachFiltersFromParams, OUTREACH_OUTCOME_LABEL, OUTREACH_OUTCOMES, OUTREACH_OUTCOMES_BY_KIND, OUTREACH_SETTABLE_STATUSES, summariseAssignResults } from "./outreach";

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
  it("offers the outcome lists per kind, with Replied only for e-mail and Spoke only for calls, and never lets a person pick Enquiry raised by hand", () => {
    expect(OUTREACH_OUTCOMES_BY_KIND.call).toEqual(["no_answer", "left_message", "spoke", "call_back_requested", "not_interested"]);
    expect(OUTREACH_OUTCOMES_BY_KIND.email).toEqual(["sent", "replied", "bounced", "not_interested"]);
    expect(OUTREACH_OUTCOMES_BY_KIND.meeting).toEqual(["meeting_booked", "meeting_held", "rescheduled", "no_show", "not_interested"]);
    expect(isOutcomeValidForKind("email", "replied")).toBe(true);
    expect(isOutcomeValidForKind("call", "replied")).toBe(false);
    expect(isOutcomeValidForKind("meeting", "replied")).toBe(false);
    expect(isOutcomeValidForKind("call", "spoke")).toBe(true);
    expect(isOutcomeValidForKind("email", "spoke")).toBe(false);
    expect(outcomesForKind("sms")).toEqual([]);
    expect(OUTREACH_SETTABLE_STATUSES).not.toContain("inquiry_raised");
  });
  it("keeps every outcome of the original single list readable (stored value set and labels), even where it no longer fits its kind", () => {
    for (const legacy of ["no_answer", "spoke", "left_message", "sent", "replied", "meeting_held", "not_interested"] as const) {
      expect(OUTREACH_OUTCOMES).toContain(legacy);
      expect(OUTREACH_OUTCOME_LABEL[legacy]).toBeTruthy();
    }
    for (const kind of ["call", "email", "meeting"] as const) for (const o of OUTREACH_OUTCOMES_BY_KIND[kind]) expect(OUTREACH_OUTCOMES).toContain(o);
    const legacyRow = { id: "e", outreach_id: "o", company_id: "c", organisation_id: "g", kind: "call", occurred_on: "2026-11-01", outcome: "replied", note: null, from_user: null, to_user: null, from_status: null, to_status: null, due_on: null, opportunity_id: null, created_by: "u", created_at: "" } as const;
    expect(describeEvent(legacyRow, () => "x", () => "i")).toBe("Call · Replied");   // shown as stored, not rewritten or hidden
  });
  it("changing the kind keeps an outcome that still fits and clears one that does not", () => {
    expect(outcomeAfterKindChange("email", "not_interested")).toBe("not_interested");
    expect(outcomeAfterKindChange("email", "spoke")).toBe("");
    expect(outcomeAfterKindChange("meeting", "sent")).toBe("");
    expect(outcomeAfterKindChange("call", "")).toBe("");
  });
  it("the database function lists the same outcomes per kind as the app (one definition kept in step)", () => {
    const sql = readFileSync(new URL("../../../../../../supabase/migrations/20261219000100_crm_clients_agencies.sql", import.meta.url), "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function crm_outreach_log("));
    for (const kind of ["call", "email", "meeting"] as const) {
      const m = fn.match(new RegExp(`when '${kind}' then array\\[([^\\]]*)\\]`));
      expect(m, kind).not.toBeNull();
      expect([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...OUTREACH_OUTCOMES_BY_KIND[kind]]);
    }
    const check = sql.match(/crm_outreach_events_outcome_check check \(outcome is null or outcome in\s*\(([^)]*)\)/);
    expect(check).not.toBeNull();
    expect([...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()).toEqual([...OUTREACH_OUTCOMES].sort());
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
    expect(describeEvent(ev({ kind: "inquiry_linked", opportunity_id: "x" }), who, () => "UAE-1: Gala")).toBe("Enquiry linked: UAE-1: Gala");
  });
});

describe("an outreach row: where it stands in words, and its one action", () => {
  it("overdue is red and says by how many days, whichever date it is measured from", () => {
    expect(outreachRowState(row({ id: "a", target_date: "2026-11-04" }), TODAY)).toMatchObject({ tone: "red", label: "Overdue by 3 days", overdue: true, dueKind: "target", dueDate: "2026-11-04", action: "log" });
    expect(outreachRowState(row({ id: "a", next_action: "Call back", next_due: "2026-11-06", status: "waiting_for_reply" }), TODAY)).toMatchObject({ tone: "red", label: "Overdue by 1 day", overdue: true, waiting: false, dueKind: "next_action" });
  });
  it("due today and waiting for a reply are amber, in words", () => {
    expect(outreachRowState(row({ id: "a", target_date: TODAY }), TODAY)).toMatchObject({ tone: "amber", label: "Due today", overdue: false });
    expect(outreachRowState(row({ id: "a", status: "waiting_for_reply", next_action: "Chase", next_due: "2026-11-20" }), TODAY)).toMatchObject({ tone: "amber", label: "Waiting for reply", waiting: true, overdue: false });
    expect(outreachRowState(row({ id: "a", status: "waiting_for_reply", target_date: TODAY }), TODAY).label).toBe("Waiting for reply, due today");
  });
  it("on time is neutral and counts the days left", () => {
    expect(outreachRowState(row({ id: "a", next_action: "Send portfolio", next_due: "2026-11-09", status: "in_progress" }), TODAY)).toMatchObject({ tone: "neutral", label: "Due in 2 days", action: "log" });
    expect(outreachRowState(row({ id: "a", target_date: "2026-11-08" }), TODAY).label).toBe("Due in 1 day");
  });
  it("the action is Set next action only when a contact was logged and nothing is planned", () => {
    expect(outreachRowState(row({ id: "a", status: "in_progress", last_contact_on: "2026-11-05" }), TODAY).action).toBe("set_next");
    expect(outreachRowState(row({ id: "a", status: "in_progress", last_contact_on: "2026-11-05", next_action: "Call", next_due: "2026-11-12" }), TODAY).action).toBe("log");
    expect(outreachRowState(row({ id: "a" }), TODAY).action).toBe("log");
  });
  it("an outreach that already has an enquiry offers the enquiry, never another one, and is not overdue", () => {
    expect(outreachRowState(row({ id: "a", status: "inquiry_raised", opportunity_id: "opp", target_date: "2026-01-01" }), TODAY)).toEqual({ tone: "green", label: "Enquiry raised", dueDate: null, dueKind: null, waiting: false, overdue: false, action: "open_enquiry" });
    // linked and later closed: still the enquiry
    expect(outreachRowState(row({ id: "a", status: "closed", opportunity_id: "opp" }), TODAY).action).toBe("open_enquiry");
    expect(outreachRowState(row({ id: "a", status: "closed", target_date: "2026-01-01" }), TODAY)).toMatchObject({ tone: "quiet", label: "Closed", overdue: false, action: "open_account" });
  });
  it("agrees with isOverdue for every status", () => {
    for (const status of ["not_started", "in_progress", "waiting_for_reply", "meeting_booked", "inquiry_raised", "closed"] as const) {
      const o = row({ id: "a", status, target_date: "2026-11-01" });
      expect(outreachRowState(o, TODAY).overdue).toBe(isOverdue(o, TODAY));
    }
  });
});
