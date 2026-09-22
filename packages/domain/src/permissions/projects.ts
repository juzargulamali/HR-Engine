import type { RoleGrant } from "../types";
import { isHrAdmin } from "./core";

/** Mirrors projects_write / project_allocations_write in supabase/migrations/20260927000000_phase4_reimbursements_projects_timesheets.sql. */
export function canManageProjects(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}
