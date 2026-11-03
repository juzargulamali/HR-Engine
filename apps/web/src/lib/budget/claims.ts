import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClaimOption } from "@/components/budget/actuals-section";

/**
 * The signed-in person's own expense claims, so an actual expense that is already in a claim can be linked to it (a link only: the claim is never changed and
 * nothing is paid twice). A failed read is reported as `failed` (the form then says the claims could not be loaded, with a retry): it is never an
 * empty list, which would read as "you have no claims".
 */
export async function loadOwnClaims(userId: string): Promise<{ claims: ClaimOption[]; failed: boolean }> {
  try {
    const supabase = await createClient();
    const { data: emp, error: empError } = await supabase.from("employees").select("id").eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (empError) return { claims: [], failed: true };
    if (!emp) return { claims: [], failed: false };
    const { data, error } = await supabase
      .from("reimbursement_claims")
      .select("id, claim_date, currency, total_amount, status")
      .eq("employee_id", emp.id)
      .is("deleted_at", null)
      .order("claim_date", { ascending: false })
      .limit(40);
    if (error) return { claims: [], failed: true };
    return { claims: (data ?? []).map((c) => ({ id: c.id, label: `${c.claim_date} · ${c.currency} ${Number(c.total_amount).toFixed(2)} · ${String(c.status).replace(/_/g, " ")}` })), failed: false };
  } catch {
    return { claims: [], failed: true };
  }
}
