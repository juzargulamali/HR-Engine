import { describe, expect, it } from "vitest";
import type { ProjGrant } from "@enginious-hr/domain";
import { canChangeStatus, canSeeProjectDetails, laneMoves, laneOf, milestoneProjectIds, moveForLane, nextMilestones, sortDirectory, type DirectoryRowLite } from "./directory";

const row = (over: Partial<DirectoryRowLite> = {}): DirectoryRowLite => ({
  id: "p1", company_id: "c1", name: "Orbit launch", reference: "UAE-P-2026-0001", kind: "client", status: "in_progress", pm_user_id: "pm", pm_name: "Mira", start_date: "2026-11-01", end_date: "2026-12-01", is_member: false, ...over,
});
const founder: ProjGrant[] = [{ companyId: "c1", capabilities: ["founder"] }];
const plain: ProjGrant[] = [{ companyId: "c1", capabilities: [] }];

describe("sortDirectory", () => {
  const rows = [
    row({ id: "a", name: "Beta", reference: "R-2", pm_name: "Zed", status: "on_site", end_date: "2026-12-10" }),
    row({ id: "b", name: "alpha", reference: "R-1", pm_name: null, status: "planning", end_date: null, start_date: null }),
    row({ id: "c", name: "Gamma", reference: "R-3", pm_name: "Amy", status: "in_progress", end_date: "2026-11-05" }),
  ];
  it("sorts by name ignoring case, either way", () => {
    expect(sortDirectory(rows, { key: "name", dir: "asc" }).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortDirectory(rows, { key: "name", dir: "desc" }).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
  it("puts a missing project manager or date last in both directions", () => {
    expect(sortDirectory(rows, { key: "pm", dir: "asc" }).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortDirectory(rows, { key: "pm", dir: "desc" }).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortDirectory(rows, { key: "dates", dir: "asc" }).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortDirectory(rows, { key: "dates", dir: "desc" }).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
  it("sorts by lifecycle order, not alphabetically", () => {
    expect(sortDirectory(rows, { key: "status", dir: "asc" }).map((r) => r.status)).toEqual(["planning", "in_progress", "on_site"]);
  });
  it("sorts by next milestone only with the milestones it was given", () => {
    const due = new Map<string, string | null>([["a", "2026-11-20"], ["c", "2026-11-02"]]);
    expect(sortDirectory(rows, { key: "milestone", dir: "asc" }, due).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
  it("breaks ties by reference and never changes the input", () => {
    const same = [row({ id: "x", reference: "R-10" }), row({ id: "y", reference: "R-9" })];
    expect(sortDirectory(same, { key: "dates", dir: "asc" }).map((r) => r.id)).toEqual(["y", "x"]);
    expect(same.map((r) => r.id)).toEqual(["x", "y"]);
  });
});

describe("who may see a next milestone", () => {
  it("is limited to members and founders of the project's company", () => {
    expect(canSeeProjectDetails(row({ is_member: true }), plain)).toBe(true);
    expect(canSeeProjectDetails(row(), founder)).toBe(true);
    expect(canSeeProjectDetails(row(), plain)).toBe(false);
    expect(canSeeProjectDetails(row({ company_id: "c2" }), founder)).toBe(false);
  });
  it("requests milestones for nobody else (a directory-only person triggers no read at all)", () => {
    const rows = [row({ id: "a" }), row({ id: "b", is_member: true }), row({ id: "c", company_id: "c2" })];
    expect(milestoneProjectIds(rows, plain)).toEqual(["b"]);
    expect(milestoneProjectIds(rows, founder)).toEqual(["a", "b"]);
    expect(milestoneProjectIds(rows, [])).toEqual(["b"]);
    expect(milestoneProjectIds([row({ id: "a" }), row({ id: "c", company_id: "c2" })], plain)).toEqual([]);
  });
});

describe("nextMilestones", () => {
  it("is the earliest dated unfinished milestone of each project", () => {
    const m = nextMilestones([
      { project_id: "p1", title: "Final render", due_date: "2026-12-01", status: "planned" },
      { project_id: "p1", title: "First draft", due_date: "2026-11-03", status: "in_progress" },
      { project_id: "p1", title: "Kick-off", due_date: "2026-10-01", status: "accepted" },
      { project_id: "p1", title: "Cancelled one", due_date: "2026-10-02", status: "cancelled" },
      { project_id: "p1", title: "Undated", due_date: null, status: "planned" },
      { project_id: "p2", title: "Only finished", due_date: "2026-11-01", status: "accepted" },
    ]);
    expect(m.get("p1")).toEqual({ title: "First draft", due: "2026-11-03" });
    expect(m.has("p2")).toBe(false);
  });
});

describe("board lanes and moves", () => {
  it("gives completed and archived projects no lane", () => {
    expect(laneOf("completed")).toBeNull();
    expect(laneOf("archived")).toBeNull();
    expect(laneOf("on_hold")).toBe("on_hold");
  });
  it("lets only the accountable PM or a founder request a status change, never on a finished project", () => {
    expect(canChangeStatus(row({ pm_user_id: "me" }), "me", plain)).toBe(true);
    expect(canChangeStatus(row(), "me", founder)).toBe(true);
    expect(canChangeStatus(row(), "me", plain)).toBe(false);
    expect(canChangeStatus(row({ status: "completed", pm_user_id: "me" }), "me", founder)).toBe(false);
  });
  it("offers a client project every other live lane plus hold, and never Completed", () => {
    const lanes = laneMoves(row({ status: "planning" })).map((m) => m.lane);
    expect(lanes).toEqual(["in_progress", "ready_for_installation", "on_site", "on_hold"]);
    expect(lanes).not.toContain("completed" as never);
  });
  it("offers an internal project only the lanes its kind uses", () => {
    expect(laneMoves(row({ kind: "internal", status: "planning" })).map((m) => m.lane)).toEqual(["in_progress", "on_hold"]);
  });
  it("marks going back, skipping and holding as needing a reason, and holding as needing a review date", () => {
    const m = (to: string) => moveForLane(row({ status: "in_progress" }), to)!;
    expect(m("ready_for_installation").needsReason).toBe(false);
    expect(m("planning").needsReason).toBe(true);
    expect(m("on_site").needsReason).toBe(true);
    expect(m("on_hold")).toMatchObject({ needsReason: true, needsReviewDate: true });
  });
  it("turns any request from a held project into Resume, which returns it to its earlier stage", () => {
    const moves = laneMoves(row({ status: "on_hold" }));
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.move.to === "resume")).toBe(true);
    expect(moves.map((m) => m.lane)).not.toContain("on_hold");
  });
  it("offers nothing for a finished project", () => {
    expect(laneMoves(row({ status: "completed" }))).toEqual([]);
    expect(laneMoves(row({ status: "archived" }))).toEqual([]);
    expect(moveForLane(row({ status: "planning" }), "completed")).toBeNull();
  });
});
