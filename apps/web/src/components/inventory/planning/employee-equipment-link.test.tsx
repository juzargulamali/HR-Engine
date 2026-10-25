/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let caps: string[] = [];
let installed = true;
let rpcResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const rpc = vi.fn(async () => rpcResult);
vi.mock("@/lib/inventory/context", () => ({
  getInventoryContext: async () => ({ installed, loadFailed: false, grants: caps.length ? [{ companyId: "c1", capabilities: caps }] : [] }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { EmployeeEquipmentLink } from "./employee-equipment-link";

const row = (over: Record<string, unknown> = {}) => ({
  employee_id: "e1", display_name: "Sara Ali", employee_number: "E-1", employment_status: "active", termination_date: null, is_active: true, is_removed: false,
  holding_kind: "unit", code: "UAE-E-00005", item_name: "Laptop X1", serial_number: "SN-1", qty: 1, unit_of_measure: "each", issued_at: "2026-10-20T08:00:00Z",
  expected_return_at: null, condition: "good", is_overdue: false, ...over,
});
const render = async () => renderToStaticMarkup((await EmployeeEquipmentLink({ employeeId: "e1", companyId: "c1" })) ?? <></>);

beforeEach(() => { caps = ["founder"]; installed = true; rpcResult = { data: [], error: null }; rpc.mockClear(); });

describe("EmployeeEquipmentLink (HR Assets tab)", () => {
  it("shows nothing, and asks nothing, to a person without Inventory access", async () => {
    caps = [];
    expect(await render()).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows nothing when Inventory is not installed", async () => {
    installed = false;
    expect(await render()).toBe("");
  });

  it("lists what the employee holds, with the ID and dates and nothing private", async () => {
    rpcResult = { data: [row(), row({ code: "UAE-E-00006", item_name: "Headset", serial_number: null, is_overdue: true, expected_return_at: "2026-10-22T08:00:00Z" })], error: null };
    const html = await render();
    expect(html).toContain("Laptop X1");
    expect(html).toContain("UAE-E-00005");
    expect(html).toContain("serial SN-1");
    expect(html).toContain("overdue");
    expect(html).toContain("/inventory/employees?employee=e1");
    expect(html).not.toMatch(/salary|cost|AED/i);
    expect(rpc).toHaveBeenCalledWith("inv_employee_outstanding", { p_company_id: "c1", p_employee_id: "e1", p_include_inactive: true });
  });

  it("says plainly when the employee holds nothing", async () => {
    expect(await render()).toContain("holds no company equipment");
  });

  it("says it could not load, never 'holds nothing', when the read fails", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const html = await render();
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("holds no company equipment");
  });
});
