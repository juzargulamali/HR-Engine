// Real-browser, role-by-role check of the Work queues and review hand-offs of "Finish Phase 2" (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the
// production build. Fictional data. Roles: a4 mgr = Project Manager (submits an output on Cara's task); a2 Cara = assignee who also holds the Operations role (the author side: cannot review);
// a6 Omar and a1 Olga = Operations Managers (reviewers); a7 Lena = team lead; a3 ceo = founder.
// Checks: the output waiting for Operations review sits in the right queue for each person with the exact version link; counters; self-review refusal; statuses follow across Work, My Work,
// Deliverables, My Day and Operations; plus the Projects list (next commitment, Manage team, table/board) and the Calendar Agenda on a phone.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/queues-shots";
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
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const asDbErr = (n, q) => { try { asDb(n, q); return ""; } catch (e) { return String(e.stderr ?? e.message); } };
const dialog = () => page.getByRole("dialog").last();
const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const noOverflow = async (what) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`${what}: horizontal overflow of ${o}px`); };
const WHEN = db("select (current_date + 6)::text");
let PRJ = "", T1 = "", V1 = "", EMPTY = "";
const workUrl = () => `${BASE}/projects/${PRJ}/work`;
const taskUrl = (t, v) => `${BASE}/projects/${PRJ}/work?task=${t}${v ? `&version=${v}` : ""}`;
const versionHref = () => `a[href*="task=${T1}&version=${V1}"]`;

await step("setup: a project with a task for Cara that needs a required output, two Operations reviewers, one project with nothing dated", async () => {
  PRJ = asDb(3, `select proj_create_internal_project('${CO}', 'Queues Expo (fictional)', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional queue project')`);
  EMPTY = asDb(3, `select proj_create_internal_project('${CO}', 'Nothing dated (fictional)', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional')`);
  db(`update proj_project_details set install_start = null, event_start = null, event_end = null where project_id = '${EMPTY}'`);
  db(`update profiles set full_name = 'Cara Assignee' where id = '${U}2'; update profiles set full_name = 'Lena Lead' where id = '${U}7'; update profiles set full_name = 'Olga Ops' where id = '${U}1'; update profiles set full_name = 'Omar Ops' where id = '${U}6'; update profiles set full_name = 'Mona Manager' where id = '${U}4'`);
  db(`update proj_company_grants set capabilities = '{operations}' where user_id in ('${U}1', '${U}2') and company_id = '${CO}' and revoked_at is null`);
  db(`insert into proj_company_grants (user_id, company_id, capabilities) select '${U}6', '${CO}', '{operations}' where not exists (select 1 from proj_company_grants where user_id = '${U}6' and company_id = '${CO}' and revoked_at is null)`);
  asDb(4, `select proj_add_member('${PRJ}', '${U}2', null)`); asDb(4, `select proj_add_member('${PRJ}', '${U}7', null)`);
  T1 = asDb(4, `select proj_create_task('${PRJ}', '{"title":"Moodboard","assignee_id":"${U}2","requires_review":true,"due_date":"${WHEN}"}'::jsonb)`);
  asDb(4, `select proj_set_task_output('${T1}', 'Moodboard', 1, true, null)`);
});

await as("mgr");
await step("PM submits version 1 on Cara's task: it goes to Operations, and the PM's Work page says it is waiting on someone else with the exact version link", async () => {
  await page.goto(taskUrl(T1), { waitUntil: "networkidle" });
  await page.getByTestId("output-submit-open").click(); await dialog().waitFor();
  await dialog().getByRole("tab", { name: "Add a link" }).click();
  await dialog().getByLabel("Link (https://)").fill("https://docs.example.com/moodboard-v1"); await dialog().getByLabel("Name for the link (optional)").fill("Moodboard v1");
  await dialog().getByTestId("output-submit-go").click();
  await until(() => db(`select count(*) from proj_task_output_versions where task_id = '${T1}'`) === "1");
  V1 = db(`select id from proj_task_output_versions where task_id = '${T1}' and version_no = 1`);
  await page.goto(workUrl(), { waitUntil: "networkidle" });
  const waiting = (await page.getByTestId("attention-waiting").innerText()).replace(/\s+/g, " ");
  if (!/Moodboard/.test(waiting) || !/Operations/.test(waiting)) throw new Error(`Waiting on someone else: ${waiting.slice(0, 260)}`);
  if (!(await page.getByTestId("attention-waiting").locator(versionHref()).count())) throw new Error("Waiting on someone else has no link to the exact version");
  if (/Moodboard/.test((await page.getByTestId("attention-needs-you").innerText()))) throw new Error("the PM is told to act on their own submission");
  const counter = (await page.getByTestId("work-count-outputs-awaiting").innerText()).replace(/\s+/g, " ");
  if (!/1/.test(counter) || !/Outputs awaiting approval/.test(counter)) throw new Error(`counter: ${counter}`);
  if (!(await page.getByTestId("work-count-tasks-in-review").count())) throw new Error("Tasks in review counter is missing");
  await page.screenshot({ path: `${SHOTS}/work-waiting-desktop.png`, fullPage: true });
});

await step("the assignee who also holds the Operations role is not offered the review (author cannot self-review); the database refuses it", async () => {
  await as("hr"); await page.goto(taskUrl(T1, V1), { waitUntil: "networkidle" });
  if (await page.getByTestId("output-review-open").count()) throw new Error("the author side was offered the review");
  const err = asDbErr(2, `select proj_decide_task_output('${V1}', 'approved', null)`);
  if (!/cannot review your own work/.test(err)) throw new Error(`the database allowed it: ${err.slice(0, 160)}`);
});

await as("admin");
await step("the assigned reviewer reaches the exact version from My Day, Operations and My Work, and Work lists it under Needs you", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator(versionHref()).first().waitFor({ timeout: 20000 });
  await page.goto(`${BASE}/operations?company=${CO}`, { waitUntil: "networkidle" });
  if (!(await page.getByTestId("ops-decisions-mine").count())) throw new Error("Decisions assigned to me is missing");
  await page.locator(versionHref()).first().waitFor();
  await page.goto(`${BASE}/projects/work`, { waitUntil: "networkidle" });
  await page.getByTestId("mywork-filter-review").click();
  await page.locator(versionHref()).first().waitFor();
  const t = await body();
  if (!/Waiting for my review/.test(t) || !/Moodboard/.test(t)) throw new Error(`My Work: ${t.slice(0, 260)}`);
  await page.locator(versionHref()).first().click();
  await page.waitForURL(new RegExp(`task=${T1}&version=${V1}`));
  await page.getByTestId("output-review-open").waitFor();
  await page.screenshot({ path: `${SHOTS}/reviewer-exact-version.png`, fullPage: true });
});

await step("the reviewer requests changes with feedback; every view follows (PM sees Changes requested, Cara sees it as Needs you)", async () => {
  await page.getByTestId("output-review-open").click(); await dialog().waitFor();
  await dialog().getByLabel("Decision").selectOption("changes_requested");
  await dialog().getByLabel(/What needs changing/).fill("Please add the third colour palette");
  await dialog().getByRole("button", { name: "Request changes" }).click();
  await until(() => db(`select status from proj_task_output_versions where id = '${V1}'`) === "changes_requested");
  await as("hr"); await page.goto(workUrl(), { waitUntil: "networkidle" });
  if (!/Moodboard/.test(await page.getByTestId("attention-needs-you").innerText())) throw new Error("Cara does not see Changes requested under Needs you");
  await as("mgr"); await page.goto(workUrl(), { waitUntil: "networkidle" });
  const w = (await page.getByTestId("attention-waiting").innerText().catch(() => "")).replace(/\s+/g, " ");
  if (!/Cara/.test(w) || !/Moodboard/.test(w)) throw new Error(`PM waiting on Cara: ${w.slice(0, 220)}`);
  if (/Outputs awaiting approval\s*1/.test(await body())) throw new Error("the counter still counts the version as awaiting");
});

await step("the Projects list shows the next commitment (or who sets it), Manage team and the Table/Board switch", async () => {
  await as("mgr"); await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  const e = (await page.getByTestId(`project-next-${EMPTY}`).first().innerText()).replace(/\s+/g, " ");
  if (!/No dated commitment/.test(e)) throw new Error(`empty project next: ${e}`);
  if (!(await page.getByTestId(`project-manage-team-${PRJ}`).first().count())) throw new Error("Manage team is not visible on the row");
  await page.getByTestId("project-view-board").first().click().catch(() => {});
  await page.getByTestId("project-view-switch").first().waitFor();
  await page.screenshot({ path: `${SHOTS}/projects-list-desktop.png`, fullPage: true });
});

await step("phone: the Projects list and the Calendar Agenda fit without sideways scroll", async () => {
  await as("mgr", { width: 390, height: 844 });
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" }); await noOverflow("projects list phone");
  await page.screenshot({ path: `${SHOTS}/projects-list-phone.png`, fullPage: true });
  await page.goto(`${BASE}/projects/calendar?view=agenda`, { waitUntil: "networkidle" });
  await page.getByTestId("calendar-view-switch").first().waitFor(); await noOverflow("calendar agenda phone");
  await page.screenshot({ path: `${SHOTS}/calendar-agenda-phone.png`, fullPage: true });
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
