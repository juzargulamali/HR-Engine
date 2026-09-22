"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { computeLeaveDays } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

const submitLeaveRequestSchema = z
  .object({
    leaveTypeCode: z.string().min(1, "Pick a leave type"),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    halfDayStart: z.coerce.boolean().optional(),
    halfDayEnd: z.coerce.boolean().optional(),
    reason: z.string().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "End date must be on or after the start date", path: ["endDate"] });

/**
 * Resolves the leave-request workflow's own step 1 approver (the same
 * resolver decide_leave_approval() uses to advance later steps) BEFORE
 * creating anything, so a request never lands with no one able to decide
 * it — e.g. an employee with no manager assigned yet.
 */
async function resolveInitialApprover(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  employeeId: string,
): Promise<{ workflowId: string; approverId: string } | { error: string }> {
  const { data: workflows } = await supabase
    .from("approval_workflows")
    .select("id")
    .eq("company_id", companyId)
    .eq("entity_type", "leave_request")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  const workflow = workflows?.[0];
  if (!workflow) return { error: "No leave-approval workflow is configured for your company. Contact HR Admin." };

  const { data: step } = await supabase
    .from("approval_workflow_steps")
    .select("approver_type")
    .eq("workflow_id", workflow.id)
    .eq("step_order", 1)
    .single();
  if (!step) return { error: "This workflow has no first step configured. Contact HR Admin." };

  const { data: approverId } = await supabase.rpc("resolve_approver", {
    p_approver_type: step.approver_type,
    p_employee_id: employeeId,
  });
  if (!approverId) {
    return { error: "No approver could be resolved for your leave request (e.g. no manager assigned). Contact HR Admin." };
  }

  return { workflowId: workflow.id, approverId };
}

export async function submitLeaveRequest(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = submitLeaveRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: employee } = await supabase
    .from("employees")
    .select("id, company_id, country_code")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!employee) return { error: "No employee record is linked to your account." };

  const { data: country } = await supabase.from("countries").select("week_start_day").eq("code", employee.country_code).single();
  if (!country) return { error: "Could not resolve your country's working week." };

  const { data: holidayRows } = await supabase
    .from("public_holidays")
    .select("holiday_date")
    .eq("country_code", employee.country_code)
    .gte("holiday_date", d.startDate)
    .lte("holiday_date", d.endDate);

  const totalDays = computeLeaveDays({
    startDate: d.startDate,
    endDate: d.endDate,
    weekStartDay: country.week_start_day,
    holidays: (holidayRows ?? []).map((h) => h.holiday_date),
    halfDayStart: d.halfDayStart,
    halfDayEnd: d.halfDayEnd,
  });
  if (totalDays <= 0) {
    return { error: "That date range has no working days (weekends/holidays only)." };
  }

  const resolved = await resolveInitialApprover(supabase, employee.company_id, employee.id);
  if ("error" in resolved) return resolved;

  const { data: request, error: insertError } = await supabase
    .from("leave_requests")
    .insert({
      employee_id: employee.id,
      leave_type_code: d.leaveTypeCode,
      start_date: d.startDate,
      end_date: d.endDate,
      half_day_start: d.halfDayStart ?? false,
      half_day_end: d.halfDayEnd ?? false,
      total_days: totalDays,
      reason: d.reason || null,
    })
    .select("id")
    .single();
  if (insertError || !request) return { error: insertError?.message ?? "Could not submit the leave request." };

  const { error: approvalError } = await supabase.from("approvals").insert({
    entity_type: "leave_request",
    entity_id: request.id,
    workflow_id: resolved.workflowId,
    step_order: 1,
    approver_id: resolved.approverId,
    decision: "pending",
  });
  if (approvalError) return { error: approvalError.message };

  revalidatePath("/leave");
  revalidatePath("/approvals");
  redirect("/leave");
}

export async function cancelLeaveRequest(requestId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", requestId);
  revalidatePath("/leave");
  return { error: error?.message ?? null };
}

const decideSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  comments: z.string().optional(),
});

export async function decideLeaveApproval(input: { approvalId: string; decision: "approved" | "rejected"; comments?: string }) {
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
  return { error: error?.message ?? null };
}
