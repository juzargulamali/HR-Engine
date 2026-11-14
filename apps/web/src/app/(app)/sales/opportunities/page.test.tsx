/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/opportunities", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/components/sales/quick-add-enquiry", () => ({ QuickAddEnquiry: ({ companyId }: { companyId?: string | null }) => <span data-testid="quick-add" data-company={companyId ?? ""} /> }));
vi.mock("../_panel/enquiry-panel", () => ({ EnquirySidePanel: () => null }));
vi.mock("@/components/workspace/list-memory", () => ({ RememberList: () => null }));
vi.mock("./enquiry-board", () => ({ EnquiryBoard: ({ columns, items }: { columns: { id: string; total?: number }[]; items: { id: string; columnId: string }[] }) => <div data-testid="board">{columns.map((c) => `LANE:${c.id}=${c.total}/${items.filter((i) => i.columnId === c.id).length}`).join(" ")}</div> }));

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const companies = [{ id: C1, name: "Fictional UAE" }, { id: C2, name: "Fictional Europe" }];
const ctx: Record<string, unknown> = { userId: "u1", grants: [{ companyId: C1, capabilities: [] }], companies, people: [{ id: "u1", name: "Fictional Amy" }, { id: "u2", name: "Fictional Zed" }], personName: (id: string) => (id === "u2" ? "Fictional Zed" : id), companyName: (id: string) => id, homeCompanyId: null };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
// The company used last in Sales (the cookie), as the real server helper would read it; the choice itself is the real rule (chooseSalesCompany).
let remembered: string | null = null;
vi.mock("@/lib/crm/active-company-server", async () => {
  const { chooseSalesCompany } = await import("@/lib/crm/active-company");
  return { pickSalesCompany: async (c: { companies: { id: string; name: string }[]; homeCompanyId?: string | null }, asked?: string | null) => chooseSalesCompany(c.companies, { asked: typeof asked === "string" ? asked : null, remembered, home: c.homeCompanyId ?? null }) };
});
let handovers: unknown = { status: "ok", rows: [] };
vi.mock("@/lib/crm/handover-attention-data", () => ({ loadMyOpenHandovers: async () => handovers }));
let query: Record<string, unknown> | null = null;
let fail = false;
const item = (n: number, stage = "qualified", next: { title: string; due_at: string } | null = null) => ({
  opp: { id: `o${n}`, reference: `OPP-QA-2026-${n}`, title: `Fictional enquiry ${n}`, company_id: C1, owner_id: "u1", stage, stage_before_hold: null, version: 1, currency: "AED", source: "website", created_at: "2026-11-01T00:00:00Z", install_start: null, event_start: null, first_response_at: "2026-11-01T00:00:00Z" },
  value: 100, companyName: "Fictional UAE", ownerName: "Fictional Amy", agency: null, client: { name: "Fictional Harbour Client" }, nextFollowUp: next ? { id: `f${n}`, assigned_to: "u1", ...next } : null, openFollowUps: next ? 1 : 0, availability: "unverified",
});
const big = { total: 2500, matched: 1375, needs: { overdue: 3, due_today: 1, no_first_response: 40, no_next_action: 12 }, stages: [{ stage: "qualified", count: 1300, unvalued: 2, totals: { AED: 5000 } }, { stage: "won", count: 75, unvalued: 0, totals: {} }], items: [item(1), item(2)], source: "database" };
let result = big;
let scope: unknown = null;
let scopeAsked: string[] = [];
let evidence: unknown = null;
let evidenceAsked: string[] | null = null;
vi.mock("@/lib/crm/enquiry-list-data", () => ({
  loadEnquiryList: async (_c: unknown, q: Record<string, unknown>) => { query = q; if (fail) throw new Error("Sales data could not be loaded: down"); return result; },
  loadEnquiryScope: async (_c: unknown, company: string) => { scopeAsked.push(company); return scope; },
  loadStageEvidence: async (ids: string[]) => { evidenceAsked = ids; return evidence; },
}));

import EnquiriesPage from "./page";
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await EnquiriesPage({ searchParams: Promise.resolve(sp) }) as React.ReactElement);
const chipHref = (html: string, label: string) => { const m = new RegExp(`<a href="([^"]*)"[^>]*>(?:<span[^>]*></span>)?${label}`).exec(html); return m ? m[1]!.replace(/&amp;/g, "&") : null; };
const chosen = (html: string, label: string) => new RegExp(`aria-current="true"[^>]*>(?:<span[^>]*></span>)?${label}`).test(html);
/** The line above the list, as text. */
const line = (html: string) => { const m = /<p class="text-sm" role="status">(.*?)<\/p>/.exec(html); return (m?.[1] ?? "").replace(/<button.*?<\/button>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); };
const active = (html: string) => /data-testid="sales-company" data-company-id="([^"]*)"/.exec(html)?.[1];

beforeEach(() => { query = null; fail = false; handovers = { status: "ok", rows: [] }; result = big; scope = null; scopeAsked = []; evidence = null; evidenceAsked = null; remembered = null; ctx.homeCompanyId = null; ctx.companies = companies; });

describe("Enquiries: bounded list, quick-filter scope and counts", () => {
  it("asks for one page with the filters from the address and shows the database's counts (not the number of rows on the page)", async () => {
    const html = await render({ q: "OPP-QA-2020-0001", owner: "me", company: C1, stage: "qualified", sort: "created:desc", page: "3" });
    expect(query).toMatchObject({ q: "OPP-QA-2020-0001", owner: "u1", company: C1, stage: "qualified", status: "open", need: "", limit: 100, offset: 200 });
    expect(query).not.toHaveProperty("perStage");
    expect(line(html)).toContain("Showing 1375 enquiries in Fictional UAE that match your filters. 1125 of the 2500 enquiries you can see are not shown by these filters.");
    expect(html).toContain("Page 3 of 14");
    for (const [label, n] of [["Overdue", 3], ["Due today", 1], ["Awaiting first response", 40], ["No next action", 12]] as const) expect(html).toContain(`${label}<span class="tabular-nums text-foreground">${n}</span>`);
  });
  it("a quick filter narrows the same scope and goes back to the first page; choosing it again clears it; the counts stay", async () => {
    const html = await render({ owner: "me", company: C1, page: "4" });
    expect(chipHref(html, "Overdue")).toBe(`/sales/opportunities?owner=me&company=${C1}&need=overdue`);
    const picked = await render({ owner: "me", company: C1, need: "overdue" });
    expect(query).toMatchObject({ need: "overdue", owner: "u1", company: C1 });
    expect(chosen(picked, "Overdue")).toBe(true);
    expect(chipHref(picked, "Overdue")).toBe(`/sales/opportunities?owner=me&company=${C1}`);
    expect(picked).toContain(`Overdue<span class="tabular-nums text-foreground">3</span>`);
  });
  it("My open enquiries means exactly mine, open, any stage, no other quick filter: it is shown as chosen only then, and choosing it sets exactly that", async () => {
    expect(chosen(await render({ owner: "me" }), "My open enquiries")).toBe(true);
    for (const sp of [{ owner: "me", stage: "won" }, { owner: "me", status: "closed" }, { owner: "me", need: "overdue" }, { owner: "me", need: "handover" }, {}] as Record<string, string>[]) expect(chosen(await render(sp), "My open enquiries"), JSON.stringify(sp)).toBe(false);
    expect(chipHref(await render({ owner: "u2", stage: "won", status: "all", need: "overdue", company: C1, q: "expo" }), "My open enquiries")).toBe(`/sales/opportunities?owner=me&company=${C1}&q=expo`);
  });
  it("My won: handover open is its own set: the chosen company applies, the other filters are cleared by its link, and its count is its rows", async () => {
    handovers = { status: "ok", rows: [{ id: "w1", companyId: C1 }, { id: "w2", companyId: C1 }, { id: "w3", companyId: C2 }] };
    const html = await render({ company: C1, q: "expo", owner: "u2", stage: "qualified" });
    expect(html).toContain(`My won: handover open<span class="tabular-nums text-foreground">2</span>`);       // C1 only
    expect(chipHref(html, "My won: handover open")).toBe(`/sales/opportunities?company=${C1}&need=handover`);
    result = { ...big, matched: 2, items: [item(1, "won"), item(2, "won")] };
    const view = await render({ company: C1, need: "handover" });
    expect(query).toMatchObject({ ids: ["w1", "w2"], owner: "u1", stage: "won", status: "all", q: "", need: "", company: C1 });
    expect(chosen(view, "My won: handover open")).toBe(true);
    expect(view).not.toContain("Awaiting first response");                    // the need chips are not offered over won enquiries
    expect(line(view)).toContain("Showing 2 of your won enquiries in Fictional UAE whose handover is not accepted yet.");
    handovers = { status: "error" };
    expect(await render()).toContain("Could not check your won handovers");
  });
  it("the board asks for the first cards of each lane and shows each lane's full count, not the number of cards", async () => {
    result = { ...big, matched: 1375, items: [item(1), item(2), item(3, "won")] };
    const html = await render({ view: "board", stage: "qualified" });
    expect(query).toMatchObject({ perStage: 25, stage: "" });                 // the stage filter is the table's
    expect(html).toContain("LANE:qualified=1300/2");
    expect(html).toContain("LANE:won=75/1");
    expect(html).toContain("LANE:new=0/0");
  });
  it("a failed read says it could not load; a search with no match is 'Nothing matches', not 'No enquiries yet'", async () => {
    fail = true;
    const failed = await render();
    expect(failed).toContain("Could not load the enquiries");
    expect(failed).not.toContain("No enquiries yet");
    fail = false;
    result = { ...big, matched: 0, items: [] };
    const none = await render({ q: "nothing" });
    expect(none).toContain("Nothing matches");
    expect(none).not.toContain("No enquiries yet");
    result = { ...result, total: 0 };
    expect(await render()).toContain("No enquiries yet");
  });
});

describe("Enquiries: which company the list opens in", () => {
  it("the company in the address wins (saved links keep working) and Add enquiry starts in it", async () => {
    remembered = C2;
    const html = await render({ company: C1 });
    expect(query).toMatchObject({ company: C1 });
    expect(active(html)).toBe(C1);
    expect(html).toContain(`data-testid="quick-add" data-company="${C1}"`);
  });
  it("with no company in the address: the company used last in Sales, then the person's own", async () => {
    remembered = C2;
    await render();
    expect(query).toMatchObject({ company: C2 });
    remembered = null; ctx.homeCompanyId = C1;
    await render();
    expect(query).toMatchObject({ company: C1 });
  });
  it("?company=all shows every company; so does a person with several companies and no default (nothing is assumed, nothing hidden)", async () => {
    remembered = C1;
    const all = await render({ company: "all" });
    expect(query).toMatchObject({ company: "" });
    expect(all).toMatch(/aria-current="page"[^>]*>All my companies/);
    expect(all).toContain(`data-testid="quick-add" data-company=""`);          // Add enquiry then uses the active company, or asks
    remembered = null;
    const none = await render();
    expect(query).toMatchObject({ company: "" });
    expect(none).toMatch(/aria-current="page"[^>]*>All my companies/);
    expect(none).not.toContain("Choose a company");
  });
  it("a company the person has no Sales access to is ignored; the company chooser keeps the filters and the view", async () => {
    remembered = C1;
    const html = await render({ company: "99999999-9999-4999-8999-999999999999", status: "all", view: "board", page: "2" });
    expect(query).toMatchObject({ company: C1 });
    expect(chipHref(html, "Fictional Europe")).toBe(`/sales/opportunities?company=${C2}&status=all&view=board`);
    expect(chipHref(html, "All my companies")).toBe("/sales/opportunities?company=all&status=all&view=board");
  });
  it("a person with one company is in that company and is offered no chooser", async () => {
    ctx.companies = [companies[0]];
    const html = await render();
    expect(query).toMatchObject({ company: C1 });
    expect(html).not.toContain("All my companies");
    expect(html).toContain("Fictional UAE");
  });
});

describe("Enquiries: the line that says what is shown and why the rest is not", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
  const small = { ...big, total: 11, matched: 6, items: many(6) };
  it("default: open enquiries in the active company, with the exact reasons for the rest from a count-only read", async () => {
    remembered = C1; result = small; scope = { inCompany: 9, won: 2, lost: 1 };
    const html = await render();
    expect(scopeAsked).toEqual([C1]);
    expect(line(html)).toBe("Showing 6 open enquiries in Fictional UAE. 5 more are not shown: 2 won and 1 lost in Fictional UAE, 2 in your other companies. Show all");
    expect(html).not.toContain("6 of 11");
    expect(chipHref(html, "Show all")).toBe("/sales/opportunities?status=all&company=all");
    expect(html).not.toContain("Clear filters");                               // the default has no filter to clear
  });
  it("when the breakdown cannot be read it says only what the two counts prove, and still offers Show all", async () => {
    remembered = C1; result = small; scope = null;
    expect(line(await render())).toBe("Showing 6 open enquiries in Fictional UAE. 5 more are won, lost or in your other companies. Show all");
  });
  it("every company, open: the rest can only be won or lost, so no second read is made", async () => {
    result = small;
    expect(line(await render({ company: "all" }))).toBe("Showing 6 open enquiries across all your companies. 5 more are won or lost. Show all");
    expect(scopeAsked).toEqual([]);
  });
  it("everything in every company hides nothing and offers no Show all", async () => {
    result = { ...small, matched: 11, items: many(11) };
    const html = await render({ company: "all", status: "all" });
    expect(line(html)).toBe("Showing all 11 enquiries across all your companies.");
    expect(html).not.toContain("Show all");
  });
  it("filtered: says the filters decide, shows each as a removable chip, and one Clear filters names the default it returns to", async () => {
    remembered = C1; result = { ...small, matched: 3, items: many(3) };
    const html = await render({ q: "expo", owner: "u2", stage: "qualified", status: "all", need: "overdue", sort: "created:desc", view: "table", page: "2" });
    expect(scopeAsked).toEqual([]);
    expect(line(html)).toContain("Showing 3 enquiries in Fictional UAE that match your filters. 8 of the 11 enquiries you can see are not shown by these filters.");
    for (const chip of ["Search: expo", "Owner: Fictional Zed", "Stage: Qualified", "Show: everything", "Overdue"]) expect(html).toContain(`title="${chip}"`);
    const remove = (label: string) => { const m = new RegExp(`<a href="([^"]*)"[^>]*aria-label="Remove filter: ${label}"`).exec(html); return m?.[1]!.replace(/&amp;/g, "&"); };
    expect(remove("Stage: Qualified")).toBe("/sales/opportunities?q=expo&owner=u2&status=all&need=overdue&sort=created%3Adesc&view=table");
    expect(remove("Search: expo")).toBe("/sales/opportunities?owner=u2&stage=qualified&status=all&need=overdue&sort=created%3Adesc&view=table");
    expect(chipHref(html, "Clear filters")).toBe("/sales/opportunities?sort=created%3Adesc&view=table");
    expect((html.match(/>Clear filters</g) ?? [])).toHaveLength(1);
    expect(html).toContain("Back to open enquiries, any owner and stage in Fictional UAE.");
  });
  it("Show: won and lost is said in words and is a filter that can be removed", async () => {
    remembered = C1; result = { ...small, matched: 3, items: many(3) }; scope = { inCompany: 9, won: 2, lost: 1 };
    const html = await render({ status: "closed" });
    expect(line(html)).toBe("Showing 3 won and lost enquiries in Fictional UAE. 8 more are not shown: 6 open in Fictional UAE, 2 in your other companies. Show all");
    expect(html).toContain(`title="Show: won and lost"`);
  });
  it("an active company with no open enquiries is not 'Nothing matches': it says so and why", async () => {
    remembered = C1; result = { ...small, matched: 0, items: [] }; scope = { inCompany: 4, won: 3, lost: 1 };
    const html = await render();
    expect(html).toContain("No open enquiries in Fictional UAE");
    expect(html).not.toContain("Nothing matches");
    expect(html).not.toContain("No enquiries yet");
  });
});

describe("Enquiries: scannable rows", () => {
  it("one Next action cell holds the action and its exact due time (late in words), and each row has one action that opens the enquiry at its next step", async () => {
    remembered = C1;
    result = { ...big, items: [item(1, "qualified", { title: "Call the fictional client", due_at: "2020-01-05T06:00:00Z" }), item(2, "proposal_prep", { title: "Draft the proposal", due_at: "2999-01-05T06:00:00Z" }), item(3, "qualified"), item(4, "won")] };
    const html = await render();
    expect(html).not.toMatch(/<th[^>]*>(?:<a[^>]*>)?Due\b/);                    // the due time is inside Next action by default
    expect(html).toMatch(/Call the fictional client<\/span><span[^>]*>[^<]*overdue/);
    expect(html).toContain("No next action planned");
    expect(html).toContain("Closed: won");
    const action = (n: number) => new RegExp(`<a[^>]*href="/sales/opportunities/o${n}(\\?tab=[a-z]+)?"[^>]*>([^<]+)<span class="sr-only">`).exec(html);
    expect(action(1)?.[2]).toBe("Follow up now");
    expect(action(2)?.[2]).toBe("Prepare proposal");
    expect(action(2)?.[1]).toBe("?tab=proposals");
    expect(action(3)?.[2]).toBe("Plan next action");
    expect(action(4)?.[2]).toBe("View");
    expect(html).toContain(`href="/sales/opportunities?open=o1"`);              // the row and the title still open the side panel
    expect(await render({ cols: "enquiry,next,due" })).toMatch(/<th[^>]*>(?:<a[^>]*>)?Due\b/);   // a saved link that names the Due column still gets it
  });
  it("the board reads the evidence of the cards the person can move, and only those", async () => {
    remembered = C1;
    result = { ...big, items: [item(1), item(2, "on_hold"), item(3, "won"), { ...item(4), opp: { ...item(4).opp, owner_id: "u2" } }] };
    await render({ view: "board" });
    expect(evidenceAsked).toEqual(["o1"]);
    evidenceAsked = null;
    await render();
    expect(evidenceAsked).toBeNull();                                          // the table makes no such read
  });
});
