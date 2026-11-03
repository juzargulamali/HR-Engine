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

/**
 * The countries the two one-click draft functions loop over, in the same order as the SQL:
 * seed_phase2b_policy_drafts() (20261103000000_phase2b_v2_policy_drafts.sql) and seed_recovery_windows_policy_drafts()
 * (20261108000000_recovery_windows_attendance_redesign.sql). Each checks `has_role('hr_admin', null, <country>)` for EVERY one of them
 * before it inserts anything and raises on the first it fails, so an HR Admin who holds the role for only some of these countries (or only
 * for one company) can never complete it.
 */
export const POLICY_DRAFT_SEED_COUNTRIES = ["AE", "SA", "PL"] as const;

/**
 * Who can use the "Create ... drafts" buttons on the Policies page: the same test the two database functions apply, no broader and no narrower
 * (an unscoped-by-company HR Admin grant that covers all of UAE, Saudi Arabia and Poland, as one grant or as one per country). The page offers
 * the buttons on this and the server actions refuse on it, so the screen and the server cannot drift apart; the database still checks it again.
 */
export function canSeedPolicyDrafts(grants: readonly RoleGrant[]): boolean {
  return POLICY_DRAFT_SEED_COUNTRIES.every((code) => canDraftPolicy(grants, code));
}

/** The one sentence shown (and returned by the server actions) when the HR Admin role is not enough for the draft buttons. */
export const SEED_POLICY_DRAFTS_BLOCKED_REASON =
  "These buttons create the drafts for the UAE, Saudi Arabia and Poland together, so they need an HR Admin role that covers all three countries and is not limited to one company; your HR role does not, and the database would refuse.";

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
