import type { Page } from "@playwright/test";

/**
 * Reads the signed-in user's own display name from the sidebar identity
 * control (`apps/web/src/components/nav/user-menu.tsx`'s trigger button,
 * which renders `fullName` as plain visible text — no navigation needed).
 * Located the same source-grounded way as the sign-out control in
 * tests/read-only/auth.spec.ts: the only button rendering lucide-react's
 * ChevronsUpDown icon, whose svg carries the stable `lucide-chevrons-up-down`
 * class.
 *
 * This exists so a mutating spec that must act on a SPECIFIC dedicated test
 * account's row in an admin-facing list (e.g. the attendance register,
 * which has no per-employee URL and shows an entire company's roster) can
 * target that exact row by the account's own real name, rather than
 * guessing at "whichever row happens to render first" — which could just
 * as easily be a real employee. Never hardcode a test account's display
 * name; always read it from the account's own session like this.
 */
export async function getOwnDisplayName(page: Page): Promise<string> {
  const trigger = page.locator("button:has(svg.lucide-chevrons-up-down)");
  const count = await trigger.count();
  if (count === 0) {
    throw new Error(
      "Could not find the account-menu trigger (button:has(svg.lucide-chevrons-up-down)) to read this account's display name — confirm the real selector on first live run rather than falling back to an unscoped row match.",
    );
  }
  const text = (await trigger.first().innerText()).trim();
  // The trigger's first line is the full name; a second line (the primary
  // role label) may follow — see user-menu.tsx.
  const firstLine = text.split("\n")[0]?.trim();
  if (!firstLine) {
    throw new Error(`Account-menu trigger was found but had no readable text ("${text}") — cannot safely target this account's row elsewhere.`);
  }
  return firstLine;
}
