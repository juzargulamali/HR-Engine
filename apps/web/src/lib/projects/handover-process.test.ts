import { describe, expect, it } from "vitest";
import { handoverProcess } from "./handover-process";

const states = (s: string | null) => handoverProcess(s).steps.map((x) => x.state);

describe("handoverProcess", () => {
  it("is the same five steps in the same order, for everyone", () => {
    expect(handoverProcess(null).steps.map((s) => s.label)).toEqual(["Prepare brief", "Submit", "Assign PM", "PM accepts", "Project created"]);
  });

  it("starts at Prepare brief when nothing has been started", () => {
    expect(states(null)).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(states("none")).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });

  it("moves one step at a time with the handover's status", () => {
    expect(states("draft")).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(states("submitted")).toEqual(["done", "done", "current", "todo", "todo"]);
    expect(states("pm_assigned")).toEqual(["done", "done", "done", "current", "todo"]);
    expect(states("accepted")).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("keeps the Project Manager as the one who decides after a clarification, and says Sales must answer", () => {
    const p = handoverProcess("clarification_requested");
    expect(p.steps.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo"]);
    expect(p.steps[3]?.note).toMatch(/Sales to answer/);
    expect(p.next).toMatch(/Sales owner answers/);
  });

  it("starts again after a withdrawal and says nothing was created", () => {
    expect(states("withdrawn")).toEqual(["current", "todo", "todo", "todo", "todo"]);
    expect(handoverProcess("withdrawn").next).toMatch(/Nothing was created/);
  });

  it("treats an unknown status as not started rather than guessing", () => {
    expect(states("something_new")).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });

  it("says who does each step", () => {
    const who = handoverProcess("submitted").steps.map((s) => s.who);
    expect(who[0]).toBe("Sales owner");
    expect(who[2]).toMatch(/Founder/);
    expect(who[3]).toBe("Project Manager");
  });
});
