import type { RoleGrant } from "../types";
import { isCLevel, isHrAdmin } from "./core";

/**
 * Gates the dashboard's headcount/attendance/pending-approvals overview —
 * not itself a mirror of any one RLS policy, since it's a read composed
 * across several tables (employees, attendance_records, leave_requests)
 * each already enforcing their own. Scoped per company, like
 * assets/page.tsx's manageableCompanies, so a CEO/CTO or HR Admin overseeing
 * several companies sees one card per company they actually hold the role
 * on, not every company in the system.
 */
export function canViewCompanyOverview(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId }) || isCLevel(grants, { companyId });
}
