/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  saveInventoryCountLine: vi.fn(async () => ({ error: null })),
  confirmInventoryCount: vi.fn(async () => ({ error: null, detail: { units: 0, quantity_lines: 1, adjustments: 1 } })),
  cancelInventoryCount: vi.fn(async () => ({ error: null })),
  checkInventoryTransaction: vi.fn(async () => ({ status: "not_recorded" as const })),
  lookupCountUnit: vi.fn(async () => ({ unit: null, error: "No unit with that code is available to you." })),
}));
vi.mock("@/lib/actions/inventorySetup", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/manage", useSearchParams: () => new URLSearchParams() }));

import { CountSheetBody, type CountSheetData, type CountSheetProps, type SheetLineView } from "./count-sheet";

const base: CountSheetData = {
  id: "11111111-1111-4111-8111-111111111111", code: "UAE-C-00001", kind: "opening", status: "open", note: null, locationId: "22222222-2222-4222-8222-222222222222",
  locationName: "Dubai", startedByName: "Amina", startedAt: "2026-10-20T08:00:00Z", confirmedByName: null, confirmedAt: null,
};
const connector = { id: "33333333-3333-4333-8333-333333333333", name: "HDMI cable 3 m", scale: 0, unitOfMeasure: "each" };
const line = (over: Partial<SheetLineView> = {}): SheetLineView => ({
  id: "l1", unitId: null, unitCode: null, itemId: connector.id, itemName: connector.name, binId: null, binCode: null, condition: "good", expected: 12, counted: 10,
  reason: null, note: null, scale: 0, unitOfMeasure: "each", ...over,
});
const props = (over: Partial<CountSheetProps> = {}): CountSheetProps => ({
  count: base, companyId: "44444444-4444-4444-8444-444444444444", canEdit: true, canConfirm: true, lines: [], items: [connector], bins: [],
  balances: [{ itemId: connector.id, binId: null, condition: "good", qty: 12 }], notCounted: [], ...over,
});
const cycle = { ...base, kind: "cycle" as const };

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

function chooseItem() {
  fireEvent.change(screen.getByLabelText("Item"), { target: { value: connector.id } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: /save this line/i }));

describe("count sheet: a typed quantity", () => {
  it("does not save a line with no quantity typed, and never fills one in", async () => {
    render(<CountSheetBody {...props()} />);
    chooseItem();
    expect((screen.getByLabelText(/quantity you counted/i) as HTMLInputElement).value).toBe("");
    submit();
    expect(await screen.findByText(/type the quantity you counted/i)).toBeTruthy();
    expect(actions.saveInventoryCountLine).not.toHaveBeenCalled();
  });

  it("asks which item was counted before anything else", async () => {
    render(<CountSheetBody {...props()} />);
    submit();
    expect(await screen.findByText(/choose the item you counted/i)).toBeTruthy();
    expect(actions.saveInventoryCountLine).not.toHaveBeenCalled();
  });

  it("refuses decimals for an item counted in whole numbers", async () => {
    render(<CountSheetBody {...props()} />);
    chooseItem();
    fireEvent.change(screen.getByLabelText(/quantity you counted/i), { target: { value: "2.5" } });
    submit();
    expect(await screen.findByText(/whole numbers/i)).toBeTruthy();
    expect(actions.saveInventoryCountLine).not.toHaveBeenCalled();
  });

  it("saves the typed quantity for an opening count, with no reason asked", async () => {
    render(<CountSheetBody {...props()} />);
    chooseItem();
    fireEvent.change(screen.getByLabelText(/quantity you counted/i), { target: { value: "40" } });
    expect(screen.queryByLabelText(/reason for the difference/i)).toBeNull();
    submit();
    await waitFor(() => expect(actions.saveInventoryCountLine).toHaveBeenCalledTimes(1));
    const fd = (actions.saveInventoryCountLine.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("qty")).toBe("40");
    expect(fd.get("itemId")).toBe(connector.id);
    expect(fd.get("countId")).toBe(base.id);
    expect(fd.get("reason")).toBeNull();
  });
});

describe("count sheet: a reason for differences on a cycle count", () => {
  it("shows the system quantity and requires a reason when the count differs", async () => {
    render(<CountSheetBody {...props({ count: cycle })} />);
    chooseItem();
    expect(screen.getByText(/the system holds 12/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/quantity you counted/i), { target: { value: "10" } });
    expect(screen.getByLabelText(/reason for the difference/i)).toBeTruthy();
    submit();
    expect(await screen.findByText(/count differs from what the system holds/i)).toBeTruthy();
    expect(actions.saveInventoryCountLine).not.toHaveBeenCalled();
    // what was typed survives the refusal
    expect((screen.getByLabelText(/quantity you counted/i) as HTMLInputElement).value).toBe("10");
  });

  it("saves with the reason once it is given", async () => {
    render(<CountSheetBody {...props({ count: cycle })} />);
    chooseItem();
    fireEvent.change(screen.getByLabelText(/quantity you counted/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/reason for the difference/i), { target: { value: "Two damaged and binned" } });
    submit();
    await waitFor(() => expect(actions.saveInventoryCountLine).toHaveBeenCalledTimes(1));
    const fd = (actions.saveInventoryCountLine.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("qty")).toBe("10");
    expect(fd.get("reason")).toBe("Two damaged and binned");
  });

  it("needs no reason when the count matches the system", async () => {
    render(<CountSheetBody {...props({ count: cycle })} />);
    chooseItem();
    fireEvent.change(screen.getByLabelText(/quantity you counted/i), { target: { value: "12" } });
    expect(screen.queryByLabelText(/reason for the difference/i)).toBeNull();
    submit();
    await waitFor(() => expect(actions.saveInventoryCountLine).toHaveBeenCalledTimes(1));
  });
});

describe("count sheet: review and confirm", () => {
  const confirmButton = () => screen.getByRole("button", { name: /confirm this count/i }) as HTMLButtonElement;

  it("shows expected against counted, and blocks confirming while a difference has no reason", () => {
    render(<CountSheetBody {...props({ count: cycle, lines: [line()] })} />);
    const row = screen.getByText("HDMI cable 3 m", { selector: "span.font-medium" }).closest("tr")!;
    expect(within(row).getByText("12")).toBeTruthy();
    expect(within(row).getByText("10")).toBeTruthy();
    expect(within(row).getByText("-2")).toBeTruthy();
    expect(within(row).getByText(/reason needed/i)).toBeTruthy();
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getAllByText(/still needs a reason/i).length).toBeGreaterThan(0);
  });

  it("allows confirming once every difference has a reason, with one key for the confirmation", async () => {
    render(<CountSheetBody {...props({ count: cycle, lines: [line({ reason: "Two damaged and binned" })] })} />);
    expect(confirmButton().disabled).toBe(false);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(actions.confirmInventoryCount).toHaveBeenCalledTimes(1));
    const fd = (actions.confirmInventoryCount.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("key")).toMatch(/^count-[A-Za-z0-9-]{8,}$/);
    expect(fd.get("countId")).toBe(base.id);
    expect(await screen.findByText(/confirmed\./i)).toBeTruthy();
  });

  it("needs at least one line", () => {
    render(<CountSheetBody {...props()} />);
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByText(/add at least one counted line first/i)).toBeTruthy();
  });

  it("leaves confirming to people who may, and says so", () => {
    render(<CountSheetBody {...props({ canConfirm: false, lines: [line({ counted: 12 })] })} />);
    expect(screen.queryByRole("button", { name: /confirm this count/i })).toBeNull();
    expect(screen.getByText(/only a founder, or someone allowed to confirm stock counts/i)).toBeTruthy();
  });

  it("shows who verified a confirmed count and when, and offers no editing", () => {
    render(<CountSheetBody {...props({ count: { ...base, status: "confirmed", confirmedByName: "Omar", confirmedAt: "2026-10-21T09:30:00Z" }, lines: [line({ counted: 12 })] })} />);
    expect(screen.getByText(/verified by omar/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save this line/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm this count/i })).toBeNull();
  });

  it("marks registered-but-uncounted units as Not counted yet", () => {
    render(<CountSheetBody {...props({ notCounted: [{ id: "u1", code: "UAE-E-00042", itemName: "Laptop" }] })} />);
    expect(screen.getByText("Not counted yet", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /counted here/i })).toBeTruthy();
  });
});
