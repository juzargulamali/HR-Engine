"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

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
  return employee;
}

const createGoalSchema = z.object({
  cycleId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  weightPercent: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).max(100).optional()),
  targetDate: z.string().optional(),
});

/** goals_write_self is pure identity (employee_id = current_employee_id()) — a goal is always created for yourself. */
export async function createGoal(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createGoalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const employee = await currentEmployee(supabase);
  if (!employee) return { error: "No employee record is linked to your account." };

  const { error } = await supabase.from("goals").insert({
    employee_id: employee.id,
    cycle_id: d.cycleId,
    title: d.title,
    description: d.description || null,
    weight_percent: d.weightPercent ?? null,
    target_date: d.targetDate || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/performance");
  return { error: null };
}

const updateGoalSchema = z.object({
  goalId: z.string().uuid(),
  status: z.enum(["in_progress", "achieved", "missed"]),
  selfRating: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(1).max(5).optional()),
});

/** Lets the owner update their own goal's status and self-assessment — still their row, still goals_write_self. */
export async function updateGoal(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateGoalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({ status: d.status, self_rating: d.selfRating ?? null })
    .eq("id", d.goalId);
  if (error) return { error: error.message };

  revalidatePath("/performance");
  return { error: null };
}

export async function deleteGoal(goalId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("goals").delete().eq("id", goalId);
  revalidatePath("/performance");
  revalidatePath("/performance/team");
  return { error: error?.message ?? null };
}

const rateGoalSchema = z.object({
  goalId: z.string().uuid(),
  managerRating: z.coerce.number().min(1).max(5),
});

/** Mirrors goals_write_manager — a manager or HR Admin setting the manager_rating on a report's goal. */
export async function rateGoal(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = rateGoalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("goals").update({ manager_rating: d.managerRating }).eq("id", d.goalId);
  if (error) return { error: error.message };

  revalidatePath("/performance/team");
  return { error: null };
}

const createCycleSchema = z
  .object({
    companyId: z.string().uuid(),
    name: z.string().min(1),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
  })
  .refine((d) => d.periodEnd >= d.periodStart, { message: "Period end must be on or after period start", path: ["periodEnd"] });

/** Mirrors performance_cycles_write — HR Admin only. */
export async function createPerformanceCycle(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createCycleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("performance_cycles")
    .insert({ company_id: d.companyId, name: d.name, period_start: d.periodStart, period_end: d.periodEnd });
  if (error) return { error: error.message };

  revalidatePath("/performance/cycles");
  return { error: null };
}

export async function closePerformanceCycle(cycleId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("performance_cycles").update({ status: "closed" }).eq("id", cycleId);
  revalidatePath("/performance/cycles");
  return { error: error?.message ?? null };
}

const createAppraisalSchema = z.object({
  employeeId: z.string().uuid(),
  cycleId: z.string().uuid(),
});

/** Mirrors appraisals_insert — appraiser_id is always the caller, checked by RLS against is_manager_of()/HR Admin. */
export async function createAppraisal(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createAppraisalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("appraisals")
    .insert({ employee_id: d.employeeId, cycle_id: d.cycleId, appraiser_id: user.id })
    .select("id")
    .single();
  if (error || !data) {
    return {
      error: error?.message.includes("permission denied")
        ? "You can only start an appraisal for your own reports."
        : (error?.message ?? "Could not start the appraisal."),
    };
  }

  revalidatePath("/performance/team");
  redirect(`/performance/appraisals/${data.id}`);
}

const ratingField = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(1).max(5).optional());

const updateAppraisalSchema = z.object({
  appraisalId: z.string().uuid(),
  qualityOfWorkRating: ratingField,
  productivityRating: ratingField,
  initiativeRating: ratingField,
  teamworkRating: ratingField,
  punctualityRating: ratingField,
  strengths: z.string().optional(),
  areasForImprovement: z.string().optional(),
});

/**
 * Content edits — allowed by RLS for the appraiser while still draft, or HR
 * Admin at any status (calibration). overall_rating is intentionally left
 * out of this update payload: a DB trigger (compute_appraisal_overall_rating)
 * now owns it exclusively, recomputing it from the five competency ratings
 * on every write — writing it from here would just be overwritten anyway.
 */
export async function updateAppraisal(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateAppraisalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("appraisals")
    .update({
      quality_of_work_rating: d.qualityOfWorkRating ?? null,
      productivity_rating: d.productivityRating ?? null,
      initiative_rating: d.initiativeRating ?? null,
      teamwork_rating: d.teamworkRating ?? null,
      punctuality_rating: d.punctualityRating ?? null,
      strengths: d.strengths || null,
      areas_for_improvement: d.areasForImprovement || null,
    })
    .eq("id", d.appraisalId);
  if (error) return { error: error.message };

  revalidatePath(`/performance/appraisals/${d.appraisalId}`);
  return { error: null };
}

export async function submitAppraisal(appraisalId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("appraisals")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", appraisalId);
  revalidatePath(`/performance/appraisals/${appraisalId}`);
  revalidatePath("/performance/team");
  return { error: error?.message ?? null };
}

/** appraisals_delete only allows this while status = 'draft' — a submitted/acknowledged appraisal is real history and can't be removed. */
export async function deleteAppraisal(appraisalId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("appraisals").delete().eq("id", appraisalId);
  revalidatePath("/performance");
  revalidatePath("/performance/team");
  return { error: error?.message ?? null };
}

/** appraisals_update_acknowledge + the guard_appraisal_acknowledge trigger both enforce this is the only edit an employee can make. */
export async function acknowledgeAppraisal(appraisalId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("appraisals")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", appraisalId);
  revalidatePath(`/performance/appraisals/${appraisalId}`);
  revalidatePath("/performance");
  return { error: error?.message ?? null };
}
