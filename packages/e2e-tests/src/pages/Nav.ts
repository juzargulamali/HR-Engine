import { type Page, expect } from "@playwright/test";

/** Every top-level route this app has (apps/web/src/app/(app)/*\/page.tsx),
 * confirmed by directory listing. */
export const ROUTES = [
  "/",
  "/employees",
  "/attendance",
  "/leave",
  "/leave/new",
  "/holidays",
  "/policies",
  "/policies/new",
  "/audit-log",
  "/payroll",
  "/reimbursements",
  "/approvals",
  "/performance",
  "/timesheets",
  "/assets",
  "/letters",
  "/profile",
  "/ai-suggestions",
  "/alerts",
] as const;

/**
 * Confirmed by reading every page.tsx under apps/web/src/app/(app)/ directly
 * (not guessed): this app has NO route that redirects or blanks the page for
 * an authenticated-but-wrong-role user. The ONLY redirect is the signed-out
 * case, handled by middleware before any page runs. A wrong-role visit to
 * one of these six routes instead renders normally (200, same URL) with a
 * `role="alert"` box carrying this exact text — see
 * `apps/web/src/components/ui/alert.tsx`. Every other route
 * (`/`, employees, attendance, leave, leave/new, holidays, policies,
 * reimbursements, approvals, performance, timesheets, letters, profile,
 * ai-suggestions is role-gated but alerts is too — see below) either has no
 * role gate at all or silently scopes its content/query by role instead of
 * denying — those need a page-specific assertion (which rows/buttons show),
 * not a generic "forbidden" check, so they are deliberately not listed here.
 */
export const ROLE_DENIED_ALERT: Partial<Record<(typeof ROUTES)[number], RegExp>> = {
  "/policies/new": /you need an hr admin grant scoped to a country/i,
  "/audit-log": /the audit log is restricted to hr admin and system administrator/i,
  "/payroll": /payroll export is restricted to hr admin, finance, ceo, and cto/i,
  "/assets": /the asset inventory is restricted to hr admin and finance/i,
  "/ai-suggestions": /ai suggestions is restricted to hr admin and sys admin/i,
  "/alerts": /alerts are restricted to hr admin, ceo, and cto/i,
};

export async function visitDirectly(page: Page, route: string): Promise<{ finalUrl: string; bodyText: string }> {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  const finalUrl = page.url();
  const bodyText = (await page.locator("body").innerText()).trim();
  return { finalUrl, bodyText };
}

/** Signed-out access: the only case this app actually redirects for. */
export async function expectRedirectedToLogin(page: Page, route: string): Promise<void> {
  const { finalUrl } = await visitDirectly(page, route);
  expect(finalUrl, `Expected an unauthenticated visit to ${route} to redirect to /login`).toMatch(/\/login(\?|$)/);
}

/**
 * For the six explicitly role-gated routes in ROLE_DENIED_ALERT only. Denial
 * here means: same URL (no redirect), 200, and the specific destructive
 * alert text — never "redirected away" or "empty page", which is not how
 * this app denies access.
 */
export async function expectRoleDenied(page: Page, route: keyof typeof ROLE_DENIED_ALERT): Promise<void> {
  const pattern = ROLE_DENIED_ALERT[route];
  if (!pattern) throw new Error(`${route} has no known role-denial alert text — see ROLE_DENIED_ALERT.`);
  const { finalUrl } = await visitDirectly(page, route);
  expect(finalUrl.endsWith(route), `Expected to stay on ${route} (role denial renders in place), was redirected to ${finalUrl}`).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: pattern })).toBeVisible();
}

/** For the six explicitly role-gated routes: the alert must be ABSENT for a
 * role that should be allowed. Does not assert on route content beyond
 * that, since each route's allowed body differs. */
export async function expectRoleAllowed(page: Page, route: keyof typeof ROLE_DENIED_ALERT): Promise<void> {
  const pattern = ROLE_DENIED_ALERT[route];
  if (!pattern) throw new Error(`${route} has no known role-denial alert text — see ROLE_DENIED_ALERT.`);
  const { finalUrl, bodyText } = await visitDirectly(page, route);
  expect(finalUrl.endsWith(route), `Expected to stay on ${route}, was redirected to ${finalUrl}`).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: pattern })).toHaveCount(0);
  expect(bodyText.length, `Expected ${route} to render real content`).toBeGreaterThan(20);
}

/** For routes with no role gate at all (see the doc comment on
 * ROLE_DENIED_ALERT): just confirms the route renders something for an
 * authenticated user. Which specific rows/buttons should or shouldn't
 * appear for a given role is page-specific — assert that in each feature's
 * own spec, not here. */
export async function expectRouteRenders(page: Page, route: string): Promise<void> {
  const { finalUrl, bodyText } = await visitDirectly(page, route);
  expect(finalUrl.endsWith(route), `Expected to stay on ${route}, was redirected to ${finalUrl}`).toBe(true);
  expect(bodyText.length, `Expected ${route} to render real content`).toBeGreaterThan(20);
}
