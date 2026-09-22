import type { RoleGrant } from "../types";
import { hasRoleAnyScope } from "./core";

/** Mirrors ai_drafts_select/_update — a role-restricted queue, not company-scoped. */
export function canReviewAiDrafts(grants: readonly RoleGrant[]): boolean {
  return hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "sys_admin");
}

/** Mirrors audit_log_select_hr / audit_log_select_sysadmin's role gate (company scoping happens server-side in the query itself). */
export function canViewAuditLog(grants: readonly RoleGrant[]): boolean {
  return hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "sys_admin");
}
