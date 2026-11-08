import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CrmOutreachEventRow, CrmOutreachRow } from "@/types/crm";

/** A failed query must surface as an error (the page says "could not load"), never as "no outreach". */
function ok(...results: { error?: { message: string } | null }[]): void {
  for (const r of results) if (r.error) throw new Error(`Outreach could not be loaded: ${r.error.message}`);
}

export interface OutreachListRow extends CrmOutreachRow { accountName: string }

/**
 * The company's outreach as the database lets THIS person read it: an assignee's own rows, an assign_owner holder's every row (policy crm_outreach_select).
 * The caller filters to "mine" itself. Throws when any read fails.
 */
export async function loadOutreach(companyId: string): Promise<OutreachListRow[]> {
  const supabase = await createClient();
  const res = await supabase.from("crm_outreach").select("*").eq("company_id", companyId).order("target_date").limit(1000);
  ok(res);
  const rows = res.data ?? [];
  const ids = [...new Set(rows.map((r) => r.organisation_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const orgs = await supabase.from("crm_organisations").select("id, name").in("id", ids);
    ok(orgs);
    for (const o of orgs.data ?? []) names.set(o.id, o.name);
  }
  return rows.map((r) => ({ ...r, accountName: names.get(r.organisation_id) ?? "Unknown account" }));
}

export interface AccountOutreach { outreach: CrmOutreachRow; events: CrmOutreachEventRow[] }

/** This account's outreach for the selected company (open first, then closed, newest first) with its full history. Throws when a read fails. */
export async function loadAccountOutreach(companyId: string, orgId: string): Promise<AccountOutreach[]> {
  const supabase = await createClient();
  const res = await supabase.from("crm_outreach").select("*").eq("company_id", companyId).eq("organisation_id", orgId).order("created_at", { ascending: false });
  ok(res);
  const rows = res.data ?? [];
  if (rows.length === 0) return [];
  const ev = await supabase.from("crm_outreach_events").select("*").in("outreach_id", rows.map((r) => r.id)).order("created_at", { ascending: true }).order("id", { ascending: true });
  ok(ev);
  const open = (r: CrmOutreachRow) => (r.status === "closed" ? 1 : 0);
  return rows
    .map((outreach) => ({ outreach, events: (ev.data ?? []).filter((e) => e.outreach_id === outreach.id) }))
    .sort((a, b) => open(a.outreach) - open(b.outreach));
}
