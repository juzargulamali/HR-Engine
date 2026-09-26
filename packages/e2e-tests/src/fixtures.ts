import { existsSync } from "node:fs";
import { test as base, expect, type Page, type Browser } from "@playwright/test";
import { authStateFile, getBaseUrl, getRunId, type Role } from "./config";
import { gotoWithRetry } from "./gotoWithRetry";

/**
 * One authenticated Page per role, loaded from a storageState file that
 * tests/auth.setup.ts (the "setup" project — see playwright.config.ts's
 * `dependencies: ["setup"]`) wrote ONCE per role before any real test ran.
 * Each test gets its own fresh BrowserContext/Page built from that saved
 * state — never a shared mutable Page reused across unrelated tests, and
 * never a fresh UI login per test.
 *
 * This replaces an earlier, broken version of this file: the old
 * `<role>Page` fixtures were declared as plain (TEST-scoped, the default)
 * fixtures that called the login UI directly, while only their underlying
 * BrowserContext was worker-scoped — so despite a comment claiming
 * "at most once per worker", every single test that requested a role
 * fixture re-ran a full UI login. A run of N tests meant N (not 1) real
 * sign-ins for that role — a credible cause of the login-timeout failures
 * documented in README.md's "Status as of the first live run", independent
 * of the sandbox network flakiness also noted there.
 */
interface RoleFixtures {
  employeePage: Page;
  managerPage: Page;
  hrAdminPage: Page;
  ceoPage: Page;
  financePage: Page;
  sysAdminPage: Page;
}

interface WorkerFixtures {
  runId: string;
}

async function pageForRole(browser: Browser, role: Role, use: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ baseURL: getBaseUrl(), storageState: authStateFile(role) });
  const page = await context.newPage();
  // storageState only restores cookies/localStorage — it doesn't navigate
  // anywhere. Land on a real authenticated page before handing this off, so
  // every test starts from actual app content instead of about:blank.
  await gotoWithRetry(page, "/");
  await use(page);
  await context.close();
}

/** Optional roles (finance, sysAdmin) skip cleanly if the setup project had
 * no credentials to sign in with for them, rather than failing on a missing
 * storageState file. */
function skipIfNoSavedState(role: Role): void {
  if (!existsSync(authStateFile(role))) {
    test.skip(true, `No saved sign-in for role "${role}" — its test account isn't configured (see tests/auth.setup.ts).`);
  }
}

export const test = base.extend<RoleFixtures, WorkerFixtures>({
  runId: [async ({}, use) => use(getRunId()), { scope: "worker" }],

  employeePage: async ({ browser }, use) => pageForRole(browser, "employee", use),
  managerPage: async ({ browser }, use) => pageForRole(browser, "manager", use),
  hrAdminPage: async ({ browser }, use) => pageForRole(browser, "hrAdmin", use),
  ceoPage: async ({ browser }, use) => pageForRole(browser, "ceo", use),
  financePage: async ({ browser }, use) => {
    skipIfNoSavedState("finance");
    return pageForRole(browser, "finance", use);
  },
  sysAdminPage: async ({ browser }, use) => {
    skipIfNoSavedState("sysAdmin");
    return pageForRole(browser, "sysAdmin", use);
  },
});

export { expect };
export { hasCredentials } from "./config";
