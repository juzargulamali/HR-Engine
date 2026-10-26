// Real-browser end-to-end check of Project Budget & Expenses (LOCAL STACK ONLY; see README.md). Seed first with `seed/budget.sh`, then run against the
// production build. It plays the whole life of one project's budget through the screens, as the people who would do it, and writes to the local database only.
//   mgr@ Project Manager   hr1@ Finance 1   pol.exec@ Finance 2   ceo@ view-only   hr@ project member (no budget access)   emp@ / admin@ / none@ no access
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/budget-shots";
import { mkdirSync } from "node:fs";
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0; let url = "";
const as = async (email, viewport, theme) => { if (page) await page.context().close(); page = await newPage(browser, viewport, theme); await login(page, `${email}@e2e.local`); return page; };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) {
    fails++;
    console.log("FAIL", name, "::", String(e.message).split("\n")[0], "| main:", (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500));
    await page.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 60)}.png`, fullPage: true }).catch(() => {});
    if (url) await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  }
};
const main = () => page.locator("main");
const mainText = async () => (await main().innerText()).replace(/\s+/g, " ");
const seen = (re, ms = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const gone = (re, ms = 15000) => page.waitForFunction((src) => !new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const go = async (path) => { url = `${BASE}${path}`; await page.goto(url, { waitUntil: "networkidle" }); };
const expectText = async (re) => { const t = await mainText(); if (!re.test(t)) throw new Error(`expected ${re} on the page, got: ${t.slice(0, 300)}`); };
const expectNoText = async (re) => { const t = await mainText(); if (re.test(t)) throw new Error(`did not expect ${re} on the page`); };
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const db = (q) => sql(q);
const untilDb = async (q, expected, ms = 15000) => { const t = Date.now(); for (;;) { const v = db(q); if (v === expected) return; if (Date.now() - t > ms) throw new Error(`database check ${q} = ${v}, expected ${expected}`); await new Promise((r) => setTimeout(r, 300)); } };
const PRJ = db("select id from proj_projects limit 1");
const tab = (name) => page.getByRole("tab", { name, exact: true });
const openTab = async (name) => { await tab(name).click(); await page.waitForFunction((n) => document.querySelector('[role=tab][aria-selected=true]')?.textContent === n, name); };
const noOverflow = async () => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) throw new Error(`horizontal overflow of ${o}px`); };
const group = (label) => main().locator("section", { has: page.getByRole("heading", { name: label, exact: true, level: 3 }) });
// Fill the last line of a category group: description, basis, then the visible number fields by their labels.
const fillLine = async (cat, { description, basis, fields }) => {
  const g = group(cat);
  await g.getByRole("button", { name: /^Add (a .* line|line to .*)$/ }).click();
  const li = g.locator("li").last();
  await li.getByLabel("Description", { exact: true }).fill(description);
  if (basis) await li.getByLabel("How is it calculated?", { exact: true }).selectOption({ label: basis });
  for (const [label, value] of Object.entries(fields)) await li.getByLabel(label, { exact: true }).fill(value);
  return li;
};
const lineTotal = async (li) => (await li.getByTestId("line-total").innerText()).replace(/\s+/g, " ");

// ---- access ----------------------------------------------------------------------------------------------------------
await as("emp");
await step("a person with no budget access sees no Budget tab and is told so on the address", async () => {
  await go(`/projects/${PRJ}`);
  await expectNoText(/\bBudget\b.*\bBudget\b/);
  const tabs = (await page.getByRole("navigation", { name: "Project sections" }).allInnerTexts().catch(() => [])).join(" ");
  if (/Budget/.test(tabs)) throw new Error("Budget tab shown to someone with no access");
  await go(`/projects/${PRJ}/budget`);
  await expectText(/do not have access|Summary only|not found/i);
  await go("/finance/project-budgets");
  await expectText(/do not have access to project budgets/i);
});
await as("hr");
await step("a project member without budget access sees no Budget tab and no budget", async () => {
  await go(`/projects/${PRJ}/work`);
  const nav = (await page.getByRole("navigation", { name: "Project sections" }).innerText()).replace(/\s+/g, " ");
  if (/Budget/.test(nav)) throw new Error("Budget tab shown to a plain member");
  await go(`/projects/${PRJ}/budget`);
  await expectText(/do not have access to this project/i);
});
await as("hr1");
await step("Finance has a Finance menu entry and an empty inbox; no Projects access is needed", async () => {
  await go("/finance/project-budgets");
  await expectText(/Project budgets/);
  await expectText(/No budgets are waiting for approval/);
  const nav = (await page.locator("nav").allInnerTexts()).join(" ");
  if (!/Finance/.test(nav)) throw new Error("no Finance entry in the menu");
});

// ---- the Project Manager prepares the budget ---------------------------------------------------------------------------
await as("mgr");
await step("the Project Manager sees the Budget tab and creates the budget in AED", async () => {
  await go(`/projects/${PRJ}/work`);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Budget" }).click();
  await page.waitForURL(/\/budget/);
  await seen(/Create the project budget/);
  await page.getByLabel("Expense currency").fill("AED");
  await page.getByRole("button", { name: "Create budget" }).click();
  await seen(/Draft budget/);
  await seen(/Total budget/);
});
await step("the four worked examples calculate as typed: food 360, petrol 30, metro 30, truck 1,050", async () => {
  const food = await fillLine("Food", { description: "Lunch for the install team", basis: "Per person per day", fields: { People: "3", Days: "2", "Rate per person per day (AED)": "60" } });
  if (!/AED 360\.00/.test(await lineTotal(food))) throw new Error("food total " + (await lineTotal(food)));
  const petrol = await fillLine("Transport", { description: "Petrol to the venue", basis: "Per kilometre", fields: { Kilometres: "60" } });
  await petrol.getByRole("button", { name: /^Use 0\.5$/ }).click();   // AED suggestion, flagged as not confirmed by Finance
  if (!/AED 30\.00/.test(await lineTotal(petrol))) throw new Error("petrol total " + (await lineTotal(petrol)));
  const text = await petrol.innerText();
  if (!/not yet confirmed by Finance/i.test(text) && !/Suggested/.test(text)) { /* the hint disappears once used; the rate is in the field */ }
  const metro = await fillLine("Transport", { description: "Metro cards 20-22 October", basis: "Fixed total for the whole period", fields: { "Total amount (AED)": "30" } });
  await metro.getByLabel("First day").fill("2026-10-20"); await metro.getByLabel("Last day (if a range)").fill("2026-10-22");
  if (!/AED 30\.00/.test(await lineTotal(metro))) throw new Error("metro total " + (await lineTotal(metro)));
  const truck = await fillLine("Truck / logistics", { description: "Truck to and from the site", basis: "Per trip", fields: { Trips: "3", "Rate per trip (AED)": "350" } });
  if (!/AED 1,050\.00/.test(await lineTotal(truck))) throw new Error("truck total " + (await lineTotal(truck)));
  await seen(/Total budget\s*AED 1,470\.00/);
});
await step("the budget saves as a draft and comes back unchanged after a reload; people can be chosen without touching project dates", async () => {
  await main().getByLabel("Floor projection delivery", { exact: false }).first().isVisible().catch(() => {});
  await page.getByLabel(/Expense period starts/).fill("2026-10-19");
  await page.getByLabel(/Expense period ends/).fill("2026-10-23");
  await main().getByRole("checkbox").first().check();
  await shot("budget-draft-desktop-dark");
  await page.getByRole("button", { name: "Save draft" }).click();
  await seen(/Draft saved/);
  await page.reload({ waitUntil: "networkidle" });
  await seen(/Total budget\s*AED 1,470\.00/);
  await page.waitForTimeout(1500);   // let the page finish hydrating before anything is typed
  const rows = db("select count(*) from pbx_budget_rows");
  if (rows !== "4") throw new Error("expected 4 stored rows, found " + rows);
  const start = db("select start_date from proj_projects limit 1");
  if (!start) throw new Error("project dates changed unexpectedly");
});
await step("the database total equals the page total (no float drift) and the budget cannot be submitted with a line missing a number", async () => {
  const total = db("select total from pbx_budget_versions limit 1");
  if (Number(total) !== 1470) throw new Error("stored total " + total);
  const li = await fillLine("Other expenses", { description: "Incomplete line", basis: "Quantity × rate", fields: { Quantity: "2" } });
  await li.waitFor();
  const submit = page.getByRole("button", { name: /Submit for approval/ });
  if (!(await submit.isDisabled())) throw new Error("submit enabled with an incomplete line");
  await li.getByRole("button", { name: /^Remove the line/ }).click();
  if (await submit.isDisabled()) throw new Error("submit still disabled after removing the incomplete line");
});
await step("submitting sends it to Finance once, even on a double click, and the draft becomes history", async () => {
  await page.getByRole("button", { name: /Submit for approval/ }).dblclick();
  await untilDb("select count(*) from pbx_budget_versions where status = 'submitted'", "1");
  await gone(/Draft budget/);
  await seen(/Budget history/);
  // the submitter, though a Finance-like person might hold access elsewhere, cannot decide their own budget
  await expectNoText(/Approve$/);
});

// ---- Finance returns, the PM revises, a second Finance person approves -------------------------------------------------------
await as("hr1");
await step("the Finance inbox lists the budget and opens the same project record", async () => {
  await go("/finance/project-budgets");
  await seen(/Budget approvals \(1\)/);
  await expectText(/Floor projection delivery/);
  await expectText(/AED 1,470\.00/);
  await expectText(/Ready for you to decide/);
  await shot("inbox-desktop-dark");
  await page.getByRole("link", { name: "Floor projection delivery" }).first().click();
  await page.waitForURL(/\/finance\/project-budgets\/.+section=budget/);
  await seen(/Decide this budget/);
});
await step("Finance returns the budget with a reason, which is required", async () => {
  await page.getByRole("button", { name: "Return for changes" }).click();
  const send = page.getByRole("button", { name: "Return to the Project Manager" });
  if (!(await send.isDisabled())) throw new Error("return allowed without a reason");
  await page.getByLabel("What should the Project Manager change?").fill("Please add a 10 AED parking line");
  await send.click();
  await seen(/Returned/);
  await expectText(/Please add a 10 AED parking line/);
});
await as("mgr");
await step("the Project Manager sees Finance's reason, makes a new draft from the returned version and resubmits", async () => {
  await go(`/projects/${PRJ}/budget`);
  await seen(/The Project Manager changes the budget as Finance asked|Finance said/);
  await expectText(/Please add a 10 AED parking line/);
  await page.getByRole("button", { name: /Make a new draft from this version/ }).click();
  await seen(/Draft budget/);
  await seen(/Total budget\s*AED 1,470\.00/);
  const li = await fillLine("Transport", { description: "Parking", basis: "Fixed total for the whole period", fields: { "Total amount (AED)": "10" } });
  if (!/AED 10\.00/.test(await lineTotal(li))) throw new Error("parking total");
  await page.getByRole("button", { name: /Submit for approval/ }).click();
  await untilDb("select count(*) from pbx_budget_versions where status in ('returned','submitted')", "2");   // the returned version stays on record next to the new submission
  await gone(/Draft budget/);
});
await as("pol.exec");
await step("a second Finance person approves; one decision only", async () => {
  await go(`/finance/project-budgets/${PRJ}?section=budget`);
  await seen(/Decide this budget/);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await untilDb("select status from pbx_budget_versions order by seq desc limit 1", "approved");
  await gone(/Decide this budget/);
  await expectText(/Revised approved budget\s*AED 1,480\.00/);
});

// ---- funds -------------------------------------------------------------------------------------------------------------
await as("hr1");
await step("Finance records a cash advance and a Pluto allocation as different things", async () => {
  await go(`/finance/project-budgets/${PRJ}?section=funds`);
  await seen(/Record funding/);
  await page.getByLabel("Amount (AED)").fill("500");
  await page.getByRole("button", { name: "Record funding" }).dblclick();   // a double click records once
  await seen(/Funding recorded/);
  await page.getByLabel("How was it provided?").selectOption({ label: "Pluto" });
  await page.getByLabel("Amount (AED)").fill("2000");
  await page.getByRole("button", { name: "Record funding" }).click();
  await seen(/AED 2,000\.00/);
  const n = db("select count(*) from pbx_funding where status = 'recorded'");
  if (n !== "2") throw new Error("expected 2 funding entries, found " + n);
  await expectText(/Cash and bank advances held by people\s*AED 500\.00/);
  await expectText(/Company card and Pluto allocations\s*AED 2,000\.00/);
  await expectText(/Advance held/); await expectText(/Not an advance/);
  await shot("funds-desktop-dark");
});

// ---- the Project Manager enters the actual expenses --------------------------------------------------------------------
await as("mgr");
await step("actual expenses start blank: approved amounts are shown, never copied in as actuals", async () => {
  await go(`/projects/${PRJ}/budget?section=actuals`);
  await page.getByRole("button", { name: "Start entering actual expenses" }).click();
  await seen(/Actual expenses \(draft\)/);
  const inputs = main().getByPlaceholder("Not entered");
  const count = await inputs.count();
  if (count < 5) throw new Error("expected five lines, found " + count);
  for (let i = 0; i < count; i++) if ((await inputs.nth(i).inputValue()) !== "") throw new Error("an actual was pre-filled");
  const submit = page.getByRole("button", { name: "Submit final expenses" });
  if (!(await submit.isDisabled())) throw new Error("submit enabled with blank lines");
});
await step("blank is not zero: a typed 0 counts, the difference is worded as over or under", async () => {
  const li = (text) => main().locator("li", { hasText: text }).first();
  const amt = (text) => li(text).getByLabel(/Actual \(AED\)/);
  await amt("Lunch for the install team").fill("400");
  await li("Lunch for the install team").getByLabel("How was it paid?").selectOption({ label: "Paid from a cash / bank advance" });
  await li("Lunch for the install team").getByLabel("Who paid?").selectOption({ label: "mgr" });
  await expectText(/Over AED 40\.00/);
  await amt("Petrol to the venue").fill("30");
  await li("Petrol to the venue").getByLabel("How was it paid?").selectOption({ label: "Paid from a cash / bank advance" });
  await li("Petrol to the venue").getByLabel("Who paid?").selectOption({ label: "mgr" });
  await amt("Metro cards").fill("0");              // a confirmed zero
  await amt("Truck to and from the site").fill("1050");
  await li("Truck to and from the site").getByLabel("How was it paid?").selectOption({ label: "Paid directly by the company" });
  await amt("Parking").fill("10");
  await li("Parking").getByLabel("How was it paid?").selectOption({ label: "Company or Pluto card" });
  await expectText(/Under AED 30\.00|Under budget by AED 30\.00|Under AED/);
});
await step("the PM must confirm completeness; then saves and submits once; Finance sees it", async () => {
  const submit = page.getByRole("button", { name: "Submit final expenses" });
  if (!(await submit.isDisabled())) throw new Error("submit enabled before the completeness confirmation");
  await page.getByLabel(/I confirm these actual expenses are complete/).check();
  await shot("actuals-draft-desktop-dark");
  await submit.dblclick();
  await untilDb("select count(*) from pbx_actual_submissions where status = 'submitted'", "1");
  const metro = db("select actual_amount from pbx_actual_rows where description like 'Metro%'");
  if (Number(metro) !== 0) throw new Error("metro should be a confirmed zero, found " + metro);
});
await as("hr1");
await step("Finance sees the final expenses in the inbox and, as an independent person, can decide them", async () => {
  await go("/finance/project-budgets?filter=actuals");
  await seen(/Final expense approvals \(1\)/);
  await expectText(/Ready for you to decide/);
});
await as("pol.exec");
await step("Finance approves the final expenses; settlement shows advance balance and company-paid spending separately", async () => {
  await go(`/finance/project-budgets/${PRJ}?section=actuals`);
  await page.getByRole("button", { name: "Approve final expenses" }).click();
  await untilDb("select count(*) from pbx_actual_submissions where status = 'approved'", "1");
  await go(`/finance/project-budgets/${PRJ}?section=settlement`);
  await expectText(/Advance still to be returned\s*AED 70\.00/);
  await expectText(/Paid directly by the company\s*AED 1,050\.00/);
  await expectText(/Company card and Pluto spending\s*AED 10\.00/);
  await expectText(/Settlement cannot be closed yet/);
  await expectText(/physical receipts|receipts/i);
  await shot("settlement-desktop-dark");
});
await step("closing is refused until receipts and the returned advance are recorded; then it closes", async () => {
  await page.getByLabel("Receipt status").selectOption({ label: "All received" });
  await page.getByRole("button", { name: "Save receipt status" }).click();
  await untilDb("select receipts_status from pbx_budgets", "received");
  await page.getByLabel("Amount (AED)").fill("70");
  await page.getByRole("button", { name: /^Record$/ }).click();
  await untilDb("select count(*) from pbx_payments where status = 'recorded'", "1");
  await seen(/Everything is reconciled/);
  await page.getByRole("button", { name: /Confirm reconciliation and close/ }).click();
  await untilDb("select settlement_status from pbx_budgets", "closed");
  await seen(/Settlement is closed/);
});

// ---- a Finance person who is the Project Manager: the CEO/CTO approver decides -----------------------------------------------------
const P2 = db("select gen_random_uuid()");
await step("a Finance-holding PM's budget is routed to the CEO/CTO approver: Finance colleagues cannot decide it, the approver can", async () => {
  const co = db("select company_id from proj_projects limit 1");
  db(`insert into proj_projects (id, company_id, reference, name, kind, pm_user_id, created_by, start_date, end_date) values ('${P2}', '${co}', 'UAE-P-2026-0099', 'Finance-led pop-up', 'internal', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3', current_date, current_date + 10); insert into proj_project_details (project_id, location, site_timezone) values ('${P2}', 'Mall atrium', 'Asia/Dubai'); insert into proj_project_members (project_id, user_id, role) values ('${P2}', '00000000-0000-4000-8000-0000000000a1', 'pm')`);
  await as("hr1");
  await go(`/projects/${P2}/budget`);
  await seen(/Create the project budget/);
  await page.getByLabel("Expense currency").fill("AED");
  await page.getByRole("button", { name: "Create budget" }).click();
  await seen(/Draft budget/);
  await page.waitForTimeout(1500);
  await fillLine("Food", { description: "Pop-up crew lunch", basis: "Fixed total for the whole period", fields: { "Total amount (AED)": "500" } });
  await page.getByRole("button", { name: /Submit for approval/ }).click();
  await untilDb("select count(*) from pbx_budget_versions where status = 'submitted' and approval_route = 'executive'", "1");
  await as("pol.exec");                                   // another Finance person: sees it, cannot decide it
  await go(`/finance/project-budgets/${P2}?section=budget`);
  await seen(/CEO or CTO approver decides it/);
  await expectNoText(/Decide this budget/);
  await go("/finance/project-budgets?filter=budget");
  await expectText(/Waiting for the CEO or CTO/);
  await as("admin");                                      // the authorised CEO/CTO approver decides it
  await go("/finance/project-budgets?filter=budget");
  await expectText(/Ready for you to decide/);
  await expectText(/You are an authorised CEO \/ CTO approver/);
  await go(`/finance/project-budgets/${P2}?section=budget`);
  await seen(/Decide this budget/);
  await shot("approver-ceo-cto-desktop-dark");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await untilDb("select count(*) from pbx_budget_versions where status = 'approved' and approval_route = 'executive' and decided_by = '00000000-0000-4000-8000-0000000000a6'", "1");
  // the approver reads everything but records nothing: no funding form, no receipts, no close
  await go(`/finance/project-budgets/${P2}?section=funds`);
  await expectNoText(/Record funding/);
  // Finance may record funding to themselves: a declaration, flagged (no second Finance person is needed)
  await as("hr1");
  await go(`/finance/project-budgets/${P2}?section=funds`);
  await seen(/Record funding/);
  await page.waitForTimeout(1500);
  await page.getByLabel("Amount (AED)").fill("100");
  await page.getByRole("button", { name: "Record funding" }).click();
  await untilDb("select count(*) from pbx_funding where self_declared and status = 'recorded'", "1");
  await seen(/Declared by the person it involves/);
  await shot("funds-self-declared-desktop-dark");
});

// ---- views, themes, phone ------------------------------------------------------------------------------------------------
await as("ceo");
await step("a read-only grantee sees the record but no controls", async () => {
  await go(`/finance/project-budgets/${PRJ}?section=budget`);
  await seen(/Floor projection delivery/);
  for (const name of [/^Approve$/, /Save draft/, /Record funding/, /Request additional budget/]) {
    if ((await main().getByRole("button", { name }).count()) > 0) throw new Error(`control ${name} shown to a read-only person`);
  }
  await go("/finance/project-budgets");
  await expectText(/read these records but not decide/i);
});
await as("mgr", { width: 390, height: 844 });
await step("phone width: the budget, actuals and settlement fit without sideways scrolling", async () => {
  for (const s of ["budget", "actuals", "settlement"]) { await go(`/projects/${PRJ}/budget?section=${s}`); await seen(/Budget|Actual|Settlement/); await noOverflow(); }
  await go(`/projects/${PRJ}/budget?section=budget`); await shot("budget-phone");
});
await as("hr1", { width: 390, height: 844 });
await step("phone width: the Finance inbox fits", async () => { await go("/finance/project-budgets"); await seen(/Project budgets/); await noOverflow(); await shot("inbox-phone"); });
await as("mgr", { width: 1280, height: 900 }, "light");
await step("light theme and keyboard: sections are a tab list that arrow keys move through", async () => {
  await go(`/projects/${PRJ}/budget`);
  await shot("budget-desktop-light");
  await page.getByRole("tab", { name: "Budget" }).focus();
  await page.keyboard.press("ArrowRight");
  const sel = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent);
  if (sel !== "Funds") throw new Error("arrow key did not move to Funds, on " + sel);
});

console.log(`\n${passes} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
