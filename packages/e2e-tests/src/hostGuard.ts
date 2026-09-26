import { getBaseUrl, getSupabaseUrl } from "./config";

/** The only hostnames this suite's browser traffic should ever land on
 * after a real navigation/redirect: the confirmed Production app, and (if
 * known) its own Supabase project — never a third-party origin, which
 * would indicate a hijacked/unexpected redirect (e.g. during sign-in). */
export function allowedHostnames(): string[] {
  const hosts = [new URL(getBaseUrl()).hostname];
  const supabaseUrl = getSupabaseUrl();
  if (supabaseUrl) hosts.push(new URL(supabaseUrl).hostname);
  return hosts;
}

/** Throws — never silently continues — if the browser ended up on a host
 * outside allowedHostnames(). Call this right after a sign-in or any
 * navigation whose destination should be fully within this app's control.
 *
 * Chrome's own internal error interstitial (shown when a navigation fails
 * at the network level — a transient connection drop, not a redirect) is
 * `chrome-error://chromewebdata/`, whose "hostname" parses to
 * "chromewebdata". That's a failed navigation, not an external origin, and
 * describing it as "unexpected navigation to external origin" is actively
 * misleading — so those pseudo-schemes are excluded here and left for the
 * caller's own navigation/assertion timeout to report accurately. */
export function assertOnAllowedHost(currentUrl: string): void {
  const url = new URL(currentUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  const allowed = allowedHostnames();
  if (!allowed.includes(url.hostname)) {
    throw new Error(`Unexpected navigation to external origin "${url.hostname}" (allowed: ${allowed.join(", ")}) — aborting rather than proceeding past an unexpected redirect.`);
  }
}
