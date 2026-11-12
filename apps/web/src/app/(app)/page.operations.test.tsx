/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";
import type { OpsDay, MyEquipmentReview } from "@/lib/my-day/operations";
import type { Overview, OverviewProject } from "@/lib/operations/model";

/**
 * My Day and Operations: the summary is shown only to someone with Operations access; what they can act on joins the one attention list without a second
 * row for the same handover; a Project Manager sees their booking review as their own item; a failed Operations read says so.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", redirect: vi.fn() }));
vi.mock("@/lib/weather", () => ({ getCurrentWeather: async () => null }));
vi.mock("@/lib/projects/format", async (orig) => ({ ...(await orig<typeof import("@/lib/projects/format")>()), todayIso: () => "2027-02-20" }));
vi.mock("@enginious-hr/domain", async (orig) => ({ ...(await orig<typeof import("@enginious-hr/domain")>()), getBusinessDateString: () => "2027-02-20" }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, { pbx_inbox: { data: { companies: [], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [], is_finance_anywhere: false, is_executive_anywhere: false }, error: null } }) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Omar Ops", grants: [] }) }));
vi.mock("@/lib/crm/my-day", () => ({ loadSalesToday: async () => ({ status: "none" }) }));
let projectsCtx: Record<string, unknown> | null = null;
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => projectsCtx }));
let handoverList: unknown[] = [];
vi.mock("@/lib/projects/my-work", () => ({
  loadProjectsAttention: async () => ({ overdueTasks: 0, dueSoonTasks: 0, reviewsWaiting: 0, handoversWaiting: handoverList.length, scopeChangesWaiting: 0, scopeChangeProjectId: null, unreadMessages: 0, unreadProjects: 0, handoverList, scopeList: [] }),
  loadMyWork: async () => ({ open: [], reviews: [], today: "2027-02-20" }),
}));
vi.mock("@/lib/my-day/loaders", () => ({ loadEquipment: async () => null, loadLiveClock: async () => ({}), loadPortfolio: async () => { throw new Error("down"); } }));
let ops: OpsDay | null | "throw" = null;
let reviews: MyEquipmentReview[] | null | "throw" = null;
vi.mock("@/lib/my-day/operations-day", () => ({
  loadOperationsDay: async () => { if (ops === "throw") throw new Error("down"); return ops; },
  loadMyEquipmentReviews: async () => { if (reviews === "throw") throw new Error("down"); return reviews; },
}));
vi.mock("./attendance-clock-card", () => ({ AttendanceClockCard: () => null }));
vi.mock("./birthdays-section", () => ({ BirthdaysSection: () => null }));
vi.mock("@/components/my-day/next-dispatch", () => ({ NextDispatch: () => null }));

import DashboardPage from "./page";

const render = async () => { const el = document.createElement("div"); el.innerHTML = renderToStaticMarkup(await DashboardPage()); return el; };
const project = (over: Partial<OverviewProject> = {}): OverviewProject => ({
  id: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", kind: "client", status: "in_progress", pm_id: "u-pm", pm: "Pat Manager", chat_group_id: null, venue: null, install_start: "2027-02-26", event_start: "2027-03-01",
  event_end: "2027-03-05", edition: null, tasks_open: 2, tasks_overdue: 0, reviews_waiting: 0, reviews_overdue: 0, blockers: [], blockers_total: 0, next_milestone: null, milestones_overdue: 0, corrections_open: 0,
  plan_changes_open: 0, plan_unreleased: 0, equipment: [], equipment_reviews: 1, release_failed: false, ...over,
});
const overview: Overview = {
  company_id: "c1", taken_at: "2027-02-20T08:00:00Z", overlaps: [], projects: [project()],
  handovers: [{ id: "h1", sales_reference: "UAE-O-2027-0002", title: "Mall roadshow", status: "submitted", submitted_at: "2027-02-18T08:00:00Z", pm_id: null, pm: null, pm_assigned_at: null, install_start: null, event_start: null, event_end: null, venue: null, edition: null, clarification_requested_at: null }],
};
const opsDay = (): OpsDay => ({ reads: [{ company: { id: "c1", name: "Fictional UAE" }, overview: { state: "ok", data: overview }, upcoming: { state: "ok", data: [] } }] });

beforeEach(() => {
  tables = { companies: rows([]), approvals: { data: [], error: null, count: 0 }, employees: rows([]), leave_requests: rows([]), reimbursement_claims: rows([]), recovery_credit_requests: rows([]) };
  projectsCtx = { installed: true, grants: [{ companyId: "c1", capabilities: ["view"] }], loadFailed: false, personName: () => "Unknown" };
  handoverList = []; ops = null; reviews = null;
});

describe("My Day: Operations", () => {
  it("regular staff see no Operations summary and no Operations items", async () => {
    const page = await render();
    expect(page.querySelector('[aria-label="Operations summary"]')).toBeNull();
    expect(page.textContent).not.toContain("Open Operations");
    expect(page.textContent).not.toContain("Mall roadshow");
  });

  it("an Operations Manager sees the summary near the top: the count, the next installations and the most urgent issue, each linked", async () => {
    ops = opsDay();
    handoverList = [{ id: "h1", opportunityId: "o2", reference: "UAE-O-2027-0002", title: "Mall roadshow", status: "submitted", at: "2027-02-18T08:00:00Z" }];
    const page = await render();
    const card = page.querySelector('[aria-label="Operations summary"]')!;
    expect(card).toBeTruthy();
    // above the list of what needs the person
    expect(card.compareDocumentPosition(page.querySelector('[data-attention-key]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const decisions = card.querySelector('[data-testid="my-day-ops-decisions"]')!;
    expect(decisions.textContent).toContain("2");
    expect(decisions.getAttribute("href")).toBe("/operations?company=c1#decisions");
    expect(card.textContent).toMatch(/UAE-P-2027-0001 Fictional Expo stand.*Installation.*in 6 days.*Pat Manager.*Needs attention/);
    const urgent = card.querySelector('[data-testid="my-day-ops-urgent"]')!;
    expect(urgent.getAttribute("href")).toBe("/projects/handovers?handover=h1");
    expect(urgent.textContent).toMatch(/Project Manager not assigned.*UAE-O-2027-0002 Mall roadshow.*With Operations/);
    // the handover the viewer can assign is in the attention list exactly once
    expect(page.querySelectorAll('[data-attention-key="opp:o2"]')).toHaveLength(1);
    expect([...page.querySelectorAll("[data-attention-key]")].filter((x) => x.textContent?.includes("Mall roadshow"))).toHaveLength(1);
    // the booking review belongs to the Project Manager: oversight for Operations, not an item in this person's list
    expect(page.querySelector('[data-attention-key="equipment-review:p1"]')).toBeNull();
  });

  it("the Project Manager sees the booking review as their own item, with no Operations summary", async () => {
    reviews = [{ projectId: "p1", reference: "UAE-P-2027-0001", name: "Fictional Expo stand", count: 1, since: "2027-02-18T08:00:00Z" }];
    const page = await render();
    const item = page.querySelector('[data-attention-key="equipment-review:p1"]')!;
    expect(item.textContent).toMatch(/UAE-P-2027-0001 Fictional Expo stand.*Review equipment booking: a committed date changed/);
    expect(item.querySelector("a")!.getAttribute("href")).toBe("/projects/p1/equipment");
    expect(page.querySelector('[aria-label="Operations summary"]')).toBeNull();
  });

  it("a failed Operations read says so on the card and in the attention list, and is never an empty summary", async () => {
    ops = "throw"; reviews = "throw";
    const page = await render();
    expect(page.textContent).toContain("Operations could not be loaded right now. Reload in a moment.");
    expect(page.textContent).toContain("Operations could not be loaded. Reload to try again.");
    expect(page.textContent).toContain("Equipment bookings to review could not be loaded. Reload to try again.");
    expect(page.textContent).not.toContain("Nothing recorded needs a decision");
    ops = { reads: [{ company: { id: "c1", name: "Fictional UAE" }, overview: { state: "error" }, upcoming: { state: "ok", data: [] } }] }; reviews = null;
    const partial = await render();
    const card = partial.querySelector('[aria-label="Operations summary"]')!;
    expect(card.textContent).toContain("Operations for Fictional UAE could not be loaded, so nothing is counted.");
    expect(card.querySelector('[data-testid="my-day-ops-decisions"]')!.textContent).toContain("—");
    expect(card.textContent).not.toMatch(/\b0\b recorded/);
  });
});
