import { describe, expect, it } from "vitest";
import { describeNotification } from "./notification-text";

const base = { project_id: "p1", reference: "UAE-P-2026-0001", name: "Floor projection" };

describe("describeNotification", () => {
  it("names the project and links to it", () => {
    expect(describeNotification("project_invitation", base)).toEqual({ text: "You were added to UAE-P-2026-0001 Floor projection.", href: "/projects/p1" });
  });
  it("links a task notice to the task and quotes its title", () => {
    const n = describeNotification("project_task_assigned", { ...base, task_id: "t9", task: "Wire sensors" });
    expect(n.text).toContain("“Wire sensors”");
    expect(n.href).toBe("/projects/p1/work/tasks/t9");
  });
  it("describes a review request and its outcome", () => {
    expect(describeNotification("project_review_requested", { ...base, task_id: "t9", task: "Shader" }).text).toContain("ready for your review");
    expect(describeNotification("project_review_result", { ...base, task_id: "t9", task: "Shader", result: "done" }).text).toContain("accepted and completed");
    expect(describeNotification("project_review_result", { ...base, task_id: "t9", task: "Shader", result: "in_progress" }).text).toContain("changes requested");
  });
  it("tells a blocker with its reason", () => {
    expect(describeNotification("project_task_blocked", { ...base, task_id: "t1", task: "Truss", reason: "Waiting for power" }).text).toContain("Waiting for power");
    expect(describeNotification("project_task_blocked", { ...base, task_id: "t1", task: "Truss", reason: "Waiting for power", fyi: true, unblocker: "Pia Manager" }).text).toBe("“Truss” on UAE-P-2026-0001 Floor projection is blocked: Waiting for power. Pia Manager was asked to unblock it.");
  });
  it("carries no message text for mentions and replies, and links to the discussion", () => {
    const m = describeNotification("project_mention", { ...base, message_id: "m1" });
    expect(m).toEqual({ text: "You were mentioned in the conversation of UAE-P-2026-0001 Floor projection.", href: "/projects/p1/discussion" });
    expect(describeNotification("project_reply", { ...base, message_id: "m1" }).href).toBe("/projects/p1/discussion");
  });
  it("distinguishes the three kinds of assignment", () => {
    expect(describeNotification("project_assignment", { ...base, deliverable: "Floor build" }).text).toContain("assigned to your team");
    expect(describeNotification("project_assignment", { ...base, booking_id: "b", location: "Expo Hall" })).toMatchObject({ href: "/projects/p1/timeline" });
    expect(describeNotification("project_assignment", { ...base, feedback_id: "f" }).href).toBe("/projects/p1/changes");
  });
  it("describes a cancelled booking and a changed date", () => {
    expect(describeNotification("project_deadline_changed", { ...base, booking_id: "b", cancelled: true }).text).toContain("cancelled");
    expect(describeNotification("project_deadline_changed", { ...base, task_id: "t", task: "Demo", to: "2099-02-14" }).text).toContain("(now 2099-02-14)");
  });
  it("points handover notices at the handovers page, even without a project", () => {
    for (const t of ["project_handover_submitted", "project_handover_assigned", "project_handover_resubmitted", "project_handover_clarification"]) {
      expect(describeNotification(t, { title: "Floor", reference: "OPP-1" }).href).toBe("/projects/handovers");
    }
    expect(describeNotification("project_handover_accepted", { ...base, title: "Floor" }).href).toBe("/projects/p1");
  });
  it("describes a scope proposal for the person who decides, linking to the changes page", () => {
    expect(describeNotification("project_scope_proposed", { ...base, title: "Add a second wall" })).toEqual({
      text: "A scope change “Add a second wall” was proposed on UAE-P-2026-0001 Floor projection and waits for your decision.", href: "/projects/p1/changes",
    });
    expect(describeNotification("project_scope_proposed", { ...base }).text).toContain("A scope change was proposed");
  });
  it("handles leadership, scope, completion and unknown types without inventing anything", () => {
    expect(describeNotification("project_assigned", { ...base, team: "Programming" }).text).toContain("head of the Programming team");
    expect(describeNotification("project_assigned", { ...base, acting_until: "2099-01-01" }).text).toContain("temporary project leadership");
    expect(describeNotification("project_scope_decision", { ...base, decision: "reject" }).text).toContain("rejected");
    expect(describeNotification("project_completed", base).text).toContain("was completed");
    expect(describeNotification("project_reopened", base).text).toContain("was reopened");
    expect(describeNotification("project_dates_changed", base).text).toContain("key dates");
    expect(describeNotification("project_something_new", {})).toEqual({ text: "A project update.", href: null });
  });
  it("describes Budget & Expenses events with money-free links for the right person", () => {
    expect(describeNotification("project_budget_submitted", { ...base, kind: "original" })).toEqual({ text: "UAE-P-2026-0001 Floor projection: a budget was submitted for Finance approval.", href: "/finance/project-budgets/p1" });
    expect(describeNotification("project_budget_submitted", { ...base, kind: "addition" }).text).toContain("a budget addition was submitted");
    expect(describeNotification("project_budget_decided", { ...base, kind: "original", decision: "returned" })).toMatchObject({ text: expect.stringContaining("returned for changes"), href: "/projects/p1/budget" });
    expect(describeNotification("project_budget_decided", { ...base, kind: "addition", decision: "approved" }).text).toContain("The additional budget was approved");
    expect(describeNotification("project_budget_decided", { ...base, kind: "original", decision: "rejected" }).text).toContain("rejected");
    expect(describeNotification("project_funding_recorded", { ...base, amount: 500, currency: "AED" }).text).toContain("AED 500");
    expect(describeNotification("project_actuals_submitted", base).href).toBe("/finance/project-budgets/p1");
    expect(describeNotification("project_actuals_decided", { ...base, decision: "approved" }).text).toContain("approved");
    expect(describeNotification("project_actuals_decided", { ...base, decision: "returned" }).text).toContain("returned for correction");
    expect(describeNotification("project_settlement_closed", base).text).toContain("closed the settlement");
  });
});

describe("equipment review and Operations planning notices", () => {
  // Fictional references.
  it("a changed date on a request with the warehouse: names the request and opens the project's Equipment tab", () => {
    expect(describeNotification("project_equipment_review", { project_id: "p1", request_id: "q1", request_code: "REQ-0101" })).toEqual({ text: "Review equipment booking: REQ-0101", href: "/projects/p1/equipment" });
    expect(describeNotification("project_equipment_review", {})).toEqual({ text: "Review equipment booking: an equipment request", href: null });
  });
  it("Sales flagged an enquiry, or answered a question: both open Upcoming Work", () => {
    expect(describeNotification("project_ops_enquiry_flagged", { opportunity_id: "o1", reference: "UAE-2027-0042" })).toEqual({ text: "Sales flagged UAE-2027-0042 for Operations planning", href: "/operations/upcoming" });
    expect(describeNotification("project_ops_sales_answered", { opportunity_id: "o1", reference: "UAE-2027-0042" })).toEqual({ text: "Sales answered your question on UAE-2027-0042", href: "/operations/upcoming" });
  });
  it("tells the outgoing Project Manager who took over and why", () => {
    const n = describeNotification("project_pm_changed", { project_id: "p1", name: "Fictional Expo stand", reference: "UAE-P-2027-0001", new_pm: "Rana Lead", reason: "Pat is on leave" });
    expect(n?.text).toContain("Rana Lead is now the Project Manager of");
    expect(n?.text).toContain("Reason: Pat is on leave");
    expect(n?.text).toContain("You stay on the project as a member.");
  });
  it("tells a crew member what moved, with the previous and new values and a link to their briefing", () => {
    const n = describeNotification("project_site_change", { ...base, title: "Setup", run_label: "Run 1", activity_id: "a7",
      changes: [{ field: "date", from: "11 Nov 2026", to: "12 Nov 2026" }, { field: "call time", from: "11 Nov 2026 07:30 Asia/Dubai", to: "12 Nov 2026 08:00 Asia/Dubai" }] });
    expect(n.text).toBe("Setup (Run 1) changed: date: 11 Nov 2026 → 12 Nov 2026; call time: 11 Nov 2026 07:30 Asia/Dubai → 12 Nov 2026 08:00 Asia/Dubai. Open your briefing.");
    expect(n.href).toBe("/site-assignments?activity=a7");
  });
});
