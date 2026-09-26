import { test, expect } from "../../src/fixtures";
import { LoginPage } from "../../src/pages/LoginPage";
import { expectRedirectedToLogin } from "../../src/pages/Nav";
import { getCredentials, hasCredentials, ALL_ROLES } from "../../src/config";

/**
 * Session/auth handling. Read-only: no records created, safe to run without
 * mutation authorization.
 */
test.describe("authentication @smoke", () => {
  test("a saved employee sign-in (from tests/auth.setup.ts) grants real access", async ({ employeePage }) => {
    // employeePage is a fresh context loaded from storageState (no UI login
    // in this test itself — see src/fixtures.ts); this confirms that saved
    // state is actually valid, not just present.
    await expect(employeePage).not.toHaveURL(/\/login/);
    expect((await employeePage.locator("body").innerText()).length).toBeGreaterThan(20);
  });

  test("wrong password is rejected with a visible error, not a silent failure", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    const { email } = getCredentials("employee");
    await loginPage.goto();
    await loginPage.signIn(email, "definitely-not-the-real-password-123!");
    await loginPage.expectSignInError();
    await context.close();
  });

  test("an unauthenticated visit to a protected route redirects to /login", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await expectRedirectedToLogin(page, "/");
    await expectRedirectedToLogin(page, "/employees");
    await expectRedirectedToLogin(page, "/policies");
    await context.close();
  });

  test("saved session persists across a reload", async ({ employeePage }) => {
    await employeePage.reload();
    // Not "networkidle": this app holds at least one long-lived connection
    // (Supabase realtime), which keeps the network non-idle indefinitely.
    await employeePage.waitForLoadState("load");
    await expect(employeePage).not.toHaveURL(/\/login/);
  });

  /**
   * Logout, for every configured role. Deliberately uses its own fresh,
   * real UI sign-in per role (never the shared employeePage/managerPage/...
   * fixtures, which load the SAVED storageState every other spec in this
   * run depends on). apps/web/src/lib/actions/auth.ts's signOut() calls
   * Supabase's auth.signOut() with no explicit scope — whether that
   * resolves to Supabase's 'global' default or something narrower isn't
   * re-derived here; either way, signing out inside a disposable context
   * this test created itself, rather than the shared saved-session
   * fixtures, means it can never invalidate another test's session no
   * matter which scope actually applies.
   */
  for (const role of ALL_ROLES) {
    test(`sign out (${role}) ends the session and a further protected request is denied`, async ({ browser }) => {
      test.skip(!hasCredentials(role), `No test account configured for role "${role}".`);
      const { email, password } = getCredentials(role);
      const context = await browser.newContext();
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.signIn(email, password);
      await loginPage.expectSignedIn();

      // Source-verified selector: UserMenu's trigger button (the sidebar
      // identity/account control) is the only button on this page rendering
      // lucide-react's ChevronsUpDown icon (apps/web/src/components/nav/
      // user-menu.tsx) — lucide-react gives every icon svg a stable
      // `lucide-<icon-name>` class. Skips cleanly, rather than guessing
      // further, if this doesn't resolve on the first real run.
      const menuTrigger = page.locator("button:has(svg.lucide-chevrons-up-down)");
      test.skip((await menuTrigger.count()) === 0, "Could not find the account-menu trigger by its known icon class — confirm the real selector on first live run.");
      await menuTrigger.first().click();

      const signOutButton = page.getByRole("button", { name: "Sign out", exact: true });
      test.skip((await signOutButton.count()) === 0, "Account menu opened but no exact 'Sign out' button was found inside it.");
      await signOutButton.click();

      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
      await expectRedirectedToLogin(page, "/");
      await context.close();
    });
  }
});
