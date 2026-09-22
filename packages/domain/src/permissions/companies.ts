import type { RoleGrant } from "../types";
import { isHrAdmin, isSysAdmin } from "./core";

/**
 * Mirrors `companies_write`/`departments_write` in
 * supabase/migrations/20260922000000_phase0_foundations.sql. Company/country
 * structure is Sys Admin's (permission matrix §3.6); departments can also be
 * managed by an HR Admin scoped to that company.
 */
export function canManageCompanies(grants: readonly RoleGrant[]): boolean {
  return isSysAdmin(grants);
}

export function canManageDepartments(grants: readonly RoleGrant[], companyId: string): boolean {
  return isSysAdmin(grants) || isHrAdmin(grants, { companyId });
}
