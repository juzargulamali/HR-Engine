import type { Locator, Page } from "@playwright/test";
import { escapeForRegExp } from "./recordTag";

/**
 * Users & Roles (`/admin/users`) columns are Name, Email, Status, Roles,
 * Actions, in that order — verified against
 * apps/web/src/app/(app)/admin/users/page.tsx. Every reader below is keyed
 * by email (auth emails are globally unique by `auth.users`) and refuses to
 * proceed unless that resolves to EXACTLY one row — 0 means the account
 * isn't visible where expected, >1 cannot legitimately happen and would
 * mean something is badly wrong; either way, this throws rather than
 * guessing which row to use.
 *
 * MUST be called with a Sys Admin session: the entire `/admin/*` section is
 * gated by apps/web/src/app/(app)/admin/layout.tsx, which renders a plain
 * "You need the System Administrator role to view this page." alert (no
 * table, zero rows, for ANY email) instead of `children` unless
 * `isSysAdmin(session.grants)`. This is a hard, global, deliberately
 * undifferentiated gate — HR Admin gets exactly the same denial as an
 * Employee, before any row for ANY email is ever rendered. (A prior version
 * of this file's callers passed `hrAdminPage` here on the mistaken
 * assumption that HR Admin could view — not just manage — this page; that
 * is what produced the observed live failure: `findUniqueUserRow` resolving
 * zero rows for the Employee test account's own email.)
 */
async function findUniqueUserRow(sysAdminPage: Page, email: string): Promise<Locator> {
  await sysAdminPage.goto("/admin/users");
  const row = sysAdminPage.getByRole("row", { name: new RegExp(escapeForRegExp(email), "i") });
  const count = await row.count();
  if (count !== 1) {
    throw new Error(`Expected exactly one Users & Roles row matching email "${email}" (auth emails are globally unique), found ${count}. Refusing to guess.`);
  }
  return row;
}

/**
 * Resolves the Employee test account's display name from a STABLE
 * identifier — its auth email (`E2E_EMPLOYEE_EMAIL`) — via the Users &
 * Roles list, never from the account's own self-reported sidebar text and
 * never from `employees.personal_email` (a separate, nullable contact
 * field with no guaranteed relationship to the login email — see
 * schema/schema.sql's `employees` table).
 *
 * This exists so a mutating spec that must act on a SPECIFIC dedicated test
 * account's row in an admin-facing list with no per-employee URL (e.g. the
 * attendance register, which shows an entire company's roster) can target
 * that exact row by a name that's ITSELF been verified against a unique
 * identifier — rather than trusting a name string on faith.
 */
export async function getEmployeeNameByAuthEmail(sysAdminPage: Page, email: string): Promise<string> {
  const row = await findUniqueUserRow(sysAdminPage, email);
  const nameCell = row.getByRole("cell").nth(0);
  const name = (await nameCell.innerText()).trim();
  if (!name || name === "—") {
    throw new Error(`The Users & Roles row for "${email}" has no usable name ("${name}") — cannot safely target this account's row elsewhere by name.`);
  }
  return name;
}

/**
 * Reads ONLY the Status cell/badge for this email's row — never the whole
 * row's text, which also contains a "Deactivate" button on an ACTIVE
 * account (to let the admin deactivate it) or a "Reactivate" button on a
 * deactivated one. A naive substring/regex check against the FULL row text
 * (e.g. /deactivat/i) matches that button's own label even when the
 * account is genuinely Active, producing a false failure.
 */
export async function getAccountStatusCellText(sysAdminPage: Page, email: string): Promise<string> {
  const row = await findUniqueUserRow(sysAdminPage, email);
  const statusCell = row.getByRole("cell").nth(2);
  return (await statusCell.innerText()).trim();
}
