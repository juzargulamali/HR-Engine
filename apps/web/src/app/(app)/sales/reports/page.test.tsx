/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

// Fictional companies. The ids are real-shaped because the active company is only ever taken from a well-formed id the person holds.
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const CONFIGURED = { response_target_hours: 4, working_calendar: { workdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", holidays: [] } };
const ctx: { userId: string; grants: unknown[]; personName: () => string; people: { id: string; name: string }[]; homeCompanyId: string | null; companies: { id: string; name: string; settings: unknown }[] } = {
  userId: "u1", grants: [], personName: () => "Sales Owner", people: [{ id: "u1", name: "Sales Owner" }], homeCompanyId: null,
  companies: [{ id: C1, name: "Enginious UAE", settings: null }, { id: C2, name: "Enginious KSA", settings: null }],
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
// The tests that are not about the company look at every company at once, which is now an explicit choice ("All my companies").
const ALL = { scope: "all" };
const render = async (sp: Record<string, string> = ALL) => renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve(sp) }));
const sourceCard = (html: string) => html.slice(html.indexOf("Enquiries by source"), html.indexOf("Won value<"));

beforeEach(() => {
  ctx.homeCompanyId = null; ctx.companies.forEach((c) => { c.settings = null; });
  n = 0; oppsFail = false; followUpsFail = false; lastScope = undefined; closureFilters = [];
  zohoResult = { data: [], error: null }; closuresResult = { data: [], error: null };
  items = [item(C1, "agency_call"), item(C1, "agency_call"), item(C1, "website"), item(C2, "linkedin"), item(C2, "whatsapp"), item(C2, "whatsapp")];
});

describe("Sales reports", () => {
  it("Enquiries by source shows readable names, never the stored ids", async () => {
    const card = sourceCard(await render());
    expect(card).toContain("Agency call (outbound)");
    expect(card).toContain("Website enquiry");
    expect(card).toContain("LinkedIn");
    expect(card).toContain("WhatsApp");
    for (const raw of ["agency_call", "direct_client", ">website<", ">linkedin<", ">whatsapp<"]) expect(card).not.toContain(raw);
    expect(card).toContain("6 enquiries, all your companies, ");
  });

  it("counts stay company-scoped: choosing one company counts only its enquiries (two companies)", async () => {
    const c1 = sourceCard(await render({ company: C1 }));
    expect(c1).toContain("3 enquiries, Enginious UAE, ");
    expect(c1).toContain("Agency call (outbound)");
    expect(c1).not.toContain("LinkedIn");
    const c2 = sourceCard(await render({ company: C2 }));
    expect(c2).toContain("3 enquiries, Enginious KSA, ");
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
    expect(html).toContain("6 enquiries, all your companies, ");           // the other cards are intact
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
    expect(html).toContain("6 enquiries, all your companies, ");
    expect(html).not.toMatch(/Overdue<\/dt><dd[^>]*>0/);
  });

  it("a failed Zoho references read (won enquiries in view) is 'Could not load', not 'Not recorded' on every row or '0 of N'", async () => {
    items = [...items, item(C1, "referral", { stage: "won", closed_at: NOW, evidence_reference: "PO-1" })];
    zohoResult = { data: null, error: { message: "timeout" } };
    const html = await render();
    expect(html).toContain("Could not load the invoice and payment references");
    expect(html).not.toContain("Not recorded");
    expect(html).not.toMatch(/\d+ of \d+ have an invoice reference/);
    expect(html).toContain("This report is incomplete");
  });

  it("when the Zoho references read works the references show as before", async () => {
    items = [...items, item(C1, "referral", { stage: "won", closed_at: NOW, evidence_reference: "PO-1" })];
    const html = await render();
    expect(html).toContain("0 of 1 have an invoice reference recorded by hand");
    expect(html).not.toContain("Could not load");
  });

  it("a failed enquiries read is 'Could not load the reports' (not 'Not enough data yet', not zeros) with a retry", async () => {
    oppsFail = true;
    const html = await render({ company: C1, from: "2026-01-01" });
    expect(html).toContain("Could not load the reports");
    expect(html).toContain("not a report with zero results");
    expect(html).toContain(`href="/sales/reports?from=2026-01-01&amp;company=${C1}"`);
    expect(html).not.toContain("Not enough data yet");
    expect(html).not.toContain("Open pipeline by stage");
  });

  it("a genuinely empty result is 'Not enough data yet'", async () => {
    items = [];
    const html = await render();
    expect(html).toContain("Not enough data yet");
    expect(html).not.toContain("Could not load");
  });

  it("applies the chosen company in the database, to the enquiries and to the reopened-closures note, and reads everything under All my companies", async () => {
    await render({ company: C2, from: "2026-08-01", to: "2026-10-31" });
    // The company, and only what a period report needs: open, created in the window or closed in it (a day wider than the period; each figure applies its exact rule).
    expect(lastScope).toEqual({ company: C2, anyOf: { open: true, createdFrom: "2026-07-31T00:00:00Z", createdTo: "2026-11-02T00:00:00Z", closedFrom: "2026-07-31T00:00:00Z", closedTo: "2026-11-02T00:00:00Z" } });
    expect(closureFilters).toEqual([["company_id", C2]]);
    closureFilters = [];
    const all = await render();
    expect(lastScope).not.toHaveProperty("company");
    expect(lastScope).toHaveProperty("anyOf.open", true);
    expect(closureFilters).toEqual([]);
    expect(sourceCard(all)).toContain("6 enquiries, all your companies, ");
    expect(sourceCard(await render({ company: C2 }))).toContain("3 enquiries, Enginious KSA, ");
  });

  // ---- the company ----------------------------------------------------------------------------------------------------------------------------
  it("opens in the person's employing company, not in every company and not in the first by name", async () => {
    ctx.homeCompanyId = C1;                                   // employed by Enginious UAE; "Enginious KSA" sorts first by name
    const html = await render({});
    expect(lastScope).toHaveProperty("company", C1);
    expect(html).toContain(`data-company-id="${C1}"`);
    expect(sourceCard(html)).toContain("3 enquiries, Enginious UAE, ");
    expect(html).toContain("All my companies");               // still one click away
  });

  it("several companies and nothing to go on: asks the person to choose and loads no figures", async () => {
    const html = await render({});
    expect(html).toContain('data-choose="true"');
    expect(html).toContain("Choose a company above to see the reports");
    expect(lastScope).toBeUndefined();                        // the enquiries were not read
    expect(html).not.toContain("Open pipeline by stage");
    expect(html).not.toContain("Not enough data yet");
  });

  it("the company chooser and the period form keep each other's choice", async () => {
    const html = await render({ company: C2, from: "2026-08-01", to: "2026-10-31" });
    expect(html).toContain(`href="/sales/reports?from=2026-08-01&amp;to=2026-10-31&amp;company=${C1}"`);
    expect(html).toContain('href="/sales/reports?from=2026-08-01&amp;to=2026-10-31&amp;scope=all"');
    expect(html).toContain(`<input type="hidden" name="company" value="${C2}"/>`);
    expect(await render({ scope: "all" })).toContain('<input type="hidden" name="scope" value="all"/>');
  });

  // ---- the two groups, the scope beside each figure ---------------------------------------------------------------------------------------------
  it("groups the reports: the current pipeline and follow-ups first, then the results for the selected period, each saying its company and dates", async () => {
    const html = await render({ company: C1, from: "2026-08-01", to: "2026-10-30" });
    const now = html.indexOf("Current pipeline and follow-ups");
    const period = html.indexOf("Results for the selected period");
    expect(now).toBeGreaterThan(-1);
    expect(period).toBeGreaterThan(now);
    const first = html.slice(now, period);
    const second = html.slice(period);
    for (const title of ["Open pipeline by stage", "Open pipeline by owner", "Follow-ups"]) { expect(first).toContain(`>${title}<`); expect(second).not.toContain(`>${title}<`); }
    for (const title of ["Timeliness", "Won and lost", "Lost reasons", "Enquiries by source", "Won value", "Won value against invoice and payment references"]) { expect(second).toContain(`>${title}<`); expect(first).not.toContain(`>${title}<`); }
    expect(first).toContain("Enginious UAE</strong>, as of now.");
    // The group line says "as of now" once: the group's own note is not allowed to repeat it straight after.
    expect(first.replace(/<!-- -->/g, "")).toContain("Enginious UAE</strong>, as of now. The dates above do not change these figures.");
    expect(first.replace(/<!-- -->/g, "")).not.toMatch(/as of now\.\s*As of now/);
    expect(second).toContain("Enginious UAE</strong>, 1 Aug to 30 Oct 2026.");
    expect(first).toContain("3 open enquiries, Enginious UAE, as of now. Currency: AED");
    expect(first).toContain("0 open follow-ups, Enginious UAE, as of now");
  });

  it("names every currency beside a money figure and never adds them together", async () => {
    items = [item(C1, "website", { currency: "AED" }), item(C1, "website", { currency: "EUR" })];
    const html = await render({ company: C1 });
    expect(html).toContain("2 open enquiries, Enginious UAE, as of now. Currencies, each on its own line: AED, EUR");
    expect(html).not.toMatch(/2,000/);                        // 1,000 AED and 1,000 EUR are never one total
  });

  // ---- timeliness that is not configured is said once ---------------------------------------------------------------------------------------------
  it("says ONCE, at the top, that timeliness is not configured, with the way to that company's settings; the card only points to it", async () => {
    const html = await render({ company: C1 });
    expect(html.match(/Response timeliness is not configured/g)).toHaveLength(1);
    expect(html.match(/No response-time target has been set\./g)).toHaveLength(1);
    expect(html).toContain(`href="/sales/settings?company=${C1}#response-targets"`);
    expect(html.indexOf("Response timeliness is not configured")).toBeLessThan(html.indexOf("Current pipeline and follow-ups"));
    expect(html).toContain("Not configured (see the notice at the top of this page)");
  });

  it("under All my companies the one notice names each company that is not configured, and only those", async () => {
    ctx.companies[1]!.settings = CONFIGURED;
    const html = await render();
    expect(html.match(/Response timeliness is not configured/g)).toHaveLength(1);
    expect(html).toContain(`href="/sales/settings?company=${C1}#response-targets"`);
    expect(html).not.toContain(`href="/sales/settings?company=${C2}#response-targets"`);
  });

  it("shows no timeliness notice when the company has a target and a calendar", async () => {
    ctx.companies[0]!.settings = CONFIGURED;
    expect(await render({ company: C1 })).not.toContain("Response timeliness is not configured");
  });

  // ---- counts link to the records only where the list shows exactly that set ----------------------------------------------------------------------
  it("links the open-pipeline counts (by stage, by owner) to Enquiries for the same company, and nothing else", async () => {
    items = [...items, item(C1, "referral", { stage: "won", closed_at: NOW, evidence_reference: "PO-1" }), item(C1, "website", { stage: "lost", closed_at: NOW, lost_reason: "Budget" })];
    const html = await render({ company: C1 });
    expect(html).toContain(`href="/sales/opportunities?stage=new&amp;company=${C1}"`);
    expect(html).toContain(`href="/sales/opportunities?owner=u1&amp;company=${C1}"`);
    expect(html.match(/data-testid="report-count-link"/g)).toHaveLength(2);   // the New stage and the one owner; a stage with no enquiries is not a link
    // The Enquiries list has no date or source filter, so won, lost, lost reasons and sources are plain numbers.
    const period = html.slice(html.indexOf("Results for the selected period"));
    expect(period).not.toContain("report-count-link");
    expect(period).not.toContain("/sales/opportunities?");
  });

  it("links no count under All my companies (the list would not show exactly that set), nor for an owner the list cannot filter by", async () => {
    expect(await render()).not.toContain("report-count-link");
    ctx.people = [];
    const html = await render({ company: C1 });
    expect(html).toContain(`href="/sales/opportunities?stage=new&amp;company=${C1}"`);
    expect(html).not.toContain("/sales/opportunities?owner=");
    ctx.people = [{ id: "u1", name: "Sales Owner" }];
  });

  it("the won-value table becomes cards on a phone instead of a wide table", async () => {
    items = [...items, item(C1, "referral", { stage: "won", closed_at: NOW, evidence_reference: "PO-1" })];
    const html = await render({ company: C1 });
    expect(html).not.toContain("min-w-[44rem]");
    expect(html.slice(html.indexOf("Won value against invoice"))).toContain("max-md:[&amp;_thead]:sr-only");
  });
});
