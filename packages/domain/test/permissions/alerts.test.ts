import { describe, expect, it } from "vitest";
import { canViewHrAlerts } from "../../src/permissions/alerts";
import type { RoleGrant } from "../../src/types";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";

const hrAdminA: RoleGrant[] = [{ role: "hr_admin", companyId: COMPANY_A, countryCode: null }];
const ceoA: RoleGrant[] = [{ role: "ceo", companyId: COMPANY_A, countryCode: null }];
const financeA: RoleGrant[] = [{ role: "finance", companyId: COMPANY_A, countryCode: null }];
const employeeOnly: RoleGrant[] = [{ role: "employee", companyId: COMPANY_A, countryCode: null }];

describe("canViewHrAlerts", () => {
  it("lets a company-scoped HR Admin or CEO grant see the page", () => {
    expect(canViewHrAlerts(hrAdminA)).toBe(true);
    expect(canViewHrAlerts(ceoA)).toBe(true);
  });

  it("checks any scope, not an exact unscoped match — the ai_drafts gotcha this mirrors", () => {
    // A plain has_role('hr_admin') (no scope argument) would incorrectly
    // return false here, since the grant itself IS company-scoped.
    expect(canViewHrAlerts(hrAdminA)).toBe(true);
  });

  it("blocks Finance and a plain employee", () => {
    expect(canViewHrAlerts(financeA)).toBe(false);
    expect(canViewHrAlerts(employeeOnly)).toBe(false);
  });
});
