import type { RoleGrant } from "../types";
import { hasRoleAnyScope } from "./core";

/**
 * The HR Alerts page aggregates across every company an HR Admin/CEO grant
 * covers (mirroring employees/page.tsx's own "list across whatever RLS
 * lets through" pattern) rather than one company at a time, so this checks
 * "holds the role anywhere" — an unscoped has_role() check would miss every
 * real, company-scoped grant (see docs/09, the same gotcha ai_drafts hit).
 * Each underlying table (employment_contracts, employee_documents,
 * identity_documents) still has its own RLS policy — HR Admin gets full
 * read, CEO gets contracts/documents but NOT identity_documents — so this
 * only gates the page itself; RLS still decides row-by-row what a CEO
 * viewer actually sees.
 */
export function canViewHrAlerts(grants: readonly RoleGrant[]): boolean {
  return hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "ceo");
}
