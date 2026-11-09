/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DetailSection } from "@/lib/crm/data";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const { stub } = vi.hoisted(() => ({ stub: (name: string) => () => `ACTION:${name}` as unknown as null }));
vi.mock("@/components/sales/follow-up-dialogs", () => ({ NewFollowUpButton: stub("add-follow-up"), CompleteFollowUpButton: stub("complete-follow-up"), RescheduleFollowUpButton: stub("reschedule"), CancelFollowUpButton: stub("cancel-follow-up") }));
vi.mock("./add-activity-form", () => ({ AddActivityForm: stub("log-activity") }));
vi.mock("./proposal-forms", () => ({ AddProposalForm: stub("add-proposal"), ProposalStatusButton: stub("proposal-status") }));
vi.mock("./commercial-forms", () => ({ ZohoForm: stub("zoho-form"), ConfirmAvailabilityButton: stub("confirm-availability"), DecideApprovalButton: stub("decide-approval") }));
vi.mock("./quick-actions", () => ({ RequestApprovalButton: stub("request-approval"), RequestAvailabilityButton: stub("request-availability"), OpenFileButton: stub("open-file"), RemoveFileButton: stub("remove-file") }));
vi.mock("./file-forms", () => ({ AddFileForms: stub("add-file") }));
vi.mock("./contacts-panel", () => ({ ContactsPanel: stub("contacts") }));
vi.mock("@/components/sales/action-form", () => ({ ActionForm: stub("action-form"), Field: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/actions/quotations", () => ({ createQuotation: vi.fn() }));
vi.mock("@/lib/crm/quotations/data", () => ({ loadQuotationList: async () => [] }));
vi.mock("@/lib/crm/data", () => ({ loadEstimateMarks: async () => new Map() }));

import { ActivityPanel } from "./activity-panel";
import { CommercialPanel } from "./commercial-panel";
import { FilesPanel } from "./files-panel";
import { FollowUpsPanel } from "./follow-ups-panel";
import { OverviewPanel } from "./overview-panel";
import { ProposalsPanel } from "./proposals-panel";
import { QuotationsPanel } from "./quotations-panel";
import { buildOppView } from "./view";

const opp = {
  id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-X-2026-0001", title: "Launch", stage: "new", currency: "AED", value: 100, source: "website", brief: null, created_at: "2026-11-01T00:00:00Z", created_by: "u1",
  stage_changed_at: "2026-11-01T00:00:00Z", first_response_at: null, availability_state: "unverified", availability_covers: null, technologies: [], version: 1, budget_note: null, evidence_type: null, evidence_reference: null, evidence_date: null,
};
const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Enginious UAE", countryCode: "AE", settings: { approval_policy: "required" } }], people: [], personName: () => "Sales Owner", companyName: () => "Enginious UAE" };
const detail = () => ({
  item: { opp, value: 100, companyName: "Enginious UAE", ownerName: "Sales Owner", agency: null, client: null, nextFollowUp: null, openFollowUps: 0, availability: "unverified" },
  contacts: [], activities: [], followUps: [], events: [], files: [], proposals: [], zoho: null, approvals: [], handover: null, closures: [],
});
const view = (...failed: DetailSection[]) => buildOppView(ctx as never, detail() as never, new Set(failed));
const html = async (c: React.ReactNode | Promise<React.ReactNode>) => renderToStaticMarkup(await c as React.ReactElement);
const actions = (h: string) => [...h.matchAll(/ACTION:([a-z-]+)/g)].map((m) => m[1]);

describe("an enquiry section that could not be read says so and offers no action that depends on it", () => {
  it("Follow-ups: 'Could not load', no add, complete, reschedule or cancel; a successful empty list still offers 'add'", async () => {
    const failed = await html(<FollowUpsPanel view={view("followUps")} />);
    expect(failed).toContain("Could not load the follow-ups");
    expect(failed).not.toContain("No open follow-up");
    expect(actions(failed)).toEqual([]);
    const empty = await html(<FollowUpsPanel view={view()} />);
    expect(empty).toContain("No open follow-up");
    expect(empty).not.toContain("Could not load");
    expect(actions(empty)).toContain("add-follow-up");
  });

  it("Activity: a failed timeline is 'Could not load' (not 'Nothing has been recorded yet'); a failed follow-up read withholds the log form; a failed closure read is its own message", async () => {
    const timeline = await html(<ActivityPanel view={view("activities")} />);
    expect(timeline).toContain("Could not load the timeline");
    expect(timeline).not.toContain("Nothing has been recorded yet");
    const events = await html(<ActivityPanel view={view("events")} />);
    expect(events).toContain("Could not load the timeline");
    const fu = await html(<ActivityPanel view={view("followUps")} />);
    expect(fu).toContain("Could not load the follow-ups");
    expect(actions(fu)).not.toContain("log-activity");
    const closures = await html(<ActivityPanel view={view("closures")} />);
    expect(closures).toContain("Could not load the closure history");
    const ok = await html(<ActivityPanel view={view()} />);
    expect(ok).toContain("Nothing has been recorded yet");
    expect(actions(ok)).toContain("log-activity");
    expect(ok).not.toContain("Could not load");
  });

  it("Proposals: versions, files or approvals failing is 'Could not load', never 'No proposal recorded yet', and nothing can be added or recorded", async () => {
    for (const s of ["proposals", "files", "approvals"] as const) {
      const h = await html(await ProposalsPanel({ view: view(s) }));
      expect(h, s).toContain("Could not load the proposal versions");
      expect(h, s).not.toContain("No proposal recorded yet");
      expect(actions(h), s).toEqual([]);
    }
    const ok = await html(await ProposalsPanel({ view: view() }));
    expect(ok).toContain("No proposal recorded yet");
    expect(actions(ok)).toContain("add-proposal");
  });

  it("Files: failed is 'Could not load', not 'No files or links yet', and nothing can be added or removed", async () => {
    for (const s of ["files", "proposals"] as const) {
      const h = await html(<FilesPanel view={view(s)} />);
      expect(h, s).toContain("Could not load the files and links");
      expect(h, s).not.toContain("No files or links yet");
      expect(actions(h), s).toEqual([]);
    }
    const ok = await html(<FilesPanel view={view()} />);
    expect(ok).toContain("No files or links yet");
    expect(actions(ok)).toContain("add-file");
  });

  it("Commercial: Zoho failing withholds the form; approvals or proposals failing withhold Request and Decide; availability is unaffected", async () => {
    const zoho = await html(<CommercialPanel view={view("zoho")} />);
    expect(zoho).toContain("Could not load the Zoho Books references");
    expect(actions(zoho)).not.toContain("zoho-form");
    expect(actions(zoho)).toContain("request-availability");
    expect(zoho).not.toContain("Could not load the approval history");
    for (const s of ["approvals", "proposals"] as const) {
      const h = await html(<CommercialPanel view={view(s)} />);
      expect(h, s).toContain("Could not load the approval history");
      expect(actions(h), s).not.toContain("request-approval");
      expect(actions(h), s).not.toContain("decide-approval");
      expect(actions(h), s).toContain("zoho-form");
    }
    const ok = await html(<CommercialPanel view={view()} />);
    expect(ok).not.toContain("Could not load");
    expect(actions(ok)).toEqual(expect.arrayContaining(["zoho-form", "request-approval"]));
  });

  it("Overview: failed contacts, approvals and follow-ups are marked in place; contacts cannot be managed", async () => {
    const h = await html(<OverviewPanel view={view("contacts", "approvals", "followUps")} />);
    expect(h).toContain("Could not load the contacts");
    expect(h).toContain("Could not load the approval history");
    expect(h).toContain("Could not load the follow-ups");
    expect(actions(h)).toEqual([]);
    expect(h).not.toContain("No open follow-up");
  });

  it("Estimates tab: failed proposals or approvals is 'Could not load', not 'No estimate yet'", async () => {
    for (const s of ["proposals", "approvals"] as const) {
      const h = await html(await QuotationsPanel({ view: view(s) }));
      expect(h, s).toContain("Could not load the estimates");
      expect(h, s).not.toContain("No estimate yet");
    }
    expect(await html(await QuotationsPanel({ view: view() }))).toContain("No estimate yet");
  });
});
