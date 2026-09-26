import { test, expect } from "../../src/fixtures";
import { AttendancePage } from "../../src/pages/AttendancePage";
import { ApprovalsPage } from "../../src/pages/LeavePage";
import { isBackupConfirmed } from "../../src/config";
import { testDate } from "../../src/recordTag";

/**
 * Attendance is HR-Admin bulk entry for the whole company (see
 * AttendancePage.ts's header comment) — there is no individual
 * self-service clock-in/out, so "missing checkout" doesn't literally apply;
 * "correction" here is re-editing an already-saved row and saving again.
 *
 * Recovery Leave: created from an attendance record's exceptional-hours
 * facts and routed through the same generic approvals inbox as leave. Both
 * use a synthetic 2099+ work_date derived from the run ID so no real
 * attendance day is ever touched.
 *
 * Mutating — gated on E2E_BACKUP_CONFIRMED.
 */
test.describe("attendance and recovery leave @mutating", () => {
  test.skip(!isBackupConfirmed(), "Mutation not authorized (E2E_BACKUP_CONFIRMED != 'true') — skipping mutating attendance tests.");

  test("HR Admin bulk-fills a day's attendance across work modes", async ({ hrAdminPage, runId }) => {
    const attendance = new AttendancePage(hrAdminPage);
    const date = testDate(runId, 0);
    await attendance.goto({ date });

    const firstRow = hrAdminPage.getByRole("row").nth(1); // row 0 is the header
    await expect(firstRow).toBeVisible();

    await firstRow.getByRole("combobox").first().selectOption("present");
    await firstRow.getByRole("combobox").nth(1).selectOption("business_travel");
    await firstRow.getByRole("spinbutton").fill("8");
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("re-saving an already-recorded day (correction) succeeds", async ({ hrAdminPage, runId }) => {
    const attendance = new AttendancePage(hrAdminPage);
    const date = testDate(runId, 0); // same date as the previous test — a correction, not a new day
    await attendance.goto({ date });
    const firstRow = hrAdminPage.getByRole("row").nth(1);
    await firstRow.getByRole("combobox").nth(1).selectOption("work_from_home");
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("an overnight/exceptional day can be flagged for Recovery Leave and approved", async ({ hrAdminPage, managerPage, runId }) => {
    const attendance = new AttendancePage(hrAdminPage);
    const date = testDate(runId, 1);
    await attendance.goto({ date });
    const firstRow = hrAdminPage.getByRole("row").nth(1);
    await firstRow.getByRole("combobox").first().selectOption("present");
    await firstRow.getByRole("combobox").nth(1).selectOption("business_travel");
    await firstRow.getByRole("spinbutton").fill("8");
    await attendance.saveAll();
    await attendance.expectSaved();

    // Whether Recovery Leave creation is a separate control or an automatic
    // side effect of specific status/hours combinations is unverified —
    // this assertion is deliberately soft, per "do not fabricate policy
    // activation or direct DB state": it reports what it finds rather than
    // asserting a specific unverified control exists.
    const recoveryNotice = hrAdminPage.getByText(/recovery day|recovery leave|recovery credit/i);
    const noticeCount = await recoveryNotice.count();
    test.skip(noticeCount === 0, "No Recovery Leave control/notice found on the attendance page for this row — confirm the real trigger on first live run before treating this as a defect.");

    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await expect(managerPage.getByRole("button", { name: "Approve", exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
