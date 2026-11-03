import { describe, expect, it } from "vitest";
import { buildWorkToday, tasksInReview, type WorkTodayTask } from "./work-today";

const TODAY = "2026-11-02";
const task = (id: string, over: Partial<WorkTodayTask> = {}): WorkTodayTask => ({
  id, title: `Task ${id}`, status: "in_progress", due_date: null, blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null,
  projectReference: "P-1", projectName: "Expo", ...over,
});
const names: Record<string, string> = { u2: "Omar Ali" };
const build = (tasks: WorkTodayTask[], limit?: number) => buildWorkToday(tasks, TODAY, (id) => names[id] ?? "Unknown", (d) => d, limit);

describe("buildWorkToday", () => {
  it("shows task titles with the project, in the order overdue (oldest first), due today, blocked, later", () => {
    const w = build([
      task("later", { due_date: "2026-11-20" }),
      task("today", { due_date: TODAY }),
      task("blocked", { due_date: "2026-11-05", blocked_at: "2026-11-01T08:00:00Z", blocked_reason: "Waiting for the venue plan", unblock_owner_id: "u2" }),
      task("old", { due_date: "2026-10-20" }),
      task("recent", { due_date: "2026-11-01" }),
    ]);
    expect(w.rows.map((r) => r.id)).toEqual(["old", "recent", "today", "blocked", "later"]);
    expect(w.rows[0]).toMatchObject({ title: "Task old", project: "P-1 · Expo", group: "overdue", dueText: "Overdue since 2026-10-20", href: "/projects/work?task=old" });
    expect(w.rows[2]).toMatchObject({ group: "today", dueText: "Due today" });
    expect(w.rows[4]).toMatchObject({ group: "later", dueText: "Due 2026-11-20" });
  });

  it("separates due today from later and from overdue, and counts each fact once", () => {
    const w = build([task("a", { due_date: "2026-10-30" }), task("b", { due_date: TODAY }), task("c", { due_date: TODAY }), task("d", { due_date: "2026-11-04" }), task("e")]);
    expect({ overdue: w.overdue, dueToday: w.dueToday, blocked: w.blocked, total: w.total }).toEqual({ overdue: 1, dueToday: 2, blocked: 0, total: 5 });
    expect(w.rows.find((r) => r.id === "e")).toMatchObject({ group: "later", dueText: "No due date" });
  });

  it("says what blocks a task and who can unblock it; a blocked overdue task is listed once, under Overdue", () => {
    const w = build([
      task("b1", { due_date: "2026-10-31", blocked_at: "x", blocked_reason: "Client has not signed", unblock_owner_id: "u2" }),
      task("b2", { blocked_at: "x", blocked_reason: "  ", unblock_owner_id: "ghost" }),
    ]);
    expect(w.rows.filter((r) => r.id === "b1")).toHaveLength(1);
    expect(w.rows.find((r) => r.id === "b1")).toMatchObject({ group: "overdue", blocked: { reason: "Client has not signed", unblockBy: "Omar Ali" } });
    // an unknown person is never named; a blank reason is not shown as nothing
    expect(w.rows.find((r) => r.id === "b2")).toMatchObject({ group: "blocked", blocked: { reason: "No reason given", unblockBy: null } });
    expect(w.blocked).toBe(2);
  });

  it("leaves out a task already sent for review (it waits on someone else) and counts it separately", () => {
    const tasks = [task("a", { due_date: TODAY }), task("r", { status: "ready_for_review", due_date: TODAY })];
    const w = build(tasks);
    expect(w.rows.map((r) => r.id)).toEqual(["a"]);
    expect(w.total).toBe(1);
    expect(tasksInReview(tasks)).toBe(1);
  });

  it("caps the rows but keeps the true total", () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`t${i}`, { due_date: TODAY }));
    const w = build(many, 5);
    expect(w.rows).toHaveLength(5);
    expect(w.total).toBe(12);
    expect(w.dueToday).toBe(12);
  });

  it("is empty for no tasks", () => {
    expect(build([])).toEqual({ rows: [], total: 0, overdue: 0, dueToday: 0, blocked: 0 });
  });
});
