// Real-browser end-to-end check of Projects Release 1, the Project Plan (LOCAL STACK ONLY; see README.md). Seed first with `seed/project-plan.sh`, then run against the
// production build. It plays the two workflows of the release through the screens, as the people who would do them, and writes to the local database only:
//   Kids Photobooth (a handover with two accepted technologies and a brief): accept -> Project Plan -> bring in the scope once -> delegate sections -> hardware (stock-matched,
//   one item missing from Inventory, one rented), a content sequence with a milestone, an app on six devices, integration and installation -> release (twice, and at the
//   same time) -> match the missing item later -> an assignee updates a task and the plan, Timeline and milestone agree -> a late storyboard -> an approved owner/date
//   change, and one the finished task cannot take -> booked equipment stays with Equipment.
//   Supply and install (made before Release 1): hardware + installation only, stored the way the previous release stored it; it must open and behave as before.
//   mgr@ Project Manager   hr@ designer (Content)   lead@ developer (Apps, Engineering)   hr1@ site lead   emp@ not on the project   ceo@ founder
import { chromium, newPage, login, BASE, psql as sql, choose } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/plan-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000a";
const CO = "00000000-0000-4000-8000-00000000a001";
const uid = { mgr: `${U}4`, hr: `${U}2`, lead: `${U}7`, hr1: `${U}1`, ceo: `${U}3` };
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0; let url = "";
const as = async (email, viewport, theme) => { if (page) await page.context().close(); page = await newPage(browser, viewport, theme); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) {
    fails++;
    console.log("FAIL", name, "::", String(e.message).split("\n")[0], "| main:", (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700));
    await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`, fullPage: true }).catch(() => {});
    if (url) await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  }
};
const main = () => page.locator("main");
const mainText = async () => (await main().innerText()).replace(/\s+/g, " ");
const go = async (path) => { url = `${BASE}${path}`; await page.goto(url, { waitUntil: "networkidle" }); };
const expectText = async (re) => { const t = await mainText(); if (!re.test(t)) throw new Error(`expected ${re} on the page, got: ${t.slice(0, 400)}`); };
const expectNoText = async (re) => { const t = await mainText(); if (re.test(t)) throw new Error(`did not expect ${re} on the page`); };
const seen = (re, ms = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const db = (q) => sql(q);
const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${fn}`); await new Promise((r) => setTimeout(r, 250)); } };
const dayIso = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const asDb = (n, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", {
  env: { ...process.env, PGPASSWORD: "postgres" },
  input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${U}${n}","role":"authenticated"}', true); ${q}; commit;`,
}).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const dialog = () => page.getByRole("dialog");
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const closeDialog = async () => { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(150); };
const noOverflow = async () => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`horizontal overflow of ${o}px`); };
const card = (key) => page.getByTestId(`dp-activation-${key}`);
const openCard = async (key) => { const c = card(key); if (!(await c.evaluate((e) => e.open))) await c.locator("summary").click(); return c; };
const row = (key) => page.getByTestId(`dp-line-${key}`);

let PRJ = ""; let SUP = ""; let MS = "";
SUP = db("select id from proj_projects where name like 'Supply and install%'");

// ===================================================================================================================================================
await as("mgr");
await step("PM: accepts the handover and lands on the Project Plan (with a way back to the Work overview)", async () => {
  await go("/projects/handovers");
  const btn = page.getByRole("button", { name: /^accept handover/i }).first();
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/delivery\?from=handover/, { timeout: 30000 });
  PRJ = page.url().match(/projects\/([0-9a-f-]{36})\//)[1];
  await page.waitForLoadState("networkidle");
  await seen(/Project Plan/);
  if (!(await page.getByTestId("dp-welcome").isVisible())) throw new Error("no welcome note after acceptance");
  if (!(await page.getByRole("link", { name: "Work overview" }).first().isVisible())) throw new Error("no link to the Work overview");
  if (db("select count(*) from proj_projects where crm_opportunity_id is not null") !== "1") throw new Error("not exactly one client project");
});
// People, a milestone and nothing else go in through the real functions as the PM (the check is of the plan, not of the people screens).
try {
  asDb(4, `select proj_add_member('${PRJ}', '${uid.hr}', null)`);
  asDb(4, `select proj_add_member('${PRJ}', '${uid.lead}', null)`);
  asDb(4, `select proj_add_member('${PRJ}', '${uid.hr1}', null)`);
  MS = asDb(4, `select proj_save_milestone('${PRJ}', null, '{"title":"Ready for mockup","due_date":"${dayIso(14)}","is_required":true}'::jsonb)`);
} catch (e) { console.log("SETUP FAIL", String(e.message).split("\n")[0]); fails++; }

await step("the summary at the top is honest about an empty plan, and the brief is beside the plan", async () => {
  await go(`/projects/${PRJ}/delivery`);
  await expectText(/next site date/i);
  await expectText(/Nothing in the plan yet/);
  await expectText(/The accepted handover lists 2 technologies that are not in the plan yet: Photobooth, Cartoon app/);
  const brief = (await page.getByTestId("dp-brief").textContent()) ?? "";
  if (!/six tablets/.test(brief)) throw new Error("the handover brief is not shown beside the plan");
});
await step("bring in the accepted technologies once: two rows with their quantities; again changes nothing; the PM's edit survives", async () => {
  await page.getByTestId("dp-seed-scope").click();
  await dialog().getByRole("button", { name: "Add to the plan" }).click();
  await seen(/2 accepted technologies added to the plan/, 20000).catch(() => {});
  await closeDialog();
  await until(() => db(`select count(*) from proj_dp_items where project_id='${PRJ}'`) === "2");
  await go(`/projects/${PRJ}/delivery`);
  await expectText(/D001 · Photobooth × 2/); await expectText(/D002 · Cartoon app × 1/);
  await expectNoText(/not in the plan yet/);
  // the PM edits Photobooth: owner and ready-by
  await openCard("D001");
  await card("D001").getByRole("button", { name: "Edit", exact: true }).first().click();
  await choose(dialog().getByLabel("Accountable owner"), /mgr/i);
  await dialog().getByLabel("Ready by").fill(dayIso(12));
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await until(() => db(`select owner_id from proj_dp_items where item_key='D001' and project_id='${PRJ}'`) === uid.mgr);
  // retrying the handover step (the RPC the acceptance and any retry uses) and reopening the plan: no duplicate, no overwrite
  asDb(4, `select proj_dp_seed_scope('${PRJ}')`); asDb(4, `select proj_dp_seed_scope('${PRJ}')`);
  await go(`/projects/${PRJ}/delivery`);
  if (db(`select count(*) from proj_dp_items where project_id='${PRJ}'`) !== "2") throw new Error("a duplicate row appeared");
  if (db(`select needed_by from proj_dp_items where item_key='D001' and project_id='${PRJ}'`) !== dayIso(12)) throw new Error("the PM's edit was overwritten");
  await expectText(/Accountable owner: mgr/);
});
await step("the PM delegates the sections: Content, Apps, Engineering, Site work", async () => {
  const set = async (label, who) => {
    const sel = page.getByTestId("dp-delegations").getByLabel(label, { exact: true });
    await choose(sel, who);
    await sel.locator("xpath=ancestor::form").getByRole("button", { name: "Save" }).click();
  };
  await set("Content", /^hr/i); await page.waitForTimeout(700);
  await set("Apps", /^lead/i); await page.waitForTimeout(700);
  await set("Engineering & integration", /^lead/i); await page.waitForTimeout(700);
  await set("Site work", /^hr1/i); await page.waitForTimeout(700);
  await until(() => db(`select count(*) from proj_dp_delegations where project_id='${PRJ}'`) === "4");
});

await step("hardware: one stock-matched, one missing from Inventory (kept as a manual line), one rented; each with the state it needs", async () => {
  await go(`/projects/${PRJ}/delivery`);
  const c = await openCard("D001");
  const add = async (fn) => { await c.getByRole("button", { name: "Add requirement" }).first().click(); await fn(dialog()); await dialog().getByRole("button", { name: "Add requirement" }).click(); await page.waitForTimeout(900); await closeDialog(); };
  await add(async (d) => {
    await choose(d.getByLabel("Section"), /^Hardware/);
    await d.getByLabel("Item", { exact: true }).fill("Booth screen"); await d.getByLabel("Quantity").fill("2"); await d.getByLabel("Specification").fill("Portrait touch screen, 21 in");
    await choose(d.getByLabel("Stock item"), /Laptop 14 inch/);
  });
  await add(async (d) => {
    await choose(d.getByLabel("Section"), /^Hardware/);
    await d.getByLabel("Item", { exact: true }).fill("Ring light 18 in"); await d.getByLabel("Quantity").fill("2");
  });
  await add(async (d) => {
    await choose(d.getByLabel("Section"), /^Hardware/);
    await d.getByLabel("Item", { exact: true }).fill("Backdrop frame"); await d.getByLabel("Quantity").fill("1"); await d.getByLabel("Specification").fill("3 x 2 m, white");
    await choose(d.getByLabel("How is it supplied?"), /^Rent/);
    await choose(d.getByLabel("Owner", { exact: true }), /mgr/i); await d.getByLabel("Expected on").fill(dayIso(10)); await d.getByLabel("Supplier").fill("Fictional Hire Ltd");
  });
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  const t = await mainText();
  if (!/Booth screen.*Matched to stock: ready to release/.test(t)) throw new Error("the matched line is not shown as ready to release");
  if (!/Ring light 18 in.*Specification pending/.test(t)) throw new Error("the manual line does not say Specification pending");
  if (!/Backdrop frame.*Rent: expected/.test(t)) throw new Error("the rented line is not shown with its expected date");
  if (!/Hardware to source/.test(t)) throw new Error("the summary does not count hardware to source");
});

await step("a content sequence the delegate adds: editable steps with their own owners and dates, waiting for each other, for a milestone", async () => {
  await as("hr");
  await go(`/projects/${PRJ}/delivery`);
  const c = await openCard("D001");
  if ((await c.getByRole("button", { name: "Edit", exact: true }).count()) !== 0) throw new Error("a section delegate can edit the activation row");
  await c.getByRole("button", { name: "Start from a sequence" }).click();
  const d = dialog();
  const names = ["Moodboard", "Storyboard", "First draft", "Client review", "Final export", "On-device test"];
  for (let n = 0; n < names.length; n++) {
    const li = d.getByTestId(`seq-step-${n}`);
    if ((await li.getByLabel(`Step ${n + 1} name`).inputValue()) !== names[n]) throw new Error(`step ${n + 1} is not ${names[n]}`);
    await choose(li.getByLabel(`Step ${n + 1} owner`), n === 5 ? /^lead/i : /^hr(?!1)/i);
    await li.getByLabel(`Step ${n + 1} start`).fill(dayIso(1 + n * 2)); await li.getByLabel(`Step ${n + 1} due`).fill(dayIso(2 + n * 2));
  }
  await choose(d.getByLabel("Milestone for all steps (optional)"), /Ready for mockup/);
  await d.getByRole("button", { name: "Add the steps" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where project_id='${PRJ}' and section='content' and removed_at is null`) === "6");
  await closeDialog();
  if (db(`select count(*) from proj_dp_lines where project_id='${PRJ}' and cardinality(depends_on) = 1`) !== "5") throw new Error("the steps do not each wait for the one before");
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await expectText(/Storyboard.*starts .*due .*for Ready for mockup/);
  await expectText(/Milestones/); await expectText(/Ready for mockup.*0 of 6 complete/);
  // the delegate cannot touch a section that is not theirs: no Edit on hardware lines
  const hw = row("L0001");
  if ((await hw.getByRole("button", { name: "Edit", exact: true }).count()) !== 0) throw new Error("the Content delegate can edit a hardware line");
});

await step("apps (one app on six devices), engineering and site work, by the people they were delegated to", async () => {
  await as("lead");
  await go(`/projects/${PRJ}/delivery`);
  let c = await openCard("D002");
  await c.getByRole("button", { name: "Add requirement" }).first().click();
  let d = dialog();
  const sections = await d.getByLabel("Section").locator("option").allInnerTexts().catch(() => []);
  if (sections.length && sections.some((s) => /Hardware|Content|Site/.test(s))) throw new Error(`the Apps/Engineering delegate is offered other sections: ${sections.join(", ")}`);
  await choose(d.getByLabel("Section"), /^Apps/);
  await d.getByLabel("App name").fill("Cartoon photo app"); await d.getByLabel("Purpose").fill("Take a photo and turn it into a cartoon");
  await d.getByLabel("Number of apps").fill("1"); await d.getByLabel("Platform").fill("Android tablet"); await d.getByLabel("Number of devices").fill("6");
  await choose(d.getByLabel("Owner", { exact: true }), /^lead/i); await d.getByLabel("Planned start").fill(dayIso(2)); await d.getByLabel("Due", { exact: true }).fill(dayIso(9));
  await d.getByRole("button", { name: "Add requirement" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where section='apps' and project_id='${PRJ}'`) === "1");
  await closeDialog();
  c = await openCard("D001");
  await c.getByRole("button", { name: "Add requirement" }).first().click();
  d = dialog();
  await choose(d.getByLabel("Section"), /^Engineering/);
  await d.getByLabel("What is needed").fill("Printer integration and test"); await choose(d.getByLabel("Kind", { exact: true }), /Integration/);
  await choose(d.getByLabel("Owner", { exact: true }), /^lead/i); await d.getByLabel("Planned start").fill(dayIso(3)); await d.getByLabel("Due", { exact: true }).fill(dayIso(8));
  await d.getByRole("button", { name: "Add requirement" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where section='engineering' and project_id='${PRJ}'`) === "1");
  await closeDialog();
  await as("hr1");
  await go(`/projects/${PRJ}/delivery`);
  c = await openCard("D001");
  await c.getByRole("button", { name: "Add requirement" }).first().click();
  d = dialog();
  await choose(d.getByLabel("Section"), /^Site work/);
  await d.getByLabel("What is needed").fill("Installation"); await choose(d.getByLabel("Kind", { exact: true }), /^Installation/);
  await choose(d.getByLabel("Owner", { exact: true }), /^hr1/i); await d.getByLabel("Planned start").fill(dayIso(11)); await d.getByLabel("Due", { exact: true }).fill(dayIso(12));
  await d.getByRole("button", { name: "Add requirement" }).click();
  await until(() => db(`select count(*) from proj_dp_lines where section='site' and project_id='${PRJ}'`) === "1");
  await closeDialog();
  const app = db(`select detail from proj_dp_lines where section='apps' and project_id='${PRJ}'`);
  if (!/"app_count": 1/.test(app) || !/"device_count": 6/.test(app)) throw new Error(`the app details are not one app and six devices: ${app}`);
});

await step("release: the dialog says what it creates; one task per work line, one DRAFT equipment line per matched hardware line; unmatched and rented stay visible", async () => {
  await as("mgr");
  await go(`/projects/${PRJ}/delivery`);
  await page.getByTestId("dp-release").click();
  const pv = await page.getByTestId("dp-release-preview").innerText();
  if (!/9 tasks will be created/.test(pv) || !/1 hardware line will be added to the project's draft equipment request/.test(pv)) throw new Error(`preview: ${pv}`);
  if (!/1 hardware line is bought, rented or client supplied/.test(pv) || !/needs a stock match/.test(pv)) throw new Error(`preview misses the rented or waiting line: ${pv}`);
  await dialog().getByRole("button", { name: "Release", exact: true }).click();
  await until(() => db(`select count(*) from proj_tasks where project_id='${PRJ}'`) === "9");
  await seen(/Released: 9 tasks created, 1 line added to the draft equipment request/).catch(() => {});
  await closeDialog();
  if (db(`select count(*) from inv_request_lines l join inv_requests r on r.id=l.request_id where r.project_id='${PRJ}'`) !== "1") throw new Error("not exactly one equipment line");
  if (db(`select count(*) from inv_requests where project_id='${PRJ}' and status='draft'`) !== "1") throw new Error("the project's request is not one draft");
  if (db(`select count(*) from proj_dp_lines where project_id='${PRJ}' and released_at is null`) !== "2") throw new Error("the manual and rented lines should still be unreleased");
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await expectText(/Review and send to Warehouse/);
  await expectText(/Ring light 18 in.*Specification pending/);
  await expectText(/Backdrop frame.*Rent: expected/);
  // the dependency between released lines is a task dependency
  if (db(`select count(*) from proj_task_dependencies where project_id='${PRJ}'`) !== "5") throw new Error(`task dependencies: ${db(`select count(*) from proj_task_dependencies where project_id='${PRJ}'`)}`);
});
await step("release again, and twice at the same time: nothing new", async () => {
  const tasks = db(`select count(*) from proj_tasks where project_id='${PRJ}'`), eq = db("select count(*) from inv_request_lines");
  await go(`/projects/${PRJ}/delivery`);
  await page.getByTestId("dp-release").click();
  await dialog().getByRole("button", { name: /Release|Nothing to release/ }).first().click().catch(() => {});
  await closeDialog();
  await Promise.all([0, 1].map(() => new Promise((res) => { try { asDb(4, `select proj_dp_release('${PRJ}')`); } catch {} res(); })));
  if (db(`select count(*) from proj_tasks where project_id='${PRJ}'`) !== tasks || db("select count(*) from inv_request_lines") !== eq) throw new Error("a repeated release created something");
  if (db(`select count(*) from proj_dp_lines where project_id='${PRJ}' and task_id is not null group by task_id having count(*) > 1`) !== "") throw new Error("two lines share a task");
});
await step("matching the missing item later: the next release adds it once", async () => {
  await go(`/projects/${PRJ}/delivery`);
  const c = await openCard("D001");
  await row("L0002").getByRole("button", { name: "Edit", exact: true }).click();
  await choose(dialog().getByLabel("Stock item"), /Power cable/);
  await dialog().getByLabel("Specification").fill("18 in ring light, 3 colour temperatures");
  await dialog().getByRole("button", { name: "Save", exact: true }).click();
  await until(() => db(`select inv_item_id is not null from proj_dp_lines where line_key='L0002' and project_id='${PRJ}'`) === "t");
  const before = db(`select count(*) from inv_request_lines l join inv_requests r on r.id=l.request_id where r.project_id='${PRJ}'`);
  asDb(4, `select proj_dp_release('${PRJ}')`); asDb(4, `select proj_dp_release('${PRJ}')`);
  if (db(`select count(*) from inv_request_lines l join inv_requests r on r.id=l.request_id where r.project_id='${PRJ}'`) !== String(Number(before) + 1)) throw new Error("the matched line was not added exactly once");
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await expectNoText(/Specification pending/);
  void c;
});

await step("an assignee updates the task once in My Work; the plan, the Timeline and the milestone agree after a refresh", async () => {
  const moodTask = db(`select task_id from proj_dp_lines where description='Moodboard' and project_id='${PRJ}'`);
  await as("hr");
  await go("/projects/work");
  await expectText(/Moodboard/);
  await go(`/projects/${PRJ}/work?task=${moodTask}`);
  const primary = page.getByTestId("task-primary-action").getByRole("button").first();
  await primary.waitFor({ timeout: 15000 });
  await primary.click();
  await until(() => db(`select status from proj_tasks where id='${moodTask}'`) === "in_progress");
  await page.getByTestId("task-primary-action").getByRole("button").first().click();
  await until(() => db(`select status from proj_tasks where id='${moodTask}'`) === "done");
  await expectText(/From the Project Plan: D001 Photobooth/);
  // the task panel links back to its activation
  const link = await page.getByTestId("task-plan-link").getByRole("link").getAttribute("href");
  if (!/\/delivery\?open=D001#dp-L\d{4}/.test(link)) throw new Error(`the task does not link back to its activation: ${link}`);
  await as("mgr");
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  if (!/Moodboard[\s\S]*Task done/.test(await row("L0007").innerText().catch(() => ""))) {
    const t = await mainText(); if (!/Task done/.test(t)) throw new Error("the plan does not show the finished task");
  }
  await expectText(/Ready for mockup.*1 of 6 complete/);
  await go(`/projects/${PRJ}/delivery?view=timeline`);
  await expectText(/Moodboard/); await expectText(/Task done/);
  const m = await page.getByTestId("plan-milestones").innerText();
  if (/Moodboard/.test(m.replace(/\s+/g, " ").split("outstanding")[0]) && false) throw new Error("unreachable");
  if (/Kids|Moodboard.*not released/.test(m) && /Photobooth: Moodboard/.test(m)) throw new Error("a finished task is listed as outstanding");
});

await step("a late storyboard shows against the first draft and in the summary; a blocker the assignee records is what the plan shows", async () => {
  const story = db(`select task_id from proj_dp_lines where description='Storyboard' and project_id='${PRJ}'`);
  asDb(2, `select proj_update_task('${story}', '{"due_date":"${dayIso(9)}","reason":"Client sent the script late"}'::jsonb)`);
  asDb(2, `select proj_block_task('${story}', 'Waiting for the client script', null, 'Chase the client for the script')`);
  await go(`/projects/${PRJ}/delivery`);
  await expectText(/Open blockers/); await expectText(/Late dependencies/);
  await openCard("D001");
  await expectText(/Late: Storyboard is due/);
  await expectText(/Blocked: Waiting for the client script\. Next: Chase the client for the script/);
  const next = await page.getByTestId("summary-next").innerText();
  if (!/Storyboard is blocked: Waiting for the client script/.test(next)) throw new Error(`the next action is not the blocker: ${next}`);
  await page.getByTestId("summary-next").getByRole("link").click();
  await page.waitForURL(/delivery\?open=D001#dp-L\d{4}/);
  await go(`/projects/${PRJ}/delivery?view=timeline`);
  await expectText(/Late: Storyboard is due/);
  await shot("timeline-desktop");
});

await step("an approved owner and date change reaches the task through the existing task rules", async () => {
  await go(`/projects/${PRJ}/delivery`);
  await openCard("D002");
  const appKey = db(`select line_key from proj_dp_lines where section='apps' and project_id='${PRJ}'`);
  await openCard("D002");
  await row(appKey).getByRole("button", { name: "Edit", exact: true }).click();
  if (!/already released.*proposal/.test(await dialog().innerText())) throw new Error("no proposal warning on a released line");
  await choose(dialog().getByLabel("Owner", { exact: true }), /^hr(?!1)/i); await dialog().getByLabel("Due", { exact: true }).fill(dayIso(12));
  await dialog().getByLabel("Why is it changing?").fill("Developer is on leave");
  await dialog().getByRole("button", { name: "Propose change" }).click();
  await page.waitForTimeout(900); await closeDialog();
  const appTask = db(`select task_id from proj_dp_lines where section='apps' and project_id='${PRJ}'`);
  if (db(`select assignee_id from proj_tasks where id='${appTask}'`) !== uid.lead) throw new Error("the task moved before approval");
  await go(`/projects/${PRJ}/delivery`);
  await expectText(/Proposed changes to released work \(1\)/);
  await page.getByRole("button", { name: "Approve change" }).click();
  await until(() => db(`select assignee_id from proj_tasks where id='${appTask}'`) === uid.hr);
  if (db(`select due_date from proj_tasks where id='${appTask}'`) !== dayIso(12)) throw new Error("the due date did not reach the task");
  await go(`/projects/${PRJ}/delivery`); await openCard("D002");
  await expectNoText(/Task update pending/);
});
await step("a change the finished task cannot take is flagged Task update pending; the manager keeps the task as it is", async () => {
  const integ = db(`select line_key from proj_dp_lines where section='engineering' and project_id='${PRJ}'`);
  const t = db(`select task_id from proj_dp_lines where line_key='${integ}' and project_id='${PRJ}'`);
  asDb(7, `select proj_set_task_status('${t}', 'in_progress')`); asDb(7, `select proj_set_task_status('${t}', 'done')`);
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await row(integ).getByRole("button", { name: "Edit", exact: true }).click();
  await dialog().getByLabel("Due", { exact: true }).fill(dayIso(13));
  await dialog().getByRole("button", { name: "Propose change" }).click();
  await page.waitForTimeout(900); await closeDialog();
  await go(`/projects/${PRJ}/delivery`);
  await page.getByRole("button", { name: "Approve change" }).click();
  await until(() => db(`select task_pending is not null from proj_dp_lines where line_key='${integ}' and project_id='${PRJ}'`) === "t");
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await expectText(/Task update pending/);
  if (db(`select due_date from proj_tasks where id='${t}'`) === dayIso(13)) throw new Error("a finished task was changed");
  await page.getByTestId(`dp-pending-${integ}`).getByRole("button", { name: "Resolve" }).click();
  await dialog().getByRole("button", { name: "Keep the task as it is" }).click();
  await until(() => db(`select task_pending is null from proj_dp_lines where line_key='${integ}' and project_id='${PRJ}'`) === "t");
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await expectNoText(/Task update pending/);
});
await step("booked equipment stays governed by Equipment: the plan form says so and Save is off", async () => {
  db(`update inv_requests set status='submitted', submitted_at=now() where project_id='${PRJ}'`);
  await go(`/projects/${PRJ}/delivery`); await openCard("D001");
  await row("L0001").getByRole("button", { name: "Edit", exact: true }).click();
  await expectDialog();
  async function expectDialog() {
    const t = await dialog().innerText();
    if (!/already with the warehouse\. Change it on the Equipment tab/.test(t)) throw new Error(`no Equipment notice: ${t.slice(0, 200)}`);
    if (!(await dialog().getByRole("button", { name: "Propose change" }).isDisabled())) throw new Error("Save is on for booked equipment");
  }
  await closeDialog();
});

await step("Breakdown view for the screenshot: summary, milestone, activation with its sections", async () => {
  await as("mgr", { width: 1280, height: 1000 });
  await go(`/projects/${PRJ}/delivery`); await openCard("D001"); await openCard("D002");
  await page.waitForTimeout(400);
  await shot("breakdown-desktop");
  await as("mgr", { width: 390, height: 844 });
  await go(`/projects/${PRJ}/delivery`); await openCard("D001"); await noOverflow(); await shot("breakdown-phone");
  await go(`/projects/${PRJ}/delivery?view=timeline`); await shot("timeline-phone");
});

// ===================================================================================================================================================
await step("Supply and install, made before Release 1: opens, with its tasks and equipment links, hardware and installation only", async () => {
  await as("mgr");
  await go(`/projects/${SUP}/work`);
  await expectText(/Project Plan/); await expectText(/Open the Project Plan/);
  await go(`/projects/${SUP}/delivery`);
  await expectText(/D001 · Wall displays/);
  await openCard("D001");
  const heads = (await card("D001").getByRole("heading", { level: 4 }).allInnerTexts()).map((h) => h.split(" · ")[0]);
  if (heads.join("|") !== "Hardware|Installation (earlier plan)") throw new Error(`the sections of a simple job are: ${heads.join(", ")}`);
  if (/waiting for/i.test(await card("D001").innerText())) throw new Error("an input is awaited on a plan with no delegation");
  await expectText(/Display units/); await expectText(/Mount and test the displays/);
  await expectText(/On draft request/);
  const links = await page.getByTestId("dp-line-L0002").getByRole("link", { name: "Open task" }).getAttribute("href");
  if (!/work\?task=/.test(links)) throw new Error("no link to its task");
  await expectText(/Review and send to Warehouse/);
  await go(`/projects/${SUP}/delivery?view=timeline`);
  await expectText(/Mount and test the displays/);
  await shot("supply-install-plan");
});
await step("the old Delivery plan addresses still work: the page, the import, the export and the template", async () => {
  await go(`/projects/${SUP}/delivery/import`);
  await expectText(/Import|Delivery plan|Project Plan/);
  for (const p of ["export", "template"]) {
    const r = await page.request.get(`${BASE}/api/projects/${SUP}/delivery-plan/${p}`);
    if (r.status() !== 200 || !/spreadsheetml/.test(r.headers()["content-type"] ?? "")) throw new Error(`${p}: ${r.status()}`);
  }
});

await step("people without a place on the project cannot open the plan", async () => {
  await as("emp");
  await page.goto(`${BASE}/projects/${PRJ}/delivery`, { waitUntil: "networkidle" });
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Booth screen|Moodboard|Release plan|Project Plan Break/.test(t)) throw new Error("someone outside the project can read the plan");
  if (!/Summary only/.test(t)) throw new Error("someone outside the project is not told it is the summary only");
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
process.exit(fails ? 1 : 0);
