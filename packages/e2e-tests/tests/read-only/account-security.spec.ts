import { test, expect } from "../../src/fixtures";
import { getCredentials } from "../../src/config";

/**
 * Account & Security UI, read-only only: every case here either fails
 * client/server-side validation before any real state changes, or is
 * deliberately restricted to a definitely-nonexistent email so it can never
 * send a real password-reset email to anyone, test account included (the
 * standing authorization for this suite explicitly forbids that). A full
 * successful password change (which does mutate the account and signs out
 * other sessions) is out of scope for this run — it wasn't authorized.
 */
test.describe("password recovery UI", () => {
  test("login page links to the forgot-password flow", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("heading", { name: /Forgot your password/i })).toBeVisible();
  });

  test("visiting /reset-password with no token shows an invalid-link message, not a form", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(page.getByLabel("New password")).not.toBeVisible();
  });

  test("visiting /reset-password with a garbage token also shows the invalid-link message", async ({ page }) => {
    await page.goto("/reset-password#access_token=not-a-real-token&refresh_token=not-a-real-token");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
  });

  test("visiting /set-password with no token shows its own invalid-link message", async ({ page }) => {
    await page.goto("/set-password");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(page.getByText(/ask HR to send you a new invite/i)).toBeVisible();
  });

  /**
   * NEVER submits a real (test or otherwise) account's email here — only
   * two distinct, definitely-nonexistent addresses, so nothing is ever
   * emailed. This confirms the neutral message renders and is stable, but
   * deliberately does NOT re-verify (as the original design behind this
   * feature did) that an existing account gets the identical message —
   * doing that safely would require submitting a real test account's email,
   * which sends a real recovery email and is out of scope for this run.
   */
  test("shows a neutral message for a nonexistent account, identical across two different nonexistent addresses", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("definitely-not-a-real-account@example.invalid");
    await page.getByRole("button", { name: "Send reset link" }).click();
    const first = await page.getByText(/if an account exists/i).textContent();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("also-not-a-real-account-2@example.invalid");
    await page.getByRole("button", { name: "Send reset link" }).click();
    const second = await page.getByText(/if an account exists/i).textContent();

    expect(first).toBe(second);
  });
});

test.describe("change password validation", () => {
  test.beforeEach(async ({ employeePage }) => {
    await employeePage.goto("/account/security");
  });

  test("rejects an incorrect current password", async ({ employeePage }) => {
    await employeePage.getByLabel("Current password").fill("not-the-real-password");
    await employeePage.getByLabel("New password", { exact: true }).fill("Correct1Horse!Battery");
    await employeePage.getByLabel("Confirm new password").fill("Correct1Horse!Battery");
    await employeePage.getByRole("button", { name: "Change password" }).click();
    await expect(employeePage.getByText(/current password is incorrect/i)).toBeVisible();
  });

  test("rejects a new password that doesn't meet requirements", async ({ employeePage }) => {
    const { password } = getCredentials("employee");
    await employeePage.getByLabel("Current password").fill(password);
    await employeePage.getByLabel("New password", { exact: true }).fill("short1A");
    await employeePage.getByLabel("Confirm new password").fill("short1A");
    await employeePage.getByRole("button", { name: "Change password" }).click();
    await expect(employeePage.getByText(/at least 10 characters|mix in at least 3/i)).toBeVisible();
  });

  test("rejects mismatched new-password confirmation", async ({ employeePage }) => {
    const { password } = getCredentials("employee");
    await employeePage.getByLabel("Current password").fill(password);
    await employeePage.getByLabel("New password", { exact: true }).fill("Correct1Horse!Battery");
    await employeePage.getByLabel("Confirm new password").fill("Different1Horse!Battery");
    await employeePage.getByRole("button", { name: "Change password" }).click();
    await expect(employeePage.getByText(/don't match/i)).toBeVisible();
  });

  test("rejects reusing the current password as the new one (never actually changes it)", async ({ employeePage }) => {
    const { password } = getCredentials("employee");
    await employeePage.getByLabel("Current password").fill(password);
    await employeePage.getByLabel("New password", { exact: true }).fill(password);
    await employeePage.getByLabel("Confirm new password").fill(password);
    await employeePage.getByRole("button", { name: "Change password" }).click();

    // Capture whatever the app actually shows — never the password itself —
    // so a failure here reports real evidence instead of a bare "text not
    // found". apps/web/src/lib/actions/password.ts's changePassword()
    // checks, in order: mismatch -> password-strength -> reuse -> current-
    // password verification. newPassword === confirmPassword here, so
    // mismatch can't be why a different message shows; if the account's own
    // current password doesn't satisfy the app's own strength policy (10+
    // chars, 3 of 4 character classes), the strength check reports THAT
    // instead of ever reaching the reuse check below it — a legitimate,
    // order-of-validation outcome, not a bug, and distinct from a silent
    // no-op (no alert at all), which would be one.
    const alert = employeePage.getByRole("alert");
    await expect(alert, "Resubmitting the current password as the new one must show a rejection message, not silently succeed.").toBeVisible({
      timeout: 10_000,
    });
    // .innerText() requires a completed layout pass and can race a just-
    // mounted element (confirmed live: it returned "" for this exact alert
    // right after toBeVisible() resolved, twice, even though the app only
    // ever renders this Alert with a non-empty state.error string —
    // apps/web/src/app/(app)/account/security/change-password-form.tsx's
    // `{state.error ? <Alert>{state.error}</Alert> : null}`, its only
    // role="alert" element on this page). .textContent() reads the DOM
    // tree directly with no layout dependency.
    const message = ((await alert.textContent()) ?? "").trim();
    await test.info().attach("change-password-reuse-message", { body: message, contentType: "text/plain" });
    expect(message, `Unexpected validation message for password reuse: "${message}"`).toMatch(
      /different from your current one|at least 10 characters|mix in at least 3/i,
    );
  });

  test("shows the password requirements before submission", async ({ employeePage }) => {
    await expect(employeePage.getByText(/at least 10 characters/i)).toBeVisible();
  });
});
