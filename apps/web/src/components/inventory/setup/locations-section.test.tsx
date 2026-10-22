/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ saveInventoryLocation: vi.fn(async () => ({ error: null })), saveInventoryBin: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/actions/inventorySetup", () => actions);

import { LocationsSection, type LocationView } from "./locations-section";

// jsdom has no <dialog> behaviour: give it the two methods the Modal calls.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  vi.clearAllMocks();
});
afterEach(() => cleanup());

const company = "44444444-4444-4444-8444-444444444444";
const dubai: LocationView = { id: "l1", code: "DXB", name: "Dubai", kind: "warehouse", timezone: "Asia/Dubai", address: null, isActive: true };

describe("locations section", () => {
  it("creates nothing by itself: with no locations it only suggests Dubai, Riyadh and Poznan", () => {
    render(<LocationsSection companyId={company} locations={[]} bins={[]} isFounder canEditBins />);
    expect(screen.getByText(/no locations yet/i)).toBeTruthy();
    for (const name of ["Dubai", "Riyadh", "Poznan"]) expect(screen.getByRole("button", { name: `Add ${name}` })).toBeTruthy();
    expect(actions.saveInventoryLocation).not.toHaveBeenCalled();
  });

  it("opens the form prefilled from a suggestion and saves nothing until confirmed", () => {
    render(<LocationsSection companyId={company} locations={[]} bins={[]} isFounder canEditBins />);
    fireEvent.click(screen.getByRole("button", { name: "Add Riyadh" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Riyadh");
    expect((screen.getByLabelText("Short code") as HTMLInputElement).value).toBe("RUH");
    expect((screen.getByLabelText("Time zone") as HTMLSelectElement).value).toBe("Asia/Riyadh");
    expect(screen.getByRole("button", { name: "Add location" })).toBeTruthy();
    expect(actions.saveInventoryLocation).not.toHaveBeenCalled();
  });

  it("shows the local time at the chosen zone", async () => {
    render(<LocationsSection companyId={company} locations={[]} bins={[]} isFounder canEditBins />);
    fireEvent.click(screen.getByRole("button", { name: "Add Dubai" }));
    expect(await screen.findByText(/local time there now/i)).toBeTruthy();
    expect(screen.getByText(/\(UTC\+4\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Europe/Warsaw" } });
    expect(await screen.findByText(/\(UTC\+[12]\)/)).toBeTruthy();
  });

  it("does not suggest a place that already exists", () => {
    render(<LocationsSection companyId={company} locations={[dubai]} bins={[]} isFounder canEditBins />);
    expect(screen.queryByRole("button", { name: "Add Dubai" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Riyadh" })).toBeTruthy();
  });

  it("offers no add, edit or suggestion to someone who is not a founder", () => {
    render(<LocationsSection companyId={company} locations={[dubai]} bins={[]} isFounder={false} canEditBins />);
    expect(screen.queryByRole("button", { name: /add a location/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Add (Riyadh|Poznan)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: /bins \(0\)/i })).toBeTruthy();
    expect(screen.getByText(/only a founder can add or change locations/i)).toBeTruthy();
  });
});
