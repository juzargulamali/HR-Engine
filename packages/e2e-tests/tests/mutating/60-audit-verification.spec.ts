import { test, expect } from "../../src/fixtures";
import { AuditLogPage } from "../../src/pages/AppPages";
import { isMutationAuthorized } from "../../src/config";

/**
 * Runs LAST among the mutating specs (see the "60-" filename prefix):
 * confirms this run's mutations (leave requests) actually left a trace in
 * the audit log HR Admin can see — Section H's "verify audit entries from
 * the preceding E2E mutations". Read-only itself (only views the audit
 * log), but depends on the mutating specs above having run in the same run
 * ID, so it lives here rather than in tests/read-only/.
 *
 * Checks for a matching ROW (table=leave_requests, action=insert, from
 * today), never the run's tag as free text — verified directly from
 * apps/web/src/app/(app)/audit-log/page.tsx: its rows only ever render
 * When/Table/(truncated) Entity ID/Action/Actor/Actor role(s)/Source, never
 * any free-text or tagged field. A tag search here can never succeed
 * regardless of whether the mutations happened (confirmed live, run
 * 36351884519) — it was a test-expectation bug, not something this page can
 * ever be made to show without adding a feature this suite has no
 * authorization to request.
 */
test.describe("audit log reflects this run's mutations @mutating", () => {
  test.skip(!isMutationAuthorized(), "Mutation not authorized (E2E_MUTATION_AUTHORIZED != 'true') — nothing to verify.");

  test("this run's leave-request inserts appear in the audit log", async ({ hrAdminPage }) => {
    const auditLog = new AuditLogPage(hrAdminPage);
    const today = new Date().toISOString().slice(0, 10);

    await auditLog.goto();
    await auditLog.filterBy({ table: "leave_requests", action: "insert", from: today });
    await auditLog.expectTableHasRows("leave_requests");
  });
});
