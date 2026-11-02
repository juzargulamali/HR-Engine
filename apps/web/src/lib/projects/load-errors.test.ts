import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import { loadProjectView } from "./data";
import { loadMyWork, loadProjectsAttention } from "./my-work";
import type { ProjectsContext } from "./context";

const ctx = {
  userId: "u1", fullName: "Pat", installed: true, hasAnyAccess: true, salesLinkedProjectIds: [], companies: [], people: [],
  grants: [{ companyId: "c1", capabilities: ["view"] }], personName: () => "Pat", companyName: () => "Enginious",
} as unknown as ProjectsContext;

const PROJECT = { id: "p1", company_id: "c1", pm_user_id: "u1", status: "active", reference: "UAE-P-1", name: "Expo", kind: "client", is_ongoing: false };

beforeEach(() => {
  tables = {
    proj_projects: row(PROJECT), proj_project_details: row({ project_id: "p1" }), proj_teams: rows([]), proj_task_collaborators: rows([]), proj_project_members: rows([]),
    proj_tasks: rows([]), proj_handovers: rows([]),
  };
  rpcs = { proj_project_people: rows([{ user_id: "u1", full_name: "Pat", role: "pm" }]), proj_directory: rows([]), proj_unread_counts: rows([]) };
});

describe("loadProjectView", () => {
  it("healthy: returns the project for its manager", async () => {
    const view = await loadProjectView(ctx, "p1");
    expect(view?.project.id).toBe("p1");
    expect(view?.level).toBe("details");
  });

  it("an absent project is null (the only case that may become 'not found')", async () => {
    tables = { ...tables, proj_projects: row(null) };
    expect(await loadProjectView(ctx, "p1")).toBeNull();
  });

  it("a failed project read THROWS: it is not 'not found'", async () => {
    tables = { ...tables, proj_projects: failing() };
    await expect(loadProjectView(ctx, "p1")).rejects.toThrow(/could not be loaded/);
  });

  it("a failed people read THROWS: a real member must not be shown as a non-member (read-only)", async () => {
    rpcs = { ...rpcs, proj_project_people: failing() };
    await expect(loadProjectView(ctx, "p1")).rejects.toThrow(/could not be loaded/);
  });

  it("a failed teams read THROWS: a team head must not lose edit rights", async () => {
    tables = { ...tables, proj_teams: failing() };
    await expect(loadProjectView(ctx, "p1")).rejects.toThrow(/could not be loaded/);
  });
});

describe("My Day project work", () => {
  it("healthy: counts come from the reads", async () => {
    tables = { ...tables, proj_tasks: rows([]), proj_handovers: rows([]) };
    expect(await loadProjectsAttention(ctx)).toMatchObject({ overdueTasks: 0, reviewsWaiting: 0, handoversWaiting: 0 });
  });

  it("a failed task read THROWS instead of returning zeros", async () => {
    tables = { ...tables, proj_tasks: failing() };
    await expect(loadMyWork(ctx)).rejects.toThrow(/could not be loaded/);
    await expect(loadProjectsAttention(ctx)).rejects.toThrow(/could not be loaded/);
  });

  it("a failed handover read THROWS: a waiting handover is not '0'", async () => {
    tables = { ...tables, proj_handovers: failing() };
    await expect(loadProjectsAttention(ctx)).rejects.toThrow(/could not be loaded/);
  });

  it("a failed unread-count read THROWS rather than reporting no unread messages", async () => {
    rpcs = { ...rpcs, proj_unread_counts: failing() };
    await expect(loadProjectsAttention(ctx)).rejects.toThrow(/could not be loaded/);
  });

  it("a person with no Projects grant gets zeros without any read (nothing to load)", async () => {
    tables = { proj_tasks: failing(), proj_handovers: failing() };
    expect(await loadProjectsAttention({ ...ctx, grants: [] } as ProjectsContext)).toMatchObject({ overdueTasks: 0, handoversWaiting: 0 });
  });
});

describe("My Day scope changes waiting for the person's decision", () => {
  const decider = { ...ctx, grants: [{ companyId: "c1", capabilities: ["approve_scope"] }] } as unknown as ProjectsContext;
  it("counts proposed changes on open projects of a company the person decides for, and names the oldest project", async () => {
    tables = { ...tables, proj_scope_changes: rows([{ project_id: "p1", proposed_at: "2026-11-01" }, { project_id: "p2", proposed_at: "2026-11-02" }, { project_id: "p3", proposed_at: "2026-11-03" }]),
      proj_projects: rows([{ id: "p1", company_id: "c1", status: "in_progress" }, { id: "p2", company_id: "c1", status: "completed" }, { id: "p3", company_id: "c2", status: "in_progress" }]) };
    expect(await loadProjectsAttention(decider)).toMatchObject({ scopeChangesWaiting: 1, scopeChangeProjectId: "p1" });
  });
  it("a person who cannot decide scope is never counted and nothing is read for them", async () => {
    tables = { ...tables, proj_scope_changes: failing() };
    expect(await loadProjectsAttention(ctx)).toMatchObject({ scopeChangesWaiting: 0, scopeChangeProjectId: null });
  });
  it("a failed read THROWS: a waiting decision is not '0'", async () => {
    tables = { ...tables, proj_scope_changes: failing() };
    await expect(loadProjectsAttention(decider)).rejects.toThrow(/could not be loaded/);
  });
  it("no proposals: zero", async () => {
    tables = { ...tables, proj_scope_changes: rows([]) };
    expect(await loadProjectsAttention(decider)).toMatchObject({ scopeChangesWaiting: 0 });
  });
});
