import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";
import { escapeForRegExp } from "../recordTag";

/**
 * apps/web/src/app/(app)/approvals/{page,recovery-credit-decision-form}.tsx
 * — the "Recovery Leave credits" table specifically. This is a SEPARATE
 * table/form from every other entity type on /approvals: recovery_credit
 * rows render their own <RecoveryCreditDecisionForm> (checked-with field,
 * optional HR-only correction controls, a native window.confirm() on
 * Approve), never the generic <DecisionButtons> the rest of this page uses
 * — see ApprovalsPage in LeavePage.ts for that generic path.
 *
 * A self-clock recovery_credit row has no single tagged free-text field the
 * way a leave/reimbursement request does; this suite tags the Site-work
 * `project_name` field instead (rendered verbatim in this table's Evidence
 * column — see approvals/page.tsx), which every row-scoping method here
 * matches on.
 */
export class RecoveryCreditApprovalsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await gotoWithRetry(this.page, "/approvals");
  }

  /** Scopes to the exact-one row whose Evidence column contains this tag
   * (the project_name this suite wrote at clock-in/switch time). Throws
   * rather than guessing on 0 or >1 matches. */
  private async rowFor(tag: string) {
    const rows = this.page.getByRole("row", { name: new RegExp(escapeForRegExp(tag)) });
    const count = await rows.count();
    if (count !== 1) {
      throw new Error(`Expected exactly one Recovery Leave credits row tagged "${tag}", found ${count}. Refusing to guess which row to act on.`);
    }
    return rows.first();
  }

  async expectPending(tag: string): Promise<void> {
    await expect(this.page.getByText(tag).first()).toBeVisible({ timeout: 15_000 });
  }

  async expectNotPending(tag: string): Promise<void> {
    await expect(this.page.getByText(tag)).toHaveCount(0);
  }

  /** The Route column's own text for this row (e.g. "Project lead → HR",
   * "Manager → HR", "Shared CEO/CTO queue", "Self-led → HR (independent
   * review)") — verified against approvals/page.tsx's APPLICANT_ROUTE_LABELS. */
  async getRouteLabel(tag: string): Promise<string> {
    const row = await this.rowFor(tag);
    return (await row.getByRole("cell").nth(2).innerText()).trim();
  }

  async hasPolicyReviewBadge(tag: string): Promise<boolean> {
    const row = await this.rowFor(tag);
    return row.getByText("Needs policy review").isVisible().catch(() => false);
  }

  /** Approve, optionally filling "Checked with" first. Registers the
   * accept-handler BEFORE clicking, matching every other decision method in
   * this suite (native window.confirm() on the Approve button — see
   * recovery-credit-decision-form.tsx). Leave `checkedWith` unset for the
   * `employee_lead_then_hr` route's own steps, where it's optional. */
  async approve(tag: string, checkedWith?: string): Promise<void> {
    const row = await this.rowFor(tag);
    if (checkedWith) {
      await row.getByLabel(/Checked with/).fill(checkedWith);
    }
    this.page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Approve", exact: true }).click();
  }

  async reject(tag: string, reason: string): Promise<void> {
    const row = await this.rowFor(tag);
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    await row.getByPlaceholder(/reason for rejecting/i).fill(reason);
    await row.getByRole("button", { name: /confirm reject/i }).click();
  }

  /** HR-only correction controls (canCorrect) — work date/hours + a
   * mandatory reason whenever either actually changes. No-ops (and throws)
   * if the caller isn't HR Admin, since recovery-credit-decision-form.tsx
   * hides this block entirely for anyone else — the thrown Playwright
   * locator-not-found error IS the intended failure signal there. */
  async saveCorrection(tag: string, opts: { hours: number; reason: string }): Promise<void> {
    const row = await this.rowFor(tag);
    await row.getByLabel("Hours").fill(String(opts.hours));
    await row.getByPlaceholder(/reason for correction/i).fill(opts.reason);
    await row.getByRole("button", { name: /save correction/i }).click();
    await expect(row.getByText(/^Saved —/)).toBeVisible({ timeout: 10_000 });
  }

  async expectErrorContaining(tag: string, pattern: RegExp): Promise<void> {
    const row = await this.rowFor(tag);
    await expect(row.locator('[role="alert"]').filter({ hasText: pattern })).toBeVisible({ timeout: 10_000 });
  }
}
