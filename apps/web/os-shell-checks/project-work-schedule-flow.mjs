// Real-browser check of the Work schedule chart (Project Plan, formerly "Timeline"). LOCAL STACK ONLY; see README.md. Seed first with `seed/project-plan.sh`, then run against the production build.
// Fictional data. Three plans of 7, 9 and 30 days at desktop and phone width: a 7-day plan fits when there is room, 9 and 30 days scroll INSIDE the chart while the page stays put; names and the
// date header stay pinned; trackpad / touch / keyboard scrolling; Day / Week; the Today jump (smooth, and instant under reduced motion); an edge cue; the tooltip on hover, focus and tap; read-only bars.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/ws-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport = { width: 1280, height: 900 }, ctxOpts = {}) => { if (page) await page.context().close(); page = await newPage(browser, viewport, "dark", ctxOpts); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await wait(120); } };
const pageOverflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const scroller = () => page.getByTestId("tl-scroll");
const metrics = () => scroller().evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, sl: e.scrollLeft, x: e.getBoundingClientRect().left, r: e.getBoundingClientRect().right, y: e.getBoundingClientRect().top, b: e.getBoundingClientRect().bottom }));

const PROJECTS = {};
const make = (days, startOffset) => {
  const P = asDb(3, `select proj_create_internal_project('${CO}', 'Schedule ${days} days (fictional)', '${U}4', false, 'normal', current_date, current_date + 60, 'Fictional')`);
  const I = db(`select gen_random_uuid()`);
  db(`insert into proj_dp_state (project_id, rev, next_item, next_line) values ('${P}', 1, 2, 3) on conflict do nothing`);
  db(`insert into proj_dp_items (id, project_id, item_key, zone, title, owner_id, needed_by, sort_order, created_by) values ('${I}', '${P}', 'D001', 'Hall', 'Wall displays', '${U}4', current_date + ${startOffset + days - 1}, 10, '${U}4')`);
  db(`insert into proj_dp_lines (project_id, item_id, line_key, section, description, assignee_id, start_date, needed_by, created_by) values
        ('${P}', '${I}', 'L0001', 'content', 'Moodboard with a rather long name that has to wrap inside the pinned column', '${U}2', current_date + ${startOffset}, current_date + ${startOffset + 3}, '${U}4'),
        ('${P}', '${I}', 'L0002', 'content', 'Storyboard', '${U}2', current_date + ${startOffset + 3}, current_date + ${startOffset + days - 1}, '${U}4')`);
  return P;
};
await step("setup: plans of 7, 9 and 30 days, each including today", async () => {
  PROJECTS[7] = make(7, -2); PROJECTS[9] = make(9, -3); PROJECTS[30] = make(30, -6);
  for (const n of [7, 9, 30]) if (db(`select count(*) from proj_dp_lines where project_id = '${PROJECTS[n]}'`) !== "2") throw new Error(`plan ${n} not built`);
});
const open = async (n) => { await page.goto(`${BASE}/projects/${PROJECTS[n]}/delivery?view=timeline`, { waitUntil: "networkidle" }); await page.getByTestId("plan-timeline").waitFor(); await scroller().waitFor(); };

await as("mgr");
await step("the view is named Work schedule, the old Timeline link still works, and the default prompt about Moodboard / Storyboard is gone", async () => {
  await open(7);
  const t = await page.locator("body").innerText();
  if (!/Work schedule/.test(t)) throw new Error("the view is not called Work schedule");
  await page.goto(`${BASE}/projects/${PROJECTS[7]}/delivery?view=work-schedule`, { waitUntil: "networkidle" });
  if (!(await page.getByTestId("plan-timeline").count())) throw new Error("?view=work-schedule does not open the chart");
  await page.goto(`${BASE}/projects/${PROJECTS[7]}/delivery`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /start from a sequence/i }).first().click().catch(() => {});
  if (await page.getByRole("dialog").count()) { const dlg = page.getByRole("dialog").last(); const v = await dlg.locator("input").evaluateAll((els) => els.map((e) => e.value).join("|")); if (/Moodboard|Storyboard/.test(v)) throw new Error(`the sequence dialog is prefilled: ${v}`); }
});

for (const [label, viewport, touch] of [["desktop", { width: 1280, height: 900 }, false], ["phone", { width: 390, height: 844 }, true]]) {
  await as("mgr", viewport, touch ? { hasTouch: true, isMobile: true } : {});
  for (const n of [7, 9, 30]) {
    await step(`${label}: a ${n}-day plan ${n === 7 && !touch ? "fits when there is room" : "scrolls inside the chart"}, the page never scrolls sideways, and names and the date header stay pinned`, async () => {
      await open(n);
      const m = await metrics();
      const scrolls = m.sw > m.cw + 1;
      if (n === 7 && !touch && scrolls) throw new Error(`7 days should fit on a desktop (${m.sw} vs ${m.cw})`);
      if ((n !== 7 || touch) && !scrolls) throw new Error(`${n} days should scroll inside the chart (${m.sw} vs ${m.cw})`);
      if ((await pageOverflow()) > 1) throw new Error(`the page scrolls sideways by ${await pageOverflow()}px`);
      if (scrolls) {
        const before = await page.getByTestId("tl-row-line").first().locator("> div").first().boundingBox();
        await scroller().evaluate((e) => { e.scrollLeft = 300; });
        await wait(250);
        const after = await page.getByTestId("tl-row-line").first().locator("> div").first().boundingBox();
        if (Math.abs(after.x - before.x) > 1) throw new Error(`the name column moved from ${before.x} to ${after.x} while scrolling`);
        const dates = await page.getByTestId(/tl-dates-/).first().innerText();
        if (!/\d/.test(dates)) throw new Error("exact dates are not readable on the row");
        if ((await pageOverflow()) > 1) throw new Error("the page moved sideways while the chart scrolled");
        await scroller().evaluate((e) => { e.scrollLeft = 0; });
      }
      await page.screenshot({ path: `${SHOTS}/chart-${n}-days-${label}.png`, fullPage: true });
    });
  }
}

await as("mgr");
await step("desktop, 30 days: trackpad, keyboard and Home/End scroll the chart; an edge cue shows where more dates are; Today is marked and the jump finds it", async () => {
  await open(30);
  if (!(await page.getByTestId("tl-today-marker").count())) throw new Error("no Today marker");
  await scroller().scrollIntoViewIfNeeded(); await wait(400);
  const m0 = await metrics(); const vh0 = page.viewportSize().height;
  await page.mouse.move((m0.x + m0.r) / 2, (Math.max(m0.y, 0) + Math.min(m0.b, vh0)) / 2);          // over the visible part of the chart
  await page.mouse.wheel(400, 0); await wait(1500);
  { const w = await metrics(); if (w.sl < 200) throw new Error(`a horizontal wheel / trackpad scroll did not move the chart (scrollLeft ${w.sl}, box ${Math.round(m0.x)}..${Math.round(m0.r)} x ${Math.round(m0.y)}..${Math.round(m0.b)}, scrollY ${await page.evaluate(() => scrollY)})`); }
  await scroller().evaluate((e) => { e.scrollLeft = 0; }); await wait(200);
  await scroller().focus();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await wait(300);
  const k = (await metrics()).sl; if (k < 40) throw new Error(`keyboard scrolling moved ${k}px`);
  await page.keyboard.press("End"); await wait(1800); const end = await metrics(); if (end.sl + end.cw < end.sw - 3) throw new Error("End did not reach the last date");
  if (!(await page.getByTestId("tl-more-left").isVisible()) || (await page.getByTestId("tl-more-right").isVisible())) throw new Error("the edge cues do not match the scroll position");
  await page.keyboard.press("Home"); await wait(1800);
  if (!(await page.getByTestId("tl-more-right").isVisible())) throw new Error("no cue that more dates are offscreen");
  await page.getByTestId("tl-today-jump").click(); await wait(900);
  const mk = await page.getByTestId("tl-today-marker").first().boundingBox(); const m1 = await metrics();
  if (!mk || mk.x < m1.x - 1 || mk.x + mk.width > m1.r + 1) throw new Error("Today is not in view after the jump");
  await page.screenshot({ path: `${SHOTS}/chart-30-days-today-desktop.png`, fullPage: true });
});

await step("desktop: Day / Week switch (week groups the scale, rows keep exact dates) and the tooltip on hover and keyboard focus clears the chart edges", async () => {
  await open(30);
  const dayW = (await metrics()).sw;
  await page.getByTestId("tl-mode-week").click(); await wait(300);
  if ((await page.getByTestId("plan-timeline").getAttribute("data-mode")) !== "week") throw new Error("Week did not switch");
  if ((await metrics()).sw >= dayW) throw new Error("Week should be more compact than Day");
  if (!/\d/.test(await page.getByTestId(/tl-dates-/).first().innerText())) throw new Error("Week view lost the exact dates");
  await page.getByTestId("tl-mode-day").click(); await wait(300);
  await scroller().evaluate((e) => { e.scrollLeft = 0; }); await wait(1200);
  const bar = page.getByTestId("tl-row-line").first().locator("[data-tl-bar]");
  await bar.hover({ position: { x: 14, y: 6 } }); await page.getByTestId("tl-tooltip").waitFor();
  const tt = await page.getByTestId("tl-tooltip").innerText();
  for (const re of [/Moodboard/, /Cara|owner/i, /\d{1,2} \w{3}/]) if (!re.test(tt)) throw new Error(`tooltip lacks ${re}: ${tt}`);
  let tb = await page.getByTestId("tl-tooltip").boundingBox(); let sc = await metrics();
  if (tb.x < sc.x - 1 || tb.x + tb.width > sc.r + 1) throw new Error("the tooltip overflows the chart edge");
  await page.mouse.move(5, 5); await wait(250);
  await page.getByTestId("tl-row-line").nth(1).locator("[data-tl-bar]").focus(); await page.getByTestId("tl-tooltip").waitFor();
  tb = await page.getByTestId("tl-tooltip").boundingBox(); sc = await metrics();
  if (tb.x < sc.x - 1 || tb.x + tb.width > sc.r + 1) throw new Error("the focus tooltip overflows the chart edge");
  if (!/Storyboard/.test(await page.getByTestId("tl-tooltip").innerText())) throw new Error("the focus tooltip is for the wrong bar");
  await page.screenshot({ path: `${SHOTS}/chart-tooltip-desktop.png` });
  // bars are read-only: dragging one changes nothing
  const before = db(`select start_date::text || '|' || needed_by::text from proj_dp_lines where project_id = '${PROJECTS[30]}' and line_key = 'L0001'`);
  const bb = await page.getByTestId("tl-row-line").first().locator("[data-tl-bar]").boundingBox();
  await page.mouse.move(bb.x + 8, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + 120, bb.y + bb.height / 2, { steps: 6 }); await page.mouse.up(); await wait(400);
  if (db(`select start_date::text || '|' || needed_by::text from proj_dp_lines where project_id = '${PROJECTS[30]}' and line_key = 'L0001'`) !== before) throw new Error("a bar could be dragged to change dates");
});

await as("mgr", { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
await step("phone: a touch swipe scrolls the chart (not the page), and tapping a bar shows the same details", async () => {
  await open(30);
  await scroller().scrollIntoViewIfNeeded(); await wait(500);
  const m0 = await metrics(); const vh = page.viewportSize().height;
  const cdp = await page.context().newCDPSession(page);
  const sx = Math.round(Math.min(m0.r, 390) - 60), sy = Math.round((Math.max(m0.y, 0) + Math.min(m0.b, vh)) / 2);
  const pt = (px) => [{ x: px, y: sy, id: 1 }];                                                    // a real finger: down, a run of moves to the left, up
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(sx) });
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(sx - i * 22) }); await wait(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(1800);
  if ((await metrics()).sl < 100) throw new Error("a touch swipe did not scroll the chart");
  if ((await pageOverflow()) > 1) throw new Error("the page scrolled sideways");
  await scroller().evaluate((e) => { e.scrollLeft = 0; }); await wait(200);
  await page.getByTestId("tl-row-line").first().locator("[data-tl-bar]").tap({ position: { x: 14, y: 6 } }); await page.getByTestId("tl-tooltip").waitFor();
  if (!/Moodboard/.test(await page.getByTestId("tl-tooltip").innerText())) throw new Error("tap details are for the wrong bar");
  const tb = await page.getByTestId("tl-tooltip").boundingBox(); const sc = await metrics();
  if (tb.x < sc.x - 1 || tb.x + tb.width > sc.r + 1) throw new Error("the tap tooltip overflows the chart");
  await page.keyboard.press("Escape"); await wait(200);
  await page.screenshot({ path: `${SHOTS}/chart-tap-phone.png`, fullPage: true });
});

await as("mgr", { width: 1280, height: 900 }, { reducedMotion: "reduce" });
await step("reduced motion: the Today jump is instant, not animated", async () => {
  await open(30);
  await scroller().evaluate((e) => { e.scrollLeft = 0; }); await wait(200);
  await page.getByTestId("tl-today-jump").click(); await wait(60);
  const a = (await metrics()).sl; await wait(600); const b = (await metrics()).sl;
  if (a < 20) throw new Error("the jump did not move at once");
  if (Math.abs(a - b) > 2) throw new Error(`the jump kept animating (${a} then ${b})`);
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
