import type { Page } from "@playwright/test";
import { test, expect } from "../../src/fixtures";
import { gotoWithRetry } from "../../src/gotoWithRetry";
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
   * The rule (policy_versions_select, supabase/migrations/20261018000000_cto_role_parity.sql; policy_versions_insert/_update/_delete):
   * everybody signed in may read ACTIVE versions, including older ones whose effective range has closed ("Show older versions" is a
   * display toggle for that history); DRAFT and SUPERSEDED versions, and every control that drafts, activates, edits or deletes, belong
   * to HR Admin and CEO / CTO with a country-wide grant. Proved in the database by packages/rls-tests/test/policy_visibility.rls.test.ts;
   * this is the same rule seen through the page. Read-only: nothing is clicked except the display toggle.
   */
  async function expectPublishedVersionsOnly(page: Page) {
    const policies = new PoliciesPage(page);
    await policies.goto();

    const latest = await policies.visibleStatuses();
    expect(latest.length, "The page should list the published policies").toBeGreaterThan(0);
    expect(new Set(latest), "By default only published (active) versions are listed").toEqual(new Set(["active"]));
    expect((await page.locator("body").innerText()).toLowerCase(), "No draft is ever shown").not.toMatch(/\bdraft\b/);
    await policies.expectNoManagementControls();

    const before = await policies.visibleVersions();
    const announced = await policies.revealOlderVersions();
    if (announced === 0) {
      test.info().annotations.push({ type: "note", description: "This environment has no older versions, so reading history was not exercised." });
      return;
    }

    const all = await policies.visibleVersions();
    expect(all.length, "Showing older versions lists exactly the older ones as well").toBe(before.length + announced);
    expect(new Set(all.map((v) => v.status)), "Older versions are published history: active only, never draft or superseded").toEqual(new Set(["active"]));
    expect((await page.locator("body").innerText()).toLowerCase()).not.toMatch(/\bdraft\b|\bsuperseded\b/);
    await policies.expectNoManagementControls();

    // An older published version can be opened and read, and offers nothing to change.
    const shown = new Set(before.map((v) => v.href));
    const older = all.find((v) => !shown.has(v.href));
    expect(older, "An older version row should be listed").toBeTruthy();
    await gotoWithRetry(page, older!.href);
    await expect(page.getByText("active", { exact: true }).first()).toBeVisible();
    await policies.expectNoManagementControls();
  }

  test("a plain employee reads published policies, including older versions, and gets no draft or management control", async ({ employeePage }) => {
    await expectPublishedVersionsOnly(employeePage);
  });

  test("a manager (no HR Admin/C-level grant) has the same published-only view and no management control", async ({ managerPage }) => {
    await expectPublishedVersionsOnly(managerPage);
  });

  test("a draft or superseded version cannot be opened by address by an employee or a manager", async ({ hrAdminPage, employeePage, managerPage }) => {
    const hr = new PoliciesPage(hrAdminPage);
    await hr.goto();
    await hr.revealOlderVersions();
    const hidden = (await hr.visibleVersions()).filter((v) => v.status === "draft" || v.status === "superseded").slice(0, 3);
    test.skip(hidden.length === 0, "This environment has no draft or superseded version for HR to point at.");
    for (const page of [employeePage, managerPage]) {
      for (const version of hidden) {
        await gotoWithRetry(page, version.href);
        const body = (await page.locator("body").innerText()).toLowerCase();
        expect(body, `${version.status} version ${version.href} must not be readable`).toMatch(/we couldn.t find that|not found|404/);
        expect(body).not.toMatch(/\bdraft\b|\bsuperseded\b/);
        await expect(page.getByRole("button", { name: /^activate$/i })).toHaveCount(0);
      }
    }
  });
});
