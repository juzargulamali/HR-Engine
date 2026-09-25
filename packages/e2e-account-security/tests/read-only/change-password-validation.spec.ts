import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";

/**
 * Every case here fails before any real password change happens — read-only
 * with respect to the account's actual password. A full successful change
 * (which does mutate the account and signs out other sessions) lives in
 * tests/mutating/.
 */
test.describe("change password validation", () => {
  const admin = createTestAdminClient();
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser(admin);
  });
  test.afterAll(async () => deleteTestUser(admin, user.id));

  test.beforeEach(async ({ page }) => {
    await loginAs(page, user.email, user.password);
    await page.goto("/account/security");
  });

  test("rejects an incorrect current password", async ({ page }) => {
    await page.getByLabel("Current password").fill("not-the-real-password");
    await page.getByLabel("New password", { exact: true }).fill("Correct1Horse!Battery");
    await page.getByLabel("Confirm new password").fill("Correct1Horse!Battery");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/current password is incorrect/i)).toBeVisible();
  });

  test("rejects a new password that doesn't meet requirements", async ({ page }) => {
    await page.getByLabel("Current password").fill(user.password);
    await page.getByLabel("New password", { exact: true }).fill("short1A");
    await page.getByLabel("Confirm new password").fill("short1A");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/at least 10 characters|mix in at least 3/i)).toBeVisible();
  });

  test("rejects mismatched new-password confirmation", async ({ page }) => {
    await page.getByLabel("Current password").fill(user.password);
    await page.getByLabel("New password", { exact: true }).fill("Correct1Horse!Battery");
    await page.getByLabel("Confirm new password").fill("Different1Horse!Battery");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/don't match/i)).toBeVisible();
  });

  test("rejects reusing the current password as the new one", async ({ page }) => {
    await page.getByLabel("Current password").fill(user.password);
    await page.getByLabel("New password", { exact: true }).fill(user.password);
    await page.getByLabel("Confirm new password").fill(user.password);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText(/different from your current one/i)).toBeVisible();
  });

  test("shows the password requirements before submission", async ({ page }) => {
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible();
  });
});
