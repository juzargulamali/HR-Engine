/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ctx = {
  userId: "u1", grants: [], personName: () => "Sales Owner",
  companies: [{ id: "c1", name: "Enginious UAE", settings: null }, { id: "c2", name: "Enginious KSA", settings: null }],
};
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));

const NOW = new Date().toISOString();
let n = 0;
const item = (company: string, source: string, over: Record<string, unknown> = {}) => {
  n++;
  return { opp: { id: `o${n}`, reference: `OPP-X-2026-${n}`, title: `Enquiry ${n}`, company_id: company, owner_id: "u1", stage: "new", currency: "AED", value: 1000, source, created_at: NOW, first_response_at: null, closed_at: null, stage_changed_at: NOW, lost_reason: null, evidence_reference: null, ...over }, value: 1000 };
};
let items: ReturnType<typeof item>[] = [];
let oppsFail = false;
let followUpsFail = false;
let zohoResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
let closuresResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };
let lastScope: Record<string, unknown> | undefined;
let closureFilters: [string, unknown][] = [];
const one = async (r: { data: unknown[] | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; };
vi.mock("@/lib/crm/data", () => ({
  // The real loader applies the scope in the database; the stand-in applies the same company filter so a test can prove it was asked for.
  loadOpportunities: async (_ctx: unknown, scope: { company?: string } = {}) => { lastScope = scope; if (oppsFail) throw new Error("Sales data could not be loaded: down"); return items.filter((i) => !scope.company || i.opp.company_id === scope.company); },
  loadFollowUps: async () => { if (followUpsFail) throw new Error("Sales data could not be loaded: down"); return { open: [], done: [] }; },
  num: (v: unknown) => (v == null ? null : Number(v)),
  readPaged: async (page: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>) => one(await page(0, 999)),
  readForIds: async (ids: string[], read: (chunk: string[], from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>) => (ids.length ? one(await read(ids, 0, 999)) : []),
}));
const table = (t: string) => {
  const b: Record<string, unknown> = {};
  const done = () => (t === "crm_zoho_references" ? zohoResult : closuresResult);
  b.select = () => b; b.not = () => b; b.in = () => b; b.order = () => b;
  b.eq = (k: string, v: unknown) => { if (t === "crm_closures") closureFilters.push([k, v]); return b; };
  b.range = async () => done();
  return b;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: table }) }));

import ReportsPage from "./page";
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve(sp) }));
const sourceCard = (html: string) => html.slice(html.indexOf("Enquiries by source"), html.indexOf("Won value<"));

beforeEach(() => {
  n = 0; oppsFail = false; followUpsFail = false; lastScope = undefined; closureFilters = [];
  zohoResult = { data: [], error: null }; closuresResult = { data: [], error: null };
  items = [item("c1", "agency_call"), item("c1", "agency_call"), item("c1", "website"), item("c2", "linkedin"), item("c2", "whatsapp"), item("c2", "whatsapp")];
});

describe("Sales reports", () => {
  it("Enquiries by source shows readable names, never the stored ids", async () => {
    const card = sourceCard(await render());
    expect(card).toContain("Agency call (outbound)");
    expect(card).toContain("Website enquiry");
    expect(card).toContain("LinkedIn");
    expect(card).toContain("WhatsApp");
    for (const raw of ["agency_call", "direct_client", ">website<", ">linkedin<", ">whatsapp<"]) expect(card).not.toContain(raw);
    expect(card).toContain("n = 6 enquiries");
  });

  it("counts stay company-scoped: choosing one company counts only its enquiries (two companies)", async () => {
    const c1 = sourceCard(await render({ company: "c1" }));
    expect(c1).toContain("n = 3 enquiries");
    expect(c1).toContain("Agency call (outbound)");
    expect(c1).not.toContain("LinkedIn");
    const c2 = sourceCard(await render({ company: "c2" }));
    expect(c2).toContain("n = 3 enquiries");
    expect(c2).toContain("WhatsApp");
    expect(c2).not.toContain("Agency call (outbound)");
  });

  it("a clean read shows no 'Could not load' and no incompleteness notice", async () => {
    const html = await render();
    expect(html).not.toContain("Could not load");
    expect(html).not.toContain("This report is incomplete");
  });

  it("a failed closures read (the reopened-closures note) says so on the Won and lost card and the report says it is incomplete; the counts are not changed", async () => {
    closuresResult = { data: null, error: { message: "permission denied" } };
    const html = await render();
    expect(html).toContain("Could not load the count of closures that were later reopened");
    expect(html).toContain("This report is incomplete");
    expect(html).toContain("the reopened-closures note under Won and lost");
    expect(html).toContain("n = 6 enquiries");           // the other cards are intact
  });

  it("a successful closures read still shows the reopened note", async () => {
    closuresResult = { data: [{ outcome: "won", closed_at: NOW, reopened_at: NOW }], error: null };
    const html = await render();
    expect(html).toContain("was later reopened");
    expect(html).not.toContain("Could not load");
  });

  it("failed follow-ups make ONLY the Follow-ups card 'Could not load' (not a zero) and the report incomplete", async () => {
    followUpsFail = true;
    const html = await render();
    expect(html).toContain("Could not load the follow-up counts");
    expect(html).toContain("This report is incomplete");
    expect(html).toContain("Open pipeline by stage");
    expect(html).toContain("n = 6 enquiries");
    expect(html).not.toMatch(/Overdue<\/dt><dd[^>]*>0/);
  });

  it("a failed Zoho references read (won enquiries in view) is 'Could not load', not 'Not recorded' on every row or '0 of N'", async () => {
    items = [...items, item("c1", "referral", { stage: "won", closed_at: NOW, evidence_reference: "PO-1" })];
    zohoResult = { data: null, error: { message: "timeout" } };
    const html = await render();
    expect(html).toContain("Could not load the invoice and payment references");
    expect(html).not.toContain("Not recorded");
    expect(html).not.toMatch(/\d+ of \d+ have an invoice reference/);
    expect(html).toContain("This report is incomplete");
  });

  it("when the Zoho references read works the references show as before", async () => {
    items = [...items, item("c1", "referral", { stage: "won", closed_at: NOW, evidence_reference: "PO-1" })];
    const html = await render();
    expect(html).toContain("0 of 1 have an invoice reference recorded by hand");
    expect(html).not.toContain("Could not load");
  });

  it("a failed enquiries read is 'Could not load the reports' (not 'Not enough data yet', not zeros) with a retry", async () => {
    oppsFail = true;
    const html = await render({ company: "c1", from: "2026-01-01" });
    expect(html).toContain("Could not load the reports");
    expect(html).toContain("not a report with zero results");
    expect(html).toContain('href="/sales/reports?from=2026-01-01&amp;company=c1"');
    expect(html).not.toContain("Not enough data yet");
    expect(html).not.toContain("Open pipeline by stage");
  });

  it("a genuinely empty result is 'Not enough data yet'", async () => {
    items = [];
    const html = await render();
    expect(html).toContain("Not enough data yet");
    expect(html).not.toContain("Could not load");
  });

  it("applies the chosen company in the database, to the enquiries and to the reopened-closures note, and reads everything when no company is chosen", async () => {
    await render({ company: "c2" });
    expect(lastScope).toEqual({ company: "c2" });
    expect(closureFilters).toEqual([["company_id", "c2"]]);
    closureFilters = [];
    const all = await render();
    expect(lastScope).toEqual({});
    expect(closureFilters).toEqual([]);
    expect(sourceCard(all)).toContain("n = 6 enquiries");
    expect(sourceCard(await render({ company: "c2" }))).toContain("n = 3 enquiries");
  });
});
