import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";

/**
 * The outreach an enquiry was raised from. crm_outreach_link_inquiry stores the link on the outreach row itself (crm_outreach.opportunity_id, with status
 * 'inquiry_raised'; migration 20261219000100), so it is one small read by that column. The database decides who may see an outreach row (its assignee, or
 * someone who may assign owners), so "none" here means "none this person may see", and the page then says nothing rather than "no outreach".
 * "error" = the read failed: the page says it could not load.
 */
export interface OutreachOrigin { outreachId: string; organisationId: string; accountName: string | null }
export type EnquiryOutreachRead = { status: "ok"; rows: OutreachOrigin[] } | { status: "error" };

const LIMIT = 3;

export async function loadEnquiryOutreach(opportunityId: string): Promise<EnquiryOutreachRead> {
  try {
    const supabase = await createClient();
    const res = await supabase.from("crm_outreach").select("id, organisation_id").eq("opportunity_id", opportunityId).order("created_at", { ascending: true }).limit(LIMIT);
    if (isNotInstalled(res.error)) return { status: "ok", rows: [] };
    if (res.error) return { status: "error" };
    const rows = res.data ?? [];
    if (rows.length === 0) return { status: "ok", rows: [] };
    // The account's name is a courtesy: if it cannot be read the link is still shown, without it.
    const names = new Map<string, string>();
    const orgs = await supabase.from("crm_organisations").select("id, name").in("id", [...new Set(rows.map((r) => r.organisation_id))]);
    for (const o of orgs.data ?? []) names.set(o.id, o.name);
    return { status: "ok", rows: rows.map((r) => ({ outreachId: r.id, organisationId: r.organisation_id, accountName: names.get(r.organisation_id) ?? null })) };
  } catch (e) {
    console.error("[crm] enquiry outreach read failed", e);
    return { status: "error" };
  }
}
