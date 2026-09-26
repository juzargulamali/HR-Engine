import { test, expect } from "../../src/fixtures";
import { LoginPage } from "../../src/pages/LoginPage";
import { expectRedirectedToLogin } from "../../src/pages/Nav";
import { getCredentials, hasCredentials } from "../../src/config";

/**
 * "Sign out of all devices" (apps/web/src/lib/actions/auth.ts's
 * signOutEverywhere(), apps/web/src/app/(app)/account/security/
 * session-controls.tsx) — the one real, intentional use of Supabase's
 * `scope: "global"`. Verifying this for real means signing out one session
 * and confirming a SEPARATE, independent session for the SAME account also
 * ends — which is exactly the effect that made the ordinary "Sign out"
 * button dangerous to test carelessly (see auth.spec.ts): global scope
 * revokes every session for the account, including ones this test never
 * directly touched.
 *
 * That's why this lives in its own file, named to sort alphabetically
 * LAST among tests/read-only/*.spec.ts (workers:1 + fullyParallel:false
 * means Playwright runs files in that order): every other read-only spec
 * that uses managerPage (rbac.spec.ts's full matrix, smoke.spec.ts, etc.)
 * has already run by the time this executes, so ending every Manager
 * session here can't break anything later in this same invocation.
 * Deliberately uses Manager, not Employee — smoke.mobile.spec.ts (a
 * different Playwright project, "mobile-smoke", which still runs after
 * "read-only" completes) only ever uses employeePage, so it's unaffected
 * either way, but this avoids the one role it does depend on.
 */
test.describe("sign out of all devices @smoke", () => {
  test("ends every session for the account, not just the one that clicked it", async ({ browser }) => {
    test.skip(!hasCredentials("manager"), "No Manager test account configured.");
    const { email, password } = getCredentials("manager");

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const loginA = new LoginPage(pageA);
    await loginA.goto();
    await loginA.signIn(email, password);
    await loginA.expectSignedIn();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const loginB = new LoginPage(pageB);
    await loginB.goto();
    await loginB.signIn(email, password);
    await loginB.expectSignedIn();

    try {
      await pageA.goto("/account/security");
      await pageA.getByRole("button", { name: "Sign out of all devices", exact: true }).click();
      await pageA.getByRole("button", { name: "Confirm", exact: true }).click();

      // A ends.
      await expect(pageA).toHaveURL(/\/login/, { timeout: 15_000 });

      // B — a separate session for the SAME account, never itself signed
      // out — must ALSO end. This is the actual proof of "every device",
      // not just that A's own click worked.
      await pageB.reload();
      await pageB.waitForLoadState("load");
      await expect(pageB, "A separate session for the same account was still signed in after 'Sign out of all devices' — this is not actually ending every session.").toHaveURL(/\/login/, { timeout: 15_000 });
      await expectRedirectedToLogin(pageB, "/");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
