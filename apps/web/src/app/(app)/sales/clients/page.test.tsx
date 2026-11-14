/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./client-actions", () => ({ AddContactButton: () => null, ClientsToolbarActions: () => null }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "u1", grants: [{ companyId: "c1", capabilities: [] }] }) }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = (n: number, name: string, extra: Record<string, unknown> = {}) => ({ id: ID(n), name, kind: "agency", place: "Dubai", note: null, contacts: [{ id: `k-${n}`, name: `Contact of ${name}`, role_title: null, email: null, phone: null }], openCount: 1, opportunityCount: 2, ...extra });
let orgs: ReturnType<typeof org>[] = [];
let loose: unknown[] = [];
let orgsFail = false;
vi.mock("@/lib/crm/data", () => ({ loadOrganisations: async () => { if (orgsFail) throw new Error("Sales data could not be loaded: down"); return { organisations: orgs, unassignedContacts: loose }; } }));

import ClientsPage from "./page";
const render = async (sp: { q?: string; kind?: string; org?: string; page?: string } = {}) => renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve(sp) }));
const looseContact = { id: "l1", name: "Loose Person", role_title: null, email: null, phone: null };
const many = (n: number) => Array.from({ length: n }, (_, i) => org(i + 1, `Fictional Organisation ${String(i + 1).padStart(3, "0")}`));
const rowsIn = (html: string) => (html.match(/data-testid="clients-org"/g) ?? []).length;

beforeEach(() => { orgs = [org(1, "Zeta Media")]; orgsFail = false; loose = [looseContact]; });

describe("Clients & contacts (/sales/clients)", () => {
  it("lists organisations with their contacts and the contacts without an organisation, from the one complete read", async () => {
    const html = await render();
    expect(html).toContain("Clients &amp; contacts");
    expect(html).toContain("Zeta Media");
    expect(html).toContain("Contact of Zeta Media");
    expect(html).toContain("Contacts without an organisation (1)");
    expect(html).toContain("Loose Person");
    expect(html).toContain("1 organisation · 2 contacts.");
    expect(html).toContain("1 open</span> of 2 enquiries · 1 contact");
    expect(html).not.toContain("Could not load");
  });

  it("a long list is paged with an honest sentence: every organisation is on exactly one page", async () => {
    orgs = many(120);
    const first = await render();
    expect(first).toContain("Showing 1-50 of 120 organisations");
    expect(rowsIn(first)).toBe(50);
    expect(first).toContain('href="/sales/clients?page=2"');
    expect(first).not.toContain("Showing the first");
    const last = await render({ page: "3" });
    expect(last).toContain("Showing 101-120 of 120 organisations");
    expect(rowsIn(last)).toBe(20);
    expect(last).toContain("Fictional Organisation 120");
    expect(last).toContain('href="/sales/clients?page=2"');
    // the header always counts the whole list, not the page
    expect(last).toContain("120 organisations · 121 contacts.");
  });

  it("the pager keeps the search and the type", async () => {
    orgs = many(120);
    const html = await render({ q: "Fictional", kind: "agency" });
    expect(html).toContain('href="/sales/clients?q=Fictional&amp;kind=agency&amp;page=2"');
  });

  it("a search says how many match out of how many, and a match on a contact arrives with that organisation open", async () => {
    orgs = [org(1, "Zeta Media"), org(2, "Fictional Harbour Studio"), org(3, "Fictional Cedar Motors")];
    const html = await render({ q: "contact of fictional harbour" });
    expect(html).toContain("1 organisation matching, of 3 in all");
    expect(rowsIn(html)).toBe(1);
    expect(html).toMatch(/<details[^>]*open=""[^>]*>.*Fictional Harbour Studio/s);
    // a plain list of several stays closed, so it is short to scan
    expect(await render()).not.toMatch(/<details[^>]*open=""/);
  });

  it("choosing an organisation shows that one alone, with its contacts open and the way back", async () => {
    orgs = [org(1, "Zeta Media"), org(2, "Fictional Harbour Studio")];
    const html = await render({ org: ID(2), q: "zeta" });
    expect(rowsIn(html)).toBe(1);
    expect(html).toContain("Contact of Fictional Harbour Studio");
    expect(html).not.toContain("Contact of Zeta Media");
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(html).toContain("Showing <span class=\"font-medium\">Fictional Harbour Studio</span> only.");
    expect(html).toContain('href="/sales/clients?q=zeta"');
    expect(html).toContain(`href="/sales/accounts/${ID(2)}"`);
    // the picker is the forms' own search-as-you-type field
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Go to an organisation");
  });

  it("an organisation id that is not in the list is ignored, never an empty page", async () => {
    const html = await render({ org: "not-an-id" });
    expect(html).toContain("Zeta Media");
    expect(html).not.toContain("only.");
  });

  it("a genuinely empty result is the empty state", async () => {
    orgs = []; loose = [];
    const html = await render();
    expect(html).toContain("No clients yet");
    expect(html).not.toContain("Could not load");
  });

  it("a search that matches nothing says so and offers the way out", async () => {
    const html = await render({ q: "zzzz" });
    expect(html).toContain("Nothing matches your search");
    expect(html).toContain("Clear search");
  });

  it("a search that matches only a contact without an organisation still shows that contact", async () => {
    const html = await render({ q: "loose" });
    expect(html).toContain("Loose Person");
    expect(html).toContain("No organisation matches your search. The contacts below do.");
    expect(html).not.toContain("Nothing matches your search");
  });

  it("a failed read is 'Could not load clients and contacts', never an empty list", async () => {
    orgsFail = true;
    const html = await render();
    expect(html).toContain("Could not load clients and contacts");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No clients yet");
  });
});
