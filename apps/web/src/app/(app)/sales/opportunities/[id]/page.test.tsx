/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const { mark } = vi.hoisted(() => ({ mark: (name: string) => () => `ACTION:${name}` as unknown as null }));
vi.mock("@/components/workspace/list-memory", () => ({ BackLink: ({ children }: { children: React.ReactNode }) => <span data-back="enquiries">{children}</span> }));
vi.mock("@/components/sales/won-handover-prompt", () => ({ WonHandoverPrompt: mark("won-handover-prompt") }));
vi.mock("@/components/sales/follow-up-dialogs", () => ({ NewFollowUpButton: mark("add-follow-up") }));
vi.mock("./activity-panel", () => ({ ActivityPanel: mark("panel-activity") }));
vi.mock("./assign-owner", () => ({ AssignOwnerButton: mark("assign-owner") }));
vi.mock("./commercial-panel", () => ({ CommercialPanel: mark("panel-commercial") }));
vi.mock("./edit-details", () => ({ EditDetailsButton: mark("edit-details") }));
vi.mock("./files-panel", () => ({ FilesPanel: mark("panel-files") }));
vi.mock("./overview-panel", () => ({ OverviewPanel: mark("panel-overview") }));
vi.mock("./proposals-panel", () => ({ ProposalsPanel: mark("panel-proposals") }));
vi.mock("./quotations-panel", () => ({ QuotationsPanel: mark("panel-quotations") }));
vi.mock("./reopen-dialog", () => ({ ReopenButton: mark("reopen") }));
vi.mock("./scope-panel", () => ({ ScopePanel: mark("panel-scope"), toEditable: () => ({}) }));
vi.mock("./stage-actions", () => ({ HoldButton: mark("hold"), MoveStageButton: mark("move-stage"), ResumeButton: mark("resume") }));
vi.mock("./detail-tabs", () => ({ DetailTabs: () => "TABS" as unknown as null }));

const opp = { id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-UAE-2026-0001", title: "Launch", stage: "new", currency: "AED", value: 100, version: 3, closed_at: null, evidence_type: null, hold_review_date: null, stage_before_close: null };
const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Enginious UAE", countryCode: "AE", settings: null }], people: [], personName: () => "Sales Owner", companyName: () => "Enginious UAE" };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
let outcome: { kind: string } = { kind: "ok" };
let failedSections: string[] = [];
let followUps: unknown[] = [{ id: "f1", status: "open", title: "Call", due_at: new Date().toISOString(), assigned_to: "u1", kind: "call" }];
const detail = () => ({
  item: { opp, value: 100, companyName: "Enginious UAE", ownerName: "Sales Owner", agency: null, client: { id: "org1", name: "Orbit" }, nextFollowUp: (followUps[0] ?? null), openFollowUps: followUps.length, availability: "unverified" },
  contacts: [], activities: [], followUps, events: [], files: [], proposals: [], zoho: null, approvals: [], handover: null, closures: [],
});
vi.mock("@/lib/crm/data", () => ({
  loadOpportunityDetailResult: async () => (outcome.kind === "ok" ? { kind: "ok", failed: new Set(failedSections), detail: detail() } : outcome),
  loadOrganisations: async () => ({ organisations: [], unassignedContacts: [] }),
}));

import OpportunityPage from "./page";
const render = async () => renderToStaticMarkup(await OpportunityPage({ params: Promise.resolve({ id: "o1" }), searchParams: Promise.resolve({}) }));
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
  it("a successful read shows the header actions and the tabs", async () => {
    const html = await render();
    expect(html).toContain("TABS");
    expect(html).toContain("Close as won");
    expect(html).toContain("ACTION:move-stage");
    expect(html).not.toContain("Could not load");
  });
  it("a successful read with no follow-up still warns 'No next action is scheduled' and offers to add one", async () => {
    followUps = [];
    const html = await render();
    expect(html).toContain("No next action is scheduled");
    expect(html).toContain("ACTION:add-follow-up");
  });
  it("failed follow-ups: the next action says 'Could not load', there is NO 'No next action is scheduled' warning and no add button", async () => {
    followUps = [];
    failedSections = ["followUps"];
    const html = await render();
    expect(html).toContain("Could not load");
    expect(html).not.toContain("No next action is scheduled");
    expect(html).not.toContain("ACTION:add-follow-up");
    expect(html).not.toContain("None scheduled");
  });
  it("failed proposals or Zoho references: no stage move is offered (its requirement hints would be wrong) and it says why; hold and close stay", async () => {
    for (const s of ["proposals", "zoho"]) {
      failedSections = [s];
      const html = await render();
      expect(html, s).toContain("Stage moves are not offered because the proposals or Zoho references could not be loaded");
      expect(html, s).not.toContain("ACTION:move-stage");
      expect(html, s).toContain("ACTION:hold");
    }
  });
  it("a failed handover read: Reopen is not offered on a Won enquiry and it says why", async () => {
    Object.assign(opp, { stage: "won", closed_at: "2026-11-02T00:00:00Z", evidence_type: "purchase_order" });
    try {
      expect(await render()).toContain("ACTION:reopen");
      failedSections = ["handover"];
      const html = await render();
      expect(html).not.toContain("ACTION:reopen");
      expect(html).toContain("Reopen is not offered because the handover record could not be loaded");
    } finally { Object.assign(opp, { stage: "new", closed_at: null, evidence_type: null }); }
  });
});
