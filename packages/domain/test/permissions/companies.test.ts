import { describe, expect, it } from "vitest";
import { canManageCompanies, canManageDepartments } from "../../src/permissions/companies";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

describe("canManageCompanies", () => {
  it("is true only for sys_admin", () => {
    expect(canManageCompanies([{ role: "sys_admin", companyId: null, countryCode: null }])).toBe(true);
    expect(canManageCompanies([{ role: "hr_admin", companyId: null, countryCode: null }])).toBe(false);
    expect(canManageCompanies([{ role: "ceo", companyId: null, countryCode: null }])).toBe(false);
  });
});

describe("canManageDepartments", () => {
  it("is true for sys_admin regardless of company", () => {
    const grants: RoleGrant[] = [{ role: "sys_admin", companyId: null, countryCode: null }];
    expect(canManageDepartments(grants, COMPANY_A)).toBe(true);
  });

  it("is true for an hr_admin scoped to that specific company", () => {
    const grants: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
    expect(canManageDepartments(grants, COMPANY_A)).toBe(true);
    expect(canManageDepartments(grants, COMPANY_B)).toBe(false);
  });

  it("is false for a plain employee", () => {
    const grants: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];
    expect(canManageDepartments(grants, COMPANY_A)).toBe(false);
  });
});
