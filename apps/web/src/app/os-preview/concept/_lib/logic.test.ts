import { describe, expect, it } from "vitest";
import { PERSONAS, PROJECTS, TASKS, TIMELINE, EQUIPMENT, projectById, tasksOf, type Persona, type Task } from "./sample";
import {
  isThisWeek, filterTasks, attentionOf, canAcceptReview, canAssign, canEditStatus, filterProjects, isMember, nextActions, overlapMinutes, parallelDays, readProjectFilter,
  siteClashFor, statusRefusal, visibleProjects,
} from "./logic";

const persona = (id: string): Persona => PERSONAS.find((p) => p.id === id)!;
const task = (id: string): Task => TASKS.find((t) => t.id === id)!;
const filter = (qs: string) => readProjectFilter(new URLSearchParams(qs));
const none = () => 0;

describe("who may change what", () => {
  it("a team member changes only their own task and never assigns", () => {
    expect(canEditStatus(persona("member"), task("t5"))).toBe(true); // Sara's
    expect(canEditStatus(persona("member"), task("t3"))).toBe(false); // Hana's
    expect(canAssign(persona("member"), task("t5"))).toBe(false);
  });
  it("a head manages their own team's tasks only", () => {
    expect(canAssign(persona("head"), task("t5"))).toBe(true); // Programming
    expect(canAssign(persona("head"), task("t3"))).toBe(false); // Content
  });
  it("a directory-only colleague changes nothing", () => {
    expect(canEditStatus(persona("directory"), task("t5"))).toBe(false);
  });
  it("nobody accepts their own work", () => {
    expect(canAcceptReview(persona("pm"), task("t2"))).toBe(true);
    expect(canAcceptReview({ ...persona("pm"), personId: "hana" }, task("t2"))).toBe(false);
  });
});

describe("status changes", () => {
  it("done needs a review first for work that is reviewed", () => {
    expect(statusRefusal(persona("pm"), task("t3"), "done")).toMatch(/send it for review first/);
  });
  it("a task with no review step cannot be sent for review", () => {
    expect(statusRefusal(persona("pm"), task("t6"), "review")).toMatch(/does not need a review/);
  });
  it("a blocked task cannot move on until the blocker is resolved", () => {
    expect(statusRefusal(persona("pm"), task("t7"), "doing")).toMatch(/blocked/);
  });
  it("a manager can accept a submitted review, and a plain move is allowed", () => {
    expect(statusRefusal(persona("pm"), task("t2"), "done")).toBeNull();
    expect(statusRefusal(persona("pm"), task("t6"), "doing")).toBeNull();
  });
});

describe("what needs attention", () => {
  const aurora = projectById("aurora")!;
  const notes = attentionOf(aurora, tasksOf("aurora"), TIMELINE.filter((t) => t.projectId === "aurora"), EQUIPMENT.filter((e) => e.projectId === "aurora"));
  it("finds the blocked, review, unassigned, overdue and shortage items of the scenario", () => {
    expect(notes.filter((n) => n.id.startsWith("b-"))).toHaveLength(1);
    expect(notes.filter((n) => n.id.startsWith("r-"))).toHaveLength(3);
    expect(notes.filter((n) => n.id.startsWith("u-"))).toHaveLength(1);
    expect(notes.filter((n) => n.id.startsWith("o-"))).toHaveLength(1);
    expect(notes.filter((n) => n.id.startsWith("e-"))).toHaveLength(1);
  });
  it("the next action is the blocker first, then the review", () => {
    const next = nextActions(persona("pm"), tasksOf("aurora"), TIMELINE.filter((t) => t.projectId === "aurora"), EQUIPMENT.filter((e) => e.projectId === "aurora"));
    expect(next[0]!.id).toBe("b-t7");
    expect(next.map((n) => n.id.slice(0, 2))).toEqual(expect.arrayContaining(["r-", "u-", "e-", "o-"]));
  });
  it("a team member is only asked about their own work, never to assign or review", () => {
    const next = nextActions(persona("member"), tasksOf("aurora"), [], []);
    expect(next.every((n) => n.id === "b-t7" ? false : !n.id.startsWith("u-") && !n.id.startsWith("r-"))).toBe(true);
  });
});

describe("the This week view", () => {
  const aurora = tasksOf("aurora");
  it("is this week plus anything open and overdue, and never counts a finished older task", () => {
    expect(aurora.filter(isThisWeek)).toHaveLength(10);
    expect(isThisWeek(task("t1"))).toBe(false); // done, due 5 Oct
    expect(isThisWeek(task("t10"))).toBe(false); // due 5 Nov
  });
  it("the summary counts come from all tasks: open, needing attention (blocked or unowned or overdue) and awaiting review", () => {
    expect(aurora.filter((t) => t.status !== "done")).toHaveLength(12);
    expect(filterTasks(aurora, { q: "", who: "", status: "", team: "", show: "attention" }, persona("pm"))).toHaveLength(2);
    expect(aurora.filter((t) => t.status === "review")).toHaveLength(3);
  });
});

describe("site bookings and parallel work", () => {
  it("a genuine overlap, with travel and preparation included, is found", () => {
    expect(overlapMinutes({ startTime: "08:00", endTime: "18:00" }, { startTime: "16:00", endTime: "20:00" })).toBe(240);
    expect(overlapMinutes({ startTime: "08:00", endTime: "10:00" }, { startTime: "15:00", endTime: "17:00" })).toBe(0);
  });
  it("the other project is named only to people who can see it", () => {
    const sb1 = TIMELINE.find((t) => t.id === "sb1")!;
    expect(siteClashFor(sb1, persona("founder"))?.other).toMatch(/Harbour/);
    expect(siteClashFor(sb1, persona("pm"))?.other).toMatch(/Harbour/); // Layla manages it
    expect(siteClashFor(sb1, persona("head"))?.other).toBe("another booking you cannot see");
  });
  it("several office tasks on one day are reported as ordinary parallel work, not as a conflict", () => {
    const days = parallelDays(tasksOf("aurora"));
    expect(days.length).toBeGreaterThan(0);
    expect(siteClashFor(TIMELINE.find((t) => t.id === "m5")!, persona("pm"))).toBeNull();
  });
});

describe("lists and access", () => {
  it("completed projects are hidden unless chosen", () => {
    const mine = visibleProjects(persona("pm"), PROJECTS);
    expect(filterProjects(mine, filter(""), none).some((p) => p.stage === "completed")).toBe(false);
    expect(filterProjects(mine, filter("show=completed"), none).map((p) => p.id)).toEqual(["gallery"]);
    expect(filterProjects(mine, filter("show=all"), none).length).toBe(mine.length);
  });
  it("only the founder sees the other company's projects", () => {
    expect(visibleProjects(persona("pm"), PROJECTS).some((p) => p.company === "ksa")).toBe(false);
    expect(visibleProjects(persona("founder"), PROJECTS).some((p) => p.company === "ksa")).toBe(true);
  });
  it("search matches reference, name, client and manager", () => {
    const mine = visibleProjects(persona("founder"), PROJECTS);
    expect(filterProjects(mine, filter("q=ENG-P-0007"), none).map((p) => p.id)).toEqual(["aurora"]);
    expect(filterProjects(mine, filter("q=northgate"), none).map((p) => p.id)).toEqual(["aurora"]);
    expect(filterProjects(mine, filter("q=internal"), none).map((p) => p.id)).toEqual(["showroom"]);
  });
  it("discussion is for project members only", () => {
    const aurora = projectById("aurora")!, harbour = projectById("harbour")!;
    expect(isMember(persona("member"), aurora, tasksOf("aurora"))).toBe(true);
    expect(isMember(persona("member"), harbour, tasksOf("harbour"))).toBe(false);
    expect(isMember(persona("directory"), aurora, tasksOf("aurora"))).toBe(false);
    expect(isMember(persona("pm"), harbour, tasksOf("harbour"))).toBe(true);
  });
});
