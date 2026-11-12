// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/lib/actions/projectsEquipmentReview", () => ({ resolveEquipmentReview: vi.fn(async () => ({ error: null })) }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => {} }));

import { EquipmentReviewPanel, ReadinessLine, ReleaseFailedNotice, StillOutNotice } from "./equipment-readiness";
import type { EquipmentReview, RequestReadiness } from "@/lib/projects/equipment-readiness-model";

afterEach(cleanup);

// Fictional data only.
const review = (over: Partial<EquipmentReview> = {}): EquipmentReview => ({ id: "v1", requestId: "q1", requestCode: "REQ-0101", field: "install_start", oldDate: "2026-11-19", newDate: "2026-11-17", changedAt: "2026-11-10T08:00:00Z", changedBy: "Fictional Pia", ...over });
const request = (over: Partial<RequestReadiness> = {}): RequestReadiness => ({ id: "q1", code: "REQ-0101", status: "in_progress", state: "partially_ready", lines: 5, reservedLines: 3, partialLines: 0, shortLines: 2, shortBuy: 1, shortRent: 0,
  shortNoPlan: 1, dispatchedLines: 0, returnedLines: 0, unitsAsked: 9, unitsShort: 3, unitsDispatched: 0, unitsReturned: 0, unitsOut: 0, neededFrom: null, neededUntil: null, expectedReturnAt: null, returnOverdue: false, ...over });

describe("Review equipment booking", () => {
  it("says which date changed, what it was and is, who changed it, and links to the request where the warehouse changes dates", () => {
    render(<EquipmentReviewPanel reviews={[review(), review({ id: "v2", field: "event_end", oldDate: "2026-11-24", newDate: "2026-11-26" })]} projectId="p1" canReview />);
    expect(screen.getByRole("heading", { name: "Review equipment booking" })).toBeTruthy();
    const text = screen.getByTestId("equipment-reviews").textContent ?? "";
    expect(text).toContain("REQ-0101 · Installation start · was 19 Nov 2026 · now 17 Nov 2026");
    expect(text).toContain("Event end · was 24 Nov 2026 · now 26 Nov 2026");
    expect(text).toContain("Changed by Fictional Pia on");
    expect(screen.getByText("The booking has not been changed. The warehouse changes it on the request, where conflicts are checked.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open request REQ-0101 to change its dates" })[0]!.getAttribute("href")).toBe("/inventory/requests/q1");
    expect(screen.getAllByRole("button", { name: "Mark as reviewed" })).toHaveLength(2);
    expect(screen.getAllByLabelText("Note (optional)")).toHaveLength(2);
  });
  it("offers no button to someone who cannot mark it, and draws nothing when there is no review", () => {
    const { container, unmount } = render(<EquipmentReviewPanel reviews={[review()]} projectId="p1" canReview={false} />);
    expect(screen.queryByRole("button", { name: "Mark as reviewed" })).toBeNull();
    expect(container.textContent).toContain("The Project Manager or the warehouse marks this as reviewed.");
    unmount();
    expect(render(<EquipmentReviewPanel reviews={[]} projectId="p1" canReview />).container.innerHTML).toBe("");
  });
});

describe("readiness and finished projects", () => {
  it("a request's Readiness line gives the state in a word and the short lines by plan", () => {
    render(<ReadinessLine request={request()} />);
    expect(screen.getByTestId("readiness-q1").textContent).toBe("Readiness: Partly ready · 3 of 5 lines reserved · 2 lines short: 1 to buy, 1 with no plan yet");
  });
  it("a finished project with equipment out: the heading, the units out, the expected return and overdue", () => {
    render(<StillOutNotice out={{ units: 3, overdue: true, requests: [{ id: "q1", code: "REQ-0101", unitsOut: 3, expectedReturnAt: "2026-11-01T08:00:00Z", overdue: true }] }} />);
    const text = screen.getByTestId("equipment-still-out").textContent ?? "";
    expect(text).toContain("Delivery complete · equipment still out");
    expect(text).toMatch(/Request REQ-0101: 3 units out · expected back .* · overdue/);
  });
  it("a failed release says so, when, and who puts it right, with the link to the request", () => {
    render(<ReleaseFailedNotice failed={{ at: "2026-11-09T10:00:00Z", detail: "Releasing equipment at project completed failed: fictional reason" }} requests={[{ id: "q1", code: "REQ-0101" }]} />);
    const text = screen.getByTestId("equipment-release-failed").textContent ?? "";
    expect(text).toContain("Releasing unused reservations failed when the project finished.");
    expect(text).toContain("Ask the warehouse to release the unused lines on the request.");
    expect(text).not.toContain("were released");
    expect(screen.getByRole("link", { name: "Open request REQ-0101" }).getAttribute("href")).toBe("/inventory/requests/q1");
  });
});
