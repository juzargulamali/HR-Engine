/**
 * The exact request paths vercel.json schedules. Vercel Cron calls them with
 * `Authorization: Bearer $CRON_SECRET` and NO Supabase session cookie, so the
 * sign-in redirect in src/proxy.ts would answer them with 307 -> /login before
 * the route's own CRON_SECRET check ever ran.
 *
 * proxy.ts exempts exactly these paths from that redirect, and only when
 * ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION is the exact string "on" (unset by
 * default, so nothing changes until the owner deliberately sets it). The route
 * handlers' own isAuthorizedCronRequest() check stays the real gate.
 *
 * Exact paths only, never a prefix: adding a path here is a deliberate act,
 * and a test pins this list to vercel.json so the two cannot drift apart.
 * Do not add a route here unless it checks isAuthorizedCronRequest() and
 * returns 401 before doing any work.
 *
 * Deliberately has no "server-only" import: src/proxy.ts imports this file.
 */
export const SCHEDULED_ROUTE_PATHS = [
  "/api/cron/leave-accrual",
  "/api/cron/comp-day-expiry",
  "/api/cron/document-expiry",
  "/api/ai/detect-balance-discrepancies",
  "/api/cron/recovery-windows",
] as const;

export const ALLOW_SCHEDULED_ROUTES_ENV = "ALLOW_SCHEDULED_ROUTES_WITHOUT_SESSION";

/** True only when the gate variable is exactly "on" ("true", "1", "ON", " on" do not enable it). */
export function scheduledRoutesAllowedWithoutSession(): boolean {
  return process.env[ALLOW_SCHEDULED_ROUTES_ENV] === "on";
}

/** Exact, case-sensitive match against the allowlist; never a prefix or pattern match. */
export function isScheduledRoutePath(pathname: string): boolean {
  return (SCHEDULED_ROUTE_PATHS as readonly string[]).includes(pathname);
}
