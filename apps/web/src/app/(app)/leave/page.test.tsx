/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/leave", redirect: vi.fn() }));
vi.mock("./cancel-request-button", () => ({ CancelRequestButton: () => null }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
let session: Record<string, unknown> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => session }));

import LeavePage from "./page";
import NewLeaveRequestPage from "./new/page";

const SESSION = { userId: "u1", employeeId: "e1", email: null, fullName: "Aisha", grants: [] };
const renderLeave = async () => renderToStaticMarkup(await LeavePage({ searchParams: Promise.resolve({}) }));
const renderNew = async () => renderToStaticMarkup(await NewLeaveRequestPage());

beforeEach(() => {
  session = SESSION;
  rpcs = { i_am_c_level: row(false), resolve_approver: row("mgr-user") };
  tables = {
    employees: row({ country_code: "AE", company_id: "c1" }),
    approval_workflows: rows([{ id: "w1" }]),
    approval_workflow_steps: row({ approver_type: "direct_manager" }),
    profiles: row({ full_name: "Mona Manager", email: "mona@example.com" }),
    recovery_credit_requests: rows([]),
    leave_balances: rows([{ leave_type_code: "annual", balance_days: 12 }]),
    comp_day_balances: row({ balance_days: 1 }),
    leave_requests: rows([{ id: "r1", leave_type_code: "annual", start_date: "2026-12-01", end_date: "2026-12-02", total_days: 2, status: "approved", reason: null }]),
  };
});

describe("Leave page", () => {
  it("healthy: shows the balances and the requests", async () => {
    const html = await renderLeave();
    expect(html).toContain("12 days");
    expect(html).toContain("Recovery Leave");
    expect(html).toContain("2026-12-01");
  });

  it("names who the leave requests go to, and calls the balance Recovery Leave", async () => {
    const html = await renderLeave();
    expect(html).toContain("Your leave requests go to");
    expect(html).toContain("Mona Manager");
    expect(html).not.toContain("Comp-off");
  });

  it("a failed read of who approves says it could not load, never 'nobody'", async () => {
    tables = { ...tables, approval_workflows: failing() };
    const html = await renderLeave();
    expect(html).toContain("Could not load who approves your leave");
    expect(html).not.toContain("nobody yet");
    expect(html).toContain("12 days"); // the rest of the page still shows
  });

  it("an executive's own leave needs no approver, and a missing manager is said in words", async () => {
    rpcs = { ...rpcs, i_am_c_level: row(true) };
    expect(await renderLeave()).toContain("needs no approver");
    rpcs = { i_am_c_level: row(false), resolve_approver: row(null) };
    expect(await renderLeave()).toContain("nobody yet");
  });

  it("lists Recovery Leave that is waiting for approval, and says when that list could not be loaded", async () => {
    tables = { ...tables, recovery_credit_requests: rows([{ id: "q1", work_date: "2026-10-30", event_type: "standard", proposed_days: 1, status: "pending_approval" }]) };
    const html = await renderLeave();
    expect(html).toContain("Recovery Leave waiting for approval");
    expect(html).toContain("2026-10-30");
    tables = { ...tables, recovery_credit_requests: failing() };
    const failed = await renderLeave();
    expect(failed).toContain("Could not load your Recovery Leave requests");
    expect(failed).not.toContain("Recovery Leave waiting for approval");
  });

  it("failed balances read: an error, not '0 days'", async () => {
    tables = { ...tables, leave_balances: failing() };
    const html = await renderLeave();
    expect(html).toContain("Could not load your leave balances");
    expect(html).not.toContain("Recovery Leave");
    expect(html).not.toContain("0 days");
    expect(html).toContain("2026-12-01"); // the requests still show
  });

  it("failed Recovery Leave read is the same error, never a zero balance", async () => {
    tables = { ...tables, comp_day_balances: failing() };
    const html = await renderLeave();
    expect(html).toContain("Could not load your leave balances");
    expect(html).not.toContain("0 days");
  });

  it("failed requests read: an error, not 'No leave requests yet', and the balances still show", async () => {
    tables = { ...tables, leave_requests: failing() };
    const html = await renderLeave();
    expect(html).toContain("Could not load your leave requests");
    expect(html).not.toContain("No leave requests yet");
    expect(html).toContain("12 days");
  });

  it("a successful read with no requests still says there are none", async () => {
    tables = { ...tables, leave_requests: rows([]) };
    expect(await renderLeave()).toContain("No leave requests yet");
  });

  it("a failed account read is 'could not load', not 'no employee record'", async () => {
    session = { ...SESSION, employeeId: null, loadFailed: true };
    const html = await renderLeave();
    expect(html).toContain("Could not load your account");
    expect(html).not.toContain("No employee record");
  });
});

describe("Request leave page", () => {
  const policy = { id: "v1", status: "active", effective_from: "2020-01-01", effective_to: null, version_no: 1 };
  beforeEach(() => {
    tables = { employees: row({ country_code: "AE" }), policy_versions: rows([policy]), policy_leave_types: rows([{ policy_version_id: "v1", leave_type_code: "annual", name: "Annual" }]) };
  });

  it("healthy: the form is shown", async () => {
    const html = await renderNew();
    expect(html).toContain("Submit request");
    expect(html).not.toContain("HR hasn");
  });

  it("failed policy read: never blames HR, and the form is not offered", async () => {
    tables = { ...tables, policy_versions: failing() };
    const html = await renderNew();
    expect(html).toContain("Could not load your leave policy");
    expect(html).not.toContain("HR hasn");
    expect(html).not.toContain("Submit request");
  });

  it("failed leave-type read: the same honest error", async () => {
    tables = { ...tables, policy_leave_types: failing() };
    const html = await renderNew();
    expect(html).toContain("Could not load your leave policy");
    expect(html).not.toContain("HR hasn");
  });

  it("failed employee read: the same honest error", async () => {
    tables = { ...tables, employees: failing() };
    const html = await renderNew();
    expect(html).toContain("Could not load your leave policy");
  });

  it("a SUCCESSFUL read with no active policy still shows the HR message", async () => {
    tables = { ...tables, policy_versions: rows([]) };
    const html = await renderNew();
    expect(html).toContain("HR hasn");
    expect(html).not.toContain("Could not load");
  });
});
