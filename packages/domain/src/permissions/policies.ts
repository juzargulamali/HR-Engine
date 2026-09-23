import type { RoleGrant } from "../types";
import { isCLevel, isHrAdmin } from "./core";

/**
 * Mirrors the RLS policies in
 * supabase/migrations/20260925000000_phase2_country_policy_engine.sql.
 * Every check here passes `{ countryCode }` with no `companyId` — matching
 * `has_role('hr_admin', null, country_code)` in SQL, which requires an
 * unscoped-by-company grant on purpose (see that migration's comment on
 * `policy_versions_select`). A company-scoped HR Admin correctly gets
 * `false` from every function below.
 */

export function canDraftPolicy(grants: readonly RoleGrant[], countryCode: string): boolean {
  return isHrAdmin(grants, { countryCode });
}

export function canEditDraftPolicyContent(grants: readonly RoleGrant[], countryCode: string): boolean {
  return isHrAdmin(grants, { countryCode });
}

/**
 * `isDrafter` mirrors the trigger's "not the same person" rule — pass
 * whether the viewer is the one who drafted this specific version.
 */
export function canActivatePolicy(grants: readonly RoleGrant[], countryCode: string, isDrafter: boolean): boolean {
  if (isDrafter) return false;
  return isHrAdmin(grants, { countryCode }) || isCLevel(grants, { countryCode });
}

export function canViewDraftPolicies(grants: readonly RoleGrant[], countryCode: string): boolean {
  return isHrAdmin(grants, { countryCode }) || isCLevel(grants, { countryCode });
}

/**
 * Deleting a draft has no separation-of-duties concern (unlike activating
 * one) — it isn't putting anything into effect — so unlike
 * canActivatePolicy, this doesn't exclude the drafter themselves. Mirrors
 * policy_versions_delete, which only ever applies to status = 'draft'.
 */
export function canDeleteDraftPolicy(grants: readonly RoleGrant[], countryCode: string): boolean {
  return isHrAdmin(grants, { countryCode }) || isCLevel(grants, { countryCode });
}

export function canManageHolidays(grants: readonly RoleGrant[], countryCode: string): boolean {
  return isHrAdmin(grants, { countryCode });
}
