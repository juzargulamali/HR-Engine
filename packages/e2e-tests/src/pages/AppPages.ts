import { type Page, expect } from "@playwright/test";

/**
 * Lighter-weight page objects for areas not deeply re-read this round
 * (their routes are confirmed real — apps/web/src/app/(app)/*\/page.tsx
 * exists for each — but exact button/label text is a best-effort,
 * text-based guess pending the first live run against Production; see the
 * morning report's "selector confidence" note). Kept deliberately generic
 * (locate by visible text/role rather than a specific DOM structure) so a
 * first run mostly needs text tweaks, not a rewrite.
 */

export class EmployeesPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/employees");
  }

  async openProfile(name: string): Promise<void> {
    await this.page.getByRole("link", { name: new RegExp(name, "i") }).click();
  }

  async expectVisible(name: string): Promise<void> {
    await expect(this.page.getByText(new RegExp(name, "i")).first()).toBeVisible({ timeout: 10_000 });
  }

  async expectNotVisible(name: string): Promise<void> {
    await expect(this.page.getByText(new RegExp(name, "i"))).toHaveCount(0);
  }
}

export class HolidaysPage {
  constructor(private readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto("/holidays");
  }
  async expectHoliday(name: string): Promise<void> {
    await expect(this.page.getByText(new RegExp(name, "i"))).toBeVisible({ timeout: 10_000 });
  }
}

export class ReimbursementsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/reimbursements");
  }

  async gotoNew(): Promise<void> {
    await this.page.getByRole("link", { name: /new|submit|add/i }).first().click();
  }

  async expectClaimVisible(needle: string): Promise<void> {
    await expect(this.page.getByText(new RegExp(needle, "i")).first()).toBeVisible({ timeout: 10_000 });
  }
}

export class AuditLogPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/audit-log");
  }

  async expectEntryVisible(needle: string): Promise<void> {
    await expect(this.page.getByText(new RegExp(needle, "i")).first()).toBeVisible({ timeout: 10_000 });
  }

  /** There must be no edit/delete affordance anywhere on this page — audit
   * log rows are append-only. Asserts absence rather than presence. */
  async expectNoEditOrDeleteControls(): Promise<void> {
    await expect(this.page.getByRole("button", { name: /^(edit|delete)$/i })).toHaveCount(0);
  }
}

export class PayrollPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/payroll");
  }

  async expectExportControlVisible(): Promise<void> {
    await expect(this.page.getByRole("button", { name: /export|generate|run/i }).first()).toBeVisible({ timeout: 10_000 });
  }

  async expectExportControlHidden(): Promise<void> {
    await expect(this.page.getByRole("button", { name: /export|generate|run/i })).toHaveCount(0);
  }
}

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  /** Part C's compact header: day/date/live clock/location/weather. Only
   * the always-present text pieces (date + location) are asserted — weather
   * is explicitly allowed to be absent on failure, per lib/weather.ts. */
  async expectHeaderVisible(): Promise<void> {
    await expect(this.page.getByText(/\d{4}/).first()).toBeVisible({ timeout: 10_000 }); // the year, from the date string
  }

  async expectLocationLabel(label: string): Promise<void> {
    await expect(this.page.getByText(label)).toBeVisible({ timeout: 10_000 });
  }
}
