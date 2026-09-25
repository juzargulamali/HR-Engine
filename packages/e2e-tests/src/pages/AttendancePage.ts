import { type Page, expect } from "@playwright/test";

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
    await this.page.goto(`/attendance${suffix}`);
  }

  private rowFor(employeeName: string) {
    return this.page.getByRole("row", { name: new RegExp(employeeName, "i") });
  }

  async setStatus(employeeName: string, status: AttendanceStatus): Promise<void> {
    await this.rowFor(employeeName).getByRole("combobox").first().selectOption(status);
  }

  async setWorkModeAndHours(employeeName: string, workMode: WorkMode, hours: number): Promise<void> {
    const row = this.rowFor(employeeName);
    const comboboxes = row.getByRole("combobox");
    await comboboxes.nth(1).selectOption(workMode);
    await row.getByRole("spinbutton").fill(String(hours));
  }

  async saveAll(): Promise<void> {
    await this.page.getByRole("button", { name: /save all/i }).click();
  }

  async expectSaved(): Promise<void> {
    await expect(this.page.getByText(/^saved\./i)).toBeVisible({ timeout: 10_000 });
  }

  async expectRecoveryDayNotice(): Promise<void> {
    await expect(this.page.getByText(/recovery day/i)).toBeVisible();
  }
}
