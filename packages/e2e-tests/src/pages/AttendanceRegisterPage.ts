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
}
