/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanResolution } from "@/lib/inventory/scan-lookup";

// The scan page may only call this one function: the module has no other export, so any other call would fail the test.
const actions = vi.hoisted(() => ({ resolveInventoryCode: vi.fn() }));
vi.mock("@/lib/actions/inventorySetup", () => actions);

import { ScanView } from "./scan-view";

const found = (code: string, name: string, extra: Partial<Extract<ScanResolution, { status: "found" }>> = {}): ScanResolution => ({
  status: "found", kind: code.includes("-E-") ? "unit" : "stock", code, id: `id-${code}`, itemId: `item-${code}`, itemName: name,
  openHref: code.includes("-E-") ? `/inventory?unit=id-${code}` : `/inventory?open=item-${code}`, facts: ["In use", "In the warehouse"], ...extra,
});

beforeEach(() => {
  actions.resolveInventoryCode.mockReset();
  actions.resolveInventoryCode.mockImplementation(async (raw: string): Promise<ScanResolution> => {
    if (/00042/.test(raw)) return found("UAE-E-00042", "Laptop · X1");
    if (/00043/.test(raw)) return found("UAE-E-00043", "Headset");
    if (/S-00007/.test(raw)) return found("UAE-S-00007", "HDMI cable");
    return { status: "unavailable" };
  });
});
afterEach(() => cleanup());

async function look(code: string) {
  fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
  await waitFor(() => expect(screen.queryByText(/looking it up/i)).toBeNull());
}
const list = () => screen.getByRole("list", { name: /scanned codes/i });

describe("scan page", () => {
  it("shows what a code is and offers Open and Add to a list", async () => {
    render(<ScanView />);
    await look("uae-e-00042");
    expect(await screen.findByText("Laptop · X1")).toBeTruthy();
    expect((screen.getByRole("link", { name: "Open" }) as HTMLAnchorElement).getAttribute("href")).toBe("/inventory?unit=id-UAE-E-00042");
    expect(screen.getByRole("button", { name: /add to a list/i })).toBeTruthy();
    expect(screen.getByText(/never changes any stock/i)).toBeTruthy();
  });

  it("opens the item for a bin label", async () => {
    render(<ScanView />);
    await look("UAE-S-00007");
    expect((await screen.findByRole("link", { name: "Open" }) as HTMLAnchorElement).getAttribute("href")).toBe("/inventory?open=item-UAE-S-00007");
  });

  it("lists a unit that is scanned again only once", async () => {
    render(<ScanView />);
    await look("UAE-E-00042");
    fireEvent.click(await screen.findByRole("button", { name: /add to a list/i }));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    await look("UAE-E-00042");
    fireEvent.click(await screen.findByRole("button", { name: /add to a list/i }));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/already on the list/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /your list \(1\)/i })).toBeTruthy();
    // a different unit is a second line
    await look("UAE-E-00043");
    fireEvent.click(await screen.findByRole("button", { name: /add to a list/i }));
    expect(within(list()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("continues to the matching form with the codes in the address", async () => {
    render(<ScanView />);
    expect(screen.getByText("Issue / Dispatch").getAttribute("aria-disabled")).toBe("true");
    await look("UAE-E-00042");
    fireEvent.click(await screen.findByRole("button", { name: /add to a list/i }));
    await look("UAE-S-00007");
    fireEvent.click(await screen.findByRole("button", { name: /add to a list/i }));
    const href = (label: string) => (screen.getByRole("link", { name: label }) as HTMLAnchorElement).getAttribute("href");
    expect(href("Issue / Dispatch")).toBe("/inventory?action=issue&codes=UAE-E-00042,UAE-S-00007");
    expect(href("Return")).toBe("/inventory?action=return&codes=UAE-E-00042,UAE-S-00007");
    expect(href("Transfer")).toBe("/inventory?action=transfer&codes=UAE-E-00042,UAE-S-00007");
  });

  it("removes a line and clears the list", async () => {
    render(<ScanView />);
    await look("UAE-E-00042");
    fireEvent.click(await screen.findByRole("button", { name: /add to a list/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove uae-e-00042/i }));
    expect(screen.getByText(/nothing on the list yet/i)).toBeTruthy();
  });

  it("gives the same safe message for a code that does not exist or is not allowed, and never offers to open or list it", async () => {
    render(<ScanView />);
    await look("UAE-E-99999");
    expect(await screen.findByText("This code is not available to you or does not exist.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("button", { name: /add to a list/i })).toBeNull();
  });

  it("says plainly when a value is not an Inventory code", async () => {
    actions.resolveInventoryCode.mockResolvedValueOnce({ status: "not_inventory", problem: "not_inventory" });
    render(<ScanView />);
    await look("hello");
    expect(await screen.findByText(/not an enginious inventory code/i)).toBeTruthy();
  });

  it("says it could not look up, instead of 'not available', when the lookup fails", async () => {
    actions.resolveInventoryCode.mockRejectedValueOnce(new Error("offline"));
    render(<ScanView />);
    await look("UAE-E-00042");
    expect(await screen.findByText(/could not be looked up/i)).toBeTruthy();
    expect(screen.queryByText(/not available to you/i)).toBeNull();
  });

  it("starts with the safe message when the address carried an unknown code", () => {
    render(<ScanView initial={{ raw: "UAE-E-00001", resolution: { status: "unavailable" } }} />);
    expect(screen.getByText("This code is not available to you or does not exist.")).toBeTruthy();
  });

  it("only ever calls the read-only lookup: one call per code typed, nothing else exists to call", async () => {
    render(<ScanView />);
    await look("UAE-E-00042");
    await look("UAE-E-99999");
    expect(actions.resolveInventoryCode).toHaveBeenCalledTimes(2);
    expect(Object.keys(actions)).toEqual(["resolveInventoryCode"]);
  });
});
