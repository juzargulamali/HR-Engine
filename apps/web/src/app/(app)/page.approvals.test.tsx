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
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Aisha Khan", grants }) }));
vi.mock("@/lib/crm/my-day", () => ({ loadSalesToday: async () => ({ status: "none" }) }));
let projectsCtx: Record<string, unknown> | null = null;
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => projectsCtx }));
vi.mock("@/lib/projects/my-work", () => ({ loadProjectsAttention: async () => { throw new Error("Work could not be loaded"); } }));
vi.mock("@/lib/my-day/loaders", () => ({
  loadEquipment: async () => null, loadLiveClock: async () => ({}), loadPortfolio: async () => { throw new Error("down"); },
}));
vi.mock("./attendance-clock-card", () => ({ AttendanceClockCard: () => null }));
vi.mock("./birthdays-section", () => ({ BirthdaysSection: () => null }));
vi.mock("@/components/my-day/people-today", () => ({ PeopleToday: () => null }));
vi.mock("@/components/my-day/next-dispatch", () => ({ NextDispatch: () => null }));

import DashboardPage from "./page";

const render = async () => renderToStaticMarkup(await DashboardPage());
const PENDING_NAMED = { data: [], error: null, count: 2 };

beforeEach(() => {
  grants = [];
  projectsCtx = null;
  tables = { companies: rows([]), approvals: PENDING_NAMED, employees: rows([]) };
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
    tables = {
      ...tables,
      approvals: () => ({ data: [{ entity_id: "r1", workflow_id: null, step_order: 1, queue_roles: ["hr_admin"] }], error: null, count: 0 }),
      recovery_credit_requests: rows([{ id: "r1", employee_id: "e-other" }]),
      employees: rows([{ id: "e-other", company_id: "c1" }]),
    };
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
});
