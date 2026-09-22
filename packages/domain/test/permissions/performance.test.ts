import { describe, expect, it } from "vitest";
import {
  canAppraiseEmployee,
  canManageAnyAppraisal,
  canManagePerformanceCycles,
  canRateGoal,
  canViewGoals,
} from "../../src/permissions/performance";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const managerA: RoleGrant[] = [{ role: "line_manager", companyId: COMPANY_A, countryCode: null }];
const employeeOnly: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];

describe("canManagePerformanceCycles", () => {
  it("is HR Admin only", () => {
    expect(canManagePerformanceCycles(hrAdminA, COMPANY_A)).toBe(true);
    expect(canManagePerformanceCycles(managerA, COMPANY_A)).toBe(false);
    expect(canManagePerformanceCycles(hrAdminA, COMPANY_B)).toBe(false);
  });
});

describe("canViewGoals", () => {
  it("lets the employee themselves, their manager, and HR Admin see the goals", () => {
    expect(canViewGoals(employeeOnly, COMPANY_A, { isSelf: true, isManager: false })).toBe(true);
    expect(canViewGoals(managerA, COMPANY_A, { isSelf: false, isManager: true })).toBe(true);
    expect(canViewGoals(hrAdminA, COMPANY_A, { isSelf: false, isManager: false })).toBe(true);
  });

  it("blocks an unrelated peer", () => {
    expect(canViewGoals(employeeOnly, COMPANY_A, { isSelf: false, isManager: false })).toBe(false);
  });
});

describe("canRateGoal", () => {
  it("lets the manager or HR Admin set a manager_rating, not a plain employee", () => {
    expect(canRateGoal(managerA, COMPANY_A, true)).toBe(true);
    expect(canRateGoal(hrAdminA, COMPANY_A, false)).toBe(true);
    expect(canRateGoal(employeeOnly, COMPANY_A, false)).toBe(false);
  });
});

describe("canAppraiseEmployee", () => {
  it("lets the manager or HR Admin start an appraisal, not a plain employee", () => {
    expect(canAppraiseEmployee(managerA, COMPANY_A, true)).toBe(true);
    expect(canAppraiseEmployee(hrAdminA, COMPANY_A, false)).toBe(true);
    expect(canAppraiseEmployee(employeeOnly, COMPANY_A, false)).toBe(false);
  });
});

describe("canManageAnyAppraisal", () => {
  it("is HR Admin only — a manager only manages appraisals they themselves wrote", () => {
    expect(canManageAnyAppraisal(hrAdminA, COMPANY_A)).toBe(true);
    expect(canManageAnyAppraisal(managerA, COMPANY_A)).toBe(false);
  });
});
