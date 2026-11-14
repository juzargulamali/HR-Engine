// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

/**
 * Clients & Agencies, the account page and the import: which company each opens in (never the first by name), the directory's paging sentence, and
 * the order and actions of the account page. Fictional companies and people only.
 */
let address = "";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/accounts", useSearchParams: () => new URLSearchParams(address), notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, href, prefetch: _p, scroll: _s, ...rest }: { children: React.ReactNode; href: string; prefetch?: boolean; scroll?: boolean }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
let cookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }) }));

// "Fictional Alpha Europe" sorts first by name: the old default. The person works in the other one.
const EU = "11111111-1111-4111-8111-111111111111";
const UAE = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const ME = "u-me";
const ctx: Record<string, unknown> = {
  userId: ME, grants: [{ companyId: EU, capabilities: [] }, { companyId: UAE, capabilities: [] }],
  companies: [{ id: EU, name: "Fictional Alpha Europe" }, { id: UAE, name: "Fictional Beta UAE" }],
  people: [], personName: (id: string) => `Person ${id}`, companyName: (id: string) => id, homeCompanyId: null,
};
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

import { buildDirectoryRows, type DirectoryRow } from "@/lib/crm/clients-agencies/directory";
import { deriveAccount } from "@/lib/crm/clients-agencies/account";
import type { CrmOrganisationRow } from "@/types/crm";

const loadDirectory = vi.fn(async (_company: string): Promise<DirectoryRow[]> => []);
const loadAccount = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
const loadStaff = vi.fn(async () => [{ userId: ME, name: "Fictional Sara", email: null, companyIds: [EU, UAE] }, { userId: "u-other", name: "Fictional Omar", email: null, companyIds: [UAE] }]);
vi.mock("@/lib/crm/clients-agencies/data", () => ({ loadDirectory: (c: string) => loadDirectory(c), loadAccount: (...a: unknown[]) => loadAccount(...a), loadStaff: () => loadStaff() }));
const loadAccountOutreach = vi.fn(async (..._a: unknown[]) => []);
vi.mock("@/lib/crm/clients-agencies/outreach-data", () => ({ loadAccountOutreach: (...a: unknown[]) => loadAccountOutreach(...a) }));

// The dialogs are not under test: each stands in as its label, with what it was given.
vi.mock("./account-forms", () => ({
  AddAccountButton: () => <button type="button">Add account</button>,
  AddAccountContactButton: () => <button type="button">Add contact</button>,
  EditAccountButton: () => <button type="button">Edit profile</button>,
  EditAccountContactButton: () => null,
}));
vi.mock("./owner-and-follow-ups", () => ({
  AddAccountFollowUpButton: () => <button type="button">Add follow-up</button>,
  AddFollowUpButton: () => <button type="button">Add follow-up</button>,
  AssignOwnerButton: () => null,
  ReassignFollowUpButton: ({ title }: { title: string }) => <button type="button">Reassign {title}</button>,
}));
vi.mock("./priority-control", () => ({ PriorityControl: () => null }));
vi.mock("./outreach-select", () => ({ AssignBar: () => null, SelectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, SelectBox: () => null, SelectAllBox: () => null }));
vi.mock("./import/import-flow", () => ({ ImportFlow: ({ companyName }: { companyName: string }) => <p>Import flow for {companyName}</p> }));
vi.mock("../outreach/outreach-section", () => ({ OutreachSection: ({ companyId, onlyContactId }: { companyId: string; onlyContactId: string | null }) => <section id="outreach" data-company={companyId} data-contact={onlyContactId ?? ""}>Outreach section</section> }));
vi.mock("@/components/sales/follow-up-row-actions", () => ({
  FollowUpRowActions: ({ followUp }: { followUp: { title: string; isOnlyOpen: boolean; opportunityId: string | null } }) => <span data-testid="row-actions" data-only-open={String(followUp.isOnlyOpen)} data-opp={followUp.opportunityId ?? ""}>Complete {followUp.title}</span>,
}));

import AccountsPage from "./page";
import AccountPage from "./[id]/page";
import ImportPage from "./import/page";

const showList = async (sp: Record<string, string> = {}) => { address = new URLSearchParams(sp).toString(); render(<>{await AccountsPage({ searchParams: Promise.resolve(sp) })}</>); };
const showAccount = async (sp: Record<string, string> = {}) => render(<>{await AccountPage({ params: Promise.resolve({ id: ORG }), searchParams: Promise.resolve(sp) })}</>);
const showImport = async (sp: Record<string, string> = {}) => render(<>{await ImportPage({ searchParams: Promise.resolve(sp) })}</>);
const companyBar = () => screen.getByTestId("sales-company");

const org = (id: string, name: string) => ({ id, name, roles: ["agency"], country_code: "AE", archived_at: null, outreach_priority: null }) as unknown as CrmOrganisationRow;
const directory = (n: number): DirectoryRow[] => buildDirectoryRows({
  organisations: Array.from({ length: n }, (_, i) => org(`o${i}`, `Fictional Account ${String(i + 1).padStart(3, "0")}`)), contacts: [], profiles: [], opportunities: [], companyId: UAE, now: new Date("2026-11-08T08:00:00Z"),
});

beforeEach(() => { cookie = undefined; ctx.homeCompanyId = null; ctx.grants = [{ companyId: EU, capabilities: [] }, { companyId: UAE, capabilities: [] }]; loadDirectory.mockClear(); loadAccount.mockClear(); loadStaff.mockClear(); loadAccountOutreach.mockClear(); loadDirectory.mockResolvedValue([]); loadAccount.mockResolvedValue(null); });
afterEach(cleanup);

describe("Clients & Agencies: the company it opens in", () => {
  it("with no company in the address it opens in the person's own company, not the first by name", async () => {
    ctx.homeCompanyId = UAE;
    await showList();
    expect(loadDirectory).toHaveBeenCalledWith(UAE);
    expect(companyBar().getAttribute("data-company-id")).toBe(UAE);
    expect(within(companyBar()).getByRole("link", { name: "Fictional Beta UAE" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("accounts-count").textContent).toContain("figures for Fictional Beta UAE");
  });
  it("the company used last in Sales wins over the person's own, and the address wins over both", async () => {
    ctx.homeCompanyId = UAE; cookie = EU;
    await showList();
    expect(loadDirectory).toHaveBeenCalledWith(EU);
    cleanup(); loadDirectory.mockClear();
    await showList({ company: UAE });
    expect(loadDirectory).toHaveBeenCalledWith(UAE);
  });
  it("with several companies and nothing to go on it asks, and loads nothing company-scoped", async () => {
    await showList();
    expect(loadDirectory).not.toHaveBeenCalled();
    expect(loadStaff).not.toHaveBeenCalled();
    expect(companyBar().getAttribute("data-choose")).toBe("true");
    expect(screen.getByTestId("sales-choose-company").textContent).toContain("Choose a company above");
    expect(within(companyBar()).getByRole("link", { name: "Fictional Beta UAE" }).getAttribute("href")).toBe(`/sales/accounts?company=${UAE}`);
    expect(screen.queryByText(/Could not load/)).toBeNull();
    expect(screen.queryByText(/No accounts yet/)).toBeNull();
  });
  it("a company in the address the person has no Sales access to is ignored, never trusted", async () => {
    await showList({ company: "99999999-9999-4999-8999-999999999999" });
    expect(loadDirectory).not.toHaveBeenCalled();
    expect(screen.getByTestId("sales-choose-company")).toBeTruthy();
  });
  it("every link to another page carries the company: accounts, import, both exports, the other company", async () => {
    loadDirectory.mockResolvedValue(directory(2));
    await showList({ company: UAE, q: "Fictional" });
    expect(screen.getByRole("link", { name: "Fictional Account 001" }).getAttribute("href")).toBe(`/sales/accounts/o0?company=${UAE}`);
    expect(screen.getByTestId("accounts-import").getAttribute("href")).toBe(`/sales/accounts/import?company=${UAE}`);
    expect(screen.getByTestId("accounts-export-filtered").getAttribute("href")).toBe(`/api/sales/accounts/export?company=${UAE}&scope=filtered&q=Fictional`);
    expect(screen.getByTestId("accounts-export-all").getAttribute("href")).toBe(`/api/sales/accounts/export?company=${UAE}&scope=all`);
    // choosing the other company keeps the search
    expect(within(companyBar()).getByRole("link", { name: "Fictional Alpha Europe" }).getAttribute("href")).toBe(`/sales/accounts?company=${EU}&q=Fictional`);
  });
  it("has one primary button; import and the exports are in one menu", async () => {
    loadDirectory.mockResolvedValue(directory(2));
    await showList({ company: UAE });
    expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy();
    expect(screen.getByTestId("accounts-more").textContent).toContain("Import and export");
    expect(screen.getAllByRole("menuitem", { hidden: true }).map((m) => m.textContent?.replace(/\s+/g, " ").trim().split(/(?<=Excel|results|accounts)/)[0])).toEqual(["Import from Excel", "Export filtered results", "Export all accounts"]);
  });
});

describe("Clients & Agencies: a long list is paged, never cut off", () => {
  it("says which rows are shown and offers the next page, keeping filters and sort", async () => {
    loadDirectory.mockResolvedValue(directory(240));
    await showList({ company: UAE, role: "agency", sort: "name", dir: "desc" });
    expect(screen.getByTestId("accounts-count").textContent).toContain("Showing 1-100 of 240 accounts matching, of 240 in all".replace(" matching, of 240 in all", ""));
    expect(screen.getAllByRole("row")).toHaveLength(101);
    const next = screen.getAllByRole("link", { name: /Next page/ });
    expect(next).toHaveLength(2); // above and below the table
    expect(next[0]!.getAttribute("href")).toBe(`/sales/accounts?company=${UAE}&role=agency&sort=name&dir=desc&page=2`);
    expect(screen.queryByRole("link", { name: /Previous page/ })).toBeNull();
    expect(screen.queryByText(/Showing the first 100/)).toBeNull();
  });
  it("the last page holds the rest, and a page past the end is the last page", async () => {
    loadDirectory.mockResolvedValue(directory(240));
    await showList({ company: UAE, page: "3" });
    expect(screen.getByTestId("accounts-count").textContent).toContain("Showing 201-240 of 240 accounts");
    expect(screen.getAllByRole("row")).toHaveLength(41);
    expect(screen.getByRole("link", { name: "Fictional Account 240" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Previous page/ })[0]!.getAttribute("href")).toBe(`/sales/accounts?company=${UAE}&page=2`);
    cleanup();
    await showList({ company: UAE, page: "77" });
    expect(screen.getByTestId("accounts-count").textContent).toContain("Showing 201-240 of 240 accounts");
  });
  it("a filtered list says how many match out of how many, and a short list has no pager", async () => {
    loadDirectory.mockResolvedValue(directory(240));
    await showList({ company: UAE, q: "Account 00" });
    expect(screen.getByTestId("accounts-count").textContent).toContain("9 accounts matching, of 240 in all");
    expect(screen.queryByTestId("accounts-pager")).toBeNull();
  });
});

const account = (over: { contacts?: number; followUps?: boolean } = {}) => {
  const opps = [
    { id: "opp-open", company_id: UAE, reference: "OPP-1", title: "Fictional open enquiry", stage: "qualified", agency_org_id: ORG, client_org_id: null, owner_id: "u-other", currency: "AED", value: null, closed_at: null, created_at: "2026-10-01T08:00:00Z" },
    { id: "opp-won", company_id: UAE, reference: "OPP-2", title: "Fictional won enquiry", stage: "won", agency_org_id: ORG, client_org_id: null, owner_id: "u-other", currency: "AED", value: null, closed_at: "2026-09-01T08:00:00Z", created_at: "2026-08-01T08:00:00Z" },
  ];
  const followUps = over.followUps === false ? [] : [
    { id: "f-mine", opportunity_id: "opp-open", organisation_id: null, title: "Call about dates", due_at: "2026-11-01T06:00:00Z", status: "open", assigned_to: ME, created_by: ME, company_id: UAE },
    { id: "f-theirs", opportunity_id: "opp-won", organisation_id: null, title: "Send invoice copy", due_at: "2026-12-01T06:00:00Z", status: "open", assigned_to: "u-other", created_by: "u-other", company_id: UAE },
  ];
  const view = deriveAccount({ orgId: ORG, companyId: UAE, now: new Date("2026-11-08T08:00:00Z"), opportunities: opps as never, proposals: [], zoho: [], activities: [], followUps: followUps as never, projects: { status: "ok", data: [] }, handovers: { status: "ok", data: new Map() } });
  const contacts = Array.from({ length: over.contacts ?? 1 }, (_, i) => ({ id: `k${i}`, name: `Fictional Contact ${i + 1}`, role_title: null, email: null, phone: null, organisation_id: ORG }));
  return { org: { ...org(ORG, "Fictional Harbour Studio"), website: null, vat_trn: null, trade_licence_no: null, place: null, note: null, outreach_priority_at: null }, contacts, profile: null, view, orgNames: new Map() };
};

describe("the account page", () => {
  it("uses the company in the address, shows it, and remembers nothing it was not given", async () => {
    loadAccount.mockResolvedValue(account());
    await showAccount({ company: UAE });
    expect(loadAccount).toHaveBeenCalledWith(ctx, UAE, ORG);
    expect(loadAccountOutreach).toHaveBeenCalledWith(UAE, ORG);
    expect(companyBar().getAttribute("data-company-id")).toBe(UAE);
    // seeing the same account for the other company is one press, on the same account
    expect(within(companyBar()).getByRole("link", { name: "Fictional Alpha Europe" }).getAttribute("href")).toBe(`/sales/accounts/${ORG}?company=${EU}`);
  });
  it("with no company in the address and nothing to go on it asks, and reads nothing about the account", async () => {
    await showAccount();
    expect(loadAccount).not.toHaveBeenCalled();
    expect(loadAccountOutreach).not.toHaveBeenCalled();
    expect(screen.getByTestId("sales-choose-company")).toBeTruthy();
    expect(within(companyBar()).getByRole("link", { name: "Fictional Beta UAE" }).getAttribute("href")).toBe(`/sales/accounts/${ORG}?company=${UAE}`);
  });
  it("opens in the person's own company when the address has none (a link from the shared contacts list)", async () => {
    ctx.homeCompanyId = UAE;
    loadAccount.mockResolvedValue(account());
    await showAccount();
    expect(loadAccount).toHaveBeenCalledWith(ctx, UAE, ORG);
  });
  it("shows contacts, open enquiries, follow-ups and outreach, in that order, before the figures and the history", async () => {
    loadAccount.mockResolvedValue(account());
    const { container } = await showAccount({ company: UAE });
    const text = container.textContent ?? "";
    const at = ["Contacts (1)", "Open enquiries (1)", "Follow-ups (2 open, 1 overdue)", "Outreach section", "Figures for Fictional Beta UAE", "Profile", "History", "Inquiries (2)"].map((t) => text.indexOf(t));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    // the next follow-up is named at the top, and Add follow-up and Add contact are there too
    expect(screen.getByTestId("account-next").textContent).toContain("Next follow-up:Call about dates");
    expect(screen.getByRole("button", { name: "Add follow-up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add contact" })).toBeTruthy();
  });
  it("a new enquiry opens the New enquiry page with this company and this account", async () => {
    loadAccount.mockResolvedValue(account());
    await showAccount({ company: UAE });
    expect(screen.getByTestId("account-new-enquiry").getAttribute("href")).toBe(`/sales/new?company=${UAE}&org=${ORG}`);
  });
  it("follow-ups can be completed and rescheduled by the people the database lets act, and reassigned as before", async () => {
    loadAccount.mockResolvedValue(account());
    await showAccount({ company: UAE });
    const rows = screen.getAllByTestId("account-follow-up");
    expect(rows).toHaveLength(2);
    // mine (I am the assignee): the actions, and it is the only open follow-up of an active enquiry
    const mine = within(rows[0]!);
    expect(rows[0]!.getAttribute("data-state")).toBe("overdue");
    expect(mine.getByTestId("row-actions").getAttribute("data-only-open")).toBe("true");
    expect(mine.getByTestId("row-actions").getAttribute("data-opp")).toBe("opp-open");
    expect(mine.getByRole("button", { name: /Reassign/ })).toBeTruthy();
    // someone else's, on an enquiry I do not own, and I am not a founder: no actions at all
    const theirs = within(rows[1]!);
    expect(theirs.queryByTestId("row-actions")).toBeNull();
    expect(theirs.queryByRole("button", { name: /Reassign/ })).toBeNull();
  });
  it("a founder may act on every follow-up", async () => {
    ctx.grants = [{ companyId: UAE, capabilities: ["founder"] }];
    loadAccount.mockResolvedValue(account());
    await showAccount({ company: UAE });
    expect(screen.getAllByTestId("row-actions")).toHaveLength(2);
    // the follow-up on the won enquiry is not "the only open one of an active enquiry"
    expect(screen.getAllByTestId("row-actions")[1]!.getAttribute("data-only-open")).toBe("false");
  });
  it("with open enquiries and no follow-up it says so in words", async () => {
    loadAccount.mockResolvedValue(account({ followUps: false }));
    await showAccount({ company: UAE });
    expect(screen.getByTestId("account-next").textContent).toContain("No follow-up is planned, and an enquiry is open. Add a follow-up.");
  });
  it("only an account with exactly one contact hands a contact to a new enquiry from outreach", async () => {
    loadAccount.mockResolvedValue(account({ contacts: 1 }));
    const one = await showAccount({ company: UAE });
    expect(one.container.querySelector("#outreach")?.getAttribute("data-contact")).toBe("k0");
    cleanup();
    loadAccount.mockResolvedValue(account({ contacts: 2 }));
    const two = await showAccount({ company: UAE });
    expect(two.container.querySelector("#outreach")?.getAttribute("data-contact")).toBe("");
  });
  it("a failed read says it could not load", async () => {
    loadAccount.mockRejectedValue(new Error("Clients & Agencies could not be loaded: down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await showAccount({ company: UAE });
    spy.mockRestore();
    expect(screen.getByText(/Could not load this account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(`/sales/accounts/${ORG}?company=${UAE}`);
  });
});

describe("Import from Excel: the company it writes to", () => {
  it("imports into the company in the address", async () => {
    await showImport({ company: UAE });
    expect(screen.getByText("Import flow for Fictional Beta UAE")).toBeTruthy();
    expect(within(companyBar()).getByRole("link", { name: "Fictional Alpha Europe" }).getAttribute("href")).toBe(`/sales/accounts/import?company=${EU}`);
  });
  it("never guesses: with several companies and nothing to go on there is no upload until one is chosen", async () => {
    await showImport();
    expect(screen.queryByText(/Import flow for/)).toBeNull();
    expect(screen.getByTestId("sales-choose-company").textContent).toContain("the import for that company");
  });
  it("opens in the person's own company rather than the first by name", async () => {
    ctx.homeCompanyId = UAE;
    await showImport();
    expect(screen.getByText("Import flow for Fictional Beta UAE")).toBeTruthy();
  });
});
