import { describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import { loadBudgetNavAccess, loadProjectBudgetAccess } from "./data";

const NOT_INSTALLED = { data: null, error: { message: "Could not find the table in the schema cache", code: "PGRST205" } };

describe("Budget navigation and tab probes", () => {
  it("healthy: Finance access is read", async () => {
    tables = { pbx_company_grants: rows([{ capabilities: ["finance"] }]) };
    expect(await loadBudgetNavAccess("u1")).toMatchObject({ any: true, finance: true });
  });
  it("a failed read is flagged, so the menu says it could not load instead of silently dropping Finance", async () => {
    tables = { pbx_company_grants: failing() };
    expect((await loadBudgetNavAccess("u1")).loadFailed).toBe(true);
  });
  it("'module not installed' stays quiet", async () => {
    tables = { pbx_company_grants: NOT_INSTALLED };
    const r = await loadBudgetNavAccess("u1");
    expect(r.any).toBe(false);
    expect(r.loadFailed).toBeUndefined();
  });
  it("the project Budget tab check reports a failure instead of looking like 'no access'", async () => {
    rpcs = { pbx_project_access: failing() };
    expect(await loadProjectBudgetAccess("p1")).toMatchObject({ can_open: false, loadFailed: true });
    rpcs = { pbx_project_access: NOT_INSTALLED };
    expect((await loadProjectBudgetAccess("p2")).loadFailed).toBeUndefined();
  });
});
