import { test, expect } from "../../src/fixtures";
import { getCredentials, hasCredentials } from "../../src/config";
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
 * credentials still authenticate a brand-new session. This runs FIRST,
 * before anything that depends on a baseline snapshot existing, so it still
 * happens even when the `baseline` job itself failed (in which case
 * `read-only` and `mutating` are skipped by the workflow's own `needs:`
 * graph — nothing was mutated, but the login check is still real,
 * independent evidence, not something to skip along with the diff).
 */
test("reconcile final state against baseline and verify the Employee account", async ({ sysAdminPage, hrAdminPage, employeePage, browser, runId }) => {
  const { email, password } = getCredentials("employee");
  const outDir = path.join(process.cwd(), "test-results", "reconciliation");
  mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `${runId}.md`);

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

  const baseline = readSnapshot(runId, "baseline");
  if (!baseline) {
    // `needs.mutating.result` (see the mutating workflow's reconciliation
    // job) — "skipped" is the ONLY value that genuinely means nothing in
    // Production was touched (the workflow's own `needs:` graph never lets
    // `mutating` start unless `read-only` passed after `baseline`). Any
    // other value ("success" or "failure") means the `mutating` job's
    // Playwright process actually ran and could have made real, permanent
    // Production changes — a missing baseline in that case is an artifact
    // pipeline failure, not proof of an all-clear, and must never be
    // reported as one (confirmed live: run 36351884519's baseline really
    // did capture successfully, but its state artifact failed to upload —
    // see config.ts's stateFile() doc comment — and this branch printed
    // "no mutations ran" while 7 real mutating tests had just run).
    const mutatingResult = process.env.E2E_MUTATING_JOB_RESULT ?? "";
    const mutatingRan = mutatingResult !== "" && mutatingResult !== "skipped";
    const markdown = mutatingRan
      ? [
          `# Reconciliation report — ${runId}`,
          "",
          "**PROBLEM: baseline unavailable, but the `mutating` job ran (result: `" + mutatingResult + "`).**",
          "",
          "This is not \"no mutations ran\" — `read-only` only starts after `baseline` succeeds, and `mutating` only starts after `read-only` passes, so the mutating Playwright tests genuinely executed and may have made real, permanent Production changes (leave requests, reimbursement claims, attendance/recovery-credit records, account status). What's missing is only this run's baseline SNAPSHOT — most likely its `.e2e-state` artifact failed to upload or download (see the `baseline` job's own upload step and this job's download steps), not that nothing happened.",
          "",
          "Do not treat this run as clean. Check the `mutating` job's own logs/JUnit/screenshots for what it actually did, and manually inspect the Employee test account's leave requests, reimbursement claims, and attendance records for this run's tag before dispatching again.",
          "",
          `Employee test account login check (independent of baseline, always performed): ${employeeLoginStillWorks ? "OK — signed in successfully." : "**PROBLEM — could not sign in.**"}`,
          "",
        ].join("\n")
      : [
          `# Reconciliation report — ${runId}`,
          "",
          "**Baseline unavailable; no mutations ran.**",
          "",
          "The `baseline` job did not produce a snapshot for this run (see its own failure earlier in this workflow run). Per the workflow's job graph, `read-only` and `mutating` both depend on `baseline` succeeding and were skipped as a result (`mutating` result: `" + (mutatingResult || "unknown") + "`) — nothing in Production was touched, so there is nothing to reconcile against.",
          "",
          `Employee test account login check (independent of baseline, always performed): ${employeeLoginStillWorks ? "OK — signed in successfully." : "**PROBLEM — could not sign in.**"}`,
          "",
        ].join("\n");
    writeFileSync(reportPath, markdown, "utf8");
    await test.info().attach("reconciliation-report", { path: reportPath, contentType: "text/markdown" });
    // eslint-disable-next-line no-console
    console.log(markdown);
    expect(employeeLoginStillWorks, "Employee test account must be able to log in even when there is no baseline to reconcile against").toBe(true);
    expect(mutatingRan, "Baseline is unavailable but the mutating job ran — this must fail loudly rather than falsely report \"no mutations ran\" (see the reconciliation-report attachment)").toBe(false);
    return;
  }

  test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to read /admin/users for the final snapshot.");

  const finalSnapshot = await captureSnapshot(sysAdminPage, hrAdminPage, employeePage, email, runId);
  writeSnapshot(runId, "final", finalSnapshot);

  const result = buildReconciliationReport(runId, baseline, finalSnapshot, employeeLoginStillWorks);

  writeFileSync(reportPath, result.markdown, "utf8");
  await test.info().attach("reconciliation-report", { path: reportPath, contentType: "text/markdown" });

  // eslint-disable-next-line no-console
  console.log(result.markdown);

  expect(employeeLoginStillWorks, "Employee test account must be able to log in at the end of the run").toBe(true);
  expect(result.hasUnexplainedChange, "Reconciliation found an unexplained change — see the reconciliation-report attachment / test-results/reconciliation/*.md").toBe(false);
});
