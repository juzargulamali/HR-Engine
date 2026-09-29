"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "./companies";
import { createClient } from "@/lib/supabase/server";

const createProjectSchema = z.object({
  companyId: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  clientName: z.string().optional(),
  managerId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * projects_write (HR Admin only, company-scoped) is the real enforcement —
 * a plain RLS-checked insert, same pattern as createCompany().
 */
export async function createProject(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      company_id: d.companyId,
      code: d.code,
      name: d.name,
      client_name: d.clientName || null,
      manager_id: d.managerId || null,
    })
    .select("id")
    .single();

  if (error || !project) {
    return { error: error?.message ?? "Could not create project." };
  }

  redirect(`/projects/${project.id}`);
}

const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  clientName: z.string().optional(),
  managerId: z.string().uuid().optional().or(z.literal("")),
  isBillable: z.enum(["true", "false"]).default("true"),
  isActive: z.enum(["true", "false"]).default("true"),
});

/**
 * Recovery Leave step 1's assigned approver, once that routing cuts over
 * (schema.sql's resolve_approver('project_manager', ...)) — reassigning
 * manager_id here takes effect for any NEW recovery_credit request created
 * after this save; it never touches an already-pending approval (approver_id
 * is captured on that row at creation time and never recomputed).
 */
export async function updateProject(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      name: d.name,
      client_name: d.clientName || null,
      manager_id: d.managerId || null,
      is_billable: d.isBillable === "true",
      is_active: d.isActive === "true",
    })
    .eq("id", d.projectId);

  if (error) return { error: error.message };

  revalidatePath(`/projects/${d.projectId}`);
  revalidatePath("/projects");
  return { error: null };
}

const addProjectAllocationSchema = z.object({
  projectId: z.string().uuid(),
  employeeId: z.string().uuid(),
  allocationPercent: z.coerce.number().min(0).max(100),
  startDate: z.string().min(1),
  endDate: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
});

/**
 * Which project resolve_approver('project_manager', ...) considers "the"
 * project for a given employee (see schema.sql) — an employee needs an
 * active allocation before Recovery Leave step 1 can ever resolve for
 * them. project_allocations_write (HR Admin, scoped to the EMPLOYEE's own
 * company) is the real enforcement.
 */
export async function addProjectAllocation(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addProjectAllocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("project_allocations").insert({
    project_id: d.projectId,
    employee_id: d.employeeId,
    allocation_percent: d.allocationPercent,
    start_date: d.startDate,
    end_date: d.endDate || null,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${d.projectId}`);
  return { error: null };
}

/** Ends an allocation as of today rather than deleting it — keeps the
 * historical record (which project this employee was on, and when) intact,
 * same "close, don't delete" convention as employment_contracts. */
export async function endProjectAllocation(allocationId: string, projectId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_allocations")
    .update({ end_date: new Date().toISOString().slice(0, 10) })
    .eq("id", allocationId);

  revalidatePath(`/projects/${projectId}`);
  return { error: error?.message ?? null };
}
