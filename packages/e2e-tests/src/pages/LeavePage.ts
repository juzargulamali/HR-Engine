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

  /** Waits for one of submitLeaveRequest()'s two real outcomes before
   * returning — never just the click. Confirmed live (run 36359831264):
   * both leave-list checks right after this call timed out even though the
   * request genuinely existed a moment later (per the error-context
   * screenshots) — `redirect("/leave")` only happens once the server
   * action's own await chain (including submit_leave_request()'s insert +
   * routing) has fully resolved, so a caller that races ahead of that
   * redirect can query /leave before the row is committed. On the error
   * path there is no redirect at all — the same page re-renders with
   * `state.error` in a `role="alert"` element instead — so this also
   * throws a clear error in that case rather than leaving the caller to
   * fail confusingly on an unrelated later assertion. */
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

    const redirected = this.page.waitForURL(/\/leave(?:[?#]|$)/, { timeout: 15_000 }).then(() => true as const);
    const errored = this.page
      .getByRole("alert")
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => false as const);
    const succeeded = await Promise.race([redirected, errored]).catch(() => null);

    if (succeeded === false) {
      const message = (await this.page.getByRole("alert").first().textContent())?.trim() || "(no error text found)";
      throw new Error(`submitRequest() failed validation instead of redirecting to /leave: "${message}"`);
    }
    if (succeeded === null) {
      throw new Error("submitRequest() neither redirected to /leave nor showed a form error within 15s.");
    }
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

  /** Reads the whole rendered row (Type/Dates/Days/Status/Cancel button) for
   * the request matching this Dates label — a diagnostic read, not an
   * assertion, for confirming a specific request's REAL current status
   * (e.g. "submitted" vs "approved" vs "cancelled") rather than inferring it
   * from where an earlier test run stopped. Returns "" (never throws) if no
   * row matches, since a request may since have been resolved or the row
   * may have moved off the current page/filter. */
  async getRequestStatus(dateRangeLabel: string): Promise<string> {
    const row = this.page.getByRole("row", { name: new RegExp(escapeForRegExp(dateRangeLabel), "i") });
    if ((await row.count()) === 0) return "";
    return (await row.first().innerText()).replace(/\s+/g, " ").trim();
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

  /** Scopes to the exact-one <TableRow> whose text contains this tagged
   * reason — verified directly from approvals/page.tsx: every section
   * (Leave requests, Reimbursement claims, Timesheets, Letters, Payroll
   * exports) is a real <Table>/<TableRow>, not a card/list-item layout (a
   * stale doc comment here previously said otherwise). Throws rather than
   * guessing on 0 or >1 matches — same "exact-one" safety convention as
   * src/identity.ts's findUniqueUserRow — so a decision action can never
   * silently act on the wrong row or on more than one. */
  private async rowFor(needle: string) {
    const rows = this.page.getByRole("row", { name: new RegExp(escapeForRegExp(needle), "i") });
    const count = await rows.count();
    if (count !== 1) {
      throw new Error(`Expected exactly one /approvals row matching this run's tagged reason, found ${count}. Refusing to guess which row to act on.`);
    }
    return rows.first();
  }

  async approve(needle: string): Promise<void> {
    this.page.once("dialog", (d) => d.accept());
    await (await this.rowFor(needle)).getByRole("button", { name: "Approve", exact: true }).click();
  }

  async reject(needle: string, reason: string): Promise<void> {
    const scope = await this.rowFor(needle);
    await scope.getByRole("button", { name: "Reject", exact: true }).click();
    await scope.getByPlaceholder(/reason for rejecting/i).fill(reason);
    await scope.getByRole("button", { name: /confirm reject/i }).click();
  }

  async expectPending(needle: string): Promise<void> {
    try {
      await expect(this.page.getByText(needle).first()).toBeVisible({ timeout: 10_000 });
    } catch (err) {
      // Turns a bare 10s timeout into an actionable diagnostic. Run
      // 36351884519's manager-routing theory (that resolve_approver(
      // 'direct_manager', ...) might not resolve to the E2E_MANAGER test
      // account) has since been RULED OUT: confirmed live that
      // employees.manager_id is correctly set to the Manager test account,
      // and that account genuinely does see this run's tagged leave
      // request pending in its own /approvals — the Employee profile page
      // just failed to DISPLAY the manager's name (a separate, now-fixed
      // RLS-visibility bug, see get_employee_manager_name() in
      // schema.sql), which is what made routing look broken. So a future
      // expectPending() timeout here is NOT explained by routing — it's
      // either a genuine timing/propagation issue or a real regression;
      // dump what IS on the page rather than guessing further.
      const rowCount = await this.page.getByRole("row").count();
      test.info().annotations.push({
        type: "diagnostic",
        description: `expectPending("${needle}") timed out. This approver's /approvals page currently has ${rowCount} table row(s) (all sections, header rows included). Approval routing itself is confirmed working (see README.md) — investigate this as a timing/selector issue, not a routing one.`,
      });
      throw err;
    }
  }

  /** Diagnostic read, not an assertion — returns the first row whose
   * accessible name matches this needle (a Dates label or tagged reason),
   * or "" if none currently matches. Unlike rowFor() (used by approve/
   * reject, which throws on 0 or >1 matches since those must act on
   * exactly one row), this is for confirming what's actually on the page
   * right now, including cases where 0 or several rows match. */
  async getPendingRowText(needle: string): Promise<string> {
    const rows = this.page.getByRole("row", { name: new RegExp(escapeForRegExp(needle), "i") });
    if ((await rows.count()) === 0) return "";
    return (await rows.first().innerText()).replace(/\s+/g, " ").trim();
  }

  async expectNotPending(needle: string): Promise<void> {
    await expect(this.page.getByText(needle)).toHaveCount(0);
  }

  /** Scopes to the exact-one reimbursement-claim row for this specific
   * claim, via the truncated Claim ID column/link approvals/page.tsx now
   * renders (see its own doc comment) — matching by date+amount can't
   * disambiguate two claims that are otherwise identical (same date, same
   * smallest-allowed test amount), confirmed live when two such claims
   * landed in the same run (36359831264) and both timed out on a
   * description that page never rendered in the first place. Uses
   * toHaveCount's own auto-retry instead of a one-shot count() check, since
   * the row can take a moment to appear after the Employee's own submit. */
  private async reimbursementRowFor(claimId: string) {
    const shortId = claimId.slice(0, 8);
    const rows = this.page.getByRole("row", { name: new RegExp(escapeForRegExp(shortId)) });
    await expect(rows, `Expected exactly one /approvals row for claim ${shortId}… — refusing to guess which row to act on`).toHaveCount(1, { timeout: 15_000 });
    return rows.first();
  }

  async expectClaimPending(claimId: string): Promise<void> {
    await this.reimbursementRowFor(claimId);
  }

  async approveClaim(claimId: string): Promise<void> {
    this.page.once("dialog", (d) => d.accept());
    await (await this.reimbursementRowFor(claimId)).getByRole("button", { name: "Approve", exact: true }).click();
  }

  async rejectClaim(claimId: string, reason: string): Promise<void> {
    const scope = await this.reimbursementRowFor(claimId);
    await scope.getByRole("button", { name: "Reject", exact: true }).click();
    await scope.getByPlaceholder(/reason for rejecting/i).fill(reason);
    await scope.getByRole("button", { name: /confirm reject/i }).click();
  }

  async expectClaimNotPending(claimId: string): Promise<void> {
    const shortId = claimId.slice(0, 8);
    await expect(this.page.getByRole("row", { name: new RegExp(escapeForRegExp(shortId)) })).toHaveCount(0);
  }
}
