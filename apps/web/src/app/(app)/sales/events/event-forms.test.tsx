// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

/** Add edition / Add first edition / Add next edition: distinct words, what each does, and where the person lands afterwards. Fictional data only. */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn() }) }));
const saveEdition = vi.fn();
vi.mock("@/lib/actions/events", () => ({ archiveEdition: vi.fn(), archiveEvent: vi.fn(), saveEdition: (...a: unknown[]) => saveEdition(...a), saveEvent: vi.fn(), saveEventEdition: vi.fn() }));
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

import { EditionButton, EVENT_WORDS } from "./event-forms";

const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { push.mockReset(); saveEdition.mockReset(); });
afterEach(() => cleanup());

describe("adding an edition", () => {
  it("Add edition (from the list) asks which event, says what it does, and opens that event with the new edition and the same company", async () => {
    saveEdition.mockResolvedValue({ error: null, id: "new-edition" });
    render(<EditionButton events={[{ id: EVENT, name: "Fictional Expo" }]} label="Add edition" keep={`company=${COMPANY}`} />);
    fireEvent.click(screen.getByRole("button", { name: "Add edition" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Adds one dated occurrence to an event that already exists. Earlier editions keep their dates.");
    fireEvent.change(within(dlg).getByLabelText("Event"), { target: { value: EVENT } });
    fireEvent.change(within(dlg).getByLabelText("Starts"), { target: { value: "2099-03-01" } });
    fireEvent.change(within(dlg).getByLabelText("Ends"), { target: { value: "2099-03-04" } });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Add edition" })); });
    const sent = saveEdition.mock.calls[0]![1] as FormData;
    expect(sent.get("eventId")).toBe(EVENT);
    expect(sent.get("start")).toBe("2099-03-01");
    expect(push).toHaveBeenCalledWith(`/sales/events/${EVENT}?edition=new-edition&company=${COMPANY}`);
  });

  it("Add first edition says it is the first occurrence and starts empty", () => {
    render(<EditionButton eventId={EVENT} eventName="Fictional Expo" label="Add first edition" />);
    fireEvent.click(screen.getByRole("button", { name: "Add first edition" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Adds the first dated occurrence of Fictional Expo.");
    expect((within(dlg).getByLabelText("City") as HTMLInputElement).value).toBe("");
    expect(within(dlg).queryByLabelText("Event")).toBeNull();
  });

  it("a refused edition (same event, same start date) is shown in the database's own words and nothing typed is lost", async () => {
    saveEdition.mockResolvedValue({ error: "That event already has an edition starting on that date" });
    render(<EditionButton eventId={EVENT} eventName="Fictional Expo" label="Add next edition" prefill={{ city: "Dubai", country: "AE", venue: "Fictional Hall", from: "Fictional Expo · 2098 · Dubai" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add next edition" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Starts"), { target: { value: "2099-03-01" } });
    fireEvent.change(within(dlg).getByLabelText("Ends"), { target: { value: "2099-03-04" } });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Add next edition" })); });
    expect((await within(dlg).findByRole("alert")).textContent).toBe("That event already has an edition starting on that date");
    expect((within(dlg).getByLabelText("Starts") as HTMLInputElement).value).toBe("2099-03-01");
    expect((within(dlg).getByLabelText("Venue") as HTMLInputElement).value).toBe("Fictional Hall");
    expect(push).not.toHaveBeenCalled();
  });

  it("defines event, edition and next edition in one place", () => {
    expect(EVENT_WORDS.event).toContain("recurring show");
    expect(EVENT_WORDS.edition).toContain("one dated occurrence");
    expect(EVENT_WORDS.next).toContain("following occurrence");
  });
});
