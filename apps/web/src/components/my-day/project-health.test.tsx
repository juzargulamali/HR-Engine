/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

import { HEALTH_TITLE, ProjectHealth } from "./project-health";
import type { Portfolio } from "@/lib/my-day/loaders";

afterEach(cleanup);

const delivery = { days: [], todayCol: null, rows: [], moreProjects: 0 };
const portfolio = (over: Partial<Portfolio> = {}): Portfolio => ({ activeCount: 5, summaryOnlyCount: 0, health: { blocked: 1, at_risk: 2, on_track: 2 }, delivery, ...over });

describe("My Day: task and milestone health", () => {
  it("is named for what it measures, never 'Project status'", () => {
    render(<ProjectHealth portfolio={portfolio()} />);
    expect(HEALTH_TITLE).toBe("Task & milestone health");
    expect(screen.getByRole("heading", { name: "Task & milestone health" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Task & milestone health by deadlines and blockers" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Project status/);
    // The short rule stays printed on the card; the count of projects that need a look is blocked + at risk.
    expect(document.body.textContent).toMatch(/Blocked: a task is marked blocked\. At risk: a task or milestone is past its due date\. Otherwise on track\./);
    expect(document.body.textContent).toMatch(/3\s*need a look/);
    expect(screen.getByRole("link", { name: "View projects" }).getAttribute("href")).toBe("/projects");
  });

  it("states the exact definition behind the ⓘ", () => {
    render(<ProjectHealth portfolio={portfolio()} />);
    fireEvent.click(screen.getByTestId("project-health-hint"));
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Blocked: an open task is marked blocked\./);
    expect(text).toMatch(/At risk: an open task or an open milestone is past its due date\./);
    expect(text).toMatch(/On track: neither of those\./);
    expect(text).toMatch(/project's own status .* are not part of it/);
  });

  it("says it could not load, and does not show zero, when the read failed", () => {
    render(<ProjectHealth portfolio="error" />);
    expect(document.body.textContent).toMatch(/Task and milestone health could not be loaded right now/);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("counts summary-only projects apart instead of guessing a group", () => {
    render(<ProjectHealth portfolio={portfolio({ summaryOnlyCount: 2 })} />);
    expect(document.body.textContent).toMatch(/2 projects you see only as a summary are not grouped\./);
  });
});
