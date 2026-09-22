"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const adjustmentSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeCode: z.string().min(1),
  amountDays: z.coerce.number().refine((n) => n !== 0, "Amount must not be zero"),
  note: z.string().optional(),
});

/**
 * The ONE normal path for a manual leave-balance correction — used both
 * when HR Admin types one in directly and when they authorize an AI draft
 * (docs/04-user-journeys.md §4.11 step 3: "calls the *normal*
 * postLedgerAdjustment() Server Action... pre-filled from the draft").
 * The write happens under HR Admin's own identity/RLS (leave_ledger_insert_hr),
 * so it's captured in audit_log as theirs — there is no separate "AI path"
 * into this table at all.
 */
export async function postLeaveLedgerAdjustment(input: {
  employeeId: string;
  leaveTypeCode: string;
  amountDays: number;
  note?: string;
}): Promise<{ error: string | null; ledgerEntryId?: string }> {
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("leave_ledger")
    .insert({
      employee_id: d.employeeId,
      leave_type_code: d.leaveTypeCode,
      txn_date: new Date().toISOString().slice(0, 10),
      entry_type: "adjustment",
      amount_days: d.amountDays,
      reference_type: "manual_adjustment",
      note: d.note || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not post the adjustment." };

  revalidatePath("/ai-suggestions");
  return { error: null, ledgerEntryId: data.id };
}
