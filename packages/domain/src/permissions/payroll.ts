import type { RoleGrant } from "../types";
import { isCLevel, isFinance, isHrAdmin } from "./core";

/** Mirrors payroll_runs_insert / payroll_runs_update_finance. */
export function canManagePayrollExport(grants: readonly RoleGrant[], companyId: string): boolean {
  return isFinance(grants, { companyId });
}

/** Mirrors payroll_runs_select: HR Admin, Finance, and any C-level exec (CEO/CTO) can all view a run. */
export function canViewPayrollExport(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId }) || isCLevel(grants, { companyId });
}

/** Mirrors letter_templates_write / generated_letters_insert. */
export function canManageLetters(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}
