// A small navigation smoke check for the shared shell (LOCAL STACK ONLY). After a change to the sidebar, top bar or bottom bar this proves that
// every module is still reachable by clicking, and that every link the shell offers lands on a page that renders (no error page, no page error,
// no sideways scroll). It reads, never writes. Usage: node os-shell-checks/nav-smoke.mjs   (against the seeded local app)
import { chromium, newPage, login, BASE } from "./lib.mjs";
const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
// Clicks navigate on the client: wait for the address to reach the module (up to 10 s) instead of reading it at once.
const arrived = (page, re) => page.waitForURL((u) => re.test(u.pathname), { timeout: 10000 }).then(() => true, () => false);
const landed = async (page) => { await page.locator("main h1, main h2").first().waitFor({ timeout: 10000 }).catch(() => {}); return (await page.locator("main h1, main h2").count()) > 0 && !/Application error/i.test(await page.locator("body").innerText()); };
const SIDE = "aside[aria-label='ENGINIOUS OS modules']";
const MODULES = [["Sales & CRM", /^\/sales/], ["People & HR", /^\/(employees|leave|attendance|payroll|recovery|performance|hr)/], ["Inventory", /^\/inventory/], ["Projects & Tasks", /^\/projects/]];

async function renders(page, path, label) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  const errs = page.errors.splice(0).filter((e) => !/favicon|Failed to load resource.*(404|401)/.test(e));
  const text = await page.locator("body").innerText();
  const broken = /Application error|This page couldn.t load|Something went wrong/i.test(text) || (res?.status() ?? 200) >= 500;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const heading = (await page.locator("main h1, main h2").count()) > 0;
  ok(!broken && errs.length === 0 && !overflow && heading, `${label}: ${path} renders${broken ? " (ERROR PAGE)" : ""}${errs.length ? ` (${errs[0].slice(0, 120)})` : ""}${overflow ? " (sideways scroll)" : ""}${heading ? "" : " (no heading)"}`);
}

// ---- desktop: the founder sees every module; an employee sees what they are given; both can click into each one the shell shows
for (const [who, email] of [["founder", "ceo@e2e.local"], ["employee", "emp@e2e.local"], ["manager", "mgr@e2e.local"]]) {
  console.log(`\n=== ${who} (${email}) desktop`);
  const page = await newPage(browser, { width: 1440, height: 900 }); await login(page, email);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const offered = [];
  for (const [name, re] of MODULES) {
    const link = page.locator(`${SIDE} a, ${SIDE} button`).filter({ hasText: new RegExp(`^${name.replace("&", "\\&")}`) }).first();
    if ((await link.count()) === 0) { console.log(`  (${who}: ${name} not in the menu)`); continue; }
    offered.push(name);
    await link.click();
    // A module with sub-pages may only expand on the first click: then follow its first sub-link.
    if (!(await arrived(page, re))) { const sub = page.locator(`${SIDE} a.os-nav-sub`).first(); if ((await sub.count()) > 0) await sub.click(); await arrived(page, re); }
    ok(re.test(new URL(page.url()).pathname), `${who}: clicking ${name} opens ${new URL(page.url()).pathname}`);
    ok(await landed(page), `${who}: ${name} landing page renders`);
  }
  if (who === "founder") for (const need of MODULES.map((m) => m[0])) ok(offered.includes(need), `founder is offered ${need}`);
  // every link in the shell, with every module expanded
  const hrefs = new Set();
  for (const start of ["/sales", "/employees", "/inventory", "/projects"]) {
    await page.goto(`${BASE}${start}`, { waitUntil: "networkidle" });
    for (const h of await page.locator(`${SIDE} a[href]`).evaluateAll((as) => as.map((a) => a.getAttribute("href")))) if (h && h.startsWith("/")) hrefs.add(h);
  }
  console.log(`  ${hrefs.size} distinct shell links`);
  for (const h of [...hrefs].sort()) await renders(page, h, who);
  await page.context().close();
}

// ---- phone: the bottom bar and its More menu reach the same modules
console.log("\n=== founder phone (390x844)");
{
  const page = await newPage(browser, { width: 390, height: 844 }); await login(page, "ceo@e2e.local");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const bar = page.locator("nav[aria-label='Primary']");
  for (const [tab, re] of [["Sales", /^\/sales/], ["People", /^\/(employees|leave|attendance|payroll|recovery|performance|hr)/]]) {
    const t = bar.locator("a, button").filter({ hasText: new RegExp(`^${tab}$`) }).first();
    if ((await t.count()) === 0) { ok(false, `phone bottom bar lacks ${tab}`); continue; }
    await t.click(); const there = await arrived(page, re);
    ok(there && (await landed(page)), `phone: ${tab} tab opens ${new URL(page.url()).pathname}`);
  }
  await bar.locator("a, button").filter({ hasText: /^More$/ }).first().click();
  const more = await page.locator("[role=dialog] a, [role=menu] a, aside a").evaluateAll((as) => as.filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.textContent.trim()));
  console.log(`  More lists: ${more.join(" | ")}`);
  ok(more.some((x) => /Inventory/.test(x)) && more.some((x) => /Projects/.test(x)), "phone More menu offers Inventory and Projects");
  for (const p of ["/inventory", "/projects", "/employees", "/sales"]) await renders(page, p, "phone");
  await page.context().close();
}

await browser.close();
console.log(fails === 0 ? "\nNAVIGATION SMOKE CHECK PASSED" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
