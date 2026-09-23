import type { RoleGrant } from "../types";
import { hasRole, isCLevel, isFinance, isHrAdmin, isSysAdmin } from "./core";

/**
 * These mirror the RLS policies in
 * supabase/migrations/20260924000000_phase1_contracts_compensation_identity.sql.
 * "Am I looking at my own record" isn't a role — it's an id comparison the
 * caller already has (session.employeeId === the record's employee_id), so
 * every function here takes it as an explicit `isSelf` flag rather than
 * trying to infer it from role grants, which is where the manager-chain
 * check (`is_manager_of`) and same-employee check genuinely can't be
 * mirrored client-side without a query — see types.ts's `RoleGrant` comment.
 */

export function canViewCompensation(grants: readonly RoleGrant[], companyId: string, isSelf: boolean): boolean {
  return isSelf || isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId });
}

export function canEditCompensation(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId });
}

export function canViewIdentityDocuments(grants: readonly RoleGrant[], companyId: string, isSelf: boolean): boolean {
  return isSelf || isHrAdmin(grants, { companyId });
}

export function canManageIdentityDocuments(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/**
 * Whether this viewer can see contract history at all. A Line Manager's
 * result set is further restricted to the current version only by the RLS
 * policy itself (`is_manager_of(employee_id) and is_current`) — that part
 * is a query-shape restriction, not a yes/no permission, so it isn't
 * something this boolean can express; don't use this alone to decide
 * whether to show "previous versions" in the UI for a manager viewer.
 */
export function canViewContracts(
  grants: readonly RoleGrant[],
  companyId: string,
  { isSelf, isManager }: { isSelf: boolean; isManager: boolean },
): boolean {
  return isSelf || isManager || isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId }) || isCLevel(grants, { companyId });
}

export function canManageContracts(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/** Mirrors employees_update_hr — restoring a soft-deleted employee is HR Admin's alone, not Sys Admin's. */
export function canDeleteOrRestoreEmployee(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/** Mirrors the employees_select bypass — who can even see that a deleted row exists. */
export function canViewDeletedEmployees(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId }) || isSysAdmin(grants);
}

/** Mirrors employees_write_hr (insert) and employees_update_hr (update) — both HR Admin only. */
export function canCreateEmployee(grants: readonly RoleGrant[], companyId: string): boolean {
  return hasRole(grants, "hr_admin", { companyId });
}

export function canEditEmployeeCore(grants: readonly RoleGrant[], companyId: string): boolean {
  return hasRole(grants, "hr_admin", { companyId });
}
