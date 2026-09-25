import { test, expect } from "../src/fixtures";
import { expectRoleAllowed, expectRoleDenied, visitDirectly } from "../src/pages/Nav";

/**
 * Grounded in a direct reading of every apps/web/src/app/(app)/*\/page.tsx
 * this session (not guessed): this app never redirects or blanks a page for
 * an authenticated-but-wrong-role user. The six routes below are the ONLY
 * ones with an explicit role check, and each renders a 200-status page with
 * a specific `role="alert"` box on denial. Every other route either has no
 * role gate (leave, leave/new, reimbursements, performance, timesheets,
 * approvals) or silently scopes its content instead of denying (`/`,
 * employees, attendance, letters) — those belong in each feature's own spec,
 * not here, since "forbidden" doesn't mean the same thing for them.
 *
 * Read-only throughout: visiting a route creates nothing.
 */
test.describe("role-based access control", () => {
  test("policies/new is HR-Admin-only", async ({ employeePage, managerPage, hrAdminPage }) => {
    await expectRoleDenied(employeePage, "/policies/new");
    await expectRoleDenied(managerPage, "/policies/new");
    await expectRoleAllowed(hrAdminPage, "/policies/new");
  });

  test("audit-log is HR-Admin/Sys-Admin-only", async ({ employeePage, managerPage, hrAdminPage }) => {
    await expectRoleDenied(employeePage, "/audit-log");
    await expectRoleDenied(managerPage, "/audit-log");
    await expectRoleAllowed(hrAdminPage, "/audit-log");
  });

  test("payroll is restricted to HR Admin, Finance, CEO, CTO", async ({ employeePage, managerPage, hrAdminPage, ceoPage }) => {
    await expectRoleDenied(employeePage, "/payroll");
    await expectRoleDenied(managerPage, "/payroll");
    await expectRoleAllowed(hrAdminPage, "/payroll");
    await expectRoleAllowed(ceoPage, "/payroll");
  });

  test("assets is restricted to HR Admin and Finance", async ({ employeePage, managerPage, hrAdminPage }) => {
    await expectRoleDenied(employeePage, "/assets");
    await expectRoleDenied(managerPage, "/assets");
    await expectRoleAllowed(hrAdminPage, "/assets");
  });

  test("ai-suggestions is restricted to HR Admin and Sys Admin", async ({ employeePage, managerPage, hrAdminPage }) => {
    await expectRoleDenied(employeePage, "/ai-suggestions");
    await expectRoleDenied(managerPage, "/ai-suggestions");
    await expectRoleAllowed(hrAdminPage, "/ai-suggestions");
  });

  test("alerts is restricted to HR Admin, CEO, CTO", async ({ employeePage, managerPage, hrAdminPage, ceoPage }) => {
    await expectRoleDenied(employeePage, "/alerts");
    await expectRoleDenied(managerPage, "/alerts");
    await expectRoleAllowed(hrAdminPage, "/alerts");
    await expectRoleAllowed(ceoPage, "/alerts");
  });

  test("routes with no role gate render for a plain employee (identity-scoped, not role-denied)", async ({ employeePage }) => {
    for (const route of ["/leave", "/leave/new", "/reimbursements", "/performance", "/timesheets", "/approvals"]) {
      const { finalUrl, bodyText } = await visitDirectly(employeePage, route);
      expect(finalUrl.endsWith(route)).toBe(true);
      expect(bodyText.length).toBeGreaterThan(0);
    }
  });
});
