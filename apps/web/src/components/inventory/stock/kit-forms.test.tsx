/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MovementInput } from "@/lib/inventory/stock-movements";
import { KitPackForm, type KitRow } from "./kit-forms";
import type { MovementServices } from "./movement-services";

afterEach(() => cleanup());

const rows: KitRow[] = [
  { itemId: "i-mixer", itemName: "Mixer", tracking: "individual", uom: "each", scale: 0, expectedQty: 1, required: true, status: "missing", packedText: null, options: [{ unitId: "u-mixer", code: "UAE-E-00050", serial: "MX-1" }] },
  { itemId: "i-xlr", itemName: "XLR cable", tracking: "quantity", uom: "each", scale: 0, expectedQty: 4, required: true, status: "missing", packedText: null, options: [] },
  { itemId: "i-case", itemName: "Flight case", tracking: "individual", uom: "each", scale: 0, expectedQty: 1, required: false, status: "present", packedText: "UAE-E-00060", options: [] },
];
function services(over: Partial<MovementServices> = {}): MovementServices {
  return {
    submit: vi.fn(async (_i: MovementInput) => ({ error: null, message: "Recorded as MV-7. 1 required item is still missing from the kit.", result: {} })),
    check: vi.fn(), search: vi.fn(async () => ({ error: null, candidates: [] })), held: vi.fn(), read: vi.fn(), employees: vi.fn(), ...over,
  } as MovementServices;
}
const kit = { unitId: "u-kit", code: "UAE-E-00100", companyId: "c1", locationId: "l1", locationName: "Dubai warehouse", itemName: "DJ kit" };
const choose = (item: string, value: string) => fireEvent.change(within(screen.getByText(item).closest("li")!).getByLabelText("This line"), { target: { value } });

describe("KitPackForm", () => {
  it("leaves lines alone unless told, and needs at least one choice", async () => {
    render(<KitPackForm services={services()} kit={kit} rows={rows} bins={[]} />);
    expect(screen.getByText(/In the kit: UAE-E-00060/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least one line/i);
  });

  it("records what is packed, what is missing, and needs a typed quantity for counted stock, then shows the summary before Confirm", async () => {
    const s = services();
    render(<KitPackForm services={s} kit={kit} rows={rows} bins={[]} />);
    choose("Mixer", "present");
    fireEvent.change(screen.getByLabelText("Which unit"), { target: { value: "u-mixer" } });
    choose("XLR cable", "present");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/XLR cable: Type the quantity/);
    choose("XLR cable", "missing");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Check before you confirm")).toBeTruthy();
    expect(screen.getByText(/Mixer: UAE-E-00050/)).toBeTruthy();
    expect(screen.getByText(/XLR cable: missing/)).toBeTruthy();
    expect(screen.getByText(/1 packed, 1 recorded as missing/)).toBeTruthy();
    expect(screen.getByText("Inside kit UAE-E-00100 (DJ kit)")).toBeTruthy();
    expect(s.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm packing/i }));
    await waitFor(() => expect(s.submit).toHaveBeenCalledTimes(1));
    const sent = (s.submit as unknown as { mock: { calls: [MovementInput][] } }).mock.calls[0]![0];
    expect(sent.kind).toBe("pack_kit");
    expect(sent.kitUnitId).toBe("u-kit");
    expect(sent.lines).toEqual([{ item_id: "i-mixer", status: "present", unit_id: "u-mixer" }, { item_id: "i-xlr", status: "missing" }]);
    expect(await screen.findByText(/still missing from the kit/)).toBeTruthy();
  });

  it("a double click on Confirm sends one request, and an uncertain failure keeps the entry and offers the check", async () => {
    const submit = vi.fn(async (_i: MovementInput) => ({ error: "The save did not finish in time.", uncertain: true }));
    const check = vi.fn(async () => ({ error: null, state: "not_recorded" as const, text: "It was not recorded." }));
    render(<KitPackForm services={services({ submit, check })} kit={kit} rows={rows} bins={[]} />);
    choose("XLR cable", "missing");
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const confirm = await screen.findByRole("button", { name: /confirm packing/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: /check whether it went through/i }));
    await waitFor(() => expect(check).toHaveBeenCalledWith("c1", submit.mock.calls[0]![0].key));
    expect(screen.getByText(/XLR cable: missing/)).toBeTruthy();
  });
});
