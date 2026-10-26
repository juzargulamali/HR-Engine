import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";
import { openAccountPanel } from "../../src/peopleAccess";

/**
 * Requirement 10: "unauthorized users cannot access admin account controls"
 * / "authorized admin can see permitted account controls". Also doubles as
 * the role-isolation check for this feature: Sys Admin is a GLOBAL role in
 * this schema (has_role('sys_admin') requires an unscoped grant — a
 * company-scoped one doesn't satisfy it, see the migration's RPCs), so
 * there's no "Sys Admin of Company A vs. Company B" scenario to test here.
 * The isolation that matters is HR Admin (broad employee-data access) never
 * gaining account/auth-admin access — proven by the hr_admin case below.
 */
test.describe("admin account controls visibility", () => {
  const admin = createTestAdminClient();
  let plainUser: TestUser;
  let hrAdminUser: TestUser;
  let sysAdminUser: TestUser;

  test.beforeAll(async () => {
    plainUser = await createTestUser(admin);
    hrAdminUser = await createTestUser(admin, { role: "hr_admin" });
    sysAdminUser = await createTestUser(admin, { role: "sys_admin" });
  });

  test.afterAll(async () => {
    await Promise.all([plainUser, hrAdminUser, sysAdminUser].map((u) => deleteTestUser(admin, u.id)));
  });

  test("a plain employee has nothing to manage in People & Access, and the old /admin/users address leads there", async ({ page }) => {
    await loginAs(page, plainUser.email, plainUser.password);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/people-access/);
    await expect(page.getByText(/cannot manage people or access/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  });

  test("an HR Admin — full employee-data access elsewhere — still gets no account controls: no Account tab, no Deactivate button", async ({ page }) => {
    await loginAs(page, hrAdminUser.email, hrAdminUser.password);
    await page.goto(`/people-access?person=u:${plainUser.id}&tab=account`);
    await expect(page.getByRole("link", { name: "Account", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send password reset" })).toHaveCount(0);
  });

  test("a Sys Admin sees account-status controls under the person's Account tab", async ({ page }) => {
    await loginAs(page, sysAdminUser.email, sysAdminUser.password);
    await page.goto("/people-access");
    await expect(page.getByRole("heading", { name: "People & Access" })).toBeVisible();

    const account = await openAccountPanel(page, plainUser.email);
    await expect(account.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(account.getByRole("button", { name: "Deactivate" })).toBeVisible();
    await expect(account.getByRole("button", { name: "Send password reset" })).toBeVisible();
  });
});
