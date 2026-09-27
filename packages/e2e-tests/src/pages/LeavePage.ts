import { type Page, expect, test } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";
import { escapeForRegExp } from "../recordTag";

/** Mirrors leave/page.tsx's own Dates-column rendering EXACTLY (including
 * the en dash, not a hyphen) — the only per-request text the leave list
 * page actually shows, so it's what expectRequestInList/cancelRequest below
 * must search for instead of the (never-rendered) reason. */
export function formatDateRange(startDate: string, endDate: string): string {
  return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
}

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

  /** Must be the row's rendered "Dates" text (see formatDateRange below),
   * never the submitted `reason` — verified directly from
   * apps/web/src/app/(app)/leave/page.tsx: its query fetches `reason` but
   * the list's <TableRow> never renders it anywhere, only Type/Dates/Days/
   * Status. A tagged reason string can never be found on this page; the
   * Dates column is the only per-request text this list actually shows. */
  async expectRequestInList(dateRangeLabel: string): Promise<void> {
    await expect(this.page.getByText(dateRangeLabel)).toBeVisible({ timeout: 10_000 });
  }

  /** Same caveat as expectRequestInList — pass the rendered Dates label, not
   * the tagged reason. */
  async cancelRequest(dateRangeLabel: string): Promise<void> {
    // `[E2E-...]` tags carry regex metacharacters (character-class
    // brackets); date labels don't, but escaping is cheap and keeps this
    // safe if a caller ever passes a tagged string here again by mistake.
    const row = this.page.getByRole("row", { name: new RegExp(escapeForRegExp(dateRangeLabel), "i") });
    await row.getByRole("button", { name: /cancel/i }).click();
  }

  /**
   * Reads the balance NUMBER itself — never "the first number anywhere in
   * the surrounding card". Verified against apps/web/src/app/(app)/leave/
   * page.tsx's actual markup: each balance is `<Card><CardHeader><CardTitle>
   * {label}</CardTitle></CardHeader><CardContent>{balance_days} days
   * </CardContent></Card>` (components/ui/card.tsx: CardTitle is an <h3>
   * nested two levels inside Card — CardTitle -> CardHeader -> Card;
   * CardContent is CardHeader's SIBLING, not its descendant). So: find the
   * label heading, go up exactly two levels to reach the Card itself, then
   * within THAT card read only the element whose own text is the balance
   * shape ("<number> days") — never the label text or anything else the
   * card might contain.
   */
  async getBalance(leaveTypeLabel: string): Promise<string> {
    const heading = this.page.getByRole("heading", { name: new RegExp(escapeForRegExp(leaveTypeLabel), "i") });
    if ((await heading.count()) === 0) return "";
    const card = heading.first().locator("..").locator(".."); // CardTitle -> CardHeader -> Card
    const balanceText = card.getByText(/^\s*[\d.]+\s*days\s*$/i);
    if ((await balanceText.count()) === 0) return "";
    return ((await balanceText.first().textContent()) ?? "").trim();
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
    try {
      await expect(this.page.getByText(needle).first()).toBeVisible({ timeout: 10_000 });
    } catch (err) {
      // Turns a bare 10s timeout into an actionable diagnostic — this run's
      // real, unresolved evidence (run 36351884519) is that this exact
      // check failed with no prior failure explaining why, and this
      // approver's session never had a way to say what it saw instead. The
      // leading candidate, verified from source (resolveInitialApprover ->
      // resolve_approver('direct_manager', ...) in schema.sql), is that step
      // 1 of the leave_request approval workflow routes to the SUBMITTER's
      // own `employees.manager_id`, not necessarily to whichever test
      // account E2E_MANAGER happens to be — that relationship has never
      // been verified against real Production data, and nothing before this
      // suite's build documented it as a required precondition (see
      // README.md's "Required role credentials" section).
      const rowCount = await this.page.getByRole("row").count();
      test.info().annotations.push({
        type: "diagnostic",
        description:
          `expectPending("${needle}") timed out. This approver's /approvals page currently has ${rowCount} table row(s) (all sections, header rows included). ` +
          "If nothing routed here, the likely cause is approval routing, not a UI bug: resolve_approver('direct_manager', employee_id) (schema.sql) resolves the SUBMITTER's own employees.manager_id, which may not be the E2E_MANAGER test account. " +
          "Confirm via HR Admin's Employees > [Employee test account] > Manager field that it is set to the E2E_MANAGER test account's own employee record before re-dispatching.",
      });
      throw err;
    }
  }

  async expectNotPending(needle: string): Promise<void> {
    await expect(this.page.getByText(needle)).toHaveCount(0);
  }
}
