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
    async as(key, viewport) { if (st.page) await st.page.context().close(); const p = await newPage(browser.b, viewport); await login(p, PERSONA[key][0]); st.page = p; return p; },
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
    eq(actual, expected, what) { if (String(actual) !== String(expected)) throw new Error(`${what}: expected ${expected}, got ${actual}`); },
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
