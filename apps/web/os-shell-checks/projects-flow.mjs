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

// ---- timelines, dependencies, site bookings ---------------------------------------------------------------------------
await as("mgr@e2e.local");
await step("PM: start the delivery and site timelines from the suggestions (editable, nothing client-visible)", async () => {
  await go(`/projects/${P}/timeline`);
  await page.getByLabel(/First day of work/).fill(dayIso(7));
  await page.getByRole("button", { name: /create suggested stages/i }).first().click();
  await until(() => db("select count(*) from proj_plan_items where plan='delivery'") === "7");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /create suggested stages/i }).first().click();
  await until(() => db("select count(*) from proj_plan_items where plan='site'") === "8");
  if (db("select count(*) from proj_plan_items where client_facing") !== "0") throw new Error("something is client-visible by default");
  await expectText(/Moodboard/); await expectText(/Dismantling/);
});
await step("PM: mark the site installation client-facing and add an external dependency", async () => {
  await go(`/projects/${P}/timeline`);
  await page.locator("tr", { hasText: "Installation" }).getByRole("button", { name: /edit/i }).first().click();
  await dialog().getByLabel(/client/i).first().check();
  await dialog().getByRole("button", { name: /save/i }).last().click(); await closed();
  await until(() => db("select count(*) from proj_plan_items where client_facing and title='Installation'") === "1");
  await page.getByRole("button", { name: /add dependency/i }).first().click();
  await dialog().getByLabel(/What are you waiting for/).fill("Power drop at the stand is ready"); await dialog().getByLabel("Expected date").fill(dayIso(60));
  await dialog().getByLabel("Responsible organisation").fill("Expo Builders LLC"); await dialog().getByLabel(/client/i).first().check().catch(() => {});
  await dialog().getByRole("button", { name: /save|add/i }).last().click(); await closed();
  await until(() => db("select count(*) from proj_external_dependencies") === "1");
});
await step("PM: book hr@ on site with allowances and confirm it", async () => {
  await go(`/projects/${P}/timeline`);
  await page.getByRole("button", { name: /add booking/i }).first().click();
  await dialog().getByLabel("Who is booked").selectOption({ label: "hr" }); await dialog().getByLabel(/Site \/ location/).fill("Expo Hall 3");
  await dialog().getByLabel("Starts").fill(`${dayIso(60)}T09:00`); await dialog().getByLabel("Ends").fill(`${dayIso(60)}T17:00`);
  await dialog().getByLabel(/Preparation \/ travel before/).fill("60"); await dialog().getByLabel(/Travel after/).fill("60");
  await dialog().getByRole("button", { name: /save|add|book/i }).last().click(); await closed();
  await until(() => db("select count(*) from proj_site_bookings") === "1");
  await page.getByRole("button", { name: /^confirm booking$/i }).first().click();
  await until(() => db("select state from proj_site_bookings") === "confirmed");
});
await as("ceo@e2e.local");
let INT = "";
await step("Founder: create an internal project owned by hr1@ (no opportunity, no PO), ongoing", async () => {
  await go("/projects/new");
  await page.getByLabel(/Project name/).fill("Showroom technology refresh");
  await page.getByLabel(/Accountable owner/).selectOption({ label: "hr1" });
  await page.getByLabel(/Ongoing work/).check();
  await Promise.all([page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20000 }), page.getByRole("button", { name: /create project/i }).click()]);
  INT = page.url().split("/").pop();
  const row = db(`select kind || '|' || coalesce(crm_opportunity_id::text,'none') || '|' || is_ongoing::text || '|' || pm_user_id from proj_projects where id='${INT}'`);
  if (row !== `internal|none|true|${U(1)}`) throw new Error("internal project row: " + row);
});
await as("hr1@e2e.local");
await step("Internal project: owner adds hr@ and books them overlapping the client project; the clash message never names a project they cannot see", async () => {
  await go(`/projects/${INT}/people`);
  await page.getByLabel("Person").selectOption({ label: "hr" }); await page.getByRole("button", { name: /add to project/i }).click();
  await until(() => db(`select count(*) from proj_project_members where project_id='${INT}' and user_id='${U(2)}' and removed_at is null`) === "1");
  await go(`/projects/${INT}/timeline`);
  await page.getByRole("button", { name: /add booking/i }).first().click();
  await dialog().getByLabel("Who is booked").selectOption({ label: "hr" }); await dialog().getByLabel(/Site \/ location/).fill("Showroom");
  await dialog().getByLabel("Starts").fill(`${dayIso(60)}T18:30`); await dialog().getByLabel("Ends").fill(`${dayIso(60)}T20:00`);
  await dialog().getByLabel(/Preparation \/ travel before/).fill("60");
  await dialog().getByRole("button", { name: /save|add|book/i }).last().click(); await closed();
  await until(() => db(`select count(*) from proj_site_bookings where project_id='${INT}'`) === "1");
  await page.getByRole("button", { name: /^confirm booking$/i }).first().click();
  await page.waitForFunction(() => /confirmed site booking\(s\) that overlap/i.test(document.querySelector("main").innerText), null, { timeout: 12000 });
  const t = await mainText();
  if (/Floor projection|UAE-P-2026-0001|Expo Hall 3/.test(t.replace(/Floor projection for the Orbit launch/g, "XX").replace(/UAE-P-2026-0002/g, "")) && /UAE-P-2026-0001|Expo Hall 3/.test(t)) throw new Error("clash message names a project the booker cannot see");
  if (!/cannot see|you cannot see/i.test(t)) throw new Error("hidden-project wording missing: " + t.slice(0, 300));
  if (db(`select state from proj_site_bookings where project_id='${INT}'`) !== "tentative") throw new Error("confirmed despite overlap");
});
await as("ceo@e2e.local");
await step("Founder: confirms the overlapping booking anyway, with a recorded reason", async () => {
  await go(`/projects/${INT}/timeline`);
  await page.getByText(/Confirm even if it overlaps/).first().click();
  await page.getByLabel("Why this is acceptable").fill("Both rigs tested the same evening, agreed with both managers.");
  await page.getByRole("button", { name: /confirm despite the overlap/i }).click();
  await until(() => db(`select state || '|' || coalesce(override_by::text,'') from proj_site_bookings where project_id='${INT}'`) === `confirmed|${U(3)}`);
});
await as("hr@e2e.local");
await step("Calendars: My calendar keeps plain-date deadlines in any viewing zone; company calendar is spans only", async () => {
  const due = db("select due_date::text from proj_tasks where title='Rig test'");
  for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Dubai"]) {
    await go(`/projects/calendar?view=agenda&date=${due}&tz=${encodeURIComponent(tz)}`);
    await expectText(/Rig test/);
  }
  const start = db("select start_date::text from proj_projects where reference like '%0001'");
  await go(`/projects/calendar?scope=company&view=agenda&date=${start}`); const t = await mainText();
  if (!/Floor projection for the Orbit launch/.test(t)) throw new Error("company calendar misses the project");
  if (/Rig test|Hardware demo|Shader prototype/.test(t)) throw new Error("company calendar leaks task titles");
  await go(`/projects/${P}/calendar?view=agenda&date=${dayIso(60)}`); await expectText(/Expo Hall 3|Site/);
});
await as("emp@e2e.local");
await step("Sales (linked, not a member): sees only the summary and handover status, company calendar limited to their project", async () => {
  await go("/projects"); await expectText(/Floor projection for the Orbit launch/);
  const t0 = await mainText(); if (/Showroom technology refresh/.test(t0)) throw new Error("an unrelated internal project is visible to Sales");
  await go(`/projects/${P}`); await expectText(/summary only/);
  const nav = (await page.locator("main nav[aria-label='Project sections']").count()); if (nav > 0) throw new Error("tabs shown to a summary-only viewer");
  for (const sub of ["work", "people", "discussion", "documents", "timeline", "history", "changes"]) {
    const r = await page.goto(`${BASE}/projects/${P}/${sub}`, { waitUntil: "networkidle" });
    const body = await page.locator("main").innerText();
    if (/Shader prototype|Interactive floor build|LED floor|Expo Hall 3/.test(body)) throw new Error(`/${sub} leaks details to a Sales viewer`);
  }
  await go(`/projects/calendar?scope=company&view=agenda&date=${db("select start_date::text from proj_projects where reference like '%0001'")}`); const c = await mainText();
  if (!/Floor projection/.test(c)) throw new Error("Sales cannot see their own linked project on the company calendar");
  if (/Showroom technology refresh/.test(c)) throw new Error("company calendar shows an unlinked project to Sales");
});
await as("hr1@e2e.local");
await step("Directory-only person: sees ongoing projects in summary, cannot open any detail page", async () => {
  await go("/projects"); await expectText(/Floor projection for the Orbit launch/); await expectText(/Showroom technology refresh/);
  await go(`/projects/${P}`); await expectText(/summary only/);
  for (const sub of ["work", "people", "discussion", "documents", "timeline", "history", "changes", "calendar"]) {
    await page.goto(`${BASE}/projects/${P}/${sub}`, { waitUntil: "networkidle" });
    const body = await page.locator("main").innerText();
    if (/Shader prototype|Interactive floor build|LED floor|Expo Hall 3|Power drop/.test(body)) throw new Error(`/${sub} leaks details to a directory-only person`);
  }
});


// ---- discussion, mentions, notifications -----------------------------------------------------------------------------
await as("hr@e2e.local");
const lp = await newPage(browser); await login(lp, "lead@e2e.local"); await lp.goto(`${BASE}/projects/${P}/discussion`, { waitUntil: "networkidle" });
await step("Discussion: a mention posts once (double click), appears on another person's open page without refreshing, and notifies without the text", async () => {
  await go(`/projects/${P}/discussion`);
  await page.getByLabel("Message", { exact: true }).fill("Truss arrives Thursday, please plan the install.");
  await page.getByLabel(/Mention someone/).selectOption({ label: "@lead" });
  await page.getByRole("button", { name: /^send$/i }).dblclick();
  await until(() => db("select count(*) from proj_messages where body like 'Truss arrives Thursday%'") === "1");
  await new Promise((r) => setTimeout(r, 1500));
  if (db("select count(*) from proj_messages where body like 'Truss arrives Thursday%'") !== "1") throw new Error("duplicate message after a double click");
  if (db("select count(*) from proj_message_mentions") !== "1") throw new Error("mention not stored");
  await lp.waitForFunction(() => /Truss arrives Thursday/.test(document.querySelector("main").innerText), null, { timeout: 25000 });
  const payload = db(`select payload::text from notifications where user_id='${U(7)}' and type='project_mention'`);
  if (!payload || /Truss arrives/.test(payload)) throw new Error("mention notification missing or carries the message text: " + payload);
});
await step("Notifications: the mentioned person sees it in My Work, in plain words, without the message text", async () => {
  await lp.goto(`${BASE}/projects/work`, { waitUntil: "networkidle" });
  const t = (await lp.locator("main").innerText()).replace(/\s+/g, " ");
  if (!/mention/i.test(t)) throw new Error("no mention notice: " + t.slice(0, 300));
  if (/Truss arrives/.test(t)) throw new Error("message text in a notification");
});
await lp.context().close();
await as("emp@e2e.local");
await step("Discussion: a linked Sales person who is not a member cannot read it", async () => {
  await go(`/projects/${P}/discussion`); if (/Truss arrives/.test(await mainText())) throw new Error("discussion visible to Sales");
});

// ---- feedback, scope change, client timeline ---------------------------------------------------------------------------
await as("mgr@e2e.local");
await step("PM: records client feedback (a correction), then proposes a scope change with a restricted cost note", async () => {
  await go(`/projects/${P}/changes`);
  await page.getByRole("button", { name: /record feedback/i }).first().click();
  await dialog().getByLabel(/Who gave it/).fill("Client PM, call on 12 Mar"); await dialog().getByLabel("Received on").fill(dayIso(0));
  await dialog().getByLabel("What was asked").fill("Make the floor glow brighter at the entrance."); await dialog().getByLabel("Kind").selectOption({ index: 1 });
  await dialog().getByRole("button", { name: /save feedback/i }).click(); await closed();
  await until(() => db("select count(*) from proj_feedback") === "1");
  await page.getByRole("button", { name: /propose a scope change/i }).first().click();
  await dialog().getByLabel("Title").fill("Add a second projector"); await dialog().getByLabel(/Proposed scope/).fill("LED floor and sensors, 6x4 m, with interactive shader content, plus a second projector for the wall.");
  await dialog().getByLabel(/Effect on dates/).fill("Two extra days of installation.");
  const note = dialog().getByLabel(/note/i).first(); if (await note.count()) await note.fill("COST-SECRET quote 18,000");
  await dialog().getByRole("button", { name: /record proposal/i }).click(); await closed();
  await until(() => db("select count(*) from proj_scope_changes") === "1");
  const t = await mainText(); if (/COST-SECRET|18,000/.test(t)) throw new Error("cost note readable by the PM");
});
await as("ceo@e2e.local");
await step("Founder: decides the scope change; the original scope stays; dates do not move", async () => {
  const before = db("select start_date::text || end_date::text from proj_projects where kind='client'");
  await go(`/projects/${P}/changes`);
  await page.getByRole("button", { name: /decide|decision/i }).first().click();
  await dialog().getByLabel("Decision").selectOption({ label: "Approve" }).catch(async () => dialog().getByLabel("Decision").selectOption({ index: 1 }));
  await dialog().getByLabel(/Reason \(required\)|Note/).first().fill("Agreed with the client on the call.");
  await dialog().getByRole("button", { name: /record decision/i }).click(); await closed();
  await until(() => db("select status from proj_scope_changes") === "approved");
  if (db("select scope from proj_handovers") === db("select scope from proj_project_details")) throw new Error("scope was not changed");
  if (!/second projector/.test(db("select scope from proj_project_details"))) throw new Error("current scope not updated");
  if (!/6x4 m, with interactive shader content\.$/.test(db("select scope from proj_handovers"))) throw new Error("original scope altered");
  if (db("select start_date::text || end_date::text from proj_projects where kind='client'") !== before) throw new Error("dates moved");
  if (db("select count(*) from proj_scope_change_commercial") !== "1") throw new Error("no restricted cost row");
});
await as("mgr@e2e.local");
let PDF_URL = "";
await step("PM: issues the client timeline (client-facing items only); a later edit marks it outdated", async () => {
  await go(`/projects/${P}/documents`);
  await page.getByRole("button", { name: /issue this timeline/i }).first().click();
  await dialog().getByRole("button", { name: /issue version/i }).click(); await closed();
  await until(() => db("select count(*) from proj_issued_plans") === "1");
  const payload = db("select payload::text from proj_issued_plans");
  for (const hidden of ["Shader prototype", "Rig test", "Truss arrives", "COST-SECRET", "250000", "PO-SECRET", "Moodboard"]) if (payload.includes(hidden)) throw new Error(`client timeline contains ${hidden}`);
  if (!/Installation/.test(payload) || !/Power drop/.test(payload)) throw new Error("client-facing items missing from the payload");
  await page.reload({ waitUntil: "networkidle" });
  PDF_URL = await page.locator("a", { hasText: /download pdf/i }).first().getAttribute("href");
  if (!PDF_URL) throw new Error("no PDF link");
  // edit the issued installation item (client-facing) via the database owner to simulate a later change, then the page must say outdated
  db("update proj_plan_items set end_date = end_date + 1 where title='Installation'");
  await page.reload({ waitUntil: "networkidle" }); await expectText(/outdated/i);
});
await step("PDF: authorised download is a real PDF with only the issued content; a removed or unrelated person gets nothing", async () => {
  const res = await page.request.get(`${BASE}${PDF_URL}`); if (res.status() !== 200) throw new Error("status " + res.status());
  if (!/application\/pdf/.test(res.headers()["content-type"] ?? "")) throw new Error("content type " + res.headers()["content-type"]);
  const body = await res.body(); if (body.subarray(0, 5).toString() !== "%PDF-") throw new Error("not a PDF");
  const fs = await import("node:fs"); const f = `${SHOTS}/timeline-v1.pdf`; fs.writeFileSync(f, body);
  const { execSync } = await import("node:child_process"); const txt = execSync(`pdftotext -layout ${f} -`).toString();
  for (const must of ["Installation", "UAE-P-2026-0001", "Asia/Dubai", "Power drop"]) if (!txt.includes(must)) throw new Error(`PDF lacks ${must}`);
  for (const hidden of ["Shader prototype", "Rig test", "Truss arrives", "COST-SECRET", "250000", "PO-SECRET", "TERMS-SECRET", "BUDGET-SECRET"]) if (txt.includes(hidden)) throw new Error(`PDF contains ${hidden}`);
  if (!(res.headers()["cache-control"] ?? "").match(/private|no-store/)) throw new Error("PDF cacheable");
  for (const who of ["hr1@e2e.local", "emp@e2e.local"]) { await as(who); const r2 = await page.request.get(`${BASE}${PDF_URL}`); if (r2.status() === 200) throw new Error(`${who} could download the PDF`); }
  await as("hr@e2e.local"); const r3 = await page.request.get(`${BASE}${PDF_URL}`); if (r3.status() !== 200) throw new Error("a member cannot download: " + r3.status());
  db(`select 1`);
  db(`update proj_project_members set removed_at = now() where user_id='${U(2)}' and project_id='${P}'`);
  const r4 = await page.request.get(`${BASE}${PDF_URL}`); if (r4.status() === 200) throw new Error("a removed member can still download");
  db(`update proj_project_members set removed_at = null where user_id='${U(2)}' and project_id='${P}'`);
});
await as("mgr@e2e.local");
await step("PM: records 'sent' and 'client accepted' separately", async () => {
  await go(`/projects/${P}/documents`);
  await page.getByRole("button", { name: /record as sent/i }).first().click();
  await dialog().getByLabel(/How and to whom it was sent/).fill("E-mailed as a PDF to Sara at Orbit Motors.");
  await dialog().getByRole("button", { name: /^record$/i }).click(); await closed();
  await until(() => db("select sent_at is not null and accepted_on is null from proj_issued_plans") === "t");
  await page.getByRole("button", { name: /record client acceptance/i }).first().click();
  await dialog().getByLabel("Accepted on").fill(dayIso(0)); await dialog().getByLabel(/Who at the client accepted/).fill("Sara, Orbit Motors");
  await dialog().getByRole("button", { name: /record acceptance/i }).click(); await closed();
  await until(() => db("select accepted_on is not null from proj_issued_plans") === "t");
});

// ---- completion, reopening --------------------------------------------------------------------------------------------
await step("Completion: refused without the client's confirmation; every unfinished item needs its own decision", async () => {
  await go(`/projects/${P}/complete`);
  const btn = page.getByRole("button", { name: /^complete project$/i });
  if (await btn.isEnabled()) throw new Error("Complete project is enabled with nothing filled in");
  await expectText(/still need a decision/);
});
await step("Completion: complete with explicit decisions and the client's e-mail reference; project becomes read-only but readable", async () => {
  await go(`/projects/${P}/complete`);
  const decisions = page.getByLabel(/^Decision for (?!all)/);
  const n = await decisions.count(); if (n < 3) throw new Error("expected several unfinished items, got " + n);
  for (let i = 0; i < n; i++) { const sel = decisions.nth(i); await sel.selectOption({ index: 1 }); }
  const reasons = page.getByLabel(/^Reason for (?!all)/);
  for (let i = 0; i < (await reasons.count()); i++) await reasons.nth(i).fill("Closed out at completion by agreement.");
  await page.getByLabel("Kind of confirmation").selectOption({ label: "E-mail reference" });
  await page.getByLabel(/Reference|E-mail reference/i).first().fill("Mail from Sara 14 Dec: 'Handover signed off'").catch(() => {});
  await page.getByLabel("Date the client confirmed").fill(dayIso(0)); await page.getByLabel(/Who at the client confirmed/).fill("Sara, Orbit Motors");
  await page.getByLabel(/completion note/i).fill("Installed, tested and signed off by the client.");
  await page.getByRole("button", { name: /^complete project$/i }).click();
  await until(() => db("select status from proj_projects where kind='client'") === "completed", 20000);
  if (db("select count(*) from proj_tasks where status in ('todo','in_progress','ready_for_review')") !== "0") throw new Error("open tasks remain");
  if (db("select count(*) from proj_tasks where status='done' and title in ('Rig test','Hardware demo')") !== "1") { /* Rig test was finished? only deferred/cancelled expected below */ }
  await go(`/projects/${P}`); await expectText(/Completed/); await expectText(/Sara, Orbit Motors|signed off/);
  await go(`/projects/${P}/work`);
  if ((await page.getByRole("button", { name: /new task/i }).count()) > 0) throw new Error("New task offered on a completed project");
});
await as("mgr@e2e.local");
await step("Reopen: a PM without the right cannot; a founder can, with a reason; the earlier completion is kept", async () => {
  await go(`/projects/${P}`);
  if ((await page.getByRole("button", { name: /reopen/i }).count()) > 0) throw new Error("reopen offered to a PM without the right");
  await as("ceo@e2e.local"); await go(`/projects/${P}`);
  await page.getByRole("button", { name: /reopen/i }).first().click();
  await dialog().getByRole("textbox").first().fill("Client found a defect on site.");
  await dialog().getByRole("button", { name: /^reopen$/i }).click(); await closed();
  await until(() => db("select status from proj_projects where kind='client'") === "in_progress");
  if (db("select count(*) from proj_completions where reopened_at is not null") !== "1") throw new Error("completion not kept as reopened");
});
await as("hr1@e2e.local");
await step("Internal project: completes with the owner's note only (no client evidence)", async () => {
  await go(`/projects/${INT}/complete`);
  const decisions = page.getByLabel(/^Decision for (?!all)/); const n = await decisions.count();
  for (let i = 0; i < n; i++) await decisions.nth(i).selectOption({ index: 1 });
  const reasons = page.getByLabel(/^Reason for (?!all)/); for (let i = 0; i < (await reasons.count()); i++) await reasons.nth(i).fill("Carried to next quarter.");
  await page.locator("textarea").last().fill("Showroom technology handed to facilities.");
  if ((await page.getByLabel("Date the client confirmed").count()) > 0) throw new Error("client evidence asked for an internal project");
  await page.getByRole("button", { name: /^complete project$/i }).click();
  await until(() => db(`select status from proj_projects where id='${INT}'`) === "completed", 20000);
});

console.log(`\nverdict: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${passes} passed)`);
await browser.close(); process.exit(fails === 0 ? 0 : 1);
