// Keyboard, focus, automated accessibility (axe) and "an error is not an empty list" for the Inventory screens
// (LOCAL STACK ONLY; needs seed/inventory.sh). In the style of a11y-states.mjs.
//   A. keyboard: Tab reaches Add item / Receive stock / a row, every stop shows a focus ring, dialog and panel focus and Escape return,
//      the Dispatch form is operable from the keyboard alone up to its review step
//   B. axe (WCAG 2.1 A/AA + best practice, serious and critical) on every Inventory page, desktop and phone, dark and light, as a person who sees it
//   C. outage: PostgREST is stopped while pages load; every Inventory page must say "Could not load", never "no items" or "no access".
//      PostgREST is started again afterwards with the same settings as local-stack/start.sh and its pid file is rewritten, so a later reset works.
// It adds one submitted project request through the real functions if the seed has none (the request panel needs one).
import { createRequire } from "node:module";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb, requestAs, U } from "./inventory-flow-lib.mjs";

const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const axeSrc = fs.readFileSync(rootRequire.resolve("axe-core/axe.min.js"), "utf8");
const browser = await chromium.launch();
let fails = 0, passes = 0;
const step = async (name, fn) => { try { await fn(); passes++; console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0].slice(0, 500)); } };
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const ITEM = s1("select id from inv_items where name='Laptop 14 inch'");
const UNIT = s1("select id from inv_units order by code limit 1");
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
const OPP = s1("select id from crm_opportunities limit 1");
let REQ = s1("select id from inv_requests order by code limit 1");
if (!REQ) REQ = requestAs(4, PRJ, ITEM, 1, 5, 9, { title: "a11y request" }).request;

const focusInfo = (page) => page.evaluate(() => {
  const el = document.activeElement; if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
  return { tag: el.tagName, name: (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.getAttribute("title") || el.getAttribute("href") || "").trim().slice(0, 80), ring: !!ring, inDialog: !!el.closest('[role="dialog"], dialog') };
});
const tabTo = async (page, test, max = 80) => {
  const seen = [];
  for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); const f = await focusInfo(page); if (f) seen.push(f); if (f && test(f)) return { f, seen }; }
  throw new Error(`not reached by Tab in ${max} presses (last: ${seen.slice(-3).map((s) => s.name || s.tag).join(" > ")})`);
};

// ---- A. keyboard and focus -------------------------------------------------------------------------------------------------------
{
  const page = await newPage(browser); await login(page, "ceo@e2e.local");
  await step("Inventory: Add item is reachable by Tab and every stop on the way shows a focus ring", async () => {
    await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
    const { seen } = await tabTo(page, (f) => /^Add item$/i.test(f.name));
    const bad = seen.filter((s) => !s.ring); if (bad.length) throw new Error("no visible focus on: " + bad.map((b) => b.name || b.tag).join(", "));
  });
  await step("Enter opens Add item with focus inside; Tab never leaves the dialog; Escape closes it and focus returns to the Add item button", async () => {
    await page.keyboard.press("Enter"); await page.locator("dialog[open]").waitFor();
    const f0 = await focusInfo(page); if (!f0?.inDialog) throw new Error("focus is not inside the dialog on open: " + JSON.stringify(f0));
    for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); const f = await focusInfo(page); if (f && !f.inDialog) throw new Error("focus reached the page behind the dialog at press " + (i + 1) + ": " + f.name); }
    await page.keyboard.press("Escape"); await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 5000 });
    const f1 = await focusInfo(page); if (!/^Add item$/i.test(f1?.name ?? "")) throw new Error("focus did not return to Add item, it is on: " + JSON.stringify(f1));
  });
  await step("Receive stock: reachable by Tab, Enter opens the side panel with focus inside it, Escape closes it and focus returns to Receive stock", async () => {
    await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
    const { f } = await tabTo(page, (x) => /^Receive stock$/i.test(x.name));
    if (!f.ring) throw new Error("no focus ring on Receive stock");
    await page.keyboard.press("Enter"); await page.waitForURL(/action=receive/); await page.locator("aside[role=dialog]").waitFor();
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('aside[role="dialog"]'), null, { timeout: 5000 });
    await page.keyboard.press("Escape"); await page.waitForURL((u) => !u.searchParams.has("action"), { timeout: 5000 });
    await page.waitForFunction(() => /^Receive stock$/i.test((document.activeElement?.innerText ?? "").trim()), null, { timeout: 5000 });
  });
  await step("A stock row opens its item panel from the keyboard, focus moves into the panel, Escape closes it and focus returns to the row link", async () => {
    await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
    const link = page.locator('main a[href*="open="]').first(); await link.focus(); await page.keyboard.press("Enter");
    await page.waitForURL(/open=/); await page.locator('aside[role="dialog"]').waitFor();
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('aside[role="dialog"]'), null, { timeout: 5000 });
    await page.keyboard.press("Escape"); await page.waitForURL((u) => !u.searchParams.has("open"));
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "A" && document.activeElement.getAttribute("href")?.includes("open="), null, { timeout: 5000 });
  });
  await step("A unit panel: the panel heading shows no stray box when it takes focus", async () => {
    await page.goto(`${BASE}/inventory?unit=${UNIT}`, { waitUntil: "networkidle" });
    const style = await page.evaluate(() => { const h = document.activeElement; if (!h || h.tagName !== "H2") return "focus is not on the heading: " + (h && h.tagName); const cs = getComputedStyle(h); return cs.outlineStyle === "none" ? "ok" : "outline " + cs.outlineStyle; });
    if (style !== "ok") throw new Error(style);
  });
  await step("Dispatch form, keyboard only: choose the project with the arrow keys, type a search, add a result with Enter, type a quantity, reach Review and open the review step (nothing is recorded)", async () => {
    const before = s1("select count(*) from inv_movements");
    await page.goto(`${BASE}/inventory?action=dispatch`, { waitUntil: "networkidle" });
    const panel = page.locator("aside[role=dialog]"); await panel.waitFor();
    // location (first select), then project: reach each select by Tab and pick with the keyboard
    const sel = await tabTo(page, (f) => f.tag === "SELECT" && /Take from/i.test(f.name));
    if (!sel.f.ring) throw new Error("no focus ring on the location select");
    await page.keyboard.press("ArrowDown");
    await tabTo(page, (f) => f.tag === "SELECT" && /project/i.test(f.name)); if (!(await focusInfo(page))?.ring) throw new Error("no focus ring on the project select");
    await page.keyboard.press("ArrowDown");
    await tabTo(page, (f) => f.tag === "INPUT" && /Search for an item or unit/i.test(f.name));
    await page.keyboard.type("HDMI");
    await panel.getByRole("list", { name: "Search results" }).waitFor();
    await tabTo(page, (f) => f.tag === "BUTTON" && /^Add HDMI/i.test(f.name), 10);
    await page.keyboard.press("Enter");
    await tabTo(page, (f) => f.tag === "INPUT" && /^Quantity of HDMI/i.test(f.name), 15);
    if (!(await focusInfo(page))?.ring) throw new Error("no focus ring on the quantity box");
    await page.keyboard.type("1");
    await tabTo(page, (f) => f.tag === "BUTTON" && /^Review$/i.test(f.name), 40);
    if (!(await focusInfo(page))?.ring) throw new Error("no focus ring on Review");
    await page.keyboard.press("Enter");
    await panel.getByText("Check before you confirm").waitFor({ timeout: 8000 });
    if (s1("select count(*) from inv_movements") !== before) throw new Error("a movement was recorded without confirmation");
  });
  await page.context().close();
}

// ---- B. axe ------------------------------------------------------------------------------------------------------------------------
const pages = [
  ["ceo@e2e.local", "/inventory"], ["ceo@e2e.local", `/inventory?open=${ITEM}`], ["ceo@e2e.local", `/inventory?unit=${UNIT}`], ["ceo@e2e.local", "/inventory?action=receive"],
  ["ceo@e2e.local", "/inventory?action=issue"], ["ceo@e2e.local", "/inventory?action=dispatch"], ["ceo@e2e.local", "/inventory?action=return"], ["ceo@e2e.local", "/inventory?action=transfer"],
  ["ceo@e2e.local", "/inventory?action=scan"], ["ceo@e2e.local", "/inventory/requests"], ["ceo@e2e.local", `/inventory/requests?open=${REQ}`], ["ceo@e2e.local", "/inventory/movements"],
  ["ceo@e2e.local", "/inventory/manage"], ["ceo@e2e.local", "/inventory/access"], ["ceo@e2e.local", "/inventory/scan"], ["ceo@e2e.local", `/inventory/labels?item=${ITEM}`],
  ["emp@e2e.local", "/inventory/mine"], ["hr@e2e.local", "/inventory/employees"], ["mgr@e2e.local", `/projects/${PRJ}/equipment`], ["mgr@e2e.local", `/projects/${PRJ}/equipment?request=${REQ}`],
  ["emp@e2e.local", `/sales/opportunities?open=${OPP}`], ["admin@e2e.local", "/inventory"],
];
for (const [vp, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  for (const theme of ["dark", "light"]) {
    const byUser = new Map();
    for (const [email] of pages) if (!byUser.has(email)) { const page = await newPage(browser, size, theme); await login(page, email); byUser.set(email, page); }
    await step(`axe (WCAG 2.1 A/AA + best practice) ${vp} ${theme}: no serious or critical findings on ${pages.length} Inventory pages`, async () => {
      const problems = [];
      for (const [email, path] of pages) {
        const page = byUser.get(email);
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(250);
        await page.evaluate(axeSrc);
        const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
        for (const v of res.violations) if (v.impact === "serious" || v.impact === "critical") problems.push(`${email.split("@")[0]} ${path.split("?")[0].replace(PRJ, ":id")}${/\?/.test(path) ? "?" + path.split("?")[1].replace(/=[0-9a-f-]{36}/g, "=id") : ""} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ").slice(0, 90)}`);
      }
      if (problems.length) throw new Error(`${problems.length} findings: ` + problems.slice(0, 8).join(" | "));
    });
    for (const p of byUser.values()) await p.context().close();
  }
}

// ---- C. outage -------------------------------------------------------------------------------------------------------------------
const LOGDIR = process.env.LOCAL_STACK_LOG_DIR ?? "/tmp/inv-stack";
const DB = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
const stopData = () => execSync(`kill $(cat ${LOGDIR}/postgrest.pid) 2>/dev/null || true; sleep 1`, { shell: "/bin/bash" });
const startData = () => execSync(
  `PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:5432/${DB}" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="\${LOCAL_JWT_SECRET:-local-stack-only-secret-0123456789abcdef}" PGRST_SERVER_PORT=3001 PGRST_SERVER_HOST=127.0.0.1 ` +
  `nohup "\${POSTGREST_BIN:-/home/user/tools/postgrest}" >"${LOGDIR}/postgrest.log" 2>&1 & echo $! > "${LOGDIR}/postgrest.pid"; sleep 2`, { shell: "/bin/bash", stdio: "ignore" });
{
  const targets = [["ceo@e2e.local", "/inventory"], ["ceo@e2e.local", `/inventory?open=${ITEM}`], ["ceo@e2e.local", "/inventory/requests"], ["ceo@e2e.local", "/inventory/movements"], ["ceo@e2e.local", "/inventory/manage"],
    ["ceo@e2e.local", "/inventory/access"], ["hr@e2e.local", "/inventory/employees"], ["emp@e2e.local", "/inventory/mine"], ["mgr@e2e.local", `/projects/${PRJ}/equipment`], ["emp@e2e.local", `/sales/opportunities?open=${OPP}`]];
  const sessions = new Map();
  for (const [email] of targets) if (!sessions.has(email)) { const page = await newPage(browser); await login(page, email); sessions.set(email, page); }
  stopData();
  try {
    for (const [email, path] of targets) {
      await step(`While the data service is down, ${path.replace(PRJ, ":id").replace(/=[0-9a-f-]{36}/g, "=id")} (${email.split("@")[0]}) says it could not load: not "no items", not "no access", not a crash`, async () => {
        const page = sessions.get(email);
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(1500);
        const body = (await page.locator("body").innerText({ timeout: 20000 })).replace(/\s+/g, " ");
        if (/Application error|Something went wrong|This page couldn.t load/i.test(body) && !/Could not load/i.test(body)) throw new Error("generic crash page: " + body.slice(0, 140));
        if (!/Could not load/i.test(body)) throw new Error("no 'Could not load' message: " + body.replace(/^.*?Inventory/, "Inventory").slice(0, 260));
        if (/No items|no equipment|Nothing matches|Only a founder|do not have access|not have access|ask a founder|Inventory is not installed/i.test(body.replace(/This is a problem loading the information, not an empty list\./, ""))) throw new Error("an outage looks like an empty list or a missing right: " + body.slice(0, 260));
      });
    }
  } finally { startData(); }
  for (const p of sessions.values()) await p.context().close();
  await step("The data service is back with a live pid file: pages load again and a later reset can stop it", async () => {
    const pid = fs.readFileSync(`${LOGDIR}/postgrest.pid`, "utf8").trim();
    if (!/^\d+$/.test(pid)) throw new Error("pid file: " + pid);
    execSync(`kill -0 ${pid}`);
    const page = await newPage(browser); await login(page, "ceo@e2e.local");
    await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
    const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    if (/Could not load/.test(t) || !/Laptop 14 inch/.test(t)) throw new Error("not back: " + t.slice(0, 200));
    await page.context().close();
  });
}

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
console.log(fails ? "VERDICT: FAIL" : "VERDICT: PASS");
process.exit(fails ? 1 : 0);
