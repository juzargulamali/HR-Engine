// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

import { WorkSummary } from "./work-summary";
import type { MilestoneSummary, OutputLine, OutputSummary } from "@/lib/projects/work-summary";

afterEach(cleanup);

// Fictional data only.
const none: MilestoneSummary = { total: 0, accepted: 0, open: 0, overdue: 0, next: null };
const some: MilestoneSummary = { total: 4, accepted: 1, open: 3, overdue: 1, next: { id: "m2", title: "Final render", due: "2027-02-01", status: "in_progress" } };
const counts = { all: 3, next: 1, missing: 1, awaiting: 1, changes: 0, approved: 1 };
const outputs: OutputSummary = { total: 3, counts };
const lines: OutputLine[] = [
  { taskId: "t1", title: "Logo reveal", output: "Logo video", state: "awaiting_review", stateText: "Awaiting Operations review · Lena", tone: "blue", version: 2, href: "/projects/P/work?task=t1&version=v1", assignee: "Cara" },
  { taskId: "t2", title: "Storyboard", output: "Boards", state: "missing", stateText: "Missing", tone: "red", version: null, href: "/projects/P/work?task=t2", assignee: null },
];
const base = { projectId: "P", milestonesHref: "/projects/P/work?ms=1#milestones", outputs, outputLines: lines, outputsMore: 1, outputsFailed: false };

describe("Work summary", () => {
  it("lists the real outputs with their review state and a link to each version", () => {
    render(<WorkSummary {...base} milestones={some} canManage={false} />);
    const row = screen.getByTestId("summary-output-t1");
    expect(within(row).getByRole("link", { name: /Logo reveal/ }).getAttribute("href")).toBe("/projects/P/work?task=t1&version=v1");
    expect(row.textContent).toContain("Awaiting Operations review · Lena · v2");
    expect(screen.getByTestId("summary-output-t2").textContent).toContain("Missing");
    expect(screen.getByRole("link", { name: /1 more, all 3 outputs/ }).getAttribute("href")).toContain("view=deliverables");
    expect(screen.getByTestId("summary-output-counts").textContent).toContain("Outputs awaiting approval 1");
  });
  it("shows milestone progress, the next one and the overdue flag, each linked", () => {
    render(<WorkSummary {...base} milestones={some} canManage />);
    expect(screen.getByTestId("summary-milestone-progress").textContent).toContain("1 of 4 accepted");
    expect(screen.getByTestId("summary-milestone-overdue").textContent).toContain("1 overdue");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByRole("link", { name: "Final render" }).getAttribute("href")).toBe("/projects/P/work?ms=1#milestones");
    expect(screen.queryByTestId("summary-add-milestone")).toBeNull();                          // milestones exist: no empty-state action
  });
  it("gives the Project Manager a small Add milestone action when there are none, and everyone else a short line", () => {
    render(<WorkSummary {...base} milestones={none} canManage addMilestone={<button type="button">Add milestone</button>} />);
    expect(within(screen.getByTestId("summary-add-milestone")).getByRole("button", { name: "Add milestone" })).toBeTruthy();
    expect(screen.getByTestId("summary-milestones-empty").textContent).toBe("No milestones yet.");
    expect(screen.getByTestId("info-hint-milestones")).toBeTruthy();            // the explanation is behind the ⓘ
    cleanup();
    render(<WorkSummary {...base} milestones={none} canManage={false} addMilestone={<button type="button">Add milestone</button>} />);
    expect(screen.queryByTestId("summary-add-milestone")).toBeNull();
    expect(screen.getByTestId("summary-milestones-empty").textContent).toContain("The Project Manager adds them.");
  });
  it("says so when the outputs could not be read, and what to do next when there are none", () => {
    render(<WorkSummary {...base} milestones={none} outputs={null} outputLines={[]} outputsMore={0} outputsFailed canManage={false} />);
    expect(screen.getByTestId("summary-outputs").textContent).toContain("⚠ The task outputs could not be loaded");
    cleanup();
    render(<WorkSummary {...base} milestones={none} outputs={{ total: 0, counts: { ...counts, all: 0 } }} outputLines={[]} outputsMore={0} canManage />);
    expect(screen.getByTestId("summary-outputs").textContent).toContain("Set expected output");
  });
});
