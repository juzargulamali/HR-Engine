import type { RoleGrant } from "../types";
import { isHrAdmin } from "./core";

/**
 * Mirrors the RLS policies in
 * supabase/migrations/20260926000000_phase3_leave_and_approvals.sql.
 * Whether a specific person can decide a specific approval isn't something
 * role grants alone can answer (it depends on who the workflow resolved as
 * the approver for that row) — that check is `approver_id = auth.uid()`,
 * enforced by decide_leave_approval() itself, not mirrored here.
 */

export function canManageDeductionPriority(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

export function canManageApprovalWorkflows(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/** Mirrors leave_requests_update_hr — corrections/cancellations by HR, distinct from the requester's own cancel. */
export function canManageAnyLeaveRequest(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}
