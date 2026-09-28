import { test, expect } from "../../src/fixtures";
import { ReimbursementsPage } from "../../src/pages/AppPages";
import { ApprovalsPage } from "../../src/pages/LeavePage";
import { isMutationAuthorized } from "../../src/config";
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
 * Matched by claim ID throughout, never by date+amount+description text —
 * confirmed live (run 36359831264) that both claims here are the same date
 * and the same smallest-allowed test amount, so nothing about their visible
 * fields distinguishes them; the tagged description, meanwhile, is never
 * rendered on the Approvals page or the employee's own /reimbursements
 * list (only Date/Amount/Status — verified from source), only on the
 * claim's own detail page. ReimbursementsPage.startDraftClaim() returns the
 * new claim's id (parsed from its own detail URL) specifically so every
 * later step — the Approvals-page row, the reconciliation report, this
 * test's own final status check — can refer to exactly one claim.
 *
 * This suite NEVER progresses a claim past approval/rejection — no export,
 * payment run, or accounting integration is ever triggered. An approved
 * claim is a real, permanent Production record; it is reported (not
 * hidden) by tests/reconcile/verify.reconcile.ts as an expected, tagged
 * change.
 *
 * Mutating — gated on E2E_MUTATION_AUTHORIZED.
 */
test.describe("reimbursement claims @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating reimbursement tests.");

  test("submit a minimal claim, manager approves it", async ({ employeePage, managerPage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    const description = tagNote(runId, "reimbursement-approve");

    await reimbursements.goto();
    const claimId = await reimbursements.startDraftClaim("AED");
    await reimbursements.addLine({
      expenseDate: testDate(runId, 2),
      category: "e2e-test",
      amount: "0.01",
      description,
    });
    await reimbursements.submitForApproval();

    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await approvals.expectClaimPending(claimId);
    await approvals.approveClaim(claimId);
    await approvals.expectClaimNotPending(claimId);

    await reimbursements.gotoClaim(claimId);
    await expect(async () => {
      expect(await reimbursements.getClaimStatus()).toMatch(/^approved$/i);
    }).toPass({ timeout: 10_000 });
  });

  test("submit a separate minimal claim, manager rejects it with a reason", async ({ employeePage, managerPage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    const description = tagNote(runId, "reimbursement-reject");
    const rejectionReason = tagNote(runId, "reimbursement-reject-decision", "Rejected by automated test");

    await reimbursements.goto();
    const claimId = await reimbursements.startDraftClaim("AED");
    await reimbursements.addLine({
      expenseDate: testDate(runId, 3),
      category: "e2e-test",
      amount: "0.01",
      description,
    });
    await reimbursements.submitForApproval();

    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();
    await approvals.expectClaimPending(claimId);
    await approvals.rejectClaim(claimId, rejectionReason);
    await approvals.expectClaimNotPending(claimId);

    await reimbursements.gotoClaim(claimId);
    await expect(async () => {
      expect(await reimbursements.getClaimStatus()).toMatch(/^rejected$/i);
    }).toPass({ timeout: 10_000 });
  });
});
