import type { Locator, Page } from "@playwright/test";
import { escapeForRegExp } from "./recordTag";

/**
 * People & Access (`/people-access`) replaced the Users & Roles table (`/admin/users`). Its people list is one link per person: the name first, then the
 * sign-in address (shown to the System Administrator), then the company and the status words of an account that is not active. A person's status badge
 * is under their Account tab. Every reader below is keyed by email (auth emails are globally unique by `auth.users`) and refuses to proceed unless that
 * resolves to EXACTLY one person: 0 means the account isn't visible where expected, >1 cannot legitimately happen; either way this throws rather than
 * guessing which one to use.
 *
 * MUST be called with a Sys Admin session: only a System Administrator sees accounts and their addresses there. An HR Admin sees employees without
 * addresses (and no Account tab), so the address search finds nobody for ANY email.
 */
async function findUniquePerson(sysAdminPage: Page, email: string): Promise<Locator> {
  await sysAdminPage.goto(`/people-access?q=${encodeURIComponent(email)}`);
  const person = sysAdminPage.getByRole("main").getByRole("link", { name: new RegExp(escapeForRegExp(email), "i") });
  const count = await person.count();
  if (count !== 1) {
    throw new Error(`Expected exactly one People & Access entry matching email "${email}" (auth emails are globally unique), found ${count}. Refusing to guess.`);
  }
  return person;
}

/**
 * Resolves the Employee test account's display name from a STABLE identifier — its auth email (`E2E_EMPLOYEE_EMAIL`) — via the People & Access list,
 * never from the account's own self-reported sidebar text and never from `employees.personal_email` (a separate, nullable contact field with no
 * guaranteed relationship to the login email — see schema/schema.sql's `employees` table).
 *
 * This exists so a mutating spec that must act on a SPECIFIC dedicated test account's row in an admin-facing list with no per-employee URL (e.g. the
 * attendance register, which shows an entire company's roster) can target that exact row by a name that's ITSELF been verified against a unique
 * identifier — rather than trusting a name string on faith.
 */
export async function getEmployeeNameByAuthEmail(sysAdminPage: Page, email: string): Promise<string> {
  const person = await findUniquePerson(sysAdminPage, email);
  // The first line of the entry is the name (the list shows the name, then the address).
  const name = (await person.locator("span").first().innerText()).trim();
  if (!name || name === "—") {
    throw new Error(`The People & Access entry for "${email}" has no usable name ("${name}") — cannot safely target this account's row elsewhere by name.`);
  }
  return name;
}

/**
 * Reads ONLY the status badge of this email's Account tab — never the whole panel's text, which also contains a "Deactivate" button on an ACTIVE
 * account or a "Reactivate" button on a deactivated one. A naive substring/regex check against the FULL panel text (e.g. /deactivat/i) matches that
 * button's own label even when the account is genuinely Active, producing a false failure.
 */
export async function getAccountStatusCellText(sysAdminPage: Page, email: string): Promise<string> {
  const person = await findUniquePerson(sysAdminPage, email);
  await person.click();
  await sysAdminPage.getByRole("navigation", { name: "About this person" }).getByRole("link", { name: "Account", exact: true }).click();
  const account = sysAdminPage.getByRole("region", { name: "Account", exact: true });
  // Badges carry a data-tone; the first one in the Account panel is the status.
  return (await account.locator("[data-tone]").first().innerText()).trim();
}
