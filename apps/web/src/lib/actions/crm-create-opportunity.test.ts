import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error { constructor(public to: string) { super(`redirect:${to}`); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); } }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: () => ({}) }) }));
let salesContext: unknown = null;
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => salesContext }));

import { createOpportunity } from "./crm";

const ME = "33333333-3333-4333-8333-333333333333";
const UAE = "11111111-1111-4111-8111-111111111111";
const EUROPE = "22222222-2222-4222-8222-222222222222";
const NO_SETTINGS = "55555555-5555-4555-8555-555555555555";
const ORG = "44444444-4444-4444-8444-444444444444";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const base = { companyId: UAE, title: "Fictional LED tunnel", source: "agency_call", agencyOrgId: ORG, nextTitle: "Call the fictional agency", nextDate: "2026-12-01", nextTime: "11:00" };
const created = () => rpc.mock.calls.filter((c) => c[0] === "crm_create_opportunity").map((c) => c[1] as Record<string, unknown>);

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: "new-id", error: null });
  // The person holds Sales access to Fictional UAE and to a company that has no Sales settings yet. They hold none to Fictional Europe.
  salesContext = {
    userId: ME, grants: [{ companyId: UAE, capabilities: [] }, { companyId: NO_SETTINGS, capabilities: [] }], people: [],
    companies: [{ id: UAE, name: "Fictional UAE", settings: { default_quote_currency: "AED" } }, { id: NO_SETTINGS, name: "Fictional Unset Co", settings: null }],
  };
});

describe("createOpportunity: the company is checked against the person's Sales access before anything is saved", () => {
  it("saves to the posted company and passes the posted currency through", async () => {
    await expect(createOpportunity({ error: null }, fd({ ...base, currency: "USD" }))).rejects.toThrow("redirect:/sales/opportunities/new-id");
    expect(created()).toHaveLength(1);
    expect(created()[0]).toMatchObject({ p_company_id: UAE, p_currency: "USD" });
  });
  it("an untouched currency is sent as none, so the database uses the company's default", async () => {
    await expect(createOpportunity({ error: null }, fd({ ...base, currency: "" }))).rejects.toThrow("redirect:");
    expect(created()[0]).toMatchObject({ p_company_id: UAE, p_currency: null });
  });
  it("a company the person holds no Sales access to is refused in words and the database is never called (a changed request cannot save elsewhere)", async () => {
    const r = await createOpportunity({ error: null }, fd({ ...base, companyId: EUROPE }));
    expect(r.error).toMatch(/do not have Sales access to that company/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a company without Sales settings keeps its blocking message and nothing is sent", async () => {
    const r = await createOpportunity({ error: null }, fd({ ...base, companyId: NO_SETTINGS }));
    expect(r.error).toMatch(/Fictional Unset Co has no Sales settings yet/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an access list that could not be read saves nothing and says it could not be checked (never 'no access')", async () => {
    salesContext = { userId: ME, grants: [], companies: [], people: [], loadFailed: true };
    const r = await createOpportunity({ error: null }, fd(base));
    expect(r.error).toMatch(/could not be checked/);
    expect(r.error).not.toMatch(/do not have Sales access/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a company id that is not an id never reaches the access check or the database", async () => {
    const r = await createOpportunity({ error: null }, fd({ ...base, companyId: "all" }));
    expect(r.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("the database's own refusal still reaches the person in words (it is the real check)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "You do not have Sales access for this company" } });
    const r = await createOpportunity({ error: null }, fd(base));
    expect(r.error).toMatch(/Sales access/);
  });
});

describe("createOpportunity: where Quick Add lands", () => {
  const quick = { ...base, after: "panel" };
  it("opens the new enquiry beside the Enquiries list by default", async () => {
    await expect(createOpportunity({ error: null }, fd(quick))).rejects.toThrow("redirect:/sales/opportunities?open=new-id");
  });
  it("returns to Follow-ups, with its filters, when it was added from there", async () => {
    await expect(createOpportunity({ error: null }, fd({ ...quick, returnTo: "/sales/follow-ups?view=week&add=1" }))).rejects.toThrow("redirect:/sales/follow-ups?view=week&open=new-id");
  });
  it("an address outside the two lists is ignored", async () => {
    for (const returnTo of ["https://elsewhere.example/sales/follow-ups", "//elsewhere.example", "/people", "/sales/settings"]) {
      await expect(createOpportunity({ error: null }, fd({ ...quick, returnTo }))).rejects.toThrow("redirect:/sales/opportunities?open=new-id");
    }
  });
  it("the full form still opens the enquiry's own page", async () => {
    await expect(createOpportunity({ error: null }, fd({ ...base, returnTo: "/sales/follow-ups" }))).rejects.toThrow("redirect:/sales/opportunities/new-id");
  });
});
