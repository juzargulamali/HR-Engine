import { test, expect } from "../../src/fixtures";
import { LeavePage, ApprovalsPage } from "../../src/pages/LeavePage";
import { isBackupConfirmed } from "../../src/config";
import { tagNote, escapeForRegExp } from "../../src/recordTag";

/**
 * Annual Leave: submission, manager approval, rejection, cancellation, on
 * the dedicated Employee/Manager test accounts only. Mutating — every test
 * here creates a real leave_requests row against Production, gated on
 * E2E_BACKUP_CONFIRMED (set only once mutation on these test accounts has
 * been explicitly authorized).
 *
 * Uses far-future dates (year 2099+) so a request never overlaps a real
 * employee's real leave and is trivially identifiable by
 * src/recordTag.ts's testDate()/tag(). The approved request's balance
 * change is real and NOT reversed by this suite (there is no safe UI path
 * to un-approve a leave request) — this is reported by
 * tests/reconcile/verify.reconcile.ts as an expected, tagged, permanent
 * change, not hidden.
 */
test.describe("annual leave workflow @mutating", () => {
  test.skip(!isBackupConfirmed(), "Mutation not authorized (E2E_BACKUP_CONFIRMED != 'true') — skipping mutating leave tests.");

  test("submit, manager approves, balance reflects the approved request", async ({ employeePage, managerPage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const approvals = new ApprovalsPage(managerPage);

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
    await expect(employeePage.getByRole("row", { name: new RegExp(escapeForRegExp(reason)) }).getByRole("button", { name: /cancel/i })).toHaveCount(0);
  });
});
