"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { computeLeaveDays, resolvePolicyVersionAsOf } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { resolveInitialApprover } from "./approvals";
import { notifyLeaveSubmitted } from "@/lib/email/leave-notifications";

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
    .select("id, company_id, country_code, manager_id, first_name, last_name")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!employee) return { error: "No employee record is linked to your account." };

  const { data: country } = await supabase.from("countries").select("week_start_day").eq("code", employee.country_code).single();
  if (!country) return { error: "Could not resolve your country's working week." };

  // No uncontrolled leave-type strings: the form no longer offers a
  // free-text fallback, but this is the authoritative check regardless of
  // what the request actually sends. If no leave_rules policy is in effect
  // today for this employee's country, submission is blocked outright with
  // a clear HR-configuration message rather than silently accepting
  // whatever leave type code was posted.
  const today = new Date().toISOString().slice(0, 10);
  const { data: policyVersions } = await supabase
    .from("policy_versions")
    .select("id, status, effective_from, effective_to, version_no")
    .eq("country_code", employee.country_code)
    .eq("policy_type", "leave_rules");
  const activePolicy = resolvePolicyVersionAsOf(
    (policyVersions ?? []).map((v) => ({
      id: v.id,
      effectiveFrom: v.effective_from,
      effectiveTo: v.effective_to,
      versionNo: v.version_no,
      status: v.status,
    })),
    today,
  );
  if (!activePolicy) {
    return { error: "HR hasn't activated a leave policy for your country yet — leave requests can't be submitted until one is active." };
  }

  const { data: leaveTypeRows } = await supabase
    .from("policy_leave_types")
    .select("leave_type_code")
    .eq("policy_version_id", activePolicy.id);
  const validLeaveTypeCodes = new Set((leaveTypeRows ?? []).map((r) => r.leave_type_code));
  if (!validLeaveTypeCodes.has(d.leaveTypeCode)) {
    return { error: "That isn't a valid leave type under your country's active leave policy." };
  }

  // Two overlapping requests for the same employee is a data-integrity
  // problem regardless of business judgment (unlike balance, where the
  // system already lets an approver knowingly approve past a warning) —
  // block it outright rather than letting it through for the approver to
  // notice.
  const { data: overlapping } = await supabase
    .from("leave_requests")
    .select("id")
    .eq("employee_id", employee.id)
    .in("status", ["submitted", "pending_approval", "approved"])
    .lte("start_date", d.endDate)
    .gte("end_date", d.startDate)
    .limit(1);
  if (overlapping && overlapping.length > 0) {
    return { error: "You already have a leave request that overlaps these dates." };
  }

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

  const resolved = await resolveInitialApprover(supabase, "leave_request", employee.company_id, employee.id, user.id);
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

  const { error: approvalError } = await supabase.rpc("create_initial_approval", {
    p_entity_type: "leave_request",
    p_entity_id: request.id,
  });
  if (approvalError) {
    // Without this, a failure here (network blip, the resolved approver's
    // role getting revoked in the split second since resolveInitialApprover
    // checked) leaves the request permanently stuck "submitted" with no
    // approvals row and no one able to act on it — cancelling it here means
    // the failure is visible and the employee can just resubmit.
    await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", request.id);
    return { error: `Could not route this request for approval, so it was cancelled: ${approvalError.message}. Please try submitting again.` };
  }

  await notifyLeaveSubmitted(supabase, {
    employeeUserId: user.id,
    employeeName: `${employee.first_name} ${employee.last_name}`,
    managerEmployeeId: employee.manager_id,
    companyId: employee.company_id,
    leaveTypeCode: d.leaveTypeCode,
    startDate: d.startDate,
    endDate: d.endDate,
    totalDays,
  });

  revalidatePath("/leave");
  revalidatePath("/approvals");
  redirect("/leave");
}

export async function cancelLeaveRequest(requestId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  // A plain table update can't touch approvals (no UPDATE grant for
  // authenticated at all) — cancel_leave_request() closes out any
  // still-pending approval step atomically with the status change, so a
  // withdrawn request stops showing up in the approver's queue and count.
  const { error } = await supabase.rpc("cancel_leave_request", { p_request_id: requestId });
  revalidatePath("/leave");
  revalidatePath("/approvals");
  return { error: error?.message ?? null };
}

