import { test, expect } from "../../src/fixtures";
import { getCredentials, hasCredentials, isMutationAuthorized } from "../../src/config";
import { AttendancePage } from "../../src/pages/AttendancePage";
import { ApprovalsPage, LeavePage } from "../../src/pages/LeavePage";
import { testWorkday, testWeekendDay, tagNote } from "../../src/recordTag";
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
 * Name resolution needs a SEPARATE Sys Admin session from the attendance
 * register itself: getEmployeeNameByAuthEmail reads `/admin/users`, which
 * apps/web/src/app/(app)/admin/layout.tsx gates to Sys Admin only, while
 * the register (canManageAttendance, packages/domain/src/permissions/
 * attendance.ts) is HR Admin only — neither role can do both, so this file
 * uses `sysAdminPage` purely to resolve the name and `hrAdminPage` for
 * every actual attendance action.
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

  test("HR Admin bulk-fills a day's attendance across work modes", async ({ hrAdminPage, sysAdminPage, runId }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve the Employee's name via /admin/users.");
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, email);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWorkday(runId, 0);
    await attendance.goto({ date });

    await attendance.setStatus(employeeName, "present");
    await attendance.setWorkModeAndHours(employeeName, "business_travel", 8);
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("re-saving an already-recorded day (correction) succeeds", async ({ hrAdminPage, sysAdminPage, runId }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve the Employee's name via /admin/users.");
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, email);
    const attendance = new AttendancePage(hrAdminPage);
    const date = testWorkday(runId, 0); // same date as the previous test — a correction, not a new day
    await attendance.goto({ date });
    await attendance.setWorkModeAndHours(employeeName, "work_from_home", 8);
    await attendance.saveAll();
    await attendance.expectSaved();
  });

  test("a weekend day recorded present automatically creates exactly one Recovery Leave credit for this employee", async ({ hrAdminPage, sysAdminPage, runId }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve the Employee's name via /admin/users.");
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, email);
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

  /**
   * The two-step Recovery Leave approval chain (Line Manager, then HR
   * Admin — seed_default_approval_workflows() in schema.sql), walked end
   * to end through the Approvals page's new "Recovery Leave credits"
   * section, verifying the credit is only posted once BOTH steps approve.
   *
   * recovery_credit_requests has no tagged free-text field (it's manager/
   * HR-attested, never a self-submitted request with a reason) — its
   * work_date is this run's unique identifier instead, same role a tagged
   * reason plays for leave/reimbursement rows. testWeekendDay(runId, N)
   * never collides with another N within THIS run, but its hash-derived
   * date CAN coincide with a date an earlier, different run already used
   * (confirmed live — see the date-search loop below), so the actual date
   * is confirmed free via AttendancePage.isUnrecorded() before saving,
   * rather than assumed from the first candidate.
   */
  test("Recovery Leave: manager approves (step 1), HR Admin approves (step 2), the comp-off credit posts only after both", async ({
    employeePage,
    managerPage,
    hrAdminPage,
    sysAdminPage,
    runId,
  }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve the Employee's name via /admin/users.");
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, email);

    // testWeekendDay(runId, N) is hash(runId) % 40 weeks + N — deterministic
    // per run, but NOT collision-proof across different runs' hashes.
    // Confirmed live: run E2E-20260928-232518's offset-2 date (2099-05-30)
    // had already been recorded by an earlier run (E2E-20260928-113008)'s
    // own weekend-day test, so this employee's row there was no longer
    // "not_recorded" — the save still succeeded but earned no NEW recovery
    // credit (one already existed for that date), producing a bare "Saved."
    // that expectSavedWithRecoveryCredits(1) correctly refused to accept as
    // proof. A bare "Saved." must never be treated as evidence a new
    // request was created — only the credit-specific message counts, and
    // only once we've first confirmed the candidate date is actually free.
    //
    // Base offset 100 keeps this search's candidates clear of every other
    // fixed offset this file uses (0 for the creation test above, 3 for the
    // rejection test below) so a search landing on 100+k can never collide
    // with either of those within the SAME run.
    const attendance = new AttendancePage(hrAdminPage);
    const DATE_SEARCH_BASE_OFFSET = 100;
    const MAX_DATE_SEARCH_ATTEMPTS = 20;
    let date: string | undefined;
    for (let attempt = 0; attempt < MAX_DATE_SEARCH_ATTEMPTS; attempt++) {
      const candidate = testWeekendDay(runId, DATE_SEARCH_BASE_OFFSET + attempt);
      await attendance.goto({ date: candidate });
      if (await attendance.isUnrecorded(employeeName)) {
        date = candidate;
        break;
      }
    }
    if (!date) {
      throw new Error(
        `Could not find an unused synthetic Saturday for the Employee test account after ${MAX_DATE_SEARCH_ATTEMPTS} attempts starting at testWeekendDay(runId, ${DATE_SEARCH_BASE_OFFSET}) — every candidate already has an attendance record. Investigate stale test data before retrying.`,
      );
    }

    // `date` is now confirmed free and is reused, unchanged, through every
    // subsequent assertion below (attendance save, both approval decisions,
    // and the final balance check) — a genuinely different date for any of
    // those would silently test nothing.
    await attendance.setStatus(employeeName, "present");
    await attendance.setWorkModeAndHours(employeeName, "business_travel", 8); // >4h => 1 full recovery day
    await attendance.saveAll();
    await attendance.expectSavedWithRecoveryCredits(1);

    // Read the balance BEFORE either decision. A failure to parse it here
    // must fail the test outright, not skip with an annotation — there is
    // no meaningful way to verify "the credit posted" without a real
    // starting number to compare against.
    const employeeLeave = new LeavePage(employeePage);
    await employeeLeave.gotoList();
    const compBalanceBefore = await employeeLeave.getBalance("Comp-off");
    const numberBefore = compBalanceBefore.match(/[\d.]+/)?.[0];
    expect(numberBefore, `Could not parse a "Comp-off" balance figure from: "${compBalanceBefore}"`).toBeDefined();

    const managerApprovals = new ApprovalsPage(managerPage);
    await managerApprovals.goto();
    await managerApprovals.expectPending(date);
    await managerApprovals.approve(date);
    // Step 1's approval row is now decided; the chain advances to a NEW
    // approvals row for HR Admin (step 2) — the Manager should no longer
    // see this request as pending, proving the routing actually moved
    // forward rather than just disappearing. expectNotPending's own
    // auto-retrying assertion is what actually waits for
    // decide_leave_approval() to finish and /approvals to reflect it —
    // approve() itself only dispatches the click, it doesn't wait for the
    // server action's transition to complete.
    await managerApprovals.expectNotPending(date);

    // Step 1 is only the "provisional release" — decide_leave_approval()
    // never touches comp_day_ledger until HR Admin's step 2 final approval.
    // A stale read here would prove nothing (a Server Component's HTML is
    // baked in at request time), so this re-navigates to /leave for a
    // genuinely fresh render rather than re-querying the page opened
    // above, which still reflects its original request from before either
    // decision.
    await employeeLeave.gotoList();
    const compBalanceAfterStep1 = await employeeLeave.getBalance("Comp-off");
    expect(compBalanceAfterStep1, "Comp-off balance changed after only step 1 (manager) approval — the credit must not post until HR Admin's step 2").toBe(compBalanceBefore);

    const hrApprovals = new ApprovalsPage(hrAdminPage);
    await hrApprovals.goto();
    await hrApprovals.expectPending(date);
    await hrApprovals.approve(date);
    await hrApprovals.expectNotPending(date);

    // The only observable, self-service signal of the posted credit: the
    // Employee's own Comp-off balance card on /leave (comp_day_balances,
    // read there — see leave/page.tsx). Must increase by exactly the
    // credited amount (1 day, from the >4h business_travel day above),
    // proving decide_leave_approval()'s HR-Admin-final-step ledger insert
    // actually ran, not just that the UI stopped showing the request.
    // Same reload requirement as above — a fresh navigation, not a poll
    // against the already-open page.
    await employeeLeave.gotoList();
    const compBalanceAfterStep2 = await employeeLeave.getBalance("Comp-off");
    const numberAfterStep2 = compBalanceAfterStep2.match(/[\d.]+/)?.[0];
    expect(numberAfterStep2, `Could not parse a "Comp-off" balance figure from: "${compBalanceAfterStep2}"`).toBeDefined();
    expect(Number(numberAfterStep2), "Comp-off balance did not increase by exactly the approved recovery credit after HR Admin's final approval").toBe(
      Number(numberBefore) + 1,
    );
  });

  test("Recovery Leave: manager can reject at step 1, stopping the chain before HR Admin and before any credit posts", async ({
    employeePage,
    managerPage,
    hrAdminPage,
    sysAdminPage,
    runId,
  }) => {
    test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to resolve the Employee's name via /admin/users.");
    const { email } = getCredentials("employee");
    const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, email);
    const date = testWeekendDay(runId, 3); // distinct from both tests above
    const rejectionReason = tagNote(runId, "recovery-credit-reject-decision", "Rejected by automated test");

    const attendance = new AttendancePage(hrAdminPage);
    await attendance.goto({ date });
    await attendance.setStatus(employeeName, "present");
    await attendance.setWorkModeAndHours(employeeName, "business_travel", 8);
    await attendance.saveAll();
    await attendance.expectSavedWithRecoveryCredits(1);

    const employeeLeave = new LeavePage(employeePage);
    await employeeLeave.gotoList();
    const compBalanceBefore = await employeeLeave.getBalance("Comp-off");

    const managerApprovals = new ApprovalsPage(managerPage);
    await managerApprovals.goto();
    await managerApprovals.expectPending(date);
    await managerApprovals.reject(date, rejectionReason);
    await managerApprovals.expectNotPending(date);

    // A rejection at step 1 must never advance the chain to step 2 — HR
    // Admin should never see this request at all, unlike the approve test
    // above where it correctly DOES move there.
    const hrApprovals = new ApprovalsPage(hrAdminPage);
    await hrApprovals.goto();
    await hrApprovals.expectNotPending(date);

    // No credit was ever posted — the balance must be byte-for-byte
    // unchanged, not just "not increased" (a decrease would also be wrong
    // and this catches that too).
    await employeeLeave.gotoList();
    const compBalanceAfter = await employeeLeave.getBalance("Comp-off");
    expect(compBalanceAfter, "Comp-off balance changed despite the recovery credit being rejected at step 1").toBe(compBalanceBefore);
  });
});
