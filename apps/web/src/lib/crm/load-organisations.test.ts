import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * A data service that behaves like the real one where it matters here: a request returns at most 1000 rows, whatever was asked for, and an
 * unranged request silently stops there. `ranges` records every range asked of each table.
 */
const CAP = 1000;
let tables: Record<string, unknown[]> = {};
let failAt: { table: string; from: number } | null = null;
let ranges: Record<string, [number, number][]> = {};
const query = (table: string) => {
  let window: [number, number] | null = null;
  const b: Record<string, unknown> = {};
  for (const m of ["select", "is", "eq", "in", "order", "not"]) b[m] = () => b;
  b.range = (from: number, to: number) => { window = [from, to]; (ranges[table] ??= []).push([from, to]); return b; };
  b.then = (resolve: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) => {
    const all = tables[table] ?? [];
    const [from, to] = window ?? [0, CAP - 1];
    if (failAt && failAt.table === table && failAt.from === from) return resolve({ data: null, error: { message: "connection reset" } });
    return resolve({ data: all.slice(from, Math.min(to + 1, from + CAP)), error: null });
  };
  return b;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => query(t) }) }));

import { loadOrganisations } from "./data";

const orgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `org-${i}`, name: `Fictional Organisation ${String(i).padStart(5, "0")}`, kind: "client", archived_at: null }));

beforeEach(() => { tables = {}; failAt = null; ranges = {}; });

describe("loadOrganisations reads every organisation, contact and enquiry, not the first 1000", () => {
  it("returns all 2,350 organisations, with the contacts and enquiry counts of the ones past the first page", async () => {
    tables = {
      crm_organisations: orgs(2350),
      // 1,200 contacts: the last ones belong to the last organisation, and two belong to none
      crm_contacts: [
        ...Array.from({ length: 1198 }, (_, i) => ({ id: `k-${i}`, name: `Fictional Person ${i}`, organisation_id: i >= 1190 ? "org-2349" : `org-${i}` })),
        { id: "k-x", name: "Fictional Loose One", organisation_id: null }, { id: "k-y", name: "Fictional Loose Two", organisation_id: null },
      ],
      // 1,500 enquiries: the last 400 name the last organisation as their client, half of them still open
      crm_opportunities: Array.from({ length: 1500 }, (_, i) => ({ agency_org_id: null, client_org_id: i >= 1100 ? "org-2349" : "org-0", stage: i % 2 ? "won" : "new" })),
    };
    const { organisations, unassignedContacts } = await loadOrganisations();
    expect(organisations).toHaveLength(2350);
    const last = organisations.at(-1)!;
    expect(last.id).toBe("org-2349");
    expect(last.contacts).toHaveLength(8);
    expect(last.opportunityCount).toBe(400);
    expect(last.openCount).toBe(200);
    expect(unassignedContacts.map((c) => c.id)).toEqual(["k-x", "k-y"]);
    // each list was asked for page by page until a short page
    expect(ranges.crm_organisations).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(ranges.crm_contacts).toEqual([[0, 999], [1000, 1999]]);
    expect(ranges.crm_opportunities).toEqual([[0, 999], [1000, 1999]]);
  });
  it("an enquiry naming one organisation as agency and client counts once", async () => {
    tables = { crm_organisations: orgs(1), crm_opportunities: [{ agency_org_id: "org-0", client_org_id: "org-0", stage: "new" }] };
    const { organisations } = await loadOrganisations();
    expect(organisations[0]).toMatchObject({ opportunityCount: 1, openCount: 1 });
  });
  it("a failed page anywhere is an error, never a shorter list", async () => {
    tables = { crm_organisations: orgs(1500) };
    failAt = { table: "crm_organisations", from: 1000 };
    await expect(loadOrganisations()).rejects.toThrow(/could not be loaded/);
    failAt = { table: "crm_contacts", from: 0 };
    await expect(loadOrganisations()).rejects.toThrow(/could not be loaded/);
  });
  it("an empty database is an empty list", async () => {
    expect(await loadOrganisations()).toEqual({ organisations: [], unassignedContacts: [] });
  });
});
