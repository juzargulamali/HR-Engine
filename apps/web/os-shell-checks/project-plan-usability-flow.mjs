// Real-browser check of the Project Plan usability follow-up (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build.
// Demo, with fictional data: a stand-in "Batak" hardware list entered with Quick add (pasted), the same save repeated (nothing added twice), a Moodboard -> Storyboard sequence with
// owners and dates, the compact Breakdown table, two rows reordered (by dragging, and by the keyboard-reachable buttons), a reload to confirm everything persisted, the same at phone
// width, a plain member who sees none of the editing controls, and the collapsed desktop sidebar (first paint, reload, other page, the page flyout).
import { chromium, newPage, login, BASE, psql as sql, choose } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/usab-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const LONG = "Fictional Alexandria Konstantinopoulos-Wickramasinghe, Senior Interactive Content Designer";
const BATAK = ["Batak unit\t4", "Power distribution box\t2", "Network switch\t1", "Spare sensors\t12", "Flight case\t3", "Cable ties\t100"];
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport) => { if (page) await page.context().close(); page = await newPage(browser, viewport); await login(page, email.includes("@") ? email : `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const dayIso = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const dialog = () => page.getByRole("dialog");
const noOverflow = async (what) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };

let PRJ = ""; let TECH = ""; let BAT = ""; let BKEY = ""; let TKEY = "";
const lineKey = (d) => db(`select line_key from proj_dp_lines where item_id='${BAT}' and description='${d}' and removed_at is null`);
const batakOrder = () => db(`select string_agg(description, ',' order by sort_order, line_key) from proj_dp_lines where item_id='${BAT}' and section='hardware' and removed_at is null`).split(",");
const batakFields = () => db(`select string_agg(description || '|' || coalesce(qty::text,'') || '|' || coalesce(assignee_id::text,'') || '|' || coalesce(start_date::text,'') || '|' || coalesce(needed_by::text,'') || '|' || version, ';' order by description) from proj_dp_lines where item_id='${BAT}' and removed_at is null`);
const openActivation = async (key) => {
  await page.goto(`${BASE}/projects/${PRJ}/delivery?open=${key}`, { waitUntil: "networkidle" });
  const c = page.getByTestId(`dp-activation-${key}`); if (!(await c.evaluate((e) => e.open))) await c.locator("summary").click();
  return c;
};
const domOrder = async () => page.getByTestId(`dp-section-${BKEY}-hardware`).locator('[data-testid^="reorder-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("reorder-row-", "")));
const keysFor = (names) => names.map(lineKey);
const quickOpen = async () => { const c = await openActivation(BKEY); await c.getByRole("button", { name: "Quick add" }).click(); await dialog().waitFor(); return c; };
const paste = async (text) => { await dialog().locator("summary", { hasText: "Paste a list" }).click(); await dialog().getByLabel(/One requirement per line/).fill(text); await dialog().getByRole("button", { name: "Put these in the rows below" }).click(); };

await as("mgr");
await step("setup: handover accepted, people added, technologies brought in, a Batak activation made", async () => {
  await page.goto(`${BASE}/projects/handovers`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^accept handover/i }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/delivery/, { timeout: 30000 });
  PRJ = page.url().match(/projects\/([0-9a-f-]{36})\//)[1];
  db(`update profiles set full_name = '${LONG}' where id = '${U}2'`);
  asDb(4, `select proj_add_member('${PRJ}', '${U}2', null)`); asDb(4, `select proj_add_member('${PRJ}', '${U}7', null)`);
  asDb(4, `select proj_dp_seed_scope('${PRJ}')`);
  TECH = db(`select id from proj_dp_items where project_id='${PRJ}' and item_key='D001'`); TKEY = "D001";
  asDb(4, `select proj_dp_save_item('${PRJ}', '${TECH}', '{"owner_id":"${U}4","needed_by":"${dayIso(30)}"}'::jsonb)`);
  asDb(4, `select proj_dp_save_item('${PRJ}', null, '{"title":"Batak wall","owner_id":"${U}7","needed_by":"${dayIso(25)}","qty":1}'::jsonb)`);
  BAT = db(`select id from proj_dp_items where project_id='${PRJ}' and title='Batak wall'`); BKEY = db(`select item_key from proj_dp_items where id='${BAT}'`);
});

await step("Quick add (desktop): a pasted list fills the rows with quantities; owners and dates can be set per row; one save adds them all, in order", async () => {
  await as("mgr", { width: 1280, height: 900 }); await quickOpen();
  const box = await dialog().boundingBox(); if (box.width < 900) throw new Error(`dialog only ${Math.round(box.width)}px wide`);
  await paste(BATAK.join("\n"));
  const note = await dialog().getByTestId("qa-note").innerText(); if (!/^6 rows added below/.test(note)) throw new Error(`note: ${note}`);
  const names = await dialog().locator('input[name="rowName"]').evaluateAll((els) => els.map((e) => e.value).filter(Boolean)); if (names.join("|") !== BATAK.map((b) => b.split("\t")[0]).join("|")) throw new Error(`rows ${names}`);
  const qtys = await dialog().locator('input[name="rowQty"]').evaluateAll((els) => els.map((e) => e.value)); if (qtys.slice(0, 6).join(",") !== "4,2,1,12,3,100") throw new Error(`quantities ${qtys}`);
  await choose(dialog().getByLabel("Row 1 owner"), /^lead/i);
  await dialog().getByLabel("Row 1 start").fill(dayIso(5)); await dialog().getByLabel("Row 1 due").fill(dayIso(9)); await dialog().getByLabel("Row 2 due").fill(dayIso(12));
  const rowsY = await Promise.all([1, 2].map(async (n) => (await dialog().getByLabel(`Row ${n} name`).boundingBox()).y));
  const sameLine = await Promise.all(["owner", "start", "due"].map(async (f) => Math.abs((await dialog().getByLabel(`Row 1 ${f}`).boundingBox()).y - rowsY[0]) < 6));
  if (!sameLine.every(Boolean)) throw new Error("name, owner and dates are not on one row at desktop width");
  await noOverflow("desktop quick add");
  await page.screenshot({ path: `${SHOTS}/quick-add-desktop.png` });
  await dialog().getByRole("button", { name: "Add rows" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where item_id='${BAT}' and removed_at is null`) === "6");
  await until(async () => /6 rows added\./.test(await dialog().innerText())); 
  if (batakOrder().join("|") !== BATAK.map((b) => b.split("\t")[0]).join("|")) throw new Error(`saved order ${batakOrder()}`);
  const first = db(`select qty || '|' || assignee_id || '|' || start_date || '|' || needed_by from proj_dp_lines where item_id='${BAT}' and description='Batak unit'`);
  if (first !== `4.000|${U}7|${dayIso(5)}|${dayIso(9)}`) throw new Error(`row 1 saved as ${first}`);
  if (db(`select count(*) from proj_tasks where project_id='${PRJ}'`) !== "0") throw new Error("adding rows created a task");
});

await step("retrying the save adds nothing: the same list again, and a double click, leave one of each", async () => {
  await as("mgr", { width: 1280, height: 900 }); await quickOpen();
  await paste(BATAK.join("\n"));
  await dialog().getByRole("button", { name: "Add rows" }).click();
  await until(async () => /left as they are/.test(await dialog().innerText()));
  const t = await dialog().innerText(); if (!/0 new rows added; 6 already in the plan were left as they are/.test(t)) throw new Error(`notice: ${t.slice(0, 300)}`);
  if (db(`select count(*) from proj_dp_lines where item_id='${BAT}' and removed_at is null`) !== "6") throw new Error("the retry added rows");
  await dialog().getByRole("button", { name: "Close", exact: true }).last().click();
  await quickOpen();
  await dialog().getByLabel("Row 1 name").fill("Gaffer tape"); await dialog().getByLabel("Row 1 quantity").fill("5");
  await dialog().getByRole("button", { name: "Add rows" }).dblclick();
  await until(() => db(`select count(*) from proj_dp_lines where item_id='${BAT}' and description='Gaffer tape' and removed_at is null`) !== "0");
  await new Promise((r) => setTimeout(r, 1500));
  if (db(`select count(*) from proj_dp_lines where item_id='${BAT}' and description='Gaffer tape' and removed_at is null`) !== "1") throw new Error("a double click added two");
  asDb(4, `select proj_dp_remove_line((select id from proj_dp_lines where item_id='${BAT}' and description='Gaffer tape'))`);   // the demo list stays the six-row list
});

await step("Moodboard -> Storyboard sequence with owners and dates, each step waiting for the one before", async () => {
  await as("mgr", { width: 1280, height: 900 });
  const c = await openActivation(TKEY); await c.getByRole("button", { name: "Start from a sequence" }).click(); await dialog().waitFor();
  for (let n = 0; n < 4; n++) await dialog().getByRole("button", { name: "Remove step 3" }).click();
  await choose(dialog().getByLabel("Step 2 owner"), /Konstantinopoulos/);
  await dialog().getByLabel("Step 1 start").fill(dayIso(2)); await dialog().getByLabel("Step 1 due").fill(dayIso(4));
  await dialog().getByLabel("Step 2 start").fill(dayIso(5)); await dialog().getByLabel("Step 2 due").fill(dayIso(8));
  await dialog().getByRole("button", { name: "Add the steps" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where item_id='${TECH}' and section='content' and removed_at is null`) === "2");
  const got = db(`select string_agg(description || '=' || coalesce(assignee_id::text, 'none') || ':' || start_date || '>' || needed_by, ',' order by sort_order) from proj_dp_lines where item_id='${TECH}' and section='content'`);
  if (got !== `Moodboard=none:${dayIso(2)}>${dayIso(4)},Storyboard=${U}2:${dayIso(5)}>${dayIso(8)}`) throw new Error(`saved ${got}`);
  const dep = db(`select count(*) from proj_dp_lines s join proj_dp_lines m on m.id = any (s.depends_on) where s.item_id='${TECH}' and s.description='Storyboard' and m.description='Moodboard'`);
  if (dep !== "1") throw new Error("Storyboard does not wait for Moodboard");
});

await step("the compact Breakdown table (desktop): one row per requirement under column headings; name, who, dates, status and actions on one line", async () => {
  await as("mgr", { width: 1280, height: 900 }); await openActivation(BKEY);
  const sec = page.getByTestId(`dp-section-${BKEY}-hardware`);
  const head = (await sec.innerText()).replace(/\s+/g, " "); if (!/Requirement Supply \/ owner Dates Status Actions/.test(head)) throw new Error(`no column headings: ${head.slice(0, 120)}`);
  const key = lineKey("Network switch"); const row = page.getByTestId(`dp-line-${key}`);
  const ys = await Promise.all(["name", "who", "when", "status"].map(async (c) => (await row.getByTestId(`dp-${c}-${key}`).boundingBox()).y));
  if (Math.max(...ys) - Math.min(...ys) > 6) throw new Error(`cells are not on one line: ${ys}`);
  const h = (await row.boundingBox()).height; if (h > 64) throw new Error(`a plain row is ${Math.round(h)}px tall`);
  const t = await row.innerText(); if (!/Network switch × 1/.test(t) || !/Inventory · Not matched to stock/.test(t)) throw new Error(`row text: ${t}`);
  await noOverflow("desktop breakdown");
  await sec.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/breakdown-desktop.png`, fullPage: true });
});

let before = ""; let orderAfterDrag = [];
await step("reorder by dragging: the first row dropped on the third moves there and is saved", async () => {
  await as("mgr", { width: 1280, height: 900 }); await openActivation(BKEY);
  before = batakFields();
  const want0 = BATAK.map((b) => lineKey(b.split("\t")[0]));
  if ((await domOrder()).join() !== want0.join()) throw new Error(`start order ${await domOrder()}`);
  await page.getByTestId(`grip-${want0[0]}`).dragTo(page.getByTestId(`reorder-row-${want0[2]}`));
  await until(async () => (await domOrder()).join() === [want0[1], want0[2], want0[0], ...want0.slice(3)].join());
  await until(async () => /Order saved/.test(await page.getByTestId(`dp-section-${BKEY}-hardware`).getByTestId("reorder-status").innerText()), 8000);
  orderAfterDrag = batakOrder();
  if (orderAfterDrag.slice(0, 3).join("|") !== "Power distribution box|Network switch|Batak unit") throw new Error(`saved ${orderAfterDrag}`);
});

await step("reorder from the keyboard: Tab to a labelled button and press Enter; focus stays on it", async () => {
  const k = lineKey("Flight case"); const up = page.getByRole("button", { name: `Move ${k} up` });
  await up.focus(); await page.keyboard.press("Enter");
  await until(() => batakOrder().indexOf("Flight case") === 3);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label")); if (focused !== `Move ${k} up`) throw new Error(`focus moved to ${focused}`);
  const live = await page.getByTestId(`dp-section-${BKEY}-hardware`).getByTestId("reorder-announce").innerText(); if (!new RegExp(`${k} moved to position 4 of 6`).test(live)) throw new Error(`announced "${live}"`);
  const grip = page.getByTestId(`grip-${lineKey("Cable ties")}`); await grip.focus(); await page.keyboard.press("ArrowUp");
  await until(() => batakOrder().indexOf("Cable ties") === 4);
  await page.screenshot({ path: `${SHOTS}/reorder-desktop.png`, fullPage: true });
});

await step("reload: the order, owners, dates and quantities are exactly what was saved", async () => {
  const want = batakOrder();
  await page.reload({ waitUntil: "networkidle" });
  const keys = await domOrder(); const names = keys.map((k) => db(`select description from proj_dp_lines where item_id='${BAT}' and line_key='${k}'`));
  if (names.join("|") !== want.join("|")) throw new Error(`after reload ${names} vs saved ${want}`);
  if (want.join("|") !== "Power distribution box|Network switch|Batak unit|Flight case|Cable ties|Spare sensors" && want.join("|") !== "Power distribution box|Network switch|Batak unit|Flight case|Spare sensors|Cable ties") throw new Error(`unexpected final order ${want}`);
  if (batakFields() !== before) throw new Error(`rows changed while reordering:\n${before}\n${batakFields()}`);
  const first = page.getByTestId(`dp-line-${lineKey("Batak unit")}`);
  const t = (await first.innerText()).replace(/\s+/g, " "); if (!/× 4/.test(t) || !/Owner: lead/.test(t)) throw new Error(`Batak unit row: ${t}`);
  const content = await openActivation(TKEY); const ct = (await content.innerText()).replace(/\s+/g, " ");
  if (!/Moodboard/.test(ct) || !new RegExp("Storyboard.*Konstantinopoulos").test(ct)) throw new Error("the sequence did not persist on screen");
  if (db(`select count(*) from proj_dp_lines where project_id='${PRJ}' and removed_at is null`) !== "8") throw new Error("a row count changed");
});

await step("phone: Breakdown stacks without sideways scroll; Quick add fits; the buttons reorder and it persists", async () => {
  await as("mgr", { width: 390, height: 844 }); await openActivation(BKEY);
  await noOverflow("phone breakdown");
  const key = lineKey("Network switch"); const row = page.getByTestId(`dp-line-${key}`);
  const nb = await row.getByTestId(`dp-name-${key}`).boundingBox(), wb = await row.getByTestId(`dp-who-${key}`).boundingBox();
  if (!(wb.y > nb.y + nb.height - 2)) throw new Error("the row is not stacked on a phone");
  const before = batakOrder();
  await page.getByRole("button", { name: `Move ${key} up` }).click();
  await until(() => batakOrder().indexOf("Network switch") === before.indexOf("Network switch") - 1);
  await page.reload({ waitUntil: "networkidle" });
  const keys = await domOrder(); if (keys.map((k) => db(`select description from proj_dp_lines where item_id='${BAT}' and line_key='${k}'`)).join() !== batakOrder().join()) throw new Error("phone reorder did not persist");
  await page.screenshot({ path: `${SHOTS}/breakdown-phone.png`, fullPage: true });
  await page.getByTestId(`dp-activation-${BKEY}`).getByRole("button", { name: "Quick add" }).click(); await dialog().waitFor();
  const b = await dialog().boundingBox(); if (b.x < -1 || b.x + b.width > 391) throw new Error("the dialog is wider than the phone");
  const n1 = await dialog().getByLabel("Row 1 name").boundingBox(), o1 = await dialog().getByLabel("Row 1 owner").boundingBox();
  if (!(o1.y > n1.y + n1.height - 2)) throw new Error("Quick add fields do not stack on a phone");
  await noOverflow("phone quick add");
  await page.screenshot({ path: `${SHOTS}/quick-add-phone.png` });
});

await step("a plain member sees the plan but none of the editing controls, and the database refuses them too", async () => {
  const email = db(`select email from auth.users where id='${U}2'`);
  await as(email, { width: 1280, height: 900 }); await openActivation(BKEY);
  if (await page.getByRole("button", { name: "Quick add" }).count()) throw new Error("a member sees Quick add");
  if (await page.locator('[data-testid^="grip-"]').count()) throw new Error("a member sees reorder grips");
  if (!(await page.getByTestId(`dp-line-${lineKey("Batak unit")}`).isVisible())) throw new Error("a member cannot read the plan");
  const err = (() => { try { asDb(2, `select proj_dp_reorder_lines('${BAT}', array['${db(`select id from proj_dp_lines where item_id='${BAT}' limit 1`)}']::uuid[])`); return ""; } catch (e) { return String(e.stderr ?? e.message); } })();
  if (!/Only the Project Manager|not found|permission/i.test(err)) throw new Error(`the database did not refuse: ${err.slice(0, 120)}`);
});

await step("collapsed desktop sidebar: remembered, drawn collapsed on the first paint (server HTML), on other pages, and its pages open beside the icons", async () => {
  await as("mgr", { width: 1280, height: 900 }); await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  const aside = page.getByRole("complementary", { name: /modules/ });
  if ((await aside.boundingBox()).width < 200) throw new Error("starts collapsed for a new browser");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await until(async () => (await aside.boundingBox()).width < 100);
  const cookies = await page.context().cookies(); if (cookies.find((c) => c.name === "sidebar-collapsed")?.value !== "1") throw new Error("no cookie");
  const html = await (await page.context().request.get(`${BASE}/projects/${PRJ}/delivery`)).text();
  if (!/data-collapsed="true"/.test(html) || !/w-\[4\.5rem\]/.test(html)) throw new Error("the server did not draw it collapsed");
  const widths = []; await page.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => { const a = document.querySelector("aside[aria-label*=modules]"); window.__w0 = a && a.getBoundingClientRect().width; }); });
  await page.reload({ waitUntil: "domcontentloaded" }); widths.push(await page.evaluate(() => window.__w0)); if (widths[0] > 100) throw new Error(`first paint width ${widths[0]}`);
  await page.goto(`${BASE}/projects/${PRJ}/delivery?view=timeline`, { waitUntil: "networkidle" });
  if ((await aside.boundingBox()).width > 100) throw new Error("another page lost the collapse");
  const projects = aside.getByRole("link", { name: "Projects" }); await projects.hover();
  const fly = page.getByTestId("rail-flyout-projects"); await fly.waitFor();
  const links = await fly.getByRole("link").allInnerTexts(); if (links.length < 2) throw new Error(`flyout links ${links}`);
  const fb = await fly.boundingBox(); if (fb.x < 70) throw new Error("the flyout overlaps the rail");
  await page.screenshot({ path: `${SHOTS}/sidebar-rail-flyout.png` });
  await fly.getByRole("link").nth(0).click(); await page.waitForLoadState("networkidle");
  if ((await aside.boundingBox()).width > 100) throw new Error("choosing a page expanded the rail");
  await projects.focus(); await fly.waitFor(); await page.keyboard.press("Escape"); await fly.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Expand sidebar" }).click(); await until(async () => (await aside.boundingBox()).width > 200);
  if ((await page.context().cookies()).find((c) => c.name === "sidebar-collapsed")?.value !== "0") throw new Error("expand did not clear the cookie");
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
