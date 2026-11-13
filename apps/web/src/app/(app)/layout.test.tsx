/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "sidebar-collapsed" ? { value: "1" } : undefined) }) }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
let session: Record<string, unknown> = {};
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => session }));
let probes = { projects: {}, inventory: {}, budget: {} } as Record<string, Record<string, unknown>>;
vi.mock("@/lib/projects/context", () => ({ loadProjectsNavAccess: async () => ({ grants: [], salesLinked: false, pendingHandovers: false, managesProjects: false, ...probes.projects }) }));
vi.mock("@/lib/inventory/context", () => ({ loadInventoryNavAccess: async () => ({ grants: [], managesProjects: false, isEmployee: false, ...probes.inventory }) }));
let waitingResult: { state: "ok"; count: number } | { state: "none" } | { state: "error" } = { state: "ok", count: 0 };
const waitingCalls = vi.fn();
vi.mock("@/lib/budget/data", () => ({
  loadBudgetNavAccess: async () => ({ any: false, finance: false, manageAccess: false, canDecide: false, ...probes.budget }),
  loadBudgetWaitingCount: async () => { waitingCalls(); return waitingResult; },
}));
vi.mock("@/components/nav/app-shell", () => ({
  AppShell: ({ hasPendingApprovals, clockOpenSince, clockLoadFailed, budget, children }: { hasPendingApprovals: boolean; clockOpenSince: string | null; clockLoadFailed: boolean; budget?: { waiting?: number }; children: React.ReactNode }) => (
    <div data-pending={String(hasPendingApprovals)} data-clock-since={String(clockOpenSince)} data-clock-failed={String(clockLoadFailed)} data-budget-waiting={String(budget?.waiting)}>{children}</div>
  ),
}));

import AppLayout from "./layout";

const render = async () => renderToStaticMarkup(await AppLayout({ children: <p>page body</p> }));

beforeEach(() => {
  session = { userId: "u1", employeeId: null, email: null, fullName: "Sam", grants: [] };
  probes = { projects: {}, inventory: {}, budget: {} };
  waitingResult = { state: "ok", count: 0 };
  waitingCalls.mockClear();
  tables = {
    approvals: { data: [], error: null, count: 0 },
    crm_company_grants: rows([]),
  };
});

describe("App layout", () => {
  it("healthy: no banner, and the approvals link only when something waits", async () => {
    const html = await render();
    expect(html).toContain("page body");
    expect(html).not.toContain("could not be loaded");
    expect(html).toContain('data-pending="false"');
    tables = { ...tables, approvals: { data: [], error: null, count: 2 } };
    expect(await render()).toContain('data-pending="true"');
  });

  it("a failed account read shows one banner: not a missing role or employee record", async () => {
    session = { ...session, loadFailed: true };
    const html = await render();
    expect(html).toContain("Could not load your account");
    expect(html).toContain("not a missing role or employee record");
    expect(html).toContain("page body");
  });

  it("a failed approvals count keeps the Approvals link visible and says part of the menu could not load", async () => {
    tables = { ...tables, approvals: failing() };
    const html = await render();
    expect(html).toContain('data-pending="true"');
    expect(html).toContain("Some menu items could not be loaded");
  });

  it("a failed Sales grants read is reported, but 'not installed' stays quiet", async () => {
    tables = { ...tables, crm_company_grants: failing() };
    expect(await render()).toContain("Some menu items could not be loaded");
    tables = { ...tables, crm_company_grants: { data: null, error: { message: "relation does not exist", code: "42P01" } } };
    expect(await render()).not.toContain("Some menu items could not be loaded");
  });

  it("a failed direct-reports read is reported; a healthy one is quiet", async () => {
    session = { ...session, employeeId: "e1" };
    tables = { ...tables, employees: failing() };
    expect(await render()).toContain("Some menu items could not be loaded");
    tables = { ...tables, employees: { data: null, error: null, count: 2 } };
    expect(await render()).not.toContain("Some menu items could not be loaded");
  });

  it.each(["projects", "inventory", "budget"])("a failed %s navigation probe is reported", async (name) => {
    probes[name] = { loadFailed: true };
    expect(await render()).toContain("Some menu items could not be loaded");
  });

  describe("Finance menu: waiting count", () => {
    it("people who can decide get the number from the small count function, and 0 is simply no number", async () => {
      probes.budget = { any: true, finance: true, canDecide: true };
      waitingResult = { state: "ok", count: 3 };
      expect(await render()).toContain('data-budget-waiting="3"');
      waitingResult = { state: "ok", count: 0 };
      const html = await render();
      expect(html).toContain('data-budget-waiting="undefined"');
      expect(html).not.toContain("could not be loaded");
    });
    it("is not asked at all for a view-only grantee or someone with no budget access (no extra work on every page)", async () => {
      probes.budget = { any: true, finance: false, canDecide: false };
      await render();
      probes.budget = { any: false, canDecide: false };
      await render();
      expect(waitingCalls).not.toHaveBeenCalled();
    });
    it("a failed read shows no number (never 0) and the existing menu banner; 'not installed' stays quiet", async () => {
      probes.budget = { any: true, finance: true, canDecide: true };
      waitingResult = { state: "error" };
      let html = await render();
      expect(html).toContain('data-budget-waiting="undefined"');
      expect(html).toContain("Some menu items could not be loaded");
      waitingResult = { state: "none" };
      html = await render();
      expect(html).not.toContain("Some menu items could not be loaded");
    });
  });

  describe("header clock status", () => {
    beforeEach(() => { session = { ...session, employeeId: "e1" }; });
    it("healthy: open session, then no open session", async () => {
      tables = { ...tables, attendance_sessions: { data: { clock_in_at: "2026-11-03T08:00:00Z" }, error: null } };
      let html = await render();
      expect(html).toContain('data-clock-since="2026-11-03T08:00:00Z"');
      expect(html).toContain('data-clock-failed="false"');
      tables = { ...tables, attendance_sessions: { data: null, error: null } };
      html = await render();
      expect(html).toContain('data-clock-since="null"');
      expect(html).toContain('data-clock-failed="false"');
    });
    it("a failed read is flagged as failed, never passed on as 'no open session'", async () => {
      tables = { ...tables, attendance_sessions: failing() };
      const html = await render();
      expect(html).toContain('data-clock-failed="true"');
      expect(html).toContain("page body");
    });
  });
});
