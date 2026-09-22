"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { computeLeaveDays } from "@enginious-hr/domain";
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
  if (approvalError) return { error: approvalError.message };

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
  const { error } = await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", requestId);
  revalidatePath("/leave");
  return { error: error?.message ?? null };
}

