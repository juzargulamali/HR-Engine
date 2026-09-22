import { describe, expect, it } from "vitest";
import {
  canActivatePolicy,
  canDraftPolicy,
  canManageHolidays,
  canViewDraftPolicies,
} from "../../src/permissions/policies";
import type { RoleGrant } from "../../src/types";

const AE = "AE";
const PL = "PL";

const countryHrAdmin: RoleGrant[] = [{ role: "hr_admin", companyId: null, countryCode: AE }];
const companyScopedHrAdmin: RoleGrant[] = [
  { role: "hr_admin", companyId: "11111111-1111-1111-1111-111111111111", countryCode: null },
];
const globalHrAdmin: RoleGrant[] = [{ role: "hr_admin", companyId: null, countryCode: null }];
const countryCeo: RoleGrant[] = [{ role: "ceo", companyId: null, countryCode: AE }];
const lineManager: RoleGrant[] = [{ role: "line_manager", companyId: null, countryCode: AE }];

describe("canDraftPolicy / canEditDraftPolicyContent / canManageHolidays", () => {
  it("requires an unscoped-by-company HR Admin grant for that country", () => {
    expect(canDraftPolicy(countryHrAdmin, AE)).toBe(true);
    expect(canDraftPolicy(globalHrAdmin, AE)).toBe(true);
  });

  it("excludes a company-scoped HR Admin — policy affects every company in the country", () => {
    expect(canDraftPolicy(companyScopedHrAdmin, AE)).toBe(false);
  });

  it("excludes a country-scoped HR Admin for a different country", () => {
    expect(canDraftPolicy(countryHrAdmin, PL)).toBe(false);
  });

  it("never lets CEO or a line manager draft, and mirrors the same rule for holidays", () => {
    expect(canDraftPolicy(countryCeo, AE)).toBe(false);
    expect(canDraftPolicy(lineManager, AE)).toBe(false);
    expect(canManageHolidays(countryCeo, AE)).toBe(false);
    expect(canManageHolidays(countryHrAdmin, AE)).toBe(true);
  });
});

describe("canActivatePolicy", () => {
  it("lets a country HR Admin or CEO activate, as long as they didn't draft it", () => {
    expect(canActivatePolicy(countryHrAdmin, AE, false)).toBe(true);
    expect(canActivatePolicy(countryCeo, AE, false)).toBe(true);
  });

  it("blocks activation by whoever drafted it, regardless of role", () => {
    expect(canActivatePolicy(countryHrAdmin, AE, true)).toBe(false);
    expect(canActivatePolicy(countryCeo, AE, true)).toBe(false);
  });

  it("blocks a line manager entirely", () => {
    expect(canActivatePolicy(lineManager, AE, false)).toBe(false);
  });
});

describe("canViewDraftPolicies", () => {
  it("is HR Admin or CEO, country-scoped — never a line manager or a company-scoped HR Admin", () => {
    expect(canViewDraftPolicies(countryHrAdmin, AE)).toBe(true);
    expect(canViewDraftPolicies(countryCeo, AE)).toBe(true);
    expect(canViewDraftPolicies(companyScopedHrAdmin, AE)).toBe(false);
    expect(canViewDraftPolicies(lineManager, AE)).toBe(false);
  });
});
