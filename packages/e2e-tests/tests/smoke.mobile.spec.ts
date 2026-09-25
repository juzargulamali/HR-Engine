import { test, expect } from "../src/fixtures";
import { DashboardPage } from "../src/pages/AppPages";
import { LeavePage } from "../src/pages/LeavePage";

/**
 * Runs only under the `mobile-smoke` Playwright project (see
 * playwright.config.ts's testMatch). Deliberately small and read-only: a
 * viewport/rendering check, not a re-run of the full functional suite.
 */
test.describe("mobile smoke @smoke", () => {
  test("dashboard is usable on a mobile viewport", async ({ employeePage }) => {
    const dashboard = new DashboardPage(employeePage);
    await dashboard.goto();
    await dashboard.expectHeaderVisible();
    // No horizontal scrollbar on a phone-width layout.
    const hasHorizontalOverflow = await employeePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow, "Dashboard causes horizontal overflow at mobile width").toBe(false);
  });

  test("leave request form is reachable and usable on mobile", async ({ employeePage }) => {
    const leavePage = new LeavePage(employeePage);
    await leavePage.gotoNew();
    await expect(employeePage.locator("#startDate")).toBeVisible();
  });
});
