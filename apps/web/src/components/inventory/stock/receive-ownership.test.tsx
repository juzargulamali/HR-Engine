/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateBase, type Candidate, type FormContext } from "@/lib/inventory/stock-candidates";
import type { MovementInput } from "@/lib/inventory/stock-movements";
import { MovementForm } from "./movement-form";
import type { MovementServices } from "./movement-services";

// A simulated server: these tests prove how the form behaves, not that the database function works.
const truss: Candidate = candidateBase({ key: "item-truss", type: "item", itemId: "i-truss", itemName: "Truss section 2 m", tracking: "quantity", uom: "pcs" });
const context: FormContext = {
  locations: [{ id: "l1", companyId: "c1", companyName: "Enginious", name: "Dubai warehouse", timezone: "Asia/Dubai", bins: [] }],
  destinations: [], projects: [], requests: [], transfers: [], rentals: [], canSeeCostsByCompany: { c1: false },
};
const services = (): MovementServices => ({
  submit: vi.fn(async () => ({ error: null, message: "Recorded as MV-000001.", result: {} })),
  check: vi.fn(async () => ({ error: null, state: "not_recorded" as const, text: "" })),
  search: vi.fn(async () => ({ error: null, candidates: [truss] })),
  held: vi.fn(async () => ({ error: null, candidates: [] })),
  read: vi.fn(async () => ({ ok: false as const, message: "no" })),
  employees: vi.fn(async () => ({ error: null, people: [] })),
});
afterEach(() => cleanup());

async function addTruss() {
  fireEvent.change(screen.getByLabelText(/search for an item or unit/i), { target: { value: "truss" } });
  fireEvent.click(await screen.findByRole("button", { name: /add truss/i }));
  fireEvent.change(screen.getByLabelText(/quantity of truss/i), { target: { value: "12" } });
}

describe("receiving: owned or rented is a visible, explicit choice", () => {
  it("offers Owned and Rented up front, with neither chosen, and explains what each means", () => {
    render(<MovementForm kind="receive" services={services()} context={context} />);
    const group = screen.getByRole("group", { name: /owned or rented/i });
    expect((within(group).getByLabelText(/^Owned/) as HTMLInputElement).checked).toBe(false);
    expect((within(group).getByLabelText(/^Rented/) as HTMLInputElement).checked).toBe(false);
    expect(within(group).getByText("It is ours. It adds to what the company owns.")).toBeTruthy();
    expect(within(group).getByText("It has to go back to its supplier. It never adds to what the company owns.")).toBeTruthy();
  });

  it("will not go to the review until the choice is made, and keeps what was typed", async () => {
    const s = services();
    render(<MovementForm kind="receive" services={s} context={context} />);
    await addTruss();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/owned or rented/i);
    expect(screen.queryByText("Check before you confirm")).toBeNull();
    expect((screen.getByLabelText(/quantity of truss/i) as HTMLInputElement).value).toBe("12");
    expect(s.submit).not.toHaveBeenCalled();
  });

  it("owned: sends no rental, and the review says it adds to what the company owns", async () => {
    const s = services();
    render(<MovementForm kind="receive" services={s} context={context} />);
    await addTruss();
    fireEvent.click(screen.getByLabelText(/^Owned/));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Owned or rented")).toBeTruthy();
    expect(screen.getByText(/Owned\. It adds to what the company owns/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /confirm receipt/i }));
    await screen.findByText("Recorded");
    const sent = (s.submit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as MovementInput;
    expect(sent.kind).toBe("receive");
    expect(sent.rental).toBeUndefined();
  });

  it("rented: asks for the supplier details and sends them as a rental", async () => {
    const s = services();
    render(<MovementForm kind="receive" services={s} context={context} />);
    await addTruss();
    fireEvent.click(screen.getByLabelText(/^Rented/));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/rental supplier/i);
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "Gulf Rentals" } });
    fireEvent.change(screen.getByLabelText(/Supplier.s reference/), { target: { value: "PO-77" } });
    fireEvent.change(screen.getByLabelText("Has to go back by"), { target: { value: "2099-01-01T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText(/Rented from Gulf Rentals/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /confirm receipt/i }));
    await screen.findByText("Recorded");
    const sent = (s.submit as ReturnType<typeof vi.fn>).mock.calls[0]![0] as MovementInput;
    expect(sent.rental).toMatchObject({ supplierName: "Gulf Rentals", externalReference: "PO-77" });
  });

  it("keeps condition, serial numbers and cost under More details, and the note collapsed", async () => {
    render(<MovementForm kind="receive" services={services()} context={context} />);
    await addTruss();
    const more = screen.getByText(/More details/).closest("details")!;
    expect(more.open).toBe(false);
    expect(within(more).getByLabelText("Condition")).toBeTruthy();
    expect((screen.getByText(/Add a note/).closest("details") as HTMLDetailsElement).open).toBe(false);
  });
});
