"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { resolveInitialApprover } from "./approvals";

const createRunSchema = z.object({
  companyId: z.string().uuid(),
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2020).max(2100),
});

export async function createPayrollRun(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createRunSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("payroll_export_runs")
    .insert({ company_id: d.companyId, period_month: d.periodMonth, period_year: d.periodYear, generated_by: user.id })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the export run." };

  const { error: linesError } = await supabase.rpc("generate_payroll_export_lines", { p_run_id: data.id });
  if (linesError) return { error: `Run created, but generating lines failed: ${linesError.message}` };

  revalidatePath("/payroll");
  redirect(`/payroll/${data.id}`);
}

export async function regenerateLines(runId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_payroll_export_lines", { p_run_id: runId });
  revalidatePath(`/payroll/${runId}`);
  return { error: error?.message ?? null };
}

export async function submitPayrollRun(runId: string, companyId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const resolved = await resolveInitialApprover(supabase, "payroll_export_run", companyId, "", user.id); // employee_id unused for payroll's role-based steps
  if ("error" in resolved) return resolved;

  const { error: updateError } = await supabase.from("payroll_export_runs").update({ status: "submitted" }).eq("id", runId);
  if (updateError) return { error: updateError.message };

  const { error: approvalError } = await supabase.rpc("create_initial_approval", {
    p_entity_type: "payroll_export_run",
    p_entity_id: runId,
  });
  if (approvalError) {
    // Without this, a failure here leaves the run permanently stuck
    // "submitted" with no approvals row and no one able to act on it.
    // Unlike leave/reimbursement/timesheet, guard_payroll_run_client_update()
    // allows a direct client transition back to 'draft' — reverting there
    // (rather than 'cancelled') means Finance can just hit "Submit for
    // approval" again from the run's own page instead of starting over.
    await supabase.from("payroll_export_runs").update({ status: "draft" }).eq("id", runId);
    return { error: `Could not route this run for approval, so it was reverted to draft: ${approvalError.message}. Please try submitting again.` };
  }

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${runId}`);
  revalidatePath("/approvals");
  return { error: null };
}

export async function markPayrollSent(runId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("payroll_export_runs").update({ sent_at: new Date().toISOString() }).eq("id", runId);
  revalidatePath(`/payroll/${runId}`);
  return { error: error?.message ?? null };
}

/**
 * RLS only permits this while the run is still a draft — deleting it
 * cascades to its lines, releasing any reimbursement/leave-encashment rows
 * it had claimed back for a future run's generation (the same release a
 * rejection performs in decide_leave_approval()).
 */
export async function deletePayrollRun(runId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("payroll_export_runs").delete().eq("id", runId);
  if (error) return { error: error.message };
  revalidatePath("/payroll");
  redirect("/payroll");
}
