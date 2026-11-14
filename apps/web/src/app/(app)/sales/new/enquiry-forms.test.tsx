/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const push = vi.fn();
let address = "view=week&add=1";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/follow-ups", useSearchParams: () => new URLSearchParams(address) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));
const createOpportunity = vi.fn();
const createOrganisation = vi.fn();
vi.mock("@/lib/actions/crm", () => ({
  checkDuplicates: vi.fn(async () => []), createOpportunity: (...a: unknown[]) => createOpportunity(...a), createOrganisation: (...a: unknown[]) => createOrganisation(...a),
  createContact: vi.fn(), findSimilarOrganisations: vi.fn(async () => []), updateOpportunity: vi.fn(), loadInquiryOrganisations: vi.fn(),
}));
vi.mock("@/lib/actions/events", () => ({ saveEventEdition: vi.fn() }));

import { NewEnquiryForm, type EnquiryCompany, type EnquiryOrganisation } from "./new-enquiry-form";
import { QuickAddEnquiryForm } from "@/components/sales/quick-add-enquiry-form";
import { CARRY_KEY, EMPTY_PREFILL, type EnquiryPrefill } from "./enquiry-form-shared";

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };

const UAE = "11111111-1111-4111-8111-111111111111";
const EUROPE = "22222222-2222-4222-8222-222222222222";
const UNSET = "55555555-5555-4555-8555-555555555555";
const company = (id: string, name: string, currency: string | null): EnquiryCompany => ({ id, name, currency, hasSettings: currency !== null, canAssignOwner: false, canOpenSettings: false, people: [] });
// Europe sorts first by name: the forms used to start on it.
const companies = [company(EUROPE, "Fictional Europe", "EUR"), company(UAE, "Fictional UAE", "AED"), company(UNSET, "Fictional Unset Co", null)];
const organisations: EnquiryOrganisation[] = [{ id: "ag", name: "Fictional Agency", kind: "agency", roles: ["agency"], place: null }, { id: "cl", name: "Fictional Client", kind: "client", roles: ["client"], place: null }];
const common = { companies, organisations, currentUserId: "me", currentUserName: "Fictional Me", today: "2026-11-14" };
const full = (activeCompany: { id: string | null; from: "context" | "remembered" | "home" | "choose" }, prefill: Partial<EnquiryPrefill> | null = null, ignored: string[] = []) =>
  render(<NewEnquiryForm {...common} contacts={[]} activeCompany={activeCompany} prefill={prefill ? { ...EMPTY_PREFILL, ...prefill } : null} prefillIgnored={ignored} />);
const quick = (activeCompany: { id: string | null; from: "context" | "remembered" | "home" | "choose" }) => {
  // The address carries ?add=1, so the dialog is already open.
  render(<QuickAddEnquiryForm {...common} activeCompany={activeCompany} />);
};
const field = <T extends HTMLElement = HTMLInputElement>(label: string | RegExp) => screen.getByLabelText(label) as T;
const set = (label: string | RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const saveButton = () => screen.getAllByRole("button", { name: /^(Record enquiry|Add enquiry)$/ }).find((b) => (b as HTMLButtonElement).type === "submit") as HTMLButtonElement;
const savingTo = () => (screen.getByTestId("enquiry-saving-to").textContent ?? "").replace(/\s+/g, " ").trim();
const choose = (label: string, text: string) => { const el = screen.getByRole("combobox", { name: new RegExp(`^${label}`) }); fireEvent.focus(el); fireEvent.change(el, { target: { value: text } }); fireEvent.click(within(screen.getByRole("listbox", { name: new RegExp(`^${label}.*matches`) })).getAllByRole("option")[0]!); };

beforeEach(() => { address = "view=week&add=1"; sessionStorage.clear(); });
afterEach(() => { cleanup(); createOpportunity.mockReset(); createOrganisation.mockReset(); push.mockReset(); });

describe.each([["the full form", full], ["Quick Add", quick]] as const)("%s: company and currency", (_name, show) => {
  it("starts in the active company (context, remembered or home), never the first by name, and says company and currency together before Save", () => {
    for (const from of ["context", "remembered", "home"] as const) {
      show({ id: UAE, from });
      expect(field<HTMLSelectElement>("Company").value).toBe(UAE);
      expect(savingTo()).toContain("Saving to Fictional UAE in AED.");
      expect(savingTo()).toContain("this company's default");
      cleanup();
    }
  });
  it("with no reliable default NOTHING is preselected: it asks, the rest is locked and it cannot be saved until a company is chosen", () => {
    show({ id: null, from: "choose" });
    expect(field<HTMLSelectElement>("Company").value).toBe("");
    expect(screen.getByText(/Choose the company first/)).toBeTruthy();
    expect(savingTo()).toBe("Choose a company before saving.");
    expect((screen.getByRole("group", { name: "Enquiry details" }) as HTMLFieldSetElement).disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    set("Company", UAE);
    expect((screen.getByRole("group", { name: "Enquiry details" }) as HTMLFieldSetElement).disabled).toBe(false);
    expect(savingTo()).toContain("Saving to Fictional UAE in AED.");
    expect(screen.queryByText(/Choose the company first/)).toBeNull();
  });
  it("an untouched currency follows the company; a currency the person chose is kept when the company changes, and can be handed back to the default", () => {
    show({ id: UAE, from: "remembered" });
    expect(field("Currency").value).toBe("AED");
    set("Company", EUROPE);
    expect(field("Currency").value).toBe("EUR");
    expect(screen.getByTestId("enquiry-currency-note").textContent).toContain("EUR is Fictional Europe's default currency");
    expect(savingTo()).toContain("Saving to Fictional Europe in EUR.");
    set("Currency", "usd");
    expect(savingTo()).toContain("Saving to Fictional Europe in USD.");
    set("Company", UAE);
    expect(field("Currency").value).toBe("USD");
    expect(savingTo()).toContain("Saving to Fictional UAE in USD.");
    expect(savingTo()).toContain("your own choice");
    expect(screen.getByTestId("enquiry-currency-note").textContent).toContain("You chose USD. It stays USD if you change the company.");
    fireEvent.click(screen.getByRole("button", { name: /Use AED/ }));
    expect(field("Currency").value).toBe("AED");
    expect(savingTo()).toContain("this company's default");
  });
  it("a company without Sales settings keeps its blocking message and cannot be saved to", () => {
    show({ id: UNSET, from: "context" });
    expect(screen.getByText(/has no Sales settings yet/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });
});

describe("the full form", () => {
  const fill = () => { set("What is the enquiry?", "Fictional LED tunnel"); set("Where did it come from?", "website"); choose("End client", "Fictional"); set("Next action", "Call the fictional client"); };
  it("prefill from the address fills the fields; an outreach shows the review note and is posted for linking", () => {
    full({ id: UAE, from: "context" }, { companyId: UAE, title: "Fictional stand", clientId: "cl", source: "agency_call", brief: "From the outreach", nextTitle: "Send options", nextDate: "2026-11-20", currency: "USD", outreachId: "77777777-7777-4777-8777-777777777777" }, ["contact"]);
    expect(screen.getByTestId("enquiry-carried-over").textContent).toContain("Carried over from outreach: check before saving.");
    expect(screen.getByText(/Part of the link could not be used/).textContent).toContain("contact");
    expect(field("What is the enquiry?").value).toBe("Fictional stand");
    expect(field<HTMLSelectElement>("Where did it come from?").value).toBe("agency_call");
    expect(field("Brief").value).toBe("From the outreach");
    expect(field("Next action").value).toBe("Send options");
    expect(field("Date").value).toBe("2026-11-20");
    expect((document.querySelector('input[name="clientOrgId"]') as HTMLInputElement).value).toBe("cl");
    expect((document.querySelector('input[name="outreachId"]') as HTMLInputElement).value).toBe("77777777-7777-4777-8777-777777777777");
    expect(savingTo()).toContain("Saving to Fictional UAE in USD.");         // a currency in the link is the person's choice
    expect(screen.queryByText("Carried over: check before saving.")).toBeNull();
  });
  it("with nothing carried over there is no review note", () => {
    full({ id: UAE, from: "home" }, { returnTo: "/sales/follow-ups?view=week" });
    expect(screen.queryByTestId("enquiry-carried-over")).toBeNull();
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/sales/follow-ups?view=week");
  });
  it("Cancel without a return address goes to the Enquiries list", () => {
    full({ id: UAE, from: "home" });
    expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toBe("/sales/opportunities");
  });
  it("the long brief and technologies typed in Quick Add are read once from this browser tab", async () => {
    sessionStorage.setItem(CARRY_KEY, JSON.stringify({ token: "abc123", brief: "A long fictional brief", technologies: [{ name: "LED wall", qty: 2 }] }));
    full({ id: UAE, from: "context" }, { companyId: UAE, carry: "abc123" });
    await waitFor(() => expect(field("Brief").value).toBe("A long fictional brief"));
    expect(field("Technology 1").value).toBe("LED wall");
    expect(field("Quantity of technology 1").value).toBe("2");
    expect(sessionStorage.getItem(CARRY_KEY)).toBeNull();
  });
  it("a double click sends the enquiry once; a refused save keeps what was typed and can be sent again", async () => {
    let answer: (v: { error: string | null }) => void = () => undefined;
    createOpportunity.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    full({ id: UAE, from: "remembered" });
    fill();
    const form = screen.getByRole("button", { name: "Record enquiry" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(createOpportunity).toHaveBeenCalledTimes(1));
    const sent = createOpportunity.mock.calls[0]![1] as FormData;
    expect(sent.get("companyId")).toBe(UAE);
    expect(sent.get("currency")).toBe("AED");
    await act(async () => { answer({ error: "Sales did not answer." }); });
    await waitFor(() => expect(screen.getByText(/Sales did not answer\. Nothing was saved/)).toBeTruthy());
    expect(field("What is the enquiry?").value).toBe("Fictional LED tunnel");
    expect(field("Next action").value).toBe("Call the fictional client");
    expect(field<HTMLSelectElement>("Where did it come from?").value).toBe("website");
    fireEvent.submit(form);
    await waitFor(() => expect(createOpportunity).toHaveBeenCalledTimes(2));     // the retry is one more send, not two
  });
  it("without an agency or end client nothing is sent and it says why", () => {
    full({ id: UAE, from: "remembered" });
    set("What is the enquiry?", "Fictional LED tunnel");
    fireEvent.submit(screen.getByRole("button", { name: "Record enquiry" }).closest("form")!);
    expect(screen.getByText(/Choose an agency, an end client, or both/)).toBeTruthy();
    expect(createOpportunity).not.toHaveBeenCalled();
  });
  it("Add organisation chooses the new record in the picker it was added from and returns the focus to that field, list closed", async () => {
    createOrganisation.mockResolvedValue({ error: null, id: "new-org" });
    full({ id: UAE, from: "remembered" });
    const agency = screen.getByRole("combobox", { name: /^Agency/ });
    fireEvent.click(within(agency.closest("div.relative.min-w-0") as HTMLElement).getByRole("button", { name: /Add organisation/ }));
    const dialog = screen.getByRole("dialog", { name: "Add organisation" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Fictional New Agency" } });
    fireEvent.submit(within(dialog).getByLabelText("Name").closest("form")!);
    await waitFor(() => expect((document.querySelector('input[name="agencyOrgId"]') as HTMLInputElement).value).toBe("new-org"));
    await waitFor(() => expect((agency as HTMLInputElement).value).toBe("Fictional New Agency"));
    expect((document.querySelector('input[name="clientOrgId"]') as HTMLInputElement).value).toBe("");   // the end client is a separate field and is untouched
    await waitFor(() => expect(document.activeElement).toBe(agency));
    expect(agency.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Quick Add", () => {
  it("Open the full form carries everything typed, and the list to come back to", () => {
    quick({ id: UAE, from: "remembered" });
    set("What is the enquiry?", "Fictional LED tunnel");
    set("Where did it come from?", "whatsapp");
    choose("Agency", "Fictional");
    set("Next action", "Call the fictional agency");
    set("Due", "2026-11-25");
    set("Location", "Fictional Hall 2");
    set("Budget or value", "90000");
    set("Currency", "usd");
    set("Brief", "B".repeat(600));
    set("Technology 1", "LED wall");
    fireEvent.click(screen.getByRole("button", { name: "Open the full form" }));
    expect(push).toHaveBeenCalledTimes(1);
    const sp = new URL(push.mock.calls[0]![0] as string, "https://app.example");
    expect(sp.pathname).toBe("/sales/new");
    expect(Object.fromEntries(sp.searchParams)).toMatchObject({
      company: UAE, title: "Fictional LED tunnel", source: "whatsapp", agency: "ag", next: "Call the fictional agency", due: "2026-11-25", location: "Fictional Hall 2", value: "90000", currency: "USD",
      returnTo: "/sales/follow-ups?view=week",
    });
    expect(sp.searchParams.get("brief")).toBeNull();                          // long text is not put in the address
    const carried = JSON.parse(sessionStorage.getItem(CARRY_KEY) ?? "{}");
    expect(carried.token).toBe(sp.searchParams.get("carry"));
    expect(carried.brief).toBe("B".repeat(600));
    expect(carried.technologies).toEqual([{ name: "LED wall", qty: 1 }]);
    expect(createOpportunity).not.toHaveBeenCalled();                         // nothing is saved by opening the full form
  });
  it("saves with the company, the currency and the list to return to; the same check as the full form answers before anything is sent", async () => {
    createOpportunity.mockResolvedValue({ error: "refused" });
    quick({ id: UAE, from: "context" });
    set("What is the enquiry?", "Fictional LED tunnel");
    set("Where did it come from?", "whatsapp");
    set("Next action", "Call the fictional agency");
    const form = screen.getByLabelText("What is the enquiry?").closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => { screen.debug(screen.getAllByRole("alert")[0], 3000); expect(screen.getByText(/Choose an agency, an end client, or both/)).toBeTruthy(); }, { timeout: 300 });
    expect(createOpportunity).not.toHaveBeenCalled();
    choose("End client", "Fictional");
    fireEvent.submit(form);
    await waitFor(() => expect(createOpportunity).toHaveBeenCalledTimes(1));
    const sent = createOpportunity.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(sent)).toMatchObject({ companyId: UAE, currency: "AED", after: "panel", returnTo: "/sales/follow-ups?view=week", nextTime: "10:00", nextKind: "call", clientOrgId: "cl" });
    await waitFor(() => expect(screen.getByText("refused")).toBeTruthy());
    expect(field("What is the enquiry?").value).toBe("Fictional LED tunnel");  // a refused save keeps what was typed
  });
});
