import { test, expect } from "../../src/fixtures";
import { HolidaysPage } from "../../src/pages/AppPages";
import { expectRoleAllowed } from "../../src/pages/Nav";

/**
 * Read-only. This suite never asserts on specific holiday dates (e.g. UAE's
 * Hijri-calendar public holidays) since those shift yearly and are not
 * something this suite should invent or hardcode — only that the page
 * renders and that "manage" controls are correctly scoped to HR Admin. Never
 * clicks "Add a holiday" — a real company holiday must never be created or
 * changed by this suite.
 */
test.describe("holidays", () => {
  test("renders for every role, with no crash", async ({ employeePage, hrAdminPage }) => {
    const employeeHolidays = new HolidaysPage(employeePage);
    const hrHolidays = new HolidaysPage(hrAdminPage);
    await employeeHolidays.goto();
    await hrHolidays.goto();
    expect((await employeePage.locator("body").innerText()).length).toBeGreaterThan(0);
    expect((await hrAdminPage.locator("body").innerText()).length).toBeGreaterThan(0);
  });

  test("'Add a holiday' is offered to HR Admin but not to a plain employee (never clicked)", async ({ employeePage, hrAdminPage }) => {
    // canManageHolidays(grants, countryCode) (apps/web/src/app/(app)/holidays/page.tsx)
    // is exactly isHrAdmin(grants, { countryCode }) — the identical check
    // canDraftPolicy uses for /policies/new's own gate
    // (packages/domain/src/permissions/policies.ts). Confirming HR Admin
    // can reach /policies/new proves their grant is genuinely
    // country-scoped, independent of this page, before assuming the
    // holidays page's "Add a holiday" section follows from the same grant.
    await expectRoleAllowed(hrAdminPage, "/policies/new");

    await employeePage.goto("/holidays");
    await hrAdminPage.goto("/holidays");

    // "Add a holiday" is a CardHeader/CardTitle (a heading), not a button —
    // the form's own submit button is labeled "Add" (add-holiday-form.tsx).
    // Only the heading is asserted here; "Add" is never clicked.
    await expect(employeePage.getByRole("heading", { name: /add a holiday/i })).toHaveCount(0);
    await expect(hrAdminPage.getByRole("heading", { name: /add a holiday/i })).toBeVisible({ timeout: 10_000 });
  });
});
