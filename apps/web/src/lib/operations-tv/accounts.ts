import { randomBytes } from "node:crypto";

/**
 * Pure helpers for the display accounts of the office board (Phase 3). A display account is an ordinary sign-in created for one TV: the service role makes it (with
 * `app_metadata.ops_tv = true` so the proxy can keep it on the board) and the database registers it for one company. Nothing here talks to the database or the network.
 */
export const DISPLAY_LABEL_MAX = 60;
/** Supabase's Go-duration syntax; about 100 years. The same value the account-status action uses to block a sign-in. */
export const DISPLAY_BAN_DURATION = "876600h";
export const DEFAULT_OFFICE_TZ = "Asia/Dubai";

/** How a display shows in People & Access, if its sign-in is ever listed there: it is named for what it is and has no roles. */
export const displayFullName = (label: string) => `Office board: ${label}`;

/** A password of at least 24 characters from 24+ random bytes, with a lower-case letter, an upper-case letter, a digit and a symbol so any password policy accepts it. The random source is injectable for tests. */
export function generateDisplayPassword(random: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  const base = Buffer.from(random(24)).toString("base64url");
  const pick = (chars: string) => chars[random(1)[0]! % chars.length]!;
  let out = base;
  if (!/[a-z]/.test(out)) out += pick("abcdefghjkmnpqrstuvwxyz");
  if (!/[A-Z]/.test(out)) out += pick("ABCDEFGHJKLMNPQRSTUVWXYZ");
  if (!/[0-9]/.test(out)) out += pick("23456789");
  if (!/[^A-Za-z0-9]/.test(out)) out += pick("-_.!");
  return out;
}

export const normaliseEmail = (s: string) => s.trim().toLowerCase();
export const isValidEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@.]+$/.test(s);

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

/** One row of the display list as the page shows it. `email` may be absent in the database answer; the page then looks it up with the service role after the access check. */
export interface DisplayRow { id: string; userId: string; label: string; officeTz: string; createdAt: string | null; lastSeenAt: string | null; revokedAt: string | null; email: string | null }
export type DisplayState = "active" | "revoked";
export const displayState = (r: Pick<DisplayRow, "revokedAt">): DisplayState => (r.revokedAt ? "revoked" : "active");

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
/** Reads the answer of `ops_tv_list_displays` defensively: a row without an id or a user is dropped, never guessed. Active rows first, then newest first. */
export function parseDisplayRows(data: unknown): DisplayRow[] {
  if (!Array.isArray(data)) return [];
  const rows: DisplayRow[] = [];
  for (const x of data) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const id = str(r.id) ?? str(r.display_id);
    const userId = str(r.user_id);
    if (!id || !userId) continue;
    rows.push({ id, userId, label: str(r.label) ?? "Display", officeTz: str(r.office_tz) ?? DEFAULT_OFFICE_TZ, createdAt: str(r.created_at), lastSeenAt: str(r.last_seen_at), revokedAt: str(r.revoked_at), email: str(r.email) });
  }
  return rows.sort((a, b) => Number(displayState(a) === "revoked") - Number(displayState(b) === "revoked") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/** Plain words for the errors these actions can meet. The database and the Admin API messages are never shown as they are. */
export function friendlyDisplayError(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "42501") return "Only an Operations Manager of this company can set up or revoke an office board display.";
  if (error.code === "42883" || error.code === "PGRST202" || error.code === "42P01" || error.code === "PGRST205" || /schema cache|does not exist/i.test(error.message ?? "")) return "The office board is not installed in this environment yet. Nothing was changed.";
  if (error.code === "22023" || error.code === "23514") return error.message && error.message.length < 200 ? error.message : fallback;
  if (/already (been )?registered|already exists|duplicate/i.test(error.message ?? "")) return "That e-mail already has an account. Use a different address for the display.";
  return fallback;
}
