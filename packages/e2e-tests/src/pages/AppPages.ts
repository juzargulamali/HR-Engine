import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";

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
    await gotoWithRetry(this.page, "/employees");
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
    await gotoWithRetry(this.page, "/holidays");
  }
  async expectHoliday(name: string): Promise<void> {
    await expect(this.page.getByText(new RegExp(name, "i"))).toBeVisible({ timeout: 10_000 });
  }
}

/**
 * apps/web/src/app/(app)/reimbursements/{page,new-claim-form,[id]/{page,
 * add-line-form,claim-actions}}.tsx — verified directly against source
 * (not guessed): a claim starts as a draft (just a currency), then gets one
 * or more lines added (expenseDate, category, amount, optional receipt/
 * description) on its own detail page, then "Submit for approval" moves it
 * out of draft. Approve/reject happens through the same generic
 * ApprovalsPage (src/pages/LeavePage.ts) every other entity type routes
 * through.
 */
export class ReimbursementsPage {
  constructor(private readonly page: Page) {}

  /** Also lands on the "Start a new claim" form — verified directly from
   * apps/web/src/app/(app)/reimbursements/page.tsx: "Start a new claim" is a
   * CardTitle (a heading, not a link/button) and NewClaimForm is embedded
   * inline on this SAME page, the same pattern as the Holidays page's "Add
   * a holiday". There is no separate "new claim" page/link to navigate to.
   * (A previous gotoNew() here searched for a "new/submit/add" link that
   * never existed and timed out after 15s on every reimbursement/document-
   * upload test, before any claim was ever created — confirmed live, run
   * 36351884519. Removed rather than fixed: nothing to navigate to.) */
  async goto(): Promise<void> {
    await gotoWithRetry(this.page, "/reimbursements");
  }

  /** Fills the "Start claim" form (currency only), follows the redirect to
   * the new draft claim's own detail page, and returns its id (parsed from
   * the resulting URL) — the only reliable way to refer to THIS claim
   * later, since two claims from the same run can otherwise look identical
   * everywhere else (same date, same smallest-allowed test amount). */
  async startDraftClaim(currency = "AED"): Promise<string> {
    await this.page.getByLabel("Currency").fill(currency);
    await this.page.getByRole("button", { name: /start claim/i }).click();
    await this.page.waitForURL(/\/reimbursements\/[^/]+$/);
    const match = this.page.url().match(/\/reimbursements\/([^/?#]+)/);
    const claimId = match?.[1];
    if (!claimId) throw new Error(`Could not parse a claim id out of the post-redirect URL: ${this.page.url()}`);
    return claimId;
  }

  /** Navigates straight to one specific claim's own detail page. */
  async gotoClaim(claimId: string): Promise<void> {
    await gotoWithRetry(this.page, `/reimbursements/${claimId}`);
  }

  /** Reads the claim detail page's own StatusBadge text (e.g. "approved",
   * "pending approval") — the actual, current status of THIS specific
   * claim, not a guess from a list page that may show several identical-
   * looking rows. */
  async getClaimStatus(): Promise<string> {
    return ((await this.page.getByText(/^(draft|submitted|pending approval|approved|rejected|cancelled)$/i).first().textContent()) ?? "").trim();
  }

  /** Adds one expense line on the claim's own detail page (call after
   * startDraftClaim, or after navigating directly to /reimbursements/:id).
   * Never attaches a receipt unless explicitly given one — receipt is
   * optional on this form. */
  async addLine(opts: { expenseDate: string; category: string; amount: string; description?: string }): Promise<void> {
    await this.page.getByLabel("Expense date").fill(opts.expenseDate);
    await this.page.getByLabel("Category").fill(opts.category);
    await this.page.getByLabel("Amount").fill(opts.amount);
    if (opts.description) {
      await this.page.getByLabel(/description/i).fill(opts.description);
    }
    await this.page.getByRole("button", { name: /add line/i }).click();
  }

  /** Moves the claim from draft to pending approval — a real, permanent
   * transition; the app exposes no "un-submit". Waits for the claim's own
   * submitted state to actually land (the "Cancel claim" button, which
   * claim-actions.tsx only renders once status is submitted/pending_approval)
   * before returning — submitClaim() is a plain server action with no
   * redirect, so a caller that switches to the Manager session right after
   * the click can otherwise beat the RSC refresh that flips isDraft/
   * isCancellable, and everything downstream looks like a routing failure
   * instead of the timing issue it actually is. */
  async submitForApproval(): Promise<void> {
    await this.page.getByRole("button", { name: /submit for approval/i }).click();
    await expect(this.page.getByRole("button", { name: /cancel claim/i })).toBeVisible({ timeout: 15_000 });
  }
}

export class AuditLogPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await gotoWithRetry(this.page, "/audit-log");
  }

  /** Applies the page's own Table/Action/From-date filter form (its "table"/
   * "action"/"from" <select>/<input> fields, submitted via "Apply filters")
   * — never a hand-built query string, so this stays correct if the page's
   * own route/param handling ever changes. */
  async filterBy(opts: { table?: string; action?: "insert" | "update" | "delete"; from?: string }): Promise<void> {
    if (opts.table) await this.page.locator("#table").selectOption(opts.table);
    if (opts.action) await this.page.locator("#action").selectOption(opts.action);
    if (opts.from) await this.page.locator("#from").fill(opts.from);
    await this.page.getByRole("button", { name: /apply filters/i }).click();
  }

  /** Verified directly from apps/web/src/app/(app)/audit-log/page.tsx: rows
   * never render any free-text/tagged field — only When/Table/(truncated)
   * Entity ID/Action/Actor/Actor role(s)/Source. A run's tag can therefore
   * never appear as visible text on this page (confirmed live, run
   * 36351884519: `60-audit-verification.spec.ts` searched for it and failed
   * every time, by design of the page, not a bug in it). This checks for a
   * real matching ROW instead — filter first with filterBy(), then call
   * this with the exact table_name text the Table column renders. */
  async expectTableHasRows(tableName: string): Promise<void> {
    await expect(this.page.getByRole("cell", { name: tableName, exact: true }).first()).toBeVisible({ timeout: 10_000 });
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
    await gotoWithRetry(this.page, "/payroll");
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
    await gotoWithRetry(this.page, "/");
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
