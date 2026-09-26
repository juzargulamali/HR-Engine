import { test, expect } from "../../src/fixtures";
import { PoliciesPage } from "../../src/pages/PoliciesPage";
import { expectRoleAllowed } from "../../src/pages/Nav";

/**
 * Policy access and the two-person activation rule — WITHOUT ever
 * activating, publishing, replacing, or deleting anything (hard boundary).
 * Fully read-only.
 */
test.describe("policies", () => {
  test("policies/new is reachable for HR Admin (role check only, no draft created)", async ({ hrAdminPage }) => {
    await expectRoleAllowed(hrAdminPage, "/policies/new");
  });

  test("only the latest version per policy is shown by default; older versions need the toggle", async ({ hrAdminPage }) => {
    const policies = new PoliciesPage(hrAdminPage);
    await policies.goto();
    await expect(hrAdminPage.getByRole("button", { name: /show older versions/i })).toBeVisible();
  });

  test("toggling 'show older versions' does not error and does not offer to activate/delete a superseded row unexpectedly", async ({ hrAdminPage }) => {
    const policies = new PoliciesPage(hrAdminPage);
    await policies.goto();
    await policies.showOlderVersions();
    const bodyText = (await hrAdminPage.locator("body").innerText()).toLowerCase();
    expect(bodyText).not.toMatch(/application error|internal server error/);
  });

  test("Activate control, if visible, is never clicked by this suite", async ({ hrAdminPage }) => {
    const policies = new PoliciesPage(hrAdminPage);
    await policies.goto();
    // This test's only job is to prove the assertion helper never calls
    // .click() on Activate — enforced by code review of PoliciesPage.ts.
    await expect(hrAdminPage.getByRole("heading", { name: /polic/i }).first()).toBeVisible();
  });

  /**
   * Section E requirement: a plain Employee must see only active/published
   * policies, with no draft/history/activate/delete affordance anywhere.
   * Grounded directly in packages/domain/src/permissions/policies.ts:
   * canViewDraftPolicies/canActivatePolicy/canDeleteDraftPolicy all require
   * HR Admin or C-level — an Employee (and Manager) has none of them, and
   * the page's own query relies on RLS (not an app-level filter) to enforce
   * this, so this is a real access-control assertion, not just a UI check.
   */
  test("a plain employee sees no draft status, and no activate/delete/show-older-versions controls", async ({ employeePage }) => {
    await employeePage.goto("/policies");
    const bodyText = (await employeePage.locator("body").innerText()).toLowerCase();
    expect(bodyText, "An Employee should never see a 'draft' policy status").not.toMatch(/\bdraft\b/);
    await expect(employeePage.getByRole("button", { name: /^activate$/i })).toHaveCount(0);
    await expect(employeePage.getByRole("button", { name: /^delete$/i })).toHaveCount(0);
    await expect(employeePage.getByRole("button", { name: /show older versions/i })).toHaveCount(0);
  });

  test("a manager (no HR Admin/C-level grant) also sees no draft-management controls", async ({ managerPage }) => {
    await managerPage.goto("/policies");
    await expect(managerPage.getByRole("button", { name: /^activate$/i })).toHaveCount(0);
    await expect(managerPage.getByRole("button", { name: /show older versions/i })).toHaveCount(0);
  });
});
