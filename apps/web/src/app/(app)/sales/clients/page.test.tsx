/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./client-actions", () => ({ AddContactButton: () => null, ClientsToolbarActions: () => null }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "u1", grants: [{ companyId: "c1", capabilities: [] }] }) }));

const org = (id: string, name: string) => ({ id, name, kind: "agency", place: "Dubai", note: null, contacts: [{ id: `k-${id}`, name: `Contact of ${name}`, role_title: null, email: null, phone: null }], openCount: 1, opportunityCount: 2 });
let orgs: ReturnType<typeof org>[] = [];
let orgsFail = false;
vi.mock("@/lib/crm/data", () => ({ loadOrganisations: async () => { if (orgsFail) throw new Error("Sales data could not be loaded: down"); return { organisations: orgs, unassignedContacts: [] }; } }));

let loose: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
const builder = { select: () => builder, is: () => builder, order: async () => loose };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => builder }) }));

import ClientsPage from "./page";
const render = async (sp: { q?: string; kind?: string } = {}) => renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve(sp) }));
const looseContact = { id: "l1", name: "Loose Person", role_title: null, email: null, phone: null };

beforeEach(() => { orgs = [org("a", "Zeta Media")]; orgsFail = false; loose = { data: [looseContact], error: null }; });

describe("legacy Clients & contacts page (/sales/clients)", () => {
  it("success: organisations, their contacts and the contacts without an organisation, exactly as before", async () => {
    const html = await render();
    expect(html).toContain("Zeta Media");
    expect(html).toContain("Contact of Zeta Media");
    expect(html).toContain("Contacts without an organisation");
    expect(html).toContain("Loose Person");
    expect(html).toContain("1 organisation · 2 contacts.");
    expect(html).not.toContain("Could not load");
  });

  it("a failed read of the contacts without an organisation says 'Could not load' (never 'none'), keeps the organisations, and does not claim a complete count", async () => {
    loose = { data: null, error: { message: "permission denied" } };
    const html = await render();
    expect(html).toContain("Zeta Media");
    expect(html).toContain("Could not load the contacts without an organisation");
    expect(html).not.toContain("Contacts without an organisation</");
    expect(html).toContain("1 contact at organisations (the contacts without an organisation could not be counted)");
    expect(html).not.toContain("1 organisation · 1 contact.");
  });

  it("with no organisations and a failed loose-contacts read it is NOT the 'No clients yet' empty state", async () => {
    orgs = [];
    loose = { data: null, error: { message: "timeout" } };
    const html = await render();
    expect(html).toContain("Could not load the contacts without an organisation");
    expect(html).not.toContain("No clients yet");
  });

  it("a genuinely empty result is still the empty state", async () => {
    orgs = [];
    loose = { data: [], error: null };
    const html = await render();
    expect(html).toContain("No clients yet");
    expect(html).not.toContain("Could not load");
  });

  it("a search that matches nothing while the loose read failed does not say 'Nothing matches'", async () => {
    loose = { data: null, error: { message: "timeout" } };
    const html = await render({ q: "zzzz" });
    expect(html).toContain("No organisation matches your search");
    expect(html).toContain("Could not load the contacts without an organisation");
    expect((await render({ q: "zzzz" })).includes("Nothing matches your search")).toBe(false);
  });

  it("a failed organisations read is 'Could not load clients and contacts', not the generic error page", async () => {
    orgsFail = true;
    const html = await render();
    expect(html).toContain("Could not load clients and contacts");
    expect(html).toContain("Try again");
  });
});
