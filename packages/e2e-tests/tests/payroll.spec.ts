import { test, expect } from "../src/fixtures";
import { PayrollPage } from "../src/pages/AppPages";
import { expectRoleAllowed, expectRoleDenied } from "../src/pages/Nav";
import { hasCredentials } from "../src/config";

/**
 * Payroll export authorization. Read-only: only VIEWS the page and checks
 * which controls render — never clicks "export"/"run", since triggering a
 * real payroll export run against Production is out of scope tonight (not
 * one of the explicit hard boundaries, but exporting real compensation data
 * is exactly the kind of side effect this suite should not risk without
 * being asked for it explicitly).
 */
test.describe("payroll export permissions", () => {
  test("employee and manager are denied", async ({ employeePage, managerPage }) => {
    await expectRoleDenied(employeePage, "/payroll");
    await expectRoleDenied(managerPage, "/payroll");
  });

  test("HR Admin and CEO can view, but only Finance sees the export control", async ({ hrAdminPage, ceoPage }) => {
    await expectRoleAllowed(hrAdminPage, "/payroll");
    await expectRoleAllowed(ceoPage, "/payroll");

    const hrPayroll = new PayrollPage(hrAdminPage);
    await hrPayroll.goto();
    // canManagePayrollExport (start a new export) = Finance only, per the
    // RBAC read of payroll/page.tsx — HR Admin can view but should not see
    // the export-start control.
    await hrPayroll.expectExportControlHidden();
  });

  test("Finance sees the export control (skips cleanly if no Finance test account exists)", async ({ financePage }) => {
    test.skip(!hasCredentials("finance"), "No Finance test account configured.");
    const financePayroll = new PayrollPage(financePage);
    await financePayroll.goto();
    await financePayroll.expectExportControlVisible();
  });
});
