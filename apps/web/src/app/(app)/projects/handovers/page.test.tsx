/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/projects/handovers", redirect: vi.fn() }));
vi.mock("@/components/projects/handover-brief", () => ({ HandoverBrief: () => null }));
vi.mock("./handover-actions", () => ({ AcceptHandoverForm: () => null, AssignPmForm: () => null, ClarifyHandoverForm: () => null }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, { proj_staff_directory: rows([]) }) }));
vi.mock("@/lib/projects/context", () => ({
  getProjectsContext: async () => ({ userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], people: [], companyName: () => "Enginious" }),
}));

import HandoversPage from "./page";

const HANDOVER = {
  id: "h1", company_id: "c1", title: "Expo stage", status: "submitted", crm_reference: "UAE-S-9", prepared_by: "u2", pm_user_id: null, pm_assigned_at: null, revision: 1,
  accepted_at: null, clarification_note: null, clarification_requested_at: null, project_id: null, submitted_at: "2026-11-01T08:00:00Z", updated_at: "2026-11-01T08:00:00Z",
};

beforeEach(() => { tables = { proj_handovers: rows([HANDOVER]) }; });

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
});
