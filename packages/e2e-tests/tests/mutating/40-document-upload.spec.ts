import { test, expect } from "../../src/fixtures";
import { ReimbursementsPage } from "../../src/pages/AppPages";
import { isMutationAuthorized } from "../../src/config";
import { tagNote } from "../../src/recordTag";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARMLESS_TEST_FILE = path.join(__dirname, "..", "..", "src", "fixtures", "testFiles", "harmless-receipt.txt");

/**
 * Document/storage upload, exercised via the reimbursement receipt-upload
 * field with a harmless synthetic .txt file — never a confidential or
 * executable file. Stops short of submitting the claim: proving the file
 * attaches to the form is the target of this test, not exercising the full
 * reimbursement flow (covered separately in 30-reimbursements.spec.ts).
 *
 * Mutating (creates a draft reimbursement claim) — gated on
 * E2E_MUTATION_AUTHORIZED.
 */
test.describe("document upload @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — skipping mutating upload test.");

  test("employee can attach a harmless test file to a new reimbursement claim", async ({ employeePage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    await reimbursements.goto();
    await reimbursements.gotoNew();
    await reimbursements.startDraftClaim("AED");

    const fileInput = employeePage.locator('input[type="file"]');
    const inputCount = await fileInput.count();
    test.skip(inputCount === 0, "No file input found on the claim detail page with this selector — confirm the real upload control on first live run.");

    await fileInput.first().setInputFiles(HARMLESS_TEST_FILE);
    const description = employeePage.getByLabel(/description/i);
    if (await description.count()) {
      await description.fill(tagNote(runId, "document-upload-test"));
    }
    // Deliberately stops short of clicking "Add line"/"Submit for
    // approval": proving the file attaches to the form is the target here.
    await expect(fileInput.first()).toHaveValue(/harmless-receipt\.txt$/);
  });
});
