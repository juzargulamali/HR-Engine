import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", fullName: "Sam", employeeId: null, grants: [] }) }));

import { getCrmContext } from "./context";
import { loadSalesToday } from "./my-day";

beforeEach(() => {
  tables = {
    crm_company_grants: rows([{ company_id: "c1", capabilities: ["owner"] }]),
    companies: rows([{ id: "c1", legal_name: "Enginious", country_code: "AE" }]),
    crm_company_settings: rows([{ company_id: "c1", default_quote_currency: "AED" }]),
  };
  rpcs = { crm_people: rows([{ user_id: "u1", full_name: "Sam", email: null, company_ids: ["c1"] }]) };
});

describe("CRM context", () => {
  it("healthy: companies, settings and people load", async () => {
    const ctx = await getCrmContext();
    expect(ctx?.loadFailed).toBeUndefined();
    expect(ctx?.companies[0]?.settings).not.toBeNull();
    expect(ctx?.people).toHaveLength(1);
  });
  it.each([
    ["settings", () => { tables = { ...tables, crm_company_settings: failing() }; }],
    ["companies", () => { tables = { ...tables, companies: failing() }; }],
    ["people", () => { rpcs = { ...rpcs, crm_people: failing() }; }],
  ])("a failed %s read is a load failure, not 'no Sales settings' or an empty list", async (_n, fail) => {
    fail();
    const ctx = await getCrmContext();
    expect(ctx?.loadFailed).toBe(true);
    expect(ctx?.companies).toEqual([]);
  });
  it("the My Day Sales card reports an error when the context could not load, instead of vanishing", async () => {
    tables = { ...tables, crm_company_settings: failing() };
    expect(await loadSalesToday()).toEqual({ status: "error" });
  });
});
