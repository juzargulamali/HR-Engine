import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Plain === on a secret comparison leaks timing information proportional to
 * how many leading bytes match — in principle usable to guess the secret
 * byte-by-byte. timingSafeEqual needs equal-length buffers, so a length
 * mismatch (any wrong guess of a different length) is handled separately;
 * the real secret is never compared via a variable-time operation.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // keep timing consistent with the equal-length path
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on every invocation
 * when CRON_SECRET is set in the project's env — see vercel.json. Any
 * request without a matching header (including a stray public hit on the
 * URL) is rejected before touching the database.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  return timingSafeStringEqual(header, `Bearer ${secret}`);
}

/** Sentinel for ledger rows a scheduled job writes, not a person — same
 * convention as supabase/seed.sql's placeholder "drafted by" author. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
