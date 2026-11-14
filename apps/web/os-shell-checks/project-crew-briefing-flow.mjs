// Real-browser check of the crew card and the briefing (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build. Fictional data.
// One populated existing project with TWO setup runs (and a timed show), one project with a single setup run, and one new project with nothing recorded. The site-only technician's card must
// show the venue (the project's, labelled), the date (the project's only when the link is unambiguous), an explicit call time, and hardware / content / app readiness with different words for
// Not applicable and Not recorded; the Project Manager sees what is missing beside Assign crew, picks the right run for the project date, and fills a call time from the activity start.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/crew-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport = { width: 1280, height: 900 }, ctx = {}) => { if (page) await page.context().close(); page = await newPage(browser, viewport, "dark", ctx); await login(page, email.includes("@") ? email : `${email}@e2e.local`); return page; };
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

// a4 mgr = Project Manager, a5 emp (Tariq Technician) = company employee with no Projects access (the site-only technician).
let A = "", B = "", C = "", RUN1 = "", RUN2 = "", SHOW = "", CSETUP = "", BSETUP = "";
const activity = (project, fields) => JSON.parse(asDb(4, `select proj_save_site_activity('${project}', null, '${JSON.stringify(fields).replace(/'/g, "''")}'::jsonb)`)).id;
const project = (name) => asDb(3, `select proj_create_internal_project('${CO}', '${name}', '${U}4', false, 'normal', current_date, current_date + 60, 'Fictional')`);
const crew = (act, rows) => asDb(4, `select proj_set_site_crew('${act}', '${JSON.stringify(rows)}'::jsonb, null)`);

await step("setup: a populated project with two setup runs and a timed show, a single-run project, and a new project", async () => {
  db(`update profiles set full_name = 'Tariq Technician' where id = '${U}5'`);
  A = project("Briefing Expo (fictional)"); B = project("Brand new (fictional)"); C = project("One run (fictional)");
  db(`update proj_project_details set location = 'Fictional Expo Centre, Hall 3', install_start = '${plus(10)}', event_start = '${plus(12)}', event_end = '${plus(14)}' where project_id in ('${A}', '${C}')`);
  RUN1 = activity(A, { activity_kind: "setup", title: "Setup run 1", run_label: "Run 1", activity_state: "tentative" });
  RUN2 = activity(A, { activity_kind: "setup", title: "Setup run 2", run_label: "Run 2", activity_state: "tentative" });
  SHOW = activity(A, { activity_kind: "show", title: "Show", activity_state: "tentative", start_date: plus(12), end_date: plus(12), starts_local: `${plus(12)}T10:00`, ends_local: `${plus(12)}T18:00` });
  crew(RUN1, [{ user_id: `${U}5`, role: "installation" }]); crew(SHOW, [{ user_id: `${U}5`, role: "standby" }]);
  CSETUP = activity(C, { activity_kind: "setup", title: "The only setup", activity_state: "tentative" }); crew(CSETUP, [{ user_id: `${U}5`, role: "installation" }]);
  BSETUP = activity(B, { activity_kind: "setup", title: "Setup (new)", activity_state: "tentative" }); crew(BSETUP, [{ user_id: `${U}5`, role: "installation" }]);
  // the Project Plan of A: a hardware line, two content lines (one with a finished task), nothing for apps
  const I = one(`select gen_random_uuid()`);
  db(`insert into proj_dp_state (project_id, rev, next_item, next_line) values ('${A}', 1, 2, 4) on conflict do nothing`);
  db(`insert into proj_dp_items (id, project_id, item_key, zone, title, owner_id, sort_order, created_by) values ('${I}', '${A}', 'D001', 'Hall', 'Secret LED wall', '${U}4', 10, '${U}4')`);
  db(`insert into proj_dp_lines (project_id, item_id, line_key, section, description, created_by) values ('${A}', '${I}', 'L0001', 'hardware', 'Secret panels', '${U}4'), ('${A}', '${I}', 'L0002', 'content', 'Secret intro film', '${U}4'), ('${A}', '${I}', 'L0003', 'content', 'Secret stills', '${U}4')`);
  const T = asDb(4, `select proj_create_task('${A}', '{"title":"Secret film task","assignee_id":"${U}4"}'::jsonb)`);
  db(`update proj_dp_lines set task_id = '${T}' where project_id = '${A}' and line_key = 'L0002'; update proj_tasks set status = 'done', completed_at = now() where id = '${T}'`);
});

const card = (act) => page.getByTestId(`site-assignment-${act}`);

await as("emp");
await step("the technician's card on the two-run project: the project's venue (labelled), no guessed date, an explicit call time, and readiness in plain words", async () => {
  await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  const c = card(RUN1);
  const t = (id) => c.getByTestId(id).innerText();
  if (!/Date not set yet/.test(await t("sa-when"))) throw new Error(`when: ${await t("sa-when")}`);
  if (!/Fictional Expo Centre, Hall 3 \(the project's venue\)/.test(await t("sa-venue"))) throw new Error(`venue: ${await t("sa-venue")}`);
  if (!/Not set yet/.test(await t("sa-call"))) throw new Error(`call: ${await t("sa-call")}`);
  // Run-specific readiness never borrows the Project Plan's counts: nothing is linked to this run, so it reads Not recorded; the project-wide counts sit on their own labelled line.
  const r = await t("sa-ready");
  if (!/Hardware: not recorded/.test(r) || !/Content: not recorded/.test(r) || !/App: not recorded/.test(r)) throw new Error(`run readiness: ${r}`);
  const pw = await t("sa-project-ready");
  if (!/^Project-wide readiness:/.test(pw)) throw new Error(`project-wide label: ${pw}`);
  if (!/hardware not ready \(0 of 1 equipment lines reserved or sent\)/.test(pw)) throw new Error(`project hardware: ${pw}`);
  if (!/content not ready \(0 of 2 outputs approved\)/.test(pw)) throw new Error(`project content (a finished task alone must not count): ${pw}`);
  if (!/app not applicable/.test(pw)) throw new Error(`project app: ${pw}`);
  if (/Secret/.test(await body())) throw new Error("a plan line or task name reached the technician");
  await page.screenshot({ path: `${SHOTS}/technician-two-runs-desktop.png`, fullPage: true });
});

await step("a single setup run uses the project's installation date and says so; a new project says Not recorded everywhere", async () => {
  const c = card(CSETUP);
  const w = await c.getByTestId("sa-when").innerText();
  if (!/from the project dates/.test(w)) throw new Error(`when: ${w}`);
  const n = card(BSETUP);
  if (!/Not recorded yet/.test(await n.getByTestId("sa-venue").innerText())) throw new Error("the new project's venue is not 'Not recorded yet'");
  const badges = await n.getByTestId("sa-ready").innerText();
  if (!/Hardware: not recorded/.test(badges) || !/Content: not recorded/.test(badges) || !/App: not recorded/.test(badges)) throw new Error(`readiness: ${badges}`);
  if (/not applicable/i.test(badges)) throw new Error("nothing recorded must not read as Not applicable");
});

await as("mgr");
await step("the Project Manager sees what is missing beside Assign crew, and a prompt to choose the run when there are several", async () => {
  await page.goto(`${BASE}/projects/${A}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const g = page.getByTestId(`site-briefing-gaps-${RUN1}`);
  const t = await g.innerText();
  if (!/choose which run it belongs to/.test(t) || !/without a call time/.test(t)) throw new Error(`gaps: ${t}`);
  if (/venue/i.test(t.replace(/Still missing from the briefing/, "")) && /No venue/.test(t)) throw new Error("the venue is the project's, so it is not a gap");
  if (!(await page.getByTestId(`site-apply-date-${RUN2}`).count())) throw new Error("run 2 has no 'This run' choice");
  await noOverflow("site schedule");
  await page.screenshot({ path: `${SHOTS}/pm-gaps-desktop.png`, fullPage: true });
});

await step("choosing the run copies the project date to that run only; the technician then sees it", async () => {
  await page.getByTestId(`site-apply-date-${RUN1}`).click(); await dialog().waitFor();
  await dialog().getByRole("button", { name: /for this run/ }).click();
  await until(() => one(`select start_date::text from proj_plan_items where id = '${RUN1}'`) === plus(10));
  if (one(`select coalesce(start_date::text, 'none') from proj_plan_items where id = '${RUN2}'`) !== "none") throw new Error("run 2 changed");
  await page.reload({ waitUntil: "networkidle" });
  if (!/choose which run/.test(await page.getByTestId(`site-briefing-gaps-${RUN2}`).innerText())) throw new Error("run 2 should still be asking");
  await as("emp"); await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  const w = await card(RUN1).getByTestId("sa-when").innerText();
  if (!/\d{1,2} [A-Z][a-z]{2}/.test(w) || /Date not set yet/.test(w)) throw new Error(`when after choosing: ${w}`);
});

await step("a call time can be filled from the activity start without retyping, and stays personal", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects/${A}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  await page.getByTestId(`site-crew-${SHOW}`).first().click(); await dialog().waitFor();
  await dialog().getByTestId("crew-use-start-0").click();
  const v = await dialog().locator("input[name=crewCall]").first().inputValue();
  if (!v.endsWith("T10:00")) throw new Error(`call time after 'use the activity start': ${v}`);
  await dialog().getByRole("button", { name: "Save crew" }).click();
  await until(() => one(`select call_at is not null from proj_site_crew where plan_item_id = '${SHOW}'`) === "t");
  await as("emp"); await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  if (/Not set yet/.test(await card(SHOW).getByTestId("sa-call").innerText())) throw new Error("the call time is still not set");
  // run 1's crew still has none: nothing was copied across people or activities
  if (!/Not set yet/.test(await card(RUN1).getByTestId("sa-call").innerText())) throw new Error("run 1's call time was filled too");
});

await step("a new project lists every gap for the Project Manager; the technician still cannot open the project", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects/${B}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const t = await page.getByTestId(`site-briefing-gaps-${BSETUP}`).innerText();
  if (!/No venue/.test(t) || !/No date yet/.test(t) || !/Readiness not recorded: hardware, content, app/.test(t) || !/without a call time/.test(t)) throw new Error(`gaps: ${t}`);
  await as("emp");
  const res = await page.goto(`${BASE}/projects/${A}/work`, { waitUntil: "networkidle" });
  if (/Secret/.test(await body()) || /Setup run 1/.test(await body()) && /Show$/.test(await page.title())) throw new Error("the project opened for the technician");
  if (db(`select count(*) from proj_project_members where project_id = '${A}' and user_id = '${U}5'`) !== "0") throw new Error("the technician became a member");
  void res;
});

await step("phone: the technician card and the Project Manager's gaps fit without sideways scroll", async () => {
  await as("emp", { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" }); await noOverflow("technician card");
  await page.screenshot({ path: `${SHOTS}/technician-two-runs-phone.png`, fullPage: true });
  await as("mgr", { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await page.goto(`${BASE}/projects/${A}/plan?plan=site&mode=list`, { waitUntil: "networkidle" }); await noOverflow("site schedule");
});

// The shared ⓘ help control (hover, keyboard focus and dismissal, phone tap) on the Site schedule, where its panel title carries one.
const icon = () => page.getByTestId("info-hint-site-schedule");
const pop = () => page.getByTestId("info-hint-popover");
const clear = async () => {
  const b = await pop().boundingBox(); if (!b) throw new Error("no popover box");
  const vp = page.viewportSize();
  if (b.x < 0 || b.y < 0 || b.x + b.width > vp.width + 0.5 || b.y + b.height > vp.height + 0.5) throw new Error(`the popover leaves the viewport: ${JSON.stringify(b)}`);
  const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e?.closest("[data-testid=info-hint-popover]"); }, [b.x + b.width / 2, b.y + Math.min(20, b.height / 2)]);
  if (!top) throw new Error("something (a card or a sticky header) is drawn over the popover");
};
await step("desktop: the ⓘ opens on hover and clears the page chrome, opens on keyboard focus, and Escape closes it", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects/${A}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  await icon().scrollIntoViewIfNeeded(); await icon().hover();
  await pop().waitFor(); if (!/Site schedule/.test(await pop().innerText())) throw new Error("the popover has the wrong text"); await clear();
  await page.mouse.move(5, 5); await pop().waitFor({ state: "detached" });
  await page.keyboard.press("Tab"); await icon().focus(); await pop().waitFor(); await clear();
  await page.keyboard.press("Escape"); await pop().waitFor({ state: "detached" });
  if (!(await icon().evaluate((e) => document.activeElement === e))) throw new Error("focus did not return to the icon after Escape");
  await page.screenshot({ path: `${SHOTS}/info-hint-desktop.png` });
});
await step("phone: a tap opens the ⓘ, a tap elsewhere closes it, and it stays inside the screen", async () => {
  await as("mgr", { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  await page.goto(`${BASE}/projects/${A}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  await icon().scrollIntoViewIfNeeded(); await icon().tap();
  await pop().waitFor(); await clear(); await noOverflow("with the popover open");
  await page.screenshot({ path: `${SHOTS}/info-hint-phone.png` });
  await page.locator("h1, h2").first().tap({ position: { x: 4, y: 4 }, force: true });
  await pop().waitFor({ state: "detached" });
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
