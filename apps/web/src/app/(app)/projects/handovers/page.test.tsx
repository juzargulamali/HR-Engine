/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/projects/handovers", redirect: vi.fn() }));
vi.mock("@/components/projects/handover-brief", () => ({ HandoverBrief: ({ h }: { h: { id: string } }) => <div data-brief={h.id}>BRIEF</div> }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("./handover-actions", () => ({ AssignPmForm: () => null, HandoverDecision: ({ handoverId }: { handoverId: string }) => <div data-decision={handoverId}>DECISION</div> }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
vi.mock("@/lib/projects/context", () => ({
  getProjectsContext: async () => ({ userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], people: [], companyName: () => "Enginious" }),
}));

import HandoversPage from "./page";

const HANDOVER = {
  id: "h1", company_id: "c1", title: "Expo stage", status: "submitted", crm_reference: "UAE-S-9", prepared_by: "u2", pm_user_id: null, pm_assigned_at: null, revision: 1,
  accepted_at: null, clarification_note: null, clarification_requested_at: null, project_id: null, submitted_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
};

beforeEach(() => { tables = { proj_handovers: rows([HANDOVER]) }; rpcs = { proj_staff_directory: rows([]) }; });

describe("Handovers page", () => {
  it("healthy: lists the handover", async () => {
    const html = renderToStaticMarkup(await HandoversPage());
    expect(html).toContain("Expo stage");
    expect(html).not.toContain("Could not load");
  });
  it("a successful read with none still says there are none", async () => {
    tables = { proj_handovers: rows([]) };
    expect(renderToStaticMarkup(await HandoversPage())).toContain("No handovers to show");
  });
  it("a failed read is an error with a retry, never 'No handovers to show'", async () => {
    tables = { proj_handovers: failing() };
    const html = renderToStaticMarkup(await HandoversPage());
    expect(html).toContain("Could not load the handovers");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No handovers to show");
  });
  it("a failed staff-directory read does not show people as unknown Sales colleagues", async () => {
    rpcs = { proj_staff_directory: failing() };
    const html = renderToStaticMarkup(await HandoversPage());
    expect(html).toContain("Could not load the staff names");
    expect(html).toContain("name could not load");
    expect(html).not.toContain("a Sales colleague");
    expect(html).toContain("Expo stage");
  });
  it("a readable directory that simply lacks the person keeps the plain label", async () => {
    expect(renderToStaticMarkup(await HandoversPage())).toContain("a Sales colleague");
  });

  const OLD = "11111111-1111-4111-8111-111111111111";
  const NEW = "22222222-2222-4222-8222-222222222222";
  const pending = (id: string, title: string, submitted: string) => ({ ...HANDOVER, id, title, status: "pm_assigned", pm_user_id: "u1", submitted_at: submitted, updated_at: submitted });
  const accepted = (n: number) => ({ ...HANDOVER, id: `acc-${n}`, title: `Accepted job ${n}`, status: "accepted", pm_user_id: "u9", project_id: `p-${n}`, accepted_at: "2026-10-01T08:00:00Z" });

  it("an old pending handover stays at the top however long the history is, with the decision on it; history is a separate, paged list", async () => {
    tables = { proj_handovers: { data: [...Array.from({ length: 30 }, (_, i) => accepted(i)), pending(NEW, "Newer pending", "2026-11-10T08:00:00Z"), pending(OLD, "Old pending from March", "2026-03-01T08:00:00Z")], error: null, count: 230 } };
    const html = renderToStaticMarkup(await HandoversPage({ searchParams: Promise.resolve({ page: "7" }) }));
    expect(html).toContain("Waiting on you as Project Manager (2)");
    expect(html.indexOf("Old pending from March")).toBeLessThan(html.indexOf("Newer pending"));        // the longest wait first
    expect(html.indexOf("Old pending from March")).toBeLessThan(html.indexOf("Accepted and withdrawn (230)"));
    expect(html).toContain(`data-decision="${OLD}"`);
    expect(html).toContain("Page 7 of 12");
    expect(html).toContain("/projects/p-0/work");                                                       // an accepted one opens its project's Work page
  });
  it("a direct link opens that brief first, in full, whatever page the list is on; the other lists do not repeat it", async () => {
    tables = { proj_handovers: rows([pending(OLD, "Old pending from March", "2026-03-01T08:00:00Z"), pending(NEW, "Newer pending", "2026-11-10T08:00:00Z")]) };
    const html = renderToStaticMarkup(await HandoversPage({ searchParams: Promise.resolve({ handover: OLD, page: "3" }) }));
    expect(html).toContain("The handover you opened");
    expect(html.indexOf("The handover you opened")).toBeLessThan(html.indexOf("Waiting on you as Project Manager"));
    expect(html.split(`data-brief="${OLD}"`).length - 1).toBe(1);
    expect(html).toContain(`id="handover-${OLD}"`);
    expect(html).toContain(`data-decision="${OLD}"`);
  });
  it("a link to a handover the person cannot see says so and shows no brief; a malformed id is ignored", async () => {
    const html = renderToStaticMarkup(await HandoversPage({ searchParams: Promise.resolve({ handover: "33333333-3333-4333-8333-333333333333" }) }));
    expect(html).toContain("That handover is not available to you");
    expect(html).not.toContain("The handover you opened");
    expect(renderToStaticMarkup(await HandoversPage({ searchParams: Promise.resolve({ handover: "not-an-id" }) }))).not.toContain("not available to you");
  });
  it("someone who asked Sales a question sees that it is with Sales and no Accept until Sales resubmits", async () => {
    tables = { proj_handovers: rows([{ ...pending(OLD, "Asked", "2026-03-01T08:00:00Z"), status: "clarification_requested", clarification_note: "Which hall?" }]) };
    const html = renderToStaticMarkup(await HandoversPage());
    expect(html).toContain("You asked Sales a question");
    expect(html).not.toContain("data-decision");
  });
});
