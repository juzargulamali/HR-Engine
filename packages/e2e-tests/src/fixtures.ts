import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { getBaseUrl, getCredentials, hasCredentials, getRunId, type Role } from "./config";
import { LoginPage } from "./pages/LoginPage";

/**
 * One authenticated Page per role, worker-scoped: each worker process logs
 * in as a given role AT MOST ONCE (Playwright caches a worker-scoped
 * fixture's value for every test that worker runs), not once per test.
 * Login happens through the real UI (LoginPage), the same path a real user
 * takes — never a direct API/cookie injection — so session-handling itself
 * is exercised, not bypassed.
 *
 * A test that needs multiple roles at once (e.g. "manager approves an
 * employee's leave request") just requests multiple fixtures — each is
 * backed by its own isolated BrowserContext, so actions in one never leak
 * into another's session, exactly like two different people in two
 * different browsers.
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
  employeeContext: BrowserContext;
  managerContext: BrowserContext;
  hrAdminContext: BrowserContext;
  ceoContext: BrowserContext;
  financeContext: BrowserContext;
  sysAdminContext: BrowserContext;
}

async function loginAs(context: BrowserContext, role: Role): Promise<Page> {
  const page = await context.newPage();
  const { email, password } = getCredentials(role);
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.signIn(email, password);
  await loginPage.expectSignedIn();
  return page;
}

export const test = base.extend<RoleFixtures, WorkerFixtures>({
  runId: [async ({}, use) => use(getRunId()), { scope: "worker" }],

  employeeContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: getBaseUrl() });
    await use(context);
    await context.close();
  }, { scope: "worker" }],
  managerContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: getBaseUrl() });
    await use(context);
    await context.close();
  }, { scope: "worker" }],
  hrAdminContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: getBaseUrl() });
    await use(context);
    await context.close();
  }, { scope: "worker" }],
  ceoContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: getBaseUrl() });
    await use(context);
    await context.close();
  }, { scope: "worker" }],
  financeContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: getBaseUrl() });
    await use(context);
    await context.close();
  }, { scope: "worker" }],
  sysAdminContext: [async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: getBaseUrl() });
    await use(context);
    await context.close();
  }, { scope: "worker" }],

  employeePage: async ({ employeeContext }, use) => use(await loginAs(employeeContext, "employee")),
  managerPage: async ({ managerContext }, use) => use(await loginAs(managerContext, "manager")),
  hrAdminPage: async ({ hrAdminContext }, use) => use(await loginAs(hrAdminContext, "hrAdmin")),
  ceoPage: async ({ ceoContext }, use) => use(await loginAs(ceoContext, "ceo")),
  financePage: async ({ financeContext }, use) => {
    if (!hasCredentials("finance")) {
      test.skip(true, "No Finance test account configured — see the morning report's account-confirmation section.");
    }
    return use(await loginAs(financeContext, "finance"));
  },
  sysAdminPage: async ({ sysAdminContext }, use) => {
    if (!hasCredentials("sysAdmin")) {
      test.skip(true, "No Sys Admin test account configured.");
    }
    return use(await loginAs(sysAdminContext, "sysAdmin"));
  },
});

export { expect };
export { hasCredentials } from "./config";
