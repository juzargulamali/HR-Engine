import "server-only";
import { availabilityDisplay, type AvailabilityDisplay } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type {
  CrmActivityRow, CrmApprovalRow, CrmContactRow, CrmFileRow, CrmFollowUpRow, CrmHandoverRow, CrmOpportunityEventRow,
  CrmOpportunityRow, CrmOrganisationRow, CrmProposalRow, CrmReminderRow, CrmZohoReferenceRow,
} from "@/types/crm";
import type { CrmContext } from "./context";

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

/** Everything the signed-in user may see (RLS decides), with names and the next follow-up resolved. */
export async function loadOpportunities(ctx: CrmContext): Promise<OpportunityListItem[]> {
  const supabase = await createClient();
  const oppsRes = await supabase.from("crm_opportunities").select("*").order("created_at", { ascending: false }).limit(2000);
  ok(oppsRes);
  const opps = oppsRes.data;
  const rows = opps ?? [];
  if (rows.length === 0) return [];
  const orgIds = [...new Set(rows.flatMap((o) => [o.agency_org_id, o.client_org_id]).filter((x): x is string => !!x))];
  const [orgsRes, fuRes] = await Promise.all([
    orgIds.length ? supabase.from("crm_organisations").select("*").in("id", orgIds) : Promise.resolve({ data: [] as CrmOrganisationRow[], error: null }),
    supabase.from("crm_follow_ups").select("*").eq("status", "open").order("due_at"),
  ]);
  ok(orgsRes, fuRes);
  const orgs = orgsRes.data;
  const followUps = fuRes.data;
  const orgBy = new Map((orgs ?? []).map((o) => [o.id, o]));
  const nextBy = new Map<string, CrmFollowUpRow>();
  const countBy = new Map<string, number>();
  for (const f of followUps ?? []) {
    if (!nextBy.has(f.opportunity_id)) nextBy.set(f.opportunity_id, f);
    countBy.set(f.opportunity_id, (countBy.get(f.opportunity_id) ?? 0) + 1);
  }
  return rows.map((o) => toItem(ctx, o, orgBy, nextBy, countBy));
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
}

export async function loadOpportunityDetail(ctx: CrmContext, id: string): Promise<OpportunityDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const oppRes = await supabase.from("crm_opportunities").select("*").eq("id", id).maybeSingle();
  ok(oppRes);
  const opp = oppRes.data;
  if (!opp) return null;
  const [orgs, links, acts, fus, evs, files, props, zoho, appr, hand] = await Promise.all([
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
  ]);
  ok(orgs, links, acts, fus, evs, files, props, zoho, appr, hand);
  const orgBy = new Map((orgs.data ?? []).map((o) => [o.id, o]));
  const open = (fus.data ?? []).filter((f) => f.status === "open");
  const nextBy = new Map<string, CrmFollowUpRow>();
  if (open[0]) nextBy.set(id, open[0]);
  const item = toItem(ctx, opp, orgBy, nextBy, new Map([[id, open.length]]));

  const contactIds = (links.data ?? []).map((l) => l.contact_id);
  const { data: contactRows } = contactIds.length ? await supabase.from("crm_contacts").select("*").in("id", contactIds) : { data: [] as CrmContactRow[] };
  const contactOrgIds = [...new Set((contactRows ?? []).map((c) => c.organisation_id).filter((x): x is string => !!x && !orgBy.has(x)))];
  if (contactOrgIds.length) {
    const { data: more } = await supabase.from("crm_organisations").select("*").in("id", contactOrgIds);
    for (const o of more ?? []) orgBy.set(o.id, o);
  }
  const roleBy = new Map((links.data ?? []).map((l) => [l.contact_id, l.role]));
  return {
    item,
    contacts: (contactRows ?? []).map((c) => ({ contact: c, role: roleBy.get(c.id) ?? null, organisation: c.organisation_id ? (orgBy.get(c.organisation_id) ?? null) : null })),
    activities: acts.data ?? [],
    followUps: fus.data ?? [],
    events: evs.data ?? [],
    files: files.data ?? [],
    proposals: props.data ?? [],
    zoho: zoho.data ?? null,
    approvals: appr.data ?? [],
    handover: hand.data ?? null,
  };
}

export interface FollowUpListItem {
  followUp: CrmFollowUpRow;
  opportunity: Pick<CrmOpportunityRow, "id" | "reference" | "title" | "stage" | "company_id" | "owner_id">;
  assigneeName: string;
}

/** Open follow-ups across everything the user can see, soonest first, plus the most recent completed ones. */
export async function loadFollowUps(ctx: CrmContext): Promise<{ open: FollowUpListItem[]; done: FollowUpListItem[] }> {
  const supabase = await createClient();
  const [openRes, doneRes] = await Promise.all([
    supabase.from("crm_follow_ups").select("*").eq("status", "open").order("due_at").limit(1000),
    supabase.from("crm_follow_ups").select("*").eq("status", "done").order("completed_at", { ascending: false }).limit(30),
  ]);
  ok(openRes, doneRes);
  const open = openRes.data;
  const done = doneRes.data;
  const all = [...(open ?? []), ...(done ?? [])];
  const oppIds = [...new Set(all.map((f) => f.opportunity_id))];
  const { data: opps } = oppIds.length
    ? await supabase.from("crm_opportunities").select("id, reference, title, stage, company_id, owner_id").in("id", oppIds)
    : { data: [] as Pick<CrmOpportunityRow, "id" | "reference" | "title" | "stage" | "company_id" | "owner_id">[] };
  const oppBy = new Map((opps ?? []).map((o) => [o.id, o]));
  const wrap = (f: CrmFollowUpRow): FollowUpListItem | null => {
    const o = oppBy.get(f.opportunity_id);
    return o ? { followUp: f, opportunity: o, assigneeName: ctx.personName(f.assigned_to) } : null;
  };
  return {
    open: (open ?? []).map(wrap).filter((x): x is FollowUpListItem => !!x),
    done: (done ?? []).map(wrap).filter((x): x is FollowUpListItem => !!x),
  };
}

export async function loadOrganisations(): Promise<{
  organisations: (CrmOrganisationRow & { contacts: CrmContactRow[]; opportunityCount: number; openCount: number })[];
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
  };
}

export async function loadProposals(ctx: CrmContext): Promise<{ proposal: CrmProposalRow; opportunity: OpportunityListItem | null; file: CrmFileRow | null }[]> {
  const supabase = await createClient();
  const [propsRes, items, filesRes] = await Promise.all([
    supabase.from("crm_proposals").select("*").order("created_at", { ascending: false }).limit(500),
    loadOpportunities(ctx),
    supabase.from("crm_files").select("*").is("deleted_at", null).eq("purpose", "proposal"),
  ]);
  ok(propsRes, filesRes);
  const props = propsRes.data;
  const files = filesRes.data;
  const oppBy = new Map(items.map((i) => [i.opp.id, i]));
  const fileBy = new Map((files ?? []).map((f) => [f.id, f]));
  return (props ?? []).map((p) => ({ proposal: p, opportunity: oppBy.get(p.opportunity_id) ?? null, file: p.file_id ? (fileBy.get(p.file_id) ?? null) : null }));
}

export async function loadMyReminders(): Promise<CrmReminderRow[]> {
  const supabase = await createClient();
  const res = await supabase.from("crm_reminders").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(50);
  ok(res);
  return res.data ?? [];
}
