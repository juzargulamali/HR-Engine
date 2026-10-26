"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCESS_MODULES, canEditJobDetails, capabilitiesOf, normaliseCapabilities, type AccessModule } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { friendlyBudgetError } from "@/lib/budget/errors";
import { friendlyCrmError } from "@/lib/crm/errors";
import { friendlyInventoryError } from "@/lib/inventory/action-utils";
import { friendlyProjectError } from "@/lib/projects/errors";
import { GRANT_TABLE } from "@/lib/people-access/data";
import type { ActionState } from "./companies";

/**
 * People & Access server actions. Each is a thin wrapper over the database function the old module screens already called
 * (crm_/proj_/inv_/pbx_grant_access and revoke_access, inv_set_operator_locations): the function, not this file, decides who may grant what,
 * so a forged request gets the same refusal a normal one would. Nothing here widens anyone's authority. What this layer adds is protective only:
 * a check that the person's access has not changed since the page was loaded (the database functions REPLACE the capability set, so a stale form
 * could silently drop a right that was given in the meantime), and validation of what was posted.
 */

const uuid = z.string().uuid();
const moduleSchema = z.enum(ACCESS_MODULES);

const friendly: Record<AccessModule, (m: string) => string> = {
  sales: friendlyCrmError,
  projects: friendlyProjectError,
  inventory: friendlyInventoryError,
  budget: (m) => friendlyBudgetError(m),
};

const GRANT_RPC = { sales: "crm_grant_access", projects: "proj_grant_access", inventory: "inv_grant_access", budget: "pbx_grant_access" } as const;
const REVOKE_RPC = { sales: "crm_revoke_access", projects: "proj_revoke_access", inventory: "inv_revoke_access", budget: "pbx_revoke_access" } as const;

function refresh() {
  revalidatePath("/people-access");
  // Menus are built from the signed-in person's own grants; they may have just changed.
  revalidatePath("/", "layout");
}

async function currentCapabilities(supabase: Awaited<ReturnType<typeof createClient>>, module: AccessModule, userId: string, companyId: string): Promise<string[] | null> {
  const { data } = await supabase.from(GRANT_TABLE[module]).select("capabilities").eq("user_id", userId).eq("company_id", companyId).is("revoked_at", null).maybeSingle();
  return data ? normaliseCapabilities(module, (data as { capabilities: string[] }).capabilities) : null;
}

const STALE = "This person's access was changed by someone else since you opened this page. Reload the page to see what they have now, then make your change again.";

const applySchema = z.object({
  module: moduleSchema,
  userId: uuid,
  companyId: uuid,
  note: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(200).optional()),
  // What the person held when the page was loaded (comma separated; empty = no access, "-" = access with no extra rights).
  before: z.string().optional(),
});

export async function applyModuleAccess(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const p = applySchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Choose a person, a module and a company." };
  const { module, userId, companyId } = p.data;
  const posted = [...new Set(fd.getAll("capabilities").map(String))];
  const vocab = new Set(capabilitiesOf(module));
  if (posted.some((c) => !vocab.has(c))) return { error: "One of the rights is not one of this module's rights. Reload the page and try again." };
  const caps = normaliseCapabilities(module, posted);
  // Budget has no "basic access": a grant with nothing ticked would give the person nothing.
  if (module === "budget" && caps.length === 0) return { error: "Choose at least one right. To remove their budget access, use Remove access." };

  const supabase = await createClient();
  if (p.data.before !== undefined) {
    const now = await currentCapabilities(supabase, module, userId, companyId);
    const was = p.data.before === "" ? null : p.data.before === "-" ? [] : normaliseCapabilities(module, p.data.before.split(","));
    const same = now === null ? was === null : was !== null && now.join(",") === was.join(",");
    if (!same) return { error: STALE };
  }

  const args = { p_user_id: userId, p_company_id: companyId, p_capabilities: caps, p_note: p.data.note ?? null };
  const { error } = await supabase.rpc(GRANT_RPC[module], args);
  if (error) return { error: friendly[module](error.message) };

  // A warehouse operator works at assigned locations. Sent only when the form carried the location list.
  if (module === "inventory" && fd.get("withLocations") === "1") {
    const ids = fd.getAll("locationIds").map(String).filter((x) => uuid.safeParse(x).success);
    const { error: locError } = await supabase.rpc("inv_set_operator_locations", { p_company_id: companyId, p_user_id: userId, p_location_ids: ids });
    refresh();
    if (locError) return { error: `Access was saved, but the locations were not: ${friendlyInventoryError(locError.message)}` };
    return { error: null };
  }
  refresh();
  return { error: null };
}

export async function revokeModuleAccess(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const p = z.object({ module: moduleSchema, userId: uuid, companyId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "Missing details. Reload the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(REVOKE_RPC[p.data.module], { p_user_id: p.data.userId, p_company_id: p.data.companyId });
  if (error) return { error: friendly[p.data.module](error.message) };
  refresh();
  return { error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Job title, department and reporting line: the existing employee record, the existing permission (HR Admin of the company)
// ---------------------------------------------------------------------------------------------------------------

const jobSchema = z.object({
  employeeId: uuid,
  jobTitle: z.string().trim().max(120, "Keep the job title under 120 characters.").optional(),
  departmentId: z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional()),
  managerId: z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional()),
});

/**
 * Writes only job_title, department_id and manager_id of an existing employee row, under employees_update_hr (HR Admin of the company) and the audit
 * trigger the table already has. It deliberately does not reuse updateEmployee(): that action also rewrites status, date of birth and other
 * fields from one form, so posting it a partial form would clear them. The checks below are the ones the employee form's own pickers imply (a manager
 * of the same company, not the person themselves) plus a guard against a reporting circle.
 */
export async function updateJobDetails(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const p = jobSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Check the form and try again." };
  const d = p.data;
  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  const supabase = await createClient();

  const { data: employee } = await supabase.from("employees").select("id, company_id, job_title, department_id, manager_id").eq("id", d.employeeId).is("deleted_at", null).maybeSingle();
  if (!employee) return { error: "You cannot see this employee record." };
  if (!canEditJobDetails(session.grants, employee.company_id)) return { error: "Only an HR Admin of this employee's company can change job details." };

  if (d.departmentId) {
    const { data: dep } = await supabase.from("departments").select("id").eq("id", d.departmentId).eq("company_id", employee.company_id).is("deleted_at", null).maybeSingle();
    if (!dep) return { error: "Choose a department of this employee's company." };
  }
  if (d.managerId) {
    if (d.managerId === employee.id) return { error: "A person cannot be their own manager." };
    const { data: manager } = await supabase.from("employees").select("id, company_id, manager_id").eq("id", d.managerId).is("deleted_at", null).maybeSingle();
    if (!manager || manager.company_id !== employee.company_id) return { error: "Choose a manager from the same company." };
    // Walk up the proposed manager's own line: if it comes back to this employee the change would make a circle.
    let cursor: string | null = manager.manager_id;
    for (let i = 0; cursor && i < 50; i++) {
      if (cursor === employee.id) return { error: "That would make a reporting circle: the chosen manager already reports, directly or not, to this person." };
      const { data: up } = await supabase.from("employees").select("manager_id").eq("id", cursor).maybeSingle();
      cursor = up?.manager_id ?? null;
    }
  }

  const patch = { job_title: d.jobTitle || null, department_id: d.departmentId ?? null, manager_id: d.managerId ?? null };
  if (patch.job_title === employee.job_title && patch.department_id === employee.department_id && patch.manager_id === employee.manager_id) return { error: null };
  const { data: updated, error } = await supabase.from("employees").update(patch).eq("id", employee.id).select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "The change was not saved: you are not allowed to edit this employee record." };
  revalidatePath("/people-access");
  revalidatePath(`/employees/${employee.id}`);
  return { error: null };
}
