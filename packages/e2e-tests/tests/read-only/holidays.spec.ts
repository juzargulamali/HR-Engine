import { test, expect } from "../../src/fixtures";
import { HolidaysPage } from "../../src/pages/AppPages";

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
    await employeePage.goto("/holidays");
    await hrAdminPage.goto("/holidays");
    await expect(employeePage.getByRole("button", { name: /add a holiday/i })).toHaveCount(0);
    // HR Admin's own grant is scoped to a specific country; if none of
    // their countries are manageable here (data-dependent), this assertion
    // may need revisiting — flagged rather than silently weakened.
    await expect(hrAdminPage.getByRole("button", { name: /add a holiday/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});
