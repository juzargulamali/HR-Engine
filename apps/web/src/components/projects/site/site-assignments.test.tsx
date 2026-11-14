// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
import { SiteAssignmentList } from "./site-assignments";
import { SiteAssignmentsCard } from "@/components/my-day/site-assignments-card";
import type { SiteAssignment } from "@/lib/projects/site-assignments";

afterEach(cleanup);

const phase = (o: Partial<NonNullable<SiteAssignment["phase"]>> = {}): NonNullable<SiteAssignment["phase"]> => ({ phase: "scheduled", basis: "project_header", first_day: "2027-11-11", last_day: "2027-11-11", started_at: null, kind: "setup", state: "tentative", today: "2027-11-01", ...o });
const card = (o: Partial<SiteAssignment> = {}): SiteAssignment => ({
  assignment_id: "as1", activity_id: "11111111-1111-4111-8111-111111111111", project_name: "Fictional expo", title: "Setup", run_label: "Run 1", kind: "setup", state: "tentative", role: "installation", location: null, start_date: null, end_date: null, starts_at: null, ends_at: null,
  tz: "Asia/Dubai", call_at: null, call_tz: null, instructions: "Bring a hard hat", crew_instructions: null, ready: { hardware: "unknown", content: "unknown", app: "unknown", note: null }, hardware_state: null, site_only: true,
  phase: phase(), contact: { name: "Fictional Eli", role: "Site lead" }, reporting: { complete: false, missing: ["venue", "call_time"] },
  effective: { venue: null, venue_source: null, start_date: "2027-11-11", end_date: "2027-11-11", date_source: "project", choice_pending: false, project_start: "2027-11-11", project_end: "2027-11-11" },
  ready_effective: { hardware: { state: "not_ready", source: "run", detail: "0 of 1 ready" }, content: { state: "not_recorded", source: null }, app: { state: "not_applicable", source: "pm" },
    project: { hardware: { state: "ready", detail: "3 of 3 ready" }, content: { state: "not_ready", detail: "1 of 2 approved" }, app: { state: "not_recorded" } } }, ...o });

describe("the crew card on a phone", () => {
  it("leads with the phase and what is still to come, then call time, venue and who to ask, and only then instructions and readiness", () => {
    render(<SiteAssignmentList rows={[card()]} />);
    const el = screen.getByTestId("site-assignment-11111111-1111-4111-8111-111111111111");
    const order = ["sa-phase", "sa-reporting", "sa-call", "sa-venue", "sa-contact", "sa-instructions", "sa-ready"].map((id) => within(el).getByTestId(id));
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("sa-phase").textContent).toBe("Tentative Setup on 11 Nov (from the project header)");
    expect(screen.getByTestId("sa-reporting").textContent).toMatch(/Still to come: the venue, your call time/);
    expect(screen.getByTestId("sa-contact").textContent).toBe("Site lead: Fictional Eli");
    expect(screen.getByTestId("sa-call").textContent).toMatch(/Not set yet/);
    expect(screen.queryByTestId("sa-provisional")).toBeNull();                                                  // the date has not passed
  });
  it("names the Project Manager when the activity has no site lead, and says when the details are complete", () => {
    render(<SiteAssignmentList rows={[card({ contact: { name: "Fictional Sam", role: "Project Manager" }, reporting: { complete: true, missing: [] }, state: "confirmed", phase: phase({ state: "confirmed" }) })]} />);
    expect(screen.getByTestId("sa-contact").textContent).toBe("Project Manager: Fictional Sam");
    expect(screen.getByTestId("sa-reporting").textContent).toMatch(/Reporting details complete/);
  });
  it("a tentative assignment whose date has passed, with details missing, says who to contact; a complete or confirmed one does not", () => {
    const passed = phase({ phase: "date_passed", basis: "activity" });
    render(<SiteAssignmentList rows={[card({ phase: passed })]} />);
    expect(screen.getByTestId("sa-phase").textContent).toBe("Scheduled installation date passed · start unconfirmed");
    expect(screen.getByTestId("sa-provisional").textContent).toBe("Provisional date passed · contact Fictional Eli for updated details");
    cleanup();
    render(<SiteAssignmentList rows={[card({ phase: passed, reporting: { complete: true, missing: [] } })]} />);
    expect(screen.queryByTestId("sa-provisional")).toBeNull();
    cleanup();
    render(<SiteAssignmentList rows={[card({ phase: { ...passed, state: "confirmed" }, state: "confirmed" })]} />);
    expect(screen.queryByTestId("sa-provisional")).toBeNull();
  });
  it("only an explicit record reads started", () => {
    render(<SiteAssignmentList rows={[card({ phase: phase({ phase: "started", basis: "activity", started_at: "2027-11-11T06:00:00Z" }) })]} />);
    expect(screen.getByTestId("sa-phase").textContent).toBe("Installation started 11 Nov");
  });
  it("shows this run's readiness, with its source, apart from the project-wide line", () => {
    render(<SiteAssignmentList rows={[card()]} />);
    expect(screen.getByTestId("sa-ready-detail").textContent).toMatch(/Hardware: Not ready \(0 of 1 ready, linked to this run\)/);
    expect(screen.getByTestId("sa-ready").textContent).toMatch(/Content: not recorded/);
    expect(screen.getByTestId("sa-ready").textContent).toMatch(/App: not applicable/);
    expect(screen.getByTestId("sa-project-ready").textContent).toBe("Project-wide readiness: hardware ready (3 of 3 ready), content not ready (1 of 2 approved), app not recorded");
    expect(screen.getByTestId("sa-ready-detail").textContent).not.toMatch(/3 of 3/);                            // the project's counts never read as this run's
  });
  it("highlights the card a change notice linked to, and shows what moved only on that card", () => {
    const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    render(<SiteAssignmentList rows={[card(), card({ assignment_id: "as2", activity_id: other })]} highlightId={id} changes={{ [id]: [{ field: "date", from: "11 Nov 2027", to: "12 Nov 2027" }, { field: "call time", from: "not set", to: "12 Nov 2027 07:00 Asia/Dubai" }] }} />);
    const a = screen.getByTestId(`site-assignment-${id}`), b = screen.getByTestId(`site-assignment-${other}`);
    expect(a.getAttribute("data-highlighted")).toBe("true"); expect(b.getAttribute("data-highlighted")).toBeNull();
    expect(a.id).toBe(`sa-${id}`);
    expect(within(a).getByTestId("sa-changed").textContent).toMatch(/Changed: date · 11 Nov 2027 → 12 Nov 2027/);
    expect(within(a).getByTestId("sa-changed").textContent).toMatch(/Changed: call time · not set → 12 Nov 2027 07:00 Asia\/Dubai/);
    expect(within(b).queryByTestId("sa-changed")).toBeNull();
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });
  it("still works for an older read with no phase: no status block, the original fields remain", () => {
    render(<SiteAssignmentList rows={[card({ phase: undefined, contact: undefined, reporting: undefined })]} />);
    expect(screen.queryByTestId("sa-phase")).toBeNull();
    expect(screen.getByTestId("sa-when")).toBeTruthy(); expect(screen.getByTestId("sa-venue")).toBeTruthy(); expect(screen.getByTestId("sa-call")).toBeTruthy();
  });
});

describe("My Day: On site next", () => {
  it("reads the same activity the same way: the phase wording, and the provisional note when it applies", () => {
    render(<SiteAssignmentsCard rows={[card({ phase: phase({ phase: "date_passed", basis: "activity" }) })]} />);
    expect(screen.getByTestId("my-day-site-phase").textContent).toBe("Scheduled installation date passed · start unconfirmed");
    expect(screen.getByTestId("my-day-site-provisional").textContent).toMatch(/Provisional date passed · contact Fictional Eli/);
    cleanup();
    render(<SiteAssignmentsCard rows={[card()]} />);
    expect(screen.getByTestId("my-day-site-phase").textContent).toBe("Tentative Setup on 11 Nov (from the project header)");
  });
});
