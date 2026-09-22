import type { AppRole } from "./roles";

/**
 * Mirrors one active row of `user_roles` (§2.2 of the schema doc). A signed-in
 * user's full permission surface is the array of these they currently hold —
 * fetch it once per request/session and pass it into every `can*` check
 * below, rather than querying per-check.
 */
export interface RoleGrant {
  role: AppRole;
  /** null = applies across every company (see `user_roles.company_id`) */
  companyId: string | null;
  /** null = applies across every country (see `user_roles.country_code`) */
  countryCode: string | null;
}

/**
 * Scope a permission check is evaluated against — mirrors the two optional
 * parameters of the `has_role()` Postgres function exactly, so a check here
 * and the RLS policy it mirrors can never quietly drift apart.
 */
export interface RoleScope {
  companyId?: string;
  countryCode?: string;
}
