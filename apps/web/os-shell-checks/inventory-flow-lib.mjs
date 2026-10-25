// Shared plumbing of the inventory-flow-*.mjs workflow checks (LOCAL STACK ONLY, see README.md). Not a check by itself.
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, newPage, login, BASE, psql } from "./lib.mjs";

export { BASE, psql };
export const DB_NAME = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
export const SHOTS = process.env.SHOTS_DIR ?? new URL("../../../docs/inventory-screenshots", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
export const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
export const PERSONA = { ceo: ["ceo@e2e.local", 3], pol: ["pol.exec@e2e.local", 8], hr1: ["hr1@e2e.local", 1], lead: ["lead@e2e.local", 7], hr: ["hr@e2e.local", 2], mgr: ["mgr@e2e.local", 4], emp: ["emp@e2e.local", 5], admin: ["admin@e2e.local", 6] };

/** Re-seeds the throwaway database (and nothing else) when RESEED=1. The app holds no database state, so it keeps running. */
export function maybeReseed(seed = "inventory.sh") {
  if (process.env.RESEED !== "1") return;
  execSync(new URL(`./seed/${seed}`, import.meta.url).pathname, { stdio: "ignore", env: process.env });
  console.log(`(reseeded with seed/${seed})`);
}

/** Runs SQL as a signed-in person through their real database role (what the app does), for set-up the screens cannot reach and for read-backs
 *  of what that person may see. Returns the last line printed. */
export const asDb = (n, stmt) => execSync(`psql -h 127.0.0.1 -U postgres -d ${DB_NAME} -v ON_ERROR_STOP=1 -Atq`, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${U(n)}","role":"authenticated"}', true);\n${stmt};\ncommit;\n`, stdio: ["pipe", "pipe", "pipe"] }).toString().trim().split("\n").filter(Boolean).pop();
/** Same, but returns the error text instead of throwing (for "the database refuses this"). */
export const asDbTry = (n, stmt) => { try { return { ok: true, out: asDb(n, stmt) }; } catch (e) { return { ok: false, out: String(e.stderr ?? e.message) }; } };
export const sql = psql;
export const sqlRows = (q) => psql(q).split("\n").filter(Boolean);

export function makeRunner(prefix, { shots = SHOTS } = {}) {
  const browser = { b: null };
  const st = { page: null, fails: 0, passes: 0, url: "", failures: [] };
  const R = {
    st,
    async start() { browser.b = await chromium.launch(); },
    async stop() { await st.page?.context().close().catch(() => {}); await browser.b?.close(); },
    /** Sign in as a persona (closing the previous session) and return the page. */
    async as(key, viewport, theme, contextOptions) { if (st.page) await st.page.context().close(); const p = await newPage(browser.b, viewport, theme, contextOptions); await login(p, PERSONA[key][0]); st.page = p; return p; },
    /** A second, independent signed-in browser session (does not replace R.page). Close it with p.context().close(). */
    async extra(key, viewport, theme, contextOptions) { const p = await newPage(browser.b, viewport, theme, contextOptions); await login(p, PERSONA[key][0]); return p; },
    get browser() { return browser.b; },
    get page() { return st.page; },
    dialog: () => st.page.locator("dialog[open]"),
    panel: () => st.page.locator("aside[role=dialog]"),
    async mainText() { return (await st.page.locator("main").innerText()).replace(/\s+/g, " "); },
    async scopeText() {
      const p = st.page;
      for (const sel of ["dialog[open]", "aside[role=dialog]", "main"]) if (await p.locator(sel).count()) return (await p.locator(sel).first().innerText()).replace(/\s+/g, " ");
      return "";
    },
    async go(path) { st.url = path; await st.page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); },
    async seen(re, ms = 15000, scope = "main") { await st.page.waitForFunction(([src, sc]) => new RegExp(src).test((document.querySelector(sc) ?? document.body).innerText), [re.source, scope], { timeout: ms }); },
    async gone(re, ms = 15000, scope = "main") { await st.page.waitForFunction(([src, sc]) => !new RegExp(src).test((document.querySelector(sc) ?? document.body).innerText), [re.source, scope], { timeout: ms }); },
    async expectText(re, scope) { const t = scope ? (await st.page.locator(scope).first().innerText()).replace(/\s+/g, " ") : await R.mainText(); if (!re.test(t)) throw new Error(`expected ${re} on page, got: ${t.slice(0, 300)}`); },
    async expectNoText(re, scope) { const t = scope ? (await st.page.locator(scope).first().innerText()).replace(/\s+/g, " ") : await R.mainText(); if (re.test(t)) throw new Error(`did not expect ${re} on page`); },
    async closedDialog(ms = 15000) { await st.page.waitForFunction(() => !document.querySelector("dialog[open]"), null, { timeout: ms }); },
    async shot(name) { await st.page.screenshot({ path: `${shots}/${name}.png`, fullPage: false }); },
    async step(name, fn) {
      try { await fn(); st.passes++; console.log("PASS", name); }
      catch (e) {
        st.fails++; st.failures.push(name);
        const p = st.page;
        console.log("FAIL", name, "::", String(e.message).split("\n").slice(0, 3).join(" ").slice(0, 600), "| dialog:", p ? (await p.locator("dialog[open]").allInnerTexts().catch(() => [])).join(" ").replace(/\s+/g, " ").slice(0, 400) : "", "| panel:", p ? (await p.locator("aside[role=dialog]").allInnerTexts().catch(() => [])).join(" ").replace(/\s+/g, " ").slice(0, 400) : "", "| main:", p ? (await p.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500) : "");
        await p?.screenshot({ path: `/tmp/${prefix}-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
        if (st.url && p) await p.goto(`${BASE}${st.url}`, { waitUntil: "networkidle" }).catch(() => {});
      }
    },
    check(cond, msg) { if (!cond) throw new Error(msg); },
    eq(actual, expected, what) { const num = (x) => (String(x).trim() !== "" && Number.isFinite(Number(x)) ? Number(x) : null); const same = num(actual) !== null && num(expected) !== null ? num(actual) === num(expected) : String(actual) === String(expected); if (!same) throw new Error(`${what}: expected ${expected}, got ${actual}`); },
    verdict(title) {
      console.log(`\n${title}: ${st.passes} passed, ${st.fails} failed`);
      if (st.fails) console.log("FAILED:", st.failures.join(" | "));
      console.log(st.fails ? "VERDICT: FAIL" : "VERDICT: PASS");
      return st.fails ? 1 : 0;
    },
  };
  return R;
}

/** Waits until fn() is truthy (polling the database, usually). */
export async function until(fn, ms = 15000, what = "") { const t = Date.now(); for (;;) { try { if (fn()) return; } catch {} if (Date.now() - t > ms) throw new Error("condition not reached " + what + fn.toString().slice(0, 120)); await new Promise((r) => setTimeout(r, 300)); } }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------------------------
// Direct calls to the data service (PostgREST) with a person's REAL token, obtained by signing in through the local gateway exactly as the
// app does. This is what a person (or a script) could do without the app: the database must refuse what is not theirs.
// ---------------------------------------------------------------------------------------------------------------------------
export const GATEWAY = "http://127.0.0.1:54321";
const tokenCache = new Map();
export async function tokenFor(key) {
  if (tokenCache.has(key)) return tokenCache.get(key);
  const r = await fetch(`${GATEWAY}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: PERSONA[key][0], password: "local-stack-password" }) });
  const j = await r.json(); if (!j.access_token) throw new Error(`could not sign in ${key}: ${JSON.stringify(j)}`);
  tokenCache.set(key, j.access_token); return j.access_token;
}
/** rest("hr1", "GET", "/inv_units?select=id") -> { status, body } (body parsed when JSON). A signed-out call uses key = null. */
export async function rest(key, method, path, body, headers = {}) {
  const tok = key ? await tokenFor(key) : null;
  const r = await fetch(`${GATEWAY}/rest/v1${path}`, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let parsed = text; try { parsed = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  return { status: r.status, body: parsed };
}
export const rpc = (key, fn, args = {}) => rest(key, "POST", `/rpc/${fn}`, args);
/** The message of a refused call, flattened. */
export const refusal = (r) => (r.status >= 400 ? String(r.body?.message ?? JSON.stringify(r.body)) : "");

// ---------------------------------------------------------------------------------------------------------------------------
// Shared screen helpers (requests, reserve dialog, movement forms) used by the flow-4/5 checks. They drive the real screens.
// ---------------------------------------------------------------------------------------------------------------------------
export const dayAt = (n, hhmm = "08:00") => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) + "T" + hhmm;

/** A project's Equipment page -> "New equipment request" -> Create draft. Returns the new request id. Dates are local time in `tz`. */
export async function newProjectRequestUI(R, projectId, { title, pickup = "Dubai", leaves, back, tz = "Asia/Dubai" }) {
  const before = new Set(sqlRows("select id from inv_requests"));
  await R.go(`/projects/${projectId}/equipment`);
  await R.page.getByRole("button", { name: "New equipment request" }).first().click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel("What is it for", { exact: true }).fill(title);
  await R.dialog().getByLabel("Pickup location (optional)").selectOption({ label: pickup });
  await R.dialog().getByLabel("Leaves the warehouse", { exact: true }).fill(leaves);
  await R.dialog().getByLabel("Due back", { exact: true }).fill(back);
  await R.dialog().locator("summary", { hasText: "Add more details" }).click();
  await R.dialog().getByLabel("Time zone of the dates").fill(tz);
  await R.dialog().getByRole("button", { name: "Create draft" }).click();
  await R.closedDialog();
  await until(() => sqlRows("select id from inv_requests").some((id) => !before.has(id)));
  return sqlRows("select id from inv_requests").find((id) => !before.has(id));
}
/** On a project's Equipment page with ?request= open: add a line for an item (by search text and exact item name). */
export async function addLineUI(R, itemName, search, qty) {
  const reqId = new URL(R.page.url()).searchParams.get("request");
  const count = () => Number(psql(`select count(*) from inv_request_lines where request_id='${reqId}'`));
  const before = count();
  const d = R.page.locator("details:has(> summary:text-is('Add an item'))").first();
  if (!(await d.evaluate((e) => e.open))) await d.locator("summary").first().click();
  const list = d.getByLabel("Matching items");
  for (let attempt = 0; attempt < 4; attempt++) {   // a keystroke that lands before the page is interactive is lost: type it again
    await d.getByLabel("Item", { exact: true }).fill(""); await d.getByLabel("Item", { exact: true }).fill(search);
    if (await list.waitFor({ timeout: 4000 }).then(() => true, () => false)) break;
  }
  await list.waitFor({ timeout: 8000 });
  const labels = await list.locator("option").allTextContents();
  const label = labels.find((l) => l === itemName) ?? labels.find((l) => l.startsWith(itemName + " "));   // "Name · model" when the item has a model
  if (!label) throw new Error(`no matching item "${itemName}" among: ${labels.join(" | ")}`);
  await list.selectOption({ label });
  await d.getByLabel("Quantity", { exact: true }).fill(String(qty));
  await d.getByRole("button", { name: "Add line" }).click();
  await until(() => count() === before + 1, 15000, "line added ");
  await sleep(600);
}
export const submitRequestUI = async (R) => { await R.page.getByRole("button", { name: "Submit to the warehouse" }).click(); };

/** Set-up as a person through the real functions (no screen): a submitted project request with one line. Returns { request, line }. */
export function requestAs(n, projectId, itemId, qty, fromDay, toDay, { title = "set-up request", location = null, tz = "Asia/Dubai", submit = true } = {}) {
  const plan = JSON.stringify({ dispatch: dayAt(fromDay, "08:00").replace("T", " "), return_due: dayAt(toDay, "17:00").replace("T", " ") });
  const req = asDb(n, `select inv_create_request('project', '${projectId}', null, '${title}', '${plan}'::jsonb, '${tz}', null, ${location ? `'${location}'` : "null"}, null)`);
  const line = asDb(n, `select inv_add_request_line('${req}', '${itemId}', ${qty}, null, null)`);
  if (submit) asDb(n, `select inv_submit_request('${req}', null)`);
  return { request: req, line };
}

/** The movement panel (a side panel opened through the address) and its list editor. */
export function movementHelpers(R) {
  const mv = () => R.panel();
  return {
    mv,
    async searchAdd(query, addName, times = 1) {
      const box = mv().getByLabel("Search for an item or unit to add");
      await box.fill(""); await box.fill(query);
      const results = mv().getByRole("list", { name: "Search results" });
      await results.waitFor();
      for (let n = 0; n < times; n++) await results.getByRole("button", { name: addName }).nth(n).click().then(() => sleep(250));
      await box.fill("");
    },
    qtyOf: (label) => mv().getByLabel(`Quantity of ${label}`, { exact: true }),
    async text() { return (await mv().innerText()).replace(/\s+/g, " "); },
    async review() { await mv().getByRole("button", { name: "Review", exact: true }).click(); await mv().getByText("Check before you confirm").waitFor(); },
  };
}
