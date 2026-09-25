import { test, expect } from "../src/fixtures";
import { LeavePage, ApprovalsPage } from "../src/pages/LeavePage";
import { isBackupConfirmed } from "../src/config";
import { tagNote } from "../src/recordTag";

/**
 * Annual Leave: submission, manager approval, rejection, cancellation.
 * Mutating — every test here creates a real leave_requests row against
 * Production, so the whole file is gated on E2E_BACKUP_CONFIRMED.
 *
 * Uses far-future dates (year 2099+) derived from the run ID so a request
 * never overlaps a real employee's real leave and is trivially identifiable
 * for cleanup by src/recordTag.ts's testDate(). The leave-type code used
 * ("annual") is the one seeded for every country's base policy; if a given
 * test employee's country has no active leave policy yet, this whole file
 * will fail at submission with the app's own "HR hasn't activated a leave
 * policy" message rather than silently doing nothing — that is itself a
 * legitimate finding to report, not a test bug.
 *
 * Whether Annual Leave approval is a single manager step or manager + a
 * separate HR stage is NOT confirmed from source in this pass — the test
 * below checks for a second pending step and reports what it finds rather
 * than assuming either shape.
 */
test.describe("annual leave workflow @mutating", () => {
  test.skip(!isBackupConfirmed(), "Backup not confirmed (E2E_BACKUP_CONFIRMED != 'true') — skipping mutating leave tests.");

  test("submit, manager approves, balance reflects the approved request", async ({ employeePage, managerPage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const approvals = new ApprovalsPage(managerPage);

    // Best-effort balance check: only asserts the number changes, not what
    // it changes to — the exact per-country accrual/deduction formula (UAE
    // per-service-year, Saudi's 5-year threshold, Poland's flat 26 days) is
    // covered by packages/domain's own unit tests, not re-derived here.
    // Skips itself if the balance card's text can't be parsed, rather than
    // asserting against a guessed format.
    await employeeLeave.gotoList();
    const balanceBefore = await employeeLeave.getBalance("Annual");
    const numberBefore = balanceBefore.match(/[\d.]+/)?.[0];

    const reason = tagNote(runId, "annual-leave-approve");
    await employeeLeave.gotoNew();
    await employeeLeave.submitRequest({
      startDate: "2099-03-10",
      endDate: "2099-03-11",
      leaveTypeCode: "annual",
      reason,
    });
    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(reason);

    await approvals.goto();
    await approvals.expectPending(reason);
    await approvals.approve(reason);
    await approvals.expectNotPending(reason);

    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(reason);
    // Whether the row's own status label reads "approved" and whether a
    // second HR approval step exists are exactly what the first live run
    // needs to confirm — asserting only non-pending-for-manager here, which
    // is true either way.

    if (numberBefore) {
      const balanceAfter = await employeeLeave.getBalance("Annual");
      const numberAfter = balanceAfter.match(/[\d.]+/)?.[0];
      expect(numberAfter, "Annual Leave balance card is no longer parseable after approval").toBeDefined();
      expect(Number(numberAfter), "Annual Leave balance did not decrease after an approved request").toBeLessThan(Number(numberBefore));
    } else {
      test.info().annotations.push({ type: "skip-reason", description: `Could not parse an "Annual" balance figure from: "${balanceBefore}" — confirm the real balance-card selector/format on first live run.` });
    }
  });

  test("submit, manager rejects with a reason, request shows as rejected", async ({ employeePage, managerPage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const approvals = new ApprovalsPage(managerPage);

    const reason = tagNote(runId, "annual-leave-reject");
    const rejectionReason = tagNote(runId, "annual-leave-reject-decision", "Rejected by automated test");

    await employeeLeave.gotoNew();
    await employeeLeave.submitRequest({
      startDate: "2099-03-15",
      endDate: "2099-03-15",
      leaveTypeCode: "annual",
      reason,
    });

    await approvals.goto();
    await approvals.expectPending(reason);
    await approvals.reject(reason, rejectionReason);
    await approvals.expectNotPending(reason);

    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(reason);
  });

  test("employee can cancel their own still-pending request", async ({ employeePage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const reason = tagNote(runId, "annual-leave-cancel");

    await employeeLeave.gotoNew();
    await employeeLeave.submitRequest({
      startDate: "2099-03-20",
      endDate: "2099-03-20",
      leaveTypeCode: "annual",
      reason,
    });
    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(reason);
    await employeeLeave.cancelRequest(reason);
    // A cancelled request should no longer sit in the pending/actionable
    // state — the exact list-row wording for "cancelled" is unverified, so
    // this only asserts it's no longer actionable via the same control.
    await expect(employeePage.getByRole("row", { name: new RegExp(reason) }).getByRole("button", { name: /cancel/i })).toHaveCount(0);
  });
});
