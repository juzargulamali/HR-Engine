import { describe, expect, it } from "vitest";
import {
  canActivatePolicy,
  canDeleteDraftPolicy,
  canDraftPolicy,
  canManageHolidays,
  canSeedPolicyDrafts,
  canViewDraftPolicies,
  POLICY_DRAFT_SEED_COUNTRIES,
  SEED_POLICY_DRAFTS_BLOCKED_REASON,
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

describe("canDeleteDraftPolicy", () => {
  it("is HR Admin or CEO, country-scoped — unlike canActivatePolicy, does not exclude the drafter", () => {
    expect(canDeleteDraftPolicy(countryHrAdmin, AE)).toBe(true);
    expect(canDeleteDraftPolicy(countryCeo, AE)).toBe(true);
    expect(canDeleteDraftPolicy(companyScopedHrAdmin, AE)).toBe(false);
    expect(canDeleteDraftPolicy(lineManager, AE)).toBe(false);
  });
});

describe("canSeedPolicyDrafts (the 'Create ... drafts' buttons on the Policies page)", () => {
  const hr = (countryCode: string | null, companyId: string | null = null): RoleGrant => ({ role: "hr_admin", companyId, countryCode });

  it("is true for an unscoped HR Admin (all countries), and for one unscoped grant per country", () => {
    expect(canSeedPolicyDrafts(globalHrAdmin)).toBe(true);
    expect(canSeedPolicyDrafts([hr("AE"), hr("SA"), hr("PL")])).toBe(true);
  });

  it("is false for an HR Admin of one or two countries, for a company-only HR Admin, and for CEO, line manager and nobody", () => {
    expect(canSeedPolicyDrafts(countryHrAdmin)).toBe(false);
    expect(canSeedPolicyDrafts([hr("AE"), hr("SA")])).toBe(false);
    expect(canSeedPolicyDrafts(companyScopedHrAdmin)).toBe(false);
    expect(canSeedPolicyDrafts([hr(null, "11111111-1111-1111-1111-111111111111")])).toBe(false);
    expect(canSeedPolicyDrafts(countryCeo)).toBe(false);
    expect(canSeedPolicyDrafts(lineManager)).toBe(false);
    expect(canSeedPolicyDrafts([])).toBe(false);
  });

  it("names the three countries the database functions loop over, and gives one sentence of explanation", () => {
    expect(POLICY_DRAFT_SEED_COUNTRIES).toEqual(["AE", "SA", "PL"]);
    expect(SEED_POLICY_DRAFTS_BLOCKED_REASON.match(/\./g)).toHaveLength(1);
  });

  // The database rule, written out independently of the application helpers: seed_phase2b_policy_drafts() and seed_recovery_windows_policy_drafts() each loop
  // `foreach v_country in array array['AE','SA','PL']` and raise unless `has_role('hr_admin', null, v_country)`, i.e. unless a live user_roles row has the role hr_admin,
  // company_id NULL (company_id = null is never true) and country_code NULL or equal to that country.
  const sqlAllows = (grants: readonly RoleGrant[]) =>
    ["AE", "SA", "PL"].every((c) => grants.some((g) => g.role === "hr_admin" && g.companyId === null && (g.countryCode === null || g.countryCode === c)));

  it("agrees with the database rule for every combination of up to three grants (role x company x country)", () => {
    const roles = ["hr_admin", "ceo", "employee"] as const;
    const companies = [null, "11111111-1111-1111-1111-111111111111"];
    const countries = [null, "AE", "SA", "PL", "DE"];
    const all: RoleGrant[] = roles.flatMap((role) => companies.flatMap((companyId) => countries.map((countryCode) => ({ role, companyId, countryCode }))));
    let checked = 0;
    const check = (grants: RoleGrant[]) => {
      expect(canSeedPolicyDrafts(grants), JSON.stringify(grants)).toBe(sqlAllows(grants));
      checked++;
    };
    check([]);
    for (let a = 0; a < all.length; a++) {
      check([all[a]!]);
      for (let b = a + 1; b < all.length; b++) {
        check([all[a]!, all[b]!]);
        for (let c = b + 1; c < all.length; c++) check([all[a]!, all[b]!, all[c]!]);
      }
    }
    expect(checked).toBe(1 + 30 + 435 + 4060);
  });
});
