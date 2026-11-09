import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CrmEventEditionRow, CrmEventRow, CrmObservationRow, CrmOrganisationRow } from "@/types/crm";
import { editionLabel, type LinkedEnquiry } from "./model";

/** A failed query must surface as an error (the page says "could not load"), never as "no data". */
function ok(...results: { error?: { message: string } | null }[]): void {
  for (const r of results) if (r.error) throw new Error(`Events could not be loaded: ${r.error.message}`);
}

/** Reads a table page by page (the data service returns at most 1000 rows per request). Throws when any page fails. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await page(from, from + 999);
    ok(r);
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) return out;
  }
}

const ENQUIRY_COLUMNS = "id, company_id, reference, title, stage, event_edition_id, agency_org_id, client_org_id";

/**
 * Every event and edition (shared by all companies) and the enquiries linked to them. The enquiries are read through the viewer's OWN session: row-level security
 * returns only the companies the viewer has a Sales grant for, so an enquiry they may not see is not in this list and contributes nothing to a figure or a drill-down.
 */
export async function loadEvents(): Promise<{ events: CrmEventRow[]; editions: CrmEventEditionRow[]; enquiries: LinkedEnquiry[] }> {
  const supabase = await createClient();
  const [events, editions, enquiries] = await Promise.all([
    readAll<CrmEventRow>((a, b) => supabase.from("crm_events").select("*").order("id").range(a, b)),
    readAll<CrmEventEditionRow>((a, b) => supabase.from("crm_event_editions").select("*").order("id").range(a, b)),
    readAll<LinkedEnquiry>((a, b) => supabase.from("crm_opportunities").select(ENQUIRY_COLUMNS).not("event_edition_id", "is", null).order("id").range(a, b)),
  ]);
  return { events, editions, enquiries };
}

export interface EventOrg { id: string; name: string; country_code: string | null; website: string | null; roles: string[]; outreach_priority: number | null }

/** One event with its editions, every observation at them, the organisations those name, and the linked enquiries the viewer can read. null = no such event. */
export async function loadEvent(eventId: string): Promise<{
  event: CrmEventRow; editions: CrmEventEditionRow[]; observations: CrmObservationRow[]; orgs: Map<string, EventOrg>; enquiries: LinkedEnquiry[];
} | null> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  const supabase = await createClient();
  const evRes = await supabase.from("crm_events").select("*").eq("id", eventId).maybeSingle();
  ok(evRes);
  if (!evRes.data) return null;
  const edRes = await supabase.from("crm_event_editions").select("*").eq("event_id", eventId).order("start_date", { ascending: false });
  ok(edRes);
  const editions = edRes.data ?? [];
  const ids = editions.map((e) => e.id);
  const none = Promise.resolve({ data: [] as never[], error: null });
  const [obsRes, enqRes] = await Promise.all([
    ids.length ? readAll<CrmObservationRow>((a, b) => supabase.from("crm_event_observations").select("*").in("edition_id", ids).order("created_at").range(a, b)).then((data) => ({ data, error: null })) : none,
    ids.length ? readAll<LinkedEnquiry>((a, b) => supabase.from("crm_opportunities").select(ENQUIRY_COLUMNS).in("event_edition_id", ids).order("id").range(a, b)).then((data) => ({ data, error: null })) : none,
  ]);
  const observations = obsRes.data as CrmObservationRow[];
  const orgIds = [...new Set(observations.flatMap((o) => [o.exhibitor_org_id, o.agency_org_id]).filter((x): x is string => !!x))];
  const orgRes = orgIds.length ? await supabase.from("crm_organisations").select("id, name, country_code, website, roles, outreach_priority").in("id", orgIds) : { data: [], error: null };
  ok(orgRes);
  const orgs = new Map<string, EventOrg>(((orgRes.data ?? []) as Pick<CrmOrganisationRow, "id" | "name" | "country_code" | "website" | "roles" | "outreach_priority">[]).map((o) => [o.id, { id: o.id, name: o.name, country_code: o.country_code, website: o.website, roles: o.roles, outreach_priority: o.outreach_priority }]));
  return { event: evRes.data, editions, observations, orgs, enquiries: enqRes.data as LinkedEnquiry[] };
}

export interface EditionOption { id: string; label: string; detail: string; archived: boolean }

/**
 * The editions an enquiry may be linked to: every live edition of a live event (newest first), plus `keep` (the one the enquiry already has, even if archived, so it still
 * shows and can be cleared or changed). Read through the viewer's session; shared by every company.
 */
export async function loadEditionOptions(keep: string | null = null): Promise<EditionOption[]> {
  const supabase = await createClient();
  const [events, editions] = await Promise.all([
    readAll<Pick<CrmEventRow, "id" | "name" | "archived_at">>((a, b) => supabase.from("crm_events").select("id, name, archived_at").order("id").range(a, b)),
    readAll<CrmEventEditionRow>((a, b) => supabase.from("crm_event_editions").select("*").order("id").range(a, b)),
  ]);
  const byEvent = new Map(events.map((e) => [e.id, e]));
  return editions
    .filter((d) => d.id === keep || (!d.archived_at && byEvent.get(d.event_id) && !byEvent.get(d.event_id)!.archived_at))
    .flatMap((d) => {
      const e = byEvent.get(d.event_id);
      return e ? [{ id: d.id, label: editionLabel(e, d), detail: [d.venue, d.start_date].filter(Boolean).join(" · "), archived: !!(d.archived_at || e.archived_at), start: d.start_date }] : [];
    })
    .sort((a, b) => b.start.localeCompare(a.start) || a.label.localeCompare(b.label))
    .map(({ start: _start, ...o }) => o);
}

/** The label and event of one edition, for an enquiry that is linked to it. null = not readable (never a guess). */
export async function loadEditionLabel(editionId: string): Promise<{ label: string; eventId: string; archived: boolean } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) return null;
  const supabase = await createClient();
  const ed = await supabase.from("crm_event_editions").select("*").eq("id", editionId).maybeSingle();
  if (ed.error || !ed.data) return null;
  const ev = await supabase.from("crm_events").select("id, name, archived_at").eq("id", ed.data.event_id).maybeSingle();
  if (ev.error || !ev.data) return null;
  return { label: editionLabel(ev.data, ed.data), eventId: ev.data.id, archived: !!(ed.data.archived_at || ev.data.archived_at) };
}

export interface OrgChoiceRow { id: string; name: string; country: string | null; website: string | null; roles: string[]; priority: number | null }

/** Every live account (the shared directory) in the short form the observation field searches. Throws when the read fails: an empty list would invite duplicate accounts. */
export async function loadOrgChoices(): Promise<OrgChoiceRow[]> {
  const supabase = await createClient();
  const rows = await readAll<Pick<CrmOrganisationRow, "id" | "name" | "country_code" | "website" | "roles" | "outreach_priority">>((a, b) =>
    supabase.from("crm_organisations").select("id, name, country_code, website, roles, outreach_priority").is("archived_at", null).order("name").order("id").range(a, b));
  return rows.map((o) => ({ id: o.id, name: o.name, country: o.country_code, website: o.website, roles: o.roles, priority: o.outreach_priority }));
}
