// Real-browser check of Projects Phase 2 (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build.
// Fictional data. Storyboard v1 -> changes requested -> v2 -> approval across the task panel, the Deliverables register, the milestone and history; a stale review screen; a restricted file;
// the register export; RAF's two site runs with crew; an overseas shipment arriving after its setup; the Work overview and its links; retries; phone width.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/p2-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport = { width: 1280, height: 900 }) => { if (page) await page.context().close(); page = await newPage(browser, viewport); await login(page, email.includes("@") ? email : `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const asDbErr = (n, q) => { try { asDb(n, q); return ""; } catch (e) { return String(e.stderr ?? e.message); } };
const email = (n) => db(`select email from auth.users where id='${U}${n}'`);
const noOverflow = async (what) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };
const dialog = () => page.getByRole("dialog").last();                                  // the task side panel is also a dialog: the form dialog opened on top is the last

// People: a4 = Project Manager (mgr), a2 = assignee (Cara), a7 = team head / reviewer (lead). Project: the seeded supply-and-install job.
const PRJ = db(`select id from proj_projects where name like 'Supply and install%' limit 1`);
const todayDb = db(`select (now() at time zone 'Asia/Dubai')::date`);
let STORY = "", MOOD = "", LOGO = "", MS = "", TEAM = "";
const taskUrl = (t) => `${BASE}/projects/${PRJ}/work?task=${t}`;
const link = (label, restricted = false) => db(`insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${PRJ}', 'link', 'document', '${label}', 'https://docs.example.com/${label.replace(/\W+/g, "-")}', ${restricted}, '${U}4') returning id`).split("\n")[0];

await step("setup: a reviewer, a team, a milestone, Storyboard with a REQUIRED expected output assigned to Cara", async () => {
  asDb(4, `select proj_add_member('${PRJ}', '${U}7', null)`);
  db(`update profiles set full_name = 'Cara Assignee' where id = '${U}2'; update profiles set full_name = 'Lena Reviewer' where id = '${U}7'`);
  TEAM = db(`insert into proj_teams (project_id, name, head_user_id, created_by) values ('${PRJ}', 'Creative', '${U}7', '${U}4') on conflict do nothing returning id`).split("\n")[0] || db(`select id from proj_teams where project_id='${PRJ}' limit 1`);
  MS = db(`insert into proj_milestones (project_id, title, due_date, created_by) values ('${PRJ}', 'Ready for mockup', '2027-11-01', '${U}4') returning id`).split("\n")[0];
  STORY = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Storyboard","assignee_id":"${U}2","team_id":"${TEAM}","requires_review":true,"milestone_id":"${MS}","due_date":"2027-11-05"}'::jsonb)`);
  MOOD = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Moodboard","assignee_id":"${U}2","team_id":"${TEAM}","requires_review":true,"milestone_id":"${MS}","due_date":"2027-11-03"}'::jsonb)`);
  LOGO = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Logo animation","assignee_id":"${U}2","team_id":"${TEAM}","requires_review":true,"due_date":"2027-11-04"}'::jsonb)`);
  asDb(4, `select proj_set_task_output('${LOGO}', 'Logo animation', 1, true, null)`);
  asDb(4, `select proj_set_task_output('${STORY}', 'Storyboard', 1, true, null)`); asDb(4, `select proj_set_task_output('${MOOD}', 'Moodboard', 1, true, null)`);
});

await step("the assignee sees the expected output and what is missing beside the action; the server refuses review without it", async () => {
  await as(email(2)); await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  const out = page.getByTestId("task-output"); await out.waitFor();
  const t = (await out.innerText()).replace(/\s+/g, " ");
  if (!/Expected output Storyboard Required Missing/.test(t)) throw new Error(`section: ${t.slice(0, 160)}`);
  if (!/Add the expected output: Storyboard\. The task cannot be sent for review or completed without it\./.test(t)) throw new Error("no next action text");
  const err = asDbErr(2, `select proj_set_task_status('${STORY}', 'ready_for_review')`);
  if (!/needs its expected output \(Storyboard\)/.test(err)) throw new Error(`the server did not refuse: ${err.slice(0, 150)}`);
  await page.screenshot({ path: `${SHOTS}/task-output-missing-desktop.png`, fullPage: true });
});

await step("v1 is submitted from the screen (a link); the attachment time is shown in the project's time zone, the link is called out as mutable, a double click makes one version", async () => {
  await page.getByTestId("output-submit-open").click(); await dialog().waitFor();
  await dialog().getByRole("tab", { name: "Add a link" }).click();
  await dialog().getByLabel("Link (https://)").fill("https://docs.example.com/storyboard-draft"); await dialog().getByLabel("Name for the link (optional)").fill("Storyboard draft");
  await dialog().getByLabel(/Note for the reviewer/).fill("First pass");
  await dialog().getByTestId("output-submit-go").dblclick();
  await until(() => db(`select count(*) from proj_task_output_versions where task_id='${STORY}'`) !== "0");
  await new Promise((r) => setTimeout(r, 1200));
  if (db(`select count(*) from proj_task_output_versions where task_id='${STORY}'`) !== "1") throw new Error("a double click made two versions");
  await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  const t = (await page.getByTestId("task-output").innerText()).replace(/\s+/g, " ");
  if (!/Version 1 Awaiting review/.test(t) || !/Attached: .* Asia\/Dubai by Cara Assignee/.test(t)) throw new Error(`v1 text: ${t.slice(0, 260)}`);
  if (!/link to a document that can change after approval/.test(t)) throw new Error("the mutable link is not called out");
  if (!/Not reviewed yet/.test(t)) throw new Error("approval time should not exist yet");
  await page.getByRole("button", { name: /send for review/i }).first().click().catch(() => {});
  await until(() => db(`select status from proj_tasks where id='${STORY}'`) === "ready_for_review", 8000).catch(() => asDb(2, `select proj_set_task_status('${STORY}', 'ready_for_review')`));
});

await step("the reviewer requests changes on v1; the task goes back to In progress; v1 keeps its own decision", async () => {
  await as(email(7)); await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  await page.getByTestId("output-review-open").click(); await dialog().waitFor();
  await dialog().getByLabel("Decision").selectOption("changes_requested");
  await dialog().getByLabel(/What needs changing/).fill("Too dark, redo the second scene");
  await dialog().getByRole("button", { name: "Request changes" }).click();
  await until(() => db(`select status from proj_task_output_versions where task_id='${STORY}' and version_no=1`) === "changes_requested");
  if (db(`select status from proj_tasks where id='${STORY}'`) !== "in_progress") throw new Error("the task did not return to In progress");
});

let staleHtml = "";
await step("v2 is submitted; v2 has its own review state while v1's decision stays; a stale review screen cannot approve the newer version", async () => {
  await as(email(2)); await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  await page.getByTestId("output-submit-open").click(); await dialog().waitFor();
  await dialog().getByRole("tab", { name: "Add a link" }).click();
  await dialog().getByLabel("Link (https://)").fill("https://docs.example.com/storyboard-draft");                 // the SAME address again: a new version
  await dialog().getByTestId("output-submit-go").click();
  await until(() => db(`select count(*) from proj_task_output_versions where task_id='${STORY}'`) === "2");
  asDb(2, `select proj_set_task_status('${STORY}', 'ready_for_review')`);
  const v = db(`select string_agg('v' || version_no || '=' || status, ',' order by version_no) from proj_task_output_versions where task_id='${STORY}'`);
  if (v !== "v1=changes_requested,v2=awaiting") throw new Error(`versions ${v}`);
  // The reviewer opens the review dialog on v2, then a v3 arrives before they press Approve.
  await as(email(7)); await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  await page.getByTestId("output-review-open").click(); await dialog().waitFor();
  await dialog().getByRole("heading").first().waitFor();
  asDb(2, `select proj_set_task_status('${STORY}', 'in_progress')`);
  asDb(2, `select proj_submit_task_output('${STORY}', '${link("Storyboard v3")}', null, 1, 'Third pass', false, 'stale-test-attempt-v3', null)`);
  asDb(2, `select proj_set_task_status('${STORY}', 'ready_for_review')`);
  await dialog().getByRole("button", { name: "Approve this version" }).click();
  await until(async () => /no longer the current one/.test(await dialog().innerText()), 25000);
  if (db(`select count(*) from proj_task_output_versions where task_id='${STORY}' and status='approved'`) !== "0") throw new Error("a stale approval landed");
  if (!/Version 2 is no longer the current one: version 3 was submitted/.test(await dialog().innerText())) throw new Error(`stale message: ${(await dialog().innerText()).slice(-200)}`);
  await page.screenshot({ path: `${SHOTS}/stale-review-refused.png` });
});

await step("the reviewer reloads and approves v3 (the version now current): approval time is separate from the attachment time; the task is Done; the milestone follows", async () => {
  await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  await page.getByTestId("output-review-open").click(); await dialog().waitFor();
  const head = await dialog().getByRole("heading").first().innerText(); if (!/version 3/.test(head)) throw new Error(`reviewing "${head}"`);
  await dialog().getByRole("button", { name: "Approve this version" }).click();
  await until(() => db(`select status from proj_task_output_versions where task_id='${STORY}' and version_no=3`) === "approved");
  if (db(`select status from proj_tasks where id='${STORY}'`) !== "done") throw new Error("the task is not done");
  const r = db(`select (approved_at > attached_at)::text || ',' || (approved_at is not null)::text from proj_task_output_versions where task_id='${STORY}' and version_no=3`); if (r !== "true,true") throw new Error(`times ${r}`);
  await page.goto(taskUrl(STORY), { waitUntil: "networkidle" });
  const t = (await page.getByTestId("task-output").innerText()).replace(/\s+/g, " ");
  if (!/Version 3 Approved/.test(t) || !/Attached: .*Asia\/Dubai/.test(t) || !/Approved: .*Asia\/Dubai by Lena Reviewer/.test(t)) throw new Error(`approved text: ${t.slice(0, 300)}`);
  await page.getByTestId(`output-history-${STORY}`).locator("summary").click();
  const h = (await page.getByTestId(`output-history-${STORY}`).innerText()).replace(/\s+/g, " ");
  if (!/Version 1 Changes requested.*Too dark, redo the second scene/.test(h) || !/Version 2 Replaced by a newer version/.test(h)) throw new Error(`history: ${h.slice(0, 300)}`);
  const hist = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/Output v1 submitted/.test(hist) || !/Output v3 submitted \(replacing v2\)/.test(hist) || !/v3 approved/.test(hist)) throw new Error("the task history lacks the output events");
  await page.screenshot({ path: `${SHOTS}/task-output-approved-desktop.png`, fullPage: true });
});

await step("the Deliverables register (Project Plan): grouped, filtered, with both times, a compact version history, and the milestone", async () => {
  await as(email(2)); await page.goto(`${BASE}/projects/${PRJ}/delivery?view=deliverables`, { waitUntil: "networkidle" });
  const reg = page.getByTestId("deliverables-register"); await reg.waitFor();
  const row = page.getByTestId(`deliverable-${STORY}`); const t = (await row.innerText()).replace(/\s+/g, " ");
  if (!/Storyboard Approved/.test(t) || !/Version 3/.test(t) || !/Attached: .*Asia\/Dubai/.test(t) || !/Approved: .*Asia\/Dubai/.test(t) || !/Ready for mockup/.test(t)) throw new Error(`row: ${t.slice(0, 300)}`);
  if ((await page.getByTestId("deliverables-filter-approved").innerText()).replace(/\s/g, "") !== "Approved1") throw new Error("approved count");
  if ((await page.getByTestId("deliverables-filter-missing").innerText()).replace(/\s/g, "") !== "Missing2") throw new Error("missing count (Moodboard and Logo animation)");
  await page.getByTestId("deliverables-filter-missing").click(); await page.waitForURL(/f=missing/);
  if (await page.getByTestId(`deliverable-${STORY}`).count()) throw new Error("the filter kept an approved row");
  for (const t of [MOOD, LOGO]) if (!(await page.getByTestId(`deliverable-${t}`).isVisible())) throw new Error("a task with no output is not listed as missing");
  await page.goto(`${BASE}/projects/${PRJ}/delivery?view=deliverables`, { waitUntil: "networkidle" });
  await page.getByTestId(`output-history-${STORY}`).locator("summary").click();
  await page.screenshot({ path: `${SHOTS}/deliverables-register-desktop.png`, fullPage: true });
  const prog = db(`select (select count(*) from proj_tasks where milestone_id='${MS}' and status='done') || '/' || (select count(*) from proj_tasks where milestone_id='${MS}')`);
  if (prog !== "1/2") throw new Error(`milestone progress ${prog}`);
  await page.goto(`${BASE}/projects/${PRJ}/work`, { waitUntil: "networkidle" });
  if (!/Ready for mockup/.test(await page.locator("body").innerText())) throw new Error("the milestone is not on the Work page");
});

await step("a restricted file is never opened through a reference: the assignee cannot choose it, the register and the export hide it from everyone but the manager", async () => {
  const secret = link("Confidential quote pack", true);
  const err = asDbErr(2, `select proj_submit_task_output('${MOOD}', '${secret}', null, 1, null, false, 'restricted-try-0001', null)`);
  if (!/not available to you/.test(err)) throw new Error(`the database allowed it: ${err.slice(0, 120)}`);
  // The Project Manager's own version goes to Operations, which cannot open restricted files: the database refuses it (a later change to Phase 2b).
  const pmErr = asDbErr(4, `select proj_submit_task_output('${MOOD}', '${secret}', null, 1, 'Manager submits', false, 'restricted-pm-0001', null)`);
  if (!/cannot open restricted files/.test(pmErr)) throw new Error(`a restricted file on a PM version was not refused: ${pmErr.slice(0, 120)}`);
  // A file that becomes restricted AFTER it was attached stays hidden in the register and the export for everyone but the manager.
  const later = link("Confidential later pack", false);
  asDb(2, `select proj_submit_task_output('${MOOD}', '${later}', null, 1, 'Assignee submits', false, 'restricted-later-0001', null)`);
  db(`update proj_files set restricted = true where id = '${later}'`);
  await as(email(2)); await page.goto(`${BASE}/projects/${PRJ}/delivery?view=deliverables`, { waitUntil: "networkidle" });
  const t = (await page.getByTestId(`deliverable-${MOOD}`).innerText());
  if (/Confidential/.test(t) || /docs\.example\.com/.test(t)) throw new Error("the restricted file leaked into the register");
  if (!/Restricted file \(the Project Manager can open it\)/.test(t)) throw new Error(`register text: ${t.slice(0, 200)}`);
  const csvA = await (await page.context().request.get(`${BASE}/api/projects/${PRJ}/deliverables/export`)).text();
  if (/Confidential/.test(csvA) || !/Storyboard/.test(csvA) || !/Restricted file/.test(csvA)) throw new Error(`assignee export: ${csvA.slice(0, 200)}`);
  await as("mgr"); const csvM = await (await page.context().request.get(`${BASE}/api/projects/${PRJ}/deliverables/export`)).text();
  if (!/Confidential later pack/.test(csvM)) throw new Error("the manager's export lacks the file name");
  const denied = await (await (await newPage(browser)).context().request.get(`${BASE}/api/projects/${PRJ}/deliverables/export`)).status();
  if (denied !== 401 && denied !== 307 && denied !== 302 && denied !== 200) throw new Error(`signed-out export status ${denied}`);
  await page.goto(`${BASE}/projects/${PRJ}/delivery?view=deliverables`, { waitUntil: "networkidle" });
  if (!/Confidential later pack/.test(await page.getByTestId(`deliverable-${MOOD}`).innerText())) throw new Error("the manager cannot see the file");
});

// ---------------------------------------------------------------------------------------------------- site
let REQ = "";
await step("RAF (Quick add): two runs in one save, a retry adds nothing, run 2's time stays 'to confirm'", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  await page.getByTestId("site-quick-add").click(); await dialog().waitFor();
  const rows = [
    ["setup", "Setup (run 1)", "Run 1", "Hall 3", "2027-11-11", "", "09:00-18:00", "confirmed"], ["show", "Show (run 1)", "Run 1", "Hall 3", "2027-11-12", "", "", "confirmed"],
    ["dismantling", "Dismantling (run 1)", "Run 1", "Hall 3", "2027-11-12", "", "20:00-23:30", "tentative"], ["setup", "Setup (run 2)", "Run 2", "Hall 3", "2027-11-13", "", "", "tentative"],
  ];
  for (let n = 0; n < rows.length; n++) {
    const [k, title, run, loc, start, end, time, st] = rows[n];
    await dialog().getByLabel(`Row ${n + 1} kind`).selectOption(k); await dialog().getByLabel(`Row ${n + 1} name`).fill(title); await dialog().getByLabel(`Row ${n + 1} run`).fill(run);
    await dialog().getByLabel(`Row ${n + 1} location`).fill(loc); await dialog().getByLabel(`Row ${n + 1} start date`).fill(start); await dialog().getByLabel(`Row ${n + 1} time`).fill(time); await dialog().getByLabel(`Row ${n + 1} state`).selectOption(st);
  }
  await dialog().getByRole("button", { name: "Add a row" }).click();
  await dialog().getByLabel("Row 5 kind").selectOption("show"); await dialog().getByLabel("Row 5 name").fill("Show (run 2)"); await dialog().getByLabel("Row 5 run").fill("Run 2"); await dialog().getByLabel("Row 5 location").fill("Hall 3");
  await dialog().getByLabel("Row 5 start date").fill("2027-11-14"); await dialog().getByLabel("Row 5 end date").fill("2027-11-15");
  await dialog().getByRole("button", { name: "Add activities" }).click();
  await until(() => db(`select count(*) from proj_plan_items where project_id='${PRJ}' and plan='site' and activity_kind is not null`) === "5");
  if (!/5 activities added/.test(await dialog().innerText())) throw new Error("no notice");
  const w = db(`select string_agg(title || '=' || coalesce(to_char(starts_at at time zone 'Asia/Dubai', 'DD HH24:MI'), start_date::text), ' | ' order by sort_order, title) from proj_plan_items where project_id='${PRJ}' and plan='site' and activity_kind is not null`);
  if (!/Setup \(run 1\)=11 09:00/.test(w) || !/Setup \(run 2\)=2027-11-13/.test(w)) throw new Error(w);
  await dialog().getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByTestId("site-quick-add").click(); await dialog().waitFor();
  const again = [["setup", "Setup (run 1)", "Run 1", "Hall 3", "2027-11-11"], ["show", "Show (run 1)", "Run 1", "Hall 3", "2027-11-12"]];
  for (let n = 0; n < again.length; n++) { const [k, title, run, loc, start] = again[n]; await dialog().getByLabel(`Row ${n + 1} kind`).selectOption(k); await dialog().getByLabel(`Row ${n + 1} name`).fill(title); await dialog().getByLabel(`Row ${n + 1} run`).fill(run); await dialog().getByLabel(`Row ${n + 1} location`).fill(loc); await dialog().getByLabel(`Row ${n + 1} start date`).fill(start); }
  await dialog().getByRole("button", { name: "Add activities" }).click();
  await until(async () => /left as they are|nothing was added twice/.test(await dialog().innerText()));
  if (db(`select count(*) from proj_plan_items where project_id='${PRJ}' and plan='site' and activity_kind is not null`) !== "5") throw new Error("the retry added activities");
});

await step("RAF: the schedule shows both runs separately with exact dates, the missing time and crew with direct fixes, and the crew is set per run", async () => {
  await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const r1 = page.getByTestId("site-run-Run 1"), r2 = page.getByTestId("site-run-Run 2");
  const t1 = (await r1.innerText()).replace(/\s+/g, " "), t2 = (await r2.innerText()).replace(/\s+/g, " ");
  if (!/Setup \(run 1\).*11 Nov, 09:00–18:00 Asia\/Dubai/.test(t1) || !/Dismantling \(run 1\).*12 Nov, 20:00–23:30 Asia\/Dubai/.test(t1)) throw new Error(`run 1: ${t1.slice(0, 300)}`);
  if (!/Setup \(run 2\).*13 Nov \(time to confirm\)/.test(t2) || !/Show \(run 2\).*14–15 Nov \(time to confirm\)/.test(t2) || /Setup \(run 1\)/.test(t2)) throw new Error(`run 2: ${t2.slice(0, 300)}`);
  if (!/Time to confirm/.test(t2) || !/No crew/.test(t2)) throw new Error("run 2 does not say what is missing");
  const id2 = db(`select id from proj_plan_items where project_id='${PRJ}' and title='Setup (run 2)'`), id1 = db(`select id from proj_plan_items where project_id='${PRJ}' and title='Setup (run 1)'`);
  await page.getByTestId(`site-missing-${id2}`).getByRole("button", { name: "Assign crew" }).click(); await dialog().waitFor();
  await dialog().getByLabel("Crew 1 person").selectOption({ label: "Cara Assignee" }); await dialog().getByLabel("Crew 1 role").selectOption("installation");
  await dialog().getByRole("button", { name: "Add a person" }).click(); await dialog().getByLabel("Crew 2 person").selectOption({ label: "Lena Reviewer" }); await dialog().getByLabel("Crew 2 role").selectOption("backup");
  await dialog().getByRole("button", { name: "Save crew" }).click();
  await until(() => db(`select count(*) from proj_site_crew where plan_item_id='${id2}'`) === "2");
  asDb(4, `select proj_set_site_crew('${id1}', '[{"user_id":"${U}2","role":"installation"},{"user_id":"${U}7","role":"installation"}]'::jsonb)`);
  await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const c2 = await page.getByTestId(`site-crew-text-${id2}`).innerText(); if (!/Installation: Cara Assignee/.test(c2) || !/Backup: Lena Reviewer/.test(c2)) throw new Error(c2);
  await page.screenshot({ path: `${SHOTS}/site-schedule-desktop.png`, fullPage: true });
});

await step("an overseas shipment that arrives after its setup is flagged, with each leg in its own zone and Inventory's state read from the linked request", async () => {
  REQ = db(`select id from inv_requests where project_id='${PRJ}' and status <> 'cancelled' limit 1`);
  if (!REQ) REQ = asDb(4, `select inv_create_request('project', '${PRJ}', null, 'RAF kit')`);
  const id1 = db(`select id from proj_plan_items where project_id='${PRJ}' and title='Setup (run 1)'`);
  await page.getByTestId("site-add-shipment").click(); await dialog().waitFor();
  await dialog().getByLabel("Name").fill("Equipment from Mumbai"); await dialog().getByLabel("Supports this setup").selectOption(id1);
  await dialog().getByLabel("Equipment request").selectOption(REQ);
  await dialog().getByLabel("Departs", { exact: true }).fill("2027-11-09T08:00"); await dialog().getByLabel("Departs: time zone").selectOption("Asia/Kolkata");
  await dialog().getByLabel("Expected arrival", { exact: true }).fill("2027-11-11T15:00"); await dialog().getByLabel("Expected arrival: time zone").selectOption("Asia/Dubai");
  await dialog().getByLabel("Carrier").fill("Fictional Freight");
  await dialog().getByRole("button", { name: "Add shipment" }).click();
  await until(() => db(`select count(*) from proj_site_shipments where project_id='${PRJ}'`) === "1");
  await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const sh = db(`select id from proj_site_shipments where project_id='${PRJ}'`);
  const legs = (await page.getByTestId(`ship-legs-${sh}`).innerText()).replace(/\s+/g, " ");
  if (!/Departs 9 Nov, 08:00 Asia\/Kolkata/.test(legs) || !/Arrives 11 Nov, 15:00 Asia\/Dubai/.test(legs)) throw new Error(legs);
  const c = (await page.getByTestId(`ship-conflict-${sh}`).innerText()); if (!/Arrives too late: it arrives after Setup \(run 1\) starts/.test(c)) throw new Error(c);
  const inv = await page.getByTestId(`ship-inventory-${sh}`).innerText(); if (!/Not submitted to the warehouse|Reserved|Sent|Short|Partly|Returned/.test(inv)) throw new Error(`inventory state "${inv}"`);
  const reqState = db(`select status from inv_requests where id='${REQ}'`); // Inventory is the source: nothing here changed the request
  if (!/draft|submitted|in_progress|fulfilled/.test(reqState)) throw new Error(`request status ${reqState}`);
  await page.screenshot({ path: `${SHOTS}/shipment-conflict-desktop.png`, fullPage: true });
  await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=timeline`, { waitUntil: "networkidle" });
  await page.getByTestId("site-timeline-scroll").waitFor();
  for (const d of ["2027-11-09", "2027-11-12", "2027-11-15"]) if (!(await page.getByTestId(`site-col-${d}`).isVisible().catch(() => false))) throw new Error(`no day column ${d}`);
  const bar = await page.locator('[data-testid^="site-bar-"]').count(); if (bar < 5) throw new Error(`only ${bar} bars`);
  await page.screenshot({ path: `${SHOTS}/site-timeline-desktop.png`, fullPage: true });
});

await step("a confirmed activity's date cannot change silently (database refuses; the screen asks why)", async () => {
  const id = db(`select id from proj_plan_items where project_id='${PRJ}' and title='Show (run 1)'`);
  const err = asDbErr(4, `select proj_save_site_activity('${PRJ}', '${id}', '{"start_date":"2027-11-13","end_date":"2027-11-13"}'::jsonb)`);
  if (!/This activity is confirmed. Say why/.test(err)) throw new Error(err.slice(0, 120));
});

await step("the Work overview: next on site, what needs attention (with who can act) linking to the right records, recent changes", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects/${PRJ}/work`, { waitUntil: "networkidle" });
  const ov = page.getByTestId("work-overview"); await ov.waitFor();
  const next = (await page.getByTestId("overview-next").innerText()).replace(/\s+/g, " ");
  if (!/Setup \(run 1\)/.test(next) || !/11 Nov, 09:00–18:00 Asia\/Dubai/.test(next) || !/Confirmed/.test(next) || !/Hall 3/.test(next)) throw new Error(`next on site: ${next}`);
  const att = (await page.getByTestId("overview-attention").innerText()).replace(/\s+/g, " ");
  if (!/Needs attention/.test(att) || !/Who can act:/.test(att)) throw new Error(`attention: ${att.slice(0, 300)}`);
  for (const k of ["shipment_conflict", "output_missing", "site_missing"]) if (!(await page.getByTestId(`attention-${k}`).count())) throw new Error(`no ${k} line`);
  const sh = db(`select id from proj_site_shipments where project_id='${PRJ}'`);
  const href = await page.getByTestId("attention-shipment_conflict").getByRole("link").first().getAttribute("href"); if (href !== `/projects/${PRJ}/plan?plan=site&mode=list#ship-${sh}`) throw new Error(`conflict link ${href}`);
  const hrefs = await page.getByTestId("attention-output_missing").getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  if (!hrefs.some((h) => new RegExp(`/projects/${PRJ}/work\\?task=${LOGO}`).test(h ?? ""))) throw new Error(`output links ${hrefs}`);
  const rec = (await page.getByTestId("overview-recent").innerText()).replace(/\s+/g, " ");
  if (!/added the shipment Equipment from Mumbai/.test(rec) || !/updated the crew of Setup/.test(rec) || !/Asia\/Dubai/.test(rec)) throw new Error(`recent: ${rec.slice(0, 300)}`);
  await page.getByTestId("attention-shipment_conflict").getByRole("link").first().click(); await page.waitForURL(/plan\?plan=site/); await page.waitForLoadState("networkidle");
  await page.getByTestId(`ship-conflict-${sh}`).waitFor({ timeout: 30000 }).catch(() => { throw new Error("the link did not land on the shipment"); });
  await page.goto(`${BASE}/projects/${PRJ}/work`, { waitUntil: "networkidle" }); await page.screenshot({ path: `${SHOTS}/work-overview-desktop.png` });
});

await step("phone: task output, register, site schedule and Work overview fit without sideways scroll", async () => {
  await as(email(2), { width: 390, height: 844 });
  for (const [what, url, tid] of [["task", taskUrl(MOOD), "task-output"], ["register", `${BASE}/projects/${PRJ}/delivery?view=deliverables`, "deliverables-register"], ["site", `${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, "site-schedule"], ["overview", `${BASE}/projects/${PRJ}/work`, "work-overview"]]) {
    await page.goto(url, { waitUntil: "networkidle" }); await page.getByTestId(tid).waitFor(); await noOverflow(what);
    await page.screenshot({ path: `${SHOTS}/${what}-phone.png`, fullPage: true });
  }
  await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=timeline`, { waitUntil: "networkidle" }); await noOverflow("site timeline");
  const sticky = await page.locator('[data-testid^="site-tl-row-"]').first().locator("div").first().evaluate((e) => getComputedStyle(e).position); if (sticky !== "sticky") throw new Error("the names do not stay in view");
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
