// Real-browser regression of Projects & Tasks through the ENGINIOUS OS interface (LOCAL STACK ONLY; see README.md).
// Seed first with the local stack (founder ceo@, PM mgr@, department head lead@, member hr@, directory-only hr1@, Sales emp@ who owns a Won
// opportunity, admin@ with no Projects access), then run this against the production build. Writes to the local database only.
import { execSync } from "node:child_process";
import { chromium, newPage, login, BASE, optionTexts, choose, psql as sql } from "./lib.mjs";
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
// A modal form (native <dialog>); the side panel is an <aside role=dialog> and is addressed separately.
const dialog = () => page.locator("dialog[open]");
const panel = () => page.locator("aside[role=dialog]");
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
// Run SQL as a signed-in person, through the same function the app calls. Returns the last line printed.
const asDb = (n, stmt) => execSync(`psql -h 127.0.0.1 -U postgres -d ${process.env.LOCAL_DB_NAME ?? "hr_local_stack"} -v ON_ERROR_STOP=1 -Atq`, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${U(n)}","role":"authenticated"}', true);\n${stmt};\ncommit;\n` }).toString().trim().split("\n").filter(Boolean).pop();
const dayIso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ---- helpers for the simplified screens ----------------------------------------------------------------------------------
// A MoreMenu ("Plan", "Manage project", "More"): open it, read or pick an item.
// (Scoped to <main>: the account menu in the header is also a menu.)
const openMenu = async (button) => { await page.locator("main").getByRole("button", { name: button, exact: true }).first().click(); await page.locator("main").getByRole("menu").first().waitFor(); };
const menuItems = async (button) => { await openMenu(button); const t = (await page.locator("main").getByRole("menu").first().locator("[role=menuitem]").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()); await page.keyboard.press("Escape"); return t; };
const pick = async (button, item) => { await openMenu(button); await page.locator("main").getByRole("menuitem", { name: item }).first().click(); };
// The Milestones & deliverables section is collapsed once milestones exist.
const openMilestones = async () => { const d = page.locator("details#milestones"); if (!(await d.evaluate((e) => e.open))) await d.locator("summary").first().click(); };
const taskRow = (title) => page.locator("main tbody tr", { hasText: title }).first();
// Add task (Quick Add): what, who, when; "more" fills the optional details first.
const addTask = async (t, { assignee, due, more, dbl = false } = {}) => {
  await page.getByRole("button", { name: /^Add task$/ }).first().click();
  const d = dialog(); await d.waitFor();
  await d.getByLabel("What needs doing").fill(t);
  if (more) { await d.locator("summary", { hasText: "Add more details" }).click(); await more(d); }
  if (assignee) await d.getByLabel("Assignee", { exact: true }).selectOption({ label: assignee });
  if (due) await d.getByLabel("Due", { exact: true }).fill(due);
  const submit = d.getByRole("button", { name: /^Add task$/ });
  if (dbl) await submit.dblclick(); else await submit.click();
  await closed();
};

// ---- access ------------------------------------------------------------------------------------------------------
await as("admin@e2e.local");
await step("a person with no Projects grant sees no module and an explanation", async () => {
  await go("/projects"); await expectText(/do not have Projects access/);
  const nav = (await page.locator("aside nav[aria-label='Modules']").innerText()).replace(/\s+/g, " ");
  if (/Projects & Tasks/.test(nav)) throw new Error("module shown in menu");
  await go("/projects/work"); await expectText(/do not have Projects access/);
});
await as("hr@e2e.local");
await step("an HR admin with a plain Projects grant sees the module and the directory; HR pages unchanged", async () => {
  await go("/projects"); await expectText(/No projects yet|Ongoing \(\d+\)/);
  const nav = (await page.locator("aside nav[aria-label='Modules']").innerText()).replace(/\s+/g, " ");
  if (!/Projects & Tasks/.test(nav)) throw new Error("module missing from the menu: " + nav);
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
await step("PM: the waiting handover is called out in My Work and on Projects, one click from the handover itself", async () => {
  await go("/projects/work"); await expectText(/1 handover waiting on you/);
  await page.getByRole("link", { name: /open handovers/i }).click(); await page.waitForURL(/\/projects\/handovers$/); await seen(/Waiting on you as Project Manager/);
  await go("/projects"); await expectText(/1 handover waiting on you/);
});
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
  // Accepting the same handover again (a retried request, a second tab) returns the same project: nothing is duplicated.
  const again = asDb(4, `select proj_accept_handover('${HANDOVER}')`);
  if (again !== P) throw new Error(`a second accept returned ${again}, not the project ${P}`);
  if (db("select count(*) from proj_projects") !== "1" || db("select count(*) from proj_handovers where project_id is not null") !== "1") throw new Error("a second accept created another project");
});
await step("project overview: summary facts, scope as agreed, no commercial data, no invented percentage", async () => {
  await go(`/projects/${P}`); const t = await mainText();
  if (!/Expo Hall 3/.test(t)) throw new Error("location missing");
  for (const secret of ["PO-SECRET-123", "BUDGET-SECRET", "TERMS-SECRET", "250,000", "250000"]) if (t.includes(secret)) throw new Error(`secret ${secret} visible`);
  if (/\d+%/.test(t) && !/required milestone/.test(t)) throw new Error("percentage without basis");
});



// ---- people, departments, temporary leadership --------------------------------------------------------------------
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
await step("Member: cannot manage people or milestones (no controls, a short Manage menu, and the database refuses)", async () => {
  await go(`/projects/${P}/people`); const t = await mainText();
  if (/Add department team|Add to project|Appoint/.test(t)) throw new Error("management controls shown to a member");
  await go(`/projects/${P}/work?tasks=all`);
  if ((await page.getByRole("button", { name: /^Plan$/, exact: true }).count()) > 0) throw new Error("Plan menu (add milestone / deliverable) shown to a member");
  const items = await menuItems("Manage project");
  if (items.some((i) => /Edit details|Change status|Complete project|Reopen/.test(i))) throw new Error("manager items in a member's Manage menu: " + items.join(" | "));
  if (!items.some((i) => /People & access/.test(i)) || !items.some((i) => /Files & client plan/.test(i)) || !items.some((i) => /History/.test(i))) throw new Error("secondary pages missing from Manage: " + items.join(" | "));
  if (db(`select count(*) from proj_milestones`) !== "0") throw new Error("milestones exist before the PM added any");
});

// ---- milestones, deliverables, tasks ---------------------------------------------------------------------------------
await as("mgr@e2e.local");
let MS1 = ""; let DL = "";
await step("PM: add two milestones and a deliverable for Programming (Plan menu on Work)", async () => {
  await go(`/projects/${P}/work?tasks=all`);
  await pick("Plan", /Add milestone/);
  await dialog().getByLabel("Title").fill("First draft approved"); await dialog().getByLabel("Due date").fill(dayIso(30));
  await dialog().getByRole("button", { name: /^Add milestone$/ }).click(); await closed();
  await pick("Plan", /Add milestone/);
  await dialog().getByLabel("Title").fill("Final render approved"); await dialog().getByLabel("Due date").fill(dayIso(45));
  await dialog().getByRole("button", { name: /^Add milestone$/ }).click(); await closed();
  MS1 = db("select id from proj_milestones where title='First draft approved'");
  await pick("Plan", /Add deliverable/);
  await dialog().getByLabel("Title").fill("Interactive floor build"); await dialog().getByLabel("Department team").selectOption({ label: "Programming" });
  await dialog().getByLabel("Milestone").selectOption({ label: "First draft approved" }); await dialog().getByLabel("Due date").fill(dayIso(25));
  await dialog().getByRole("button", { name: /^Add deliverable$/ }).click(); await closed();
  DL = db("select id from proj_deliverables"); if (!DL || db("select count(*) from proj_milestones") !== "2") throw new Error("not saved");
  await openMilestones(); await seen(/Interactive floor build/);
});
await as("lead@e2e.local");
let T1 = ""; let T2 = "";
await step("Department head: Add task for a team member with the review rule; cannot assign outside the team", async () => {
  await go(`/projects/${P}/work?tasks=all`);
  await addTask("Shader prototype", {
    assignee: "hr", due: dayIso(10),
    more: async (d) => {
      await d.getByLabel("Department team").selectOption({ label: "Programming" });
      await d.getByLabel("Deliverable").selectOption({ label: "Interactive floor build" });
      await d.getByLabel("Start date").fill(dayIso(3));
      await d.getByLabel("Needs review").check();
    },
  });
  T1 = db("select id from proj_tasks where title='Shader prototype'"); if (!T1) throw new Error("not created");
  if (db(`select requires_review from proj_tasks where id='${T1}'`) !== "t") throw new Error("review flag lost");
  if (db(`select assignee_id from proj_tasks where id='${T1}'`) !== U(2)) throw new Error("wrong assignee");
  await page.getByRole("button", { name: /^Add task$/ }).first().click();
  const o = await optionTexts(dialog().getByLabel("Assignee", { exact: true })); await page.keyboard.press("Escape"); await closed();
  if (o.some((x) => /mgr/.test(x))) throw new Error("head can assign outside the team: " + o.join(","));
  if (!o.some((x) => /hr/.test(x))) throw new Error("head cannot assign inside the team: " + o.join(","));
});
await as("hr@e2e.local");
await step("Member: starts the task in place, sends it for review through its form, and is never offered completion", async () => {
  await go(`/projects/${P}/work/tasks/${T1}`);
  const status = page.getByLabel(/^Status of Shader prototype/);
  let opts = await optionTexts(status);
  if (opts.some((o) => /Accept and complete|Mark done/.test(o))) throw new Error("completion offered on a review task: " + opts.join(" | "));
  await choose(status, /^Start/); await until(() => db(`select status from proj_tasks where id='${T1}'`) === "in_progress");
  await page.waitForFunction(() => /In progress/.test(document.body.innerText), null, { timeout: 12000 });
  opts = await optionTexts(page.getByLabel(/^Status of Shader prototype/));
  if (opts.some((o) => /Accept and complete|Mark done/.test(o))) throw new Error("completion offered after starting: " + opts.join(" | "));
  await choose(page.getByLabel(/^Status of Shader prototype/), /Send for review/);
  await dialog().getByRole("button", { name: /^Send for review$/ }).click(); await closed();
  await until(() => db(`select status from proj_tasks where id='${T1}'`) === "ready_for_review");
  opts = await optionTexts(page.getByLabel(/^Status of Shader prototype/));
  if (opts.some((o) => /Accept and complete|Mark done|Request changes/.test(o))) throw new Error("self-review offered: " + opts.join(" | "));
});
await step("Member: adds a task for themself only (one click, no duplicate); routine tasks finish without review; blocking needs a reason", async () => {
  await go(`/projects/${P}/work?tasks=all`);
  await page.getByRole("button", { name: /^Add task$/ }).first().click();
  const o = await optionTexts(dialog().getByLabel("Assignee", { exact: true })); await page.keyboard.press("Escape"); await closed();
  if (o.length !== 1) throw new Error("member can assign to others: " + o.join(","));
  await addTask("Prepare test rig", { due: dayIso(12), dbl: true });
  if (db("select count(*) from proj_tasks where title='Prepare test rig'") !== "1") throw new Error("double click created " + db("select count(*) from proj_tasks where title='Prepare test rig'") + " tasks");
  T2 = db("select id from proj_tasks where title='Prepare test rig'");
  await go(`/projects/${P}/work/tasks/${T2}`);
  await pick("More", /Block task/);
  await dialog().getByRole("button", { name: /mark as blocked/i }).click(); await page.waitForTimeout(800);
  if (db(`select blocked_at is null from proj_tasks where id='${T2}'`) !== "t") throw new Error("blocked without a reason");
  await dialog().getByLabel("What is blocking it").fill("Truss not delivered"); await dialog().getByLabel(/Or what action/).fill("Standbuilder delivers the truss");
  await dialog().getByRole("button", { name: /mark as blocked/i }).click(); await closed(); await until(() => db(`select blocked_at is not null from proj_tasks where id='${T2}'`) === "t");
  await seen(/Truss not delivered/);
  const blockedOpts = await optionTexts(page.getByLabel(/^Status of Prepare test rig/));
  if (blockedOpts.some((x) => /Mark done/.test(x))) throw new Error("Mark done offered while blocked: " + blockedOpts.join(" | "));
  await pick("More", /Clear blocker/); await dialog().getByRole("button", { name: /^Clear blocker$/ }).click(); await closed();
  await until(() => db(`select blocked_at is null from proj_tasks where id='${T2}'`) === "t");
  await choose(page.getByLabel(/^Status of Prepare test rig/), /^Start/); await until(() => db(`select status from proj_tasks where id='${T2}'`) === "in_progress");
  await choose(page.getByLabel(/^Status of Prepare test rig/), /Mark done/); await until(() => db(`select status from proj_tasks where id='${T2}'`) === "done");
});
await as("lead@e2e.local");
await step("Department head: accepts the reviewed task (confirm form) so the deliverable can move", async () => {
  await go(`/projects/${P}/work/tasks/${T1}`);
  await choose(page.getByLabel(/^Status of Shader prototype/), /Accept and complete/);
  await dialog().getByRole("button", { name: /^Accept and complete$/ }).click(); await closed();
  await until(() => db(`select completed_by from proj_tasks where id='${T1}'`) === U(7));
});
await as("mgr@e2e.local");
await step("Changing a due date in the table lists dependent work and moves nothing", async () => {
  await go(`/projects/${P}/work?tasks=all`);
  await addTask("Rig test", { assignee: "hr", due: dayIso(12), more: async (d) => { await d.getByLabel("Start date").fill(dayIso(5)); } });
  await addTask("Hardware demo", { assignee: "hr", due: dayIso(16), more: async (d) => { await d.getByLabel("Start date").fill(dayIso(13)); await d.getByLabel(/Depends on/).selectOption({ label: "Rig test" }); } });
  if (db("select count(*) from proj_task_dependencies") !== "1") throw new Error("dependency not stored");
  const A = db("select id from proj_tasks where title='Rig test'");
  const before = db("select due_date::text || start_date::text from proj_tasks where title='Hardware demo'");
  const dueBefore = db(`select string_agg(title || ':' || coalesce(due_date::text,''), ',' order by title) from proj_tasks where title not in ('Rig test')`);
  await taskRow("Rig test").getByRole("button", { name: /Change due date of Rig test/ }).click();
  await dialog().getByLabel("Due date").fill(dayIso(20)); await dialog().getByLabel(/Why is the date changing/).fill("Truss delivery slipped");
  await page.waitForTimeout(1500);
  const text = (await dialog().innerText()).replace(/\s+/g, " ");
  if (!/Hardware demo/.test(text)) throw new Error("dependent task not listed before saving: " + text.slice(0, 300));
  await dialog().getByLabel(/I have seen this/).check();
  await dialog().getByRole("button", { name: /save due date/i }).click(); await closed();
  await until(() => db(`select count(*) from proj_task_events where task_id='${A}' and kind='due_date_changed'`) === "1");
  if (db("select due_date::text || start_date::text from proj_tasks where title='Hardware demo'") !== before) throw new Error("dependent task was moved automatically");
  if (db(`select string_agg(title || ':' || coalesce(due_date::text,''), ',' order by title) from proj_tasks where title not in ('Rig test')`) !== dueBefore) throw new Error("another task's date changed");
  await seen(/dependent task/i);
  if (db(`select due_date::text from proj_tasks where id='${A}'`) !== dayIso(20)) throw new Error("new date not saved");
});
await as("lead@e2e.local");
await step("Department head: accepts the team's deliverable (only theirs); has no milestone or deliverable creation", async () => {
  await go(`/projects/${P}/work?tasks=all`);
  if ((await page.getByRole("button", { name: /^Plan$/, exact: true }).count()) > 0) throw new Error("PM-only Plan menu shown to a head");
  await openMilestones();
  if ((await page.getByRole("button", { name: /add milestone|add deliverable/i }).count()) > 0) throw new Error("PM-only controls shown to a head");
  await page.locator("#deliverables li", { hasText: "Interactive floor build" }).getByRole("button", { name: /change status/i }).click();
  await dialog().getByLabel("New status").selectOption({ label: "Accepted" });
  await dialog().getByRole("button", { name: /change status/i }).click(); await closed();
  await until(() => db("select status from proj_deliverables") === "accepted");
});
await as("mgr@e2e.local");
await step("PM: accepts the milestone; progress states its basis (1 of 2 required milestones accepted)", async () => {
  await go(`/projects/${P}/work?tasks=all`); await openMilestones();
  await page.locator("#milestone-list li", { hasText: "First draft approved" }).getByRole("button", { name: /change status/i }).click();
  await dialog().getByLabel("New status").selectOption({ label: "Accepted" });
  await dialog().getByRole("button", { name: /change status/i }).click(); await closed();
  await seen(/1 of 2 required milestones accepted/);
  if (db("select count(*) from proj_milestones where status='accepted'") !== "1") throw new Error("not accepted");
});

// ---- plans: delivery and site, dependencies, site bookings ---------------------------------------------------------------
await as("mgr@e2e.local");
await step("PM: start the delivery and site plans from the suggestions (editable, nothing client-visible)", async () => {
  await go(`/projects/${P}/plan`);
  await page.getByLabel(/First day of work/).fill(dayIso(7));
  await page.getByRole("button", { name: /create suggested stages/i }).first().click();
  await until(() => db("select count(*) from proj_plan_items where plan='delivery'") === "7");
  await go(`/projects/${P}/plan?plan=site`);
  await page.getByRole("button", { name: /create suggested stages/i }).first().click();
  await until(() => db("select count(*) from proj_plan_items where plan='site'") === "8");
  if (db("select count(*) from proj_plan_items where client_facing") !== "0") throw new Error("something is client-visible by default");
  await expectText(/Dismantling/);
  await go(`/projects/${P}/plan`); await expectText(/Moodboard/);
});
await step("PM: mark the site installation client-facing and add an external dependency", async () => {
  await go(`/projects/${P}/plan?plan=site`);
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
await step("Plan: List, Calendar and Timeline are views of the same dates; switching writes nothing; legacy addresses forward here", async () => {
  const snapshot = () => db("select (select string_agg(id::text || coalesce(start_date::text,'') || coalesce(end_date::text,'') || coalesce(starts_at::text,'') || version::text, ',' order by id) from proj_plan_items) || '|' || (select count(*) from proj_plan_items) || '|' || (select count(*) from proj_site_bookings) || '|' || (select count(*) from proj_external_dependencies)");
  const before = snapshot();
  for (const q of ["plan=delivery&mode=list", "plan=delivery&mode=timeline", "plan=delivery&mode=calendar", "plan=site&mode=list", "plan=site&mode=timeline", "plan=site&mode=calendar"]) {
    await go(`/projects/${P}/plan?${q}`);
    const t = await mainText(); if (/Application error|could not be loaded/i.test(t)) throw new Error(`/plan?${q} failed: ${t.slice(0, 160)}`);
    if (/plan=site/.test(q) && !/Site/.test(t)) throw new Error("site plan not shown for " + q);
  }
  await go(`/projects/${P}/plan?plan=delivery&mode=timeline`); if ((await page.getByRole("img", { name: /as bars/i }).count()) + (await page.locator("[aria-label$='as bars']").count()) === 0) throw new Error("timeline bars missing");
  if (snapshot() !== before) throw new Error("switching plan views changed data");
  await go(`/projects/${P}/timeline`); if (!/\/plan/.test(page.url())) throw new Error("/timeline did not forward: " + page.url());
  await go(`/projects/${P}/calendar?view=agenda&date=${dayIso(10)}`); if (!/\/plan\?/.test(page.url()) || !/mode=calendar/.test(page.url()) || !new RegExp(`date=${dayIso(10)}`).test(page.url())) throw new Error("/calendar did not forward with its view and date: " + page.url());
  await go(`/projects/${P}/timeline?check=00000000-0000-4000-8000-000000000001`); if (!/plan=site/.test(page.url())) throw new Error("a conflict-check address did not open the Site plan: " + page.url());
});
await step("PM: book hr@ on site with allowances and confirm it (Site plan)", async () => {
  await go(`/projects/${P}/plan?plan=site`);
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
await step("Founder: Quick Add an internal project owned by hr1@ (no opportunity, no PO), ongoing; /projects/new still works", async () => {
  await go("/projects/new"); await expectText(/internal project/i);
  await go("/projects?add=1");
  const d = dialog(); await d.waitFor();
  await d.getByLabel(/Project name/).fill("Showroom technology refresh");
  await d.getByLabel(/Accountable owner/).selectOption({ label: "hr1" });
  await d.locator("summary", { hasText: "Add more details" }).click();
  await d.getByLabel(/Ongoing work/).check();
  await Promise.all([page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 20000 }), d.getByRole("button", { name: /^create project$/i }).click()]);
  INT = page.url().split("/").pop();
  const row = db(`select kind || '|' || coalesce(crm_opportunity_id::text,'none') || '|' || is_ongoing::text || '|' || pm_user_id from proj_projects where id='${INT}'`);
  if (row !== `internal|none|true|${U(1)}`) throw new Error("internal project row: " + row);
  if (db("select count(*) from proj_projects where kind='internal'") !== "1") throw new Error("more than one internal project");
});
await as("hr1@e2e.local");
await step("Internal project: owner adds hr@ and books them overlapping the client project; the clash message never names a project they cannot see", async () => {
  await go(`/projects/${INT}/people`);
  await page.getByLabel("Person").selectOption({ label: "hr" }); await page.getByRole("button", { name: /add to project/i }).click();
  await until(() => db(`select count(*) from proj_project_members where project_id='${INT}' and user_id='${U(2)}' and removed_at is null`) === "1");
  await go(`/projects/${INT}/plan?plan=site`);
  await page.getByRole("button", { name: /add booking/i }).first().click();
  await dialog().getByLabel("Who is booked").selectOption({ label: "hr" }); await dialog().getByLabel(/Site \/ location/).fill("Showroom");
  await dialog().getByLabel("Starts").fill(`${dayIso(60)}T18:30`); await dialog().getByLabel("Ends").fill(`${dayIso(60)}T20:00`);
  await dialog().getByLabel(/Preparation \/ travel before/).fill("60");
  await dialog().getByRole("button", { name: /save|add|book/i }).last().click(); await closed();
  await until(() => db(`select count(*) from proj_site_bookings where project_id='${INT}'`) === "1");
  await page.getByRole("button", { name: /^confirm booking$/i }).first().click();
  await page.waitForFunction(() => /confirmed site booking\(s\) that overlap/i.test(document.querySelector("main").innerText), null, { timeout: 12000 });
  const t = await mainText();
  if (/UAE-P-2026-0001|Expo Hall 3|Floor projection/.test(t)) throw new Error("clash message names a project the booker cannot see");
  if (!/cannot see|you cannot see/i.test(t)) throw new Error("hidden-project wording missing: " + t.slice(0, 300));
  if (db(`select state from proj_site_bookings where project_id='${INT}'`) !== "tentative") throw new Error("confirmed despite overlap");
});
await as("ceo@e2e.local");
await step("Founder: confirms the overlapping booking anyway, with a recorded reason (from the Site plan)", async () => {
  await go(`/projects/${INT}/plan?plan=site`);
  await page.getByText(/Confirm even if it overlaps/).first().click();
  await page.getByLabel("Why this is acceptable").fill("Both rigs tested the same evening, agreed with both managers.");
  await page.getByRole("button", { name: /confirm despite the overlap/i }).click();
  await until(() => db(`select state || '|' || coalesce(override_by::text,'') from proj_site_bookings where project_id='${INT}'`) === `confirmed|${U(3)}`);
});
await as("hr@e2e.local");
await step("Calendars: My calendar keeps plain-date deadlines in any viewing zone; company calendar is spans only; the project's Plan calendar shows the booking", async () => {
  const due = db("select due_date::text from proj_tasks where title='Rig test'");
  for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Dubai"]) {
    await go(`/projects/calendar?view=agenda&date=${due}&tz=${encodeURIComponent(tz)}`);
    await expectText(/Rig test/);
  }
  const start = db("select start_date::text from proj_projects where reference like '%0001'");
  await go(`/projects/calendar?scope=company&view=agenda&date=${start}`); const t = await mainText();
  if (!/Floor projection for the Orbit launch/.test(t)) throw new Error("company calendar misses the project");
  if (/Rig test|Hardware demo|Shader prototype/.test(t)) throw new Error("company calendar leaks task titles");
  await go(`/projects/${P}/plan?plan=site&mode=calendar&view=agenda&date=${dayIso(60)}`); await expectText(/Expo Hall 3|Site/);
});

await as("emp@e2e.local");
await step("Sales (linked, not a member): sees only the summary and handover status, company calendar limited to their project", async () => {
  await go("/projects"); await expectText(/Floor projection for the Orbit launch/);
  const t0 = await mainText(); if (/Showroom technology refresh/.test(t0)) throw new Error("an unrelated internal project is visible to Sales");
  await go(`/projects/${P}`); await expectText(/summary only/i);
  await expectText(/Enginious Local AE/); await expectNoText(/Unknown/);
  const nav = (await page.locator("main nav[aria-label='Project sections']").count()); if (nav > 0) throw new Error("tabs shown to a summary-only viewer");
  if ((await page.getByRole("button", { name: "Manage project" }).count()) > 0) throw new Error("Manage project shown to a summary-only viewer");
  for (const sub of ["work", "people", "discussion", "documents", "plan", "timeline", "history", "changes"]) {
    await page.goto(`${BASE}/projects/${P}/${sub}`, { waitUntil: "networkidle" });
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
  await go(`/projects/${P}`); await expectText(/summary only/i);
  await expectText(/Enginious Local AE/); await expectNoText(/Unknown/);
  for (const sub of ["work", "people", "discussion", "documents", "plan", "timeline", "history", "changes", "calendar"]) {
    await page.goto(`${BASE}/projects/${P}/${sub}`, { waitUntil: "networkidle" });
    const body = await page.locator("main").innerText();
    if (/Shader prototype|Interactive floor build|LED floor|Expo Hall 3|Power drop/.test(body)) throw new Error(`/${sub} leaks details to a directory-only person`);
  }
});
const INTERNAL = db("select id from proj_projects where kind = 'internal' order by created_at limit 1");
db(`update proj_project_details set scope = 'INTERNAL-ONLY scope: rack inventory and wiring plan' where project_id = '${INTERNAL}' and coalesce(btrim(scope), '') = ''`);
// Text that exists only inside the internal project's member-only tables (scope, and any milestone, task or booking titles).
const PRIVATE_OF_INTERNAL = db(`select coalesce(scope, '') from proj_project_details where project_id = '${INTERNAL}' union all select title from proj_milestones where project_id = '${INTERNAL}' union all select title from proj_tasks where project_id = '${INTERNAL}'`).split("\n").map((x) => x.trim()).filter((x) => x.length >= 6);
if (PRIVATE_OF_INTERNAL.length === 0) throw new Error("the internal project has no private text to check against");
for (const who of ["mgr@e2e.local", "lead@e2e.local"]) {
  await as(who);
  await step(`${who}: sees the company's ongoing projects in the list and, on one they are not on, the summary only with the right company name`, async () => {
    await go("/projects"); await expectText(/Showroom technology refresh/); await expectText(/Floor projection for the Orbit launch/);
    await go(`/projects/${INTERNAL}`); await expectText(/summary only/i); await expectText(/Enginious Local AE/); await expectNoText(/Unknown/);
    if ((await page.locator("main nav[aria-label='Project sections']").count()) > 0) throw new Error("tabs shown to a summary-only viewer");
    for (const sub of ["work", "people", "discussion", "documents", "plan", "timeline", "history", "changes", "calendar"]) {
      await page.goto(`${BASE}/projects/${INTERNAL}/${sub}`, { waitUntil: "networkidle" });
      const body = await page.locator("main").innerText();
      for (const secret of PRIVATE_OF_INTERNAL) if (body.includes(secret)) throw new Error(`/${sub} leaks "${secret}" to someone who is not on the project`);
    }
  });
}


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
  await lp.goto(`${BASE}/projects/work?tasks=all`, { waitUntil: "networkidle" });
  const t = (await lp.locator("main").innerText()).replace(/\s+/g, " ");
  if (!/mention/i.test(t)) throw new Error("no mention notice: " + t.slice(0, 300));
  if (/Truss arrives/.test(t)) throw new Error("message text in a notification");
});
await lp.context().close();
await as("emp@e2e.local");
await step("Discussion: a linked Sales person who is not a member cannot read it", async () => {
  await go(`/projects/${P}/discussion`); if (/Truss arrives/.test(await mainText())) throw new Error("discussion visible to Sales");
});
await as("hr@e2e.local");
await step("Discussion history: the page opens on the latest 100; Show earlier messages reaches the very first message, without losing the live ones", async () => {
  db(`insert into proj_messages (project_id, author_id, body, created_at) select '${P}', '${U(4)}', 'History note ' || g, now() - interval '30 days' + (g || ' minutes')::interval from generate_series(1, 130) g`);
  await go(`/projects/${P}/discussion`);
  let t = await mainText();
  if (!/History note 130\b/.test(t)) throw new Error("the latest message is missing");
  if (/Truss arrives Thursday/.test(t)) throw new Error("the oldest message should not be loaded up front");
  const more = page.getByRole("button", { name: /show earlier messages/i });
  if ((await more.count()) !== 1) throw new Error("no Show earlier messages button");
  for (let i = 0; i < 6 && (await more.count()) > 0; i++) { await more.click(); await page.waitForTimeout(900); }
  if ((await more.count()) !== 0) throw new Error("the button never went away");
  t = await mainText();
  if (!/Truss arrives Thursday/.test(t)) throw new Error("the first message was not reached");
  if (!/History note 1\b/.test(t) || !/History note 130\b/.test(t)) throw new Error("history is incomplete");
  const n = await page.locator("[id^='msg-']").count();
  const total = Number(db(`select count(*) from proj_messages where project_id = '${P}'`));
  if (n !== total) throw new Error(`${n} messages shown, ${total} stored`);
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
  await go(`/projects/${P}/work?tasks=all`);
  if ((await page.getByRole("button", { name: /new task/i }).count()) > 0) throw new Error("New task offered on a completed project");
});
await as("mgr@e2e.local");
await step("Reopen: a PM without the right cannot (no menu item); a founder can, with a reason; the earlier completion is kept", async () => {
  await go(`/projects/${P}`);
  const items = await menuItems("Manage project");
  if (items.some((i) => /Reopen/.test(i))) throw new Error("reopen offered to a PM without the right: " + items.join(" | "));
  await as("ceo@e2e.local"); await go(`/projects/${P}`);
  await pick("Manage project", /Reopen project/);
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
await as("ceo@e2e.local");
await step("Completed projects are listed under Show: Completed and archived (no Board), and drop out of Ongoing", async () => {
  await go("/projects"); const t = await mainText(); if (/Showroom technology refresh/.test(t)) throw new Error("a completed project is still in Ongoing");
  await go("/projects?show=finished"); await expectText(/Showroom technology refresh/); await expectText(/Completed/);
  if (await page.getByRole("navigation", { name: "View" }).count()) throw new Error("Table/Board switch offered for completed projects");
  await go(`/projects/${INT}/work?tasks=all`); if ((await page.getByRole("button", { name: /^Add task$/ }).count()) > 0) throw new Error("Add task offered on a completed project");
});
console.log(`\nverdict: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${passes} passed)`);
await browser.close(); process.exit(fails === 0 ? 0 : 1);
