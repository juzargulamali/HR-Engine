import "server-only";
import { z } from "zod";
import { CRM_PIPELINE_STAGES, CRM_STAGE_IDS, CRM_TIME_ZONE, crmStageLabel, crmToday, daysOverdue, dubaiDateTimeToIso, isCrmActive } from "@enginious-hr/domain";
import { addDays } from "@/lib/crm/reports";
import { displaySafe } from "../outbound";
import type { LookupRow, LookupSection, SalesLookupCard } from "../protocol";
import { JarvisRefusalError, type JarvisActionDefinition, type JarvisContext } from "../types";
import { ACTIVITY_COLUMNS, ENQUIRY_COLUMNS, FOLLOW_UP_COLUMNS, inBatches, type EnquiryRow } from "./projection";

export const SALES_LOOKUP_ID = "jarvis.sales.lookup.run";
/** Rows shown per list (the same cap as the first lookup). The total is counted separately and exactly. */
export const LOOKUP_LIMIT = 25;
/** The most enquiries one "no activity" or "attention" pass will consider. Above it the card says the answer covers only the first SCAN_LIMIT. */
export const SCAN_LIMIT = 500;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const name = z.string().trim().min(2).max(120);
/**
 * THE QUERY DESCRIPTOR: the only thing a lookup is built from. It is bounded and validated here on every call, including a follow-up ("show the whole company instead")
 * and a choice the person clicks. It carries no rows, no company and no user: the company is the one selected in the panel and authorised again by the dispatcher, the
 * person is the signed-in session. A descriptor the browser altered can only ask a different allowed question about records that session can read.
 */
export const lookupDescriptor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("followups"), when: z.enum(["today", "upcoming"]), days: z.number().int().min(1).max(60).default(7) }),
  z.object({
    kind: z.literal("enquiries"), scope: z.enum(["mine", "company"]).default("mine"), stage: z.enum(CRM_STAGE_IDS).nullable().default(null),
    org: z.object({ id: uuid.nullable().default(null), name: name.nullable().default(null) }).nullable().default(null),
    event: z.object({ id: uuid.nullable().default(null), name: name.nullable().default(null) }).nullable().default(null),
    /** A name the person gave without saying whether it is an organisation or an event: both are searched. */
    named: name.nullable().default(null),
  }),
  z.object({ kind: z.literal("inactive"), days: z.number().int().min(1).max(365).default(14) }),
  z.object({ kind: z.literal("enquiry"), reference: z.string().trim().max(40).nullable().default(null), id: uuid.nullable().default(null) }),
  z.object({ kind: z.literal("attention") }),
]);
export type LookupDescriptor = z.infer<typeof lookupDescriptor>;

const FAILED = "I could not load that just now. This is a failed lookup, not an empty result: try again in a moment, or open the screen in Sales.";
const KIND: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", proposal: "Proposal", other: "Other" };
type Sb = JarvisContext["supabase"];
type Res<T> = { data: T[] | null; error: unknown; count?: number | null };
const failed = (): never => { throw new JarvisRefusalError("lookup_failed", FAILED); };
const dayStart = (date: string) => dubaiDateTimeToIso(date, "00:00")!;
const fmtDate = (iso: string) => crmToday(new Date(iso));

async function companyName(ctx: JarvisContext): Promise<string> {
  const c = await ctx.supabase.from("companies").select("legal_name").eq("id", ctx.companyId).maybeSingle();
  if (c.error) failed();
  return (c.data as { legal_name?: string } | null)?.legal_name ?? "this company";
}

/** Names of organisations and enquiries for a page of rows: ONE read each (no per-row reads), through the person's own session. */
async function orgNames(sb: Sb, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (want.length === 0) return out;
  const rows = await inBatches<{ id: string; name: string }>(want, (b) => sb.from("crm_organisations").select("id, name").in("id", b));
  if (!rows) failed();
  for (const o of rows!) out.set(o.id, o.name);
  return out;
}
async function enquiryRefs(ctx: JarvisContext, ids: (string | null)[]): Promise<Map<string, { id: string; reference: string; title: string }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, { id: string; reference: string; title: string }>();
  if (want.length === 0) return out;
  const r = (await ctx.supabase.from("crm_opportunities").select("id, reference, title").eq("company_id", ctx.companyId).in("id", want)) as Res<{ id: string; reference: string; title: string }>;
  if (r.error) failed();
  for (const o of r.data ?? []) out.set(o.id, o);
  return out;
}

const party = (o: EnquiryRow, names: Map<string, string>) => {
  const a = o.agency_org_id ? names.get(o.agency_org_id) : null, c = o.client_org_id ? names.get(o.client_org_id) : null;
  return a && c ? `${a} for ${c}` : a ?? c ?? null;
};
const enquiryRow = (o: EnquiryRow, names: Map<string, string>, me: string, meta: string | null = null): LookupRow => ({
  id: o.id, primary: `${o.reference} · ${displaySafe(o.title, 120).text}`,
  secondary: [crmStageLabel(o.stage), party(o, names), o.owner_id === me ? "owned by you" : "another owner"].filter(Boolean).join(" · "),
  meta: meta ?? ([o.install_start ? `installation ${o.install_start}` : null, o.event_start ? `event ${o.event_start}${o.event_end && o.event_end !== o.event_start ? ` to ${o.event_end}` : ""}` : null].filter(Boolean).join(" · ") || null),
  href: `/sales/opportunities/${o.id}`,
});

interface Built { title: string; scope: string; filters: string[]; sections: LookupSection[]; total: number | null; unavailable?: string[]; empty?: string; choices?: SalesLookupCard["choices"]; links: SalesLookupCard["links"]; note?: string | null }

async function followUps(ctx: JarvisContext, d: Extract<LookupDescriptor, { kind: "followups" }>): Promise<Built> {
  const today = crmToday(ctx.now);
  const nowIso = ctx.now.toISOString();
  const tomorrow = dayStart(addDays(today, 1));
  const [from, to, title, when] = d.when === "today"
    ? [nowIso, tomorrow, "Your Sales follow-ups due today", `due later today (${today}); a follow-up whose time has already passed is overdue, not due today`]
    : [tomorrow, dayStart(addDays(today, d.days + 1)), `Your Sales follow-ups in the next ${d.days} days`, `due from ${addDays(today, 1)} to ${addDays(today, d.days)}`];
  const r = (await ctx.supabase.from("crm_follow_ups").select(FOLLOW_UP_COLUMNS, { count: "exact" }).eq("status", "open").eq("assigned_to", ctx.userId).eq("company_id", ctx.companyId)
    .gte("due_at", from).lt("due_at", to).order("due_at").limit(LOOKUP_LIMIT)) as Res<{ id: string; title: string; kind: string; due_at: string; opportunity_id: string | null }>;
  if (r.error || typeof r.count !== "number") failed();
  const rows = r.data ?? [];
  const opps = await enquiryRefs(ctx, rows.map((f) => f.opportunity_id));
  const section: LookupSection = {
    heading: title, total: r.count!,
    rows: rows.map((f) => {
      const o = f.opportunity_id ? opps.get(f.opportunity_id) : undefined;
      return { id: f.id, primary: displaySafe(f.title).text, secondary: `${KIND[f.kind] ?? "Other"} · due ${fmtDate(f.due_at)}`, meta: o ? `${o.reference} · ${displaySafe(o.title, 120).text}` : null, href: o ? `/sales/opportunities/${o.id}` : "/sales/follow-ups" };
    }),
  };
  return { title, scope: "Assigned to you · still open", filters: [when], sections: [section], total: r.count!, empty: `No matching follow-ups: nothing assigned to you is ${d.when === "today" ? "due later today" : `due in the next ${d.days} days`}.`, links: [{ label: "Open Follow-ups", href: "/sales/follow-ups" }] };
}

/** Organisations or events whose name contains the words given: a few candidates, read through the person's own session (shared directory, as the app shows it). */
async function findNamed(sb: Sb, table: "crm_organisations" | "crm_events", text: string): Promise<{ id: string; name: string }[]> {
  const r = (await sb.from(table).select("id, name").ilike("name", `%${text.replace(/[%_\\]/g, " ").trim()}%`).is("archived_at", null).order("name").limit(6)) as Res<{ id: string; name: string }>;
  if (r.error) failed();
  return r.data ?? [];
}

async function enquiries(ctx: JarvisContext, d: Extract<LookupDescriptor, { kind: "enquiries" }>): Promise<Built> {
  const filters: string[] = [];
  const links = [{ label: "Open Enquiries", href: "/sales/opportunities" }];
  let org = d.org, event = d.event;
  const choose = (what: string, options: { label: string; descriptor: LookupDescriptor }[]): Built => ({ title: "Which one do you mean?", scope: "", filters: [], sections: [], total: null, choices: options, links, note: `More than one ${what} matches that name.` });
  // A bare name is looked for among organisations AND events; the person is asked only when it is genuinely ambiguous.
  if (d.named && !org && !event) {
    const [os, es] = await Promise.all([findNamed(ctx.supabase, "crm_organisations", d.named), findNamed(ctx.supabase, "crm_events", d.named)]);
    if (os.length + es.length === 0) return { title: "Open enquiries", scope: "", filters: [], sections: [], total: null, links: [...links, { label: "Clients & Agencies", href: "/sales/accounts" }, { label: "Events & Exhibitions", href: "/sales/events" }], empty: "I could not find a client, an agency or an event with that name among the ones you can see. Check the spelling, or open the directory." };
    if (os.length + es.length > 1) return choose("client, agency or event", [...os.map((o) => ({ label: `${o.name} (client or agency)`, descriptor: { ...d, named: null, org: { id: o.id, name: null } } })), ...es.map((e) => ({ label: `${e.name} (event)`, descriptor: { ...d, named: null, event: { id: e.id, name: null } } }))]);
    if (os[0]) org = { id: os[0].id, name: null }; else event = { id: es[0]!.id, name: null };
  }
  let orgRow: { id: string; name: string } | null = null;
  if (org) {
    const found = org.id ? ((await ctx.supabase.from("crm_organisations").select("id, name").eq("id", org.id).limit(1)) as Res<{ id: string; name: string }>) : null;
    if (found?.error) failed();
    const list = found ? found.data ?? [] : await findNamed(ctx.supabase, "crm_organisations", org.name ?? "");
    if (list.length === 0) return { title: "Open enquiries", scope: "", filters: [], sections: [], total: null, links: [...links, { label: "Clients & Agencies", href: "/sales/accounts" }], empty: "I could not find that client or agency among the ones you can see." };
    if (list.length > 1) return choose("client or agency", list.map((o) => ({ label: o.name, descriptor: { ...d, org: { id: o.id, name: null } } })));
    orgRow = list[0]!;
    filters.push(`client or agency: ${orgRow.name}`);
  }
  let editionIds: string[] | null = null;
  if (event) {
    const found = event.id ? ((await ctx.supabase.from("crm_events").select("id, name").eq("id", event.id).limit(1)) as Res<{ id: string; name: string }>) : null;
    if (found?.error) failed();
    const list = found ? found.data ?? [] : await findNamed(ctx.supabase, "crm_events", event.name ?? "");
    if (list.length === 0) return { title: "Open enquiries", scope: "", filters: [], sections: [], total: null, links: [...links, { label: "Events & Exhibitions", href: "/sales/events" }], empty: "I could not find that event among the ones you can see." };
    if (list.length > 1) return choose("event", list.map((e) => ({ label: e.name, descriptor: { ...d, event: { id: e.id, name: null } } })));
    const eds = (await ctx.supabase.from("crm_event_editions").select("id").eq("event_id", list[0]!.id).limit(200)) as Res<{ id: string }>;
    if (eds.error) failed();
    editionIds = (eds.data ?? []).map((e) => e.id);
    filters.push(`linked to the event ${list[0]!.name} (any edition)`);
    links.push({ label: "Events & Exhibitions", href: "/sales/events" });
  }
  const stages = d.stage ? [d.stage] : [...CRM_PIPELINE_STAGES, "on_hold"];
  filters.unshift(d.stage ? `stage: ${crmStageLabel(d.stage)}` : "open (not Won or Lost; On hold included)");
  const section = (heading: string, rows: LookupRow[], total: number): LookupSection => ({ heading, rows, total });
  const title = d.scope === "mine" ? "Your open enquiries" : "Open enquiries";
  const scope = d.scope === "mine" ? "Owned by you" : "Everyone's enquiries in this company (the same as the Enquiries screen shows you)";
  const empty = "No matching enquiries for those filters.";
  if (editionIds && editionIds.length === 0) return { title, scope, filters, sections: [section(title, [], 0)], total: 0, empty, links };
  let q = ctx.supabase.from("crm_opportunities").select(ENQUIRY_COLUMNS, { count: "exact" }).eq("company_id", ctx.companyId).in("stage", stages);
  if (d.scope === "mine") q = q.eq("owner_id", ctx.userId);
  if (orgRow) q = q.or(`agency_org_id.eq.${orgRow.id},client_org_id.eq.${orgRow.id}`);
  if (editionIds) q = q.in("event_edition_id", editionIds);
  const r = (await q.order("created_at", { ascending: false }).limit(LOOKUP_LIMIT)) as Res<EnquiryRow>;
  if (r.error || typeof r.count !== "number") failed();
  const rows = r.data ?? [];
  const names = await orgNames(ctx.supabase, rows.flatMap((o) => [o.agency_org_id, o.client_org_id]));
  return { title, scope, filters, sections: [section(title, rows.map((o) => enquiryRow(o, names, ctx.userId)), r.count!)], total: r.count!, empty, links };
}

/** The person's own open enquiries, at most SCAN_LIMIT, newest first, with the exact number that exist. */
async function myOpen(ctx: JarvisContext, stages: readonly string[]): Promise<{ rows: EnquiryRow[]; count: number }> {
  const r = (await ctx.supabase.from("crm_opportunities").select(ENQUIRY_COLUMNS, { count: "exact" }).eq("company_id", ctx.companyId).eq("owner_id", ctx.userId).in("stage", [...stages]).order("created_at", { ascending: false }).limit(SCAN_LIMIT)) as Res<EnquiryRow>;
  if (r.error || typeof r.count !== "number") throw new Error("unreadable");
  return { rows: r.data ?? [], count: r.count };
}
const coverage = (count: number) => (count > SCAN_LIMIT ? `You own ${count} open enquiries; this looked at the ${SCAN_LIMIT} newest only.` : null);

async function inactive(ctx: JarvisContext, d: Extract<LookupDescriptor, { kind: "inactive" }>): Promise<Built> {
  const cutoff = new Date(ctx.now.getTime() - d.days * 86_400_000).toISOString();
  let mine: { rows: EnquiryRow[]; count: number };
  try { mine = await myOpen(ctx, CRM_PIPELINE_STAGES); } catch { return failed(); }
  const ids = mine.rows.map((o) => o.id);
  const recent = new Set<string>();
  const acts = await inBatches<{ opportunity_id: string }>(ids, (b) => ctx.supabase.from("crm_activities").select(ACTIVITY_COLUMNS).eq("company_id", ctx.companyId).in("opportunity_id", b).gte("occurred_at", cutoff).limit(5000));
  if (!acts) failed();
  for (const x of acts!) recent.add(x.opportunity_id);
  // An enquiry created inside the window is not "quiet for N days" yet.
  const quiet = mine.rows.filter((o) => !recent.has(o.id) && o.created_at < cutoff);
  const names = await orgNames(ctx.supabase, quiet.slice(0, LOOKUP_LIMIT).flatMap((o) => [o.agency_org_id, o.client_org_id]));
  const title = `Your enquiries with no recorded activity for ${d.days} days`;
  return {
    title, scope: "Owned by you · open working stages (On hold, Won and Lost are left out)", total: quiet.length,
    filters: [`no call, email, meeting, note or client response recorded in Enginious OS since ${fmtDate(cutoff)}`, `created before ${fmtDate(cutoff)}`],
    sections: [{ heading: title, total: quiet.length, rows: quiet.slice(0, LOOKUP_LIMIT).map((o) => enquiryRow(o, names, ctx.userId)) }],
    note: ["This means nothing was RECORDED on the enquiry. It does not mean nobody contacted the client.", coverage(mine.count)].filter(Boolean).join(" "),
    empty: `No matching enquiries: every open enquiry you own has activity recorded in the last ${d.days} days (or is newer than that).`, links: [{ label: "Open Enquiries", href: "/sales/opportunities" }],
  };
}

async function enquiry(ctx: JarvisContext, d: Extract<LookupDescriptor, { kind: "enquiry" }>): Promise<Built> {
  if (!d.reference && !d.id) throw new JarvisRefusalError("invalid_input", "Which enquiry? Give its reference (for example OPP-UAE-2026-0001), or open the enquiry and ask again.");
  let q = ctx.supabase.from("crm_opportunities").select(ENQUIRY_COLUMNS).eq("company_id", ctx.companyId);
  q = d.id ? q.eq("id", d.id) : q.eq("reference", d.reference!.toUpperCase());
  const r = (await q.limit(1)) as Res<EnquiryRow>;
  if (r.error) failed();
  const o = (r.data ?? [])[0];
  // The same words whether it does not exist, belongs to another company or cannot be seen.
  if (!o) throw new JarvisRefusalError("not_permitted", "That enquiry could not be found in the selected company, or you cannot see it.");
  const names = await orgNames(ctx.supabase, [o.agency_org_id, o.client_org_id]);
  const unavailable: string[] = [];
  const fu = (await ctx.supabase.from("crm_follow_ups").select(FOLLOW_UP_COLUMNS, { count: "exact" }).eq("company_id", ctx.companyId).eq("opportunity_id", o.id).eq("status", "open").order("due_at").limit(5)) as Res<{ id: string; title: string; kind: string; due_at: string }>;
  const act = (await ctx.supabase.from("crm_activities").select(ACTIVITY_COLUMNS).eq("company_id", ctx.companyId).eq("opportunity_id", o.id).order("occurred_at", { ascending: false }).limit(1)) as Res<{ kind: string; occurred_at: string }>;
  if (fu.error || typeof fu.count !== "number") unavailable.push("its open follow-ups");
  if (act.error) unavailable.push("its last recorded activity");
  const fact = (label: string, value: string | null): LookupRow | null => (value ? { id: label, primary: label, secondary: value, meta: null, href: null } : null);
  const last = act.error ? null : (act.data ?? [])[0];
  const details = [
    fact("Stage", `${crmStageLabel(o.stage)}${o.stage_changed_at ? ` since ${fmtDate(o.stage_changed_at)}` : ""}`), fact("Agency", o.agency_org_id ? names.get(o.agency_org_id) ?? null : null),
    fact("End client", o.client_org_id ? names.get(o.client_org_id) ?? null : null), fact("Owner", o.owner_id === ctx.userId ? "You" : "Another owner"), fact("Location", o.location ? displaySafe(o.location, 120).text : null),
    fact("Event dates", o.event_start ? `${o.event_start}${o.event_end && o.event_end !== o.event_start ? ` to ${o.event_end}` : ""}` : null), fact("Installation starts", o.install_start),
    fact("Created", fmtDate(o.created_at)), fact("Closed", o.closed_at ? fmtDate(o.closed_at) : null), fact("Hold review date", o.hold_review_date),
    act.error ? null : fact("Last recorded activity", last ? `${KIND[last.kind] ?? last.kind} on ${fmtDate(last.occurred_at)}` : "None recorded"),
  ].filter((x): x is LookupRow => !!x);
  const sections: LookupSection[] = [{ heading: `${o.reference} · ${displaySafe(o.title, 120).text}`, total: details.length, rows: details, facts: true }];
  if (!fu.error && typeof fu.count === "number") sections.push({ heading: "Open follow-ups", total: fu.count, rows: (fu.data ?? []).map((f) => ({ id: f.id, primary: displaySafe(f.title).text, secondary: `${KIND[f.kind] ?? "Other"} · due ${fmtDate(f.due_at)}${f.due_at < ctx.now.toISOString() ? ` · ${daysOverdue(f.due_at, ctx.now)} day(s) overdue` : ""}`, meta: null, href: null })) });
  return { title: "Enquiry status", scope: "One enquiry you can see", filters: [], sections, total: null, unavailable, links: [{ label: `Open ${o.reference}`, href: `/sales/opportunities/${o.id}` }], note: "Value, budget, estimates and proposals are on the enquiry page: I do not read them here." };
}

async function attention(ctx: JarvisContext): Promise<Built> {
  const today = crmToday(ctx.now);
  const nowIso = ctx.now.toISOString();
  const sections: LookupSection[] = [];
  const unavailable: string[] = [];
  const seen = new Set<string>();
  // Each source is read on its own: one that cannot be read is NAMED as unavailable, never shown as "nothing".
  const fu = async (heading: string, reason: string, from: string | null, to: string) => {
    let q = ctx.supabase.from("crm_follow_ups").select(FOLLOW_UP_COLUMNS, { count: "exact" }).eq("status", "open").eq("assigned_to", ctx.userId).eq("company_id", ctx.companyId).lt("due_at", to);
    if (from) q = q.gte("due_at", from);
    const r = (await q.order("due_at").limit(LOOKUP_LIMIT)) as Res<{ id: string; title: string; kind: string; due_at: string; opportunity_id: string | null }>;
    if (r.error || typeof r.count !== "number") { unavailable.push(heading.toLowerCase()); return; }
    // The follow-ups themselves were read: if their enquiries' names cannot be, they are still listed (without the enquiry line), not dropped.
    const opps = await enquiryRefs(ctx, (r.data ?? []).map((f) => f.opportunity_id)).catch(() => new Map<string, { id: string; reference: string; title: string }>());
    for (const f of r.data ?? []) if (f.opportunity_id) seen.add(f.opportunity_id);
    sections.push({ heading, note: reason, total: r.count, rows: (r.data ?? []).map((f) => { const o = f.opportunity_id ? opps.get(f.opportunity_id) : undefined; return { id: f.id, primary: displaySafe(f.title).text, secondary: `${KIND[f.kind] ?? "Other"} · due ${fmtDate(f.due_at)}${from ? "" : ` · ${daysOverdue(f.due_at, ctx.now)} day(s) overdue`}`, meta: o ? `${o.reference} · ${displaySafe(o.title, 120).text}` : null, href: o ? `/sales/opportunities/${o.id}` : "/sales/follow-ups" }; }) });
  };
  await fu("Overdue follow-ups", "The due time has passed and the follow-up is still open.", null, nowIso);
  await fu("Follow-ups due today", "Due later today.", nowIso, dayStart(addDays(today, 1)));
  let note: string | null = null;
  try {
    const mine = await myOpen(ctx, [...CRM_PIPELINE_STAGES, "on_hold"]);
    note = coverage(mine.count);
    const names = await orgNames(ctx.supabase, mine.rows.flatMap((o) => [o.agency_org_id, o.client_org_id]));
    const hold = mine.rows.filter((o) => o.stage === "on_hold" && o.hold_review_date && o.hold_review_date <= today && !seen.has(o.id));
    for (const o of hold) seen.add(o.id);
    sections.push({ heading: "On hold: review date has arrived", note: "The hold review date is today or earlier.", total: hold.length, rows: hold.slice(0, LOOKUP_LIMIT).map((o) => enquiryRow(o, names, ctx.userId, `review date ${o.hold_review_date}`)) });
    const active = mine.rows.filter((o) => isCrmActive(o.stage));
    const withNext = new Set<string>();
    const open = await inBatches<{ opportunity_id: string }>(active.map((o) => o.id), (b) => ctx.supabase.from("crm_follow_ups").select("opportunity_id").eq("company_id", ctx.companyId).eq("status", "open").in("opportunity_id", b).limit(5000));
    if (!open) throw new Error("unreadable");
    for (const x of open) withNext.add(x.opportunity_id);
    // One enquiry is listed once: under the first reason that applies.
    const noNext = active.filter((o) => !withNext.has(o.id) && !seen.has(o.id));
    for (const o of noNext) seen.add(o.id);
    sections.push({ heading: "No next action planned", note: "An open enquiry you own with no open follow-up.", total: noNext.length, rows: noNext.slice(0, LOOKUP_LIMIT).map((o) => enquiryRow(o, names, ctx.userId)) });
    const noResponse = mine.rows.filter((o) => !o.first_response_at && !seen.has(o.id));
    sections.push({ heading: "No first response recorded", note: "An open enquiry you own with no first response recorded yet.", total: noResponse.length, rows: noResponse.slice(0, LOOKUP_LIMIT).map((o) => enquiryRow(o, names, ctx.userId)) });
  } catch { unavailable.push("your open enquiries (hold reviews, enquiries with no next action or no first response)"); }
  if (sections.length === 0) failed();
  return {
    title: "What needs your attention today", scope: "Your follow-ups and the enquiries you own · Sales & CRM only", filters: [`today is ${today} (Dubai)`], sections: sections.filter((s) => s.total > 0), unavailable,
    total: sections.reduce((n, s) => n + s.total, 0), note, empty: unavailable.length > 0 ? undefined : "Nothing in Sales & CRM needs your attention right now: no overdue or due-today follow-ups, no hold reviews, and every open enquiry you own has a next action and a first response.",
    links: [{ label: "Open Follow-ups", href: "/sales/follow-ups" }, { label: "Open Enquiries", href: "/sales/opportunities" }],
  };
}

/**
 * The Sales lookups: follow-ups due today or coming up, open enquiries (mine or the company's, by stage, client or agency, or linked event), enquiries with no recorded
 * activity, one enquiry's status, and "what needs my attention today". Computed and shown INSIDE Enginious OS: no provider call, ever. Every row is read through the signed-in
 * person's own session with an explicit column list that has no financial column (sales/projection.ts), narrowed to the company selected in the panel, which the dispatcher
 * authorised for this request. Totals are exact counts, separate from the rows shown. A failed read is a refusal ("lookup_failed") or a named unavailable part, never zero.
 */
export const salesLookup: JarvisActionDefinition<LookupDescriptor, LookupDescriptor, SalesLookupCard, never> = {
  id: SALES_LOOKUP_ID,
  module: "sales",
  title: "Look up Sales follow-ups and enquiries",
  description: "Ask, for example, \"what needs my attention today?\", \"my follow-ups due today\", \"my open enquiries\", \"open enquiries for Fictional Wave Agency\", \"enquiries with no activity for 14 days\" or \"status of OPP-UAE-2026-0001\". Nothing leaves Enginious OS.",
  risk: "read",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: false,
  inputSchema: lookupDescriptor,
  valuesSchema: lookupDescriptor,
  describe: () => "Sales lookup (read only)",
  async propose(ctx, d) {
    const built = d.kind === "followups" ? await followUps(ctx, d) : d.kind === "enquiries" ? await enquiries(ctx, d) : d.kind === "inactive" ? await inactive(ctx, d) : d.kind === "enquiry" ? await enquiry(ctx, d) : await attention(ctx);
    const shown = built.sections.reduce((n, s) => n + s.rows.length, 0);
    const card: SalesLookupCard = {
      kind: "lookup.sales", title: built.title, company: { id: ctx.companyId, name: await companyName(ctx) }, scope: built.scope, filters: built.filters,
      asOf: ctx.now.toISOString(), asOfLabel: `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: CRM_TIME_ZONE }).format(ctx.now)} (Dubai)`,
      total: built.total, shown, sections: built.sections, unavailable: built.unavailable ?? [], note: built.note ?? null,
      empty: (built.total === 0 || (built.total === null && shown === 0 && !(built.choices?.length))) && !(built.unavailable?.length) ? built.empty ?? "No matching records." : null,
      choices: built.choices ?? [], links: built.links, descriptor: d,
    };
    return { values: d, target: { kind: "new" }, valid: false, card };
  },
};
