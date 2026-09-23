"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { resolveInitialApprover } from "./approvals";
import { validateUploadFile } from "@/lib/uploads";

async function currentEmployee(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: employee } = await supabase
    .from("employees")
    .select("id, company_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  return employee ? { ...employee, userId: user.id } : null;
}

const createClaimSchema = z.object({ currency: z.string().length(3, "3-letter currency code, e.g. AED") });

export async function createDraftClaim(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createClaimSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." };

  const { data, error } = await supabase
    .from("reimbursement_claims")
    .insert({ employee_id: employee.id, currency: parsed.data.currency.toUpperCase() })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the claim." };

  revalidatePath("/reimbursements");
  redirect(`/reimbursements/${data.id}`);
}

const addLineSchema = z.object({
  claimId: z.string().uuid(),
  expenseDate: z.string().min(1),
  category: z.string().min(1),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  description: z.string().optional(),
});

export async function addClaimLine(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." };

  let receiptFilePath: string | null = null;
  const file = formData.get("receipt");
  if (file instanceof File && file.size > 0) {
    const validationError = validateUploadFile(file);
    if (validationError) return { error: validationError };

    receiptFilePath = `${employee.company_id}/${employee.id}/receipts/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(receiptFilePath, file, { contentType: file.type });
    if (uploadError) return { error: `Receipt upload failed: ${uploadError.message}` };
  }

  const { count } = await supabase
    .from("reimbursement_claim_lines")
    .select("id", { count: "exact", head: true })
    .eq("claim_id", d.claimId);
  const nextLineNo = (count ?? 0) + 1;

  const { error } = await supabase.from("reimbursement_claim_lines").insert({
    claim_id: d.claimId,
    line_no: nextLineNo,
    expense_date: d.expenseDate,
    category: d.category,
    amount: d.amount,
    description: d.description || null,
    receipt_file_path: receiptFilePath,
  });
  if (error) return { error: error.message };

  revalidatePath(`/reimbursements/${d.claimId}`);
  return { error: null };
}

/**
 * Storage removal is best-effort — if it fails, the row still goes (same
 * remove-then-delete order as deleteLetter()), since a receipt with no line
 * left pointing at it is unreachable through the UI either way.
 */
export async function deleteClaimLine(lineId: string, claimId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: line } = await supabase.from("reimbursement_claim_lines").select("receipt_file_path").eq("id", lineId).maybeSingle();
  if (line?.receipt_file_path) {
    await supabase.storage.from("receipts").remove([line.receipt_file_path]);
  }

  const { error } = await supabase.from("reimbursement_claim_lines").delete().eq("id", lineId);
  revalidatePath(`/reimbursements/${claimId}`);
  return { error: error?.message ?? null };
}

export async function submitClaim(claimId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." };

  const resolved = await resolveInitialApprover(supabase, "reimbursement_claim", employee.company_id, employee.id, employee.userId);
  if ("error" in resolved) return resolved;

  const { error: updateError } = await supabase
    .from("reimbursement_claims")
    .update({ status: "submitted" })
    .eq("id", claimId);
  if (updateError) return { error: updateError.message };

  const { error: approvalError } = await supabase.rpc("create_initial_approval", {
    p_entity_type: "reimbursement_claim",
    p_entity_id: claimId,
  });
  if (approvalError) {
    // Without this, a failure here leaves the claim permanently stuck
    // "submitted" with no approvals row and no one able to act on it —
    // cancelling it makes the failure visible; its lines are untouched, so
    // resubmitting means creating a fresh claim with the same lines.
    await supabase.from("reimbursement_claims").update({ status: "cancelled" }).eq("id", claimId);
    return { error: `Could not route this claim for approval, so it was cancelled: ${approvalError.message}. Please try submitting again.` };
  }

  revalidatePath("/reimbursements");
  revalidatePath(`/reimbursements/${claimId}`);
  revalidatePath("/approvals");
  return { error: null };
}

export async function cancelClaim(claimId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("reimbursement_claims").update({ status: "cancelled" }).eq("id", claimId);
  revalidatePath("/reimbursements");
  return { error: error?.message ?? null };
}
