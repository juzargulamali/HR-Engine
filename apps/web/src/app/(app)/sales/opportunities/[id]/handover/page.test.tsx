/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/crm", () => ({ updateHandover: vi.fn() }));
vi.mock("@/lib/actions/projectsCore", () => ({ saveHandover: vi.fn(), submitHandover: vi.fn(), withdrawHandover: vi.fn() }));
const rpc = vi.fn(async () => ({ data: [{ user_id: "u9", full_name: "Pia Manager", email: "pia@x.test", company_ids: ["c1"] }], error: null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

let canEdit = true;
const ctx = { userId: "u1", companies: [{ id: "c1", name: "Enginious KSA", countryCode: "SA", settings: null }], personName: (id: string | null) => (id === "u9" ? "Pia Manager" : "Sales Owner"), companyName: () => "Enginious KSA" };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx, displayNameFor: (p: { full_name: string | null }) => p.full_name ?? "Unnamed" }));
const opp = {
  id: "o1", company_id: "c1", reference: "OPP-KSA-2026-0001", title: "Riyadh launch", stage: "won", location: "Riyadh Front", technologies: [{ name: "LED wall", qty: 2 }], risks: [], scope: "LED wall hire", exclusions: null,
  install_start: "2026-12-01", event_start: "2026-12-03", event_end: "2026-12-05", evidence_type: "purchase_order", evidence_reference: "PO-77", evidence_date: "2026-11-20", payment_terms: "30 days",
  currency: "SAR", closed_at: "2026-11-20T10:00:00Z", availability_by: null, availability_at: null, availability_notes: null,
};
let handover: Record<string, unknown> | null = null;
vi.mock("@/lib/crm/data", () => ({
  loadOpportunityDetail: async () => ({ item: { opp, companyName: "Enginious KSA", value: 100000, availability: "confirmed" }, handover, proposals: [], files: [], contacts: [{ id: "k1" }], zoho: null }),
}));
vi.mock("../view", () => ({ buildOppView: () => ({ opp, canEdit, isWon: true, ownerName: "Sales Owner" }) }));
vi.mock("../contacts-panel", () => ({ ContactsPanel: () => null }));
let projectState: { installed: boolean; status: Record<string, unknown> | null; row: unknown };
vi.mock("./project-handover", () => ({
  loadProjectHandover: async () => projectState,
  ProjectHandoverPanel: ({ defaults }: { defaults: { siteTimezone: string; siteTimezoneNote?: string } }) => <div data-testid="brief" data-tz={defaults.siteTimezone}>{defaults.siteTimezoneNote}</div>,
}));

import HandoverPage from "./page";

const render = async () => renderToStaticMarkup(await HandoverPage({ params: Promise.resolve({ id: "o1" }) }));
beforeEach(() => { canEdit = true; handover = null; projectState = { installed: true, status: null, row: null }; });

describe("Sales handover page", () => {
  it("shows ONE process, Prepare brief to Project created, and no second PM or status form", async () => {
    const html = await render();
    for (const label of ["Prepare brief", "Submit", "Assign PM", "PM accepts", "Project created"]) expect(html).toContain(label);
    expect(html).toContain("Handover process");
    expect(html).not.toContain("Project Manager and status");
    expect(html).not.toContain("Save handover");
    expect(html).not.toContain("Two separate records");
    expect(rpc).not.toHaveBeenCalled(); // the staff directory is not even read for the old form
  });

  it("marks the step that is waiting from the handover's own status", async () => {
    projectState = { installed: true, status: { status: "submitted" }, row: null };
    const html = await render();
    expect(html).toMatch(/aria-current="step"[^>]*>.*?Assign PM/s);
    expect(html).toContain("a founder (or someone they gave PM assignment to) names the Project Manager");
  });

  it("suggests the site time zone from the enquiry's location, not always Dubai", async () => {
    const html = await render();
    expect(html).toContain('data-tz="Asia/Riyadh"');
    expect(html).toContain("the enquiry&#x27;s location mentions Riyadh");
  });

  it("keeps an earlier Sales-side record, read-only and collapsed, with its old status and Project Manager", async () => {
    handover = { status: "handed_over", pm_user_id: "u9", notes: "Site access via gate 3", prepared_at: "2026-11-21T08:00:00Z", prepared_by: "u1", handed_over_at: "2026-11-22T08:00:00Z", updated_at: "2026-11-22T08:00:00Z" };
    const html = await render();
    expect(html).toContain("Earlier Sales-side handover record (kept for history)");
    expect(html).toContain("Pia Manager");
    expect(html).toContain("Handed over");
    expect(html).toContain("Site access via gate 3");
    expect(html).not.toContain("Save handover");
  });

  it("shows no earlier-record block when the Sales-side record was never used", async () => {
    handover = { status: "draft", pm_user_id: null, notes: null, prepared_at: null, prepared_by: null, handed_over_at: null, updated_at: "x" };
    expect(await render()).not.toContain("Earlier Sales-side handover record");
  });

  it("falls back to the older Sales-side form only where Projects & Tasks is not installed", async () => {
    projectState = { installed: false, status: null, row: null };
    const html = await render();
    expect(html).toContain("Projects &amp; Tasks is not installed in this environment");
    expect(html).toContain("Project Manager and status");
    expect(html).toContain("Save handover");
    expect(html).not.toContain("Handover process");
  });

  it("offers nothing to change to a person who may not edit it", async () => {
    canEdit = false;
    handover = { status: "ready", pm_user_id: "u9", notes: null, prepared_at: null, prepared_by: null, handed_over_at: null, updated_at: "x" };
    projectState = { installed: false, status: null, row: null };
    const html = await render();
    expect(html).not.toContain("Save handover");
    expect(html).toContain("Only the owner (Sales Owner) or a founder can change this");
  });
});
