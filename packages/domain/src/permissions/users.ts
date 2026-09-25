import type { RoleGrant } from "../types";
import { isSysAdmin } from "./core";

/**
 * Mirrors `user_roles_write_sysadmin` in
 * supabase/migrations/20260922000000_phase0_foundations.sql. Provisioning a
 * login and granting/revoking roles is Sys Admin's alone (permission matrix
 * §3.6) — HR Admin can request a role but never grants one directly.
 */
export function canManageUsers(grants: readonly RoleGrant[]): boolean {
  return isSysAdmin(grants);
}

export function canAssignRole(grants: readonly RoleGrant[]): boolean {
  return isSysAdmin(grants);
}

/**
 * Decision (Account Control & Security Settings, requirement 5): activating/
 * deactivating a login, sending an admin-triggered password reset, and
 * resending an invitation are all identity/access-provisioning actions —
 * the same category as inviteUser/resendInvite/deleteUserAccount above and
 * "Manage roles / user access" in docs/03-permission-matrix.md §3.6, which
 * is already Sys-Admin-only ("R (request only)" for HR Admin). HR Admin
 * keeps full read/write on employee master data (§3.1) — this is narrowly
 * about the *login*, not the person's HR record, so it stays out of HR
 * Admin's remit for the same reason Sys Admin has "near-zero" standing
 * access to HR content (§3.7): each role's access footprint stays scoped to
 * its own domain. HR Admin can still see account status in the Users &
 * Roles list (read-only) to know who to chase about an unstarted invite.
 */
export function canManageAccountStatus(grants: readonly RoleGrant[]): boolean {
  return isSysAdmin(grants);
}

export function canAdminResetPassword(grants: readonly RoleGrant[]): boolean {
  return isSysAdmin(grants);
}
