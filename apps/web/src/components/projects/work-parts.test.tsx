// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

import { mergeActivity, RecentActivity, type ActivityLine } from "./work-parts";

afterEach(cleanup);

// Fictional data only. `log` is the change log (dates, status, people); `overview` is the output, review and site changes.
const log: ActivityLine[] = [
  { key: "1", subject: "Milestone: Final render", sentence: "Due date moved to 12 Nov 2027", when: "10 Nov 2027, 09:00", who: "Fictional Pm", href: "/projects/p1/work?ms=1#milestone-list", at: "2027-11-10T05:00:00.000+00:00" },
  { key: "2", subject: "Project status", sentence: "Planning to Active", when: "8 Nov 2027, 12:00", who: "Recorded by the system", href: "/projects/p1/history", at: "2027-11-08T08:00:00+00:00" },
];
const overview: ActivityLine[] = [
  { key: "o-1", subject: "Fictional Eli submitted v2 of Storyboard", when: "10 Nov 2027, 10:05 Asia/Dubai", at: "2027-11-10T06:05:00Z" },
  { key: "o-2", subject: "Fictional Cara confirmed Setup", when: "9 Nov 2027, 14:00 Asia/Dubai", at: "2027-11-09T10:00:00Z" },
];

describe("Work: one Recent activity block", () => {
  it("merges both sources by time, newest first, whatever way each writes the instant", () => {
    expect(mergeActivity(log, overview).map((l) => l.key)).toEqual(["o-1", "1", "o-2", "2"]);
    expect(mergeActivity(log, [])).toEqual(log);
    // A date that cannot be read sorts last and nothing is dropped.
    expect(mergeActivity([{ ...log[0]!, key: "x", at: "not a date" }], overview).map((l) => l.key)).toEqual(["o-1", "o-2", "x"]);
  });

  it("shows every line of both sources under one heading with one link to History", () => {
    render(<RecentActivity lines={mergeActivity(log, overview)} failed={[]} historyHref="/projects/p1/history" />);
    const block = screen.getByTestId("recent-activity");
    expect(within(block).getAllByRole("heading")).toHaveLength(1);
    expect(within(block).getByRole("heading").textContent).toMatch(/^Recent activity/);
    expect(within(block).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Fictional Eli submitted v2 of Storyboard10 Nov 2027, 10:05 Asia/Dubai",
      "Milestone: Final renderDue date moved to 12 Nov 2027Fictional Pm · 10 Nov 2027, 09:00",
      "Fictional Cara confirmed Setup9 Nov 2027, 14:00 Asia/Dubai",
      "Project statusPlanning to ActiveRecorded by the system · 8 Nov 2027, 12:00",
    ]);
    expect(within(block).getAllByRole("link", { name: "Full history" })).toHaveLength(1);
    expect(within(block).getByRole("link", { name: "Full history" }).getAttribute("href")).toBe("/projects/p1/history");
    // A change-log line opens its record; an overview line has no page of its own, so it is plain text, never a dead link.
    expect(within(block).getByRole("link", { name: "Milestone: Final render" }).getAttribute("href")).toBe("/projects/p1/work?ms=1#milestone-list");
    expect(within(block).queryByRole("link", { name: /submitted v2/ })).toBeNull();
    expect(block.textContent).not.toMatch(/Recent changes/);
  });

  it("says which part could not load and still lists the other part", () => {
    render(<RecentActivity lines={overview} failed={["the changes to dates, status and people"]} historyHref="/h" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Could not load the changes to dates, status and people\./);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("never reads as empty when both parts failed, and reads as empty only when both loaded with nothing", () => {
    const { unmount } = render(<RecentActivity lines={[]} failed={["the changes to dates, status and people", "the output, review and site changes"]} historyHref="/h" />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/is recorded yet/);
    unmount();
    render(<RecentActivity lines={[]} failed={[]} historyHref="/h" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).toMatch(/is recorded yet/);
  });
});
