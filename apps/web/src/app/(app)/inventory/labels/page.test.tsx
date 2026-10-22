/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ tables: [] as string[], rpc: 0 }));
function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_t, prop) { if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result); return () => proxy; },
    apply() { return proxy; },
  });
  return proxy;
}
const tables: Record<string, unknown[]> = {
  inv_units: [{ id: "unit-1", code: "UAE-E-00042", company_id: "c1", item_id: "item-1", location_id: "l1", unit_cost: 7654.321, employee_id: "emp-secret" }],
  inv_balances: [{ id: "bal-1", company_id: "c1", label_code: "UAE-S-00007", item_id: "item-2", location_id: "l1", bin_id: "bin-1" }],
  inv_items: [{ id: "item-1", name: "Laptop", model: "X1" }, { id: "item-2", name: "HDMI cable 3 m", model: null }],
  inv_bins: [{ id: "bin-1", code: "A-12" }],
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => { calls.tables.push(t); return chain({ data: tables[t] ?? [], error: null }); },
    rpc: () => { calls.rpc += 1; return chain({ data: null, error: null }); },
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "os.example.com", "x-forwarded-proto": "https" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/inventory/labels", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/inventory/context", () => ({ getInventoryContext: async () => ({ userId: "u", locationName: () => "Dubai" }) }));

import InventoryLabelsPage from "./page";
const render = async (sp: Record<string, string>) => renderToStaticMarkup(await InventoryLabelsPage({ searchParams: Promise.resolve(sp) }));

describe("Labels page", () => {
  it("renders a unit label and a bin label with the code, a short name and a place, in the chosen size", async () => {
    const html = await render({ codes: "UAE-E-00042,UAE-S-00007", size: "small" });
    expect(html).toContain("UAE-E-00042");
    expect(html).toContain("Laptop X1");
    expect(html).toContain("Dubai");
    expect(html).toContain("UAE-S-00007");
    expect(html).toContain("HDMI cable 3 m");
    expect(html).toContain("Bin A-12");
    expect(html).toContain('data-size="small"');
    expect(html).toContain("<svg");
    expect(html).toContain("2 labels");
    expect(html).toContain("same code");
  });

  it("never puts a price or a person on a label, even if the row carried one", async () => {
    const html = await render({ codes: "UAE-E-00042" });
    expect(html).not.toContain("7654");
    expect(html).not.toContain("emp-secret");
    expect(html).not.toMatch(/unit_cost|employee|AED/);
  });

  it("says one safe thing about codes that are not shown, and reads only tables", async () => {
    calls.tables.length = 0; calls.rpc = 0;
    const html = await render({ codes: "UAE-E-00042,UAE-E-99999,hello" });
    expect(html).toContain("1 code not shown: it is not available to you or does not exist");
    expect(html).toContain("Not Inventory codes, so left out: hello");
    expect(calls.rpc).toBe(0);
  });

  it("asks for codes when none are given, and for an item or location it reads the units of it", async () => {
    expect(await render({})).toContain("Type the codes above to see the labels");
    const html = await render({ item: "3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607" });
    expect(html).toContain("UAE-E-00042");
  });

  it("ignores a malformed item or location and says so", async () => {
    expect(await render({ item: "nope" })).toContain("not valid, so it was ignored");
  });
});
