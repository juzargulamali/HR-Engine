import { test, expect } from "../../src/fixtures";
import { getCredentials, isMutationAuthorized } from "../../src/config";
import { AttendancePage } from "../../src/pages/AttendancePage";
import { testWorkday, testWeekendDay } from "../../src/recordTag";
import { getEmployeeNameByAuthEmail } from "../../src/identity";

/**
 * Attendance is HR-Admin bulk entry for the whole company (see
 * AttendancePage.ts's header comment) — there is no individual
 * self-service clock-in/out, so "missing checkout" doesn't literally apply;
 * "correction" here is re-editing an already-saved row and saving again.
 *
 * Every test targets the Employee test account's OWN row, resolved from a
 * STABLE identifier — its auth email, via getEmployeeNameByAuthEmail
 * (src/identity.ts), which itself fails loudly unless that email resolves
 * to exactly one Users & Roles row — never a self-reported name and never
 * "whichever row the register renders first" (that register lists every
 * active employee in HR Admin's company, real employees included).
 * AttendancePage's mutating methods (setStatus/setWorkModeAndHours) also
 * independently fail before touching anything unless that name resolves to
 * exactly one row on THIS date's register too — two employees could
 * plausibly share a display name even if their auth emails don't.
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

  test("HR Admin bulk-fills a day's attendance across work modes", async ({ hrAdminPage, runId }) => {
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(hrAdminPage, email);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWorkday(runId, 0);
    await attendance.goto({ date });

    await attendance.setStatus(employeeName, "present");
    await attendance.setWorkModeAndHours(employeeName, "business_travel", 8);
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("re-saving an already-recorded day (correction) succeeds", async ({ hrAdminPage, runId }) => {
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(hrAdminPage, email);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWorkday(runId, 0); // same date as the previous test — a correction, not a new day
    await attendance.goto({ date });
    await attendance.setWorkModeAndHours(employeeName, "work_from_home", 8);
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("a weekend day recorded present automatically creates exactly one Recovery Leave credit for this employee", async ({ hrAdminPage, runId }) => {
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(hrAdminPage, email);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWeekendDay(runId, 0);
    await attendance.goto({ date });
    await attendance.setStatus(employeeName, "present");
    await attendance.setWorkModeAndHours(employeeName, "business_travel", 8); // >4h => 1 full recovery day, per record_attendance_and_recovery()
    await attendance.saveAll();

    // This save touches ONLY this employee's row (bulkRecordAttendance only
    // sends changed/selected rows), so "1" here is specifically this
    // request, not a count that could include anyone else's. See
    // AttendancePage.expectSavedWithRecoveryCredits's doc comment for why
    // this is used instead of the Approvals page (which never renders
    // recovery_credit approvals at all).
    await attendance.expectSavedWithRecoveryCredits(1);
  });
});
