/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/inventory/stock", useSearchParams: () => new URLSearchParams() }));
let unitRows: Record<string, unknown>[] = []; let countedRows: Record<string, unknown>[] = []; let headRows: Record<string, unknown>[] = []; let fail = false;
vi.mock("@/lib/inventory/xshare-data", async () => {
  const x = await import("@/lib/inventory/xshare");
  return {
    loadXUnits: async () => { if (fail) throw new Error("boom"); return unitRows.map(x.mapUnit); },
    loadXCounted: async () => { if (fail) throw new Error("boom"); return countedRows.map(x.mapCounted); },
    loadXTransfers: async () => headRows.map(x.mapHead),
  };
});
import { CrossCompanySection } from "./cross-company-section";

const here = (p: Record<string, string | null> = {}) => `/inventory/stock?${new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v) as [string, string][])).toString()}`;
const render = async () => renderToStaticMarkup((await CrossCompanySection({ locationId: "", here })) as React.ReactElement);
const cable = { item_id: "i2", item_name: "HDMI cable 5 m", category_name: "Cables", unit_of_measure: "each", condition: "good", qty: "4.000", rented: false, custody_kind: "warehouse", owner_company_id: "c1", owner_company_name: "Enginious UAE",
  location_id: "l2", location_name: "Riyadh warehouse", location_company_id: "c2", bin_id: null, bin_code: null, transfer_id: null, transfer_code: null, sharing_revoked: false };
const panel = { unit_id: "u1", code: "UAE-E-00042", serial_number: "SN-1", item_id: "i1", item_name: "LED panel", category_name: null, condition: "good", custody_kind: "warehouse", ownership: "owned", owner_company_id: "c1", owner_company_name: "Enginious UAE",
  location_id: "l2", location_name: "Riyadh warehouse", location_company_id: "c2", bin_id: null, bin_code: null, transfer_id: null, transfer_code: null, usable_here: true, sharing_revoked: false };
const head = { transfer_id: "t1", code: "UAE-T-00001", status: "in_transit", sender_company_id: "c1", sender_company_name: "Enginious UAE", from_location_id: "l1", from_location_name: "Dubai warehouse", to_location_id: "l2", to_location_name: "Riyadh warehouse",
  to_company_id: "c2", to_company_name: "Enginious KSA", dispatched_at: "2026-11-01T08:00:00Z", expected_at: null, received_at: null, carrier: null, reference: null, dispatched_by_name: null, received_by_name: null, line_count: 1, still_on_the_way: 1, sharing_revoked: false };

beforeEach(() => { unitRows = []; countedRows = []; headRows = []; fail = false; });

describe("CrossCompanySection: other companies' equipment at your warehouses", () => {
  it("shows counted stock as quantity, item, owner and the warehouse it is physically in, with no cost", async () => {
    countedRows = [cable];
    const html = await render();
    expect(html).toContain("Equipment of other companies at your warehouses");
    expect(html).toContain('aria-label="4 × HDMI cable 5 m · Owned by Enginious UAE · at Riyadh warehouse"');
    expect(html).toContain("Owned by Enginious UAE");
    expect(html).toContain("At Riyadh warehouse");
    expect(html).not.toMatch(/price|supplier|unit_cost|AED/i);
    expect(html).not.toContain("Sharing revoked");
  });
  it("shows counted stock still on the way as such, and units next to it", async () => {
    countedRows = [{ ...cable, custody_kind: "transit", transfer_id: "t1", transfer_code: "UAE-T-00001", qty: "3.000" }];
    unitRows = [panel];
    const html = await render();
    expect(html).toContain("On the way to Riyadh warehouse (UAE-T-00001)");
    expect(html).toContain("/inventory/transfers/t1");
    expect(html).toContain("UAE-E-00042");
  });
  it("says 'Sharing revoked—contact owner' for revoked counted stock, units and an in-transit transfer; the equipment is still listed", async () => {
    countedRows = [{ ...cable, sharing_revoked: true }];
    unitRows = [{ ...panel, sharing_revoked: true, usable_here: false }];
    headRows = [{ ...head, sharing_revoked: true }];
    const html = await render();
    expect(html.match(/Sharing revoked—contact owner/g)).toHaveLength(3);
    expect(html).toContain("HDMI cable 5 m");
    expect(html).toContain("LED panel");
  });
  it("says nothing about revocation for a received transfer with the sharing active, and renders nothing when there is nothing", async () => {
    headRows = [{ ...head, status: "received", sharing_revoked: true }];
    expect(await render()).not.toContain("Sharing revoked");
    headRows = [];
    expect(renderToStaticMarkup((await CrossCompanySection({ locationId: "", here })) as React.ReactElement)).toBe("");
  });
  it("says it could not load, never an empty list, when a read fails", async () => {
    fail = true;
    expect(await render()).toContain("could not be loaded");
  });
});
