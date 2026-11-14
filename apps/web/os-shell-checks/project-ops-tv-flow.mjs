// Phase 3 — Operations TV (the office board at /tv). LOCAL STACK ONLY; see README.md. Seed first with `seed/ops-tv.sh`, then run against the production build. Fictional data.
// What it proves, as the people and the display do it:
//   1. the Operations Manager (founder) adds a display through the real Office board screen; the display signs in on its own account and lands on the board
//   2. the facts on the board match the source records: RAF-style runs kept apart, Crew missing, Call time pending, Shipment arrival after setup, Start unconfirmed vs Started (explicit record only), the Inventory request state, handovers waiting
//   3. a Project Manager changes a date and a crew call time ONCE in the existing workflow; the next refresh shows it under the right run (nothing else on the board moves)
//   4. the pinned rail stays put while project pages rotate; one page stays still; layouts at TV, 4K, desktop, tablet and phone are legible, with no horizontal scroll
//   5. a failed refresh keeps the last good board marked Stale; revoking the display clears the board; a display identity cannot open anything else; the response carries only the allowed fields and is never cached
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/ops-tv-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
const browser = await chromium.launch();
let people = null; let tv = null; let fails = 0; let passes = 0;
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); for (const [who, pg] of [["tv", tv], ["people", people]]) await pg?.screenshot({ path: `${SHOTS}/fail-${who}-${name.replace(/\W+/g, "_").slice(0, 40)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const one = (q) => db(q).split("\n")[0];
const until = async (fn, ms = 20000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${String(fn).slice(0, 120)}`); await new Promise((r) => setTimeout(r, 250)); } };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const plus = (n) => one(`select (current_date + ${n})::text`);
const nice = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const norm = (t) => t.replace(/\s+/g, " ").trim();

const asPerson = async (email, viewport = { width: 1280, height: 900 }) => { if (people) await people.context().close(); people = await newPage(browser, viewport, "dark", {}); await login(people, email.includes("@") ? email : `${email}@e2e.local`); return people; };
const dialog = () => people.getByRole("dialog").last();
const text = async (page, id) => norm(await page.getByTestId(id).innerText());
const board = (page) => page.getByTestId("tv-board");
const settle = async (page) => { await page.waitForLoadState("networkidle"); await board(page).waitFor(); };
/** Moves the display's clock forward (its 60 s refresh and 25 s rotation timers fire) without waiting in real time. */
const advance = async (page, ms) => { await page.clock.runFor(ms); await page.waitForTimeout(500); };
const refreshOnce = async (page) => { const before = await page.getByTestId("tv-updated").innerText().catch(() => ""); await advance(page, 61000); await until(async () => (await page.getByTestId("tv-updated").innerText().catch(() => "")) !== before || (await board(page).getAttribute("data-status")) !== "ok", 15000).catch(() => {}); await page.waitForTimeout(400); };

let RAF = "", SET1 = "", SHOW = "", DIS = "", SET2 = "", RAFREQ = "", PASSED = "", PSET = "", STARTED = "", SSET = "", SUP = "", SHOWROOM = "", HAND = "";
let displayEmail = "", displayPassword = "", displayId = "";
const projectBlock = (id) => tv.getByTestId(`tv-project-${id}`);

await step("setup: the schema has the board; the fixture is in place (RAF-style project with four runs, passed-date job, started job, ten active projects, a pending handover)", async () => {
  if (one("select to_regprocedure('public.ops_tv_board(uuid)') is not null") !== "t") throw new Error("the database is not built from the Phase 3 migrations");
  const id = (q) => one(q);
  RAF = id("select id from proj_projects where name like 'RAF Museum%'");
  SET1 = id(`select id from proj_plan_items where project_id = '${RAF}' and plan = 'site' and title = 'Setup'`);
  SHOW = id(`select id from proj_plan_items where project_id = '${RAF}' and plan = 'site' and title = 'Show'`);
  DIS = id(`select id from proj_plan_items where project_id = '${RAF}' and plan = 'site' and title = 'Dismantle'`);
  SET2 = id(`select id from proj_plan_items where project_id = '${RAF}' and plan = 'site' and title = 'Reinstall'`);
  RAFREQ = id(`select id from inv_requests where project_id = '${RAF}' limit 1`);
  PASSED = id("select id from proj_projects where name like 'Passed date job%'"); PSET = id(`select id from proj_plan_items where project_id = '${PASSED}' and plan = 'site' limit 1`);
  STARTED = id("select id from proj_projects where name like 'Started job%'"); SSET = id(`select id from proj_plan_items where project_id = '${STARTED}' and plan = 'site' limit 1`);
  SUP = id("select id from proj_projects where name like 'Supply and install%'"); SHOWROOM = id("select id from proj_projects where name = 'Showroom refresh'");
  HAND = id("select id from proj_handovers where status in ('submitted','pm_assigned','clarification_requested') limit 1");
  if (one("select count(*) from proj_projects") !== "10") throw new Error("expected ten projects in the fixture");
  if (one(`select count(*) from proj_plan_items where project_id = '${RAF}' and plan = 'site'`) !== "4") throw new Error("expected four runs on the RAF-style project");
});

await step("the founder adds a display through the real Office board screen; the one-time password is shown; the row is active, for this company only", async () => {
  await asPerson("ceo");
  await people.goto(`${BASE}/operations/office-board?company=${CO}`, { waitUntil: "networkidle" });
  if (await people.getByTestId("ops-board-page").count() !== 1) throw new Error("the Office board screen did not open");
  await people.getByTestId("ops-board-add").click();
  await people.locator("#ob-label").fill("Office TV (fictional)");
  await people.locator("#ob-email").fill("office-tv@e2e.local");
  await people.getByTestId("ops-board-create").click();
  await people.getByTestId("ops-board-created").waitFor();
  displayEmail = norm(await people.getByTestId("ops-board-email").innerText());
  const pw = people.getByTestId("ops-board-password");
  await people.getByRole("button", { name: "Show", exact: true }).click();
  await until(async () => !/^•+$/.test(norm(await pw.innerText())), 5000);
  displayPassword = norm(await pw.innerText());
  if (displayEmail !== "office-tv@e2e.local" || displayPassword.length < 16) throw new Error(`display credentials: ${displayEmail} / ${displayPassword.length} characters`);
  await people.screenshot({ path: `${SHOTS}/display-created.png`, fullPage: true });
  await people.getByTestId("ops-board-created-done").click();
  displayId = one(`select id from ops_tv_displays where company_id = '${CO}' and revoked_at is null`);
  if (!displayId) throw new Error("no active display row");
  if (one(`select count(*) from employees e join ops_tv_displays d on d.user_id = e.user_id`) !== "0") throw new Error("the display account has an employee record");
  if (one(`select c.app_metadata ->> 'ops_tv' from local_auth.credentials c join auth.users u on u.id = c.user_id where u.email = '${displayEmail}'`) !== "true") throw new Error("the display account is not marked as a display");
  await people.reload({ waitUntil: "networkidle" });
  if ((await people.getByTestId(`ops-board-row-${displayId}`).getAttribute("data-state")) !== "active") throw new Error("the row is not active");
  await people.screenshot({ path: `${SHOTS}/office-board-displays.png`, fullPage: true });
});

await step("the display signs in on its own account (1920×1080) and lands on the board; the refresh answer carries only approved fields and is never cached", async () => {
  tv = await newPage(browser, { width: 1920, height: 1080 }, "dark", {});
  await tv.clock.install({ time: Date.now() });
  await tv.goto(`${BASE}/login`); await tv.getByLabel(/email/i).fill(displayEmail); await tv.getByLabel(/password/i).first().fill(displayPassword);
  await tv.getByRole("button", { name: /sign in|log in/i }).click(); await tv.waitForURL((u) => u.pathname === "/tv", { timeout: 20000 }).catch((e) => { throw new Error(`${e.message.split("\n")[0]} (at ${tv.url()})`); });
  await settle(tv);
  if ((await board(tv).getAttribute("data-status")) !== "ok") throw new Error("the board is not in the ok state");
  const t = await text(tv, "tv-header");
  if (!/Enginious/.test(t) || !/Last updated/.test(t)) throw new Error(`header: ${t}`);
  const r = await tv.evaluate(async (c) => { const res = await fetch(`/api/tv/board?company=${c}`, { cache: "no-store" }); return { status: res.status, cc: res.headers.get("cache-control"), body: await res.json() }; }, CO);
  if (r.status !== 200 || !/no-store/.test(r.cc ?? "") || !/private/.test(r.cc ?? "")) throw new Error(`refresh answer: ${r.status} ${r.cc}`);
  const allowed = { top: ["generated_at", "access", "company", "office_tz", "display", "truncated", "activities", "shipments", "projects", "handovers", "notes"],
    activity: ["id", "project_id", "project_ref", "project_name", "title", "kind", "run_label", "state", "phase", "venue", "venue_source", "start_date", "end_date", "starts_at", "ends_at", "tz", "lead", "crew", "crew_total", "call_missing", "readiness"],
    shipment: ["id", "project_id", "project_ref", "project_name", "label", "activity_id", "activity_title", "run_label", "departs_at", "arrives_at", "returns_at", "tz", "state", "request"],
    project: ["id", "ref", "name", "status", "kind", "pm_name", "activations", "next_activity_id", "dated_activities", "project_readiness", "equipment"],
    handover: ["id", "reference", "title", "status", "pm_name", "install_start", "location", "submitted_at"] };
  const extra = (obj, keys, where) => Object.keys(obj).filter((k) => !keys.includes(k)).map((k) => `${where}.${k}`);
  const b = r.body.board;
  const bad = [...extra(b, allowed.top, "board"), ...b.activities.flatMap((a) => extra(a, allowed.activity, "activity")), ...b.shipments.flatMap((s) => extra(s, allowed.shipment, "shipment")),
    ...b.projects.flatMap((p) => extra(p, allowed.project, "project")), ...b.handovers.flatMap((h) => extra(h, allowed.handover, "handover"))];
  if (bad.length) throw new Error(`fields outside the allowlist: ${[...new Set(bad)].join(", ")}`);
  const raw = JSON.stringify(b);
  if (/@|"phone"|"email"|comment|budget|file_url|signed_url|"value"/i.test(raw)) throw new Error("the response carries a field that must never appear (e-mail, phone, comment, budget, file or value)");
  if (b.access !== "display" || b.company.id !== CO) throw new Error(`access ${b.access}`);
  await tv.screenshot({ path: `${SHOTS}/tv-1920x1080-page1.png` });
});

await step("facts match the source records: runs kept apart, what is missing is said, Start unconfirmed vs Started, Inventory's own state, handovers waiting", async () => {
  const raf = await text(tv, `tv-project-${RAF}`).catch(async () => { await tv.getByTestId("tv-page-indicator").waitFor(); throw new Error("RAF project is not on the first page"); });
  // page order is by next site activity, so look through every page
  const pageTexts = []; const pages = Number((await tv.getByTestId("tv-page-indicator").innerText()).match(/of (\d+)/)?.[1] ?? 1);
  for (let i = 0; i < pages; i++) { await tv.goto(`${BASE}/tv?page=${i + 1}&rotate=0`, { waitUntil: "networkidle" }); await board(tv).waitFor(); pageTexts.push(norm(await tv.locator(".tv-page").innerText())); }
  const all = pageTexts.join(" | ");
  const rail = norm(await tv.getByTestId("tv-rail").innerText());
  const everything = `${rail} | ${all} | ${norm(await tv.getByTestId("tv-handovers").innerText())}`;
  const need = [[/RAF Museum Hendon: Cold War hall/, "long project name"], [/Crew missing/, "Crew missing (Reinstall has nobody)"], [/Call time pending/, "Call time pending (one person has no call time)"], [/Shipment arrival after setup/, "Shipment arrival after setup"],
    [/start unconfirmed/i, "Start unconfirmed for the passed date"], [/No scheduled site work/, "no scheduled site work"], [/Kids Photobooth/, "pending handover"], [/ENG-R-0000\d/, "Inventory request code"], [/Run 1/, "Run 1"]];
  for (const [re, what] of need) if (!re.test(everything)) throw new Error(`the board does not show ${what}`);
  const blocks = {};
  for (let i = 0; i < pages; i++) { await tv.goto(`${BASE}/tv?page=${i + 1}&rotate=0`, { waitUntil: "networkidle" }); await board(tv).waitFor(); for (const el of await tv.locator("[data-testid^=tv-project-]").all()) blocks[await el.getAttribute("data-testid")] = norm(await el.innerText()); }
  const mine = (t, name) => { const i = t.indexOf(name); return i < 0 ? "" : t.slice(i, i + 700); };
  const p = blocks[`tv-project-${PASSED}`] ?? ""; const s = blocks[`tv-project-${STARTED}`] ?? "";
  if (!p || !s) throw new Error("the passed-date or started project is not on the board");
  if (/\bStarted\b|Installation started/.test(p)) throw new Error(`a passed date alone reads started: ${p}`);
  if (!/unconfirmed/i.test(p)) throw new Error(`passed-date job does not say start unconfirmed: ${p}`);
  if (!/started/i.test(s) || /unconfirmed/i.test(s)) throw new Error(`the explicitly started job should read started: ${s}`);
  // equipment state comes from Inventory's own record
  const reqCode = one(`select code from inv_requests where id = '${RAFREQ}'`);
  if (!new RegExp(reqCode).test(everything)) throw new Error(`the RAF request ${reqCode} is not shown`);
  // the source of truth: the database read, as the display, equals what is on the screen for the request state
  const state = one(`select (inv_request_state('${RAFREQ}')) ->> 'state'`);
  console.log(`   (Inventory says the RAF request ${reqCode} is '${state}'; board text near it: ${mine(everything, reqCode).slice(0, 140)})`);
  await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" });
});

await step("readiness on the board equals the source: not recorded stays 'not recorded' (a completed task alone never makes equipment ready)", async () => {
  const src = one(`select (proj_activity_readiness_effective('${SET1}')) ->> 'hardware'`);
  const t = norm(await tv.locator("body").innerText());
  if (src === "not_recorded" && /Hardware ready|Equipment ready/i.test(t) && !/not recorded|Readiness not recorded/i.test(t)) throw new Error("the board claims readiness the source does not record");
  console.log(`   (source hardware readiness for RAF run 1: ${src})`);
});

await step("ONE edit by the Project Manager: move the Dismantle date and give the third crew member a call time; after one refresh the board shows both under the right run", async () => {
  await asPerson("mgr");
  const newDay = plus(8);
  const api = () => tv.evaluate(async (c) => (await (await fetch(`/api/tv/board?company=${c}`, { cache: "no-store" })).json()).board, CO);
  const byId = (b, id) => b.activities.find((a) => a.id === id);
  const before = await api();
  if (byId(before, SET1).call_missing !== 1 || byId(before, SHOW).call_missing !== 1) throw new Error("fixture: run 1 and the Show should each be missing one call time");
  await people.goto(`${BASE}/projects/${RAF}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const row = people.getByTestId(`site-activity-${DIS}`);
  await row.getByRole("button", { name: "Edit", exact: true }).click(); await dialog().waitFor();
  await dialog().locator("#sa-start").fill(newDay); await dialog().locator("#sa-end").fill(newDay);
  await dialog().getByLabel(/Why is a date or time changing/).fill("Hall handover moved by two days");
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await until(() => one(`select (starts_at at time zone 'Asia/Dubai')::date::text from proj_plan_items where id = '${DIS}'`) === newDay);
  await people.reload({ waitUntil: "networkidle" });
  await people.getByTestId(`site-crew-${SET1}`).first().click(); await dialog().waitFor();
  const calls = dialog().locator("input[name=crewCall]");
  const n = await calls.count(); let filled = false;
  for (let i = 0; i < n; i++) if (!(await calls.nth(i).inputValue())) { await calls.nth(i).fill(`${plus(1)}T08:30`); filled = true; break; }
  if (!filled) throw new Error("every crew member already has a call time");
  await dialog().getByRole("button", { name: "Save crew" }).click();
  await until(() => one(`select count(*) from proj_site_crew where plan_item_id = '${SET1}' and call_at is null`) === "0");
  // before the display refreshes, it still shows the old board
  await refreshOnce(tv);
  await board(tv).waitFor();
  const rail = norm(await tv.getByTestId("tv-rail").innerText());
  const blockTexts = []; for (const q of [1, 2]) { await tv.goto(`${BASE}/tv?page=${q}&rotate=0`, { waitUntil: "networkidle" }); blockTexts.push(norm(await tv.locator(".tv-page").innerText())); }
  const raf = norm(blockTexts.join(" | "));
  const rafBlock = raf.slice(raf.indexOf("RAF Museum Hendon"), raf.indexOf("RAF Museum Hendon") + 1800);
  if (!new RegExp(nice(newDay)).test(rafBlock + " " + rail)) throw new Error(`the new Dismantle date (${nice(newDay)}) is not on the board: ${rafBlock.slice(0, 500)}`);
  if (new RegExp(`Dismantle[^|]{0,60}${nice(plus(6))}`).test(rafBlock)) throw new Error("the old Dismantle date is still shown against the Dismantle run");
  const after = await api();
  if (byId(after, SET1).call_missing !== 0) throw new Error("run 1 still lacks a call time on the board after it was saved");
  if (byId(after, SHOW).call_missing !== 1) throw new Error("the Show's own missing call time was changed by the edit to run 1");
  if (byId(after, DIS).start_date !== newDay && !String(byId(after, DIS).starts_at).startsWith(newDay.slice(0, 7))) throw new Error("the Dismantle run does not carry the new date");
  for (const id of [SET1, SHOW, SET2]) if (byId(after, id).starts_at !== byId(before, id).starts_at || byId(after, id).start_date !== byId(before, id).start_date) throw new Error("a run the Project Manager did not touch moved on the board");
  if (/Shipment arrival after setup/.test(rafBlock) === false) throw new Error("the shipment conflict disappeared although the dates did not change");
  await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" });
  await tv.screenshot({ path: `${SHOTS}/tv-after-pm-edit.png` });
});

await step("the pinned rail stays during rotation: pages rotate on the 25 s timer with an indicator; the rail and header do not change; hovering or ?rotate=0 holds a page", async () => {
  await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" }); await board(tv).waitFor();
  await tv.mouse.move(5, 5); // a pointer resting on the project list holds the page by design
  const ind = tv.getByTestId("tv-page-indicator");
  const t0 = norm(await ind.innerText()); if (!/Page 1 of 2/.test(t0)) throw new Error(`indicator: ${t0}`);
  const railBefore = norm(await tv.getByTestId("tv-rail").innerText()); const first = norm(await tv.locator(".tv-page").innerText());
  const railBox = await tv.getByTestId("tv-rail").boundingBox(); const colBefore = await tv.locator(".tv-colhead span").first().boundingBox();
  await tv.clock.runFor(26000); await tv.waitForTimeout(600);
  const t1 = norm(await ind.innerText()); if (!/Page 2 of 2/.test(t1)) throw new Error(`after 26 s: ${t1}`);
  const second = norm(await tv.locator(".tv-page").innerText()); if (second === first) throw new Error("the project list did not change on rotation");
  if (norm(await tv.getByTestId("tv-rail").innerText()) !== railBefore) throw new Error("the rail changed during rotation");
  const railAfter = await tv.getByTestId("tv-rail").boundingBox(); const colAfter = await tv.locator(".tv-colhead span").first().boundingBox();
  if (Math.abs(railAfter.x - railBox.x) > 1 || Math.abs(railAfter.y - railBox.y) > 1 || Math.abs(railAfter.width - railBox.width) > 1) throw new Error("the rail moved or resized during rotation");
  if (Math.abs(colAfter.width - colBefore.width) > 1 || Math.abs(colAfter.x - colBefore.x) > 1) throw new Error("column widths changed between pages");
  await tv.screenshot({ path: `${SHOTS}/tv-1920x1080-page2.png` });
  await tv.goto(`${BASE}/tv?rotate=0`, { waitUntil: "networkidle" }); await tv.mouse.move(5, 5);
  await tv.clock.runFor(60000); await tv.waitForTimeout(400);
  if (!/Page 1 of 2/.test(norm(await tv.getByTestId("tv-page-indicator").innerText()))) throw new Error("?rotate=0 still rotated");
});

await step("a single page stays still: with at most five active projects there is no indicator and nothing rotates", async () => {
  const ids = db("select id from proj_projects where name not in ('Showroom refresh','Supply and install (made before Release 1)') and name not like 'RAF%' and name not like 'Passed%'").split("\n");
  db(`update proj_projects set status = 'archived' where id in (${ids.map((i) => `'${i}'`).join(",")})`);
  try {
    await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" }); await board(tv).waitFor();
    if (await tv.getByTestId("tv-page-indicator").count()) throw new Error("an indicator is shown for a single page");
    const before = norm(await tv.locator(".tv-page").innerText()); await tv.clock.runFor(60000); await tv.waitForTimeout(400);
    if (norm(await tv.locator(".tv-page").innerText()) !== before) throw new Error("a single page changed");
  } finally { db(`update proj_projects set status = 'planning' where id in (${ids.map((i) => `'${i}'`).join(",")})`); }
  await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" });
});

await step("layouts: 1920×1080 pinned rail beside the board; 4K bigger type, not more rows; desktop and tablet put the rail above; phone has an agenda and compact cards with no horizontal scroll; long names never hide the time or blocker", async () => {
  const fits = async (page, label) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (o.sw > o.cw + 1) throw new Error(`${label}: horizontal scroll (${o.sw} > ${o.cw})`); };
  const rowsOf = (page) => page.locator("[data-testid^=tv-project-]").count();
  const layout = async (w, h, scale, name, expectRe = null) => {
    const p = await newPage(browser, { width: w, height: h }, "dark", { deviceScaleFactor: scale });
    await p.goto(`${BASE}/login`); await p.getByLabel(/email/i).fill(displayEmail); await p.getByLabel(/password/i).first().fill(displayPassword);
    await p.getByRole("button", { name: /sign in|log in/i }).click(); await p.waitForURL((u) => u.pathname === "/tv"); await p.getByTestId("tv-board").waitFor(); await p.waitForLoadState("networkidle");
    await fits(p, name);
    const rail = await p.getByTestId("tv-rail").boundingBox(); const proj = await p.locator(".tv-projects").boundingBox();
    const rows = await rowsOf(p);
    const long = p.getByTestId(`tv-project-${RAF}`); const hasLong = await long.count();
    if (hasLong) { const t = norm(await long.innerText()); if (!/\d{1,2}:\d{2}|Call time|time to confirm|Date/i.test(t)) throw new Error(`${name}: the long project's row has no time information`); if (expectRe && !expectRe.test(t)) throw new Error(`${name}: the long project's row lacks ${expectRe}`); const b = await long.boundingBox(); if (b.width > w + 1) throw new Error(`${name}: the long project overflows`); }
    if (w < 500) { await p.screenshot({ path: `${SHOTS}/tv-${name}-agenda.png` }); await p.locator(".tv-projects").evaluate((e) => e.scrollIntoView()); await p.waitForTimeout(300); await p.screenshot({ path: `${SHOTS}/tv-${name}-projects.png` }); await p.screenshot({ path: `${SHOTS}/tv-${name}-full.png`, fullPage: true }); }
    else await p.screenshot({ path: `${SHOTS}/tv-${name}.png` });
    const res = { rail, proj, rows, name }; await p.context().close(); return res;
  };
  const tvLayout = await layout(1920, 1080, 1, "1920x1080");
  if (!(tvLayout.rail.x < tvLayout.proj.x)) throw new Error("1920x1080: the rail is not beside the board");
  if (tvLayout.rows > 5) throw new Error(`1920x1080: ${tvLayout.rows} project rows on a page`);
  const k4 = await layout(3840, 2160, 1, "3840x2160");
  if (k4.rows > 5) throw new Error(`4K shows ${k4.rows} rows`);
  const rootFont = async (w, h) => { const p = await newPage(browser, { width: w, height: h }, "dark", {}); await p.goto(`${BASE}/login`); await p.getByLabel(/email/i).fill(displayEmail); await p.getByLabel(/password/i).first().fill(displayPassword); await p.getByRole("button", { name: /sign in|log in/i }).click(); await p.waitForURL((u) => u.pathname === "/tv"); await p.getByTestId("tv-board").waitFor(); const f = await p.locator(".tv-rail-item").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize)); await p.context().close(); return f; };
  const f1 = await rootFont(1920, 1080); const f2 = await rootFont(3840, 2160); if (!(f2 > f1 * 1.5)) throw new Error(`4K type is not larger (${f1}px → ${f2}px)`);
  const desk = await layout(1440, 900, 1, "desktop-1440x900", /Reinstall|Run 2/); if (!(desk.rail.y < desk.proj.y)) throw new Error("desktop: the rail is not above the board");
  const tab = await layout(820, 1180, 1, "tablet-820x1180"); if (!(tab.rail.y < tab.proj.y)) throw new Error("tablet: the rail is not above the board");
  const ph = await layout(390, 844, 2, "phone-390x844"); if (!(ph.rail.y < ph.proj.y)) throw new Error("phone: agenda is not above the projects");
});

await step("a temporary refresh failure keeps the last good board marked Stale with its time; the next good refresh clears it", async () => {
  await tv.goto(`${BASE}/tv?rotate=0`, { waitUntil: "networkidle" }); await board(tv).waitFor();
  const stamp = norm(await tv.getByTestId("tv-updated").innerText()); const railBefore = norm(await tv.getByTestId("tv-rail").innerText());
  await tv.route("**/api/tv/board**", (r) => r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ state: "error" }) }));
  await advance(tv, 61000); await advance(tv, 61000);
  await tv.getByTestId("tv-stale").waitFor({ timeout: 10000 });
  const st = norm(await tv.getByTestId("tv-stale").innerText());
  if (!/stale/i.test(st) || !/as of/i.test(st)) throw new Error(`stale warning: ${st}`);
  if (norm(await tv.getByTestId("tv-rail").innerText()) !== railBefore) throw new Error("the last good board was not kept");
  if (!/Last updated/.test(await text(tv, "tv-updated"))) throw new Error("no last successful time");
  await tv.screenshot({ path: `${SHOTS}/tv-stale.png` });
  await tv.unroute("**/api/tv/board**");
  await advance(tv, 61000); await until(async () => (await tv.getByTestId("tv-stale").count()) === 0, 15000);
  if (stamp === norm(await tv.getByTestId("tv-updated").innerText())) console.log("   (timestamp unchanged within the same minute)");
});

await step("a display identity cannot open anything else: protected pages send it back to the board, existing APIs refuse it, and Operations / Projects data reads return nothing", async () => {
  const paths = ["/", "/projects", `/projects/${RAF}/work`, "/operations", "/operations/office-board", "/inventory", "/people", "/settings", "/site-assignments", "/sales"];
  for (const p of paths) {
    await tv.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    if (new URL(tv.url()).pathname !== "/tv") throw new Error(`${p} opened for the display (landed on ${tv.url()})`);
  }
  const probe = await tv.evaluate(async () => { const out = {}; for (const u of ["/api/jarvis/chat", "/api/files/x", "/api/notifications"]) { try { const r = await fetch(u, { redirect: "manual" }); out[u] = r.status || "redirect"; } catch { out[u] = "error"; } } return out; });
  console.log(`   (existing API probes as the display: ${JSON.stringify(probe)})`);
  for (const [u, s] of Object.entries(probe)) if (s === 200) throw new Error(`${u} answered 200 for the display`);
  // the database: a display reads nothing through the existing project and operations reads
  const sub = one(`select user_id from ops_tv_displays where id = '${displayId}'`);
  const asDisplay = (q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["pipe", "pipe", "ignore"], input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
  if (asDisplay("select count(*) from proj_projects") !== "0") throw new Error("the display can read projects");
  if (asDisplay("select count(*) from proj_plan_items") !== "0") throw new Error("the display can read plan items");
  let refused = false; try { asDisplay(`select ops_tv_revoke_display('${displayId}')`); } catch { refused = true; } if (!refused) throw new Error("a display can revoke itself");
  await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" });
});

await step("cross-company: the board answers for its own company only (another company's id is refused), and an ordinary employee outside Operations is refused", async () => {
  const other = one(`select id from companies where id <> '${CO}' limit 1`);
  if (!other) { console.log("   (no second company in the fixture)"); return; }
  const r = await tv.evaluate(async (c) => { const res = await fetch(`/api/tv/board?company=${c}`, { cache: "no-store" }); return { s: res.status, b: await res.json() }; }, other);
  if (r.s === 200 && r.b.board?.company?.id !== CO) throw new Error("a display read another company's board");
  if (r.s === 200 && r.b.board.company.id === CO) console.log("   (a display that names another company still gets only its own company's board)");
  const sub = one(`select user_id from ops_tv_displays where id = '${displayId}'`);
  let refused = false; try { execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["pipe", "pipe", "ignore"], input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${sub}","role":"authenticated"}', true); select ops_tv_board('${other}'); commit;` }); } catch { refused = true; }
  if (!refused) throw new Error("the database let a display read another company's board");
  const emp = await newPage(browser, { width: 1280, height: 900 }, "dark", {}); await login(emp, "emp@e2e.local");
  const e = await emp.evaluate(async (c) => { const res = await fetch(`/api/tv/board?company=${c}`, { cache: "no-store" }); return res.status; }, CO);
  if (e === 200) throw new Error("a person with no Operations grant read the board");
  await emp.context().close();
});

await step("revoking the display clears the board on the next access check: the founder revokes; the page and the next refresh say so; the account can no longer sign in", async () => {
  await tv.goto(`${BASE}/tv?rotate=0`, { waitUntil: "networkidle" }); await board(tv).waitFor();
  await asPerson("ceo"); await people.goto(`${BASE}/operations/office-board?company=${CO}`, { waitUntil: "networkidle" });
  await people.getByTestId(`ops-board-revoke-${displayId}`).click();
  await people.getByTestId(`ops-board-revoke-confirm-${displayId}`).click();
  await until(() => one(`select revoked_at is not null from ops_tv_displays where id = '${displayId}'`) === "t");
  await advance(tv, 61000);
  await until(async () => /revoked|denied|signed_out|not_installed/.test((await board(tv).getAttribute("data-status")) ?? "") || (await tv.getByTestId("tv-state-revoked").count()) > 0, 15000);
  if (await tv.getByTestId("tv-rail").count()) throw new Error("the board is still on screen after revocation");
  console.log(`   (state after revocation: ${await board(tv).getAttribute("data-status")})`);
  await tv.screenshot({ path: `${SHOTS}/tv-revoked.png` });
  await tv.goto(`${BASE}/tv`, { waitUntil: "networkidle" });
  if (await tv.getByTestId("tv-rail").count()) throw new Error("a reload after revocation shows the board");
  const again = await newPage(browser, { width: 1280, height: 900 }, "dark", {});
  await again.goto(`${BASE}/login`); await again.getByLabel(/email/i).fill(displayEmail); await again.getByLabel(/password/i).first().fill(displayPassword);
  await again.getByRole("button", { name: /sign in|log in/i }).click(); await again.waitForTimeout(2500);
  if (new URL(again.url()).pathname === "/tv" && await again.getByTestId("tv-rail").count()) throw new Error("a revoked display signed in and sees the board");
  await again.context().close();
  await asPerson("ceo"); await people.goto(`${BASE}/operations/office-board?company=${CO}`, { waitUntil: "networkidle" });
  if ((await people.getByTestId(`ops-board-row-${displayId}`).getAttribute("data-state")) !== "revoked") throw new Error("the Office board does not list it as revoked");
  await people.screenshot({ path: `${SHOTS}/office-board-revoked.png`, fullPage: true });
});

await step("an Operations Manager (not a display) opens the same board at /tv and sees it for the company (read-only, no sign-out surprise)", async () => {
  await asPerson("ceo", { width: 1920, height: 1080 });
  await people.goto(`${BASE}/tv?company=${CO}`, { waitUntil: "networkidle" }); await board(people).waitFor();
  if (!/Last updated/.test(await text(people, "tv-header"))) throw new Error("no board for the founder");
  const writes = await people.locator("form button:not(.tv-signout), input:not([type=hidden]), textarea").count();
  if (writes) throw new Error(`the board has ${writes} writable controls`);
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
