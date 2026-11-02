/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/alerts", redirect: vi.fn() }));
vi.mock("./acknowledge-alert-form", () => ({ AcknowledgeAlertForm: () => null }));
vi.mock("@/components/attendance/auto-refresh", () => ({ AutoRefresh: () => null }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Hana", grants: [{ role: "hr_admin", companyId: "c1", countryCode: null }] }),
}));

import AlertsPage from "./page";

const render = async () => renderToStaticMarkup(await AlertsPage());

beforeEach(() => {
  tables = {
    employees: rows([{ id: "e2", first_name: "Omar", last_name: "Ali", company_id: "c1", country_code: "AE" }]),
    employment_contracts: rows([]), employee_documents: rows([]), identity_documents: rows([]), recovery_alerts: rows([]), companies: rows([{ id: "c1", legal_name: "Enginious" }]),
  };
  rpcs = {
    recovery_scheduler_status: {
      data: {
        stale: false, open_failures: 0, windows_policy_active: false, scheduler_ready: { ready: true, reasons: [] }, last_success_at: null, database_fingerprint: null,
        work_remaining: { open_periods: 0, open_windowed_sessions: 0, unresolved_failures: 0, unrouted_window_requests: 0 },
      },
      error: null,
    },
  };
});

describe("Alerts page", () => {
  it("a successful read with nothing due says so", async () => {
    expect(await render()).toContain("Nothing needs attention right now.");
  });
  it("a failed contracts read is an error, never 'Nothing needs attention'", async () => {
    tables = { ...tables, employment_contracts: failing() };
    const html = await render();
    expect(html).toContain("Could not load part of the alerts (contracts and probation");
    expect(html).not.toContain("Nothing needs attention right now.");
  });
  it("a failed Recovery Leave alerts read is named too", async () => {
    tables = { ...tables, recovery_alerts: failing() };
    expect(await render()).toContain("Recovery Leave alerts");
  });
  it("a failed processor-status read for an HR Admin is reported (it is only 'not for you' for others)", async () => {
    rpcs = { recovery_scheduler_status: failing("down") };
    const html = await render();
    expect(html).toContain("background processing status");
  });
});
