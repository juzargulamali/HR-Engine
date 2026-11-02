/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", redirect: vi.fn() }));
vi.mock("@/lib/weather", () => ({ getCurrentWeather: async () => null }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Aisha Khan", grants }) }));
let salesToday: Record<string, unknown> = { status: "none" };
let equipmentFails = false;
vi.mock("@/lib/crm/my-day", () => ({ loadSalesToday: async () => salesToday }));
let projectsCtx: Record<string, unknown> | null = null;
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => projectsCtx }));
let myWork: { open: unknown[]; reviews: unknown[]; today: string } | "fail" = "fail";
let attention: Record<string, unknown> | "fail" = "fail";
vi.mock("@/lib/projects/my-work", () => ({
  loadProjectsAttention: async () => { if (attention === "fail") throw new Error("Work could not be loaded"); return attention; },
  loadMyWork: async () => { if (myWork === "fail") throw new Error("Work could not be loaded"); return myWork; },
}));
vi.mock("@/lib/my-day/loaders", () => ({
  loadEquipment: async () => { if (equipmentFails) throw new Error("down"); return null; }, loadLiveClock: async () => ({}), loadPortfolio: async () => { throw new Error("down"); },
}));
vi.mock("./attendance-clock-card", () => ({ AttendanceClockCard: () => null }));
vi.mock("./birthdays-section", () => ({ BirthdaysSection: () => null }));
vi.mock("@/components/my-day/people-today", () => ({ PeopleToday: () => null }));
vi.mock("@/components/my-day/next-dispatch", () => ({ NextDispatch: () => null }));

import DashboardPage from "./page";

const render = async () => renderToStaticMarkup(await DashboardPage());
const PENDING_NAMED = { data: [], error: null, count: 2 };
const EMPTY_INBOX: FakeResult = { data: { companies: [], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [], is_finance_anywhere: false, is_executive_anywhere: false }, error: null };
const inboxWith = (over: Record<string, unknown>): FakeResult => ({ data: { ...(EMPTY_INBOX.data as object), ...over }, error: null });
const budgetRow = (over: Record<string, unknown>) => ({ budget_id: "b1", project_id: "p1", reference: "P-1", name: "Expo", company_id: "c1", version_id: "v1", i_can_decide: true, on_hold: false, ...over });

beforeEach(() => {
  grants = [];
  projectsCtx = null;
  tables = { companies: rows([]), approvals: PENDING_NAMED, employees: rows([]) };
  rpcs = { pbx_inbox: EMPTY_INBOX };
  salesToday = { status: "none" };
  myWork = "fail";
  attention = "fail";
  equipmentFails = false;
});

describe("My Day approvals", () => {
  it("healthy: the count, the primary button and the tile", async () => {
    const html = await render();
    expect(html).toContain("Review approvals (2)");
    expect(html).toContain("Your updates for today: 2 items need your attention.");
  });

  it("a failed approvals read: tile '—', error row, honest greeting, no fall-back to 'Request leave'", async () => {
    tables = { ...tables, approvals: failing() };
    const html = await render();
    expect(html).toContain("Approvals could not be loaded");
    expect(html).toContain("Could not be loaded");
    expect(html).toContain("Review approvals");
    expect(html).not.toContain("Nothing needs your attention right now.");
    expect(html).not.toContain("Nothing is waiting on you");
    expect(html).not.toContain("Request leave");
  });

  it("a genuine zero still says nothing is waiting", async () => {
    tables = { ...tables, approvals: { data: [], error: null, count: 0 } };
    const html = await render();
    expect(html).toContain("Nothing needs your attention right now.");
    expect(html).toContain("Request leave");
  });

  it("an HR Admin with Recovery Leave queue steps sees them counted (D-21)", async () => {
    grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
    tables = { ...tables, approvals: () => ({ data: [], error: null, count: 0 }) };
    // the queue steps this person decides now come from the database's own list (recovery_decider_inbox)
    rpcs = { ...rpcs, recovery_decider_inbox: rows([{ approval_id: "a1", approver_id: null, queue_roles: ["hr_admin"], id: "r1", employee_id: "e-other", company_id: "c1" }]) };
    const html = await render();
    expect(html).toContain("Review approvals (1)");
    expect(html).not.toContain("Nothing needs your attention right now.");
  });

  it("a failed Projects read shows one error row instead of dropping the card", async () => {
    projectsCtx = { installed: true, grants: [{ companyId: "c1", capabilities: ["view"] }], loadFailed: false };
    const html = await render();
    expect(html).toContain("Project items could not be loaded");
  });

  it("a failed Projects access lookup shows the error row too (the card does not vanish)", async () => {
    projectsCtx = { installed: true, grants: [], loadFailed: true };
    const html = await render();
    expect(html).toContain("Project items could not be loaded");
  });

  it("a Finance person with no Projects grant sees the budgets waiting for them, and the count joins the decisions", async () => {
    rpcs = { pbx_inbox: inboxWith({ budget_approvals: [budgetRow({}), budgetRow({ version_id: "v2" }), budgetRow({ version_id: "v3", i_can_decide: false })] }) };
    tables = { ...tables, pbx_budget_versions: rows([]) };
    const html = await render();
    expect(html).toContain("Project budgets waiting for you");
    expect(html).toContain("/finance/project-budgets?filter=budget");
    // the decisions count is stated once, by the "Needs me" card, not repeated as a tile
    expect(html).not.toContain("Decisions waiting");
    expect(html).toContain("Needs me");
    expect(html).toContain("Review approvals (2)");   // the approvals count is unchanged: budgets are their own row
    expect(html).toContain("Your updates for today: 4 items need your attention.");
  });

  it("items the person submitted themselves stay visible under 'Waiting on others', not as a decision", async () => {
    rpcs = { pbx_inbox: inboxWith({ budget_approvals: [budgetRow({ i_can_decide: false })] }) };
    tables = { ...tables, approvals: { data: [], error: null, count: 0 }, pbx_budget_versions: rows([{ id: "v1" }]) };
    const html = await render();
    expect(html).toContain("Waiting on others");
    expect(html).toContain("Project budgets you submitted, waiting on others");
    expect(html).not.toContain("Project budgets waiting for you");
    expect(html).toContain("Nothing needs your attention right now.");
  });

  it("a failed pbx_inbox read shows an error row, not 0 and not nothing", async () => {
    rpcs = { pbx_inbox: failing() };
    const html = await render();
    expect(html).toContain("Project budgets could not be loaded");
    expect(html).not.toContain("Nothing needs your attention right now.");
  });

  it("a failed read of what the person authored is an error row too", async () => {
    rpcs = { pbx_inbox: inboxWith({ budget_approvals: [budgetRow({})] }) };
    tables = { ...tables, pbx_budget_versions: failing() };
    expect(await render()).toContain("Project budgets could not be loaded");
  });

  it("a person with no budget access (empty inbox) sees no budget row at all", async () => {
    const html = await render();
    expect(html).not.toContain("Project budgets");
    expect(html).not.toContain("Waiting on others");
  });

  it("Project budgets not installed here: no row and no error", async () => {
    rpcs = { pbx_inbox: { data: null, error: { message: "Could not find the function public.pbx_inbox in the schema cache", code: "PGRST202" } } };
    const html = await render();
    expect(html).not.toContain("Project budgets");
  });

  const salesOk = (handover: unknown) => ({ status: "ok", data: { attention: [], overdue: 0, dueToday: 0, noFirstResponse: 0, openCount: 1, opportunityCount: 1, pipeline: [], handover, approvals: { status: "none" } } });
  const hrow = (kind: string, id: string) => ({ kind, opportunityId: id, reference: `R-${id}`, title: `Job ${id}`, detail: "", scope: "mine", at: null });

  it("the Sales owner sees the handover rows on My Day without any Projects access", async () => {
    salesToday = salesOk({ status: "ok", rows: [hrow("handover_question", "a"), hrow("won_no_handover", "b"), hrow("won_no_handover", "c")] });
    tables = { ...tables, approvals: { data: [], error: null, count: 0 } };
    const html = await render();
    expect(html).toContain("Handover: the PM asked a question");
    expect(html).toContain("Won, handover not submitted");
    expect(html).toContain("/sales/opportunities/a/handover");
    expect(html).toContain("Your updates for today: 3 items need your attention.");
  });

  it("a failed handover read is an error row, 'Could not check handovers', not a missing row", async () => {
    salesToday = salesOk({ status: "error" });
    tables = { ...tables, approvals: { data: [], error: null, count: 0 } };
    const html = await render();
    expect(html).toContain("Could not check handovers");
    expect(html).not.toContain("Nothing needs your attention right now.");
  });

  it("a Sales founder sees the commercial approvals waiting for them; a failed read is an error row", async () => {
    tables = { ...tables, approvals: { data: [], error: null, count: 0 } };
    salesToday = salesOk({ status: "ok", rows: [] });
    (salesToday.data as Record<string, unknown>).approvals = { status: "ok", count: 2, oldestOpportunityId: "o1" };
    let html = await render();
    expect(html).toContain("Commercial approvals waiting for your decision");
    expect(html).toContain("/sales/opportunities/o1?tab=commercial");
    (salesToday.data as Record<string, unknown>).approvals = { status: "error" };
    html = await render();
    expect(html).toContain("Commercial approvals could not be loaded");
  });

  it("no handover rows: nothing about handovers", async () => {
    salesToday = salesOk({ status: "ok", rows: [] });
    expect(await render()).not.toContain("handover");
  });
});
