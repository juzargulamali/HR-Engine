/**
 * What an emailed sign-in link brought back in the address, read without contacting anything. Pure, so every shape is tested.
 *
 * Supabase puts the result of an invite or password link in the address: the session after `#` when it worked, or an error after `#` (and
 * sometimes after `?`) when the link was already used or is too old. A link made the older way comes back as `?code=...`, which can only
 * be completed in the browser that asked for it.
 *
 * Nothing here is ever logged or shown: the tokens go straight to the session and are removed from the address.
 */
export type EmailLink =
  | { kind: "tokens"; accessToken: string; refreshToken: string; type: string | null }
  | { kind: "error"; code: string | null; description: string | null }
  | { kind: "code" }
  | { kind: "none" };

const params = (part: string) => new URLSearchParams(part.replace(/^[#?]/, ""));

export function readEmailLink(hash: string, search = ""): EmailLink {
  const h = params(hash);
  const q = params(search);
  const accessToken = h.get("access_token");
  const refreshToken = h.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken, type: h.get("type") };
  const error = h.get("error") ?? q.get("error");
  const code = h.get("error_code") ?? q.get("error_code");
  if (error || code) return { kind: "error", code, description: h.get("error_description") ?? q.get("error_description") };
  if (q.get("code")) return { kind: "code" };
  return { kind: "none" };
}

/** A link that was already used, or is too old. Supabase reports both the same way. */
export const isUsedOrExpired = (link: EmailLink): boolean => link.kind === "error" && (link.code === "otp_expired" || /expired|invalid/i.test(link.description ?? ""));

/**
 * Where a link that landed on the wrong page belongs. Supabase sends a link to the site's home address when the address the app asked for
 * is not on its allowed list (for example a link sent from a Preview deployment); the home address then shows the sign-in page and the
 * link was lost. An invite goes to /set-password, a password reset to /reset-password. Null when the address carries no session.
 */
export function emailLinkDestination(hash: string): "/set-password" | "/reset-password" | null {
  const link = readEmailLink(hash);
  if (link.kind !== "tokens") return null;
  return link.type === "recovery" ? "/reset-password" : link.type === "invite" || link.type === "signup" ? "/set-password" : null;
}
