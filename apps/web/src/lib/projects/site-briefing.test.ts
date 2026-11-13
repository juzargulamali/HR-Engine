import { describe, expect, it } from "vitest";
import { EFFECTIVE_LABELS, effectiveReadyText, gapText, READY_LABELS, type SiteBriefing } from "@/lib/projects/phase2/model";
import { assignmentWhen, callWord, venueWord, type SiteAssignment } from "@/lib/projects/site-assignments";

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
