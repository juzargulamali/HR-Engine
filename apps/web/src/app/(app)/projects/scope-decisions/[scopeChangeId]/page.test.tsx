/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/projects", redirect: (to: string) => redirect(to) }));
vi.mock("@/app/(app)/projects/[id]/changes/feedback-forms", () => ({ DecideScopeChangeForm: () => <button type="button">Decide</button> }));
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => ({ userId: "u1", installed: true, hasAnyAccess: true, grants: [{ companyId: "c1", capabilities: ["approve_scope"] }] }) }));

let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import ScopeDecisionPage from "./page";

const ID = "11111111-1111-4111-8111-111111111111";
const CONTEXT = {
  scope_change_id: ID, project_id: "p1", project_reference: "UAE-P-9", project_name: "Beta arena", title: "Move the stage", proposed_scope: "Stage moves to hall B",
  effect_on_dates: "Two days later", proposed_by_name: "Pia Pm", proposed_at: "2026-11-01T08:00:00Z", status: "proposed", can_decide: true,
};
const render = async (id = ID) => renderToStaticMarkup(await ScopeDecisionPage({ params: Promise.resolve({ scopeChangeId: id }) }));

beforeEach(() => {
  redirect.mockClear();
  rpcs = { proj_scope_decision_context: rows([CONTEXT]) };
  tables = { proj_scope_changes: row(null) }; // a non-member cannot read the proposal itself
});

describe("Scope change decision page (decider without project membership)", () => {
  it("shows the proposal's title, proposed scope, effect on dates, who proposed it and the Decide action, and nothing else about the project", async () => {
    const html = await render();
    expect(html).toContain("Move the stage");
    expect(html).toContain("Stage moves to hall B");
    expect(html).toContain("Two days later");
    expect(html).toContain("Pia Pm");
    expect(html).toContain("UAE-P-9");
    expect(html).toContain("Decide");
    expect(html).toContain("does not give you access to the project itself");
    expect(html).not.toMatch(/Current scope|Members|Budget|Cost effect/);
  });

  it("a failed read says it could not load, with a retry, never 'not available'", async () => {
    rpcs = { proj_scope_decision_context: failing() };
    const html = await render();
    expect(html).toContain("Could not load this scope change");
    expect(html).toContain(`/projects/scope-decisions/${ID}`);
    expect(html).not.toContain("not available to you");
  });

  it("no row (not allowed, unknown or withdrawn) says it is not available; a malformed id too", async () => {
    rpcs = { proj_scope_decision_context: rows([]) };
    expect(await render()).toContain("not available to you");
    expect(await render("nonsense")).toContain("not available to you");
  });

  it("someone who can already read the proposal (founder or member) is sent to the project's own page, as before", async () => {
    tables = { proj_scope_changes: row({ id: ID }) };
    await expect(render()).rejects.toThrow("REDIRECT /projects/p1/changes");
  });

  it("a decided proposal has no Decide action and says so", async () => {
    rpcs = { proj_scope_decision_context: rows([{ ...CONTEXT, status: "approved", can_decide: false }]) };
    const html = await render();
    expect(html).not.toContain(">Decide<");
    expect(html).toContain("already been decided");
  });

  it("a finished project's proposal says it can no longer be decided", async () => {
    rpcs = { proj_scope_decision_context: rows([{ ...CONTEXT, can_decide: false }]) };
    expect(await render()).toContain("project is finished");
  });
});
