import { test } from "../../src/fixtures";
import { getCredentials, hasCredentials } from "../../src/config";
import { captureSnapshot, writeSnapshot } from "../../src/baseline";

/**
 * Runs once per CI invocation of the `baseline` project, BEFORE read-only
 * or mutating tests run. Captures the pre-run state of the Employee test
 * account via the same authenticated UI reads the functional specs use —
 * no service role, no direct DB read (see src/baseline.ts). The
 * `reconciliation` project re-captures the same state at the end and diffs
 * against this file.
 *
 * Needs Sys Admin as well as HR Admin: captureSnapshot resolves the
 * Employee's name and status via `/admin/users`, which
 * apps/web/src/app/(app)/admin/layout.tsx gates to Sys Admin only — see
 * src/baseline.ts's doc comments. The mutating workflow's own
 * account-status test (50-account-status.spec.ts) already hard-requires
 * Sys Admin with no fallback, so this is never a NEW dependency for that
 * workflow — just made explicit here too, with the same skip-cleanly
 * convention, rather than failing with a less legible error deeper inside
 * captureSnapshot.
 */
test("capture pre-run baseline for the Employee test account", async ({ sysAdminPage, hrAdminPage, employeePage, runId }) => {
  test.skip(!hasCredentials("sysAdmin"), "No Sys Admin test account configured — required to read /admin/users for baseline capture.");
  const { email } = getCredentials("employee");
  const snapshot = await captureSnapshot(sysAdminPage, hrAdminPage, employeePage, email, runId);
  writeSnapshot(runId, "baseline", snapshot);
  // eslint-disable-next-line no-console
  console.log(`[baseline] captured for run ${runId}:`, JSON.stringify(snapshot, null, 2));
});
