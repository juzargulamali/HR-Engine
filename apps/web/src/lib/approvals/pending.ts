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
 * How many approvals wait on this person's own decision: the steps routed to them by name, plus the Recovery Leave queue steps they decide now. The queue steps come
 * from the database's own list of what this person may decide (recovery_decider_inbox), because the tables hide some of them from a CEO / CTO (an HR Admin's request on
 * the shared queue) and the badge must agree with the Approvals page. Throws when any read fails, so the caller shows "could not load" and never a false zero.
 */
export async function loadMyPendingApprovalCount(supabase: Supabase, viewer: { userId: string }): Promise<number> {
  const [direct, inbox] = await Promise.all([
    supabase.from("approvals").select("id", { count: "exact", head: true }).eq("approver_id", viewer.userId).eq("decision", "pending"),
    supabase.rpc("recovery_decider_inbox"),
  ]);
  if (direct.error) throw direct.error;
  if (inbox.error) throw inbox.error;
  // A step assigned to the person by name is already in the first count; add only the queue steps (no assigned person).
  const queued = new Set((inbox.data ?? []).filter((r) => r.approver_id === null).map((r) => r.approval_id));
  return (direct.count ?? 0) + queued.size;
}
