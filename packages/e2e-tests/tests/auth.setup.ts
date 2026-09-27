import { test as setup } from "@playwright/test";
import { ALL_ROLES, authStateFile, getCredentials, hasCredentials, type Role } from "../src/config";
import { assertOnAllowedHost } from "../src/hostGuard";
import { LoginPage } from "../src/pages/LoginPage";

/**
 * Standard Playwright authenticated-state pattern: this "setup" project
 * (see playwright.config.ts) runs once, before the real test projects
 * (which declare `dependencies: ["setup"]`), and signs in as each
 * configured role exactly once via the real UI, saving the resulting
 * storageState to a gitignored file. Every other spec's role fixture
 * (src/fixtures.ts) then just loads that file into a fresh context — it
 * never calls the login form itself.
 *
 * This replaces an earlier, incorrect design where each `<role>Page`
 * fixture called the login flow directly: that fixture was declared with
 * TEST scope (the default), not worker scope, so despite a comment
 * claiming otherwise, it re-authenticated via the real UI on every single
 * test that requested it — 30 tests meant up to 30 real Supabase sign-ins
 * per run, not one per role. That repeated load is a credible contributor
 * to the login-timeout failures seen in this suite's first live run,
 * separate from (and probably larger than) the sandbox network flakiness
 * also documented in README.md.
 *
 * One `setup(...)` block per role means a failure here names the exact
 * role that failed, in this project's own report — not a generic
 * "Test timeout ... while setting up XPage" buried inside an unrelated
 * functional test. An optional role (finance, sysAdmin) with no configured
 * account skips cleanly rather than failing the whole setup project.
 */
for (const role of ALL_ROLES) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    setup.skip(!hasCredentials(role), `No test account configured for role "${role}".`);
    const { email, password } = getCredentials(role);
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.signIn(email, password);
    await loginPage.expectSignedIn();
    // Sign-in must land on this app (or its own Supabase project) — never
    // an unexpected external origin (e.g. a hijacked/misconfigured redirect).
    assertOnAllowedHost(page.url());
    await page.context().storageState({ path: authStateFile(role as Role) });
  });
}
