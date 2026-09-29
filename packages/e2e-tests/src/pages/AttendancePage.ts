import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";
import { escapeForRegExp } from "../recordTag";

/**
 * apps/web/src/app/(app)/attendance/{page,bulk-attendance-form}.tsx — HR
 * Admin bulk-fills a whole day's attendance for every active employee in
 * one company; there is no individual employee self-service clock-in/out
 * anywhere in this app (attendance_records.clock_in/clock_out exist in the
 * schema but are never populated or read — confirmed by reading the
 * migration's own comments). "Correction" here means re-editing an
 * already-saved row and saving again; a literal "missing checkout" case
 * doesn't apply to this UI's design — see the morning report.
 */
export const WORK_MODES = ["office", "client_site", "work_from_home", "field_work", "business_travel"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export type AttendanceStatus = "not_recorded" | "present" | "absent" | "leave" | "partial_day";

export class AttendancePage {
  constructor(private readonly page: Page) {}

  async goto(params?: { date?: string; companyId?: string }): Promise<void> {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    if (params?.companyId) qs.set("companyId", params.companyId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    await gotoWithRetry(this.page, `/attendance${suffix}`);
  }

  /** Scoped to a specific employee's real display name — never "whichever
   * row renders first" (the register lists every active employee in HR
   * Admin's company, real employees included). This alone does NOT
   * guarantee uniqueness — see uniqueRowFor() below, which every mutating
   * method uses instead. */
  rowFor(employeeName: string) {
    return this.page.getByRole("row", { name: new RegExp(escapeForRegExp(employeeName), "i") });
  }

  /**
   * Same lookup as rowFor(), but FAILS BEFORE any mutation if it doesn't
   * resolve to EXACTLY one row on this date's register — two employees in
   * the same company could plausibly share a display name, and this suite
   * must never guess which one is the dedicated test account. Every method
   * below that changes a value or saves goes through this, never rowFor()
   * directly.
   */
  private async uniqueRowFor(employeeName: string) {
    const row = this.rowFor(employeeName);
    const count = await row.count();
    if (count !== 1) {
      throw new Error(`Expected exactly one attendance row for "${employeeName}" on this date, found ${count}. Refusing to select/fill/save an ambiguous or missing row.`);
    }
    return row;
  }

  async setStatus(employeeName: string, status: AttendanceStatus): Promise<void> {
    const row = await this.uniqueRowFor(employeeName);
    await row.getByRole("combobox").first().selectOption(status);
  }

  async setWorkModeAndHours(employeeName: string, workMode: WorkMode, hours: number): Promise<void> {
    const row = await this.uniqueRowFor(employeeName);
    const comboboxes = row.getByRole("combobox");
    await comboboxes.nth(1).selectOption(workMode);
    await row.getByRole("spinbutton").fill(String(hours));
  }

  /**
   * Selects the project a recovery-day's work was for, by its visible name
   * — required (validate_recovery_credit_project() in schema.sql) before a
   * Present row on a recovery day can earn a credit request at all. The
   * register's third combobox (after status, work mode); if the employee
   * has only one active allocation for this date it's already the default
   * selection, but this suite calls it explicitly rather than relying on
   * that default. Throws if the employee has no allocation option at all
   * (the column renders "No allocation" text instead of a <select> then) —
   * the one-time fixture documented in README.md must be set up first.
   */
  async setProject(employeeName: string, projectName: string): Promise<void> {
    const row = await this.uniqueRowFor(employeeName);
    const comboboxes = row.getByRole("combobox");
    const count = await comboboxes.count();
    if (count < 3) {
      throw new Error(
        `"${employeeName}" has no project allocation option on this date's register — cannot select project "${projectName}". Set up the one-time E2E project/allocation fixture first (see README.md's "Recovery Leave PM/HR-owner fixture" section).`,
      );
    }
    await comboboxes.nth(2).selectOption({ label: projectName });
  }

  async saveAll(): Promise<void> {
    await this.page.getByRole("button", { name: /save all/i }).click();
  }

  async expectSaved(): Promise<void> {
    await expect(this.page.getByText(/^saved\./i)).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Verified against bulk-attendance-form.tsx's own success message:
   * `Saved.{result.creditedCount > 0 ? " N recovery credit request(s)
   * submitted for approval." : ""}` — this is the ONE precise, save-scoped
   * signal for "did saving THIS row on THIS date earn a recovery credit",
   * tied exactly to the row(s) this specific "Save all" click touched
   * (bulkRecordAttendance only sends changed/selected rows). This is used
   * INSTEAD OF looking for the request on the Approvals page: reading
   * apps/web/src/app/(app)/approvals/page.tsx directly shows it fetches
   * every entity_type of pending approval but only ever renders sections
   * for leave_request/reimbursement_claim/timesheet/generated_letter/
   * payroll_export_run — `recovery_credit` approvals are silently never
   * displayed there at all. Scanning that page for "the first Approve
   * button" would at best prove an UNRELATED approval exists, never this
   * one — this success message is the only reliable, specific signal
   * available through the UI.
   */
  async expectSavedWithRecoveryCredits(count: number): Promise<void> {
    await expect(this.page.getByText(`Saved. ${count} recovery credit request(s) submitted for approval.`, { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  /**
   * True if this employee has NO attendance recorded yet for whatever date
   * this page is currently showing (status === "not_recorded"). Read-only —
   * call this BEFORE setStatus/saveAll to confirm a synthetic date is
   * actually free.
   *
   * Why this check exists: this suite's synthetic weekend dates
   * (testWeekendDay() in recordTag.ts) are `hash(runId) % 40 weeks +
   * offsetWeeks` — deterministic per run, but NOT collision-proof across
   * different runs' hashes. Confirmed live: run E2E-20260928-232518's
   * offset-2 date (2099-05-30) had already been recorded by an earlier
   * run (E2E-20260928-113008)'s own weekend-day test. On an
   * already-recorded date, record_attendance_and_recovery() still saves
   * successfully but creates no NEW recovery_credit_requests row (one
   * already exists there), so the save only ever shows a bare "Saved." —
   * expectSavedWithRecoveryCredits() correctly fails on that, but by then
   * the test has already wasted a real Production mutation on the wrong
   * date. This lets a caller pick a different candidate date BEFORE
   * saving anything, rather than discover the collision only after.
   */
  async isUnrecorded(employeeName: string): Promise<boolean> {
    const row = await this.uniqueRowFor(employeeName);
    const status = await row.getByRole("combobox").first().inputValue();
    return status === "not_recorded";
  }

  /** The employee's own SELECTED control values on whatever date this page
   * is currently showing, or null if the employee has no row on this
   * date's register (e.g. inactive or a different company). Used for
   * baseline/reconciliation reporting — never mutates anything.
   *
   * Reads `.inputValue()` on the status/work-mode <select>s and the hours
   * <input>, never the row's `.innerText()` — confirmed live (run
   * 36359831264) that a native `<select>`'s `innerText`, read via an
   * ancestor, includes every `<option>`'s label concatenated together
   * regardless of which one is actually selected (a real Chromium quirk,
   * not specific to this app), so baseline and final always looked
   * identical no matter what was actually saved. `.inputValue()` returns
   * the literal selected `value` attribute (e.g. "present",
   * "business_travel"), which is also more precise than a display label. */
  async getRowValues(employeeName: string): Promise<string | null> {
    const row = this.rowFor(employeeName);
    if ((await row.count()) === 0) return null;
    const comboboxes = row.first().getByRole("combobox");
    const status = await comboboxes.first().inputValue();
    const workMode = await comboboxes.nth(1).inputValue();
    const hours = await row.first().getByRole("spinbutton").inputValue();
    return `status=${status} workMode=${workMode} hours=${hours}`;
  }
}
