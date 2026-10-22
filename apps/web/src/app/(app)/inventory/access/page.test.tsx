/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";

const COMPANY = "44444444-4444-4444-8444-444444444444";
const state = vi.hoisted(() => ({ caps: [] as string[], failing: false }));

function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_t, prop) { if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result); return () => proxy; },
    apply() { return proxy; },
  });
  return proxy;
}
const tables: Record<string, unknown[]> = {
  inv_company_grants: [
    { id: "g1", user_id: "u-me", company_id: COMPANY, capabilities: ["founder"], note: null, granted_by: null, granted_at: "2026-10-01T00:00:00Z" },
    { id: "g2", user_id: "u-2", company_id: COMPANY, capabilities: ["warehouse", "view_costs"], note: "Dubai store", granted_by: "u-me", granted_at: "2026-10-02T00:00:00Z" },
  ],
  inv_operator_locations: [{ user_id: "u-2", location_id: "l1" }],
  inv_company_sharing: [],
  companies: [{ id: COMPANY, legal_name: "Enginious UAE" }, { id: "c2", legal_name: "Enginious Poland" }],
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => chain(state.failing ? { data: null, error: { message: "boom" } } : { data: tables[t] ?? [], error: null }),
    rpc: () => chain({ data: [{ user_id: "u-me", full_name: "Me", email: "me@example.com" }, { user_id: "u-2", full_name: "Amina", email: "amina@example.com" }, { user_id: "u-3", full_name: "Omar", email: "omar@example.com" }], error: null }),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/access", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({
    userId: "u-me", fullName: "Me", installed: true, grants: state.caps.length ? [{ companyId: COMPANY, capabilities: state.caps as InvCapability[] }] : [],
    companies: [{ id: COMPANY, name: "Enginious UAE", referenceCode: "UAE", isEnabled: true }],
    locations: [{ id: "l1", company_id: COMPANY, code: "DXB", name: "Dubai", kind: "warehouse", timezone: "Asia/Dubai", address: null, is_active: true, created_by: null, created_at: "", updated_at: "" }],
    assignedLocationIds: [], employeeId: null, managesProjects: false, companyName: () => "Enginious UAE", locationName: () => "Dubai",
  }),
}));

import InventoryAccessPage from "./page";
const render = async () => renderToStaticMarkup(await InventoryAccessPage({ searchParams: Promise.resolve({}) }));

describe("Access page", () => {
  it("lists people with their rights in words, where they work, and the permission explanation", async () => {
    state.caps = ["founder"]; state.failing = false;
    const html = await render();
    expect(html).toContain("People with access (2)");
    expect(html).toContain("Amina");
    expect(html).toContain("Warehouse operator");
    expect(html).toContain("See purchase costs");
    expect(html).toContain("Works at: Dubai");
    expect(html).toContain("Purchase costs are a separate right");
    expect(html).toContain("Give access");
    expect(html).toContain("Sharing equipment with another company");
    expect(html).toContain("Enginious Poland");
  });

  it("does not let someone who manages access but is not a founder change a cost reader, or allow sharing", async () => {
    state.caps = ["manage_access"]; state.failing = false;
    const html = await render();
    expect(html).toContain("Only a founder can change this");
    expect(html).toContain("Only a founder of Enginious UAE can allow or stop this");
    expect(html).toContain("only a founder can give, change or remove founder, access-management and cost rights");
  });

  it("refuses everyone else in words", async () => {
    state.caps = ["warehouse"]; state.failing = false;
    expect(await render()).toContain("Only a founder, or someone a founder gave access management to");
  });

  it("says it could not load when the data service fails", async () => {
    state.caps = ["founder"]; state.failing = true;
    const html = await render();
    expect(html).toContain("not an empty list");
    expect(html).not.toContain("Nobody has Inventory access");
  });
});
