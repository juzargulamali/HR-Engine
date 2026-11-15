// Real-browser check of project scheduling (LOCAL STACK ONLY; see README.md). Seed first with `seed/base.sh`, then run against the production build. Fictional data.
//   1. Operations Overview names WHO is booked twice: the crew member and both confirmed assignments, each window in its own site's time zone, each with a direct link; an
//      assignment in a company the Operations Manager holds no right for is a time window only; a Project Manager cannot read it; the office board (/tv) carries none of it.
//   2. One site activity says the same thing in the Calendar's Month, Week and Agenda views, on the Site schedule and on Work: before its start, after its start time with no
//      start record (never "started"), after an explicit start record, and when finished.
//   3. Back to Calendar on the record a calendar entry opens restores the date, view, time zone and filters.
//   4. The Projects list shows a compact work package count only on a project that has work packages, from one read; it opens the project's work packages.
//   5. The Work schedule at phone width (390 and 360 px, light and dark, long names): no sideways page scroll, readable rows, reachable controls.
// Screenshots (deviceScaleFactor 2) go to SHOTS_DIR with the prefix pr3-.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/pr3-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001"; const CO2 = "00000000-0000-4000-8000-00000000a002";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (who, viewport = { width: 1280, height: 900 }, theme = "light") => { if (page) await page.context().close(); page = await newPage(browser, viewport, theme, { deviceScaleFactor: 2 }); await login(page, `${who}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0].slice(0, 500)); await page?.screenshot({ path: `${SHOTS}/pr3-fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const asDbErr = (n, q) => { try { execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["pipe", "pipe", "pipe"], input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }); return ""; } catch (e) { return String(e.stderr ?? e.message); } };
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
const flat = (s) => s.replace(/\s+/g, " ").trim();
const shot = (name, opts = {}) => page.screenshot({ path: `${SHOTS}/pr3-${name}.png`, fullPage: true, ...opts });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const local = (expr) => db(`select to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI')`);
const act = (pm, project, fields) => JSON.parse(asDb(pm, `select proj_save_site_activity('${project}', null, '${JSON.stringify(fields).replace(/'/g, "''")}'::jsonb)`)).id;
const day3 = db(`select ((now() at time zone 'Asia/Dubai')::date + 3)::text`);

let PA = "", PB = "", PX = "", A1 = "", A2 = "", X1 = "", PH = "";
await step("setup: two projects of one company and one of another, an Operations Manager, and one technician confirmed on three overlapping activities", async () => {
  db(`update profiles set full_name = 'Hana Rigger' where id = '${U}2'; update profiles set full_name = 'Omar Operations' where id = '${U}6'`);
  db(`insert into proj_company_grants (user_id, company_id, capabilities) select '${U}6', '${CO}', '{operations}' where not exists (select 1 from proj_company_grants where user_id = '${U}6' and company_id = '${CO}' and revoked_at is null)`);
  PA = asDb(3, `select proj_create_internal_project('${CO}', 'Fictional Airshow Pavilion', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional', 'Asia/Dubai')`);
  PB = asDb(3, `select proj_create_internal_project('${CO}', 'Fictional Motor Show Stand', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional', 'Europe/London')`);
  for (const p of [PA, PB]) asDb(4, `select proj_add_member('${p}', '${U}2', null)`);
  A1 = act(4, PA, { activity_kind: "setup", title: "Installation day", activity_state: "confirmed", starts_local: `${day3}T09:00`, ends_local: `${day3}T17:00`, tz: "Asia/Dubai" });
  A2 = act(4, PB, { activity_kind: "setup", title: "Stand build", activity_state: "confirmed", starts_local: `${day3}T11:00`, ends_local: `${day3}T15:00`, tz: "Europe/London" });   // 15:00 to 19:00 in Dubai
  asDb(4, `select proj_set_site_crew('${A1}', '[{"user_id":"${U}2","role":"installation"}]'::jsonb, null)`);
  // the second place is what the booking rule refuses without authority: recorded directly, as an override would leave it
  db(`insert into proj_site_crew (project_id, plan_item_id, user_id, crew_role, created_by) values ('${PB}', '${A2}', '${U}2', 'installation', '${U}4')`);
  // another company's project, which the Operations Manager of the first company holds no right for
  db(`insert into proj_company_settings (company_id, reference_code) values ('${CO2}', 'POL') on conflict do nothing`);
  PX = db(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by) values ('${CO2}', 'POL-P-2099-0001', 'HIDDEN-OTHER-COMPANY-PROJECT', 'internal', 'in_progress', '${U}8', '${U}8') returning id`).split("\n")[0];
  db(`insert into proj_project_details (project_id, location, site_timezone, technologies) values ('${PX}', 'HIDDEN-OTHER-VENUE', 'Europe/Warsaw', '[]'::jsonb)`);
  X1 = db(`insert into proj_plan_items (project_id, plan, title, activity_kind, activity_state, confirmed_at, status, start_date, end_date, created_by) values ('${PX}', 'site', 'HIDDEN-OTHER-ACTIVITY', 'setup', 'confirmed', now(), 'planned', '${day3}', '${day3}', '${U}8') returning id`).split("\n")[0];
  db(`insert into proj_site_crew (project_id, plan_item_id, user_id, crew_role, created_by) values ('${PX}', '${X1}', '${U}2', 'installation', '${U}8')`);
  if (!PA || !PB || !A1 || !A2 || !X1) throw new Error("setup incomplete");
});

// ---- 1. Operations: who is booked twice ------------------------------------------------------------------------------------
await step("Operations Manager: Team pressure names the crew member and both confirmed assignments, with each window in its own site's time zone and a link to each", async () => {
  await as("admin");
  await go(`/operations?company=${CO}`);
  const pairs = page.locator('[data-testid="ops-pressure-pair"][data-kind="crew_overlap"]');
  await pairs.first().waitFor();
  const both = pairs.filter({ hasText: "Stand build" }).filter({ hasText: "Installation day" });
  if ((await both.count()) !== 1) throw new Error(`expected one pair for the two visible assignments, got ${await both.count()}`);
  if (flat(await both.getByTestId("ops-overlap-person").innerText()) !== "Hana Rigger") throw new Error("the crew member is not named");
  const lines = (await both.getByTestId("ops-commitment").allInnerTexts()).map(flat);
  const d = `${Number(day3.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(day3.slice(5, 7)) - 1]}`;
  const want = [`Installation day · UAE-P-`, `· ${d}, 09:00 to 17:00 (Asia/Dubai)`, `Stand build · UAE-P-`, `· ${d}, 11:00 to 15:00 (Europe/London)`];
  const joined = lines.join(" || ");
  for (const w of want) if (!joined.includes(w)) throw new Error(`missing "${w}" in: ${joined}`);
  const hrefs = await both.getByTestId("ops-commitment").locator("a").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
  const expected = [`/projects/${PA}/plan?plan=site&mode=list#site-${A1}`, `/projects/${PB}/plan?plan=site&mode=list#site-${A2}`];
  if (hrefs.slice().sort().join("|") !== expected.slice().sort().join("|")) throw new Error("links: " + hrefs.join(" | "));
  await page.getByTestId("ops-pressure").scrollIntoViewIfNeeded();
  await shot("ops-overlap-ops-manager", { fullPage: false });
  // each link opens the exact activity
  await both.getByTestId("ops-commitment").locator("a", { hasText: "Stand build" }).click();
  await page.waitForURL(new RegExp(`/projects/${PB}/plan`));
  await page.getByTestId(`site-activity-${A2}`).waitFor();
  if (!/Hana Rigger/.test(await page.getByTestId(`site-activity-${A2}`).innerText())) throw new Error("the linked activity does not show the crew member");
});
await step("Operations Manager: an overlapping assignment in a company they hold no right for is a time window only (no project, title, venue or link)", async () => {
  await go(`/operations?company=${CO}`);
  const hidden = page.locator('[data-testid="ops-commitment"][data-source="other_company"]');
  if ((await hidden.count()) !== 2) throw new Error(`expected the other company's assignment against each of the two, got ${await hidden.count()}`);
  for (const t of (await hidden.allInnerTexts()).map(flat)) {
    if (!/^A confirmed assignment in another company \(details not shown\) · .+, all day \(Europe\/Warsaw\)$/.test(t)) throw new Error("hidden side wording: " + t);
  }
  if ((await hidden.locator("a").count()) !== 0) throw new Error("a hidden assignment has a link");
  const text = await page.locator("body").innerText();
  for (const s of ["HIDDEN-OTHER-COMPANY-PROJECT", "HIDDEN-OTHER-ACTIVITY", "HIDDEN-OTHER-VENUE", "POL-P-2099-0001"]) if (text.includes(s)) throw new Error(`the page shows ${s}`);
  const html = await page.content();
  for (const s of ["HIDDEN-OTHER", "POL-P-2099", PX, X1]) if (html.includes(s)) throw new Error(`the page source carries ${s}`);
  const raw = asDb(6, `select ops_crew_overlaps('${CO}')::text`);
  for (const s of ["HIDDEN-OTHER", "POL-P-2099", PX, X1]) if (raw.includes(s)) throw new Error(`the read returns ${s}`);
  if (!/not an Operations|Operations Managers of this company|42501/i.test(asDbErr(6, `select ops_crew_overlaps('${CO2}')`))) throw new Error("the other company's overlaps were readable");
});
await step("a Project Manager and a project member cannot read who is booked twice (the Operations right is checked in the database)", async () => {
  for (const n of [4, 2]) if (!/Operations is open to the Operations Managers/.test(asDbErr(n, `select ops_crew_overlaps('${CO}')`))) throw new Error(`user a${n} could read the overlaps`);
  await as("mgr"); await go(`/operations?company=${CO}`);
  if (await page.getByTestId("ops-overlap-person").count()) throw new Error("a Project Manager sees the Operations overlap detail");
});
await step("the office board keeps the detail off: the board read and the /tv page carry no overlap, no link to a project and nothing of the other company", async () => {
  const board = asDb(6, `select ops_tv_board('${CO}')::text`);
  if (/overlap|booked twice|"href"|\/projects\//i.test(board)) throw new Error("the board read carries overlap detail or links");
  for (const s of ["HIDDEN-OTHER", "POL-P-2099", PX, X1]) if (board.includes(s)) throw new Error(`the board read carries ${s}`);
  if (JSON.parse(board).activities.some((a) => "overlaps" in a || "crew_overlaps" in a)) throw new Error("a board activity carries overlaps");
  await as("admin"); await go(`/tv?company=${CO}`);
  const text = await page.locator("body").innerText();
  if (/is on two confirmed|booked twice|another company/i.test(text)) throw new Error("the office board shows the overlap detail");
  if ((await page.locator(`a[href*="/projects/"]`).count()) > 0) throw new Error("the office board links to a project");
  for (const s of ["HIDDEN-OTHER", "POL-P-2099"]) if (text.includes(s)) throw new Error(`the office board shows ${s}`);
  await shot("ops-office-board-no-overlap-detail", { fullPage: false });
});

// ---- 2. one activity, one state, everywhere --------------------------------------------------------------------------------
const stateOnSchedule = async () => { await go(`/projects/${PA}/plan?plan=site&mode=list`); const e = page.getByTestId(`site-phase-${PH}`); await e.waitFor(); return { text: flat(await e.innerText()), key: await e.getAttribute("data-state") }; };
const stateInCalendar = async (view, date) => {
  await go(`/projects/${PA}/plan?plan=site&mode=calendar&view=${view}&date=${date}`);
  const e = page.locator(`[data-testid="calendar-entry-state"][data-entry="plan_site:${PH}"]`).locator("visible=true");
  await e.first().waitFor();
  return { text: flat(await e.first().innerText()), key: await e.first().getAttribute("data-state") };
};
const stateOnWork = async () => { await go(`/projects/${PA}/work`); const e = page.getByTestId("overview-next"); await e.waitFor(); return flat(await e.innerText()); };
const sameEverywhere = async (moment, date, allowed, { onWork = true } = {}) => {
  const s = await stateOnSchedule();
  if (!allowed.includes(s.key)) throw new Error(`${moment}: the Site schedule says ${s.key} (${s.text})`);
  await page.getByTestId(`site-activity-${PH}`).scrollIntoViewIfNeeded();
  await shot(`phase-${moment}-site-schedule`, { fullPage: false });
  for (const view of ["month", "week", "agenda"]) {
    const c = await stateInCalendar(view, date);
    if (c.key !== s.key || c.text !== s.text) throw new Error(`${moment}: ${view} says "${c.text}" [${c.key}] but the Site schedule says "${s.text}" [${s.key}]`);
    await shot(`phase-${moment}-calendar-${view}`, { fullPage: false });
  }
  if (onWork) { const w = await stateOnWork(); const label = s.text.split(" · Recorded")[0].split(" · Not recorded")[0]; if (!w.includes(label)) throw new Error(`${moment}: Work's Next on site does not say "${label}": ${w}`); }
  return s;
};
await step("before the start time: Month, Week, Agenda, the Site schedule and Work all say the same scheduled state", async () => {
  await as("mgr");
  const tomorrow = db(`select ((now() at time zone 'Asia/Dubai')::date + 1)::text`);
  PH = act(4, PA, { activity_kind: "show", title: "Phase check show", activity_state: "tentative", starts_local: `${tomorrow}T10:00`, ends_local: `${tomorrow}T18:00`, tz: "Asia/Dubai" });
  const s = await sameEverywhere("before-start", tomorrow, ["scheduled"]);
  if (/started/i.test(s.text)) throw new Error("reads started before its start: " + s.text);
});
let phaseDay = "";
await step("after the start time with NO start record: nowhere reads Started (it is due today, or its date has passed and the start is unconfirmed)", async () => {
  const startsLocal = local(`(now() at time zone 'Asia/Dubai') - interval '2 hours'`); const endsLocal = local(`(now() at time zone 'Asia/Dubai') + interval '3 hours'`);
  phaseDay = startsLocal.slice(0, 10);
  asDb(4, `select proj_save_site_activity('${PA}', '${PH}', '{"starts_local":"${startsLocal}","ends_local":"${endsLocal}","tz":"Asia/Dubai","reason":"Fictional move for the check"}'::jsonb)`);
  if (db(`select (starts_at < now())::text || '|' || (actual_started_at is null)::text from proj_plan_items where id = '${PH}'`) !== "true|true") throw new Error("the activity is not past its start without a record");
  const s = await sameEverywhere("start-time-passed-no-record", phaseDay, ["due_today", "date_passed"]);
  if (/\bstarted\b/i.test(s.text.replace(/Not recorded as started|nobody has recorded that it started/gi, ""))) throw new Error("reads started without a start record: " + s.text);
  // even when the stored item status says in progress
  db(`update proj_plan_items set status = 'in_progress' where id = '${PH}'`);
  const again = await sameEverywhere("start-time-passed-status-in-progress", phaseDay, ["due_today", "date_passed"], { onWork: false });
  if (again.text !== s.text) throw new Error("the stored status changed the wording: " + again.text);
});
await step("after an explicit start record (recorded by the Project Manager on the Site schedule): every view says Started", async () => {
  await go(`/projects/${PA}/plan?plan=site&mode=list`);
  await page.getByTestId(`site-activity-${PH}`).getByRole("button", { name: "Record started" }).click();
  await page.getByRole("button", { name: "Record that work began" }).click();
  await until(() => db(`select actual_started_at is not null from proj_plan_items where id = '${PH}'`) === "t");
  const s = await sameEverywhere("explicit-start", phaseDay, ["started"]);
  if (!/^Show started /.test(s.text)) throw new Error("wording: " + s.text);
});
await step("when finished: every view says Finished", async () => {
  db(`update proj_plan_items set status = 'done' where id = '${PH}'`);
  const s = await sameEverywhere("finished", phaseDay, ["finished"], { onWork: false });
  if (!/^Finished/.test(s.text)) throw new Error("wording: " + s.text);
});

// ---- 3. Back to Calendar ----------------------------------------------------------------------------------------------------
await step("Back to Calendar from a record opened on the project's Plan calendar restores the date, view, time zone and filter", async () => {
  const address = `/projects/${PA}/plan?plan=site&mode=calendar&view=week&date=${day3}&tz=Europe%2FLondon&kind=plan_site`;
  await go(address);
  await page.locator(`[data-testid="calendar-entry-state"][data-entry="plan_site:${A1}"]`).first().waitFor();
  await page.getByRole("link", { name: "Installation day", exact: true }).first().click();
  await page.waitForURL(/from=plan-calendar/);
  await page.getByTestId(`site-activity-${A1}`).waitFor();
  const back = page.getByRole("link", { name: "Back to Calendar" });
  await back.waitFor();
  await shot("back-to-calendar-on-record", { fullPage: false });
  await back.click();
  await page.waitForURL(/mode=calendar/);
  const u = new URL(page.url());
  for (const [k, v] of [["plan", "site"], ["mode", "calendar"], ["view", "week"], ["date", day3], ["tz", "Europe/London"], ["kind", "plan_site"]]) if (u.searchParams.get(k) !== v) throw new Error(`${k} came back as ${u.searchParams.get(k)}, not ${v}: ${page.url()}`);
  if (u.pathname !== `/projects/${PA}/plan`) throw new Error("came back to " + u.pathname);
  if ((await page.getByRole("group", { name: "Calendar view" }).locator('[aria-current="true"]').innerText()).trim() !== "Week") throw new Error("the Week view is not the one shown");
});
await step("Back to Calendar from a record opened on the Projects calendar restores the scope, date, view and Show only filters; a record opened elsewhere has no such link", async () => {
  await as("hr");
  await go(`/projects/calendar?scope=mine&view=agenda&date=${day3}&kind=site_activity`);
  await page.getByRole("link", { name: "Installation day", exact: true }).first().click();
  await page.waitForURL(/from=calendar/);
  await page.getByRole("link", { name: "Back to Calendar" }).click();
  await page.waitForURL(/\/projects\/calendar\?/);
  const u = new URL(page.url());
  for (const [k, v] of [["scope", "mine"], ["view", "agenda"], ["date", day3], ["kind", "site_activity"]]) if (u.searchParams.get(k) !== v) throw new Error(`${k} came back as ${u.searchParams.get(k)}, not ${v}`);
  if (!(await page.locator('input[name="kind"][value="site_activity"]').isChecked())) throw new Error("the Site activities filter is not ticked after coming back");
  await go(`/projects/${PA}/plan?plan=site&mode=list`);
  if (await page.getByRole("link", { name: "Back to Calendar" }).count()) throw new Error("Back to Calendar is offered on a record that was not opened from a calendar");
});

// ---- 4. Projects list: work package indicator --------------------------------------------------------------------------------
await step("Projects list: a compact work package count on the project that has work packages, none on the others, and it opens the project's work packages", async () => {
  db(`insert into proj_deliverables (project_id, title, status, accepted_at, accepted_by, created_by) values
        ('${PA}', 'Fictional LED wall package', 'accepted', now(), '${U}4', '${U}4'), ('${PA}', 'Fictional content package', 'ready_for_review', null, null, '${U}4'),
        ('${PA}', 'Fictional rigging package', 'open', null, null, '${U}4'), ('${PA}', 'Fictional cancelled package', 'cancelled', null, null, '${U}4')`);
  await as("mgr"); await go("/projects");
  const wp = page.getByTestId(`project-wp-${PA}`); await wp.waitFor();
  if (flat(await wp.innerText()) !== "1/3 work packages · review") throw new Error("indicator: " + flat(await wp.innerText()));
  if ((await wp.locator("a").getAttribute("aria-label")) !== "1 of 3 work packages accepted, 1 ready for review") throw new Error("spoken label: " + (await wp.locator("a").getAttribute("aria-label")));
  if (await page.getByTestId(`project-wp-${PB}`).count()) throw new Error("an indicator is drawn on a project with no work packages");
  if (await page.getByTestId("project-wp-error").count()) throw new Error("the list says work packages could not be loaded");
  await shot("projects-list-work-packages");
  await go("/projects?view=board");
  if (!flat(await page.locator("main").innerText()).includes("1/3 work packages")) throw new Error("the board does not show the indicator");
  await go("/projects"); await page.getByTestId(`project-wp-${PA}`).locator("a").click();
  await page.waitForURL(new RegExp(`/projects/${PA}/work#work-packages`));
  await page.getByTestId("work-packages-disclosure").waitFor();
  // a summary-only person is shown no count
  await as("hr1"); await go("/projects");
  if (await page.locator('[data-testid^="project-wp-"]').count()) throw new Error("a summary-only person sees a work package count");
});

// ---- 5. the Work schedule on a phone -------------------------------------------------------------------------------------------
await step("setup: a Project Plan with long names over 30 days", async () => {
  const I = db(`select gen_random_uuid()`);
  db(`insert into proj_dp_state (project_id, rev, next_item, next_line) values ('${PA}', 1, 2, 5) on conflict do nothing`);
  db(`insert into proj_dp_items (id, project_id, item_key, zone, title, owner_id, needed_by, sort_order, created_by) values ('${I}', '${PA}', 'D001', 'Hall', 'Interactive heritage wall with a very long activation name that has to wrap on a phone', '${U}4', current_date + 24, 10, '${U}4')`);
  db(`insert into proj_dp_lines (project_id, item_id, line_key, section, description, assignee_id, start_date, needed_by, created_by) values
        ('${PA}', '${I}', 'L0001', 'content', 'Moodboard and storyboard for the international heritage showcase, first and second rounds of client comments', '${U}2', current_date - 6, current_date + 3, '${U}4'),
        ('${PA}', '${I}', 'L0002', 'content', 'Storyboard', '${U}2', current_date + 3, current_date + 12, '${U}4'),
        ('${PA}', '${I}', 'L0003', 'content', 'Supercalifragilisticexpialidocious-interactive-application-build-and-test', '${U}2', current_date + 8, current_date + 24, '${U}4'),
        ('${PA}', '${I}', 'L0004', 'content', 'No dates yet', '${U}2', null, null, '${U}4')`);
});
for (const width of [390, 360]) for (const theme of ["light", "dark"]) {
  await step(`Work schedule at ${width} px, ${theme}: no sideways page scroll, readable rows, the controls reachable, the chart scrolls inside itself`, async () => {
    await as("mgr", { width, height: 780 }, theme);
    await go(`/projects/${PA}/delivery?view=work-schedule`);
    const sc = page.getByTestId("tl-scroll"); await sc.waitFor();
    if ((await overflow()) > 1) throw new Error(`the page scrolls sideways by ${await overflow()} px`);
    const m = await sc.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right }));
    if (m.left < -1 || m.right > width + 1) throw new Error(`the chart is wider than the screen: ${m.left} to ${m.right}`);
    if (m.sw <= m.cw) throw new Error("a 30 day plan should scroll inside the chart");
    // rows: every name is readable (not clipped, at least 12 px text) and leaves at least 40% of the chart's width to the dates
    const rows = await page.locator('[data-testid^="tl-row-"]').evaluateAll((els) => els.map((li) => { const e = li.firstElementChild; const a = e.querySelector("a"); const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, clipped: e.scrollWidth > e.clientWidth + 1, font: parseFloat(getComputedStyle(a).fontSize), text: a.textContent.trim().slice(0, 30) }; }));
    if (rows.length < 4) throw new Error("the rows are not drawn: " + rows.length);
    for (const r of rows) {
      if (r.clipped) throw new Error(`a name is cut off: ${r.text}`);
      if (r.font < 12) throw new Error(`a name is drawn at ${r.font}px`);
      if (r.w > m.cw * 0.6) throw new Error(`the pinned names take ${Math.round(r.w)} of ${m.cw}px, leaving too little for the dates`);
    }
    // controls: Day, Week and Today are on screen, at least 40 px tall, and work
    for (const name of ["tl-mode-day", "tl-mode-week", "tl-today-jump"]) {
      const b = page.getByTestId(name); await b.scrollIntoViewIfNeeded();
      const box = await b.boundingBox();
      if (!box || box.x < 0 || box.x + box.width > width + 1) throw new Error(`${name} is off the screen`);
      if (box.height < 40) throw new Error(`${name} is ${Math.round(box.height)} px tall, too small to tap reliably`);
    }
    await page.getByTestId("tl-mode-week").click();
    if ((await page.getByTestId("plan-timeline").getAttribute("data-mode")) !== "week") throw new Error("Week did not switch the scale");
    await page.getByTestId("tl-mode-day").click();
    await page.getByTestId("tl-today-jump").click();
    await page.waitForTimeout(700);
    if ((await sc.evaluate((e) => e.scrollLeft)) <= 0) throw new Error("Today did not scroll the chart");
    if ((await overflow()) > 1) throw new Error("the page scrolls sideways after using the controls");
    // a bar opens its details on tap and the details stay on screen
    const bar = page.locator('[data-testid^="tl-bar-"]').nth(1); await bar.scrollIntoViewIfNeeded(); await bar.click({ position: { x: 10, y: 6 } });
    const tip = page.getByTestId("tl-tooltip"); await tip.waitFor({ timeout: 5000 });
    const tb = await tip.boundingBox();
    if (!tb || tb.x < -1 || tb.x + tb.width > width + 1) throw new Error("the bar's details run off the screen");
    await page.getByTestId("plan-timeline").scrollIntoViewIfNeeded();
    await shot(`work-schedule-${width}-${theme}`, { fullPage: false });
  });
}

await browser.close();
console.log(`\nverdict: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${passes} passed). Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
