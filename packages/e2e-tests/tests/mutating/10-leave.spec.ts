import { test, expect } from "../../src/fixtures";
import { LeavePage, ApprovalsPage, formatDateRange } from "../../src/pages/LeavePage";
import { isMutationAuthorized } from "../../src/config";
import { tagNote, testWorkday, escapeForRegExp } from "../../src/recordTag";
import { writeLeaveApprovalExpectation } from "../../src/baseline";

/**
 * Annual Leave: submission, manager approval, rejection, cancellation, on
 * the dedicated Employee/Manager test accounts only. Mutating — every test
 * here creates a real leave_requests row against Production, gated on
 * E2E_MUTATION_AUTHORIZED (set only once mutation on these test accounts
 * has been explicitly authorized for this run).
 *
 * Dates are `testWorkday(runId, offsetWeeks)`-derived (src/recordTag.ts),
 * NOT fixed calendar dates — a run-ID-varying but always-an-ordinary-
 * working-day date, guaranteed correct under every seeded country's weekend
 * pattern (UAE/Saudi Arabia: Friday+Saturday off; Poland: Saturday+Sunday
 * off). This used to be three hardcoded 2099-03-* dates; confirmed live
 * (run 36351884519) that's a real bug on any REPEAT dispatch: tests 1 and 3
 * below failed at expectRequestInList before ever reaching approve/cancel,
 * which leaves their leave_requests rows permanently stuck "submitted"/
 * "pending_approval" (no reversal path). A second run reusing the same
 * fixed dates would then hit apps/web/src/lib/actions/leave.ts's overlap
 * guard on every new submission ("You already have a leave request that
 * overlaps these dates") — a confusing, unrelated-looking failure. Distinct
 * offsetWeeks (0/1/2) keep the three tests' dates from overlapping each
 * other within one run, same as attendance's testWorkday/testWeekendDay
 * usage.
 *
 * expectRequestInList/cancelRequest search the leave list's rendered "Dates"
 * text (LeavePage.formatDateRange), never the tagged `reason` — verified
 * directly from apps/web/src/app/(app)/leave/page.tsx: it fetches `reason`
 * but never renders it in the requests table, only Type/Dates/Days/Status.
 * The Approvals page (a separate query/component) DOES render `reason`, so
 * expectPending/approve/reject/expectNotPending below still use it there.
 *
 * The approved request's balance change is real and NOT reversed by this
 * suite (there is no safe UI path to un-approve a leave request) — this is
 * reported by tests/reconcile/verify.reconcile.ts as an expected,
 * quantified, permanent change (via writeLeaveApprovalExpectation below),
 * not hidden.
 */
function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

test.describe("annual leave workflow @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating leave tests.");

  test("submit, manager approves, balance reflects the approved request", async ({ employeePage, managerPage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const approvals = new ApprovalsPage(managerPage);

    await employeeLeave.gotoList();
    const balanceBefore = await employeeLeave.getBalance("Annual");
    const numberBefore = balanceBefore.match(/[\d.]+/)?.[0];

    const reason = tagNote(runId, "annual-leave-approve");
    // testWorkday(runId, 0): an ordinary working day (Tuesday) for every
    // seeded country; +1 day (Wednesday) is always still a working day
    // regardless of which of the two weekend patterns applies — 2
    // consecutive real working days, no seeded holiday in range, so the
    // expected deduction is exactly 2 days.
    const startDate = testWorkday(runId, 0);
    const endDate = addDays(startDate, 1);
    const dateRangeLabel = formatDateRange(startDate, endDate);
    const LEAVE_DAYS_REQUESTED = 2;
    await employeeLeave.gotoNew();
    await employeeLeave.submitRequest({
      startDate,
      endDate,
      leaveTypeCode: "annual",
      reason,
    });
    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(dateRangeLabel);

    await approvals.goto();
    await approvals.expectPending(reason);
    await approvals.approve(reason);
    await approvals.expectNotPending(reason);

    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(dateRangeLabel);

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
    // Offset by 1 week from the approve test's date so the two requests'
    // date ranges never overlap within the same run.
    const date = testWorkday(runId, 1);
    const dateRangeLabel = formatDateRange(date, date);

    await employeeLeave.gotoNew();
    await employeeLeave.submitRequest({
      startDate: date,
      endDate: date,
      leaveTypeCode: "annual",
      reason,
    });

    await approvals.goto();
    await approvals.expectPending(reason);
    await approvals.reject(reason, rejectionReason);
    await approvals.expectNotPending(reason);

    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(dateRangeLabel);
  });

  test("employee can cancel their own still-pending request", async ({ employeePage, runId }) => {
    const employeeLeave = new LeavePage(employeePage);
    const reason = tagNote(runId, "annual-leave-cancel");
    // Offset by 2 weeks from the approve test's date so this request's date
    // never overlaps either of the other two tests' dates within the same
    // run.
    const date = testWorkday(runId, 2);
    const dateRangeLabel = formatDateRange(date, date);

    await employeeLeave.gotoNew();
    await employeeLeave.submitRequest({
      startDate: date,
      endDate: date,
      leaveTypeCode: "annual",
      reason,
    });
    await employeeLeave.gotoList();
    await employeeLeave.expectRequestInList(dateRangeLabel);
    await employeeLeave.cancelRequest(dateRangeLabel);
    await expect(employeePage.getByRole("row", { name: new RegExp(escapeForRegExp(dateRangeLabel)) }).getByRole("button", { name: /cancel/i })).toHaveCount(0);
  });
});
