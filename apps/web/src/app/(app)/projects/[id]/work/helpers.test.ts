import { describe, expect, it } from "vitest";
import type { ProjectStanding } from "@enginious-hr/domain";
import type { ProjDeliverableRow, ProjProjectPersonRow, ProjTaskRow, ProjTeamRow } from "@/types/projects";
import {
  stripSteps,
  deliverableMoves, describeTaskEvent, dueWords, filterTasks, groupDeliverables, hasActiveFilters, isTaskOverdue, milestoneMoves, newTaskOptions, parseTaskFilters,
  quickAssigneeChoices, reviewQueue, showChoiceOf, sortTasks, taskCountsByDeliverable, taskRowFields, DEFAULT_TASK_FILTERS,
  isDueThisWeekOrOverdue, needsAttention, weekWindow,
} from "./helpers";

const U = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const fmt = (d: string) => d;

function task(over: Partial<ProjTaskRow> = {}): ProjTaskRow {
  return {
    id: "t", project_id: "p", deliverable_id: null, milestone_id: null, team_id: null, title: "T", description: null, assignee_id: "a", priority: "normal", start_date: null,
    due_date: null, status: "todo", requires_review: false, blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null, completed_at: null, completed_by: null,
    created_by: "a", version: 1, created_at: "", updated_at: "", ...over,
  };
}
const standing = (over: Partial<ProjectStanding> = {}): ProjectStanding => ({ companyId: "c", grants: [], isPm: false, isMember: true, isActingPm: false, headOfTeamIds: [], isSalesLinked: false, status: "in_progress", ...over });
const person = (id: string, team: string | null, name = id): ProjProjectPersonRow => ({ user_id: id, full_name: name, role: "member", team_id: team, is_team_head: false, acting_until: null });
const team = (id: string, name: string, head: string): ProjTeamRow => ({ id, project_id: "p", name, department_id: null, head_user_id: head, created_by: null, created_at: "", removed_at: null });

describe("parseTaskFilters", () => {
  it("defaults to open tasks and ignores unknown or malformed values", () => {
    expect(parseTaskFilters({})).toEqual(DEFAULT_TASK_FILTERS);
    expect(parseTaskFilters({ status: "bogus", assignee: "not-a-uuid", team: "x", mine: "yes" })).toEqual(DEFAULT_TASK_FILTERS);
  });
  it("accepts valid filters, takes the first of repeated parameters, and clamps ids", () => {
    const f = parseTaskFilters({ status: ["done", "all"], assignee: U, team: TEAM, mine: "1", overdue: "1", blocked: "1", deliverable: T2 });
    expect(f).toEqual({ assignee: U, status: "done", team: TEAM, deliverable: T2, mine: true, overdue: true, blocked: true, attention: false, q: "" });
    expect(parseTaskFilters({ status: "all" }).status).toBe("all");
  });
  it("reads the toolbar's single Show choice, a search text, and old multi-flag bookmarks the same way", () => {
    expect(parseTaskFilters({ show: "overdue" })).toMatchObject({ overdue: true, mine: false, blocked: false });
    expect(parseTaskFilters({ show: "mine" }).mine).toBe(true);
    expect(parseTaskFilters({ show: "everything" })).toEqual(DEFAULT_TASK_FILTERS);
    expect(parseTaskFilters({ q: "  truss  " }).q).toBe("truss");
    expect(parseTaskFilters({ q: "x".repeat(300) }).q).toHaveLength(100);
    expect(showChoiceOf({ mine: false, overdue: true, blocked: true, attention: false })).toBe("overdue");
    expect(showChoiceOf({ mine: false, overdue: false, blocked: false, attention: false })).toBe("");
  });
  it("searches titles and descriptions, ignoring case", () => {
    const tasks = [task({ id: "1", title: "Truss delivery" }), task({ id: "2", title: "Other", description: "about the TRUSS" }), task({ id: "3", title: "Nothing" })];
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, q: "truss" }, U, "2026-10-20").map((t) => t.id)).toEqual(["1", "2"]);
  });
  it("reports when a filter is active", () => {
    expect(hasActiveFilters(DEFAULT_TASK_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_TASK_FILTERS, status: "all" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_TASK_FILTERS, mine: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_TASK_FILTERS, q: "x" })).toBe(true);
  });
});

describe("filtering and ordering", () => {
  const today = "2026-10-20";
  const tasks = [
    task({ id: "1", status: "todo", due_date: "2026-10-19", assignee_id: U }),
    task({ id: "2", status: "done", due_date: "2026-10-01" }),
    task({ id: "3", status: "in_progress", due_date: "2026-10-25", blocked_at: "x", blocked_reason: "r" }),
    task({ id: "4", status: "ready_for_review", team_id: TEAM }),
    task({ id: "5", status: "cancelled" }),
  ];
  it("shows only open tasks by default (done, cancelled and deferred are not open)", () => {
    expect(filterTasks(tasks, DEFAULT_TASK_FILTERS, U, today).map((t) => t.id)).toEqual(["1", "3", "4"]);
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, status: "all" }, U, today)).toHaveLength(5);
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, status: "done" }, U, today).map((t) => t.id)).toEqual(["2"]);
  });
  it("applies mine, team, blocked and overdue, which combine", () => {
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, mine: true }, U, today).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, team: TEAM }, U, today).map((t) => t.id)).toEqual(["4"]);
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, blocked: true }, U, today).map((t) => t.id)).toEqual(["3"]);
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, overdue: true }, U, today).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { ...DEFAULT_TASK_FILTERS, overdue: true, mine: true, assignee: "other" }, U, today)).toEqual([]);
  });
  it("detects overdue by plain date comparison, never for finished work or today", () => {
    expect(isTaskOverdue({ status: "todo", due_date: "2026-10-19" }, today)).toBe(true);
    expect(isTaskOverdue({ status: "todo", due_date: today }, today)).toBe(false);
    expect(isTaskOverdue({ status: "done", due_date: "2026-01-01" }, today)).toBe(false);
    expect(isTaskOverdue({ status: "todo", due_date: null }, today)).toBe(false);
  });
  it("sorts by due date (undated last), then priority, then title", () => {
    const sorted = sortTasks([
      task({ id: "a", due_date: null, title: "A" }), task({ id: "b", due_date: "2026-10-22", priority: "low", title: "B" }),
      task({ id: "c", due_date: "2026-10-22", priority: "urgent", title: "C" }), task({ id: "d", due_date: "2026-10-21", title: "D" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["d", "c", "b", "a"]);
  });
  it("states due dates in words with plural handling", () => {
    expect(dueWords(null, true, today, fmt).text).toBe("No due date");
    expect(dueWords("2026-10-19", true, today, fmt)).toEqual({ text: "2026-10-19 · overdue by 1 day", overdue: true });
    expect(dueWords("2026-10-10", true, today, fmt).text).toContain("overdue by 10 days");
    expect(dueWords(today, true, today, fmt).text).toContain("due today");
    expect(dueWords("2026-10-01", false, today, fmt)).toEqual({ text: "2026-10-01", overdue: false });
  });
});

describe("row mapping and counts", () => {
  it("maps names, team, deliverable and flags the same way for table and cards", () => {
    const d = [{ id: "d1", title: "Floor build" }];
    const r = taskRowFields(task({ team_id: TEAM, deliverable_id: "d1", blocked_at: "x", requires_review: true, due_date: "2026-10-19" }), { nameOf: () => "Sam", teams: [team(TEAM, "Programming", U)], deliverables: d, today: "2026-10-20", format: fmt });
    expect(r).toMatchObject({ assignee: "Sam", team: "Programming", deliverable: "Floor build", blocked: true, needsReview: true });
    expect(r.due.overdue).toBe(true);
    expect(taskRowFields(task(), { nameOf: () => "x", teams: [], deliverables: [], today: "2026-10-20", format: fmt })).toMatchObject({ team: null, deliverable: null });
  });
  it("counts open and total tasks per deliverable from real tasks", () => {
    const c = taskCountsByDeliverable([task({ deliverable_id: "d" }), task({ deliverable_id: "d", status: "done" }), task({ deliverable_id: "d", status: "cancelled" }), task({ deliverable_id: null })]);
    expect(c.get("d")).toEqual({ open: 1, total: 3 });
    expect(c.size).toBe(1);
  });
  it("groups deliverables by milestone and keeps unlinked ones last", () => {
    const ds = [{ id: "1", milestone_id: "m2" }, { id: "2", milestone_id: null }, { id: "3", milestone_id: "m1" }, { id: "4", milestone_id: "gone" }] as ProjDeliverableRow[];
    const g = groupDeliverables([{ id: "m1" }, { id: "m2" }, { id: "m3" }], ds);
    expect(g.map((x) => x.milestone?.id ?? null)).toEqual(["m1", "m2", null]);
    expect(g[2]!.deliverables.map((d) => d.id)).toEqual(["2", "4"]);
  });
});

describe("review queue", () => {
  const tasks = [task({ id: "r1", status: "ready_for_review", assignee_id: "worker", team_id: TEAM, requires_review: true }), task({ id: "r2", status: "ready_for_review", assignee_id: "me", team_id: TEAM }), task({ id: "r3", status: "ready_for_review", assignee_id: "worker", team_id: T2 }), task({ id: "x", status: "todo" })];
  it("lists what a head may review in their team, never their own work", () => {
    expect(reviewQueue(tasks, standing({ headOfTeamIds: [TEAM] }), "me").map((t) => t.id)).toEqual(["r1"]);
  });
  it("lists everything for the PM except the PM's own tasks, and nothing for a plain member", () => {
    expect(reviewQueue(tasks, standing({ isPm: true }), "me").map((t) => t.id).sort()).toEqual(["r1", "r3"]);
    expect(reviewQueue(tasks, standing(), "me")).toEqual([]);
  });
});

describe("new task options (mirror proj_create_task)", () => {
  const people = [person("me", "t1", "Me"), person("mate", "t1", "Mate"), person("other", "t2", "Other"), person("head", "t1", "Head")];
  const teams = [team("t1", "Programming", "head"), team("t2", "Content", "x")];
  const deliverables = [
    { id: "d-t1", title: "Build", team_id: "t1", status: "open" }, { id: "d-t2", title: "Copy", team_id: "t2", status: "open" },
    { id: "d-none", title: "General", team_id: null, status: "open" }, { id: "d-done", title: "Old", team_id: null, status: "accepted" },
  ];

  it("lets a plain member assign only themself, in their own team or none, to deliverables they may use", () => {
    const o = newTaskOptions({ standing: standing(), userId: "me", myTeamId: "t1", people, teams, deliverables, manager: false });
    expect(o.teams.map((t) => t.id)).toEqual(["t1"]);
    expect(o.assigneesByTeam[""]!.map((p) => p.id)).toEqual(["me"]);
    expect(o.assigneesByTeam["t1"]!.map((p) => p.id)).toEqual(["me"]);
    expect(o.deliverablesByTeam[""]!.map((d) => d.id)).toEqual(["d-none"]);
    expect(o.deliverablesByTeam["t1"]!.map((d) => d.id).sort()).toEqual(["d-none", "d-t1"]);
    expect(o.canRequireReview).toBe(false);
  });
  it("lets a head distribute to their own team and themself, and require review", () => {
    const o = newTaskOptions({ standing: standing({ headOfTeamIds: ["t1"] }), userId: "head", myTeamId: "t1", people, teams, deliverables, manager: false });
    expect(o.teams.map((t) => t.id)).toEqual(["t1"]);
    expect(o.assigneesByTeam["t1"]!.map((p) => p.id).sort()).toEqual(["head", "me", "mate"].sort());
    expect(o.assigneesByTeam[""]!.map((p) => p.id)).toEqual(["head"]);
    expect(o.canRequireReview).toBe(true);
  });
  it("lets the PM assign anyone in any team and file under any live deliverable", () => {
    const o = newTaskOptions({ standing: standing({ isPm: true }), userId: "pm", myTeamId: null, people, teams, deliverables, manager: true });
    expect(o.teams).toHaveLength(2);
    expect(o.assigneesByTeam["t2"]).toHaveLength(4);
    expect(o.deliverablesByTeam["t2"]!.map((d) => d.id)).not.toContain("d-done");
    expect(o.deliverablesByTeam[""]!).toHaveLength(3);
    expect(o.canRequireReview).toBe(true);
  });
});

describe("status options and history", () => {
  it("only reopens an accepted or cancelled milestone or deliverable, with a reason", () => {
    for (const f of [milestoneMoves, deliverableMoves]) {
      expect(f("accepted")).toEqual([{ to: "in_progress", label: "Reopen as In progress", needsNote: true }]);
      expect(f("cancelled")).toHaveLength(1);
    }
  });
  it("needs a note to cancel or defer, and omits the current status", () => {
    const m = milestoneMoves("planned");
    expect(m.map((x) => x.to)).not.toContain("planned");
    expect(m.find((x) => x.to === "cancelled")?.needsNote).toBe(true);
    expect(m.find((x) => x.to === "accepted")?.needsNote).toBe(false);
    expect(deliverableMoves("open").find((x) => x.to === "deferred")?.needsNote).toBe(true);
  });
  it("words history lines, with reasons", () => {
    const date = (d: string | null) => d ?? "none";
    expect(describeTaskEvent({ kind: "due_date_changed", from_value: "2099-02-10", to_value: "2099-02-14", note: "Client wanted polish" }, date)).toBe("Due date changed from 2099-02-10 to 2099-02-14. Reason: Client wanted polish");
    expect(describeTaskEvent({ kind: "reassigned", from_value: "A", to_value: "B", note: null }, date)).toBe("Reassigned from A to B.");
    expect(describeTaskEvent({ kind: "status_changed", from_value: "todo", to_value: "ready_for_review", note: null }, date)).toBe("Status changed from To do to Ready for review.");
    expect(describeTaskEvent({ kind: "blocked", from_value: null, to_value: "Waiting for truss", note: "Standbuilder delivers" }, date)).toBe("Blocked: Waiting for truss. To unblock: Standbuilder delivers");
    expect(describeTaskEvent({ kind: "created", from_value: null, to_value: "Sam", note: null }, date)).toBe("Created and assigned to Sam.");
  });
});

describe("quickAssigneeChoices", () => {
  const people = [person(U, null, "Ann"), person("b", TEAM, "Bea"), person("c", TEAM, "Cy"), person("d", T2, "Dee")];
  const teams = [team(TEAM, "Programming", "b"), team(T2, "Hardware", "d")];
  const base = { userId: "b", myTeamId: TEAM, people, teams, deliverables: [] as never[] };
  it("offers a Project Manager everyone, filed under no team", () => {
    const o = newTaskOptions({ ...base, standing: standing({ isPm: true }), manager: true });
    const c = quickAssigneeChoices(o, true);
    expect(c.map((x) => x.name)).toEqual(["Ann", "Bea", "Cy", "Dee"]);
    expect(c.every((x) => x.teamId === "")).toBe(true);
  });
  it("offers a plain member only themself, with no team", () => {
    const o = newTaskOptions({ ...base, userId: "c", standing: standing(), manager: false });
    expect(quickAssigneeChoices(o, false)).toEqual([{ id: "c", name: "Cy", teamId: "" }]);
  });
  it("offers a department head themself (no team) and their team members (filed under the team), and nobody from other teams", () => {
    const o = newTaskOptions({ ...base, standing: standing({ headOfTeamIds: [TEAM] }), manager: false });
    const c = quickAssigneeChoices(o, false);
    expect(c.map((x) => [x.name, x.teamId])).toEqual([["Bea", ""], ["Cy", TEAM]]);
  });
});


describe("This week and needs attention", () => {
  const task = (due: string | null, status = "todo", blocked: string | null = null) => ({ status, due_date: due, blocked_at: blocked });
  it("finds Monday to Sunday of the week of any day", () => {
    expect(weekWindow("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // a Monday
    expect(weekWindow("2026-10-28")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(weekWindow("2026-11-01")).toEqual({ start: "2026-10-26", end: "2026-11-01" }); // a Sunday
  });
  it("puts overdue and this-week open tasks in This week, and nothing later, finished or undated", () => {
    const today = "2026-10-28";
    expect(isDueThisWeekOrOverdue(task("2026-10-20"), today)).toBe(true);
    expect(isDueThisWeekOrOverdue(task("2026-11-01"), today)).toBe(true);
    expect(isDueThisWeekOrOverdue(task("2026-11-02"), today)).toBe(false);
    expect(isDueThisWeekOrOverdue(task("2026-10-28", "done"), today)).toBe(false);
    expect(isDueThisWeekOrOverdue(task(null), today)).toBe(false);
  });
  it("needs attention means an open task that is blocked or overdue", () => {
    const today = "2026-10-28";
    expect(needsAttention(task("2026-10-30", "todo", "2026-10-27T10:00:00Z"), today)).toBe(true);
    expect(needsAttention(task("2026-10-20"), today)).toBe(true);
    expect(needsAttention(task("2026-10-30"), today)).toBe(false);
    expect(needsAttention(task("2026-10-20", "done"), today)).toBe(false);
  });
  it("reads show=attention from the address and counts it as an active filter", () => {
    const f = parseTaskFilters({ show: "attention" });
    expect(f.attention).toBe(true);
    expect(hasActiveFilters(f)).toBe(true);
    expect(showChoiceOf(f)).toBe("attention");
  });
});

describe("milestone strip", () => {
  const m = (id: string, status: string, dueDate: string | null, isRequired = true) => ({ id, title: id, status, dueDate, isRequired });
  const states = (list: ReturnType<typeof m>[], today = "2026-06-10") => stripSteps(list, today).map((s) => `${s.m.id}:${s.state}`);

  it("marks accepted ones done, the first open one next and the rest later", () => {
    expect(states([m("a", "accepted", "2026-06-01"), m("b", "in_progress", "2026-06-20"), m("c", "planned", "2026-07-01")])).toEqual(["a:done", "b:next", "c:later"]);
  });
  it("marks any open milestone whose date has passed as late, never as done", () => {
    expect(states([m("a", "planned", "2026-06-01"), m("b", "planned", "2026-06-05"), m("c", "planned", "2026-07-01")])).toEqual(["a:late", "b:late", "c:later"]);
  });
  it("leaves cancelled and deferred milestones out, and an undated one is not late", () => {
    expect(states([m("a", "cancelled", "2026-06-01"), m("b", "deferred", null), m("c", "planned", null)])).toEqual(["c:next"]);
  });
  it("is empty when there is no milestone", () => {
    expect(states([])).toEqual([]);
  });
});
