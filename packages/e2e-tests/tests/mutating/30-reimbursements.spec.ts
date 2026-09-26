import { test, expect } from "../../src/fixtures";
import { ReimbursementsPage } from "../../src/pages/AppPages";
import { ApprovalsPage } from "../../src/pages/LeavePage";
import { isBackupConfirmed } from "../../src/config";
import { tagNote, testDate } from "../../src/recordTag";

/**
 * Reimbursements: submit a minimal, clearly fake, smallest-allowed-amount
 * claim, approve one and reject another, on the Employee/Manager test
 * accounts only. Verified against real source
 * (apps/web/src/app/(app)/reimbursements/{new-claim-form,[id]/{add-line-form,
 * claim-actions}}.tsx): a claim is created as a draft (currency only), gets
 * one expense line (date/category/amount/optional description), then
 * "Submit for approval" moves it into the same generic approvals inbox
 * leave requests use.
 *
 * This suite NEVER progresses a claim past approval/rejection — no export,
 * payment run, or accounting integration is ever triggered. An approved
 * claim is a real, permanent Production record; it is reported (not
 * hidden) by tests/reconcile/verify.reconcile.ts as an expected, tagged
 * change.
 *
 * Mutating — gated on E2E_BACKUP_CONFIRMED.
 */
test.describe("reimbursement claims @mutating", () => {
  test.skip(!isBackupConfirmed(), "Mutation not authorized (E2E_BACKUP_CONFIRMED != 'true') — skipping mutating reimbursement tests.");

  test("submit a minimal claim, manager approves it", async ({ employeePage, managerPage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    const description = tagNote(runId, "reimbursement-approve");

    await reimbursements.goto();
    await reimbursements.gotoNew();
    await reimbursements.startDraftClaim("AED");
    await reimbursements.addLine({
      expenseDate: testDate(runId, 2),
      category: "e2e-test",
      amount: "0.01",
      description,
    });
    await reimbursements.submitForApproval();

    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await approvals.expectPending(description);
    await approvals.approve(description);
    await approvals.expectNotPending(description);

    await reimbursements.goto();
    await reimbursements.expectClaimVisible(description);
  });

  test("submit a separate minimal claim, manager rejects it with a reason", async ({ employeePage, managerPage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    const description = tagNote(runId, "reimbursement-reject");
    const rejectionReason = tagNote(runId, "reimbursement-reject-decision", "Rejected by automated test");

    await reimbursements.goto();
    await reimbursements.gotoNew();
    await reimbursements.startDraftClaim("AED");
    await reimbursements.addLine({
      expenseDate: testDate(runId, 3),
      category: "e2e-test",
      amount: "0.01",
      description,
    });
    await reimbursements.submitForApproval();

    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await approvals.expectPending(description);
    await approvals.reject(description, rejectionReason);
    await approvals.expectNotPending(description);

    await reimbursements.goto();
    await reimbursements.expectClaimVisible(description);
  });
});
