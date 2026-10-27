import { expect, type Locator, type Page } from "@playwright/test";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The account controls (status, password reset, resend invite, delete) live in People & Access (`/people-access`), under the person's Account tab,
 * where Users & roles used to be a table with one row per person. Finds the one person with this sign-in address (System Administrator only), opens
 * their Account tab and returns that region, so a spec can look for the status badge and the buttons inside it.
 */
export async function openAccountPanel(page: Page, email: string): Promise<Locator> {
  await page.goto(`/people-access?q=${encodeURIComponent(email)}`);
  const person = page.getByRole("main").getByRole("link", { name: new RegExp(escapeRe(email), "i") });
  await expect(person, `exactly one person with the address ${email}`).toHaveCount(1);
  await person.click();
  await page.getByRole("navigation", { name: "About this person" }).getByRole("link", { name: "Account", exact: true }).click();
  const account = page.getByRole("region", { name: "Account", exact: true });
  await expect(account).toBeVisible();
  return account;
}
