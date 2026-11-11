import "server-only";
import { availabilityDisplay, type AvailabilityDisplay } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CrmActivityRow, CrmApprovalRow, CrmClosureRow, CrmEstimateSendRow, CrmContactRow, CrmFileRow, CrmFollowUpRow, CrmHandoverRow, CrmOpportunityEventRow,
  CrmOpportunityRow, CrmOrganisationRow, CrmProposalRow, CrmReminderRow, CrmZohoReferenceRow,
} from "@/types/crm";
import type { CrmContext } from "./context";
import { organisationLabel } from "./reports";

/** A failed query must surface as an error, never as "no data". */
function ok(...results: { error?: { message: string } | null }[]): void {
  for (const r of results) if (r.error) throw new Error(`Sales data could not be loaded: ${r.error.message}`);
}

export const num = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

export interface OpportunityListItem {
  opp: CrmOpportunityRow;
  value: number | null;
  companyName: string;
  ownerName: string;
  agency: CrmOrganisationRow | null;
  client: CrmOrganisationRow | null;
  nextFollowUp: CrmFollowUpRow | null;
  openFollowUps: number;
  availability: AvailabilityDisplay;
}

/** The data service returns at most this many rows per request (Supabase default): every list here is read page by page until a short page. */
const PAGE = 1000;
/** Ids sent in one `in (...)` filter: keeps the request address short. */
const ID_CHUNK = 150;

type Res<T> = { data: T[] | null; error: { message: string } | null };

/** Reads every row of a query, page by page, in the query's own stable order. Throws when any page fails: a short list must never look complete. */
export async function readPaged<T>(page: (from: number, to: number) => PromiseLike<Res<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await page(from, from + PAGE - 1);
    ok(r);
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGE) return out;
  }
}

/** Reads the rows that belong to `ids`, a chunk of ids at a time (each chunk itself page by page). */
export async function readForIds<T>(ids: readonly string[], read: (chunk: string[], from: number, to: number) => PromiseLike<Res<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    out.push(...await readPaged<T>((from, to) => read(chunk, from, to)));
  }
  return out;
}

/** What to read. Everything is applied IN THE DATABASE, inside what the person may see (row-level security), before any page is cut. */
export interface OpportunityScope {
  company?: string;
  owner?: string;
  /** One stage; it wins over `status` (asking for Won is never emptied by "open"). */
  stage?: string;
  /** Default: everything. */
  status?: "open" | "closed" | "all";
  /** Any of these periods (a superset is fine: the report functions apply the exact Dubai-day rule): still open, created in [from, to), or closed in [from, to). Leave out for everything. */
  anyOf?: { open: true; createdFrom: string; createdTo: string; closedFrom: string; closedTo: string };
}

/**
 * The enquiries the signed-in user may see (RLS decides) that match `scope`, COMPLETE: read page by page, newest first. Names and the next open follow-up are
 * resolved from reads limited to those enquiries. Throws when any read fails. Used by Reports (scoped to what the period needs), Follow-ups, My Day and the
 * proposals list; the Enquiries list and board use the bounded read in enquiry-list-data.ts and come here only where its function is not installed.
 */
export async function loadOpportunities(ctx: CrmContext, scope: OpportunityScope = {}): Promise<OpportunityListItem[]> {
  const supabase = await createClient();
  const filtered = () => {
    let query = supabase.from("crm_opportunities").select("*");
    if (scope.company) query = query.eq("company_id", scope.company);
    if (scope.owner) query = query.eq("owner_id", scope.owner);
    if (scope.stage) query = query.eq("stage", scope.stage as CrmOpportunityRow["stage"]);
    else if (scope.status === "open") query = query.not("stage", "in", "(won,lost)");
    else if (scope.status === "closed") query = query.in("stage", ["won", "lost"]);
    return query;
  };
  const page = (build: () => ReturnType<typeof filtered>) => readPaged<CrmOpportunityRow>((from, to) => build().order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to));
  let rows: CrmOpportunityRow[];
  if (scope.anyOf) {
    // Three plain reads (open; created in the window; closed in the window), merged by id: each enquiry a period report needs, and no others.
    const w = scope.anyOf;
    const parts = await Promise.all([
      page(() => filtered().not("stage", "in", "(won,lost)")),
      page(() => filtered().gte("created_at", w.createdFrom).lt("created_at", w.createdTo)),
      page(() => filtered().in("stage", ["won", "lost"]).gte("closed_at", w.closedFrom).lt("closed_at", w.closedTo)),
    ]);
    const seen = new Map<string, CrmOpportunityRow>();
    for (const r of parts.flat()) seen.set(r.id, r);
    rows = [...seen.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  } else rows = await page(filtered);
  if (rows.length === 0) return [];
  const orgIds = [...new Set(rows.flatMap((o) => [o.agency_org_id, o.client_org_id]).filter((x): x is string => !!x))];
  const ids = rows.map((o) => o.id);
  // The open follow-ups of THESE enquiries (soonest first). For a large set one complete read of the open follow-ups is fewer requests than hundreds of id chunks.
  const followUpsRead = ids.length > 4 * ID_CHUNK
    ? readPaged<CrmFollowUpRow>((from, to) => supabase.from("crm_follow_ups").select("*").eq("status", "open").not("opportunity_id", "is", null).order("due_at").order("id").range(from, to))
    : readForIds<CrmFollowUpRow>(ids, (chunk, from, to) => supabase.from("crm_follow_ups").select("*").eq("status", "open").in("opportunity_id", chunk).order("due_at").order("id").range(from, to));
  const [orgs, followUps] = await Promise.all([
    readForIds<CrmOrganisationRow>(orgIds, (chunk, from, to) => supabase.from("crm_organisations").select("*").in("id", chunk).order("id").range(from, to)),
    followUpsRead,
  ]);
  const orgBy = new Map(orgs.map((o) => [o.id, o]));
  const nextBy = new Map<string, CrmFollowUpRow>();
  const countBy = new Map<string, number>();
  for (const f of [...followUps].sort((a, b) => a.due_at.localeCompare(b.due_at))) {
    if (!f.opportunity_id) continue;   // a follow-up on an account with no inquiry belongs to no opportunity
    if (!nextBy.has(f.opportunity_id)) nextBy.set(f.opportunity_id, f);
    countBy.set(f.opportunity_id, (countBy.get(f.opportunity_id) ?? 0) + 1);
  }
  return rows.map((o) => toItem(ctx, o, orgBy, nextBy, countBy));
}

/** How many enquiries the person may see in all (an exact count from the database, not the length of a page). Throws when it cannot be counted. */
export async function countOpportunities(): Promise<number> {
  const supabase = await createClient();
  const res = await supabase.from("crm_opportunities").select("id", { count: "exact", head: true });
  if (res.error) throw new Error(`Sales data could not be loaded: ${res.error.message}`);
  return res.count ?? 0;
}

function toItem(
  ctx: CrmContext,
  o: CrmOpportunityRow,
  orgBy: Map<string, CrmOrganisationRow>,
  nextBy: Map<string, CrmFollowUpRow>,
  countBy: Map<string, number>,
): OpportunityListItem {
  return {
    opp: o,
    value: num(o.value),
    companyName: ctx.companyName(o.company_id),
    ownerName: ctx.personName(o.owner_id),
    agency: o.agency_org_id ? (orgBy.get(o.agency_org_id) ?? null) : null,
    client: o.client_org_id ? (orgBy.get(o.client_org_id) ?? null) : null,
    nextFollowUp: nextBy.get(o.id) ?? null,
    openFollowUps: countBy.get(o.id) ?? 0,
    availability: availabilityDisplay({
      availabilityState: o.availability_state,
      availabilityCovers: o.availability_covers,
      installStart: o.install_start,
      eventStart: o.event_start,
      eventEnd: o.event_end,
      technologies: o.technologies,
    }),
  };
}

export interface OpportunityDetail {
  item: OpportunityListItem;
  contacts: { contact: CrmContactRow; role: string | null; organisation: CrmOrganisationRow | null }[];
  activities: CrmActivityRow[];
  followUps: CrmFollowUpRow[];
  events: CrmOpportunityEventRow[];
  files: CrmFileRow[];
  proposals: CrmProposalRow[];
  zoho: CrmZohoReferenceRow | null;
  approvals: CrmApprovalRow[];
  handover: CrmHandoverRow | null;
  /** Every Won/Lost the opportunity has had, newest first; a reopened one is kept with who reopened it and why. */
  closures: CrmClosureRow[];
  /** Estimates of this enquiry that were explicitly recorded as sent to the client (newest first). Empty when none, when the read failed (see `failed`) or when the database does not have the feature yet. */
  estimateSends: CrmEstimateSendRow[];
  /** False only when the database has no record of sent estimates at all (its migration is not applied): the action is then not offered. */
  estimateSendsInstalled: boolean;
}

/** The parts of the enquiry page that can fail on their own (the enquiry itself and the names of its parties are not among them: if those fail there is no page). */
export type DetailSection = "contacts" | "activities" | "followUps" | "events" | "files" | "proposals" | "zoho" | "approvals" | "handover" | "closures" | "estimateSends";

/**
 * What reading one enquiry can end in, four different things that must never look alike:
 *  - `ok`: the enquiry was read; `failed` names any section that could NOT be read (its data in `detail` is then empty and must not be shown as "none");
 *  - `not_found`: the read worked and there is no such enquiry (or this person cannot see it: the database does not tell the two apart);
 *  - `denied`: the database refused the read outright (a permission error, not an empty result);
 *  - `error`: the read itself failed (the data service did not answer, a timeout...).
 */
export type OpportunityDetailResult =
  | { kind: "ok"; detail: OpportunityDetail; failed: ReadonlySet<DetailSection> }
  | { kind: "not_found" }
  | { kind: "denied" }
  | { kind: "error" };

/** The data service or the database saying the table itself is not there. */
const isMissingTable = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /could not find the table|relation .* does not exist/i.test(e.message ?? "");
const isDenied = (e: { code?: string; message?: string }) => e.code === "42501" || /permission denied|row-level security/i.test(e.message ?? "");

export async function loadOpportunityDetailResult(ctx: CrmContext, id: string): Promise<OpportunityDetailResult> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: "not_found" };
  try {
    const supabase = await createClient();
    const oppRes = await supabase.from("crm_opportunities").select("*").eq("id", id).maybeSingle();
    if (oppRes.error) {
      console.error("[crm] enquiry read failed", oppRes.error.message);
      return isDenied(oppRes.error) ? { kind: "denied" } : { kind: "error" };
    }
    const opp = oppRes.data;
    if (!opp) return { kind: "not_found" };
    const [orgs, links, acts, fus, evs, files, props, zoho, appr, hand, clos, sends] = await Promise.all([
      supabase.from("crm_organisations").select("*").in("id", [opp.agency_org_id, opp.client_org_id].filter((x): x is string => !!x)),
      supabase.from("crm_opportunity_contacts").select("contact_id, role").eq("opportunity_id", id),
      supabase.from("crm_activities").select("*").eq("opportunity_id", id).order("occurred_at", { ascending: false }),
      supabase.from("crm_follow_ups").select("*").eq("opportunity_id", id).order("due_at"),
      supabase.from("crm_opportunity_events").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }),
      supabase.from("crm_files").select("*").eq("opportunity_id", id).is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("crm_proposals").select("*").eq("opportunity_id", id).order("version", { ascending: false }),
      supabase.from("crm_zoho_references").select("*").eq("opportunity_id", id).maybeSingle(),
      supabase.from("crm_approvals").select("*").eq("opportunity_id", id).order("requested_at", { ascending: false }),
      supabase.from("crm_handovers").select("*").eq("opportunity_id", id).maybeSingle(),
      supabase.from("crm_closures").select("*").eq("opportunity_id", id).order("closed_at", { ascending: false }),
      // Not in the generated types (like the estimate tables); read through the person's own session.
      (supabase as unknown as SupabaseClient).from("crm_estimate_sends").select("*").eq("opportunity_id", id).order("recorded_at", { ascending: false }),
    ]);
    // The parties' names are part of the page header ("No client recorded" would be a lie), so without them there is no page.
    if (orgs.error) {
      console.error("[crm] enquiry parties read failed", orgs.error.message);
      return { kind: "error" };
    }
    const failed = new Set<DetailSection>();
    const note = (section: DetailSection, res: { error?: { message: string } | null }) => {
      if (res.error) { failed.add(section); console.error(`[crm] enquiry ${section} read failed`, res.error.message); }
    };
    note("activities", acts); note("followUps", fus); note("events", evs); note("files", files); note("proposals", props);
    note("zoho", zoho); note("approvals", appr); note("handover", hand); note("closures", clos); note("contacts", links);
    // A database without the table (the Estimate sent migration is not applied yet) is a known state, not a failed read: there are no records and the action is not offered.
    const sendsMissing = !!sends.error && isMissingTable(sends.error);
    if (!sendsMissing) note("estimateSends", sends);
    const orgBy = new Map((orgs.data ?? []).map((o) => [o.id, o]));
    const open = (fus.data ?? []).filter((f) => f.status === "open");
    const nextBy = new Map<string, CrmFollowUpRow>();
    if (open[0]) nextBy.set(id, open[0]);
    const item = toItem(ctx, opp, orgBy, nextBy, new Map([[id, open.length]]));

    const contactIds = (links.data ?? []).map((l) => l.contact_id);
    let contactRows: CrmContactRow[] = [];
    if (contactIds.length) {
      const res = await supabase.from("crm_contacts").select("*").in("id", contactIds);
      note("contacts", res);
      contactRows = res.data ?? [];
    }
    const contactOrgIds = [...new Set(contactRows.map((c) => c.organisation_id).filter((x): x is string => !!x && !orgBy.has(x)))];
    if (contactOrgIds.length) {
      const res = await supabase.from("crm_organisations").select("*").in("id", contactOrgIds);
      note("contacts", res);
      for (const o of res.data ?? []) orgBy.set(o.id, o);
    }
    const roleBy = new Map((links.data ?? []).map((l) => [l.contact_id, l.role]));
    const detail: OpportunityDetail = {
      item,
      contacts: contactRows.map((c) => ({ contact: c, role: roleBy.get(c.id) ?? null, organisation: c.organisation_id ? (orgBy.get(c.organisation_id) ?? null) : null })),
      activities: acts.data ?? [],
      followUps: fus.data ?? [],
      events: evs.data ?? [],
      files: files.data ?? [],
      proposals: props.data ?? [],
      zoho: zoho.data ?? null,
      approvals: appr.data ?? [],
      handover: hand.data ?? null,
      closures: clos.data ?? [],
      estimateSends: sendsMissing ? [] : ((sends.data ?? []) as CrmEstimateSendRow[]),
      estimateSendsInstalled: !sendsMissing,
    };
    return { kind: "ok", detail, failed };
  } catch (e) {
    console.error("[crm] enquiry read threw", e);
    return { kind: "error" };
  }
}

/**
 * The enquiry with every section read, or null when it does not exist. Throws when ANY part could not be read (the callers that use this
 * show their own "could not load"); the Enquiry, Close and Handover pages use `loadOpportunityDetailResult` to keep what did load.
 */
export async function loadOpportunityDetail(ctx: CrmContext, id: string): Promise<OpportunityDetail | null> {
  const r = await loadOpportunityDetailResult(ctx, id);
  if (r.kind === "not_found") return null;
  if (r.kind !== "ok") throw new Error(`Sales data could not be loaded: the enquiry was ${r.kind === "denied" ? "refused" : "not readable"}`);
  if (r.failed.size > 0) throw new Error(`Sales data could not be loaded: ${[...r.failed].join(", ")}`);
  return r.detail;
}

export interface FollowUpListItem {
  followUp: CrmFollowUpRow;
  /** Null for a follow-up on an account with no inquiry (then `account` names the account). */
  opportunity: Pick<CrmOpportunityRow, "id" | "reference" | "title" | "stage" | "company_id" | "owner_id"> | null;
  account: { id: string; name: string; companyId: string } | null;
  assigneeName: string;
  /** "Agency for Client", or whichever exists (same wording as the enquiry list); the account's name for an account follow-up. */
  party: string;
}

/** Open follow-ups across everything the user can see, soonest first, plus the most recent completed ones. Follow-ups on accounts with no inquiry are listed alongside. */
export async function loadFollowUps(ctx: CrmContext): Promise<{ open: FollowUpListItem[]; done: FollowUpListItem[] }> {
  const supabase = await createClient();
  const [openRes, doneRes] = await Promise.all([
    readPaged<CrmFollowUpRow>((from, to) => supabase.from("crm_follow_ups").select("*").eq("status", "open").order("due_at").order("id").range(from, to)),
    supabase.from("crm_follow_ups").select("*").eq("status", "done").order("completed_at", { ascending: false }).limit(30),
  ]);
  ok(doneRes);
  const open = openRes;
  const done = doneRes.data;
  const all = [...(open ?? []), ...(done ?? [])];
  const oppIds = [...new Set(all.map((f) => f.opportunity_id).filter((x): x is string => !!x))];
  type OppBits = Pick<CrmOpportunityRow, "id" | "reference" | "title" | "stage" | "company_id" | "owner_id" | "agency_org_id" | "client_org_id">;
  // A failed read here must not silently drop follow-ups (their enquiry or account would look missing): it throws like every other read in this file.
  const opps = await readForIds<OppBits>(oppIds, (chunk, from, to) => supabase.from("crm_opportunities").select("id, reference, title, stage, company_id, owner_id, agency_org_id, client_org_id").in("id", chunk).order("id").range(from, to));
  const accountIds = all.filter((f) => !f.opportunity_id).map((f) => f.organisation_id).filter((x): x is string => !!x);
  const orgIds = [...new Set([...(opps ?? []).flatMap((o) => [o.agency_org_id, o.client_org_id]), ...accountIds].filter((x): x is string => !!x))];
  const orgRows = await readForIds<{ id: string; name: string }>(orgIds, (chunk, from, to) => supabase.from("crm_organisations").select("id, name").in("id", chunk).order("id").range(from, to));
  const orgName = new Map((orgRows ?? []).map((o) => [o.id, o.name]));
  const oppBy = new Map((opps ?? []).map((o) => [o.id, o]));
  const wrap = (f: CrmFollowUpRow): FollowUpListItem | null => {
    if (!f.opportunity_id) {
      const name = f.organisation_id ? orgName.get(f.organisation_id) : undefined;
      if (!f.organisation_id || !name) return null;
      return { followUp: f, opportunity: null, account: { id: f.organisation_id, name, companyId: f.company_id }, assigneeName: ctx.personName(f.assigned_to), party: name };
    }
    const o = oppBy.get(f.opportunity_id);
    if (!o) return null;
    const agency = o.agency_org_id ? (orgName.get(o.agency_org_id) ?? null) : null;
    const client = o.client_org_id ? (orgName.get(o.client_org_id) ?? null) : null;
    const { agency_org_id: _a, client_org_id: _c, ...opportunity } = o;
    return { followUp: f, opportunity, account: null, assigneeName: ctx.personName(f.assigned_to), party: organisationLabel({ agency: agency ? { name: agency } : null, client: client ? { name: client } : null }) };
  };
  return {
    open: (open ?? []).map(wrap).filter((x): x is FollowUpListItem => !!x),
    done: (done ?? []).map(wrap).filter((x): x is FollowUpListItem => !!x),
  };
}

export async function loadOrganisations(): Promise<{
  organisations: (CrmOrganisationRow & { contacts: CrmContactRow[]; opportunityCount: number; openCount: number })[];
  /** People recorded without an organisation (so they can still be found and linked to an opportunity). */
  unassignedContacts: CrmContactRow[];
}> {
  const supabase = await createClient();
  const [orgsRes, contactsRes, oppsRes] = await Promise.all([
    supabase.from("crm_organisations").select("*").is("archived_at", null).order("name"),
    supabase.from("crm_contacts").select("*").is("archived_at", null).order("name"),
    supabase.from("crm_opportunities").select("agency_org_id, client_org_id, stage"),
  ]);
  ok(orgsRes, contactsRes, oppsRes);
  const orgs = orgsRes.data;
  const contacts = contactsRes.data;
  const opps = oppsRes.data;
  const contactsBy = new Map<string, CrmContactRow[]>();
  for (const c of contacts ?? []) if (c.organisation_id) contactsBy.set(c.organisation_id, [...(contactsBy.get(c.organisation_id) ?? []), c]);
  const total = new Map<string, number>();
  const openN = new Map<string, number>();
  for (const o of opps ?? []) {
    for (const orgId of new Set([o.agency_org_id, o.client_org_id])) {
      if (!orgId) continue;
      total.set(orgId, (total.get(orgId) ?? 0) + 1);
      if (o.stage !== "won" && o.stage !== "lost") openN.set(orgId, (openN.get(orgId) ?? 0) + 1);
    }
  }
  return {
    organisations: (orgs ?? []).map((o) => ({ ...o, contacts: contactsBy.get(o.id) ?? [], opportunityCount: total.get(o.id) ?? 0, openCount: openN.get(o.id) ?? 0 })),
    unassignedContacts: (contacts ?? []).filter((c) => !c.organisation_id),
  };
}

/** Which of these proposal versions are ESTIMATES built in the app (and whether each is finalised). A failed read throws: it must never look like "none are estimates". */
export async function loadEstimateMarks(proposalIds: readonly string[]): Promise<Map<string, { finalised: boolean }>> {
  if (proposalIds.length === 0) return new Map();
  const res = await ((await createClient()) as unknown as SupabaseClient).from("crm_quotations").select("proposal_id, issued_at").in("proposal_id", [...proposalIds]);
  if (res.error) throw new Error(`Estimates could not be loaded: ${res.error.message}`);
  return new Map(((res.data ?? []) as { proposal_id: string; issued_at: string | null }[]).map((r) => [r.proposal_id, { finalised: !!r.issued_at }]));
}

export async function loadProposals(ctx: CrmContext): Promise<{ proposal: CrmProposalRow; opportunity: OpportunityListItem | null; file: CrmFileRow | null; estimate: { finalised: boolean } | null }[]> {
  const supabase = await createClient();
  const [propsRes, items, filesRes] = await Promise.all([
    supabase.from("crm_proposals").select("*").order("created_at", { ascending: false }).limit(500),
    loadOpportunities(ctx),
    supabase.from("crm_files").select("*").is("deleted_at", null).eq("purpose", "proposal"),
  ]);
  ok(propsRes, filesRes);
  const props = propsRes.data;
  const files = filesRes.data;
  const estimates = await loadEstimateMarks((props ?? []).map((p) => p.id));
  const oppBy = new Map(items.map((i) => [i.opp.id, i]));
  const fileBy = new Map((files ?? []).map((f) => [f.id, f]));
  return (props ?? []).map((p) => ({ proposal: p, opportunity: oppBy.get(p.opportunity_id) ?? null, file: p.file_id ? (fileBy.get(p.file_id) ?? null) : null, estimate: estimates.get(p.id) ?? null }));
}

export async function loadMyReminders(): Promise<CrmReminderRow[]> {
  const supabase = await createClient();
  const res = await supabase.from("crm_reminders").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(50);
  ok(res);
  return res.data ?? [];
}
