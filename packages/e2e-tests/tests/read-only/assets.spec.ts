import { expectRoleAllowed, expectRoleDenied } from "../../src/pages/Nav";
import { test } from "../../src/fixtures";

/** Read-only RBAC only. The document-upload mutating test lives separately
 * in tests/mutating/40-document-upload.spec.ts. */
test.describe("assets permissions", () => {
  test("assets is restricted to HR Admin and Finance", async ({ employeePage, managerPage, hrAdminPage }) => {
    await expectRoleDenied(employeePage, "/assets");
    await expectRoleDenied(managerPage, "/assets");
    await expectRoleAllowed(hrAdminPage, "/assets");
  });
});
