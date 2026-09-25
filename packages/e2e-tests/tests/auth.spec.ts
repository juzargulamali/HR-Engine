import { test, expect } from "../src/fixtures";
import { LoginPage } from "../src/pages/LoginPage";
import { expectRedirectedToLogin } from "../src/pages/Nav";
import { getCredentials } from "../src/config";

/**
 * Session/auth handling. Read-only: no records created, safe to run without
 * backup confirmation.
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
});
