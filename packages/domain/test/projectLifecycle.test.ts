import { describe, expect, it } from "vitest";
import { allowedStatusMoves, completionActionsFor, isFinishedProject, liveStatusesFor, milestoneProgress } from "../src";

describe("project lifecycle", () => {
  it("offers client projects the install and show states and internal projects only planning and in progress", () => {
    expect(liveStatusesFor("client")).toEqual(["planning", "in_progress", "ready_for_installation", "on_site"]);
    expect(liveStatusesFor("internal")).toEqual(["planning", "in_progress"]);
    const internal = allowedStatusMoves("internal", "in_progress").map((m) => m.to);
    expect(internal).not.toContain("on_site");
    expect(internal).not.toContain("ready_for_installation");
  });
  it("makes the next step free and a step back or a skip need a reason", () => {
    const moves = allowedStatusMoves("client", "in_progress");
    expect(moves.find((m) => m.to === "ready_for_installation")?.needsReason).toBe(false);
    expect(moves.find((m) => m.to === "planning")?.needsReason).toBe(true);
    expect(moves.find((m) => m.to === "on_site")?.needsReason).toBe(true);
  });
  it("needs a reason and a review date to hold, and offers resume while held", () => {
    const hold = allowedStatusMoves("client", "planning").find((m) => m.to === "on_hold");
    expect(hold).toMatchObject({ needsReason: true, needsReviewDate: true });
    expect(allowedStatusMoves("client", "on_hold").map((m) => m.to)).toEqual(["resume"]);
  });
  it("never offers Completed as a plain move, and archives only a completed project", () => {
    for (const s of ["planning", "in_progress", "ready_for_installation", "on_site"]) expect(allowedStatusMoves("client", s).map((m) => m.to)).not.toContain("completed");
    expect(allowedStatusMoves("client", "completed").map((m) => m.to)).toEqual(["archived"]);
    expect(allowedStatusMoves("client", "archived")).toEqual([]);
    expect(isFinishedProject("completed") && isFinishedProject("archived") && !isFinishedProject("on_hold")).toBe(true);
  });
  it("states progress with its basis and never invents a percentage", () => {
    expect(milestoneProgress(0, 0)).toBeNull();
    expect(milestoneProgress(2, 5)).toMatchObject({ percent: 40, basis: "2 of 5 required milestones accepted" });
    expect(milestoneProgress(1, 1)?.basis).toBe("1 of 1 required milestone accepted");
    expect(milestoneProgress(9, 5)?.percent).toBe(100);
  });
  it("offers only explicit resolutions for unfinished work, never Done", () => {
    for (const kind of ["task", "deliverable", "milestone", "feedback", "booking"] as const) {
      expect(completionActionsFor(kind).map((a) => a.id)).not.toContain("done");
    }
    expect(completionActionsFor("booking").map((a) => a.id)).toEqual(["cancel"]);
  });
});
