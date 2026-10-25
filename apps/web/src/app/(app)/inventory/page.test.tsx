/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";
import type { InvItemRow, InvLocationRow } from "@/types/inventory";
import { buildStockRows } from "@/lib/inventory/stock-list";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory", useSearchParams: () => new URLSearchParams() }));
const C1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
let grants: { companyId: string; capabilities: InvCapability[] }[] = [];
let managesProjects = false;
let list: Awaited<ReturnType<typeof import("@/lib/inventory/stock").loadStockList>>;
const loadStockList = vi.fn(async () => list);
const fillSummaryUsable = vi.fn(async (rows: readonly unknown[]) => rows.map((r) => ({ ...(r as object), usable: 7 })));
vi.mock("@/lib/inventory/stock", () => ({ loadStockList: (...a: unknown[]) => (loadStockList as (...x: unknown[]) => unknown)(...a), fillSummaryUsable: (...a: unknown[]) => (fillSummaryUsable as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({
    userId: "u", fullName: "Test", installed: true, grants, companies: grants.map((g) => ({ id: g.companyId, name: "Enginious", referenceCode: "UAE", isEnabled: true })),
    locations: grants.length ? [{ id: L1, company_id: C1, name: "Dubai warehouse", timezone: "Asia/Dubai", is_active: true } as InvLocationRow] : [], assignedLocationIds: [L1], employeeId: null, managesProjects,
    companyName: () => "Enginious", locationName: () => "Dubai warehouse",
  }),
}));
vi.mock("./_panel/action-panel", () => ({ ActionSidePanel: () => null, parseAction: (r: string) => (["receive", "issue", "dispatch", "return", "transfer", "scan"].includes(r) ? r : null) }));
vi.mock("./_panel/item-panel", () => ({ ItemSidePanel: () => null }));
vi.mock("./_panel/unit-panel", () => ({ UnitSidePanel: () => null }));

import InventoryPage from "./page";

const item = (over: Partial<InvItemRow>): InvItemRow => ({
  id: "33333333-3333-4333-8333-333333333333", company_id: C1, name: "Laptop X1", category_id: null, tracking: "individual", unit_of_measure: "each", quantity_scale: 0, manufacturer: null, model: "X1",
  specification: null, status: "active", replaced_by_item_id: null, notes: null, version: 1, created_by: null, created_at: "", updated_at: "", ...over,
});
const listFor = (detail: boolean, withCost: boolean) => ({
  rows: buildStockRows({
    items: [item({})], categories: [],
    units: detail ? [{ id: "unit-1", item_id: "33333333-3333-4333-8333-333333333333", code: "UAE-E-00001", serial_number: "SN-SECRET", lifecycle: "active", condition: "good", custody_kind: "employee", location_id: L1, in_kit_id: null, ownership: "owned" }] : [],
    balances: [], reservations: [], detailCompanyIds: new Set(detail ? [C1] : []), locationId: "", now: new Date(),
    costs: withCost ? new Map([["33333333-3333-4333-8333-333333333333", { amount: 4200, currency: "AED" }]]) : undefined,
  }),
  categories: [], locations: [{ id: L1, company_id: C1, name: "Dubai warehouse", timezone: "Asia/Dubai", is_active: true } as InvLocationRow], companies: [{ id: C1, name: "Enginious" }],
  detailCompanyIds: new Set(detail ? [C1] : []), costCompanyIds: new Set(withCost ? [C1] : []), truncated: false,
}) as typeof list;

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await InventoryPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => { loadStockList.mockClear(); fillSummaryUsable.mockClear(); managesProjects = false; });

describe("Inventory page", () => {
  it("a founder sees every column choice, the header actions and the cost column when chosen", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    list = listFor(true, true);
    const html = await render({ cols: "item,usable,warehouse,out,cost" });
    expect(html).toContain("Add item");
    for (const a of ["Scan", "Receive stock", "Issue / Dispatch", "Return", "Transfer"]) expect(html).toContain(a);
    expect(html).toContain("Latest cost");
    expect(html).toContain("AED 4,200");
    expect(html).toContain("1 with employees");
    expect(loadStockList).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ withCosts: true }));
  });

  it("a warehouse operator without view_costs never gets cost markup or a cost query, even if the address asks for it", async () => {
    grants = [{ companyId: C1, capabilities: ["warehouse"] }];
    list = listFor(true, false);
    const html = await render({ cols: "item,cost" });
    expect(html).not.toContain("Latest cost");
    expect(html).not.toContain("AED 4,200");
    expect(html).not.toContain("4,200");
    expect(loadStockList).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ withCosts: false }));
    expect(html).toContain("Receive stock");
    expect(html).not.toContain("Add item"); // no catalogue rights
  });

  it("a person who can view stock but not operate it gets Scan only, and no stock-moving buttons", async () => {
    grants = [{ companyId: C1, capabilities: ["view_stock"] }];
    list = listFor(true, false);
    const html = await render();
    expect(html).toContain("Scan");
    expect(html).not.toContain("Receive stock");
    expect(html).not.toContain("Issue / Dispatch");
  });

  it("a Project Manager without a grant sees the catalogue summary only: usable now from the database's availability, nothing about custody", async () => {
    grants = [];
    managesProjects = true;
    list = listFor(false, false);
    const html = await render({ cols: "item,usable,warehouse,out,reserved,draft" });
    expect(fillSummaryUsable).toHaveBeenCalledTimes(1);
    expect(html).toContain("Laptop X1");
    expect(html).toContain("Usable now");
    expect(html).toContain(">7<");
    for (const hidden of ["In the warehouse", "Reserved (future)", "with employees", "on projects", "SN-SECRET", "Latest cost", 'data-label="Not counted yet"', "Not counted yet</a>"]) expect(html.includes(hidden), hidden).toBe(false);
    expect(html).toContain("You can see the catalogue and how many of each item are usable now");
    expect(html).not.toContain("Receive stock");
    expect(html).not.toContain("Add item");
  });

  it("a person with no Inventory access and no project is told so", async () => {
    grants = [];
    managesProjects = false;
    const html = await render();
    expect(html).toContain("You do not have Inventory access");
    expect(loadStockList).not.toHaveBeenCalled();
  });

  it("says it could not load, never 'no items', when the read fails", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    loadStockList.mockRejectedValueOnce(new Error("database down"));
    const html = await render();
    expect(html).toContain("Could not load the inventory");
    expect(html).toContain("not an empty list");
    expect(html).not.toContain("No items yet");
  });

  it("says there are no items when there really are none, and offers Add", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    list = { ...listFor(true, false), rows: [] };
    const html = await render();
    expect(html).toContain("No items yet");
    expect(html).toContain("Add item");
  });

  it("says nothing matches (with a way to clear) when a search finds nothing", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    list = listFor(true, false);
    const html = await render({ q: "zzzz" });
    expect(html).toContain("Nothing matches");
    expect(html).toContain("Clear filters");
  });

  it("finds an item by a unit's serial number for people who can view stock", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    list = listFor(true, false);
    const html = await render({ q: "sn-secret" });
    expect(html).toContain("Laptop X1");
    expect(html).not.toContain("SN-SECRET");
  });

  it("stacks rows on a phone (every cell but the first has its label) and sorts by an address choice", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    list = listFor(true, false);
    const html = await render({ sort: "usable:desc" });
    expect(html).toContain('data-label="Usable now"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain("max-md:");
  });

  it("ignores values in the address it does not know", async () => {
    grants = [{ companyId: C1, capabilities: ["founder"] }];
    list = listFor(true, false);
    const html = await render({ tracking: "nonsense", status: "evil", sort: "x:desc", location: "nope", category: "nope", cols: "hacked" });
    expect(html).toContain("Laptop X1");
  });
});
