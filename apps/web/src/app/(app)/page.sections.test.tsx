/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

/**
 * My Day: "My work today", "Needs me" and "Waiting on others". Every source is read on its own: a source that fails is its own error row and the others still list.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", redirect: vi.fn() }));
vi.mock("@/lib/weather", () => ({ getCurrentWeather: async () => null }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Aisha Khan", grants }) }));
vi.mock("@/lib/crm/my-day", () => ({ loadSalesToday: async () => ({ status: "none" }) }));
let projectsCtx: Record<string, unknown> | null = null;
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => projectsCtx }));
type Settled = { ok: unknown } | "fail";
let attention: Settled = "fail";
let myWork: Settled = "fail";
const result = (s: Settled) => { if (s === "fail") throw new Error("Work could not be loaded"); return s.ok; };
vi.mock("@/lib/projects/my-work", () => ({ loadProjectsAttention: async () => result(attention), loadMyWork: async () => result(myWork) }));
vi.mock("@/lib/my-day/loaders", () => ({ loadEquipment: async () => null, loadLiveClock: async () => ({}), loadPortfolio: async () => { throw new Error("down"); } }));
vi.mock("./attendance-clock-card", () => ({ AttendanceClockCard: () => null }));
vi.mock("./birthdays-section", () => ({ BirthdaysSection: () => null }));
vi.mock("@/components/my-day/people-today", () => ({ PeopleToday: () => null }));
vi.mock("@/components/my-day/next-dispatch", () => ({ NextDispatch: () => null }));

import DashboardPage from "./page";

const render = async () => renderToStaticMarkup(await DashboardPage());
const NO_ATTENTION = { overdueTasks: 0, dueSoonTasks: 0, reviewsWaiting: 0, handoversWaiting: 0, scopeChangesWaiting: 0, scopeChangeProjectId: null, unreadMessages: 0, unreadProjects: 0 };
const EMPTY_INBOX: FakeResult = { data: { companies: [], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [], is_finance_anywhere: false, is_executive_anywhere: false }, error: null };
const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Task ${id}`, status: "in_progress", due_date: null, blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null,
  projectReference: "P-7", projectName: "Expo Hall", assignee_id: "u1", ...over,
});
const todayDubai = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const inDays = (n: number) => new Date(new Date(`${todayDubai}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const withProjects = (open: unknown[] = []) => {
  projectsCtx = { installed: true, grants: [{ companyId: "c1", capabilities: ["view"] }], loadFailed: false, personName: (id: string) => (id === "u2" ? "Omar Ali" : "Unknown") };
  attention = { ok: NO_ATTENTION };
  myWork = { ok: { open, reviews: [], today: todayDubai } };
};

beforeEach(() => {
  grants = [];
  projectsCtx = null;
  attention = "fail";
  myWork = "fail";
  tables = { companies: rows([]), approvals: { data: [], error: null, count: 0 }, employees: rows([]), leave_requests: rows([]), reimbursement_claims: rows([]), recovery_credit_requests: rows([]) };
  rpcs = { pbx_inbox: EMPTY_INBOX };
});

describe("My work today", () => {
  it("shows task titles with the project, due today apart from later, and what blocks me", async () => {
    withProjects([
      task("a", { title: "Rig the stage lights", due_date: todayDubai }),
      task("b", { title: "Order the cabling", due_date: inDays(3) }),
      task("c", { title: "Approve the floor plan", blocked_at: "2026-11-01T08:00:00Z", blocked_reason: "Waiting for the venue", unblock_owner_id: "u2" }),
      task("d", { title: "Send the invoice", due_date: inDays(-2) }),
    ]);
    const html = await render();
    expect(html).toContain('aria-label="My work today"');
    for (const title of ["Rig the stage lights", "Order the cabling", "Approve the floor plan", "Send the invoice"]) expect(html).toContain(title);
    expect(html).toContain("Due today");
    expect(html).toContain("Overdue");
    expect(html).toContain("Blocked: Waiting for the venue");
    expect(html).toContain("Omar Ali can unblock it");
    expect(html.indexOf("Send the invoice")).toBeLessThan(html.indexOf("Rig the stage lights"));
    expect(html.indexOf("Rig the stage lights")).toBeLessThan(html.indexOf("Order the cabling"));
    expect(html).toContain("/projects/work?task=a");
    // one block per fact: the overdue count is not repeated as a row in "Needs me"
    expect(html).not.toContain("Project task overdue");
  });

  it("a failed read of the tasks is one error line, and the rest of the page still lists", async () => {
    withProjects();
    myWork = "fail";
    attention = { ok: { ...NO_ATTENTION, reviewsWaiting: 2 } };
    tables = { ...tables, approvals: { data: [], error: null, count: 3 } };
    const html = await render();
    expect(html).toContain("Your tasks could not be loaded");
    expect(html).not.toContain("No open tasks assigned to you");
    expect(html).toContain("Waiting on your decision");
    expect(html).toContain("Project tasks waiting for your review");
    expect(html).toContain("/projects/work?show=review");
  });

  it("someone with no Projects access sees no card and nothing about tasks", async () => {
    const html = await render();
    expect(html).not.toContain("My work today");
    expect(html).not.toContain("tasks could not be loaded");
  });

  it("a person with Projects access and no open tasks is told so", async () => {
    withProjects([]);
    expect(await render()).toContain("No open tasks assigned to you or shared with you.");
  });
});

describe("Needs me and Waiting on others", () => {
  it("one 'Needs me' list: approvals, budget steps and project reviews together, titled for the person", async () => {
    withProjects();
    attention = { ok: { ...NO_ATTENTION, reviewsWaiting: 1, handoversWaiting: 1 } };
    tables = { ...tables, approvals: { data: [], error: null, count: 2 } };
    const html = await render();
    expect((html.match(/aria-label="Needs me"/g) ?? []).length).toBe(1);
    expect(html).toContain("Waiting on your decision");
    expect(html).toContain("Project handover waiting on you");
    expect(html).toContain("Project task waiting for your review");
  });

  it("what the person submitted themselves stays under 'Waiting on others', with its age, and is never a decision for them", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000 - 3_600_000).toISOString();
    tables = {
      ...tables,
      leave_requests: rows([{ submitted_at: twoDaysAgo }]),
      reimbursement_claims: rows([{ submitted_at: twoDaysAgo, created_at: twoDaysAgo }, { submitted_at: null, created_at: twoDaysAgo }]),
      recovery_credit_requests: rows([{ submitted_at: twoDaysAgo }]),
    };
    const html = await render();
    expect(html).toContain("Waiting on others");
    expect(html).toContain("Leave request you submitted, waiting for a decision");
    expect(html).toContain("Expense claims you submitted, waiting for decisions");
    expect(html).toContain("Recovery Leave request you submitted, waiting for a decision");
    expect(html).toContain("Oldest waiting 2 days");
    // not counted as something that needs the person
    expect(html).toContain("Nothing needs your attention right now.");
    expect(html).toContain("Nothing is waiting on you");
  });

  it("a task the person sent for review waits on the reviewer, not on them", async () => {
    withProjects([task("r", { status: "ready_for_review", title: "Stage plan" }), task("a", { title: "Cabling", due_date: todayDubai })]);
    const html = await render();
    expect(html).toContain("Task you sent for review, waiting on the reviewer");
    // listed once: only in Waiting on others, not as work to do
    expect(html).not.toContain("Stage plan");
    expect(html).toContain("Cabling");
  });

  it("each waiting source fails on its own: an error row for it, the others still list", async () => {
    tables = { ...tables, leave_requests: rows([{ submitted_at: new Date().toISOString() }]), reimbursement_claims: failing(), recovery_credit_requests: rows([]) };
    const html = await render();
    expect(html).toContain("Your expense claims could not be loaded");
    expect(html).toContain("Leave request you submitted, waiting for a decision");
    expect(html).not.toContain("Your leave requests could not be loaded");
  });

  it("every source failing at once still renders the page with an error row per source", async () => {
    withProjects();
    attention = "fail";
    myWork = "fail";
    tables = { ...tables, approvals: failing(), leave_requests: failing(), reimbursement_claims: failing(), recovery_credit_requests: failing() };
    rpcs = { pbx_inbox: failing() };
    const html = await render();
    for (const line of ["Approvals could not be loaded", "Project items could not be loaded", "Project budgets could not be loaded", "Your tasks could not be loaded", "Your leave requests could not be loaded", "Your expense claims could not be loaded", "Your Recovery Leave requests could not be loaded"]) {
      expect(html, line).toContain(line);
    }
    expect(html).not.toContain("Nothing is waiting on you");
    expect(html).not.toContain("Nothing needs your attention right now.");
  });

  it("a person with nothing submitted sees no 'Waiting on others' heading", async () => {
    expect(await render()).not.toContain("Waiting on others");
  });
});

describe("Dispatch and return notes waiting for me (C4)", () => {
  it("lists a note waiting for my acknowledgement under Needs me, linking to the project's Equipment page", async () => {
    rpcs = { ...rpcs, inv_notes_waiting_for_me: rows([{ note_id: "n1", note_no: "ENG-D-00017", kind: "dispatch", project_id: "p9", project_ref: "ENG-P-9", project_name: "Mall activation", waiting_since: new Date(Date.now() - 2 * 86_400_000).toISOString() }]) };
    const html = await render();
    expect(html).toContain("Dispatch note waiting for you: Mall activation");
    expect(html).toContain("/projects/p9/equipment?note=n1#notes");
    expect(html).not.toContain("Dispatch and return notes could not be loaded");
  });
  it("a failed read is an error row, never 'nothing waiting', and the rest of the page still lists", async () => {
    rpcs = { ...rpcs, inv_notes_waiting_for_me: failing() };
    const html = await render();
    expect(html).toContain("Dispatch and return notes could not be loaded");
    expect(html).not.toContain("Nothing needs your attention right now.");
  });
  it("nothing waiting, or notes not installed in this database, adds nothing to the page", async () => {
    const quiet = await render();
    expect(quiet).not.toContain("waiting for you");
    rpcs = { ...rpcs, inv_notes_waiting_for_me: { data: null, error: { message: "Could not find the function public.inv_notes_waiting_for_me", code: "PGRST202" } } };
    const html = await render();
    expect(html).not.toContain("Dispatch and return notes could not be loaded");
    expect(html).not.toContain("Dispatch note waiting");
  });
});

describe("one block per fact; no dead rows", () => {
  it("has no 'Coming soon' line, no Quick actions card and no Decisions waiting tile", async () => {
    grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
    const html = await render();
    expect(html).not.toContain("Coming soon");
    expect(html).not.toContain("Quick actions");
    expect(html).not.toContain("Decisions waiting");
  });
  it("the HR figure that is not a list is not a link, and 'On leave' opens the register", async () => {
    grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
    tables = { ...tables, companies: rows([{ id: "c1", legal_name: "Enginious FZ", country_code: "AE" }]) };
    const html = await render();
    const inReview = html.indexOf("Leave requests in review");
    expect(inReview).toBeGreaterThan(-1);
    // the tile for "in review" is a plain card (no anchor around it)
    expect(html.slice(Math.max(0, inReview - 400), inReview)).not.toContain('href="/approvals"');
    expect(html).toContain("Leave recorded for today; see the register");
  });
});
