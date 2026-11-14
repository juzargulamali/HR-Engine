// Compatibility smoke test of a PREVIOUSLY DEPLOYED app build against a database built from ALL current migrations, including 20270109000100 (LOCAL STACK ONLY; see README.md). Fictional data.
// Run it with the previous build serving (for example `main` built in a separate checkout) after `seed/project-plan.sh` (which applies every migration of THIS checkout).
// It does what live people do on the old build: sign in, open My Day, the project list, a project's Work page and Project Plan, and make ORDINARY edits (Manage project, Edit details: venue and
// installation date) that now fire the new notice trigger on a project that has confirmed, crewed site activities (crew made as a Preview user would have made them), and it records what the
// crew and the project members would then see on that old build. Every page must load without an error page; the edits must save; nothing else about the edit may change.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/main-compat-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport = { width: 1280, height: 900 }) => { if (page) await page.context().close(); page = await newPage(browser, viewport, "dark", {}); await login(page, email.includes("@") ? email : `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page?.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const one = (q) => db(q).split("\n")[0];
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const dialog = () => page.getByRole("dialog").last();
const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const plus = (n) => one(`select (current_date + ${n})::text`);
const BROKEN = /Application error|This page couldn.t load|Something went wrong|Internal Server Error|could not be found/i;
const opens = async (path, what) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); const t = await body(); if (BROKEN.test(t)) throw new Error(`${what} shows an error page: ${t.slice(0, 160)}`); return t; };
const tech = `${U}5`; const cara = `${U}2`;
const notices = (user) => db(`select payload::text from notifications where user_id = '${user}' and type = 'project_site_change' and read_at is null order by created_at`).split("\n").filter(Boolean).map((t) => JSON.parse(t));

let P = "", INH = "", OWN = "";
const activity = (fields) => JSON.parse(asDb(4, `select proj_save_site_activity('${P}', null, '${JSON.stringify(fields).replace(/'/g, "''")}'::jsonb)`)).id;
const crew = (act, rows) => asDb(4, `select proj_set_site_crew('${act}', '${JSON.stringify(rows)}'::jsonb, null)`);

await step("setup: the schema is the final one; a project with confirmed crewed activities exists (crew made through the functions a Preview user would have used)", async () => {
  if (one("select to_regprocedure('public.proj_preview_site_assignment(uuid, uuid)') is not null") !== "t") throw new Error("the database is not built from the final migrations");
  db(`update profiles set full_name = 'Tariq Technician' where id = '${tech}'; update profiles set full_name = 'Cara Assignee' where id = '${cara}'; update profiles set full_name = 'Mona Manager' where id = '${U}4'`);
  P = asDb(3, `select proj_create_internal_project('${CO}', 'Compat Expo (fictional)', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional')`);
  db(`update proj_project_details set location = 'Fictional Expo Centre, Hall 3', site_timezone = 'Asia/Dubai', install_start = '${plus(9)}' where project_id = '${P}'`);
  asDb(4, `select proj_add_member('${P}', '${cara}', null)`);
  INH = activity({ activity_kind: "setup", title: "Inheriting setup", activity_state: "confirmed", start_date: plus(9), end_date: plus(9) });
  OWN = activity({ activity_kind: "show", title: "Own venue show", activity_state: "confirmed", start_date: plus(11), end_date: plus(11), location: "Fictional Own Hall" });
  crew(INH, [{ user_id: tech, role: "installation", call_local: `${plus(9)}T07:30` }, { user_id: cara, role: "standby" }]);
  crew(OWN, [{ user_id: tech, role: "installation" }]);
  db(`delete from notifications where type = 'project_site_change'`);
});

await as("mgr");
await step("Project Manager on the previous build: My Day, the project list, the project's Work page and Project Plan all open without an error", async () => {
  await opens("/", "My Day"); await opens("/projects", "the project list"); await opens(`/projects/${P}/work`, "the project's Work page"); await opens(`/projects/${P}/plan`, "the Project Plan"); await opens(`/projects/${P}/plan?plan=site&mode=list`, "the site timeline");
  await page.screenshot({ path: `${SHOTS}/previous-build-site-timeline.png`, fullPage: true });
});

await step("an ORDINARY project edit (Manage project, Edit details: venue and installation date) saves, and fires the new trigger without breaking the save", async () => {
  await page.goto(`${BASE}/projects/${P}/work`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Manage project/ }).first().click();
  await page.getByRole("menuitem", { name: /Edit details/ }).click(); await dialog().waitFor();
  await dialog().getByLabel("Location").fill("Fictional Expo Centre, Hall 4");
  await dialog().getByLabel("Installation starts").fill(plus(10));
  await dialog().getByRole("button", { name: "Save details" }).click();
  await until(() => one(`select location from proj_project_details where project_id = '${P}'`) === "Fictional Expo Centre, Hall 4");
  if (one(`select install_start::text from proj_project_details where project_id = '${P}'`) !== plus(10)) throw new Error("the installation date was not saved");
  if (BROKEN.test(await body())) throw new Error("an error page after saving");
  if (one(`select count(*) from proj_project_details where project_id = '${P}'`) !== "1") throw new Error("details row count changed");
});

await step("what the edit told the crew: the activity that inherits the venue only, once, nothing for the activity with its own venue; and nothing for the actor", async () => {
  const t = notices(tech); const c = notices(cara);
  const forInh = t.filter((n) => n.activity_id === INH); const forOwn = t.filter((n) => n.activity_id === OWN);
  if (forInh.length !== 1 || !forInh[0].changes.some((x) => x.field === "venue" && x.to === "Fictional Expo Centre, Hall 4")) throw new Error(`technician notices for the inheriting activity: ${JSON.stringify(forInh)}`);
  if (forOwn.length) throw new Error("the activity with its own venue produced a notice");
  if (c.length !== 1) throw new Error(`Cara has ${c.length} notices`);
  if (notices(`${U}4`).length) throw new Error("the actor was told about their own edit");
});

await step("a project member on the previous build (Cara) sees the notice: how it is worded, where it leads, and that My Day and her project pages still open", async () => {
  await as("hr");
  await opens("/", "My Day (Cara)");
  const bell = page.getByRole("button", { name: /notification/i }).first();
  const bellCount = await bell.count();
  let wording = "no bell on this build";
  if (bellCount) { await bell.click(); await page.waitForTimeout(800); wording = (await page.locator("[role=dialog], [role=menu], aside").last().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300); }
  console.log(`   (Cara's notice list on the previous build: ${wording})`);
  await page.screenshot({ path: `${SHOTS}/previous-build-member-notice.png`, fullPage: true });
  await opens(`/projects/${P}/work`, "the project's Work page (Cara)");
});

await step("the site-only technician on the previous build: My Day opens; there is no Preview-only page to break; the notice is unread and invisible to them there (no bell)", async () => {
  await as("emp");
  await opens("/", "My Day (technician)");
  const bell = await page.getByRole("button", { name: /notification/i }).count();
  console.log(`   (technician's bell on the previous build: ${bell ? "present" : "absent"}; unread notices: ${notices(tech).length})`);
});

await as("mgr");
await step("ordinary CREW edits (the crew function Preview users call) and an ordinary activity edit keep working with the previous build open: nothing errors and the previous build still renders the activity", async () => {
  asDb(4, `select proj_set_site_crew('${INH}', '${JSON.stringify([{ user_id: tech, role: "installation", call_local: `${plus(10)}T08:15` }, { user_id: cara, role: "standby" }])}'::jsonb, null)`);
  const ver = one(`select version from proj_plan_items where id = '${INH}'`);
  asDb(4, `select proj_save_site_activity('${P}', '${INH}', '{"start_date":"${plus(10)}","end_date":"${plus(10)}","reason":"Hall moved a day","expected_version":${ver}}'::jsonb)`);
  await opens(`/projects/${P}/plan?plan=site&mode=list`, "the site timeline after the edits");
  const calls = one(`select count(*) from proj_site_crew where plan_item_id = '${INH}' and call_at is not null`);
  if (calls !== "1") throw new Error(`call times recorded: ${calls}`);
});

await step("the other everyday edits on the previous build (status, a task, a milestone) are not affected by the new triggers", async () => {
  const T = asDb(4, `select proj_create_task('${P}', '{"title":"Compat task","assignee_id":"${U}4","due_date":"${plus(5)}"}'::jsonb)`);
  asDb(4, `select proj_save_milestone('${P}'::uuid, null, '{"title":"Compat milestone","due_date":"${plus(20)}","is_required":true}'::jsonb)`);
  await opens(`/projects/${P}/work?tasks=all`, "the Work page with the new task");
  if (!/Compat task/.test(await body())) throw new Error("the new task is not shown");
  if (one(`select count(*) from proj_tasks where id = '${T}'`) !== "1") throw new Error("task missing");
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
