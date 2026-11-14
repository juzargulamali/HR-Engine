// Real-browser check of the CREW CHANGE NOTICES (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the production build. Fictional data.
// Runs against either app build (set OLD_APP=1 for the build from before this round, to prove it works against the migrated schema: the notice still arrives, worded generically).
// Cases, all driven through the normal screens with CONFIRMED crew:
//   1. the Project Manager changes the PROJECT's venue in Edit details: only the confirmed activity that inherits it (crew told with previous and new venue); an activity with its own venue, and a
//      tentative one, tell nobody;
//   2. the Project Manager changes the activity's time zone and saves the crew unchanged: the call time's zone changes with it, and the notice reads each side in its own zone;
//   3. a call time's zone alone changes with the same instant (the crew function, which the Crew dialog does not expose): the displayed clock time changes, so the crew member is told.
import { chromium, newPage, login, BASE, psql as sql, choose } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/notices-shots";
const NEW = !process.env.OLD_APP;
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
const plus = (n) => one(`select (current_date + ${n})::text`);
const tech = `${U}5`; const cara = `${U}2`;
const notices = (user, act) => db(`select payload::text from notifications where user_id = '${user}' and type = 'project_site_change'${act ? ` and payload->>'activity_id' = '${act}'` : ""} and read_at is null order by created_at`).split("\n").filter(Boolean).map((t) => JSON.parse(t));
const markRead = () => db(`update notifications set read_at = now() where type = 'project_site_change'`);

let P = "", INH = "", OWN = "", TENT = "";
const activity = (fields) => JSON.parse(asDb(4, `select proj_save_site_activity('${P}', null, '${JSON.stringify(fields).replace(/'/g, "''")}'::jsonb)`)).id;
const crew = (act, rows) => asDb(4, `select proj_set_site_crew('${act}', '${JSON.stringify(rows)}'::jsonb, null)`);

await step("setup: a project with a venue, a confirmed activity that inherits it (crew: the technician), a confirmed activity with its own venue (crew: Cara) and a tentative one that inherits it", async () => {
  db(`update profiles set full_name = 'Tariq Technician' where id = '${tech}'; update profiles set full_name = 'Cara Assignee' where id = '${cara}'; update profiles set full_name = 'Mona Manager' where id = '${U}4'`);
  P = asDb(3, `select proj_create_internal_project('${CO}', 'Notices Expo (fictional)', '${U}4', false, 'normal', current_date, current_date + 40, 'Fictional')`);
  db(`update proj_project_details set location = 'Fictional Expo Centre, Hall 3', site_timezone = 'Asia/Dubai' where project_id = '${P}'`);
  asDb(4, `select proj_add_member('${P}', '${cara}', null)`);
  INH = activity({ activity_kind: "setup", title: "Inheriting setup", activity_state: "confirmed", start_date: plus(9), end_date: plus(9) });
  OWN = activity({ activity_kind: "show", title: "Own venue show", activity_state: "confirmed", start_date: plus(11), end_date: plus(11), location: "Fictional Own Hall" });
  TENT = activity({ activity_kind: "mockup", title: "Tentative mockup", activity_state: "tentative", start_date: plus(8), end_date: plus(8) });
  crew(INH, [{ user_id: tech, role: "installation", call_local: `${plus(9)}T07:30` }]);
  crew(OWN, [{ user_id: cara, role: "standby" }]);
  crew(TENT, [{ user_id: tech, role: "installation" }]);
  markRead();
});

await as("mgr");
await step("case 1: Edit details changes the PROJECT venue; only the confirmed activity that inherits it tells its crew, with the previous and new venue", async () => {
  await page.goto(`${BASE}/projects/${P}/work`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Manage project/ }).first().click();
  await page.getByRole("menuitem", { name: /Edit details/ }).click(); await dialog().waitFor();
  await dialog().getByLabel("Location").fill("Fictional Expo Centre, Hall 4");
  await dialog().getByRole("button", { name: "Save details" }).click();
  await until(() => one(`select location from proj_project_details where project_id = '${P}'`) === "Fictional Expo Centre, Hall 4");
  await until(() => notices(tech, INH).length > 0);
  const n = notices(tech, INH);
  if (n.length !== 1) throw new Error(`the technician has ${n.length} notices for the inheriting activity`);
  const ch = n[0].changes.find((c) => c.field === "venue");
  if (!ch || ch.from !== "Fictional Expo Centre, Hall 3" || ch.to !== "Fictional Expo Centre, Hall 4") throw new Error(`venue change: ${JSON.stringify(n[0].changes)}`);
  if (notices(tech, TENT).length) throw new Error("a tentative activity announced a venue change");
  if (notices(cara).length) throw new Error("the crew of an activity with its OWN venue was told about the project venue");
  if (notices(`${U}4`).length) throw new Error("the actor was notified");
});

await step("case 1 as the crew member sees it: the notice and the card say the venue changed from and to", async () => {
  await as("emp", { width: 390, height: 844 });
  if (NEW) {
    await page.goto(`${BASE}/site-assignments?activity=${INH}`, { waitUntil: "networkidle" });
    const ch = (await page.getByTestId(`site-assignment-${INH}`).getByTestId("sa-changed").innerText()).replace(/\s+/g, " ");
    if (!/Changed: venue/.test(ch) || !/Hall 3 → Fictional Expo Centre, Hall 4/.test(ch)) throw new Error(`card: ${ch}`);
    const v = (await page.getByTestId(`site-assignment-${INH}`).getByTestId("sa-venue").innerText());
    if (!/Hall 4 \(the project's venue\)/.test(v)) throw new Error(`venue line: ${v}`);
    await page.screenshot({ path: `${SHOTS}/notice-project-venue-phone.png`, fullPage: true });
    // a site-only technician has no notification bell: My Day itself must say a briefing changed
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const md = (await page.getByTestId("my-day-site-changed").first().innerText()).replace(/\s+/g, " ");
    if (!/Changed: venue/.test(md) || !/Hall 4/.test(md) || !(await page.getByTestId("my-day-site-changed").first().getByRole("link", { name: /See your briefing/ }).count())) throw new Error(`My Day: ${md}`);
    await page.screenshot({ path: `${SHOTS}/notice-my-day-phone.png`, fullPage: true });
  } else {
    await page.goto(`${BASE}/site-assignments`, { waitUntil: "networkidle" });
    const v = (await page.getByTestId(`site-assignment-${INH}`).getByTestId("sa-venue").innerText());
    if (!/Hall 4 \(the project's venue\)/.test(v)) throw new Error(`venue line (previous build): ${v}`);
  }
});

await as("mgr");
await step("case 2: the activity's time zone changes and the crew is saved unchanged: the call time moves with the zone, and the notice reads each side in the zone it carried", async () => {
  markRead();
  await page.goto(`${BASE}/projects/${P}/plan?plan=site&mode=list`, { waitUntil: "networkidle" });
  const row = page.getByTestId(`site-activity-${INH}`);
  await row.getByRole("button", { name: "Edit", exact: true }).click(); await dialog().waitFor();
  await dialog().getByLabel("The time window is known").check();                        // the zone control only exists with a time window
  await dialog().locator("#sa-from").fill("09:00"); await dialog().locator("#sa-to").fill("17:00");
  await choose(dialog().locator("#sa-tz"), /Asia\/Riyadh/);
  await dialog().getByLabel(/Why is a date or time changing/).fill("The crew works to Riyadh time");
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await until(() => one(`select tz from proj_plan_items where id = '${INH}'`) === "Asia/Riyadh");
  await until(() => notices(tech, INH).length > 0);
  const dn = notices(tech, INH)[0].changes;
  if (!dn.some((c) => c.field === "date") || dn.some((c) => c.field === "call time")) throw new Error(`the time window and zone: expected a date notice and no call time notice yet: ${JSON.stringify(dn)}`);
  markRead();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId(`site-crew-${INH}`).click(); await dialog().waitFor();
  await dialog().getByRole("button", { name: /^Save/ }).click();
  await until(() => notices(tech, INH).length > 0);
  const n = notices(tech, INH)[0].changes.find((c) => c.field === "call time");
  if (!n) throw new Error(`no call time change: ${JSON.stringify(notices(tech, INH))}`);
  if (!/Asia\/Dubai/.test(n.from) || !/Asia\/Riyadh/.test(n.to) || n.from === n.to) throw new Error(`call time notice: ${n.from} -> ${n.to}`);
  if (notices(cara).length) throw new Error("someone not on the activity was told");
});

await step("case 3: only the call time's zone changes (same instant, different clock time): the crew member is told, and the previous value is read in the previous zone", async () => {
  markRead();
  const before = one(`select call_at::text from proj_site_crew where plan_item_id = '${INH}' and user_id = '${tech}'`);
  // the same instant, written as the clock time of the NEW zone (Asia/Karachi, UTC+5): the crew function keeps call_at and only the zone changes
  const local = one(`select to_char(call_at at time zone 'Asia/Karachi', 'YYYY-MM-DD') || 'T' || to_char(call_at at time zone 'Asia/Karachi', 'HH24:MI') from proj_site_crew where plan_item_id = '${INH}' and user_id = '${tech}'`);
  asDb(4, `select proj_set_site_crew('${INH}', '[{"user_id":"${tech}","role":"installation","call_local":"${local}","call_tz":"Asia/Karachi"}]'::jsonb, null)`);
  const after = one(`select call_at::text from proj_site_crew where plan_item_id = '${INH}' and user_id = '${tech}'`);
  if (before !== after) throw new Error("the instant moved: the check needs the same instant");
  const n = notices(tech, INH)[0]?.changes.find((c) => c.field === "call time");
  if (!n) throw new Error("a call-time zone change with the same instant told nobody");
  if (!/Asia\/Riyadh/.test(n.from) || !/Asia\/Karachi/.test(n.to) || n.from === n.to) throw new Error(`notice: ${n.from} -> ${n.to}`);
  if (NEW) {
    await as("emp", { width: 390, height: 844 });
    await page.goto(`${BASE}/site-assignments?activity=${INH}`, { waitUntil: "networkidle" });
    const ch = (await page.getByTestId(`site-assignment-${INH}`).getByTestId("sa-changed").innerText()).replace(/\s+/g, " ");
    if (!/Changed: call time/.test(ch) || !/Asia\/Karachi/.test(ch)) throw new Error(`card: ${ch}`);
    await page.screenshot({ path: `${SHOTS}/notice-call-zone-phone.png`, fullPage: true });
  }
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
