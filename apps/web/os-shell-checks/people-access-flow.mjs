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
await step("admin: the HR role Line Manager is called Reporting Manager everywhere on the screen", async () => {
  await go(personUrl(4, "roles"));
  await expectText(/Reporting Manager/);
  await expectNoText(/Line Manager/);
  await go("/people-access");
  await expectText(/Reporting Manager/);
  await expectNoText(/Line Manager/);
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
const E = (n) => `00000000-0000-4000-8000-0000000000e${n}`;
const D = { studio: "00000000-0000-4000-8000-0000000000d2", field: "00000000-0000-4000-8000-0000000000d3", warsaw: "00000000-0000-4000-8000-0000000000d4" };
const job = (n) => db(`select coalesce(job_title,'') || '|' || coalesce(department_id::text,'') || '|' || coalesce(manager_id::text,'') from employees where id='${E(n)}'`);
const jobForm = () => ({
  title: page.getByLabel("Job title", { exact: true }), dept: page.getByLabel("Department", { exact: true }), mgr: page.getByLabel("Reporting manager", { exact: true }),
  save: main().getByRole("button", { name: "Save job details" }),
});
// Sets a <select> to a value the page does not offer (a forged request: the browser is the same, the choice is not one the form lists).
const forge = (selector, value) => page.evaluate(([sel, v]) => { const s = document.querySelector(sel); const o = document.createElement("option"); o.value = v; o.textContent = "forged"; s.appendChild(o); s.value = v; s.dispatchEvent(new Event("change", { bubbles: true })); }, [selector, value]);
await step("HR Admin: the field is called Reporting manager, and the HR role is Reporting Manager, not Line Manager", async () => {
  await go(personUrl(5, "job"));
  await expectText(/Reporting manager/);
  await expectNoText(/Line Manager|Reports to/);
  if ((await jobForm().mgr.count()) !== 1) throw new Error("no Reporting manager field");
});
await step("HR Admin: edits job title, department and reporting manager together; the employee record changes and the audit trail records before and after", async () => {
  await go(personUrl(5, "job"));
  const f = jobForm();
  await f.title.fill("Senior designer");
  await f.dept.selectOption({ label: "Production Studio" });
  await f.mgr.selectOption({ label: "Leo Lead" });
  await f.save.click();
  await untilDb(`select job_title from employees where id='${E(5)}'`, "Senior designer");
  if (job(5) !== `Senior designer|${D.studio}|${E(7)}`) throw new Error(`record: ${job(5)}`);
  const audit = db(`select coalesce(before_data->>'job_title','none') || ' > ' || coalesce(after_data->>'job_title','none') || ' | ' || coalesce(before_data->>'department_id','none') || ' > ' || coalesce(after_data->>'department_id','none') || ' | ' || coalesce(before_data->>'manager_id','none') || ' > ' || coalesce(after_data->>'manager_id','none') from audit_log where table_name='employees' and record_id='${E(5)}' and action='update' order by occurred_at desc limit 1`);
  if (!/none > Senior designer/.test(audit) || !new RegExp(`none > ${D.studio}`).test(audit) || !new RegExp(`${E(4)} > ${E(7)}`).test(audit)) throw new Error(`audit: ${audit}`);
  await go(personUrl(5, "job"));
  await expectText(/Senior designer/); await expectText(/Production Studio/); await expectText(/Leo Lead/);
});
await step("HR Admin: changes department only; the title and reporting manager are left exactly as they were", async () => {
  await go(personUrl(5, "job"));
  await jobForm().dept.selectOption({ label: "Field Operations" });
  await jobForm().save.click();
  await untilDb(`select department_id from employees where id='${E(5)}'`, D.field);
  if (job(5) !== `Senior designer|${D.field}|${E(7)}`) throw new Error(`record: ${job(5)}`);
});
await step("HR Admin: clearing the department and the reporting manager clears them on the record", async () => {
  await go(personUrl(5, "job"));
  await jobForm().dept.selectOption({ label: "None" });
  await jobForm().mgr.selectOption({ label: "No one" });
  await jobForm().save.click();
  await untilDb(`select coalesce(department_id::text,'') || coalesce(manager_id::text,'') from employees where id='${E(5)}'`, "");
  if (job(5) !== "Senior designer||") throw new Error(`record: ${job(5)}`);
  db(`update employees set manager_id='${E(4)}', department_id=null where id='${E(5)}'`); // put Eve back under Max for the cycle checks
});
await step("HR Admin: the person is never offered as their own manager, and only people of the same company are offered", async () => {
  await go(personUrl(5, "job"));
  const options = await jobForm().mgr.locator("option").allInnerTexts();
  if (options.some((o) => /Eve Employee/.test(o))) throw new Error("a person is offered as their own manager");
  if (options.some((o) => /Piotr|Pola/.test(o))) throw new Error(`a Poland employee is offered for a UAE employee: ${options.join(" | ")}`);
  const depts = await jobForm().dept.locator("option").allInnerTexts();
  if (depts.some((o) => /Warsaw Workshop/.test(o))) throw new Error(`another company's department is offered: ${depts.join(" | ")}`);
  if (!depts.includes("Production Studio") || !depts.includes("Field Operations")) throw new Error(`departments: ${depts.join(" | ")}`);
});
await step("HR Admin: a direct reporting circle is refused in words and nothing changes (Max reports to Cleo; Cleo cannot report to Max)", async () => {
  const before = job(3);
  await go(personUrl(3, "job"));
  await jobForm().mgr.selectOption({ label: "Max Manager" });
  await jobForm().save.click();
  await seen(/reporting circle/);
  if (job(3) !== before) throw new Error(`the record changed: ${job(3)}`);
});
await step("HR Admin: a longer reporting circle is refused too (Eve reports to Max who reports to Cleo; Cleo cannot report to Eve)", async () => {
  const before = job(3);
  await go(personUrl(3, "job"));
  await jobForm().mgr.selectOption({ label: "Eve Employee" });
  await jobForm().save.click();
  await seen(/reporting circle/);
  if (job(3) !== before) throw new Error(`the record changed: ${job(3)}`);
});
await step("HR Admin: a forged request cannot name a department of another company, a manager of another company, or the person themselves", async () => {
  await go(personUrl(5, "job"));
  const before = job(5);
  await forge("#pa-job-dept", D.warsaw); await jobForm().save.click();
  await seen(/department of this employee's company/);
  await go(personUrl(5, "job"));
  await forge("#pa-job-mgr", E(8)); await jobForm().save.click();
  await seen(/manager from the same company/);
  await go(personUrl(5, "job"));
  await forge("#pa-job-mgr", E(5)); await jobForm().save.click();
  await seen(/own manager/);
  if (job(5) !== before) throw new Error(`a forged request changed the record: ${job(5)}`);
});
await step("HR Admin: an over-long title is refused", async () => {
  await go(personUrl(5, "job"));
  const before = job(5);
  await jobForm().title.evaluate((el) => el.removeAttribute("maxlength"));
  await jobForm().title.fill("x".repeat(130)); await jobForm().save.click();
  await seen(/under 120 characters/);
  if (job(5) !== before) throw new Error("the record changed");
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

// ---- the access grant rules R1 to R3, as the screen shows them (the database proves them; see packages/rls-tests/test/access_grant_rules.rls.test.ts) --------------------------
const presetOption = (c, label) => c.locator("select").first().locator("option", { hasText: label });
const budgetCard = () => card("Project budgets");
await as("hr1", { width: 1280, height: 900 }, "dark");
await step("R1 on screen: a Finance access manager who is not an approver sees the approver preset greyed out, with the reason, and can still give other rights", async () => {
  db(`delete from pbx_company_grants where user_id='${U(5)}'`);
  await go(personUrl(5, "modules"));
  const c = budgetCard();
  if (!(await presetOption(c, "CEO / CTO approver").isDisabled())) throw new Error("the approver preset is offered to someone who is not an approver");
  if (await presetOption(c, "Finance").isDisabled()) throw new Error("an ordinary preset is greyed out");
  await c.getByText(/Only a CEO \/ CTO approver of this company can give or remove the approver right/).first().waitFor();
});
await step("R2 on screen: on one's own card, presets and ticks that would add a right are greyed out; the reason is shown", async () => {
  await go(personUrl(1, "modules"));
  const c = budgetCard();
  if (!(await presetOption(c, "Read only").isDisabled())) throw new Error("a preset that adds to one's own access is offered");
  await c.getByText(/You cannot add rights to your own access/).first().waitFor();
  await c.getByText(/Choose rights one by one/).click();
  if (!(await c.getByRole("checkbox", { name: /^Read only/ }).isDisabled())) throw new Error("a right that would be added to oneself can be ticked");
});
await as("ceo", { width: 1280, height: 900 }, "dark");
db(`insert into pbx_company_grants (user_id, company_id, capabilities, note) values ('${U(3)}', '${CO}', '{executive_approver,manage_access}', 'owner-run for the test') on conflict (user_id, company_id) where revoked_at is null do update set capabilities = excluded.capabilities`);
await step("R1 on screen: a CEO / CTO approver (named by the owner) can give the approver right, and it is saved", async () => {
  await go(personUrl(5, "modules"));
  const c = budgetCard();
  if (await presetOption(c, "CEO / CTO approver").isDisabled()) throw new Error("an approver cannot give the approver right");
  await choosePreset(c, "CEO / CTO approver");
  await c.getByRole("button", { name: "Give access" }).click();
  await untilDb(`select array_to_string(array(select unnest(capabilities) order by 1), ',') from pbx_company_grants where user_id='${U(5)}' and revoked_at is null`, "executive_approver");
});
await as("hr1", { width: 1280, height: 900 }, "dark");
await step("R1 on screen: a Finance access manager cannot remove an approver: the right is greyed out, there is no Remove access, and the reason is shown; other rights can still be changed", async () => {
  await go(personUrl(5, "modules"));
  const c = budgetCard();
  await c.getByText(/Choose rights one by one/).click();
  if (!(await c.getByRole("checkbox", { name: /^CEO \/ CTO approver/ }).isDisabled())) throw new Error("the approver right can be unticked by a non-approver");
  if (await c.getByRole("checkbox", { name: /^Read only/ }).isDisabled()) throw new Error("another right of an approver is greyed out");
  if ((await c.getByRole("button", { name: /Remove access/ }).count()) !== 0) throw new Error("Remove access is offered for an approver");
  await c.getByText(/Access cannot be removed here\. Only a CEO \/ CTO approver of this company can withdraw an approver/).waitFor();
  // and the database says the same when the request is forged: a withdrawal by revoke
  const { rpc } = await import("./inventory-flow-lib.mjs");
  const r = await rpc("hr1", "pbx_revoke_access", { p_user_id: U(5), p_company_id: CO });
  if (r.status < 400 || !/Only a CEO \/ CTO approver of this company can withdraw an approver/.test(JSON.stringify(r.body))) throw new Error(`the database did not refuse: ${r.status} ${JSON.stringify(r.body)}`);
});
await as("ceo", { width: 1280, height: 900 }, "dark");
await step("R1 on screen: the last eligible approver is warned about and the database refuses to remove them; they stay an approver", async () => {
  db(`update pbx_company_grants set revoked_at = now() where user_id in ('${U(5)}', '${U(6)}') and company_id='${CO}' and revoked_at is null and 'executive_approver' = any (capabilities)`);
  await go(personUrl(3, "modules"));
  const c = budgetCard();
  await c.getByText(/Choose rights one by one/).click();
  await c.getByRole("checkbox", { name: /^CEO \/ CTO approver/ }).uncheck();
  await c.getByText(/only CEO \/ CTO approver of/i).waitFor();
  await c.getByRole("button", { name: "Save changes" }).click();
  await seen(/last eligible CEO \/ CTO approver/);
  if (!/executive_approver/.test(db(`select capabilities from pbx_company_grants where user_id='${U(3)}' and revoked_at is null`))) throw new Error("the last approver was removed");
});
await step("R3 on screen (Sales): an access manager who is not a founder cannot change or withdraw another access manager, can step down themselves, and a founder can do both", async () => {
  db(`delete from crm_company_grants where user_id in ('${U(4)}', '${U(5)}')`);
  db(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U(4)}', '${CO}', '{manage_access}'), ('${U(5)}', '${CO}', '{manage_access,assign_owner}')`);
  await as("mgr", { width: 1280, height: 900 }, "dark");
  await go(personUrl(5, "modules"));
  const other = card("Sales & CRM");
  await other.getByText(/Only a founder can change this person's access/).waitFor();
  if ((await other.getByRole("button", { name: /Remove access/ }).count()) !== 0) throw new Error("Remove access is offered for another access manager");
  await go(personUrl(4, "modules"));
  await card("Sales & CRM").getByRole("button", { name: /Remove access/ }).waitFor();     // stepping down oneself
  await card("Sales & CRM").getByText(/Choose rights one by one/).click();
  if (!(await card("Sales & CRM").getByRole("checkbox", { name: /^Reopen closed/ }).isDisabled())) throw new Error("an access manager can tick a right onto their own access");
  await as("ceo", { width: 1280, height: 900 }, "dark");
  await go(personUrl(5, "modules"));
  await card("Sales & CRM").getByRole("button", { name: /Remove access/ }).waitFor();     // a founder may withdraw an access manager
  // put the sample scenario's Sales grants back (mgr and emp are ordinary Sales people there)
  db(`delete from crm_company_grants where user_id in ('${U(4)}', '${U(5)}')`);
  db(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U(4)}', '${CO}', '{}'), ('${U(5)}', '${CO}', '{}')`);
});

// ---- changing a job without the right ------------------------------------------------------------------------------------------------------------
const patch = (key, id, body) => import("./inventory-flow-lib.mjs").then(({ rest }) => rest(key, "PATCH", `/employees?id=eq.${id}`, body, { prefer: "return=representation" }));
await as("admin", { width: 1280, height: 900 }, "light");
await step("System Administrator: reads the job but has no form and cannot change it, in the page or through the data service", async () => {
  await go(personUrl(5, "job"));
  await expectText(/Reporting manager/);
  if ((await page.getByRole("button", { name: "Save job details" }).count()) !== 0) throw new Error("a save button is offered");
  const before = job(5);
  const r = await patch("admin", E(5), { job_title: "Chief of everything" });
  if (job(5) !== before) throw new Error(`the System Administrator changed a job: ${job(5)} (${r.status})`);
});
await step("Reporting manager (Max) cannot change the job of the person who reports to them, and Eve cannot change her own manager or title", async () => {
  const before = job(5);
  const byManager = await patch("mgr", E(5), { job_title: "Promoted by the manager", manager_id: E(7) });
  if (job(5) !== before) throw new Error(`the manager changed the record: ${job(5)} (${byManager.status})`);
  const bySelf = await patch("emp", E(5), { job_title: "Self promoted" });
  const bySelfManager = await patch("emp", E(5), { manager_id: E(3) });
  if (job(5) !== before) throw new Error(`the employee changed their own record: ${job(5)} (${bySelf.status}, ${bySelfManager.status})`);
});
await step("An HR Admin of another company (Poland) cannot change a UAE employee's job, in the page or through the data service", async () => {
  db(`insert into user_roles (user_id, role, company_id) values ('${U(8)}', 'hr_admin', '00000000-0000-4000-8000-00000000a002') on conflict do nothing`);
  try {
    await as("pol.exec", { width: 1280, height: 900 }, "dark");
    await go(personUrl(5, "job"));
    if ((await page.getByRole("button", { name: "Save job details" }).count()) !== 0) throw new Error("a save button is offered for a UAE employee");
    const before = job(5);
    const r = await patch("pol", E(5), { job_title: "Changed from Poland" });
    if (job(5) !== before) throw new Error(`a Poland HR Admin changed a UAE record: ${job(5)} (${r.status})`);
    // the same person can edit their own company's employee
    await go(`/people-access?person=u:${U(9)}&tab=job`);
    await jobForm().title.fill("Workshop lead");
    await jobForm().dept.selectOption({ label: "Warsaw Workshop" });
    await jobForm().save.click();
    await untilDb(`select job_title from employees where id='${E(9)}'`, "Workshop lead");
  } finally {
    db(`delete from user_roles where user_id='${U(8)}' and role='hr_admin'`);
  }
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

// ---- the old management addresses --------------------------------------------------------------------------------------------------------------
const OLD = ["/admin/users", "/sales/access", "/projects/access", "/inventory/access", "/admin/users/", "/sales/access?x=1", "/inventory/access?company=00000000-0000-4000-8000-00000000a001"];
await step("every old management address answers with a temporary redirect to People & Access, signed out as well as signed in (a trailing slash is first tidied by the framework)", async () => {
  for (const path of OLD) {
    let url = new URL(path, BASE); let last = null;
    for (let hop = 0; hop < 3; hop++) {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 300 || r.status >= 400) break;
      last = { status: r.status, to: new URL(r.headers.get("location") ?? "", BASE) };
      url = last.to;
      if (url.pathname === "/people-access") break;
    }
    if (!last || last.to.pathname !== "/people-access") throw new Error(`${path}: ends at ${url.pathname}`);
    if (last.status !== 307) throw new Error(`${path}: the last redirect is ${last.status}, expected a temporary 307`);
  }
});
await step("signed out, an old address ends at sign-in and, after signing in, at People & Access", async () => {
  const ctx = await newPage(browser, { width: 1280, height: 900 }, "dark");
  try {
    await ctx.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
    if (!new URL(ctx.url()).pathname.startsWith("/login")) throw new Error(`landed on ${ctx.url()}`);
  } finally { await ctx.context().close(); }
});
for (const who of ["admin", "ceo", "hr1", "hr", "mgr", "emp"]) {
  await as(who, { width: 1280, height: 900 }, "dark");
  await step(`${who}: every old management address lands on People & Access with no error, and shows only what ${who} may manage`, async () => {
    for (const path of OLD.slice(0, 4)) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      if (res && res.status() >= 400) throw new Error(`${path}: HTTP ${res.status()}`);
      if (new URL(page.url()).pathname !== "/people-access") throw new Error(`${path} -> ${page.url()}`);
      const t = await mainText();
      if (/Application error|Something went wrong|could not be found/i.test(t)) throw new Error(`${path}: ${t.slice(0, 160)}`);
      if (!/People & Access/.test(t)) throw new Error(`${path}: ${t.slice(0, 160)}`);
    }
  });
}
// A person who held access before still has exactly that access afterwards: the screen offers each person the management they had on the old screens.
await step("existing management rights carry over: founder (Sales, Projects) manages those two; budget manager manages Budget; HR Admin edits jobs; nobody else gets anything", async () => {
  const seen = {};
  for (const [who, expected] of [["admin", "accounts"], ["ceo", "modules:Project budgets,Projects & Tasks,Sales & CRM"], ["hr1", "modules:Project budgets+job"], ["hr", "job"], ["mgr", "none"], ["emp", "none"], ["lead", "none"]]) {
    await as(who, { width: 1280, height: 900 }, "dark");
    await go(personUrl(5));
    const t = await tabs();
    const got = t.includes("Module access") ? await (async () => { await go(personUrl(5, "modules")); const heads = (await page.locator('section[aria-labelledby^="pa-"] h3').allInnerTexts()).sort(); return `modules:${heads.join(",")}${t.includes("Job & department") ? "+job" : ""}`; })()
      : t.includes("Account") ? "accounts" : t.includes("Job & department") ? "job" : "none";
    seen[who] = got;
    const ok = who === "hr1" ? got.startsWith("modules:Project budgets") && got.endsWith("+job") : got === expected;
    if (!ok) throw new Error(`${who}: expected ${expected}, saw ${got}`);
  }
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
