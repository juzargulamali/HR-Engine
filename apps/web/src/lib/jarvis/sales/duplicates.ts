import type { SupabaseClient } from "@supabase/supabase-js";
import { findLikelyDuplicates, type DuplicateCandidate } from "@enginious-hr/domain";
import type { DuplicateView, EnquiryValues } from "../protocol";

/**
 * Possible duplicate enquiries: the same deterministic rules as the existing form (crm_find_duplicate_candidates, scored by findLikelyDuplicates in packages/domain),
 * read through the person's own session, and limited to the SELECTED company. A failed check is reported as failed, never as "no duplicates".
 */
export async function findDuplicateEnquiries(supabase: SupabaseClient, v: EnquiryValues): Promise<{ ok: true; matches: DuplicateView[] } | { ok: false }> {
  if (!v.agencyOrgId && !v.clientOrgId && !v.eventStart && !v.installStart && !v.location) return { ok: true, matches: [] };
  const r = await supabase.rpc("crm_find_duplicate_candidates", {
    p_agency_org_id: v.agencyOrgId, p_client_org_id: v.clientOrgId, p_event_start: v.eventStart, p_install_start: v.installStart, p_location: v.location,
  });
  if (r.error) return { ok: false };
  const rows = ((r.data ?? []) as { opportunity_id: string; company_id: string; reference: string; title: string; stage: string; agency_org_id: string | null; client_org_id: string | null; event_start: string | null; install_start: string | null; location: string | null; technologies: { name: string; qty: number }[] | null; created_at: string }[])
    .filter((x) => x.company_id === v.companyId);
  const candidates: DuplicateCandidate[] = rows.map((x) => ({ id: x.opportunity_id, reference: x.reference, stage: x.stage, agencyOrgId: x.agency_org_id, clientOrgId: x.client_org_id, title: x.title,
    eventStart: x.event_start, installStart: x.install_start, location: x.location, technologies: x.technologies ?? [], createdAt: x.created_at }));
  const matches = findLikelyDuplicates({ agencyOrgId: v.agencyOrgId, clientOrgId: v.clientOrgId, title: v.title, eventStart: v.eventStart, installStart: v.installStart, location: v.location, technologies: v.technologies }, candidates);
  return { ok: true, matches: matches.slice(0, 5).map((m) => ({ id: m.candidate.id, reference: m.candidate.reference, title: rows.find((x) => x.opportunity_id === m.candidate.id)?.title ?? "", stage: m.candidate.stage, level: m.level, reasons: m.reasons })) };
}
