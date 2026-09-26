import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { stateFile } from "./config";
import { isTagged } from "./recordTag";

/**
 * Baseline/reconciliation state, captured and re-captured via the SAME
 * authenticated UI reads the functional specs already use (HR Admin's
 * Users & Roles list, the Employee's own Leave and Reimbursements pages) —
 * never a direct database read, never a service-role key. This is
 * necessarily narrower than a full-table scan: it only knows what the app's
 * own UI shows a role. That's an accepted, explicit trade-off for not using
 * a service-role key anywhere in this suite (see README.md's safety model).
 */
export interface AccountSnapshot {
  capturedAt: string;
  employeeAccountStatusText: string | null;
  employeeAnnualLeaveBalanceText: string | null;
  employeeReimbursementRows: string[];
}

/** Reads the Employee row's status cell from HR Admin's Users & Roles list
 * (read-only for HR Admin — see packages/domain/src/permissions/users.ts's
 * canManageAccountStatus doc comment: only Sys Admin can toggle it, but HR
 * Admin can always see it, so this works even when no Sys Admin test
 * account is configured). */
export async function readEmployeeAccountStatus(hrAdminPage: Page, employeeEmail: string): Promise<string | null> {
  await hrAdminPage.goto("/admin/users");
  const row = hrAdminPage.getByRole("row", { name: new RegExp(employeeEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
  if ((await row.count()) === 0) return null;
  return (await row.first().innerText()).replace(/\s+/g, " ").trim();
}

export async function readEmployeeAnnualLeaveBalance(employeePage: Page): Promise<string | null> {
  await employeePage.goto("/leave");
  const card = employeePage.getByText(/annual/i).locator("..");
  if ((await card.count()) === 0) return null;
  return ((await card.first().textContent()) ?? "").replace(/\s+/g, " ").trim();
}

/** A coarse, best-effort snapshot of the Employee's reimbursement claims —
 * one string per visible row/card — used only to notice that a new claim
 * appeared and to correlate it with this run's tag, not to parse amounts. */
export async function readEmployeeReimbursementRows(employeePage: Page): Promise<string[]> {
  await employeePage.goto("/reimbursements");
  const rows = employeePage.getByRole("row");
  const count = await rows.count();
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    texts.push((await rows.nth(i).innerText()).replace(/\s+/g, " ").trim());
  }
  return texts;
}

export async function captureSnapshot(hrAdminPage: Page, employeePage: Page, employeeEmail: string): Promise<AccountSnapshot> {
  return {
    capturedAt: new Date().toISOString(),
    employeeAccountStatusText: await readEmployeeAccountStatus(hrAdminPage, employeeEmail),
    employeeAnnualLeaveBalanceText: await readEmployeeAnnualLeaveBalance(employeePage),
    employeeReimbursementRows: await readEmployeeReimbursementRows(employeePage),
  };
}

function ensureStateDir(runId: string): void {
  mkdirSync(path.dirname(stateFile(runId)), { recursive: true });
}

export function writeSnapshot(runId: string, label: "baseline" | "final", snapshot: AccountSnapshot): void {
  ensureStateDir(runId);
  const file = stateFile(runId).replace(/\.json$/, `.${label}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
}

export function readSnapshot(runId: string, label: "baseline" | "final"): AccountSnapshot | null {
  const file = stateFile(runId).replace(/\.json$/, `.${label}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as AccountSnapshot;
}

export interface ReconciliationResult {
  markdown: string;
  /** True if something needs a human to look at it before this is safe to
   * call done — an account left deactivated, a login that stopped working,
   * or a balance change with no matching tagged record to explain it. */
  hasUnexplainedChange: boolean;
}

/** Compares baseline vs. final snapshots and produces the reconciliation
 * report required by the standing authorization: every record/value that
 * remains changed after the run, and — for anything that can't be reset via
 * the UI — the exact values that need resetting in Supabase. `runId` is
 * used to recognize a leave-balance change as EXPECTED (a tagged, approved
 * leave request from this same run explains it) vs. UNEXPECTED (no such
 * record is visible — investigate before calling the run clean). */
export function buildReconciliationReport(runId: string, baseline: AccountSnapshot, final: AccountSnapshot, taggedApprovedLeaveVisible: boolean, employeeLoginStillWorks: boolean): ReconciliationResult {
  const lines: string[] = [`# Reconciliation report — ${runId}`, "", `Baseline captured: ${baseline.capturedAt}`, `Final captured:    ${final.capturedAt}`, ""];
  let hasUnexplainedChange = false;

  lines.push("## Employee test account status");
  lines.push(`- Baseline: \`${baseline.employeeAccountStatusText ?? "(not found)"}\``);
  lines.push(`- Final:    \`${final.employeeAccountStatusText ?? "(not found)"}\``);
  const statusLooksActive = /\bactive\b/i.test(final.employeeAccountStatusText ?? "") && !/deactivat/i.test(final.employeeAccountStatusText ?? "");
  if (!statusLooksActive || !employeeLoginStillWorks) {
    hasUnexplainedChange = true;
    lines.push(`- **PROBLEM: the Employee test account is not confirmed active and able to log in at the end of this run.** Reset \`profiles.account_status\` to \`'active'\` and clear \`banned_until\` for this account in Supabase if the app's own reactivation flow did not already do so.`);
  } else {
    lines.push("- OK — active and able to log in.");
  }
  lines.push("");

  lines.push("## Employee Annual Leave balance");
  lines.push(`- Baseline: \`${baseline.employeeAnnualLeaveBalanceText ?? "(not found)"}\``);
  lines.push(`- Final:    \`${final.employeeAnnualLeaveBalanceText ?? "(not found)"}\``);
  if (baseline.employeeAnnualLeaveBalanceText !== final.employeeAnnualLeaveBalanceText) {
    if (taggedApprovedLeaveVisible) {
      lines.push(`- Changed, and explained: this run's tagged, approved leave request (\`[${runId}] ...\`) accounts for it. This is a real, permanent, approved leave grant on the test account and was not reset — reversing it would itself be a real leave-ledger mutation this suite is not authorized to perform. If you want the balance restored, cancel/reverse that approved request for the Employee test account directly in Supabase.`);
    } else {
      hasUnexplainedChange = true;
      lines.push(`- **PROBLEM: balance changed but no matching tagged, approved leave request from this run is visible — unexplained, investigate before treating this run as clean.**`);
    }
  } else {
    lines.push("- Unchanged.");
  }
  lines.push("");

  lines.push("## Employee reimbursement claims");
  const newRows = final.employeeReimbursementRows.filter((r) => !baseline.employeeReimbursementRows.includes(r));
  if (newRows.length === 0) {
    lines.push("- No new claim rows visible.");
  } else {
    lines.push(`- ${newRows.length} new row(s), all expected to carry this run's tag (\`[${runId}] ...\`):`);
    for (const row of newRows) {
      const tagged = isTagged(row, runId) || row.includes(`[${runId}]`);
      lines.push(`  - \`${row}\`${tagged ? "" : " — **not tagged with this run's ID, investigate**"}`);
      if (!tagged) hasUnexplainedChange = true;
    }
    lines.push(
      `- These claims are real, permanent Production records (a smallest-allowed-amount, clearly fake test claim in \`approved\`/\`rejected\` state). They were never progressed past approval/rejection — no export, payment, or accounting integration was triggered. If you want them removed rather than left as identified test data, delete these specific tagged rows directly in Supabase; they are otherwise harmless and clearly identified.`,
    );
  }
  lines.push("");

  return { markdown: lines.join("\n"), hasUnexplainedChange };
}
