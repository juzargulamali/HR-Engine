/**
 * Stages 2 to 4: Sales lookups, factual summaries, scope wording for an estimate, and the provenance rule at the outbound gate. Fictional data; the provider is the
 * simulated one or an intercepted HTTP request (no network, no key, no paid call).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { registerAllJarvisActions } from "./actions";
import { createAssistant, type JarvisAssistant } from "./assistant";
import { gateProvider } from "./outbound";
import { findProtectedContent, hasStoredFinancial, redactAppText } from "./protected";
import type { SalesLookupCard, SalesSummaryCard, ScopeDraftCard, SendResult } from "./protocol";
import { simulatedBehaviour, simulatedProviderCalls } from "./provider/simulated";
import type { JarvisProvider, StructuredRequest } from "./provider/types";
import { routeMessage } from "./router";
import { ACTIVITY_COLUMNS, ACTIVITY_TEXT_COLUMNS, ENQUIRY_COLUMNS, ENQUIRY_TEXT_COLUMNS, FINANCIAL_COLUMNS, FOLLOW_UP_COLUMNS } from "./sales/projection";
import { parseSalesQuery, refineQuery } from "./sales/query-parse";
import { narrativeMatchesFacts, resolveWindow } from "./sales/summary";
import { fakeDeps, ID, mkOpp, newWorld, type World } from "./testing/fake-world";

let w: World;
let a: JarvisAssistant;
/** A fixed "now": Wednesday 14 October 2099, 10:00 in Dubai. */
const NOW = new Date("2099-10-14T06:00:00Z");
const make = (over: Parameters<typeof fakeDeps>[1] = {}) => createAssistant(fakeDeps(w, { now: () => NOW, ...over }));
const as = (user: string) => { w.signedIn = user; return make(); };
const at = (iso: string) => new Date(iso).toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
beforeAll(() => registerAllJarvisActions());
beforeEach(() => { w = newWorld(); a = make(); simulatedProviderCalls.length = 0; simulatedBehaviour.summary = "ok"; simulatedBehaviour.scope = "ok"; vi.spyOn(console, "info").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

const lookup = (r: SendResult): SalesLookupCard => { if (!r.ok || r.kind !== "action" || r.card.kind !== "lookup.sales") throw new Error(`expected a Sales lookup, got ${JSON.stringify(r).slice(0, 300)}`); return r.card; };
const summary = (r: SendResult): SalesSummaryCard => { if (!r.ok || r.kind !== "action" || r.card.kind !== "summary.sales") throw new Error(`expected a Sales summary, got ${JSON.stringify(r).slice(0, 300)}`); return r.card; };
const scope = (r: SendResult): ScopeDraftCard => { if (!r.ok || r.kind !== "action" || r.card.kind !== "estimate.scope") throw new Error(`expected a scope draft, got ${JSON.stringify(r).slice(0, 300)}`); return r.card; };
const ask = (text: string, extra: Partial<Parameters<JarvisAssistant["send"]>[0]> = {}) => a.send({ companyId: ID.co1, text, ...extra });
/** A card as text WITHOUT its random record ids, so "this figure is not on the card" cannot be confused by digits inside an id. */
const text = (card: unknown) => JSON.stringify(card).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
const metric = (c: SalesSummaryCard, label: string) => c.metrics.find((m) => m.label === label);

/** Sentinels: stored financial facts that must never reach a provider request, and the same amount as a figure the person supplies, which may. */
const STORED = { value: 918273, budget: "Stored budget AED 918,273 agreed", terms: "50% deposit, balance 30 days", scopeLine: "Hire rate 4455 per day for the LED wall.", noteLine: "Client said their budget is AED 77,001." };

describe("routing: a Sales question becomes a validated descriptor, locally; actions and writing requests are not hijacked", () => {
  it("questions are read by what they ask, not by a list of sentences", () => {
    const kinds = (t: string, ctx = {}) => { const r = routeMessage(t, ctx); return r.kind === "query" ? (r.query.kind === "scope" || r.query.kind === "financial" ? r.query.kind : `${r.query.kind}:${String(r.query.descriptor.kind)}`) : r.kind; };
    for (const t of ["What needs my attention today?", "what should I focus on today", "What's on my plate?"]) expect(kinds(t), t).toBe("lookup:attention");
    for (const t of ["Show my follow-ups due today", "which follow-ups do I have today?"]) expect(parseSalesQuery(t), t).toEqual({ kind: "lookup", descriptor: { kind: "followups", when: "today" } });
    expect(parseSalesQuery("Show my upcoming follow-ups for the next 14 days")).toEqual({ kind: "lookup", descriptor: { kind: "followups", when: "upcoming", days: 14 } });
    expect(parseSalesQuery("my follow-ups this week")).toEqual({ kind: "lookup", descriptor: { kind: "followups", when: "upcoming", days: 7 } });
    expect(parseSalesQuery("Which of my enquiries have had no activity for 21 days?")).toEqual({ kind: "lookup", descriptor: { kind: "inactive", days: 21 } });
    expect(parseSalesQuery("enquiries that have gone quiet")).toEqual({ kind: "lookup", descriptor: { kind: "inactive", days: 14 } });
    expect(parseSalesQuery("What is the status of OPP-UAE-2026-0007?")).toEqual({ kind: "lookup", descriptor: { kind: "enquiry", reference: "OPP-UAE-2026-0007" } });
    expect(parseSalesQuery("Show my open enquiries")).toMatchObject({ kind: "lookup", descriptor: { kind: "enquiries", scope: "mine", stage: null, named: null } });
    expect(parseSalesQuery("List all our open enquiries in Negotiation")).toMatchObject({ descriptor: { kind: "enquiries", scope: "company", stage: "negotiation" } });
    expect(parseSalesQuery("Open enquiries for Fictional Wave Agency")).toMatchObject({ descriptor: { kind: "enquiries", scope: "company", named: "Fictional Wave Agency" } });
    expect(parseSalesQuery("Summarise this month's enquiries")).toEqual({ kind: "summary", descriptor: { kind: "period", period: "this_month", compare: false, focus: "all", narrative: true } });
    expect(parseSalesQuery("How many enquiries did we win or lose last month?")).toEqual({ kind: "summary", descriptor: { kind: "period", period: "last_month", compare: false, focus: "won_lost", narrative: false } });
    expect(parseSalesQuery("Which events have the most enquiries this year?")).toMatchObject({ kind: "summary", descriptor: { period: "this_year", focus: "events" } });
    expect(parseSalesQuery("What changed in enquiries compared with the previous period?")).toMatchObject({ kind: "summary", descriptor: { compare: true, narrative: true } });
    expect(parseSalesQuery("Summarise OPP-UAE-2026-0007 and its next steps")).toEqual({ kind: "summary", descriptor: { kind: "enquiry", reference: "OPP-UAE-2026-0007" } });
    expect(parseSalesQuery("Summarise this enquiry", { enquiryOnPage: true })).toEqual({ kind: "summary", descriptor: { kind: "enquiry", reference: null } });
    expect(kinds("Draft the estimate scope for OPP-UAE-2026-0007")).toBe("scope");
    // not Sales questions about the records
    for (const t of ["I lost my keys yesterday", "Summarise this email: the client wants two LED walls for their stand and asked about enquiries won last year by their competitors in the region, please keep it short and polite", "What is the capital of France?", "We won!"]) expect(parseSalesQuery(t), t).toBeNull();
    // the Sales actions and writing requests keep their own routes
    expect(kinds("Update the enquiry OPP-UAE-2026-0007: venue is Harbour Hall")).toBe("mode");
    expect(kinds("Move OPP-UAE-2026-0007 to Qualified")).toBe("mode");
    expect(kinds("Create an enquiry for Fictional Wave Agency about two LED walls for the gala dinner in December")).toBe("brief");
    expect(kinds("Write an email to the client about this enquiry", { hasEnquiry: true })).toBe("chat");
    expect(kinds("Draft a reply to this enquiry", { hasEnquiry: true })).toBe("mode");
    expect(kinds("How do I see my open enquiries?")).toBe("knowledge");
    expect(kinds("confirmed")).toBe("greeting"); // a chat line is never a write confirmation
    // overdue keeps its own lookup
    expect(kinds("Show my overdue Sales follow-ups")).toBe("lookup");
  });

  it("a question about stored money is answered with the screen to open: nothing is read, nothing is sent; a draft that uses a figure the person supplies is still a draft", async () => {
    w.opps.push(mkOpp({ company_id: ID.co1, owner_id: ID.u1, value: 918273, currency: "AED", budget_note: "Stored budget AED 918,273" }));
    w.readLog.length = 0;
    for (const t of ["What is the total value of our open enquiries?", "How much revenue did we win last month?", `What is the budget for ${w.opps[0]!.reference}?`, "Summarise the value of our pipeline", "Which enquiry has the highest value?"]) {
      const r = await ask(t);
      expect(r.ok && r.kind === "reply" && r.text, t).toMatch(/do not read, total or summarise values, budgets, prices/);
      expect(r.ok && r.kind === "reply" && r.links.map((l) => l.href), t).toContain("/sales/reports");
    }
    expect(w.readLog.filter((x) => x.startsWith("crm_o") || x === "crm_follow_ups")).toEqual([]);
    expect(simulatedProviderCalls).toHaveLength(0);
    // a figure the person supplies for a piece of writing is ordinary writing
    const draft = await ask("Draft a reply to the client offering 85 per item for 1,200 items; our budget for the job is AED 90,000");
    expect(draft.ok && draft.kind === "action" && draft.card.kind).toBe("chat.reply");
    expect(simulatedProviderCalls[0]!.input).toContain("our budget for the job is AED 90,000");
    // counts stay available
    expect(parseSalesQuery("How many enquiries did we win last month?")).toMatchObject({ kind: "summary" });
  });

  it("a follow-up changes ONE thing of the last question; the result is a fresh descriptor, validated and run again", () => {
    expect(refineQuery("show last month instead", { kind: "summary", descriptor: { kind: "period", period: "this_month", compare: false, focus: "all", narrative: false } })).toMatchObject({ descriptor: { period: "last_month", focus: "all" } });
    expect(refineQuery("compare with the previous period", { kind: "summary", descriptor: { kind: "period", period: "last_month" } })).toMatchObject({ descriptor: { period: "last_month", compare: true } });
    expect(refineQuery("make that shorter", { kind: "summary", descriptor: { kind: "period", period: "last_month" } })).toMatchObject({ descriptor: { narrative: true } });
    expect(refineQuery("the whole company instead", { kind: "lookup", descriptor: { kind: "enquiries", scope: "mine", stage: null } })).toMatchObject({ descriptor: { scope: "company" } });
    expect(refineQuery("only Qualified", { kind: "lookup", descriptor: { kind: "enquiries", scope: "company" } })).toMatchObject({ descriptor: { stage: "qualified", scope: "company" } });
    expect(refineQuery("make it 30 days", { kind: "lookup", descriptor: { kind: "inactive", days: 14 } })).toEqual({ kind: "lookup", descriptor: { kind: "inactive", days: 30 } });
    expect(refineQuery("thanks", { kind: "lookup", descriptor: { kind: "inactive", days: 14 } })).toBeNull();
  });
});

describe("Stage 2: lookups (no provider call, explicit columns, exact totals, honest states)", () => {
  let mine: ReturnType<typeof mkOpp>, theirs: ReturnType<typeof mkOpp>, ksa: ReturnType<typeof mkOpp>;
  beforeEach(() => {
    // u1 holds Sales grants for co1 and co2; u2 for co2 only; u3 none.
    mine = mkOpp({ company_id: ID.co1, owner_id: ID.u1, title: "Fictional harbour gala", stage: "qualified", agency_org_id: w.orgs[0]!.id, client_org_id: w.orgs[1]!.id, created_at: daysAgo(40), value: STORED.value, currency: "AED", budget_note: STORED.budget, payment_terms: STORED.terms, first_response_at: daysAgo(39) });
    theirs = mkOpp({ company_id: ID.co1, owner_id: ID.u2, title: "Fictional desert launch", stage: "negotiation", client_org_id: w.orgs[1]!.id, created_at: daysAgo(10), first_response_at: daysAgo(9) });
    ksa = mkOpp({ company_id: ID.co2, owner_id: ID.u2, title: "Fictional Riyadh expo", stage: "new", client_org_id: w.orgs[1]!.id, created_at: daysAgo(5) });
    w.opps.push(mine, theirs, ksa);
    w.followUps.push(
      { id: "f-over", opportunity_id: mine.id, title: "Call the agency", due_at: daysAgo(2), kind: "call", assigned_to: ID.u1 },
      { id: "f-today", opportunity_id: mine.id, title: "Send the floor plan", due_at: at("2099-10-14T12:00:00Z"), kind: "email", assigned_to: ID.u1 },
      { id: "f-soon", opportunity_id: mine.id, title: "Site visit", due_at: at("2099-10-17T06:00:00Z"), kind: "meeting", assigned_to: ID.u1 },
      { id: "f-later", opportunity_id: mine.id, title: "Chase the PO", due_at: at("2099-11-20T06:00:00Z"), kind: "other", assigned_to: ID.u1 },
      { id: "f-other", opportunity_id: theirs.id, title: "Someone else's task", due_at: at("2099-10-14T12:00:00Z"), kind: "call", assigned_to: ID.u2 },
    );
  });

  it("due today is not overdue; upcoming states its period; other people's follow-ups are not listed; nothing leaves the app", async () => {
    const today = lookup(await ask("Show my follow-ups due today"));
    expect(today.sections[0]!.rows.map((r) => r.primary)).toEqual(["Send the floor plan"]);
    expect(today.total).toBe(1);
    expect(today.filters.join(" ")).toMatch(/2099-10-14/);
    expect(today.filters.join(" ")).toMatch(/already passed is overdue, not due today/);
    expect(today.company.name).toBe("Fictional Enginious UAE LLC");
    expect(today.asOfLabel).toMatch(/Dubai/);
    const soon = lookup(await ask("Show my upcoming follow-ups for the next 7 days"));
    expect(soon.sections[0]!.rows.map((r) => r.primary)).toEqual(["Site visit"]);
    expect(soon.filters.join(" ")).toMatch(/2099-10-15 to 2099-10-21/);
    expect(simulatedProviderCalls).toHaveLength(0);
    expect(w.usage.size).toBe(0);
  });

  it("the Dubai day decides 'today', not the server's UTC day", async () => {
    // 22:30 UTC on 13 October is already 02:30 on 14 October in Dubai.
    const late = make({ now: () => new Date("2099-10-13T22:30:00Z") });
    const c = lookup(await late.send({ companyId: ID.co1, text: "Show my follow-ups due today" }));
    expect(c.filters.join(" ")).toMatch(/2099-10-14/);
    expect(c.sections[0]!.rows.map((r) => r.primary)).toEqual(["Send the floor plan"]);
  });

  it("open enquiries: mine by default; the company-wide view is the Enquiries screen's scope; stage, organisation and event filters; no financial field is read or shown", async () => {
    const own = lookup(await ask("Show my open enquiries"));
    expect(own.sections[0]!.rows.map((r) => r.id)).toEqual([mine.id]);
    expect(own.scope).toMatch(/Owned by you/);
    const all = lookup(await ask("Show all our open enquiries"));
    expect(all.sections[0]!.rows.map((r) => r.id).sort()).toEqual([mine.id, theirs.id].sort()); // never the other company's
    expect(all.scope).toMatch(/Enquiries screen/);
    expect(all.total).toBe(2);
    expect(lookup(await ask("List all our open enquiries in Negotiation")).sections[0]!.rows.map((r) => r.id)).toEqual([theirs.id]);
    const byOrg = lookup(await ask("Open enquiries for Fictional Wave Agency"));
    expect(byOrg.sections[0]!.rows.map((r) => r.id)).toEqual([mine.id]);
    expect(byOrg.filters.join(" ")).toMatch(/Fictional Wave Agency/);
    // an event link
    w.events.push({ id: "e0000000-0000-4000-8000-000000000001", name: "Fictional Tomorrow Transport Forum", archived_at: null });
    w.editions.push({ id: "d0000000-0000-4000-8000-000000000001", event_id: "e0000000-0000-4000-8000-000000000001" });
    theirs.event_edition_id = "d0000000-0000-4000-8000-000000000001";
    const byEvent = lookup(await ask("Open enquiries linked to Fictional Tomorrow Transport Forum"));
    expect(byEvent.sections[0]!.rows.map((r) => r.id)).toEqual([theirs.id]);
    // nothing financial was read for any of it, and none of it is on a card
    const cols = w.selectLog.filter((s) => s.table === "crm_opportunities").map((s) => s.columns).join(",");
    for (const f of FINANCIAL_COLUMNS) expect(cols.split(",").map((c) => c.trim()), f).not.toContain(f);
    expect(text([own, all, byOrg, byEvent])).not.toMatch(/918273|918,273|deposit/);
    expect(simulatedProviderCalls).toHaveLength(0);
  });

  it("a name that matches several records asks ONE question; the choice is a descriptor the server validates and runs again", async () => {
    w.orgs.push({ ...w.orgs[0]!, id: "c0000000-0000-4000-8000-000000000009", name: "Fictional Wave Agency Riyadh" });
    const q = lookup(await ask("Open enquiries for Fictional Wave"));
    expect(q.choices.map((c) => c.label)).toEqual(["Fictional Wave Agency (client or agency)", "Fictional Wave Agency Riyadh (client or agency)"]);
    expect(q.sections).toEqual([]);
    const chosen = lookup(await a.act({ companyId: ID.co1, actionId: "jarvis.sales.lookup.run", input: q.choices[0]!.descriptor }));
    expect(chosen.sections[0]!.rows.map((r) => r.id)).toEqual([mine.id]);
    // an unknown name is an honest "not found", not a list of everything
    const none = lookup(await ask("Open enquiries for Zephyr Nonexistent Holdings"));
    expect(none.empty).toMatch(/could not find/);
    expect(none.sections).toEqual([]);
  });

  it("the total is EXACT and separate from the 25 rows shown", async () => {
    for (let i = 0; i < 40; i++) w.opps.push(mkOpp({ company_id: ID.co1, owner_id: ID.u1, title: `Fictional job ${i}`, stage: "new", client_org_id: w.orgs[1]!.id, created_at: daysAgo(3) }));
    const c = lookup(await ask("Show my open enquiries"));
    expect(c.total).toBe(41);
    expect(c.sections[0]!.total).toBe(41);
    expect(c.sections[0]!.rows).toHaveLength(25);
    expect(c.shown).toBe(25);
  });

  it("no recorded activity: says exactly what it means, uses the stated number of days, and leaves out new enquiries", async () => {
    w.activities.push({ id: "a1", opportunity_id: mine.id, kind: "call", body: "Spoke to the agency", occurred_at: daysAgo(30), internal: false, created_by: ID.u1 });
    const fresh = mkOpp({ company_id: ID.co1, owner_id: ID.u1, title: "Fictional new job", stage: "new", client_org_id: w.orgs[1]!.id, created_at: daysAgo(2) }); w.opps.push(fresh);
    const c = lookup(await ask("Which of my enquiries have had no activity for 14 days?"));
    expect(c.sections[0]!.rows.map((r) => r.id)).toEqual([mine.id]);
    expect(c.title).toMatch(/14 days/);
    expect(c.note).toMatch(/nothing was RECORDED[\s\S]*does not mean nobody contacted the client/);
    expect(lookup(await ask("Which of my enquiries have had no activity for 45 days?")).total).toBe(0);
    // the follow-up re-runs the same question with one thing changed
    const again = lookup(await ask("make it 20 days", { context: { lastQuery: { kind: "lookup", descriptor: c.descriptor } } }));
    expect(again.title).toMatch(/20 days/);
  });

  it("one enquiry by reference: status, parties, dates, follow-ups and last activity; never its value or budget; another company's reference is not found", async () => {
    const c = lookup(await ask(`What is the status of ${mine.reference}?`));
    const facts = Object.fromEntries(c.sections[0]!.rows.map((r) => [r.primary, r.secondary]));
    expect(facts.Stage).toMatch(/^Qualified/);
    expect(facts.Agency).toBe("Fictional Wave Agency");
    expect(facts["End client"]).toBe("Fictional Harbour Brands");
    expect(c.sections[1]!.heading).toBe("Open follow-ups");
    expect(c.sections[1]!.total).toBe(4);
    expect(c.note).toMatch(/Value, budget, estimates and proposals are on the enquiry page/);
    expect(text(c)).not.toMatch(/918273|918,273|deposit/);
    // the same words for "another company" and "does not exist"
    const other = await ask(`What is the status of ${ksa.reference}?`);
    const missing = await ask("What is the status of OPP-UAE-2026-9999?");
    expect(other).toMatchObject({ ok: false, code: "not_permitted" });
    expect(!other.ok && !missing.ok && other.message === missing.message).toBe(true);
  });

  it("'what needs my attention today' gives reasons, lists one enquiry once, and names a part it could not load instead of showing nothing", async () => {
    const noNext = mkOpp({ company_id: ID.co1, owner_id: ID.u1, title: "Fictional job with no next action", stage: "new", client_org_id: w.orgs[1]!.id, created_at: daysAgo(6) }); // also has no first response: listed once
    const held = mkOpp({ company_id: ID.co1, owner_id: ID.u1, title: "Fictional held job", stage: "on_hold", client_org_id: w.orgs[1]!.id, hold_review_date: "2099-10-10", first_response_at: daysAgo(50), created_at: daysAgo(60) });
    w.opps.push(noNext, held);
    const c = lookup(await ask("What needs my attention today?"));
    expect(c.sections.map((s) => [s.heading, s.total])).toEqual([["Overdue follow-ups", 1], ["Follow-ups due today", 1], ["On hold: review date has arrived", 1], ["No next action planned", 1]]);
    expect(c.sections.every((s) => typeof s.note === "string" && s.note.length > 10)).toBe(true);
    const all = c.sections.flatMap((s) => s.rows.map((r) => r.id));
    expect(all.filter((id) => id === noNext.id)).toHaveLength(1);
    expect(c.unavailable).toEqual([]);
    // one source fails: the answer is partial and says which part; it is not zero
    w.failTables = ["crm_opportunities"];
    const partial = lookup(await ask("What needs my attention today?"));
    expect(partial.unavailable.join(" ")).toMatch(/your open enquiries/);
    expect(partial.empty).toBeNull();
    // everything fails: a refusal, never "nothing needs your attention"
    w.failTables = ["crm_opportunities", "crm_follow_ups"];
    expect(await ask("What needs my attention today?")).toMatchObject({ ok: false, code: "lookup_failed" });
  });

  it("empty, denied, failed and paused are four different answers", async () => {
    w.followUps = [];
    const empty = lookup(await ask("Show my follow-ups due today"));
    expect(empty.total).toBe(0);
    expect(empty.empty).toMatch(/No matching follow-ups/);
    w.failTables = ["crm_follow_ups"];
    expect(await ask("Show my follow-ups due today")).toMatchObject({ ok: false, code: "lookup_failed", message: expect.stringMatching(/failed lookup, not an empty result/) });
    w.failTables = [];
    // u2 has no grant for co1: refused before anything is read
    w.readLog.length = 0;
    const denied = await as(ID.u2).send({ companyId: ID.co1, text: "Show all our open enquiries" });
    expect(denied.ok).toBe(false);
    expect(w.readLog.filter((t) => t.startsWith("crm_o") || t === "crm_follow_ups")).toEqual([]);
    const paused = await make({ config: { paused: ["lookups"] } }).send({ companyId: ID.co1, text: "Show my open enquiries" });
    expect(paused).toMatchObject({ ok: false, code: "paused" });
  });

  it("access isolation: another company's records never appear; a forged descriptor, a forged id and a revoked grant give nothing", async () => {
    // u2 (KSA only) asks in KSA: sees KSA, never UAE
    const u2 = as(ID.u2);
    const own = lookup(await u2.send({ companyId: ID.co2, text: "Show all our open enquiries" }));
    expect(own.sections[0]!.rows.map((r) => r.id)).toEqual([ksa.id]);
    // a descriptor altered in the browser to carry another company's organisation, event or enquiry id is only a question: the read is still the session's
    const forged = await u2.act({ companyId: ID.co2, actionId: "jarvis.sales.lookup.run", input: { kind: "enquiry", id: mine.id } });
    expect(forged).toMatchObject({ ok: false, code: "not_permitted" });
    expect(await u2.act({ companyId: ID.co1, actionId: "jarvis.sales.lookup.run", input: { kind: "enquiries", scope: "company" } })).toMatchObject({ ok: false });
    // extra keys (a company, a user, rows) are not part of a descriptor
    const extra = lookup(await u2.act({ companyId: ID.co2, actionId: "jarvis.sales.lookup.run", input: { kind: "enquiries", scope: "company", company_id: ID.co1, owner_id: ID.u1, rows: [{ id: mine.id }] } }));
    expect(extra.sections[0]!.rows.map((r) => r.id)).toEqual([ksa.id]);
    expect(await u2.act({ companyId: ID.co2, actionId: "jarvis.sales.lookup.run", input: { kind: "everything" } })).toMatchObject({ ok: false });
    // a stale context from another company: the follow-up runs for the company selected NOW, under today's permissions
    w.signedIn = ID.u1; a = make();
    const uae = lookup(await ask("Show all our open enquiries"));
    const switched = lookup(await a.send({ companyId: ID.co2, text: "only New enquiry", context: { lastQuery: { kind: "lookup", descriptor: uae.descriptor } } }));
    expect(switched.company.name).toBe("Fictional Enginious KSA LLC");
    expect(switched.sections[0]!.rows.map((r) => r.id)).toEqual([ksa.id]);
    // the grant is revoked: the very next question is refused
    w.grants.find((g) => g.user_id === ID.u1 && g.company_id === ID.co1)!.revoked_at = new Date().toISOString();
    expect((await ask("Show my open enquiries")).ok).toBe(false);
    // a question that names a company other than the selected one is not answered about the wrong company
    w.grants.find((g) => g.user_id === ID.u1 && g.company_id === ID.co1)!.revoked_at = null;
    const named = await ask("Summarise this month's enquiries for Fictional Enginious KSA LLC");
    expect(named.ok && named.kind === "reply" && named.text).toMatch(/another company is selected/);
  });

  it("every column list of the projection is free of financial columns", () => {
    for (const list of [ENQUIRY_COLUMNS, ENQUIRY_TEXT_COLUMNS, FOLLOW_UP_COLUMNS, ACTIVITY_COLUMNS, ACTIVITY_TEXT_COLUMNS]) for (const c of list.split(",").map((x) => x.trim())) expect(FINANCIAL_COLUMNS as readonly string[], c).not.toContain(c);
  });
});

describe("Stage 3: summaries (figures computed by the app; the model only words them)", () => {
  const inOct = (d: number) => at(`2099-10-${String(d).padStart(2, "0")}T08:00:00Z`);
  const inSep = (d: number) => at(`2099-09-${String(d).padStart(2, "0")}T08:00:00Z`);
  beforeEach(() => {
    const client = w.orgs[1]!.id;
    w.events.push({ id: "e0000000-0000-4000-8000-000000000001", name: "Fictional Tomorrow Transport Forum", archived_at: null }, { id: "e0000000-0000-4000-8000-000000000002", name: "Fictional Taste Tomorrow", archived_at: null });
    w.editions.push({ id: "d0000000-0000-4000-8000-000000000001", event_id: "e0000000-0000-4000-8000-000000000001" }, { id: "d0000000-0000-4000-8000-000000000002", event_id: "e0000000-0000-4000-8000-000000000002" }, { id: "d0000000-0000-4000-8000-000000000003", event_id: "e0000000-0000-4000-8000-000000000001" });
    const mk = (over: Partial<ReturnType<typeof mkOpp>>) => w.opps.push(mkOpp({ company_id: ID.co1, client_org_id: client, value: STORED.value, currency: "AED", budget_note: STORED.budget, ...over }));
    // October (so far): 5 created, 2 won, 1 lost. September: 3 created, 1 won, 2 lost.
    mk({ created_at: inOct(2), stage: "new", source: "referral", event_edition_id: "d0000000-0000-4000-8000-000000000001" });
    mk({ created_at: inOct(3), stage: "qualified", source: "referral", event_edition_id: "d0000000-0000-4000-8000-000000000003" });
    mk({ created_at: inOct(5), stage: "won", closed_at: inOct(12), source: "whatsapp", event_edition_id: "d0000000-0000-4000-8000-000000000002" });
    mk({ created_at: inOct(6), stage: "lost", closed_at: inOct(13), lost_reason: "Budget lower than scope", source: "website" });
    mk({ created_at: inOct(7), stage: "new", source: null });
    mk({ created_at: inSep(2), stage: "won", closed_at: inOct(1), source: "linkedin" });
    mk({ created_at: inSep(3), stage: "won", closed_at: inSep(20), source: "referral" });
    mk({ created_at: inSep(4), stage: "lost", closed_at: inSep(21), lost_reason: "Went with another supplier at AED 40,000" });
    mk({ created_at: at("2099-08-10T08:00:00Z"), stage: "lost", closed_at: inSep(5), lost_reason: "Event cancelled" });
    // another company's enquiry in the same period: never counted
    w.opps.push(mkOpp({ company_id: ID.co2, client_org_id: client, created_at: inOct(4), stage: "won", closed_at: inOct(9) }));
    // a closure in October that was reopened later: reported apart, not as won
    w.closures.push({ id: "c1", company_id: ID.co1, opportunity_id: w.opps[0]!.id, outcome: "won", closed_at: inOct(8), reopened_at: inOct(9), value_at_close: STORED.value });
  });

  it("periods are Dubai calendar dates, and the previous equivalent period is stated", () => {
    expect(resolveWindow("this_month", NOW)).toMatchObject({ current: { from: "2099-10-01", to: "2099-10-14" }, previous: { from: "2099-09-01", to: "2099-09-14" } });
    expect(resolveWindow("last_month", NOW)).toMatchObject({ current: { from: "2099-09-01", to: "2099-09-30" }, previous: { from: "2099-08-01", to: "2099-08-31" } });
    expect(resolveWindow("last_7_days", NOW)).toMatchObject({ current: { from: "2099-10-08", to: "2099-10-14" }, previous: { from: "2099-10-01", to: "2099-10-07" } });
    // 22:30 UTC on 30 September is already 1 October in Dubai
    expect(resolveWindow("this_month", new Date("2099-09-30T22:30:00Z")).current).toMatchObject({ from: "2099-10-01", to: "2099-10-01" });
  });

  it("'how many did we win or lose' is answered locally: exact counts, definitions, the denominator, supporting records, no provider call", async () => {
    const c = summary(await ask("How many enquiries did we win or lose this month?"));
    expect(metric(c, "Won")!.value).toBe(2);
    expect(metric(c, "Lost")!.value).toBe(1);
    expect(metric(c, "Share won of those closed (%)")).toMatchObject({ value: 67, definition: expect.stringMatching(/2 of 3/) });
    expect(metric(c, "Closures later reopened")!.value).toBe(1);
    expect(metric(c, "Won")!.definition).toMatch(/Won now and whose closing date falls in the period/);
    expect(c.period).toMatch(/October 2099 so far \(2099-10-01 to 2099-10-14, Dubai dates\)/);
    expect(c.scope).toMatch(/Sales reports/);
    expect(c.coverage.join(" ")).toMatch(/CURRENT stage and closing date/);
    expect(c.coverage.join(" ")).toMatch(/won enquiry is not a delivered project/);
    expect(c.supporting.map((s) => [s.heading, s.total, s.rows.length])).toEqual([["Won in the period", 2, 2], ["Lost in the period", 1, 1]]);
    expect(c.narrative).toBeNull();
    expect(simulatedProviderCalls).toHaveLength(0);
    expect(w.usage.size).toBe(0);
  });

  it("a comparison uses the previous equivalent period; a zero denominator is 'not calculated', never a made-up trend", async () => {
    const c = summary(await ask("How many enquiries did we win or lose last month compared with the previous month?"));
    expect(c.period).toMatch(/September 2099/);
    expect(c.comparedWith).toMatch(/August 2099/);
    expect(metric(c, "Won")).toMatchObject({ value: 1, previous: 0 });
    expect(metric(c, "Lost")).toMatchObject({ value: 2, previous: 0 });
    expect(metric(c, "Share won of those closed (%)")).toMatchObject({ value: 33, previous: null }); // nothing closed in August: no share, not 0%
    w.opps = w.opps.filter((o) => !o.closed_at);
    const none = summary(await ask("How many enquiries did we win or lose this month?"));
    expect(metric(none, "Share won of those closed (%)")).toBeUndefined();
    expect(none.coverage.join(" ")).toMatch(/nothing to divide by/);
  });

  it("events with the most enquiries: counted per event across its editions, with what is not linked stated", async () => {
    const c = summary(await ask("Which events have the most enquiries this month?"));
    const g = c.groups.find((x) => x.heading === "Events with the most enquiries")!;
    expect(g.rows).toEqual([{ label: "Fictional Tomorrow Transport Forum", count: 2 }, { label: "Fictional Taste Tomorrow", count: 1 }]);
    expect(g.definition).toMatch(/2 of 5 are not linked to any event/);
    expect(simulatedProviderCalls).toHaveLength(0);
  });

  it("more than the display cap: totals stay exact, the supporting list is capped and says so through its total", async () => {
    for (let i = 0; i < 40; i++) w.opps.push(mkOpp({ company_id: ID.co1, client_org_id: w.orgs[1]!.id, created_at: inOct(2), stage: "won", closed_at: inOct(10) }));
    const c = summary(await ask("How many enquiries did we win or lose this month?"));
    expect(metric(c, "Won")!.value).toBe(42);
    const won = c.supporting.find((s) => s.heading === "Won in the period")!;
    expect(won.total).toBe(42);
    expect(won.rows).toHaveLength(25);
  });

  it("PROVIDER REQUEST (sentinels): a summary in words sends counts, names and definitions; never a stored value, budget or priced lost reason; the app's figures stay authoritative", async () => {
    const c = summary(await ask("Summarise this month's enquiries"));
    expect(simulatedProviderCalls).toHaveLength(1);
    const req = simulatedProviderCalls[0]!;
    expect(req.sources).toEqual(["user_text", "sales_facts"]);
    expect(req.task).toBe("sales_summary");
    for (const piece of ["Enquiries created: 5", "Won: 2", "Lost: 1", "Share won of those closed (%): 67", "Events with the most enquiries: Fictional Tomorrow Transport Forum\nCount for the line above: 2", "Recorded lost reasons: Budget lower than scope\nCount for the line above: 1", "Fictional Enginious UAE LLC", "2099-10-01 to 2099-10-14"]) expect(req.input, piece).toContain(piece);
    expect(req.input).not.toMatch(/918273|918,273|Stored budget|deposit|AED/);
    expect(req.facts).toBeUndefined(); // the gate folded the facts into the one text it screened
    expect(c.narrative).toMatch(/^In short: /);
    expect(c.narrativeNote).toMatch(/Wording by the AI model/);
    expect(c.suggestions).toEqual(["Review the open follow-ups."]);
    expect(metric(c, "Won")!.value).toBe(2); // figures come from the app, not from the wording
    expect(JSON.stringify(c)).not.toMatch(/"execute"|"role"/);
    expect([...w.usage.values()]).toEqual([1]);
    // a recorded lost reason that carries a price is counted without its wording, on the card and in the request
    simulatedProviderCalls.length = 0;
    const sep = summary(await ask("Summarise last month's enquiries"));
    expect(sep.groups.find((g) => g.heading === "Recorded lost reasons")!.rows.map((r) => r.label).sort()).toEqual(["A reason with details that stay on the enquiry", "Event cancelled"].sort());
    expect(simulatedProviderCalls[0]!.input).not.toMatch(/40,000|another supplier/);
  });

  it("the wording cannot change the facts: a wrong number, an amount of money, a delivery claim or an unusable answer is dropped and the figures are shown alone", async () => {
    for (const bad of ["wrong_number", "money", "delivered", "malformed"] as const) {
      simulatedBehaviour.summary = bad;
      const c = summary(await ask("Summarise this month's enquiries"));
      expect(c.narrative, bad).toBeNull();
      expect(c.suggestions, bad).toEqual([]);
      expect(c.narrativeNote, bad).toMatch(/did not match the figures|could not be used/);
      expect(metric(c, "Enquiries created")!.value, bad).toBe(5);
      expect(text(c), bad).not.toMatch(/9871|450,000|delivered\./);
    }
    expect(narrativeMatchesFacts("There were 5 created and 2 won.", new Set(["5", "2"]))).toBe(true);
    expect(narrativeMatchesFacts("There were 6 created.", new Set(["5", "2"]))).toBe(false);
    expect(narrativeMatchesFacts("About 2.5 per week.", new Set(["2", "5"]))).toBe(false);
  });

  it("a provider failure, a paused chat or a reached limit leaves the successful lookup usable", async () => {
    const failing: JarvisProvider = { kind: "simulated", structured: async () => { throw new (await import("./provider/types")).JarvisProviderError("timeout"); } };
    const t = summary(await make({ provider: failing }).send({ companyId: ID.co1, text: "Summarise this month's enquiries" }));
    expect(metric(t, "Enquiries created")!.value).toBe(5);
    expect(t.narrative).toBeNull();
    expect(t.narrativeNote).toMatch(/took too long[\s\S]*computed by Enginious OS/);
    const paused = summary(await make({ config: { paused: ["chat"] } }).send({ companyId: ID.co1, text: "Summarise this month's enquiries" }));
    expect(paused.narrativeNote).toMatch(/paused/);
    expect(metric(paused, "Won")!.value).toBe(2);
    const limited = summary(await make({ config: { dailyLimit: 0 } }).send({ companyId: ID.co1, text: "Summarise this month's enquiries" }));
    expect(limited.narrativeNote).toMatch(/limit/);
    expect(simulatedProviderCalls).toHaveLength(0);
    // a failed count is a failed lookup, never a zero
    w.failTables = ["crm_opportunities"];
    expect(await ask("How many enquiries did we win or lose this month?")).toMatchObject({ ok: false, code: "lookup_failed", message: expect.stringMatching(/not a zero/) });
  });

  it("a follow-up is a new validated question: 'show last month instead' re-reads the data; browser-supplied rows or numbers are ignored; a revoked grant stops it", async () => {
    const first = summary(await ask("How many enquiries did we win or lose this month?"));
    const tampered = { ...first.descriptor, metrics: [{ label: "Won", value: 999 }], company_id: ID.co2, rows: ["x"] };
    const next = summary(await ask("show last month instead", { context: { lastQuery: { kind: "summary", descriptor: tampered } } }));
    expect(next.period).toMatch(/September 2099/);
    expect(metric(next, "Won")!.value).toBe(1);
    // the tampered number and the extra keys are nowhere: the figures are the app's own, and the descriptor that comes back holds only its own keys
    expect(next.metrics.map((m) => m.value)).toEqual([1, 2, 33]);
    expect(Object.keys(next.descriptor).sort()).toEqual(["compare", "focus", "kind", "narrative", "period"]);
    // the company switched: the same follow-up answers for the company selected now
    const ksa = summary(await a.send({ companyId: ID.co2, text: "show this month instead", context: { lastQuery: { kind: "summary", descriptor: first.descriptor } } }));
    expect(ksa.company.name).toBe("Fictional Enginious KSA LLC");
    expect(metric(ksa, "Won")!.value).toBe(1);
    w.grants.find((g) => g.user_id === ID.u1 && g.company_id === ID.co1)!.revoked_at = new Date().toISOString();
    expect((await ask("show last month instead", { context: { lastQuery: { kind: "summary", descriptor: first.descriptor } } })).ok).toBe(false);
    // "make that shorter" refers to the summary only while the panel still sends its question (the panel drops it once a general chat reply is the latest answer);
    // without it, the same line continues the general conversation
    w.grants.find((g) => g.user_id === ID.u1 && g.company_id === ID.co1)!.revoked_at = null;
    const turns = [{ role: "user" as const, text: "Draft an email" }, { role: "jarvis" as const, text: "Hello [name], ..." }];
    const chatty = await ask("make that shorter", { context: { turns } });
    expect(chatty.ok && chatty.kind === "action" && chatty.card.kind).toBe("chat.reply");
    const refined = summary(await ask("make that shorter", { context: { turns, lastQuery: { kind: "summary", descriptor: first.descriptor } } }));
    expect(refined.descriptor).toMatchObject({ kind: "period", narrative: true });
    // more ids than one filter carries are read in batches, with the same result
    for (let i = 0; i < 230; i++) w.opps.push(mkOpp({ company_id: ID.co1, owner_id: ID.u1, client_org_id: w.orgs[1]!.id, stage: "new", created_at: at("2099-08-01T08:00:00Z") }));
    const quiet = await ask("Which of my enquiries have had no activity for 14 days?");
    expect(quiet.ok && quiet.kind === "action" && quiet.card.kind === "lookup.sales" && quiet.card.total).toBe(230);
    expect(w.selectLog.filter((x) => x.table === "crm_activities").length).toBeGreaterThanOrEqual(3);
  });

  it("PROVIDER REQUEST (sentinels): one enquiry's summary sends its operational facts and screened text; stored financial fields and financial sentences in its text never leave", async () => {
    const e = mkOpp({
      company_id: ID.co1, owner_id: ID.u1, title: "Fictional gesture wall", stage: "proposal_prep", agency_org_id: w.orgs[0]!.id, client_org_id: w.orgs[1]!.id, location: "Fictional Crescent Centre, Abu Dhabi", event_start: "2099-11-18", event_end: "2099-11-20",
      value: STORED.value, currency: "AED", budget_note: STORED.budget, payment_terms: STORED.terms, technologies: [{ name: "Gesture wall software", qty: 2 }],
      brief: "The agency wants a gesture-controlled wall with two counters, six products per counter, on an RTX 4070. Their budget is AED 65,000 to 80,000.",
      scope: `Software for two counters. ${STORED.scopeLine} The agency supplies the LED wall.`,
    });
    w.opps.push(e);
    w.activities.push({ id: "a9", opportunity_id: e.id, kind: "call", body: `Agency confirmed two counters. ${STORED.noteLine} Arabic translation is not confirmed.`, occurred_at: daysAgo(2), internal: false, created_by: ID.u1 });
    w.followUps.push({ id: "f9", opportunity_id: e.id, title: "Email the scope response", due_at: at("2099-10-20T06:00:00Z"), kind: "email", assigned_to: ID.u1 });
    const c = summary(await ask(`Summarise ${e.reference} and its next steps`));
    expect(simulatedProviderCalls).toHaveLength(1);
    const req = simulatedProviderCalls[0]!;
    expect(req.sources).toEqual(["user_text", "sales_facts", "sales_record_text"]);
    // approved operational facts arrive, non-financial numbers included
    for (const piece of [`Enquiry reference: ${e.reference}`, "Enquiry title: Fictional gesture wall", "Stage: Proposal preparation", "Agency: Fictional Wave Agency", "End client: Fictional Harbour Brands", "Event start date: 2099-11-18", "Requested technology: Gesture wall software (quantity 2)", "Open follow-up: Email the scope response, due 2099-10-20", "two counters, six products per counter, on an RTX 4070", "Software for two counters.", "The agency supplies the LED wall.", "Agency confirmed two counters.", "Arabic translation is not confirmed."]) expect(req.input, piece).toContain(piece);
    // stored financial fields and financial sentences of the record's own text do not
    for (const secret of ["918273", "918,273", "Stored budget", "deposit", "65,000", "80,000", "4455", "Hire rate", "77,001", "budget is"]) expect(req.input, secret).not.toContain(secret);
    expect(w.selectLog.filter((s) => s.table === "crm_opportunities").every((s) => !/\b(?:value|currency|budget_note|payment_terms)\b/.test(s.columns))).toBe(true);
    expect(c.coverage.join(" ")).toMatch(/1 sentence of the brief mention figures/);
    expect(c.coverage.join(" ")).toMatch(/Value, budget, payment terms, estimates and proposals were not read/);
    expect(c.narrative).toMatch(/^In short: /);
    expect(text(c)).not.toMatch(/918273|77,001|4455/);
    // a brief marked as not for external sharing is left out entirely, and the card says so
    e.brief = "CONFIDENTIAL - do not forward\nThe agency wants a gesture wall.";
    simulatedProviderCalls.length = 0;
    const marked = summary(await ask(`Summarise ${e.reference} and its next steps`));
    expect(simulatedProviderCalls[0]!.input).not.toMatch(/CONFIDENTIAL|do not forward/);
    expect(marked.coverage.join(" ")).toMatch(/brief is marked or worded in a way that keeps it inside/);
    // another company's enquiry: not found, nothing sent
    simulatedProviderCalls.length = 0;
    const ksa = mkOpp({ company_id: ID.co2, owner_id: ID.u2 }); w.opps.push(ksa);
    expect(await ask(`Summarise ${ksa.reference} and its next steps`)).toMatchObject({ ok: false, code: "not_permitted" });
    expect(simulatedProviderCalls).toHaveLength(0);
  });
});

describe("the provenance rule at the outbound gate (the same amount, two origins)", () => {
  const sent: StructuredRequest[] = [];
  const inner: JarvisProvider = { kind: "simulated", structured: async (r) => { sent.push(r); return {}; } };
  const base = { task: "sales_summary", instructions: "x", jsonSchema: {}, maxOutputTokens: 100, timeoutMs: 1000 };
  const gate = (id: string) => gateProvider(inner, id)!;
  beforeEach(() => { sent.length = 0; });

  it("a figure the person supplies goes out; the same figure in app-held text or a fact value is refused; a browser label cannot move it across", async () => {
    // user-supplied working figures: allowed, in chat and in a summary request
    await gate("jarvis.sales.chat.reply").structured({ ...base, sources: ["user_text"], input: "<message>\nDraft a reply: our rate is 85 per item, budget AED 77,001, our cost 60.\n</message>", inputTag: null });
    expect(sent).toHaveLength(1);
    // the same amounts as app-held record text: refused
    await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_record_text"], input: "<request>\nSummarise\n</request>", inputTag: null, recordText: "Client said their budget is AED 77,001." })).rejects.toMatchObject({ code: "protected_content" });
    await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_record_text"], input: "<request>\nSummarise\n</request>", inputTag: null, recordText: "Rate 85 per item." })).rejects.toMatchObject({ code: "protected_content" });
    // as a fact value: refused (a currency-less rate, a range, a ratio in words)
    for (const value of ["Budget AED 77,001", "rate 85 per item", "between 65,000 and 80,000", "margin 30%", "turnover up 12 percent"]) await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_facts"], input: "<request>\nSummarise\n</request>", inputTag: null, facts: [{ label: "Enquiry title", value }] }), value).rejects.toMatchObject({ code: "protected_content" });
    // a number is a count only: not a decimal, not a huge figure
    await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_facts"], input: "<request>\nx\n</request>", inputTag: null, facts: [{ label: "Won", value: 918273.5 }] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_facts"], input: "<request>\nx\n</request>", inputTag: null, facts: [{ label: "Value AED 5", value: 1 }] })).rejects.toMatchObject({ code: "unavailable" });
    // declaring the wrong source does not launder app data: app fields need their app source, and a capability without that source cannot carry them at all
    await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text"], input: "<request>\nx\n</request>", inputTag: null, recordText: "The agency supplies the LED wall." })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gate("jarvis.sales.chat.reply").structured({ ...base, sources: ["user_text", "sales_record_text"], input: "<message>\nhi\n</message>", inputTag: null, recordText: "The agency supplies the LED wall." })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gate("jarvis.sales.draft_reply").structured({ ...base, sources: ["user_text"], input: "hello", facts: [{ label: "Won", value: 2 }] })).rejects.toMatchObject({ code: "unavailable" });
    // a sharing restriction inside a record stops the request
    await expect(gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_record_text"], input: "<request>\nx\n</request>", inputTag: null, recordText: "Internal use only.\nThe agency supplies the LED wall." })).rejects.toMatchObject({ code: "protected_content" });
    expect(sent).toHaveLength(1);
    // clean app data passes, appended by the gate in its own block
    await gate("jarvis.sales.summary.run").structured({ ...base, sources: ["user_text", "sales_facts", "sales_record_text"], input: "<request>\nSummarise\n</request>", inputTag: null, facts: [{ label: "Won", value: 2 }, { label: "Event start date", value: "2099-11-18" }], recordText: "Two counters, six products per counter, RTX 4070." });
    expect(sent[1]!.input).toBe("<request>\nSummarise\n</request>\n<enginious_os_data>\nWon: 2\nEvent start date: 2099-11-18\nTwo counters, six products per counter, RTX 4070.\n</enginious_os_data>");
  });

  it("the content screen by origin: working figures pass as user text and fail as app text; non-financial numbers pass in both", () => {
    for (const t of ["Our rate is 85 per item.", "Client budget: AED 65,000 to 80,000", "Our cost is 60 each.", "Proposed project value AED 120,000.", "Working estimate 45k."]) {
      expect(findProtectedContent(t, "user"), t).toEqual([]);
      expect(findProtectedContent(t, "app"), t).toContain("stored_financial");
    }
    for (const t of ["Two counters, six products per counter, an RTX 4070.", "Event 18 to 20 May 2027, installation from 16 May after 10 am.", "A 4-by-2.5-metre LED wall and a 55-inch screen.", "Ready on 2027-09-06 for testing; 3 show days.", "1200 wristbands for 6 groups of 12 minutes."]) {
      expect(findProtectedContent(t, "user"), t).toEqual([]);
      expect(hasStoredFinancial(t), t).toBe(false);
    }
    // sensitive employee data and company results are refused whatever the origin
    for (const t of ["Sara's salary is AED 18,500.", "Passport number N4471923.", "Turnover last year was AED 3,400,000.", "See the general ledger."]) for (const o of ["user", "app"] as const) expect(findProtectedContent(t, o).length, `${t} (${o})`).toBeGreaterThan(0);
    expect(redactAppText("Software for two counters. Hire rate 4455 per day. The agency supplies the wall.")).toEqual({ text: "Software for two counters. The agency supplies the wall.", removed: 1, omitted: false });
    expect(redactAppText("NDA\nThe agency supplies the wall.")).toMatchObject({ text: "", omitted: true });
  });
});

describe("Stage 4: scope wording for an estimate (no prices, nothing saved)", () => {
  it("drafts scope lines from the request and the enquiry's screened scope; never reads or sends a stored price; a line with money is dropped; nothing is written", async () => {
    const e = mkOpp({ company_id: ID.co1, owner_id: ID.u1, title: "Fictional product counters", stage: "qualified", client_org_id: w.orgs[1]!.id, value: STORED.value, currency: "AED", budget_note: STORED.budget, technologies: [{ name: "Product-recognition counter software", qty: 2 }], scope: `Two counters, each independent. ${STORED.scopeLine} Shipping is excluded.` });
    w.opps.push(e);
    const c = scope(await ask(`Draft the estimate scope for ${e.reference}`));
    const req = simulatedProviderCalls[0]!;
    expect(req.task).toBe("estimate_scope");
    expect(req.sources).toEqual(["user_text", "sales_facts", "sales_record_text"]);
    for (const piece of [`Draft the estimate scope for ${e.reference}`, "Requested technology: Product-recognition counter software (quantity 2)", "Two counters, each independent.", "Shipping is excluded."]) expect(req.input, piece).toContain(piece);
    for (const secret of ["918273", "Stored budget", "4455", "Hire rate"]) expect(req.input, secret).not.toContain(secret);
    expect(c.text).toMatch(/Product-recognition counter software \(quantity 2\)/);
    expect(c.enquiry).toMatchObject({ reference: e.reference });
    expect(c.note).toMatch(/no prices, creates no estimate and saves nothing/);
    expect(c.note).toMatch(/1 sentence of the enquiry's scope mention figures/);
    expect(c.links.map((l) => l.href)).toContain("/sales/proposals");
    expect(w.rpcLog.filter((x) => !["jarvis_my_access", "jarvis_usage_take"].includes(x.name))).toEqual([]);
    expect(w.readLog).not.toContain("crm_proposals");
    // the model wrote a priced line: it is dropped before display
    simulatedBehaviour.scope = "money";
    const priced = scope(await ask(`Draft the estimate scope for ${e.reference}`));
    expect(priced.text).not.toMatch(/AED|12,000/);
    expect(priced.note).toMatch(/Lines that mentioned an amount of money were left out/);
    // a working figure the person supplies goes out with their request (provenance), but the draft itself stays without money
    simulatedBehaviour.scope = "ok"; simulatedProviderCalls.length = 0;
    scope(await ask("Draft the scope of work for an estimate: two LED walls and a touch table, client budget around AED 50,000"));
    expect(simulatedProviderCalls[0]!.input).toContain("client budget around AED 50,000");
    expect(simulatedProviderCalls[0]!.sources).toEqual(["user_text"]);
    // a pasted prepared estimate document is not sent
    simulatedProviderCalls.length = 0;
    const doc = await ask("Draft the scope of work for an estimate from this:\nQuotation No: Q-2099-0142\nLED wall AED 40,000\nSubtotal AED 40,000\nVAT 5% AED 2,000\nGrand total AED 42,000");
    expect(doc.ok && doc.kind === "action").toBe(false);
    expect(simulatedProviderCalls).toHaveLength(0);
    // another company's enquiry is not found
    const ksa = mkOpp({ company_id: ID.co2, owner_id: ID.u2 }); w.opps.push(ksa);
    expect(await ask(`Draft the estimate scope for ${ksa.reference}`)).toMatchObject({ ok: false, code: "not_permitted" });
  });

  it("the boundaries are stated, not automated: Won, Lost, hold, reassignment and estimate finalisation stay on their screens", async () => {
    const e = mkOpp({ company_id: ID.co1, owner_id: ID.u1, stage: "negotiation", client_org_id: w.orgs[1]!.id }); w.opps.push(e);
    for (const t of [`Mark ${e.reference} as won`, `Mark ${e.reference} as lost`, `Put ${e.reference} on hold`]) {
      const r = await ask(t);
      expect(JSON.stringify(r), t).toMatch(/enquiry page|Sales|cannot|not something JARVIS/i);
      expect(r.ok && r.kind === "action" && r.confirmation, t).toBeFalsy();
    }
    expect(w.rpcLog.filter((x) => x.name.startsWith("jarvis_") && !["jarvis_my_access", "jarvis_usage_take", "jarvis_pref_list"].includes(x.name))).toEqual([]);
  });
});
