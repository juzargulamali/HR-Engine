import { test } from "../../src/fixtures";

/**
 * One-off, read-only audit of EVERY row currently on the Manager test
 * account's own /approvals — not just the ones from a specific tagged run.
 * Requested after manually resolving run E2E-20260928-012304's 3 stuck
 * leave requests, to see whether any of the OTHER pending items on that
 * same page are leftover E2E test data (tagged `[E2E-...]` in their
 * reason) versus real, untagged requests that should be left alone.
 *
 * Read-only — creates nothing, touches nothing, and has zero effect on any
 * future mutating dispatch (no runId is generated, no test account state
 * changes). approvals/page.tsx scopes every row to `approver_id =
 * session.userId`, so this only ever sees what the Manager test account
 * itself is authorized to see — nothing broader.
 *
 * Diagnostic only, not a permanent regression test — safe to delete once
 * its report has been read.
 */
const TAG_PATTERN = /\[E2E-\d{8}-\d{6}\]/;

test.describe("audit all pending items on the Manager test account's /approvals", () => {
  test("lists every current row, flagging which carry an [E2E-...] run tag", async ({ managerPage }) => {
    await managerPage.goto("/approvals");

    const rows = managerPage.getByRole("row");
    const count = await rows.count();

    const lines = [`# Pending-approvals audit (read ${new Date().toISOString()})`, "", `Total rows currently on /approvals: ${count}`, ""];

    let taggedCount = 0;
    let untaggedCount = 0;
    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).innerText()).replace(/\s+/g, " ").trim();
      if (!text) continue;
      const match = text.match(TAG_PATTERN);
      if (match) {
        taggedCount++;
        lines.push(`- [TAGGED ${match[0]}] \`${text}\``);
      } else {
        untaggedCount++;
        lines.push(`- [untagged] \`${text}\``);
      }
    }

    lines.push("", `Summary: ${taggedCount} row(s) carry an [E2E-...] run tag (safe to treat as suite leftovers), ${untaggedCount} row(s) do not (treat as real/unrelated — left untouched by this audit).`);

    const report = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log(report);
    await test.info().attach("pending-approvals-audit", { body: report, contentType: "text/markdown" });
  });
});
