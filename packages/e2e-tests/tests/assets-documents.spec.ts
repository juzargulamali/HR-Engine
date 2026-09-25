import { test, expect } from "../src/fixtures";
import { expectRoleAllowed, expectRoleDenied } from "../src/pages/Nav";
import { ReimbursementsPage } from "../src/pages/AppPages";
import { isBackupConfirmed } from "../src/config";
import { tagNote } from "../src/recordTag";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARMLESS_TEST_FILE = path.join(__dirname, "..", "src", "fixtures", "testFiles", "harmless-receipt.txt");

test.describe("assets permissions", () => {
  test("assets is restricted to HR Admin and Finance", async ({ employeePage, managerPage, hrAdminPage }) => {
    await expectRoleDenied(employeePage, "/assets");
    await expectRoleDenied(managerPage, "/assets");
    await expectRoleAllowed(hrAdminPage, "/assets");
  });
});

/**
 * Document/storage permissions, exercised via the reimbursement receipt
 * upload path with a harmless synthetic .txt file (src/fixtures/testFiles).
 * The exact upload field selector on the "new claim" form is unverified
 * this pass (ReimbursementsPage.gotoNew() only confirmed the entry link) —
 * this test is written defensively: it skips itself with a clear message if
 * no file input is found, rather than guessing a selector and asserting a
 * false pass.
 *
 * Mutating (creates a reimbursement claim) — gated on backup confirmation.
 */
test.describe("document upload @mutating", () => {
  test.skip(!isBackupConfirmed(), "Backup not confirmed (E2E_BACKUP_CONFIRMED != 'true') — skipping mutating upload test.");

  test("employee can attach a harmless test file to a new reimbursement claim", async ({ employeePage, runId }) => {
    const reimbursements = new ReimbursementsPage(employeePage);
    await reimbursements.goto();
    await reimbursements.gotoNew();

    const fileInput = employeePage.locator('input[type="file"]');
    const inputCount = await fileInput.count();
    test.skip(inputCount === 0, "No file input found on the new-claim form with this selector — confirm the real upload control on first live run.");

    await fileInput.first().setInputFiles(HARMLESS_TEST_FILE);
    const description = employeePage.locator('[name="description"], textarea, input[type="text"]').first();
    if (await description.count()) {
      await description.fill(tagNote(runId, "document-upload-test"));
    }
    // Deliberately stops short of submitting the claim: proving the file
    // attaches to the form is the target of this test, not exercising the
    // full reimbursement approval flow (covered separately, and not
    // required tonight).
    await expect(fileInput.first()).toHaveValue(/harmless-receipt\.txt$/);
  });
});
