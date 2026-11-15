/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "u", grants: [], companies: [], people: [] }) }));

import { setOutreachContact } from "@/lib/actions/outreach";
import { OutreachContactControl } from "./outreach-forms";

// Fictional people.
const OUT = "77777777-7777-4777-8777-777777777777";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const contacts = [{ id: C1, name: "Aisha Buyer", roleTitle: "Marketing lead" }, { id: C2, name: "Bilal Planner", roleTitle: null }];
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

afterEach(cleanup);
beforeEach(() => rpc.mockReset().mockResolvedValue({ data: null, error: null }));

describe("the contact of an outreach", () => {
  it("offers the account's contacts, with the saved one chosen, and none as a choice", () => {
    render(<OutreachContactControl outreachId={OUT} contactId={C2} contacts={contacts} />);
    const select = screen.getByLabelText("Contact for this outreach") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["No contact chosen", "Aisha Buyer · Marketing lead", "Bilal Planner"]);
    expect(select.value).toBe(C2);
    expect(screen.getByRole("button", { name: "Save contact" })).toBeTruthy();
  });

  it("an account without contacts says where to add one; a closed or converted outreach shows the contact without a form", () => {
    render(<OutreachContactControl outreachId={OUT} contactId={null} contacts={[]} />);
    expect(screen.getByTestId("outreach-contact").textContent).toMatch(/has no contacts yet/);
    cleanup();
    render(<OutreachContactControl outreachId={OUT} contactId={C1} contacts={contacts} readOnly />);
    expect(screen.getByTestId("outreach-contact").textContent).toBe("Contact: Aisha Buyer · Marketing lead");
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<OutreachContactControl outreachId={OUT} contactId={null} contacts={contacts} readOnly />);
    expect(screen.getByTestId("outreach-contact").textContent).toBe("Contact: None chosen");
  });

  it("saving sends the chosen contact, or none, to the database function; a refusal is said in words", async () => {
    expect((await setOutreachContact({ error: null }, fd({ outreachId: OUT, contactId: C1 }))).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("crm_outreach_set_contact", { p_outreach: OUT, p_contact: C1 });
    await setOutreachContact({ error: null }, fd({ outreachId: OUT, contactId: "" }));
    expect(rpc).toHaveBeenLastCalledWith("crm_outreach_set_contact", { p_outreach: OUT, p_contact: null });
    expect((await setOutreachContact({ error: null }, fd({ outreachId: OUT, contactId: "not-an-id" }))).error).toMatch(/Choose one of the account's contacts/);
    rpc.mockResolvedValue({ data: null, error: { message: "Choose one of this account's own contacts. Add the person to the account first" } });
    expect((await setOutreachContact({ error: null }, fd({ outreachId: OUT, contactId: C1 }))).error).toMatch(/account's own contacts/);
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_outreach_set_contact in the schema cache" } });
    expect((await setOutreachContact({ error: null }, fd({ outreachId: OUT, contactId: C1 }))).error).toMatch(/not available in this environment yet/);
  });
});
