import { describe, expect, it } from "vitest";
import { blockers, holdReviewState, nextUp, resolutionSummary, workCounts, type TaskLite } from "./overview-helpers";

const task = (over: Partial<TaskLite>): TaskLite => ({ id: "t", title: "T", status: "todo", due_date: null, blocked_at: null, blocked_reason: null, assignee_id: "u", unblock_owner_id: null, unblock_action: null, ...over });

describe("workCounts", () => {
  it("counts only real open work, by plain date compare", () => {
    const c = workCounts({
      tasks: [task({ due_date: "2099-01-01" }), task({ due_date: "2099-01-02", blocked_at: "x" }), task({ status: "done", due_date: "2000-01-01" }), task({ status: "cancelled", due_date: "2000-01-01" })],
      milestones: [{ id: "m", title: "m", status: "planned", due_date: null, is_required: true }, { id: "m2", title: "m2", status: "accepted", due_date: null, is_required: true }],
      feedback: [{ status: "open" }, { status: "resolved" }], bookings: [{ state: "confirmed", ends_at: "2099-01-01T00:00:00Z" }, { state: "cancelled", ends_at: "2099-01-01T00:00:00Z" }, { state: "tentative", ends_at: "2000-01-01T00:00:00Z" }],
      today: "2099-01-02", nowIso: "2050-01-01T00:00:00Z",
    });
    expect(c).toEqual({ openTasks: 2, blockedTasks: 1, overdueTasks: 1, unacceptedMilestones: 1, openFeedback: 1, upcomingBookings: 1 });
  });
  it("treats a task due today as not overdue", () => {
    expect(workCounts({ tasks: [task({ due_date: "2099-01-02" })], milestones: [], feedback: [], bookings: [], today: "2099-01-02", nowIso: "" }).overdueTasks).toBe(0);
  });
});

describe("nextUp", () => {
  it("lists unfinished dated milestones and deliverables soonest first, limited, flagging overdue", () => {
    const items = nextUp(
      [{ id: "1", title: "A", status: "planned", due_date: "2099-03-01", is_required: true }, { id: "2", title: "B", status: "accepted", due_date: "2099-01-01", is_required: true }, { id: "3", title: "C", status: "planned", due_date: null, is_required: true }],
      [{ id: "4", title: "D", status: "open", due_date: "2098-12-30" }, { id: "5", title: "E", status: "cancelled", due_date: "2098-12-01" }],
      "2099-01-01", 5,
    );
    expect(items.map((i) => [i.kind, i.title, i.overdue])).toEqual([["Deliverable", "D", true], ["Milestone", "A", false]]);
    expect(nextUp(items.map((i) => ({ id: i.id, title: i.title, status: "planned", due_date: i.due, is_required: true })), [], "2000-01-01", 1)).toHaveLength(1);
  });
});

describe("other summaries", () => {
  it("finds only open blocked tasks", () => {
    expect(blockers([task({ blocked_at: "x" }), task({ blocked_at: "x", status: "done" }), task({})])).toHaveLength(1);
  });
  it("summarises completion resolutions in words", () => {
    expect(resolutionSummary([])).toBe("Nothing was left unfinished.");
    expect(resolutionSummary([{ kind: "task", action: "cancel" }, { kind: "task", action: "cancel" }, { kind: "feedback", action: "defer" }])).toBe("3 unfinished items decided at completion: 2 cancelled, 1 deferred.");
  });
  it("classifies a hold review date", () => {
    expect(holdReviewState("2099-01-01", "2099-01-02")).toBe("overdue");
    expect(holdReviewState("2099-01-02", "2099-01-02")).toBe("today");
    expect(holdReviewState("2099-01-03", "2099-01-02")).toBe("upcoming");
    expect(holdReviewState(null, "2099-01-02")).toBe("none");
  });
});
