import { describe, expect, it } from "vitest";
import { canManageAssets, canViewAssetAssignments, canViewAssetInventory } from "../../src/permissions/assets";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const financeA: RoleGrant[] = [{ role: "finance", companyId: COMPANY_A, countryCode: null }];
const ceoA: RoleGrant[] = [{ role: "ceo", companyId: COMPANY_A, countryCode: null }];
const managerA: RoleGrant[] = [{ role: "line_manager", companyId: COMPANY_A, countryCode: null }];
const employeeOnly: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];

describe("canViewAssetInventory", () => {
  it("lets HR Admin and Finance browse their own company's inventory", () => {
    expect(canViewAssetInventory(hrAdminA, COMPANY_A)).toBe(true);
    expect(canViewAssetInventory(financeA, COMPANY_A)).toBe(true);
  });

  it("blocks CEO, a manager, and a plain employee — and a grant scoped to a different company", () => {
    expect(canViewAssetInventory(ceoA, COMPANY_A)).toBe(false);
    expect(canViewAssetInventory(managerA, COMPANY_A)).toBe(false);
    expect(canViewAssetInventory(employeeOnly, COMPANY_A)).toBe(false);
    expect(canViewAssetInventory(hrAdminA, COMPANY_B)).toBe(false);
  });
});

describe("canManageAssets", () => {
  it("is HR Admin only — not even Finance, which can view but never write", () => {
    expect(canManageAssets(hrAdminA, COMPANY_A)).toBe(true);
    expect(canManageAssets(financeA, COMPANY_A)).toBe(false);
  });
});

describe("canViewAssetAssignments", () => {
  it("lets the employee themselves, their manager, HR Admin, and Finance see who has what", () => {
    expect(canViewAssetAssignments(employeeOnly, COMPANY_A, { isSelf: true, isManager: false })).toBe(true);
    expect(canViewAssetAssignments(managerA, COMPANY_A, { isSelf: false, isManager: true })).toBe(true);
    expect(canViewAssetAssignments(hrAdminA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
    expect(canViewAssetAssignments(financeA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
  });

  it("blocks an unrelated peer (not self, not their manager, no admin role)", () => {
    expect(canViewAssetAssignments(employeeOnly, COMPANY_A, { isSelf: false, isManager: false })).toBe(false);
  });
});
