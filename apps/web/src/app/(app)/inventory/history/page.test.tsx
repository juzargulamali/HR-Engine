/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvCapability } from "@enginious-hr/domain";
import type { InvLocationRow } from "@/types/inventory";
import type { MovementList, Names } from "@/lib/inventory/stock";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/movements", useSearchParams: () => new URLSearchParams() }));
const C1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
let grants: { companyId: string; capabilities: InvCapability[] }[] = [];
const loc = { id: L1, company_id: C1, code: "DXB", name: "Dubai warehouse", kind: "warehouse", timezone: "Asia/Dubai", address: null, is_active: true, created_by: null, created_at: "", updated_at: "" } as InvLocationRow;
vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({ userId: "u", fullName: "T", installed: true, grants, companies: [{ id: C1, name: "Enginious", referenceCode: "UAE", isEnabled: true }], locations: [loc], assignedLocationIds: [L1], employeeId: null, managesProjects: false, companyName: () => "Enginious", locationName: () => "Dubai warehouse" }),
}));
const names: Names = { employees: new Map(), projects: new Map(), users: new Map(), requests: new Map(), employee: () => "Sara Ali", project: () => "P-7 Mall", user: () => "Omar Operator", request: () => "REQ-1" };
let result: MovementList | Error;
const loadMovements = vi.fn(async (..._args: unknown[]) => { if (result instanceof Error) throw result; return result; });
vi.mock("@/lib/inventory/stock", () => ({ loadMovements: (...a: unknown[]) => (loadMovements as (...x: unknown[]) => unknown)(...a), MOVEMENTS_PER_PAGE: 50 }));
vi.mock("./_panel/movement-panel", () => ({ MovementSidePanel: () => null }));

import MovementsPage from "./page";

const row = { id: "55555555-5555-4555-8555-555555555555", code: "MV-000010", kind: "issue_employee" as const, occurred_at: "2026-11-03T05:30:00Z", performed_by: "u", note: "Handed over", reason: null, project_id: null, employee_id: "e1", request_id: null, from_location_id: L1, to_location_id: null, corrects_movement_id: null,
  lines: [{ id: "l1", item_id: "i1", unit_id: "u1", qty: 1, from_kind: "warehouse", to_kind: "employee", from_location_id: L1, to_location_id: null, from_bin_id: null, to_bin_id: null, from_employee_id: null, to_employee_id: "e1", from_project_id: null, to_project_id: null, from_balance_id: null, to_balance_id: null, condition_from: null, condition_to: null, exception_note: null, corrects_line_id: null }] };
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await MovementsPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => { grants = [{ companyId: C1, capabilities: ["warehouse"] }]; loadMovements.mockClear(); result = { rows: [row], total: 1, names, items: new Map([["i1", "Laptop X1"]]) }; });

describe("Movements page", () => {
  it("shows the ledger with the time in the place's zone, what, how much, from and to, who, who it was for and the note", async () => {
    const html = await render();
    for (const h of ["When", "What", "Quantity", "From → To", "Who", "Project, employee or request", "Note"]) expect(html).toContain(h);
    expect(html).toContain("3 Nov 2026, 09:30");
    expect(html).toContain("Issued to employee");
    expect(html).toContain("Laptop X1");
    expect(html).toContain("Dubai warehouse → Employee: Sara Ali");
    expect(html).toContain("Omar Operator");
    expect(html).toContain("Handed over");
    expect(html).toContain("Check a transaction");
    expect(html).toContain('data-label="Note"');
  });
  it("is for people who can view stock only, and does not even ask the database for anyone else", async () => {
    grants = [{ companyId: C1, capabilities: ["manage_catalogue"] }];
    const html = await render();
    expect(html).toContain("Movements are for people who may see stock");
    expect(loadMovements).not.toHaveBeenCalled();
    expect(html).not.toContain("Laptop X1");
  });
  it("turns the chosen dates into the start and end of those days in the place's zone", async () => {
    await render({ from: "2026-11-01", to: "2026-11-05", kind: "receipt", location: L1 });
    const [, f, ids, fromIso, toIso] = loadMovements.mock.calls[0] as unknown as [unknown, Record<string, unknown>, string[], string, string];
    expect(f).toMatchObject({ kind: "receipt", location: L1, from: "2026-11-01", to: "2026-11-05" });
    expect(ids).toEqual([C1]);
    expect(fromIso).toBe("2026-10-31T20:00:00.000Z");
    expect(toIso).toBe("2026-11-05T20:00:00.000Z");
  });
  it("ignores a kind or date it does not know", async () => {
    await render({ kind: "evil", from: "yesterday", page: "-4" });
    expect(loadMovements.mock.calls[0]![1]).toMatchObject({ kind: "", from: "", page: 1 });
  });
  it("says it could not load, never 'no movements', when the read fails", async () => {
    result = new Error("db down");
    const html = await render();
    expect(html).toContain("Could not load the movements");
    expect(html).not.toContain("No movements yet");
  });
  it("says there are none yet, and says when nothing matches the filters", async () => {
    result = { rows: [], total: 0, names, items: new Map() };
    expect(await render()).toContain("No movements yet");
    const html = await render({ kind: "receipt" });
    expect(html).toContain("Nothing matches");
    expect(html).toContain("Clear filters");
  });
  it("pages through the ledger", async () => {
    result = { rows: [row], total: 120, names, items: new Map([["i1", "Laptop X1"]]) };
    const html = await render({ page: "2" });
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain(">Newer<");
    expect(html).toContain(">Older<");
  });
});
