import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";

/**
 * MUTATING: really deactivates and reactivates a disposable test account.
 * Never run against Production (see README.md).
 *
 * This is the scenario account-deactivation-reactivation.spec.ts does NOT
 * cover: that spec opens a fresh, logged-OUT context and proves a NEW
 * sign-in attempt is rejected after deactivation. It never proves an
 * ALREADY-authenticated session gets cut off. This spec does exactly that —
 * one session, established before deactivation, still holding its cookie
 * when deactivation happens, then making a further request.
 */
test("an existing, already-authenticated session is denied on its next protected request after deactivation — not just future logins", async ({
  browser,
}) => {
  const admin = createTestAdminClient();
  const sysAdmin = await createTestUser(admin, { role: "sys_admin" });
  const target = await createTestUser(admin);

  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Create the target user's session FIRST, before any deactivation —
    // this is the session that must get cut off, not a new login attempt.
    await loginAs(targetPage, target.email, target.password);
    await targetPage.goto("/account/security");
    await expect(targetPage).not.toHaveURL(/\/login/);
    await expect(targetPage.getByRole("heading", { name: "Account & security" })).toBeVisible();

    // 2. A separate System Administrator session deactivates the target
    // through the authorized UI flow — never a direct DB/API bypass.
    await loginAs(adminPage, sysAdmin.email, sysAdmin.password);
    await adminPage.goto("/admin/users");
    const row = adminPage.getByRole("row", { name: new RegExp(target.email) });
    adminPage.once("dialog", (dialog) => dialog.accept("existing-session test"));
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText(/Deactivated/i)).toBeVisible();

    // 3. The target's ALREADY-OPEN session — no new login, same browser
    // context/cookies as step 1 — makes its next protected request. proxy.ts
    // calls supabase.auth.getUser() on every request (not getSession()),
    // which revalidates against the Auth server live; a banned user must be
    // denied here, redirected to /login, unable to reach protected content.
    await targetPage.goto("/account/security");
    await expect(targetPage).toHaveURL(/\/login/);
    await expect(targetPage.getByRole("heading", { name: "Account & security" })).not.toBeVisible();

    // Also confirm a second, different protected page is equally denied —
    // not just the one page this test happened to reload.
    await targetPage.goto("/");
    await expect(targetPage).toHaveURL(/\/login/);

    // 4. Reactivate afterward, per the required test flow — leaves no
    // dangling deactivated disposable account, and proves the account isn't
    // permanently broken by this test.
    adminPage.once("dialog", (dialog) => dialog.accept("existing-session test cleanup"));
    await row.getByRole("button", { name: "Reactivate" }).click();
    await expect(row.getByText("Active")).toBeVisible();

    const restoredContext = await browser.newContext();
    const restoredPage = await restoredContext.newPage();
    await loginAs(restoredPage, target.email, target.password);
    await expect(restoredPage).not.toHaveURL(/\/login/);
    await restoredContext.close();
  } finally {
    await targetContext.close();
    await adminContext.close();
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, sysAdmin.id);
  }
});
