import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import type { CrmAccountProfileRow, CrmContactRow, CrmOrganisationRow } from "@/types/crm";
import type { CrmContext } from "../context";
import { deriveAccount, type AccountView, type OppLite, type ProjectLite, type Section } from "./account";
import { buildDirectoryRows, type DirectoryRow } from "./directory";
import type { StaffPerson } from "./staff";
import type { SummaryInputs } from "./import/export";

/** A failed query must surface as an error (the page says "could not load"), never as "no data". */
function ok(...results: { error?: { message: string } | null }[]): void {
  for (const r of results) if (r.error) throw new Error(`Clients & Agencies could not be loaded: ${r.error.message}`);
}

/**
 * The shared organisations with the selected company's profiles, contacts and enquiry figures. Throws when the organisations, contacts or profiles
 * cannot be read. When only the ENQUIRIES cannot be read, the rows still load with `stats: null`, which the page shows as "Could not load" (never zero,
 * never a badge).
 */
export async function loadDirectory(companyId: string, now: Date = new Date()): Promise<DirectoryRow[]> {
  const supabase = await createClient();
  const [orgs, contacts, profiles, opps] = await Promise.all([
    supabase.from("crm_organisations").select("*").is("archived_at", null).order("name"),
    supabase.from("crm_contacts").select("*").is("archived_at", null).order("name"),
    supabase.from("crm_account_profiles").select("*").eq("company_id", companyId),
    readAll<DirectoryOpp>((a, b) => supabase.from("crm_opportunities").select("id, company_id, agency_org_id, client_org_id, stage, created_at").eq("company_id", companyId).order("id").range(a, b)).catch((e) => {
      console.error("[clients-agencies] enquiries could not be read for the directory", e);
      return null;
    }),
  ]);
  ok(orgs, contacts, profiles);
  return buildDirectoryRows({ organisations: orgs.data ?? [], contacts: contacts.data ?? [], profiles: profiles.data ?? [], opportunities: opps, companyId, now });
}

type DirectoryOpp = Pick<OppLite, "id" | "company_id" | "agency_org_id" | "client_org_id" | "stage" | "created_at">;

/** Every person with CRM access in companies the caller can access (crm_people). E-mail addresses are filled only for a Sales founder. Throws on failure. */
export async function loadStaff(): Promise<StaffPerson[]> {
  const supabase = await createClient();
  const res = await supabase.rpc("crm_people");
  ok(res);
  return (res.data ?? []).map((p) => ({ userId: p.user_id, name: p.full_name?.trim() || p.email?.split("@")[0] || "Unnamed user", email: p.email, companyIds: p.company_ids }));
}

const HANDOVER_CHECK_LIMIT = 30;

export interface AccountPage {
  org: CrmOrganisationRow;
  contacts: CrmContactRow[];
  profile: CrmAccountProfileRow | null;
  view: AccountView;
  /** Names of the other organisations on this account's inquiries (agency or end client). */
  orgNames: Map<string, string>;
}

/** null = no such organisation (or not visible). Throws when a required read fails; projects and handovers fail softly into a section the page words as "could not load". */
export async function loadAccount(ctx: CrmContext, companyId: string, orgId: string, now: Date = new Date()): Promise<AccountPage | null> {
  void ctx;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return null;
  const supabase = await createClient();
  const orgRes = await supabase.from("crm_organisations").select("*").eq("id", orgId).maybeSingle();
  ok(orgRes);
  if (!orgRes.data) return null;
  const [contactsRes, profileRes, oppsRes] = await Promise.all([
    supabase.from("crm_contacts").select("*").eq("organisation_id", orgId).is("archived_at", null).order("name"),
    supabase.from("crm_account_profiles").select("*").eq("organisation_id", orgId).eq("company_id", companyId).maybeSingle(),
    supabase.from("crm_opportunities")
      .select("id, company_id, reference, title, stage, agency_org_id, client_org_id, owner_id, currency, value, closed_at, created_at")
      .eq("company_id", companyId).or(`agency_org_id.eq.${orgId},client_org_id.eq.${orgId}`).order("created_at", { ascending: false }).limit(1000),
  ]);
  ok(contactsRes, profileRes, oppsRes);
  const opps: OppLite[] = oppsRes.data ?? [];
  const ids = opps.map((o) => o.id);
  const none = Promise.resolve({ data: [], error: null });
  const [proposals, zoho, activities, followUps, others] = await Promise.all([
    ids.length ? supabase.from("crm_proposals").select("id, opportunity_id, version, status, sent_on").in("opportunity_id", ids) : none,
    ids.length ? supabase.from("crm_zoho_references").select("opportunity_id, quote_ref, quote_sent_on").in("opportunity_id", ids) : none,
    ids.length ? supabase.from("crm_activities").select("id, opportunity_id, kind, occurred_at").in("opportunity_id", ids) : none,
    // The inquiries' open follow-ups, and the ones placed on this account itself (no inquiry), for the selected company only.
    supabase.from("crm_follow_ups").select("id, opportunity_id, organisation_id, title, due_at, status, assigned_to, created_by, company_id").eq("company_id", companyId).eq("status", "open")
      .or(ids.length ? `opportunity_id.in.(${ids.join(",")}),and(opportunity_id.is.null,organisation_id.eq.${orgId})` : `and(opportunity_id.is.null,organisation_id.eq.${orgId})`),
    (() => {
      const other = [...new Set(opps.flatMap((o) => [o.agency_org_id, o.client_org_id]).filter((x): x is string => !!x && x !== orgId))];
      return other.length ? supabase.from("crm_organisations").select("id, name").in("id", other) : none;
    })(),
  ]);
  ok(proposals, zoho, activities, followUps, others);

  // Projects are read through the viewer's own session: they appear only for people who can open them. A failed read is a section error, never "none".
  const wonIds = opps.filter((o) => o.stage === "won").map((o) => o.id);
  let projects: Section<ProjectLite[]> = { status: "ok", data: [] };
  let handovers: Section<Map<string, string>> = { status: "ok", data: new Map() };
  if (wonIds.length) {
    const pr = await supabase.from("proj_projects").select("id, reference, name, status, completed_at, crm_opportunity_id").in("crm_opportunity_id", wonIds);
    if (isNotInstalled(pr.error)) { /* Projects not installed here: no projects exist */ }
    else if (pr.error) { projects = { status: "error" }; }
    else projects = { status: "ok", data: pr.data ?? [] };
    if (projects.status === "ok") {
      const visible = new Set(projects.data.map((p) => p.crm_opportunity_id));
      const need = wonIds.filter((id) => !visible.has(id)).slice(0, HANDOVER_CHECK_LIMIT);
      const map = new Map<string, string>();
      try {
        for (let i = 0; i < need.length; i += 10) {
          const part = need.slice(i, i + 10);
          const results = await Promise.all(part.map((id) => supabase.rpc("proj_handover_for_opportunity", { p_opportunity_id: id })));
          for (const [n, r] of results.entries()) {
            if (isNotInstalled(r.error)) continue;
            if (r.error) throw new Error(r.error.message);
            const st = r.data?.[0]?.status;
            if (st) map.set(part[n]!, st);
          }
        }
        handovers = { status: "ok", data: map };
      } catch { handovers = { status: "error" }; }
    }
  }
  const view = deriveAccount({
    orgId, companyId, now, opportunities: opps, proposals: proposals.data ?? [], zoho: zoho.data ?? [], activities: activities.data ?? [], followUps: followUps.data ?? [], projects, handovers,
  });
  return { org: orgRes.data, contacts: contactsRes.data ?? [], profile: profileRes.data ?? null, view, orgNames: new Map((others.data ?? []).map((o) => [o.id, o.name])) };
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

/**
 * Everything the export's Summary sheet needs to count inquiries, quotes and completed projects the way the account page does, for every
 * organisation at once. Inquiries, quotes and replies fail the whole load; projects fail softly into "could not load" cells.
 */
export async function loadSummaryInputs(companyId: string): Promise<SummaryInputs> {
  const supabase = await createClient();
  const [opportunities, proposals, zoho, activities] = await Promise.all([
    readAll<OppLite>((a, b) => supabase.from("crm_opportunities").select("id, company_id, reference, title, stage, agency_org_id, client_org_id, owner_id, currency, value, closed_at, created_at").eq("company_id", companyId).order("id").range(a, b)),
    readAll((a, b) => supabase.from("crm_proposals").select("id, opportunity_id, version, status, sent_on").order("id").range(a, b)),
    readAll((a, b) => supabase.from("crm_zoho_references").select("opportunity_id, quote_ref, quote_sent_on").order("opportunity_id").range(a, b)),
    readAll((a, b) => supabase.from("crm_activities").select("id, opportunity_id, kind, occurred_at").eq("kind", "client_response").order("id").range(a, b)),
  ]);
  const won = new Set(opportunities.filter((o) => o.stage === "won").map((o) => o.id));
  let projects: Section<ProjectLite[]> = { status: "ok", data: [] };
  if (won.size) {
    const all: ProjectLite[] = [];
    for (let from = 0; projects.status === "ok"; from += 1000) {
      const r = await supabase.from("proj_projects").select("id, reference, name, status, completed_at, crm_opportunity_id").not("crm_opportunity_id", "is", null).order("id").range(from, from + 999);
      if (isNotInstalled(r.error)) break;
      // Any other failure is "could not load" in the sheet, never zero.
      if (r.error) { projects = { status: "error" }; break; }
      all.push(...(r.data ?? []));
      if ((r.data ?? []).length < 1000) break;
    }
    if (projects.status === "ok") projects = { status: "ok", data: all.filter((p) => p.crm_opportunity_id && won.has(p.crm_opportunity_id)) };
  }
  return { companyId, opportunities, proposals, zoho, activities, projects };
}
