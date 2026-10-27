#!/usr/bin/env node
// Measures what a DEACTIVATED account's already-issued access token can still do, without assuming the answer.
//
// How it is used (docs/people-access-hosted-test-runbook.md, step H4):
//   1. you run this with the test account's address and password; it signs in once and keeps that session;
//   2. when it asks, you deactivate that account in People & Access (as the test System Administrator) and press ENTER;
//   3. it then asks, every few seconds, three questions with the OLD token, until the token expires, and writes down when each answer changed:
//        auth   : does the auth service still accept the token?            (GET /auth/v1/user)
//        data   : does the data API still accept it as a signed-in user?   (GET /rest/v1/profiles, readable by signed-in users only)
//        refresh: does the auth service still hand out a new token?        (refresh-token grant, once early and once after expiry)
//
// It reads nothing but the account's own profile row and a one-row sample of the directory every signed-in user can read. It writes nothing,
// never prints a token or the password, never touches the service-role key, changes no setting, and refuses any account whose address does
// not contain "e2e-test-" so it can never be pointed at a real person by mistake.
//
//   SUPABASE_URL=https://<project>.supabase.co SUPABASE_ANON_KEY=<public anon key> \
//   P_EMAIL=<you>+e2e-test-p@<domain> P_PASSWORD=<the test account's password> \
//   node scripts/measure-token-window.mjs [--poll-seconds 30] [--max-minutes 90]
import readline from "node:readline";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const POLL_SECONDS = arg("poll-seconds", 30);
const MAX_MINUTES = arg("max-minutes", 90);
const { SUPABASE_URL, SUPABASE_ANON_KEY, P_EMAIL, P_PASSWORD } = process.env;

function stop(message) {
  console.error(`\nStopped: ${message}`);
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !P_EMAIL || !P_PASSWORD) stop("set SUPABASE_URL, SUPABASE_ANON_KEY, P_EMAIL and P_PASSWORD (see the header of this file).");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(SUPABASE_URL)) stop("SUPABASE_URL must be a https://<project>.supabase.co address (or a local stack).");
if (!P_EMAIL.toLowerCase().includes("e2e-test-")) stop(`${P_EMAIL} does not look like a disposable test account (its address must contain "e2e-test-"). Nothing was done.`);
const base = SUPABASE_URL.replace(/\/$/, "");

const decode = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
const stamp = (d = new Date()) => d.toISOString().replace("T", " ").slice(0, 19) + "Z";
const verdict = (res) => `${res.status}${res.status === 200 ? " accepted" : " refused"}`;

async function call(path, token, init = {}) {
  try {
    return await fetch(`${base}${path}`, { ...init, headers: { apikey: SUPABASE_ANON_KEY, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  } catch (e) {
    return { status: 0, json: async () => ({ message: String(e) }), text: async () => "" };
  }
}

// ---- 1. sign in once ----
const signIn = await call("/auth/v1/token?grant_type=password", null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: P_EMAIL, password: P_PASSWORD }) });
if (signIn.status !== 200) stop(`the test account could not sign in (HTTP ${signIn.status}). Check the address and password, and that the account is Active.`);
const session = await signIn.json();
const token = session.access_token;
const claims = decode(token);
const expiresAt = new Date(claims.exp * 1000);
console.log(`Signed in as ${P_EMAIL}.`);
console.log(`Access token issued ${stamp(new Date(claims.iat * 1000))}, expires ${stamp(expiresAt)}  =>  lifetime ${Math.round((claims.exp - claims.iat) / 60)} minutes. (Refresh token kept; neither is printed.)`);

const ask = async () => {
  const auth = await call("/auth/v1/user", token);
  const own = await call(`/rest/v1/profiles?id=eq.${claims.sub}&select=id,account_status`, token);
  const directory = await call("/rest/v1/profiles?select=id&limit=1", token);
  const ownRows = own.status === 200 ? (await own.json()).length : null;
  const dirRows = directory.status === 200 ? (await directory.json()).length : null;
  return {
    auth: verdict(auth),
    dataOwnRow: own.status === 200 ? `${own.status} own profile row ${ownRows === 1 ? "readable" : "NOT readable"}` : verdict(own),
    dataDirectory: directory.status === 200 ? `${directory.status} directory ${dirRows === 1 ? "readable" : "empty"}` : verdict(directory),
  };
};
const refreshAttempt = async () => {
  const res = await call("/auth/v1/token?grant_type=refresh_token", null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
  return `${res.status}${res.status === 200 ? " NEW TOKEN ISSUED" : " refused"}`;
};

// ---- 2. baseline ----
const before = await ask();
console.log("\nBefore deactivation (should all be accepted):");
console.log(`  auth: ${before.auth} | data: ${before.dataOwnRow}; ${before.dataDirectory}`);
if (!before.auth.startsWith("200") || !before.dataOwnRow.startsWith("200")) stop("the token is not accepted even before deactivation, so a measurement would mean nothing.");

// ---- 3. you deactivate ----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => rl.question(`\nNow, as the test System Administrator, DEACTIVATE ${P_EMAIL} in People & Access and wait for the page to say Deactivated.\nPress ENTER the moment it does: `, resolve));
rl.close();
const t0 = Date.now();
console.log(`Deactivation recorded at ${stamp(new Date(t0))}. Polling every ${POLL_SECONDS}s until the token expires (${stamp(expiresAt)}) plus a minute, or ${MAX_MINUTES} minutes.\n`);

// ---- 4. poll ----
const timeline = [];
let last = "";
const record = (state, extra = "") => {
  const key = JSON.stringify(state);
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (key !== last) {
    timeline.push({ at: stamp(), elapsed, ...state, note: extra });
    console.log(`+${String(elapsed).padStart(5)}s  auth: ${state.auth} | data: ${state.dataOwnRow}; ${state.dataDirectory}${extra ? `  [${extra}]` : ""}`);
    last = key;
  }
};
const refreshEarly = await refreshAttempt();
console.log(`+${String(Math.round((Date.now() - t0) / 1000)).padStart(5)}s  refresh with the old refresh token: ${refreshEarly}`);
const deadline = Math.min(expiresAt.getTime() + 60_000, t0 + MAX_MINUTES * 60_000);
while (Date.now() < deadline) {
  record(await ask());
  await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
}
record(await ask(), "final");
const refreshLate = await refreshAttempt();
console.log(`         refresh at the end: ${refreshLate}`);

// ---- 5. result ----
const firstRefusal = (field) => timeline.find((t) => !t[field].startsWith("200"));
const dataField = "dataDirectory";
const finishedBeforeExpiry = Date.now() < expiresAt.getTime();
console.log("\n=== RESULT (paste this into the runbook) ===");
console.log(`Token lifetime: ${Math.round((claims.exp - claims.iat) / 60)} minutes (expires ${stamp(expiresAt)}).`);
const a = firstRefusal("auth");
console.log(`Auth service: ${a ? `refused the old token from +${a.elapsed}s after deactivation (${a.auth})` : "still ACCEPTED the old token for the whole observation"}.`);
const d = firstRefusal(dataField);
console.log(
  `Data API: ${d ? `refused the old token from +${d.elapsed}s after deactivation (${d[dataField]})` : finishedBeforeExpiry ? `still ACCEPTED the old token until the end of the observation, which stopped BEFORE the token expired (${stamp()})` : "still ACCEPTED the old token for the whole observation"}.`,
);
console.log(`Refresh with the old refresh token: ${refreshEarly} right after deactivation; ${refreshLate} at the end.`);
console.log("(Nothing was changed by this script: no write, no setting, no token revoked.)");
process.exit(0);
