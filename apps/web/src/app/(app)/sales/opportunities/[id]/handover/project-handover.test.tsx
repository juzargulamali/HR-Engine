/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/projectsCore", () => ({ saveHandover: vi.fn(), saveAndSubmitHandover: vi.fn(), submitHandover: vi.fn(), withdrawHandover: vi.fn() }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

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
});
