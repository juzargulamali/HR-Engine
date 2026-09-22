import { describe, expect, it } from "vitest";
import { hasRole, isHrAdmin, isSysAdmin } from "../../src/permissions/core";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";
const COUNTRY_AE = "AE";
const COUNTRY_PL = "PL";

describe("hasRole", () => {
  it("matches an unscoped grant against any scope, per has_role() semantics", () => {
    const grants: RoleGrant[] = [{ role: "hr_admin", companyId: null, countryCode: null }];
    expect(hasRole(grants, "hr_admin")).toBe(true);
    expect(hasRole(grants, "hr_admin", { companyId: COMPANY_A })).toBe(true);
    expect(hasRole(grants, "hr_admin", { companyId: COMPANY_B })).toBe(true);
  });

  it("restricts a company-scoped grant to that company only", () => {
    const grants: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
    expect(hasRole(grants, "hr_admin", { companyId: COMPANY_A })).toBe(true);
    expect(hasRole(grants, "hr_admin", { companyId: COMPANY_B })).toBe(false);
  });

  it("does not let a company-scoped grant match when the caller asks an unscoped question", () => {
    // Mirrors has_role('hr_admin') called with no company_id argument in SQL:
    // the parameter defaults to null, "company_id = null" is never true, so
    // only an unscoped grant satisfies an unscoped question.
    const grants: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
    expect(hasRole(grants, "hr_admin")).toBe(false);
  });

  it("restricts a country-scoped grant to that country only", () => {
    const grants: RoleGrant[] = [{ role: "hr_admin", companyId: null, countryCode: COUNTRY_PL }];
    expect(hasRole(grants, "hr_admin", { countryCode: COUNTRY_PL })).toBe(true);
    expect(hasRole(grants, "hr_admin", { countryCode: COUNTRY_AE })).toBe(false);
  });

  it("never matches a different role", () => {
    const grants: RoleGrant[] = [{ role: "employee", companyId: null, countryCode: null }];
    expect(hasRole(grants, "hr_admin")).toBe(false);
  });

  it("combines multiple grants correctly (union of access)", () => {
    const grants: RoleGrant[] = [
      { role: "employee", companyId: null, countryCode: null },
      { role: "line_manager", companyId: COMPANY_A, countryCode: null },
    ];
    expect(isHrAdmin(grants)).toBe(false);
    expect(hasRole(grants, "line_manager", { companyId: COMPANY_A })).toBe(true);
    expect(hasRole(grants, "line_manager", { companyId: COMPANY_B })).toBe(false);
  });

  it("sys_admin convenience wrapper matches the generic check", () => {
    const grants: RoleGrant[] = [{ role: "sys_admin", companyId: null, countryCode: null }];
    expect(isSysAdmin(grants)).toBe(true);
  });
});
