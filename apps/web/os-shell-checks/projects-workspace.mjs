// The simplified Projects & Tasks workspace (directory table + board + summary panel, My Work, the project's Work / Plan / Discussion /
// Manage menu, task side panel, quick changes) in a real browser. LOCAL STACK ONLY (see README.md).
// Needs the shared sample scenario in the throwaway database (README: "Sample scenario"): the Projects seed plus one client project with a
// Programming team (lead@ heads it, hr@ is in it), four tasks (one overdue, one waiting for review), two milestones and a short
// discussion. The script adds what it needs on top (an internal project owned by hr1@, a project in the second company, a grant for
// admin@ that it later revokes) and writes to the database it drives, so reseed before every run.
// The end-to-end flow (handover, review rules, plans, site bookings, completion) is projects-flow.mjs; this file is about finding,
// filtering, moving and quickly changing work, and about who may see or change what.
import { execSync } from "node:child_process";
import { chromium, newPage, login, BASE, optionTexts, choose, psql as sql } from "./lib.mjs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const browser = await chromium.launch();
let fails = 0; let passes = 0; let page;
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `${SHOTS}/pwfail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`, fullPage: true }).catch(() => {});
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 12000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(150); } throw new Error(`timed out waiting for ${what}`); }
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const CO = "00000000-0000-4000-8000-00000000a001"; const PL = "00000000-0000-4000-8000-00000000a002";
const DB = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
// Run SQL as a signed-in person (through the same functions the app calls). Returns the last line printed.
const asDb = (n, stmt) => execSync(`psql -h 127.0.0.1 -U postgres -d ${DB} -v ON_ERROR_STOP=1 -Atq`, { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${U(n)}","role":"authenticated"}', true);\n${stmt};\ncommit;\n` }).toString().trim().split("\n").filter(Boolean).pop();
const taskId = (title) => sql(`select id from proj_tasks where title='${title}'`);
const taskStatus = (title) => sql(`select status from proj_tasks where title='${title}'`);

const T = { shader: "Shader prototype", sensor: "Sensor calibration", guide: "Write the operator guide", power: "Confirm power and network with the venue" };
const P = sql("select id from proj_projects where kind='client'");
for (const t of Object.values(T)) if (sql(`select count(*) from proj_tasks where title='${t}'`) !== "1") throw new Error(`the sample scenario is not loaded (missing task "${t}")`);
if (!P) throw new Error("the sample scenario is not loaded (no client project)");
const M1 = "Content approved by the client"; const M2 = "Installation complete";

// ---- extra data on top of the scenario (all through the real functions) ----------------------------------------------------------
const INT = asDb(3, `select proj_create_internal_project('${CO}', 'Showroom technology refresh', '${U(1)}'::uuid, true)`);
asDb(1, `select proj_save_milestone('${INT}'::uuid, null, '{"title":"Racks installed","due_date":"2026-11-30","is_required":true}'::jsonb)`);
asDb(1, `select proj_create_task('${INT}'::uuid, '{"title":"Cable audit","assignee_id":"${U(1)}","due_date":"2026-11-25"}'::jsonb)`);
sql(`insert into proj_company_settings (company_id, reference_code) values ('${PL}', 'PLP') on conflict do nothing`);
sql(`insert into proj_company_grants (user_id, company_id, capabilities) values ('${U(8)}', '${PL}', '{founder}'), ('${U(9)}', '${PL}', '{}') on conflict do nothing`);
const PLP = asDb(8, `select proj_create_internal_project('${PL}', 'Warsaw depot refit', '${U(9)}'::uuid, true)`);
asDb(9, `select proj_save_milestone('${PLP}'::uuid, null, '{"title":"Warsaw racks delivered","due_date":"2026-12-01","is_required":true}'::jsonb)`);
if (!INT || !PLP) throw new Error("could not create the extra projects");

// A fingerprint of everything HR owns: nothing the Projects screens do may change it.
const HR_TABLES = ["attendance_records", "attendance_sessions", "attendance_segments", "leave_requests", "leave_balances", "leave_ledger", "recovery_periods", "recovery_windows", "recovery_credit_requests", "comp_day_ledger", "comp_day_balances", "payroll_export_runs", "reimbursement_claims", "timesheets", "timesheet_entries", "approvals"];
const hrFingerprint = () => sql(`select ${HR_TABLES.map((t) => `(select count(*) from ${t}) || ':' || (select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') from ${t} x)`).join(" || ',' || ")}`) + "|" + sql("select coalesce(md5(string_agg(id::text || coalesce(manager_id::text,''), ',' order by id)), '') from employees");
const HR_BEFORE = hrFingerprint();

// Browser dialogs (the unsaved-changes question is a window.confirm): answer as the test says.
let policy = "accept"; const asked = [];
const watch = (p) => p.on("dialog", async (d) => { if (d.type() === "beforeunload") return d.accept(); asked.push(d.message()); return policy === "accept" ? d.accept() : d.dismiss(); });
const as = async (email, viewport) => { if (page) await page.context().close(); page = await newPage(browser, viewport); watch(page); await login(page, email); return page; };
const main = async (p = page) => (await p.locator("main").innerText()).replace(/\s+/g, " ");
const panel = (p = page) => p.locator("aside[role=dialog]");
const modal = (p = page) => p.locator("dialog[open]");
const go = async (path, p = page) => { await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); };
const urlParam = (k) => new URL(page.url()).searchParams.get(k);
const rowNames = async () => (await page.locator("main tbody tr").evaluateAll((trs) => trs.map((r) => r.querySelector("a")?.textContent?.trim() ?? ""))).filter(Boolean);
const heads = async () => (await page.locator("main thead th").allInnerTexts()).map((t) => t.trim());
const html = () => page.content();
const openFilters = async () => { const b = page.getByRole("button", { name: /^Filters/ }); if ((await b.getAttribute("aria-expanded")) !== "true") await b.click(); };
const row = (title) => page.locator("main tbody tr", { hasText: title }).first();
const board = () => page.locator("main [role=region][aria-label$='Scroll sideways for more columns.']");
const column = (label) => board().locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${label}`, "i") }) }).first();
const card = (title) => board().locator("section ul > li", { hasText: title }).first();
const moveTo = (title, label) => page.getByLabel(`Move ${title} to`).selectOption({ label });
const menuItems = async (button) => { await page.locator("main").getByRole("button", { name: button, exact: true }).first().click(); const m = page.locator("main").getByRole("menu").first(); await m.waitFor(); const t = (await m.locator("[role=menuitem]").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()); await page.keyboard.press("Escape"); return t; };

// ============================================================================================================================
// Directory (ceo@ is a founder: sees both projects and all of their milestones)
// ============================================================================================================================
await as("ceo@e2e.local", { width: 1280, height: 800 });
await step("Projects opens as a table: Project, Project Manager, Status, Key dates, Next milestone, with the ongoing projects", async () => {
  await go("/projects");
  const h = (await heads()).map((x) => x.toLowerCase());
  for (const want of ["project", "project manager", "status", "key dates", "next milestone"]) if (!h.some((x) => x.startsWith(want))) throw new Error(`missing column ${want}; have ${h.join(" | ")}`);
  const names = await rowNames(); if (names.length !== 2 || !names.includes("Floor projection delivery") || !names.includes("Showroom technology refresh")) throw new Error("rows: " + names.join(", "));
  const m = await main(); if (!/Ongoing \(2\)/.test(m)) throw new Error("Ongoing count missing: " + m.slice(0, 200));
  if (!new RegExp(M1).test(row("Floor projection").innerText ? await row("Floor projection").innerText() : "")) throw new Error("next milestone of the client project not shown");
  if (!/Racks installed/.test(await row("Showroom").innerText())) throw new Error("next milestone of the internal project not shown");
});
await step("search by name, reference and Project Manager; no match says so; Clear restores", async () => {
  const q = page.getByRole("searchbox");
  await q.fill("showroom"); await page.waitForURL((u) => u.searchParams.get("q") === "showroom"); await until(async () => (await rowNames()).join() === "Showroom technology refresh", "name match");
  await q.fill("UAE-P-2026-0001"); await until(async () => (await rowNames()).join() === "Floor projection delivery", "reference match");
  await q.fill("hr1"); await until(async () => (await rowNames()).join() === "Showroom technology refresh", "Project Manager match");
  await q.fill("zzzzzz"); await until(async () => /No project matches those filters/.test(await main()), "no-match text");
  await page.getByRole("link", { name: /^clear$/i }).first().click(); await until(async () => (await rowNames()).length === 2 && !urlParam("q"), "cleared");
});
await step("kind and status filters work; a kind or status the address invents is ignored; Show Completed lists none yet", async () => {
  await page.locator("#lt-kind").selectOption("internal"); await until(async () => (await rowNames()).join() === "Showroom technology refresh", "internal only");
  await page.locator("#lt-kind").selectOption("client"); await until(async () => (await rowNames()).join() === "Floor projection delivery", "client only");
  await page.locator("#lt-kind").selectOption(""); await page.waitForURL((u) => !u.searchParams.has("kind")); await until(async () => (await rowNames()).length === 2, "both kinds again");
  await page.locator("#lt-status").selectOption("planning"); await page.waitForURL((u) => u.searchParams.get("status") === "planning"); await until(async () => (await rowNames()).length === Number(sql("select count(*) from proj_projects where status='planning' and company_id='" + CO + "'")), "planning");
  await page.locator("#lt-status").selectOption("on_site"); await until(async () => /No project matches those filters/.test(await main()), "no project on site");
  await go("/projects?kind=weird&status=bogus&show=nonsense"); if ((await rowNames()).length !== 2) throw new Error("invented filters were not ignored");
  await go("/projects?status=completed"); if ((await rowNames()).length !== 2) throw new Error("a Completed status filter must not apply to Ongoing projects");
  await go("/projects"); await page.locator("#lt-show").selectOption("finished"); await until(async () => /No completed projects/.test(await main()), "completed view empty");
  if (await page.getByRole("navigation", { name: "View" }).count()) throw new Error("the Table/Board switch is offered for completed projects");
});
await step("header sorting toggles asc/desc with aria-sort; an invented sort key is ignored", async () => {
  await go("/projects?sort=name"); let n = await rowNames(); if (n.join() !== [...n].sort().join()) throw new Error("not ascending: " + n.join(" | "));
  if ((await page.locator("main thead th[aria-sort=ascending]").count()) !== 1) throw new Error("aria-sort not ascending");
  await page.locator("main thead").getByRole("link", { name: /^Project$/ }).click(); await page.waitForURL((u) => u.searchParams.get("sort") === "name:desc");
  await until(async () => { const x = await rowNames(); return x.join() === [...x].sort().reverse().join(); }, "descending");
  await go("/projects?sort=%27%3Bdrop%20table"); if ((await rowNames()).length !== 2) throw new Error("bogus sort broke the list");
  await go("/projects?sort=password:desc"); if ((await rowNames()).length !== 2) throw new Error("bogus sort key broke the list");
  await go("/projects?sort=milestone"); n = await rowNames(); if (n.length !== 2) throw new Error("sorting by next milestone lost a row");
});
await step("Table to Board keeps every project and the filters; there is no Completed lane; Board back to Table", async () => {
  await go("/projects?kind=client&q=floor"); const nTable = (await rowNames()).length;
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: /board/i }).click(); await page.waitForURL((u) => u.searchParams.get("view") === "board");
  await until(async () => (await board().locator("section ul > li").count()) === nTable, "cards");
  if (urlParam("kind") !== "client" || urlParam("q") !== "floor") throw new Error("filters lost on the switch");
  const lanes = (await board().locator("section h3").allInnerTexts()).map((t) => t.replace(/\d+\s*$/, "").trim());
  if (lanes.some((l) => /completed|archived/i.test(l))) throw new Error("a Completed lane exists: " + lanes.join(", "));
  for (const want of ["Planning", "In progress", "On hold"]) if (!lanes.includes(want)) throw new Error(`missing lane ${want}: ${lanes.join(", ")}`);
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: /table/i }).click(); await until(async () => (await rowNames()).length === nTable, "table again");
});
await step("Board: a status move opens the existing status form (the card stays until it is saved); Cancel and an unfinished form change nothing", async () => {
  await go("/projects?view=board");
  await moveTo("Floor projection delivery", "In progress");
  const d = modal(); await d.waitFor(); if (!/Change status/.test(await d.innerText())) throw new Error("not the status form");
  if (sql("select status from proj_projects where kind='client'") !== "planning") throw new Error("moved before the form was saved");
  if (!(await column("Planning").innerText()).includes("Floor projection")) throw new Error("card left its lane before saving");
  await d.getByRole("button", { name: /^cancel$/i }).click(); await until(async () => (await modal().count()) === 0, "dialog closed");
  if (sql("select status from proj_projects where kind='client'") !== "planning") throw new Error("Cancel changed the status");
  await moveTo("Floor projection delivery", "On hold"); const h = modal(); await h.waitFor();
  await h.getByRole("button", { name: /save status/i }).click(); await sleep(700);
  if (!(await h.isVisible()) || sql("select status from proj_projects where kind='client'") !== "planning") throw new Error("put on hold without a reason and a review date");
  await h.getByLabel(/why is it on hold/i).fill("Waiting for the venue contract"); await h.getByLabel("Review date").fill("2026-12-10");
  await h.getByRole("button", { name: /save status/i }).click(); await until(() => sql("select status from proj_projects where kind='client'") === "on_hold", "held");
  await until(async () => (await column("On hold").innerText()).includes("Floor projection"), "card in the On hold lane");
  if ((await column("Planning").innerText()).includes("Floor projection")) throw new Error("card also still in Planning");
});
await step("Board: Resume from On hold goes back to the stage it was held from; a refused move leaves the card and says why", async () => {
  await moveTo("Floor projection delivery", "Planning"); const d = modal(); await d.waitFor();
  // Another person moves it first: the form still offers "Resume", which the database now refuses.
  sql("update proj_projects set status='in_progress' where kind='client'");
  await d.getByRole("button", { name: /save status/i }).click();
  await until(async () => (await d.locator("[role=alert]").count()) > 0, "a refusal message", 12000);
  const msg = await d.locator("[role=alert]").first().innerText(); if (!msg.trim()) throw new Error("empty refusal");
  await d.getByRole("button", { name: /^cancel$/i }).click(); await until(async () => (await modal().count()) === 0, "closed");
  sql("update proj_projects set status='on_hold' where kind='client'");
  await go("/projects?view=board"); await moveTo("Floor projection delivery", "Planning"); const r = modal(); await r.waitFor();
  await r.getByRole("button", { name: /save status/i }).click(); await until(() => sql("select status from proj_projects where kind='client'") === "planning", "resumed to the stage it was held from");
});
await step("Board: only the accountable PM or a founder gets Move controls; an internal project of someone else's has none for the PM of another project", async () => {
  await go("/projects?view=board");
  if ((await page.getByLabel(/^Move Floor projection delivery to$/).count()) !== 1 || (await page.getByLabel(/^Move Showroom technology refresh to$/).count()) !== 1) throw new Error("a founder should be able to move both");
  await as("mgr@e2e.local"); await go("/projects?view=board");
  if ((await page.getByLabel(/^Move Floor projection delivery to$/).count()) !== 1) throw new Error("the PM cannot move their own project");
  if ((await page.getByLabel(/^Move Showroom technology refresh to$/).count()) !== 0) throw new Error("a PM can move someone else's project");
  if (!/Only the Project Manager or a founder can change the status/.test(await card("Showroom technology refresh").innerText())) throw new Error("no explanation on the locked card");
  await as("hr@e2e.local"); await go("/projects?view=board");
  if ((await page.getByLabel(/^Move .* to$/).count()) !== 0) throw new Error("a plain member is offered a status move");
});
await step("New internal project: offered only to people who may assign a PM (a plain member and Sales are not)", async () => {
  await go("/projects"); if ((await page.getByRole("button", { name: /new internal project/i }).count()) !== 0) throw new Error("hr@ is offered New internal project");
  await as("emp@e2e.local"); await go("/projects"); if ((await page.getByRole("button", { name: /new internal project/i }).count()) !== 0) throw new Error("Sales is offered New internal project");
  await as("ceo@e2e.local"); await go("/projects?add=1"); await modal().waitFor(); if (!/New internal project/.test(await modal().innerText())) throw new Error("?add=1 did not open the form");
  await modal().getByLabel(/Project name/).fill("Refusal check"); await modal().getByRole("button", { name: /^create project$/i }).click(); await sleep(700);
  if ((await modal().count()) === 0 || sql("select count(*) from proj_projects where name='Refusal check'") !== "0") throw new Error("created without an accountable owner");
});

// ============================================================================================================================
// Who sees which next milestone (member/founder only), and the summary panel
// ============================================================================================================================
const LEAKY = [M1, M2, "Racks installed", "Warsaw racks delivered", "Shader prototype", "Cable audit", "LED floor and sensors", "Truss arrives"];
const leaks = (body, allowed = []) => LEAKY.filter((s) => body.includes(s) && !allowed.includes(s));
await as("hr1@e2e.local");
await step("hr1@ (PM of the internal project only): Next milestone shown for their own project, 'Members only' for the client project, and no client milestone text anywhere in the page", async () => {
  await go("/projects"); const m = await main();
  if (!/next milestone/i.test(m)) throw new Error("column missing for a member");
  if (!/Racks installed/.test(await row("Showroom").innerText())) throw new Error("own milestone not shown");
  if (!/Members only/.test(await row("Floor projection").innerText())) throw new Error("no 'Members only' on the client project row");
  const bad = leaks(await html(), ["Racks installed", "Cable audit"]); if (bad.length) throw new Error("page HTML contains: " + bad.join(", "));
});
const dirOnly = [["mgr@e2e.local", "the PM of the client project", [M1, "Shader prototype"]], ["lead@e2e.local", "a department head", [M1, "Shader prototype"]]];
for (const [who, what, allowed] of dirOnly) {
  await as(who);
  await step(`${who} (${what}): Next milestone for the project they are on, nothing for the internal project, and no internal milestone in the page`, async () => {
    await go("/projects");
    if (!new RegExp(M1).test(await row("Floor projection").innerText())) throw new Error("own project milestone not shown");
    if (!/Members only/.test(await row("Showroom").innerText())) throw new Error("no 'Members only' on the project they are not on");
    const bad = leaks(await html(), allowed); if (bad.length) throw new Error("page HTML contains: " + bad.join(", "));
  });
}
sql(`insert into proj_company_grants (user_id, company_id, capabilities) values ('${U(6)}', '${CO}', '{}')`);
await as("admin@e2e.local");
await step("admin@ granted plain Projects access (a person on no project): summaries only, no Next milestone column, no milestone text; access revoked later cuts every path", async () => {
  await go("/projects"); const m = await main();
  if (/next milestone/i.test(m)) throw new Error("Next milestone column shown to someone on no project");
  if (!/Floor projection delivery/.test(m) || !/Showroom technology refresh/.test(m)) throw new Error("summaries missing");
  const bad = leaks(await html()); if (bad.length) throw new Error("page HTML contains: " + bad.join(", "));
  await go("/projects/work"); if (!/No open tasks|Nothing/.test(await main())) throw new Error("My Work not empty for a person on no project");
  if ((await page.locator("section[aria-label='My projects']").count()) !== 0) throw new Error("My projects shown to a person on no project");
});
await step("Summary panel: a project the person is not on opens a summary only (reference, company, type, status, PM, dates); direct address, Full page, Back all work; no private text", async () => {
  await go("/projects"); await page.locator("main tbody").getByRole("link", { name: "Floor projection delivery" }).click();
  await page.waitForURL((u) => u.searchParams.get("open") === P); await panel().waitFor();
  const t = await panel().innerText();
  for (const want of ["UAE-P-2026-0001", "Enginious Local AE", "Client project", "Project Manager", "mgr"]) if (!t.includes(want)) throw new Error(`summary lacks ${want}: ${t.slice(0, 300)}`);
  if (leaks(t).length || /LED floor|Expo Hall|PO-SECRET|BUDGET/.test(t)) throw new Error("private text in the summary panel: " + t.slice(0, 300));
  if (!/Sales handover/.test(t) === false) { /* a Sales handover block only for Sales-linked people */ }
  if ((await rowNames()).length !== 2) throw new Error("list changed behind the panel");
  await page.goBack(); await panel().waitFor({ state: "detached", timeout: 8000 });
  await go(`/projects?open=${P}`); await panel().waitFor();
  await panel().getByRole("link", { name: /full page/i }).click(); await page.waitForURL(new RegExp(`/projects/${P}$`)); await until(async () => /summary only/i.test(await main()), "summary-only page");
  if ((await page.locator("main nav[aria-label='Project sections']").count()) > 0) throw new Error("tabs shown to a summary-only viewer");
  await go("/projects?open=00000000-0000-4000-8000-0000000000ff"); if (/Floor projection|Showroom/.test(await panel().innerText().catch(() => ""))) throw new Error("a foreign id showed data");
  await go("/projects?open=not-an-id"); if ((await panel().count()) !== 0) throw new Error("a malformed open id should be ignored");
});
sql(`delete from proj_company_grants where user_id='${U(6)}'`);
await step("revoking admin@'s Projects grant takes the module and every project path away at once", async () => {
  await go("/projects"); await until(async () => /do not have Projects access/.test(await main()), "no-access page");
  for (const path of [`/projects/${P}`, `/projects/${P}/work?tasks=all`, `/projects/work?tasks=all`, `/projects?open=${P}`, `/projects/calendar`]) { await go(path); const b = await main(); if (!/access|not found|could not be found/i.test(b) || leaks(b).length || /Floor projection/.test(b)) throw new Error(`${path} still shows data after revocation: ${b.slice(0, 160)}`); }
  const nav = (await page.locator("aside nav[aria-label='Modules']").innerText()).replace(/\s+/g, " "); if (/Projects & Tasks/.test(nav)) throw new Error("module still in the menu");
});
await step("a member who opens a project goes straight to its workspace, not a panel; Sales linked sees summary + handover status in the panel", async () => {
  await as("hr@e2e.local"); await go("/projects"); await page.locator("main tbody").getByRole("link", { name: "Floor projection delivery" }).click(); await page.waitForURL(new RegExp(`/projects/${P}$`)); await until(async () => (await page.locator("main nav[aria-label='Project sections']").count()) === 1, "tabs");
  await as("emp@e2e.local"); await go(`/projects?open=${P}`); await panel().waitFor(); const t = await panel().innerText();
  if (!/Sales handover/.test(t) || !/Accepted/i.test(t)) throw new Error("handover status missing for the linked Sales person: " + t.slice(0, 300));
  if (leaks(t).length) throw new Error("private text for Sales: " + t.slice(0, 200));
});

// ============================================================================================================================
// My Work
// ============================================================================================================================
await as("hr@e2e.local", { width: 1280, height: 800 });
await step("My Work opens on the person's own open tasks as a table (Task, Project, Assignee, Due, Status) with blocked / review / overdue shown in words", async () => {
  await go("/projects/work"); const h = (await heads()).map((x) => x.toLowerCase());
  for (const want of ["task", "project", "assignee", "due", "status"]) if (!h.some((x) => x.startsWith(want))) throw new Error(`missing column ${want}: ${h.join(" | ")}`);
  const n = await rowNames(); if (n.sort().join() !== [T.shader, T.sensor, T.guide].sort().join()) throw new Error("rows: " + n.join(", "));
  if (!/Needs review/.test(await row(T.shader).innerText())) throw new Error("no 'Needs review' flag");
  if (!/overdue by \d+ days?/.test(await row(T.guide).innerText())) throw new Error("overdue not said in words");
  if (!/Floor projection delivery/.test(await row(T.sensor).innerText())) throw new Error("project column empty");
  const show = await optionTexts(page.locator("#lt-show")); if (show.some((o) => /My team/.test(o))) throw new Error("hr@ is offered My team: " + show.join(" | "));
  await go("/projects/work?show=team"); if ((await rowNames()).length !== 3) throw new Error("show=team widened the list for someone who leads nothing");
});
await step("My Work filters: Overdue, Waiting for review (hr@ reviews nothing), search, project filter, sorting; invented values are ignored", async () => {
  await page.locator("#lt-show").selectOption("overdue"); await until(async () => (await rowNames()).join() === T.guide, "overdue only");
  await page.locator("#lt-show").selectOption("review"); await until(async () => /Nothing is waiting for your review/.test(await main()), "review empty for a non-reviewer");
  await go("/projects/work"); const q = page.getByRole("searchbox"); await q.fill("sensor"); await until(async () => (await rowNames()).join() === T.sensor, "search");
  await q.fill("no-such-task"); await until(async () => /No task matches/.test(await main()), "no match"); await page.getByRole("link", { name: /^clear$/i }).first().click(); await until(async () => (await rowNames()).length === 3, "cleared");
  await go("/projects/work?sort=task"); let n = await rowNames(); if (n.join() !== [...n].sort().join()) throw new Error("not ascending: " + n.join(" | "));
  await go("/projects/work?sort=due"); n = await rowNames(); if (n[0] !== T.guide) throw new Error("due sort does not put the overdue task first: " + n.join(" | "));
  await go("/projects/work?show=zzz&sort=%27x&project=nope&view=weird&cols=bogus"); if ((await rowNames()).length !== 3) throw new Error("invented values broke the list");
});
await step("My Work Board shows the same tasks by status; Table/Board switch keeps the filters; Columns menu adds Priority and Milestone", async () => {
  await go("/projects/work?q=a"); const nTable = (await rowNames()).length;
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: /board/i }).click(); await page.waitForURL((u) => u.searchParams.get("view") === "board");
  await until(async () => (await board().locator("section ul > li").count()) === nTable, "same cards");
  if (!(await column("Ready for review").innerText()).includes(T.shader)) throw new Error("Shader prototype is not in Ready for review");
  if (!(await column("To do").innerText()).includes(T.sensor)) throw new Error("Sensor calibration is not in To do");
  if (urlParam("q") !== "a") throw new Error("search lost on the switch");
  await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: /table/i }).click(); await until(async () => (await rowNames()).length === nTable, "table again");
  await page.getByRole("button", { name: /columns/i }).click(); await page.getByLabel("Milestone", { exact: true }).check(); await page.waitForURL((u) => /milestone/.test(u.searchParams.get("cols") ?? ""));
  await until(async () => /Content approved by the client/.test(await row(T.sensor).innerText()), "milestone shown via its deliverable");
  await page.keyboard.press("Escape");
});
await step("My projects strip: each project with its next milestone and a direct Discussion link (member); handovers waiting strip only for people who can act on one", async () => {
  await go("/projects/work"); const s = page.locator("section[aria-label='My projects']"); const t = (await s.innerText()).replace(/\s+/g, " ");
  if (!t.includes("Floor projection delivery") || !t.includes(M1)) throw new Error("strip: " + t);
  if (/Showroom/.test(t)) throw new Error("a project hr@ is not on appears in My projects");
  await s.getByRole("link", { name: /discussion/i }).click(); await page.waitForURL(new RegExp(`/projects/${P}/discussion$`));
  await go("/projects/work"); if (/waiting on you/i.test(await main())) throw new Error("handover strip shown to a plain member");
});
await step("quick changes only where permitted: the task owner changes status and due date but is never offered Assignee; the head and the PM are", async () => {
  await go("/projects/work"); const r = row(T.sensor);
  if ((await r.getByLabel(/^Status of Sensor calibration/).count()) !== 1) throw new Error("owner has no status control");
  if ((await r.getByRole("button", { name: /Change due date of Sensor calibration/ }).count()) !== 1) throw new Error("owner has no due-date control");
  if ((await r.getByLabel(/^Assignee of/).count()) !== 0) throw new Error("the task owner can reassign");
  for (const who of ["lead@e2e.local", "mgr@e2e.local"]) { await as(who); await go(`/projects/${P}/work?tasks=all`); if ((await row(T.sensor).getByLabel(/^Assignee of Sensor calibration/).count()) !== 1) throw new Error(`${who} has no assignee control`); }
  await as("hr1@e2e.local"); await go(`/projects/${P}/work?tasks=all`); if (/Sensor calibration/.test(await main())) throw new Error("hr1@ (not a member) sees the project's tasks");
});
await as("lead@e2e.local");
await step("the head reassigns in place: options are the team only, the change is saved, logged in the task history and told to the new assignee", async () => {
  await go(`/projects/${P}/work?tasks=all`); const sel = row(T.sensor).getByLabel(/^Assignee of Sensor calibration/);
  const opts = await optionTexts(sel); if (opts.some((o) => /mgr|ceo|admin/.test(o))) throw new Error("head offered people outside the team: " + opts.join(" | "));
  await choose(sel, /^lead/); await until(() => sql(`select assignee_id from proj_tasks where title='${T.sensor}'`) === U(7), "reassigned");
  if (sql(`select count(*) from proj_task_events where task_id='${taskId(T.sensor)}' and kind='reassigned'`) !== "1") throw new Error("no history entry for the reassignment");
  if (sql(`select count(*) from notifications where user_id='${U(7)}' and type='project_task_assigned'`) === "0" && sql(`select count(*) from notifications where user_id='${U(7)}' and type like 'project%'`) === "0") throw new Error("no notice to the new assignee");
  await choose(row(T.sensor).getByLabel(/^Assignee of Sensor calibration/), /^hr/); await until(() => sql(`select assignee_id from proj_tasks where title='${T.sensor}'`) === U(2), "reassigned back");
});
await step("a plain status change saves in place; a change that needs a reason opens its form; a stale change is refused in words and the old value comes back", async () => {
  await go(`/projects/${P}/work?tasks=all`);
  await choose(row(T.sensor).getByLabel(/^Status of Sensor calibration/), /^Start/); await until(() => taskStatus(T.sensor) === "in_progress", "Start saved in place");
  const sel = row(T.guide).getByLabel(/^Status of Write the operator guide/); await choose(sel, /^Defer/); const d = modal(); await d.waitFor();
  if (taskStatus(T.guide) !== "todo") throw new Error("deferred before the form was saved"); await d.getByRole("button", { name: /^Defer$/ }).click(); await sleep(600);
  if (taskStatus(T.guide) !== "todo") throw new Error("deferred without a reason"); await page.keyboard.press("Escape"); await until(async () => (await modal().count()) === 0, "closed");
  // Someone else changes the task after this page loaded.
  sql(`update proj_tasks set version = version + 1 where title='${T.guide}'`);
  const sel2 = row(T.guide).getByLabel(/^Status of Write the operator guide/); await choose(sel2, /^Start/);
  await until(async () => /changed by someone else/i.test(await row(T.guide).innerText()), "the stale-change message", 12000);
  if (taskStatus(T.guide) !== "todo") throw new Error("stale change was applied");
  const shown = await row(T.guide).getByLabel(/^Status of Write the operator guide/).evaluate((e) => (e.options ? e.options[e.selectedIndex].text : e.innerText)); if (/Saving|In progress/.test(shown)) throw new Error("old value not restored, shows: " + shown);
});
await as("mgr@e2e.local");
await step("a due date changed in the table asks for a reason, keeps the old date until saved, and never moves another task's date", async () => {
  await go(`/projects/${P}/work?tasks=all`); const before = sql("select string_agg(title || due_date::text, ',' order by title) from proj_tasks where title <> 'Confirm power and network with the venue'");
  await row(T.power).getByRole("button", { name: /Change due date of Confirm power/ }).click(); const d = modal(); await d.waitFor();
  await d.getByLabel("Due date").fill("2026-11-09"); await d.getByRole("button", { name: /save due date/i }).click(); await sleep(600);
  if (sql(`select due_date::text from proj_tasks where title='${T.power}'`) !== "2026-11-02") throw new Error("saved without a reason");
  await d.getByLabel(/Why is the date changing/).fill("Venue moved the power drop"); await d.getByRole("button", { name: /save due date/i }).click(); await d.waitFor({ state: "detached", timeout: 12000 });
  await until(() => sql(`select due_date::text from proj_tasks where title='${T.power}'`) === "2026-11-09", "new date saved");
  if (sql("select string_agg(title || due_date::text, ',' order by title) from proj_tasks where title <> 'Confirm power and network with the venue'") !== before) throw new Error("another task's date changed");
  if (sql(`select count(*) from proj_task_events where task_id='${taskId(T.power)}' and kind='due_date_changed'`) !== "1") throw new Error("no history for the date change");
});

// ============================================================================================================================
// The task side panel
// ============================================================================================================================
await as("hr@e2e.local", { width: 1280, height: 800 });
await step("a task opens in a panel beside My Work with the list, filters and sort kept; Back closes it; the address works directly; Full page opens the task", async () => {
  await go("/projects/work?sort=task"); const names = await rowNames();
  await page.locator("main tbody").getByRole("link", { name: T.sensor }).click(); await page.waitForURL((u) => u.searchParams.get("task") === taskId(T.sensor)); await panel().waitFor();
  const p = await panel().innerText(); if (!p.includes(T.sensor) || !/Comments/.test(p) || !/History/.test(p)) throw new Error("panel content: " + p.slice(0, 200));
  if (urlParam("sort") !== "task") throw new Error("sort lost"); if ((await rowNames()).join() !== names.join()) throw new Error("the list behind the panel changed");
  await page.goBack(); await panel().waitFor({ state: "detached", timeout: 8000 }); if (urlParam("task")) throw new Error("task still in the address");
  await go(`/projects/work?task=${taskId(T.guide)}`); await panel().waitFor(); if (!(await panel().innerText()).includes(T.guide)) throw new Error("direct address did not open it");
  await panel().getByRole("link", { name: /full page/i }).click(); await page.waitForURL(new RegExp(`/projects/${P}/work/tasks/${taskId(T.guide)}$`)); await until(async () => (await main()).includes(T.guide), "task page");
  await page.goBack(); await panel().waitFor(); await page.keyboard.press("Escape"); await panel().waitFor({ state: "detached" });
});
await step("panel: status, due and More are the same controls as the table; a comment is added and shown; unsaved text asks before it is thrown away", async () => {
  await go(`/projects/work?task=${taskId(T.sensor)}`); await panel().waitFor();
  if ((await panel().getByLabel(/^Status of Sensor calibration/).count()) !== 1) throw new Error("no status control in the panel");
  const body = panel().getByLabel(/add a comment/i); await body.fill("Calibration sheet uploaded to the shared folder."); await panel().getByRole("button", { name: /add comment/i }).click();
  await until(async () => /Calibration sheet uploaded/.test(await panel().innerText()), "comment shown", 12000);
  if (sql(`select count(*) from proj_task_comments where body like 'Calibration sheet%'`) !== "1") throw new Error("comment not stored once");
  await body.fill("Unsent draft"); asked.length = 0; policy = "dismiss";
  await page.locator("main tbody").getByRole("link", { name: T.guide }).click(); await sleep(600);
  if (asked.length !== 1) throw new Error("no unsaved-changes question when opening another task"); if (urlParam("task") !== taskId(T.sensor)) throw new Error("switched although the person chose to stay");
  if ((await panel().getByLabel(/add a comment/i).inputValue()) !== "Unsent draft") throw new Error("draft lost after staying");
  policy = "accept"; await page.locator("main tbody").getByRole("link", { name: T.guide }).click(); await page.waitForURL((u) => u.searchParams.get("task") === taskId(T.guide)); await panel().waitFor();
  if (asked.length !== 2) throw new Error("agreeing to leave did not go through the question"); if (sql("select count(*) from proj_task_comments where body = 'Unsent draft'") !== "0") throw new Error("unsent text was saved");
});
await step("a stale edit is refused (two sessions), the second person keeps what they typed, and the first person's change is not overwritten", async () => {
  const id = taskId(T.sensor); const a = await newPage(browser); watch(a); await login(a, "lead@e2e.local"); const b = await newPage(browser); watch(b); await login(b, "lead@e2e.local");
  for (const p of [a, b]) { await go(`/projects/${P}/work/tasks/${id}`, p); await p.locator("main").getByRole("button", { name: "More", exact: true }).click(); await p.getByRole("menuitem", { name: /edit task/i }).click(); await modal(p).waitFor(); }
  await a.getByLabel("Title").fill("Sensor calibration (rev A)"); await a.getByRole("button", { name: /save task/i }).click(); await until(() => sql(`select title from proj_tasks where id='${id}'`) === "Sensor calibration (rev A)", "first save");
  await b.getByLabel("Title").fill("Sensor calibration (rev B)"); await b.getByRole("button", { name: /save task/i }).click();
  await until(async () => /changed by someone else/i.test(await modal(b).innerText()), "a stale-edit message", 12000);
  if (sql(`select title from proj_tasks where id='${id}'`) !== "Sensor calibration (rev A)") throw new Error("the first person's edit was overwritten");
  if ((await b.getByLabel("Title").inputValue()) !== "Sensor calibration (rev B)") throw new Error("typed value lost after the refusal");
  await a.context().close(); await b.context().close(); sql(`update proj_tasks set title='${T.sensor}' where id='${id}'`);
});
await step("a task the person may not read (not a member, another company, made-up id) shows a plain message and no data", async () => {
  const id = taskId(T.sensor);
  await as("hr1@e2e.local"); await go(`/projects/work?task=${id}`); let p = await panel().innerText().catch(() => ""); if (/Sensor calibration|Calibration sheet/.test(p) || /Sensor calibration|Calibration sheet/.test(await html())) throw new Error("hr1@ can read a task of a project they are not on");
  await as("pol.exec@e2e.local"); await go(`/projects/work?task=${id}`); p = await panel().innerText().catch(() => ""); if (/Sensor calibration/.test(p) || /Sensor calibration|Floor projection/.test(await html())) throw new Error("another company's founder can read the task");
  await go(`/projects/${P}/work/tasks/${id}`); if (/Sensor calibration/.test(await html())) throw new Error("another company's founder can open the task page");
  await as("hr@e2e.local"); await go("/projects/work?task=00000000-0000-4000-8000-0000000000ff"); if (!/does not exist, or you cannot see it/i.test(await panel().innerText())) throw new Error("unknown task id message");
  await go("/projects/work?task=not-an-id"); if ((await panel().count()) !== 0) throw new Error("a malformed task id should be ignored");
});

// ============================================================================================================================
// A project's Work, Plan, Discussion and Manage menu
// ============================================================================================================================
await as("mgr@e2e.local", { width: 1280, height: 800 });
await step("Work opens on 'This week': four cards counted from the tasks, the overdue task is listed, 'View all tasks (4)' opens every open task, the cards filter, and the old overview address lands here with its content", async () => {
  await go(`/projects/${P}/work`); const t = await main();
  for (const re of [/4 Open tasks/, /1 Need attention/, /1 In review/, /\d+ due this week/, /Upcoming milestones/, /This week/, /Needs action/, /Project details/, /Agreed scope/]) if (!re.test(t)) throw new Error(`missing ${re} on Work: ${t.slice(0, 300)}`);
  if (!(await rowNames()).includes(T.guide)) throw new Error("the overdue task is not in This week: " + (await rowNames()).join(" | "));
  const all = page.getByRole("link", { name: /^View all tasks \(4\)$/ }); if ((await all.count()) < 1) throw new Error("no 'View all tasks (4)' link");
  await all.first().click(); await until(async () => (await rowNames()).length === 4, "all four open tasks listed");
  await page.getByRole("link", { name: /Need attention/ }).click(); await until(async () => (await rowNames()).join() === T.guide, "Need attention card narrows to the overdue task");
  await page.getByRole("link", { name: /In review/ }).click(); await until(async () => (await rowNames()).join() === T.shader, "In review card narrows to the review task");
  await go(`/projects/${P}`); if (!new URL(page.url()).pathname.endsWith("/work")) throw new Error("overview address did not lead to Work: " + page.url());
  const tabs = await page.getByRole("navigation", { name: "Project sections" }).innerText(); for (const w of ["Work", "Timeline", "Discussion", "Equipment"]) if (!tabs.includes(w)) throw new Error("tab missing: " + w);
});
await step("Work composition: a main column and a narrower right rail (about 72/28), three summary cards level with the rail's first card, This week directly under them, milestones below the task list, a compact toolbar with Table/Board, search and Filters", async () => {
  await go(`/projects/${P}/work`);
  const box = (loc) => loc.first().boundingBox();
  const cards = page.getByRole("list", { name: "Where the work stands" }); if ((await cards.locator("> li").count()) !== 3) throw new Error("expected three summary cards");
  if (/Due this week/.test(await cards.innerText())) throw new Error("Due this week is still a summary card");
  const cb = await box(cards), rail = await box(page.getByRole("complementary", { name: "Project support" }).locator("section").first()), taskCard = await box(page.getByRole("region", { name: "Tasks" })), strip = await box(page.getByRole("region", { name: "Milestones" }));
  if (Math.abs(cb.y - rail.y) > 4) throw new Error(`rail first card (${rail.y}) is not level with the summary cards (${cb.y})`);
  const ratio = cb.width / (cb.width + rail.width); if (ratio < 0.68 || ratio > 0.76) throw new Error("main/rail split is " + ratio.toFixed(2));
  if (!(taskCard.y > cb.y + cb.height - 1 && taskCard.y - (cb.y + cb.height) < 40)) throw new Error("This week is not directly under the summary cards");
  if (!(strip.y > taskCard.y + taskCard.height - 1)) throw new Error("milestones are not below the task list");
  for (const name of [/^Table$/, /^Board$/, /^Filters/]) if ((await page.getByRole("region", { name: "Tasks" }).getByRole(name === undefined ? "button" : "link", { name }).count()) + (await page.getByRole("region", { name: "Tasks" }).getByRole("button", { name }).count()) < 1) throw new Error("toolbar lacks " + name);
  if ((await page.getByRole("searchbox", { name: "Search tasks" }).count()) !== 1) throw new Error("no search box");
  await openFilters(); for (const id of ["#ob-status", "#ob-assignee", "#ob-group"]) if ((await page.locator(id).count()) !== 1) throw new Error(`Filters panel lacks ${id}`);
});
await step("An empty project: a compact task card with Add task and View all tasks, one milestone as a single row, nothing invented", async () => {
  const E = asDb(3, `select proj_create_internal_project('${CO}', 'Empty labelling', '${U(4)}'::uuid, true)`);
  asDb(4, `select proj_save_milestone('${E}'::uuid, null, '{"title":"Labels approved","due_date":"2026-11-30","is_required":true}'::jsonb)`);
  await go(`/projects/${E}/work`); const t = await main();
  if (!/No tasks yet/.test(t)) throw new Error("no empty message: " + t.slice(0, 200));
  const tc = page.getByRole("region", { name: "Tasks" });
  for (const n of [/^Add task$/, /^View all tasks/]) if ((await tc.getByRole(/Add/.test(n.source) ? "button" : "link", { name: n }).count()) < 1) throw new Error("empty state lacks " + n);
  const h = (await tc.boundingBox()).height; if (h > 280) throw new Error(`empty task card is ${Math.round(h)}px tall`);
  const ms = page.getByRole("region", { name: "Milestones" }); if ((await ms.count()) !== 1 || (await ms.boundingBox()).height > 90) throw new Error("one milestone is not a compact row");
  if (sql(`select count(*) from proj_tasks where project_id='${E}'`) !== "0") throw new Error("a task appeared in the empty project");
});
await step("Work groups tasks by Department, Milestone (with an honest 'Unlinked'), Status or Assignee; an invented group is ignored; the board ignores grouping", async () => {
  await go(`/projects/${P}/work?group=milestone`); const groups = async () => (await page.locator("main details > summary").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  let g = await groups(); const ms = g.find((x) => x.startsWith(M1)); const un = g.find((x) => x.startsWith("Unlinked"));
  if (!ms || !un) throw new Error("groups: " + g.join(" | ")); if (!/3 tasks/.test(ms)) throw new Error("milestone group count: " + ms); if (!/1 task/.test(un) || !/Not linked to any milestone/.test(un)) throw new Error("Unlinked group: " + un);
  const unText = await page.locator("main details", { has: page.locator("summary", { hasText: "Unlinked" }) }).first().innerText(); if (!unText.includes(T.power) || unText.includes(T.shader)) throw new Error("Unlinked group holds the wrong tasks");
  await go(`/projects/${P}/work?group=team`); g = await groups(); if (!g.some((x) => x.startsWith("Programming")) || !g.some((x) => x.startsWith("No department"))) throw new Error("team groups: " + g.join(" | "));
  await go(`/projects/${P}/work?group=status`); g = await groups(); if (!g.some((x) => /^To do/.test(x)) || !g.some((x) => /^Ready for review/.test(x))) throw new Error("status groups: " + g.join(" | "));
  await go(`/projects/${P}/work?group=assignee`); g = await groups(); if (!g.some((x) => /^hr/.test(x)) || !g.some((x) => /^mgr/.test(x))) throw new Error("assignee groups: " + g.join(" | "));
  await go(`/projects/${P}/work?tasks=all&group=bogus`); if ((await page.locator("main tbody tr").count()) < 4) throw new Error("bogus group broke the list");
  await go(`/projects/${P}/work?group=milestone&view=board`); if (!(await board().count())) throw new Error("board missing"); if ((await board().locator("section ul > li").count()) < 4) throw new Error("board lost tasks");
  await go(`/projects/${P}/work?tasks=all`); await openFilters(); await page.locator("#ob-group").selectOption("status"); await page.waitForURL((u) => u.searchParams.get("group") === "status");
});
await step("Work: filters and the review queue — 'Waiting for your review' shows the sent-for-review task to the PM and the head, and opening it uses the panel with Accept", async () => {
  await go(`/projects/${P}/work?tasks=all`); const q = page.locator("main", { has: page.getByText(/Waiting for your review \(1\)/) }); if ((await q.count()) !== 1) throw new Error("PM has no review queue");
  await page.getByRole("link", { name: /^Review$/ }).first().click(); await page.waitForURL((u) => u.searchParams.get("task") === taskId(T.shader)); await panel().waitFor();
  const opts = await optionTexts(panel().getByLabel(/^Status of Shader prototype/)); if (!opts.some((o) => /Accept and complete/.test(o)) || !opts.some((o) => /Request changes/.test(o))) throw new Error("reviewer options: " + opts.join(" | "));
  await page.keyboard.press("Escape"); await panel().waitFor({ state: "detached" });
  await openFilters(); await page.locator("#ob-status").selectOption("done"); await until(async () => /No tasks match/.test(await main()), "no done tasks yet");
  if (!/Show: Done/.test(await page.getByRole("list", { name: "Filters in use" }).innerText())) throw new Error("an active filter is not shown as a chip");
  await go(`/projects/${P}/work?show=overdue`); await until(async () => (await rowNames()).join() === T.guide, "overdue narrowing");
  await go(`/projects/${P}/work?show=mine`); await until(async () => (await rowNames()).join() === T.power, "my tasks narrowing (the PM's own task)");
  await as("hr@e2e.local"); await go(`/projects/${P}/work?tasks=all`); if (/Waiting for your review/.test(await main())) throw new Error("review queue shown to the task's own assignee");
});
await step("Work: Add task limits — a member can only add for themself; ?add=1 opens it; a refusal keeps what was typed", async () => {
  await go(`/projects/${P}/work?add=1`); const d = modal(); await d.waitFor();
  const o = await optionTexts(d.getByLabel("Assignee", { exact: true })); if (o.length !== 1) throw new Error("member can assign to others: " + o.join(","));
  await d.getByLabel("What needs doing").fill("Backdrop timing test"); await d.getByLabel("Due", { exact: true }).fill("2026-11-10");
  await d.locator("summary", { hasText: "Add more details" }).click(); await d.getByLabel("Start date").fill("2026-11-12");
  await sleep(300); await d.getByRole("button", { name: /^Add task$/ }).click(); await sleep(900);
  if (sql("select count(*) from proj_tasks where title='Backdrop timing test'") !== "0") throw new Error("a task with a due date before its start date was created");
  if ((await d.getByLabel("What needs doing").inputValue()) !== "Backdrop timing test") throw new Error("typed title lost");
  await d.getByLabel("Start date").fill("2026-11-08"); await d.getByRole("button", { name: /^Add task$/ }).click(); await until(() => sql("select count(*) from proj_tasks where title='Backdrop timing test'") === "1", "created after fixing the dates");
});
await as("lead@e2e.local");
await step("Discussion: Jump to task opens the task beside the Work list; Files link; a message never creates, completes or copies work", async () => {
  await go(`/projects/${P}/discussion`);
  if ((await page.getByRole("button", { name: /create task|make.*task|convert/i }).count()) !== 0) throw new Error("the discussion offers to create a task");
  const sel = page.getByLabel("Jump to a task"); const opts = await optionTexts(sel); if (!opts.some((o) => o === T.sensor)) throw new Error("jump list: " + opts.join(" | "));
  await sel.selectOption({ label: T.sensor }); await page.waitForURL((u) => u.pathname.endsWith("/work") && u.searchParams.get("task") === taskId(T.sensor)); await panel().waitFor();
  await go(`/projects/${P}/discussion`); await page.getByRole("link", { name: /^Files$/ }).click(); await page.waitForURL(new RegExp(`/projects/${P}/documents$`));
  await go(`/projects/${P}/discussion`); const tasksBefore = sql("select count(*) || ':' || coalesce(string_agg(status || due_date::text, ',' order by id::text), '') from proj_tasks");
  await page.getByLabel("Message", { exact: true }).fill("TODO: please create a task for the backdrop, mark the guide done and move everything one week."); await page.getByRole("button", { name: /^send$/i }).click();
  await until(() => sql("select count(*) from proj_messages where body like 'TODO: please create%'") === "1", "message stored"); await sleep(800);
  if (sql("select count(*) || ':' || coalesce(string_agg(status || due_date::text, ',' order by id::text), '') from proj_tasks") !== tasksBefore) throw new Error("sending a message changed tasks");
});
await as("mgr@e2e.local");
await step("Work, Timeline, Discussion, Equipment are the four sections; the old overview address leads to Work; Manage project reaches People, Feedback & changes, Files & client plan, History and Complete for the PM", async () => {
  await go(`/projects/${P}`); const tabs = (await page.locator("main nav[aria-label='Project sections'] a").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").replace(/\d+\s*$/, "").trim());
  if (tabs.join("|") !== "Work|Timeline|Discussion|Equipment") throw new Error("tabs: " + tabs.join("|"));
  const items = await menuItems("Manage project"); for (const want of ["Edit details", "Change status", "People & access", "Feedback & changes", "Files & client plan", "History", "Complete project"]) if (!items.some((i) => i.startsWith(want))) throw new Error(`Manage lacks ${want}: ${items.join(" | ")}`);
  for (const [item, path] of [["People & access", "people"], ["Feedback & changes", "changes"], ["Files & client plan", "documents"], ["History", "history"], ["Complete project", "complete"]]) {
    await go(`/projects/${P}`); await page.locator("main").getByRole("button", { name: "Manage project", exact: true }).click(); await page.locator("main").getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
    await page.waitForURL(new RegExp(`/projects/${P}/${path}$`)); if (/Application error|could not be found/i.test(await main())) throw new Error(`${path} failed to open`);
  }
  await go(`/projects/${P}`); await page.locator("main").getByRole("button", { name: "Manage project", exact: true }).click(); await page.locator("main").getByRole("menuitem", { name: /^Edit details/ }).click();
  const d = modal(); await d.waitFor(); if (!(await d.getByLabel("Name").inputValue()).includes("Floor projection")) throw new Error("edit form not filled"); await page.keyboard.press("Escape");
});
await step("Edit details: a stale save (two sessions) is refused in words and nothing is overwritten", async () => {
  const a = await newPage(browser); watch(a); await login(a, "mgr@e2e.local"); const b = await newPage(browser); watch(b); await login(b, "mgr@e2e.local");
  for (const p of [a, b]) { await go(`/projects/${P}`, p); await p.locator("main").getByRole("button", { name: "Manage project", exact: true }).click(); await p.locator("main").getByRole("menuitem", { name: /^Edit details/ }).click(); await modal(p).waitFor(); }
  await a.getByLabel("Location").fill("Expo Hall 4"); await a.getByRole("button", { name: /save details/i }).click(); await until(() => sql(`select location from proj_project_details where project_id='${P}'`) === "Expo Hall 4", "first save");
  await b.getByLabel("Location").fill("Expo Hall 5"); await b.getByRole("button", { name: /save details/i }).click();
  await until(async () => /changed by someone else/i.test(await modal(b).innerText()), "a stale-edit message", 12000);
  if (sql(`select location from proj_project_details where project_id='${P}'`) !== "Expo Hall 4") throw new Error("overwritten"); if ((await b.getByLabel("Location").inputValue()) !== "Expo Hall 5") throw new Error("typed value lost");
  await a.context().close(); await b.context().close();
});

// ============================================================================================================================
// Companies and revoked membership
// ============================================================================================================================
await as("ceo@e2e.local");
await step("another company's project is invisible to this company's founder (list, search, direct address, calendar); and the reverse", async () => {
  await go("/projects"); let b = await main() + await html(); if (/Warsaw/.test(b)) throw new Error("the Polish project is listed for the UAE founder");
  await page.getByRole("searchbox").fill("warsaw"); await until(async () => /No project matches/.test(await main()), "no match for the other company"); 
  await go(`/projects/${PLP}`); b = await main() + await html(); if (/Warsaw depot refit|Warsaw racks/.test(b)) throw new Error("the Polish project opened for the UAE founder");
  await go(`/projects/${PLP}/work?tasks=all`); if (/Warsaw/.test(await html())) throw new Error("the Polish Work page opened");
  await go("/projects/calendar?scope=company&view=agenda&date=2026-11-30"); if (/Warsaw/.test(await html())) throw new Error("the company calendar shows another company's project");
  await as("pol.exec@e2e.local"); await go("/projects"); b = await main() + await html(); if (!/Warsaw depot refit/.test(b)) throw new Error("the Polish founder cannot see their own project");
  if (/Floor projection|Showroom technology|Sensor calibration|Content approved/.test(b)) throw new Error("the Polish founder sees UAE projects: " + b.slice(0, 200));
  await go(`/projects/${P}`); b = await html(); if (/Floor projection|Content approved|LED floor/.test(b)) throw new Error("the UAE project opened for the Polish founder");
  await go("/projects/work"); if (/Sensor calibration|Floor projection/.test(await html())) throw new Error("UAE tasks in the Polish founder's My Work");
});
await step("membership revoked: the person loses the workspace, their tasks, the panel, the discussion and the files at once; restored membership restores them", async () => {
  sql(`update proj_project_members set removed_at = now() where project_id='${P}' and user_id='${U(2)}'`);
  await as("hr@e2e.local");
  await go("/projects/work"); let b = await main(); if (/Sensor calibration|Shader prototype/.test(b)) throw new Error("tasks of a removed project still listed");
  if ((await page.locator("section[aria-label='My projects']").count()) !== 0) throw new Error("project still in My projects");
  await go(`/projects/${P}/work?tasks=all`); b = await main(); if (/Sensor calibration|Shader prototype/.test(b) || !/summary only/i.test(b)) throw new Error("workspace still open: " + b.slice(0, 150));
  await go(`/projects/work?task=${taskId(T.sensor)}`); if (/Sensor calibration/.test(await html())) throw new Error("task panel still opens");
  for (const sub of ["discussion", "documents", "plan", "history"]) { await go(`/projects/${P}/${sub}`); if (/Truss arrives|Sensor calibration|LED floor/.test(await html())) throw new Error(`/${sub} still readable`); }
  sql(`update proj_project_members set removed_at = null where project_id='${P}' and user_id='${U(2)}'`);
  await go("/projects/work"); if (!/Sensor calibration/.test(await main())) throw new Error("restoring membership did not restore the tasks");
});
await step("HR independence: attendance, leave, Recovery, ledger, payroll, reimbursement, timesheet rows and every manager line are exactly as before this run", async () => {
  if (hrFingerprint() !== HR_BEFORE) throw new Error("an HR table or a manager line changed while the Projects screens were used");
});

console.log("client console/page errors:", (page?.errors ?? []).filter((e) => !/Failed to load resource.*(40[34])/.test(e)).slice(0, 5));
await browser.close(); console.log(`\nverdict: ${fails === 0 ? "ALL PASS" : `${fails} FAIL`} (${passes} passed)`); process.exit(fails ? 1 : 0);
