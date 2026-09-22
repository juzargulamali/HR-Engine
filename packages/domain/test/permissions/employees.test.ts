import { describe, expect, it } from "vitest";
import {
  canDeleteOrRestoreEmployee,
  canEditCompensation,
  canEditEmployeeCore,
  canManageContracts,
  canManageIdentityDocuments,
  canViewCompensation,
  canViewContracts,
  canViewDeletedEmployees,
  canViewIdentityDocuments,
} from "../../src/permissions/employees";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const financeA: RoleGrant[] = [{ role: "finance", companyId: COMPANY_A, countryCode: null }];
const ceoA: RoleGrant[] = [{ role: "ceo", companyId: COMPANY_A, countryCode: null }];
const managerA: RoleGrant[] = [{ role: "line_manager", companyId: COMPANY_A, countryCode: null }];
const employeeOnly: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];
const sysAdmin: RoleGrant[] = [{ role: "sys_admin", companyId: null, countryCode: null }];

describe("compensation permissions", () => {
  it("lets the employee view their own, HR Admin and Finance view anyone in their company", () => {
    expect(canViewCompensation(employeeOnly, COMPANY_A, true)).toBe(true);
    expect(canViewCompensation(employeeOnly, COMPANY_A, false)).toBe(false);
    expect(canViewCompensation(hrAdminA, COMPANY_A, false)).toBe(true);
    expect(canViewCompensation(financeA, COMPANY_A, false)).toBe(true);
    expect(canViewCompensation(hrAdminA, COMPANY_B, false)).toBe(false);
  });

  it("never lets a line manager or CEO view compensation, and never lets the employee edit it", () => {
    expect(canViewCompensation(managerA, COMPANY_A, false)).toBe(false);
    expect(canViewCompensation(ceoA, COMPANY_A, false)).toBe(false);
    expect(canEditCompensation(employeeOnly, COMPANY_A)).toBe(false);
    expect(canEditCompensation(hrAdminA, COMPANY_A)).toBe(true);
    expect(canEditCompensation(financeA, COMPANY_A)).toBe(true);
  });
});

describe("identity document permissions", () => {
  it("is self + HR Admin only — never Finance, CEO, or a manager", () => {
    expect(canViewIdentityDocuments(employeeOnly, COMPANY_A, true)).toBe(true);
    expect(canViewIdentityDocuments(hrAdminA, COMPANY_A, false)).toBe(true);
    expect(canViewIdentityDocuments(financeA, COMPANY_A, false)).toBe(false);
    expect(canViewIdentityDocuments(ceoA, COMPANY_A, false)).toBe(false);
    expect(canViewIdentityDocuments(managerA, COMPANY_A, false)).toBe(false);
    expect(canManageIdentityDocuments(hrAdminA, COMPANY_A)).toBe(true);
    expect(canManageIdentityDocuments(financeA, COMPANY_A)).toBe(false);
  });
});

describe("contract permissions", () => {
  it("includes self, the manager, HR Admin, Finance, and CEO", () => {
    expect(canViewContracts(employeeOnly, COMPANY_A, { isSelf: true, isManager: false })).toBe(true);
    expect(canViewContracts(managerA, COMPANY_A, { isSelf: false, isManager: true })).toBe(true);
    expect(canViewContracts(hrAdminA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
    expect(canViewContracts(financeA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
    expect(canViewContracts(ceoA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
  });

  it("excludes an unrelated employee who is neither self nor their manager", () => {
    expect(canViewContracts(employeeOnly, COMPANY_A, { isSelf: false, isManager: false })).toBe(false);
  });

  it("restricts editing to HR Admin", () => {
    expect(canManageContracts(hrAdminA, COMPANY_A)).toBe(true);
    expect(canManageContracts(financeA, COMPANY_A)).toBe(false);
    expect(canManageContracts(managerA, COMPANY_A)).toBe(false);
  });
});

describe("core profile edit permission", () => {
  it("mirrors employees_update_hr — HR Admin only, scoped to their company", () => {
    expect(canEditEmployeeCore(hrAdminA, COMPANY_A)).toBe(true);
    expect(canEditEmployeeCore(hrAdminA, COMPANY_B)).toBe(false);
    expect(canEditEmployeeCore(managerA, COMPANY_A)).toBe(false);
    expect(canEditEmployeeCore(employeeOnly, COMPANY_A)).toBe(false);
  });
});

describe("soft delete permissions", () => {
  it("only HR Admin can delete or restore, never Sys Admin", () => {
    expect(canDeleteOrRestoreEmployee(hrAdminA, COMPANY_A)).toBe(true);
    expect(canDeleteOrRestoreEmployee(sysAdmin, COMPANY_A)).toBe(false);
  });

  it("HR Admin and Sys Admin can both see that a deleted employee exists", () => {
    expect(canViewDeletedEmployees(hrAdminA, COMPANY_A)).toBe(true);
    expect(canViewDeletedEmployees(sysAdmin, COMPANY_A)).toBe(true);
    expect(canViewDeletedEmployees(financeA, COMPANY_A)).toBe(false);
  });
});
