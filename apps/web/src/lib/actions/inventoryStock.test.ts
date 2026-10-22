import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error { constructor(public to: string) { super(`redirect:${to}`); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); } }));
let outcome: { data: unknown; error: { message: string } | null } | Error = { data: null, error: null };
const calls: { fn: string; args: Record<string, unknown>; signal?: AbortSignal }[] = [];
const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
  const entry: (typeof calls)[number] = { fn, args };
  calls.push(entry);
  const settle = () => (outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome));
  return { abortSignal: (s: AbortSignal) => { entry.signal = s; return settle(); }, then: (a: (v: unknown) => unknown, b: (e: unknown) => unknown) => settle().then(a, b) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@/lib/inventory/context", () => ({ getInventoryContext: async () => null }));

import { checkTransaction, correctMovement, recordMovement, registerUnit, saveItem } from "./inventoryStock";
import type { MovementInput } from "@/lib/inventory/stock-movements";

const C = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";
const U = "44444444-4444-4444-8444-444444444444";
const KEY = "issue-12345678-abcd";
const issue: MovementInput = { kind: "issue", companyId: C, locationId: L, key: KEY, lines: [{ unit_id: U }], employeeId: E };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeEach(() => { calls.length = 0; rpc.mockClear(); outcome = { data: { movement_id: "m1", code: "MV-000001", lines: [] }, error: null }; });

describe("recordMovement", () => {
  it("calls the database function with the key made when the form opened, and says what was recorded", async () => {
    const r = await recordMovement(issue);
    expect(r.error).toBeNull();
    expect(r.message).toBe("Recorded as MV-000001.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("inv_issue_to_employee");
    expect(calls[0]!.args).toMatchObject({ p_company_id: C, p_location_id: L, p_employee_id: E, p_key: KEY, p_lines: [{ unit_id: U }] });
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the same call again for a repeat, with the same key (the database returns the first result)", async () => {
    await recordMovement(issue);
    await recordMovement(issue);
    expect(calls.map((c) => c.args.p_key)).toEqual([KEY, KEY]);
    expect(calls[1]!.args).toEqual(calls[0]!.args);
  });

  it("asks the database nothing when the request is incomplete", async () => {
    expect((await recordMovement({ ...issue, employeeId: undefined })).error).toMatch(/employee/);
    expect((await recordMovement({ ...issue, key: "short" })).error).toMatch(/Reload the page|expired|8/i);
    expect((await recordMovement({ ...issue, lines: [] })).error).toMatch(/at least one/i);
    expect((await recordMovement({ ...issue, locationId: "not-a-uuid" as never })).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps only the fields the database reads from each line", async () => {
    await recordMovement({ ...issue, lines: [{ unit_id: U, evil: "x", qty: "5" } as never] });
    expect(calls[0]!.args.p_lines).toEqual([{ unit_id: U }]);
  });

  it("shows the database's plain message as it is, and does not call a refusal uncertain", async () => {
    outcome = { data: null, error: { message: "Only 3 of Laptop X1 can be issued now: the rest is reserved for upcoming requests" } };
    const r = await recordMovement(issue);
    expect(r.error).toBe("Only 3 of Laptop X1 can be issued now: the rest is reserved for upcoming requests");
    expect(r.uncertain).toBeFalsy();
  });

  it("calls a timeout or a lost connection uncertain, so the form offers the result check", async () => {
    outcome = { data: null, error: { message: "TimeoutError: The operation was aborted due to timeout" } };
    const a = await recordMovement(issue);
    expect(a.uncertain).toBe(true);
    expect(a.error).toMatch(/Check whether it went through/);
    outcome = new Error("fetch failed");
    const b = await recordMovement(issue);
    expect(b.uncertain).toBe(true);
  });

  it("translates permission failures", async () => {
    outcome = { data: null, error: { message: "permission denied for function inv_issue_to_employee" } };
    expect((await recordMovement(issue)).error).toBe("You are not allowed to do that.");
  });
});

describe("checkTransaction", () => {
  it("says in words whether the key was recorded, and changes nothing", async () => {
    outcome = { data: { found: true, status: "recorded", movement_code: "MV-9", movement_id: "m9" }, error: null };
    const r = await checkTransaction(C, KEY);
    expect(r).toMatchObject({ error: null, state: "recorded", movementId: "m9" });
    expect(r.text).toMatch(/Do not send it again/);
    expect(calls[0]).toMatchObject({ fn: "inv_transaction_status", args: { p_company_id: C, p_key: KEY } });
    outcome = { data: { found: false, status: "not_recorded" }, error: null };
    expect((await checkTransaction(C, KEY)).state).toBe("not_recorded");
  });
  it("refuses a malformed key or company without asking", async () => {
    expect((await checkTransaction(C, "no")).error).toMatch(/not a valid transaction key/);
    expect((await checkTransaction("x", KEY)).error).toMatch(/company/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveItem", () => {
  it("adds an item as in use, sends unit and decimals only for counted stock, then lands on the new item", async () => {
    outcome = { data: "new-item", error: null };
    await expect(saveItem({ error: null }, fd({ companyId: C, name: " XLR cable ", tracking: "quantity", unitOfMeasure: "m", quantityScale: "2", specification: "5 m", after: "panel", status: "active" }))).rejects.toThrow("redirect:/inventory?open=new-item");
    expect(calls[0]).toMatchObject({ fn: "inv_save_item", args: { p_company_id: C, p_item_id: null, p_fields: { name: "XLR cable", tracking: "quantity", status: "active", unit_of_measure: "m", quantity_scale: 2, specification: "5 m" } } });
    calls.length = 0;
    await expect(saveItem({ error: null }, fd({ companyId: C, name: "Laptop", tracking: "individual", unitOfMeasure: "box", quantityScale: "3", after: "panel" }))).rejects.toThrow(/redirect/);
    expect(calls[0]!.args.p_fields).toEqual({ name: "Laptop", tracking: "individual", status: "active" });
  });
  it("needs a name and a tracking method", async () => {
    expect((await saveItem({ error: null }, fd({ companyId: C, name: "", tracking: "individual" }))).error).toMatch(/name/);
    expect((await saveItem({ error: null }, fd({ companyId: C, name: "x" }))).error).toMatch(/how this item is tracked/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("edits with the version so a stale edit is refused, and keeps what was typed when the database refuses", async () => {
    outcome = { data: null, error: { message: "Someone else changed this item. Reload and try again" } };
    const r = await saveItem({ error: null }, fd({ companyId: C, itemId: U, name: "Laptop", expectedVersion: "4", categoryId: "" }));
    expect(r.error).toBe("Someone else changed this item. Reload and try again");
    expect(calls[0]!.args).toMatchObject({ p_item_id: U, p_fields: { name: "Laptop", expected_version: 4, category_id: "" } });
  });
});

describe("registerUnit", () => {
  const base = { companyId: C, itemId: U, locationId: L, condition: "good", key: "unit-12345678-abcd" };
  it("registers a unit with its own key, and says it is not counted yet", async () => {
    outcome = { data: { unit_id: U, code: "UAE-E-00042", lifecycle: "draft" }, error: null };
    const r = await registerUnit({ error: null }, fd({ ...base, serial: " SN-1 " }));
    expect(r.error).toBeNull();
    expect(r.code).toBe("UAE-E-00042");
    expect(r.warning).toMatch(/Not counted yet/);
    expect(calls[0]).toMatchObject({ fn: "inv_register_unit", args: { p_serial_number: "SN-1", p_key: "unit-12345678-abcd", p_cost: null } });
  });
  it("sends a cost only with both an amount and a currency", async () => {
    expect((await registerUnit({ error: null }, fd({ ...base, cost: "100" }))).error).toMatch(/amount and a currency/);
    expect(rpc).not.toHaveBeenCalled();
    await registerUnit({ error: null }, fd({ ...base, cost: "100", currency: "aed", purchaseDate: "2026-10-01" }));
    expect(calls[0]!.args.p_cost).toEqual({ unit_cost: 100, currency: "AED", purchase_date: "2026-10-01" });
  });
});

describe("correctMovement", () => {
  const L1 = "55555555-5555-4555-8555-555555555555";
  it("needs a reason and at least one corrected quantity, and sends only the lines that were typed", async () => {
    const base = { companyId: C, movementId: U, key: "fix-12345678-abcd" };
    expect((await correctMovement({ error: null }, fd({ ...base, reason: "", [`qty_${L1}`]: "3" }))).error).toMatch(/why/);
    expect((await correctMovement({ error: null }, fd({ ...base, reason: "Counted again" }))).error).toMatch(/right quantity/);
    expect(rpc).not.toHaveBeenCalled();
    outcome = { data: { code: "MV-20" }, error: null };
    const r = await correctMovement({ error: null }, fd({ ...base, reason: "Counted again", [`qty_${L1}`]: "18,5" }));
    expect(r.warning).toMatch(/Correction recorded as MV-20/);
    expect(calls[0]).toMatchObject({ fn: "inv_correct_movement", args: { p_reason: "Counted again", p_lines: [{ line_id: L1, qty: 18.5 }] } });
  });
});
