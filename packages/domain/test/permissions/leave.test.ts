import { describe, expect, it } from "vitest";
import { canViewEmployeeLeave } from "../../src/permissions/leave";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const financeA: RoleGrant[] = [{ role: "finance", companyId: COMPANY_A, countryCode: null }];
const ceoA: RoleGrant[] = [{ role: "ceo", companyId: COMPANY_A, countryCode: null }];
const ctoA: RoleGrant[] = [{ role: "cto", companyId: COMPANY_A, countryCode: null }];
const managerA: RoleGrant[] = [{ role: "line_manager", companyId: COMPANY_A, countryCode: null }];
const employeeOnly: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];

describe("canViewEmployeeLeave", () => {
  it("mirrors leave_requests_select: self, manager, HR Admin, Finance, and CEO/CTO", () => {
    expect(canViewEmployeeLeave(employeeOnly, COMPANY_A, { isSelf: true, isManager: false })).toBe(true);
    expect(canViewEmployeeLeave(managerA, COMPANY_A, { isSelf: false, isManager: true })).toBe(true);
    expect(canViewEmployeeLeave(hrAdminA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
    expect(canViewEmployeeLeave(financeA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
    expect(canViewEmployeeLeave(ceoA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
    expect(canViewEmployeeLeave(ctoA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
  });

  it("blocks an unrelated peer, and every scoped role for a different company", () => {
    expect(canViewEmployeeLeave(employeeOnly, COMPANY_A, { isSelf: false, isManager: false })).toBe(false);
    expect(canViewEmployeeLeave(hrAdminA, COMPANY_B, { isSelf: false, isManager: false })).toBe(false);
    expect(canViewEmployeeLeave(financeA, COMPANY_B, { isSelf: false, isManager: false })).toBe(false);
    expect(canViewEmployeeLeave(ceoA, COMPANY_B, { isSelf: false, isManager: false })).toBe(false);
  });
});
