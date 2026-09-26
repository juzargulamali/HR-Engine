import { test, expect } from "../../src/fixtures";
import { getCredentials, hasCredentials, isMutationAuthorized } from "../../src/config";
import { assertApprovedTestEmail } from "../../src/emergencyStop";
import { escapeForRegExp } from "../../src/recordTag";
import { LoginPage } from "../../src/pages/LoginPage";

/**
 * Deactivates and reactivates the dedicated Employee test account ONLY —
 * NEVER the System Administrator account (the actor here, never the
 * target), and never any other account. Runs LAST among the mutating specs
 * (see the "50-" filename prefix and playwright.config.ts's doc comment) —
 * this is also how "stop further mutations" on a critical reactivation
 * failure is enforced: nothing after this file in the mutating project
 * mutates anything (60-audit-verification.spec.ts is read-only), so a
 * thrown error here needs no separate abort mechanism to prevent a further
 * mutation from running in the same invocation.
 *
 * Grounded directly in source: only Sys Admin can toggle account status
 * (packages/domain/src/permissions/users.ts's canManageAccountStatus), and
 * both Deactivate and Reactivate go through a native window.prompt()
 * requiring a non-blank reason (apps/web/src/app/(app)/admin/users/
 * account-status-controls.tsx). Skips cleanly if no Sys Admin test account
 * is configured — this suite never substitutes a different role for it.
 *
 * Recovery structure: EVERY step from the Deactivate click through the
 * session-denial assertions runs inside one try/catch, and reactivation is
 * ALWAYS attempted afterward regardless of whether that block succeeded,
 * threw partway through, or the click itself failed — "might have
 * deactivated" is treated as "assume it did" rather than requiring proof.
 * If reactivation itself then fails, this test fails loudly with the exact
 * manual recovery steps, rather than silently leaving a real account
 * deactivated. Mutating — gated on E2E_MUTATION_AUTHORIZED. The standing
 * authorization for this run explicitly covers this deactivation/
 * reactivation cycle.
 */
test.describe("account status (Employee test account only) @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating account-status test.");

  test("deactivate denies an already-open Employee session; reactivate restores login, or this fails loudly with recovery steps", async ({ sysAdminPage, employeePage, browser }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — account-status mutation requires it and is never attempted with a substitute role.");
    const { email: employeeEmail, password: employeePassword } = getCredentials("employee");

    // Emergency stop: refuse to act on anything but the approved,
    // dedicated Employee test account.
    assertApprovedTestEmail(employeeEmail);

    await sysAdminPage.goto("/admin/users");
    const row = sysAdminPage.getByRole("row", { name: new RegExp(escapeForRegExp(employeeEmail), "i") });
    await expect(row.getByText("Active")).toBeVisible();

    // The Employee's session is already open (employeePage, loaded from
    // storageState) BEFORE any deactivation happens — this is the session
    // that must get cut off, not a new login attempt.
    await employeePage.goto("/account/security");
    await expect(employeePage).not.toHaveURL(/\/login/);

    // --- Everything from here through the session-denial checks is
    // "might have deactivated the account" — any failure inside this block
    // still means reactivation below must be attempted. ---
    let originalError: unknown = null;
    try {
      sysAdminPage.once("dialog", (dialog) => dialog.accept("Production QA run — temporary deactivation, will reactivate immediately"));
      await row.getByRole("button", { name: "Deactivate" }).click();
      await expect(row.getByText(/Deactivated/i)).toBeVisible();

      // The Employee's ALREADY-OPEN session — no new login — makes its next
      // protected request. It must be denied and redirected to /login, not
      // merely blocked on a future login attempt.
      await employeePage.goto("/account/security");
      await expect(employeePage).toHaveURL(/\/login/);
      await employeePage.goto("/");
      await expect(employeePage).toHaveURL(/\/login/);
    } catch (err) {
      originalError = err;
    }

    // --- ALWAYS attempt reactivation now, whether or not the block above
    // threw, and whether or not the click even reached the server. Idempotent:
    // only clicks Reactivate if the row doesn't already read Active. ---
    let reactivationError: unknown = null;
    try {
      await row.waitFor({ state: "visible" });
      const alreadyActive = await row.getByText("Active").isVisible().catch(() => false);
      if (!alreadyActive) {
        sysAdminPage.once("dialog", (dialog) => dialog.accept("Production QA run — reactivation"));
        await row.getByRole("button", { name: "Reactivate" }).click();
        await expect(row.getByText("Active")).toBeVisible();
      }
    } catch (err) {
      reactivationError = err;
    }

    // --- Always attempt a fresh sign-in check too, for diagnostic value,
    // regardless of the outcomes above — a genuinely fresh context, not the
    // stale employeePage session. ---
    let freshLoginWorks = false;
    let freshLoginError: unknown = null;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.signIn(employeeEmail, employeePassword);
      await loginPage.expectSignedIn();
      freshLoginWorks = true;
    } catch (err) {
      freshLoginError = err;
    } finally {
      await context.close();
    }

    if (reactivationError) {
      throw new Error(
        [
          "CRITICAL: automated reactivation of the Employee test account FAILED after a deactivation attempt.",
          `Reactivation error: ${String(reactivationError)}`,
          `Fresh Employee login after this failure: ${freshLoginWorks ? "still works" : `also failed (${String(freshLoginError)})`}`,
          originalError ? `(A separate error also occurred earlier in this test: ${String(originalError)})` : null,
          "",
          "MANUAL RECOVERY REQUIRED NOW:",
          `1. Sign in as Sys Admin (E2E_ADMIN_EMAIL) -> /admin/users -> find the row for ${employeeEmail}.`,
          "2. If it reads 'Deactivated', click 'Reactivate' and give any non-blank reason.",
          "3. If the UI reactivation control itself is broken, the Supabase fallback (see supabase/migrations/*_account_security_controls.sql) is to set that profile's `account_status` column back to 'active' and clear its `banned_until` column directly for this account only.",
          "4. Confirm recovery by signing in as the Employee test account directly.",
          "No further mutating tests run after this one in this invocation (see this file's header comment) — nothing else needs to be stopped.",
        ]
          .filter(Boolean)
          .join("\n"),
        { cause: reactivationError },
      );
    }

    expect(freshLoginWorks, `Employee test account must be able to log in at the end of this test${freshLoginError ? ` (login error: ${String(freshLoginError)})` : ""}`).toBe(true);

    if (originalError) {
      throw originalError;
    }
  });
});
