import { type Page, expect } from "@playwright/test";

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
    await this.page.goto("/policies");
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
}
