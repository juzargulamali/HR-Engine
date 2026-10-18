// Counts what a person actually has to do for five everyday jobs, in a real browser, on the same sample scenario (LOCAL STACK ONLY).
// Start point of every job: signed in, on the My Day page. Counted: every click, and every field filled or chosen; "screens" are the full
// pages visited (the path changes; opening a side panel or a dialog is a click, not a screen). The job is only counted as done when the
// result is in the database. Run once per variant against the app that serves that UI:
//   VARIANT=before BASE_URL=http://127.0.0.1:3100 node os-shell-checks/workflow-steps.mjs
//   VARIANT=after  BASE_URL=http://127.0.0.1:3000 node os-shell-checks/workflow-steps.mjs
// Reseed with the scenario between runs (the jobs change data). Output: one JSON line per job, then a table.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";

const VARIANT = process.env.VARIANT === "before" ? "before" : "after";
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const browser = await chromium.launch();
const results = [];
const modulesNav = (page) => page.locator('nav[aria-label="Modules"]');

async function job(name, email, run) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const page = await newPage(browser);
  await login(page, email);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const c = { clicks: 0, fields: 0, screens: 0, path: new URL(page.url()).pathname, steps: [] };
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) { const p = new URL(f.url()).pathname; if (p !== c.path) { c.screens++; c.path = p; } } });
  const t = {
    click: async (loc, label) => { await loc.click(); c.clicks++; c.steps.push(`click: ${label}`); await page.waitForLoadState("networkidle").catch(() => {}); },
    fill: async (loc, value, label) => { await loc.fill(value); c.fields++; c.steps.push(`enter: ${label}`); },
    choose: async (loc, value, label) => { await loc.selectOption(value); c.fields++; c.steps.push(`choose: ${label}`); },
    page,
  };
  let ok = false; let error = null;
  try { ok = await run(t); } catch (e) { error = String(e.message).split("\n")[0]; }
  results.push({ variant: VARIANT, job: name, done: ok, interactions: c.clicks + c.fields, clicks: c.clicks, fields: c.fields, screens: c.screens, steps: c.steps, error });
  await page.context().close();
}

const optionValue = async (page, selectSel, text) => page.locator(`${selectSel} option`, { hasText: text }).first().getAttribute("value");
const stamp = Date.now().toString().slice(-5);

// 1. Add an enquiry -------------------------------------------------------------------------------------------------------------------
await job("1 Add an enquiry", "emp@e2e.local", async (t) => {
  const { page } = t;
  const title = `Lobby projection ${stamp}`;
  if (VARIANT === "before") {
    await t.click(modulesNav(page).getByRole("link", { name: "Sales & CRM", exact: true }), "Sales & CRM");
    await t.click(modulesNav(page).getByRole("link", { name: "New enquiry", exact: true }), "New enquiry");
    await t.fill(page.locator("#enq-title"), title, "requirement");
    await t.choose(page.locator("#enq-source"), "agency_call", "source");
    await t.choose(page.locator("select[name=agencyOrgId]"), await optionValue(page, "select[name=agencyOrgId]", "Zeta"), "agency");
    await t.fill(page.locator("#enq-next-title"), "Call to qualify the brief", "next action");
    await t.click(page.locator("form").getByRole("button", { name: /^(create|save|record)/i }).last(), "save");
  } else {
    await t.click(modulesNav(page).getByRole("link", { name: "Sales & CRM", exact: true }), "Sales & CRM");
    await t.click(page.getByRole("button", { name: /add enquiry/i }), "Add enquiry");
    const dlg = page.getByRole("dialog");
    await t.fill(dlg.getByLabel(/what is the enquiry/i), title, "requirement");
    await t.choose(dlg.locator("select[name=source]"), "agency_call", "source");
    await t.choose(dlg.locator("select[name=agencyOrgId]"), await optionValue(page, "dialog select[name=agencyOrgId]", "Zeta"), "agency");
    await t.fill(dlg.locator("input[name=nextTitle]"), "Call to qualify the brief", "next action");
    await t.click(dlg.getByRole("button", { name: /^(add|create|save)/i }).last(), "save");
  }
  await page.waitForTimeout(2500);
  return Number(sql(`select count(*) from crm_opportunities where title = '${title}' and exists (select 1 from crm_follow_ups f where f.opportunity_id = crm_opportunities.id and f.status = 'open')`)) === 1;
});

// 2. Complete a follow-up and set the next action -------------------------------------------------------------------------------------
await job("2 Complete a follow-up", "emp@e2e.local", async (t) => {
  const { page } = t;
  const opp = sql("select id from crm_opportunities where title like 'Hotel lobby%'");
  if (VARIANT === "before") {
    await t.click(modulesNav(page).getByRole("link", { name: "Sales & CRM", exact: true }), "Sales & CRM");
    await t.click(modulesNav(page).getByRole("link", { name: "Follow-ups", exact: true }), "Follow-ups");
    await t.click(page.getByRole("row", { name: /Hotel lobby/ }).getByRole("button", { name: /done/i }), "Done on the overdue follow-up");
  } else {
    await t.click(modulesNav(page).getByRole("link", { name: "Sales & CRM", exact: true }), "Sales & CRM");
    await t.click(page.getByRole("row", { name: /Hotel lobby/ }).getByRole("button", { name: /complete|done/i }), "Complete the overdue follow-up");
  }
  const dlg = page.getByRole("dialog");
  await t.fill(dlg.getByLabel(/what came of it|what happened/i), "Spoke to the facilities manager; he confirms the lobby dimensions on Monday.", "what happened");
  await t.fill(dlg.locator("input[name=nextTitle]"), "Send the measured drawing", "next action");
  const date = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await t.fill(dlg.locator("input[name=nextDate]"), date, "next date");
  await t.click(dlg.getByRole("button", { name: /^complete/i }).last(), "complete");
  await page.waitForTimeout(2500);
  return Number(sql(`select count(*) from crm_follow_ups where opportunity_id = '${opp}' and status = 'done'`)) === 1 && Number(sql(`select count(*) from crm_follow_ups where opportunity_id = '${opp}' and status = 'open'`)) === 1;
});

// 3. Find and update an assigned task --------------------------------------------------------------------------------------------------
await job("3 Update an assigned task", "hr@e2e.local", async (t) => {
  const { page } = t;
  if (VARIANT === "before") {
    await t.click(modulesNav(page).getByRole("link", { name: "Projects & Tasks", exact: true }), "Projects & Tasks");
    await t.click(modulesNav(page).getByRole("link", { name: "My Work", exact: true }), "My Work");
    await t.click(page.getByRole("link", { name: "Sensor calibration" }).first(), "open the task");
    await t.click(page.getByRole("button", { name: /^start/i }).first(), "Start");
    const dlg = page.getByRole("dialog");
    if (await dlg.count()) await t.click(dlg.getByRole("button", { name: /^(start|save|move|confirm)/i }).last(), "confirm");
  } else {
    await t.click(modulesNav(page).getByRole("link", { name: "Projects & Tasks", exact: true }), "Projects & Tasks");
    await t.choose(page.getByRole("row", { name: /Sensor calibration/ }).getByLabel(/status of/i), { label: "Start" }, "status");
  }
  await page.waitForTimeout(2500);
  return sql("select status from proj_tasks where title = 'Sensor calibration'") === "in_progress";
});

// 4. Open a project discussion ---------------------------------------------------------------------------------------------------------
await job("4 Open the project discussion", "hr@e2e.local", async (t) => {
  const { page } = t;
  if (VARIANT === "before") {
    await t.click(modulesNav(page).getByRole("link", { name: "Projects & Tasks", exact: true }), "Projects & Tasks");
    await t.click(page.getByRole("link", { name: /Floor projection/ }).first(), "the project");
    await t.click(page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /discussion/i }), "Discussion");
  } else {
    await t.click(modulesNav(page).getByRole("link", { name: "Projects & Tasks", exact: true }), "Projects & Tasks");
    await t.click(page.getByRole("region", { name: "My projects" }).getByRole("link", { name: /discussion/i }), "Discussion");
  }
  await page.waitForTimeout(1000);
  return /Truss arrives/.test(await page.locator("main").innerText());
});

// 5. Find the next project milestone ---------------------------------------------------------------------------------------------------
await job("5 Find the next milestone", "hr@e2e.local", async (t) => {
  const { page } = t;
  await t.click(modulesNav(page).getByRole("link", { name: "Projects & Tasks", exact: true }), "Projects & Tasks");
  if (VARIANT === "before") await t.click(page.getByRole("link", { name: /Floor projection/ }).first(), "the project");
  await page.waitForTimeout(800);
  return /Content approved by the client/.test(await page.locator("main").innerText());
});

await browser.close();
for (const r of results) console.log(JSON.stringify(r));
console.log("\n" + `variant: ${VARIANT}`);
console.log("job".padEnd(34) + "done  interactions  (clicks + fields)  screens");
for (const r of results) console.log(r.job.padEnd(34) + String(r.done).padEnd(6) + String(r.interactions).padEnd(14) + `(${r.clicks} + ${r.fields})`.padEnd(19) + r.screens + (r.error ? `   ERROR: ${r.error}` : ""));
