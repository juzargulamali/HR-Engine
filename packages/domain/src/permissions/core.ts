import type { AppRole } from "../roles";
import type { RoleGrant, RoleScope } from "../types";

/**
 * Pure, side-effect-free mirror of the `has_role()` Postgres function
 * (docs/02-database-schema.md §2.6). Every module's permission checks are
 * built on this one primitive — never re-implement the scoping rule.
 *
 * IMPORTANT: this is a UI-affordance mirror, not the source of truth.
 * Hiding a button because `hasRole()` returns false is a convenience; the
 * real enforcement is always the matching RLS policy in Postgres
 * (architecture doc §1.5). Never gate a real write on this function alone.
 */
/**
 * A grant value of `null` (unscoped) always matches. A non-null grant value
 * only matches a scope the caller actually specified and that equals it —
 * mirroring SQL's `(company_id is null or company_id = p_company_id)` where
 * an unpassed `p_company_id` defaults to `null`, and `x = null` is never
 * true. Get this backwards and a company-scoped role would leak into every
 * company whenever a caller forgets to pass a scope — the opposite of what
 * the RLS policy actually does.
 */
function matchesScope(grantValue: string | null, scopeValue: string | undefined): boolean {
  if (grantValue === null) return true;
  if (scopeValue === undefined) return false;
  return grantValue === scopeValue;
}

export function hasRole(grants: readonly RoleGrant[], role: AppRole, scope: RoleScope = {}): boolean {
  return grants.some(
    (grant) =>
      grant.role === role &&
      matchesScope(grant.companyId, scope.companyId) &&
      matchesScope(grant.countryCode, scope.countryCode),
  );
}

export const isEmployee = (grants: readonly RoleGrant[], scope?: RoleScope) => hasRole(grants, "employee", scope);
export const isLineManager = (grants: readonly RoleGrant[], scope?: RoleScope) => hasRole(grants, "line_manager", scope);
export const isHrAdmin = (grants: readonly RoleGrant[], scope?: RoleScope) => hasRole(grants, "hr_admin", scope);
export const isFinance = (grants: readonly RoleGrant[], scope?: RoleScope) => hasRole(grants, "finance", scope);
export const isCeo = (grants: readonly RoleGrant[], scope?: RoleScope) => hasRole(grants, "ceo", scope);
export const isSysAdmin = (grants: readonly RoleGrant[], scope?: RoleScope) => hasRole(grants, "sys_admin", scope);
