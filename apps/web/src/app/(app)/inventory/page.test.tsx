/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";
import type { InvLocationRow } from "@/types/inventory";
import { heldRows, requestRow, returnRows, salesRows, transferRows, waitingRow, type QueueRow, type SourceKey } from "@/lib/inventory/today";
import type { TodayData } from "@/lib/inventory/today-data";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory", useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
let cookieValue = "";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (k === "inv_warehouse" && cookieValue ? { value: cookieValue } : undefined) }) }));
vi.mock("@/lib/actions/inventoryPlanning", () => ({ recordOpportunityCheck: vi.fn() }));

const C1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const L2 = "33333333-3333-4333-8333-333333333333";
let grants: { companyId: string; capabilities: InvCapability[] }[] = [];
let managesProjects = false;
let locations: InvLocationRow[] = [];
let assigned: string[] = [];
const loc = (id: string, name: string): InvLocationRow => ({ id, company_id: C1, code: name, name, kind: "warehouse", timezone: "Asia/Dubai", address: null, is_active: true, created_by: null, created_at: "", updated_at: "" });
vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({
    userId: "u", fullName: "Test", installed: true, grants, companies: grants.map((g) => ({ id: g.companyId, name: "Enginious", referenceCode: "UAE", isEnabled: true })),
    locations, assignedLocationIds: assigned, employeeId: null, managesProjects,
    companyName: () => "Enginious", locationName: (id: string | null) => locations.find((l) => l.id === id)?.name ?? "Unknown",
  }),
}));

let data: TodayData;
const loadToday = vi.fn(async (..._a: unknown[]) => data);
vi.mock("@/lib/inventory/today-data", () => ({ loadToday: (...a: unknown[]) => loadToday(...a) }));

import TodayPage from "./page";

const NOW = new Date("2026-10-19T09:30:00+04:00");
const ctx = { now: NOW };
const line = (over: Partial<{ reserved: number; dispatched: number; toReserve: number }> = {}) => ({ status: "open" as const, reserved: 0, dispatched: 0, toReserve: 0, ...over });
const req = (over: Record<string, unknown>) => ({ id: "r1", code: "REQ-0049", kind: "project" as const, forLabel: "Al Khail Roadshow", timezone: "Asia/Dubai", plan: { dispatch: "2026-10-19T14:00" }, neededFrom: null, lines: [line({ reserved: 16, dispatched: 6 })], ...over });

const sendRow = requestRow(req({}), ctx)!;
const prepareRow = requestRow(req({ id: "r2", code: "REQ-0047", forLabel: "Gulf Bank Summit", plan: { dispatch: "2026-10-22T08:00" }, lines: [line({ reserved: 10 }), line({ toReserve: 4 })] }), ctx)!;
const [returnsRow] = returnRows([{ holderKind: "project", holderId: "p1", dueAt: "2026-10-16T18:00:00+04:00", zone: "Asia/Dubai", key: "unit:1" }], { project: new Map([["p1", "Dubai Expo Pavilion"]]), employee: new Map() }, new Map(), ctx);
const [transferRow] = transferRows([{ id: "t1", code: "TRF-0112", fromName: "Abu Dhabi", toName: "Dubai", expectedAt: "2026-10-20T12:00:00+04:00", zone: "Asia/Dubai", items: 6 }], ctx, { here: true });
const [salesRow] = salesRows([{ checkId: "c1", opportunityId: "o1", companyId: C1, reference: "ENQ-0188", requestedAt: "2026-10-17T11:20:00+04:00", locationId: L1, locationName: "Dubai warehouse", installStart: null, eventStart: "2026-11-12", eventEnd: "2026-11-14", technologies: [{ name: "LED wall panel", qty: 24 }], zone: "Asia/Dubai" }], ctx);
const allRows: QueueRow[] = [sendRow, prepareRow, returnsRow!, transferRow!, salesRow!];
const today = (rows: QueueRow[], failed: SourceKey[] = [], notes: string[] = []): TodayData => ({ rows, failed, notes, nowIso: NOW.toISOString() });

const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TodayPage({ searchParams: Promise.resolve(sp) }));
const redirectOf = async (sp: Record<string, string> = {}) => { try { await render(sp); return null; } catch (e) { const m = /^REDIRECT:(.*)$/.exec((e as Error).message); if (m) return m[1]; throw e; } };

beforeEach(() => {
  loadToday.mockClear();
  grants = [{ companyId: C1, capabilities: ["warehouse"] }];
  managesProjects = false;
  locations = [loc(L1, "Dubai warehouse"), loc(L2, "Abu Dhabi warehouse")];
  assigned = [L1];
  cookieValue = "";
  data = today(allRows);
});

describe("Today page", () => {
  it("renders one row per job, in groups by their own date, each with what, for whom, when and one button", async () => {
    const html = await render();
    expect(html).toContain("Work waiting at Dubai warehouse");
    for (const g of ["Late", "Next 7 days", "Waiting, no date set"]) expect(html).toContain(g);
    expect(html).toContain("Al Khail Roadshow still has equipment to send");
    expect(html).toContain("Project Al Khail Roadshow · request REQ-0049");
    expect(html).toContain("Dispatch today, 14:00");
    expect(html).toContain("1 line ready to send");
    expect(html).toContain("Gulf Bank Summit needs its equipment prepared");
    expect(html).toContain("1 of 2 lines fully reserved · 1 still to reserve");
    expect(html).toContain("1 item is overdue from Dubai Expo Pavilion");
    expect(html).toContain("Transfer TRF-0112 is on its way here");
    expect(html).toContain("Sales asks whether equipment is free for enquiry ENQ-0188");
    expect(html).toContain("Nothing is reserved by a check");
    for (const b of ["Send equipment", "Prepare equipment", "Receive returns", "Receive transfer", "Check availability"]) expect(html).toContain(b);
    expect(html).toContain('href="/inventory/requests/r1?step=send"');
    expect(html).toContain('href="/inventory/stock?action=transfer&amp;mode=receive&amp;transfer=t1"');
    // counts on the filters
    for (const f of ["Everything", "Prepare", "Send out", "Receive back", "Transfers", "Sales checks"]) expect(html).toContain(f);
    expect(html).not.toContain('role="alert"');
    expect(loadToday).toHaveBeenCalledWith(expect.anything(), { locationId: L1 });
  });

  it("keeps unresolved shortages and held units visible in their own groups, with who acts and the next action", async () => {
    const waiting = waitingRow(req({ id: "r3", code: "REQ-0052", forLabel: "Marina Launch", lines: [{ ...line({ toReserve: 3 }), shortageAction: "need_to_rent", itemName: "LED wall panel", qty: 3 }] }), ctx)!;
    const [held] = heldRows([{ id: "u9", code: "UAE-E-00031", itemName: "Projector", condition: "damaged", locationName: "Dubai warehouse", reservedFor: [{ requestId: "r2", code: "REQ-0047" }] }]);
    data = today([...allRows, waiting, held!]);
    const html = await render();
    expect(html).toContain("Waiting / Shortages");
    expect(html).toContain("Held for checking");
    expect(html).toContain("1 line of Marina Launch is waiting for stock to be bought or rented");
    expect(html).toContain("LED wall panel × 3: to rent");
    expect(html).toContain("Who acts:");
    expect(html).toContain("whoever arranges the rental");
    expect(html).toContain("Next:");
    expect(html).toContain("Projector UAE-E-00031 is held for checking");
    expect(html).toContain("it needs a replacement before it can be sent");
    // the shortage group comes after the dated groups, and each has its own filter
    expect(html.indexOf('id="today-waiting"')).toBeGreaterThan(html.indexOf('id="today-none"'));
    expect(html.indexOf('id="today-held"')).toBeGreaterThan(html.indexOf('id="today-waiting"'));
    const only = await render({ show: "waiting" });
    expect(only).toContain("Marina Launch");
    expect(only).not.toContain("Al Khail Roadshow still has");
  });

  it("a failed held-units read is its own red alert and its filter reads ?, never zero", async () => {
    data = today(allRows, ["held"]);
    const html = await render();
    expect(html).toContain("Equipment held for checking could not be loaded.");
    expect(html).not.toContain("Nothing waiting");
  });

  it("a Sales row shows only what the Sales checks list shows: no client, value or notes", async () => {
    const html = await render({ show: "sales" });
    const li = /<li[^>]*data-kind="sales"[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
    expect(li).toContain("ENQ-0188");
    expect(li).toContain("LED wall panel × 24");
    for (const word of ["client", "value", "notes", "title", "amount"]) expect(li.toLowerCase().includes(word), word).toBe(false);
    expect(html).not.toContain("Al Khail Roadshow");
  });

  it("names the source that failed in a red alert, never shows its count as zero, and is not an empty queue", async () => {
    data = today(allRows.filter((r) => r.kind !== "transfer"), ["transfers"]);
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Incoming transfers could not be loaded.");
    expect(html).toContain("it is not an empty queue");
    expect(html).toContain("Try again");
    expect(html).toContain("(could not be loaded)");
    expect(html).not.toContain("Nothing waiting");
    // the other sources still show
    expect(html).toContain("Al Khail Roadshow still has equipment to send");
    expect(html).toContain("Dubai Expo Pavilion");
  });

  it("when every source failed it says so and does not offer 'Nothing waiting'", async () => {
    data = today([], ["requests", "returns", "transfers", "sales"]);
    const html = await render();
    for (const n of ["Equipment requests", "Equipment due back", "Incoming transfers", "Sales checks"]) expect(html).toContain(`${n} could not be loaded.`);
    expect(html).not.toContain("Nothing waiting at");
    expect(html).not.toContain("Go to Stock");
  });

  it("a friendly empty state with a way to Stock when every source answered and nothing is waiting", async () => {
    data = today([]);
    const html = await render();
    expect(html).toContain("Nothing waiting at Dubai warehouse");
    expect(html).toContain("Go to Stock");
    expect(html).toContain('href="/inventory/stock"');
  });

  it("filters by ?show= and says when nothing is under a filter", async () => {
    const html = await render({ show: "transfer" });
    expect(html).toContain("Transfer TRF-0112");
    expect(html).not.toContain("Al Khail Roadshow still has");
    data = today([sendRow]);
    expect(await render({ show: "sales" })).toContain("Nothing waiting under Sales checks");
  });

  it("works in the warehouse from the address, then the remembered one; All warehouses is its own choice", async () => {
    assigned = [L1, L2];
    await render({ location: L2 });
    expect(loadToday).toHaveBeenLastCalledWith(expect.anything(), { locationId: L2 });
    cookieValue = L2;
    await render();
    expect(loadToday).toHaveBeenLastCalledWith(expect.anything(), { locationId: L2 });
    const all = await render({ location: "all" });
    expect(loadToday).toHaveBeenLastCalledWith(expect.anything(), { locationId: null });
    expect(all).toContain("Work waiting across all warehouses");
  });

  it("offers the switcher and Scan", async () => {
    const html = await render();
    expect(html).toContain("You are working in");
    expect(html).toContain("All warehouses");
    expect(html).toContain("Scan a label");
    expect(html).toContain('href="/inventory/stock?action=scan"');
  });

  it("says plainly when there is no warehouse at all", async () => {
    locations = [];
    const html = await render();
    expect(html).toContain("No warehouse or location has been set up");
    expect(loadToday).not.toHaveBeenCalled();
  });

  it("sends an old stock link to the stock list with every parameter kept, before anything is read", async () => {
    expect(await redirectOf({ action: "receive", location: L1 })).toBe(`/inventory/stock?action=receive&location=${L1}`);
    expect(await redirectOf({ open: "abc" })).toBe("/inventory/stock?open=abc");
    expect(await redirectOf({ unit: "UAE-E-00001" })).toBe("/inventory/stock?unit=UAE-E-00001");
    expect(loadToday).not.toHaveBeenCalled();
  });

  it("a ?location or ?show alone is Today, not a legacy link", async () => {
    expect(await redirectOf({ location: L1, show: "send" })).toBeNull();
  });

  it("people with no Inventory grant never see Today: a Project Manager goes to Requests, everyone else to My equipment", async () => {
    grants = [];
    managesProjects = true;
    expect(await redirectOf()).toBe("/inventory/requests");
    managesProjects = false;
    expect(await redirectOf()).toBe("/inventory/mine");
    expect(loadToday).not.toHaveBeenCalled();
  });

  it("a person who may not operate stock gets links to the records, no Send / Receive buttons, and still Prepare and the Sales check", async () => {
    grants = [{ companyId: C1, capabilities: ["view_stock"] }];
    const html = await render();
    for (const hidden of ["Send equipment", "Receive returns", "Receive transfer"]) expect(html.includes(hidden), hidden).toBe(false);
    // the rows are still reachable from their titles
    expect(html).toContain('href="/inventory/requests/r1?step=send"');
    expect(html).toContain("Al Khail Roadshow still has equipment to send");
    expect(html).toContain("Transfer TRF-0112 is on its way here");
    expect(html).toContain("Prepare equipment");
    expect(html).toContain("Check availability");
  });

  it("a warehouse operator is offered the buttons that move stock", async () => {
    const html = await render();
    expect(html.match(/Send equipment/g)?.length).toBe(1);
    expect(html).toContain("Receive returns");
    expect(html).toContain("Receive transfer");
  });

  it("says out loud when a cap was hit", async () => {
    data = today([sendRow], [], ["Only the first 400 live requests were checked (the earliest by date). Open Requests to see the rest."]);
    expect(await render()).toContain("Only the first 400 live requests were checked");
  });
});
