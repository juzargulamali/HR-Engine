import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));

import { loadHandoverRows, loadHandoverStatus } from "./handover-attention-data";
import type { CrmContext } from "./context";
import type { OpportunityListItem } from "./data";

const NOT_INSTALLED = { data: null, error: { message: "Could not find the table 'public.proj_handovers' in the schema cache", code: "PGRST205" } };
const ctx = (founder = false) => ({ userId: "me", grants: [{ companyId: "c1", capabilities: founder ? ["founder"] : [] }] }) as unknown as CrmContext;
const opp = (id: string, over: Record<string, unknown> = {}) => ({ opp: { id, reference: `R-${id}`, title: `Job ${id}`, stage: "won", owner_id: "me", company_id: "c1", closed_at: new Date().toISOString(), stage_changed_at: new Date().toISOString(), ...over } }) as unknown as OpportunityListItem;

beforeEach(() => { tables = {}; rpcs = {}; });

describe("loadHandoverRows", () => {
  it("a won enquiry whose handover has not been started shows the row", async () => {
    tables = { proj_handovers: rows([]) };
    const r = await loadHandoverRows(ctx(), [opp("a")]);
    expect(r).toMatchObject({ status: "ok", rows: [{ kind: "won_no_handover", opportunityId: "a" }] });
  });
  it("the row disappears once the handover is submitted", async () => {
    tables = { proj_handovers: rows([{ crm_opportunity_id: "a", crm_reference: "R-a", title: "Job a", status: "submitted", clarification_note: null, accepted_at: null, updated_at: new Date().toISOString() }]) };
    expect(await loadHandoverRows(ctx(), [opp("a")])).toEqual({ status: "ok", rows: [] });
  });
  it("a failed read is 'error', never an empty list", async () => {
    tables = { proj_handovers: failing() };
    expect(await loadHandoverRows(ctx(), [opp("a")])).toEqual({ status: "error" });
  });
  it("Projects not installed here: nothing to check", async () => {
    tables = { proj_handovers: NOT_INSTALLED };
    expect(await loadHandoverRows(ctx(), [opp("a")])).toEqual({ status: "none" });
  });
  it("a founder's check of another owner's win reads its status through the Sales read function; a failure there is an error", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    tables = { proj_handovers: rows([]) };
    rpcs = { proj_handover_for_opportunity: rows([]) };
    const ok = await loadHandoverRows(ctx(true), [opp("x", { owner_id: "other", closed_at: old })]);
    expect(ok).toMatchObject({ status: "ok", rows: [{ opportunityId: "x", scope: "company" }] });
    rpcs = { proj_handover_for_opportunity: failing() };
    expect(await loadHandoverRows(ctx(true), [opp("x", { owner_id: "other", closed_at: old })])).toEqual({ status: "error" });
    // a person who is not a founder never triggers that read and never sees the row
    rpcs = { proj_handover_for_opportunity: failing() };
    expect(await loadHandoverRows(ctx(false), [opp("x", { owner_id: "other", closed_at: old })])).toEqual({ status: "ok", rows: [] });
  });
});

describe("loadHandoverStatus", () => {
  it("reads one enquiry's status; no row means not started; a failure is an error", async () => {
    rpcs = { proj_handover_for_opportunity: rows([{ status: "draft" }]) };
    expect(await loadHandoverStatus("a")).toEqual({ status: "ok", handoverStatus: "draft" });
    rpcs = { proj_handover_for_opportunity: rows([]) };
    expect(await loadHandoverStatus("a")).toEqual({ status: "ok", handoverStatus: null });
    rpcs = { proj_handover_for_opportunity: failing() };
    expect(await loadHandoverStatus("a")).toEqual({ status: "error" });
  });
});
