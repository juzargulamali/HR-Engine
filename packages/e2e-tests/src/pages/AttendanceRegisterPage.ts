import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";
import { escapeForRegExp } from "../recordTag";

/**
 * apps/web/src/app/(app)/attendance/{page,register-table,edit-panels}.tsx — the
 * AUTOMATIC, read-first HR register (replaces the all-row manual bulk-edit register as
 * the default; that one now lives at /attendance?manual=1, see AttendancePage.ts).
 */
export const REGISTER_COLUMNS = [
  "Employee",
  "Clock status",
  /^Attendance for \d{4}-\d{2}-\d{2}$/,
  "Work mode",
  "First clock-in",
  "Last clock-out",
  "Recorded hours",
  "Recovery / review",
  "Edit",
] as const;

export type ClockStatusLabel = "Clocked in" | "Clocked out" | "Not started";

export class AttendanceRegisterPage {
  constructor(private readonly page: Page) {}

  async goto(params?: { date?: string; filter?: string }): Promise<void> {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    if (params?.filter) qs.set("filter", params.filter);
    await gotoWithRetry(this.page, `/attendance${qs.toString() ? `?${qs.toString()}` : ""}`);
  }

  rowFor(employeeName: string) {
    return this.page.getByRole("row", { name: new RegExp(escapeForRegExp(employeeName), "i") });
  }

  /** FAILS before acting unless the name resolves to exactly one row — same rule as every other page object here. */
  async uniqueRowFor(employeeName: string) {
    const row = this.rowFor(employeeName);
    const count = await row.count();
    if (count !== 1) throw new Error(`Expected exactly one register row for "${employeeName}", found ${count}. Refusing to act on an ambiguous or missing row.`);
    return row;
  }

  async expectClockStatus(employeeName: string, status: ClockStatusLabel): Promise<void> {
    const row = await this.uniqueRowFor(employeeName);
    await expect(row.getByText(status, { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  async expectLastUpdatedVisible(): Promise<void> {
    await expect(this.page.getByText(/^Last updated \d{2}:\d{2}:\d{2}$/)).toBeVisible();
  }

  async openEdit(employeeName: string): Promise<void> {
    const row = await this.uniqueRowFor(employeeName);
    await row.getByRole("button", { name: "Edit", exact: true }).click();
  }

  /** The employee id the register row carries — the stable handle for the row's own detail panel and form ids. */
  async employeeIdOf(employeeName: string): Promise<string> {
    const row = await this.uniqueRowFor(employeeName);
    const id = await row.getAttribute("data-employee-id");
    if (!id) throw new Error(`The register row for "${employeeName}" has no data-employee-id`);
    return id;
  }

  /** Expands the row's evidence panel (sessions, modes, corrections). */
  async expandRow(employeeName: string): Promise<void> {
    const row = await this.uniqueRowFor(employeeName);
    await row.getByRole("button", { name: new RegExp(escapeForRegExp(employeeName)) }).first().click();
  }

  detailFor(employeeId: string) {
    return this.page.locator(`#detail-${employeeId}`);
  }

  /**
   * HR "Add missing attendance (recorded by HR)": exact wall-clock times in the EMPLOYEE'S country time zone, a work
   * mode, and — for site work — a project and a lead, with the required reason. Waits for the save confirmation.
   */
  async addMissingAttendance(
    employeeName: string,
    input: { date: string; start: string; end: string; mode: "office" | "wfh" | "site_work" | "client_meeting" | "business_travel"; project?: string; leadName?: string; reason: string },
  ): Promise<void> {
    const employeeId = await this.employeeIdOf(employeeName);
    await this.openEdit(employeeName);
    const detail = this.detailFor(employeeId);
    await detail.locator(`#ms-${employeeId}`).fill(`${input.date}T${input.start}`);
    await detail.locator(`#me-${employeeId}`).fill(`${input.date}T${input.end}`);
    await detail.locator(`#mm-${employeeId}`).selectOption(input.mode);
    if (input.project) await detail.locator(`#mp-${employeeId}`).fill(input.project);
    if (input.leadName) await detail.locator(`#ml-${employeeId}`).selectOption({ label: input.leadName });
    await detail.locator(`#mr-${employeeId}`).fill(input.reason);
    await detail.getByRole("button", { name: "Add attendance" }).click();
    await expect(this.page.getByText("Saved. The register will refresh.").first()).toBeVisible({ timeout: 20_000 });
  }

  /** HR correction of an existing session's clock-out (required reason). The original and corrected times are both kept. */
  async correctClockOut(employeeName: string, date: string, newEndLocal: string, reason: string): Promise<void> {
    const employeeId = await this.employeeIdOf(employeeName);
    await this.openEdit(employeeName);
    const detail = this.detailFor(employeeId);
    const save = detail.getByRole("button", { name: "Save correction" }).first();
    await expect(save).toBeDisabled(); // a reason is required before a correction can be saved
    await detail.getByLabel(/^Clock-out \(/).first().fill(`${date}T${newEndLocal}`);
    await detail.getByLabel(/^Reason \(required/).first().fill(reason);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(this.page.getByText("Saved. The register will refresh.").first()).toBeVisible({ timeout: 20_000 });
  }
}
