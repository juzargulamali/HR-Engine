import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ClaimOption } from "@/components/budget/actuals-section";

/**
 * The signed-in person's own expense claims, so an actual expense that is already in a claim can be linked to it (a link only: the claim is never changed and
 * nothing is paid twice). Quiet on failure: the Project Manager can write the claim reference in the note instead.
 */
export async function loadOwnClaims(userId: string): Promise<ClaimOption[]> {
  try {
    const supabase = await createClient();
    const { data: emp } = await supabase.from("employees").select("id").eq("user_id", userId).is("deleted_at", null).maybeSingle();
    if (!emp) return [];
    const { data } = await supabase
      .from("reimbursement_claims")
      .select("id, claim_date, currency, total_amount, status")
      .eq("employee_id", emp.id)
      .is("deleted_at", null)
      .order("claim_date", { ascending: false })
      .limit(40);
    return (data ?? []).map((c) => ({ id: c.id, label: `${c.claim_date} · ${c.currency} ${Number(c.total_amount).toFixed(2)} · ${String(c.status).replace(/_/g, " ")}` }));
  } catch {
    return [];
  }
}
