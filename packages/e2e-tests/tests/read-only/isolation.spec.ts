import { test, expect } from "../../src/fixtures";
import { EmployeesPage } from "../../src/pages/AppPages";

/**
 * Cross-employee/company/country isolation. Confirmed from source
 * (employees/page.tsx): the employees list has NO role-based deny — its row
 * set is entirely determined by RLS on the `employees` table itself, scoped
 * by the viewer's company/country grants. So the correct assertion here is
 * "a plain employee sees fewer/different rows than HR Admin sees", not "a
 * plain employee is denied the page" — this is a data-scoping test, not an
 * access-control test.
 *
 * A genuine cross-COMPANY isolation check (a test identity in one company
 * unable to see another company's data) is NOT covered here: the dedicated
 * E2E test accounts configured for this suite all belong to one company.
 * This is a real, reported coverage limitation, not something to fabricate
 * by inventing a second company's test account.
 *
 * Read-only: lists only, no records created.
 */
test.describe("cross-employee / cross-company isolation", () => {
  test("a plain employee's directory view is not broader than HR Admin's", async ({ employeePage, hrAdminPage }) => {
    const employeeDirectory = new EmployeesPage(employeePage);
    const hrDirectory = new EmployeesPage(hrAdminPage);
    await employeeDirectory.goto();
    await hrDirectory.goto();

    const employeeRowCount = await employeePage.getByRole("row").count();
    const hrRowCount = await hrAdminPage.getByRole("row").count();

    // HR Admin (company-wide/cross-company per their grants) should never
    // see FEWER rows than a single employee's own scoped view. Equality is
    // acceptable (e.g. a single-company deployment with one HR Admin), a
    // plain employee seeing MORE would be the actual isolation bug.
    expect(employeeRowCount, "A plain employee's directory view should not exceed HR Admin's").toBeLessThanOrEqual(hrRowCount);
  });

  test("HR Admin's 'New employee' action is not offered to a plain employee", async ({ employeePage, hrAdminPage }) => {
    await employeePage.goto("/employees");
    await hrAdminPage.goto("/employees");
    await expect(employeePage.getByRole("link", { name: /new employee/i })).toHaveCount(0);
    await expect(hrAdminPage.getByRole("link", { name: /new employee/i })).toBeVisible();
  });
});
