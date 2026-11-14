/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/projects/handovers", redirect: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/lib/actions/projectsCore", () => ({ acceptHandover: vi.fn(), assignHandoverPm: vi.fn(), requestHandoverClarification: vi.fn(), saveHandover: vi.fn(), saveAndSubmitHandover: vi.fn(), withdrawHandover: vi.fn() }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, { proj_staff_directory: rows([]) }) }));
let grants = [{ companyId: "c1", capabilities: ["founder"] }];
vi.mock("@/lib/projects/context", () => ({
  getProjectsContext: async () => ({ userId: "u1", grants, people: [{ id: "u1", name: "Fictional Pm", companyIds: ["c1"] }], companyName: () => "Fictional Co" }),
}));

import { HandoverBrief } from "@/components/projects/handover-brief";
import { ProjectHandoverPanel } from "../../sales/opportunities/[id]/handover/project-handover";
import type { ProjHandoverRow } from "@/types/projects";
import HandoversPage from "./page";

// Fictional handover, waiting on the viewer (u1) as Project Manager.
const H: ProjHandoverRow = {
  id: "11111111-1111-4111-8111-111111111111", company_id: "c1", crm_opportunity_id: "o1", crm_reference: "UAE-S-9", status: "pm_assigned", prepared_by: "u2", sales_owner_id: "u2",
  title: "Fictional Expo stand", client_name: "Northwind Events", location: "Hall 4, Dubai", site_timezone: "Asia/Dubai", install_start: "2027-02-01", event_start: "2027-02-03", event_end: "2027-02-05",
  technologies: [{ name: "LED wall", qty: 2 }], scope: "Two LED walls, installed and run", exclusions: null, risks: ["Venue power unconfirmed"], notes: "Loading bay closes at 18:00",
  pm_user_id: "u1", pm_assigned_by: "u3", pm_assigned_at: "2027-01-12T08:00:00Z", clarification_note: null, clarification_requested_at: null, clarification_requested_by: null,
  submitted_at: "2027-01-11T08:00:00Z", accepted_by: null, accepted_at: null, project_id: null, revision: 1, version: 3, created_at: "2027-01-10T08:00:00Z", updated_at: "2027-01-12T08:00:00Z",
};
const page = async () => renderToStaticMarkup(await HandoversPage());
/** Every submit button of the page with its classes, whatever order the attributes are written in. */
const submitButtons = (html: string) => [...html.matchAll(/<button ([^>]*)>([^<]*)</g)].filter((m) => m[1]!.includes('type="submit"')).map((m) => ({ cls: /class="([^"]*)"/.exec(m[1]!)?.[1] ?? "", text: m[2]! }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(() => { grants = [{ companyId: "c1", capabilities: ["founder"] }]; tables = { proj_handovers: rows([H]) }; });

describe("the Project Manager's side of a handover", () => {
  it("shows the brief with the same component and markup Sales sees on the enquiry", async () => {
    const html = await page();
    const brief = renderToStaticMarkup(<HandoverBrief h={H} clarification={null} salesHref={null} />);
    expect(html).toContain(brief);
    const sales = renderToStaticMarkup(<ProjectHandoverPanel state={{ installed: true, status: { handover_id: H.id, status: "pm_assigned", pm_name: "Fictional Pm", project_id: null, project_reference: null, clarification_note: null }, row: H }}
      opportunityId="o1" canEdit defaults={{ title: "", clientName: "", location: "", siteTimezone: "Asia/Dubai", installStart: "", eventStart: "", eventEnd: "", scope: "", exclusions: "", notes: "", technologies: [] }} personName={() => "Fictional Sales"} />);
    expect(sales).toContain(brief);
  });

  it("Accept is the one primary button; changing the Project Manager and asking Sales are secondary", async () => {
    const html = await page();
    const primary = submitButtons(html);
    expect(primary.map((b) => b.text)).toEqual(["Accept handover", "Change Project Manager"]);
    expect(primary[0]!.cls).toContain("text-primary-foreground");
    expect(primary[1]!.cls).not.toContain("text-primary-foreground");
    expect(html).toContain("Ask Sales a question");
    expect(html).toContain("a second one is never created");
  });

  it("naming the first Project Manager is the primary button on a submitted handover", async () => {
    tables = { proj_handovers: rows([{ ...H, status: "submitted", pm_user_id: null, pm_assigned_at: null }]) };
    const html = await page();
    const buttons = submitButtons(html);
    expect(buttons.map((b) => b.text)).toEqual(["Assign Project Manager"]);
    expect(buttons[0]!.cls).toContain("text-primary-foreground");
  });

  it("links back to the enquiry only when this person can read it in Sales: never a dead link", async () => {
    // No Sales access: the enquiry is not returned to this session, so the reference is plain text.
    let html = await page();
    expect(html).not.toContain("/sales/opportunities/");
    expect(html).toContain("UAE-S-9");
    // Sales access: the enquiry is readable, so the link is offered.
    tables = { proj_handovers: rows([H]), crm_opportunities: rows([{ id: "o1" }]) };
    html = await page();
    expect(html).toContain('href="/sales/opportunities/o1/handover"');
    expect(html).toContain("Open the enquiry in Sales (UAE-S-9)");
  });

  it("a failed Sales-access check says so and offers no link; the handover is still shown", async () => {
    tables = { proj_handovers: rows([H]), crm_opportunities: failing() };
    const html = await page();
    expect(html).toContain("Could not load whether you can open the Sales enquiries");
    expect(html).not.toContain("/sales/opportunities/");
    expect(html).toContain("Fictional Expo stand");
  });

  it("an accepted brief is kept, read-only, with the project one click away", async () => {
    const accepted = { ...H, status: "accepted", project_id: "p1", accepted_at: "2027-01-13T08:00:00Z" };
    tables = { proj_handovers: rows([accepted]) };
    const html = renderToStaticMarkup(await HandoversPage({ searchParams: Promise.resolve({ handover: H.id }) }));
    expect(html).toContain("Accepted brief, kept as agreed");
    expect(html).toContain(renderToStaticMarkup(<HandoverBrief h={accepted} clarification={null} salesHref={null} />));
    expect(html).toContain('href="/projects/p1/work"');
    expect(count(html, "Accept handover")).toBe(0);
    expect(html).not.toContain("Change Project Manager");
  });
});
