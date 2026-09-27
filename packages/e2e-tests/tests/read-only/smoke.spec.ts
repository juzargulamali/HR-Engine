import { test, expect } from "../../src/fixtures";
import { DashboardPage } from "../../src/pages/AppPages";
import { ROUTES, visitDirectly } from "../../src/pages/Nav";

/**
 * Broadest possible read-only pass: every role can sign in and every route
 * renders SOMETHING for an authenticated user (never a crash/500). Run this
 * first — a failure here means the environment itself isn't ready, and the
 * more specific specs below aren't worth running yet.
 */
test.describe("smoke @smoke", () => {
  test("dashboard renders for each role", async ({ employeePage, managerPage, hrAdminPage, ceoPage }) => {
    for (const page of [employeePage, managerPage, hrAdminPage, ceoPage]) {
      const dashboard = new DashboardPage(page);
      await dashboard.goto();
      await dashboard.expectHeaderVisible();
    }
  });

  test("every top-level route renders without error for HR Admin", async ({ hrAdminPage }) => {
    for (const route of ROUTES) {
      const { finalUrl, bodyText } = await visitDirectly(hrAdminPage, route);
      expect(bodyText, `${route} rendered no content at all (final URL: ${finalUrl})`).not.toBe("");
      expect(bodyText.toLowerCase(), `${route} looks like a crashed/error page`).not.toMatch(/application error|internal server error|unhandled/);
    }
  });
});
