import { test, expect } from "../../src/fixtures";
import { REGISTER_COLUMNS, AttendanceRegisterPage } from "../../src/pages/AttendanceRegisterPage";
import { gotoWithRetry } from "../../src/gotoWithRetry";

/**
 * Recovery Leave windows redesign — READ-ONLY desktop checks of the new screens. Runs ONLY
 * under the dedicated `preview-recovery-windows-read-only` Playwright project, from
 * e2e-preview-recovery-windows.yml against a Preview deployment — never swept into the
 * Production read-only project (which only covers tests/read-only).
 *
 * Nothing here mutates anything, and nothing depends on a particular employee's state:
 * every assertion is about structure, wording and states that must hold for whoever is in
 * the register that day.
 */
test.describe("automatic attendance register (HR Admin) @recovery-windows", () => {
  test("is a read-first register with the specified columns, live status text and a Last-updated stamp", async ({ hrAdminPage }) => {
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto();
    await expect(hrAdminPage.getByRole("heading", { name: "Attendance", level: 1 })).toBeVisible();

    const headers = hrAdminPage.getByRole("columnheader");
    await expect(headers).toHaveCount(REGISTER_COLUMNS.length);
    for (let i = 0; i < REGISTER_COLUMNS.length; i += 1) {
      const expected = REGISTER_COLUMNS[i]!;
      await expect(headers.nth(i)).toHaveText(expected);
    }

    // Read-first: no row is an editable form, and the old bulk Save control is not on this page.
    await expect(hrAdminPage.getByRole("button", { name: /save all/i })).toHaveCount(0);
    await expect(hrAdminPage.locator("tbody select, tbody input[type='number']")).toHaveCount(0);

    await register.expectLastUpdatedVisible();
    await expect(hrAdminPage.getByText(/Live · refreshes every 30s|Stale|Disconnected/)).toBeVisible();
  });

  test("shows the live 'Clocked in now' count separately from attendance for the date", async ({ hrAdminPage }) => {
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto();
    await expect(hrAdminPage.locator("p", { hasText: /^Clocked in now$/ })).toBeVisible(); // the summary tile (the same words are also a filter option)
    await expect(hrAdminPage.getByText(/^Present on \d{4}-\d{2}-\d{2}$/)).toBeVisible();
    await expect(hrAdminPage.getByText("Not started / not recorded", { exact: true })).toBeVisible();
    await expect(hrAdminPage.locator("p", { hasText: /^Needs review$/ })).toBeVisible();
  });

  test("every row carries a clock state as TEXT (never colour alone) and never says Online/Offline or Absent", async ({ hrAdminPage }) => {
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto();
    const rows = hrAdminPage.locator("tbody tr[data-employee-id]");
    const count = await rows.count();
    test.skip(count === 0, "No employees in this company to check.");
    for (let i = 0; i < count; i += 1) {
      await expect(rows.nth(i).locator("[data-clock-status]")).toHaveCount(1);
      await expect(rows.nth(i).locator("[data-clock-status]")).toHaveText(/^(Clocked in|Clocked out|Not started)/);
    }
    await expect(hrAdminPage.locator("tbody")).not.toContainText(/\b(online|offline)\b/i);
    await expect(hrAdminPage.locator("tbody")).not.toContainText(/\babsent\b/i);
  });

  test("the date, company/name and status filters are present, and a far-future date shows nobody as clocked in", async ({ hrAdminPage }) => {
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto();
    await expect(hrAdminPage.getByLabel("Date")).toBeVisible();
    await expect(hrAdminPage.getByLabel("Search name")).toBeVisible();
    const show = hrAdminPage.getByLabel("Show");
    for (const option of ["Everyone", "Clocked in now", "Office", "Work from home", "Site work / Installation", "Client meeting", "On leave", "Needs review"]) {
      await expect(show.locator("option", { hasText: option })).toHaveCount(1);
    }
    await register.goto({ date: "2099-01-01" });
    await expect(hrAdminPage.locator("tbody [data-clock-status='clocked_in']")).toHaveCount(0);
  });

  test("an HR-only Edit control reveals required-reason forms; the Add missing attendance form is labelled as recorded by HR", async ({ hrAdminPage }) => {
    const register = new AttendanceRegisterPage(hrAdminPage);
    await register.goto();
    const edit = hrAdminPage.getByRole("button", { name: "Edit", exact: true }).first();
    test.skip((await edit.count()) === 0, "No rows to edit.");
    await edit.click();
    await expect(hrAdminPage.getByText("Add missing attendance (recorded by HR)")).toBeVisible();
    await expect(hrAdminPage.getByLabel(/^Reason \(required\)/).first()).toBeVisible();
    // Nothing is submitted — this is a read-only check.
  });
});

test.describe("employee dashboard status @recovery-windows", () => {
  test("shows the Attendance clock card with a text status, the clock action, and no break buttons", async ({ employeePage }) => {
    await gotoWithRetry(employeePage, "/");
    const heading = employeePage.getByRole("heading", { name: "Attendance clock" });
    await expect(heading).toBeVisible();
    const card = heading.locator("xpath=ancestor::div[contains(@class, 'rounded-')][1]"); // the Card around the heading
    await expect(card.locator("[data-clock-status]")).toHaveCount(1);
    await expect(card.locator("[data-clock-status]")).toHaveText(/^(Clocked in|Clocked out|Not started)/);
    await expect(card.getByRole("link", { name: /^(Clock In|Clock Out)$/ })).toBeVisible();
    await expect(card).not.toContainText(/break/i);
    await expect(card.getByText(/^Last updated \d{2}:\d{2}:\d{2}$/)).toBeVisible();
    await expect(card).not.toContainText(/available balance:/i);
  });
});

test.describe("HR alerts page @recovery-windows", () => {
  test("renders for HR Admin and, when work alerts exist, lists them with the review columns", async ({ hrAdminPage }) => {
    await gotoWithRetry(hrAdminPage, "/alerts");
    await expect(hrAdminPage.getByRole("heading", { name: "Alerts", level: 1 })).toBeVisible();
    const section = hrAdminPage.getByText("Recovery Leave work alerts", { exact: true });
    if ((await section.count()) > 0) {
      const headers = ["Employee", "Company", "Alert", "Working period began", "Recorded", "Elapsed", "Triggered", "Rest / rollover"];
      for (const h of headers) await expect(hrAdminPage.getByRole("columnheader", { name: h, exact: true })).toBeVisible();
    }
  });

  test("is not available to an ordinary employee", async ({ employeePage }) => {
    await gotoWithRetry(employeePage, "/alerts");
    await expect(employeePage.getByText("Alerts are restricted to HR Admin, CEO, and CTO.")).toBeVisible();
  });
});
