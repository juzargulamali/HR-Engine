import { describe, expect, it } from "vitest";
import { completeButOut, datesWord, decisions, equipmentLine, filterUpcoming, nextResponsible, pressure, riskReasons, topIssue, upcomingDelivery, type Overview, type OverviewProject, type RequestState, type UpcomingRow } from "./model";

const TODAY = "2027-02-20";
const req = (over: Partial<RequestState> = {}): RequestState => ({
  id: "q1", code: "UAE-R-00001", status: "submitted", state: "reserved", lines: 2, reserved_lines: 2, partial_lines: 0, short_lines: 0, short_buy: 0, short_rent: 0, short_no_plan: 0, dispatched_lines: 0,
  returned_lines: 0, units_asked: 6, units_short: 0, units_dispatched: 0, units_returned: 0, units_out: 0, needed_from: null, needed_until: null, expected_return_at: "2027-03-08T08:00:00Z", return_overdue: false, ...over,
});
const project = (over: Partial<OverviewProject> = {}): OverviewProject => ({
  id: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", kind: "client", status: "in_progress", pm_id: "u-pm", pm: "Pat Manager", chat_group_id: "g1", venue: "Expo Hall 4", install_start: "2027-02-26",
  event_start: "2027-03-01", event_end: "2027-03-05", edition: "Fictional Auto Expo · 2027 · Dubai", tasks_open: 4, tasks_overdue: 0, reviews_waiting: 0, reviews_overdue: 0, blockers: [], next_milestone: null,
  milestones_overdue: 0, corrections_open: 0, plan_changes_open: 0, plan_unreleased: 0, equipment: [], equipment_reviews: 0, release_failed: false, ...over,
});
const overview = (over: Partial<Overview> = {}): Overview => ({ company_id: "c1", taken_at: "2027-02-20T08:00:00Z", handovers: [], projects: [], overlaps: [], ...over });
const row = (over: Partial<UpcomingRow> = {}): UpcomingRow => ({
  id: "o1", company_id: "c1", reference: "UAE-O-2027-0007", title: "Expo stand for Fictional Motors", stage: "proposal_sent", owner_id: "u-s", owner: "Sam Sales", flagged_at: "2027-01-05T08:00:00Z", decision_date: "2027-01-15",
  dates_tentative: true, won: false, location: "Dubai", install_start: "2027-02-26", event_start: "2027-03-01", event_end: "2027-03-05", dismantle_date: null, edition: null, teams: [], equipment: [], to_confirm: null,
  note: null, planning: null, handover: null, ...over,
});

describe("Operations: Upcoming Work", () => {
  it("dates are tentative until Sales wins, whatever the tick says", () => {
    expect(datesWord(row())).toEqual({ text: "Tentative", tentative: true });
    expect(datesWord(row({ dates_tentative: false }))).toEqual({ text: "Dates confirmed by Sales; the enquiry is not won yet", tentative: false });
    expect(datesWord(row({ won: true, dates_tentative: true }))).toEqual({ text: "Confirmed: this enquiry is won", tentative: false });
  });

  it("names who has the next step, from the recorded state", () => {
    expect(nextResponsible(row())).toMatchObject({ who: "Operations", what: "Name a provisional Project Manager" });
    const planned = { provisional_pm_id: "u-pm", provisional_pm: "Pat Manager", risk: "low" as const, risk_note: null, capacity_conflict: false, capacity_note: null, question: null, question_at: null, question_by: null, answer: null, answered_at: null };
    expect(nextResponsible(row({ planning: planned }))).toEqual({ who: "Sales", person: "Sam Sales", what: "Decision expected 2027-01-15" });
    expect(nextResponsible(row({ planning: planned, decision_date: null })).what).toBe("Waiting for the client's decision (no date recorded)");
    expect(nextResponsible(row({ planning: planned, to_confirm: "Power drop" }))).toMatchObject({ who: "Sales", what: "Confirm the open details" });
    expect(nextResponsible(row({ planning: { ...planned, question: "Hall from the 25th?" } }))).toMatchObject({ who: "Sales", what: "Answer the question from Operations" });
    expect(nextResponsible(row({ planning: { ...planned, question: "Hall from the 25th?", answer: "Yes" } })).what).toBe("Decision expected 2027-01-15");
    expect(nextResponsible(row({ won: true }))).toMatchObject({ who: "Sales", what: "Prepare the handover" });
    expect(nextResponsible(row({ won: true, handover: { id: "h", status: "draft", submitted_at: null, pm: null, project_id: null } })).what).toBe("Submit the handover");
    expect(nextResponsible(row({ won: true, handover: { id: "h", status: "submitted", submitted_at: null, pm: null, project_id: null } }))).toMatchObject({ who: "Operations", what: "Assign a Project Manager" });
    expect(nextResponsible(row({ won: true, handover: { id: "h", status: "pm_assigned", submitted_at: null, pm: "Pat Manager", project_id: null } }))).toEqual({ who: "Project Manager", person: "Pat Manager", what: "Accept the handover" });
    expect(nextResponsible(row({ won: true, handover: { id: "h", status: "clarification_requested", submitted_at: null, pm: "Pat Manager", project_id: null } })).who).toBe("Sales");
  });

  it("filters by text, stage and who has the next step", () => {
    const rows = [row(), row({ id: "o2", reference: "UAE-O-2027-0009", title: "Mall roadshow", owner: "Rana Sales", won: true, stage: "won", edition: { event_name: "Gulf Tech", label: "Gulf Tech · 2027 · Riyadh", venue: null, city: "Riyadh", start_date: null, end_date: null } })];
    expect(filterUpcoming(rows, { q: "riyadh" }).map((r) => r.id)).toEqual(["o2"]);
    expect(filterUpcoming(rows, { q: "sam" }).map((r) => r.id)).toEqual(["o1"]);
    expect(filterUpcoming(rows, { stage: "won" }).map((r) => r.id)).toEqual(["o2"]);
    expect(filterUpcoming(rows, { stage: "open" }).map((r) => r.id)).toEqual(["o1"]);
    expect(filterUpcoming(rows, { next: "operations" }).map((r) => r.id)).toEqual(["o1"]);
    expect(filterUpcoming(rows, { next: "sales" }).map((r) => r.id)).toEqual(["o2"]);
    expect(filterUpcoming(rows, {})).toHaveLength(2);
  });
});

describe("Operations: Overview", () => {
  it("equipment is stated from the Inventory records: a buy or rent shortage is short, never reserved", () => {
    expect(equipmentLine(req())).toBe("UAE-R-00001: Reserved. 2 of 2 lines reserved.");
    expect(equipmentLine(req({ state: "partially_ready", reserved_lines: 1, short_lines: 1, short_buy: 1 }))).toBe("UAE-R-00001: Partly ready. 1 of 2 lines reserved. 1 line short (1 to buy).");
    expect(equipmentLine(req({ state: "short", reserved_lines: 0, short_lines: 2, short_rent: 1, short_no_plan: 1 }))).toBe("UAE-R-00001: Short. 0 of 2 lines reserved. 2 lines short (1 to rent, 1 with no plan yet).");
    expect(equipmentLine(req({ state: "still_out", reserved_lines: 0, dispatched_lines: 2, units_out: 3, return_overdue: true }))).toBe("UAE-R-00001: Still out. 0 of 2 lines reserved. 3 units out, due back 2027-03-08 (overdue).");
    expect(equipmentLine(req({ state: "dispatched", reserved_lines: 0, units_out: 1, expected_return_at: null }))).toContain("1 unit out, no return date recorded.");
  });

  it("needs my decision: an unassigned handover, a stalled one, a blocker, an installation at risk, a booking to review and a failed release, each with its owner and its screen", () => {
    const o = overview({
      handovers: [
        { id: "h1", sales_reference: "UAE-O-2027-0007", title: "Expo stand", status: "submitted", submitted_at: "2027-02-18T08:00:00Z", pm_id: null, pm: null, pm_assigned_at: null, install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null },
        { id: "h2", sales_reference: "UAE-O-2027-0003", title: "Old pending job", status: "pm_assigned", submitted_at: "2026-12-01T08:00:00Z", pm_id: "u", pm: "Pat Manager", pm_assigned_at: "2027-02-10T08:00:00Z", install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null },
        { id: "h3", sales_reference: "UAE-O-2027-0004", title: "Fresh assignment", status: "pm_assigned", submitted_at: "2027-02-19T08:00:00Z", pm_id: "u", pm: "Pat Manager", pm_assigned_at: "2027-02-19T08:00:00Z", install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null },
      ],
      projects: [project({
        blockers: [{ task_id: "t1", title: "Power drop", since: "2027-02-19T08:00:00Z", reason: "Venue has not confirmed", assignee: "Eli Engineer", unblock_owner: "Sam Sales", cross_team: true },
          { task_id: "t2", title: "Fresh own blocker", since: "2027-02-20T07:00:00Z", reason: null, assignee: "Eli Engineer", unblock_owner: null, cross_team: false }],
        equipment: [req({ state: "partially_ready", reserved_lines: 1, short_lines: 1, short_buy: 1 })], equipment_reviews: 1, tasks_overdue: 2,
      }), project({ id: "p2", reference: "UAE-P-2026-0090", name: "Finished show", status: "completed", install_start: "2026-12-01", event_start: "2026-12-05", event_end: "2026-12-06", release_failed: true })],
    });
    const items = decisions(o, TODAY);
    expect(items.map((d) => d.kind)).toEqual(["pm_unassigned", "handover_stalled", "blocker", "at_risk_installation", "equipment_review", "release_failed"]);
    expect(items[0]).toMatchObject({ owner: "Operations", href: "/projects/handovers?handover=h1", action: "Assign a Project Manager", date: "2027-02-18" });
    expect(items[1]).toMatchObject({ owner: "Pat Manager", href: "/projects/handovers?handover=h2" });
    expect(items[1]!.detail).toBe("Waiting 10 days for Pat Manager to accept.");
    expect(items[2]).toMatchObject({ owner: "Sam Sales", href: "/projects/p1/work?task=t1" });
    expect(items[2]!.detail).toContain('"Power drop" is blocked since 2027-02-19: Venue has not confirmed. Waiting on Sam Sales.');
    expect(items[3]!.detail).toBe("Installation starts 2027-02-26: equipment short on UAE-R-00001; 2 blocked tasks; 2 overdue tasks.");
    expect(items[4]).toMatchObject({ href: "/projects/p1/equipment", action: "Review equipment booking" });
    expect(items[5]).toMatchObject({ owner: "Warehouse", href: "/projects/p2/equipment" });
    expect(decisions(overview(), TODAY)).toEqual([]);
  });

  it("an installation is at risk only on recorded evidence and only inside the next 14 days", () => {
    expect(riskReasons(project(), TODAY)).toEqual([]);
    expect(riskReasons(project({ plan_unreleased: 3, milestones_overdue: 1, equipment: [req({ state: "draft", status: "draft" })] }), TODAY)).toEqual(["an equipment request has not been sent to the warehouse", "1 overdue milestone", "3 delivery plan lines not released to the teams"]);
    expect(riskReasons(project({ tasks_overdue: 5, install_start: "2027-04-20", event_start: "2027-04-22" }), TODAY)).toEqual([]);       // too far away to call it at risk
    expect(riskReasons(project({ tasks_overdue: 5, install_start: null, event_start: null }), TODAY)).toEqual([]);                        // no date recorded: nothing is inferred
    expect(riskReasons(project({ tasks_overdue: 5, status: "completed" }), TODAY)).toEqual([]);
  });

  it("delivery complete and equipment still out are separate facts, and such a project stays listed", () => {
    const done = project({ status: "completed", equipment: [req({ state: "still_out", units_out: 3, dispatched_lines: 2, reserved_lines: 0 })] });
    expect(completeButOut(done)).toBe(true);
    expect(completeButOut(project({ equipment: [req({ units_out: 3 })] }))).toBe(false);
    expect(topIssue(done, TODAY)).toBe("Delivery complete · equipment still out (3 units)");
    expect(upcomingDelivery(overview({ projects: [done, project({ id: "p3", status: "completed" })] })).map((p) => p.id)).toEqual(["p1"]);
    expect(topIssue(project(), TODAY)).toBeNull();
    expect(topIssue(project({ reviews_waiting: 2 }), TODAY)).toBe("2 tasks waiting for review");
    expect(upcomingDelivery(overview({ projects: [project({ id: "late", reference: "B", install_start: "2027-05-01" }), project({ id: "none", reference: "C", install_start: null, event_start: null }), project({ id: "soon", reference: "A" })] })).map((p) => p.id)).toEqual(["soon", "late", "none"]);
  });

  it("pressure lists only what is recorded: overlaps, overdue reviews, shortages, partial dispatch and overdue returns", () => {
    const o = overview({
      overlaps: [{ user_id: "u1", person: "Eli Engineer", a: "UAE-P-2027-0001", a_id: "p1", b: "UAE-P-2027-0002", b_id: "p2", from: "2027-03-01", to: "2027-03-05" }],
      projects: [project({ reviews_overdue: 2, equipment: [req({ state: "partially_dispatched", short_lines: 1, short_rent: 1, reserved_lines: 0, dispatched_lines: 1, units_out: 4, return_overdue: true })] })],
    });
    const p = pressure(o);
    expect(p.map((x) => x.kind)).toEqual(["overlap", "reviews_overdue", "shortage", "partial_dispatch", "overdue_return"]);
    expect(p[0]!.text).toBe("Eli Engineer is on UAE-P-2027-0001 and UAE-P-2027-0002, whose delivery dates overlap 2027-03-01 to 2027-03-05.");
    expect(p[3]!.text).toBe("UAE-P-2027-0001: UAE-R-00001 is partly dispatched (1 of 2 lines).");
    expect(p[4]!.text).toBe("UAE-P-2027-0001: 4 units from UAE-R-00001 due back 2027-03-08 and not returned.");
    expect(pressure(overview({ projects: [project()] }))).toEqual([]);
  });
});
