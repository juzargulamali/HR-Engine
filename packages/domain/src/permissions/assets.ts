import type { RoleGrant } from "../types";
import { isFinance, isHrAdmin } from "./core";

/**
 * Mirrors assets_select's company-wide branch (HR Admin/Finance browsing
 * the whole inventory) — the RLS policy's other branch, "the specific
 * asset(s) actually issued to me/my team", is a per-row case covered by
 * canViewAssetAssignments below, not something a single inventory-wide
 * boolean can express.
 */
export function canViewAssetInventory(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId });
}

/** Mirrors assets_write / asset_assignments_write — HR Admin alone manages the inventory and who holds what. */
export function canManageAssets(grants: readonly RoleGrant[], companyId: string): boolean {
  return isHrAdmin(grants, { companyId });
}

/** Mirrors asset_assignments_select: self, manager, HR Admin, Finance. */
export function canViewAssetAssignments(
  grants: readonly RoleGrant[],
  companyId: string,
  { isSelf, isManager }: { isSelf: boolean; isManager: boolean },
): boolean {
  return isSelf || isManager || isHrAdmin(grants, { companyId }) || isFinance(grants, { companyId });
}
