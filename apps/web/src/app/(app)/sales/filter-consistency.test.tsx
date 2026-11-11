// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Clients & Agencies, Outreach and Events & Exhibitions use the Sales > Enquiries toolbar: no Apply button, each page's own filters and defaults, and a Clear
 * that keeps the company, the sort, the view and the calendar's month.
 */
let address = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/x", useSearchParams: () => new URLSearchParams(address) }));
vi.mock("next/link", () => ({ default: ({ children, href, scroll: _scroll, ...rest }: { children: React.ReactNode; href: string; scroll?: boolean }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: "u1", grants: [{ companyId: C1, capabilities: ["assign_owner"] }, { companyId: C2, capabilities: [] }], companies: [{ id: C1, name: "Fictional Co" }, { id: C2, name: "Fictional Other Co" }], people: [], personName: (id: string) => id, companyName: (id: string) => id };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
vi.mock("@enginious-hr/domain", async (orig) => ({ ...(await orig<object>()), hasCrmCapability: (_g: unknown, company: string) => company === C1 }));
vi.mock("@/lib/crm/clients-agencies/data", () => ({ loadDirectory: async () => [], loadStaff: async () => [] }));
vi.mock("@/lib/crm/clients-agencies/outreach-data", () => ({ loadOutreach: async () => [] }));
vi.mock("@/lib/crm/events/data", () => ({ loadEvents: async () => ({ events: [], editions: [], enquiries: [] }) }));
vi.mock("./accounts/account-forms", () => ({ AddAccountButton: () => null }));
vi.mock("./events/event-forms", () => ({ AddEventButton: () => null, EditionButton: () => null }));

import AccountsPage from "./accounts/page";
import OutreachPage from "./outreach/page";
import EventsPage from "./events/page";

const show = async (Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>, sp: Record<string, string>) => {
  address = new URLSearchParams(sp).toString();
  render(<>{await Page({ searchParams: Promise.resolve(sp) })}</>);
};
const noApply = () => expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const clear = () => screen.getByRole("link", { name: "Clear" }).getAttribute("href");

afterEach(() => cleanup());

describe("Clients & Agencies filters", () => {
  it("keeps its filters and defaults, without Apply; the less common ones sit under More filters", async () => {
    await show(AccountsPage, { company: C1 });
    noApply();
    expect(screen.getByRole("searchbox", { name: "Search accounts" })).toBeTruthy();
    expect(select("Role").value).toBe("");
    expect(select("Outreach priority").value).toBe("");
    expect(select("Account owner").value).toBe("");
    expect(screen.queryByLabelText("Country")).toBeNull();
    expect(screen.getByRole("button", { name: /More filters/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
  });
  it("shows the less common filters in use and Clear keeps the company and the sort", async () => {
    await show(AccountsPage, { company: C1, q: "expo", country: "AE", exhibition: "Fictional Expo", rel: "won", sort: "name", dir: "desc" });
    expect(screen.getByLabelText("2 in use")).toBeTruthy();
    expect(select("Country").value).toBe("AE");
    expect((screen.getByLabelText("Exhibition") as HTMLInputElement).value).toBe("Fictional Expo");
    expect(clear()).toBe(`/sales/accounts?company=${C1}&sort=name&dir=desc`);
  });
});

describe("Outreach filters", () => {
  it("keeps Status and Overdue only for a person's own outreach, without Apply", async () => {
    await show(OutreachPage, { company: C2 });
    noApply();
    expect(select("Status").value).toBe("");
    expect(select("Status").options[0]!.text).toBe("Not closed");
    expect((screen.getByLabelText("Overdue only") as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText("Assigned to")).toBeNull();
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
  });
  it("All outreach adds Assigned to; Clear keeps the company and the view; the company chooser is not a filter", async () => {
    await show(OutreachPage, { company: C1, view: "all", status: "contacted", overdue: "1" });
    expect(select("Assigned to").value).toBe("");
    expect((screen.getByLabelText("Overdue only") as HTMLInputElement).checked).toBe(true);
    expect(clear()).toBe(`/sales/outreach?company=${C1}&view=all`);
    expect(screen.queryByRole("list", { name: "Filters in use" })).toBeNull();
  });
});

describe("Events & Exhibitions filters", () => {
  it("List: keeps When (upcoming by default), Country and the dates, without Apply", async () => {
    await show(EventsPage, {});
    noApply();
    expect(screen.getByRole("searchbox", { name: /Search events/ })).toBeTruthy();
    expect(select("When").value).toBe("");
    expect(select("When").options[0]!.text).toBe("Upcoming (default)");
    expect(select("Country").value).toBe("");
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
  });
  it("List: dates and archived show as in use; Clear keeps whose enquiry figures are counted", async () => {
    await show(EventsPage, { scope: "all", when: "past", from: "2027-03-01", archived: "1" });
    expect(select("When").value).toBe("past");
    expect(screen.getByLabelText("2 in use")).toBeTruthy();
    expect(select("Enquiry figures for").value).toBe("all");
    expect(clear()).toBe("/sales/events?scope=all");
  });
  it("Calendar: When and the dates are not offered; Clear keeps the Calendar view and its month", async () => {
    await show(EventsPage, { view: "calendar", month: "2027-03", q: "expo", country: "AE", archived: "1" });
    noApply();
    expect(screen.queryByLabelText("When")).toBeNull();
    expect(screen.queryByLabelText("From date")).toBeNull();
    expect(select("Country").value).toBe("AE");
    expect(clear()).toBe("/sales/events?view=calendar&month=2027-03");
  });
});
