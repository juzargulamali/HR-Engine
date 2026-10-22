/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRACKING_WORDS } from "@/lib/inventory/words";

const saveItem = vi.fn(async (_p: unknown, _f: FormData) => ({ error: null as string | null }));
const registerUnit = vi.fn(async (_p: unknown, _f: FormData) => ({ error: null as string | null, warning: 'Registered as UAE-E-00042. It shows as "Not counted yet" until the opening stock is confirmed.' }));
vi.mock("@/lib/actions/inventoryStock", () => ({
  saveItem: (p: unknown, f: FormData) => saveItem(p, f), registerUnit: (p: unknown, f: FormData) => registerUnit(p, f),
  replaceItem: vi.fn(), ensureBinLabel: vi.fn(), setKitLine: vi.fn(),
}));

import { AddUnitForm, QuickAddItemForm } from "./item-forms";

afterEach(() => { cleanup(); saveItem.mockClear(); registerUnit.mockClear(); });

const companies = [{ id: "c1", name: "Enginious", categories: [{ id: "k1", label: "Audio / Cables" }] }];

describe("QuickAddItemForm", () => {
  it("asks for the name, category and how it is tracked, with the plain help for each answer", () => {
    render(<QuickAddItemForm companies={companies} close={() => undefined} />);
    expect(screen.getByLabelText("Item name")).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
    for (const t of Object.values(TRACKING_WORDS)) {
      expect(screen.getByText(t.label)).toBeTruthy();
      expect(screen.getByText(t.help)).toBeTruthy();
    }
  });

  it("shows unit of measure and decimals only for counted stock, and keeps manufacturer, model and specification under 'Add more details'", () => {
    render(<QuickAddItemForm companies={companies} close={() => undefined} />);
    expect(screen.queryByLabelText("Unit of measure")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Individual item/));
    expect(screen.queryByLabelText("Unit of measure")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Counted stock/));
    expect(screen.getByLabelText("Unit of measure")).toBeTruthy();
    expect(screen.getByLabelText("Decimals")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Consumable/));
    expect(screen.getByLabelText("Unit of measure")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Kit/));
    expect(screen.queryByLabelText("Unit of measure")).toBeNull();
    const more = screen.getByText("Add more details").closest("details")!;
    expect(more.contains(screen.getByLabelText("Manufacturer"))).toBe(true);
    expect(more.contains(screen.getByLabelText("Model"))).toBe(true);
    expect(more.contains(screen.getByLabelText("Specification"))).toBe(true);
  });

  it("sends what was typed, and keeps it when the database refuses", async () => {
    saveItem.mockResolvedValueOnce({ error: "An item with the same name, model and specification already exists" });
    render(<QuickAddItemForm companies={companies} close={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "XLR cable" } });
    fireEvent.click(screen.getByLabelText(/Counted stock/));
    fireEvent.change(screen.getByLabelText("Unit of measure"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already exists/);
    expect((screen.getByLabelText("Item name") as HTMLInputElement).value).toBe("XLR cable");
    expect((screen.getByLabelText("Unit of measure") as HTMLInputElement).value).toBe("m");
    const sent = saveItem.mock.calls[0]![1];
    expect(sent.get("name")).toBe("XLR cable");
    expect(sent.get("tracking")).toBe("quantity");
    expect(sent.get("unitOfMeasure")).toBe("m");
    expect(sent.get("status")).toBe("active");
  });
});

describe("AddUnitForm", () => {
  const props = { item: { id: "i1", companyId: "c1", name: "Laptop X1" }, locations: [{ id: "l1", name: "Dubai warehouse", bins: [{ id: "b1", code: "A1", label: null }] }] };
  it("offers cost fields only to someone who may see costs, and says the unit starts as not counted yet", () => {
    const { unmount } = render(<AddUnitForm {...props} canSeeCosts={false} />);
    expect(screen.getByText(/Not counted yet/)).toBeTruthy();
    expect(screen.queryByLabelText("Cost")).toBeNull();
    expect(document.body.innerHTML).not.toContain('name="cost"');
    unmount();
    render(<AddUnitForm {...props} canSeeCosts />);
    expect(screen.getByLabelText("Cost")).toBeTruthy();
  });
  it("sends its own key, and a new key after a success so the next unit is not mistaken for a repeat", async () => {
    render(<AddUnitForm {...props} canSeeCosts={false} />);
    fireEvent.change(screen.getByLabelText(/Serial number/), { target: { value: "SN-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Register unit" }));
    await waitFor(() => expect(registerUnit).toHaveBeenCalledTimes(1));
    const first = registerUnit.mock.calls[0]![1].get("key") as string;
    expect(first).toMatch(/^unit-/);
    expect(await screen.findByText(/Registered as UAE-E-00042/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Serial number/), { target: { value: "SN-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Register unit" }));
    await waitFor(() => expect(registerUnit).toHaveBeenCalledTimes(2));
    expect(registerUnit.mock.calls[1]![1].get("key")).not.toBe(first);
  });
});
