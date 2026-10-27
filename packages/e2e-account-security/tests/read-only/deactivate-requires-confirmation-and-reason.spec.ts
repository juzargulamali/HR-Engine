import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";
import { openAccountPanel } from "../../src/peopleAccess";

/**
 * Proves the confirmation+reason requirement WITHOUT actually deactivating
 * anything — dismissing the prompt (returning null, as if the admin hit
 * Cancel) must abort before the server action is ever called. The
 * corresponding "reason accepted -> account really deactivates" case is in
 * tests/mutating/, since that one is a real, hard-to-reverse state change.
 */
test("dismissing the reason prompt aborts the deactivation — no state change", async ({ page }) => {
  const admin = createTestAdminClient();
  const sysAdmin = await createTestUser(admin, { role: "sys_admin" });
  const target = await createTestUser(admin);

  try {
    await loginAs(page, sysAdmin.email, sysAdmin.password);
    const account = await openAccountPanel(page, target.email);

    page.once("dialog", (dialog) => dialog.dismiss());
    await account.getByRole("button", { name: "Deactivate" }).click();

    // No network round-trip should have happened — the badge stays Active.
    await page.waitForTimeout(500);
    await expect(account.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(account.getByText(/Deactivated/i)).not.toBeVisible();
  } finally {
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, sysAdmin.id);
  }
});

test("submitting a blank reason also aborts the deactivation", async ({ page }) => {
  const admin = createTestAdminClient();
  const sysAdmin = await createTestUser(admin, { role: "sys_admin" });
  const target = await createTestUser(admin);

  try {
    await loginAs(page, sysAdmin.email, sysAdmin.password);
    const account = await openAccountPanel(page, target.email);

    page.once("dialog", (dialog) => dialog.accept("   "));
    await account.getByRole("button", { name: "Deactivate" }).click();

    await page.waitForTimeout(500);
    await expect(account.getByText("Active", { exact: true }).first()).toBeVisible();
  } finally {
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, sysAdmin.id);
  }
});
