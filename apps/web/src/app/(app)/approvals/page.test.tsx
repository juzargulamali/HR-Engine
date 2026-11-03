/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/approvals", redirect: vi.fn() }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("./decision-buttons", () => ({ DecisionButtons: () => <button type="button">Decide</button> }));
vi.mock("./recovery-credit-decision-form", () => ({ RecoveryCreditDecisionForm: () => null }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
let grants: { role: string; companyId: string | null }[] = [];
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e-mgr", email: null, fullName: "Manager", grants }) }));

import ApprovalsPage from "./page";

const LEAVE_APPROVAL = { id: "a1", entity_type: "leave_request", entity_id: "lr1", step_order: 1, workflow_id: null, approver_id: "u1", queue_roles: null, created_at: "2026-11-01" };
const healthy = (): Record<string, FakeResult> => ({
  approvals: rows([LEAVE_APPROVAL]),
  leave_requests: rows([{ id: "lr1", employee_id: "e1", leave_type_code: "annual", start_date: "2026-12-01", end_date: "2026-12-05", total_days: 5, reason: "Trip" }]),
  employees: rows([{ id: "e1", first_name: "Aisha", last_name: "Khan", company_id: "c1", country_code: "AE" }]),
  leave_balances: rows([{ employee_id: "e1", leave_type_code: "annual", balance_days: 2 }]),
  comp_day_balances: rows([]),
  deduction_priority_rules: rows([]),
  recovery_credit_requests: rows([]),
});
const render = async () => renderToStaticMarkup(await ApprovalsPage());

beforeEach(() => { tables = healthy(); rpcs = {}; grants = []; });

describe("Approvals page", () => {
  it("healthy: lists the request and flags a balance that does not cover it", async () => {
    const html = await render();
    expect(html).toContain("Aisha Khan");
    expect(html).toContain("Insufficient balance");
    expect(html).not.toContain("Could not load");
  });

  it("each row says how long it has waited on the person (the step's own creation time)", async () => {
    const html = await render();
    expect(html).toMatch(/Waiting (\d+ days?|since today)/);
  });

  it("an empty successful read still says nothing is waiting", async () => {
    tables = { ...healthy(), approvals: rows([]) };
    expect(await render()).toContain("Nothing waiting on you right now.");
  });

  it("a failed approvals read is an error with a retry, never 'Nothing waiting on you'", async () => {
    tables = { ...healthy(), approvals: failing() };
    const html = await render();
    expect(html).toContain("Could not load your approvals");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Nothing waiting on you");
  });

  it("a failed leave-request read says so and does not claim nothing is waiting", async () => {
    tables = { ...healthy(), leave_requests: failing() };
    const html = await render();
    expect(html).toContain("Could not load part of your approvals (leave requests)");
    expect(html).not.toContain("Nothing waiting on you");
  });

  it("a failed balance read never flags a request 'Insufficient balance'; it says the balance could not be checked", async () => {
    tables = { ...healthy(), leave_balances: failing() };
    const html = await render();
    expect(html).toContain("Aisha Khan");
    expect(html).not.toContain("Insufficient balance");
    expect(html).toContain("Balance could not be checked");
    expect(html).toContain("Could not load part of your approvals (leave balances)");
  });

  it("a failed name read says the name was not loaded rather than a dash", async () => {
    tables = { ...healthy(), employees: failing() };
    const html = await render();
    expect(html).toContain("Name not loaded");
  });
});

describe("Approvals page: Recovery Leave cards for the people who decide (A15)", () => {
  const request = { id: "rc1", employee_id: "e-app", attendance_record_id: null, work_date: "2027-01-09", event_type: "standard", proposed_days: 1, corrected_at: null, work_mode: "site_work", project_name: "Project X", project_lead_employee_id: "e-mgr", applicant_route: "employee_lead_then_hr", needs_policy_review: false, routing_issue: null, recovery_window_id: null, consumption_ack_at: null };
  const inboxRow = (over: Record<string, unknown> = {}) => ({ ...request, approval_id: "a9", step_order: 1, workflow_id: null, approver_id: "u1", queue_roles: null, approval_created_at: "2026-11-01", employee_name: "Aisha Khan", company_id: "c1", country_code: "AE", ...over });
  const leadStep = { id: "a9", entity_type: "recovery_credit", entity_id: "rc1", step_order: 1, workflow_id: null, approver_id: "u1", queue_roles: null, created_at: "2026-11-01" };
  const base = (): Record<string, FakeResult> => ({ ...healthy(), approvals: rows([leadStep]), employees: rows([{ id: "e-mgr", first_name: "Leo", last_name: "Lead", company_id: "c1", country_code: "AE" }]) });
  const queueInbox = () => inboxRow({ approver_id: null, queue_roles: ["ceo", "cto"], applicant_route: "hr_admin_ceo_cto_queue", project_lead_employee_id: null });

  it("a project lead sees the applicant's name even though the lead cannot read that employee row", async () => {
    tables = { ...base(), recovery_credit_requests: rows([request]) };
    rpcs = { recovery_decider_inbox: rows([inboxRow()]) };
    const html = await render();
    expect(html).toContain("Aisha Khan");
    expect(html).not.toContain("Could not load");
  });

  it("a CEO deciding an HR Admin's request on the shared queue gets the card although neither the queue row nor the request row is readable to them", async () => {
    grants = [{ role: "ceo", companyId: "c1" }];
    tables = { ...healthy(), approvals: rows([]), employees: rows([]), recovery_credit_requests: rows([]) };
    rpcs = { recovery_decider_inbox: rows([queueInbox()]) };
    const html = await render();
    expect(html).toContain("Aisha Khan");
    expect(html).toContain("Shared CEO/CTO queue");
    expect(html).not.toContain("Nothing waiting on you");
  });

  it("a step the table already lists is not shown twice when the inbox lists it too", async () => {
    tables = { ...base(), recovery_credit_requests: rows([request]) };
    rpcs = { recovery_decider_inbox: rows([inboxRow()]) };
    const html = await render();
    expect(html.match(/Aisha Khan/g)).toHaveLength(1);
  });

  it("a CEO of another company is not offered it by the database, so no card and 'nothing waiting' is the true answer", async () => {
    grants = [{ role: "ceo", companyId: "c2" }];
    tables = { ...healthy(), approvals: rows([]), employees: rows([]), recovery_credit_requests: rows([]) };
    rpcs = { recovery_decider_inbox: rows([]) };
    const html = await render();
    expect(html).not.toContain("Aisha Khan");
    expect(html).toContain("Nothing waiting on you right now.");
  });

  it("a failed inbox read says so; it is never presented as nothing waiting", async () => {
    grants = [{ role: "ceo", companyId: "c1" }];
    tables = { ...healthy(), approvals: rows([]), employees: rows([]), recovery_credit_requests: rows([]) };
    rpcs = { recovery_decider_inbox: failing() };
    const html = await render();
    expect(html).toContain("Could not load part of your approvals (Recovery Leave approvals)");
    expect(html).not.toContain("Nothing waiting on you");
  });
});
