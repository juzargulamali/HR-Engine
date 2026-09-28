import { test, expect } from "../../src/fixtures";

/**
 * Two one-off, read-only checks requested after manually resolving every
 * known [E2E-...]-tagged leave request found on the Manager test account's
 * /approvals (runs E2E-20260928-012304, E2E-20260927-212904, and
 * E2E-20260927-234659):
 *
 * 1. Re-sweep /approvals and assert NO row still carries an [E2E-...] run
 *    tag — a real regression check this time (not just an observation),
 *    since the whole point is confirming the manual cleanup actually took.
 *
 * 2. Investigate the 2 untagged reimbursement claims spotted during the
 *    first sweep (AED 0.01, dated 2026-09-28 — the exact "smallest allowed
 *    test amount" convention this suite always uses, but with no
 *    [E2E-...] tag anywhere, so they were left untouched rather than
 *    guessed at). approvals/page.tsx's reimbursement-claims table never
 *    renders a claim's description (confirmed from source, see
 *    ApprovalsPage's own doc comments) — only each claim's own detail page
 *    does, via its expense lines' Description column. This visits every
 *    reimbursement claim currently pending on /approvals and reads its
 *    full detail (claim date, currency/amount, status, and every line's
 *    date/category/amount/description) so a human can judge whether it's
 *    old test data or something else — no tag matching, no assumptions.
 *
 * Read-only — creates nothing, touches nothing, has zero effect on any
 * future mutating dispatch. Diagnostic only, safe to delete once read.
 */
const TAG_PATTERN = /\[E2E-\d{8}-\d{6}\]/;

test.describe("post-cleanup sweep of the Manager test account's /approvals", () => {
  test("confirms no row still carries an [E2E-...] run tag", async ({ managerPage }) => {
    await managerPage.goto("/approvals");

    const rows = managerPage.getByRole("row");
    const count = await rows.count();

    const stillTagged: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).innerText()).replace(/\s+/g, " ").trim();
      if (TAG_PATTERN.test(text)) stillTagged.push(text);
    }

    const report = [
      `# Post-cleanup sweep (read ${new Date().toISOString()})`,
      "",
      `Total rows on /approvals: ${count}`,
      `Rows still carrying an [E2E-...] tag: ${stillTagged.length}`,
      ...stillTagged.map((t) => `- \`${t}\``),
    ].join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("post-cleanup-sweep", { body: report, contentType: "text/markdown" });

    expect(stillTagged, `Expected zero tagged rows remaining after manual cleanup, found ${stillTagged.length}:\n${report}`).toHaveLength(0);
  });

  test("reads full detail (date/currency/amount/status/lines) of every reimbursement claim currently pending", async ({ managerPage }) => {
    await managerPage.goto("/approvals");

    const claimLinks = managerPage.locator('a[href^="/reimbursements/"]');
    const linkCount = await claimLinks.count();
    const claimIds: string[] = [];
    for (let i = 0; i < linkCount; i++) {
      const href = await claimLinks.nth(i).getAttribute("href");
      const id = href?.match(/^\/reimbursements\/([^/?#]+)$/)?.[1];
      if (id) claimIds.push(id);
    }

    const lines = [`# Pending reimbursement claims — full detail (read ${new Date().toISOString()})`, "", `Claims currently pending approval: ${claimIds.length}`, ""];

    for (const claimId of claimIds) {
      await managerPage.goto(`/reimbursements/${claimId}`);
      const heading = (await managerPage.locator("h1").first().textContent())?.trim() ?? "";
      const claimDate = (await managerPage.locator("p.text-muted-foreground").first().textContent())?.trim() ?? "";
      const status = ((await managerPage.getByText(/^(draft|submitted|pending approval|approved|rejected|cancelled)$/i).first().textContent()) ?? "").trim();

      lines.push(`## Claim ${claimId}`, `- Heading: \`${heading}\``, `- Claim date: \`${claimDate}\``, `- Status: \`${status}\``, "- Expense lines:");

      const lineRows = managerPage.getByRole("row");
      const lineRowCount = await lineRows.count();
      let sawLine = false;
      for (let i = 1; i < lineRowCount; i++) {
        const cells = lineRows.nth(i).getByRole("cell");
        const cellCount = await cells.count();
        if (cellCount < 4) continue;
        sawLine = true;
        const date = (await cells.nth(0).innerText()).trim();
        const category = (await cells.nth(1).innerText()).trim();
        const amount = (await cells.nth(2).innerText()).trim();
        const description = (await cells.nth(3).innerText()).trim();
        lines.push(`  - date=\`${date}\` category=\`${category}\` amount=\`${amount}\` description=\`${description}\``);
      }
      if (!sawLine) lines.push("  - (no expense lines)");
      lines.push("");
    }

    const report = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("pending-reimbursement-claims-detail", { body: report, contentType: "text/markdown" });
  });
});
