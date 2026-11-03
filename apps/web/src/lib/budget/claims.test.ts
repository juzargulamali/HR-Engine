import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));

import { loadOwnClaims } from "./claims";

const CLAIM = { id: "c1", claim_date: "2026-10-30", currency: "AED", total_amount: "120", status: "pending_approval" };

beforeEach(() => { tables = { employees: row({ id: "e1" }), reimbursement_claims: rows([CLAIM]) }; });

describe("Own expense claims for the actuals form", () => {
  it("healthy: lists the claims", async () => {
    const r = await loadOwnClaims("u1");
    expect(r.failed).toBe(false);
    expect(r.claims).toEqual([{ id: "c1", label: "2026-10-30 · AED 120.00 · pending approval" }]);
  });
  it("no claims is genuinely empty, not a failure", async () => {
    tables = { ...tables, reimbursement_claims: rows([]) };
    expect(await loadOwnClaims("u1")).toEqual({ claims: [], failed: false });
  });
  it("no employee record is genuinely empty, not a failure", async () => {
    tables = { ...tables, employees: row(null) };
    expect(await loadOwnClaims("u1")).toEqual({ claims: [], failed: false });
  });
  it("a failed claims read is reported as failed, not as an empty list", async () => {
    tables = { ...tables, reimbursement_claims: failing() };
    expect(await loadOwnClaims("u1")).toEqual({ claims: [], failed: true });
  });
  it("a failed employee read is reported as failed", async () => {
    tables = { ...tables, employees: failing() };
    expect((await loadOwnClaims("u1")).failed).toBe(true);
  });
});
