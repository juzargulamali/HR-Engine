// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/operations", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/actions/operations", () => ({ saveEnquiryPlanning: vi.fn() }));
vi.mock("@/lib/projects/format", async (orig) => ({ ...(await orig<typeof import("@/lib/projects/format")>()), todayIso: () => "2027-02-20" }));
const data = vi.hoisted(() => ({ ctx: null as unknown, overview: null as unknown, upcoming: null as unknown, sites: null as unknown }));
vi.mock("@/lib/operations/data", () => ({
  getOperationsContext: async () => data.ctx,
  pickCompany: async (ctx: { companies: { id: string; name: string }[] }, asked?: string) => ctx.companies.find((c) => c.id === asked) ?? ctx.companies[0] ?? null,
  loadOverview: async () => data.overview, loadUpcoming: async () => data.upcoming, loadSiteActivities: async () => data.sites,
}));

import OperationsOverviewPage from "./page";
import UpcomingWorkPage from "./upcoming/page";
import type { Overview, UpcomingRow } from "@/lib/operations/model";

const CO = { id: "c1", name: "Fictional UAE" };
const ctx = (companies = [CO]) => ({ companies, loadFailed: false, installed: true, projects: { userId: "u-me", people: [{ id: "u-pm", name: "Pat Manager", companyIds: ["c1"] }, { id: "u-x", name: "Other Company PM", companyIds: ["c2"] }] } });
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
    event_end: "2027-03-05", edition: null, tasks_open: 0, tasks_overdue: 0, reviews_waiting: 0, reviews_overdue: 0, blockers: [], blockers_total: 0, next_milestone: null, milestones_overdue: 0, corrections_open: 0, plan_changes_open: 0,
    plan_unreleased: 0, equipment_reviews: 0, release_failed: false,
    equipment: [{ id: "q1", code: "UAE-R-00001", status: "in_progress", state: "still_out", lines: 2, reserved_lines: 0, partial_lines: 0, short_lines: 0, short_buy: 0, short_rent: 0, short_no_plan: 0, dispatched_lines: 2, returned_lines: 0,
      units_asked: 6, units_short: 0, units_dispatched: 6, units_returned: 3, units_out: 3, needed_from: null, needed_until: null, expected_return_at: "2027-03-08T08:00:00Z", return_overdue: false }],
  }],
};
const live: Overview["projects"][number] = {
  ...overview.projects[0]!, id: "p2", reference: "UAE-P-2027-0002", name: "Fictional Motors launch", status: "active", chat_group_id: null, venue: "Expo Hall 4",
  equipment: [{ ...overview.projects[0]!.equipment[0]!, id: "q2", code: "UAE-R-00002", state: "short", lines: 2, reserved_lines: 1, short_lines: 1, short_rent: 1, dispatched_lines: 0, units_dispatched: 0, units_returned: 0, units_out: 0, expected_return_at: null }],
};
const renderPage = async (page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>, sp: Record<string, string> = {}) => render(<>{await page({ searchParams: Promise.resolve(sp) })}</>);

beforeEach(() => { data.ctx = ctx(); data.overview = { state: "ok", data: overview }; data.upcoming = { state: "ok", data: [row] }; data.sites = { state: "not_installed" }; });
afterEach(cleanup);

describe("Operations Overview", () => {
  it("leads with four figures that open their records, then the decision queue beside the timeline", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [...overview.projects, live] } };
    await renderPage(OperationsOverviewPage);
    const cards = within(screen.getByTestId("ops-summary")).getAllByRole("link");
    expect(cards.map((c) => [c.textContent?.replace(/\s+/g, " ").trim(), c.getAttribute("href")])).toEqual([
      ["2Needs my decision", "/operations?company=c1#decisions"], ["1Installations in the next 14 days", "/operations?company=c1#installations"],
      ["2Equipment issues", "/operations?company=c1#equipment"], ["1Upcoming Sales work", "/operations/upcoming?company=c1"]]);
    // every figure is the length of the list it opens
    expect(within(screen.getByTestId("ops-decisions")).getAllByRole("listitem").filter((li) => li.getAttribute("data-testid")?.startsWith("ops-decision-"))).toHaveLength(2);
    expect(screen.getByTestId("ops-installations").children).toHaveLength(1);
    expect(screen.getByTestId("ops-equipment").children).toHaveLength(2);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const at = (re: RegExp) => headings.findIndex((h) => re.test(h));
    expect(at(/^Needs my decision \(2\)/)).toBeLessThan(at(/^Next on site/));
    expect(at(/^Next on site/)).toBeLessThan(at(/^Next installations \(1\)/));
    expect(at(/^Next installations/)).toBeLessThan(at(/^Delivery timeline/));
    expect(at(/^Delivery timeline/)).toBeLessThan(at(/^Upcoming delivery by week/));
    const item = screen.getByTestId("ops-decision-pm_unassigned");
    expect(item.textContent).toMatch(/Project Manager not assigned.*UAE-O-2027-0002 Mall roadshow.*With Operations · since/);
    expect(within(item).getByRole("link", { name: "Assign a Project Manager" }).getAttribute("href")).toBe("/projects/handovers?handover=h1");
    expect(document.body.textContent).not.toMatch(/score \d|\d+ ?%|capacity \d|performance score/i);
  });

  it("marks installation, show and dismantling apart in words, and says an enquiry's dates are tentative", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [live] } };
    data.upcoming = { state: "ok", data: [{ ...row, install_start: "2027-03-10", event_start: "2027-03-12", event_end: "2027-03-14", dismantle_date: "2027-03-15" }] };
    await renderPage(OperationsOverviewPage);
    const tl = screen.getByTestId("ops-timeline");
    // the enquiry's installation, show and dismantling are ONE row marked tentative; the project's own header dates are in Next on site, labelled as header dates
    expect(tl.querySelectorAll('[data-testid^="ops-group-"]')).toHaveLength(1);
    expect([...tl.querySelectorAll("[data-kind]")].map((x) => `${x.getAttribute("data-kind")}:${x.textContent}`)).toEqual(["installation:Installation", "show:Show", "dismantling:Dismantling"]);
    expect(within(tl).getAllByText("Tentative")).toHaveLength(1);
    expect(tl.textContent).toContain("Sales date · tentative");
    const next = screen.getByTestId("ops-next-on-site");
    expect(next.textContent).toContain("UAE-P-2027-0002 Fictional Motors launch");
    expect(next.textContent).toContain("(from the project header)");
    expect(next.textContent).not.toMatch(/started/i);
  });

  it("draws the week chart as a list whose counts are its projects, and a readiness bar only with a real denominator", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [live, { ...live, id: "p3", reference: "UAE-P-2027-0003", name: "No dates yet", install_start: null, event_start: null, event_end: null, equipment: [] }] } };
    await renderPage(OperationsOverviewPage);
    const week = screen.getByTestId("ops-week-2027-02-22");
    expect(week.textContent).toMatch(/Next week.*1.*UAE-P-2027-0002 Fictional Motors launch/);
    expect(within(week).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByTestId("ops-week-none").textContent).toMatch(/No date recorded.*1.*UAE-P-2027-0003/);
    expect(screen.getByTestId("ops-week-2027-02-15").textContent).toMatch(/This week.*0/);
    const install = screen.getByTestId("ops-install-UAE-P-2027-0002");
    expect(within(install).getByTestId("ops-readiness").textContent).toBe("1 of 2 equipment lines ready");
    expect(within(screen.getByTestId("ops-project-UAE-P-2027-0003")).queryByTestId("ops-readiness")).toBeNull();
    expect(screen.getByTestId("ops-project-UAE-P-2027-0003").textContent).toContain("No equipment request recorded");
  });

  it("labels each project from recorded facts, shows the evidence as links and never a score", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [overview.projects[0]!, live, { ...live, id: "p3", reference: "UAE-P-2027-0003", name: "No dates yet", install_start: null, event_start: null, event_end: null, equipment: [] },
      { ...live, id: "p4", reference: "UAE-P-2027-0004", name: "Quiet job", install_start: "2027-06-01", equipment: [] }] } };
    await renderPage(OperationsOverviewPage);
    const label = (ref: string) => screen.getByTestId(`ops-project-${ref}`).querySelector("[data-health]")?.textContent;
    expect(label("UAE-P-2027-0002")).toBe("At risk");
    expect(label("UAE-P-2027-0001")).toBe("Needs attention");                                    // delivery complete, equipment still out
    expect(label("UAE-P-2027-0003")).toBe("Not enough information");
    expect(label("UAE-P-2027-0004")).toBe("On track");
    expect(screen.getByTestId("ops-health-counts").textContent).toBe("At risk1Needs attention1Not enough information1On track1");
    const risky = screen.getByTestId("ops-project-UAE-P-2027-0002");
    expect(within(risky).getByRole("link", { name: /Installation planned 2027-02-26 \(project header\): equipment short on UAE-R-00002/ }).getAttribute("href")).toBe("/projects/p2/equipment");
    expect(within(screen.getByTestId("ops-project-UAE-P-2027-0001")).getByRole("link", { name: "Delivery complete, 3 units still out" }).getAttribute("href")).toBe("/projects/p1/equipment");
    expect(within(screen.getByTestId("ops-project-UAE-P-2027-0001")).getByRole("link", { name: "Project chat" }).getAttribute("href")).toBe("/operations?company=c1&chat=g1");
    // the rules live behind the ⓘ beside the heading (hover, focus or tap), not in the page
    expect(screen.queryByText("How the label is decided")).toBeNull();
    fireEvent.pointerEnter(screen.getByTestId("info-hint-project-health"), { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toContain("How the label is decided");
    expect(screen.getByRole("tooltip").textContent).toMatch(/not a score/);
    expect(document.body.textContent).not.toMatch(/score \d|\d+ ?%|performance score/i);
  });

  it("shows a partly dispatched request with its count and Equipment link, and the event edition as secondary text only where one is recorded", async () => {
    const partly = { ...live, edition: "Fictional Auto Expo · 2027 · Dubai", equipment: [{ ...live.equipment[0]!, state: "partially_dispatched" as const, lines: 4, reserved_lines: 0, short_lines: 0, short_rent: 0, dispatched_lines: 1 }] };
    data.overview = { state: "ok", data: { ...overview, projects: [partly, { ...live, id: "p4", reference: "UAE-P-2027-0004", name: "Quiet job", equipment: [] }] } };
    await renderPage(OperationsOverviewPage);
    const issue = screen.getByTestId("ops-equipment-partial_dispatch");
    expect(issue.textContent).toMatch(/Partly dispatched.*UAE-P-2027-0002 Fictional Motors launch.*UAE-R-00002: 1 of 4 lines dispatched · With Warehouse/);
    expect(within(issue).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/projects/p2/equipment?request=q2", "/projects/p2/equipment?request=q2"]);
    expect(within(issue).getByTestId("ops-request-UAE-R-00002").textContent).toBe("UAE-R-00002");
    expect(within(screen.getByTestId("ops-summary")).getByRole("link", { name: /Equipment issues/ }).textContent).toContain("1");
    expect(within(screen.getByTestId("ops-install-UAE-P-2027-0002")).getByTestId("ops-edition").textContent).toBe("Fictional Auto Expo · 2027 · Dubai");
    expect(within(screen.getByTestId("ops-project-UAE-P-2027-0002")).getByTestId("ops-edition").textContent).toBe("Fictional Auto Expo · 2027 · Dubai");
    expect(within(screen.getByTestId("ops-project-UAE-P-2027-0004")).queryByTestId("ops-edition")).toBeNull();
    cleanup();
    data.overview = { state: "error" };
    await renderPage(OperationsOverviewPage);
    expect(screen.queryByTestId("ops-equipment")).toBeNull();                                    // a failed read shows neither, only that it could not load
    expect(screen.queryByTestId("ops-edition")).toBeNull();
    expect(document.body.textContent).toMatch(/could not be loaded|could not load/i);
  });

  it("a refused read, a failed read and an empty company each say what happened; a failed read is never a figure or a label", async () => {
    data.overview = { state: "denied" };
    await renderPage(OperationsOverviewPage);
    expect(screen.getByTestId("ops-denied").textContent).toMatch(/no longer an Operations Manager of this company/);
    cleanup();
    data.overview = { state: "error" };
    await renderPage(OperationsOverviewPage);
    expect(document.body.textContent).toMatch(/could not be loaded|couldn.t load|could not load/i);
    expect(screen.queryByTestId("ops-summary")).toBeNull();
    expect(document.querySelector("[data-health]")).toBeNull();
    expect(screen.queryByText(/Nothing recorded needs a decision/)).toBeNull();
    cleanup();
    data.overview = { state: "ok", data: { ...overview, handovers: [], projects: [] } }; data.upcoming = { state: "error" };
    await renderPage(OperationsOverviewPage);
    expect(screen.getByText(/Nothing recorded needs a decision right now/)).toBeTruthy();
    expect(screen.getAllByText("No live project in this company.").length).toBeGreaterThan(0);
    expect(screen.queryByText("No enquiry is flagged for Operations planning.")).toBeNull();     // the Sales section failed: it does not read as "none"
    const sales = within(screen.getByTestId("ops-summary")).getByRole("link", { name: /Upcoming Sales work/ });
    expect(sales.textContent).toContain("—");                                                     // and its figure is not zero
    expect(sales.textContent).toContain("Could not be loaded");
    expect(screen.getByText(/⚠ Enquiry dates could not be loaded, so only project dates are shown\./)).toBeTruthy();
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
  it("is scannable: event and venue, dates, expected decision, provisional PM and the next unresolved item; the rest is one tap away", async () => {
    await renderPage(UpcomingWorkPage);
    const card = screen.getByTestId("ops-row-UAE-O-2027-0007");
    expect(within(card).getByRole("heading").textContent).toBe("Fictional Auto Expo · 2027 · Dubai");
    expect(card.textContent).toMatch(/Expo Hall 4, Dubai · UAE-O-2027-0007 · Expo stand for Fictional Motors/);
    expect(card.textContent).toMatch(/Proposal sent\s*Tentative dates/);
    const facts = [...card.querySelector("dl")!.querySelectorAll("dt")].map((x) => x.textContent);
    expect(facts).toEqual(["Dates (tentative)", "Expected decision", "Provisional Project Manager", "Next unresolved item"]);
    expect([...card.querySelector("dl")!.querySelectorAll("[data-kind]")].map((x) => x.textContent)).toEqual(["Installation", "Show", "Dismantling"]);
    expect(card.querySelector("dl")!.textContent).toMatch(/Dismantling\s*Not recorded/);
    expect(card.querySelector("dl")!.textContent).toMatch(/Provisional Project Manager\s*Nobody yet/);
    expect(card.querySelector("dl")!.textContent).toMatch(/Next unresolved item\s*Confirm the open details\s*With Sales \(Sam Sales\)/);
    const more = card.querySelector("details")!;
    expect(more.hasAttribute("open")).toBe(false);
    expect(more.textContent).toMatch(/Sales owner\s*Sam Sales/);
    expect(more.textContent).toMatch(/Expected teams\s*Engineering, Content/);
    expect(more.textContent).toMatch(/Expected equipment\s*LED wall x 1/);
    expect(more.textContent).toMatch(/Sales still to confirm\s*Power drop position/);
    fireEvent.pointerEnter(screen.getByTestId("info-hint-what-is-shown-here"), { pointerType: "mouse" });
    expect(screen.getByRole("tooltip").textContent).toContain("Prices, quotes and Sales notes are never shown here.");
    expect(card.textContent).not.toMatch(/AED|price|margin|quote|estimate|value/i);
    expect(within(card).queryByRole("link", { name: /Project Manager|handover/ })).toBeNull();     // nothing to assign before the handover exists
  });

  it("once won and submitted it reads as confirmed and links to the handover where the Project Manager is assigned", async () => {
    data.upcoming = { state: "ok", data: [{ ...row, stage: "won", won: true, dates_tentative: false, planning: { provisional_pm_id: "u-pm", provisional_pm: "Pat Manager", risk: "medium", risk_note: "Tight window", capacity_conflict: true, capacity_note: "Clashes with the Riyadh job", question: "Hall from the 25th?", question_at: "2027-01-10T08:00:00Z", question_by: "Omar Ops", answer: "Yes", answered_at: "2027-01-11T08:00:00Z" },
      handover: { id: "h9", status: "submitted", submitted_at: "2027-02-01T08:00:00Z", pm: null, project_id: null } }] };
    await renderPage(UpcomingWorkPage);
    const card = screen.getByTestId("ops-row-UAE-O-2027-0007");
    expect(card.textContent).toContain("Confirmed (won)");
    expect(card.textContent).toContain("Capacity conflict");
    expect(card.textContent).toContain("Risk: Medium");
    expect(card.textContent).toMatch(/Provisional Project Manager\s*Pat Manager\s*Provisional: nothing is booked/);
    expect(card.textContent).toMatch(/Next unresolved item\s*Assign a Project Manager\s*With Operations/);
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

describe("Operations Overview: the site activities, company and queues of this round", () => {
  const phase = (over: Record<string, unknown> = {}) => ({ phase: "scheduled", basis: "activity", first_day: "2027-02-24", last_day: "2027-02-24", started_at: null, kind: "setup", state: "tentative", today: "2027-02-20", ...over });
  const activity = (over: Record<string, unknown> = {}) => ({
    id: "a1", project_id: "p2", reference: "UAE-P-2027-0002", project_name: "Fictional Motors launch", project_status: "active", title: "Hall 4 installation", kind: "setup", run_label: "Run 1", state: "tentative",
    start_date: "2027-02-24", end_date: null, starts_at: null, ends_at: null, tz: "Asia/Dubai", effective: { venue: "Expo Hall 4", venue_source: "activity", start_date: "2027-02-24", end_date: null, date_source: "activity", choice_pending: false, project_start: null, project_end: null },
    phase: phase(), owner_name: "Eli Engineer", crew_total: 0, call_missing: 0, actual_started_at: null, ...over,
  });

  it("always names the current company, with a switcher for more than one", async () => {
    await renderPage(OperationsOverviewPage);
    expect(screen.getByTestId("ops-company").textContent).toBe("Company Fictional UAE");
    cleanup();
    data.ctx = ctx([CO, { id: "c2", name: "Fictional KSA" }]);
    await renderPage(OperationsOverviewPage, { company: "c2" });
    const chip = screen.getByTestId("ops-company");
    expect(chip.getAttribute("data-company-id")).toBe("c2");
    expect(within(chip).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/operations?company=c1", "/operations?company=c2"]);
  });

  it("puts the decisions assigned to the viewer first, then follow-ups with their owners, then Next on site, then the figures", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [{ ...overview.projects[0]!, status: "active", equipment_reviews: 1 }, live],
      output_reviews: [{ version_id: "v1", task_id: "t1", project_id: "p2", reference: "UAE-P-2027-0002", project: "Fictional Motors launch", task: "Stage render", label: "Render", version_no: 2, attached_at: "2027-02-19T08:00:00Z", submitted_by_id: "u-pm", submitted_by: "Pat Manager",
        assignee_id: "u-eli", assignee: "Eli Engineer", reviewer_id: "u-me", reviewer: "Rana Operations", needs_reviewer: false, pm: "Pat Manager" }] } };
    data.sites = { state: "ok", data: [activity()] };
    await renderPage(OperationsOverviewPage);
    const mine = screen.getByTestId("ops-decisions-mine");
    expect(within(mine).getAllByRole("listitem")).toHaveLength(1);
    expect(within(mine).getByRole("link", { name: "Open the version to review it" }).getAttribute("href")).toBe("/projects/p2/work?task=t1&version=v1");
    const follow = screen.getByTestId("ops-followups");
    expect(follow.textContent).toMatch(/With Operations/);
    expect(follow.textContent).toMatch(/With Pat Manager/);
    const order = ["ops-decisions-mine", "ops-followups", "ops-next-on-site", "ops-summary"].map((id) => document.querySelector(`[data-testid="${id}"]`)!);
    for (let i = 1; i < order.length; i += 1) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists each dated activity once under Next on site with its exact Site schedule link, and never says started from a date", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [live] } };
    data.sites = { state: "ok", data: [activity(), activity({ id: "a2", title: "Late hall prep", phase: phase({ phase: "date_passed", first_day: "2027-02-10", last_day: "2027-02-10" }), start_date: "2027-02-10" }),
      activity({ id: "a3", title: "Hall 4 dismantling", kind: "dismantling", phase: phase({ kind: "dismantling", first_day: "2027-03-08", last_day: "2027-03-08" }), start_date: "2027-03-08" })] };
    await renderPage(OperationsOverviewPage);
    const next = screen.getByTestId("ops-next-on-site");
    expect([...next.children].map((li) => li.getAttribute("data-testid"))).toEqual(["ops-activity-a2", "ops-activity-a1", "ops-entry-s:p2"]);   // passed date first, then the next 14 days; the project has no show activity, so its header show date is listed, labelled
    expect(screen.getByTestId("ops-entry-s:p2").textContent).toContain("Show date (from the project header)");
    expect(within(screen.getByTestId("ops-activity-a1")).getByRole("link", { name: /Hall 4 installation/ }).getAttribute("href")).toBe("/projects/p2/plan?plan=site&mode=list#site-a1");
    const late = screen.getByTestId("ops-activity-a2");
    expect(late.textContent).toContain("Scheduled installation date passed · start unconfirmed");
    expect(late.textContent).toContain("record the start or move the date");
    expect(document.body.textContent).not.toMatch(/Installation started|The show started|Already started/);
    // the later dismantling is in the timeline under its run, once, and not again in Next on site
    expect(within(screen.getByTestId("ops-timeline")).getByTestId("ops-activity-a3")).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="ops-activity-a1"]')).toHaveLength(1);
    expect(screen.queryByTestId("ops-sites-fallback")).toBeNull();
  });

  it("says plainly when the site activity read is not available and falls back to header dates, labelled", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [live] } };
    data.sites = { state: "error" };
    await renderPage(OperationsOverviewPage);
    expect(screen.getByTestId("ops-sites-fallback").textContent).toMatch(/Site activities could not be loaded.*project headers/);
    expect(screen.getByTestId("ops-next-on-site").textContent).toContain("Installation date (from the project header)");
  });

  it("links an equipment request code to the exact request and names the next action", async () => {
    const draft = { ...live, equipment: [{ ...live.equipment[0]!, id: "q5", code: "UAE-R-00005", state: "draft" as const, short_lines: 0, short_rent: 0, needed_from: null, needed_until: null }] };
    data.overview = { state: "ok", data: { ...overview, projects: [draft] } };
    await renderPage(OperationsOverviewPage);
    const issue = screen.getByTestId("ops-equipment-not_sent");
    expect(within(issue).getByTestId("ops-request-UAE-R-00005").getAttribute("href")).toBe("/projects/p2/equipment?request=q5");
    expect(issue.textContent).toContain("Set planning dates before submitting to Warehouse");
  });

  it("team pressure shows both commitments of an overlap with their projects and dates", async () => {
    data.overview = { state: "ok", data: { ...overview, projects: [live, { ...live, id: "p3", reference: "UAE-P-2027-0003", name: "Roadshow", equipment: [] }],
      overlaps: [{ user_id: "u-t", person: "Tariq Technician", a: "UAE-P-2027-0002", a_id: "p2", b: "UAE-P-2027-0003", b_id: "p3", from: "2027-02-26", to: "2027-03-01" }] } };
    data.sites = { state: "ok", data: [activity({ phase: phase({ first_day: "2027-02-26", last_day: "2027-02-27" }), start_date: "2027-02-26" }), activity({ id: "a9", project_id: "p3", reference: "UAE-P-2027-0003", project_name: "Roadshow", title: "Roadshow rigging", phase: phase({ first_day: "2027-02-27", last_day: "2027-02-27" }), start_date: "2027-02-27" })] };
    await renderPage(OperationsOverviewPage);
    const pair = screen.getByTestId("ops-pressure-pair");
    const both = within(pair).getAllByTestId("ops-commitment").map((c) => c.textContent);
    expect(both).toEqual(["Hall 4 installation · UAE-P-2027-0002 Fictional Motors launch · 26 Feb to 27 Feb", "Roadshow rigging · UAE-P-2027-0003 Roadshow · 27 Feb"]);
    expect(pair.textContent).toContain("Tariq Technician");
  });
});

describe("Upcoming Work: provisional Project Manager and handover lines", () => {
  const planned = { provisional_pm_id: null, provisional_pm: null, risk: "unknown" as const, risk_note: null, capacity_conflict: false, capacity_note: null, question: null, question_at: null, question_by: null, answer: null, answered_at: null };
  it("the button says what it does when naming a provisional Project Manager is the next step", async () => {
    data.upcoming = { state: "ok", data: [{ ...row, to_confirm: null, planning: planned }] };
    await renderPage(UpcomingWorkPage);
    expect(screen.getByTestId("ops-plan-UAE-O-2027-0007").textContent).toBe("Name a provisional Project Manager");
    cleanup();
    data.upcoming = { state: "ok", data: [row] };                                                   // Sales still has to confirm details: the next step is not Operations'
    await renderPage(UpcomingWorkPage);
    expect(screen.getByTestId("ops-plan-UAE-O-2027-0007").textContent).toBe("Plan");
  });
  it("a pending handover carries its owner and next step in one line at the top", async () => {
    data.upcoming = { state: "ok", data: [{ ...row, stage: "won", won: true, dates_tentative: false, handover: { id: "h9", status: "pm_assigned", submitted_at: "2027-02-01T08:00:00Z", pm: "Pat Manager", project_id: null } }] };
    await renderPage(UpcomingWorkPage);
    expect(screen.getByTestId("ops-handover-line-UAE-O-2027-0007").textContent).toBe("With Project Manager (Pat Manager) · Next: Accept the handover");
  });
});
