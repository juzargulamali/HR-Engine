import { test } from "../../src/fixtures";
import { getCredentials } from "../../src/config";
import { captureSnapshot, writeSnapshot } from "../../src/baseline";

/**
 * Runs once per CI invocation of the `baseline` project, BEFORE read-only
 * or mutating tests run. Captures the pre-run state of the Employee test
 * account via the same authenticated UI reads the functional specs use —
 * no service role, no direct DB read (see src/baseline.ts). The
 * `reconciliation` project re-captures the same state at the end and diffs
 * against this file.
 */
test("capture pre-run baseline for the Employee test account", async ({ hrAdminPage, employeePage, runId }) => {
  const { email } = getCredentials("employee");
  const snapshot = await captureSnapshot(hrAdminPage, employeePage, email, runId);
  writeSnapshot(runId, "baseline", snapshot);
  // eslint-disable-next-line no-console
  console.log(`[baseline] captured for run ${runId}:`, JSON.stringify(snapshot, null, 2));
});
