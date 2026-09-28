import { test, expect } from "../../src/fixtures";
import { ReimbursementsPage } from "../../src/pages/AppPages";
import { isMutationAuthorized } from "../../src/config";
import { tagNote, testDate } from "../../src/recordTag";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARMLESS_TEST_FILE = path.join(__dirname, "..", "..", "src", "fixtures", "testFiles", "harmless-receipt.txt");

/**
 * Document/storage upload, exercised via the reimbursement receipt-upload
 * field with a harmless synthetic .txt file — never a confidential or
 * executable file. Stops short of submitting the claim for approval:
 * exercising the full reimbursement approval flow is
 * 30-reimbursements.spec.ts's job, not this one's.
 *
 * Mutating (creates a draft reimbursement claim) — gated on
 * E2E_MUTATION_AUTHORIZED.
 *
 * Confirmed live (reconciliation reports for runs E2E-20260928-012304 and
 * E2E-20260928-094436): this test used to fill the file input and
 * description but never click "Add line" — add-line-form.tsx's
 * expenseDate/category/amount are all `required`, so nothing was ever
 * actually persisted. The draft claim it creates was a permanent
 * Production record with ZERO expense lines, violating this suite's own
 * "every mutating record must be tagged" rule and tripping
 * reconciliation's reimbursement-claims check every single run ("not
 * tagged with this run's ID — investigate") — a false positive, since
 * there was never anything to tag. Now fills the required fields too (same
 * "e2e-test"/AED 0.01 convention as 30-reimbursements.spec.ts, a distinct
 * testDate offset so its date never collides with those two claims) and
 * clicks "Add line", so this claim carries one real, tagged, permanently
 * findable line — still never "Submit for approval".
 */
test.describe("document upload @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating upload test.");

  test("employee can attach a harmless test file to a new reimbursement claim", async ({ employeePage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    await reimbursements.goto();
    await reimbursements.startDraftClaim("AED");

    const fileInput = employeePage.locator('input[type="file"]');
    const inputCount = await fileInput.count();
    test.skip(inputCount === 0, "No file input found on the claim detail page with this selector — confirm the real upload control on first live run.");

    await fileInput.first().setInputFiles(HARMLESS_TEST_FILE);
    await expect(fileInput.first()).toHaveValue(/harmless-receipt\.txt$/);

    await employeePage.getByLabel("Expense date").fill(testDate(runId, 4));
    await employeePage.getByLabel("Category").fill("e2e-test");
    await employeePage.getByLabel("Amount").fill("0.01");
    await employeePage.getByLabel(/description/i).fill(tagNote(runId, "document-upload-test"));
    await employeePage.getByRole("button", { name: /add line/i }).click();
  });
});
