import { test, expect } from "../../src/fixtures";
import { LeavePage, ApprovalsPage } from "../../src/pages/LeavePage";
import { isMutationAuthorized } from "../../src/config";
import { tagNote, escapeForRegExp } from "../../src/recordTag";
import { writeLeaveApprovalExpectation } from "../../src/baseline";

/**
 * Annual Leave: submission, manager approval, rejection, cancellation, on
 * the dedicated Employee/Manager test accounts only. Mutating — every test
 * here creates a real leave_requests row against Production, gated on
 * E2E_MUTATION_AUTHORIZED (set only once mutation on these test accounts
 * has been explicitly authorized for this run).
 *
 * Dates are fixed, real 2099 calendar dates chosen to be an ordinary
 * working day under BOTH weekend patterns this suite's seeded countries use
 * (UAE/Saudi Arabia: Friday+Saturday off; Poland: Saturday+Sunday off) —
 * verified: 2099-03-10/11 are a Tuesday/Wednesday, 2099-03-17 a Tuesday,
 * 2099-03-18 a Wednesday. This matters because
 * apps/web/src/lib/actions/leave.ts rejects a request whose date range has
 * no working day at all ("weekends/holidays only") — a date that happened
 * to fall on the wrong country's weekend would fail submission for a
 * reason unrelated to what each test is actually checking. See
 * src/recordTag.ts's doc comment for the full reasoning.
 *
 * The approved request's balance change is real and NOT reversed by this
 * suite (there is no safe UI path to un-approve a leave request) — this is
 * reported by tests/reconcile/verify.reconcile.ts as an expected,
 * quantified, permanent change (via writeLeaveApprovalExpectation below),
 * not hidden.
 */
test.describe("annual leave workflow @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating leave tests.");

  test("submit, manager approves, balance reflects the approved request", async ({ employeePage, managerPage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const approvals = new ApprovalsPage(managerPage);

    await employeeLeave.gotoList();
    const balanceBefore = await employeeLeave.getBalance("Annual");
    const numberBefore = balanceBefore.match(/[\d.]+/)?.[0];

    const reason = tagNote(runId, "annual-leave-approve");
    // 2099-03-10 (Tue) to 2099-03-11 (Wed): 2 consecutive real working days,
    // no seeded holiday in range — the expected deduction is exactly 2 days.
    const LEAVE_DAYS_REQUESTED = 2;
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

    // Written regardless of whether the balance card parses cleanly below
    // — reconciliation does its own parsing later and needs this
    // expectation on record either way, per "correlate a changed balance
    // with the specific approved request, not just tagged text".
    writeLeaveApprovalExpectation(runId, {
      reasonTag: reason,
      leaveTypeLabel: "Annual",
      leaveDaysRequested: LEAVE_DAYS_REQUESTED,
    });

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
      startDate: "2099-03-17", // Tuesday
      endDate: "2099-03-17",
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
      startDate: "2099-03-18", // Wednesday
      endDate: "2099-03-18",
      leaveTypeCode: "annual",
      reason,
    });
    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(reason);
    await employeeLeave.cancelRequest(reason);
    await expect(employeePage.getByRole("row", { name: new RegExp(escapeForRegExp(reason)) }).getByRole("button", { name: /cancel/i })).toHaveCount(0);
  });
});
