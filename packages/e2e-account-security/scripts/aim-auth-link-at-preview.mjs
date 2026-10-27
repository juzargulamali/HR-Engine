#!/usr/bin/env node
// Re-aims an invitation or password-reset e-mail link at the PREVIEW you are testing.
//
// Why: the e-mail is built from the deployment's NEXT_PUBLIC_SITE_URL, which may be the production address even when the invitation was sent
// from a preview. Clicking it would then test production's page, not the preview's. The link in the e-mail first goes to Supabase
// (/auth/v1/verify), which answers with a redirect to the site carrying the sign-in tokens. This script asks for that redirect WITHOUT a browser,
// reads where it points, and prints the same destination on the preview's own address. Nothing is changed in any setting or account.
//
//   node scripts/aim-auth-link-at-preview.mjs "<the link from the e-mail>" https://<your-preview>.vercel.app
//
// The link is single use: do not click it first. The result contains a live sign-in token for a disposable test account: open it once, in a
// private window, and do not share it. It refuses anything that is not a Supabase verify link and a *.vercel.app (or local) preview.
const [link, previewArg] = process.argv.slice(2);
const stop = (m) => { console.error(`Stopped: ${m}`); process.exit(1); };
if (!link || !previewArg) stop('usage: node scripts/aim-auth-link-at-preview.mjs "<link from the e-mail>" https://<preview>.vercel.app');

let source, preview;
try { source = new URL(link); preview = new URL(previewArg); } catch { stop("one of the two addresses is not a valid URL."); }
const okHost = (h) => h === "localhost" || h === "127.0.0.1";
if (!(source.hostname.endsWith(".supabase.co") || okHost(source.hostname))) stop(`${source.hostname} is not a Supabase address: this only handles the link from the e-mail.`);
if (!(preview.hostname.endsWith(".vercel.app") || okHost(preview.hostname))) stop(`${preview.hostname} is not a *.vercel.app preview (or a local address).`);

let destination;
if (source.hash.includes("access_token=") || source.searchParams.has("code")) {
  destination = source; // already the site's own address with the tokens on it
} else {
  if (!source.pathname.endsWith("/auth/v1/verify")) stop("this is not a Supabase verify link (…/auth/v1/verify?token=…).");
  const res = await fetch(source, { redirect: "manual" });
  const where = res.headers.get("location");
  if (![301, 302, 303, 307, 308].includes(res.status) || !where) stop(`Supabase did not redirect (HTTP ${res.status}). The link may already have been used or have expired: send a new e-mail.`);
  destination = new URL(where, source);
}

// If the redirect landed on the site's root (the redirect address was not allowed), use the page the link type belongs to.
const type = source.searchParams.get("type") ?? new URLSearchParams(destination.hash.slice(1)).get("type");
let path = destination.pathname;
if (path === "/" || path === "") path = type === "invite" || type === "signup" ? "/set-password" : "/reset-password";
const out = `${preview.origin}${path}${destination.search}${destination.hash}`;
if (!/access_token=|code=/.test(out)) stop("the redirect carried no sign-in token. Send a new e-mail and try again.");

console.log("Open this once, in a private window (it contains a live sign-in token for the test account):\n");
console.log(out);
console.log(`\nPage: ${path}   Type: ${type ?? "unknown"}   (token not shown above is not stored anywhere by this script)`);
