import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CrmOutreachEventRow, CrmOutreachRow } from "@/types/crm";
import { OUTREACH_LIMIT } from "./outreach";

/** A failed query must surface as an error (the page says "could not load"), never as "no outreach". */
function ok(...results: { error?: { message: string } | null }[]): void {
  for (const r of results) if (r.error) throw new Error(`Outreach could not be loaded: ${r.error.message}`);
}

const ID_CHUNK = 150;

export interface OutreachListRow extends CrmOutreachRow {
  accountName: string;
  /**
   * The people recorded at the account (outreach itself holds no contact). Empty = none recorded; null = they could not be read, which the row
   * words as "could not load" and never as "no contact".
   */
  contacts: { id: string; name: string; role_title: string | null }[] | null;
}

/**
 * The company's outreach as the database lets THIS person read it: an assignee's own rows, an assign_owner holder's every row (policy crm_outreach_select).
 * The caller filters to "mine" itself. Throws when the outreach or the account names cannot be read; the accounts' contacts fail softly (see `contacts`).
 * At most OUTREACH_LIMIT rows, earliest target date first.
 */
export async function loadOutreach(companyId: string): Promise<OutreachListRow[]> {
  const supabase = await createClient();
  const res = await supabase.from("crm_outreach").select("*").eq("company_id", companyId).order("target_date").limit(OUTREACH_LIMIT);
  ok(res);
  const rows = res.data ?? [];
  const ids = [...new Set(rows.map((r) => r.organisation_id))];
  const names = new Map<string, string>();
  const contactsBy = new Map<string, { id: string; name: string; role_title: string | null }[]>();
  let contactsOk = true;
  // The account ids go a chunk at a time, so a long list never makes an address the data service refuses.
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const [orgs, contacts] = await Promise.all([
      supabase.from("crm_organisations").select("id, name").in("id", chunk),
      supabase.from("crm_contacts").select("id, name, role_title, organisation_id").in("organisation_id", chunk).is("archived_at", null).order("name"),
    ]);
    ok(orgs);
    for (const o of orgs.data ?? []) names.set(o.id, o.name);
    if (contacts.error) { contactsOk = false; console.error("[outreach] contacts could not be read", contacts.error.message); continue; }
    for (const c of contacts.data ?? []) if (c.organisation_id) contactsBy.set(c.organisation_id, [...(contactsBy.get(c.organisation_id) ?? []), { id: c.id, name: c.name, role_title: c.role_title }]);
  }
  return rows.map((r) => ({ ...r, accountName: names.get(r.organisation_id) ?? "Unknown account", contacts: contactsOk ? (contactsBy.get(r.organisation_id) ?? []) : null }));
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
