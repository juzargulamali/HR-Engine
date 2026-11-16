// People & HR Phase 1: ONE focused signed-in walkthrough at PHONE width (390 px) on an isolated test employee. LOCAL STACK ONLY (see README.md); fictional data.
// Seed first with `seed/people-hr.sh`, then run against the production build. It writes to the database it drives.
//   1. onboarding resumes on the SAME record: create an employee (identity and job only), leave to the directory, come back from the directory's flag, finish the pay step without retyping
//      the employee or company; there is still exactly one employee with that number and one id throughout
//   2. schedule a future pay change: it is listed as not in force yet, current pay is exactly what it was (same pay version, same figures, one version)
//   3. a Finance user sees the scheduled change but no way to cancel it; the HR Admin cancels it (two taps)
//   4. current pay is still unchanged; the cancelled change is out of Scheduled changes and appears in History as "Cancelled, never applied"; the daily job on the change's date does not apply it
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/people-hr-cancel-shots";
mkdirSync(SHOTS, { recursive: true });
const AE = "00000000-0000-4000-8000-00000000a001";
const PHONE = { width: 390, height: 844 };
const browser = await chromium.launch();
let page = null; let fails = 0; let passes = 0;
const as = async (email) => { if (page) await page.context().close(); page = await newPage(browser, PHONE, "dark", { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); await login(page, `${email}@e2e.local`); };
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); }
  catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page?.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 44)}.png`, fullPage: true }).catch(() => {}); }
};
const one = (q) => sql(q).split("\n")[0];
const until = async (fn, ms = 20000) => { const t = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t > ms) throw new Error(`condition not met: ${String(fn).slice(0, 110)}`); await new Promise((r) => setTimeout(r, 250)); } };
const body = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
/** Nothing scrolls sideways: not the page, and not any table inside its card (a stacked table has its own overflow-x wrapper that a page-level check does not see). */
const noInnerScroll = async (what) => {
  const wide = await page.evaluate(() => [...document.querySelectorAll(".os-table-wrap")].map((w) => w.scrollWidth - w.clientWidth).filter((d) => d > 1));
  if (wide.length) throw new Error(`${what}: a table scrolls sideways inside its card (by ${wide.join(", ")} px)`);
};
/** Every badge with exactly these words is fully inside its card and none of its words are cut off. */
const badgesFullyVisible = async (words, what) => {
  const badges = await page.locator(".os-badge").filter({ hasText: new RegExp(`^\\s*${words}\\s*$`) }).all();
  if (!badges.length) throw new Error(`${what}: no "${words}" badge found`);
  for (const badge of badges) {
    const box = await badge.boundingBox(); const card = await badge.locator("xpath=ancestor::div[contains(@class,'os-table-wrap')]").boundingBox();
    if (!box || !card) throw new Error(`${what}: "${words}" has no box`);
    if (box.x < card.x - 0.5 || box.x + box.width > card.x + card.width + 0.5) throw new Error(`${what}: "${words}" sticks out of its card (badge ${Math.round(box.x)}-${Math.round(box.x + box.width)}, card ${Math.round(card.x)}-${Math.round(card.x + card.width)})`);
    if (await badge.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) throw new Error(`${what}: the words "${words}" are cut off`);
  }
};
const noHScroll = async (what) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (o.sw > o.cw + 1) throw new Error(`${what}: horizontal overflow ${o.sw} > ${o.cw}`); };
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); };
const plus = (n) => one(`select (current_date + ${n})::text`);
const FIRST = "Nadia"; const LAST = "Cancelcheck"; let EMPNO = "";   // assigned by the database from the shared series when the employee is saved; read back after creation (unique per run, so a rerun needs no reseed)
let EMP = ""; let PAY_BEFORE = "";
const paySnapshot = () => one(`select count(*) || ' version(s); current ' || coalesce(string_agg(id::text || ' ' || base_salary::text || ' ' || allowances::text || ' ' || currency, ';') filter (where is_current), 'none') from compensation_details where employee_id = '${EMP}'`);

await step("the database has the Phase 1 functions including the cancellation; the app under test is built from this checkout", async () => {
  if (one("select to_regprocedure('public.dismiss_employment_change(uuid)') is not null and to_regprocedure('public._hr_lock_employee(uuid)') is not null") !== "t") throw new Error("the database is not built from the corrected migration");
  console.log("     head under test:", execSync("git rev-parse HEAD", { cwd: new URL("../../..", import.meta.url).pathname }).toString().trim());
});

await as("hr1");
await step("onboarding: create an employee with identity and job only; the profile opens on the new record with its setup steps", async () => {
  await go("/employees/new");
  await page.locator("#companyId").selectOption(AE); await page.getByTestId("onboarding-summary").waitFor();
  await page.locator("#firstName").fill(FIRST); await page.locator("#lastName").fill(LAST); await page.getByTestId("number-auto").waitFor();
  await page.locator("#jobTitle").fill("Installation technician"); await page.locator("#hireDate").fill(plus(-60));
  await page.getByRole("button", { name: /^Create employee/ }).click();
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}/, { timeout: 20000 });
  EMP = page.url().match(/employees\/([0-9a-f-]{36})/)[1];
  EMPNO = one(`select employee_number from employees where id = '${EMP}'`);
  await page.getByTestId("setup-checklist").waitFor();
  if (one(`select count(*) from employees where employee_number = '${EMPNO}'`) !== "1") throw new Error("not exactly one employee");
  if (!/To do/.test(await page.getByTestId("setup-status-compensation").innerText())) throw new Error("pay should still be to do");
  await noHScroll("the new profile");
  await page.screenshot({ path: `${SHOTS}/1-created-phone.png`, fullPage: true });
});

await step("leave midway and resume: the directory flags the unfinished setup, the flag opens the SAME record (same id), and the pay step opens with employee and company already shown", async () => {
  await go(`/employees?q=${EMPNO}`);
  if (!/setup steps? to do/i.test(await body())) throw new Error("the directory does not flag the unfinished setup");
  await noHScroll("the directory");
  await page.getByRole("link", { name: new RegExp(FIRST) }).first().click();
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}/);
  if (page.url().match(/employees\/([0-9a-f-]{36})/)[1] !== EMP) throw new Error("resuming opened a different record");
  await page.getByTestId("setup-checklist").waitFor();
  await page.getByTestId("setup-step-compensation").getByRole("link").first().click();
  await page.getByTestId("change-employment-form").waitFor();
  const t = await body();
  if (!new RegExp(FIRST).test(t) || !/Enginious Local AE/.test(t)) throw new Error("the pay form does not show the employee and company");
  if (!/AED/.test(await page.locator("#currency-shown").inputValue())) throw new Error("the company currency was not used");
  await page.locator("#newBasicSalary").fill("6500"); await page.locator("#newOtherAllowance").fill("750");
  await page.getByRole("button", { name: /Add salary/ }).click();
  await until(() => one(`select count(*) from compensation_details where employee_id = '${EMP}' and is_current`) === "1");
  if (one(`select count(*) from employees where employee_number = '${EMPNO}'`) !== "1") throw new Error("a second employee exists");
  if (one(`select id from employees where employee_number = '${EMPNO}'`) !== EMP) throw new Error("the employee id changed");
  PAY_BEFORE = paySnapshot();
});

await step("current terms show the pay before the change", async () => {
  await go(`/employees/${EMP}?tab=employment`);
  if (!/7250 AED \(basic 6500, others 750\)/.test(await page.getByTestId("current-terms").innerText().then((x) => x.replace(/\s+/g, " ")))) throw new Error(`current terms: ${await page.getByTestId("current-terms").innerText()}`);
});

let EVENT = "";
await step("schedule a future pay change: the sentence says scheduled; it is listed as not in force yet; current pay is exactly as before", async () => {
  await go(`/employees/${EMP}?tab=employment&change=salary`);
  await page.getByTestId("change-employment-form").waitFor();
  await page.locator("#effectiveDate").fill(plus(30)); await page.locator("#newBasicSalary").fill("7200");
  if (!/Scheduled/i.test(await page.getByTestId("change-employment-effect").innerText())) throw new Error("the effect sentence does not say it is scheduled");
  await page.getByRole("button", { name: /Schedule|Save|Record|Change/ }).last().click();
  await until(() => one(`select count(*) from employee_career_events where employee_id = '${EMP}' and applied_at is null and dismissed_at is null`) === "1");
  EVENT = one(`select id from employee_career_events where employee_id = '${EMP}' and applied_at is null`);
  if (paySnapshot() !== PAY_BEFORE) throw new Error(`current pay moved: ${paySnapshot()} vs ${PAY_BEFORE}`);
  await go(`/employees/${EMP}?tab=employment`);
  const t = await body();
  if (!/Takes effect on/.test(t) || !/Not in force yet/.test(t)) throw new Error("the scheduled change is not listed as not in force yet");
  if (!(await page.getByTestId(`cancel-form-${EVENT}`).count())) throw new Error("the HR Admin has no way to cancel it");
  await noHScroll("the Employment tab with a scheduled change");
  await page.screenshot({ path: `${SHOTS}/2-scheduled-phone.png`, fullPage: true });
});

await as("fin");
await step("a Finance user sees the scheduled change but is offered no cancel control", async () => {
  await go(`/employees/${EMP}?tab=employment`);
  const t = await body();
  if (!/Takes effect on/.test(t)) throw new Error("Finance cannot see the scheduled change");
  if (await page.getByTestId(`cancel-form-${EVENT}`).count()) throw new Error("Finance was offered a cancel control");
});
await step("Finance's direct database call to cancel is refused and the change is still scheduled", async () => {
  let refused = false;
  try {
    execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -v ON_ERROR_STOP=1 -Atq", { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["pipe", "pipe", "pipe"], input: `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true); select dismiss_employment_change('${EVENT}'); rollback;` });
  } catch { refused = true; }
  if (!refused) throw new Error("the database let Finance cancel");
  if (one(`select dismissed_at is null from employee_career_events where id = '${EVENT}'`) !== "t") throw new Error("the change was cancelled by Finance");
});

await as("hr1");
await step("the HR Admin cancels it in two taps: the first only asks, the second cancels", async () => {
  await go(`/employees/${EMP}?tab=employment`);
  const form = page.getByTestId(`cancel-form-${EVENT}`);
  await form.getByRole("button", { name: /Cancel this change/ }).click();
  if (one(`select dismissed_at is null from employee_career_events where id = '${EVENT}'`) !== "t") throw new Error("the first tap already cancelled it");
  await page.screenshot({ path: `${SHOTS}/3-asking-phone.png`, fullPage: true });
  await form.getByRole("button", { name: /Yes, cancel this change/ }).click();
  await until(() => one(`select dismissed_at is not null from employee_career_events where id = '${EVENT}'`) === "t");
});

await step("after cancelling: current pay is exactly as before (same pay version, one version); the change is gone from Scheduled changes and appears in History as cancelled, never applied", async () => {
  if (paySnapshot() !== PAY_BEFORE) throw new Error(`current pay moved: ${paySnapshot()} vs ${PAY_BEFORE}`);
  if (one(`select applied_at is null and dismissed_by is not null from employee_career_events where id = '${EVENT}'`) !== "t") throw new Error("the event row is not cancelled and unapplied with the person who cancelled it");
  await go(`/employees/${EMP}?tab=employment`);
  const terms = (await page.getByTestId("current-terms").innerText()).replace(/\s+/g, " ");
  if (!/7250 AED \(basic 6500, others 750\)/.test(terms)) throw new Error(`current terms changed: ${terms}`);
  if (!(await page.getByTestId("scheduled-empty").isVisible())) throw new Error("Scheduled changes still lists something");
  const t = await body();
  if (!/Cancelled, never applied/.test(t)) throw new Error("History does not show the cancelled change");
  if (!new RegExp(plus(30)).test(t)) throw new Error("History does not show the change's date");
  await noHScroll("the Employment tab after cancelling");
  await noInnerScroll("History after cancelling");
  await badgesFullyVisible("Salary change", "History");
  await badgesFullyVisible("Cancelled, never applied", "History");
  await page.screenshot({ path: `${SHOTS}/4-cancelled-in-history-phone.png`, fullPage: true });
});

await step("the daily job on the change's date does not apply a cancelled change: nothing applied, nothing held, the cancelled event stays unapplied, pay unchanged", async () => {
  const appliedBefore = one(`select count(*) from employee_career_events where employee_id = '${EMP}' and applied_at is not null`);   // the first salary entry is an applied event
  const r = one(`select (apply_due_employment_changes(((current_date + 31)::timestamp + interval '12 hours') at time zone 'UTC') ->> 'applied') || ' ' || (apply_due_employment_changes(((current_date + 31)::timestamp + interval '12 hours') at time zone 'UTC') ->> 'conflicts')`);
  if (r !== "0 0") throw new Error(`the job applied or held something for a cancelled change: ${r}`);
  if (one(`select count(*) from employee_career_events where employee_id = '${EMP}' and applied_at is not null`) !== appliedBefore) throw new Error("an applied event appeared after the job ran");
  if (one(`select applied_at is null and dismissed_at is not null and conflict_at is null from employee_career_events where id = '${EVENT}'`) !== "t") throw new Error("the cancelled event changed state");
  if (paySnapshot() !== PAY_BEFORE) throw new Error("pay moved after the job ran");
});

await browser.close();
console.log(`\n${fails === 0 ? "ALL PASSED" : "FAILED"}: ${passes} passed, ${fails} failed (screenshots in ${SHOTS})`);
process.exit(fails === 0 ? 0 : 1);
