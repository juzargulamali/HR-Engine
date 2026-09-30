import { test, expect } from "../../src/fixtures";
import { DashboardPage } from "../../src/pages/AppPages";
import { AttendanceClockPage } from "../../src/pages/AttendanceClockPage";

/**
 * Runs only under the `mobile-smoke` Playwright project (see
 * playwright.config.ts's testMatch on *.mobile.spec.ts under tests/
 * read-only/). Read-only: viewport/rendering/reachability checks for
 * "attendance controls are immediately accessible on mobile", never a
 * mutation.
 */
test.describe("attendance clock: mobile accessibility @smoke", () => {
  test("the mobile floating clock shortcut is visible on the dashboard without opening the nav drawer", async ({ employeePage }) => {
    const dashboard = new DashboardPage(employeePage);
    await dashboard.goto();
    await dashboard.expectHeaderVisible();
    // clock-fab.tsx: fixed-position, md:hidden — present on the dashboard
    // itself with no navigation required to reach it.
    await expect(employeePage.getByRole("link", { name: /clock in|clocked in/i })).toBeVisible();
  });

  test("the attendance clock dashboard card is visible near the top of the dashboard", async ({ employeePage }) => {
    const dashboard = new DashboardPage(employeePage);
    await dashboard.goto();
    await expect(employeePage.getByRole("heading", { name: "Attendance clock" })).toBeVisible();
  });

  test("/attendance-clock renders usably at mobile width, with no horizontal overflow", async ({ employeePage }) => {
    const clock = new AttendanceClockPage(employeePage);
    await clock.goto();
    await expect(employeePage.getByLabel("Work mode")).toBeVisible();
    const hasHorizontalOverflow = await employeePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow, "/attendance-clock causes horizontal overflow at mobile width").toBe(false);
  });
});
