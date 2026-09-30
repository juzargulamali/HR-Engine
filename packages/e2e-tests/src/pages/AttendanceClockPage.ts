import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";

/**
 * apps/web/src/app/(app)/attendance-clock/{page,clock-controls,resolve-
 * project-lead-form}.tsx — employee self-service attendance clocking:
 * Clock In / Switch work mode / Clock Out, work mode + optional/required
 * project name + project lead, and the "awaiting project lead" resolver.
 * There is deliberately no Start Break / End Break control anywhere on this
 * page (see attendance_sessions' own doc comment in schema.sql) — this page
 * object never provides one either.
 */
export const WORK_MODES = ["office", "wfh", "site_work", "client_meeting", "business_travel"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export class AttendanceClockPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await gotoWithRetry(this.page, "/attendance-clock");
  }

  /** Scopes a locator to <main id="main-content"> (app-shell.tsx), excluding
   * the persistent mobile ClockFab — a sibling of <main>, present on every
   * authenticated page — which renders the exact same "Clocked in"/"Clock
   * In" text as this page's own status card. Without this scope, "Clocked
   * in" resolves to 2 elements once the FAB catches up to a fresh clock-in,
   * a real strict-mode race that intermittently made isClockedIn() throw
   * (caught by its own .catch(() => false)) and report "not clocked in"
   * immediately after a genuinely successful clock-in. */
  private main() {
    return this.page.locator("#main-content");
  }

  isClockedIn(): Promise<boolean> {
    return this.main()
      .getByText("Clocked in", { exact: true })
      .isVisible()
      .catch(() => false);
  }

  /** True while the "Switch work mode" form is open (see clock-controls.tsx's
   * `switching` state) — the work-mode/project/lead fields are shared by the
   * Clock In form and this one, so callers use this to know which "Clock
   * In" / "Switch work mode" trigger button is currently on screen. */
  private async ensureNotSwitching(): Promise<void> {
    const cancel = this.page.getByRole("button", { name: "Cancel", exact: true });
    if (await cancel.isVisible().catch(() => false)) await cancel.click();
  }

  /** `projectLeadName`: select a specific colleague by their exact display
   * name (resolved via src/identity.ts's getEmployeeNameByAuthEmail — never
   * guessed). `projectLeadAny`: for mechanics tests that only need SOME
   * lead selected (the form enforces one is present for Site work, but
   * doesn't care which) — picks the first real option after the "None"
   * placeholder, never a hardcoded name. */
  async clockIn(opts: { workMode: WorkMode; projectName?: string; projectLeadName?: string; projectLeadAny?: boolean }): Promise<void> {
    await this.page.getByLabel("Work mode").selectOption(opts.workMode);
    if (opts.projectName) await this.page.getByLabel(/^Project/).fill(opts.projectName);
    if (opts.projectLeadName) await this.page.getByLabel(/^Project lead/).selectOption({ label: opts.projectLeadName });
    else if (opts.projectLeadAny) await this.page.getByLabel(/^Project lead/).selectOption({ index: 1 });
    await this.page.getByRole("button", { name: /^Clock In$/ }).click();
    // clockIn() round-trips through a Server Action before clock-controls.tsx
    // clears pending and re-renders — wait for either "Clocked in" or an
    // error alert, never a fixed sleep.
    await expect(this.main().getByText("Clocked in", { exact: true }).or(this.page.locator('[role="alert"]'))).toBeVisible({ timeout: 15_000 });
  }

  async switchWorkMode(opts: { workMode: WorkMode; projectName?: string; projectLeadName?: string }): Promise<void> {
    await this.ensureNotSwitching();
    await this.page.getByRole("button", { name: "Switch work mode", exact: true }).click();
    await this.page.getByLabel("Work mode").selectOption(opts.workMode);
    if (opts.projectName) await this.page.getByLabel(/^Project/).fill(opts.projectName);
    if (opts.projectLeadName) await this.page.getByLabel(/^Project lead/).selectOption({ label: opts.projectLeadName });
    await this.page.getByRole("button", { name: "Switch work mode", exact: true }).nth(1).click();
    await expect(this.page.getByText(/^Current:/)).toBeVisible({ timeout: 15_000 });
  }

  async clockOut(): Promise<void> {
    await this.ensureNotSwitching();
    await this.page.getByRole("button", { name: "Clock Out", exact: true }).click();
    await expect(this.main().getByText("Not clocked in", { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  async expectError(pattern: RegExp): Promise<void> {
    await expect(this.page.locator('[role="alert"]').filter({ hasText: pattern })).toBeVisible({ timeout: 10_000 });
  }

  async expectLocationNotice(pattern: RegExp): Promise<void> {
    await expect(this.page.getByText(pattern)).toBeVisible({ timeout: 10_000 });
  }

  /** The most recent "Recent sessions" row's own Segments cell text — the
   * page renders segments as `Label (Project)` joined by " → " (see
   * attendance-clock/page.tsx), so this is the one place mode-switch history
   * is directly readable without a database query. */
  async getMostRecentSessionSegmentsText(): Promise<string> {
    const rows = this.page.locator("table tbody tr");
    return (await rows.first().locator("td").nth(2).innerText()).trim();
  }

  async resolveAwaitingLead(workDateLabel: string, leadName: string): Promise<void> {
    const card = this.page.locator("div").filter({ hasText: workDateLabel }).last();
    await card.getByLabel("Project lead").selectOption({ label: leadName });
    await card.getByRole("button", { name: /route for approval/i }).click();
    await expect(card.getByText("Routed for approval.")).toBeVisible({ timeout: 10_000 });
  }
}
