import { describe, expect, it } from "vitest";
import { canAssignRole, canManageUsers } from "../../src/permissions/users";

describe("user management permissions", () => {
  it("only sys_admin can manage users or assign roles", () => {
    const sysAdmin = [{ role: "sys_admin" as const, companyId: null, countryCode: null }];
    const hrAdmin = [{ role: "hr_admin" as const, companyId: null, countryCode: null }];

    expect(canManageUsers(sysAdmin)).toBe(true);
    expect(canManageUsers(hrAdmin)).toBe(false);
    expect(canAssignRole(sysAdmin)).toBe(true);
    expect(canAssignRole(hrAdmin)).toBe(false);
  });
});
