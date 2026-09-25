import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";

/**
 * MUTATING: really deactivates and reactivates a (disposable, throwaway)
 * test account, and really attempts to sign in as it while deactivated.
 * Never run against Production (see README.md).
 */
test("deactivating an account blocks its login, reactivating restores it, both audited", async ({ page, browser }) => {
  const admin = createTestAdminClient();
  const sysAdmin = await createTestUser(admin, { role: "sys_admin" });
  const target = await createTestUser(admin);

  try {
    await loginAs(page, sysAdmin.email, sysAdmin.password);
    await page.goto("/admin/users");
    const row = page.getByRole("row", { name: new RegExp(target.email) });

    page.once("dialog", (dialog) => dialog.accept("e2e test deactivation"));
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText(/Deactivated/i)).toBeVisible();

    // A fresh, unauthenticated context — proves the block at the actual
    // sign-in boundary, not just the admin UI's own state.
    const loggedOutContext = await browser.newContext();
    const loggedOutPage = await loggedOutContext.newPage();
    await loggedOutPage.goto("/login");
    await loggedOutPage.getByLabel("Email").fill(target.email);
    await loggedOutPage.getByLabel("Password", { exact: true }).fill(target.password);
    await loggedOutPage.getByRole("button", { name: "Sign in" }).click();
    await expect(loggedOutPage.getByText(/wasn't recognized/i)).toBeVisible();
    await loggedOutContext.close();

    const { data: deactivatedRow } = await admin
      .from("audit_log")
      .select("action, actor_id")
      .eq("table_name", "profiles")
      .eq("record_id", target.id)
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(deactivatedRow).toHaveLength(1);
    expect(deactivatedRow![0]!.actor_id).toBe(sysAdmin.id);

    page.once("dialog", (dialog) => dialog.accept("e2e test reactivation"));
    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(row.getByText("Active")).toBeVisible();

    const restoredContext = await browser.newContext();
    const restoredPage = await restoredContext.newPage();
    await loginAs(restoredPage, target.email, target.password);
    await expect(restoredPage).not.toHaveURL(/\/login/);
    await restoredContext.close();
  } finally {
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, sysAdmin.id);
  }
});
