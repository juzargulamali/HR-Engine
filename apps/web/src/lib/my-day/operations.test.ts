import { describe, expect, it } from "vitest";
import { buildAttention, ok, projectDecisionCandidates } from "./attention";
import { equipmentReviewCandidates, opsAnswerCandidates, opsCandidatesFailed, opsDaySummary, OPS_ANSWER_DAYS, type OpsCompanyRead, type OpsDay } from "./operations";
import type { Overview, OverviewProject, UpcomingRow } from "@/lib/operations/model";

const TODAY = "2027-02-20";
const NOW = new Date("2027-02-20T08:00:00Z");
const project = (over: Partial<OverviewProject> = {}): OverviewProject => ({
  id: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", kind: "client", status: "in_progress", pm_id: "u-pm", pm: "Pat Manager", chat_group_id: null, venue: null, install_start: "2027-02-26", event_start: "2027-03-01",
  event_end: "2027-03-05", edition: null, tasks_open: 2, tasks_overdue: 0, reviews_waiting: 0, reviews_overdue: 0, blockers: [], blockers_total: 0, next_milestone: null, milestones_overdue: 0, corrections_open: 0,
  plan_changes_open: 0, plan_unreleased: 0, equipment: [], equipment_reviews: 0, release_failed: false, ...over,
});
const handover = (id: string): Overview["handovers"][number] => ({ id, sales_reference: "UAE-O-2027-0002", title: "Mall roadshow", status: "submitted", submitted_at: "2027-02-18T08:00:00Z", pm_id: null, pm: null, pm_assigned_at: null, install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null });
const overview = (over: Partial<Overview> = {}): Overview => ({ company_id: "c1", taken_at: "2027-02-20T08:00:00Z", handovers: [], projects: [], overlaps: [], ...over });
const row = (over: Partial<UpcomingRow> = {}): UpcomingRow => ({
  id: "o1", company_id: "c1", reference: "UAE-O-2027-0007", title: "Expo stand for Fictional Motors", stage: "proposal_sent", owner_id: "u-s", owner: "Sam Sales", flagged_at: "2027-01-05T08:00:00Z", decision_date: null,
  dates_tentative: true, won: false, location: null, install_start: null, event_start: null, event_end: null, dismantle_date: null, edition: null, teams: [], equipment: [], to_confirm: null, note: null, planning: null, handover: null, ...over,
});
const answered = (at: string) => ({ provisional_pm_id: null, provisional_pm: null, risk: "unknown" as const, risk_note: null, capacity_conflict: false, capacity_note: null, question: "Hall from the 25th?", question_at: "2027-02-10T08:00:00Z", question_by: "Omar Ops", answer: "Yes", answered_at: at });
const read = (over: Partial<OpsCompanyRead> = {}): OpsCompanyRead => ({ company: { id: "c1", name: "Fictional UAE" }, overview: { state: "ok", data: overview() }, upcoming: { state: "ok", data: [] }, ...over });
const day = (...reads: OpsCompanyRead[]): OpsDay => ({ reads });

describe("Operations on My Day: the summary", () => {
  it("counts the recorded decisions, lists the next installations and names the most urgent issue with its owner and a direct link", () => {
    const o = overview({ handovers: [handover("h1")], projects: [project({ equipment_reviews: 1 }), project({ id: "p2", reference: "UAE-P-2027-0002", name: "Later job", install_start: "2027-03-02" }), project({ id: "p3", install_start: "2027-05-01" })] });
    const s = opsDaySummary(day(read({ overview: { state: "ok", data: o } })), TODAY);
    expect(s.decisions).toBe(2);
    expect(s.decisionsHref).toBe("/operations?company=c1#decisions");
    expect(s.installations.map((i) => [i.title, i.date, i.inDays, i.health, i.href])).toEqual([
      ["UAE-P-2027-0001 Fictional Expo stand", "2027-02-26", 6, "needs_attention", "/projects/p1/work"], ["UAE-P-2027-0002 Later job", "2027-03-02", 10, "on_track", "/projects/p2/work"]]);
    expect(s.urgent).toMatchObject({ kind: "pm_unassigned", label: "Project Manager not assigned", title: "UAE-O-2027-0002 Mall roadshow", owner: "Operations", href: "/projects/handovers?handover=h1" });
    expect(s.failed).toEqual([]);
  });
  it("a booking review is shown as oversight with the Project Manager named as its owner", () => {
    const s = opsDaySummary(day(read({ overview: { state: "ok", data: overview({ projects: [project({ install_start: "2027-06-01", event_start: null, event_end: null, equipment_reviews: 1 })] }) } })), TODAY);
    expect(s.urgent).toMatchObject({ kind: "equipment_review", owner: "Pat Manager", href: "/projects/p1/equipment" });
  });
  it("a company whose read failed is named and never counted as zero; when none loaded there is no figure at all", () => {
    const two = opsDaySummary(day(read({ overview: { state: "ok", data: overview({ handovers: [handover("h1")] }) } }), read({ company: { id: "c2", name: "Fictional KSA" }, overview: { state: "error" } })), TODAY);
    expect(two).toMatchObject({ decisions: 1, failed: ["Fictional KSA"], multi: true });
    expect(two.urgent?.title).toBe("UAE-O-2027-0002 Mall roadshow · Fictional UAE");            // with two companies each line says which
    const none = opsDaySummary(day(read({ overview: { state: "error" } })), TODAY);
    expect(none).toMatchObject({ decisions: null, installations: [], urgent: null, failed: ["Fictional UAE"] });
  });
  it("only the companies it was given are counted or linked", () => {
    const s = opsDaySummary(day(read({ overview: { state: "ok", data: overview({ projects: [project()] }) } })), TODAY);
    expect(JSON.stringify(s)).not.toContain("c2");
    expect(s.installations.every((i) => i.href.startsWith("/projects/p1/"))).toBe(true);
  });
});

describe("Operations on My Day: what the person can act on", () => {
  it("a Sales answer to the Operations question is an item for seven days, keyed by its enquiry", () => {
    const fresh = row({ planning: answered("2027-02-19T08:00:00Z") });
    const c = opsAnswerCandidates(day(read({ upcoming: { state: "ok", data: [fresh, row({ id: "o2", planning: answered("2027-02-12T07:00:00Z") }), row({ id: "o3", planning: { ...answered("x"), answer: null, answered_at: null } }), row({ id: "o4" })] } })), NOW);
    expect(c.map((x) => [x.key, x.source, x.href])).toEqual([["opp:o1", "operations", "/operations/upcoming?company=c1&q=UAE-O-2027-0007"]]);
    expect(c[0]!.what).toBe("Sales answered the Operations question: decide the planning");
    expect(OPS_ANSWER_DAYS).toBe(7);
    // once the project exists the enquiry has left Upcoming Work
    expect(opsAnswerCandidates(day(read({ upcoming: { state: "ok", data: [{ ...fresh, handover: { id: "h", status: "accepted", submitted_at: null, pm: "Pat", project_id: "p9" } }] } })), NOW)).toEqual([]);
  });
  it("a handover the viewer can assign is listed once: Operations adds no second row for it, and an answer on the same enquiry merges into it", () => {
    const projects = projectDecisionCandidates({ handoverList: [{ id: "h1", opportunityId: "o1", reference: "UAE-O-2027-0007", title: "Expo stand for Fictional Motors", status: "submitted", at: "2027-02-18T08:00:00Z" }], scopeList: [] }, NOW);
    const d = day(read({ overview: { state: "ok", data: overview({ handovers: [handover("h1")] }) }, upcoming: { state: "ok", data: [row({ planning: answered("2027-02-19T08:00:00Z"), handover: { id: "h1", status: "submitted", submitted_at: null, pm: null, project_id: null } })] } }));
    const a = buildAttention([ok("project-decisions", projects), ok("operations", opsAnswerCandidates(d, NOW))]);
    expect(a.count).toBe(1);
    expect(a.items[0]).toMatchObject({ key: "opp:o1", what: "Project handover waiting for a project manager to be assigned", also: ["Sales answered the Operations question: decide the planning"], sources: ["project-decisions", "operations"] });
    expect(opsDaySummary(d, TODAY).decisions).toBe(1);                                            // the summary counts the same handover once too
  });
  it("a failed Upcoming Work read is an error for the attention list, not an empty one", () => {
    expect(opsCandidatesFailed(day(read({ upcoming: { state: "error" } })))).toBe(true);
    expect(opsCandidatesFailed(day(read()))).toBe(false);
  });
  it("a booking review is the Project Manager's own item, one per project", () => {
    const c = equipmentReviewCandidates([{ projectId: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", count: 2, since: "2027-02-18T08:00:00Z" }], NOW);
    expect(c).toMatchObject([{ key: "equipment-review:p1", source: "project-equipment", title: "UAE-P-2027-0001 Fictional Expo stand", what: "Review 2 equipment bookings: committed dates changed", href: "/projects/p1/equipment" }]);
    expect(buildAttention([ok("project-equipment", c), ok("project-equipment", c)]).count).toBe(1);
  });
});
