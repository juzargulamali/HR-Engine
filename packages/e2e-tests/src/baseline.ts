import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { stateFile } from "./config";
import { testWorkday, testWeekendDay, isTagged } from "./recordTag";
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
  employeeReimbursementClaims: ReimbursementClaimSnapshot[];
  /** Keyed by the exact synthetic date string used this run (see
   * src/recordTag.ts's testWorkday()/testWeekendDay()) — the Employee's own
   * attendance register values on that date (status/work mode/hours), or
   * null if no row exists yet (expected at baseline time, before the
   * mutating project runs). */
  employeeAttendanceByDate: Record<string, string | null>;
}

/** One claim's actual, current state, read from ITS OWN detail page — never
 * from the list page, which (verified from source,
 * apps/web/src/app/(app)/reimbursements/page.tsx) only ever shows Date/
 * Amount/Status, never the tagged description. `description` is the first
 * expense line's own Description cell (this suite's tests always add
 * exactly one line per claim), or null if the claim has no lines yet. */
export interface ReimbursementClaimSnapshot {
  id: string;
  status: string;
  description: string | null;
}

function parseBalanceNumber(text: string | null): number | null {
  const match = text?.match(/[\d.]+/)?.[0];
  return match ? Number(match) : null;
}

/** Reads ONLY the Employee's status cell/badge from the Users & Roles list.
 * MUST be a Sys Admin session — the whole `/admin/*` section (including
 * `/admin/users`) is gated by apps/web/src/app/(app)/admin/layout.tsx to
 * `isSysAdmin(session.grants)` only; HR Admin gets the same denial alert as
 * anyone else and never sees a row at all (confirmed live: this previously
 * took an `hrAdminPage` on the mistaken assumption that HR Admin could
 * still VIEW this page even though only Sys Admin can toggle status —
 * viewing requires it too). Never the whole row's text — see
 * src/identity.ts's getAccountStatusCellText doc comment for why that
 * produces a false "deactivated" reading on an Active account. Throws
 * (never returns null) if the row can't be found or is ambiguous — an
 * identity problem this suite should stop on immediately, not paper over
 * with a "(not found)" placeholder. */
export async function readEmployeeAccountStatus(sysAdminPage: Page, employeeEmail: string): Promise<string> {
  return getAccountStatusCellText(sysAdminPage, employeeEmail);
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

/** Reads every one of the Employee's reimbursement claims BY ID: first
 * collects each claim's id from the list page's own row links
 * (`<Link href="/reimbursements/{id}">`), then visits each claim's detail
 * page individually to read its real current status and its first expense
 * line's description — the only place either is genuinely visible (see
 * ReimbursementClaimSnapshot's doc comment). Slower than a single list-page
 * read, but a claim's identity, status, and tag can only be told apart this
 * way — confirmed live (run 36359831264) that two claims sharing the same
 * date and the same smallest-allowed test amount are otherwise
 * indistinguishable from the list page alone. */
export async function readEmployeeReimbursementClaims(employeePage: Page): Promise<ReimbursementClaimSnapshot[]> {
  await employeePage.goto("/reimbursements");
  const links = employeePage.locator('a[href^="/reimbursements/"]');
  const linkCount = await links.count();
  const ids: string[] = [];
  for (let i = 0; i < linkCount; i++) {
    const href = await links.nth(i).getAttribute("href");
    const id = href?.match(/^\/reimbursements\/([^/?#]+)$/)?.[1];
    if (id) ids.push(id);
  }

  const claims: ReimbursementClaimSnapshot[] = [];
  for (const id of ids) {
    await employeePage.goto(`/reimbursements/${id}`);
    const status = ((await employeePage.getByText(/^(draft|submitted|pending approval|approved|rejected|cancelled)$/i).first().textContent()) ?? "").trim();
    const rows = employeePage.getByRole("row");
    // Row 0 is the expense-lines table's own header row; row 1, if present,
    // is either this claim's first (and, for every test in this suite,
    // only) expense line, or — for a claim with zero lines, e.g.
    // 40-document-upload.spec.ts's draft, which deliberately never adds one
    // — the table's own single-cell EmptyState row (colSpan=6). Description
    // is the 4th cell (Date/Category/Amount/Description/Receipt/actions —
    // verified from reimbursements/[id]/page.tsx), guarded by an actual
    // cell count so the EmptyState row is never misread as a 4th cell that
    // doesn't exist.
    let description: string | null = null;
    if ((await rows.count()) > 1) {
      const cells = rows.nth(1).getByRole("cell");
      if ((await cells.count()) >= 4) {
        const text = (await cells.nth(3).innerText()).trim();
        description = text === "—" ? null : text;
      }
    }
    claims.push({ id, status, description });
  }
  return claims;
}

/** The Employee's own row text on each of this run's two synthetic
 * attendance dates (the ordinary workday and the deliberate weekend day —
 * see recordTag.ts), read via the attendance register. Needs TWO separate
 * role sessions, not one: name resolution (getEmployeeNameByAuthEmail)
 * reads `/admin/users`, which apps/web/src/app/(app)/admin/layout.tsx gates
 * to Sys Admin only, while the attendance register itself
 * (canManageAttendance, packages/domain/src/permissions/attendance.ts) is
 * HR Admin only — neither role can do both. The employee's name is
 * resolved from their auth email via getEmployeeNameByAuthEmail (a stable
 * identifier), never a self-reported name — see src/identity.ts. */
export async function readEmployeeAttendanceByDate(sysAdminPage: Page, hrAdminPage: Page, employeeEmail: string, runId: string): Promise<Record<string, string | null>> {
  const employeeName = await getEmployeeNameByAuthEmail(sysAdminPage, employeeEmail);
  const attendance = new AttendancePage(hrAdminPage);
  const dates = [testWorkday(runId, 0), testWeekendDay(runId, 0)];
  const result: Record<string, string | null> = {};
  for (const date of dates) {
    await attendance.goto({ date });
    result[date] = await attendance.getRowValues(employeeName);
  }
  return result;
}

export async function captureSnapshot(sysAdminPage: Page, hrAdminPage: Page, employeePage: Page, employeeEmail: string, runId: string): Promise<AccountSnapshot> {
  const employeeAnnualLeaveBalanceText = await readEmployeeAnnualLeaveBalance(employeePage);
  return {
    capturedAt: new Date().toISOString(),
    employeeAccountStatusText: await readEmployeeAccountStatus(sysAdminPage, employeeEmail),
    employeeAnnualLeaveBalanceText,
    employeeAnnualLeaveBalanceNumber: parseBalanceNumber(employeeAnnualLeaveBalanceText),
    employeeReimbursementClaims: await readEmployeeReimbursementClaims(employeePage),
    employeeAttendanceByDate: await readEmployeeAttendanceByDate(sysAdminPage, hrAdminPage, employeeEmail, runId),
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
  // Matched by id, never by row text — a claim's list-page row never shows
  // its tag at all (Date/Amount/Status only), and two claims from the same
  // run can otherwise look identical (same date, same smallest-allowed test
  // amount). Each claim's REAL current status is read from its own detail
  // page, never assumed — a claim this run created is just as likely to be
  // stuck at `submitted`/`pending_approval` as `approved`/`rejected`,
  // confirmed live (run 36359831264) when two mutating tests failed before
  // either claim was ever decided.
  const baselineIds = new Set(baseline.employeeReimbursementClaims.map((c) => c.id));
  const newClaims = final.employeeReimbursementClaims.filter((c) => !baselineIds.has(c.id));
  if (newClaims.length === 0) {
    lines.push("- No new claims.");
  } else {
    lines.push(`- ${newClaims.length} new claim(s):`);
    for (const claim of newClaims) {
      const tagged = isTagged(claim.description, runId);
      if (!tagged) hasUnexplainedChange = true;
      const statusNote: Record<string, string> = {
        approved: "a real, permanent Production record. Reversing it would itself be a real mutation this suite is not authorized to perform — to restore, reverse/cancel this reimbursement_claims row directly in Supabase.",
        rejected: "a real, permanent Production record in a terminal, no-further-action state — safe to leave as identified test data, or delete directly in Supabase.",
        submitted: "still pending — no approver has decided it yet. Either leave it for a manager to decide, or cancel/delete it (via its own page, or directly in Supabase).",
        pending_approval: "still pending — no approver has decided it yet. Either leave it for a manager to decide, or cancel/delete it (via its own page, or directly in Supabase).",
        draft: "never submitted — has no approval routing at all yet. Delete it via its own \"Delete\" button, or directly in Supabase.",
        cancelled: "cancelled by the employee — a real, permanent record, safe to leave or delete directly in Supabase.",
      };
      const note = statusNote[claim.status] ?? `in an unrecognized status ("${claim.status}") — investigate directly.`;
      lines.push(
        `  - \`${claim.id.slice(0, 8)}…\` — status \`${claim.status}\`, ${tagged ? `tagged (\`${claim.description}\`)` : "**not tagged with this run's ID — investigate**"}. ${note}`,
      );
    }
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
