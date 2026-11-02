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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e-mgr", email: null, fullName: "Manager", grants: [] }) }));

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

beforeEach(() => { tables = healthy(); });

describe("Approvals page", () => {
  it("healthy: lists the request and flags a balance that does not cover it", async () => {
    const html = await render();
    expect(html).toContain("Aisha Khan");
    expect(html).toContain("Insufficient balance");
    expect(html).not.toContain("Could not load");
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
