import { test, expect } from "../../src/fixtures";
import { AttendancePage } from "../../src/pages/AttendancePage";
import { ApprovalsPage } from "../../src/pages/LeavePage";
import { isMutationAuthorized } from "../../src/config";
import { testWorkday, testWeekendDay } from "../../src/recordTag";
import { getOwnDisplayName } from "../../src/identity";

/**
 * Attendance is HR-Admin bulk entry for the whole company (see
 * AttendancePage.ts's header comment) — there is no individual
 * self-service clock-in/out, so "missing checkout" doesn't literally apply;
 * "correction" here is re-editing an already-saved row and saving again.
 *
 * Every test targets the Employee test account's OWN row, found by its real
 * display name (src/identity.ts) — never "whichever row the register
 * renders first", which lists every active employee in HR Admin's company,
 * real employees included.
 *
 * Dates: `testWorkday()`/`testWeekendDay()` (src/recordTag.ts) are used
 * instead of a plain synthetic date, because
 * `record_attendance_and_recovery()` (schema/schema.sql) AUTOMATICALLY
 * creates a recovery_credit_requests row (and its approval) whenever a
 * `status = 'present'` row is saved on a date the server considers a
 * recovery day (weekend or holiday) for that employee's country — there is
 * no separate UI control for this. A "plain" attendance test on an
 * accidental weekend date would silently create a misleading recovery
 * record instead of a plain one; testWorkday() guarantees that never
 * happens, and testWeekendDay() is used deliberately, once, to exercise
 * that exact automatic path on purpose.
 *
 * Mutating — gated on E2E_MUTATION_AUTHORIZED.
 */
test.describe("attendance and recovery leave @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating attendance tests.");

  test("HR Admin bulk-fills a day's attendance across work modes", async ({ hrAdminPage, employeePage, runId }) => {
    const employeeName = await getOwnDisplayName(employeePage);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWorkday(runId, 0);
    await attendance.goto({ date });

    const row = attendance.rowFor(employeeName);
    await expect(row).toBeVisible();

    await row.getByRole("combobox").first().selectOption("present");
    await row.getByRole("combobox").nth(1).selectOption("business_travel");
    await row.getByRole("spinbutton").fill("8");
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("re-saving an already-recorded day (correction) succeeds", async ({ hrAdminPage, employeePage, runId }) => {
    const employeeName = await getOwnDisplayName(employeePage);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWorkday(runId, 0); // same date as the previous test — a correction, not a new day
    await attendance.goto({ date });
    const row = attendance.rowFor(employeeName);
    await row.getByRole("combobox").nth(1).selectOption("work_from_home");
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("a weekend day recorded present automatically creates and routes a Recovery Leave credit for approval", async ({ hrAdminPage, managerPage, employeePage, runId }) => {
    const employeeName = await getOwnDisplayName(employeePage);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWeekendDay(runId, 0);
    await attendance.goto({ date });
    const row = attendance.rowFor(employeeName);
    await row.getByRole("combobox").first().selectOption("present");
    await row.getByRole("combobox").nth(1).selectOption("business_travel");
    await row.getByRole("spinbutton").fill("8"); // >4h => 1 full recovery day, per record_attendance_and_recovery()
    await attendance.saveAll();
    await attendance.expectSaved();

    // This is now a deterministic, verified server-side effect (not a
    // guessed UI control) — a real, hard assertion, not a soft skip.
    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await expect(managerPage.getByRole("button", { name: "Approve", exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
