/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const { mark } = vi.hoisted(() => ({ mark: (name: string) => () => `ACTION:${name}` as unknown as null }));
vi.mock("@/components/workspace/list-memory", () => ({ BackLink: ({ children, section, fallback }: { children: React.ReactNode; section: string; fallback: string }) => <span data-back={section} data-fallback={fallback}>{children}</span> }));
vi.mock("@/components/sales/company-memory", () => ({ SalesCompanyMemory: ({ companyId }: { companyId: string }) => <span data-company-memory={companyId} /> }));
vi.mock("./activity-panel", () => ({ ActivityPanel: mark("panel-activity") }));
vi.mock("./commercial-panel", () => ({ CommercialPanel: mark("panel-commercial") }));
vi.mock("./files-panel", () => ({ FilesPanel: mark("panel-files") }));
vi.mock("./overview-panel", () => ({ OverviewPanel: mark("panel-overview") }));
vi.mock("./proposals-panel", () => ({ ProposalsPanel: mark("panel-proposals") }));
vi.mock("./quotations-panel", () => ({ QuotationsPanel: mark("panel-quotations") }));
vi.mock("./scope-panel", () => ({ ScopePanel: mark("panel-scope"), toEditable: () => ({}) }));
vi.mock("./enquiry-guide", () => ({ EnquiryGuide: mark("guide") }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), Suspense: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./detail-tabs", () => ({ DetailTabs: ({ initial, syncAddress }: { initial: string; syncAddress?: boolean }) => `TABS:${initial}:${syncAddress ? "synced" : "unsynced"}` as unknown as null }));

const opp = { id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-UAE-2026-0001", title: "Launch", stage: "new", currency: "AED", value: 100, version: 3, closed_at: null, evidence_type: null, hold_review_date: null, stage_before_close: null };
const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Enginious UAE", countryCode: "AE", settings: null }], people: [], personName: () => "Sales Owner", companyName: () => "Enginious UAE" };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
let outcome: { kind: string } = { kind: "ok" };
let failedSections: string[] = [];
let followUps: unknown[] = [{ id: "f1", status: "open", title: "Call", due_at: new Date().toISOString(), assigned_to: "u1", kind: "call" }];
const detail = () => ({
  item: { opp, value: 100, companyName: "Enginious UAE", ownerName: "Sales Owner", agency: null, client: { id: "org1", name: "Orbit" }, nextFollowUp: (followUps[0] ?? null), openFollowUps: followUps.length, availability: "unverified" },
  contacts: [], activities: [], followUps, events: [], files: [], proposals: [], zoho: null, approvals: [], handover: null, closures: [], estimateSends: [], estimateSendsInstalled: true,
});
vi.mock("@/lib/crm/data", () => ({
  loadOpportunityDetailResult: async () => (outcome.kind === "ok" ? { kind: "ok", failed: new Set(failedSections), detail: detail() } : outcome),
  loadOrganisations: async () => ({ organisations: [], unassignedContacts: [] }),
}));

import OpportunityPage from "./page";
const render = async (search: { tab?: string; from?: string } = {}) => renderToStaticMarkup(await OpportunityPage({ params: Promise.resolve({ id: "o1" }), searchParams: Promise.resolve(search) }));
beforeEach(() => { outcome = { kind: "ok" }; failedSections = []; followUps = [{ id: "f1", status: "open", title: "Call", due_at: new Date().toISOString(), assigned_to: "u1", kind: "call" }]; });

describe("Enquiry page: a failed read is 'Could not load', distinct from not found, no access and an empty result", () => {
  it("the enquiry could not be read: 'Could not load' with a retry link and none of the header actions", async () => {
    outcome = { kind: "error" };
    const html = await render();
    expect(html).toContain("Could not load this enquiry");
    expect(html).toContain('href="/sales/opportunities/o1"');
    expect(html).toContain("Try again");
    expect(html).toContain("This is not a missing enquiry");
    for (const absent of ["ACTION:", "TABS", "Close as won", "Close as lost", "do not have access", "Opportunity actions"]) expect(html).not.toContain(absent);
  });
  it("a missing enquiry is the not-found page", async () => {
    outcome = { kind: "not_found" };
    await expect(render()).rejects.toThrow("notFound");
  });
  it("a refused read says 'no access' (not 'could not load', not 'not found') and offers nothing", async () => {
    outcome = { kind: "denied" };
    const html = await render();
    expect(html).toContain("You do not have access to this enquiry");
    expect(html).not.toContain("Could not load");
    expect(html).not.toContain("ACTION:");
  });
  it("a successful read shows the title, the company and currency, ONE summary and the tabs; the actions are the summary's (tested in summary.test.tsx)", async () => {
    const html = await render();
    expect(html).toContain("TABS:overview:synced");
    expect(html).toContain("OPP-UAE-2026-0001");
    expect(html).toContain("Enginious UAE");
    expect(html).toContain("AED");
    expect(html.match(/ACTION:guide/g)).toHaveLength(1);
    expect(html).not.toContain("Could not load");
    // The old row of equal buttons and the repeated status alerts are gone from the page itself.
    for (const gone of ["Opportunity actions", "Close as won", "Put on hold"]) expect(html).not.toContain(gone);
  });
  it("the summary is always rendered for a read enquiry, whatever part of it failed", async () => {
    followUps = [];
    expect(await render()).toContain("ACTION:guide");
    failedSections = ["followUps", "proposals", "zoho", "handover"];
    expect(await render()).toContain("ACTION:guide");
  });
  it("opens on the tab the address names, and the tabs keep the address in step", async () => {
    expect(await render({ tab: "commercial" })).toContain("TABS:commercial:synced");
  });
  it("remembers the enquiry's company for the next Sales page", async () => {
    expect(await render()).toContain('data-company-memory="c1"');
  });
  it("Back returns to the list the person came from: Follow-ups with from=follow-ups, otherwise Enquiries (also on a failed read)", async () => {
    expect(await render()).toContain('data-back="enquiries" data-fallback="/sales/opportunities"');
    const fromFollowUps = await render({ from: "follow-ups" });
    expect(fromFollowUps).toContain('data-back="follow-ups" data-fallback="/sales/follow-ups"');
    expect(fromFollowUps).toContain(">Follow-ups<");
    // Any other value is ignored: only the two known lists are ever used.
    expect(await render({ from: "https://elsewhere.example" })).toContain('data-back="enquiries"');
    outcome = { kind: "error" };
    expect(await render({ from: "follow-ups" })).toContain('data-back="follow-ups"');
  });
});
