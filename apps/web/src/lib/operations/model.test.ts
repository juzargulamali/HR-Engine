import { describe, expect, it } from "vitest";
import { deliveryByWeek, equipmentIssues, eventLine, healthCounts, installationsWithin, projectHealth, readiness, timeline, weekStart } from "./model";
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
      { text: "Installation starts 2027-02-26: equipment short on UAE-R-00001", href: "/projects/p1/equipment" },
      { text: "Installation starts 2027-02-26: 1 overdue task", href: "/projects/p1/work" },
      { text: "Installation starts 2027-02-26: 2 delivery plan lines not released to the teams", href: "/projects/p1/delivery" },
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
      project({ equipment: [req({ state: "short", short_lines: 1, short_buy: 1 }), req({ id: "q2", code: "UAE-R-00002", state: "draft" })], equipment_reviews: 1 }),
      project({ id: "p2", reference: "UAE-P-2027-0002", install_start: "2027-08-01", event_start: null, event_end: null, equipment: [req({ id: "q3", state: "draft" })] }),
      project({ id: "p3", reference: "UAE-P-2027-0003", status: "completed", release_failed: true, equipment: [req({ id: "q4", state: "still_out", units_out: 2 })] }),
    ] });
    expect(equipmentIssues(o, TODAY).map((x) => [x.kind, x.project.split(" ")[0], x.owner])).toEqual([
      ["shortage", "UAE-P-2027-0001", "Warehouse"], ["release_failed", "UAE-P-2027-0003", "Warehouse"], ["booking_review", "UAE-P-2027-0001", "Pat Manager"],
      ["not_sent", "UAE-P-2027-0001", "Pat Manager"], ["still_out", "UAE-P-2027-0003", "Warehouse"]]);
    expect(equipmentIssues(overview({ projects: [project()] }), TODAY)).toEqual([]);
  });
  it("the week chart and its list are the same records: every live project is in exactly one bucket", () => {
    expect(weekStart("2027-02-20")).toBe("2027-02-15");                                           // a Saturday belongs to the week that began on Monday
    const o = overview({ projects: [project({ id: "a" }), project({ id: "b", install_start: "2027-02-16" }), project({ id: "c", install_start: "2027-02-10" }), project({ id: "d", install_start: "2027-06-01" }),
      project({ id: "e", install_start: null, event_start: null }), project({ id: "f", status: "completed" })] });
    const weeks = deliveryByWeek(o, TODAY);
    expect(weeks.map((w) => [w.key, w.label, w.projects.map((p) => p.id)])).toEqual([
      ["started", "Already started", ["c"]], ["2027-02-15", "This week", ["b"]], ["2027-02-22", "Next week", ["a"]], ["2027-03-01", "Week of 2027-03-01", []], ["2027-03-08", "Week of 2027-03-08", []],
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
