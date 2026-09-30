"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface RecoveryCreditActionResult {
  error: string | null;
}

const adjustSchema = z.object({
  requestId: z.string().uuid(),
  correctedWorkDate: z.string().min(1),
  correctedHours: z.coerce.number().positive(),
  correctionReason: z.string().optional(),
  checkedWith: z.string().optional(),
});

/**
 * HR's correction step, saved independently of the decision itself (see
 * adjust_recovery_credit_request() in schema.sql — it requires a reason
 * only when the date/hours actually change, and recomputes the proposed
 * credit server-side via the same ≤4h/>4h threshold every recording path
 * shares). The ORIGINAL values are never touched by this — they stay on
 * the originating attendance evidence for the approval screen's own
 * "original vs. corrected" display.
 */
export async function adjustRecoveryCreditRequest(input: {
  requestId: string;
  correctedWorkDate: string;
  correctedHours: number;
  correctionReason?: string;
  checkedWith?: string;
}): Promise<RecoveryCreditActionResult> {
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_recovery_credit_request", {
    p_request_id: d.requestId,
    p_corrected_work_date: d.correctedWorkDate,
    p_corrected_hours: d.correctedHours,
    p_correction_reason: d.correctionReason || null,
    p_checked_with: d.checkedWith || null,
  });

  revalidatePath("/approvals");
  return { error: error?.message ?? null };
}

const decideSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  checkedWith: z.string().optional(),
  comments: z.string().optional(),
});

/**
 * HR's decision on a Recovery Leave credit — a dedicated action (never the
 * generic decideApproval() other entity types use), since
 * decide_recovery_credit_request() requires "whom HR checked this with"
 * before an APPROVAL (the product brief: HR verifies the work with the
 * relevant project lead outside the application first) and delegates the
 * actual state transition to the SAME decide_leave_approval() every other
 * entity type uses, so the ledger is still posted in exactly one place.
 */
export async function decideRecoveryCreditRequest(input: {
  requestId: string;
  decision: "approved" | "rejected";
  checkedWith?: string;
  comments?: string;
}): Promise<RecoveryCreditActionResult> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_recovery_credit_request", {
    p_request_id: d.requestId,
    p_decision: d.decision,
    p_checked_with: d.checkedWith || null,
    p_comments: d.comments || null,
  });

  revalidatePath("/approvals");
  return { error: error?.message ?? null };
}
