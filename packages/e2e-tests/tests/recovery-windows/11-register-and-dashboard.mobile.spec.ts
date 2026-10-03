import { test, expect } from "../../src/fixtures";
import { gotoWithRetry } from "../../src/gotoWithRetry";

/**
 * Phone-sized READ-ONLY checks (Pixel 5) for the new attendance screens. Runs only under the
 * dedicated `preview-recovery-windows-mobile` project — see 10-register-and-dashboard.spec.ts.
 */
async function hasPageLevelHorizontalOverflow(page: import("@playwright/test").Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

test.describe("phone layout @recovery-windows", () => {
  test("the dashboard status card is readable on a phone: text status, action, no overflow, FAB present", async ({ employeePage }) => {
    await gotoWithRetry(employeePage, "/");
    const heading = employeePage.getByRole("heading", { name: "Attendance clock" });
    await expect(heading).toBeVisible();
    await expect(employeePage.locator("[data-clock-status]").first()).toHaveText(/^(Clocked in|Clocked out|Not started)/);
    await expect(employeePage.getByRole("link", { name: /^Clock In$|^Clock Out$/ })).toBeVisible();
    // The mobile shortcut still works alongside the card.
    await expect(employeePage.getByRole("link", { name: /^Clock in$|^Clocked in —/ })).toBeVisible();
    expect(await hasPageLevelHorizontalOverflow(employeePage), "dashboard overflows horizontally on a phone").toBe(false);
  });

  test("the HR register scrolls its table inside its own container; the page itself never overflows", async ({ hrAdminPage }) => {
    await gotoWithRetry(hrAdminPage, "/attendance");
    await expect(hrAdminPage.getByRole("heading", { name: "Attendance", level: 1 })).toBeVisible();
    await expect(hrAdminPage.getByText(/^Last updated \d{2}:\d{2}:\d{2}$/)).toBeVisible();
    expect(await hasPageLevelHorizontalOverflow(hrAdminPage), "register overflows horizontally on a phone").toBe(false);
  });

  test("the alerts page is usable on a phone for HR Admin", async ({ hrAdminPage }) => {
    await gotoWithRetry(hrAdminPage, "/alerts");
    await expect(hrAdminPage.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
    expect(await hasPageLevelHorizontalOverflow(hrAdminPage), "alerts overflows horizontally on a phone").toBe(false);
  });
});
