import { describe, expect, it } from "vitest";
import type { ProjectStanding } from "@enginious-hr/domain";
import type { ProjTaskRow } from "@/types/projects";
import {
  boardColumnOf, boardTargets, buildTaskRow, groupTaskRows, moveFor, moveMode, parseGroupBy, parseTaskSort, sortTaskRows, taskMoveSpecs,
  type ProjectLookup, type RowContext, type TaskRowData,
} from "./task-logic";

const ME = "me";
const OTHER = "other";
const TEAM = "team-1";
const TEAM2 = "team-2";
const PROJECT = { id: "p1", reference: "UAE-P-2026-0001", name: "Orbit", status: "in_progress" };
const standing = (over: Partial<ProjectStanding> = {}): ProjectStanding => ({ companyId: "c", grants: [{ companyId: "c", capabilities: [] }], isPm: false, isMember: true, isActingPm: false, headOfTeamIds: [], isSalesLinked: false, status: "in_progress", ...over });
const look = (s: ProjectStanding, over: Partial<ProjectLookup> = {}): ProjectLookup => ({
  project: PROJECT, standing: s,
  teams: [{ id: TEAM, name: "Programming" }, { id: TEAM2, name: "Hardware" }],
  deliverables: [{ id: "d1", title: "Floor build", milestone_id: "m1" }, { id: "d2", title: "Spare parts", milestone_id: null }],
  milestones: [{ id: "m1", title: "First draft" }, { id: "m2", title: "Final render" }],
  people: [{ user_id: ME, full_name: "Me", team_id: TEAM }, { user_id: OTHER, full_name: "Other", team_id: TEAM }, { user_id: "far", full_name: "Far", team_id: TEAM2 }],
  ...over,
});
const rc: RowContext = { userId: ME, today: "2026-10-20", nameOf: (id) => (id === ME ? "Me" : id === OTHER ? "Other" : id), formatDate: (d) => d };
const task = (over: Partial<ProjTaskRow> = {}): ProjTaskRow => ({
  id: "t", project_id: "p1", deliverable_id: null, milestone_id: null, team_id: TEAM, title: "T", description: null, assignee_id: ME, priority: "normal", start_date: null,
  due_date: null, status: "todo", requires_review: false, blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null, completed_at: null,
  completed_by: null, created_by: ME, version: 3, created_at: "", updated_at: "", ...over,
});

describe("moveMode", () => {
  it("saves plain moves directly and sends anything needing a reason, review or decision to a form", () => {
    expect(moveMode({ requiresReview: false }, { to: "in_progress", needsNote: false })).toBe("direct");
    expect(moveMode({ requiresReview: false }, { to: "done", needsNote: false })).toBe("direct");
    expect(moveMode({ requiresReview: true }, { to: "done", needsNote: false })).toBe("dialog");
    expect(moveMode({ requiresReview: true }, { to: "ready_for_review", needsNote: false })).toBe("dialog");
    expect(moveMode({ requiresReview: false }, { to: "cancelled", needsNote: true })).toBe("dialog");
    expect(moveMode({ requiresReview: false }, { to: "in_progress", needsNote: true })).toBe("dialog");
  });
});

describe("what a viewer may change on a row", () => {
  it("lets an assignee move a routine task and finish it, but gives them no reassign control", () => {
    const r = buildTaskRow(task(), look(standing()), rc);
    expect(r.moves.map((m) => [m.to, m.mode])).toEqual([["in_progress", "direct"], ["done", "direct"]]);
    expect(r.canChangeDue).toBe(true);
    expect(r.canReassign).toBe(false);
    expect(r.reassignOptions).toEqual([]);
  });
  it("never lets the person whose work is reviewed accept it, and keeps Done a form even for a reviewer", () => {
    const mine = buildTaskRow(task({ status: "ready_for_review", requires_review: true, team_id: TEAM }), look(standing({ headOfTeamIds: [TEAM] })), rc);
    expect(mine.moves.some((m) => m.to === "done")).toBe(false);
    const theirs = buildTaskRow(task({ status: "ready_for_review", requires_review: true, assignee_id: OTHER }), look(standing({ headOfTeamIds: [TEAM] })), rc);
    expect(theirs.moves.find((m) => m.to === "done")).toMatchObject({ label: "Accept and complete", mode: "dialog" });
    expect(theirs.moves.find((m) => m.label === "Request changes")).toMatchObject({ needsNote: true, mode: "dialog" });
  });
  it("sends a review-required task for review through a form, not a cell edit", () => {
    const r = buildTaskRow(task({ status: "in_progress", requires_review: true }), look(standing()), rc);
    expect(r.moves.find((m) => m.to === "ready_for_review")?.mode).toBe("dialog");
    expect(r.moves.some((m) => m.to === "done")).toBe(false);
  });
  it("offers a blocked routine task no Done move", () => {
    const r = buildTaskRow(task({ blocked_at: "2026-10-01T00:00:00Z", blocked_reason: "x" }), look(standing()), rc);
    expect(r.moves.some((m) => m.to === "done")).toBe(false);
    expect(r.blocked).toBe(true);
  });
  it("lets the head of the task's team reassign within the team, and the PM anyone", () => {
    const head = buildTaskRow(task({ assignee_id: OTHER }), look(standing({ headOfTeamIds: [TEAM] })), rc);
    expect(head.canReassign).toBe(true);
    expect(head.reassignOptions.map((o) => o.id).sort()).toEqual([ME, OTHER].sort());
    const pm = buildTaskRow(task({ assignee_id: OTHER }), look(standing({ isPm: true })), rc);
    expect(pm.reassignOptions.map((o) => o.id).sort()).toEqual(["far", ME, OTHER].sort());
    const headOfOtherTeam = buildTaskRow(task({ assignee_id: OTHER }), look(standing({ headOfTeamIds: [TEAM2] })), rc);
    expect(headOfOtherTeam.canReassign).toBe(false);
    expect(headOfOtherTeam.moves).toEqual([]);
    expect(headOfOtherTeam.canChangeDue).toBe(false);
  });
  it("gives a founder who is not on the project the manager's rights, and a plain member of someone else's task nothing", () => {
    const founder = buildTaskRow(task({ assignee_id: OTHER }), look(standing({ isMember: false, grants: [{ companyId: "c", capabilities: ["founder"] }] })), rc);
    expect(founder.canChangeDue).toBe(true);
    expect(founder.canReassign).toBe(true);
    const member = buildTaskRow(task({ assignee_id: OTHER, team_id: TEAM2 }), look(standing()), rc);
    expect(member).toMatchObject({ moves: [], canChangeDue: false, canReassign: false });
  });
  it("makes everything read-only once the project is completed or archived", () => {
    for (const status of ["completed", "archived"]) {
      const r = buildTaskRow(task(), look(standing({ isPm: true }), { project: { ...PROJECT, status } }), rc);
      expect(r).toMatchObject({ moves: [], canChangeDue: false, canReassign: false });
    }
  });
  it("closed tasks offer a reopen to leaders only, with a reason", () => {
    const leader = taskMoveSpecs("manager", ME, { assigneeId: OTHER, teamId: TEAM, requiresReview: false, status: "done", blocked: false });
    expect(leader.map((m) => [m.to, m.mode])).toEqual([["in_progress", "dialog"], ["todo", "dialog"]]);
    expect(taskMoveSpecs("assignee", ME, { assigneeId: ME, teamId: TEAM, requiresReview: false, status: "done", blocked: false })).toEqual([]);
  });
  it("states due dates as plain dates with the overdue state in words", () => {
    expect(buildTaskRow(task({ due_date: "2026-10-18" }), look(standing()), rc).due).toEqual({ text: "2026-10-18 · overdue by 2 days", overdue: true });
    expect(buildTaskRow(task({ due_date: "2026-10-20" }), look(standing()), rc).due).toEqual({ text: "2026-10-20 · due today", overdue: false });
    expect(buildTaskRow(task({ due_date: "2026-10-30" }), look(standing()), rc).due.overdue).toBe(false);
    expect(buildTaskRow(task({ due_date: "2026-10-01", status: "done" }), look(standing()), rc).due.overdue).toBe(false);
    expect(buildTaskRow(task(), look(standing()), rc).due.text).toBe("No due date");
  });
});

describe("board", () => {
  it("places tasks by status and leaves deferred and cancelled off the board", () => {
    expect(boardColumnOf("todo")).toBe("todo");
    expect(boardColumnOf("ready_for_review")).toBe("ready_for_review");
    expect(boardColumnOf("deferred")).toBeNull();
    expect(boardColumnOf("cancelled")).toBeNull();
  });
  it("offers only the columns the viewer's own moves lead to", () => {
    const todo = buildTaskRow(task(), look(standing()), rc);
    expect(boardTargets(todo)).toEqual(["in_progress", "done"]);
    const leader = buildTaskRow(task({ assignee_id: OTHER }), look(standing({ isPm: true })), rc);
    expect(boardTargets(leader)).toEqual(["in_progress", "done"]); // deferred and cancelled are real moves but not board columns
    expect(boardTargets({ moves: [] })).toEqual([]);
  });
  it("prefers the move that needs no reason when two lead to the same status", () => {
    const r = { moves: [{ to: "in_progress", label: "Request changes", needsNote: true, mode: "dialog" as const }, { to: "in_progress", label: "Withdraw", needsNote: false, mode: "direct" as const }] };
    expect(moveFor(r, "in_progress")?.label).toBe("Withdraw");
    expect(moveFor(r, "done")).toBeNull();
  });
});

describe("sorting", () => {
  const mk = (over: Partial<TaskRowData>): TaskRowData => ({ ...buildTaskRow(task(), look(standing()), rc), ...over });
  const rows = [mk({ id: "a", title: "Beta", dueDate: "2026-10-25", assigneeName: "Zed", status: "done", priority: "low" }), mk({ id: "b", title: "Alpha", dueDate: null, assigneeName: "Amy", status: "todo", priority: "urgent" }), mk({ id: "c", title: "Gamma", dueDate: "2026-10-21", assigneeName: "Bob", status: "in_progress", priority: "normal" })];
  it("parses only known sort keys", () => {
    expect(parseTaskSort("title:desc")).toEqual({ key: "due", dir: "asc" });
    expect(parseTaskSort("assignee:desc")).toEqual({ key: "assignee", dir: "desc" });
    expect(parseTaskSort("")).toEqual({ key: "due", dir: "asc" });
  });
  it("sorts by due with undated last in either direction", () => {
    expect(sortTaskRows(rows, { key: "due", dir: "asc" }).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortTaskRows(rows, { key: "due", dir: "desc" }).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
  it("sorts by title, assignee, status workflow order and priority", () => {
    expect(sortTaskRows(rows, { key: "task", dir: "asc" }).map((r) => r.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(sortTaskRows(rows, { key: "assignee", dir: "desc" }).map((r) => r.assigneeName)).toEqual(["Zed", "Bob", "Amy"]);
    expect(sortTaskRows(rows, { key: "status", dir: "asc" }).map((r) => r.status)).toEqual(["todo", "in_progress", "done"]);
    expect(sortTaskRows(rows, { key: "priority", dir: "asc" }).map((r) => r.priority)).toEqual(["urgent", "normal", "low"]);
  });
  it("does not change the input", () => {
    const copy = rows.map((r) => r.id);
    sortTaskRows(rows, { key: "task", dir: "desc" });
    expect(rows.map((r) => r.id)).toEqual(copy);
  });
});

describe("grouping", () => {
  const l = look(standing());
  const row = (over: Partial<ProjTaskRow>) => buildTaskRow(task(over), l, rc);
  const rows = [
    row({ id: "1", milestone_id: "m2", team_id: TEAM, assignee_id: OTHER }),
    row({ id: "2", deliverable_id: "d1", team_id: TEAM2 }),          // milestone m1 through its deliverable
    row({ id: "3", deliverable_id: "d2", team_id: null }),           // deliverable with no milestone: unlinked
    row({ id: "4", status: "in_progress" }),
  ];
  it("groups by milestone through the task or its deliverable, in plan order, with an honest Unlinked group last", () => {
    const g = groupTaskRows(rows, "milestone", { milestones: ["m1", "m2"] });
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([["First draft", ["2"]], ["Final render", ["1"]], ["Unlinked", ["3", "4"]]]);
    expect(g[2]?.none).toBe(true);
  });
  it("groups by department with the unassigned tasks last", () => {
    expect(groupTaskRows(rows, "team").map((x) => x.label)).toEqual(["Hardware", "Programming", "No department"]);
  });
  it("groups by status in workflow order and by assignee alphabetically", () => {
    expect(groupTaskRows(rows, "status").map((x) => x.label)).toEqual(["To do", "In progress"]);
    expect(groupTaskRows(rows, "assignee").map((x) => x.label)).toEqual(["Me", "Other"]);
  });
  it("returns one group for no grouping and parses the parameter strictly", () => {
    expect(groupTaskRows(rows, "none")).toHaveLength(1);
    expect(parseGroupBy("milestone")).toBe("milestone");
    expect(parseGroupBy("everything")).toBe("none");
  });
});
