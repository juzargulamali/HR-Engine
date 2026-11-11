import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A small stand-in for the data service: it applies the filters it is given, sorts, and returns at most 1000 rows per request (like the real one), so the test
// proves the loader asks for the right thing and keeps reading until it has everything. Fictional data only.
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { crm_opportunities: [], crm_organisations: [], crm_follow_ups: [] };
const requests: { table: string; filters: string[]; range?: [number, number] }[] = [];
let failTable: string | null = null;

function builder(table: string) {
  let rows = [...(db[table] ?? [])];
  const filters: string[] = [];
  const orders: [string, boolean][] = [];
  let head = false;
  const like = (v: unknown, pattern: string) => typeof v === "string" && v.toLowerCase().includes(pattern.replace(/%/g, "").toLowerCase());
  const b: Record<string, unknown> = {};
  const finish = (from = 0, to = 999) => {
    requests.push({ table, filters, range: [from, to] });
    if (failTable === table) return { data: null, error: { message: "down" }, count: null };
    for (const [col, asc] of [...orders].reverse()) rows.sort((x, y) => String(x[col] ?? "").localeCompare(String(y[col] ?? "")) * (asc ? 1 : -1));
    const page = rows.slice(from, Math.min(to + 1, from + 1000));
    return head ? { data: null, error: null, count: rows.length } : { data: page, error: null, count: null };
  };
  Object.assign(b, {
    select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
    eq: (c: string, v: unknown) => { filters.push(`${c}=${v}`); rows = rows.filter((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { filters.push(`${c} in ${v.length}`); rows = rows.filter((r) => v.includes(r[c])); return b; },
    not: (c: string, op: string, v: string) => { filters.push(`${c} not ${op} ${v}`); if (op === "in") { const list = v.replace(/[()]/g, "").split(","); rows = rows.filter((r) => !list.includes(String(r[c]))); } else rows = rows.filter((r) => r[c] != null); return b; },
    ilike: (c: string, p: string) => { filters.push(`${c} ilike ${p}`); rows = rows.filter((r) => like(r[c], p)); return b; },
    or: (expr: string) => {
      filters.push(`or ${expr}`);
      const parts = expr.match(/[a-z_]+\.(?:ilike\."[^"]*"|in\.\([^)]*\))/g) ?? [];
      rows = rows.filter((r) => parts.some((part) => {
        const [col, op] = part.split(".") as [string, string];
        if (op === "ilike") return like(r[col], part.slice(part.indexOf('"') + 1, -1));
        return part.slice(part.indexOf("(") + 1, -1).split(",").includes(String(r[col]));
      }));
      return b;
    },
    order: (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending !== false]); return b; },
    range: async (from: number, to: number) => finish(from, to),
    limit: async (n: number) => { const r = finish(0, n - 1); return r; },
    then: (resolve: (v: unknown) => void) => resolve(finish()),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => builder(t) }) }));

import { countOpportunities, loadOpportunities } from "./data";

const ctx = { userId: "u1", companyName: (id: string) => `Company ${id}`, personName: (id: string) => `Person ${id}` } as never;
const day = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString();
const opp = (n: number, over: Row = {}): Row => ({
  id: `opp-${String(n).padStart(5, "0")}`, reference: `OPP-QA-2020-${String(n).padStart(4, "0")}`, title: `Fictional enquiry ${n}`, company_id: n % 2 ? "c1" : "c2", owner_id: n % 3 ? "u1" : "u2",
  stage: n % 10 === 0 ? "won" : n % 11 === 0 ? "lost" : "qualified", created_at: day(n), agency_org_id: null, client_org_id: null, value: null, currency: "AED",
  availability_state: "unverified", availability_covers: null, install_start: null, event_start: null, event_end: null, technologies: [], ...over,
});

beforeEach(() => {
  requests.length = 0; failTable = null;
  // 2,500 enquiries: number 1 is the OLDEST, far beyond the 1,000 newest rows that one request returns.
  db.crm_opportunities = Array.from({ length: 2500 }, (_, i) => opp(i + 1));
  db.crm_opportunities[0] = opp(1, { title: "Fictional oldest enquiry", client_org_id: "org-harbour", stage: "qualified" });
  db.crm_organisations = [{ id: "org-harbour", name: "Fictional Harbour Client" }, { id: "org-other", name: "Fictional Other Agency" }];
  db.crm_follow_ups = [
    { id: "f2", opportunity_id: "opp-00001", status: "open", due_at: day(4000), title: "Later" },
    { id: "f1", opportunity_id: "opp-00001", status: "open", due_at: day(3000), title: "Call the client" },
    { id: "f3", opportunity_id: "opp-02500", status: "open", due_at: day(3500), title: "Newest follow-up" },
    { id: "f4", opportunity_id: null, organisation_id: "org-other", status: "open", due_at: day(3100), title: "Account follow-up" },
  ];
});

describe("enquiries are read completely and searched before any row limit", () => {
  it("an unfiltered read returns every enquiry (2,500, not the newest 1,000), newest first, page by page", async () => {
    const all = await loadOpportunities(ctx);
    expect(all).toHaveLength(2500);
    expect(all[0]!.opp.id).toBe("opp-02500");
    expect(all.at(-1)!.opp.id).toBe("opp-00001");
    expect(requests.filter((r) => r.table === "crm_opportunities").map((r) => r.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(await countOpportunities()).toBe(2500);
  });
  it("an exact reference finds the oldest enquiry, with its organisation and its NEXT open follow-up (soonest first)", async () => {
    const hit = await loadOpportunities(ctx, { q: "OPP-QA-2020-0001", status: "open" });
    expect(hit.map((i) => i.opp.reference)).toEqual(["OPP-QA-2020-0001"]);
    expect(hit[0]).toMatchObject({ client: { name: "Fictional Harbour Client" }, openFollowUps: 2, nextFollowUp: { title: "Call the client" } });
    const oppRequest = requests.find((r) => r.table === "crm_opportunities")!;
    expect(oppRequest.filters.join(" | ")).toMatch(/stage not in \(won,lost\).*or title\.ilike\."%OPP-QA-2020-0001%",reference\.ilike\."%OPP-QA-2020-0001%"/);
    // The related reads are limited to the matching enquiry, not the whole tables.
    expect(requests.find((r) => r.table === "crm_follow_ups")!.filters).toContain("opportunity_id in 1");
  });
  it("searches by end-client or agency name through the organisations, and by title", async () => {
    expect((await loadOpportunities(ctx, { q: "harbour" })).map((i) => i.opp.id)).toEqual(["opp-00001"]);
    expect((await loadOpportunities(ctx, { q: "oldest enquiry" })).map((i) => i.opp.id)).toEqual(["opp-00001"]);
    expect(await loadOpportunities(ctx, { q: "nothing like this" })).toEqual([]);
  });
  it("what is typed cannot change the filter: commas, brackets and quotes are searched as text", async () => {
    await loadOpportunities(ctx, { q: 'a,b).or(id.eq."x"' });
    const filter = requests.find((r) => r.table === "crm_opportunities")!.filters.find((f) => f.startsWith("or "))!;
    expect(filter).toBe('or title.ilike."%a,b).or(id.eq.\\"x\\"%",reference.ilike."%a,b).or(id.eq.\\"x\\"%"');
  });
  it("company, owner, stage and status are applied in the database; a stage wins over the status", async () => {
    const mine = await loadOpportunities(ctx, { company: "c1", owner: "u1", status: "open" });
    expect(mine.length).toBeGreaterThan(500);
    expect(mine.every((i) => i.opp.company_id === "c1" && i.opp.owner_id === "u1" && i.opp.stage === "qualified")).toBe(true);
    const won = await loadOpportunities(ctx, { stage: "won", status: "open" });
    expect(won).toHaveLength(250);
    expect(won.every((i) => i.opp.stage === "won")).toBe(true);
    const closed = await loadOpportunities(ctx, { status: "closed" });
    expect(closed.every((i) => i.opp.stage === "won" || i.opp.stage === "lost")).toBe(true);
    expect(closed.length + (await loadOpportunities(ctx, { status: "open" })).length).toBe(2500);
  });
  it("a search that matches too many organisations to list reads the whole scope instead of dropping matches", async () => {
    db.crm_organisations = Array.from({ length: 80 }, (_, i) => ({ id: `org-${i}`, name: `Fictional Client ${i}` }));
    const rows = await loadOpportunities(ctx, { q: "fictional", company: "c1" });
    expect(rows).toHaveLength(1250);                                      // every c1 enquiry: the caller then filters by the text
    expect(requests.find((r) => r.table === "crm_opportunities")!.filters.some((f) => f.startsWith("or "))).toBe(false);
  });
  it("a failed read throws: on the enquiries, the organisations or the follow-ups (never a short list)", async () => {
    for (const t of ["crm_opportunities", "crm_organisations", "crm_follow_ups"]) {
      failTable = t;
      await expect(loadOpportunities(ctx, { q: "harbour" }), t).rejects.toThrow(/could not be loaded/);
    }
    failTable = "crm_opportunities";
    await expect(countOpportunities()).rejects.toThrow(/could not be loaded/);
  });
});
