import type { RoleGrant } from "../types";
import { isHrAdmin } from "./core";

/**
 * Mirrors performance_cycles_write. Reading cycles (performance_cycles_select)
 * is open to any signed-in user — there's no "canView" to mirror for that.
 */
export function canManagePerformanceCycles(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/**
 * Mirrors goals_select. An employee's own full CRUD on their own goals
 * (goals_write_self) is pure identity — `employee_id = current_employee_id()`,
 * no role involved — so it isn't mirrored here; check `isSelf` directly,
 * same as the note in employees.ts.
 */
export function canViewGoals(
  grants: readonly RoleGrant[],
  companyId: string,
  { isSelf, isManager }: { isSelf: boolean; isManager: boolean },
): boolean {
  return isSelf || isManager || isHrAdmin(grants, { companyId });
}

/** Mirrors goals_write_manager (update only) — setting manager_rating on a report's goal. */
export function canRateGoal(grants: readonly RoleGrant[], companyId: string, isManager: boolean): boolean {
  return isManager || isHrAdmin(grants, { companyId });
}

/**
 * Mirrors the role-conditional half of appraisals_insert — starting an
 * appraisal for someone. `appraiser_id = auth.uid()` is identity, set by
 * the action itself, not something a grants-only check can express.
 */
export function canAppraiseEmployee(grants: readonly RoleGrant[], companyId: string, isManager: boolean): boolean {
  return isManager || isHrAdmin(grants, { companyId });
}

/** Mirrors appraisals_update_hr — HR Admin can edit/calibrate any appraisal regardless of status. */
export function canManageAnyAppraisal(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}
