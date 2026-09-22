"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { resolveInitialApprover } from "./approvals";

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

const createTimesheetSchema = z
  .object({
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
  })
  .refine((d) => d.periodEnd >= d.periodStart, { message: "Period end must be on or after period start", path: ["periodEnd"] });

export async function createDraftTimesheet(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createTimesheetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const supabase = await createClient();
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." };

  const { data, error } = await supabase
    .from("timesheets")
    .insert({ employee_id: employee.id, period_start: parsed.data.periodStart, period_end: parsed.data.periodEnd })
    .select("id")
    .single();
  if (error || !data) {
    return {
      error: error?.message.includes("duplicate key")
        ? "You already have a timesheet for that exact period."
        : (error?.message ?? "Could not create the timesheet."),
    };
  }

  revalidatePath("/timesheets");
  redirect(`/timesheets/${data.id}`);
}

const addEntrySchema = z.object({
  timesheetId: z.string().uuid(),
  workDate: z.string().min(1),
  projectId: z.string().uuid().optional().or(z.literal("")),
  taskDescription: z.string().optional(),
  hours: z.coerce.number().positive("Hours must be greater than zero").max(24),
  isBillable: z.enum(["true", "false"]).optional(),
});

export async function addTimesheetEntry(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addEntrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("timesheet_entries").insert({
    timesheet_id: d.timesheetId,
    work_date: d.workDate,
    project_id: d.projectId || null,
    task_description: d.taskDescription || null,
    hours: d.hours,
    is_billable: d.isBillable !== "false",
  });
  if (error) return { error: error.message };

  revalidatePath(`/timesheets/${d.timesheetId}`);
  return { error: null };
}

export async function deleteTimesheetEntry(entryId: string, timesheetId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("timesheet_entries").delete().eq("id", entryId);
  revalidatePath(`/timesheets/${timesheetId}`);
  return { error: error?.message ?? null };
}

export async function submitTimesheet(timesheetId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." };

  const { count } = await supabase
    .from("timesheet_entries")
    .select("id", { count: "exact", head: true })
    .eq("timesheet_id", timesheetId);
  if (!count) return { error: "Add at least one entry before submitting." };

  const resolved = await resolveInitialApprover(supabase, "timesheet", employee.company_id, employee.id, employee.userId);
  if ("error" in resolved) return resolved;

  const { error: updateError } = await supabase.from("timesheets").update({ status: "submitted" }).eq("id", timesheetId);
  if (updateError) return { error: updateError.message };

  const { error: approvalError } = await supabase.from("approvals").insert({
    entity_type: "timesheet",
    entity_id: timesheetId,
    workflow_id: resolved.workflowId,
    step_order: 1,
    approver_id: resolved.approverId,
    decision: "pending",
  });
  if (approvalError) return { error: approvalError.message };

  revalidatePath("/timesheets");
  revalidatePath(`/timesheets/${timesheetId}`);
  revalidatePath("/approvals");
  return { error: null };
}

export async function cancelTimesheet(timesheetId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("timesheets").update({ status: "cancelled" }).eq("id", timesheetId);
  revalidatePath("/timesheets");
  return { error: error?.message ?? null };
}
