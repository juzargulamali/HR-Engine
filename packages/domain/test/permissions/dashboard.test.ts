import { describe, expect, it } from "vitest";
import { canViewCompanyOverview } from "../../src/permissions/dashboard";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const ceoA: RoleGrant[] = [{ role: "ceo", companyId: COMPANY_A, countryCode: null }];
const managerA: RoleGrant[] = [{ role: "line_manager", companyId: COMPANY_A, countryCode: null }];

describe("canViewCompanyOverview", () => {
  it("lets HR Admin and CEO see their own company's overview", () => {
    expect(canViewCompanyOverview(hrAdminA, COMPANY_A)).toBe(true);
    expect(canViewCompanyOverview(ceoA, COMPANY_A)).toBe(true);
  });

  it("blocks a manager and a grant scoped to a different company", () => {
    expect(canViewCompanyOverview(managerA, COMPANY_A)).toBe(false);
    expect(canViewCompanyOverview(hrAdminA, COMPANY_B)).toBe(false);
    expect(canViewCompanyOverview(ceoA, COMPANY_B)).toBe(false);
  });
});
