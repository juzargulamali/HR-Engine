// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/**
 * Outreach: the company it opens in, what a row says (account, contact, owner, next action and due together; overdue and waiting in words), the row's one
 * action, the honest limit, the empty queue, and the outreach that already has an enquiry. Fictional companies and people only.
 */
let address = "";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/outreach", useSearchParams: () => new URLSearchParams(address) }));
vi.mock("next/link", () => ({ default: ({ children, href, prefetch: _p, scroll: _s, ...rest }: { children: React.ReactNode; href: string; prefetch?: boolean; scroll?: boolean }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));
vi.mock("@/lib/actions/outreach", () => ({ linkOutreachInquiry: vi.fn(), logOutreachActivity: vi.fn(), setOutreachNextAction: vi.fn(), setOutreachStatus: vi.fn() }));
vi.mock("@/components/sales/format", async (orig) => ({ ...(await orig<object>()), todayInDubai: () => "2026-11-07" }));

const EU = "11111111-1111-4111-8111-111111111111";
const UAE = "22222222-2222-4222-8222-222222222222";
const ME = "u-me";
const ctx: Record<string, unknown> = {
  userId: ME, grants: [{ companyId: EU, capabilities: [] }, { companyId: UAE, capabilities: [] }],
  companies: [{ id: EU, name: "Fictional Alpha Europe" }, { id: UAE, name: "Fictional Beta UAE" }],
  people: [], personName: (id: string) => (id === ME ? "Fictional Sara" : "Fictional Omar"), companyName: (id: string) => id, homeCompanyId: null,
};
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
const loadOutreach = vi.fn(async (_c: string): Promise<unknown[]> => []);
vi.mock("@/lib/crm/clients-agencies/outreach-data", () => ({ loadOutreach: (c: string) => loadOutreach(c) }));
vi.mock("@/lib/crm/clients-agencies/data", () => ({ loadStaff: async () => [] }));

import { OUTREACH_LIMIT } from "@/lib/crm/clients-agencies/outreach";
import OutreachPage from "./page";
import { OutreachSection } from "./outreach-section";

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, organisation_id: `org-${id}`, company_id: UAE, assigned_to: ME, assigned_by: "lead", assigned_at: "2026-11-01T00:00:00Z", target_date: "2026-11-30", objective: null, status: "not_started",
  closed_reason: null, closed_at: null, last_contact_on: null, last_contact_kind: null, last_outcome: null, next_action: null, next_due: null, opportunity_id: null, created_at: "", updated_at: "",
  accountName: `Fictional Account ${id}`, contacts: [], ...o,
});
const show = async (sp: Record<string, string> = {}) => { address = new URLSearchParams(sp).toString(); render(<>{await OutreachPage({ searchParams: Promise.resolve(sp) })}</>); };
const lead = (on: boolean) => { ctx.grants = [{ companyId: EU, capabilities: [] }, { companyId: UAE, capabilities: on ? ["assign_owner"] : [] }]; };
const rowFor = (name: string) => screen.getAllByTestId("outreach-row").find((r) => r.textContent?.includes(name))!;

beforeEach(() => { cookie = undefined; ctx.homeCompanyId = null; lead(false); loadOutreach.mockReset(); loadOutreach.mockResolvedValue([]); });
afterEach(cleanup);

describe("Outreach: the company it opens in", () => {
  it("opens in the person's own company, not the first by name", async () => {
    ctx.homeCompanyId = UAE;
    await show();
    expect(loadOutreach).toHaveBeenCalledWith(UAE);
    expect(screen.getByTestId("sales-company").getAttribute("data-company-id")).toBe(UAE);
    expect(screen.getByTestId("outreach-count").textContent).toContain("Your outreach for Fictional Beta UAE: 0 open");
  });
  it("the company used last in Sales is next in line, and the address wins", async () => {
    cookie = UAE;
    await show();
    expect(loadOutreach).toHaveBeenCalledWith(UAE);
    cleanup(); loadOutreach.mockClear();
    await show({ company: EU });
    expect(loadOutreach).toHaveBeenCalledWith(EU);
  });
  it("with several companies and nothing to go on it asks and loads no outreach", async () => {
    await show();
    expect(loadOutreach).not.toHaveBeenCalled();
    expect(screen.getByTestId("sales-choose-company").textContent).toContain("that company's outreach");
    expect(screen.queryByText(/Nothing assigned to you/)).toBeNull();
    expect(within(screen.getByTestId("sales-company")).getByRole("link", { name: "Fictional Beta UAE" }).getAttribute("href")).toBe(`/sales/outreach?company=${UAE}`);
  });
  it("choosing another company keeps All outreach", async () => {
    lead(true);
    await show({ company: UAE, view: "all" });
    expect(within(screen.getByTestId("sales-company")).getByRole("link", { name: "Fictional Alpha Europe" }).getAttribute("href")).toBe(`/sales/outreach?company=${EU}&view=all`);
  });
});

describe("Outreach rows", () => {
  it("shows account, contact, owner, next action and due together, with overdue in words", async () => {
    loadOutreach.mockResolvedValue([row("A", { status: "in_progress", next_action: "Send the portfolio", next_due: "2026-11-04", last_contact_on: "2026-11-02", last_contact_kind: "call", last_outcome: "spoke", contacts: [{ id: "k1", name: "Fictional Hana", role_title: "Producer" }, { id: "k2", name: "Fictional Li", role_title: null }] })]);
    await show({ company: UAE });
    const r = rowFor("Fictional Account A");
    const text = r.textContent ?? "";
    expect(r.getAttribute("data-state")).toBe("overdue");
    expect(text).toContain("Overdue by 3 days");
    expect(text).toContain("Contact: Fictional Hana (Producer) and 1 more");
    expect(text).toContain("Owner: Fictional Sara (you)");
    expect(text).toContain("Next action: Send the portfolio · due 4 Nov 2026");
    expect(within(r).getByRole("link", { name: "Fictional Account A" }).getAttribute("href")).toBe(`/sales/accounts/org-A?company=${UAE}#outreach`);
    // its one action
    expect(within(r).getAllByRole("button")).toHaveLength(1);
    expect(within(r).getByRole("button", { name: /Log activity/ })).toBeTruthy();
    expect(screen.getByTestId("outreach-count").textContent).toContain("1 open, 1 overdue");
  });
  it("waiting for a reply is said in words, and counted", async () => {
    loadOutreach.mockResolvedValue([row("B", { status: "waiting_for_reply", next_action: "Chase the reply", next_due: "2026-11-20", last_contact_on: "2026-11-05", last_contact_kind: "email", last_outcome: "sent" })]);
    await show({ company: UAE });
    const r = rowFor("Fictional Account B");
    expect(r.getAttribute("data-state")).toBe("waiting");
    expect(r.textContent).toContain("Waiting for reply");
    expect(r.textContent).not.toContain("Overdue");
    expect(screen.getByTestId("outreach-count").textContent).toContain("1 waiting for a reply");
  });
  it("a contact was logged and nothing is planned: the action is Set next action, and the missing next action is said", async () => {
    loadOutreach.mockResolvedValue([row("C", { status: "in_progress", last_contact_on: "2026-11-05", last_contact_kind: "call", last_outcome: "spoke" })]);
    await show({ company: UAE });
    const r = rowFor("Fictional Account C");
    expect(r.textContent).toContain("Next action: None set · target date 30 Nov 2026");
    expect(r.textContent).toContain("Contact: None recorded");
    expect(within(r).getByRole("button", { name: /Set next action/ })).toBeTruthy();
    expect(within(r).queryByRole("button", { name: /Log activity/ })).toBeNull();
  });
  it("contacts that could not be read say so, never 'none'", async () => {
    loadOutreach.mockResolvedValue([row("D", { contacts: null })]);
    await show({ company: UAE });
    expect(rowFor("Fictional Account D").textContent).toContain("Contact: Could not load");
  });
  it("an outreach that already has an enquiry offers that enquiry and no way to create another", async () => {
    loadOutreach.mockResolvedValue([row("E", { status: "inquiry_raised", opportunity_id: "opp-9", target_date: "2026-01-01" })]);
    await show({ company: UAE, status: "inquiry_raised" });
    const r = rowFor("Fictional Account E");
    expect(r.textContent).toContain("Inquiry raised");
    expect(r.textContent).not.toContain("Overdue");
    expect(within(r).getByRole("link", { name: /Open the enquiry/ }).getAttribute("href")).toBe("/sales/opportunities/opp-9");
    expect(within(r).queryByRole("button")).toBeNull();
  });
  it("All outreach names each owner", async () => {
    lead(true);
    loadOutreach.mockResolvedValue([row("F", { assigned_to: "u-omar" }), row("G")]);
    await show({ company: UAE, view: "all" });
    expect(rowFor("Fictional Account F").textContent).toContain("Owner: Fictional Omar");
    expect(rowFor("Fictional Account G").textContent).toContain("Owner: Fictional Sara (you)");
  });
});

describe("Outreach: limits and the empty queue", () => {
  it("says so when the read came back full, instead of looking complete", async () => {
    loadOutreach.mockResolvedValue(Array.from({ length: OUTREACH_LIMIT }, (_, i) => row(String(i), { assigned_to: i === 0 ? ME : "u-omar" })));
    await show({ company: UAE });
    expect(screen.getByTestId("outreach-limit").textContent).toContain(`Showing the first ${OUTREACH_LIMIT} outreach records for Fictional Beta UAE`);
    expect(screen.getByTestId("outreach-limit").textContent).toContain("including some of yours");
  });
  it("says nothing about a limit below it", async () => {
    loadOutreach.mockResolvedValue([row("A")]);
    await show({ company: UAE });
    expect(screen.queryByTestId("outreach-limit")).toBeNull();
  });
  it("an empty queue tells a salesperson what to do next", async () => {
    await show({ company: UAE });
    expect(screen.getByText("Nothing assigned to you")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Follow-ups" }).getAttribute("href")).toBe("/sales/follow-ups");
    expect(screen.queryByRole("link", { name: /Choose accounts to assign/ })).toBeNull();
    expect(screen.queryByTestId("outreach-assign")).toBeNull();
  });
  it("a Sales lead gets the way to assignment, in the same company", async () => {
    lead(true);
    await show({ company: UAE });
    expect(screen.getByRole("link", { name: "Choose accounts to assign" }).getAttribute("href")).toBe(`/sales/accounts?company=${UAE}`);
    expect(screen.getByTestId("outreach-assign").getAttribute("href")).toBe(`/sales/accounts?company=${UAE}`);
    cleanup();
    await show({ company: UAE, view: "all" });
    expect(screen.getByText("No outreach yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Choose accounts to assign" }).getAttribute("href")).toBe(`/sales/accounts?company=${UAE}`);
  });
  it("a failed read says it could not load", async () => {
    loadOutreach.mockRejectedValue(new Error("Outreach could not be loaded: down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await show({ company: UAE });
    spy.mockRestore();
    expect(screen.getByText(/Could not load Outreach/)).toBeTruthy();
    expect(screen.queryByText(/Nothing assigned to you/)).toBeNull();
  });
});

describe("the account's Outreach section: outreach to enquiry", () => {
  const ORG = "33333333-3333-4333-8333-333333333333";
  const OUT = "44444444-4444-4444-8444-444444444444";
  const CONTACT = "55555555-5555-4555-8555-555555555555";
  const events = [{ id: "e1", outreach_id: OUT, kind: "call", occurred_on: "2026-11-05", outcome: "spoke", note: "Wants a quote for the lobby", created_by: ME, from_user: null, to_user: null, from_status: null, to_status: null, due_on: null, opportunity_id: null }];
  const section = (o: Record<string, unknown>, onlyContactId: string | null = CONTACT) => render(
    <OutreachSection items={[{ outreach: { ...row("x"), id: OUT, organisation_id: ORG, ...o }, events }] as never} orgId={ORG} orgName="Fictional Harbour Studio" companyId={UAE} today="2026-11-07" canAssign={false}
      nameOf={() => "Fictional Sara"} inquiries={[{ id: "opp-9", label: "OPP-9: Fictional lobby screens" }]} onlyContactId={onlyContactId} />,
  );
  it("Create inquiry carries the company, account, outreach, contact, a title and a short brief to the New enquiry form", () => {
    section({ status: "in_progress", objective: "Introduce the LED tunnel" });
    const href = screen.getByRole("link", { name: "Create inquiry" }).getAttribute("href")!;
    expect(href.startsWith("/sales/new?")).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(href.split("?")[1]))).toEqual({
      company: UAE, org: ORG, outreach: OUT, contact: CONTACT, title: "Fictional Harbour Studio: Introduce the LED tunnel",
      brief: "Outreach objective: Introduce the LED tunnel Latest outreach note (2026-11-05, Call, Spoke): Wants a quote for the lobby",
    });
    expect(screen.queryByTestId("outreach-enquiry-linked")).toBeNull();
  });
  it("sends no contact when the account has none or several", () => {
    section({ status: "in_progress" }, null);
    expect(new URLSearchParams(screen.getByRole("link", { name: "Create inquiry" }).getAttribute("href")!.split("?")[1]).has("contact")).toBe(false);
  });
  it("an outreach that already has an enquiry says so and links to it: no second enquiry can be created or linked", () => {
    section({ status: "inquiry_raised", opportunity_id: "opp-9" });
    const linked = screen.getByTestId("outreach-enquiry-linked");
    expect(linked.textContent).toBe("Enquiry already created: open OPP-9: Fictional lobby screens");
    expect(within(linked).getByRole("link").getAttribute("href")).toBe("/sales/opportunities/opp-9");
    expect(screen.queryByRole("link", { name: "Create inquiry" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Link an inquiry/ })).toBeNull();
  });
  it("a closed outreach that had raised an enquiry still shows the enquiry and offers nothing else", () => {
    section({ status: "closed", opportunity_id: "opp-9", closed_reason: "Done" });
    expect(screen.getByTestId("outreach-enquiry-linked")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Create inquiry" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Log activity/ })).toBeNull();
  });
});
