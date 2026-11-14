// Real-browser, role-by-role check of "Finish Phase 2" (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build. Fictional data.
// One populated project with two setup runs and a dismantle between them, a project with a single setup run, a project whose only evidence is a PASSED scheduled date, and a project that
// is recorded as started. Roles: a4 mgr = Project Manager; a5 emp (Tariq Technician) = site-only technician; a3 ceo = founder (sees Operations); a3 ceo = founder.
// Checks: the Project Manager's "Preview briefing" equals what the technician sees on a phone; a passed date never reads as started (Site schedule, technician, Operations); only an explicit
// record says started; a provisional date that passed with missing details names who to contact; the personal call time is not the activity start; a confirmed date or venue change notifies
// only the affected crew with the previous and new values; Operations lists every dated activity once, links to the exact row, labels header dates and keeps the company visible.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/finish-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport = { width: 1280, height: 900 }) => { if (page) await page.context().close(); page = await newPage(browser, viewport, "dark", {}); await login(page, email.includes("@") ? email : `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const one = (q) => db(q).split("\n")[0];
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const dialog = () => page.getByRole("dialog").last();
const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const noOverflow = async (what) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };
const plus = (n) => one(`select (current_date + ${n})::text`);
const text = async (testId) => (await page.getByTestId(testId).first().innerText()).replace(/\s+/g, " ");

let CP = "", A = "", C = "", P = "", S = "", RUN1 = "", DIS = "", RUN2 = "", SHOW = "", CSET = "", PSET = "", SSET = "";
const activity = (project, fields) => JSON.parse(asDb(4, `select proj_save_site_activity('${project}', null, '${JSON.stringify(fields).replace(/'/g, "''")}'::jsonb)`)).id;
const project = (name) => asDb(3, `select proj_create_internal_project('${CO}', '${name}', '${U}4', false, 'normal', current_date, current_date + 60, 'Fictional')`);
const crew = (act, rows) => asDb(4, `select proj_set_site_crew('${act}', '${JSON.stringify(rows)}'::jsonb, null)`);
const tech = `${U}5`;

await step("setup: a populated project with two setup runs and a dismantle between them, a single-run project, a passed-date project and a started project", async () => {
  db(`update profiles set full_name = 'Tariq Technician' where id = '${tech}'; update profiles set full_name = 'Mona Manager' where id = '${U}4'`);
  A = project("Finish Expo (fictional)"); C = project("Single run (fictional)"); P = project("Passed date (fictional)"); S = project("Started job (fictional)");
  db(`update proj_project_details set location = 'Fictional Expo Centre, Hall 3', install_start = '${plus(10)}', event_start = '${plus(13)}', event_end = '${plus(15)}' where project_id in ('${A}', '${C}')`);
  RUN1 = activity(A, { activity_kind: "setup", title: "Setup run 1", run_label: "Run 1", activity_state: "tentative" });
  DIS = activity(A, { activity_kind: "dismantling", title: "Dismantle after run 1", run_label: "Run 1", activity_state: "tentative", start_date: plus(12), end_date: plus(12) });
  RUN2 = activity(A, { activity_kind: "setup", title: "Setup run 2", run_label: "Run 2", activity_state: "confirmed", start_date: plus(20), end_date: plus(20), location: "Fictional Hall 5" });
  SHOW = activity(A, { activity_kind: "show", title: "Show", activity_state: "tentative", start_date: plus(13), end_date: plus(13), starts_local: `${plus(13)}T10:00`, ends_local: `${plus(13)}T18:00` });
  crew(RUN1, [{ user_id: tech, role: "installation" }]);
  crew(RUN2, [{ user_id: tech, role: "installation", call_local: `${plus(20)}T07:30` }]);
  crew(SHOW, [{ user_id: tech, role: "standby", call_local: `${plus(13)}T08:15` }]);
  CSET = activity(C, { activity_kind: "setup", title: "The only setup", activity_state: "tentative" }); crew(CSET, [{ user_id: tech, role: "installation" }]);
  PSET = activity(P, { activity_kind: "setup", title: "Past setup", activity_state: "tentative", start_date: plus(-2), end_date: plus(-2) }); crew(PSET, [{ user_id: tech, role: "installation" }]);
  SSET = activity(S, { activity_kind: "setup", title: "Recorded setup", activity_state: "confirmed", start_date: plus(-1), end_date: plus(1), location: "Fictional Hall 1" }); crew(SSET, [{ user_id: tech, role: "installation", call_local: `${plus(-1)}T08:00` }]);
  db(`delete from notifications where type = 'project_site_change'`);
});

const card = (act) => page.getByTestId(`site-assignment-${act}`);
let previewPhase = "";

await as("mgr");
await step("PM: runs stay distinct; the undated run asks which run, the dismantle between runs has its own date, and the PM sees No date where nothing is set", async () => {
  await page.goto(`${BASE}/projects/${A}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const r1 = await text(`site-phase-${RUN1}`);
  if (!/No date · choose which run/.test(r1)) throw new Error(`run 1 phase: ${r1}`);
  const d = await text(`site-phase-${DIS}`);
  if (!/Tentative Dismantling on/.test(d)) throw new Error(`dismantle phase: ${d}`);
  if (/started/i.test(r1 + d)) throw new Error("something reads as started without a record");
  await page.screenshot({ path: `${SHOTS}/site-schedule-two-runs-desktop.png`, fullPage: true });
});

await step("PM: Preview briefing beside Crew shows exactly what the technician will see, with missing date, venue and call time visible", async () => {
  await page.getByTestId(`site-preview-${RUN1}`).click(); await dialog().waitFor();
  const label = await dialog().getByTestId("site-preview-label").innerText();
  if (!/As Tariq Technician sees it/.test(label)) throw new Error(`label: ${label}`);
  const frame = (await dialog().getByTestId("site-preview-frame").innerText()).replace(/\s+/g, " ");
  if (!/No date · choose which run/.test(frame)) throw new Error(`preview phase: ${frame.slice(0, 200)}`);
  if (!/Fictional Expo Centre, Hall 3 \(the project's venue\)/.test(frame)) throw new Error("preview does not show the project's venue");
  if (!/Not set yet/.test(frame)) throw new Error("preview does not show the missing call time");
  const missing = await dialog().getByTestId("site-preview-missing").innerText();
  if (!/date/i.test(missing) || !/call time/i.test(missing)) throw new Error(`missing: ${missing}`);
  previewPhase = (await dialog().getByTestId("site-preview-frame").getByTestId("sa-phase").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: `${SHOTS}/preview-briefing-desktop.png`, fullPage: true });
  await page.keyboard.press("Escape");
});

await as("emp", { width: 390, height: 844 });
await step("technician on a phone: the same phase, reporting status first, then call time, venue and the named Project Manager; only the assigned activities", async () => {
  await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  const c = card(RUN1);
  const ph = (await c.getByTestId("sa-phase").innerText()).replace(/\s+/g, " ");
  if (ph !== previewPhase) throw new Error(`technician "${ph}" differs from the preview "${previewPhase}"`);
  const order = await c.evaluate((el) => ["sa-phase", "sa-reporting", "sa-call", "sa-venue", "sa-contact", "sa-ready"].map((id) => { const n = el.querySelector(`[data-testid="${id}"]`); return n ? n.getBoundingClientRect().top : Infinity; }));
  if (order.some((v, i) => i > 0 && v < order[i - 1])) throw new Error(`phone order: ${order.join(",")}`);
  if (!/Project Manager: Mona Manager/.test(await text("sa-contact"))) throw new Error(`contact: ${await c.getByTestId("sa-contact").innerText()}`);
  if (await page.getByTestId(`site-assignment-${DIS}`).count()) throw new Error("the technician sees an activity they are not assigned to");
  const t = await body();
  if (/Secret|budget|chat/i.test(t.replace(/The project's chat, tasks, files and reviews are not part of it\./g, ""))) throw new Error("a project record reached the technician");
  await noOverflow("technician phone");
  await page.screenshot({ path: `${SHOTS}/technician-phone-first.png`, fullPage: true });
});

await step("a single setup run shows the project date as tentative and says it comes from the project header", async () => {
  const ph = await text("sa-phase").catch(() => "");
  const c = card(CSET); const p = (await c.getByTestId("sa-phase").innerText()).replace(/\s+/g, " ");
  if (!/Tentative Setup on .*\(from the project header\)/.test(p)) throw new Error(`phase: ${p} ${ph}`);
});

await step("a PASSED scheduled date alone never reads as started: technician and provisional note name who to contact", async () => {
  const c = card(PSET);
  const p = (await c.getByTestId("sa-phase").innerText()).replace(/\s+/g, " ");
  if (!/Scheduled installation date passed · start unconfirmed/.test(p)) throw new Error(`phase: ${p}`);
  if (/started/i.test(p.replace("start unconfirmed", ""))) throw new Error("reads as started");
  const n = (await c.getByTestId("sa-provisional").innerText()).replace(/\s+/g, " ");
  if (!/Provisional date passed · contact Mona Manager for updated details/.test(n)) throw new Error(`provisional: ${n}`);
  await page.screenshot({ path: `${SHOTS}/technician-passed-date-phone.png`, fullPage: true });
});

await step("the personal call time is not the activity start: a 08:15 call for a 10:00 show, and a confirmed activity keeps its own venue", async () => {
  const c = card(SHOW); const call = (await c.getByTestId("sa-call").innerText()).replace(/\s+/g, " ");
  if (!/08:15/.test(call)) throw new Error(`call: ${call}`);
  const w = (await c.getByTestId("sa-when").innerText()).replace(/\s+/g, " ");
  if (!/10:00/.test(w) || /08:15/.test(w)) throw new Error(`when: ${w}`);
  if (!/Fictional Hall 5/.test((await card(RUN2).getByTestId("sa-venue").innerText()))) throw new Error("activity-specific venue was replaced");
});

await as("ceo");
await step("Operations: the company stays visible; every dated activity appears once with its exact link; a passed date never says started; a header date is labelled", async () => {
  await page.goto(`${BASE}/operations?company=${CO}`, { waitUntil: "networkidle" });
  if (!(await page.getByTestId("ops-company").count())) throw new Error("the current company is not shown");
  const t = await body();
  if (/Installation started/.test(t.replace(/Recorded setup/g, ""))) throw new Error("Operations says Installation started");
  for (const [id, what] of [[RUN2, "run 2"], [DIS, "dismantle"], [SHOW, "show"], [PSET, "passed"]]) {
    const n = await page.getByTestId(`ops-activity-${id}`).count();
    if (n !== 1) throw new Error(`${what} appears ${n} times`);
    const href = await page.getByTestId(`ops-activity-${id}`).locator("a[href*='#site-']").first().getAttribute("href").catch(() => null);
    if (!href || !href.includes(`#site-${id}`)) throw new Error(`${what} has no exact link (${href})`);
  }
  if (await page.getByTestId(`ops-activity-${RUN1}`).count()) throw new Error("the undated run 1 is listed with a guessed date");
  if (!/Date passed · start unconfirmed|date passed · start unconfirmed/i.test(t)) throw new Error("the passed date is not labelled start unconfirmed");
  if (!/Scheduled installation date passed · start unconfirmed/.test(await text(`ops-activity-${PSET}`))) throw new Error(`passed row: ${await text(`ops-activity-${PSET}`)}`);
  if (!/Set planning dates before submitting to Warehouse/.test(t)) throw new Error("the equipment issue does not name its next action");
  const eq = await page.locator("a[href*='/equipment?request=']").count();
  if (eq < 1) throw new Error("the equipment request code does not link to the request");
  if ((await page.getByTestId("ops-commitment").count()) < 2) throw new Error("team pressure does not show both commitments");
  await page.screenshot({ path: `${SHOTS}/operations-site-desktop.png`, fullPage: true });
});

await as("mgr");
await step("PM records that work began (an explicit record): only now does the technician and Operations read started; clearing the record returns to start unconfirmed", async () => {
  await page.goto(`${BASE}/projects/${S}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  if (!/Scheduled installation date passed · start unconfirmed/.test(await text(`site-phase-${SSET}`))) throw new Error("Site schedule does not say start unconfirmed");
  await page.getByTestId(`site-record-start-${SSET}`).click(); await dialog().waitFor();
  await dialog().getByRole("button", { name: "Record that work began" }).click();
  await until(() => one(`select actual_started_at is not null from proj_plan_items where id = '${SSET}'`) === "t");
  await page.reload({ waitUntil: "networkidle" });
  const s = await text(`site-phase-${SSET}`);
  if (!/Installation started/.test(s)) throw new Error(`after record: ${s}`);
  await page.screenshot({ path: `${SHOTS}/site-started-recorded.png`, fullPage: true });
  await as("emp"); await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  if (!/Installation started/.test(await card(SSET).getByTestId("sa-phase").innerText())) throw new Error("technician does not see the record");
  await as("ceo"); await page.goto(`${BASE}/operations?company=${CO}`, { waitUntil: "networkidle" });
  if (/start unconfirmed/.test(await text(`ops-activity-${SSET}`))) throw new Error("Operations still says start unconfirmed after a record");
  await as("mgr"); await page.goto(`${BASE}/projects/${S}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  await page.getByTestId(`site-clear-start-${SSET}`).click(); await dialog().waitFor();
  await dialog().getByRole("button", { name: "Clear the start record" }).click();
  await until(() => one(`select actual_started_at is null from proj_plan_items where id = '${SSET}'`) === "t");
});

await step("a confirmed date or venue change notifies only the affected crew, with previous and new values and a link to the briefing", async () => {
  const ver = one(`select version from proj_plan_items where id = '${RUN2}'`);
  asDb(4, `select proj_save_site_activity('${A}', '${RUN2}', '{"start_date":"${plus(22)}","end_date":"${plus(22)}","location":"Fictional Hall 7","reason":"The hall changed","expected_version":${ver}}'::jsonb)`);
  const n = db(`select count(*) from notifications where type = 'project_site_change' and user_id = '${tech}' and (payload::text like '%${RUN2}%')`);
  if (n !== "1") throw new Error(`the technician has ${n} notices for the move`);
  if (db(`select count(*) from notifications where type = 'project_site_change' and user_id <> '${tech}'`) !== "0") throw new Error("someone who is not assigned was notified");
  const pl = db(`select payload::text from notifications where type = 'project_site_change' and user_id = '${tech}' limit 1`);
  if (!pl.includes("Hall 5") || !pl.includes("Hall 7")) throw new Error(`payload lacks the previous and new venue: ${pl.slice(0, 200)}`);
  await as("emp", { width: 390, height: 844 });
  await page.goto(`${BASE}/site-assignments?activity=${RUN2}`, { waitUntil: "networkidle" });
  const ch = (await card(RUN2).getByTestId("sa-changed").innerText()).replace(/\s+/g, " ");
  if (!/Hall 5 → Fictional Hall 7|Fictional Hall 5 → Fictional Hall 7/.test(ch)) throw new Error(`changed: ${ch}`);
  await page.screenshot({ path: `${SHOTS}/technician-change-notice-phone.png`, fullPage: true });
});

await as("mgr");
await step("Files & client plan: choose what the client sees with tick boxes, preview it, and a version issued earlier stays frozen and still opens after the choice changes", async () => {
  // client timelines belong to client projects: accept the seeded Sales handover as the Project Manager (the real function), then add one activity to that live project
  asDb(4, `select proj_accept_handover('${one("select id from proj_handovers limit 1")}')`);
  CP = one("select project_id from proj_handovers limit 1");
  if (!CP) throw new Error("accepting the handover made no project");
  RUN2 = activity(CP, { activity_kind: "setup", title: "Client setup", activity_state: "tentative", start_date: plus(20), end_date: plus(20) });
  await page.goto(`${BASE}/projects/${CP}/documents`, { waitUntil: "networkidle" });
  for (const id of ["ct-choose", "ct-preview", "ct-issued"]) if (!(await page.getByTestId(id).count())) throw new Error(`${id} is missing`);
  const box = page.getByTestId(`ct-pick-${RUN2}`);
  if (await box.isChecked()) throw new Error("run 2 is client-facing before anybody chose it");
  await box.check();
  await page.getByRole("button", { name: "Save what the client sees" }).click();
  await until(() => one(`select client_facing from proj_plan_items where id = '${RUN2}'`) === "t");
  asDb(4, `select proj_issue_plan('${CP}', 'FIN-001', 'First issue')`);
  const issued = one(`select count(*) from proj_issued_plans where project_id = '${CP}'`);
  const before = one(`select md5(payload::text) from proj_issued_plans where project_id = '${CP}' order by issued_at limit 1`);
  await page.goto(`${BASE}/projects/${CP}/documents`, { waitUntil: "networkidle" });
  await page.getByTestId(`ct-pick-${RUN2}`).uncheck();
  await page.getByRole("button", { name: "Save what the client sees" }).click();
  await until(() => one(`select client_facing from proj_plan_items where id = '${RUN2}'`) === "f");
  if (one(`select count(*) from proj_issued_plans where project_id = '${CP}'`) !== issued) throw new Error("changing the choice changed the issued versions");
  if (one(`select md5(payload::text) from proj_issued_plans where project_id = '${CP}' order by issued_at limit 1`) !== before) throw new Error("an issued version changed");
  await page.goto(`${BASE}/projects/${CP}/documents`, { waitUntil: "networkidle" });
  const link = page.getByTestId("ct-issued").locator("a").first();
  await link.waitFor(); await link.click(); await page.waitForLoadState("networkidle");
  if (/couldn't load|Something went wrong|Application error/i.test(await body())) throw new Error("the issued version did not open");
  await page.screenshot({ path: `${SHOTS}/files-client-plan-issued.png`, fullPage: true });
});

await as("emp");
await step("the technician has no route into the project: only their own assignment and briefing", async () => {
  for (const path of [`/projects/${A}/work`, `/projects/${A}/plan`, `/projects/${A}/documents`]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const t = await body();
    if (/Setup run 1|Dismantle after run 1|Finish Expo/.test(t) && !/not found|don't have access|cannot|denied|404/i.test(t)) throw new Error(`${path} showed the project`);
  }
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
