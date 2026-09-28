import { test } from "../../src/fixtures";
import { LeavePage, ApprovalsPage, formatDateRange } from "../../src/pages/LeavePage";

const RUN_TAG_PREFIX = "[E2E-20260928-012304]";

/**
 * One-off, read-only confirmation for the specific tagged mutating run
 * E2E-20260928-012304 (GitHub Actions run 36365755828). That run's three
 * annual-leave tests all reported failure at submitRequest() itself — a bug
 * in the (now-fixed) v1 Promise.race()-based redirect/error detection, not
 * a timeout — so it was never established whether the underlying "Submit"
 * click (which fires the real server action, before the buggy client-side
 * race went wrong) actually created each leave_requests row in Production.
 * This test performs that independent read (real UI, no service role, no
 * direct DB read) — never asserting an expected value, since the whole
 * point is to observe whatever is actually there.
 *
 * Read-only — creates nothing, runs regardless of E2E_MUTATION_AUTHORIZED.
 *
 * This is diagnostic, not a permanent regression test: once its report
 * (this test's console output / attached report, or the job summary) has
 * been read, this file can be deleted.
 */
const TAGGED_REQUESTS: { label: string; note: string }[] = [
  { label: formatDateRange("2099-09-22", "2099-09-23"), note: "annual-leave-approve" },
  { label: formatDateRange("2099-09-29", "2099-09-29"), note: "annual-leave-reject" },
  { label: formatDateRange("2099-10-06", "2099-10-06"), note: "annual-leave-cancel" },
];

test.describe("confirm run E2E-20260928-012304's actual leave state", () => {
  test("reads each tagged request's real row text and the current Annual Leave balance (Employee's own /leave)", async ({ employeePage }) => {
    const leave = new LeavePage(employeePage);
    await leave.gotoList();

    const balance = await leave.getBalance("Annual");

    const lines = [
      `# Confirmed leave state for run E2E-20260928-012304 (read ${new Date().toISOString()})`,
      "",
      `Annual Leave balance card: \`${balance || "(not found)"}\``,
      "",
      "## Tagged requests (row text as currently rendered on /leave)",
      "",
    ];
    for (const { label, note } of TAGGED_REQUESTS) {
      const rowText = await leave.getRequestStatus(label);
      lines.push(`- **${note}** (Dates: \`${label}\`): ${rowText ? `\`${rowText}\`` : "NOT FOUND — no row currently matches this Dates label (may never have been created, or already resolved/removed since)"}`);
    }
    const report = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("confirm-E2E-20260928-012304-leave-state", { body: report, contentType: "text/markdown" });
  });

  test("confirms whether any of this run's leave requests are still stuck pending on the Manager test account's own /approvals", async ({ managerPage }) => {
    const approvals = new ApprovalsPage(managerPage);
    await approvals.goto();

    // Matches on the run's tag prefix (embedded in the reason approvals/
    // page.tsx renders), not the Dates label — /approvals shows a leave
    // request's tagged reason, never a formatted date range (that's only
    // rendered on /leave's own list). A request that's already been
    // approved/rejected/cancelled correctly shows here as NOT FOUND, since
    // /approvals only ever lists items still pending a decision. Reads
    // EVERY matching row (up to 3, one per test), not just the first —
    // more than one test could plausibly still be stuck pending at once.
    const rows = managerPage.getByRole("row", { name: new RegExp(RUN_TAG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
    const count = await rows.count();
    const rowTexts: string[] = [];
    for (let i = 0; i < count; i++) {
      rowTexts.push((await rows.nth(i).innerText()).replace(/\s+/g, " ").trim());
    }
    const report = [
      `# Confirmed approvals-side state for run E2E-20260928-012304 (read ${new Date().toISOString()})`,
      "",
      count === 0
        ? `No row on /approvals is still tagged \`${RUN_TAG_PREFIX}\` — nothing from this run is currently stuck pending (already decided, or was never created).`
        : `${count} row(s) on /approvals still tagged \`${RUN_TAG_PREFIX}\`:`,
      ...rowTexts.map((t) => `- \`${t}\``),
    ].join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("confirm-E2E-20260928-012304-approvals-state", { body: report, contentType: "text/markdown" });
  });
});
