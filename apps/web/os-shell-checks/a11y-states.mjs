// Keyboard, focus, automated accessibility (axe) and "error is not empty" checks for the simplified Sales and Projects screens
// (LOCAL STACK ONLY; needs the sample scenario, reseed before running). The outage section runs only when OUTAGE_STOP_CMD and
// OUTAGE_START_CMD are set: it stops the data service (PostgREST) while a signed-in page is loaded, then starts it again.
import { createRequire } from "node:module";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";

const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const axeSrc = fs.readFileSync(rootRequire.resolve("axe-core/axe.min.js"), "utf8");
const browser = await chromium.launch();
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); } };
const PRJ = sql("select id from proj_projects where kind='client'");
const OPP = sql("select id from crm_opportunities where title like 'Hotel lobby%'");
const TASK = sql("select id from proj_tasks where title='Sensor calibration'");

const focusInfo = (page) => page.evaluate(() => {
  const el = document.activeElement; if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
  return { tag: el.tagName, name: (el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.getAttribute("title") || "").trim().slice(0, 80), ring: !!ring, inDialog: !!el.closest('[role="dialog"], dialog') };
});
const tabTo = async (page, test, max = 60) => {
  const seen = [];
  for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); const f = await focusInfo(page); if (f) seen.push(f); if (f && test(f)) return { f, seen }; }
  throw new Error(`not reached by Tab in ${max} presses`);
};

// ---- A. keyboard and focus ------------------------------------------------------------------------------------------------------
{
  const page = await newPage(browser); await login(page, "emp@e2e.local");
  await step("Enquiries: Add enquiry is reachable by Tab, every stop on the way shows a focus ring", async () => {
    await page.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" });
    const { seen } = await tabTo(page, (f) => /^Add enquiry$/i.test(f.name));
    const bad = seen.filter((s) => !s.ring); if (bad.length) throw new Error("no visible focus on: " + bad.map((b) => b.name || b.tag).join(", "));
  });
  await step("Enter opens Add enquiry with focus inside; Tab never leaves the dialog; Escape closes it and returns focus to the button", async () => {
    await page.keyboard.press("Enter"); await page.getByRole("dialog", { name: /add an enquiry/i }).waitFor();
    const f0 = await focusInfo(page); if (!f0?.inDialog) throw new Error("focus is not inside the dialog on open");
    for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); const f = await focusInfo(page); if (f && !f.inDialog) throw new Error("focus reached the page behind the dialog at press " + (i + 1) + ": " + f.name); } // null = the browser's own controls, as with any native modal
    await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: /add an enquiry/i }).waitFor({ state: "detached", timeout: 5000 });
    const f1 = await focusInfo(page); if (!/^Add enquiry$/i.test(f1?.name ?? "")) throw new Error("focus did not return to Add enquiry, it is on: " + JSON.stringify(f1));
  });
  await step("A row opens its panel from the keyboard; focus moves into the panel; Escape closes it and focus returns to the row", async () => {
    await page.goto(`${BASE}/sales/opportunities`, { waitUntil: "networkidle" });
    const link = page.locator('main a[href*="open="]').first(); await link.focus(); await page.keyboard.press("Enter");
    await page.waitForURL(/open=/); await page.locator('aside[role="dialog"]').waitFor();
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('aside[role="dialog"]'), null, { timeout: 5000 });
    await page.keyboard.press("Escape"); await page.waitForURL((u) => !u.searchParams.has("open"));
    await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "A" && document.activeElement.getAttribute("href")?.includes("open="), null, { timeout: 5000 });
  });
  await step("The panel heading shows no stray box when it takes focus (it is not a control)", async () => {
    await page.goto(`${BASE}/sales/opportunities?open=${OPP}`, { waitUntil: "networkidle" });
    const style = await page.evaluate(() => { const h = document.activeElement; if (!h || h.tagName !== "H2") return "focus is not on the heading: " + (h && h.tagName); const cs = getComputedStyle(h); return cs.outlineStyle === "none" ? "ok" : "outline " + cs.outlineStyle; });
    if (style !== "ok") throw new Error(style);
  });
  await step("Board: each card's Move to control is reachable by Tab and has a name that says whose card it is", async () => {
    await page.goto(`${BASE}/sales/opportunities?view=board`, { waitUntil: "networkidle" });
    const { f } = await tabTo(page, (x) => x.tag === "SELECT" && /^move .+ to/i.test(x.name), 80);
    const label = await page.evaluate(() => { const s = document.activeElement; return s.getAttribute("aria-label") || (s.labels && s.labels[0]?.innerText) || ""; });
    if (!/^move .+ to/i.test(label)) throw new Error("accessible name too thin: " + JSON.stringify(label));
    if (!f.ring) throw new Error("no visible focus ring on the Move to select");
  });
  await page.context().close();
}
{
  const page = await newPage(browser); await login(page, "hr@e2e.local");
  await step("My Work: the status control of a task is reachable by Tab, named for its task, with a focus ring", async () => {
    await page.goto(`${BASE}/projects/work`, { waitUntil: "networkidle" });
    const { f } = await tabTo(page, (x) => (x.tag === "SELECT" || x.tag === "BUTTON") && /status of/i.test(x.name), 80);
    if (!f.ring) throw new Error("no visible focus ring");
  });
  await page.context().close();
}

// ---- B. automated accessibility (axe) ---------------------------------------------------------------------------------------------
const pages = [
  ["emp@e2e.local", "/sales/follow-ups"], ["emp@e2e.local", "/sales/opportunities"], ["emp@e2e.local", "/sales/opportunities?view=board"],
  ["emp@e2e.local", "/sales/opportunities?add=1"], ["emp@e2e.local", `/sales/opportunities?open=${OPP}`],
  ["mgr@e2e.local", "/projects"], ["mgr@e2e.local", "/projects?view=board"], ["hr@e2e.local", "/projects/work"],
  ["mgr@e2e.local", `/projects/${PRJ}`], ["mgr@e2e.local", `/projects/${PRJ}/work`], ["mgr@e2e.local", `/projects/${PRJ}/work?task=${TASK}`],
  ["mgr@e2e.local", `/projects/${PRJ}/plan`], ["mgr@e2e.local", `/projects/${PRJ}/discussion`],
];
for (const [vp, size] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  for (const theme of ["dark", "light"]) {
    const byUser = new Map();
    for (const [email, path] of pages) { if (!byUser.has(email)) { const page = await newPage(browser, size, theme); await login(page, email); byUser.set(email, page); } }
    await step(`axe (WCAG 2.1 A/AA + best practice) ${vp} ${theme}: no serious or critical findings on ${pages.length} pages`, async () => {
      const problems = [];
      for (const [email, path] of pages) {
        const page = byUser.get(email);
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(200);
        await page.evaluate(axeSrc);
        const res = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }));
        for (const v of res.violations) if (v.impact === "serious" || v.impact === "critical") problems.push(`${path.split("?")[0].replace(PRJ, ":id")} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ")}`);
      }
      if (problems.length) throw new Error(problems.slice(0, 6).join(" | "));
    });
    for (const p of byUser.values()) await p.context().close();
  }
}

// ---- C. an error is never shown as "no records" -----------------------------------------------------------------------------------
await step("A search with no match says there is no match, not that loading failed", async () => {
  const page = await newPage(browser); await login(page, "emp@e2e.local");
  await page.goto(`${BASE}/sales/opportunities?q=zzzznomatch`, { waitUntil: "networkidle" });
  const t = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  if (/Could not load/i.test(t)) throw new Error("shows a load error for an empty search"); if (!/nothing matches|no enquiries/i.test(t)) throw new Error("no empty-state wording: " + t.slice(-240));
  await page.context().close();
});
if (process.env.OUTAGE_STOP_CMD && process.env.OUTAGE_START_CMD) {
  const targets = [["emp@e2e.local", "/sales/opportunities"], ["emp@e2e.local", "/sales/follow-ups"], ["mgr@e2e.local", "/projects"], ["hr@e2e.local", "/projects/work"], ["mgr@e2e.local", `/projects/${PRJ}/work`]];
  const sessions = new Map();
  for (const [email] of targets) if (!sessions.has(email)) { const page = await newPage(browser); await login(page, email); sessions.set(email, page); }
  execSync(process.env.OUTAGE_STOP_CMD);
  try {
    for (const [email, path] of targets) {
      await step(`While the data service is down, ${path.replace(PRJ, ":id")} says it could not load (not an empty list, not a crash)`, async () => {
        const page = sessions.get(email);
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        const body = (await page.locator("body").innerText({ timeout: 20000 })).replace(/\s+/g, " ");
        if (/Application error|Something went wrong|This page couldn.t load/i.test(body) && !/Could not load/.test(body)) throw new Error("generic crash page: " + body.slice(0, 140));
        if (!/Could not load/.test(body)) throw new Error("no 'Could not load' message: " + body.slice(-300));
        if (!/not an empty list/.test(body)) throw new Error("does not say it is not an empty list");
      });
    }
  } finally { execSync(process.env.OUTAGE_START_CMD); }
  for (const p of sessions.values()) await p.context().close();
} else console.log("SKIP outage section (OUTAGE_STOP_CMD / OUTAGE_START_CMD not set)");

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL ACCESSIBILITY AND STATE CHECKS PASSED");
process.exit(fails ? 1 : 0);
