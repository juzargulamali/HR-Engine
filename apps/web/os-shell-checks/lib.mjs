// Shared helpers for the ENGINIOUS OS shell checks. LOCAL STACK ONLY (see README): never point these at a hosted database.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(new URL("../../../packages/e2e-tests/package.json", import.meta.url));
import { existsSync } from "node:fs";
const playwright = require("@playwright/test");
// Uses the sandbox image's own Chromium when it is there (CHROMIUM_PATH overrides), so a newer Playwright does not need its own download.
const SYSTEM_CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
export const chromium = { launch: (options = {}) => playwright.chromium.launch({ ...(SYSTEM_CHROMIUM ? { executablePath: SYSTEM_CHROMIUM, args: ["--no-sandbox"] } : {}), ...options }) };
export const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing to run against ${BASE}: these checks write to the app they drive and are for the local stack only`);
export const PASSWORD = "local-stack-password";
const DB = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
export const psql = (q) => execSync(`psql -h 127.0.0.1 -U postgres -d ${DB} -Atc "${q}"`, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" } }).toString().trim();
export async function newPage(browser, viewport = { width: 1280, height: 900 }, theme = "dark", contextOptions = {}) {
  const ctx = await browser.newContext({ viewport, ...contextOptions });
  await ctx.addInitScript((t) => { try { if (!localStorage.getItem("theme")) localStorage.setItem("theme", t); } catch {} }, theme);
  const page = await ctx.newPage(); page.errors = [];
  page.on("pageerror", (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(`console: ${m.text()}`); });
  return page;
}
export async function login(page, email) {
  await page.goto(`${BASE}/login`); await page.getByLabel(/email/i).fill(email); await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click(); await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
}

// A value that is changed through a <select> (older screens) or through the ENGINIOUS OS choice menu (a button that opens a list of choices).
const isMenuButton = (sel) => sel.evaluate((e) => e.tagName === "BUTTON");
const menuLabels = async (menu) => menu.locator("[role=menuitem]").evaluateAll((items) => items.map((i) => (i.querySelector("span.truncate") ?? i).textContent.replace(/\s+/g, " ").trim()));
/** The choices a control offers. */
export async function optionTexts(sel) {
  if (!(await isMenuButton(sel))) return sel.locator("option").allInnerTexts();
  await sel.click(); const menu = sel.locator("xpath=..").locator("[role=menu]"); await menu.waitFor();
  const labels = await menuLabels(menu); await sel.page().keyboard.press("Escape"); return labels;
}
/** Picks the first choice whose words match `re`; returns its words. */
export async function choose(sel, re) {
  if (!(await isMenuButton(sel))) {
    const opts = await sel.locator("option").allInnerTexts(); const o = opts.find((x) => re.test(x));
    if (!o) throw new Error(`no option ${re} among: ${opts.join(" | ")}`);
    await sel.selectOption({ label: o }); return o;
  }
  await sel.click(); const menu = sel.locator("xpath=..").locator("[role=menu]"); await menu.waitFor();
  const labels = await menuLabels(menu); const i = labels.findIndex((x) => re.test(x));
  if (i < 0) { await sel.page().keyboard.press("Escape"); throw new Error(`no choice ${re} among: ${labels.join(" | ")}`); }
  await menu.locator("[role=menuitem]").nth(i).click(); return labels[i];
}
