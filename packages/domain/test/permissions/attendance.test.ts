import { describe, expect, it } from "vitest";
import { canManageAttendance, canViewAttendance } from "../../src/permissions/attendance";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const managerA: RoleGrant[] = [{ role: "line_manager", companyId: COMPANY_A, countryCode: null }];
const employeeOnly: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];

describe("canViewAttendance", () => {
  it("lets the employee themselves, their manager, and HR Admin see the record", () => {
    expect(canViewAttendance(employeeOnly, COMPANY_A, { isSelf: true, isManager: false })).toBe(true);
    expect(canViewAttendance(managerA, COMPANY_A, { isSelf: false, isManager: true })).toBe(true);
    expect(canViewAttendance(hrAdminA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
  });

  it("blocks an unrelated peer — and HR Admin scoped to a different company", () => {
    expect(canViewAttendance(employeeOnly, COMPANY_A, { isSelf: false, isManager: false })).toBe(false);
    expect(canViewAttendance(hrAdminA, COMPANY_B, { isSelf: false, isManager: false })).toBe(false);
  });
});

describe("canManageAttendance", () => {
  it("is HR Admin only — not even the employee's own manager", () => {
    expect(canManageAttendance(hrAdminA, COMPANY_A)).toBe(true);
    expect(canManageAttendance(managerA, COMPANY_A)).toBe(false);
    expect(canManageAttendance(employeeOnly, COMPANY_A)).toBe(false);
  });
});
