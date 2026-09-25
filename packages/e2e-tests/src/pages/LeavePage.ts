import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";

/**
 * apps/web/src/app/(app)/leave/{page,new/leave-request-form}.tsx —
 * self-service leave submission (employee), plus the employee's own list
 * of requests with cancel where allowed. Field names/values verified by
 * reading leave-request-form.tsx directly.
 */
export class LeavePage {
  constructor(private readonly page: Page) {}

  async gotoNew(): Promise<void> {
    await gotoWithRetry(this.page, "/leave/new");
  }

  async gotoList(): Promise<void> {
    await gotoWithRetry(this.page, "/leave");
  }

  async submitRequest(opts: { startDate: string; endDate: string; leaveTypeCode?: string; reason?: string }): Promise<void> {
    await this.page.locator("#startDate").fill(opts.startDate);
    await this.page.locator("#endDate").fill(opts.endDate);
    if (opts.leaveTypeCode) {
      await this.page.locator("#leaveTypeCode").selectOption(opts.leaveTypeCode);
    }
    if (opts.reason) {
      await this.page.locator("#reason").fill(opts.reason);
    }
    await this.page.getByRole("button", { name: /submit/i }).click();
  }

  async expectRequestInList(reasonOrDateRange: string): Promise<void> {
    await expect(this.page.getByText(reasonOrDateRange)).toBeVisible({ timeout: 10_000 });
  }

  async cancelRequest(reasonOrDateRange: string): Promise<void> {
    const row = this.page.getByRole("row", { name: new RegExp(reasonOrDateRange, "i") });
    await row.getByRole("button", { name: /cancel/i }).click();
  }

  async getBalance(leaveTypeLabel: string): Promise<string> {
    const card = this.page.getByText(new RegExp(leaveTypeLabel, "i")).locator("..");
    return (await card.textContent()) ?? "";
  }
}

/**
 * apps/web/src/app/(app)/approvals/{page,decision-buttons}.tsx — the
 * generic approval inbox every entity type (leave_request, recovery_credit,
 * reimbursement_claim, ...) routes through via decide_leave_approval().
 * Verified directly from decision-buttons.tsx: "Approve" fires a native
 * window.confirm() dialog before submitting (Playwright auto-dismisses
 * dialogs unless a handler is registered — approve() below registers a
 * one-shot accept handler); "Reject" reveals an inline reason textarea and
 * a separate "Confirm reject" button, no native dialog.
 */
export class ApprovalsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await gotoWithRetry(this.page, "/approvals");
  }

  private cardFor(needle: string) {
    // Approvals render as cards/list items, not a <table>; scope by the
    // nearest ancestor containing the needle text instead of assuming a
    // table row.
    return this.page.locator(`text=${needle}`).locator("..").locator("..");
  }

  async approve(needle: string): Promise<void> {
    this.page.once("dialog", (d) => d.accept());
    await this.cardFor(needle).getByRole("button", { name: "Approve", exact: true }).click();
  }

  async reject(needle: string, reason: string): Promise<void> {
    const scope = this.cardFor(needle);
    await scope.getByRole("button", { name: "Reject", exact: true }).click();
    await scope.getByPlaceholder(/reason for rejecting/i).fill(reason);
    await scope.getByRole("button", { name: /confirm reject/i }).click();
  }

  async expectPending(needle: string): Promise<void> {
    await expect(this.page.getByText(needle).first()).toBeVisible({ timeout: 10_000 });
  }

  async expectNotPending(needle: string): Promise<void> {
    await expect(this.page.getByText(needle)).toHaveCount(0);
  }
}
