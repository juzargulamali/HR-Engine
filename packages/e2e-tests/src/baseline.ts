import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { stateFile } from "./config";
import { testWorkday, testWeekendDay } from "./recordTag";
import { getEmployeeNameByAuthEmail, getAccountStatusCellText } from "./identity";
import { AttendancePage } from "./pages/AttendancePage";
import { LeavePage } from "./pages/LeavePage";

/**
 * Baseline/reconciliation state, captured and re-captured via the SAME
 * authenticated UI reads the functional specs already use (HR Admin's
 * Users & Roles list, the Employee's own Leave/Reimbursements/Attendance
 * pages) — never a direct database read, never a service-role key. This is
 * necessarily narrower than a full-table scan: it only knows what the app's
 * own UI shows a role. That's an accepted, explicit trade-off for not using
 * a service-role key anywhere in this suite (see README.md's safety model).
 */
export interface AccountSnapshot {
  capturedAt: string;
  employeeAccountStatusText: string;
  employeeAnnualLeaveBalanceText: string | null;
  employeeAnnualLeaveBalanceNumber: number | null;
  employeeReimbursementRows: string[];
  /** Keyed by the exact synthetic date string used this run (see
   * src/recordTag.ts's testWorkday()/testWeekendDay()) — the Employee's own
   * row text on that date's attendance register, or null if no row exists
   * yet (expected at baseline time, before the mutating project runs). */
  employeeAttendanceByDate: Record<string, string | null>;
}

function parseBalanceNumber(text: string | null): number | null {
  const match = text?.match(/[\d.]+/)?.[0];
  return match ? Number(match) : null;
}

/** Reads ONLY the Employee's status cell/badge from HR Admin's Users &
 * Roles list (read-only for HR Admin — see
 * packages/domain/src/permissions/users.ts's canManageAccountStatus doc
 * comment: only Sys Admin can toggle it, but HR Admin can always see it, so
 * this works even when no Sys Admin test account is configured). Never the
 * whole row's text — see src/identity.ts's getAccountStatusCellText doc
 * comment for why that produces a false "deactivated" reading on an
 * Active account. Throws (never returns null) if the row can't be found or
 * is ambiguous — an identity problem this suite should stop on immediately,
 * not paper over with a "(not found)" placeholder. */
export async function readEmployeeAccountStatus(hrAdminPage: Page, employeeEmail: string): Promise<string> {
  return getAccountStatusCellText(hrAdminPage, employeeEmail);
}

/** Delegates to LeavePage.getBalance(), which reads the balance NUMBER's
 * own element specifically (Card > CardContent, "<N> days") rather than any
 * digit found anywhere in the card — see LeavePage.ts's doc comment. */
export async function readEmployeeAnnualLeaveBalance(employeePage: Page): Promise<string | null> {
  const leavePage = new LeavePage(employeePage);
  await leavePage.gotoList();
  const text = await leavePage.getBalance("Annual");
  return text || null;
}

/** A coarse, best-effort snapshot of the Employee's reimbursement claims —
 * one string per visible row/card — used to notice that a new claim
 * appeared and to correlate it with this run's tag. */
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

/** The Employee's own row text on each of this run's two synthetic
 * attendance dates (the ordinary workday and the deliberate weekend day —
 * see recordTag.ts), read via HR Admin's attendance register. The
 * employee's name is resolved from their auth email via
 * getEmployeeNameByAuthEmail (a stable identifier), never a self-reported
 * name — see src/identity.ts. */
export async function readEmployeeAttendanceByDate(hrAdminPage: Page, employeeEmail: string, runId: string): Promise<Record<string, string | null>> {
  const employeeName = await getEmployeeNameByAuthEmail(hrAdminPage, employeeEmail);
  const attendance = new AttendancePage(hrAdminPage);
  const dates = [testWorkday(runId, 0), testWeekendDay(runId, 0)];
  const result: Record<string, string | null> = {};
  for (const date of dates) {
    await attendance.goto({ date });
    result[date] = await attendance.rowText(employeeName);
  }
  return result;
}

export async function captureSnapshot(hrAdminPage: Page, employeePage: Page, employeeEmail: string, runId: string): Promise<AccountSnapshot> {
  const employeeAnnualLeaveBalanceText = await readEmployeeAnnualLeaveBalance(employeePage);
  return {
    capturedAt: new Date().toISOString(),
    employeeAccountStatusText: await readEmployeeAccountStatus(hrAdminPage, employeeEmail),
    employeeAnnualLeaveBalanceText,
    employeeAnnualLeaveBalanceNumber: parseBalanceNumber(employeeAnnualLeaveBalanceText),
    employeeReimbursementRows: await readEmployeeReimbursementRows(employeePage),
    employeeAttendanceByDate: await readEmployeeAttendanceByDate(hrAdminPage, employeeEmail, runId),
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

/** Written by 10-leave.spec.ts's approve test right after a successful
 * approval, so reconciliation can correlate a balance change with the
 * SPECIFIC request that caused it and its EXACT expected day count — the
 * presence of tagged text alone proves a record exists, not that it
 * explains a particular numeric delta. */
export interface LeaveApprovalExpectation {
  reasonTag: string;
  leaveTypeLabel: string;
  leaveDaysRequested: number;
}

function expectationsFile(runId: string): string {
  return stateFile(runId).replace(/\.json$/, ".expectations.json");
}

export function writeLeaveApprovalExpectation(runId: string, expectation: LeaveApprovalExpectation): void {
  ensureStateDir(runId);
  writeFileSync(expectationsFile(runId), JSON.stringify(expectation, null, 2), "utf8");
}

export function readLeaveApprovalExpectation(runId: string): LeaveApprovalExpectation | null {
  const file = expectationsFile(runId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as LeaveApprovalExpectation;
}

export interface ReconciliationResult {
  markdown: string;
  /** True if something needs a human to look at it before this is safe to
   * call done — an account left deactivated, a login that stopped working,
   * or a balance change that doesn't match this run's specific approved
   * request. */
  hasUnexplainedChange: boolean;
}

/** Compares baseline vs. final snapshots and produces the reconciliation
 * report required by the standing authorization: every record/value that
 * remains changed after the run, and — for anything that can't be reset via
 * the UI — the exact values that need resetting in Supabase. A balance
 * change is only treated as EXPLAINED when it numerically matches THIS
 * run's specific approved leave request (via the expectations file 10-leave
 * .spec.ts writes) — tagged text being visible somewhere is not, by itself,
 * sufficient evidence that it explains a particular number. */
export function buildReconciliationReport(runId: string, baseline: AccountSnapshot, final: AccountSnapshot, employeeLoginStillWorks: boolean): ReconciliationResult {
  const lines: string[] = [`# Reconciliation report — ${runId}`, "", `Baseline captured: ${baseline.capturedAt}`, `Final captured:    ${final.capturedAt}`, ""];
  let hasUnexplainedChange = false;

  lines.push("## Employee test account status");
  lines.push(`- Baseline: \`${baseline.employeeAccountStatusText}\``);
  lines.push(`- Final:    \`${final.employeeAccountStatusText}\``);
  // Exact match against the literal badge label, per
  // account-status-controls.tsx's STATUS_LABEL ("Active" / "Deactivated —
  // access suspended" / "Invited") — this is now scoped to ONLY the status
  // cell (src/identity.ts's getAccountStatusCellText), never the whole row,
  // so it's no longer susceptible to a "Deactivate" BUTTON in the same row
  // (present precisely because the account IS active) matching a loose
  // /deactivat/i check.
  const baselineLooksActive = baseline.employeeAccountStatusText === "Active";
  const finalLooksActive = final.employeeAccountStatusText === "Active";
  if (!baselineLooksActive) {
    lines.push(`- Note: baseline status was not "Active" either — this account may not have started this run in a clean state.`);
  }
  if (!finalLooksActive || !employeeLoginStillWorks) {
    hasUnexplainedChange = true;
    lines.push(
      `- **PROBLEM: the Employee test account is not confirmed active and able to log in at the end of this run** (status text: "${final.employeeAccountStatusText}", fresh login succeeded: ${employeeLoginStillWorks}). ` +
        `Manual recovery: sign in as Sys Admin (E2E_ADMIN_EMAIL) -> /admin/users -> find the Employee test account's row -> click "Reactivate" and give any non-blank reason. ` +
        `If that doesn't work, the Supabase fallback (schema/schema.sql's account-security migration) is to set that profile's \`account_status\` column back to \`'active'\` and clear its \`banned_until\` column directly.`,
    );
  } else if (baseline.employeeAccountStatusText === final.employeeAccountStatusText) {
    lines.push("- OK — unchanged, active, and able to log in.");
  } else {
    lines.push("- OK — active and able to log in (status text changed but both read exactly \"Active\").");
  }
  lines.push("");

  lines.push("## Employee Annual Leave balance");
  lines.push(`- Baseline: \`${baseline.employeeAnnualLeaveBalanceText ?? "(not found)"}\` (parsed: ${baseline.employeeAnnualLeaveBalanceNumber ?? "n/a"})`);
  lines.push(`- Final:    \`${final.employeeAnnualLeaveBalanceText ?? "(not found)"}\` (parsed: ${final.employeeAnnualLeaveBalanceNumber ?? "n/a"})`);
  const expectation = readLeaveApprovalExpectation(runId);
  if (baseline.employeeAnnualLeaveBalanceNumber === null || final.employeeAnnualLeaveBalanceNumber === null) {
    if (baseline.employeeAnnualLeaveBalanceText !== final.employeeAnnualLeaveBalanceText) {
      hasUnexplainedChange = true;
      lines.push(`- **PROBLEM: the balance text changed but could not be parsed as a number on one or both sides — cannot verify the change is what this run expected.**`);
    } else {
      lines.push("- Unchanged (and unparseable as a number either way — confirm the balance-card format on a live run).");
    }
  } else {
    const actualDelta = baseline.employeeAnnualLeaveBalanceNumber - final.employeeAnnualLeaveBalanceNumber;
    if (Math.abs(actualDelta) < 0.001) {
      if (expectation) {
        hasUnexplainedChange = true;
        lines.push(
          `- **PROBLEM: this run recorded an approved leave request expecting a ${expectation.leaveDaysRequested}-day deduction ("${expectation.reasonTag}"), but the balance did not change at all.**`,
        );
      } else {
        lines.push("- Unchanged (no leave-approval expectation was recorded for this run either, consistent with no change).");
      }
    } else if (expectation && Math.abs(actualDelta - expectation.leaveDaysRequested) < 0.01) {
      lines.push(
        `- Changed by ${actualDelta} day(s), which exactly matches this run's approved request ("${expectation.reasonTag}", ${expectation.leaveDaysRequested} day(s) requested). ` +
          `This is a real, permanent, approved leave grant on the test account and was not reset — reversing it would itself be a real leave-ledger mutation this suite is not authorized to perform. ` +
          `To restore it: in Supabase, reverse/cancel the leave_requests row whose reason starts with "[${runId}] annual-leave-approve" for the Employee test account, and restore its leave_ledger entry.`,
      );
    } else {
      hasUnexplainedChange = true;
      const expectedText = expectation
        ? `${expectation.leaveDaysRequested} day(s) (from "${expectation.reasonTag}")`
        : "no expectations file was found for this run — either no leave approval ran, or (check first) the mutating job's .e2e-state/ artifact failed to transfer to this reconciliation job";
      lines.push(`- **PROBLEM: balance changed by ${actualDelta} day(s), but this does not match what this run expected (${expectedText}) — unexplained, investigate before treating this run as clean.**`);
    }
  }
  lines.push("");

  lines.push("## Employee reimbursement claims");
  const newRows = final.employeeReimbursementRows.filter((r) => !baseline.employeeReimbursementRows.includes(r));
  if (newRows.length === 0) {
    lines.push("- No new claim rows visible.");
  } else {
    lines.push(`- ${newRows.length} new row(s), all expected to carry this run's tag (\`[${runId}] ...\`):`);
    for (const row of newRows) {
      const tagged = row.includes(`[${runId}]`);
      lines.push(`  - \`${row}\`${tagged ? "" : " — **not tagged with this run's ID, investigate**"}`);
      if (!tagged) hasUnexplainedChange = true;
    }
    lines.push(
      `- These claims are real, permanent Production records (a smallest-allowed-amount, clearly fake test claim in \`approved\`/\`rejected\` state). They were never progressed past approval/rejection — no export, payment, or accounting integration was triggered. To remove rather than leave as identified test data: delete these specific tagged \`reimbursement_claim_lines\`/\`reimbursement_claims\` rows directly in Supabase.`,
    );
  }
  lines.push("");

  lines.push("## Employee attendance / recovery-leave records (this run's synthetic dates)");
  const attendanceDates = Object.keys(final.employeeAttendanceByDate);
  if (attendanceDates.length === 0) {
    lines.push("- No attendance dates were captured for this run.");
  } else {
    for (const date of attendanceDates) {
      const before = baseline.employeeAttendanceByDate[date] ?? null;
      const after = final.employeeAttendanceByDate[date] ?? null;
      lines.push(`- **${date}**: baseline \`${before ?? "(no row)"}\` -> final \`${after ?? "(no row)"}\``);
    }
    lines.push(
      "- These are on synthetic 2099+ dates (one ordinary working day, one deliberate weekend day used to exercise the automatic Recovery Leave credit path) — they can never collide with a real attendance day. Left in place; there is no delete UI for an attendance/recovery-credit record. To remove: delete the corresponding `attendance_records`/`recovery_credit_requests`/`comp_day_ledger` rows for the Employee test account directly in Supabase.",
    );
  }
  lines.push("");

  return { markdown: lines.join("\n"), hasUnexplainedChange };
}
