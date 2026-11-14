// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/** Events & Exhibitions list: whose enquiry figures are counted, that every link keeps the company, and that a long list says what it shows. Fictional data only. */
let address = "";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/events", useSearchParams: () => new URLSearchParams(address) }));
vi.mock("next/link", () => ({ default: ({ children, href, scroll: _scroll, ...rest }: { children: React.ReactNode; href: string; scroll?: boolean }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/lib/actions/events", () => ({ archiveEdition: vi.fn(), archiveEvent: vi.fn(), saveEdition: vi.fn(), saveEvent: vi.fn(), saveEventEdition: vi.fn() }));

const EU = "11111111-1111-4111-8111-111111111111";   // "Enginious Europe": first by name
const UAE = "22222222-2222-4222-8222-222222222222";
const ctx: { userId: string; grants: unknown[]; homeCompanyId: string | null; companies: { id: string; name: string }[] } = {
  userId: "u1", grants: [{ companyId: EU, capabilities: [] }, { companyId: UAE, capabilities: [] }], homeCompanyId: UAE,
  companies: [{ id: EU, name: "Enginious Europe" }, { id: UAE, name: "Enginious UAE" }],
};
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

const EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const edition = (n: number) => ({ id: `ed-${n}`, event_id: EVENT, start_date: `${2030 + n}-03-01`, end_date: `${2030 + n}-03-04`, city: "Dubai", country_code: "AE", venue: "Fictional Hall", archived_at: null });
let data: { events: unknown[]; editions: ReturnType<typeof edition>[]; enquiries: unknown[] };
let fail = false;
vi.mock("@/lib/crm/events/data", () => ({ loadEvents: async () => { if (fail) throw new Error("down"); return data; } }));

import EventsPage from "./page";
const show = async (sp: Record<string, string> = {}) => { address = new URLSearchParams(sp).toString(); return render(<>{await EventsPage({ searchParams: Promise.resolve(sp) })}</>); };
const rowOf = (label: string) => screen.getByRole("link", { name: label }).closest("tr")!;
const cells = (label: string) => Array.from(rowOf(label).querySelectorAll("td")).map((c) => c.textContent);

beforeEach(() => {
  fail = false; ctx.homeCompanyId = UAE;
  data = {
    events: [{ id: EVENT, name: "Fictional Expo", kind: "exhibition", website: null, archived_at: null }],
    editions: [edition(1), edition(2)],
    enquiries: [
      { id: "o1", company_id: UAE, reference: "OPP-UAE-1", title: "Fictional stand", stage: "new", event_edition_id: "ed-1", agency_org_id: null, client_org_id: null },
      { id: "o2", company_id: UAE, reference: "OPP-UAE-2", title: "Fictional wall", stage: "won", event_edition_id: "ed-1", agency_org_id: null, client_org_id: null },
      { id: "o3", company_id: EU, reference: "OPP-EU-1", title: "Fictional floor", stage: "lost", event_edition_id: "ed-1", agency_org_id: null, client_org_id: null },
    ],
  };
});
afterEach(() => cleanup());

describe("Events & Exhibitions: the company", () => {
  it("opens in the person's employing company (UAE), not the first company by name (Europe), and says so next to the figures", async () => {
    await show();
    expect(screen.getByTestId("sales-company").getAttribute("data-company-id")).toBe(UAE);
    expect(screen.getByTestId("events-scope").textContent).toBe("Enginious UAE");
    expect(cells("Fictional Expo · 2031 · Dubai").slice(4)).toEqual(["2", "1", "1", "1", "0"]);   // total, open, closed, won, lost: UAE's two only
  });

  it("another company, or All my companies, is an explicit choice that keeps the filters and the view", async () => {
    await show({ when: "all", country: "AE" });
    const nav = screen.getByRole("navigation", { name: "Company" });
    expect(within(nav).getByRole("link", { name: "Enginious Europe" }).getAttribute("href")).toBe(`/sales/events?when=all&country=AE&company=${EU}`);
    expect(within(nav).getByRole("link", { name: "All my companies" }).getAttribute("href")).toBe("/sales/events?when=all&country=AE&scope=all");
    cleanup();
    await show({ scope: "all" });
    expect(screen.getByTestId("events-scope").textContent).toBe("All your companies");
    expect(cells("Fictional Expo · 2031 · Dubai").slice(4)).toEqual(["3", "1", "2", "1", "1"]);
    cleanup();
    await show({ company: EU });
    expect(cells("Fictional Expo · 2031 · Dubai").slice(4)).toEqual(["1", "0", "1", "0", "1"]);
  });

  it("several companies and nothing to go on: the shared events are listed, no figure is shown for a company nobody chose", async () => {
    ctx.homeCompanyId = null;
    await show();
    expect(screen.getByTestId("sales-company").getAttribute("data-choose")).toBe("true");
    expect(screen.getByTestId("sales-choose-company").textContent).toContain("the enquiry figures of each edition");
    expect(screen.queryByRole("columnheader", { name: "Enquiries" })).toBeNull();
    expect(cells("Fictional Expo · 2031 · Dubai")).toHaveLength(4);
    expect(screen.queryByTestId("events-scope")).toBeNull();
  });

  it("every link out of the list carries the company: an edition, the calendar, the import", async () => {
    await show({ q: "expo" });
    expect(screen.getByRole("link", { name: "Fictional Expo · 2031 · Dubai" }).getAttribute("href")).toBe(`/sales/events/${EVENT}?edition=ed-1&company=${UAE}`);
    expect(screen.getByRole("link", { name: /Calendar/ }).getAttribute("href")).toBe(`/sales/events?company=${UAE}&q=expo&view=calendar`);
    expect(screen.getByRole("link", { name: /Import events/ }).getAttribute("href")).toBe(`/sales/events/import?company=${UAE}`);
    cleanup();
    await show({ view: "calendar", month: "2031-03", scope: "all" });
    const links = screen.getAllByRole("link", { name: "Fictional Expo" }).map((a) => a.getAttribute("href"));
    expect(new Set(links)).toEqual(new Set([`/sales/events/${EVENT}?edition=ed-1&scope=all`]));
    expect(screen.getByRole("link", { name: /Next/ }).getAttribute("href")).toBe("/sales/events?scope=all&view=calendar&month=2031-04");
    expect(screen.getByRole("link", { name: /List/ }).getAttribute("href")).toBe("/sales/events?scope=all");
  });
});

describe("Events & Exhibitions: adding, and a long list", () => {
  it("offers Add event, Add edition and Import events as three different things, with what each does in words", async () => {
    await show();
    expect(screen.getByRole("button", { name: "Add event" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add edition" })).toBeTruthy();
    expect(screen.getByTestId("event-add-consequences").textContent).toBe("Add event creates a new show with its first edition. Add edition adds a dated occurrence to a show already listed. Both are shared with every company.");
    expect(screen.getByTestId("info-hint-event-words")).toBeTruthy();
  });

  it("says which editions are shown and offers the rest: 1-100 of 130, then 101-130", async () => {
    data.editions = Array.from({ length: 130 }, (_, i) => ({ ...edition(1), id: `ed-${i}`, start_date: `2031-01-${String((i % 28) + 1).padStart(2, "0")}`, end_date: "2031-02-28", city: `City ${i}` }));
    await show({ company: UAE });
    const pager = screen.getByTestId("events-pager");
    expect(pager.textContent).toContain("Showing 1-100 of 130 editions.");
    expect(screen.getAllByRole("row")).toHaveLength(101);   // the header and 100 editions
    expect(within(pager).getByRole("link", { name: "Next 30" }).getAttribute("href")).toBe(`/sales/events?company=${UAE}&page=2`);
    expect(within(pager).queryByRole("link", { name: /Previous/ })).toBeNull();
    cleanup();
    await show({ company: UAE, page: "2" });
    expect(screen.getByTestId("events-pager").textContent).toContain("Showing 101-130 of 130 editions.");
    expect(screen.getAllByRole("row")).toHaveLength(31);
    expect(screen.getByRole("link", { name: "Previous 100" }).getAttribute("href")).toBe(`/sales/events?company=${UAE}`);
    cleanup();
    await show({ company: UAE, page: "99" });                // a page past the end is the last page, never an empty list
    expect(screen.getByTestId("events-pager").textContent).toContain("Showing 101-130 of 130 editions.");
  });

  it("a short list has no pager", async () => {
    await show();
    expect(screen.queryByTestId("events-pager")).toBeNull();
  });

  it("a failed read says it could not load, with a retry that keeps the address, and shows no list", async () => {
    fail = true;
    await show({ company: UAE, when: "past" });
    expect(screen.getByText(/Could not load Events & Exhibitions/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(`/sales/events?company=${UAE}&when=past`);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
