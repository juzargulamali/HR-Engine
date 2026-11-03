/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateBase, type Candidate } from "@/lib/inventory/stock-candidates";
import type { MovementInput } from "@/lib/inventory/stock-movements";
import type { SendItem } from "@/lib/inventory/workspace";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }), usePathname: () => "/inventory/requests/r1", useSearchParams: () => new URLSearchParams() }));
const submit = vi.fn(async (_i: MovementInput) => ({ error: null as string | null, message: "Recorded as MV-000001.", result: {}, uncertain: false }));
vi.mock("../stock/movement-services-live", () => ({
  liveServices: {
    submit: (i: MovementInput) => submit(i),
    check: vi.fn(async () => ({ error: null, state: "not_recorded", text: "" })),
    search: vi.fn(), held: vi.fn(), read: vi.fn(), employees: vi.fn(),
  },
}));
import { ReceiveStep } from "./receive-step";
import { SendStep, type SendStepProps } from "./send-step";

beforeEach(() => { submit.mockClear(); refresh.mockClear(); submit.mockImplementation(async () => ({ error: null, message: "Recorded as MV-000001.", result: {}, uncertain: false })); });
afterEach(() => cleanup());

const projector: SendItem = { itemId: "i-pj", name: "Video projector", model: null, tracking: "individual", individual: true, uom: "each", scale: 0, units: [{ unitId: "u1", code: "PJ-0403", serial: null }, { unitId: "u2", code: "PJ-0404", serial: null }], countedToSend: 0, reserved: 4, sent: 2 };
const strips: SendItem = { itemId: "i-ps", name: "Power strip", model: null, tracking: "quantity", individual: false, uom: "each", scale: 0, units: [], countedToSend: 6, reserved: 10, sent: 4 };
const send = (over: Partial<SendStepProps> = {}) => (
  <SendStep requestId="r1" requestCode="REQ-0049" projectId="p1" projectName="Al Khail Roadshow" companyId="c1" items={[projector, strips]} sentCodes={["PJ-0401"]}
    locations={[{ id: "l1", name: "Dubai warehouse" }]} defaultLocationId="l1" expectedReturnLabel="23 Oct 2026, 18:00 GST" formContext={null} {...over} />
);

describe("Send out", () => {
  it("carries the project, request, warehouse and expected return forward and ticks nothing", () => {
    render(send());
    expect(screen.getByText(/Dubai warehouse/)).toBeTruthy();
    expect(screen.getByText(/Al Khail Roadshow/)).toBeTruthy();
    expect(screen.getByText(/23 Oct 2026, 18:00 GST/)).toBeTruthy();
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((c) => !c.checked)).toBe(true);
    expect((screen.getByLabelText(/counted quantity/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: /^Review/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it("a scan ticks a reserved unit; a code that is not reserved blocks the review; one already sent says so", async () => {
    render(send());
    const box = screen.getByLabelText(/scan or type a code/i);
    fireEvent.change(box, { target: { value: "pj-0403" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((screen.getByLabelText(/PJ-0403/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(box, { target: { value: "PJ-0401" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/PJ-0401 has already been sent/)).toBeTruthy();
    fireEvent.change(box, { target: { value: "WM-0099" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/WM-0099 is not reserved for this request/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect((await screen.findAllByRole("alert")).some((a) => /Take off what the system would refuse/.test(a.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("Check before you confirm")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("a partial dispatch warns, goes through the review, and sends only what was ticked, against the request", async () => {
    render(send());
    fireEvent.click(screen.getByLabelText(/PJ-0403/));
    fireEvent.change(screen.getByLabelText(/counted quantity/i), { target: { value: "2" } });
    expect(screen.getByText(/sending 1 of 2 reserved/)).toBeTruthy();
    expect(screen.getByText(/sending 2 of 6 reserved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect(await screen.findByText("Check before you confirm")).toBeTruthy();
    const dl = screen.getByText("What").closest("dl")!;
    expect(within(dl).getByText(/PJ-0403/)).toBeTruthy();
    expect(within(dl).getByText("Request")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm: send 3/i }));
    await screen.findByText("Recorded");
    const sent = submit.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: "dispatch", companyId: "c1", locationId: "l1", projectId: "p1", requestId: "r1" });
    expect(sent.lines).toEqual([{ unit_id: "u1" }, { item_id: "i-ps", qty: 2 }]);
    expect(sent.expectedReturnAt).toBeUndefined();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a request that can no longer be sent against says so instead of the form", () => {
    render(send({ blockedMessage: "This request is fulfilled, so equipment cannot be sent against it." }));
    expect(screen.getByText(/This request is fulfilled, so equipment cannot be sent against it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Review/ })).toBeNull();
  });

  it("the Recorded panel, with the note's PDF, survives the refresh that makes the request fulfilled (a dispatch that sent everything)", async () => {
    submit.mockImplementation(async () => ({ error: null, message: "Dispatched.", result: { project_id: "p1", note_id: "n1", note_no: "ENG-D-00001" }, uncertain: false }));
    const { rerender } = render(send());
    fireEvent.click(screen.getByLabelText(/PJ-0403/));
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm: send 1/i }));
    await screen.findByText("Recorded");
    // the page re-renders with the request fulfilled: the step is told it is blocked, and must keep showing what was just recorded
    rerender(send({ items: [], blockedMessage: "This request is fulfilled, so equipment cannot be sent against it." }));
    expect(screen.getByText("Recorded")).toBeTruthy();
    expect(screen.getAllByText("ENG-D-00001").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Download PDF/ }).getAttribute("href")).toBe("/projects/p1/equipment/notes/n1/pdf");
    expect(screen.queryByText(/cannot be sent against it/)).toBeNull();
  });

  it("more counted than reserved is refused before the review", () => {
    render(send());
    fireEvent.change(screen.getByLabelText(/counted quantity/i), { target: { value: "9" } });
    expect(screen.getByText(/9 counted, but only 6 are reserved and still to send/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect(screen.queryByText("Check before you confirm")).toBeNull();
  });

  it("a failed request keeps everything that was ticked", async () => {
    submit.mockImplementationOnce(async () => ({ error: "Not enough free stock", message: "", result: {}, uncertain: false }) as never);
    render(send());
    fireEvent.click(screen.getByLabelText(/PJ-0404/));
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm: send 1/i }));
    expect(await screen.findByText("Not enough free stock")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
    expect((screen.getByLabelText(/PJ-0404/) as HTMLInputElement).checked).toBe(true);
  });

  it("an unplanned dispatch is a separate, labelled exception that says it does not fulfil the request", () => {
    render(send());
    const box = screen.getByRole("region", { name: "Unplanned dispatch" });
    expect(box.textContent).toMatch(/does not fulfil this request/i);
    expect(box.textContent).toMatch(/not part of a request/i);
  });

  it("says plainly when nothing is reserved, and when everything has been sent", () => {
    const { rerender } = render(send({ items: [] }));
    expect(screen.getByText(/Nothing is reserved for this request yet/)).toBeTruthy();
    rerender(send({ items: [{ ...projector, units: [], sent: 4 }] }));
    expect(screen.getByText(/Everything reserved for this request has been sent/)).toBeTruthy();
  });
});

const unit = (id: string, code: string): Candidate => candidateBase({ key: `unit-${id}`, type: "unit", unitId: id, code, itemId: "i-led", itemName: "LED wall panel", custody: "project", condition: "good", projectId: "p1" });
const hdmi: Candidate = candidateBase({ key: "bal-hdmi", type: "counted", itemId: "i-hdmi", itemName: "HDMI cable", tracking: "quantity", qty: 8, custody: "project", condition: "good", projectId: "p1" });
const receive = (over: Partial<React.ComponentProps<typeof ReceiveStep>> = {}) => (
  <ReceiveStep companyId="c1" projectId="p1" projectName="Dubai Expo Pavilion" requestCode="REQ-0044" locations={[{ id: "l1", name: "Dubai warehouse" }]} defaultLocationId="l1"
    held={[unit("u7", "LED-0007"), unit("u8", "LED-0008"), hdmi]} heldError={null}
    totals={[
      { itemId: "i-led", name: "LED wall panel", individual: true, sent: 12, returned: 6, stillOut: 6, level: "request", note: null },
      { itemId: "i-hdmi", name: "HDMI cable", individual: false, sent: 16, returned: null, stillOut: 8, level: "project", note: "Counted stock comes back to the project, not to a request line." },
    ]}
    holders={{ u7: "this", u8: "other" }} {...over} />
);

describe("Receive back", () => {
  it("shows Sent / Returned / Still out, and never a guessed Returned for counted stock sent for several requests", () => {
    render(receive());
    const table = screen.getByRole("region", { name: "Sent, returned and still out" });
    expect(within(table).getByText("Project level")).toBeTruthy();
    expect(within(table).getByLabelText("Not shown for this request")).toBeTruthy();
    expect(within(table).getByText(/Counted stock comes back to the project, not to a request line/)).toBeTruthy();
  });

  it("starts from what the project holds, ticks nothing, and says whose request each unit belongs to", () => {
    render(receive());
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((c) => !c.checked)).toBe(true);
    expect(screen.getByText(/This request/)).toBeTruthy();
    expect(screen.getByText(/Another request/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Review/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires a condition for everything received, shows what becomes available, and sends a partial return against the project", async () => {
    render(receive());
    fireEvent.click(screen.getByLabelText(/LED wall panel · LED-0007/));
    fireEvent.change(screen.getByLabelText(/How many HDMI cable came back/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose a condition/);
    fireEvent.change(screen.getByLabelText(/Condition of LED wall panel · LED-0007/), { target: { value: "good" } });
    fireEvent.change(screen.getByLabelText(/Condition of HDMI cable/), { target: { value: "damaged" } });
    expect(screen.getByText("Available again")).toBeTruthy();
    expect(screen.getByText("Held, not available")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect(await screen.findByText("Check before you confirm")).toBeTruthy();
    expect(screen.getByText(/items stay with the project/)).toBeTruthy();
    expect(screen.getByText(/held for checking/)).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm: record returns/i }));
    await screen.findByText("Recorded");
    const sent = submit.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: "return", returnFrom: "project", projectId: "p1", locationId: "l1" });
    expect(sent.requestId).toBeUndefined();
    expect(sent.lines).toEqual([{ unit_id: "u7", condition: "good" }, { item_id: "i-hdmi", qty: 5, condition: "damaged" }]);
  });

  it("sets one condition for the ticked lines only, starting empty, and never touches an unticked line", () => {
    render(receive({ holders: { u7: "this", u8: "this" } }));
    const helper = () => screen.getByRole("combobox", { name: /Set the condition for all ticked lines/ }) as HTMLSelectElement;
    const apply = () => screen.getByRole("button", { name: /^Apply to \d+ ticked lines?$/ }) as HTMLButtonElement;
    expect(helper().value).toBe("");
    expect(helper().disabled).toBe(true); // nothing ticked: nothing to set
    fireEvent.click(screen.getByLabelText("LED wall panel · LED-0007"));
    fireEvent.click(screen.getByLabelText("LED wall panel · LED-0008"));
    fireEvent.change(screen.getByLabelText(/How many HDMI cable came back/), { target: { value: "2" } });
    expect(helper().value).toBe(""); // ticking never selects a condition for you
    expect(apply().disabled).toBe(true);
    fireEvent.change(helper(), { target: { value: "damaged" } });
    expect(apply().textContent).toBe("Apply to 3 ticked lines");
    fireEvent.click(apply());
    expect((screen.getByLabelText(/Condition of LED wall panel · LED-0007/) as HTMLSelectElement).value).toBe("damaged");
    expect((screen.getByLabelText(/Condition of LED wall panel · LED-0008/) as HTMLSelectElement).value).toBe("damaged");
    expect((screen.getByLabelText(/Condition of HDMI cable/) as HTMLSelectElement).value).toBe("damaged");
    expect(helper().value).toBe("");
    // untick one: it keeps its condition for when it is ticked again, but the helper only counts what is ticked now
    fireEvent.click(screen.getByLabelText("LED wall panel · LED-0008"));
    fireEvent.change(helper(), { target: { value: "good" } });
    expect(apply().textContent).toBe("Apply to 2 ticked lines");
    fireEvent.click(apply());
    expect((screen.getByLabelText(/Condition of LED wall panel · LED-0007/) as HTMLSelectElement).value).toBe("good");
    expect((screen.getByLabelText(/Condition of HDMI cable/) as HTMLSelectElement).value).toBe("good");
    fireEvent.click(screen.getByLabelText("LED wall panel · LED-0008"));
    expect((screen.getByLabelText(/Condition of LED wall panel · LED-0008/) as HTMLSelectElement).value).toBe("damaged");
  });

  it("offers Tick all N for several units of one item, and a line without a condition still blocks Review", async () => {
    render(receive({ holders: { u7: "this", u8: "this" } }));
    fireEvent.click(screen.getByRole("button", { name: /Tick all 2/ }));
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).filter((c) => c.checked)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Untick all 2/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Choose a condition/);
    expect(submit).not.toHaveBeenCalled();
  });

  it("says when what the project holds could not be loaded, rather than showing an empty list", () => {
    render(receive({ held: [], heldError: "It could not be read." }));
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded.*not an empty list/s);
  });

  it("says everything is back when the project holds nothing", () => {
    render(receive({ held: [] }));
    expect(screen.getByText(/holds nothing that is recorded as dispatched to it/)).toBeTruthy();
  });
});
