import type { SupabaseClient } from "@supabase/supabase-js";
import { crmStageLabel } from "@enginious-hr/domain";
import type { EnquiryRef } from "../protocol";

/**
 * Reading ONE existing enquiry for an action, through the signed-in person's OWN session: RLS (crm_opportunities select = crm_has_access(company)) decides what they can see,
 * so an id they cannot read looks exactly like an id that does not exist. A page's or a message's enquiry id is a HINT only: this is where it is re-verified.
 */
export interface EnquiryRow {
  id: string; company_id: string; reference: string; title: string; stage: string; owner_id: string | null; version: number;
  agency_org_id: string | null; client_org_id: string | null; currency: string | null; value: number | null; budget_note: string | null; brief: string | null;
  event_start: string | null; event_end: string | null; install_start: string | null; location: string | null; technologies: { name: string; qty: number }[] | null;
  scope: string | null; waiting_on: string | null;
}

const COLUMNS = "id, company_id, reference, title, stage, owner_id, version, agency_org_id, client_org_id, currency, value, budget_note, brief, event_start, event_end, install_start, location, technologies, scope, waiting_on";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EnquiryLookup = { ok: true; row: EnquiryRow } | { ok: false; reason: "not_found" | "other_company" | "unreadable" };

export async function readEnquiry(supabase: SupabaseClient, id: string, companyId: string): Promise<EnquiryLookup> {
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const r = await supabase.from("crm_opportunities").select(COLUMNS).eq("id", id).maybeSingle();
  if (r.error) return { ok: false, reason: "unreadable" };
  const row = r.data as EnquiryRow | null;
  if (!row) return { ok: false, reason: "not_found" };
  // An enquiry of another company is never used for the selected one: the panel's company and the enquiry's company must be the same (a proposal is bound to its company).
  if (row.company_id !== companyId) return { ok: false, reason: "other_company" };
  return { ok: true, row };
}

export const LOOKUP_WORDS: Record<"not_found" | "other_company" | "unreadable", string> = {
  not_found: "That enquiry could not be found, or you cannot see it.",
  other_company: "That enquiry belongs to another company. Choose that company in JARVIS first.",
  unreadable: "Could not read the enquiry just now. Try again in a moment.",
};

export const enquiryRef = (r: EnquiryRow): EnquiryRef => ({ id: r.id, reference: r.reference, title: r.title, stage: r.stage, stageLabel: crmStageLabel(r.stage), companyId: r.company_id });

/** The names of the enquiry's agency and end client, as the person sees them (organisations are readable by anyone with a Sales grant). */
export async function organisationNames(supabase: SupabaseClient, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (want.length === 0) return out;
  const r = await supabase.from("crm_organisations").select("id, name").in("id", want);
  if (r.error) return out;
  for (const o of (r.data ?? []) as { id: string; name: string }[]) out.set(o.id, o.name);
  return out;
}

/** Does the person own the enquiry, or hold the founder capability for its company? (the rule of crm_require_owner_or_founder, read from their own grants). */
export async function isOwnerOrFounder(supabase: SupabaseClient, userId: string, row: Pick<EnquiryRow, "owner_id" | "company_id">): Promise<boolean | "error"> {
  if (row.owner_id === userId) return true;
  const g = await supabase.from("crm_company_grants").select("capabilities").eq("user_id", userId).eq("company_id", row.company_id).is("revoked_at", null).maybeSingle();
  if (g.error) return "error";
  return !!(g.data as { capabilities: string[] } | null)?.capabilities?.includes("founder");
}
