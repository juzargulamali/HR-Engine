/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";

const COMPANY = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";

/** A data client that answers every read with an empty list and every function with nothing: enough to prove the page assembles. */
function emptyChain(result: unknown): unknown {
  const target = function noop() {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
      if (prop === "maybeSingle" || prop === "single") return () => emptyChain({ data: null, error: null });
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}
const ok = { data: [], error: null, count: 0 };
const state = vi.hoisted(() => ({ caps: [] as string[], loadError: false }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => emptyChain(state.loadError ? { data: null, error: { message: "boom" } } : ok), rpc: () => emptyChain(ok) }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/manage", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({
    userId: "u-me", fullName: "Me", installed: true, grants: state.caps.length ? [{ companyId: COMPANY, capabilities: state.caps as InvCapability[] }] : [],
    companies: [{ id: COMPANY, name: "Enginious UAE", referenceCode: "UAE", isEnabled: true }],
    locations: [{ id: LOCATION, company_id: COMPANY, code: "DXB", name: "Dubai", kind: "warehouse", timezone: "Asia/Dubai", address: null, is_active: true, created_by: null, created_at: "", updated_at: "" }],
    assignedLocationIds: [], employeeId: null, managesProjects: false, companyName: () => "Enginious UAE", locationName: () => "Dubai",
  }),
}));

import InventoryManagePage from "./page";

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await InventoryManagePage({ searchParams: Promise.resolve(sp) }));

describe("Setup page", () => {
  it("shows every section as a heading on one page for a founder, including the earlier asset register", async () => {
    state.caps = ["founder"]; state.loadError = false;
    const html = await render();
    for (const heading of ["Getting started", "Company settings", "Locations and bins", "Categories", "Opening stock and counts", "Record equipment already with employees or on projects", "Technology templates", "Earlier asset register"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("0 of 5 steps done");
    expect(html).toContain("Add a location");
  });

  it("hides the earlier asset register and location editing from someone who only manages the catalogue", async () => {
    state.caps = ["manage_catalogue"]; state.loadError = false;
    const html = await render();
    expect(html).not.toContain("Earlier asset register</h2>");
    expect(html).not.toContain("Add a location");
    expect(html).toContain("Only a founder can add or change locations");
    expect(html).toContain("Add a category");
  });

  it("says who it is for, instead of failing, to someone with no Inventory rights", async () => {
    state.caps = ["view_stock"]; state.loadError = false;
    expect(await render()).toContain("Setup is for founders and people who manage the catalogue");
  });

  it("says it could not load, never 'no categories', when the data service fails", async () => {
    state.caps = ["founder"]; state.loadError = true;
    const html = await render();
    expect(html).toContain("not an empty list");
    expect(html).not.toContain("No categories yet");
  });

  it("opens the technology template editor from the address, and says when a count cannot be found", async () => {
    state.caps = ["founder"]; state.loadError = false;
    expect(await render({ tech: "new" })).toContain("New technology template");
    expect(await render({ count: "11111111-1111-4111-8111-111111111111" })).toContain("That count was not found");
  });
});
