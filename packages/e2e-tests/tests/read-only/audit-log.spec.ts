import { test, expect } from "../../src/fixtures";
import { AuditLogPage } from "../../src/pages/AppPages";
import { expectRoleDenied } from "../../src/pages/Nav";

/** Read-only: viewing the audit log creates nothing. RBAC allow/deny across
 * all 6 roles is covered by the full matrix in rbac.spec.ts; this file
 * covers the audit log's own structural guarantees. Post-mutation content
 * verification (that this run's tagged leave/reimbursement mutations
 * actually left a trace here) runs later, in
 * tests/mutating/60-audit-verification.spec.ts, once there's something to
 * find. */
test.describe("audit log", () => {
  test("restricted to HR Admin / Sys Admin", async ({ employeePage, managerPage }) => {
    await expectRoleDenied(employeePage, "/audit-log");
    await expectRoleDenied(managerPage, "/audit-log");
  });

  test("has no edit or delete affordance anywhere (append-only)", async ({ hrAdminPage }) => {
    const auditLog = new AuditLogPage(hrAdminPage);
    await auditLog.goto();
    await auditLog.expectNoEditOrDeleteControls();
  });

  test("renders entries for HR Admin", async ({ hrAdminPage }) => {
    await hrAdminPage.goto("/audit-log");
    const bodyText = (await hrAdminPage.locator("body").innerText()).trim();
    expect(bodyText.length).toBeGreaterThan(20);
  });
});
