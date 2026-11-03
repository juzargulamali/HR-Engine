import { describe, expect, it } from "vitest";
import { projectDayRows } from "./my-day";

const none = { overdueTasks: 0, dueSoonTasks: 0, reviewsWaiting: 0, handoversWaiting: 0, scopeChangesWaiting: 0, scopeChangeProjectId: null, scopeChangeId: null, unreadMessages: 0, unreadProjects: 0 };

describe("projectDayRows", () => {
  it("is empty when nothing is waiting: no invented rows", () => {
    expect(projectDayRows(none)).toEqual([]);
  });
  it("lists only non-zero rows, handovers and reviews first, and marks what needs the person", () => {
    const rows = projectDayRows({ ...none, overdueTasks: 2, dueSoonTasks: 4, reviewsWaiting: 1, handoversWaiting: 1, unreadMessages: 3, unreadProjects: 2 });
    expect(rows.map((r) => r.key)).toEqual(["proj-handovers", "proj-reviews", "proj-overdue", "proj-soon", "proj-unread"]);
    expect(rows.filter((r) => r.needsYou).map((r) => r.key)).toEqual(["proj-handovers", "proj-reviews", "proj-overdue"]);
  });
  it("uses singular and plural wording and links to the page that handles each", () => {
    const [one] = projectDayRows({ ...none, overdueTasks: 1 });
    expect(one).toMatchObject({ label: "Project task overdue", href: "/projects/work" });
    expect(projectDayRows({ ...none, overdueTasks: 3 })[0]!.label).toBe("Project tasks overdue");
    expect(projectDayRows({ ...none, reviewsWaiting: 2 })[0]!.href).toBe("/projects/work#reviews");
  });
  it("scope changes waiting for the person's decision come after handovers, need them, and open the decision page of the oldest one", () => {
    const rows = projectDayRows({ ...none, handoversWaiting: 1, reviewsWaiting: 1, scopeChangesWaiting: 2, scopeChangeProjectId: "p9", scopeChangeId: "s9" });
    expect(rows.map((r) => r.key)).toEqual(["proj-handovers", "proj-scope", "proj-reviews"]);
    expect(rows[1]).toMatchObject({ label: "Scope changes waiting for your decision", href: "/projects/scope-decisions/s9", needsYou: true });
    expect(projectDayRows({ ...none, scopeChangesWaiting: 1, scopeChangeProjectId: "p9", scopeChangeId: "s9" })[0]!.label).toBe("Scope change waiting for your decision");
  });
});
