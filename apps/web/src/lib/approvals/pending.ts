import type { RoleGrant } from "@enginious-hr/domain";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * A QUEUE approval step (approver_id null: the legacy role_queue:% mechanism and the newer queue_roles one, both Recovery Leave) belongs to
 * the viewer only when they hold one of its deciding roles in the beneficiary's own company, and never when the request is their own.
 * Mirrors has_role() / decide_leave_approval()'s authorisation. One function, used by the Approvals page and by every count of
 * "waiting on me", so the two can never disagree.
 */
export function isQueueDecisionEligible({
  roles,
  beneficiaryEmployeeId,
  beneficiaryCompanyId,
  viewerEmployeeId,
  grants,
}: {
  /** The deciding roles of the step: its own queue_roles, or the legacy role named on the workflow step. */
  roles: readonly string[];
  beneficiaryEmployeeId: string;
  beneficiaryCompanyId: string | null | undefined;
  viewerEmployeeId: string | null;
  grants: readonly Pick<RoleGrant, "role" | "companyId">[];
}): boolean {
  if (beneficiaryEmployeeId === viewerEmployeeId) return false;
  if (!beneficiaryCompanyId) return false;
  return roles.some((role) => grants.some((g) => g.role === role && (g.companyId === null || g.companyId === beneficiaryCompanyId)));
}

/**
 * How many approvals wait on this person's own decision: the steps routed to them by name, plus the Recovery Leave queue steps they may
 * decide. Throws when any read fails, so the caller shows "could not load" and never a false zero.
 */
export async function loadMyPendingApprovalCount(
  supabase: Supabase,
  viewer: { userId: string; employeeId: string | null; grants: readonly Pick<RoleGrant, "role" | "companyId">[] },
): Promise<number> {
  const [direct, queue] = await Promise.all([
    supabase.from("approvals").select("id", { count: "exact", head: true }).eq("approver_id", viewer.userId).eq("decision", "pending"),
    supabase.from("approvals").select("entity_id, workflow_id, step_order, queue_roles").eq("decision", "pending").is("approver_id", null).eq("entity_type", "recovery_credit"),
  ]);
  if (direct.error) throw direct.error;
  if (queue.error) throw queue.error;
  const queued = queue.data ?? [];
  if (queued.length === 0) return direct.count ?? 0;

  const legacy = queued.filter((a) => a.queue_roles === null && a.workflow_id !== null);
  const [requests, steps] = await Promise.all([
    supabase.from("recovery_credit_requests").select("id, employee_id").in("id", queued.map((a) => a.entity_id)),
    legacy.length > 0
      ? supabase.from("approval_workflow_steps").select("workflow_id, step_order, approver_type").in("workflow_id", legacy.map((a) => a.workflow_id!))
      : Promise.resolve({ data: [] as { workflow_id: string; step_order: number; approver_type: string }[], error: null }),
  ]);
  if (requests.error) throw requests.error;
  if (steps.error) throw steps.error;
  const employeeIds = [...new Set((requests.data ?? []).map((r) => r.employee_id))];
  const employees = employeeIds.length > 0 ? await supabase.from("employees").select("id, company_id").in("id", employeeIds) : { data: [] as { id: string; company_id: string }[], error: null };
  if (employees.error) throw employees.error;

  const requestById = new Map((requests.data ?? []).map((r) => [r.id, r]));
  const companyById = new Map((employees.data ?? []).map((e) => [e.id, e.company_id]));
  const legacyRole = new Map((steps.data ?? []).filter((s) => s.approver_type.startsWith("role_queue:")).map((s) => [`${s.workflow_id}:${s.step_order}`, s.approver_type.replace("role_queue:", "")]));
  const eligible = queued.filter((a) => {
    const request = requestById.get(a.entity_id);
    if (!request) return false;
    const legacyName = legacyRole.get(`${a.workflow_id}:${a.step_order}`);
    return isQueueDecisionEligible({
      roles: a.queue_roles ?? (legacyName ? [legacyName] : []),
      beneficiaryEmployeeId: request.employee_id,
      beneficiaryCompanyId: companyById.get(request.employee_id),
      viewerEmployeeId: viewer.employeeId,
      grants: viewer.grants,
    });
  });
  return (direct.count ?? 0) + eligible.length;
}
