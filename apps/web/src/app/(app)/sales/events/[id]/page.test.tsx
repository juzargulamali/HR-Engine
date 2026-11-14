// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

/** One event's page: the company the figures are counted for, the order of the sections, the way back, and Archive as a secondary action. Fictional data only. */
vi.mock("server-only", () => ({}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn() }), usePathname: () => "/sales/events/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href, scroll: _scroll, ...rest }: { children: React.ReactNode; href: string; scroll?: boolean }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
const archiveEdition = vi.fn(); const archiveEvent = vi.fn();
vi.mock("@/lib/actions/events", () => ({ archiveEdition: (...a: unknown[]) => archiveEdition(...a), archiveEvent: (...a: unknown[]) => archiveEvent(...a), saveEdition: vi.fn(), saveEvent: vi.fn(), saveEventEdition: vi.fn(), saveObservation: vi.fn(), removeObservation: vi.fn(), setOutreachPriority: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async () => ({ data: [], error: null }) }) }));

const EU = "11111111-1111-4111-8111-111111111111";   // "Enginious Europe": first by name
const UAE = "22222222-2222-4222-8222-222222222222";
const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const E27 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const E26 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGENCY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; const CLIENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ctx: { userId: string; grants: { companyId: string; capabilities: string[] }[]; homeCompanyId: string | null; companies: { id: string; name: string }[]; personName: () => string; companyName: (id: string) => string } = {
  userId: "u1", grants: [{ companyId: EU, capabilities: [] }, { companyId: UAE, capabilities: [] }], homeCompanyId: UAE,
  companies: [{ id: EU, name: "Enginious Europe" }, { id: UAE, name: "Enginious UAE" }], personName: () => "Fictional Person", companyName: (id) => (id === UAE ? "Enginious UAE" : "Enginious Europe"),
};
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

let fail = false;
const far = (y: number, md: string) => `${y}-${md}`;
const event = { id: EVENT, name: "Fictional Expo", kind: "exhibition", website: null, note: null, archived_at: null, created_by: "u1" };
const editions = [
  { id: E27, event_id: EVENT, start_date: far(2099, "10-13"), end_date: far(2099, "10-17"), city: "Dubai", country_code: "AE", venue: "Fictional Hall", archived_at: null },
  { id: E26, event_id: EVENT, start_date: far(2020, "10-12"), end_date: far(2020, "10-16"), city: "Dubai", country_code: "AE", venue: "Fictional Hall", archived_at: null },
];
const observations = [{ id: "ob1", edition_id: E26, exhibitor_org_id: CLIENT, kind: "exhibited", agency_org_id: AGENCY, agency_unknown: false, stand_no: "B12", agency_role: "stand_builder", note: null, verification: "confirmed", created_by: "u1", created_at: "2020-10-12T08:00:00Z" }];
const orgs = new Map([[AGENCY, { id: AGENCY, name: "Fictional Agency A", country_code: "AE", website: null, roles: ["agency"], outreach_priority: null }], [CLIENT, { id: CLIENT, name: "Fictional Harbour Client", country_code: "AE", website: null, roles: ["client"], outreach_priority: null }]]);
const enquiries = [
  { id: "o1", company_id: UAE, reference: "OPP-UAE-1", title: "Fictional stand", stage: "new", event_edition_id: E27, agency_org_id: null, client_org_id: null },
  { id: "o2", company_id: EU, reference: "OPP-EU-1", title: "Fictional floor", stage: "lost", event_edition_id: E27, agency_org_id: null, client_org_id: null },
];
vi.mock("@/lib/crm/events/data", () => ({
  loadEvent: async () => { if (fail) throw new Error("down"); return { event, editions, observations, orgs, enquiries }; },
  loadOrgChoices: async () => [],
}));

// jsdom has no dialog methods: opening one just marks it open, as the other dialog tests do.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

import EventPage from "./page";
const show = async (sp: Record<string, string> = {}) => render(<>{await EventPage({ params: Promise.resolve({ id: EVENT }), searchParams: Promise.resolve(sp) })}</>);
const table = () => screen.getByRole("table", { name: "Editions of this event" });
const figures = (year: string) => Array.from(within(table()).getAllByRole("row").find((r) => r.textContent?.includes(`· ${year} ·`))!.querySelectorAll("td")).slice(4, 9).map((c) => c.textContent);

beforeEach(() => { fail = false; ctx.homeCompanyId = UAE; push.mockReset(); archiveEdition.mockReset(); archiveEvent.mockReset(); });
afterEach(() => cleanup());

describe("an event's page: the company", () => {
  it("counts for the person's employing company (UAE) when the address names none, never the first by name, and says the company next to every count", async () => {
    await show();
    expect(screen.getByTestId("sales-company").getAttribute("data-company-id")).toBe(UAE);
    expect(figures("2099")).toEqual(["1", "1", "0", "0", "0"]);
    expect(screen.getByTestId("edition-counts").textContent).toBe("1 enquiry: 1 open, 0 won, 0 lost for Enginious UAE");
    expect(screen.getAllByTestId("event-scope").every((n) => n.textContent === "for Enginious UAE")).toBe(true);
    expect(screen.getByText("For Enginious UAE.")).toBeTruthy();                       // beside the linked enquiries
    expect(screen.getByText("OPP-UAE-1")).toBeTruthy();
    expect(screen.queryByText("OPP-EU-1")).toBeNull();
  });

  it("the company in the address (carried by every link from the list) wins; All my companies is the sum", async () => {
    await show({ company: EU, edition: E27 });
    expect(figures("2099")).toEqual(["1", "0", "1", "0", "1"]);
    cleanup();
    await show({ scope: "all", edition: E27 });
    expect(figures("2099")).toEqual(["2", "1", "1", "0", "1"]);
    expect(screen.getByTestId("edition-counts").textContent).toContain("for All your companies");
  });

  it("several companies and nothing to go on: no figure and no enquiry is shown until a company is chosen; the shared parts still are", async () => {
    ctx.homeCompanyId = null;
    await show();
    expect(screen.getByTestId("sales-choose-company")).toBeTruthy();
    expect(within(table()).queryByRole("columnheader", { name: "Enquiries" })).toBeNull();
    expect(screen.queryByTestId("edition-counts")).toBeNull();
    expect(screen.queryByText("OPP-UAE-1")).toBeNull();
    expect(screen.getByRole("heading", { name: "Who exhibited, and with which agency" })).toBeTruthy();
    // An account is opened without a guessed company.
    expect(screen.getAllByRole("link", { name: "Fictional Harbour Client" })[0]!.getAttribute("href")).toBe(`/sales/accounts/${CLIENT}`);
  });

  it("keeps the company and the edition in focus on every link: another edition, the company chooser, an account", async () => {
    await show({ company: UAE, edition: E26 });
    expect(within(table()).getByRole("link", { name: "Fictional Expo · 2099 · Dubai" }).getAttribute("href")).toBe(`/sales/events/${EVENT}?company=${UAE}&edition=${E27}`);
    const nav = screen.getByRole("navigation", { name: "Company" });
    expect(within(nav).getByRole("link", { name: "Enginious Europe" }).getAttribute("href")).toBe(`/sales/events/${EVENT}?edition=${E26}&company=${EU}`);
    expect(within(nav).getByRole("link", { name: "All my companies" }).getAttribute("href")).toBe(`/sales/events/${EVENT}?edition=${E26}&scope=all`);
    expect(screen.getAllByRole("link", { name: "Fictional Harbour Client" })[0]!.getAttribute("href")).toBe(`/sales/accounts/${CLIENT}?company=${UAE}`);
  });

  it("the way back is the list as the person left it; without one remembered, the list for the same company", async () => {
    await show({ company: UAE });
    expect(screen.getByRole("link", { name: "Events & Exhibitions" }).getAttribute("href")).toBe(`/sales/events?company=${UAE}`);
    cleanup();
    sessionStorage.setItem("os-list:events:href", `/sales/events?company=${UAE}&view=calendar&month=2099-10&country=AE`);
    await show({ company: UAE });
    expect(screen.getByRole("link", { name: "Events & Exhibitions" }).getAttribute("href")).toBe(`/sales/events?company=${UAE}&view=calendar&month=2099-10&country=AE`);
    sessionStorage.clear();
  });

  it("a failed read says it could not load and offers a retry that keeps the edition and the company", async () => {
    fail = true;
    await show({ company: UAE, edition: E26 });
    expect(screen.getByText(/Could not load this event/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(`/sales/events/${EVENT}?edition=${E26}&company=${UAE}`);
  });
});

describe("an event's page: order and actions", () => {
  it("shows venue and dates first, then the linked enquiries, then the observations, then the agencies to contact", async () => {
    await show({ company: UAE });
    const order = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    const at = (start: string) => order.findIndex((t) => t.startsWith(start));
    expect(at("Editions")).toBe(0);
    expect(at("Enquiries linked to Fictional Expo · 2099 · Dubai (1)")).toBeGreaterThan(at("Editions"));
    expect(at("Who exhibited, and with which agency")).toBeGreaterThan(at("Enquiries linked to"));
    expect(at("Agencies to contact for Fictional Expo · 2099 · Dubai")).toBeGreaterThan(at("Who exhibited"));
    const focus = screen.getByTestId("edition-in-focus");
    expect(focus.textContent).toContain("13 to 17 Oct 2099");
    expect(focus.textContent).toContain("Fictional Hall, Dubai, United Arab Emirates");
  });

  it("the editions table turns into cards on a phone (no sideways scroll)", async () => {
    await show({ company: UAE });
    expect(table().className).toContain("max-md:[&_tbody_tr]:block");
  });

  it("offers Add next edition (not Add edition) on an event that has editions, starting with the place of the latest one and saying what it does", async () => {
    await show({ company: UAE });
    expect(screen.queryByRole("button", { name: "Add edition" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add next edition" }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Adds the following occurrence of Fictional Expo. The place is copied from Fictional Expo · 2099 · Dubai: change it if the show has moved. Earlier editions are not changed.");
    expect((within(dlg).getByLabelText("City") as HTMLInputElement).value).toBe("Dubai");
    expect((within(dlg).getByLabelText("Venue") as HTMLInputElement).value).toBe("Fictional Hall");
    expect((within(dlg).getByLabelText("Starts") as HTMLInputElement).value).toBe("");      // the dates are never guessed
  });

  it("Archive is not a button on the page: it is in a menu, and its confirmation says what happens before anything does", async () => {
    archiveEvent.mockResolvedValue({ error: null });
    await show({ company: UAE });
    expect(screen.queryByRole("button", { name: /^Archive/ })).toBeNull();
    const more = screen.getAllByRole("button", { name: "More" });
    fireEvent.click(more[0]!);                                                          // the event's own menu, in the header
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive event/ }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Archive Fictional Expo?");
    expect(dlg.textContent).toContain("this event and all its editions are marked Archived and no longer offered when linking a new enquiry");
    expect(dlg.textContent).toContain("nothing is deleted");
    expect(archiveEvent).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Keep it" }));
    expect(archiveEvent).not.toHaveBeenCalled();
  });

  it("an edition is archived from its row's menu after the same confirmation; a refusal is shown in words", async () => {
    archiveEdition.mockResolvedValue({ error: "Only the person who added this edition, or a founder, can archive it" });
    await show({ company: UAE });
    const row = within(table()).getAllByRole("row").find((r) => r.textContent?.includes("· 2020 ·"))!;
    fireEvent.click(within(row).getByRole("button", { name: "More" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: /Archive edition/ }));
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("this edition is marked Archived");
    fireEvent.click(within(dlg).getByRole("button", { name: "Archive edition Fictional Expo · 2020 · Dubai" }));
    expect(await within(dlg).findByText("Only the person who added this edition, or a founder, can archive it")).toBeTruthy();
    expect(archiveEdition).toHaveBeenCalledWith(E26);
  });
});
