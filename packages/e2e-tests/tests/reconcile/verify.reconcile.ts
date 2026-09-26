import { test, expect } from "../../src/fixtures";
import { getCredentials } from "../../src/config";
import { captureSnapshot, readSnapshot, writeSnapshot, buildReconciliationReport } from "../../src/baseline";
import { LoginPage } from "../../src/pages/LoginPage";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Runs once per CI invocation of the `reconciliation` project, AFTER the
 * mutating project (always — even if a mutating test failed partway; see
 * the mutating GitHub Actions workflow's `if: always()`). Re-captures the
 * same state baseline.baseline.ts captured, via the same UI reads, then
 * reports every record/value that remains changed — per the standing
 * authorization: "Report every record and value that remains changed after
 * the run... tell me the exact values that need resetting."
 *
 * Global teardown requirement ("verify the Employee test account is active
 * and can log in") is done here as a REAL fresh sign-in — not a reused
 * storageState — because that's the only way to actually prove the
 * credentials still authenticate a brand-new session.
 */
test("reconcile final state against baseline and verify the Employee account", async ({ hrAdminPage, employeePage, browser, runId }) => {
  const { email, password } = getCredentials("employee");

  const finalSnapshot = await captureSnapshot(hrAdminPage, employeePage, email);
  writeSnapshot(runId, "final", finalSnapshot);

  const baseline = readSnapshot(runId, "baseline");
  test.skip(!baseline, `No baseline found for run ${runId} — the baseline project did not run first, nothing to reconcile against.`);

  // Real, fresh sign-in — proves the account is genuinely usable, not just
  // that a previously-saved session cookie still happens to work.
  const context = await browser.newContext();
  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  let employeeLoginStillWorks = false;
  try {
    await loginPage.goto();
    await loginPage.signIn(email, password);
    await loginPage.expectSignedIn();
    employeeLoginStillWorks = true;
  } catch {
    employeeLoginStillWorks = false;
  } finally {
    await context.close();
  }

  // A tagged leave row visible in the Employee's own list is treated as
  // "explains a balance change" — see src/baseline.ts's doc comment.
  await employeePage.goto("/leave");
  const taggedLeaveVisible = (await employeePage.getByText(`[${runId}]`).count()) > 0;

  const result = buildReconciliationReport(runId, baseline!, finalSnapshot, taggedLeaveVisible, employeeLoginStillWorks);

  const outDir = path.join(process.cwd(), "test-results", "reconciliation");
  mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `${runId}.md`);
  writeFileSync(reportPath, result.markdown, "utf8");
  await test.info().attach("reconciliation-report", { path: reportPath, contentType: "text/markdown" });

  // eslint-disable-next-line no-console
  console.log(result.markdown);

  expect(employeeLoginStillWorks, "Employee test account must be able to log in at the end of the run").toBe(true);
  expect(result.hasUnexplainedChange, "Reconciliation found an unexplained change — see the reconciliation-report attachment / test-results/reconciliation/*.md").toBe(false);
});
