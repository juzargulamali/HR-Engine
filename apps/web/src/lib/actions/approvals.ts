"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type ApprovableEntityType = "leave_request" | "reimbursement_claim" | "timesheet" | "generated_letter" | "payroll_export_run";

/**
 * Resolves an approval workflow's own step 1 approver (the same resolver
 * decide_leave_approval() uses to advance later steps) BEFORE creating
 * anything, so a request/claim/letter/run never lands with no one able to
 * decide it — e.g. an employee with no manager assigned yet. Shared across
 * every entity type this engine handles (docs/09-extending-the-system.md).
 *
 * payroll_export_run has no single employee (it's company-wide), so its
 * role:finance/role:ceo steps resolve through resolve_approver_for_company()
 * instead of the employee-centric resolve_approver() every other entity
 * type uses — same split decide_leave_approval() itself makes.
 */
export async function resolveInitialApprover(
  supabase: SupabaseClient,
  entityType: ApprovableEntityType,
  companyId: string,
  employeeId: string,
): Promise<{ workflowId: string; approverId: string } | { error: string }> {
  const { data: workflows } = await supabase
    .from("approval_workflows")
    .select("id")
    .eq("company_id", companyId)
    .eq("entity_type", entityType)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  const workflow = workflows?.[0];
  if (!workflow) return { error: "No approval workflow is configured for your company. Contact HR Admin." };

  const { data: step } = await supabase
    .from("approval_workflow_steps")
    .select("approver_type")
    .eq("workflow_id", workflow.id)
    .eq("step_order", 1)
    .single();
  if (!step) return { error: "This workflow has no first step configured. Contact HR Admin." };

  const { data: approverId } =
    entityType === "payroll_export_run"
      ? await supabase.rpc("resolve_approver_for_company", { p_approver_type: step.approver_type, p_company_id: companyId })
      : await supabase.rpc("resolve_approver", { p_approver_type: step.approver_type, p_employee_id: employeeId });
  if (!approverId) {
    return { error: "No approver could be resolved (e.g. no manager assigned, or no one holds the required role). Contact HR Admin." };
  }

  return { workflowId: workflow.id, approverId };
}

const decideSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comments: z.string().optional(),
});

/**
 * One Server Action for every approvable entity type (leave, reimbursement
 * claims, timesheets, and whatever's next) — decide_leave_approval() itself
 * is entity-generic (supabase/migrations/20260927000000_...sql), so this
 * doesn't need to know which kind of approval it's deciding.
 */
export async function decideApproval(input: { approvalId: string; decision: "approved" | "rejected"; comments?: string }) {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_leave_approval", {
    p_approval_id: parsed.data.approvalId,
    p_decision: parsed.data.decision,
    p_comments: parsed.data.comments || null,
  });

  revalidatePath("/approvals");
  revalidatePath("/leave");
  revalidatePath("/reimbursements");
  return { error: error?.message ?? null };
}
