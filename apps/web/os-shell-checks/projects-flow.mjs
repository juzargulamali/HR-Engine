// Real-browser regression of Projects & Tasks through the ENGINIOUS OS interface (LOCAL STACK ONLY; see README.md).
// Seed first with the local stack (founder ceo@, PM mgr@, department head lead@, member hr@, directory-only hr1@, Sales emp@ who owns a Won
// opportunity, admin@ with no Projects access), then run this against the production build. Writes to the local database only.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0; let url = "";
const as = async (email, viewport, theme) => { if (page) await page.context().close(); page = await newPage(browser, viewport, theme); await login(page, email); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) {
    fails++;
    console.log("FAIL", name, "::", String(e.message).split("\n")[0], "| dialog:", (await page.getByRole("dialog").allInnerTexts().catch(() => [])).join(" ").replace(/\s+/g, " ").slice(0, 300), "| main:", (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
    await page.screenshot({ path: `${SHOTS}/pfail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`, fullPage: true }).catch(() => {});
    if (url) await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  }
};
const dialog = () => page.getByRole("dialog");
const mainText = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const seen = (re, ms = 12000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const gone = (re, ms = 12000) => page.waitForFunction((src) => !new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const closed = () => page.waitForFunction(() => !document.querySelector("dialog[open]"), null, { timeout: 12000 });
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); };
const expectText = async (re) => { const t = await mainText(); if (!re.test(t)) throw new Error(`expected ${re} on page, got: ${t.slice(0, 200)}`); };
const expectNoText = async (re) => { const t = await mainText(); if (re.test(t)) throw new Error(`did not expect ${re} on page`); };
const db = (q) => sql(q);
const until = async (fn, ms = 12000) => { const t = Date.now(); for (;;) { try { if (fn()) return; } catch {} if (Date.now() - t > ms) throw new Error("condition not reached: " + fn.toString().slice(0, 120)); await new Promise((r) => setTimeout(r, 300)); } };
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const OPP = db("select id from crm_opportunities limit 1");
let P = ""; let HANDOVER = "";

// ---- access ------------------------------------------------------------------------------------------------------
await as("admin@e2e.local");
await step("a person with no Projects grant sees no module and an explanation", async () => {
  await go("/projects"); await expectText(/do not have Projects access/);
  const nav = (await page.locator("aside nav[aria-label='Modules']").innerText()).replace(/\s+/g, " ");
  if (/Projects & Tasks/.test(nav)) throw new Error("module shown in menu");
  await go("/projects/work"); await expectText(/do not have Projects access/);
});
await as("hr@e2e.local");
await step("an HR admin with a plain Projects grant sees the directory and the module; HR pages unchanged", async () => {
  await go("/projects"); await expectText(/Ongoing projects/);
  await go("/employees"); await expectText(/Employees|employee/i);
});

// ---- Sales prepares the handover ------------------------------------------------------------------------------------
await as("emp@e2e.local");
await step("Sales: prefilled delivery brief, saved without any commercial value", async () => {
  await go(`/sales/opportunities/${OPP}/handover`);
  await page.getByLabel("Scope of work").fill("LED floor and sensors, 6x4 m, with interactive shader content.");
  await page.getByRole("button", { name: /save the delivery brief/i }).click();
  await page.waitForFunction(() => /Save changes|Submit the handover/.test(document.body.innerText), null, { timeout: 12000 });
  HANDOVER = db("select id from proj_handovers limit 1"); if (!HANDOVER) throw new Error("no handover row");
  const row = db("select row_to_json(h)::text from proj_handovers h");
  for (const secret of ["PO-SECRET-123", "BUDGET-SECRET", "TERMS-SECRET", "250000"]) if (row.includes(secret)) throw new Error(`commercial value ${secret} copied into the handover`);
});
await step("Sales: submit the handover; it waits for a Project Manager", async () => {
  await page.getByRole("button", { name: /submit the handover/i }).click();
  await page.waitForFunction(() => /Waiting for a Project Manager/i.test(document.body.innerText), null, { timeout: 12000 });
  if (db("select status from proj_handovers") !== "submitted") throw new Error("not submitted");
});

// ---- founder assigns the PM ------------------------------------------------------------------------------------------
await as("ceo@e2e.local");
await step("Founder: Handovers lists it first and the PM can be chosen", async () => {
  await go("/projects/handovers"); await expectText(/Floor projection for the Orbit launch/);
  await page.locator("select").filter({ has: page.locator("option", { hasText: "mgr" }) }).first().selectOption({ label: "mgr" });
  await page.getByRole("button", { name: /assign|choose|save/i }).first().click();
  await page.waitForFunction(() => /mgr/.test(document.querySelector("main").innerText) && /accept/i.test(document.querySelector("main").innerText), null, { timeout: 12000 });
  if (db("select status from proj_handovers") !== "pm_assigned") throw new Error("PM not assigned");
});
await as("mgr@e2e.local");
await step("PM: asks Sales to clarify; Sales answers; PM accepts; exactly one project", async () => {
  await go("/projects/handovers");
  await page.getByRole("button", { name: /ask sales to clarify/i }).first().click();
  await page.getByRole("textbox").last().fill("Which hours can we access the hall?");
  await page.getByRole("button", { name: /send|request clarification|ask sales/i }).last().click();
  await page.waitForFunction(() => /Clarification requested/i.test(document.querySelector("main").innerText), null, { timeout: 12000 });
  if (db("select status from proj_handovers") !== "clarification_requested") throw new Error("status not clarification_requested");
});
await as("emp@e2e.local");
await step("Sales: sees the question, adds the answer, resubmits", async () => {
  await go(`/sales/opportunities/${OPP}/handover`); await expectText(/Which hours can we access the hall\?/);
  await page.getByLabel("Notes for the Project Manager").last().fill("Hall access 08:00 to 22:00 daily.");
  await page.getByRole("button", { name: /save changes/i }).click(); await page.waitForTimeout(800);
  await page.getByRole("button", { name: /resubmit to the project manager/i }).click();
  await page.waitForFunction(() => /Waiting for the PM to accept/i.test(document.body.innerText), null, { timeout: 12000 });
});
await as("mgr@e2e.local");
await step("PM: accept (double click safe) opens the new project", async () => {
  await go("/projects/handovers");
  const btn = page.getByRole("button", { name: /^accept/i }).first();
  await Promise.all([page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 20000 }), btn.dblclick()]);
  P = page.url().split("/").pop(); url = `${BASE}/projects/${P}`;
  await seen(/Floor projection for the Orbit launch/);
  if (db("select count(*) from proj_projects") !== "1") throw new Error("not exactly one project");
  if (!/^UAE-P-\d{4}-0001$/.test(db("select reference from proj_projects"))) throw new Error("reference");
});
await step("project overview: summary facts, scope as agreed, no commercial data, no invented percentage", async () => {
  await go(`/projects/${P}`); const t = await mainText();
  if (!/Expo Hall 3/.test(t)) throw new Error("location missing");
  for (const secret of ["PO-SECRET-123", "BUDGET-SECRET", "TERMS-SECRET", "250,000", "250000"]) if (t.includes(secret)) throw new Error(`secret ${secret} visible`);
  if (/\d+%/.test(t) && !/required milestone/.test(t)) throw new Error("percentage without basis");
});


// ---- people, departments, temporary leadership --------------------------------------------------------------------
const dayIso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const label = (t, scope = page) => scope.getByLabel(t, { exact: false }).first();
const pickByText = async (scope, labelText, optionText) => { const sel = scope.getByLabel(labelText, { exact: false }).first(); await sel.selectOption({ label: optionText }); };
await as("mgr@e2e.local");
await step("PM: create the Programming team with lead@ as head (head is added as a member)", async () => {
  await go(`/projects/${P}/people`);
  await page.getByRole("button", { name: /add department team/i }).first().click();
  await dialog().getByLabel(/name/i).first().fill("Programming");
  await dialog().locator("select").first().selectOption({ label: "lead" });
  await dialog().getByRole("button", { name: /save team/i }).click(); await closed();
  if (db("select count(*) from proj_teams") !== "1") throw new Error("team not saved");
  if (db(`select count(*) from proj_project_members where user_id='${U(7)}' and removed_at is null`) !== "1") throw new Error("head not a member");
});
await step("PM: add hr@ (an HR admin) to the Programming team; a person without Projects access cannot be added", async () => {
  await go(`/projects/${P}/people`);
  await page.getByLabel("Person").selectOption({ label: "hr" }); await page.getByLabel(/Department \(optional\)/).selectOption({ label: "Programming" });
  await page.getByRole("button", { name: /add to project/i }).click();
  await until(() => db(`select team_id is not null from proj_project_members where user_id='${U(2)}' and removed_at is null`) === "t");
  const options = await page.getByLabel("Person").locator("option").allInnerTexts();
  if (options.some((o) => /admin|pol\./.test(o))) throw new Error("a person without Projects access is offered: " + options.join(","));
});
await step("PM: appoint and end temporary leadership; it grants no HR rights", async () => {
  await go(`/projects/${P}/people`);
  await page.locator("#ap-user").selectOption({ label: "hr" }); await page.locator("#ap-until").fill(dayIso(10));
  await page.getByRole("button", { name: /^appoint$/i }).click();
  await until(() => db(`select role from proj_project_members where user_id='${U(2)}' and removed_at is null`) === "acting_pm");
  await seen(/Temporary leader until/);
  await page.getByRole("button", { name: /end now/i }).first().click();
  await dialog().getByRole("button", { name: /end leadership/i }).click();
  await until(() => db(`select role from proj_project_members where user_id='${U(2)}' and removed_at is null`) === "member");
});
await as("hr@e2e.local");
await step("Member: cannot manage people or milestones (no controls, and the database refuses)", async () => {
  await go(`/projects/${P}/people`); const t = await mainText();
  if (/Add department team|Add to project|Appoint/.test(t)) throw new Error("management controls shown to a member");
  await go(`/projects/${P}/work`);
  if ((await page.getByRole("button", { name: /add milestone/i }).count()) > 0) throw new Error("Add milestone shown to a member");
});

// ---- milestones, deliverables, tasks ---------------------------------------------------------------------------------
await as("mgr@e2e.local");
let MS1 = ""; let DL = "";
await step("PM: add two milestones and a deliverable for Programming", async () => {
  await go(`/projects/${P}/work`);
  await page.getByRole("button", { name: /add milestone/i }).first().click();
  await dialog().getByLabel("Title").fill("First draft approved"); await dialog().getByLabel("Due date").fill(dayIso(30));
  await dialog().getByRole("button", { name: /save|add/i }).last().click(); await closed();
  await page.getByRole("button", { name: /add milestone/i }).first().click();
  await dialog().getByLabel("Title").fill("Final render approved"); await dialog().getByLabel("Due date").fill(dayIso(45));
  await dialog().getByRole("button", { name: /save|add/i }).last().click(); await closed();
  MS1 = db("select id from proj_milestones where title='First draft approved'");
  await page.getByRole("button", { name: /add deliverable/i }).first().click();
  await dialog().getByLabel("Title").fill("Interactive floor build"); await dialog().getByLabel("Department team").selectOption({ label: "Programming" });
  await dialog().getByLabel("Milestone").selectOption({ label: "First draft approved" }); await dialog().getByLabel("Due date").fill(dayIso(25));
  await dialog().getByRole("button", { name: /save|add/i }).last().click(); await closed();
  DL = db("select id from proj_deliverables"); if (!DL || db("select count(*) from proj_milestones") !== "2") throw new Error("not saved");
  await seen(/Interactive floor build/);
});
await as("lead@e2e.local");
let T1 = ""; let T2 = "";
await step("Department head: distribute a review-required task to a team member; cannot assign outside the team", async () => {
  await go(`/projects/${P}/work`);
  await page.getByRole("button", { name: /new task/i }).first().click();
  await dialog().getByLabel("Title").fill("Shader prototype"); await dialog().getByLabel("Department team").selectOption({ label: "Programming" }); await dialog().getByLabel("Assigned to").selectOption({ label: "hr" });
  await dialog().getByLabel("Deliverable").selectOption({ label: "Interactive floor build" }); await dialog().getByLabel("Start date").fill(dayIso(3)); await dialog().getByLabel("Due date").fill(dayIso(10));
  await dialog().getByLabel(/needs review|requires review|review/i).first().check();
  await dialog().getByRole("button", { name: /create task/i }).click(); await closed();
  T1 = db("select id from proj_tasks where title='Shader prototype'"); if (!T1) throw new Error("not created");
  if (db(`select requires_review from proj_tasks where id='${T1}'`) !== "t") throw new Error("review flag lost");
  const opts = await (async () => { await page.getByRole("button", { name: /new task/i }).first().click(); const o = await dialog().getByLabel("Assigned to").locator("option").allInnerTexts(); await page.keyboard.press("Escape"); return o; })();
  if (opts.some((o) => /mgr/.test(o))) throw new Error("head can assign outside the team: " + opts.join(","));
});
await as("hr@e2e.local");
await step("Member: starts the task, sends it for review, and cannot complete it themself", async () => {
  await go(`/projects/${P}/work/tasks/${T1}`);
  await page.getByRole("button", { name: /^start$/i }).click(); await seen(/In progress/);
  if ((await page.getByRole("button", { name: /accept and complete|mark done/i }).count()) > 0) throw new Error("self-completion offered for a review task");
  await page.getByRole("button", { name: /send for review/i }).click(); await seen(/Ready for review/);
  if ((await page.getByRole("button", { name: /accept and complete/i }).count()) > 0) throw new Error("self-review offered");
  if (db(`select status from proj_tasks where id='${T1}'`) !== "ready_for_review") throw new Error("db status");
});
await step("Member: creates a task for themself only; routine tasks finish without review; blocking needs a reason", async () => {
  await go(`/projects/${P}/work`);
  await page.getByRole("button", { name: /new task/i }).first().click();
  const opts = await dialog().getByLabel("Assigned to").locator("option").allInnerTexts(); if (opts.length !== 1) throw new Error("member can assign to others: " + opts.join(","));
  await dialog().getByLabel("Title").fill("Prepare test rig"); await dialog().getByLabel("Due date").fill(dayIso(12));
  await dialog().getByRole("button", { name: /create task/i }).click(); await closed();
  T2 = db("select id from proj_tasks where title='Prepare test rig'");
  await go(`/projects/${P}/work/tasks/${T2}`);
  await page.getByRole("button", { name: /block task/i }).click();
  await dialog().getByRole("button", { name: /mark as blocked/i }).click(); await page.waitForTimeout(800);
  if (db(`select blocked_at is null from proj_tasks where id='${T2}'`) !== "t") throw new Error("blocked without a reason");
  await dialog().getByLabel("What is blocking it").fill("Truss not delivered"); await dialog().getByLabel(/Or what action/).fill("Standbuilder delivers the truss");
  await dialog().getByRole("button", { name: /mark as blocked/i }).click(); await closed(); await seen(/Truss not delivered/);
  if ((await page.getByRole("button", { name: /mark done/i }).count()) > 0) throw new Error("Mark done offered while blocked");
  await page.getByRole("button", { name: /clear blocker/i }).first().click(); await dialog().getByRole("button", { name: /clear blocker/i }).click(); await closed(); await until(() => db(`select blocked_at is null from proj_tasks where id='${T2}'`) === "t");
  await page.getByRole("button", { name: /^start$/i }).click(); await seen(/In progress/);
  await page.getByRole("button", { name: /mark done/i }).click(); await seen(/Done/);
});
await as("lead@e2e.local");
await step("Department head: accepts the reviewed task and the deliverable's status can then move", async () => {
  await go(`/projects/${P}/work/tasks/${T1}`);
  await page.getByRole("button", { name: /accept and complete/i }).click(); await seen(/Done/);
  if (db(`select completed_by from proj_tasks where id='${T1}'`) !== U(7)) throw new Error("not completed by the head");
});
await as("mgr@e2e.local");
await step("Changing a due date lists dependent work and moves nothing", async () => {
  await go(`/projects/${P}/work`);
  await page.getByRole("button", { name: /new task/i }).first().click();
  await dialog().getByLabel("Title").fill("Rig test"); await dialog().getByLabel("Assigned to").selectOption({ label: "hr" });
  await dialog().getByLabel("Start date").fill(dayIso(5)); await dialog().getByLabel("Due date").fill(dayIso(12));
  await dialog().getByRole("button", { name: /create task/i }).click(); await closed();
  const A = db("select id from proj_tasks where title='Rig test'");
  await page.getByRole("button", { name: /new task/i }).first().click();
  await dialog().getByLabel("Title").fill("Hardware demo"); await dialog().getByLabel("Assigned to").selectOption({ label: "hr" });
  await dialog().getByLabel("Start date").fill(dayIso(13)); await dialog().getByLabel("Due date").fill(dayIso(16));
  await dialog().getByLabel(/Depends on/).selectOption({ label: "Rig test" });
  await dialog().getByRole("button", { name: /create task/i }).click(); await closed();
  if (db("select count(*) from proj_task_dependencies") !== "1") throw new Error("dependency not stored");
  await go(`/projects/${P}/work/tasks/${A}`);
  const before = db("select due_date::text || start_date::text from proj_tasks where title='Hardware demo'");
  await page.getByRole("button", { name: /edit task/i }).click();
  await dialog().getByLabel("Due date").fill(dayIso(20)); await dialog().getByLabel(/Why is the date changing/).fill("Truss delivery slipped");
  await page.waitForTimeout(1500);
  const text = (await dialog().innerText()).replace(/\s+/g, " ");
  if (!/Hardware demo/.test(text)) throw new Error("dependent task not listed before saving: " + text.slice(0, 300));
  await dialog().getByLabel(/I have seen this/).check();
  await dialog().getByRole("button", { name: /save task/i }).click(); await closed();
  if (db("select due_date::text || start_date::text from proj_tasks where title='Hardware demo'") !== before) throw new Error("dependent task was moved automatically");
  await until(() => db(`select count(*) from proj_task_events where task_id='${A}' and kind='due_date_changed'`) === "1");
  await seen(/Due date changed|moved from|due date/i);
});
await as("lead@e2e.local");
await step("Department head: accepts the team's deliverable (only theirs)", async () => {
  await go(`/projects/${P}/work`);
  if ((await page.getByRole("button", { name: /add milestone|add deliverable/i }).count()) > 0) throw new Error("PM-only controls shown to a head");
  await page.getByRole("button", { name: /change status/i }).first().click();
  await dialog().getByLabel("New status").selectOption({ label: "Accepted" });
  await dialog().getByRole("button", { name: /change status/i }).click(); await closed();
  await until(() => db("select status from proj_deliverables") === "accepted");
});
await as("mgr@e2e.local");
await step("PM: accepts the milestone; progress states its basis (1 of 2 required milestones accepted)", async () => {
  await go(`/projects/${P}/work`);
  await page.getByRole("button", { name: /change status/i }).first().click();
  await dialog().getByLabel("New status").selectOption({ label: "Accepted" });
  await dialog().getByRole("button", { name: /change status/i }).click(); await closed();
  await seen(/1 of 2 required milestones accepted/);
  if (db("select count(*) from proj_milestones where status='accepted'") !== "1") throw new Error("not accepted");
});
console.log(`\nverdict: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${passes} passed)`);
await browser.close(); process.exit(fails === 0 ? 0 : 1);
