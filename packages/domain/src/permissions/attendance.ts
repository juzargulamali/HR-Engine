import type { RoleGrant } from "../types";
import { isHrAdmin } from "./core";

/** Mirrors attendance_select: self, manager, HR Admin. */
export function canViewAttendance(
  grants: readonly RoleGrant[],
  companyId: string,
  { isSelf, isManager }: { isSelf: boolean; isManager: boolean },
): boolean {
  return isSelf || isManager || isHrAdmin(grants, { companyId });
}

/** Mirrors attendance_write — HR Admin alone records/corrects attendance (manual entry or import). */
export function canManageAttendance(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}
