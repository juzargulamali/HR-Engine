"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { resolveInitialApprover } from "./approvals";
import { addNumberedClaimLine } from "@enginious-hr/domain";
import { discardHrUpload, readBackHrUpload, signHrUpload } from "@/lib/hr-upload-server";
import { sanitizeForStoragePath, UPLOAD_PAGE_OUT_OF_DATE, validateUploadMeta, type PrepareUploadResult } from "@/lib/upload-rules";

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

/** `<company>/<employee>/receipts/<submission>-<name>`: the receipts bucket's convention, with the one-time submission id as the retry key. */
const receiptPath = (companyId: string, employeeId: string, submission: string, name: string) => `${companyId}/${employeeId}/receipts/${submission}-${sanitizeForStoragePath(name)}`;

/** The signed-in employee and the claim, which must be their own and still a draft (the same rule the database enforces on the lines). */
async function ownDraftClaim(supabase: Awaited<ReturnType<typeof createClient>>, claimId: string) {
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." } as const;
  const { data: claim } = await supabase.from("reimbursement_claims").select("id, employee_id, status").eq("id", claimId).maybeSingle();
  if (!claim || claim.employee_id !== employee.id) return { error: "That claim was not found." } as const;
  if (claim.status !== "draft") return { error: "Receipts and lines can only be added while the claim is a draft." } as const;
  return { error: null, employee } as const;
}

/**
 * Step 1 of adding a claim line WITH a receipt (see addClaimLine). Authorises the employee for THIS claim from the database (their own, still a draft), checks the declared file
 * against the displayed limits (PDF, JPEG, PNG or WebP, up to 10 MB) and returns the one-time upload link for the private receipts bucket. Nothing is recorded.
 */
export async function prepareReceiptUpload(input: { claimId: string; submissionId: string; name: string; size: number; type: string }): Promise<PrepareUploadResult> {
  const claimId = z.string().uuid().safeParse(input.claimId);
  const submission = z.string().uuid().safeParse(input.submissionId);
  if (!claimId.success) return { error: "That claim was not found." };
  if (!submission.success) return { error: UPLOAD_PAGE_OUT_OF_DATE };
  const metaError = validateUploadMeta(input);
  if (metaError) return { error: metaError };
  const supabase = await createClient();
  const own = await ownDraftClaim(supabase, claimId.data);
  if (own.error) return { error: own.error };
  return signHrUpload("receipts", receiptPath(own.employee.company_id, own.employee.id, submission.data, input.name));
}

/**
 * The receipt does not pass through this action (a server action accepts 1 MB by default and a Vercel function 4.5 MB): the browser sends it straight to the private bucket
 * after prepareReceiptUpload, and this action reads it back (real size and leading bytes) before the line links it. The form posts only the declared `receiptName`,
 * `receiptType` and `receiptSize`. Retry-safe for a line with a receipt: the stored path comes from the form's one-time `submissionId`, so a repeat returns the line already
 * saved instead of numbering a second one. A receipt that fails a check, or a line that cannot be saved, deletes the file again.
 */
export async function addClaimLine(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addLineSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  const legacy = formData.get("receipt");
  if (legacy instanceof File && legacy.size > 0) return { error: UPLOAD_PAGE_OUT_OF_DATE };

  const supabase = await createClient();
  const own = await ownDraftClaim(supabase, d.claimId);
  if (own.error) return { error: own.error };
  const employee = own.employee;

  let receiptFilePath: string | null = null;
  const receiptName = String(formData.get("receiptName") ?? "");
  if (receiptName) {
    const declared = { name: receiptName, type: String(formData.get("receiptType") ?? ""), size: Number(formData.get("receiptSize") ?? 0) };
    const validationError = validateUploadMeta(declared);
    if (validationError) return { error: validationError };
    const submission = z.string().uuid().safeParse(String(formData.get("submissionId") ?? ""));
    if (!submission.success) return { error: UPLOAD_PAGE_OUT_OF_DATE };
    receiptFilePath = receiptPath(employee.company_id, employee.id, submission.data, receiptName);

    // A repeat of a submission that was already saved is a success that adds nothing.
    const { data: again } = await supabase.from("reimbursement_claim_lines").select("id").eq("claim_id", d.claimId).eq("receipt_file_path", receiptFilePath).maybeSingle();
    if (again) return { error: null };
    const checked = await readBackHrUpload("receipts", receiptFilePath, declared);
    if (checked.error) return { error: checked.error };
  }

  // Next number = highest existing + 1, retried when a simultaneous add takes it (unique (claim_id, line_no)).
  const result = await addNumberedClaimLine({
    async highestLineNo() {
      const { data, error } = await supabase
        .from("reimbursement_claim_lines")
        .select("line_no")
        .eq("claim_id", d.claimId)
        .order("line_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { value: data?.line_no ?? null, error: error ? "Could not read this claim's lines." : null };
    },
    async insertLine(lineNo) {
      const { error } = await supabase.from("reimbursement_claim_lines").insert({
        claim_id: d.claimId,
        line_no: lineNo,
        expense_date: d.expenseDate,
        category: d.category,
        amount: d.amount,
        description: d.description || null,
        receipt_file_path: receiptFilePath,
      });
      return { error: error ? { code: error.code, message: error.message } : null };
    },
  });
  if (!result.ok) {
    if (receiptFilePath) {
      // A simultaneous retry may have saved the line a moment earlier: then the receipt is in use and stays.
      const { data: raced } = await supabase.from("reimbursement_claim_lines").select("id").eq("claim_id", d.claimId).eq("receipt_file_path", receiptFilePath).maybeSingle();
      if (raced) return { error: null };
      // Without this, a failed line insert leaves the receipt orphaned in storage with nothing ever pointing at it.
      await discardHrUpload("receipts", receiptFilePath);
    }
    return { error: result.reason === "error" ? `Could not add the line: ${result.message}` : result.message };
  }

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

/**
 * RLS (reimbursement_delete_draft) only permits this while the claim is
 * still a draft — once submitted, "Cancel claim" above is the only way
 * out, same as leave_requests never getting a delete option either.
 * reimbursement_claim_lines cascades on delete, but their receipt files in
 * Storage don't — remove those first or they're orphaned.
 */
export async function deleteDraftClaim(claimId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: lines } = await supabase.from("reimbursement_claim_lines").select("receipt_file_path").eq("claim_id", claimId);
  const receiptPaths = (lines ?? []).map((l) => l.receipt_file_path).filter((p): p is string => Boolean(p));
  if (receiptPaths.length > 0) {
    await supabase.storage.from("receipts").remove(receiptPaths);
  }

  const { error } = await supabase.from("reimbursement_claims").delete().eq("id", claimId);
  revalidatePath("/reimbursements");
  return { error: error?.message ?? null };
}
