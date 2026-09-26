import { test, expect } from "../../src/fixtures";
import { getCredentials, hasCredentials } from "../../src/config";
import { isBackupConfirmed } from "../../src/config";
import { assertApprovedTestEmail } from "../../src/emergencyStop";
import { LoginPage } from "../../src/pages/LoginPage";

/**
 * Deactivates and reactivates the dedicated Employee test account ONLY —
 * NEVER the System Administrator account (the actor here, never the
 * target), and never any other account. Runs LAST among the mutating specs
 * (see the "50-" filename prefix and playwright.config.ts's doc comment):
 * deactivating the Employee account could otherwise disrupt any later
 * mutating test that depends on that account's session.
 *
 * Grounded directly in source: only Sys Admin can toggle account status
 * (packages/domain/src/permissions/users.ts's canManageAccountStatus), and
 * both Deactivate and Reactivate go through a native window.prompt()
 * requiring a non-blank reason (apps/web/src/app/(app)/admin/users/
 * account-status-controls.tsx, exercised in this session's earlier
 * security review). Skips cleanly if no Sys Admin test account is
 * configured — this suite never substitutes a different role for it.
 *
 * Mutating — gated on E2E_BACKUP_CONFIRMED. The standing authorization for
 * this run explicitly covers this deactivation/reactivation cycle.
 */
test.describe("account status (Employee test account only) @mutating", () => {
  test.skip(!isBackupConfirmed(), "Mutation not authorized (E2E_BACKUP_CONFIRMED != 'true') — skipping mutating account-status test.");

  test("deactivate denies an already-open Employee session; reactivate restores login", async ({ sysAdminPage, employeePage, browser }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — account-status mutation requires it and is never attempted with a substitute role.");
    const { email: employeeEmail, password: employeePassword } = getCredentials("employee");

    // Emergency stop: refuse to act on anything but the approved,
    // dedicated Employee test account.
    assertApprovedTestEmail(employeeEmail);

    // 1. The Employee's session is already open (employeePage, loaded from
    // storageState) BEFORE any deactivation happens — this is the session
    // that must get cut off, not a new login attempt.
    await employeePage.goto("/account/security");
    await expect(employeePage).not.toHaveURL(/\/login/);

    // 2. Sys Admin deactivates the Employee test account through the
    // authorized UI flow — never a direct DB/API bypass.
    await sysAdminPage.goto("/admin/users");
    const row = sysAdminPage.getByRole("row", { name: new RegExp(employeeEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
    await expect(row.getByText("Active")).toBeVisible();
    sysAdminPage.once("dialog", (dialog) => dialog.accept("Production QA run — temporary deactivation, will reactivate immediately"));
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row.getByText(/Deactivated/i)).toBeVisible();

    try {
      // 3. The Employee's ALREADY-OPEN session — no new login — makes its
      // next protected request. It must be denied and redirected to
      // /login, not merely blocked on a future login attempt.
      await employeePage.goto("/account/security");
      await expect(employeePage).toHaveURL(/\/login/);
      await employeePage.goto("/");
      await expect(employeePage).toHaveURL(/\/login/);
    } finally {
      // 4. Reactivate immediately, regardless of the assertion above's
      // outcome — never leave the Employee test account deactivated.
      sysAdminPage.once("dialog", (dialog) => dialog.accept("Production QA run — reactivation"));
      await row.getByRole("button", { name: "Reactivate" }).click();
      await expect(row.getByText("Active")).toBeVisible();
    }

    // 5. Verify login works again via a genuinely fresh sign-in (not the
    // stale, now-denied employeePage context).
    const context = await browser.newContext();
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.signIn(employeeEmail, employeePassword);
    await loginPage.expectSignedIn();
    await context.close();
  });
});
