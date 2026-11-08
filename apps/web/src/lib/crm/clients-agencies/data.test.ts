import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Result = { data: unknown; error: { message: string; code?: string } | null };
let tables: Record<string, Result> = {};
let rpcs: Record<string, Result> = {};
// A query builder that answers like Supabase's: every filter returns itself and awaiting it gives the table's canned result.
const builder = (res: Result) => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "or", "order", "limit", "range"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data, error: res.error });
  b.then = (resolve: (r: Result) => unknown) => resolve(res);
  return b;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => builder(tables[t] ?? { data: [], error: null }), rpc: async (f: string) => rpcs[f] ?? { data: [], error: null } }) }));

import { loadAccount, loadDirectory } from "./data";

const CO = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG = "bbbbbbbb-0000-4000-8000-000000000002";
const ctx = {} as never;
const good = (extra: Record<string, Result> = {}) => ({
  crm_organisations: { data: [{ id: ORG, name: "Fictional Co", roles: [] }], error: null },
  crm_contacts: { data: [], error: null }, crm_account_profiles: { data: [], error: null },
  crm_opportunities: { data: [{ id: "opp-1", company_id: CO, reference: "UAE-1", title: "Job", stage: "won", agency_org_id: null, client_org_id: ORG, owner_id: "u", currency: "AED", value: null, closed_at: null, created_at: "" }], error: null },
  ...extra,
});
const boom = { data: null, error: { message: "connection reset" } };

beforeEach(() => { tables = {}; rpcs = {}; });

describe("a failed read is an error, never an empty or zero page", () => {
  it("the directory throws when the organisations, contacts or profiles cannot be read", async () => {
    for (const t of ["crm_organisations", "crm_contacts", "crm_account_profiles"]) {
      tables = good({ [t]: boom });
      await expect(loadDirectory(CO), t).rejects.toThrow(/could not be loaded/);
    }
  });
  it("when only the enquiries cannot be read the rows load WITHOUT figures or a badge (never zero)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    tables = good({ crm_opportunities: boom });
    const rows = await loadDirectory(CO);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stats: null, relationship: null });
    expect(rows[0]!.org.name).toBe("Fictional Co");
  });
  it("with the enquiries read, the directory counts them the way the account page does", async () => {
    tables = good();
    const rows = await loadDirectory(CO, new Date("2026-11-08T08:00:00Z"));
    expect(rows[0]).toMatchObject({ stats: { total: 1, won: 1, open: 0 } });
  });
  it("the account page throws when the organisation or the inquiries cannot be read", async () => {
    tables = good({ crm_opportunities: boom });
    await expect(loadAccount(ctx, CO, ORG)).rejects.toThrow(/could not be loaded/);
    tables = good({ crm_organisations: boom });
    await expect(loadAccount(ctx, CO, ORG)).rejects.toThrow(/could not be loaded/);
    tables = good({ crm_activities: boom });
    await expect(loadAccount(ctx, CO, ORG)).rejects.toThrow(/could not be loaded/);
  });
  it("a failed projects read leaves completed projects as unknown, not zero", async () => {
    tables = good({ proj_projects: boom });
    const page = await loadAccount(ctx, CO, ORG);
    expect(page?.view.counts.completedProjects).toBeNull();
    expect(page?.view.counts.won).toBe(1);
  });
  it("a failed handover check marks the won inquiry's project as unknown", async () => {
    tables = good();
    rpcs = { proj_handover_for_opportunity: boom };
    const page = await loadAccount(ctx, CO, ORG);
    expect(page?.view.inquiries[0]?.project).toEqual({ kind: "unknown" });
  });
  it("an organisation that does not exist is not found (not an error)", async () => {
    tables = good({ crm_organisations: { data: null, error: null } });
    expect(await loadAccount(ctx, CO, ORG)).toBeNull();
  });
});
