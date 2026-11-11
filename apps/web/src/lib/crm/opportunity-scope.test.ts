import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A small stand-in for the data service: it applies the filters it is given, sorts, and returns at most 1000 rows per request (like the real one), so the test
// proves the loaders ask for the right thing and keep reading until they have everything. Fictional data only. The bounded list function itself is proven on a real
// PostgreSQL in packages/rls-tests/test/crm-enquiry-list.rls.test.ts.
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { crm_opportunities: [], crm_organisations: [], crm_follow_ups: [] };
const requests: { table: string; filters: string[]; range?: [number, number] }[] = [];
let failTable: string | null = null;
let rpcResult: { data: unknown; error: { code?: string; message: string } | null } = { data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_enquiry_list in the schema cache" } };
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

function builder(table: string) {
  let rows = [...(db[table] ?? [])];
  const filters: string[] = [];
  const orders: [string, boolean][] = [];
  let head = false;
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
    gte: (c: string, v: string) => { filters.push(`${c}>=${v}`); rows = rows.filter((r) => r[c] != null && String(r[c]) >= v); return b; },
    lt: (c: string, v: string) => { filters.push(`${c}<${v}`); rows = rows.filter((r) => r[c] != null && String(r[c]) < v); return b; },
    or: () => { throw new Error("no hand-built or() filter is sent to the data service"); },
    order: (c: string, o?: { ascending?: boolean }) => { orders.push([c, o?.ascending !== false]); return b; },
    range: async (from: number, to: number) => finish(from, to),
    then: (resolve: (v: unknown) => void) => resolve(finish()),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => builder(t), rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpcResult; } }) }));

import { countOpportunities, loadOpportunities } from "./data";
import { loadEnquiryList } from "./enquiry-list-data";
import { listFromItems, type EnquiryListQuery } from "./enquiry-list";

const ctx = { userId: "u1", people: [{ id: "u2", name: "Zed (fictional)" }, { id: "u1", name: "Amy (fictional)" }], companyName: (id: string) => `Company ${id}`, personName: (id: string) => `Person ${id}` } as never;
const day = (n: number) => new Date(Date.UTC(2020, 0, 1) + n * 86_400_000).toISOString();
const opp = (n: number, over: Row = {}): Row => ({
  id: `opp-${String(n).padStart(5, "0")}`, reference: `OPP-QA-2020-${String(n).padStart(4, "0")}`, title: `Fictional enquiry ${n}`, company_id: n % 2 ? "c1" : "c2", owner_id: n % 3 ? "u1" : "u2",
  stage: n % 10 === 0 ? "won" : n % 11 === 0 ? "lost" : "qualified", created_at: day(n), closed_at: n % 10 === 0 || n % 11 === 0 ? day(n + 30) : null, agency_org_id: null, client_org_id: null, value: n % 4 === 0 ? null : 100, currency: "AED",
  first_response_at: day(n), availability_state: "unverified", availability_covers: null, install_start: null, event_start: null, event_end: null, technologies: [], ...over,
});
const Q: EnquiryListQuery = { q: "", company: "", owner: "", stage: "", status: "open", need: "", sort: { key: "due", dir: "asc" }, limit: 100, offset: 0 };

beforeEach(() => {
  requests.length = 0; rpcCalls.length = 0; failTable = null;
  rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_enquiry_list in the schema cache" } };
  // 2,500 enquiries: number 1 is the OLDEST, far beyond the 1,000 newest rows that one request returns.
  db.crm_opportunities = Array.from({ length: 2500 }, (_, i) => opp(i + 1));
  db.crm_opportunities![0] = opp(1, { title: "Fictional oldest enquiry", client_org_id: "org-harbour", stage: "qualified", closed_at: null, first_response_at: null });
  db.crm_organisations = [{ id: "org-harbour", name: "Fictional Harbour Client" }, { id: "org-other", name: "Fictional Other Agency" }];
  db.crm_follow_ups = [
    { id: "f2", opportunity_id: "opp-00001", status: "open", due_at: day(4000), title: "Later" },
    { id: "f1", opportunity_id: "opp-00001", status: "open", due_at: day(10), title: "Call the client" },
    { id: "f3", opportunity_id: "opp-02499", status: "open", due_at: day(9000), title: "Newest follow-up" },
    { id: "f4", opportunity_id: null, organisation_id: "org-other", status: "open", due_at: day(3100), title: "Account follow-up" },
  ];
});

describe("complete reads (Reports, Follow-ups, My Day; and the list where its function is not installed)", () => {
  it("an unfiltered read returns every enquiry (2,500, not the newest 1,000), newest first, page by page", async () => {
    const all = await loadOpportunities(ctx);
    expect(all).toHaveLength(2500);
    expect(all[0]!.opp.id).toBe("opp-02500");
    expect(all.at(-1)!.opp.id).toBe("opp-00001");
    expect(requests.filter((r) => r.table === "crm_opportunities").map((r) => r.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(await countOpportunities()).toBe(2500);
  });
  it("company, owner, stage and status are applied in the database; a stage wins over the status", async () => {
    const mine = await loadOpportunities(ctx, { company: "c1", owner: "u1", status: "open" });
    expect(mine.length).toBeGreaterThan(500);
    expect(mine.every((i) => i.opp.company_id === "c1" && i.opp.owner_id === "u1" && i.opp.stage === "qualified")).toBe(true);
    const won = await loadOpportunities(ctx, { stage: "won", status: "open" });
    expect(won).toHaveLength(250);
    const closed = await loadOpportunities(ctx, { status: "closed" });
    expect(closed.length + (await loadOpportunities(ctx, { status: "open" })).length).toBe(2500);
  });
  it("a period report reads only what it needs: still open, created in the window, or closed in the window, for the company, each once", async () => {
    const from = day(2000); const to = day(2100);
    const rows = await loadOpportunities(ctx, { company: "c1", anyOf: { open: true, createdFrom: from, createdTo: to, closedFrom: from, closedTo: to } });
    const all = db.crm_opportunities!.filter((o) => o.company_id === "c1");
    const wanted = all.filter((o) => !["won", "lost"].includes(String(o.stage)) || (String(o.created_at) >= from && String(o.created_at) < to) || (o.closed_at != null && String(o.closed_at) >= from && String(o.closed_at) < to));
    expect(new Set(rows.map((r) => r.opp.id))).toEqual(new Set(wanted.map((o) => o.id)));
    expect(rows).toHaveLength(wanted.length);                                 // merged by id: nothing twice
    expect(rows.length).toBeLessThan(all.length);                            // closed enquiries from outside the window are not read
    // Every closed enquiry of the period is there, and none from outside it that is not open or new: Won and Lost are still counted by closure date downstream.
    const closedOutside = all.filter((o) => ["won", "lost"].includes(String(o.stage)) && !(String(o.closed_at) >= from && String(o.closed_at) < to) && !(String(o.created_at) >= from && String(o.created_at) < to));
    expect(closedOutside.length).toBeGreaterThan(0);
    for (const o of closedOutside) expect(rows.some((r) => r.opp.id === o.id)).toBe(false);
    expect(requests.filter((r) => r.table === "crm_opportunities").every((r) => r.filters.includes("company_id=c1"))).toBe(true);
  });
  it("a failed read throws: on the enquiries, the organisations or the follow-ups (never a short list)", async () => {
    for (const t of ["crm_opportunities", "crm_organisations", "crm_follow_ups"]) {
      failTable = t;
      await expect(loadOpportunities(ctx, { status: "open" }), t).rejects.toThrow(/could not be loaded/);
    }
    failTable = "crm_opportunities";
    await expect(countOpportunities()).rejects.toThrow(/could not be loaded/);
  });
});

describe("the Enquiries list and board: one bounded read", () => {
  const rpcRow = (n: number, over: Row = {}) => ({ ...opp(n), agency_name: null, client_name: "Fictional Harbour Client", open_follow_ups: 1, next: { id: "f1", title: "Call the client", due_at: day(10), assigned_to: "u1" }, ...over });
  it("asks the database for one page with the filters, the need, the sort and the owners in name order; maps the rows without reading anything else", async () => {
    rpcResult = { error: null, data: { total: 2500, matched: 1375, needs: { overdue: 1, due_today: 0, no_first_response: 1, no_next_action: 1373 }, stages: [{ stage: "qualified", count: 1375, unvalued: 300, totals: { AED: "107500" } }], rows: [rpcRow(1, { value: "100.50" })] } };
    const r = await loadEnquiryList(ctx, { ...Q, q: " OPP-QA-2020-0001 ", company: "c1", owner: "u1", need: "overdue", limit: 100, offset: 200 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({ name: "crm_enquiry_list", args: { p_company: "c1", p_owner: "u1", p_stage: null, p_status: "open", p_q: "OPP-QA-2020-0001", p_need: "overdue", p_ids: null, p_sort: "due", p_dir: "asc", p_owner_order: ["u1", "u2"], p_limit: 100, p_offset: 200, p_per_stage: null } });
    expect(requests).toEqual([]);                                             // no table read at all: no enquiry detail rows, no follow-ups, no organisations
    expect(r).toMatchObject({ source: "database", total: 2500, matched: 1375, needs: { overdue: 1, no_next_action: 1373 }, stages: [{ stage: "qualified", count: 1375, unvalued: 300, totals: { AED: 107500 } }] });
    expect(r.items[0]).toMatchObject({ value: 100.5, companyName: "Company c1", ownerName: "Person u1", client: { name: "Fictional Harbour Client" }, agency: null, openFollowUps: 1, nextFollowUp: { title: "Call the client" }, availability: "unverified" });
    expect(Object.keys(r.items[0]!.opp).sort()).toEqual(["company_id", "created_at", "currency", "event_start", "first_response_at", "id", "install_start", "owner_id", "reference", "source", "stage", "stage_before_hold", "title", "version"].sort());
  });
  it("the board asks for the first cards of each lane; the handover view sends its ids", async () => {
    rpcResult = { error: null, data: { total: 1, matched: 0, needs: { overdue: 0, due_today: 0, no_first_response: 0, no_next_action: 0 }, stages: [], rows: [] } };
    await loadEnquiryList(ctx, { ...Q, perStage: 25, ids: ["a", "b"], status: "all", stage: "won" });
    expect(rpcCalls[0]!.args).toMatchObject({ p_per_stage: 25, p_ids: ["a", "b"], p_stage: "won", p_status: "all" });
  });
  it("a failed read, or an answer in the wrong shape, throws (never an empty list); only a missing function falls back", async () => {
    rpcResult = { data: null, error: { message: "permission denied for function crm_enquiry_list" } };
    await expect(loadEnquiryList(ctx, Q)).rejects.toThrow(/could not be loaded/);
    rpcResult = { data: { rows: "nope" }, error: null };
    await expect(loadEnquiryList(ctx, Q)).rejects.toThrow(/unexpected shape/);
    expect(requests).toEqual([]);
  });
  it("without the function: the same answers from a complete read. The oldest enquiry is found by exact reference, by client name and by title", async () => {
    const hit = await loadEnquiryList(ctx, { ...Q, q: "OPP-QA-2020-0001" });
    expect(hit).toMatchObject({ source: "complete", total: 2500, matched: 1 });
    expect(hit.items[0]).toMatchObject({ client: { name: "Fictional Harbour Client" }, openFollowUps: 2, nextFollowUp: { title: "Call the client" } });
    expect((await loadEnquiryList(ctx, { ...Q, q: "harbour" })).items.map((i) => i.opp.id)).toEqual(["opp-00001"]);
    expect((await loadEnquiryList(ctx, { ...Q, q: "oldest enquiry" })).items.map((i) => i.opp.id)).toEqual(["opp-00001"]);
    expect((await loadEnquiryList(ctx, { ...Q, q: "a,b).or(id.eq.x" })).matched).toBe(0);     // what is typed is only ever text
  });
});

describe("the list rules in the app (the fallback): one page, counts over every match", () => {
  const NOW = new Date(day(3000));
  const items = async () => loadOpportunities(ctx, { status: "open" });
  it("returns one page in the requested order while matched and the lane counts cover every match", async () => {
    const all = await items();
    const r = listFromItems(all, { ...Q, limit: 100, offset: 0 }, NOW);
    expect(r.matched).toBe(all.length);
    expect(r.items).toHaveLength(100);
    expect(r.items[0]!.opp.id).toBe("opp-00001");                            // soonest next action first; enquiries with none sort last
    const second = listFromItems(all, { ...Q, limit: 100, offset: 100 }, NOW);
    expect(new Set([...r.items, ...second.items].map((i) => i.opp.id)).size).toBe(200);
    expect(r.stages).toEqual([{ stage: "qualified", count: all.length, unvalued: all.filter((i) => i.value == null).length, totals: { AED: all.filter((i) => i.value != null).length * 100 } }]);
  });
  it("the quick-filter counts are over the filters without the need, and each equals the rows that need returns", async () => {
    const all = await items();
    const plain = listFromItems(all, Q, NOW);
    expect(plain.needs).toEqual({ overdue: 1, due_today: 0, no_first_response: 1, no_next_action: all.length - 2 });
    for (const need of ["overdue", "no_first_response", "no_next_action"] as const) {
      const r = listFromItems(all, { ...Q, need, limit: 5000 }, NOW);
      expect(r.matched, need).toBe(plain.needs[need]);
      expect(r.items, need).toHaveLength(plain.needs[need]);
      expect(r.needs, need).toEqual(plain.needs);                            // the other chips keep their counts while one is chosen
    }
    // The counts follow the other filters: another owner has no overdue enquiry.
    expect(listFromItems(all, { ...Q, owner: "u2" }, NOW).needs.overdue).toBe(0);
  });
  it("the board form gives the first cards of each lane; an id list restricts (the handover view)", async () => {
    const all = await loadOpportunities(ctx);
    const board = listFromItems(all, { ...Q, status: "all", perStage: 3 }, NOW);
    for (const s of board.stages) expect(board.items.filter((i) => i.opp.stage === s.stage), s.stage).toHaveLength(3);
    expect(board.stages.reduce((n, s) => n + s.count, 0)).toBe(2500);
    const ids = listFromItems(all, { ...Q, status: "all", ids: ["opp-00010", "opp-00020", "nope"] }, NOW);
    expect(ids.items.map((i) => i.opp.id).sort()).toEqual(["opp-00010", "opp-00020"]);
    expect(ids.matched).toBe(2);
  });
});
