/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/projectsCore", () => ({ saveHandover: vi.fn(), saveAndSubmitHandover: vi.fn(), submitHandover: vi.fn(), withdrawHandover: vi.fn() }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import { HandoverBrief } from "@/components/projects/handover-brief";
import type { ProjHandoverRow } from "@/types/projects";
import { loadProjectHandover, ProjectHandoverPanel } from "./project-handover";

const NOT_INSTALLED = { data: null, error: { message: "Could not find the table 'public.proj_handovers' in the schema cache", code: "PGRST205" } };
const defaults = { title: "T", clientName: "", location: "", siteTimezone: "Asia/Dubai", installStart: "", eventStart: "", eventEnd: "", scope: "", exclusions: "", notes: "", technologies: [], risks: [] };
beforeEach(() => { tables = {}; rpcs = {}; });

describe("the project handover read", () => {
  it("nothing prepared yet is installed, not failed, no status", async () => {
    rpcs = { proj_handover_for_opportunity: rows([]) }; tables = { proj_handovers: row(null) };
    expect(await loadProjectHandover("o1")).toEqual({ installed: true, status: null, row: null });
  });
  it("Projects not installed here is 'not installed' (unchanged)", async () => {
    rpcs = { proj_handover_for_opportunity: NOT_INSTALLED }; tables = { proj_handovers: NOT_INSTALLED };
    expect(await loadProjectHandover("o1")).toEqual({ installed: false, status: null, row: null });
  });
  it("any OTHER failed read is 'failed', never 'nothing prepared yet' and never 'not installed'", async () => {
    rpcs = { proj_handover_for_opportunity: failing() }; tables = { proj_handovers: row(null) };
    expect(await loadProjectHandover("o1")).toMatchObject({ installed: true, failed: true });
    rpcs = { proj_handover_for_opportunity: rows([]) }; tables = { proj_handovers: failing("timeout") };
    expect(await loadProjectHandover("o1")).toMatchObject({ installed: true, failed: true });
  });
});

describe("the project handover panel", () => {
  const panel = (state: Parameters<typeof ProjectHandoverPanel>[0]["state"]) => renderToStaticMarkup(<ProjectHandoverPanel state={state} opportunityId="o1" canEdit defaults={defaults} personName={() => "Sales Owner"} />);
  it("a failed read says 'Could not load' and offers no Save, Submit or Withdraw", () => {
    const html = panel({ installed: true, failed: true, status: null, row: null });
    expect(html).toContain("Could not load the project handover");
    expect(html).not.toContain("No project handover has been prepared yet");
    expect(html).not.toMatch(/Save|Submit|Withdraw/);
  });
  it("nothing prepared yet (a successful empty read) still offers the brief to the person who may edit it", () => {
    const html = panel({ installed: true, status: null, row: null });
    expect(html).toContain("No project handover has been prepared yet");
    expect(html).not.toContain("Could not load");
  });

  // Fictional handover.
  const saved = (over: Partial<ProjHandoverRow> = {}): ProjHandoverRow => ({
    id: "h1", company_id: "c1", crm_opportunity_id: "o1", crm_reference: "UAE-S-9", status: "draft", prepared_by: "u2", sales_owner_id: "u2", title: "Fictional Expo stand",
    client_name: "Northwind Events", location: "Hall 4, Dubai", site_timezone: "Asia/Dubai", install_start: "2027-02-01", event_start: "2027-02-03", event_end: "2027-02-05",
    technologies: [{ name: "LED wall", qty: 2 }], scope: "Two LED walls, installed and run", exclusions: null, risks: ["Venue power unconfirmed"], notes: "Loading bay closes at 18:00",
    pm_user_id: null, pm_assigned_by: null, pm_assigned_at: null, clarification_note: null, clarification_requested_at: null, clarification_requested_by: null, submitted_at: null,
    accepted_by: null, accepted_at: null, project_id: null, revision: 0, version: 1, created_at: "2027-01-10T08:00:00Z", updated_at: "2027-01-10T08:00:00Z", ...over,
  });
  const status = (st: string, over: Record<string, unknown> = {}) => ({ handover_id: "h1", status: st, pm_name: null, project_id: null, project_reference: null, clarification_note: null, ...over });
  const facts = { edition: null, contactCount: 2, salesGaps: ["No accepted proposal is recorded."] };
  const withFacts = (state: Parameters<typeof ProjectHandoverPanel>[0]["state"], canEdit = true, d = defaults) =>
    renderToStaticMarkup(<ProjectHandoverPanel state={state} opportunityId="o1" canEdit={canEdit} defaults={d} personName={() => "Sales Owner"} facts={facts} />);
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it("a brief with its scope written reads 'Ready for handover', with what transfers and what needs attention", () => {
    const html = withFacts({ installed: true, status: status("draft"), row: saved() });
    expect(html).toContain('data-ready="true"');
    expect(html).toContain("Ready for handover");
    expect(html).toContain("What transfers to the project");
    for (const label of ["Project name", "Scope of work", "Exclusions", "Client", "Location", "Installation date", "Show dates", "Site time zone", "Technologies and quantities", "Risks"]) expect(html).toContain(`>${label}</dt>`);
    expect(html).toContain("Needs attention, before or after");
    expect(html).toContain("Contacts are not copied: the 2 contacts and their roles stay on the enquiry.");
    expect(html).toContain("On the enquiry: No accepted proposal is recorded.");
    // Who is told, said before the button; ONE primary button (Save and submit), Save draft and Withdraw secondary.
    expect(html).toContain("When you submit: ");
    expect(html).toContain("Nothing is sent to the client.");
    expect(count(html, ">Save and submit<")).toBe(1);
    expect(html).toContain("Withdraw this handover");
  });

  it("a missing scope stays visible as the blocker and the state is 'Not ready for handover' (before any brief is saved too)", () => {
    for (const html of [withFacts({ installed: true, status: status("draft"), row: saved({ scope: null }) }), withFacts({ installed: true, status: null, row: null })]) {
      expect(html).toContain('data-ready="false"');
      expect(html).toContain("Not ready for handover");
      expect(html).toContain("Blocks submitting:");
      expect(html).toContain("The scope of work is empty.");
    }
  });

  it("once submitted the brief is what is shown, as the Project Manager sees it, and editing is one click away with no second primary button", () => {
    const html = withFacts({ installed: true, status: status("submitted"), row: saved({ status: "submitted", submitted_at: "2027-01-11T08:00:00Z" }) });
    expect(html).toContain("Submitted: what the project will receive");
    expect(html).toContain("The brief, as the Project Manager sees it");
    expect(html).toContain('data-testid="handover-brief"');
    expect(html).toContain("Edit the submitted brief");
    expect(html).not.toContain(">Save and submit<");
    expect(html).toContain("nobody is notified again");
  });

  it("after acceptance it links to the one project, keeps the brief read-only and offers no save, submit or withdraw", () => {
    const html = withFacts({ installed: true, status: status("accepted", { project_id: "p1", project_reference: "PRJ-UAE-2027-0001" }), row: saved({ status: "accepted", project_id: "p1" }) });
    expect(html).toContain('href="/projects/p1"');
    expect(html).toContain("Open PRJ-UAE-2027-0001");
    expect(html).toContain("never a second one");
    expect(html).toContain("What the project received");
    expect(html).toContain("What was not copied");
    expect(html).toContain("The accepted brief (kept as agreed, read-only)");
    expect(html).not.toMatch(/Save changes|Save and submit|Save draft|Withdraw this handover|Blocks submitting/);
  });

  it("shows the brief with the SAME component, in the same order, as the Project Manager's page", () => {
    const h = saved({ status: "accepted", project_id: "p1" });
    const sales = withFacts({ installed: true, status: status("accepted", { project_id: "p1" }), row: h });
    const brief = renderToStaticMarkup(<HandoverBrief h={h} />);
    expect(sales).toContain(brief);
    const order = ["Agreed scope", "Site and dates", "Equipment", "Dependencies and risks", "Notes for the Project Manager"].map((t) => brief.indexOf(t));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("someone who sees only the status (not the brief) is shown no values that might not be the saved ones", () => {
    const html = withFacts({ installed: true, status: status("submitted"), row: null }, false);
    expect(html).not.toContain("What transfers to the project");
    expect(html).toContain("The brief itself is visible to the person who prepared it and to founders.");
  });
});
