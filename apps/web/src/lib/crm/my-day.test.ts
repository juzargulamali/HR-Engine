import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));
vi.mock("./context", () => ({ getCrmContext: async () => null }));
vi.mock("./data", () => ({ loadFollowUps: async () => ({ open: [], done: [] }), loadOpportunities: async () => [] }));

import { loadApprovalsWaiting } from "./my-day";
import type { CrmContext } from "./context";

const ctx = (caps: string[], policy: "required" | "not_required" | "not_configured" = "required") =>
  ({ userId: "me", grants: [{ companyId: "c1", capabilities: caps }], companies: [{ id: "c1", name: "Co", countryCode: "AE", settings: { approval_policy: policy } }] }) as unknown as CrmContext;

beforeEach(() => { tables = {}; });

describe("loadApprovalsWaiting (Sales founders)", () => {
  it("counts pending requests and points at the oldest enquiry", async () => {
    tables = { crm_approvals: rows([{ opportunity_id: "o-old", requested_at: "2026-10-30" }, { opportunity_id: "o-new", requested_at: "2026-11-01" }]) };
    expect(await loadApprovalsWaiting(ctx(["founder"]))).toEqual({ status: "ok", count: 2, oldestOpportunityId: "o-old" });
  });
  it("a person who is not a founder sees nothing, and nothing is read", async () => {
    tables = { crm_approvals: failing() };
    expect(await loadApprovalsWaiting(ctx([]))).toEqual({ status: "none" });
    expect(await loadApprovalsWaiting(ctx(["manage_access"]))).toEqual({ status: "none" });
  });
  it("a company whose approval policy is not 'required' cannot decide anything: no row", async () => {
    expect(await loadApprovalsWaiting(ctx(["founder"], "not_configured"))).toEqual({ status: "none" });
    expect(await loadApprovalsWaiting(ctx(["founder"], "not_required"))).toEqual({ status: "none" });
  });
  it("a failed read is an error, never zero", async () => {
    tables = { crm_approvals: failing() };
    expect(await loadApprovalsWaiting(ctx(["founder"]))).toEqual({ status: "error" });
  });
  it("no pending requests: a real zero", async () => {
    tables = { crm_approvals: rows([]) };
    expect(await loadApprovalsWaiting(ctx(["founder"]))).toMatchObject({ status: "ok", count: 0 });
  });
});
