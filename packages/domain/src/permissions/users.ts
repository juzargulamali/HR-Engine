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
