import type { RoleGrant } from "../types";
import { isFinance, isHrAdmin } from "./core";

/** Mirrors employee_documents_table_insert/_update in supabase/migrations/20260928000000_phase5_...sql. */
export function canManageEmployeeDocuments(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/** Mirrors employee_documents_table_select: the owner (self) or HR Admin — never a manager or Finance. */
export function canViewEmployeeDocuments(grants: readonly RoleGrant[], companyId: string, isSelf: boolean): boolean {
  return isSelf || isHrAdmin(grants, { companyId });
}

/** HR Admin and Finance are the only roles with any visibility into final settlement figures. */
export function canViewFinalSettlement(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId });
}
