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
    // itself with no navigation required to reach it. Its accessible name
    // (aria-label) is "Clock in" / "Clocked in — ..." (lowercase "in"),
    // deliberately distinct from attendance-clock-card.tsx's own dashboard
    // button text "Clock In" / "Clock Out / switch mode" (capital "In") —
    // a case-INsensitive match here hits both and trips Playwright's
    // strict-mode check, so this must stay case-sensitive.
    await expect(employeePage.getByRole("link", { name: /^Clock in$|^Clocked in —/ })).toBeVisible();
  });

  test("the attendance clock dashboard card is visible near the top of the dashboard", async ({ employeePage }) => {
    const dashboard = new DashboardPage(employeePage);
    await dashboard.goto();
    await expect(employeePage.getByRole("heading", { name: "Attendance clock" })).toBeVisible();
  });

  test("/attendance-clock renders usably at mobile width, with no horizontal overflow", async ({ employeePage }) => {
    const clock = new AttendanceClockPage(employeePage);
    await clock.goto();
    // This is a rendering/reachability check, not an assertion about clock
    // state — the page shows a "Work mode" select when not clocked in, or
    // "Clock Out"/"Switch work mode" controls when already clocked in (e.g.
    // a session left open by a previous run). Either one proves the page
    // rendered its real controls rather than a blank/error state; asserting
    // only "Work mode" made this read-only test wrongly depend on the
    // account never being mid-session.
    await expect(employeePage.getByLabel("Work mode").or(employeePage.getByRole("button", { name: "Clock Out", exact: true }))).toBeVisible();
    const hasHorizontalOverflow = await employeePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow, "/attendance-clock causes horizontal overflow at mobile width").toBe(false);
  });
});
