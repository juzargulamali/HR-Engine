// Real-browser check of the collapsed sidebar rail (LOCAL STACK ONLY; see README.md). Seed with `seed/project-plan.sh`, then run against the production build.
// Reproduces and verifies the two defects on a Projects Timeline page: (1) a collapsed rail icon's label is shown in full in a tooltip OUTSIDE the rail (it used to be clipped to "My"),
// and the icons are centred at one size with a usable hit area; (2) a module's flyout renders ABOVE the project header and sticky tabs (it used to sit behind them), stays inside the
// viewport, can be reached with the pointer and the keyboard, closes on Escape and gives focus back. Checked at desktop, a narrow window and phone width, and on two modules.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/rail-shots";
const PHASE = process.env.PHASE ?? "after";
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport) => { if (page) await page.context().close(); page = await newPage(browser, viewport); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/${PHASE}-fail-${name.replace(/\W+/g, "_").slice(0, 40)}.png` }).catch(() => {}); }
};
const PRJ = sql(`select id from proj_projects where name like 'Kids Photobooth%' limit 1`) || sql(`select id from proj_projects order by created_at limit 1`);
const aside = () => page.getByRole("complementary", { name: /modules/ });
const open = async (viewport, collapsed = true) => {
  await as("mgr", viewport);
  await page.goto(`${BASE}/projects/${PRJ}/timeline`, { waitUntil: "networkidle" });
  const w = (await aside().boundingBox())?.width ?? 0;
  if (collapsed && w > 100) { await page.getByRole("button", { name: "Collapse sidebar" }).click(); await page.waitForFunction(() => document.querySelector("aside[aria-label*=modules]").getBoundingClientRect().width <= 73); }
};
/** What is on top at a point: true when that element is inside `sel` (the thing we expect to be seen). */
const topIsInside = (sel, x, y) => page.evaluate(([s, px, py]) => { const el = document.elementFromPoint(px, py); return !!el && !!el.closest(s); }, [sel, x, y]);
const railItems = () => aside().locator("nav a, nav [aria-disabled]");

for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["narrow", { width: 1024, height: 700 }], ["zoomed", { width: 1280, height: 500 }]]) {
  await step(`${label}: every rail icon is centred, one size, with a usable hit area`, async () => {
    await open(viewport);
    const rail = await aside().boundingBox();
    const boxes = await aside().locator("nav a").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); const i = e.querySelector("svg").getBoundingClientRect(); return { w: r.width, h: r.height, icon: i.width, cx: i.x + i.width / 2, link: r.x + r.width / 2 }; }));
    if (boxes.length < 4) throw new Error(`only ${boxes.length} rail links`);
    for (const b of boxes) {
      if (b.w < 40 || b.h < 40) throw new Error(`hit area ${Math.round(b.w)}x${Math.round(b.h)} is under 40px`);
      if (Math.abs(b.cx - (rail.x + rail.width / 2)) > 2) throw new Error(`an icon is ${Math.round(b.cx - (rail.x + rail.width / 2))}px off the rail centre`);
      if (Math.abs(b.icon - boxes[0].icon) > 0.5) throw new Error("icon sizes differ");
    }
    await page.screenshot({ path: `${SHOTS}/${PHASE}-rail-${label}.png` });
  });
  await step(`${label}: hovering an icon shows its whole label outside the rail; focus does too; the icon has a name`, async () => {
    await open(viewport);
    const first = aside().locator("nav a").first();
    const name = await first.getAttribute("aria-label") ?? (await first.innerText()).trim();
    if (!/my day/i.test(name)) throw new Error(`the first icon is named "${name}"`);
    await first.hover();
    const tip = page.getByRole("tooltip").filter({ hasText: /My Day/ }).first();
    await tip.waitFor({ timeout: 3000 });
    const tb = await tip.boundingBox(), rail = await aside().boundingBox();
    if (tb.x < rail.x + rail.width - 1) throw new Error(`the tooltip starts inside the rail (${Math.round(tb.x)} < ${Math.round(rail.x + rail.width)})`);
    const txt = (await tip.innerText()).trim(); if (txt !== "My Day") throw new Error(`the tooltip says "${txt}"`);
    await page.evaluate(() => { document.querySelector('[role="tooltip"]').style.pointerEvents = "auto"; });          // it ignores the pointer; let it be hit-tested to prove nothing covers it
    if (!(await topIsInside('[role="tooltip"]', tb.x + tb.width - 4, tb.y + tb.height / 2))) throw new Error("the tooltip's end is covered by something");
    if (tb.x + tb.width > page.viewportSize().width) throw new Error("the tooltip leaves the viewport");
    await page.screenshot({ path: `${SHOTS}/${PHASE}-tooltip-${label}.png` });
    await page.mouse.move(700, 600); await page.getByRole("tooltip").first().waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await first.focus(); await page.keyboard.press("Shift+Tab"); await first.focus();
    await page.getByRole("tooltip").filter({ hasText: /My Day/ }).first().waitFor({ timeout: 3000 });
  });
  await step(`${label}: the Sales & CRM flyout is above the project header and tabs, inside the viewport, and reachable by pointer`, async () => {
    await open(viewport);
    const sales = aside().getByRole("link", { name: /Sales/ });
    await sales.hover();
    const fly = page.getByTestId("rail-flyout-sales");
    await fly.waitFor({ timeout: 3000 });
    const fb = await fly.boundingBox(); const vp = page.viewportSize();
    if (fb.x + fb.width > vp.width + 1 || fb.y < -1 || fb.y + fb.height > vp.height + 1) throw new Error(`the flyout leaves the viewport: ${JSON.stringify(fb)}`);
    const links = await fly.getByRole("link").elementHandles();
    for (const h of links) { const b = await h.boundingBox(); if (!(await topIsInside('[data-testid^="rail-flyout-"]', b.x + b.width / 2, b.y + b.height / 2))) throw new Error(`part of the flyout is covered at ${Math.round(b.x)},${Math.round(b.y)}`); }
    for (const [x, y] of [[fb.x + fb.width - 6, fb.y + 6], [fb.x + 8, fb.y + fb.height - 6], [fb.x + fb.width / 2, fb.y + fb.height / 2]]) if (!(await topIsInside('[data-testid^="rail-flyout-"]', x, y))) throw new Error(`the flyout corner at ${Math.round(x)},${Math.round(y)} is covered`);
    await page.screenshot({ path: `${SHOTS}/${PHASE}-flyout-${label}.png` });
    // the pointer can travel from the icon into the menu without it closing
    const ib = await sales.boundingBox(); await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.mouse.move(fb.x + 20, fb.y + 20, { steps: 8 }); await page.waitForTimeout(400);
    if (!(await fly.isVisible())) throw new Error("the flyout closed while the pointer moved into it");
    await fly.getByRole("link").nth(1).hover(); if (!(await fly.isVisible())) throw new Error("the flyout closed over its own link");
  });
}

await step("keyboard: ArrowRight/Enter opens the pages, arrows move, Escape closes and gives focus back to the icon", async () => {
  await open({ width: 1280, height: 900 });
  const sales = aside().getByRole("link", { name: /Sales/ });
  await sales.focus();
  const fly = page.getByTestId("rail-flyout-sales"); await fly.waitFor({ timeout: 3000 });
  await page.keyboard.press("ArrowRight");
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid^="rail-flyout-"]'));
  await page.waitForFunction(() => !!document.activeElement?.closest('[data-testid^="rail-flyout-"]'), null, { timeout: 2000 }).catch(() => {});
  if (!(await inside())) throw new Error("ArrowRight did not move focus into the flyout");
  const a = await page.evaluate(() => document.activeElement.textContent); await page.keyboard.press("ArrowDown");
  const b = await page.evaluate(() => document.activeElement.textContent); if (a === b) throw new Error("ArrowDown did not move");
  await page.keyboard.press("ArrowUp"); if ((await page.evaluate(() => document.activeElement.textContent)) !== a) throw new Error("ArrowUp did not go back");
  await page.keyboard.press("Escape"); await fly.waitFor({ state: "detached", timeout: 3000 });
  if (!(await page.evaluate(() => document.activeElement?.getAttribute("href") === document.querySelector("aside a[href*='sales' i], aside a[aria-label*='Sales']")?.getAttribute("href")))) throw new Error("focus did not return to the Sales icon");
});

await step("shared shell: another module's flyout (Projects & Tasks) is also above the project header; expanded mode keeps normal labels and sub-links", async () => {
  await open({ width: 1280, height: 900 });
  const proj = aside().getByRole("link", { name: /Projects/ }); await proj.hover();
  const fly = page.getByTestId("rail-flyout-projects"); await fly.waitFor({ timeout: 3000 });
  const fb = await fly.boundingBox();
  if (!(await topIsInside('[data-testid^="rail-flyout-"]', fb.x + fb.width / 2, fb.y + fb.height / 2))) throw new Error("covered");
  await page.screenshot({ path: `${SHOTS}/${PHASE}-flyout-projects.png` });
  await page.getByRole("button", { name: "Expand sidebar" }).click(); await page.waitForFunction(() => document.querySelector("aside[aria-label*=modules]").getBoundingClientRect().width > 200);
  const t = await aside().innerText(); if (!/My Day/.test(t) || !/Sales & CRM/.test(t)) throw new Error(`expanded labels: ${t.slice(0, 80)}`);
  if (!(await aside().getByRole("link", { name: "Project Plan" }).count()) && !(await aside().getByRole("link", { name: /Projects$/ }).count())) throw new Error("no sub-links in expanded mode");
});

await step("phone: the drawer still opens and the rail is not drawn", async () => {
  await as("mgr", { width: 390, height: 844 }); await page.goto(`${BASE}/projects/${PRJ}/timeline`, { waitUntil: "networkidle" });
  if (await aside().isVisible()) throw new Error("the desktop rail shows on a phone");
  await page.getByRole("button", { name: /menu/i }).first().click(); await page.waitForTimeout(400);
  const dlg = page.getByRole("dialog"); if (!(await dlg.count())) throw new Error("no drawer");
  await page.screenshot({ path: `${SHOTS}/${PHASE}-drawer-phone.png` });
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
