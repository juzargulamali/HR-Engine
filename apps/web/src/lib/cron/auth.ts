import "server-only";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every invocation
 * when CRON_SECRET is set in the project's env — see vercel.json. Any
 * request without a matching header (including a stray public hit on the
 * URL) is rejected before touching the database.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Sentinel for ledger rows a scheduled job writes, not a person — same
 * convention as supabase/seed.sql's placeholder "drafted by" author. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
