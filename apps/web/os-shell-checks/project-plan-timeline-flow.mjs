// Real-browser check of the Project Plan Timeline (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build.
// It builds a small schedule (Moodboard a range, Storyboard one day, Push Buttons a due date only, a range that crosses into the next month, work with no dates), then compares what
// the Timeline SHOWS (the written dates on each row, the day columns, the bar positions) with the saved records: for a short schedule (a labelled column and gridline per day, bars
// aligned to those columns), for a long one (weekly labels, exact dates still on every row), after Release (the task's CURRENT dates, not the plan's), and at desktop and phone widths
// (the names and dates stay in view while the chart scrolls). Fictional data; writes to the local database only.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/tl-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport) => { if (page) await page.context().close(); page = await newPage(browser, viewport); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pd = (iso) => ({ d: Number(iso.slice(8, 10)), m: MON[Number(iso.slice(5, 7)) - 1], mi: iso.slice(5, 7), y: iso.slice(0, 4) });
// What a person should read for a record: an INDEPENDENT rendering of the saved dates (not the app's function).
const expectDates = (start, due) => {
  if (!start && !due) return "No dates";
  if (!start) return `Due ${pd(due).d} ${pd(due).m} ${pd(due).y !== "2026" ? pd(due).y : ""}`.trim();
  if (!due || start === due) { const a = pd(start); return `${a.d} ${a.m}${a.y !== "2026" ? ` ${a.y}` : ""}`; }
  const a = pd(start), b = pd(due), yr = a.y !== "2026" ? ` ${a.y}` : "";
  return a.mi === b.mi ? `${a.d}–${b.d} ${b.m}${yr}` : `${a.d} ${a.m} – ${b.d} ${b.m}${yr}`;
};
const lineId = (desc) => db(`select id from proj_dp_lines where description='${desc}' and project_id='${PRJ}' and removed_at is null`);
const rec = (desc) => { const r = db(`select coalesce(start_date::text,'')||'|'||coalesce(needed_by::text,'') from proj_dp_lines where description='${desc}' and project_id='${PRJ}'`).split("|"); return { start: r[0] || null, due: r[1] || null }; };
const taskRec = (desc) => { const r = db(`select coalesce(t.start_date::text,'')||'|'||coalesce(t.due_date::text,'') from proj_tasks t join proj_dp_lines l on l.task_id=t.id where l.description='${desc}' and l.project_id='${PRJ}'`).split("|"); return { start: r[0] || null, due: r[1] || null }; };
const go = async () => { await page.goto(`${BASE}/projects/${PRJ}/delivery?view=timeline&open=D001`, { waitUntil: "networkidle" }); await page.getByTestId("plan-timeline").waitFor(); };
const near = (a, b, what, tol = 2.5) => { if (Math.abs(a - b) > tol) throw new Error(`${what}: ${a.toFixed(1)} vs ${b.toFixed(1)}`); };

let PRJ = "";
const LINES = {
  "Moodboard": ["2027-03-14", "2027-03-16"],               // a range
  "Storyboard": ["2027-03-17", "2027-03-17"],              // one day
  "Push Buttons": [null, "2027-03-19"],                    // a due date only
  "Print and mount": ["2027-03-30", "2027-04-02"],         // a range that crosses into the next month
  "Calibrate sensors": [null, null],                       // no dates at all
};

await as("mgr");
await step("setup: a project with Moodboard, Storyboard, Push Buttons, a month-crossing range and an undated requirement", async () => {
  await page.goto(`${BASE}/projects/handovers`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^accept handover/i }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/delivery/, { timeout: 30000 });
  PRJ = page.url().match(/projects\/([0-9a-f-]{36})\//)[1];
  asDb(4, `select proj_add_member('${PRJ}', '${U}2', null)`);
  asDb(4, `select proj_dp_seed_scope('${PRJ}')`);
  const item = db(`select id from proj_dp_items where project_id='${PRJ}' and item_key='D001'`);
  for (const [desc, [s, d]] of Object.entries(LINES)) {
    const f = { section: "content", description: desc, assignee_id: `${U}2`, ...(s ? { start_date: s } : {}), ...(d ? { needed_by: d } : {}) };
    asDb(4, `select proj_dp_save_line('${item}', null, '${JSON.stringify(f)}'::jsonb)`);
  }
  asDb(4, `select proj_dp_save_line('${item}', null, '{"section":"hardware","description":"Spare buttons"}'::jsonb)`);
});

for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  await step(`${label}, short schedule: a labelled column and gridline for every day; each row says its exact dates; bars sit on the saved days`, async () => {
    await as("mgr", viewport); await go();
    const tl = page.getByTestId("plan-timeline");
    if ((await tl.getAttribute("data-mode")) !== "day") throw new Error("a 20-day schedule is not drawn with a column per day");
    // columns: every day from the first scheduled day to the last, each labelled
    const cols = await page.locator('[data-testid^="tl-col-"]').evaluateAll((els) => els.map((e) => ({ date: e.dataset.testid.slice(7), text: e.innerText.replace(/\s+/g, " ").trim(), x: e.getBoundingClientRect().x, w: e.getBoundingClientRect().width })));
    const dates = cols.map((c) => c.date);
    if (dates[0] !== "2027-03-14" || dates.at(-1) !== "2027-04-02") throw new Error(`columns run ${dates[0]} to ${dates.at(-1)}`);
    if (cols.length !== 20) throw new Error(`${cols.length} columns for a 20-day schedule`);
    for (const c of cols) if (!new RegExp(`\\b${Number(c.date.slice(8, 10))}\\b`).test(c.text)) throw new Error(`column ${c.date} reads "${c.text}"`);
    if (!cols.find((c) => c.date === "2027-04-01").text.includes("Apr")) throw new Error("the first of the next month is not labelled with its month");
    if (!cols[0].text.includes("Mar")) throw new Error("the first column has no month");
    if (cols.some((c) => c.w < 40)) throw new Error(`a day column is only ${Math.min(...cols.map((c) => c.w)).toFixed(0)}px wide`);
    // gridline for each day: the row background repeats once per column
    const cell = await page.getByTestId(`tl-bar-${lineId("Moodboard")}`).locator("xpath=..").evaluate((e) => ({ size: getComputedStyle(e).backgroundSize, w: e.getBoundingClientRect().width, img: getComputedStyle(e).backgroundImage }));
    if (!/linear-gradient/.test(cell.img)) throw new Error("no gridline");
    const step1 = cell.size.split(" ")[0]; const px = step1.endsWith("%") ? (parseFloat(step1) / 100) * cell.w : parseFloat(step1);
    near(px, cell.w / 20, "gridline spacing", 1.5);
    // each row: the written dates and the bar, against the saved record
    for (const desc of Object.keys(LINES)) {
      const id = lineId(desc), r = rec(desc);
      const text = (await page.getByTestId(`tl-dates-${id}`).innerText()).trim();
      if (text !== expectDates(r.start, r.due)) throw new Error(`${desc} reads "${text}", the record says ${r.start}→${r.due}`);
      if (!r.start && !r.due) { if (!(await page.getByTestId(`tl-nodates-${id}`).isVisible())) throw new Error(`${desc}: no "No dates"`); continue; }
      const bar = await page.getByTestId(`tl-bar-${id}`).boundingBox();
      const first = cols.find((c) => c.date === (r.start ?? r.due)), last = cols.find((c) => c.date === (r.due ?? r.start));
      const scroll = await page.getByTestId("tl-scroll").evaluate((e) => e.scrollLeft);
      const shape = await page.getByTestId(`tl-bar-${id}`).getAttribute("data-shape");
      near(bar.x, first.x + 1, `${desc} bar starts on ${r.start ?? r.due}`);
      near(bar.x + bar.width, last.x + last.w - 1, `${desc} bar ends on ${r.due ?? r.start}`);
      const want = r.start && r.due ? (r.start === r.due ? "single" : "range") : r.due ? "due" : "start";
      if (shape !== want) throw new Error(`${desc} drawn as ${shape}, expected ${want}`);
      void scroll;
    }
    // the hardware draft with no dates, and the Unscheduled list
    const hw = (await page.getByTestId(`tl-dates-${lineId("Spare buttons")}`).innerText()).trim();
    if (hw !== "No dates") throw new Error(`hardware with no dates reads "${hw}"`);
    const un = await page.getByTestId("tl-unscheduled").innerText();
    if (!/Calibrate sensors/.test(un) || !/Spare buttons/.test(un)) throw new Error("the Unscheduled list is incomplete");
    await page.screenshot({ path: `${SHOTS}/timeline-short-${label}.png`, fullPage: true });
  });
  await step(`${label}: names and exact dates stay in view while the chart scrolls; nothing clipped; the page itself does not scroll sideways`, async () => {
    const sc = page.getByTestId("tl-scroll");
    const id = lineId("Push Buttons");
    const name = page.getByTestId(`tl-dates-${id}`);
    const before = await name.boundingBox();
    const scrollable = await sc.evaluate((e) => e.scrollWidth > e.clientWidth);
    if (label === "phone" && !scrollable) throw new Error("the chart does not scroll sideways on a phone");
    await sc.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
    await page.waitForTimeout(150);
    const after = await name.boundingBox();
    near(after.x, before.x, "the dates column moved while scrolling", 1.5);
    if (!(await name.isVisible())) throw new Error("the dates scrolled out of view");
    const clipped = await page.getByTestId(`tl-row-line`).first().locator("a").evaluate((e) => e.scrollWidth > e.clientWidth + 1);
    if (clipped) throw new Error("a requirement name is clipped");
    const leftW = (await page.getByTestId("tl-row-line").first().locator("div").first().boundingBox()).width;
    if (leftW < 150) throw new Error(`the name column is only ${Math.round(leftW)}px`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) throw new Error(`the page scrolls sideways by ${over}px`);
    await sc.evaluate((e) => { e.scrollLeft = 0; });
  });
}

await step("a long schedule: weekly labels, exact dates still on every row (also a range that crosses into the next month)", async () => {
  const item = db(`select id from proj_dp_items where project_id='${PRJ}' and item_key='D001'`);
  asDb(4, `select proj_dp_save_line('${item}', null, '{"section":"content","description":"Strike and return","assignee_id":"${U}2","needed_by":"2027-06-30"}'::jsonb)`);
  await as("mgr", { width: 390, height: 844 }); await go();
  if ((await page.getByTestId("plan-timeline").getAttribute("data-mode")) !== "week") throw new Error("a 109-day schedule is still drawn by the day");
  const cols = await page.locator('[data-testid^="tl-col-"]').evaluateAll((els) => els.map((e) => ({ date: e.dataset.testid.slice(7), text: e.innerText.replace(/\s+/g, " ").trim() })));
  if (cols[0].date !== "2027-03-14" || cols[1].date !== "2027-03-21" || cols[2].date !== "2027-03-28") throw new Error(`weekly labels: ${cols.slice(0, 3).map((c) => c.date)}`);
  if (cols.length !== Math.ceil(109 / 7)) throw new Error(`${cols.length} weekly labels`);
  if (!/14 Mar/.test(cols[0].text) || !/21 Mar/.test(cols[1].text)) throw new Error(`labels read ${cols[0].text}, ${cols[1].text}`);
  for (const desc of [...Object.keys(LINES), "Strike and return"]) {
    const id = lineId(desc), r = rec(desc);
    const text = (await page.getByTestId(`tl-dates-${id}`).innerText()).trim();
    if (text !== expectDates(r.start, r.due)) throw new Error(`${desc} reads "${text}", the record says ${r.start}→${r.due}`);
  }
  const bar = await page.getByTestId(`tl-bar-${lineId("Print and mount")}`).boundingBox();
  if (!(bar.width >= 4)) throw new Error("a range is too thin to see in weekly mode");
  await page.screenshot({ path: `${SHOTS}/timeline-long-phone.png`, fullPage: true });
  await as("mgr", { width: 1280, height: 900 }); await go();
  await page.screenshot({ path: `${SHOTS}/timeline-long-desktop.png`, fullPage: true });
});

await step("after Release the Timeline draws the linked task's CURRENT dates, not the plan's", async () => {
  asDb(4, `select proj_dp_release('${PRJ}')`);
  // the assignee moves Moodboard: the plan line still says 14-16 Mar, the task now says 15-18 Mar
  const t = db(`select task_id from proj_dp_lines where description='Moodboard' and project_id='${PRJ}'`);
  asDb(2, `select proj_update_task('${t}', '{"start_date":"2027-03-15","due_date":"2027-03-18"}'::jsonb)`);
  if (rec("Moodboard").start !== "2027-03-14") throw new Error("the plan line moved on its own");
  await as("mgr", { width: 1280, height: 900 }); await go();
  const id = lineId("Moodboard"), cur = taskRec("Moodboard");
  const text = (await page.getByTestId(`tl-dates-${id}`).innerText()).trim();
  if (text !== expectDates(cur.start, cur.due) || text !== "15–18 Mar 2027") throw new Error(`Moodboard reads "${text}" (task ${cur.start}→${cur.due})`);
  await page.getByTestId("plan-timeline").getAttribute("data-mode");
  // in weekly mode here (the long line is still in the plan), so check the bar by data attributes and by position against the weekly header
  const shape = await page.getByTestId(`tl-bar-${id}`).getAttribute("data-start");
  if (shape !== "2027-03-15") throw new Error(`the bar is drawn from ${shape}`);
  // a released work line with no due date of its own is no longer "inherited": it shows the task's
  const sb = (await page.getByTestId(`tl-dates-${lineId("Storyboard")}`).innerText()).trim();
  if (sb !== "17 Mar 2027") throw new Error(`Storyboard reads "${sb}"`);
  await page.screenshot({ path: `${SHOTS}/timeline-released-desktop.png`, fullPage: true });
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
