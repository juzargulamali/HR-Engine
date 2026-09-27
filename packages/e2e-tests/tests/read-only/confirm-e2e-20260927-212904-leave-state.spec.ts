import { test } from "../../src/fixtures";
import { LeavePage, ApprovalsPage, formatDateRange } from "../../src/pages/LeavePage";

/**
 * One-off, read-only confirmation for the specific tagged mutating run
 * E2E-20260927-212904 (GitHub Actions run 36351884519). That run's three
 * annual-leave tests each created a real leave_requests row but failed
 * before reaching approve/reject/cancel — their final status was reported
 * to the user as "left pending" INFERRED from where the tests stopped, not
 * independently read back from the app. These tests perform that
 * independent read (real UI, no service role, no direct DB read) — never
 * asserting an expected value, since the whole point is to observe
 * whatever is actually there.
 *
 * Read-only — creates nothing, runs regardless of E2E_MUTATION_AUTHORIZED.
 *
 * This is diagnostic, not a permanent regression test: once its report
 * (this test's console output / attached report, or the job summary) has
 * been read, and the three requests below have been resolved one way or
 * another, this file can be deleted.
 */
const TAGGED_REQUESTS: { label: string; note: string }[] = [
  { label: formatDateRange("2099-03-10", "2099-03-11"), note: "annual-leave-approve" },
  { label: formatDateRange("2099-03-17", "2099-03-17"), note: "annual-leave-reject" },
  { label: formatDateRange("2099-03-18", "2099-03-18"), note: "annual-leave-cancel" },
];

test.describe("confirm run E2E-20260927-212904's actual leave state", () => {
  test("reads each tagged request's real row text and the current Annual Leave balance (Employee's own /leave)", async ({ employeePage }) => {
    const leave = new LeavePage(employeePage);
    await leave.gotoList();

    const balance = await leave.getBalance("Annual");

    const lines = [
      `# Confirmed leave state for run E2E-20260927-212904 (read ${new Date().toISOString()})`,
      "",
      `Annual Leave balance card: \`${balance || "(not found)"}\``,
      "",
      "## Tagged requests (row text as currently rendered on /leave)",
      "",
    ];
    for (const { label, note } of TAGGED_REQUESTS) {
      const rowText = await leave.getRequestStatus(label);
      lines.push(`- **${note}** (Dates: \`${label}\`): ${rowText ? `\`${rowText}\`` : "NOT FOUND — no row currently matches this Dates label (may have been resolved/removed since)"}`);
    }
    const report = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("confirm-E2E-20260927-212904-leave-state", { body: report, contentType: "text/markdown" });
  });

  test("confirms the Manager test account can see a matching request in its own /approvals, and reads its tagged reason", async ({ managerPage }) => {
    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();

    const lines = [
      `# Confirmed approvals-side state for run E2E-20260927-212904 (read ${new Date().toISOString()})`,
      "",
      "## Tagged requests (row text as currently rendered on /approvals, Manager test account's own session)",
      "",
    ];
    for (const { label, note } of TAGGED_REQUESTS) {
      const rowText = await approvals.getPendingRowText(label);
      lines.push(`- **${note}** (Dates: \`${label}\`): ${rowText ? `\`${rowText}\`` : "NOT FOUND — no row currently matches this Dates label on /approvals (may not be routed here, or already decided)"}`);
    }
    const report = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("confirm-E2E-20260927-212904-approvals-state", { body: report, contentType: "text/markdown" });
  });
});
