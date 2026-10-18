import { describe, expect, it } from "vitest";
import { filterDirectory, groupTasksByDue, handoverWaitsOnMe, isWaitingOnMyReview, type DirectoryItem } from "./work-logic";

describe("groupTasksByDue", () => {
  const tasks = [
    { id: "a", due_date: "2026-10-10" }, { id: "b", due_date: "2026-10-18" }, { id: "c", due_date: "2026-10-24" },
    { id: "d", due_date: "2026-10-25" }, { id: "e", due_date: null }, { id: "f", due_date: "2026-10-01" },
  ];
  const g = groupTasksByDue(tasks, "2026-10-18");
  it("separates overdue, the next 7 days (today included), later and undated, each ordered by date", () => {
    expect(g.overdue.map((t) => t.id)).toEqual(["f", "a"]);
    expect(g.soon.map((t) => t.id)).toEqual(["b", "c"]);
    expect(g.later.map((t) => t.id)).toEqual(["d"]);
    expect(g.undated.map((t) => t.id)).toEqual(["e"]);
  });
  it("treats today as due, not overdue, across a month boundary", () => {
    const x = groupTasksByDue([{ id: "t", due_date: "2026-11-02" }], "2026-10-31");
    expect(x.soon).toHaveLength(1);
    expect(x.overdue).toHaveLength(0);
  });
});

describe("isWaitingOnMyReview", () => {
  const ctx = { userId: "me", isFounder: false, isPm: false, isActingPm: false, headOfTeamIds: ["t1"] };
  const task = { status: "ready_for_review", assignee_id: "other", team_id: "t1" };
  it("waits on the head of the task's team, the PM, temporary leaders and founders", () => {
    expect(isWaitingOnMyReview(task, ctx)).toBe(true);
    expect(isWaitingOnMyReview({ ...task, team_id: "t2" }, ctx)).toBe(false);
    expect(isWaitingOnMyReview({ ...task, team_id: "t2" }, { ...ctx, isPm: true })).toBe(true);
    expect(isWaitingOnMyReview({ ...task, team_id: null }, { ...ctx, isActingPm: true })).toBe(true);
    expect(isWaitingOnMyReview({ ...task, team_id: null }, { ...ctx, isFounder: true })).toBe(true);
  });
  it("never asks a person to review their own work, or a task not ready for review", () => {
    expect(isWaitingOnMyReview({ ...task, assignee_id: "me" }, { ...ctx, isPm: true })).toBe(false);
    expect(isWaitingOnMyReview({ ...task, status: "in_progress" }, ctx)).toBe(false);
  });
});

describe("filterDirectory", () => {
  const rows: DirectoryItem[] = [
    { company_id: "c1", reference: "UAE-P-2026-0001", name: "Floor projection", kind: "client", status: "in_progress", pm_name: "Rafi", start_date: null, end_date: null },
    { company_id: "c1", reference: "UAE-P-2026-0002", name: "Showroom tech", kind: "internal", status: "planning", pm_name: "Amira", start_date: null, end_date: null },
    { company_id: "c2", reference: "KSA-P-2026-0001", name: "LED tunnel", kind: "client", status: "completed", pm_name: "Daniel", start_date: null, end_date: null },
  ];
  const f = { q: "", company: "", kind: "", status: "", view: "live" as const };
  it("keeps live and finished projects apart", () => {
    expect(filterDirectory(rows, f).map((r) => r.reference)).toEqual(["UAE-P-2026-0001", "UAE-P-2026-0002"]);
    expect(filterDirectory(rows, { ...f, view: "finished" }).map((r) => r.reference)).toEqual(["KSA-P-2026-0001"]);
  });
  it("filters by company, kind, status and a search over reference, name and PM", () => {
    expect(filterDirectory(rows, { ...f, kind: "internal" })).toHaveLength(1);
    expect(filterDirectory(rows, { ...f, company: "c2" })).toHaveLength(0);
    expect(filterDirectory(rows, { ...f, status: "planning" })[0]!.name).toBe("Showroom tech");
    expect(filterDirectory(rows, { ...f, q: "rafi" })).toHaveLength(1);
    expect(filterDirectory(rows, { ...f, q: "0002" })).toHaveLength(1);
  });
});

describe("handoverWaitsOnMe", () => {
  const canAssign = (c: string) => c === "c1";
  it("submitted waits on someone who can assign a PM; assigned waits on its PM only", () => {
    expect(handoverWaitsOnMe({ status: "submitted", pm_user_id: null, company_id: "c1" }, "me", canAssign)).toBe(true);
    expect(handoverWaitsOnMe({ status: "submitted", pm_user_id: null, company_id: "c2" }, "me", canAssign)).toBe(false);
    expect(handoverWaitsOnMe({ status: "pm_assigned", pm_user_id: "me", company_id: "c2" }, "me", canAssign)).toBe(true);
    expect(handoverWaitsOnMe({ status: "pm_assigned", pm_user_id: "x", company_id: "c1" }, "me", canAssign)).toBe(false);
    expect(handoverWaitsOnMe({ status: "draft", pm_user_id: "me", company_id: "c1" }, "me", canAssign)).toBe(false);
  });
});
