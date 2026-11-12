// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/operations", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/operations", () => ({ saveEnquiryPlanning: vi.fn() }));
vi.mock("@/lib/projects/format", async (orig) => ({ ...(await orig<typeof import("@/lib/projects/format")>()), todayIso: () => "2027-02-20" }));
const data = vi.hoisted(() => ({ ctx: null as unknown, overview: null as unknown, upcoming: null as unknown }));
vi.mock("@/lib/operations/data", () => ({
  getOperationsContext: async () => data.ctx,
  pickCompany: (ctx: { companies: { id: string; name: string }[] }, asked?: string) => ctx.companies.find((c) => c.id === asked) ?? ctx.companies[0] ?? null,
  loadOverview: async () => data.overview, loadUpcoming: async () => data.upcoming,
}));

import OperationsOverviewPage from "./page";
import UpcomingWorkPage from "./upcoming/page";
import type { Overview, UpcomingRow } from "@/lib/operations/model";

const CO = { id: "c1", name: "Fictional UAE" };
const ctx = (companies = [CO]) => ({ companies, loadFailed: false, installed: true, projects: { people: [{ id: "u-pm", name: "Pat Manager", companyIds: ["c1"] }, { id: "u-x", name: "Other Company PM", companyIds: ["c2"] }] } });
const row: UpcomingRow = {
  id: "o1", company_id: "c1", reference: "UAE-O-2027-0007", title: "Expo stand for Fictional Motors", stage: "proposal_sent", owner_id: "u-s", owner: "Sam Sales", flagged_at: "2027-01-05T08:00:00Z", decision_date: "2027-01-15",
  dates_tentative: true, won: false, location: "Dubai", install_start: "2027-02-26", event_start: "2027-03-01", event_end: "2027-03-05", dismantle_date: null,
  edition: { event_name: "Fictional Auto Expo", label: "Fictional Auto Expo · 2027 · Dubai", venue: "Expo Hall 4", city: "Dubai", start_date: "2027-03-01", end_date: "2027-03-05" },
  teams: ["engineering", "content"], equipment: [{ name: "LED wall", qty: 1 }], to_confirm: "Power drop position", note: null, planning: null, handover: null,
};
const overview: Overview = {
  company_id: "c1", taken_at: "2027-02-20T08:00:00Z", overlaps: [],
  handovers: [{ id: "h1", sales_reference: "UAE-O-2027-0002", title: "Mall roadshow", status: "submitted", submitted_at: "2027-02-18T08:00:00Z", pm_id: null, pm: null, pm_assigned_at: null, install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null }],
  projects: [{
    id: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", kind: "client", status: "completed", pm_id: "u-pm", pm: "Pat Manager", chat_group_id: "g1", venue: null, install_start: "2027-02-26", event_start: "2027-03-01",
    event_end: "2027-03-05", edition: null, tasks_open: 0, tasks_overdue: 0, reviews_waiting: 0, reviews_overdue: 0, blockers: [], next_milestone: null, milestones_overdue: 0, corrections_open: 0, plan_changes_open: 0,
    plan_unreleased: 0, equipment_reviews: 0, release_failed: false,
    equipment: [{ id: "q1", code: "UAE-R-00001", status: "in_progress", state: "still_out", lines: 2, reserved_lines: 0, partial_lines: 0, short_lines: 0, short_buy: 0, short_rent: 0, short_no_plan: 0, dispatched_lines: 2, returned_lines: 0,
      units_asked: 6, units_short: 0, units_dispatched: 6, units_returned: 3, units_out: 3, needed_from: null, needed_until: null, expected_return_at: "2027-03-08T08:00:00Z", return_overdue: false }],
  }],
};
const renderPage = async (page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>, sp: Record<string, string> = {}) => render(<>{await page({ searchParams: Promise.resolve(sp) })}</>);

beforeEach(() => { data.ctx = ctx(); data.overview = { state: "ok", data: overview }; data.upcoming = { state: "ok", data: [row] }; });
afterEach(cleanup);

describe("Operations Overview", () => {
  it("leads with what needs a decision, then Sales, delivery and pressure; each item has its owner and a direct link", async () => {
    await renderPage(OperationsOverviewPage);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.filter((h) => /Needs my decision|Coming up from Sales|Upcoming delivery|Team and warehouse pressure/.test(h ?? ""))).toEqual(["Needs my decision (1)", "Coming up from Sales", "Upcoming delivery", "Team and warehouse pressure"]);
    const item = screen.getByTestId("ops-decision-pm_unassigned");
    expect(item.textContent).toMatch(/Project Manager not assigned.*UAE-O-2027-0002 Mall roadshow.*With: Operations/);
    expect(within(item).getByRole("link", { name: "Assign a Project Manager" }).getAttribute("href")).toBe("/projects/handovers?handover=h1");
    expect(screen.getByTestId("ops-coming").textContent).toMatch(/UAE-O-2027-0007.*Proposal sent · Tentative.*Next: Sales, confirm the open details/);
    const project = screen.getByTestId("ops-project-UAE-P-2027-0001");
    expect(project.textContent).toContain("Delivery complete · equipment still out");
    expect(project.textContent).toMatch(/Venue\s*Not recorded/);
    expect(project.textContent).toContain("Not recorded on the project");                       // dismantling: unknown is said, not guessed
    expect(project.textContent).toContain("UAE-R-00001: Still out. 0 of 2 lines reserved. 3 units out, due back 2027-03-08.");
    expect(within(project).getByRole("link", { name: "Open project chat" }).getAttribute("href")).toBe("/operations?company=c1&chat=g1");
    expect(document.body.textContent).not.toMatch(/score|capacity \d|%/i);
  });

  it("a refused read, a failed read and an empty company each say what happened", async () => {
    data.overview = { state: "denied" };
    await renderPage(OperationsOverviewPage);
    expect(screen.getByTestId("ops-denied").textContent).toMatch(/no longer an Operations Manager of this company/);
    cleanup();
    data.overview = { state: "error" };
    await renderPage(OperationsOverviewPage);
    expect(document.body.textContent).toMatch(/could not be loaded|couldn.t load|could not load/i);
    expect(screen.queryByText(/Nothing recorded needs a decision/)).toBeNull();
    cleanup();
    data.overview = { state: "ok", data: { ...overview, handovers: [], projects: [] } }; data.upcoming = { state: "error" };
    await renderPage(OperationsOverviewPage);
    expect(screen.getByText(/Nothing recorded needs a decision right now/)).toBeTruthy();
    expect(screen.getByText("No live project in this company.")).toBeTruthy();
    expect(screen.queryByText("No enquiry is flagged for Operations planning.")).toBeNull();     // the Sales section failed: it does not read as "none"
  });

  it("offers a company chooser only to someone who is Operations Manager of more than one, and shows the one asked for", async () => {
    await renderPage(OperationsOverviewPage);
    expect(screen.queryByRole("navigation", { name: "Company" })).toBeNull();
    cleanup();
    data.ctx = ctx([CO, { id: "c2", name: "Fictional KSA" }]);
    await renderPage(OperationsOverviewPage, { company: "c2" });
    const nav = screen.getByRole("navigation", { name: "Company" });
    expect(within(nav).getByRole("link", { name: "Fictional KSA" }).getAttribute("aria-current")).toBe("page");
    cleanup();
    await renderPage(OperationsOverviewPage, { company: "not-mine" });                            // a company that is not theirs falls back to their own
    expect(within(screen.getByRole("navigation", { name: "Company" })).getByRole("link", { name: "Fictional UAE" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("Upcoming Work", () => {
  it("shows the planning fields, says what is tentative and what is not recorded, and offers only this company's people as provisional PM", async () => {
    await renderPage(UpcomingWorkPage);
    const card = screen.getByTestId("ops-row-UAE-O-2027-0007");
    expect(card.textContent).toMatch(/UAE-O-2027-0007.*Expo stand for Fictional Motors.*Proposal sent.*Tentative/);
    expect(card.textContent).toMatch(/Sales owner\s*Sam Sales/);
    expect(card.textContent).toMatch(/Event edition\s*Fictional Auto Expo · 2027 · Dubai/);
    expect(card.textContent).toMatch(/Venue or city\s*Expo Hall 4 · Dubai/);
    expect(card.textContent).toMatch(/Dismantling\s*Not recorded/);
    expect(card.textContent).toMatch(/Expected teams\s*Engineering, Content/);
    expect(card.textContent).toMatch(/Expected equipment\s*LED wall x 1/);
    expect(card.textContent).toMatch(/Sales still to confirm\s*Power drop position/);
    expect(card.textContent).toMatch(/Provisional Project Manager\s*Nobody yet/);
    expect(card.textContent).toMatch(/Next step\s*Sales \(Sam Sales\): Confirm the open details/);
    expect(document.body.textContent).toContain("Prices, quotes and Sales notes are never shown here.");
    expect(within(card).queryByRole("link", { name: /Project Manager|handover/ })).toBeNull();     // nothing to assign before the handover exists
  });

  it("once won and submitted it reads as confirmed and links to the handover where the Project Manager is assigned", async () => {
    data.upcoming = { state: "ok", data: [{ ...row, stage: "won", won: true, dates_tentative: false, planning: { provisional_pm_id: "u-pm", provisional_pm: "Pat Manager", risk: "medium", risk_note: "Tight window", capacity_conflict: true, capacity_note: "Clashes with the Riyadh job", question: "Hall from the 25th?", question_at: "2027-01-10T08:00:00Z", question_by: "Omar Ops", answer: "Yes", answered_at: "2027-01-11T08:00:00Z" },
      handover: { id: "h9", status: "submitted", submitted_at: "2027-02-01T08:00:00Z", pm: null, project_id: null } }] };
    await renderPage(UpcomingWorkPage);
    const card = screen.getByTestId("ops-row-UAE-O-2027-0007");
    expect(card.textContent).toContain("Confirmed: this enquiry is won");
    expect(card.textContent).toContain("Capacity conflict");
    expect(card.textContent).toMatch(/Provisional Project Manager\s*Pat Manager \(provisional, nothing is booked\)/);
    expect(card.textContent).toMatch(/Question for Sales\s*Hall from the 25th\?.*Sales answered.*Yes/);
    expect(within(card).getByRole("link", { name: "Assign a Project Manager" }).getAttribute("href")).toBe("/projects/handovers?handover=h9");
  });

  it("no flagged enquiry, a refused read and a failed read are three different messages", async () => {
    data.upcoming = { state: "ok", data: [] };
    await renderPage(UpcomingWorkPage);
    expect(screen.getByText("No enquiry is flagged for Operations")).toBeTruthy();
    cleanup();
    data.upcoming = { state: "denied" };
    await renderPage(UpcomingWorkPage);
    expect(screen.getByTestId("ops-denied")).toBeTruthy();
    expect(screen.queryByText("No enquiry is flagged for Operations")).toBeNull();
    cleanup();
    data.upcoming = { state: "error" };
    await renderPage(UpcomingWorkPage);
    expect(screen.queryByText("No enquiry is flagged for Operations")).toBeNull();
    expect(document.body.textContent).toMatch(/could not be loaded|could not load/i);
  });
});
