/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ unit: null as Record<string, unknown> | null, redirected: null as string | null, rpc: 0, tables: [] as string[] }));
function chain(result: unknown): unknown {
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
      if (prop === "maybeSingle") return () => chain({ data: result && typeof result === "object" && "row" in (result as object) ? (result as { row: unknown }).row : null, error: null });
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => {
      state.tables.push(t);
      if (t === "inv_units") return chain({ row: state.unit });
      if (t === "inv_items") return chain({ row: { name: "Laptop", model: null, specification: null } });
      return chain({ row: null });
    },
    rpc: () => { state.rpc += 1; return chain({ row: null }); },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { state.redirected = to; throw new Error("NEXT_REDIRECT"); },
  useRouter: () => ({ push: vi.fn() }), usePathname: () => "/inventory/scan", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/inventorySetup", () => ({ resolveInventoryCode: vi.fn() }));

import InventoryScanPage from "./page";
const run = async (sp: Record<string, string>) => {
  try { return renderToStaticMarkup(await InventoryScanPage({ searchParams: Promise.resolve(sp) })); } catch (e) { if ((e as Error).message === "NEXT_REDIRECT") return null; throw e; }
};

beforeEach(() => { state.unit = null; state.redirected = null; state.rpc = 0; state.tables = []; });

describe("Scan page address (the QR on a label)", () => {
  it("opens the record when the person may see it, and calls no function", async () => {
    state.unit = { id: "unit-9", code: "UAE-E-00042", item_id: "i1", lifecycle: "active", custody_kind: "warehouse", location_id: null, bin_id: null };
    expect(await run({ c: "UAE-E-00042" })).toBeNull();
    expect(state.redirected).toBe("/inventory?unit=unit-9");
    expect(state.rpc).toBe(0);
  });

  it("gives the safe message, and opens nothing, for a code that is unknown or not allowed", async () => {
    const html = await run({ c: "UAE-E-00042" });
    expect(html).toContain("This code is not available to you or does not exist.");
    expect(state.redirected).toBeNull();
    expect(state.rpc).toBe(0);
  });

  it("shows the scanner with no code in the address, and looks nothing up", async () => {
    const html = await run({});
    expect(html).toContain("Scan a label");
    expect(html).toContain("Use the camera");
    expect(state.tables).toEqual([]);
  });

  it("says a value that is not a code is not a code", async () => {
    expect(await run({ c: "https://evil.example/x" })).toContain("not an Enginious Inventory code");
  });
});
