/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";
import type { InvBinRow, InvItemRow, InvLocationRow } from "@/types/inventory";
import { buildStockRows } from "@/lib/inventory/stock-list";
import type { ItemDetail, MovementDetail, Names, UnitDetail, UnitView } from "@/lib/inventory/stock";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/inventory", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) }) }) }) }) }));

const C1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const I1 = "33333333-3333-4333-8333-333333333333";
const U1 = "44444444-4444-4444-8444-444444444444";
const M1 = "55555555-5555-4555-8555-555555555555";
const B1 = "66666666-6666-4666-8666-666666666666";
let grants: { companyId: string; capabilities: InvCapability[] }[] = [];
const loc = { id: L1, company_id: C1, code: "DXB", name: "Dubai warehouse", kind: "warehouse", timezone: "Asia/Dubai", address: null, is_active: true, created_by: null, created_at: "", updated_at: "" } as InvLocationRow;
const bin = { id: B1, company_id: C1, location_id: L1, code: "A1", label: null, is_active: true, created_at: "" } as InvBinRow;

vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({ userId: "u", fullName: "T", installed: true, grants, companies: [{ id: C1, name: "Enginious", referenceCode: "UAE", isEnabled: true }], locations: [loc], assignedLocationIds: [L1], employeeId: null, managesProjects: false, companyName: () => "Enginious", locationName: () => "Dubai warehouse" }),
}));

const names: Names = {
  employees: new Map(), projects: new Map(), users: new Map(), requests: new Map(),
  employee: (id) => (id ? "Sara Ali" : "—"), project: (id) => (id ? "P-7 Mall" : "—"), user: (id) => (id ? "Omar Operator" : "—"), request: (id) => (id ? "REQ-1" : "—"),
};
const item = (over: Partial<InvItemRow> = {}): InvItemRow => ({ id: I1, company_id: C1, name: "Laptop X1", category_id: null, tracking: "individual", unit_of_measure: "each", quantity_scale: 0, manufacturer: "Acme", model: "X1", specification: null, status: "active", replaced_by_item_id: null, notes: null, version: 3, created_by: null, created_at: "", updated_at: "", ...over });
const unitView = (over: Partial<UnitView> = {}): UnitView => ({
  id: U1, company_id: C1, item_id: I1, code: "UAE-E-00042", serial_number: "SN-1", ownership: "owned", rental_id: null, lifecycle: "active", condition: "good", custody_kind: "employee", location_id: L1, bin_id: null,
  employee_id: "e1", project_id: null, transfer_id: null, repair_reference: null, in_kit_id: null, expected_return_at: null, verified_at: "2026-10-01T00:00:00Z", verified_by: "u", legacy_asset_id: null, notes: null,
  version: 1, created_by: "u", created_at: "2026-10-01T00:00:00Z", updated_at: "", retired_at: null, where: "With an employee: Sara Ali", employeeName: "Sara Ali", projectName: null, binLabel: null, locationName: "Dubai warehouse", cost: { amount: 4200, currency: "AED" }, overdue: false, ...over,
});
const counts = (detail: boolean) => buildStockRows({ items: [item()], categories: [], units: detail ? [{ id: "unit-42", item_id: I1, code: "UAE-E-00042", serial_number: "SN-1", lifecycle: "active", condition: "good", custody_kind: "employee", location_id: L1, in_kit_id: null, ownership: "owned" }] : [], balances: [], reservations: [], detailCompanyIds: new Set(detail ? [C1] : []), locationId: "", now: new Date() })[0]!;

let itemDetail: ItemDetail | null;
let unitDetail: UnitDetail | null;
let movementDetail: MovementDetail | null;
vi.mock("@/lib/inventory/stock", () => ({
  loadItemDetail: async () => itemDetail,
  loadUnitDetail: async () => unitDetail,
  loadMovementDetail: async () => movementDetail,
  loadFormContext: async () => ({ locations: [{ id: L1, companyId: C1, companyName: "Enginious", name: "Dubai warehouse", timezone: "Asia/Dubai", bins: [{ id: B1, code: "A1", label: null }] }], destinations: [], projects: [], requests: [], transfers: [], rentals: [], canSeeCostsByCompany: { [C1]: true } }),
  employeeNameFor: async () => null, resolveCodes: async () => [],
}));

import { ItemSidePanel } from "./item-panel";
import { UnitSidePanel } from "./unit-panel";
import { MovementSidePanel } from "../movements/_panel/movement-panel";

const render = async (el: Promise<React.ReactElement | null>) => renderToStaticMarkup((await el) as React.ReactElement);
const here = (p: Record<string, string | null> = {}) => `/inventory?${new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v) as [string, string][])).toString()}`;
const baseItem = (over: Partial<ItemDetail> = {}): ItemDetail => ({
  item: item(), categoryName: "Computers", companyName: "Enginious", detail: true, canEdit: true, canSeeCosts: true, canConfirm: false, counts: counts(true), categories: [], units: [unitView()], unitsTruncated: false,
  balances: [], kits: new Map(), movements: [], locations: [loc], bins: [bin], summaryAvailability: [], names, replacedBy: null, ...over,
});

beforeEach(() => { grants = [{ companyId: C1, capabilities: ["founder"] }]; itemDetail = baseItem(); });

describe("ItemSidePanel", () => {
  it("shows the item, its counts, its units with where they are, print links and the edit form to a founder", async () => {
    const html = await render(ItemSidePanel({ openId: I1, closeHref: "/inventory", here, binCode: null }));
    expect(html).toContain("Laptop X1");
    expect(html).toContain("Individual item");
    expect(html).toContain("Usable now");
    expect(html).toContain("UAE-E-00042");
    expect(html).toContain("With an employee: Sara Ali");
    expect(html).toContain("/inventory/labels?codes=UAE-E-00042");
    expect(html).toContain("AED 4,200");
    expect(html).toContain("Edit details");
    expect(html).toContain('name="expectedVersion" value="3"');
    expect(html).toContain("Receive stock");
    expect(html).toContain("More actions");
    expect(html).toContain("Recent movements");
  });

  it("gives a person without stock access the summary only: no units, custody, movements or cost, and where the numbers come from", async () => {
    grants = [{ companyId: C1, capabilities: ["manage_access"] }];
    itemDetail = baseItem({ detail: false, canEdit: false, canSeeCosts: false, units: [], counts: counts(false), movements: [], summaryAvailability: [{ locationId: L1, name: "Dubai warehouse", usableNow: 4 }] });
    const html = await render(ItemSidePanel({ openId: I1, closeHref: "/inventory", here, binCode: null }));
    expect(html).toContain("Usable now at Dubai warehouse");
    expect(html).toContain(">4<");
    expect(html).toContain("for the warehouse team");
    for (const hidden of ["UAE-E-00042", "Sara Ali", "AED", "Recent movements", "Receive stock", "Edit details", "With employees"]) expect(html.includes(hidden), hidden).toBe(false);
  });

  it("says an item that does not exist, or is not theirs, is not found (never an empty item)", async () => {
    itemDetail = null;
    expect(await render(ItemSidePanel({ openId: I1, closeHref: "/inventory", here, binCode: null }))).toContain("does not exist, or you do not have access to it");
    expect(await render(ItemSidePanel({ openId: "nonsense", closeHref: "/inventory", here, binCode: null }))).toContain("does not point to an item");
  });

  it("shows counted stock by location and bin with the bin label and a print link, and highlights the scanned bin", async () => {
    const counted = item({ tracking: "quantity", name: "XLR cable" });
    itemDetail = baseItem({
      item: counted, units: [], counts: counts(false),
      balances: [{ id: "bal1", company_id: C1, item_id: I1, holder_kind: "warehouse", location_id: L1, bin_id: B1, employee_id: null, project_id: null, transfer_id: null, kit_unit_id: null, repair_reference: null, rental_id: null, condition: "good", qty: "20", label_code: "UAE-S-00007", expected_return_at: null, verified_at: null, verified_by: null, version: 1, created_at: "", updated_at: "", locationName: "Dubai warehouse", binLabel: "A1", holderText: "On the shelf" }],
    });
    const html = await render(ItemSidePanel({ openId: I1, closeHref: "/inventory", here, binCode: "UAE-S-00007" }));
    expect(html).toContain("Stock by location and bin");
    expect(html).toContain("UAE-S-00007");
    expect(html).toContain("/inventory/labels?codes=UAE-S-00007");
    expect(html).toContain("Dubai warehouse, bin A1");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("Create a bin label");
  });

  it("tells people a draft item cannot receive stock yet", async () => {
    itemDetail = baseItem({ item: item({ status: "draft" }) });
    const html = await render(ItemSidePanel({ openId: I1, closeHref: "/inventory", here, binCode: null }));
    expect(html).toContain("This item is a draft, so stock cannot be received for it yet");
    expect(html).not.toContain(">Receive stock<");
  });
});

const baseUnit = (over: Partial<UnitDetail> = {}): UnitDetail => ({
  unit: unitView(), item: item(), companyName: "Enginious", canOperate: true, canEdit: true, canSeeCosts: true, kit: [], packable: [], rental: null, history: [], historyTruncated: false, names, locations: [loc], bins: [bin], inKitCode: null, ...over,
});

describe("UnitSidePanel", () => {
  it("offers a return for equipment that is with an employee, and the actions that apply", async () => {
    unitDetail = baseUnit();
    const html = await render(UnitSidePanel({ unitRef: U1, closeHref: "/inventory", here }));
    expect(html).toContain("UAE-E-00042");
    expect(html).toContain("Return from employee");
    expect(html).toContain("employee=e1");
    expect(html).not.toContain("Issue to a person");
    expect(html).toContain("Print label");
    expect(html).toContain("History");
    expect(html).toContain("Nothing has been recorded for this unit yet");
  });
  it("offers issue, dispatch and transfer for a usable unit on the shelf, and says a draft unit cannot be used", async () => {
    unitDetail = baseUnit({ unit: unitView({ custody_kind: "warehouse", employee_id: null, employeeName: null, where: "In the warehouse: Dubai warehouse" }) });
    const html = await render(UnitSidePanel({ unitRef: U1, closeHref: "/inventory", here }));
    for (const a of ["Issue to a person", "Dispatch to a project", "Send to another location"]) expect(html).toContain(a);
    unitDetail = baseUnit({ unit: unitView({ custody_kind: "warehouse", lifecycle: "draft", employee_id: null, where: "Not counted yet" }) });
    const draft = await render(UnitSidePanel({ unitRef: U1, closeHref: "/inventory", here }));
    expect(draft).toContain("Not counted yet");
    expect(draft).not.toContain("Issue to a person");
  });
  it("flags overdue equipment", async () => {
    unitDetail = baseUnit({ unit: unitView({ overdue: true, expected_return_at: "2026-09-01T00:00:00Z" }) });
    expect(await render(UnitSidePanel({ unitRef: U1, closeHref: "/inventory", here }))).toContain("Overdue");
  });
  it("shows a kit's checklist with what is missing", async () => {
    unitDetail = baseUnit({
      item: item({ tracking: "kit", name: "DJ kit" }),
      kit: [
        { id: "k1", company_id: C1, kit_unit_id: U1, item_id: "i-a", expected_qty: 1, is_required: true, status: "present", content_unit_id: "cu1", present_qty: 0, substitute_item_id: null, note: null, updated_at: "", itemName: "Mixer", itemTracking: "individual", itemUom: "each", itemScale: 0, substituteName: null, contentCode: "UAE-E-00050" },
        { id: "k2", company_id: C1, kit_unit_id: U1, item_id: "i-b", expected_qty: 2, is_required: true, status: "missing", content_unit_id: null, present_qty: 0, substitute_item_id: null, note: null, updated_at: "", itemName: "XLR cable", itemTracking: "quantity", itemUom: "each", itemScale: 0, substituteName: null, contentCode: null },
      ],
    });
    const html = await render(UnitSidePanel({ unitRef: U1, closeHref: "/inventory", here }));
    expect(html).toContain("Kit contents");
    expect(html).toContain("UAE-E-00050");
    expect(html).toContain("Missing");
    expect(html).toContain("Edit the checklist");
  });
  it("is 'not found' for a person who may not read units (the database returns nothing)", async () => {
    unitDetail = null;
    expect(await render(UnitSidePanel({ unitRef: "UAE-E-00042", closeHref: "/inventory", here }))).toContain("or you do not have access to it");
  });
  it("shows no actions to someone who cannot operate stock", async () => {
    grants = [{ companyId: C1, capabilities: ["view_stock"] }];
    unitDetail = baseUnit({ canOperate: false, canEdit: false, canSeeCosts: false });
    const html = await render(UnitSidePanel({ unitRef: U1, closeHref: "/inventory", here }));
    expect(html).not.toContain("Return from employee");
    expect(html).not.toContain("Send for repair");
    expect(html).not.toContain("Purchase cost");
  });
});

const movement = (kind: string, over: Record<string, unknown> = {}): MovementDetail => ({
  movement: {
    id: M1, company_id: C1, code: "MV-000010", kind, occurred_at: "2026-11-03T05:30:00Z", recorded_at: "2026-11-03T05:30:01Z", performed_by: "u", note: "Delivered", reason: null, project_id: null, employee_id: "e1", request_id: null,
    from_location_id: L1, to_location_id: null, corrects_movement_id: null, recipient_name: null, expected_return_at: null, transfer_id: null, to_project_id: null, idempotency_key: "issue-abcdef12-3456",
    lines: [{ id: "ln1", item_id: I1, unit_id: null, qty: "20", from_kind: "external", to_kind: "warehouse", from_location_id: null, to_location_id: L1, from_bin_id: null, to_bin_id: B1, from_employee_id: null, to_employee_id: null, from_project_id: null, to_project_id: null, from_balance_id: null, to_balance_id: "bal", condition_from: null, condition_to: "good", exception_note: null, corrects_line_id: null }],
    ...over,
  } as MovementDetail["movement"],
  items: new Map([[I1, "XLR cable"]]), unitCodes: new Map(), names, corrects: null, correctedBy: [], correctable: new Set(["ln1"]), binLabels: new Map([[B1, "A1"]]),
});

describe("MovementSidePanel", () => {
  it("shows a ledger entry in the place's time zone with its lines, and the transaction key", async () => {
    grants = [{ companyId: C1, capabilities: ["warehouse"] }];
    movementDetail = movement("receipt");
    const html = await render(MovementSidePanel({ openId: M1, closeHref: "/inventory/movements", locations: [loc] }));
    expect(html).toContain("Stock received");
    expect(html).toContain("MV-000010");
    expect(html).toContain("09:30");
    expect(html).toContain("XLR cable");
    expect(html).toContain("Outside (new stock)");
    expect(html).toContain("Dubai warehouse, bin A1");
    expect(html).toContain("issue-abcdef12-3456");
    expect(html).not.toContain("Correct this entry");
  });
  it("offers 'Correct this entry' only to people who confirm stock, and only where a correction is possible", async () => {
    grants = [{ companyId: C1, capabilities: ["confirm_stock", "warehouse"] }];
    movementDetail = movement("receipt");
    expect(await render(MovementSidePanel({ openId: M1, closeHref: "/inventory/movements", locations: [loc] }))).toContain("Correct this entry");
    movementDetail = { ...movement("issue_employee"), correctable: new Set() };
    expect(await render(MovementSidePanel({ openId: M1, closeHref: "/inventory/movements", locations: [loc] }))).not.toContain("Correct this entry");
  });
  it("links a correction to the entry it corrects", async () => {
    movementDetail = { ...movement("correction", { corrects_movement_id: "orig" }), corrects: { id: "orig", code: "MV-000009" } };
    const html = await render(MovementSidePanel({ openId: M1, closeHref: "/inventory/movements", locations: [loc] }));
    expect(html).toContain("Corrects");
    expect(html).toContain("MV-000009");
  });
});
