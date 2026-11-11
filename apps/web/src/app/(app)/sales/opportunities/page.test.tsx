/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/sales/opportunities", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/components/sales/quick-add-enquiry", () => ({ QuickAddEnquiry: () => null }));
vi.mock("../_panel/enquiry-panel", () => ({ EnquirySidePanel: () => null }));
vi.mock("@/components/workspace/list-memory", () => ({ RememberList: () => null }));
vi.mock("./enquiry-board", () => ({ EnquiryBoard: ({ columns, items }: { columns: { id: string; total?: number }[]; items: { id: string; columnId: string }[] }) => <div data-testid="board">{columns.map((c) => `LANE:${c.id}=${c.total}/${items.filter((i) => i.columnId === c.id).length}`).join(" ")}</div> }));

const ctx = { userId: "u1", grants: [{ companyId: "c1", capabilities: [] }], companies: [{ id: "c1", name: "Fictional Co" }, { id: "c2", name: "Fictional Other Co" }], people: [{ id: "u1", name: "Fictional Amy" }, { id: "u2", name: "Fictional Zed" }], personName: (id: string) => id, companyName: (id: string) => id };
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ctx }));
let handovers: unknown = { status: "ok", rows: [] };
vi.mock("@/lib/crm/handover-attention-data", () => ({ loadMyOpenHandovers: async () => handovers }));
let query: Record<string, unknown> | null = null;
let fail = false;
const item = (n: number, stage = "qualified") => ({
  opp: { id: `o${n}`, reference: `OPP-QA-2026-${n}`, title: `Fictional enquiry ${n}`, company_id: "c1", owner_id: "u1", stage, stage_before_hold: null, version: 1, currency: "AED", source: "website", created_at: "2026-11-01T00:00:00Z", install_start: null, event_start: null, first_response_at: null },
  value: 100, companyName: "Fictional Co", ownerName: "Fictional Amy", agency: null, client: { name: "Fictional Harbour Client" }, nextFollowUp: null, openFollowUps: 0, availability: "unverified",
});
let result = { total: 2500, matched: 1375, needs: { overdue: 3, due_today: 1, no_first_response: 40, no_next_action: 12 }, stages: [{ stage: "qualified", count: 1300, unvalued: 2, totals: { AED: 5000 } }, { stage: "won", count: 75, unvalued: 0, totals: {} }], items: [item(1), item(2)], source: "database" };
vi.mock("@/lib/crm/enquiry-list-data", () => ({ loadEnquiryList: async (_c: unknown, q: Record<string, unknown>) => { query = q; if (fail) throw new Error("Sales data could not be loaded: down"); return result; } }));

import EnquiriesPage from "./page";
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await EnquiriesPage({ searchParams: Promise.resolve(sp) }) as React.ReactElement);
const chipHref = (html: string, label: string) => { const m = new RegExp(`<a href="([^"]*)"[^>]*>(?:<span[^>]*></span>)?${label}`).exec(html); return m ? m[1]!.replace(/&amp;/g, "&") : null; };
const chosen = (html: string, label: string) => new RegExp(`aria-current="true"[^>]*>(?:<span[^>]*></span>)?${label}`).test(html);

beforeEach(() => { query = null; fail = false; handovers = { status: "ok", rows: [] }; });

describe("Enquiries: bounded list, quick-filter scope and counts", () => {
  it("asks for one page with the filters from the address and shows the database's counts (not the number of rows on the page)", async () => {
    const html = await render({ q: "OPP-QA-2020-0001", owner: "me", company: "c1", stage: "qualified", sort: "created:desc", page: "3" });
    expect(query).toMatchObject({ q: "OPP-QA-2020-0001", owner: "u1", company: "c1", stage: "qualified", status: "open", need: "", limit: 100, offset: 200 });
    expect(query).not.toHaveProperty("perStage");
    expect(html).toContain("1375 of 2500 enquiries match");
    expect(html).toContain("Page 3 of 14");
    for (const [label, n] of [["Overdue", 3], ["Due today", 1], ["Awaiting first response", 40], ["No next action", 12]] as const) expect(html).toContain(`${label}<span class="tabular-nums text-foreground">${n}</span>`);
  });
  it("a quick filter narrows the same scope and goes back to the first page; choosing it again clears it; the counts stay", async () => {
    const html = await render({ owner: "me", company: "c1", page: "4" });
    expect(chipHref(html, "Overdue")).toBe("/sales/opportunities?owner=me&company=c1&need=overdue");
    const picked = await render({ owner: "me", company: "c1", need: "overdue" });
    expect(query).toMatchObject({ need: "overdue", owner: "u1", company: "c1" });
    expect(chosen(picked, "Overdue")).toBe(true);
    expect(chipHref(picked, "Overdue")).toBe("/sales/opportunities?owner=me&company=c1");
    expect(picked).toContain(`Overdue<span class="tabular-nums text-foreground">3</span>`);
  });
  it("My open enquiries means exactly mine, open, any stage, no other quick filter: it is shown as chosen only then, and choosing it sets exactly that", async () => {
    expect(chosen(await render({ owner: "me" }), "My open enquiries")).toBe(true);
    for (const sp of [{ owner: "me", stage: "won" }, { owner: "me", status: "closed" }, { owner: "me", need: "overdue" }, { owner: "me", need: "handover" }, {}] as Record<string, string>[]) expect(chosen(await render(sp), "My open enquiries"), JSON.stringify(sp)).toBe(false);
    expect(chipHref(await render({ owner: "u2", stage: "won", status: "all", need: "overdue", company: "c1", q: "expo" }), "My open enquiries")).toBe("/sales/opportunities?owner=me&company=c1&q=expo");
  });
  it("My won: handover open is its own set: the chosen company applies, the other filters are cleared by its link, and its count is its rows", async () => {
    handovers = { status: "ok", rows: [{ id: "w1", companyId: "c1" }, { id: "w2", companyId: "c1" }, { id: "w3", companyId: "c2" }] };
    const html = await render({ company: "c1", q: "expo", owner: "u2", stage: "qualified" });
    expect(html).toContain(`My won: handover open<span class="tabular-nums text-foreground">2</span>`);       // c1 only
    expect(chipHref(html, "My won: handover open")).toBe("/sales/opportunities?company=c1&need=handover");
    result = { ...result, matched: 2, items: [item(1, "won"), item(2, "won")] };
    const view = await render({ company: "c1", need: "handover" });
    expect(query).toMatchObject({ ids: ["w1", "w2"], owner: "u1", stage: "won", status: "all", q: "", need: "", company: "c1" });
    expect(chosen(view, "My won: handover open")).toBe(true);
    expect(view).not.toContain("Awaiting first response");                    // the need chips are not offered over won enquiries
    expect(view).toContain("2 of 2500 enquiries match");
    handovers = { status: "error" };
    expect(await render()).toContain("Could not check your won handovers");
  });
  it("the board asks for the first cards of each lane and shows each lane's full count, not the number of cards", async () => {
    result = { ...result, matched: 1375, items: [item(1), item(2), item(3, "won")] };
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
    result = { ...result, matched: 0, items: [] };
    const none = await render({ q: "nothing" });
    expect(none).toContain("Nothing matches");
    expect(none).not.toContain("No enquiries yet");
    result = { ...result, total: 0 };
    expect(await render()).toContain("No enquiries yet");
  });
});
