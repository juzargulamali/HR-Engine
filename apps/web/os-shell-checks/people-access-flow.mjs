// Real-browser check of People & Access (LOCAL STACK ONLY; see README.md). Seed first with `seed/budget.sh` (the sample scenario plus Budget access), then run against the
// production build. It writes to the local database only.
//   admin@  System Administrator (also an authorised CEO / CTO budget approver; holds NO access-management right in any module)
//   ceo@    Sales and Projects founder (UAE), read-only budget grant      hr1@  HR Admin, budget Finance and the only budget access manager
//   hr@     HR Admin with no module access                                  mgr@ / emp@ / lead@ / none@  nothing to manage
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/people-access-shots";
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0; let url = "";
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const CO = "00000000-0000-4000-8000-00000000a001";
const as = async (email, viewport, theme) => { if (page) await page.context().close(); page = await newPage(browser, viewport, theme); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) {
    fails++;
    console.log("FAIL", name, "::", String(e.message).split("\n")[0], "| main:", (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`, fullPage: true }).catch(() => {});
  }
};
const main = () => page.locator("main");
const mainText = async () => (await main().innerText()).replace(/\s+/g, " ");
const go = async (path) => { url = `${BASE}${path}`; await page.goto(url, { waitUntil: "networkidle" }); await page.waitForTimeout(800); };
const expectText = async (re) => { const t = await mainText(); if (!re.test(t)) throw new Error(`expected ${re} on the page, got: ${t.slice(0, 300)}`); };
const expectNoText = async (re) => { const t = await mainText(); if (re.test(t)) throw new Error(`did not expect ${re} on the page`); };
const seen = (re, ms = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const db = (q) => sql(q);
const untilDb = async (q, expected, ms = 15000) => { const t = Date.now(); for (;;) { const v = db(q); if (v === expected) return; if (Date.now() - t > ms) throw new Error(`database check ${q} = ${v}, expected ${expected}`); await new Promise((r) => setTimeout(r, 300)); } };
const navLinks = async () => page.locator("nav a, aside a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
const tabs = async () => page.locator('nav[aria-label="About this person"] a').allInnerTexts();
const personUrl = (n, tab) => `/people-access?person=u:${U(n)}${tab ? `&tab=${tab}` : ""}`;
const card = (name) => main().locator('section[aria-labelledby^="pa-"]', { has: page.getByRole("heading", { name, exact: true, level: 3 }) });
const noOverflow = async () => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`horizontal overflow of ${o}px`); };
const capsSql = (table, n) => `select coalesce(array_to_string(array(select unnest(capabilities) order by 1), ','), '') from ${table} where user_id='${U(n)}' and company_id='${CO}' and revoked_at is null`;
const choosePreset = async (c, label) => {
  const select = c.locator("select").first();
  const options = await select.locator("option").allInnerTexts();
  const o = options.find((x) => x.startsWith(label));
  if (!o) throw new Error(`no preset ${label} among: ${options.join(" | ")}`);
  await select.selectOption({ label: o });
  await c.getByRole("button", { name: "Add preset" }).click();
};

// ---- the System Administrator: accounts and HR roles, nothing in the modules ------------------------------------------------------
await as("admin", { width: 1280, height: 900 }, "dark");
await step("admin: People & Access is in the menu, Users & Roles is gone", async () => {
  await go("/people-access");
  const links = await navLinks();
  if (!links.includes("/people-access")) throw new Error(`links: ${links.join(", ")}`);
  for (const old of ["/admin/users", "/sales/access", "/projects/access", "/inventory/access"]) if (links.includes(old)) throw new Error(`still offers ${old}`);
  await expectText(/People & Access/);
});
await step("admin: sees accounts with addresses, and can search", async () => {
  await expectText(/hr1@e2e\.local/);
  await page.getByRole("searchbox").fill("pol.worker");
  await main().getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForURL(/q=pol\.worker/);
  await expectText(/pol\.worker@e2e\.local/);
  await expectNoText(/hr1@e2e\.local/);
});
await step("admin: Account, Job & department and HR roles tabs, and no Module access tab (no module power by title)", async () => {
  await go(personUrl(1));
  const t = await tabs();
  if (JSON.stringify(t) !== JSON.stringify(["Account", "Job & department", "HR roles"])) throw new Error(`tabs: ${t.join(" | ")}`);
  await expectText(/Account/);
});
await step("admin: HR roles tab lists roles with revoke, a role form, and says HR roles give no module access", async () => {
  await go(personUrl(1, "roles"));
  await expectText(/HR Admin/);
  await expectText(/give no access to Sales, Projects, Inventory or project budgets/i);
  if ((await page.getByRole("button", { name: "revoke" }).count()) < 1) throw new Error("no revoke button");
  await page.getByRole("button", { name: "Grant role" }).waitFor();
});
await step("admin: the job is shown read-only (only an HR Admin of the company may edit it)", async () => {
  await go(personUrl(5, "job"));
  await expectText(/Only an HR Admin of .* can change these details/);
  if ((await page.getByRole("button", { name: "Save job details" }).count()) !== 0) throw new Error("a save button is offered to a System Administrator");
});
await step("admin: can invite a person (the panel is there) and has no module tab for anyone", async () => {
  await go("/people-access");
  await page.getByText("Invite a person").waitFor();
  await go(personUrl(4, "modules"));
  const t = await tabs();
  if (t.includes("Module access")) throw new Error(`tabs: ${t.join(" | ")}`);
});
await step("old addresses redirect to People & Access (/admin/users)", async () => {
  await go("/admin/users");
  if (!new URL(page.url()).pathname.startsWith("/people-access")) throw new Error(page.url());
  await expectText(/People & Access/);
});

// ---- a Sales and Projects founder: module access only, the old rules ----------------------------------------------------------------
await as("ceo", { width: 1280, height: 900 }, "dark");
await step("founder: People & Access appears; the old Access links do not; the old addresses redirect", async () => {
  await go("/people-access");
  const links = await navLinks();
  if (!links.includes("/people-access")) throw new Error("no People & Access link");
  for (const old of ["/sales/access", "/projects/access"]) if (links.includes(old)) throw new Error(`still offers ${old}`);
  for (const old of ["/sales/access", "/projects/access", "/inventory/access"]) {
    await go(old);
    if (!new URL(page.url()).pathname.startsWith("/people-access")) throw new Error(`${old} -> ${page.url()}`);
  }
});
await step("founder: sees names and addresses of staff (as the old screens did), but no HR roles or accounts", async () => {
  await go("/people-access");
  await expectText(/mgr@e2e\.local/);
  await go(personUrl(4));
  const t = await tabs();
  if (JSON.stringify(t) !== JSON.stringify(["Module access"])) throw new Error(`tabs: ${t.join(" | ")}`);
  await expectNoText(/Invite a person/);
});
await step("founder: Sales and Projects cards only (no Inventory, no Budget: nothing to manage there)", async () => {
  await go(personUrl(4, "modules"));
  await card("Sales & CRM").waitFor(); await card("Projects & Tasks").waitFor();
  for (const other of ["Inventory", "Project budgets"]) if ((await card(other).count()) !== 0) throw new Error(`${other} card is shown`);
});
await step("founder: a preset is added on top of existing rights, the change is shown first, and nothing else changes", async () => {
  await go(personUrl(4, "modules"));
  const c = card("Sales & CRM");
  await choosePreset(c, "Sales lead");
  await c.getByText(/what this change does/i).waitFor();
  const text = (await c.innerText()).replace(/\s+/g, " ");
  if (!/Adds Assign owners Reopen closed opportunities/.test(text)) throw new Error(`review: ${text.slice(0, 400)}`);
  if (/Removes/.test(text)) throw new Error("claims to remove something");
  await c.getByRole("button", { name: "Save changes" }).click();
  await untilDb(`select array_to_string(array(select unnest(capabilities) order by 1), ',') from crm_company_grants where user_id='${U(4)}' and revoked_at is null`, "assign_owner,reopen_closed");
  await page.waitForTimeout(800);
  await go(personUrl(4, "modules"));
  await choosePreset(card("Sales & CRM"), "Availability confirmer");
  await card("Sales & CRM").getByRole("button", { name: "Save changes" }).click();
  await untilDb(`select array_to_string(array(select unnest(capabilities) order by 1), ',') from crm_company_grants where user_id='${U(4)}' and revoked_at is null`, "assign_owner,confirm_availability,reopen_closed");
});
await step("founder: a stale form is stopped instead of dropping a right given in the meantime", async () => {
  await go(personUrl(4, "modules"));
  const c = card("Sales & CRM");
  db(`update crm_company_grants set capabilities='{assign_owner,confirm_availability,reopen_closed,view_audit}' where user_id='${U(4)}' and revoked_at is null`);
  await choosePreset(c, "Sales administrator");
  await c.getByRole("button", { name: "Save changes" }).click();
  await seen(/changed by someone else since you opened this page/);
  if (!/view_audit/.test(db(`select capabilities from crm_company_grants where user_id='${U(4)}' and revoked_at is null`))) throw new Error("the right given meanwhile was lost");
});
await step("founder: the database's own refusal is shown in words (a live project's manager cannot be withdrawn)", async () => {
  await go(personUrl(4, "modules"));
  const c = card("Projects & Tasks");
  await c.getByRole("button", { name: /Remove access/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove access", exact: true }).click();
  await page.getByRole("dialog").getByRole("alert").waitFor();
  const msg = await page.getByRole("dialog").getByRole("alert").innerText();
  if (!/Project Manager|department head|live project/i.test(msg)) throw new Error(`message: ${msg}`);
  if (db(`select count(*) from proj_company_grants where user_id='${U(4)}' and revoked_at is null`) !== "1") throw new Error("the grant is gone");
  await page.keyboard.press("Escape");
});
await step("founder: removing someone's access asks first and then removes it", async () => {
  await go(personUrl(5, "modules"));
  const c = card("Sales & CRM");
  await c.getByRole("button", { name: /Remove access/ }).click();
  await page.getByRole("dialog").getByText(/will lose access to Sales & CRM for .* straight away/).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Remove access", exact: true }).click();
  await untilDb(`select count(*) from crm_company_grants where user_id='${U(5)}' and revoked_at is null`, "0");
});
await step("founder: company settings (project reference code) are kept, editable by a founder", async () => {
  await go("/people-access?view=company");
  await expectText(/Projects · /);
  await expectText(/UAE-P-2026-0001/);
  await page.getByRole("button", { name: /Change code/ }).waitFor();
});
await step("founder: phone width has no sideways scroll", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await go(personUrl(4, "modules")); await noOverflow();
  await go("/people-access"); await noOverflow();
});

// ---- the budget access manager (also an HR Admin): budget cards, job editing, the last-manager protection --------------------------------
await as("hr1", { width: 1280, height: 900 }, "dark");
await step("budget manager: sees Job & department and Module access for a colleague, never Account or HR roles", async () => {
  await go(personUrl(5));
  const t = await tabs();
  if (JSON.stringify(t) !== JSON.stringify(["Job & department", "Module access"])) throw new Error(`tabs: ${t.join(" | ")}`);
});
await step("budget manager: a budget grant needs a right, shows what it gives, and is saved", async () => {
  await go(personUrl(5, "modules"));
  const c = card("Project budgets");
  const save = c.getByRole("button", { name: "Give access" });
  if (!(await save.isDisabled())) throw new Error("the button is on with nothing chosen");
  await choosePreset(c, "Read only");
  await c.getByText(/What will be given/).waitFor();
  await save.click();
  await untilDb(capsSql("pbx_company_grants", 5), "view");
});
await step("budget manager: adds Finance on top of read only; read only is kept", async () => {
  await go(personUrl(5, "modules"));
  const c = card("Project budgets");
  await choosePreset(c, "Finance");
  await c.getByRole("button", { name: "Save changes" }).click();
  await untilDb(capsSql("pbx_company_grants", 5), "finance,view");
});
await step("budget manager: the last access manager's protection is explained and enforced", async () => {
  await go(personUrl(1, "modules"));
  const c = card("Project budgets");
  await c.getByText(/Choose rights one by one/).click();
  await c.getByRole("checkbox", { name: /Manage budget access/ }).uncheck();
  await c.getByText(/last person who manages this access/).waitFor();
  await c.getByRole("button", { name: "Save changes" }).click();
  await seen(/last person|cannot remove|Cannot remove/i);
  if (!/manage_access/.test(db(`select capabilities from pbx_company_grants where user_id='${U(1)}' and revoked_at is null`))) throw new Error("the last access manager lost the right");
});
await step("HR Admin: edits job title, department and reporting line of the employee record, and the audit trail records it", async () => {
  await go(personUrl(5, "job"));
  await page.getByLabel("Job title", { exact: true }).fill("Senior designer");
  await main().getByRole("button", { name: "Save job details" }).click();
  await untilDb(`select job_title from employees where user_id='${U(5)}'`, "Senior designer");
  if (db(`select count(*) from audit_log where table_name='employees' and record_id='00000000-0000-4000-8000-0000000000e5' and action='update'`) === "0") throw new Error("no audit row for the employee update");
});
await step("HR Admin: a reporting circle and a manager of themselves are refused in words", async () => {
  await go(personUrl(4, "job"));
  // Max reports to Cleo; making Cleo report to Max would be a circle: try it on Cleo's record
  await go(personUrl(3, "job"));
  const select = page.getByLabel("Reports to");
  const options = await select.locator("option").allInnerTexts();
  if (!options.some((o) => /Max Manager/.test(o))) throw new Error(`managers offered: ${options.join(" | ")}`);
  if (options.some((o) => /Cleo Chief/.test(o))) throw new Error("a person is offered as their own manager");
  await select.selectOption({ label: options.find((o) => /Max Manager/.test(o)) });
  await main().getByRole("button", { name: "Save job details" }).click();
  await seen(/reporting circle/);
});

// ---- an HR Admin with no module access ---------------------------------------------------------------------------------------------------------
await as("hr", { width: 1280, height: 900 }, "light");
await step("HR Admin: sees employees but no addresses, no accounts, no roles, no modules", async () => {
  await go("/people-access");
  await expectNoText(/@e2e\.local/);
  await go(personUrl(7));
  const t = await tabs();
  if (JSON.stringify(t) !== JSON.stringify(["Job & department"])) throw new Error(`tabs: ${t.join(" | ")}`);
  await go(personUrl(7, "roles"));
  await expectNoText(/Give a role|HR Admin\b.*revoke/);
  await go("/people-access?view=company");
  await expectText(/no company settings for you to see/);
});

// ---- everyone else ------------------------------------------------------------------------------------------------------------------------
for (const who of ["mgr", "emp", "lead"]) {
  await as(who, { width: 1280, height: 900 }, "dark");
  await step(`${who}: no menu entry, and the page explains there is nothing to manage`, async () => {
    await go("/people-access");
    if ((await navLinks()).includes("/people-access")) throw new Error("the menu offers it");
    await expectText(/You cannot manage people or access/);
    await expectNoText(/e2e\.local|Invite a person/);
  });
}

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
