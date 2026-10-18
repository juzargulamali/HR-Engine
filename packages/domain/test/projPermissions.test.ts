import { describe, expect, it } from "vitest";
import {
  allowedTaskMoves, canCreateTaskFor, canManageProject, canViewProjectDetails, canViewProjectSummary, hasProjCapability, hasAnyProjAccess,
  isProjFounder, projectViewLevel, taskActorRole, type ProjectStanding, type ProjGrant, type TaskRef,
} from "../src";

const UAE = "co-uae";
const KSA = "co-ksa";
const grant = (companyId: string, ...capabilities: ProjGrant["capabilities"][number][]): ProjGrant => ({ companyId, capabilities });

function standing(over: Partial<ProjectStanding> = {}): ProjectStanding {
  return { companyId: UAE, grants: [], isPm: false, isMember: false, isActingPm: false, headOfTeamIds: [], isSalesLinked: false, status: "in_progress", ...over };
}

describe("Projects capabilities", () => {
  it("treats founder as every capability, per company only", () => {
    const g = [grant(UAE, "founder")];
    expect(hasProjCapability(g, UAE, "assign_pm")).toBe(true);
    expect(hasProjCapability(g, KSA, "assign_pm")).toBe(false);
    expect(isProjFounder(g, UAE)).toBe(true);
    expect(isProjFounder([grant(UAE, "assign_pm")], UAE)).toBe(false);
  });
  it("gives an empty grant access to the directory and nothing else", () => {
    expect(hasAnyProjAccess([grant(UAE)])).toBe(true);
    expect(hasProjCapability([grant(UAE)], UAE, "view_audit")).toBe(false);
  });
});

describe("what a person can see of one project (mirrors proj_can_view_*)", () => {
  it("shows founders everything in their own company only", () => {
    expect(projectViewLevel(standing({ grants: [grant(UAE, "founder")] }))).toBe("details");
    expect(projectViewLevel(standing({ grants: [grant(KSA, "founder")] }))).toBe("none");
  });
  it("shows a directory-only user ongoing projects in summary, not finished ones, never details", () => {
    expect(projectViewLevel(standing({ grants: [grant(UAE)] }))).toBe("summary");
    expect(projectViewLevel(standing({ grants: [grant(UAE)], status: "completed" }))).toBe("none");
    expect(canViewProjectDetails(standing({ grants: [grant(UAE)] }))).toBe(false);
  });
  it("shows members details, including after completion", () => {
    expect(projectViewLevel(standing({ grants: [grant(UAE)], isMember: true, status: "completed" }))).toBe("details");
  });
  it("shows a Sales-linked person only the summary, even of a finished project", () => {
    const s = standing({ isSalesLinked: true, status: "completed" });
    expect(canViewProjectSummary(s)).toBe(true);
    expect(canViewProjectDetails(s)).toBe(false);
  });
  it("gives an HR role, or a plain employee, nothing", () => {
    expect(projectViewLevel(standing())).toBe("none");
  });
});

describe("who can manage a project", () => {
  it("allows founder, PM and unexpired temporary leader; not a head or a member", () => {
    expect(canManageProject(standing({ grants: [grant(UAE, "founder")] }))).toBe(true);
    expect(canManageProject(standing({ isPm: true, isMember: true }))).toBe(true);
    expect(canManageProject(standing({ isActingPm: true, isMember: true }))).toBe(true);
    expect(canManageProject(standing({ isMember: true, headOfTeamIds: ["t1"] }))).toBe(false);
    expect(canManageProject(standing({ isMember: true }))).toBe(false);
  });
});

const task = (over: Partial<TaskRef> = {}): TaskRef => ({ assigneeId: "u-member", teamId: "t1", requiresReview: false, status: "todo", blocked: false, ...over });

describe("task roles and moves (mirrors proj_set_task_status)", () => {
  const member = standing({ isMember: true });
  const head = standing({ isMember: true, headOfTeamIds: ["t1"] });
  const pm = standing({ isMember: true, isPm: true });

  it("resolves manager over head over assignee, and nobody else", () => {
    expect(taskActorRole(pm, "u-pm", task())).toBe("manager");
    expect(taskActorRole(head, "u-head", task())).toBe("head");
    expect(taskActorRole(member, "u-member", task())).toBe("assignee");
    expect(taskActorRole(member, "u-other", task())).toBeNull();
    expect(taskActorRole(head, "u-head", task({ teamId: "t2" }))).toBeNull();
  });
  it("lets the owner finish a routine task and offers nothing to a stranger", () => {
    const moves = allowedTaskMoves("assignee", "u-member", task({ status: "in_progress" })).map((m) => m.to);
    expect(moves).toContain("done");
    expect(allowedTaskMoves(null, "u-x", task())).toEqual([]);
  });
  it("does not let the owner complete a task that needs review, and lets a different reviewer", () => {
    const own = allowedTaskMoves("assignee", "u-member", task({ requiresReview: true, status: "ready_for_review" })).map((m) => m.to);
    expect(own).not.toContain("done");
    expect(own).toContain("in_progress");
    const review = allowedTaskMoves("head", "u-head", task({ requiresReview: true, status: "ready_for_review" }));
    expect(review.map((m) => m.to)).toContain("done");
    expect(review.find((m) => m.label === "Request changes")?.needsNote).toBe(true);
  });
  it("never lets a reviewer review their own work", () => {
    const selfAssigned = allowedTaskMoves("head", "u-head", task({ assigneeId: "u-head", requiresReview: true, status: "ready_for_review" })).map((m) => m.to);
    expect(selfAssigned).not.toContain("done");
  });
  it("hides Mark done while a task is blocked, and requires a note to reopen, defer or cancel", () => {
    expect(allowedTaskMoves("assignee", "u-member", task({ status: "in_progress", blocked: true })).map((m) => m.to)).not.toContain("done");
    const lead = allowedTaskMoves("manager", "u-pm", task({ status: "in_progress" }));
    expect(lead.find((m) => m.to === "cancelled")?.needsNote).toBe(true);
    expect(allowedTaskMoves("manager", "u-pm", task({ status: "done" })).every((m) => m.needsNote)).toBe(true);
    expect(allowedTaskMoves("assignee", "u-member", task({ status: "done" }))).toEqual([]);
  });
});

describe("creating tasks (mirrors proj_create_task)", () => {
  it("lets a member create only for themselves, in their own team or none", () => {
    const m = standing({ isMember: true });
    expect(canCreateTaskFor(m, "u1", "u1", null, "t1")).toBe(true);
    expect(canCreateTaskFor(m, "u1", "u1", "t1", "t1")).toBe(true);
    expect(canCreateTaskFor(m, "u1", "u1", "t2", "t1")).toBe(false);
    expect(canCreateTaskFor(m, "u1", "u2", null, "t1")).toBe(false);
  });
  it("lets a head distribute inside their team and the PM anywhere, and a non-member nothing", () => {
    expect(canCreateTaskFor(standing({ isMember: true, headOfTeamIds: ["t1"] }), "h", "u2", "t1", null)).toBe(true);
    expect(canCreateTaskFor(standing({ isMember: true, isPm: true }), "p", "u2", "t9", null)).toBe(true);
    expect(canCreateTaskFor(standing({ grants: [grant(UAE)] }), "d", "d", null, null)).toBe(false);
  });
});
