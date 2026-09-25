import { describe, expect, it } from "vitest";
import {
  canAdminResetPassword,
  canAssignRole,
  canManageAccountStatus,
  canManageUsers,
} from "../../src/permissions/users";

describe("user management permissions", () => {
  const sysAdmin = [{ role: "sys_admin" as const, companyId: null, countryCode: null }];
  const hrAdmin = [{ role: "hr_admin" as const, companyId: null, countryCode: null }];

  it("only sys_admin can manage users or assign roles", () => {
    expect(canManageUsers(sysAdmin)).toBe(true);
    expect(canManageUsers(hrAdmin)).toBe(false);
    expect(canAssignRole(sysAdmin)).toBe(true);
    expect(canAssignRole(hrAdmin)).toBe(false);
  });

  it("only sys_admin can activate/deactivate accounts or admin-reset a password — not HR Admin", () => {
    expect(canManageAccountStatus(sysAdmin)).toBe(true);
    expect(canManageAccountStatus(hrAdmin)).toBe(false);
    expect(canAdminResetPassword(sysAdmin)).toBe(true);
    expect(canAdminResetPassword(hrAdmin)).toBe(false);
  });
});
