/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateBase, type Candidate, type FormContext } from "@/lib/inventory/stock-candidates";
import type { MovementInput } from "@/lib/inventory/stock-movements";
import { MovementForm } from "./movement-form";
import type { MovementServices } from "./movement-services";

// These tests prove how the form behaves with a simulated server: they do NOT prove the database functions work.

const laptop: Candidate = candidateBase({
  key: "unit-u1", type: "unit", unitId: "u1", code: "UAE-E-00042", itemId: "i-laptop", itemName: "Laptop X1", lifecycle: "active", custody: "warehouse",
  condition: "good", locationId: "l1", where: "In the warehouse: Dubai warehouse",
});
const cable: Candidate = candidateBase({
  key: "bal-b1", type: "counted", code: "UAE-S-00007", itemId: "i-xlr", itemName: "XLR cable", tracking: "quantity", qty: 20, binId: "b1", binLabel: "A1", condition: "good",
  locationId: "l1", where: "On the shelf: Dubai warehouse, bin A1",
});
const heldLaptop: Candidate = { ...laptop, key: "unit-held", unitId: "u9", code: "UAE-E-00099", custody: "employee", employeeId: "e1", employeeName: "Sara Ali", where: "With an employee: Sara Ali" };

const context: FormContext = {
  locations: [{ id: "l1", companyId: "c1", companyName: "Enginious", name: "Dubai warehouse", timezone: "Asia/Dubai", bins: [{ id: "b1", code: "A1", label: null }] }],
  destinations: [
    { id: "l1", companyId: "c1", companyName: "Enginious", name: "Dubai warehouse", timezone: "Asia/Dubai", bins: [] },
    { id: "l2", companyId: "c1", companyName: "Enginious", name: "Riyadh warehouse", timezone: "Asia/Riyadh", bins: [] },
  ],
  projects: [], requests: [], transfers: [], rentals: [], canSeeCostsByCompany: { c1: false },
};

function services(over: Partial<MovementServices> = {}): MovementServices {
  return {
    submit: vi.fn(async () => ({ error: null, message: "Recorded as MV-000001.", result: {} })),
    check: vi.fn(async () => ({ error: null, state: "not_recorded" as const, text: "It was not recorded. Nothing changed, so it is safe to send it again." })),
    search: vi.fn(async () => ({ error: null, candidates: [laptop, cable] })),
    held: vi.fn(async () => ({ error: null, candidates: [heldLaptop] })),
    read: vi.fn(async () => ({ ok: true as const, kind: "unit" as const, unitId: "u1", itemId: "i-laptop", code: "UAE-E-00042", candidate: laptop })),
    employees: vi.fn(async () => ({ error: null, people: [{ employeeId: "e1", name: "Sara Ali", number: "E-1", department: "Events" }] })),
    ...over,
  };
}

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => cleanup());

async function fillIssue(s: MovementServices, opts: { add?: "laptop" | "cable" } = { add: "laptop" }) {
  render(<MovementForm kind="issue" services={s} context={context} />);
  fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
  fireEvent.change(screen.getByLabelText("Who receives it?"), { target: { value: "sara" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sara Ali/ }));
  fireEvent.change(screen.getByLabelText(/search for an item or unit/i), { target: { value: "lap" } });
  if (opts.add === "cable") fireEvent.click(await screen.findByRole("button", { name: /add xlr cable/i }));
  else fireEvent.click(await screen.findByRole("button", { name: /add laptop x1/i }));
}

describe("MovementForm: review before confirm", () => {
  it("shows the transaction summary before the Confirm button, and sends nothing until Confirm", async () => {
    const s = services();
    await fillIssue(s);
    expect(screen.queryByRole("button", { name: /confirm issue/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Check before you confirm")).toBeTruthy();
    const dl = screen.getByText("What").closest("dl")!;
    expect(within(dl).getByText(/Laptop X1 \(UAE-E-00042\)/)).toBeTruthy();
    expect(within(dl).getByText("Employee: Sara Ali")).toBeTruthy();
    expect(within(dl).getByText("Dubai warehouse")).toBeTruthy();
    for (const label of ["What", "How much", "From", "To", "Who"]) expect(within(dl).getByText(label)).toBeTruthy();
    expect(s.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirm issue/i })).toBeTruthy();
  });

  it("refuses to review an empty list and says why", async () => {
    render(<MovementForm kind="issue" services={services()} context={context} />);
    fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/choose the employee|at least one/i);
    expect(screen.queryByText("Check before you confirm")).toBeNull();
  });
});

describe("MovementForm: one request, one key", () => {
  it("a double click sends one request", async () => {
    let release!: () => void;
    const submit = vi.fn((_i: MovementInput) => new Promise<{ error: null; message: string }>((resolve) => { release = () => resolve({ error: null, message: "Recorded as MV-1." }); }));
    const s = services({ submit });
    await fillIssue(s);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const confirm = await screen.findByRole("button", { name: /confirm issue/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(submit).toHaveBeenCalledTimes(1);
    const sent = submit.mock.calls[0]![0];
    expect(sent.kind).toBe("issue");
    expect(sent.key).toMatch(/^issue-/);
    expect(sent.lines).toEqual([{ unit_id: "u1" }]);
    expect(sent.employeeId).toBe("e1");
    expect(sent.locationId).toBe("l1");
    await act(async () => { release(); });
    expect(await screen.findByText("Recorded as MV-1.")).toBeTruthy();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("shows success only after the server says so, and keeps the form when the server refuses", async () => {
    const submit = vi.fn(async () => ({ error: "Only 3 of Laptop X1 can be issued now: the rest is reserved." }));
    await fillIssue(services({ submit }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm issue/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/reserved/);
    expect(screen.queryByText("Recorded")).toBeNull();
    // still on the review step, with the summary and a way back
    expect(screen.getByText("Check before you confirm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /back to edit/i }));
    expect(screen.getByRole("list", { name: "On the list" })).toBeTruthy();
    expect(screen.getByText("Sara Ali")).toBeTruthy();
  });
});

describe("MovementForm: an uncertain failure", () => {
  it("offers the result check, does not clear the form, and retries with the SAME key", async () => {
    const submit = vi.fn(async (_i: MovementInput) => ({ error: "The save did not finish in time. Use “Check whether it went through” before trying again.", uncertain: true }));
    const check = vi.fn(async () => ({ error: null, state: "not_recorded" as const, text: "It was not recorded. Nothing changed, so it is safe to send it again." }));
    await fillIssue(services({ submit, check }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm issue/i }));
    const checkButton = await screen.findByRole("button", { name: /check whether it went through/i });
    const firstKey = submit.mock.calls[0]![0].key;
    // the entry is still there, and it cannot be changed while we do not know
    expect(screen.getByText(/Laptop X1 \(UAE-E-00042\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /back to edit/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(checkButton);
    expect(await screen.findByText(/safe to send it again/i)).toBeTruthy();
    expect(check).toHaveBeenCalledWith("c1", firstKey);
    fireEvent.click(screen.getByRole("button", { name: /try again with the same entry/i }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]![0].key).toBe(firstKey);
    expect(submit.mock.calls[1]![0].lines).toEqual(submit.mock.calls[0]![0].lines);
  });

  it("treats a lost connection (the call itself throws) as uncertain too", async () => {
    const submit = vi.fn(async () => { throw new Error("Failed to fetch"); });
    await fillIssue(services({ submit }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm issue/i }));
    expect(await screen.findByRole("button", { name: /check whether it went through/i })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/could not confirm/i);
  });

  it("when the check says it was recorded, it shows done and never offers to send again", async () => {
    const submit = vi.fn(async () => ({ error: "The save did not finish in time.", uncertain: true }));
    const check = vi.fn(async () => ({ error: null, state: "recorded" as const, text: "Yes, it went through: recorded as MV-9. Do not send it again." }));
    await fillIssue(services({ submit, check }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm issue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /check whether it went through/i }));
    expect(await screen.findByText(/recorded as MV-9/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again with the same entry/i })).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("MovementForm: scanning", () => {
  it("scanning the same unit twice lists it once and says so", async () => {
    const s = services();
    render(<MovementForm kind="issue" services={s} context={context} />);
    fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
    fireEvent.click(screen.getByRole("button", { name: /scan a label/i }));
    const typed = screen.getByLabelText(/type the code/i);
    fireEvent.change(typed, { target: { value: "UAE-E-00042" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    await waitFor(() => expect(screen.getByRole("list", { name: "On the list" }).children).toHaveLength(1));
    fireEvent.change(typed, { target: { value: "https://app.example.com/inventory/scan?c=UAE-E-00042" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(await screen.findByText(/UAE-E-00042 is already on the list/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "On the list" }).children).toHaveLength(1);
    expect(s.read).toHaveBeenCalledTimes(1);
  });

  it("two reads of one label in the same instant look it up once and list it once", async () => {
    const s = services();
    render(<MovementForm kind="issue" services={s} context={context} />);
    fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
    fireEvent.click(screen.getByRole("button", { name: /scan a label/i }));
    const typed = screen.getByLabelText(/type the code/i);
    const lookUp = screen.getByRole("button", { name: /look up/i });
    fireEvent.change(typed, { target: { value: "UAE-E-00042" } });
    fireEvent.click(lookUp);
    fireEvent.click(lookUp);
    await waitFor(() => expect(screen.getByRole("list", { name: "On the list" }).children).toHaveLength(1));
    expect(s.read).toHaveBeenCalledTimes(1);
  });

  it("a code that is not an Inventory label, or not found, adds nothing and says so", async () => {
    const s = services({ read: vi.fn(async () => ({ ok: false as const, message: "No equipment or stock with that code was found, or you do not have access to it." })) });
    render(<MovementForm kind="issue" services={s} context={context} />);
    fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
    fireEvent.click(screen.getByRole("button", { name: /scan a label/i }));
    fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(await screen.findByText(/not an Inventory label/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: "UAE-E-00777" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(await screen.findByText(/no equipment or stock with that code/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "On the list" })).toBeNull();
  });

  it("a unit that cannot be issued is refused in words and not added", async () => {
    const s = services({ read: vi.fn(async () => ({ ok: true as const, kind: "unit" as const, unitId: "u9", itemId: "i-laptop", code: "UAE-E-00099", candidate: heldLaptop })) });
    render(<MovementForm kind="issue" services={s} context={context} />);
    fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
    fireEvent.click(screen.getByRole("button", { name: /scan a label/i }));
    fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: "UAE-E-00099" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(await screen.findByText(/not on the shelf: with an employee/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "On the list" })).toBeNull();
  });
});

describe("MovementForm: counted stock", () => {
  it("a count line needs a typed quantity: adding it from a search or a scan never fills it in", async () => {
    const s = services();
    await fillIssue(s, { add: "cable" });
    const qty = screen.getByLabelText(/quantity of xlr cable/i) as HTMLInputElement;
    expect(qty.value).toBe("");
    expect(screen.getByText(/20 on the shelf/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent).join(" ")).toMatch(/type the quantity/i);
    expect(screen.queryByText("Check before you confirm")).toBeNull();
    expect(s.submit).not.toHaveBeenCalled();
    // typing more than the shelf holds is refused too
    fireEvent.change(qty, { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent).join(" ")).toMatch(/only 20/i);
    fireEvent.change(qty, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Check before you confirm")).toBeTruthy();
    expect(screen.getAllByText(/5 XLR cable/).length).toBeGreaterThan(0);
  });

  it("scanning a bin label adds the item and bin with an empty quantity", async () => {
    const s = services({ read: vi.fn(async () => ({ ok: true as const, kind: "stock" as const, itemId: "i-xlr", code: "UAE-S-00007", candidate: cable })) });
    render(<MovementForm kind="issue" services={s} context={context} />);
    fireEvent.change(screen.getByLabelText("Take from"), { target: { value: "l1" } });
    fireEvent.click(screen.getByRole("button", { name: /scan a label/i }));
    fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: "UAE-S-00007" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    const qty = (await screen.findByLabelText(/quantity of xlr cable/i)) as HTMLInputElement;
    expect(qty.value).toBe("");
    expect(screen.getByText(/type how many/i)).toBeTruthy();
  });
});

describe("MovementForm: returns", () => {
  it("defaults every returned line to Good (available now), holds anything else, and says what stays outstanding", async () => {
    const submit = vi.fn(async (_i: MovementInput) => ({ error: null, message: "Recorded as MV-5." }));
    const s = services({ submit, held: vi.fn(async () => ({ error: null, candidates: [heldLaptop, { ...heldLaptop, key: "unit-h2", unitId: "u10", code: "UAE-E-00100" }] })) });
    render(<MovementForm kind="return" services={s} context={context} />);
    fireEvent.change(screen.getByLabelText("Back into"), { target: { value: "l1" } });
    fireEvent.click(screen.getByLabelText("An employee"));
    fireEvent.change(screen.getByLabelText("Which employee?"), { target: { value: "sara" } });
    fireEvent.click(await screen.findByRole("button", { name: /Sara Ali/ }));
    fireEvent.click(await screen.findByRole("button", { name: /add laptop x1 uae-e-00099/i }));
    const cond = screen.getByLabelText("Condition") as HTMLSelectElement;
    expect(cond.value).toBe("good");
    expect(within(cond).getByRole("option", { name: /good: available now/i })).toBeTruthy();
    expect(within(cond).getByRole("option", { name: /damaged: held back/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("Check before you confirm")).toBeTruthy();
    expect(screen.getByText(/1 other item stays with the employee/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /confirm return/i }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0].lines).toEqual([{ unit_id: "u9", condition: "good" }]);
    expect(submit.mock.calls[0]![0].returnFrom).toBe("employee");
  });

  it("a damaged unit is shown as held back on the review step", async () => {
    const s = services();
    render(<MovementForm kind="return" services={s} context={context} initial={{ candidates: [heldLaptop], locationId: "l1", returnFrom: "employee", employee: { id: "e1", name: "Sara Ali" } }} />);
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "damaged" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText(/not in good condition/i)).toBeTruthy();
    expect(screen.getAllByText(/damaged, held back/i).length).toBeGreaterThan(0);
  });
});

describe("MovementForm: transfers", () => {
  it("says there is no other location to send to when the company has only one", () => {
    const only = { ...context, destinations: [context.destinations[0]!] };
    render(<MovementForm kind="transfer" services={services()} context={only} initial={{ candidates: [laptop], locationId: "l1" }} />);
    expect(screen.getByText(/no other location to send to yet/i)).toBeTruthy();
    expect(screen.queryByText(/not available at the destination/i)).toBeNull();
  });
  it("says the stock is in transit and not available at the destination", async () => {
    const s = services();
    render(<MovementForm kind="transfer" services={s} context={context} initial={{ candidates: [laptop], locationId: "l1" }} />);
    fireEvent.change(screen.getByLabelText("Send to"), { target: { value: "l2" } });
    expect(screen.getByText(/not available at the destination/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText(/Riyadh warehouse \(in transit: not available there until it is received\)/)).toBeTruthy();
  });
});
