/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./close-form", () => ({ CloseForm: () => "ACTION:close-form" as unknown as null }));
const opp = { id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-UAE-2026-0001", title: "Launch", stage: "new", currency: "AED", value: 100, version: 3, closed_at: null, evidence_type: null, evidence_reference: null, evidence_date: null, lost_reason: null };
const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: [] }], companies: [{ id: "c1", name: "Enginious UAE", countryCode: "AE", settings: null }], people: [], personName: () => "Sales Owner", companyName: () => "Enginious UAE" };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
let outcome: { kind: string } = { kind: "ok" };
let failedSections: string[] = [];
vi.mock("@/lib/crm/data", () => ({
  loadOpportunityDetailResult: async () => (outcome.kind === "ok"
    ? { kind: "ok", failed: new Set(failedSections), detail: { item: { opp, value: 100, companyName: "Enginious UAE", ownerName: "Sales Owner", availability: "unverified" }, followUps: [], contacts: [], proposals: [], files: [], zoho: null, approvals: [], activities: [], events: [], handover: null, closures: [] } }
    : outcome),
}));

import CloseOpportunityPage from "./page";
const render = async (outcomeParam = "won") => renderToStaticMarkup(await CloseOpportunityPage({ params: Promise.resolve({ id: "o1" }), searchParams: Promise.resolve({ outcome: outcomeParam }) }));
beforeEach(() => { outcome = { kind: "ok" }; failedSections = []; opp.stage = "new"; });

describe("Close page (Mark Won / Mark Lost)", () => {
  it("a successful read offers the close form", async () => {
    const html = await render();
    expect(html).toContain("ACTION:close-form");
    expect(html).not.toContain("Could not load");
  });
  it("the enquiry could not be read: 'Could not load' with a retry that keeps the Close page, and NO Mark Won / close form", async () => {
    outcome = { kind: "error" };
    const html = await render();
    expect(html).toContain("Could not load this enquiry");
    expect(html).toContain('href="/sales/opportunities/o1/close"');
    expect(html).toContain("Nothing was changed");
    expect(html).not.toContain("ACTION:close-form");
    expect(html).not.toContain("do not have access");
  });
  it("a missing enquiry is the not-found page", async () => {
    outcome = { kind: "not_found" };
    await expect(render()).rejects.toThrow("notFound");
  });
  it("a refused read says 'no access', not 'could not load'", async () => {
    outcome = { kind: "denied" };
    const html = await render("lost");
    expect(html).toContain("You do not have access to this enquiry");
    expect(html).not.toContain("Could not load");
    expect(html).not.toContain("ACTION:close-form");
  });
  it("failed follow-ups: the close form (which states how many follow-ups it cancels) is not offered, and it says why", async () => {
    failedSections = ["followUps"];
    const html = await render();
    expect(html).toContain("Could not load the follow-ups");
    expect(html).toContain("the close form is not offered until they load");
    expect(html).not.toContain("ACTION:close-form");
  });
  it("another failed section (for example the files) does not block closing", async () => {
    failedSections = ["files"];
    expect(await render()).toContain("ACTION:close-form");
  });
  it("an already closed enquiry still shows its closing facts (not affected)", async () => {
    opp.stage = "won"; Object.assign(opp, { closed_at: "2026-11-02T00:00:00Z", evidence_type: "purchase_order", evidence_reference: "PO-1", evidence_date: "2026-11-01" });
    try {
      const html = await render();
      expect(html).toContain("Already closed as won");
      expect(html).not.toContain("ACTION:close-form");
    } finally { Object.assign(opp, { stage: "new", closed_at: null, evidence_type: null, evidence_reference: null, evidence_date: null }); }
  });
});
