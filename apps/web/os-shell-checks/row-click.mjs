// Real-browser check of "click a row to open it" in Projects (LOCAL STACK ONLY; needs the sample scenario, reseed before each run; it changes one
// task's status through the real control). Covers: project rows and task rows (table, phone cards, board cards) open from their empty part;
// controls inside a row (status, assignee, due-date button, menu, dialog) do only their own job; the title stays a real link (keyboard and
// new tab); a modified click opens a new tab; a click that ends a text selection opens nothing; the hover and selected looks differ.
import { chromium, newPage, login, BASE, psql, choose } from "./lib.mjs";
const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const P = psql("select id from proj_projects where kind='client' limit 1");
const q = (page, k) => new URL(page.url()).searchParams.get(k);
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});
const edge = { position: { x: 3, y: 3 } }; // the top-left corner of a cell: padding, never a control

async function desktop() {
  const page = await newPage(browser, { width: 1440, height: 900 }); await login(page, "mgr@e2e.local");

  // ---- project rows
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  const prow = page.locator("main tbody tr[data-clickable]", { hasText: "Floor projection delivery" }).first();
  ok((await prow.count()) === 1, "project row is a clickable row");
  await prow.locator("td").nth(2).click(edge); await page.waitForURL(new RegExp(`/projects/${P}`), { timeout: 10000 }).catch(() => {});
  ok(new URL(page.url()).pathname.startsWith(`/projects/${P}`), `clicking the empty part of a project row opens the project (${new URL(page.url()).pathname})`);
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  const link = page.locator("main tbody tr", { hasText: "Floor projection delivery" }).first().getByRole("link", { name: "Floor projection delivery" });
  ok(((await link.getAttribute("href")) ?? "").startsWith(`/projects/${P}`), "the project title is still a real link");
  await link.focus(); await page.keyboard.press("Enter"); await page.waitForURL(new RegExp(`/projects/${P}`), { timeout: 10000 }).catch(() => {});
  ok(new URL(page.url()).pathname.startsWith(`/projects/${P}`), "keyboard: Enter on the title link opens the project");
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  const [tab] = await Promise.all([page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null), page.locator("main tbody tr[data-clickable]", { hasText: "Floor projection delivery" }).first().locator("td").nth(2).click({ ...edge, modifiers: ["Control"] })]);
  ok(!!tab, "Ctrl-click on the row opens the project in a new tab"); if (tab) await tab.close();

  // ---- task rows
  await page.goto(`${BASE}/projects/${P}/work?tasks=all`, { waitUntil: "networkidle" });
  const row = (t) => page.locator("main tbody tr[data-clickable]", { hasText: t }).first();
  const panel = page.locator("aside[role=dialog]");
  ok((await row("Sensor calibration").count()) === 1, "task row is a clickable row");

  // hover looks different
  const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  const rest = await bg(row("Sensor calibration")); await row("Sensor calibration").hover({ position: { x: 5, y: 5 } }); await page.waitForTimeout(250);
  const hover = await bg(row("Sensor calibration")); ok(rest !== hover, `hover changes the row background (${rest} -> ${hover})`);
  ok((await row("Sensor calibration").evaluate((e) => getComputedStyle(e).cursor)) === "pointer", "a clickable row shows the pointer");

  // empty part opens the panel
  await row("Sensor calibration").locator("td").nth(3).click(edge); await panel.waitFor({ timeout: 10000 }).catch(() => {});
  ok((await panel.count()) === 1 && !!q(page, "task"), "clicking the empty part of a task row opens its panel");
  ok((await row("Sensor calibration").getAttribute("data-selected")) === "true", "the open task's row is marked selected");
  const sel = await bg(row("Sensor calibration")); ok(sel !== rest && sel !== hover, "selected, hover and resting rows look different");
  await page.goto(`${BASE}/projects/${P}/work?tasks=all`, { waitUntil: "networkidle" });

  // controls do only their own job
  const statusBtn = row("Sensor calibration").getByRole("button", { name: /^Status of Sensor calibration/ });
  await statusBtn.click(); await page.waitForTimeout(400);
  ok(!q(page, "task") && (await panel.count()) === 0, "opening the status menu does not open the task");
  ok((await statusBtn.getAttribute("aria-expanded")) === "true", "the status menu opened");
  await statusBtn.locator("xpath=..").locator("[role=menu] li").first().click(); await page.waitForTimeout(300); // the menu's own title line: not an item
  ok(!q(page, "task"), "a click inside the menu (outside its items) does not open the task");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  if ((await statusBtn.getAttribute("aria-expanded")) === "true") await statusBtn.click();
  await page.waitForTimeout(300);
  const picked = await choose(statusBtn, /^Start/); await page.waitForTimeout(1200);
  ok(!q(page, "task") && (await panel.count()) === 0, `choosing "${picked}" changes the status only, without opening the task`);
  ok(psql("select status from proj_tasks where title='Sensor calibration'") === "in_progress", "the status really changed (through the real action)");
  const assignee = row("Write the operator guide").getByRole("button", { name: /^Assignee of/ });
  if ((await assignee.count()) === 1) { await assignee.click(); await page.waitForTimeout(300); ok(!q(page, "task"), "opening the assignee menu does not open the task"); await page.keyboard.press("Escape"); }
  const dueBtn = row("Write the operator guide").getByRole("button", { name: /Change due date of/ });
  await dueBtn.click(); await page.waitForTimeout(400);
  ok((await page.locator("dialog[open]").count()) === 1 && !q(page, "task"), "the due-date button opens its own dialog, not the task");
  await page.locator("dialog[open]").getByRole("textbox").first().click().catch(() => {}); await page.waitForTimeout(200);
  ok(!q(page, "task"), "clicking inside the dialog does not open the task behind it");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  // keyboard and new tab keep working through the title link
  const title = row("Write the operator guide").getByRole("link", { name: "Write the operator guide" });
  await title.focus(); await page.keyboard.press("Enter"); await panel.waitFor({ timeout: 10000 }).catch(() => {});
  ok((await panel.count()) === 1, "keyboard: Enter on the task title opens its panel");
  await page.goto(`${BASE}/projects/${P}/work?tasks=all`, { waitUntil: "networkidle" });
  const [tab2] = await Promise.all([page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null), row("Write the operator guide").locator("td").nth(3).click({ ...edge, modifiers: ["Control"] })]);
  ok(!!tab2 && /task=/.test(tab2.url()), "Ctrl-click on a task row opens its address in a new tab"); if (tab2) await tab2.close();

  // a text selection is not a click
  await page.goto(`${BASE}/projects/${P}/work?tasks=all`, { waitUntil: "networkidle" });
  const t = row("Confirm power and network").locator("td").first(); const box = await t.boundingBox();
  await page.mouse.move(box.x + 8, box.y + box.height - 6); await page.mouse.down(); await page.mouse.move(box.x + box.width - 8, box.y + box.height - 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
  ok(!q(page, "task") || (await page.evaluate(() => (window.getSelection()?.toString() ?? "").length)) === 0, "dragging to select text does not open the task");

  // board cards
  await page.goto(`${BASE}/projects/${P}/work?tasks=all&view=board`, { waitUntil: "networkidle" });
  const card = page.locator("li[data-clickable]", { hasText: "Confirm power and network" }).first();
  ok((await card.count()) === 1, "board card is clickable");
  await card.click({ position: { x: 4, y: 4 } }); await panel.waitFor({ timeout: 10000 }).catch(() => {});
  ok((await panel.count()) === 1, "clicking the empty part of a board card opens the task");
  await page.goto(`${BASE}/projects?view=board`, { waitUntil: "networkidle" });
  const pcard = page.locator("li[data-clickable]", { hasText: "Floor projection delivery" }).first();
  await pcard.click({ position: { x: 4, y: 4 } }); await page.waitForURL(new RegExp(`/projects/${P}`), { timeout: 10000 }).catch(() => {});
  ok(new URL(page.url()).pathname.startsWith(`/projects/${P}`), "clicking the empty part of a project board card opens the project");
  await page.context().close();
}

async function phone() {
  const page = await newPage(browser, { width: 390, height: 844 }); await login(page, "mgr@e2e.local");
  await page.goto(`${BASE}/projects/${P}/work?tasks=all`, { waitUntil: "networkidle" });
  const row = page.locator("main tbody tr[data-clickable]", { hasText: "Sensor calibration" }).first();
  ok((await row.evaluate((e) => getComputedStyle(e).display)) === "block", "phone: the row is a card");
  const status = row.getByRole("button", { name: /^Status of/ }); await status.click(); await page.waitForTimeout(400);
  ok(!q(page, "task"), "phone: the status control on a card does not open the task"); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  await row.locator("td").first().click({ position: { x: 3, y: 3 } }); await page.locator("aside[role=dialog]").waitFor({ timeout: 10000 }).catch(() => {});
  ok(!!q(page, "task"), "phone: tapping the empty part of a task card opens the task");
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.locator("main tbody tr[data-clickable]", { hasText: "Floor projection delivery" }).first().locator("td").first().click({ position: { x: 3, y: 3 } });
  await page.waitForURL(new RegExp(`/projects/${P}`), { timeout: 10000 }).catch(() => {});
  ok(new URL(page.url()).pathname.startsWith(`/projects/${P}`), "phone: tapping a project card opens the project");
  await page.context().close();
}

await desktop(); await phone(); await browser.close();
console.log(fails === 0 ? "\nROW CLICK CHECKS PASSED" : `\n${fails} FAILED`); process.exit(fails === 0 ? 0 : 1);
