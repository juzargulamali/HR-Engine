/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/inventory/transfers/x", useSearchParams: () => new URLSearchParams() }));
const LOC2 = "l2";
const state = vi.hoisted(() => ({ operate: false, fail: false }));
vi.mock("@/lib/inventory/context", () => ({ getInventoryContext: async () => ({ userId: "u", grants: state.operate ? [{ companyId: "c2", capabilities: ["founder"] }] : [], assignedLocationIds: [] }) }));
let raw: Record<string, unknown> | null = null;
vi.mock("@/lib/inventory/transfer-data", async () => {
  const { mapTrace } = await import("@/lib/inventory/xshare");
  const { viewFromTrace } = await import("@/lib/inventory/transfer-view");
  return { loadTransferView: async () => { if (state.fail) throw new Error("boom"); return raw ? viewFromTrace(mapTrace(raw)) : null; } };
});
import TransferTracePage from "./page";

const ID = "77777777-7777-4777-8777-777777777777";
const traceRaw = (revoked: boolean, status = "in_transit"): Record<string, unknown> => ({
  transfer: { transfer_id: ID, code: "UAE-T-00001", status, sender_company_id: "c1", sender_company_name: "Enginious UAE", from_location_id: "l1", from_location_name: "Dubai warehouse", to_location_id: "l2", to_location_name: "Riyadh warehouse",
    to_company_id: "c2", to_company_name: "Enginious KSA", dispatched_at: "2026-11-01T08:00:00Z", expected_at: null, received_at: null, carrier: null, reference: null, dispatched_by_name: null, received_by_name: null, line_count: 1, still_on_the_way: 1, sharing_revoked: revoked },
  units: [], quantities: [{ item_id: "i2", item_name: "HDMI cable 5 m", category: null, unit_of_measure: "each", owner_company_id: "c1", owner_company_name: "Enginious UAE", qty_sent: 4, qty_on_the_way: 4, on_the_way: [] }], events: [],
});
const render = async () => renderToStaticMarkup((await TransferTracePage({ params: Promise.resolve({ id: ID }) })) as React.ReactElement);

beforeEach(() => { raw = null; state.operate = false; state.fail = false; });

describe("Transfer trace page", () => {
  it("says 'Sharing revoked—contact owner' when the database says the authorisation was revoked, and still shows the whole transfer", async () => {
    raw = traceRaw(true);
    const html = await render();
    expect(html).toContain("Sharing revoked—contact owner");
    expect(html).toContain("Transfer UAE-T-00001");
    expect(html).toContain("HDMI cable 5 m");
  });
  it("says nothing about revocation otherwise (the owner's own side included)", async () => {
    raw = traceRaw(false);
    expect(await render()).not.toContain("Sharing revoked");
  });
  it("says both companies and warehouses, what was sent, received and is still in transit, and who acts next", async () => {
    raw = { ...traceRaw(false), quantities: [{ item_id: "i2", item_name: "HDMI cable 5 m", category: null, unit_of_measure: "each", owner_company_id: "c1", owner_company_name: "Enginious UAE", qty_sent: 4, qty_on_the_way: 1, on_the_way: [] }] };
    const html = await render();
    expect(html).toContain("Dubai warehouse · Enginious UAE to Riyadh warehouse · Enginious KSA");
    expect(html).toContain("4 sent · 3 received · 1 still in transit");
    expect(html).toContain("Riyadh warehouse · Enginious KSA acts next");
    expect(html).toContain("Partly received");
    expect(html).toContain("Owned by Enginious UAE");
    // Someone who may not operate the receiving warehouse is told who receives; no button.
    expect(html).not.toContain("Receive this transfer");
    expect(html).toContain("Receiving is done by a warehouse operator at Riyadh warehouse · Enginious KSA");
  });
  it("offers Receive this transfer, against this transfer, only to someone who may operate the receiving warehouse", async () => {
    raw = traceRaw(false); state.operate = true;
    const html = await render();
    expect(html).toContain("Receive this transfer");
    expect(html).toContain(`/inventory/stock?action=transfer&amp;mode=receive&amp;transfer=${ID}&amp;location=${LOC2}`);
  });
  it("says it could not load when the read fails, and not found when there is none", async () => {
    state.fail = true;
    expect(await render()).toContain("Could not load this transfer");
    state.fail = false;
    expect(await render()).toContain("No transfer with that address was found");
  });
});
