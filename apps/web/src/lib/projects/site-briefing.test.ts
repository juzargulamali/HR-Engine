import { describe, expect, it } from "vitest";
import { EFFECTIVE_LABELS, effectiveReadyText, gapText, READY_LABELS, type SiteBriefing } from "@/lib/projects/phase2/model";
import { assignmentWhen, callWord, contactWord, needsProvisionalNote, projectReadyText, reportingText, siteChangesByActivity, venueWord, type SiteAssignment } from "@/lib/projects/site-assignments";

const base = {
  assignment_id: "a", activity_id: "x", project_name: "Fictional job", title: "Setup", run_label: null, kind: "setup", state: "tentative", role: "installation", location: null,
  start_date: null, end_date: null, starts_at: null, ends_at: null, tz: "Asia/Dubai", call_at: null, call_tz: null, instructions: null, crew_instructions: null,
  ready: { hardware: "unknown", content: "unknown", app: "unknown", note: null }, hardware_state: null, site_only: true,
} as SiteAssignment;

describe("the crew card words", () => {
  it("says Not applicable and Not recorded differently, and where a value came from", () => {
    expect(READY_LABELS.unknown).toBe("Not recorded");
    expect(READY_LABELS.not_applicable).toBe("Not applicable");
    expect(effectiveReadyText({ state: "not_recorded", source: null })).toBe("Not recorded");
    expect(effectiveReadyText({ state: "not_applicable", source: "pm" })).toBe("Not applicable (set by hand)");
    expect(effectiveReadyText({ state: "not_applicable", source: "plan", detail: "Nothing of this kind in the Project Plan" })).toBe("Not applicable (nothing of this kind in the Project Plan, from the Project Plan)");
    expect(effectiveReadyText({ state: "not_ready", source: "plan", detail: "1 of 2 ready" })).toBe("Not ready (1 of 2 ready, from the Project Plan)");
    expect(effectiveReadyText({ state: "not_ready", source: "run", detail: "0 of 1 ready" })).toBe("Not ready (0 of 1 ready, linked to this run)");
    expect(Object.values(EFFECTIVE_LABELS)).toEqual(["Ready", "Not ready", "Not applicable", "Not recorded"]);
  });
  it("a call time is explicit: nothing is invented, and the person is told it is still to come", () => {
    expect(callWord(base)).toMatch(/Not set yet/);
    expect(callWord({ ...base, call_at: "2027-01-05T03:30:00Z" })).toMatch(/07:30/);
  });
  it("the venue is the activity's own, else the project's (and says so), else not recorded", () => {
    expect(venueWord(base)).toBe("Not recorded yet");
    expect(venueWord({ ...base, location: "Hall 3" })).toBe("Hall 3");
    expect(venueWord({ ...base, effective: { venue: "Expo Centre", venue_source: "project", start_date: null, end_date: null, date_source: null, choice_pending: false, project_start: null, project_end: null } })).toBe("Expo Centre (the project's venue)");
  });
  it("the date comes from the project only when the database says it is unambiguous, and says so", () => {
    expect(assignmentWhen(base)).toMatch(/Date not set yet/);
    const eff = { venue: null, venue_source: null, start_date: "2027-01-12", end_date: "2027-01-12", date_source: "project" as const, choice_pending: false, project_start: "2027-01-12", project_end: "2027-01-12" };
    expect(assignmentWhen({ ...base, effective: eff })).toMatch(/12 Jan 2027.*from the project dates/);
    expect(assignmentWhen({ ...base, effective: { ...eff, start_date: null, date_source: null, choice_pending: true } })).not.toMatch(/from the project dates/);
  });
});

describe("what the Project Manager is told is missing", () => {
  const b = { id: "x", crew_total: 3, call_missing: 2, candidates: [], gaps: [], effective: { project_start: "2027-01-12" }, ready: { hardware: { state: "not_recorded" }, content: { state: "ready" }, app: { state: "not_recorded" } } } as unknown as SiteBriefing;
  it("names each gap in plain words", () => {
    expect(gapText("venue", b, "Setup")).toMatch(/No venue/);
    expect(gapText("call_time", b, "Setup")).toBe("2 of 3 without a call time");
    expect(gapText("readiness", b, "Setup")).toBe("Readiness not recorded: hardware, app");
    expect(gapText("choose_run", b, "Setup / installation")).toMatch(/setup \/ installation date is 2027-01-12: choose which run/);
  });
});

describe("the crew card's status words", () => {
  it("names who to ask and what is still to come", () => {
    expect(contactWord(base)).toBeNull();
    expect(contactWord({ ...base, contact: { name: "Fictional Eli", role: "Site lead" } })).toBe("Site lead: Fictional Eli");
    expect(contactWord({ ...base, contact: { name: null, role: "Project Manager" } })).toBe("Project Manager: not named yet");
    expect(reportingText({ ...base, reporting: { complete: false, missing: ["date", "venue", "call_time"] } }).text).toBe("Still to come: the date, the venue, your call time");
    expect(reportingText({ ...base, reporting: { complete: true, missing: [] } }).complete).toBe(true);
  });
  it("the provisional note is only for a TENTATIVE assignment whose date passed with details missing", () => {
    const passed = { phase: "date_passed", basis: "activity", first_day: "2027-11-11", last_day: "2027-11-11", started_at: null, kind: "setup", state: "tentative", today: "2027-11-20" } as const;
    expect(needsProvisionalNote({ ...base, phase: passed, reporting: { complete: false, missing: ["venue"] } })).toBe(true);
    expect(needsProvisionalNote({ ...base, phase: passed, reporting: { complete: true, missing: [] } })).toBe(false);
    expect(needsProvisionalNote({ ...base, state: "confirmed", phase: { ...passed, state: "confirmed" }, reporting: { complete: false, missing: ["venue"] } })).toBe(false);
    expect(needsProvisionalNote({ ...base, phase: { ...passed, phase: "scheduled" }, reporting: { complete: false, missing: ["venue"] } })).toBe(false);
  });
  it("project-wide readiness is one labelled line, absent when the database sent no project block", () => {
    expect(projectReadyText(undefined)).toBeNull();
    expect(projectReadyText({ hardware: { state: "not_recorded", source: null }, content: { state: "not_recorded", source: null }, app: { state: "not_recorded", source: null } })).toBeNull();
    expect(projectReadyText({ hardware: { state: "not_recorded", source: null }, content: { state: "not_recorded", source: null }, app: { state: "not_recorded", source: null }, project: { hardware: { state: "ready", detail: "2 of 2 ready" }, content: { state: "not_applicable" }, app: { state: "not_recorded" } } }))
      .toBe("Project-wide readiness: hardware ready (2 of 2 ready), content not applicable, app not recorded");
  });
  it("groups unread change notices by activity and ignores anything malformed", () => {
    const got = siteChangesByActivity([
      { payload: { activity_id: "a", changes: [{ field: "date", from: "A", to: "B" }] } }, { payload: { activity_id: "a", changes: [{ field: "venue", from: "X", to: "Y" }, { field: 1 }] } },
      { payload: { activity_id: 7, changes: [] } }, { payload: null }, { payload: { activity_id: "b", changes: "no" } }]);
    expect(got).toEqual({ a: [{ field: "date", from: "A", to: "B" }, { field: "venue", from: "X", to: "Y" }] });
  });
});
