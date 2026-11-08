import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));

import type { CrmContext } from "./context";
import { loadFollowUps, loadOpportunityDetail, loadOpportunityDetailResult } from "./data";

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = { userId: "u1", grants: [], personName: () => "Sales Owner", companyName: () => "Enginious UAE" } as unknown as CrmContext;
const opp = { id: ID, company_id: "c1", owner_id: "u1", agency_org_id: null, client_org_id: "org1", stage: "new", value: 5, availability_state: "unverified", availability_covers: null, technologies: [] };
const baseTables = (): Record<string, FakeResult> => ({
  crm_opportunities: row(opp), crm_organisations: rows([{ id: "org1", name: "Orbit Motors" }]), crm_opportunity_contacts: rows([]), crm_activities: rows([]), crm_follow_ups: rows([]),
  crm_opportunity_events: rows([]), crm_files: rows([]), crm_proposals: rows([]), crm_zoho_references: row(null), crm_approvals: rows([]), crm_handovers: row(null), crm_closures: rows([]), crm_contacts: rows([]),
});
beforeEach(() => { tables = baseTables(); });

describe("reading one enquiry: four different outcomes", () => {
  it("a successful read with nothing recorded is ok, nothing failed (empty is not an error)", async () => {
    const r = await loadOpportunityDetailResult(ctx, ID);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect([...r.failed]).toEqual([]); expect(r.detail.proposals).toEqual([]); expect(r.detail.item.client?.name).toBe("Orbit Motors"); }
  });
  it("a read that works and finds no enquiry is not_found (also for a malformed id)", async () => {
    tables.crm_opportunities = row(null);
    expect(await loadOpportunityDetailResult(ctx, ID)).toEqual({ kind: "not_found" });
    expect(await loadOpportunityDetailResult(ctx, "not-an-id")).toEqual({ kind: "not_found" });
  });
  it("a refused read is denied, and is not the same as not_found or error", async () => {
    tables.crm_opportunities = { data: null, error: { message: "permission denied for table crm_opportunities", code: "42501" } };
    expect(await loadOpportunityDetailResult(ctx, ID)).toEqual({ kind: "denied" });
  });
  it("a failed read of the enquiry itself is error (never not_found)", async () => {
    tables.crm_opportunities = failing();
    expect(await loadOpportunityDetailResult(ctx, ID)).toEqual({ kind: "error" });
  });
  it("without the parties' names there is no page: error", async () => {
    tables.crm_organisations = failing();
    expect(await loadOpportunityDetailResult(ctx, ID)).toEqual({ kind: "error" });
  });
  it("each other section fails on its own and is NAMED; the rest of the enquiry still loads", async () => {
    const sections: [string, string][] = [["crm_activities", "activities"], ["crm_follow_ups", "followUps"], ["crm_opportunity_events", "events"], ["crm_files", "files"], ["crm_proposals", "proposals"], ["crm_zoho_references", "zoho"], ["crm_approvals", "approvals"], ["crm_handovers", "handover"], ["crm_closures", "closures"], ["crm_opportunity_contacts", "contacts"]];
    for (const [table, section] of sections) {
      tables = baseTables();
      tables[table] = failing();
      const r = await loadOpportunityDetailResult(ctx, ID);
      expect(r.kind, table).toBe("ok");
      if (r.kind === "ok") { expect([...r.failed], table).toEqual([section]); expect(r.detail.item.opp.id).toBe(ID); }
    }
  });
  it("a failure reading the contacts of the enquiry is the contacts section's", async () => {
    tables.crm_opportunity_contacts = rows([{ contact_id: "k1", role: null }]);
    tables.crm_contacts = failing();
    const r = await loadOpportunityDetailResult(ctx, ID);
    expect(r.kind === "ok" && [...r.failed]).toEqual(["contacts"]);
  });
  it("the older loader (used by the estimate page and the side panel) still throws on ANY failed part and returns null for a missing enquiry", async () => {
    expect((await loadOpportunityDetail(ctx, ID))?.item.opp.id).toBe(ID);
    tables.crm_zoho_references = failing();
    await expect(loadOpportunityDetail(ctx, ID)).rejects.toThrow(/could not be loaded/);
    tables = baseTables(); tables.crm_opportunities = row(null);
    expect(await loadOpportunityDetail(ctx, ID)).toBeNull();
    tables = baseTables(); tables.crm_opportunities = failing();
    await expect(loadOpportunityDetail(ctx, ID)).rejects.toThrow(/could not be loaded/);
  });
});

describe("follow-up list read (Follow-ups page and Reports)", () => {
  const fu = { id: "f1", opportunity_id: ID, organisation_id: null, status: "open", due_at: new Date().toISOString(), assigned_to: "u1", company_id: "c1", title: "Call", kind: "call" };
  it("a failed read of the enquiries or names the follow-ups point at throws instead of silently dropping them", async () => {
    tables = { crm_follow_ups: rows([fu]), crm_opportunities: failing(), crm_organisations: rows([]) };
    await expect(loadFollowUps(ctx)).rejects.toThrow(/could not be loaded/);
    tables = { crm_follow_ups: rows([fu]), crm_opportunities: rows([{ id: ID, reference: "R", title: "T", stage: "new", company_id: "c1", owner_id: "u1", agency_org_id: null, client_org_id: "org1" }]), crm_organisations: failing() };
    await expect(loadFollowUps(ctx)).rejects.toThrow(/could not be loaded/);
  });
  it("a working read still lists them", async () => {
    tables = { crm_follow_ups: rows([fu]), crm_opportunities: rows([{ id: ID, reference: "R", title: "T", stage: "new", company_id: "c1", owner_id: "u1", agency_org_id: null, client_org_id: "org1" }]), crm_organisations: rows([{ id: "org1", name: "Orbit" }]) };
    const r = await loadFollowUps(ctx);
    expect(r.open).toHaveLength(1);
  });
});
