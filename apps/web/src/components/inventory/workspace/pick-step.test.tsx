/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickInput, SendItem } from "@/lib/inventory/workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/requests/r1", useSearchParams: () => new URLSearchParams() }));
type Outcome = { error: string | null; message?: string; result?: unknown; uncertain?: boolean };
const recordPick = vi.fn(async (_i: PickInput): Promise<Outcome> => ({ error: null, message: "Picked. 2 are picked and waiting to be sent. Next: the warehouse sends the equipment.", result: {} }));
const checkTransaction = vi.fn(async (): Promise<{ error: string | null; state?: string; text?: string }> => ({ error: null, state: "not_recorded", text: "It was not recorded. Nothing changed, so it is safe to send it again." }));
vi.mock("@/lib/actions/inventoryStock", () => ({ recordPick: (i: PickInput) => recordPick(i), checkTransaction: () => checkTransaction() }));

import { PickStep, type PickStepProps } from "./pick-step";

beforeEach(() => { recordPick.mockClear(); checkTransaction.mockClear(); refresh.mockClear(); });
afterEach(() => cleanup());

const panel: SendItem = { itemId: "i-p", name: "LED panel", model: null, tracking: "individual", individual: true, uom: "each", scale: 0, countedToSend: 0, reserved: 3, sent: 0, asked: 4, pickedWaiting: 1,
  units: [{ unitId: "u1", code: "UAE-E-00001", serial: null, picked: true }, { unitId: "u2", code: "UAE-E-00002", serial: null, picked: false }, { unitId: "u3", code: "UAE-E-00003", serial: null, picked: false }] };
const cable: SendItem = { itemId: "i-c", name: "Power cable", model: null, tracking: "quantity", individual: false, uom: "each", scale: 0, units: [], countedToSend: 8, reserved: 8, sent: 0, asked: 8, pickedWaiting: 0 };
const truss: SendItem = { itemId: "i-t", name: "Truss", model: null, tracking: "quantity", individual: false, uom: "each", scale: 0, units: [], countedToSend: 0, reserved: 0, sent: 0, asked: 6, pickedWaiting: 0 };
const pick = (over: Partial<PickStepProps> = {}) => (
  <PickStep requestId="r1" requestCode="UAE-R-00009" projectName="Fictional Roadshow" companyId="c1" items={[panel, cable, truss]} sentCodes={["UAE-E-00009"]}
    locations={[{ id: "l1", name: "Dubai warehouse" }]} defaultLocationId="l1" unitBins={{ u1: "A-01", u2: "A-02" }} itemBins={{ "i-c": ["C-07"] }} leavesLabel="19 Oct 2026, 10:00"
    sendHref="/inventory/requests/r1?step=send" prepareHref="/inventory/requests/r1?step=prepare" {...over} />
);

describe("Pick", () => {
  it("lists what is reserved with its bin and the four quantities; what is already picked is ticked, nothing else; a short line says how many", () => {
    render(pick());
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false]);
    expect(screen.getByText("Bin A-01")).toBeTruthy();
    expect(screen.getByText("No bin recorded")).toBeTruthy();
    expect(screen.getByText("Bin C-07")).toBeTruthy();
    const led = document.querySelector('[data-item="LED panel"]')!;
    expect([...led.querySelectorAll("[data-qty] dd")].map((d) => d.textContent)).toEqual(["4", "3", "1", "0"]);
    expect(led.textContent).toMatch(/Short: 1 of 4 not reserved/);
    // nothing reserved for the truss: it is seen here, and says what to do about it
    expect(document.querySelector('[data-item="Truss"]')!.textContent).toMatch(/Short: 6 of 6 not reserved/);
    // one primary action, disabled until something changes
    expect((screen.getByRole("button", { name: "Pick items" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a scan ticks a reserved unit; a wrong code and a repeated scan are said beside the scan box and never added", () => {
    render(pick());
    const box = screen.getByLabelText(/scan or type a code/i);
    const add = () => fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    fireEvent.change(box, { target: { value: "uae-e-00002" } }); add();
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).map((b) => b.checked)).toEqual([true, true, false]);
    fireEvent.change(box, { target: { value: "UAE-E-00002" } }); add();
    expect(document.querySelector('[data-scan="warn"]')!.textContent).toMatch(/Already scanned: UAE-E-00002 is already on the list/);
    fireEvent.change(box, { target: { value: "UAE-E-00777" } }); add();
    expect(document.querySelector('[data-scan="bad"]')!.textContent).toMatch(/Wrong item: UAE-E-00777 is not reserved for this request/);
    fireEvent.change(box, { target: { value: "UAE-E-00009" } }); add();
    expect(document.querySelector('[data-scan="warn"]')!.textContent).toMatch(/already been sent/);
    // the wrong code blocks the save until it is taken off
    fireEvent.click(screen.getByRole("button", { name: "Pick items" }));
    expect(recordPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Take UAE-E-00777 off the list/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pick items" }));
    expect(recordPick).toHaveBeenCalledTimes(1);
  });

  it("sends only what changed, says the effect of saving beside the button, then what posted and who acts next", async () => {
    render(pick());
    fireEvent.click((screen.getAllByRole("checkbox") as HTMLInputElement[])[1]!);
    fireEvent.change(screen.getByLabelText("Picked"), { target: { value: "5" } });
    expect(screen.getByTestId("pick-action").textContent).toMatch(/Saving records 7 as picked for this request and leaves 4 reserved on the shelf\. Nothing leaves the warehouse\./);
    fireEvent.click(screen.getByRole("button", { name: "Pick items" }));
    await waitFor(() => expect(recordPick).toHaveBeenCalledTimes(1));
    const sent = recordPick.mock.calls[0]![0];
    expect(sent).toMatchObject({ companyId: "c1", locationId: "l1", requestId: "r1" });
    expect(sent.key).toMatch(/^pick-/);
    // the unit that was already picked is not sent again
    expect(sent.lines).toEqual([{ unit_id: "u2", picked: true }, { item_id: "i-c", qty: 5 }]);
    expect(await screen.findByText(/2 are picked and waiting to be sent/)).toBeTruthy();
    expect(screen.getByText(/Nothing has left the warehouse yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send equipment" }).getAttribute("href")).toBe("/inventory/requests/r1?step=send");
    expect(refresh).toHaveBeenCalled();
  });

  it("unticking what was picked puts it back", async () => {
    render(pick());
    fireEvent.click((screen.getAllByRole("checkbox") as HTMLInputElement[])[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Pick items" }));
    await waitFor(() => expect(recordPick).toHaveBeenCalledTimes(1));
    expect(recordPick.mock.calls[0]![0].lines).toEqual([{ unit_id: "u1", picked: false }]);
  });

  it("after a save whose result is not known the list is kept, and it is checked before anything is sent again", async () => {
    recordPick.mockImplementationOnce(async () => ({ error: "The save did not finish in time. Use “Check whether it went through” before trying again: the same entry cannot be recorded twice.", uncertain: true }));
    render(pick());
    fireEvent.click((screen.getAllByRole("checkbox") as HTMLInputElement[])[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Pick items" }));
    expect(await screen.findByText(/We do not know whether this pick was recorded/)).toBeTruthy();
    // the working list is exactly as it was, and the main button does not send blindly
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).map((b) => b.checked)).toEqual([true, true, false]);
    expect((screen.getByRole("button", { name: /Check first, then try again/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Send it again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check whether it went through" }));
    expect(await screen.findByText(/It was not recorded/)).toBeTruthy();
    const firstKey = recordPick.mock.calls[0]![0].key;
    fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    await waitFor(() => expect(recordPick).toHaveBeenCalledTimes(2));
    // the same entry with the same key: it can never be recorded twice
    expect(recordPick.mock.calls[1]![0].key).toBe(firstKey);
    expect(recordPick.mock.calls[1]![0].lines).toEqual([{ unit_id: "u2", picked: true }]);
  });

  it("when the check says it did go through, it is shown as done and nothing is sent again", async () => {
    recordPick.mockImplementationOnce(async () => ({ error: "The save did not finish in time.", uncertain: true }));
    checkTransaction.mockImplementationOnce(async () => ({ error: null, state: "recorded", text: "Yes, it went through. Do not send it again." }));
    render(pick());
    fireEvent.click((screen.getAllByRole("checkbox") as HTMLInputElement[])[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Pick items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check whether it went through" }));
    expect(await screen.findByText(/Yes, it went through/)).toBeTruthy();
    expect(recordPick).toHaveBeenCalledTimes(1);
  });

  it("says why nothing can be picked instead of the form, and when nothing is reserved", () => {
    const { unmount } = render(pick({ blockedMessage: "This request is fulfilled, so nothing can be picked for it." }));
    expect(screen.getByText(/fulfilled, so nothing can be picked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pick items" })).toBeNull();
    unmount();
    render(pick({ items: [truss] }));
    expect(screen.getByText(/Nothing is reserved for this request yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Reserve equipment under Prepare/ })).toBeTruthy();
  });
});
