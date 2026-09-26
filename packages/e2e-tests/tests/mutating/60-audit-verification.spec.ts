import { test, expect } from "../../src/fixtures";
import { isBackupConfirmed } from "../../src/config";

/**
 * Runs LAST among the mutating specs (see the "60-" filename prefix):
 * confirms this run's tagged mutations (leave, reimbursements) actually
 * left a trace in the audit log HR Admin can see — Section H's "verify
 * audit entries from the preceding E2E mutations". Read-only itself (only
 * views the audit log), but depends on the mutating specs above having run
 * in the same run ID, so it lives here rather than in tests/read-only/.
 */
test.describe("audit log reflects this run's mutations @mutating", () => {
  test.skip(!isBackupConfirmed(), "Mutation not authorized (E2E_BACKUP_CONFIRMED != 'true') — nothing tagged to verify.");

  test("this run's tag appears somewhere in the audit log", async ({ hrAdminPage, runId }) => {
    await hrAdminPage.goto("/audit-log");
    const count = await hrAdminPage.getByText(runId).count();
    if (count === 0) {
      test.info().annotations.push({
        type: "finding",
        description: `No audit-log entry visible containing "${runId}" — either this run's leave/reimbursement mutations were skipped (E2E_BACKUP_CONFIRMED was false when they ran), the audit log doesn't surface the tagged free-text field directly, or pagination/filtering hides it. Confirm on first live run before treating this as a defect.`,
      });
    }
    expect(count, `Expected at least one audit-log entry referencing this run's tag "${runId}"`).toBeGreaterThan(0);
  });
});
