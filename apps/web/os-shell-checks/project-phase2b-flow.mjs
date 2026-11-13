// Real-browser check of the Projects Phase 2 follow-up (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build.
// Fictional data. A new Project Manager sets up the project team (Content and Programming, one lead named, one still needed), reopens setup without duplicates, and submits an output
// that a DIFFERENT eligible Operations Manager reviews (with the dual-role refusal, an old version link, and "Needs an Operations reviewer"); then one installation with a project member and a
// site-only technician: the technician sees only their own assignment, cannot open the project's chat, tasks, files or exports by direct link, and loses the assignment when it is removed.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/p2b-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
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
const dialog = () => page.getByRole("dialog").last();
const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const noOverflow = async (what) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };

// People: a4 mgr = Project Manager; a2 hr (Cara) = assignee and ALSO an Operations Manager (the dual role); a1 hr1 and a6 admin = Operations Managers; a7 lead (Lena) = Programming lead;
// a5 emp = a company employee with no Projects access (the site-only technician); a3 ceo = founder.
const WHEN = db("select (current_date + 6)::text");
let PRJ = "", T1 = "", T2 = "", T3 = "", V1 = "", ACT = "";
const workUrl = () => `${BASE}/projects/${PRJ}/work`;
const taskUrl = (t, v) => `${BASE}/projects/${PRJ}/work?task=${t}${v ? `&version=${v}` : ""}`;

await step("setup: a new project with no team, two Operations Managers, one assignee who also holds the Operations role", async () => {
  PRJ = asDb(3, `select proj_create_internal_project('${CO}', 'Follow-up Expo (fictional)', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional follow-up project')`);
  db(`update profiles set full_name = 'Cara Assignee' where id = '${U}2'; update profiles set full_name = 'Lena Lead' where id = '${U}7'; update profiles set full_name = 'Olga Ops' where id = '${U}1'; update profiles set full_name = 'Omar Ops' where id = '${U}6'; update profiles set full_name = 'Tariq Technician' where id = '${U}5'`);
  db(`update proj_company_grants set capabilities = '{operations}' where user_id in ('${U}1', '${U}2') and company_id = '${CO}' and revoked_at is null`);
  db(`insert into proj_company_grants (user_id, company_id, capabilities) select '${U}6', '${CO}', '{operations}' where not exists (select 1 from proj_company_grants where user_id = '${U}6' and company_id = '${CO}' and revoked_at is null)`);
  db(`insert into proj_company_grants (user_id, company_id, capabilities) select '${U}5', '${CO}', '{}' where false`);   // emp has NO Projects access, deliberately
  if (db(`select count(*) from proj_teams where project_id = '${PRJ}'`) !== "0") throw new Error("the new project already has teams");
  if (db(`select count(*) from employees where user_id = '${U}5' and company_id = '${CO}'`) === "0") throw new Error("the technician is not an employee of the company (the seed changed?)");
});

await as("mgr");
await step("Work for a new project: Set up your project team is the first thing on the page", async () => {
  await page.goto(workUrl(), { waitUntil: "networkidle" });
  const card = page.getByTestId("team-setup-card"); await card.waitFor();
  const y = async (id) => (await page.getByTestId(id).first().boundingBox())?.y ?? Infinity;
  if (!((await y("team-setup-card")) < (await y("work-summary")))) throw new Error("the team setup is not above the rest of Work");
  if (!/Set up your project team/.test(await card.innerText())) throw new Error("heading");
  await page.screenshot({ path: `${SHOTS}/team-setup-card-desktop.png`, fullPage: true });
});

await step("choose Content and Programming, a lead for Programming only: Lead needed is flagged, the lead's project access is explicit, and saving needs that confirmed", async () => {
  await page.getByTestId("team-setup-open").click(); await dialog().waitFor();
  const save = dialog().getByRole("button", { name: "Save team" });
  if (!(await save.isDisabled())) throw new Error("Save is enabled with nothing chosen");
  await dialog().getByTestId("ts-preset-content").check(); await dialog().getByTestId("ts-preset-programming").check();
  if (!/Programming Lead/.test(await dialog().innerText()) || !/Content Lead/.test(await dialog().innerText())) throw new Error("leads are not labelled by team");
  if ((await dialog().getByText("Lead needed").count()) < 2) throw new Error("Lead needed is not flagged for both teams yet");
  await dialog().getByTestId("ts-lead-programming").selectOption(`${U}7`);
  const access = dialog().getByTestId("ts-access"); await access.waitFor();
  if (!/Lena Lead/.test(await access.innerText()) || !/workspace, tasks, files and Project Chat/.test(await access.innerText())) throw new Error(`access text: ${await access.innerText()}`);
  if (!(await save.isDisabled())) throw new Error("Save is enabled before the access is confirmed");
  await page.screenshot({ path: `${SHOTS}/team-setup-dialog-desktop.png` });
  await dialog().getByTestId("ts-confirm").check();
  await save.click();
  await until(() => db(`select count(*) from proj_teams where project_id = '${PRJ}' and removed_at is null`) === "2");
  await until(async () => /2 teams created/.test(await dialog().innerText()));                      // the database row lands before the notice is drawn
  const t = await dialog().innerText();
  if (!/2 teams created/.test(t) || !/Lead needed: Content/.test(t)) throw new Error(`notice: ${t.slice(0, 200)}`);
  if (db(`select head_user_id from proj_teams where project_id = '${PRJ}' and name = 'Programming'`) !== `${U}7`) throw new Error("Programming lead");
  if (db(`select count(*) from proj_teams where project_id = '${PRJ}' and name = 'Content' and head_user_id is null`) !== "1") throw new Error("Content should have no lead yet");
  if (db(`select count(*) from proj_project_members where project_id = '${PRJ}' and user_id = '${U}7' and removed_at is null`) !== "1") throw new Error("the confirmed lead was not added");
});

await step("setup is complete enough to summarise: a compact Project team with Lead needed, a visible Manage team, and no setup card", async () => {
  await page.goto(workUrl(), { waitUntil: "networkidle" });
  if (await page.getByTestId("team-setup-card").count()) throw new Error("the setup card is still shown");
  const s = await page.getByTestId("team-summary").innerText();
  if (!/Programming.*Programming Lead: Lena Lead/s.test(s) || !/Content.*Lead needed/s.test(s)) throw new Error(`summary: ${s}`);
  if (!(await page.getByTestId("team-manage-open").isVisible())) throw new Error("Manage team is not visible");
  await page.screenshot({ path: `${SHOTS}/team-summary-desktop.png`, fullPage: true });
});

await step("reopening setup never duplicates a team or replaces a lead: the existing teams are shown as they are and only the missing lead can be filled", async () => {
  await page.getByTestId("team-manage-open").click(); await dialog().waitFor();
  const save = dialog().getByRole("button", { name: "Save team" });
  if (!(await save.isDisabled())) throw new Error("Save is enabled with nothing to save");
  if (!(await dialog().getByTestId("ts-preset-content").isDisabled()) || !(await dialog().getByTestId("ts-preset-content").isChecked())) throw new Error("Content should be shown as already on the project");
  if (!/Lena Lead.*set/s.test(await dialog().getByTestId("ts-existing-programming").innerText())) throw new Error("Programming's lead should be shown as set, not editable");
  if (await dialog().getByTestId("ts-existing-programming").locator("select").count()) throw new Error("an existing lead can be replaced from here");
  await dialog().getByTestId("ts-lead-content").selectOption(`${U}2`);
  await dialog().getByTestId("ts-confirm").check();
  await save.click();
  await until(() => db(`select head_user_id from proj_teams where project_id = '${PRJ}' and name = 'Content'`) === `${U}2`);
  if (db(`select count(*) from proj_teams where project_id = '${PRJ}' and removed_at is null`) !== "2") throw new Error("a team was duplicated");
  if (db(`select head_user_id from proj_teams where project_id = '${PRJ}' and name = 'Programming'`) !== `${U}7`) throw new Error("an existing lead was overwritten");
  // a retry of the same request (a double submit, a dropped connection) changes nothing
  const again = asDb(4, `select proj_setup_teams('${PRJ}', '[{"name":"Content","preset":"content","lead_user_id":"${U}7"},{"name":"programming"}]'::jsonb, true)`);
  if (!/"created": 0/.test(again) || db(`select count(*) from proj_teams where project_id = '${PRJ}' and removed_at is null`) !== "2" || db(`select head_user_id from proj_teams where project_id = '${PRJ}' and name = 'Content'`) !== `${U}2`) throw new Error(`retry changed something: ${again}`);
});

await step("a Site / Installation team enrols nobody; the People page says Project team and names leads by team", async () => {
  const before = db(`select count(*) from proj_project_members where project_id = '${PRJ}' and removed_at is null`);
  await page.goto(workUrl(), { waitUntil: "networkidle" });
  await page.getByTestId("team-manage-open").click(); await dialog().waitFor();
  await dialog().getByTestId("ts-preset-site_installation").check();
  if (!/adds no technicians/.test(await dialog().getByTestId("ts-site-note").innerText())) throw new Error("the site team note is missing");
  await dialog().getByRole("button", { name: "Save team" }).click();
  await until(() => db(`select count(*) from proj_teams where project_id = '${PRJ}' and name like 'Site%'`) === "1");
  if (db(`select count(*) from proj_project_members where project_id = '${PRJ}' and removed_at is null`) !== before) throw new Error("choosing the site team changed the roster");
  if (db(`select count(*) from proj_project_members where project_id = '${PRJ}' and user_id = '${U}5'`) !== "0") throw new Error("a technician was enrolled");
  await page.goto(`${BASE}/projects/${PRJ}/people`, { waitUntil: "networkidle" });
  const t = await body();
  if (!/Project teams/.test(t) || /Department teams/.test(t) || !/Programming Lead/.test(t) || !/Site \/ Installation/.test(t)) throw new Error(`people page: ${t.slice(0, 300)}`);
  if (/Department/.test(await page.getByRole("table").first().innerText())) throw new Error("a Department column is still shown");
});

await step("setup: a task assigned to Cara (who also holds the Operations role) with a required output", async () => {
  T1 = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Logo reveal","assignee_id":"${U}2","requires_review":true,"due_date":"${WHEN}"}'::jsonb)`);
  asDb(4, `select proj_set_task_output('${T1}', 'Logo reveal', 1, true, null)`);
});

await step("the Project Manager submits a version on Cara's task: it goes to Operations (Awaiting Operations review), never to the PM or team lead", async () => {
  await as("mgr"); await page.goto(taskUrl(T1), { waitUntil: "networkidle" });
  await page.getByTestId("output-submit-open").click(); await dialog().waitFor();
  await dialog().getByRole("tab", { name: "Add a link" }).click();
  await dialog().getByLabel("Link (https://)").fill("https://docs.example.com/logo-reveal-v1"); await dialog().getByLabel("Name for the link (optional)").fill("Logo reveal v1");
  await dialog().getByTestId("output-submit-go").click();
  await until(() => db(`select count(*) from proj_task_output_versions where task_id = '${T1}'`) === "1");
  V1 = db(`select id from proj_task_output_versions where task_id = '${T1}' and version_no = 1`);
  if (db(`select review_route from proj_task_output_versions where id = '${V1}'`) !== "operations") throw new Error("not routed to Operations");
  await page.goto(taskUrl(T1), { waitUntil: "networkidle" });
  const st = await page.getByTestId("output-version-state-1").innerText();
  if (!/Awaiting Operations review/.test(st)) throw new Error(`state: ${st}`);
  if (await page.getByTestId("output-review-open").count()) throw new Error("the PM was offered the review of their own submission");
  if (!(await page.getByTestId("output-assign-reviewer").isVisible())) throw new Error("the PM has no way to assign a reviewer");
  await page.screenshot({ path: `${SHOTS}/output-awaiting-operations-desktop.png`, fullPage: true });
});

await step("the team lead and the assignee are not offered the review; the dual-role assignee (an Operations Manager) is refused by the database and the screen", async () => {
  await as("lead"); await page.goto(taskUrl(T1), { waitUntil: "networkidle" });
  if (await page.getByTestId("output-review-open").count()) throw new Error("the team lead was offered the review");
  await as(`${"hr"}`); await page.goto(taskUrl(T1), { waitUntil: "networkidle" });
  if (await page.getByTestId("output-review-open").count()) throw new Error("the assignee who holds the Operations role was offered the review");
  const err = asDbErr(2, `select proj_decide_task_output('${V1}', 'approved', null)`);
  if (!/cannot review your own work/.test(err)) throw new Error(`the database allowed it: ${err.slice(0, 160)}`);
  const err2 = asDbErr(4, `select proj_decide_task_output('${V1}', 'approved', null)`);
  if (!/cannot review your own work/.test(err2)) throw new Error(`the submitter was allowed: ${err2.slice(0, 160)}`);
  const err3 = asDbErr(7, `select proj_decide_task_output('${V1}', 'approved', null)`);
  if (!/Operations Manager/.test(err3)) throw new Error(`the team lead was allowed: ${err3.slice(0, 160)}`);
  if (db(`select status from proj_task_output_versions where id = '${V1}'`) !== "awaiting") throw new Error("a refused decision changed the version");
});

await step("the review is in an Operations Manager's My Day and in the Operations decision queue, each linking to the exact version", async () => {
  await as("admin"); await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const link = page.locator(`a[href*="task=${T1}&version=${V1}"]`).first();
  await link.waitFor({ timeout: 20000 });
  if (!/Operations review/.test(await body())) throw new Error("My Day does not say it is an Operations review");
  await page.goto(`${BASE}/operations?company=${CO}`, { waitUntil: "networkidle" });
  const t = await body();
  if (!/Output waiting for Operations review/.test(t) || !/Logo reveal/.test(t)) throw new Error(`queue: ${t.slice(0, 300)}`);
  await page.locator(`a[href*="task=${T1}&version=${V1}"]`).first().click();
  await page.waitForURL(new RegExp(`task=${T1}&version=${V1}`));
  await page.getByTestId("output-review-open").waitFor();
  await page.screenshot({ path: `${SHOTS}/operations-review-desktop.png`, fullPage: true });
});

await step("a different eligible Operations Manager approves it; the reviewer's name shows and the approval time is separate", async () => {
  await page.getByTestId("output-review-open").click(); await dialog().waitFor();
  await dialog().getByRole("button", { name: "Approve this version" }).click();
  await until(() => db(`select status from proj_task_output_versions where id = '${V1}'`) === "approved");
  if (db(`select approved_by from proj_task_output_versions where id = '${V1}'`) !== `${U}6`) throw new Error("approved by the wrong person");
  await as("mgr"); await page.goto(taskUrl(T1), { waitUntil: "networkidle" });
  const t = (await page.getByTestId("task-output").innerText()).replace(/\s+/g, " ");
  if (!/Version 1 Approved/.test(t) || !/Approved: .* by Omar Ops/.test(t)) throw new Error(`panel: ${t.slice(0, 260)}`);
});

await step("a new version has its own review, and a link to the old version never approves the newer one", async () => {
  T2 = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Teaser","assignee_id":"${U}2","requires_review":true,"due_date":"${WHEN}"}'::jsonb)`);
  asDb(4, `select proj_set_task_output('${T2}', 'Teaser', 1, true, null)`);
  const f1 = db(`insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${PRJ}', 'link', 'document', 'Teaser v1', 'https://docs.example.com/teaser-1', false, '${U}4') returning id`).split("\n")[0];
  const f2 = db(`insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${PRJ}', 'link', 'document', 'Teaser v2', 'https://docs.example.com/teaser-2', false, '${U}4') returning id`).split("\n")[0];
  const v1 = JSON.parse(asDb(4, `select proj_submit_task_output('${T2}', '${f1}', null, 1, null, false, 'teaser-attempt-1', null)`)).id;
  asDb(4, `select proj_submit_task_output('${T2}', '${f2}', null, 1, null, false, 'teaser-attempt-2', null)`);
  await as("hr1"); await page.goto(taskUrl(T2, v1), { waitUntil: "networkidle" });
  const n = await page.getByTestId("output-version-stale").innerText();
  if (!/Version 1 is no longer the current one: version 2/.test(n)) throw new Error(`notice: ${n}`);
  const err = asDbErr(1, `select proj_decide_task_output('${v1}', 'approved', null)`);
  if (!/no longer the current one|already decided/.test(err)) throw new Error(`the old version could be approved: ${err.slice(0, 160)}`);
  if (db(`select count(*) from proj_task_output_versions where task_id = '${T2}' and status = 'approved'`) !== "0") throw new Error("an old link approved something");
  const v2 = db(`select id from proj_task_output_versions where task_id = '${T2}' and version_no = 2`);
  asDb(1, `select proj_decide_task_output('${v2}', 'approved', null)`);
  if (db(`select status from proj_task_output_versions where id = '${v2}'`) !== "approved") throw new Error("v2 did not get its own review");
});

await step("with nobody else eligible the version says Needs an Operations reviewer, tells the PM how to resolve it, and the Work overview and Operations queue flag it", async () => {
  db(`update proj_company_grants set revoked_at = now() where user_id in ('${U}1', '${U}6') and company_id = '${CO}' and revoked_at is null`);
  T3 = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Closing sting","assignee_id":"${U}2","requires_review":true,"due_date":"${WHEN}"}'::jsonb)`);
  asDb(4, `select proj_set_task_output('${T3}', 'Closing sting', 1, true, null)`);
  const f = db(`insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${PRJ}', 'link', 'document', 'Sting v1', 'https://docs.example.com/sting-1', false, '${U}4') returning id`).split("\n")[0];
  asDb(4, `select proj_submit_task_output('${T3}', '${f}', null, 1, null, false, 'sting-attempt-0001', null)`);
  await as("mgr"); await page.goto(taskUrl(T3), { waitUntil: "networkidle" });
  const a = await page.getByTestId("output-needs-reviewer").innerText();
  if (!/Needs an Operations reviewer/.test(a) || !/People & Access/.test(a)) throw new Error(`alert: ${a}`);
  await page.goto(workUrl(), { waitUntil: "networkidle" });
  if (!(await page.getByTestId("attention-ops_reviewer_needed").count())) throw new Error("the Work overview does not flag it");
  await as("hr"); await page.goto(`${BASE}/operations?company=${CO}`, { waitUntil: "networkidle" });
  if (!/Needs an Operations reviewer/.test(await body())) throw new Error("the Operations queue does not flag it");
  db(`update proj_company_grants set revoked_at = null where user_id in ('${U}1', '${U}6') and company_id = '${CO}'`);
});

await step("one installation: a project member and a site-only technician assigned from the Site schedule, with call time and instructions", async () => {
  ACT = JSON.parse(asDb(4, `select proj_save_site_activity('${PRJ}', null, '${JSON.stringify({ activity_kind: "setup", title: "Setup (run 1)", location: "Hall 3", start_date: WHEN, end_date: WHEN, starts_local: `${WHEN}T09:00`, ends_local: `${WHEN}T18:00`, activity_state: "confirmed" })}'::jsonb)`)).id;
  asDb(4, `select proj_add_member('${PRJ}', '${U}2', null)`);
  await as("mgr"); await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  await page.getByTestId(`site-crew-${ACT}`).first().click(); await dialog().waitFor();
  if (!/site-only/.test(await dialog().getByTestId("crew-site-only-note").innerText())) throw new Error("the site-only note is missing");
  const sel = dialog().getByLabel("Crew 1 person");
  await sel.selectOption(`${U}2`);
  await dialog().getByRole("button", { name: "Add a person" }).click();
  await dialog().getByLabel("Crew 2 person").selectOption(`${U}5`);
  await dialog().locator("input[name=crewCall]").nth(1).fill(`${WHEN}T07:30`);
  await dialog().locator("input[name=crewNote]").nth(1).fill("Meet at gate 2 with your safety shoes");
  await dialog().getByRole("button", { name: "Save crew" }).click();
  await until(() => db(`select count(*) from proj_site_crew where plan_item_id = '${ACT}'`) === "2");
  if (db(`select count(*) from proj_project_members where project_id = '${PRJ}' and user_id = '${U}5'`) !== "0") throw new Error("the technician became a project member");
  await page.reload({ waitUntil: "networkidle" });
  if (!/Tariq Technician \(site-only\)/.test(await body())) throw new Error("the schedule does not mark the technician as site-only");
  asDb(4, `select proj_set_activity_readiness('${ACT}', '{"hardware":"ready","content":"not_ready","app":"unknown","note":"Final video due Thursday","crew_instructions":"Park at the loading bay"}'::jsonb)`);
});

await step("the site-only technician sees their own assignment (activity, role, venue, call time, instructions, readiness) on My Day and My site assignments, and nothing else", async () => {
  await as("emp"); await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (!(await page.getByTestId("my-day-site-assignments").isVisible())) throw new Error("no On site next card on My Day");
  await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  const card = page.getByTestId(`site-assignment-${ACT}`); await card.waitFor();
  const t = (await card.innerText()).replace(/\s+/g, " ");
  for (const re of [/Setup \(run 1\)/, /Installation/, /Hall 3/, /07:30/, /Meet at gate 2/, /Park at the loading bay/, /Hardware: ready/, /Content: not ready/, /Final video due Thursday/, /assigned to this activity only/]) if (!re.test(t)) throw new Error(`missing ${re}: ${t.slice(0, 300)}`);
  if (/Follow-up Expo.*(budget|price|client)/i.test(t)) throw new Error("commercial words on the assignment");
  await page.screenshot({ path: `${SHOTS}/site-assignment-desktop.png`, fullPage: true });
  await as("emp", { width: 390, height: 844 }); await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  await page.getByTestId(`site-assignment-${ACT}`).waitFor(); await noOverflow("site assignments (phone)");
  await page.screenshot({ path: `${SHOTS}/site-assignment-phone.png`, fullPage: true });
});

await step("the assignment grants no chat, detailed tasks, files, reviews or exports: every direct link is denied", async () => {
  await as("emp");
  const probes = [`/projects/${PRJ}/work`, `/projects/${PRJ}/work/tasks/${T1}`, `/projects/${PRJ}/discussion`, `/projects/${PRJ}/documents`, `/projects/${PRJ}/delivery?view=deliverables`, `/projects/${PRJ}/plan?plan=site`, `/projects/${PRJ}/people`, `/projects/${PRJ}/budget`];
  for (const p of probes) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    const t = await body();
    if (/Follow-up Expo|Logo reveal|Storyboard|Setup \(run 1\)|Hall 3|Gate 2/i.test(t)) throw new Error(`${p} leaked project content to the site-only technician`);
  }
  const ex = await page.context().request.get(`${BASE}/api/projects/${PRJ}/deliverables/export`);
  if (ex.status() === 200) throw new Error("the register export opened for the site-only technician");
  if (db(`select count(*) from proj_tasks where project_id = '${PRJ}'`) === "0") throw new Error("test setup: no tasks to leak");
  const chatErr = asDbErr(5, `select chat_project_group('${PRJ}')`);
  if (!/not a member/.test(chatErr)) throw new Error(`project chat was reachable: ${chatErr.slice(0, 120)}`);
});

await step("removing the assignment ends the access: the technician's list is empty", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects/${PRJ}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  asDb(4, `select proj_set_site_crew('${ACT}', '[{"user_id":"${U}2","role":"installation"}]'::jsonb, null)`);
  await as("emp"); await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  if (!/Nothing assigned to you on site/.test(await body())) throw new Error("the revoked assignment is still shown");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (await page.getByTestId("my-day-site-assignments").count()) throw new Error("My Day still shows the revoked assignment");
});

await step("the technician's employment ends (the sign-in stays active): the old assignment stops showing; restored employment shows it again", async () => {
  asDb(4, `select proj_set_site_crew('${ACT}', '[{"user_id":"${U}2","role":"installation"},{"user_id":"${U}5","role":"installation"}]'::jsonb, null)`);
  await as("emp"); await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  if (/Nothing assigned to you on site/.test(await body())) throw new Error("the assignment is not shown before employment ends");
  db(`update employees set employment_status = 'terminated' where user_id = '${U}5'`);
  if (db(`select is_active from profiles where id = '${U}5'`) !== "t") throw new Error("test setup: the sign-in should stay active");
  await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  if (!/Nothing assigned to you on site/.test(await body())) throw new Error("the assignment still shows after employment ended");
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (await page.getByTestId("my-day-site-assignments").count()) throw new Error("My Day still shows the assignment after employment ended");
  db(`update employees set employment_status = 'active' where user_id = '${U}5'`);
  await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
  if (/Nothing assigned to you on site/.test(await body())) throw new Error("restored employment did not restore the assignment");
});

await step("a Project Manager version already waiting from the first Phase 2 migration (team route) can be sent to Operations without a new upload", async () => {
  T3 = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Legacy pending output","assignee_id":"${U}2","requires_review":true,"due_date":"${WHEN}"}'::jsonb)`);
  asDb(4, `select proj_set_task_output('${T3}', 'Legacy pending output', 1, true, null)`);
  const F = db(`insert into proj_files (project_id, kind, purpose, label, url, restricted, uploaded_by) values ('${PRJ}', 'link', 'document', 'Legacy pending', 'https://docs.example.com/legacy-pending', false, '${U}4') returning id`).split("\n")[0];
  const VL = db(`insert into proj_task_output_versions (project_id, task_id, version_no, file_id, item_count, submitted_by, status) values ('${PRJ}', '${T3}', 1, '${F}', 1, '${U}4', 'awaiting') returning id`).split("\n")[0];
  if (db(`select review_route from proj_task_output_versions where id = '${VL}'`) !== "team") throw new Error("test setup: the legacy row should start on the team route");
  await as("mgr"); await page.goto(taskUrl(T3), { waitUntil: "networkidle" });
  await page.getByTestId("output-reroute").click(); await dialog().waitFor();
  await dialog().getByRole("button", { name: "Send to Operations" }).click();
  await until(() => db(`select review_route from proj_task_output_versions where id = '${VL}'`) === "operations");
  await page.goto(taskUrl(T3), { waitUntil: "networkidle" });
  if (!/Awaiting Operations review/.test(await page.getByTestId("output-version-state-1").innerText())) throw new Error("the version does not say Awaiting Operations review");
  if (await page.getByTestId("output-reroute").count()) throw new Error("the button is still offered after the version was sent");
  if (db(`select count(*) from proj_task_output_versions where task_id = '${T3}'`) !== "1") throw new Error("a new version was created instead of rerouting");
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
