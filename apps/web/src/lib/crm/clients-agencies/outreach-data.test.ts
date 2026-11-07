import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
type Result = { data: unknown; error: { message: string } | null };
let tables: Record<string, Result> = {};
const builder = (res: Result) => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) b[m] = () => b;
  b.then = (resolve: (r: Result) => unknown) => resolve(res);
  return b;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => builder(tables[t] ?? { data: [], error: null }) }) }));

import { loadAccountOutreach, loadOutreach } from "./outreach-data";

const boom = { data: null, error: { message: "connection reset" } };
const row = { id: "o1", organisation_id: "g1", company_id: "c1", assigned_to: "u1", status: "not_started", target_date: "2026-12-01" };
beforeEach(() => { tables = {}; });

describe("a failed outreach read is an error, never 'no outreach'", () => {
  it("the list throws when the outreach or the account names cannot be read", async () => {
    tables = { crm_outreach: boom };
    await expect(loadOutreach("c1")).rejects.toThrow(/could not be loaded/);
    tables = { crm_outreach: { data: [row], error: null }, crm_organisations: boom };
    await expect(loadOutreach("c1")).rejects.toThrow(/could not be loaded/);
  });
  it("names each account, and an empty answer is an empty list", async () => {
    tables = { crm_outreach: { data: [row], error: null }, crm_organisations: { data: [{ id: "g1", name: "Fictional Co" }], error: null } };
    expect((await loadOutreach("c1"))[0]?.accountName).toBe("Fictional Co");
    tables = { crm_outreach: { data: [], error: null } };
    expect(await loadOutreach("c1")).toEqual([]);
  });
  it("the account's outreach throws when its history cannot be read, and lists open outreach before closed", async () => {
    tables = { crm_outreach: { data: [row], error: null }, crm_outreach_events: boom };
    await expect(loadAccountOutreach("c1", "g1")).rejects.toThrow(/could not be loaded/);
    tables = { crm_outreach: { data: [{ ...row, id: "c", status: "closed" }, { ...row, id: "a" }], error: null }, crm_outreach_events: { data: [{ id: "e", outreach_id: "a" }], error: null } };
    const r = await loadAccountOutreach("c1", "g1");
    expect(r.map((x) => x.outreach.id)).toEqual(["a", "c"]);
    expect(r[0]?.events).toHaveLength(1);
  });
});
