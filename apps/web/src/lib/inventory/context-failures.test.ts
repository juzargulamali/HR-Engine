import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", fullName: "Op", employeeId: null, grants: [] }) }));

import { getInventoryContext, loadInventoryNavAccess } from "./context";
import { loadEquipment } from "@/lib/my-day/loaders";

beforeEach(() => {
  tables = {
    inv_company_grants: rows([{ company_id: "c1", capabilities: ["warehouse"] }]),
    employees: rows([{ id: "e1" }]),
    proj_projects: { data: null, error: null, count: 0 },
    companies: rows([{ id: "c1", legal_name: "Enginious" }]),
    inv_company_settings: rows([{ company_id: "c1", reference_code: "UAE", is_enabled: true }]),
    inv_locations: rows([{ id: "l1", company_id: "c1", name: "Dubai warehouse" }]),
    inv_operator_locations: rows([{ location_id: "l1" }]),
  };
});

describe("Inventory context", () => {
  it("healthy: locations, settings and assignments load", async () => {
    const ctx = await getInventoryContext();
    expect(ctx?.loadFailed).toBeUndefined();
    expect(ctx?.locations).toHaveLength(1);
    expect(ctx?.companies[0]?.isEnabled).toBe(true);
    expect(ctx?.assignedLocationIds).toEqual(["l1"]);
  });
  it.each([
    ["locations", "inv_locations"], ["settings", "inv_company_settings"], ["assignments", "inv_operator_locations"], ["companies", "companies"],
  ])("a failed %s read is a load failure, not 'no warehouse set up', 'switched off' or a wrong default warehouse", async (_n, table) => {
    tables = { ...tables, [table]: failing() };
    const ctx = await getInventoryContext();
    expect(ctx?.loadFailed).toBe(true);
    expect(ctx?.locations).toEqual([]);
  });
  it("a failed project-manager count is a load failure, not 'not a project manager'", async () => {
    tables = { ...tables, proj_projects: { data: null, error: { message: "down" }, count: null } };
    expect((await getInventoryContext())?.loadFailed).toBe(true);
  });
  it("Projects not being installed is quiet: the person simply manages no projects", async () => {
    tables = { ...tables, proj_projects: { data: null, error: { message: "relation does not exist", code: "42P01" }, count: null } };
    const ctx = await getInventoryContext();
    expect(ctx?.loadFailed).toBeUndefined();
    expect(ctx?.managesProjects).toBe(false);
  });
  it("the My Day equipment card throws when access could not load, so the page can say so instead of dropping the card", async () => {
    tables = { ...tables, inv_locations: failing() };
    await expect(loadEquipment()).rejects.toThrow(/could not be loaded/);
  });
  it("the nav probe reports a failed grants read, but stays quiet when Inventory is not installed", async () => {
    tables = { ...tables, inv_company_grants: failing() };
    expect((await loadInventoryNavAccess("u1")).loadFailed).toBe(true);
    tables = { ...tables, inv_company_grants: { data: null, error: { message: "does not exist", code: "42P01" } } };
    expect((await loadInventoryNavAccess("u1")).loadFailed).toBeUndefined();
  });
});
