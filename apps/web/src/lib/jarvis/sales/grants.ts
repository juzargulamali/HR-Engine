import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Does this person hold an active Sales grant (and, if asked, the capability: `founder` implies every one) for THIS company? Read through their own session (crm_company_grants). */
export async function hasSalesGrant(supabase: SupabaseClient, userId: string, companyId: string, capability?: string): Promise<boolean | "error"> {
  const r = await supabase.from("crm_company_grants").select("capabilities").eq("user_id", userId).eq("company_id", companyId).is("revoked_at", null).maybeSingle();
  if (r.error) return "error";
  const row = r.data as { capabilities: string[] } | null;
  if (!row) return false;
  if (!capability) return true;
  return row.capabilities.includes("founder") || row.capabilities.includes(capability);
}

/** The companies this person has a Sales grant for, with names (for the panel's company picker). */
export async function salesCompanies(supabase: SupabaseClient, userId: string): Promise<{ id: string; name: string }[] | "error"> {
  const g = await supabase.from("crm_company_grants").select("company_id").eq("user_id", userId).is("revoked_at", null);
  if (g.error) return "error";
  const ids = [...new Set(((g.data ?? []) as { company_id: string }[]).map((x) => x.company_id))];
  if (ids.length === 0) return [];
  const c = await supabase.from("companies").select("id, legal_name").in("id", ids).order("legal_name");
  if (c.error) return "error";
  return ((c.data ?? []) as { id: string; legal_name: string }[]).map((x) => ({ id: x.id, name: x.legal_name }));
}
