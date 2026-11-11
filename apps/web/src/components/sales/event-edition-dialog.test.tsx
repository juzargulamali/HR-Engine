/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/sales", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));
const createOpportunity = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ checkDuplicates: vi.fn(async () => ({ matches: [] })), createOpportunity: (...a: unknown[]) => createOpportunity(...a), updateOpportunity: vi.fn(), loadInquiryOrganisations: vi.fn() }));
const saveEventEdition = vi.fn();
vi.mock("@/lib/actions/events", () => ({ saveEventEdition: (...a: unknown[]) => saveEventEdition(...a) }));

import { EventEditionDialog } from "./event-edition-dialog";
import { QuickAddEnquiryForm } from "./quick-add-enquiry-form";

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

afterEach(() => { cleanup(); saveEventEdition.mockReset(); createOpportunity.mockReset(); });

// Fictional data only.
const EVENTS = [{ id: "ev-expo", name: "Fictional Expo Global", editions: 2 }, { id: "ev-empty", name: "Fictional Summit", editions: 0 }];
const posted = (call: number) => Object.fromEntries((saveEventEdition.mock.calls[call]![1] as FormData).entries());
const set = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the event and edition form", () => {
  it("adds a new event with its first edition in ONE save and hands back both ids and the picker label", async () => {
    saveEventEdition.mockResolvedValue({ error: null, id: "ev-new", editionId: "ed-new" });
    const onCreated = vi.fn(); const onClose = vi.fn();
    render(<EventEditionDialog open onClose={onClose} events={EVENTS} initial={{ name: "Fictional Tech Week", start: "2027-03-30", end: "2027-04-02" }} onCreated={onCreated} />);
    // Prefilled from where it was opened.
    expect((screen.getByLabelText("Event name") as HTMLInputElement).value).toBe("Fictional Tech Week");
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe("2027-03-30");
    expect((screen.getByLabelText("Ends") as HTMLInputElement).value).toBe("2027-04-02");
    set("City", "Riyadh"); set("Venue", "Fictional Hall");
    fireEvent.click(screen.getByRole("button", { name: "Add event and first edition" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(saveEventEdition).toHaveBeenCalledTimes(1);
    expect(posted(0)).toMatchObject({ name: "Fictional Tech Week", kind: "exhibition", start: "2027-03-30", end: "2027-04-02", city: "Riyadh", venue: "Fictional Hall" });
    expect(posted(0).eventId).toBeUndefined();
    expect(onCreated).toHaveBeenCalledWith({ eventId: "ev-new", eventName: "Fictional Tech Week", newEvent: true, editionId: "ed-new", label: "Fictional Tech Week · 2027 · Riyadh", detail: "Fictional Hall · 2027-03-30" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the matching event when the name already exists and adds the edition to it instead", async () => {
    saveEventEdition.mockResolvedValue({ error: null, id: "ev-expo", editionId: "ed-28" });
    const onCreated = vi.fn();
    render(<EventEditionDialog open onClose={() => undefined} events={EVENTS} initial={{ name: " fictional EXPO-global " }} onCreated={onCreated} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toMatch(/Fictional Expo Global is already in Events & Exhibitions \(2 editions\)/);
    fireEvent.click(within(notice).getByRole("button", { name: "Add an edition to Fictional Expo Global" }));
    expect((screen.getByLabelText("Event") as HTMLSelectElement).value).toBe("ev-expo");
    expect(screen.queryByLabelText("Event name")).toBeNull();
    set("Starts", "2028-10-09"); set("Ends", "2028-10-13");
    fireEvent.click(screen.getByRole("button", { name: "Add next edition" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(posted(0)).toMatchObject({ eventId: "ev-expo", start: "2028-10-09", end: "2028-10-13" });
    expect(posted(0).name).toBeUndefined();
    expect(onCreated.mock.calls[0]![0]).toMatchObject({ eventId: "ev-expo", newEvent: false, editionId: "ed-28", label: "Fictional Expo Global · 2028" });
  });

  it("says Add first edition for an event with none, and keeps what was typed when the save is refused", async () => {
    saveEventEdition.mockResolvedValue({ error: "That event already has an edition starting on that date" });
    const onCreated = vi.fn(); const onClose = vi.fn();
    render(<EventEditionDialog open onClose={onClose} events={EVENTS} initial={{ eventId: "ev-empty", start: "2027-05-04", end: "2027-05-05" }} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole("button", { name: "Add first edition" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/already has an edition/);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe("2027-05-04");
  });
});

describe("Create event or edition from Quick Add", () => {
  const props = {
    companies: [{ id: "co", name: "Fictional Co", currency: "AED", hasSettings: true, canAssignOwner: false, canOpenSettings: false, people: [] }],
    organisations: [{ id: "client", name: "Fictional Client Only", kind: "client", roles: ["client"], place: null }],
    editions: [{ id: "g27", label: "Fictional Expo Global · 2027 · Dubai", detail: "2027-10-11", archived: false }],
    events: EVENTS, currentUserId: "u1", currentUserName: "Fictional Person", today: "2026-11-11",
  };
  const openForm = () => {
    render(<QuickAddEnquiryForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Add enquiry/ }));
    set("What is the enquiry?", "Fictional LED tunnel");
    set("Next action", "Call to qualify");
    set("Event start", "2027-03-30"); set("Event end", "2027-04-02");
    set("Brief", "A fictional brief that must survive.");
    const field = screen.getByRole("combobox", { name: /Event \/ Exhibition/ });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Fictional Tech Week" } });
    expect(screen.getByText(/Nothing matches “Fictional Tech Week”\. Use Create event or edition below/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create event or edition" }));
  };
  const draft = () => ({
    title: (screen.getByLabelText("What is the enquiry?") as HTMLInputElement).value, next: (screen.getByLabelText("Next action") as HTMLInputElement).value,
    start: (screen.getByLabelText("Event start") as HTMLInputElement).value, end: (screen.getByLabelText("Event end") as HTMLInputElement).value,
    brief: (screen.getByLabelText("Brief") as HTMLTextAreaElement).value,
  });
  const DRAFT = { title: "Fictional LED tunnel", next: "Call to qualify", start: "2027-03-30", end: "2027-04-02", brief: "A fictional brief that must survive." };
  const edition = () => (document.querySelector('input[name="eventEditionId"]') as HTMLInputElement).value;

  it("prefills the name and dates, saves the event on its own, keeps every field of the draft and selects the new edition; the enquiry is not saved", async () => {
    saveEventEdition.mockResolvedValue({ error: null, id: "ev-new", editionId: "ed-new" });
    openForm();
    expect((screen.getByLabelText("Event name") as HTMLInputElement).value).toBe("Fictional Tech Week");
    expect((screen.getByLabelText("Starts") as HTMLInputElement).value).toBe("2027-03-30");
    expect((screen.getByLabelText("Ends") as HTMLInputElement).value).toBe("2027-04-02");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add event and first edition" })); });
    await waitFor(() => expect(edition()).toBe("ed-new"));
    expect(screen.queryByLabelText("Event name")).toBeNull();
    expect((screen.getByRole("combobox", { name: /Event \/ Exhibition/ }) as HTMLInputElement).value).toBe("Fictional Tech Week · 2027");
    expect(draft()).toEqual(DRAFT);
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("cancelling, or a refused save, leaves the draft as it was and links nothing", async () => {
    saveEventEdition.mockResolvedValue({ error: "An event with that name already exists. Open it and add the next edition instead." });
    openForm();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add event and first edition" })); });
    expect((await screen.findByRole("alert")).textContent).toMatch(/already exists/);
    expect(draft()).toEqual(DRAFT);
    expect(edition()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Event name")).toBeNull();
    expect(draft()).toEqual(DRAFT);
    expect(edition()).toBe("");
    expect(createOpportunity).not.toHaveBeenCalled();
  });
});
