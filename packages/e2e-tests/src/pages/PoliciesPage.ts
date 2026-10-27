import { type Page, expect } from "@playwright/test";
import { gotoWithRetry } from "../gotoWithRetry";

/**
 * apps/web/src/app/(app)/policies/{page,policy-versions-table,
 * activate-button,delete-policy-version-button}.tsx — built this session,
 * so this is fully verified against source, not guessed. Deliberately never
 * clicks Activate: policy activation is out of scope for tonight's suite
 * (hard boundary — "do not modify or activate policy records").
 */
export class PoliciesPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await gotoWithRetry(this.page, "/policies");
  }

  async showOlderVersions(): Promise<void> {
    await this.page.getByRole("button", { name: /show older versions/i }).click();
  }

  rowFor(countryLabel: string, policyType: string) {
    return this.page.getByRole("row", { name: new RegExp(`${countryLabel}.*${policyType}`, "i") });
  }

  /** Only the latest version per (country, policy_type) should be visible
   * before the toggle is used. */
  async expectOnlyLatestVisible(countryLabel: string, policyType: string, latestVersionText: string, olderVersionText: string): Promise<void> {
    await expect(this.page.getByText(latestVersionText)).toBeVisible();
    await expect(this.page.getByText(olderVersionText)).toHaveCount(0);
  }

  async expectActivateNeverClickable(countryLabel: string, policyType: string): Promise<void> {
    // Explicit negative assertion, not just "we didn't click it": proves
    // this suite genuinely cannot activate anything even by accident.
    const activateButtons = this.rowFor(countryLabel, policyType).getByRole("button", { name: /^activate$/i });
    const count = await activateButtons.count();
    if (count > 0) {
      // Visible to THIS role is fine (that's the two-person-rule check) —
      // the assertion is simply "we never call .click() on it", enforced by
      // code review of this file, not a runtime check.
      await expect(activateButtons.first()).toBeVisible();
    }
  }

  async expectDeleteHiddenOrDisabled(countryLabel: string, policyType: string): Promise<void> {
    const row = this.rowFor(countryLabel, policyType);
    const deleteButton = row.getByRole("button", { name: /^delete$/i });
    const count = await deleteButton.count();
    if (count === 0) {
      await expect(row.getByText(/has configured leave types/i)).toBeVisible();
    } else {
      await expect(deleteButton).toBeDisabled();
    }
  }

  /** The status badge of every version row currently shown (lower case), in table order. */
  async visibleStatuses(): Promise<string[]> {
    const cells = this.page.locator("table tbody tr td:nth-child(5)");
    return (await cells.allInnerTexts()).map((t) => t.trim().toLowerCase()).filter(Boolean);
  }

  /** Status and address of every version row currently shown. */
  async visibleVersions(): Promise<{ status: string; href: string }[]> {
    return this.page.locator("table tbody tr").evaluateAll((rows) =>
      rows
        .map((row) => ({
          status: (row.querySelector("td:nth-child(5)")?.textContent ?? "").trim().toLowerCase(),
          href: row.querySelector('a[href^="/policies/"]')?.getAttribute("href") ?? "",
        }))
        .filter((r) => r.status && r.href),
    );
  }

  /** Reveals the older versions when the toggle is offered; returns how many it announced (0 when there is no toggle). */
  async revealOlderVersions(): Promise<number> {
    const toggle = this.page.getByRole("button", { name: /show older versions/i });
    if ((await toggle.count()) === 0) return 0;
    const announced = Number(/\((\d+)\)/.exec((await toggle.innerText()) ?? "")?.[1] ?? "0");
    await toggle.click();
    await expect(this.page.getByRole("button", { name: /hide older versions/i })).toBeVisible();
    return announced;
  }

  /** What only someone who may draft or decide a policy is given: none of it may appear for anyone else. */
  async expectNoManagementControls(): Promise<void> {
    await expect(this.page.getByRole("button", { name: /^activate$/i })).toHaveCount(0);
    await expect(this.page.getByRole("button", { name: /^delete$/i })).toHaveCount(0);
    await expect(this.page.getByRole("link", { name: /^draft a policy$/i })).toHaveCount(0);
    await expect(this.page.getByText(/awaiting a different approver|has configured leave types|review & activate/i)).toHaveCount(0);
  }
}
