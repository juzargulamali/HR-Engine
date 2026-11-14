import { describe, expect, it } from "vitest";
import { activityWhen, deliveryByWeek, equipmentIssues, eventLine, groupEntries, headerDateText, healthCounts, installationsWithin, laterEntries, nextOnSite, passedEntries, projectHealth, readiness, splitDecisions, timeline, weekStart } from "./model";
import type { SiteActivityRead } from "@/lib/projects/phase2/model";
import type { SitePhaseInfo } from "@/lib/projects/site-state";
import { completeButOut, datesWord, decisions, equipmentLine, filterUpcoming, nextResponsible, pressure, riskReasons, topIssue, upcomingDelivery, type Overview, type OverviewProject, type RequestState, type UpcomingRow } from "./model";

const TODAY = "2027-02-20";
const req = (over: Partial<RequestState> = {}): RequestState => ({
  id: "q1", code: "UAE-R-00001", status: "submitted", state: "reserved", lines: 2, reserved_lines: 2, partial_lines: 0, short_lines: 0, short_buy: 0, short_rent: 0, short_no_plan: 0, dispatched_lines: 0,
  returned_lines: 0, units_asked: 6, units_short: 0, units_dispatched: 0, units_returned: 0, units_out: 0, needed_from: null, needed_until: null, expected_return_at: "2027-03-08T08:00:00Z", return_overdue: false, ...over,
});
const project = (over: Partial<OverviewProject> = {}): OverviewProject => ({
  id: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", kind: "client", status: "in_progress", pm_id: "u-pm", pm: "Pat Manager", chat_group_id: "g1", venue: "Expo Hall 4", install_start: "2027-02-26",
  event_start: "2027-03-01", event_end: "2027-03-05", edition: "Fictional Auto Expo · 2027 · Dubai", tasks_open: 4, tasks_overdue: 0, reviews_waiting: 0, reviews_overdue: 0, blockers: [], blockers_total: 0, next_milestone: null,
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
    expect(equipmentLine(req({ state: "still_out", reserved_lines: 0, dispatched_lines: 2, units_out: 3, return_overdue: true }))).toBe("UAE-R-00001: Still out. 3 units out, due back 2027-03-08 (overdue).");
    expect(equipmentLine(req({ state: "draft", status: "draft", reserved_lines: 0 }))).toBe("UAE-R-00001: Not sent to the warehouse yet. 2 lines on the draft, nothing reserved yet.");
    expect(equipmentLine(req({ state: "empty", lines: 0, reserved_lines: 0 }))).toBe("UAE-R-00001: No lines.");
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
    expect(items[3]!.detail).toBe("Installation planned 2027-02-26 (project header): equipment short on UAE-R-00001; 2 blocked tasks; 2 overdue tasks.");
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

describe("Operations: project health (rule-based, never a score)", () => {
  const blocker = { task_id: "t1", title: "Rig the truss", since: "2027-02-10T08:00:00Z", reason: null, assignee: "Riya", unblock_owner: null, cross_team: false };
  it("on track needs recorded dates and nothing recorded against the project; the evidence says what was checked", () => {
    const h = projectHealth(project({ install_start: "2027-06-01", event_start: "2027-06-03" }), TODAY);
    expect(h.health).toBe("on_track");
    expect(h.evidence).toEqual([{ text: "Dates are recorded; no blocker, shortage, overdue task, overdue milestone or booking review is recorded", href: "/projects/p1/work" }]);
  });
  it("no recorded date is 'not enough information', never on track", () => {
    const h = projectHealth(project({ install_start: null, event_start: null, event_end: null }), TODAY);
    expect(h).toEqual({ health: "not_enough_info", evidence: [{ text: "Neither an installation date nor a show date is recorded", href: "/projects/p1/work" }] });
  });
  it("needs attention: a blocker, a missing owner, a shortage, a booking review, an overdue task or milestone, equipment still out after completion", () => {
    const far = { install_start: "2027-06-01", event_start: "2027-06-03", event_end: "2027-06-05" };
    const texts = (p: OverviewProject) => { const h = projectHealth(p, TODAY); expect(h.health).toBe("needs_attention"); return h.evidence.map((e) => e.text); };
    expect(texts(project({ ...far, blockers: [blocker], blockers_total: 1 }))).toEqual(["Blocked since 2027-02-10: Rig the truss (nobody is named to unblock it)"]);
    expect(texts(project({ ...far, blockers: [{ ...blocker, unblock_owner: "Wael" }], blockers_total: 7 }))).toEqual(["Blocked since 2027-02-10: Rig the truss (waiting on Wael)", "6 more blocked tasks"]);
    expect(texts(project({ ...far, pm_id: null }))).toEqual(["No Project Manager is recorded"]);
    expect(texts(project({ ...far, equipment: [req({ state: "short", short_lines: 1, short_buy: 1 })] }))).toEqual(["Equipment short on UAE-R-00001: 1 line"]);
    expect(texts(project({ ...far, equipment_reviews: 2 }))).toEqual(["2 equipment bookings to review after a date change (with Pat Manager)"]);
    expect(texts(project({ ...far, tasks_overdue: 1, milestones_overdue: 2 }))).toEqual(["1 overdue task", "2 overdue milestones"]);
    expect(texts(project({ status: "completed", equipment: [req({ state: "still_out", units_out: 3 })] }))).toEqual(["Delivery complete, 3 units still out"]);
  });
  it("at risk: a recorded problem inside the 14 days, an unreleased reservation, or an overdue return; every reason links to its screen", () => {
    const h = projectHealth(project({ equipment: [req({ state: "short", short_lines: 1, short_rent: 1 })], plan_unreleased: 2, tasks_overdue: 1 }), TODAY);
    expect(h.health).toBe("at_risk");
    expect(h.evidence).toEqual([
      { text: "Installation planned 2027-02-26 (project header): equipment short on UAE-R-00001", href: "/projects/p1/equipment" },
      { text: "Installation planned 2027-02-26 (project header): 1 overdue task", href: "/projects/p1/work" },
      { text: "Installation planned 2027-02-26 (project header): 2 delivery plan lines not released to the teams", href: "/projects/p1/delivery" },
    ]);
    expect(projectHealth(project({ status: "completed", release_failed: true }), TODAY).health).toBe("at_risk");
    expect(projectHealth(project({ install_start: "2027-06-01", event_start: null, event_end: null, equipment: [req({ state: "still_out", units_out: 2, return_overdue: true })] }), TODAY)).toMatchObject({
      health: "at_risk", evidence: [{ text: "Equipment from UAE-R-00001 was due back 2027-03-08 and is not returned", href: "/projects/p1/equipment" }] });
    // the same shortage five months out is a thing to look at, not a risk to the date
    expect(projectHealth(project({ install_start: "2027-07-01", event_start: "2027-07-03", event_end: "2027-07-05", equipment: [req({ state: "short", short_lines: 1 })] }), TODAY).health).toBe("needs_attention");
  });
  it("counts the labels of live projects and of finished ones that still have something open, and nothing else", () => {
    const o = overview({ projects: [project(), project({ id: "p2", install_start: null, event_start: null }), project({ id: "p3", status: "completed" }), project({ id: "p4", status: "archived", release_failed: true })] });
    expect(healthCounts(o, TODAY)).toEqual({ on_track: 1, needs_attention: 0, at_risk: 1, not_enough_info: 1 });
  });
});

describe("Operations: the figures behind the summary cards", () => {
  it("readiness has a real denominator or is not drawn", () => {
    expect(readiness(project({ equipment: [req({ lines: 4, reserved_lines: 3, state: "partially_ready" }), req({ id: "q2", lines: 2, reserved_lines: 2 })] }))).toEqual({ ready: 5, total: 6 });
    expect(readiness(project())).toBeNull();                                                      // no request at all
    expect(readiness(project({ equipment: [req({ state: "draft" })] }))).toBeNull();              // nothing is with the warehouse yet
    expect(readiness(project({ equipment: [req({ state: "dispatched" })] }))).toBeNull();         // already out: "ready" no longer means anything
  });
  it("installations in the next 14 days: today counts, day 15 does not, finished and undated projects never do", () => {
    const o = overview({ projects: [project({ id: "a", install_start: "2027-02-20" }), project({ id: "b", install_start: "2027-03-06" }), project({ id: "c", install_start: "2027-03-07" }),
      project({ id: "d", install_start: "2027-02-19" }), project({ id: "e", install_start: null, event_start: "2027-02-22" }), project({ id: "f", status: "completed" }), project({ id: "g", install_start: null, event_start: null })] });
    expect(installationsWithin(o, TODAY).map((p) => [p.id, p.in_days, p.by])).toEqual([["a", 0, "installation"], ["e", 2, "show"], ["b", 14, "installation"]]);
  });
  it("equipment issues come from records, name their owner, and list an unsent request only inside the window", () => {
    const o = overview({ projects: [
      project({ equipment: [req({ state: "short", short_lines: 1, short_buy: 1 }), req({ id: "q2", code: "UAE-R-00002", state: "draft", needed_from: "2027-02-25", needed_until: "2027-03-06" })], equipment_reviews: 1 }),
      project({ id: "p2", reference: "UAE-P-2027-0002", install_start: "2027-08-01", event_start: null, event_end: null, equipment: [req({ id: "q3", state: "draft", needed_from: "2027-07-30", needed_until: "2027-08-05" })] }),
      project({ id: "p3", reference: "UAE-P-2027-0003", status: "completed", release_failed: true, equipment: [req({ id: "q4", state: "still_out", units_out: 2 })] }),
    ] });
    expect(equipmentIssues(o, TODAY).map((x) => [x.kind, x.project.split(" ")[0], x.owner])).toEqual([
      ["shortage", "UAE-P-2027-0001", "Warehouse"], ["release_failed", "UAE-P-2027-0003", "Warehouse"], ["booking_review", "UAE-P-2027-0001", "Pat Manager"],
      ["not_sent", "UAE-P-2027-0001", "Pat Manager"], ["still_out", "UAE-P-2027-0003", "Warehouse"]]);
    expect(equipmentIssues(overview({ projects: [project()] }), TODAY)).toEqual([]);
    // a partly dispatched request is listed with its dispatched and total lines and opens the Equipment tab
    expect(equipmentIssues(overview({ projects: [project({ equipment: [req({ state: "partially_dispatched", lines: 4, dispatched_lines: 1 })] })] }), TODAY)).toEqual([
      { kind: "partial_dispatch", key: "partial:q1", project: "UAE-P-2027-0001 Fictional Expo stand", text: "UAE-R-00001: 1 of 4 lines dispatched", owner: "Warehouse", href: "/projects/p1/equipment?request=q1", code: "UAE-R-00001", requestId: "q1", next: "Dispatch the remaining lines; open the request" }]);
    expect(equipmentIssues(overview({ projects: [project({ equipment: [req({ state: "dispatched", lines: 4, dispatched_lines: 4 })] })] }), TODAY)).toEqual([]);
  });
  it("a draft request with no planning dates is listed even far ahead, links the exact request, and names the next action", () => {
    const far = project({ install_start: "2027-08-01", event_start: null, event_end: null, equipment: [req({ id: "q5", code: "UAE-R-00005", state: "draft", needed_from: null, needed_until: null })] });
    const [issue] = equipmentIssues(overview({ projects: [far] }), TODAY);
    expect(issue).toMatchObject({ kind: "not_sent", code: "UAE-R-00005", requestId: "q5", href: "/projects/p1/equipment?request=q5", owner: "Pat Manager", next: "Set planning dates before submitting to Warehouse" });
    expect(issue!.text).toContain("planning dates are not set");
    // with its dates set it is not an issue far ahead, and inside the window the next step is to submit
    const dated = project({ equipment: [req({ id: "q6", state: "draft", needed_from: "2027-02-25", needed_until: "2027-03-06" })] });
    expect(equipmentIssues(overview({ projects: [dated] }), TODAY)[0]).toMatchObject({ kind: "not_sent", next: "Submit to Warehouse" });
    expect(equipmentIssues(overview({ projects: [{ ...far, equipment: [{ ...far.equipment[0]!, needed_from: "2027-07-30", needed_until: "2027-08-05" }] }] }), TODAY)).toEqual([]);
  });
  it("the week chart and its list are the same records: every live project is in exactly one bucket", () => {
    expect(weekStart("2027-02-20")).toBe("2027-02-15");                                           // a Saturday belongs to the week that began on Monday
    const o = overview({ projects: [project({ id: "a" }), project({ id: "b", install_start: "2027-02-16" }), project({ id: "c", install_start: "2027-02-10" }), project({ id: "d", install_start: "2027-06-01" }),
      project({ id: "e", install_start: null, event_start: null }), project({ id: "f", status: "completed" })] });
    const weeks = deliveryByWeek(o, TODAY);
    expect(weeks.map((w) => [w.key, w.label, w.projects.map((p) => p.id)])).toEqual([
      ["passed", "Date passed · start unconfirmed", ["c"]], ["2027-02-15", "This week", ["b"]], ["2027-02-22", "Next week", ["a"]], ["2027-03-01", "Week of 2027-03-01", []], ["2027-03-08", "Week of 2027-03-08", []],
      ["2027-03-15", "Week of 2027-03-15", []], ["2027-03-22", "Week of 2027-03-22", []], ["later", "Later", ["d"]], ["none", "No date recorded", ["e"]]]);
    expect(weeks.reduce((a, w) => a + w.projects.length, 0)).toBe(5);
    expect(deliveryByWeek(overview(), TODAY).every((w) => w.projects.length === 0)).toBe(true);
  });
  it("the timeline keeps installation, show and dismantling apart, marks an enquiry tentative until won, and drops what has a project", () => {
    const o = overview({ projects: [project()] });
    const enquiry = row({ install_start: "2027-03-10", event_start: "2027-03-12", event_end: "2027-03-14", dismantle_date: "2027-03-15" });
    expect(timeline(o, [enquiry], TODAY).map((e) => [e.date, e.kind, e.tentative, e.title.split(" ")[0]])).toEqual([
      ["2027-02-26", "installation", false, "UAE-P-2027-0001"], ["2027-03-01", "show", false, "UAE-P-2027-0001"],
      ["2027-03-10", "installation", true, "UAE-O-2027-0007"], ["2027-03-12", "show", true, "UAE-O-2027-0007"], ["2027-03-15", "dismantling", true, "UAE-O-2027-0007"]]);
    expect(timeline(o, [{ ...enquiry, won: true }], TODAY).filter((e) => e.tentative)).toEqual([]);
    expect(timeline(o, [{ ...enquiry, dates_tentative: false }], TODAY).filter((e) => e.tentative)).toEqual([]);   // Sales confirmed the dates: the same word as on the Upcoming Work card
    expect(timeline(o, [{ ...enquiry, handover: { id: "h", status: "accepted", submitted_at: null, pm: "Pat Manager", project_id: "p1" } }], TODAY)).toHaveLength(2);
    expect(timeline(o, null, TODAY)).toHaveLength(2);                                             // enquiries not loaded: the project dates still show
    expect(timeline(overview({ projects: [project({ install_start: "2027-04-30", event_start: "2027-05-02", event_end: "2027-05-04" })] }), [], TODAY)).toEqual([]);
    // a show that is under way is still on the timeline
    expect(timeline(overview({ projects: [project({ install_start: "2027-02-10", event_start: "2027-02-18", event_end: "2027-02-22" })] }), [], TODAY).map((e) => e.kind)).toEqual(["show"]);
  });
  it("names the event and venue of a flagged enquiry, falling back to its own title and place", () => {
    expect(eventLine(row())).toEqual({ event: "Expo stand for Fictional Motors", venue: "Dubai" });
    expect(eventLine(row({ edition: { event_name: "Fictional Auto Expo", label: "Fictional Auto Expo · 2027", venue: "Expo Hall 4", city: "Dubai", start_date: null, end_date: null } }))).toEqual({ event: "Fictional Auto Expo · 2027", venue: "Expo Hall 4, Dubai" });
    expect(eventLine(row({ location: null })).venue).toBeNull();
  });
});


// ---- the same site activities everywhere ------------------------------------------------------------------------------------------------------------------------------
const phase = (over: Partial<SitePhaseInfo> = {}): SitePhaseInfo => ({ phase: "scheduled", basis: "activity", first_day: "2027-02-24", last_day: "2027-02-24", started_at: null, kind: "setup", state: "tentative", today: TODAY, ...over });
const act = (over: Partial<SiteActivityRead> & { ph?: Partial<SitePhaseInfo> } = {}): SiteActivityRead => {
  const { ph, ...rest } = over;
  return {
    id: "a1", project_id: "p1", reference: "UAE-P-2027-0001", project_name: "Fictional Expo stand", project_status: "in_progress", title: "Hall 4 installation", kind: "setup", run_label: "Run 1", state: "tentative",
    start_date: "2027-02-24", end_date: null, starts_at: null, ends_at: null, tz: "Asia/Dubai",
    effective: { venue: "Expo Hall 4", venue_source: "activity", start_date: "2027-02-24", end_date: null, date_source: "activity", choice_pending: false, project_start: null, project_end: null },
    phase: phase(ph), owner_name: "Eli Engineer", crew_total: 0, call_missing: 0, actual_started_at: null, ...rest,
  };
};

describe("Operations: one site activity, told the same way", () => {
  it("a project that has dated activities gets no header installation row; each activity appears once, linking to its exact row", () => {
    const o = overview({ projects: [project()] });
    const acts = [act(), act({ id: "a2", title: "Hall 4 dismantling", kind: "dismantling", start_date: "2027-03-08", ph: { first_day: "2027-03-08", last_day: "2027-03-08", kind: "dismantling" } })];
    const all = timeline(o, null, TODAY, 30, acts);
    expect(all.filter((e) => e.source === "project_header" && e.kind === "installation")).toEqual([]);
    expect(all.map((e) => e.activityId).filter(Boolean)).toEqual(["a1", "a2"]);
    expect(new Set(all.map((e) => e.key)).size).toBe(all.length);
    expect(all.find((e) => e.activityId === "a1")!.href).toBe("/projects/p1/plan?plan=site&mode=list#site-a1");
    // the header SHOW date is still listed only while no show activity carries it, and says it is a header date
    expect(all.filter((e) => e.source === "project_header").map((e) => [e.kind, e.statusLabel])).toEqual([["show", "Show date (from the project header)"]]);
    // a project with no activity falls back to its header and says so
    const fallback = timeline(o, null, TODAY, 30, []);
    expect(fallback.map((e) => [e.kind, e.source, e.statusLabel])).toEqual([["installation", "project_header", "Installation date (from the project header)"], ["show", "project_header", "Show date (from the project header)"]]);
    // an activity read that is unavailable is the same fallback
    expect(timeline(o, null, TODAY, 30, null).map((e) => e.source)).toEqual(["project_header", "project_header"]);
  });
  it("a tentative Sales row is dropped once the enquiry has a project, and is labelled as a Sales date before", () => {
    const o = overview({ projects: [project({ install_start: null, event_start: null, event_end: null })] });
    const enquiry = row({ install_start: "2027-03-10", event_start: "2027-03-12", event_end: "2027-03-14", dismantle_date: "2027-03-15" });
    expect(timeline(o, [enquiry], TODAY, 30, []).map((e) => e.statusLabel)).toEqual(["Sales date · tentative", "Sales date · tentative", "Sales date · tentative"]);
    expect(timeline(o, [{ ...enquiry, handover: { id: "h", status: "accepted", submitted_at: null, pm: "Pat Manager", project_id: "p1" } }], TODAY, 30, [])).toEqual([]);
    expect(timeline(o, [{ ...enquiry, handover: { id: "h", status: "accepted", submitted_at: null, pm: "Pat Manager", project_id: null } }], TODAY, 30, [])).toEqual([]);
    expect(timeline(o, [{ ...enquiry, won: true }], TODAY, 30, [])[0]!.statusLabel).toBe("Sales date · enquiry won");
  });
  it("a date that has passed is never 'started': only an explicit record is", () => {
    const o = overview({ projects: [project({ install_start: "2027-02-10", event_start: "2027-03-01", event_end: "2027-03-05" })] });
    const passed = act({ ph: { phase: "date_passed", first_day: "2027-02-10", last_day: "2027-02-10" }, start_date: "2027-02-10" });
    const [e] = passedEntries(o, [passed], TODAY);
    expect(e).toMatchObject({ passed: true, started: false, statusLabel: "Scheduled installation date passed · start unconfirmed" });
    expect(e!.statusLabel).not.toMatch(/started \d|Installation started|The show started/);
    // a header date that has passed says the same, and is listed for a project with no activity
    const [h] = passedEntries(o, [], TODAY);
    expect(h).toMatchObject({ source: "project_header", passed: true, started: false, statusLabel: "Scheduled installation date passed · start unconfirmed" });
    expect(headerDateText({ install_start: "2027-02-10", event_start: null }, TODAY)!.lead).toBe("Scheduled installation date passed · start unconfirmed (2027-02-10, project header)");
    expect(headerDateText({ install_start: "2027-02-26", event_start: null }, TODAY)!.lead).toBe("Installation planned 2027-02-26 (project header)");
    // a recorded start is the only thing that reads as started
    const started = act({ actual_started_at: "2027-02-12T07:00:00Z", ph: { phase: "started", first_day: "2027-02-10", last_day: "2027-02-26", started_at: "2027-02-12T07:00:00Z" } });
    const entries = timeline(o, null, TODAY, 30, [started]);
    expect(entries.find((x) => x.activityId === "a1")).toMatchObject({ started: true, passed: false, statusLabel: "Installation started 12 Feb" });
    expect(passedEntries(o, [started], TODAY)).toEqual([]);
    // the week chart and the decision text never say started from a date either
    expect(deliveryByWeek(o, TODAY).map((w) => w.label)).not.toContain("Already started");
    const at = decisions(overview({ projects: [project({ install_start: "2027-02-10", equipment: [req({ state: "short", short_lines: 1 })] })] }), TODAY).find((d) => d.kind === "at_risk_installation")!;
    expect(at.detail).toMatch(/^Scheduled installation date passed · start unconfirmed/);
    expect(at.detail).not.toMatch(/started 20|Installation started|The show started/);
  });
  it("Next on site is the activities inside 14 days plus those with a passed date; the timeline holds the rest, so no activity is in both", () => {
    const o = overview({ projects: [project({ install_start: null, event_start: null, event_end: null })] });
    const acts = [
      act({ id: "late", title: "Overdue date", ph: { phase: "date_passed", first_day: "2027-02-10", last_day: "2027-02-10" } }),
      act({ id: "soon", title: "This week" }),
      act({ id: "far", title: "Next month", ph: { first_day: "2027-03-12", last_day: "2027-03-12" } }),
      act({ id: "beyond", title: "Too far", ph: { first_day: "2027-05-12", last_day: "2027-05-12" } }),
      act({ id: "none", title: "No date", ph: { phase: "no_date", first_day: null, last_day: null, basis: "none" } }),
    ];
    const next = nextOnSite(o, acts, TODAY);
    const later = laterEntries(o, [], acts, TODAY);
    expect(next.map((e) => e.activityId)).toEqual(["late", "soon"]);
    expect(later.map((e) => e.activityId)).toEqual(["far"]);
    expect([...next, ...later].map((e) => e.activityId).filter((id, i, all) => all.indexOf(id) !== i)).toEqual([]);
  });
  it("installation, show and dismantling of one enquiry or one run share one row", () => {
    const o = overview({ projects: [project()] });
    const acts = [act({ id: "i1", title: "Install", ph: { first_day: "2027-02-24", last_day: "2027-02-24" } }), act({ id: "s1", title: "Show", kind: "show", ph: { kind: "show", first_day: "2027-02-27", last_day: "2027-02-28" } }),
      act({ id: "r2", title: "Install run 2", run_label: "Run 2", ph: { first_day: "2027-03-10", last_day: "2027-03-10" } })];
    const groups = groupEntries(timeline(o, null, TODAY, 30, acts));
    expect(groups.map((g) => [g.title, g.entries.map((e) => e.activityId)])).toEqual([
      ["UAE-P-2027-0001 Fictional Expo stand · Run 1", ["i1", "s1"]], ["UAE-P-2027-0001 Fictional Expo stand · Run 2", ["r2"]]]);   // two runs stay distinct
    const enquiry = row({ install_start: "2027-03-10", event_start: "2027-03-12", event_end: "2027-03-14", dismantle_date: "2027-03-15" });
    const sales = groupEntries(timeline(overview(), [enquiry], TODAY, 30, []));
    expect(sales).toHaveLength(1);
    expect(sales[0]!.entries.map((e) => e.kind)).toEqual(["installation", "show", "dismantling"]);
    expect(sales[0]!.tentative).toBe(true);
  });
  it("says a time window as a time, and a date range as dates", () => {
    expect(activityWhen(act({ starts_at: "2027-02-24T05:00:00Z", ends_at: "2027-02-24T13:00:00Z" }))).toBe("24 Feb, 09:00–17:00");
    expect(activityWhen(act({ ph: { first_day: "2027-02-24", last_day: "2027-02-26" } }))).toBe("24 Feb to 26 Feb");
  });
});

describe("Operations: decisions assigned to me, follow-ups with a named owner", () => {
  it("the viewer's own decisions lead; the rest are follow-ups that name who they wait on", () => {
    const o = overview({
      handovers: [{ id: "h1", sales_reference: "UAE-O-2027-0007", title: "Expo stand", status: "submitted", submitted_at: "2027-02-18T08:00:00Z", pm_id: null, pm: null, pm_assigned_at: null, install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null }],
      projects: [project({ equipment_reviews: 1 })],
      output_reviews: [{ version_id: "v1", task_id: "t1", project_id: "p1", reference: "UAE-P-2027-0001", project: "Fictional Expo stand", task: "Stage render", label: "Render", version_no: 2, attached_at: "2027-02-19T08:00:00Z", submitted_by_id: "u-pm", submitted_by: "Pat Manager",
        assignee_id: "u-eli", assignee: "Eli Engineer", reviewer_id: "u-me", reviewer: "Rana Operations", needs_reviewer: false, pm: "Pat Manager" }],
    });
    const items = decisions(o, TODAY, "u-me");
    expect(items.map((d) => [d.kind, d.mine])).toEqual([["output_review", true], ["pm_unassigned", false], ["equipment_review", false]]);
    expect(items[0]).toMatchObject({ href: "/projects/p1/work?task=t1&version=v1", owner: "Rana Operations" });
    const { mine, followUps } = splitDecisions(items);
    expect(mine).toHaveLength(1);
    expect(followUps.every((d) => d.owner.length > 0)).toBe(true);
    expect(followUps.find((d) => d.kind === "equipment_review")!.owner).toBe("Pat Manager");
    // the project manager sees their own booking review first
    expect(decisions(o, TODAY, "u-pm")[0]).toMatchObject({ kind: "equipment_review", mine: true });
    // without a viewer nothing is "mine"
    expect(splitDecisions(decisions(o, TODAY)).mine).toEqual([]);
  });
});

describe("Operations: team pressure shows both commitments", () => {
  const two = overview({
    projects: [project(), project({ id: "p2", reference: "UAE-P-2027-0002", name: "Fictional Motors launch", install_start: "2027-02-24", event_start: "2027-02-26", event_end: "2027-02-27" })],
    overlaps: [{ user_id: "u-t", person: "Tariq Technician", a: "UAE-P-2027-0001", a_id: "p1", b: "UAE-P-2027-0002", b_id: "p2", from: "2027-02-26", to: "2027-02-27" }],
  });
  it("a person on two projects lists the activity (or header window) on each side with its project and dates", () => {
    const acts = [act({ id: "x1", title: "Hall 4 installation", state: "confirmed", ph: { first_day: "2027-02-26", last_day: "2027-02-27", state: "confirmed" }, start_date: "2027-02-26", end_date: "2027-02-27" }),
      act({ id: "x2", project_id: "p2", reference: "UAE-P-2027-0002", project_name: "Fictional Motors launch", title: "Stage rigging", state: "confirmed", starts_at: "2027-02-26T05:00:00Z", ends_at: "2027-02-26T13:00:00Z", start_date: null, ph: { first_day: "2027-02-26", last_day: "2027-02-26", state: "confirmed" } })];
    const [item] = pressure(two, acts).filter((x) => x.kind === "overlap");
    expect(item!.commitments).toEqual([
      { project: "UAE-P-2027-0001 Fictional Expo stand", title: "Hall 4 installation", when: "26 Feb to 27 Feb", href: "/projects/p1/plan?plan=site&mode=list#site-x1", source: "activity" },
      { project: "UAE-P-2027-0002 Fictional Motors launch", title: "Stage rigging", when: "26 Feb, 09:00–17:00", href: "/projects/p2/plan?plan=site&mode=list#site-x2", source: "activity" }]);
    // with no activity read, each side is its header window and says so
    const [plain] = pressure(two, null).filter((x) => x.kind === "overlap");
    expect(plain!.commitments!.map((c) => [c.title, c.source])).toEqual([["Project delivery window (from the project header)", "project_header"], ["Project delivery window (from the project header)", "project_header"]]);
  });
  it("two confirmed crewed activities of different projects that overlap are listed once, with both commitments; tentative, uncrewed and same-project ones are not", () => {
    const o = overview({ projects: [project(), project({ id: "p2", reference: "UAE-P-2027-0002", name: "Fictional Motors launch" })] });
    const mk = (id: string, pid: string, ref: string, over: Partial<SiteActivityRead> = {}) => act({ id, project_id: pid, reference: ref, state: "confirmed", crew_total: 2, ph: { state: "confirmed", first_day: "2027-03-02", last_day: "2027-03-02" }, start_date: "2027-03-02", ...over });
    const a = mk("c1", "p1", "UAE-P-2027-0001", { title: "Hall 4 installation" }); const b = mk("c2", "p2", "UAE-P-2027-0002", { title: "Stage rigging" });
    const items = pressure(o, [a, b]).filter((x) => x.kind === "crew_overlap");
    expect(items).toHaveLength(1);
    expect(items[0]!.commitments!.map((c) => c.title)).toEqual(["Hall 4 installation", "Stage rigging"]);
    expect(items[0]!.text).toContain("Check on the Site schedule whether the same people are on both");
    expect(pressure(o, [a, { ...b, state: "tentative" }]).filter((x) => x.kind === "crew_overlap")).toEqual([]);
    expect(pressure(o, [a, { ...b, crew_total: 0 }]).filter((x) => x.kind === "crew_overlap")).toEqual([]);
    expect(pressure(o, [a, { ...b, project_id: "p1" }]).filter((x) => x.kind === "crew_overlap")).toEqual([]);
    // a time window that does not overlap is not a clash, even on the same day
    expect(pressure(o, [{ ...a, starts_at: "2027-03-02T05:00:00Z", ends_at: "2027-03-02T08:00:00Z" }, { ...b, starts_at: "2027-03-02T09:00:00Z", ends_at: "2027-03-02T12:00:00Z" }]).filter((x) => x.kind === "crew_overlap")).toEqual([]);
  });
});
