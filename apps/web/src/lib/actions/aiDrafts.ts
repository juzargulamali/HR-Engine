"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { postLeaveLedgerAdjustment } from "./ledgerAdjustments";

interface AdjustBalancePayload {
  employee_id: string;
  leave_type_code: string;
  amount_days: number;
  note?: string;
}

/**
 * Authorize an AI draft — docs/04-user-journeys.md §4.11 step 3: this
 * calls the exact same Server Action a manual correction would, under HR
 * Admin's own identity/RLS, pre-filled from the draft. There is no
 * separate write path for AI-originated changes; if the normal action
 * rejects the payload, the draft stays pending and nothing changes.
 */
export async function authorizeAiDraft(draftId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: draft } = await supabase.from("ai_drafts").select("entity_type, proposed_action, proposed_payload, status").eq("id", draftId).maybeSingle();
  if (!draft) return { error: "Draft not found." };
  if (draft.status !== "draft") return { error: "This draft has already been decided." };

  let referenceId: string | undefined;
  if (draft.entity_type === "leave_ledger" && draft.proposed_action === "adjust_balance") {
    const payload = draft.proposed_payload as unknown as AdjustBalancePayload;
    const result = await postLeaveLedgerAdjustment({
      employeeId: payload.employee_id,
      leaveTypeCode: payload.leave_type_code,
      amountDays: payload.amount_days,
      note: payload.note,
    });
    if (result.error) return result;
    referenceId = result.ledgerEntryId;
  } else {
    return { error: `No authorize handler is wired up yet for ${draft.entity_type}/${draft.proposed_action}.` };
  }

  const { error } = await supabase
    .from("ai_drafts")
    .update({ status: "authorized", authorized_by: user.id, authorized_at: new Date().toISOString(), reference_id: referenceId })
    .eq("id", draftId);
  if (error) return { error: error.message };

  revalidatePath("/ai-suggestions");
  return { error: null };
}

export async function rejectAiDraft(draftId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("ai_drafts").update({ status: "rejected" }).eq("id", draftId);
  revalidatePath("/ai-suggestions");
  return { error: error?.message ?? null };
}
