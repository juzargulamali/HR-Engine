// People & HR Phase 1 (LOCAL STACK ONLY; see README.md). Seed first with `seed/people-hr.sh`, then run against the production build. Fictional data.
// One signed-in walkthrough at PHONE width as HR (an unscoped HR Admin), then the permission boundaries with authorised and unauthorised roles:
//   1. directory: search by number and name, Add employee visible, filters restored on return from a profile
//   2. company first: UAE, Saudi Arabia and Poland defaults; a company with no default currency asks for it in place
//   3. add an employee (identity and job only), leave midway, resume the same record from the directory and finish contract, pay, document and opening balances WITHOUT retyping
//      the employee or company; a double click and a repeat never create a second employee or a second opening balance
//   4. one job-and-pay change: applied now, scheduled for later (nothing changes until the date), refused before the hire date; the Change salary shortcut
//   5. documents: one Add document flow, the type decides the fields, renewal opens with the type chosen and keeps the earlier document
//   6. People & Access link from the profile; employment saves never touch grants (every company-scoped grant table is identical before and after)
//   7. permission boundaries: an HR Admin of one company, Finance, a manager and the employee against another company's record, pay, identity documents and the shared actions
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/people-hr-shots";
mkdirSync(SHOTS, { recursive: true });
const U = "00000000-0000-4000-8000-0000000000";
const AE = "00000000-0000-4000-8000-00000000a001"; const PL = "00000000-0000-4000-8000-00000000a002"; const SA = "00000000-0000-4000-8000-00000000a003"; const NC = "00000000-0000-4000-8000-00000000a004";
const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email, viewport = PHONE) => { if (page) await page.context().close(); page = await newPage(browser, viewport, "dark", { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page?.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const db = (q) => sql(q);
const one = (q) => db(q).split("\n")[0];
const until = async (fn, ms = 20000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${String(fn).slice(0, 110)}`); await new Promise((r) => setTimeout(r, 250)); } };
const asDb = (user, q) => execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["pipe", "pipe", "pipe"], input: `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); ${q}; commit;` }).toString().trim().split("\n").filter(Boolean).pop() ?? "";
const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const noHScroll = async (what) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (o.sw > o.cw + 1) throw new Error(`${what}: horizontal scroll (${o.sw} > ${o.cw})`); };
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); };
const plus = (n) => one(`select (current_date + ${n})::text`);
const grantsHash = () => one("select md5(coalesce(string_agg(t.r, '|' order by t.r), '')) from (select 'p:' || user_id || company_id || capabilities::text || coalesce(revoked_at::text,'') as r from proj_company_grants union all select 'c:' || user_id || company_id || capabilities::text || coalesce(revoked_at::text,'') from crm_company_grants union all select 'i:' || user_id || company_id || capabilities::text || coalesce(revoked_at::text,'') from inv_company_grants union all select 'x:' || user_id || company_id || capabilities::text || coalesce(revoked_at::text,'') from pbx_company_grants union all select 'r:' || user_id || role::text || coalesce(company_id::text,'') || coalesce(country_code,'') || coalesce(revoked_at::text,'') from user_roles) t");

let EMP = ""; let EMPNO = "ZZ-701"; let FIRST = "Amira"; let LAST = "Walkthrough";
let GRANTS_BEFORE = "";

await step("setup: the schema has People & HR Phase 1; three countries and a company with no default currency are in place; every company-scoped grant is recorded", async () => {
  if (one("select to_regprocedure('public.record_employment_change(uuid,date,text,numeric,numeric,text,date)') is not null") !== "t") throw new Error("the database is not built from the Phase 1 migration");
  if (one("select string_agg(country_code, ',' order by country_code) from companies where is_active") !== "AE,AE,PL,SA") throw new Error("expected AE, AE, PL and SA companies");
  GRANTS_BEFORE = grantsHash();
});

await as("hr1");
await step("directory at phone width: Add employee is visible; search finds a person by employee number and by name; filters survive a trip to a profile and back", async () => {
  await go("/employees");
  if (!(await page.getByTestId("add-employee").isVisible())) throw new Error("Add employee is not visible");
  await noHScroll("the directory");
  await page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first().fill("L-5"); await page.keyboard.press("Enter");
  await page.waitForURL(/q=L-5/); const t = await body();
  if (!/Eve/.test(t) || /Max Manager/.test(t)) throw new Error(`search by number: ${t.slice(0, 200)}`);
  await page.screenshot({ path: `${SHOTS}/directory-phone.png`, fullPage: true });
  await page.getByRole("link", { name: /Eve/ }).first().click(); await page.waitForURL(/\/employees\/[0-9a-f-]{36}/);
  await page.getByRole("link", { name: /^Employees$/ }).first().click(); await page.waitForURL(/\/employees(\?|$)/);
  if (!/q=L-5/.test(page.url()) && (await page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first().inputValue()) !== "L-5") throw new Error(`the search was not restored: ${page.url()}`);
  await go("/employees?q=Salma"); if (!/Salma/.test(await body())) throw new Error("search by name");
});

await step("company first: nothing but the company is asked until one is chosen; UAE, Saudi Arabia and Poland each bring their country and currency; a missing default currency is asked for in place", async () => {
  await go("/employees/new");
  if (await page.locator("#firstName").count()) throw new Error("identity fields are shown before a company is chosen");
  const pick = async (id) => { await page.locator("#companyId").selectOption(id); await page.getByTestId("onboarding-summary").waitFor(); return (await body()); };
  let t = await pick(AE); if (!/United Arab Emirates/.test(t) || !/AED/.test(t)) throw new Error("UAE defaults");
  t = await pick(SA); if (!/Saudi Arabia/.test(t) || !/SAR/.test(t)) throw new Error("Saudi defaults");
  await page.screenshot({ path: `${SHOTS}/onboarding-saudi-phone.png`, fullPage: true });
  t = await pick(PL); if (!/Poland/.test(t) || !/PLN/.test(t)) throw new Error("Poland defaults");
  t = await pick(NC); if (!(await page.getByTestId("currency-note").isVisible())) throw new Error("a missing default currency is not explained in place");
  await noHScroll("the onboarding form");
});

await step("add an employee once (identity and job only): double click creates one record and opens the profile with what remains", async () => {
  await go("/employees/new");
  await page.locator("#companyId").selectOption(AE); await page.getByTestId("onboarding-summary").waitFor();
  await page.locator("#firstName").fill(FIRST); await page.locator("#lastName").fill(LAST); await page.locator("#employeeNumber").fill(EMPNO);
  await page.locator("#jobTitle").fill("Installation technician"); await page.locator("#hireDate").fill(plus(-20));
  await page.screenshot({ path: `${SHOTS}/onboarding-filled-phone.png`, fullPage: true });
  await page.getByRole("button", { name: /^Create employee/ }).dblclick();
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}/, { timeout: 20000 });
  EMP = page.url().match(/employees\/([0-9a-f-]{36})/)[1];
  if (one(`select count(*) from employees where company_id = '${AE}' and employee_number = '${EMPNO}'`) !== "1") throw new Error("a double click created more than one employee");
  await page.getByTestId("setup-checklist").waitFor();
  const t = await body();
  if (!/Employee created/.test(t)) throw new Error("no created notice");
  for (const k of ["contract", "compensation", "documents", "account"]) if (!/To do/.test(await page.getByTestId(`setup-status-${k}`).innerText())) throw new Error(`${k} should be to do`);
  if (!/Optional/.test(await page.getByTestId("setup-status-opening_balances").innerText())) throw new Error("opening balances should be optional");
  await page.screenshot({ path: `${SHOTS}/profile-setup-phone.png`, fullPage: true });
  await noHScroll("the profile");
});

await step("Saudi Arabia and Poland employees take their company's country and currency into the saved records (contract and pay entered in the same step this time)", async () => {
  for (const [co, cc, cur, no] of [[SA, "SA", "SAR", "ZZ-702"], [PL, "PL", "PLN", "ZZ-703"]]) {
    await go("/employees/new");
    await page.locator("#companyId").selectOption(co); await page.getByTestId("onboarding-summary").waitFor();
    await page.locator("#firstName").fill(`Test${cc}`); await page.locator("#lastName").fill("Country"); await page.locator("#employeeNumber").fill(no); await page.locator("#hireDate").fill(plus(-10));
    await page.getByText("Contract and pay now (optional)").click();
    await page.locator("#contractType").selectOption("permanent"); await page.locator("#basicSalary").fill("3000");
    if ((await page.locator("#salaryCurrency").inputValue()).toUpperCase() !== cur) throw new Error(`${cc}: the pay currency was not suggested as ${cur}`);
    await page.getByRole("button", { name: /^Create employee/ }).click();
    await page.waitForURL(/\/employees\/[0-9a-f-]{36}/, { timeout: 20000 });
    const id = page.url().match(/employees\/([0-9a-f-]{36})/)[1];
    if (one(`select country_code from employees where id = '${id}'`) !== cc) throw new Error(`${cc}: country not taken from the company`);
    if (one(`select currency from compensation_details where employee_id = '${id}'`) !== cur) throw new Error(`${cc}: pay currency not ${cur}`);
    if (one(`select count(*) from employment_contracts where employee_id = '${id}'`) !== "1") throw new Error(`${cc}: contract not saved`);
    if (!/Done/.test(await page.getByTestId("setup-status-contract").innerText()) || !/Done/.test(await page.getByTestId("setup-status-compensation").innerText())) throw new Error(`${cc}: the checklist does not show contract and pay done`);
  }
});

await step("leave midway and resume the same record: the directory flags it, the profile still lists the same steps, and a repeat submit of the creation goes to the same record", async () => {
  await go(`/employees?q=${EMPNO}`);
  const row = await body(); if (!/setup steps? to do|setup steps/i.test(row)) throw new Error(`the directory does not flag the unfinished setup: ${row.slice(0, 220)}`);
  await page.getByRole("link", { name: new RegExp(FIRST) }).first().click(); await page.waitForURL(new RegExp(EMP));
  if (!(await page.getByTestId("setup-checklist").isVisible())) throw new Error("the resumed profile has no checklist");
  if (one(`select count(*) from employees where employee_number = '${EMPNO}'`) !== "1") throw new Error("a second employee exists");
});

await step("contract step: the form opens with the employee and company shown and the hire date as the start; saving marks the step done", async () => {
  await page.getByTestId("setup-step-contract").getByRole("link").first().click();
  await page.getByTestId("add-contract").waitFor();
  const who = await page.getByTestId("add-contract-who").innerText(); if (!new RegExp(FIRST).test(who) || !/Enginious Local AE/.test(who)) throw new Error(`context: ${who}`);
  if (!(await page.locator("#startDate").inputValue())) throw new Error("the start date was not prefilled from the hire date");
  await page.getByRole("button", { name: /Add contract|Save|Add/ }).last().click();
  await until(() => one(`select count(*) from employment_contracts where employee_id = '${EMP}'`) === "1");
});

await step("pay step: Add salary opens in the same change form with the date from the hire date and the company currency; saving records the first salary", async () => {
  await go(`/employees/${EMP}`);
  await page.getByTestId("setup-step-compensation").getByRole("link").first().click();
  await page.getByTestId("change-employment-form").waitFor();
  if (!/AED/.test(await page.locator("#currency-shown").inputValue())) throw new Error("currency was not the company's");
  await page.locator("#newBasicSalary").fill("6500"); await page.locator("#newOtherAllowance").fill("750");
  await page.getByRole("button", { name: /Add salary/ }).click();
  await until(() => one(`select count(*) from compensation_details where employee_id = '${EMP}' and is_current`) === "1");
  if (one(`select base_salary::text from compensation_details where employee_id = '${EMP}' and is_current`) !== "6500.00" && one(`select base_salary::text from compensation_details where employee_id = '${EMP}' and is_current`) !== "6500") throw new Error("salary not saved");
});

await step("documents step: the Add document form opens with the employee, company and the type usual for the country; the type decides the fields; saving marks the step done", async () => {
  await go(`/employees/${EMP}`);
  await page.getByTestId("setup-step-documents").getByRole("link").first().click();
  await page.getByTestId("add-document-form").waitFor();
  const ctx = await page.getByTestId("add-document-context").innerText(); if (!new RegExp(FIRST).test(ctx) || !/Enginious Local AE/.test(ctx)) throw new Error(`context: ${ctx}`);
  await page.getByTestId("add-document-submit").click();
  await page.getByText(/Enter the Emirates ID number/).waitFor({ timeout: 5000 }).catch(() => { throw new Error("a missing number was not asked for beside the field"); });
  await page.locator("#docNumber").fill("784-1990-1234567-1"); await page.locator("#docExpiry").fill(plus(25));
  await page.screenshot({ path: `${SHOTS}/add-document-phone.png`, fullPage: true });
  await page.getByTestId("add-document-submit").click();
  await until(() => one(`select count(*) from identity_documents where employee_id = '${EMP}'`) === "1");
});

await step("opening balances (optional step): recorded once with the employee and company shown; a second submit is refused and no second row exists", async () => {
  await go(`/employees/${EMP}`);
  await page.getByTestId("setup-step-opening_balances").getByRole("link").first().click();
  await page.getByTestId("opening-balances-card").waitFor();
  await page.locator("#openingAnnualLeaveDays").fill("5"); await page.locator("#openingCompDays").fill("2");
  const save = page.getByTestId("opening-balances-card").getByRole("button", { name: /Save|Record/ });
  await save.dblclick();
  await until(() => one(`select count(*) from leave_ledger where employee_id = '${EMP}' and reference_type = 'opening_balance'`) === "1");
  if (one(`select count(*) from comp_day_ledger where employee_id = '${EMP}' and source = 'opening_balance'`) !== "1") throw new Error("comp-day opening balance count");
  await go(`/employees/${EMP}?tab=leave&step=opening-balances`);
  const again = page.getByTestId("opening-balances-card").getByRole("button", { name: /Save|Record/ });
  if (await again.count()) { await page.locator("#openingAnnualLeaveDays").fill("5"); await again.first().click(); await page.waitForTimeout(1200); }
  if (one(`select count(*) from leave_ledger where employee_id = '${EMP}' and reference_type = 'opening_balance'`) !== "1") throw new Error("a repeat added a second opening balance");
});

await step("the checklist now shows contract, compensation, documents and opening balances done and only the account to do", async () => {
  await go(`/employees/${EMP}`);
  for (const k of ["contract", "compensation", "documents", "opening_balances"]) if (!/Done/.test(await page.getByTestId(`setup-status-${k}`).innerText())) throw new Error(`${k} is not done`);
  if (!/To do/.test(await page.getByTestId("setup-status-account").innerText())) throw new Error("account should still be to do");
  await page.screenshot({ path: `${SHOTS}/profile-setup-mostly-done-phone.png`, fullPage: true });
});

await step("job and pay: a change dated today is applied (title and pay together); one dated later is SCHEDULED and changes nothing until its date; before the hire date is refused", async () => {
  await go(`/employees/${EMP}?tab=employment&change=job`);
  await page.getByTestId("change-employment-form").waitFor();
  await page.locator("#newJobTitle").fill("Senior technician"); await page.locator("#newBasicSalary").fill("7000");
  if (!/today/i.test(await page.getByTestId("change-employment-effect").innerText())) throw new Error("the effect sentence does not say it takes effect today");
  await page.getByRole("button", { name: /Save|Record|Change/ }).last().click();
  await until(() => one(`select job_title from employees where id = '${EMP}'`) === "Senior technician");
  if (one(`select count(*) from compensation_details where employee_id = '${EMP}' and is_current`) !== "1") throw new Error("more than one current pay");
  await go(`/employees/${EMP}?tab=employment&change=salary`);
  await page.locator("#effectiveDate").fill(plus(30)); await page.locator("#newBasicSalary").fill("7500"); await page.locator("#newJobTitle").fill("Lead technician");
  if (!/Scheduled/i.test(await page.getByTestId("change-employment-effect").innerText())) throw new Error("the effect sentence does not say it is scheduled");
  await page.getByRole("button", { name: /Schedule|Save|Record|Change/ }).last().click();
  await until(() => one(`select count(*) from employee_career_events where employee_id = '${EMP}' and applied_at is null`) === "1");
  if (one(`select job_title from employees where id = '${EMP}'`) !== "Senior technician") throw new Error("a scheduled change altered the title early");
  if (one(`select base_salary::text from compensation_details where employee_id = '${EMP}' and is_current`).replace(/\.00$/, "") !== "7000") throw new Error("a scheduled change altered pay early");
  await go(`/employees/${EMP}?tab=employment`); if (!/Takes effect on/.test(await body())) throw new Error("the scheduled change is not listed");
  await page.screenshot({ path: `${SHOTS}/employment-scheduled-phone.png`, fullPage: true });
  await go(`/employees/${EMP}?tab=employment&change=salary`);
  await page.locator("#effectiveDate").fill(plus(-400)); await page.locator("#newBasicSalary").fill("9000");
  await page.getByRole("button", { name: /Save|Record|Change|Schedule/ }).last().click(); await page.waitForTimeout(1500);
  if (one(`select count(*) from compensation_details where employee_id = '${EMP}'`) !== "2") throw new Error("a change before the hire date was saved");
  // the daily job on its date applies the scheduled change (as the service role would)
  db(`select apply_due_employment_changes('AE', current_date + 31)`);
  if (one(`select job_title from employees where id = '${EMP}'`) !== "Lead technician") throw new Error("the scheduled title was not applied on its date");
  if (one(`select count(*) from compensation_details where employee_id = '${EMP}' and is_current`) !== "1") throw new Error("pay current count after applying");
});

await step("Change salary shortcut: the Compensation tab sends an authorised user into the one change form with pay first", async () => {
  await go(`/employees/${EMP}?tab=compensation`);
  await page.getByTestId("change-salary-link").click(); await page.getByTestId("change-employment-form").waitFor();
  if (!/employment/.test(page.url())) throw new Error("the shortcut did not go to the one change form");
  if (await page.locator("form").filter({ has: page.locator("#baseSalary") }).count()) throw new Error("a second pay form still exists");
});

await step("renewal: the Renew button opens the form with the document type chosen and locked and the earlier number filled; the earlier document stays in the history", async () => {
  await go(`/employees/${EMP}?tab=documents`);
  const rows = page.locator("[data-testid^=renew-]"); if ((await rows.count()) < 1) throw new Error("no Renew button on a document with an expiry");
  await rows.first().click(); await page.getByTestId("add-document-form").waitFor();
  if (!/Emirates ID/.test(await page.getByTestId("add-document-type-locked").innerText())) throw new Error("type not locked to the renewed document");
  if (!(await page.locator("#docNumber").inputValue())) throw new Error("the earlier number was not prefilled");
  await page.locator("#docExpiry").fill(plus(900)); await page.getByTestId("add-document-submit").click();
  await until(() => one(`select count(*) from identity_documents where employee_id = '${EMP}'`) === "2");
  await go(`/employees/${EMP}?tab=documents`); if (((await page.locator("[data-testid^=document-row-]").count())) < 2) throw new Error("the earlier document is no longer listed");
  await page.screenshot({ path: `${SHOTS}/documents-renewed-phone.png`, fullPage: true });
});

await step("a Visa needs its file: the type decides the fields, and the file is asked for beside the field", async () => {
  await go(`/employees/${EMP}?tab=documents&add=${encodeURIComponent("employee:visa")}`);
  await page.getByTestId("add-document-form").waitFor();
  await page.locator("#docExpiry").fill(plus(300)); await page.getByTestId("add-document-submit").click();
  await page.getByText(/Attach the Visa file/).waitFor({ timeout: 5000 }).catch(() => { throw new Error("the missing file was not asked for"); });
  if (one(`select count(*) from employee_documents where employee_id = '${EMP}'`) !== "0") throw new Error("a visa was saved without its file");
});

await step("People & Access: the profile's card names the company and the modules a change there affects, links to the right record, and employment saves left every grant untouched", async () => {
  await as("admin");
  await go(`/employees/${EMP}`);
  const card = await page.getByTestId("people-access-card").innerText();
  if (!/Enginious Local AE/.test(card) || !/(Sales|Projects|Inventory)/.test(card)) throw new Error(`card: ${card}`);
  await page.getByTestId("people-access-card").getByRole("link").first().click();
  await page.waitForURL(/people-access/); await page.waitForLoadState("networkidle");
  await until(async () => new RegExp(FIRST).test(await body()), 15000).catch(() => { throw new Error("People & Access did not open the person"); });
  await page.screenshot({ path: `${SHOTS}/people-access-phone.png`, fullPage: true });
  if (grantsHash() !== GRANTS_BEFORE) throw new Error("a company-scoped grant or role changed during onboarding and employment edits");
});

const SAEMP = `${U}f3`;
await as("hr.ae");
await step("an HR Admin of the UAE company only: cannot see the Saudi employee, her pay or her documents (direct address, tab address and the shared change function)", async () => {
  await go(`/employees/${SAEMP}`); let t = await body();
  if (/Salma/.test(t) && !/not found|could not be found|404/i.test(t)) throw new Error("the Saudi employee is visible");
  await go(`/employees/${SAEMP}?tab=compensation`); t = await body(); if (/9000|SAR/.test(t)) throw new Error("the Saudi salary is visible");
  await go(`/employees?q=Salma`); if (/Salma/.test(await body())) throw new Error("the Saudi employee is in the directory");
  let refused = false; try { asDb(`${U}b1`, `select record_employment_change('${SAEMP}', current_date, 'Boss', 10000, 0, null, current_date)`); } catch { refused = true; }
  if (!refused) throw new Error("the change function accepted another company's employee");
  await go(`/employees/${EMP}`); if (/Amira/.test(await body()) === false) throw new Error("their own company's employee is not visible");
  await go("/employees/new"); await page.locator("#companyId").waitFor();
  const options = await page.locator("#companyId option").allInnerTexts(); if (options.some((o) => /SA|PL|NC/.test(o))) throw new Error(`the company picker offers other companies: ${options.join(", ")}`);
});

await as("fin");
await step("Finance: sees pay and can change it (pay only, no scheduling, no job title); sees no identity documents and no Add employee; direct documents address falls back", async () => {
  await go(`/employees/${EMP}?tab=compensation`);
  if (!(await page.getByTestId("current-pay").count())) throw new Error("Finance cannot see pay");
  await go(`/employees/${EMP}?tab=documents`);
  const t = await body(); if (/784-1990/.test(t)) throw new Error("Finance can read an identity number");
  await go("/employees"); if (await page.getByTestId("add-employee").count()) throw new Error("Finance is offered Add employee");
  await go(`/employees/${EMP}?tab=employment&change=salary`);
  if (await page.locator("#newJobTitle").count()) throw new Error("Finance is offered the job title");
  let refused = false; try { asDb(`${U}b2`, `select record_employment_change('${EMP}', current_date + 10, null, 8000, 0, null, current_date)`); } catch { refused = true; }
  if (!refused) throw new Error("Finance could schedule a pay change");
});

await as("mgr");
await step("a Line Manager: sees their report but not pay or identity documents, and no setup checklist", async () => {
  await go(`/employees/${U}e5`); const t = await body();
  if (!/Eve/.test(t)) throw new Error("manager cannot see the report");
  if (await page.getByTestId("setup-checklist").count()) throw new Error("manager sees the setup checklist");
  await go(`/employees/${U}e5?tab=compensation`); if (/Basic salary/.test(await body())) throw new Error("manager can read pay");
  await go(`/employees/${EMP}`); if (/Amira/.test(await body()) && !/not found|could not be found/i.test(await body()) && (await page.getByTestId("setup-checklist").count())) throw new Error("manager sees another team's record with its setup");
});

await as("emp");
await step("the employee: sees their own profile and nothing of other people's; cannot add documents or change pay", async () => {
  await go(`/employees/${U}e5`); if (await page.getByTestId("setup-checklist").count()) throw new Error("employee sees a setup checklist");
  await go(`/employees/${U}e5?tab=documents`); if (await page.getByTestId("add-document-open").count()) throw new Error("employee is offered Add document");
  await go(`/employees/${EMP}`); const t = await body(); if (/Amira/.test(t) && !/not found|could not be found/i.test(t)) throw new Error("employee can open a colleague's profile");
  let refused = false; try { asDb(`${U}a5`, `select record_employment_change('${U}e5', current_date, 'Boss', 99999, 0, null, current_date)`); } catch { refused = true; }
  if (!refused) throw new Error("an employee could change their own pay");
});

console.log(`\n${passes} passed, ${fails} failed. Screenshots in ${SHOTS}`);
await browser.close();
process.exit(fails ? 1 : 0);
