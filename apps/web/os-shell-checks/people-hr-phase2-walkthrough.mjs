// People & HR Phase 2: ONE focused signed-in walkthrough at PHONE width (390 px) on isolated, fictional data. LOCAL STACK ONLY (see README.md).
// Seed first with `seed/people-hr-phase2.sh`, then run against the production build. It writes to the database it drives.
//   1. the Alerts queue: a document expiry and an attendance exception under Needs action, a probation deadline under Due soon; each row has employee, company, issue, date, who acts next and one action;
//      no identity number in the queue; nothing scrolls sideways
//   2. each action opens the EXACT record with context carried forward (document: the renewal form for that passport with the number prefilled; attendance: the register on that company and date with the
//      employee's row open; probation: that employee's Employment tab) and a way back that returns to the same company and view
//   3. one acknowledgement leaves the issue open (the attendance exception): it moves to Acknowledged and still says it is open, the register and the profile still show it, My Day stops counting it as waiting
//   4. one resolution updates the views: renewing the passport removes it from the queue, the profile and My Day on the next load
//   5. an HR Admin of another company cannot see or open the Polish employee's items or record; a CEO sees items and who acts next but has no Mark as seen
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/people-hr-phase2-shots";
mkdirSync(SHOTS, { recursive: true });
const AE = "00000000-0000-4000-8000-00000000a001"; const PL = "00000000-0000-4000-8000-00000000a002";
const DANA = "00000000-0000-4000-8000-00000000e201"; const PAVEL = "00000000-0000-4000-8000-00000000e202"; const ADEL = "00000000-0000-4000-8000-00000000e203"; const ZOFIA = "00000000-0000-4000-8000-00000000e204";
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
const noHScroll = async (what) => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); if (o.sw > o.cw + 1) throw new Error(`${what}: the page scrolls sideways (${o.sw} > ${o.cw})`); };
const noInnerScroll = async (what) => {
  const wide = await page.evaluate(() => [...document.querySelectorAll(".os-table-wrap")].map((w) => w.scrollWidth - w.clientWidth).filter((d) => d > 1));
  if (wide.length) throw new Error(`${what}: a table scrolls sideways inside its card (by ${wide.join(", ")} px)`);
};
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); };
const row = (name) => page.locator("[data-testid^='queue-item-']").filter({ hasText: name });
const today = one("select current_date::text"); const yesterday = one("select (current_date - 1)::text");
const fromAlerts = (u) => new URL(u).searchParams.get("from") === "alerts";

await step("the database has the Phase 2 migration; the app under test is built from this checkout", async () => {
  if (one("select to_regprocedure('public.acknowledge_hr_queue_item(text, uuid, date, text)') is not null and to_regclass('public.hr_queue_acknowledgements') is not null") !== "t") throw new Error("the database is not built from the current migrations");
  console.log("     head under test:", execSync("git rev-parse HEAD", { cwd: new URL("../../..", import.meta.url).pathname }).toString().trim());
});

await as("hr1");
await step("Alerts (unscoped HR Admin): Needs action lists the document expiry and the attendance exception, Due soon the probation deadline; each row says employee, company, issue, date, who acts next, with one direct action; no identity number; nothing scrolls sideways", async () => {
  await go("/alerts?company=" + AE);
  const needs = page.getByTestId("queue-needs_action"); const due = page.getByTestId("queue-due_soon");
  await needs.waitFor();
  const n = (await needs.innerText()).replace(/\s+/g, " "); const d = (await due.innerText()).replace(/\s+/g, " ");
  for (const [text, what] of [[/Dana Docexpiry/, "Dana"], [/Enginious Local AE/, "company"], [/Passport expired: expired 5 days ago/, "issue"], [/Acts next: You \(HR Admin\)/, "acts next"], [/Adel Attendance/, "Adel"], [/Manual entry and clock records differ/, "attendance issue"]]) if (!text.test(n)) throw new Error(`Needs action is missing ${what}: ${n.slice(0, 300)}`);
  if (!/Pavel Probation/.test(d) || !/Probation review is due in 7 days/.test(d)) throw new Error(`Due soon is missing the probation deadline: ${d.slice(0, 300)}`);
  const all = await body();
  if (/FIC-PASS/.test(all)) throw new Error("an identity document number is in the queue");
  if (/Zofia/.test(all)) throw new Error("the company filter did not narrow the queue");
  await noHScroll("the queue"); await noInnerScroll("the queue");
  await page.screenshot({ path: `${SHOTS}/1-queue-phone.png`, fullPage: true });
});

await step("document expiry opens the renewal form for THAT passport (employee and company shown, number prefilled), and the way back returns to the same company filter", async () => {
  await row("Dana Docexpiry").getByRole("link", { name: "Renew document" }).click();
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}\?/, { timeout: 20000 });
  const u = new URL(page.url());
  if (!u.pathname.endsWith(DANA) || u.searchParams.get("tab") !== "documents" || u.searchParams.get("renew") !== "1" || !fromAlerts(page.url())) throw new Error(`unexpected address ${page.url()}`);
  await page.getByTestId("add-document-form").waitFor();
  const t = await body();
  if (!/Dana/.test(t) || !/Enginious Local AE/.test(t)) throw new Error("the form does not show the employee and company");
  if ((await page.locator("#docNumber").inputValue()) !== "FIC-PASS-0001") throw new Error("the passport number was not prefilled");
  await noHScroll("the renewal form");
  await page.screenshot({ path: `${SHOTS}/2-renew-form-phone.png`, fullPage: true });
  await page.getByRole("link", { name: /Alerts/ }).first().click();
  await page.waitForURL(/\/alerts/); if (new URL(page.url()).searchParams.get("company") !== AE) throw new Error(`the way back lost the company filter: ${page.url()}`);
});

await step("attendance exception opens the register on that company and date with the employee's row open and marked", async () => {
  await row("Adel Attendance").getByRole("link", { name: "Review in the register" }).click();
  await page.waitForURL(/\/attendance\?/, { timeout: 20000 });
  const u = new URL(page.url());
  if (u.searchParams.get("companyId") !== AE || u.searchParams.get("date") !== yesterday || u.searchParams.get("employee") !== ADEL) throw new Error(`unexpected address ${page.url()}`);
  const r = page.locator(`tr[data-employee-id="${ADEL}"]`); await r.waitFor();
  if ((await r.getAttribute("aria-current")) !== "true") throw new Error("the employee's row is not marked");
  if (!(await page.locator(`#detail-${ADEL}`).count())) throw new Error("the employee's row is not open");
  if (!/Needs review \(1\)/.test(await page.getByTestId("needs-review").innerText())) throw new Error("the register does not lead with Needs review");
  await noHScroll("the register"); await noInnerScroll("the register");
  await page.screenshot({ path: `${SHOTS}/3-register-phone.png`, fullPage: true });
});

await step("probation deadline opens that employee's Employment tab", async () => {
  await go("/alerts?company=" + AE);
  await row("Pavel Probation").getByRole("link", { name: "Open employment" }).click();
  await page.waitForURL(/\/employees\/[0-9a-f-]{36}\?/, { timeout: 20000 });
  const u = new URL(page.url());
  if (!u.pathname.endsWith(PAVEL) || u.searchParams.get("tab") !== "employment") throw new Error(`unexpected address ${page.url()}`);
  await page.getByTestId("profile-subtitle").waitFor({ timeout: 20000 });
  if (!/Pavel/.test(await body())) throw new Error("the record is not Pavel's");
  await noHScroll("the employment tab");
});

await step("ACKNOWLEDGE leaves the issue open: Mark as seen moves the attendance exception to Acknowledged, which still says it is open and keeps its link", async () => {
  await go("/alerts?company=" + AE);
  const card = row("Adel Attendance");
  await card.getByLabel("Note for this acknowledgement").fill("Asked the line manager");
  await card.getByRole("button", { name: "Mark as seen" }).click();
  await until(async () => one(`select count(*) from hr_queue_acknowledgements where employee_id = '${ADEL}'`) === "1");
  await go("/alerts?company=" + AE);
  const ack = (await page.getByTestId("queue-acknowledged").innerText()).replace(/\s+/g, " ");
  if (!/Adel Attendance/.test(ack) || !/Asked the line manager/.test(ack) || !/Still open/.test(ack)) throw new Error(`Acknowledged does not show it as seen and still open: ${ack.slice(0, 300)}`);
  if (/Adel Attendance/.test(await page.getByTestId("queue-needs_action").innerText())) throw new Error("it is still under Needs action");
  if (!(await page.getByTestId("queue-acknowledged").getByRole("link", { name: "Review in the register" }).count())) throw new Error("the link to resolve it is gone");
  if (one(`select presence_conflict is not null from attendance_records where employee_id = '${ADEL}'`) !== "t") throw new Error("the source record changed: acknowledging must not resolve it");
  await page.screenshot({ path: `${SHOTS}/4-acknowledged-phone.png`, fullPage: true });
});

await step("the acknowledged issue is still open in the OTHER views: the register still lists it under Needs review, the profile's Attendance tab still lists it, and My Day no longer counts it as waiting", async () => {
  await go(`/attendance?companyId=${AE}&date=${yesterday}`);
  if (!/Adel Attendance/.test(await page.getByTestId("needs-review").innerText())) throw new Error("the register no longer lists it");
  await go(`/employees/${ADEL}?tab=attendance`);
  if (!/Needs review \(1\)/.test(await page.getByTestId("attendance-exceptions").innerText())) throw new Error("the profile's Attendance tab does not lead with the exception");
  await noHScroll("the attendance tab"); await noInnerScroll("the attendance tab");
  await page.screenshot({ path: `${SHOTS}/5-profile-attendance-phone.png`, fullPage: true });
  await go("/");
  const day = await body();
  if (/Attendance exceptions/.test(day)) throw new Error("My Day still counts the acknowledged attendance exception as waiting");
  if (!/Document expiries/.test(day)) throw new Error("My Day does not list the document expiry that has not been seen");
});

await step("RESOLVE updates the views: renewing the passport removes it from the queue, the profile and My Day on the next load", async () => {
  await go(`/employees/${DANA}`);
  if (!/expired/i.test(await page.getByTestId("next-actions").innerText())) throw new Error("the profile does not flag the expired passport before the renewal");
  await go(`/employees/${DANA}?tab=documents&add=identity:passport&renew=1&docId=${one(`select id from identity_documents where employee_id = '${DANA}'`)}`);
  await page.getByTestId("add-document-form").waitFor();
  await page.locator("#docExpiry").fill(one("select (current_date + 400)::text"));
  await page.getByTestId("add-document-submit").click();
  await page.getByTestId("add-document-saved").waitFor({ timeout: 20000 });
  await go("/alerts?company=" + AE);
  if (/Dana Docexpiry/.test(await body())) throw new Error("the queue still lists the renewed passport");
  await go(`/employees/${DANA}`);
  const flags = (await page.getByTestId("next-actions").count()) ? await page.getByTestId("next-actions").innerText() : "";
  if (/passport|expired|expiring|document/i.test(flags)) throw new Error(`the profile still flags the passport: ${flags}`);
  await go("/");
  if (/Document expiries/.test(await body())) throw new Error("My Day still counts the renewed passport");
  await page.screenshot({ path: `${SHOTS}/6-after-resolution-phone.png`, fullPage: true });
});

await as("hr.ae");
await step("OUT OF SCOPE: an HR Admin of the UAE company only sees none of the Polish employee's items and cannot open the record or the register for it", async () => {
  await go("/alerts");
  const t = await body();
  if (/Zofia/.test(t) || /Enginious Local PL/.test(t)) throw new Error("the queue lists the Polish company");
  await go(`/employees/${ZOFIA}`);
  if (/Zofia|FIC-PASS-0002/.test(await body())) throw new Error("the Polish employee's record opened");
  await go(`/attendance?companyId=${PL}&date=${today}&employee=${ZOFIA}`);
  const reg = await body();
  if (/Zofia|Enginious Local PL/.test(reg)) throw new Error("the Polish register opened");
  await go(`/employees/${ZOFIA}?tab=documents&add=identity:passport&renew=1`);
  if (/Zofia|FIC-PASS-0002/.test(await body())) throw new Error("the renewal form opened for the Polish employee");
});
await step("OUT OF SCOPE (database): HR Admin of the UAE company cannot acknowledge the Polish item", async () => {
  const U = "00000000-0000-4000-8000-0000000000b1"; const doc = one(`select id from identity_documents where employee_id = '${ZOFIA}'`); const d = one(`select expiry_date::text from identity_documents where employee_id = '${ZOFIA}'`);
  const out = (() => {
    try { execSync("psql -h 127.0.0.1 -U postgres -d hr_local_stack -Atq -v ON_ERROR_STOP=1", { env: { ...process.env, PGPASSWORD: "postgres" }, input: `set role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${U}","role":"authenticated"}', false);\nselect acknowledge_hr_queue_item('identity_document', '${doc}', '${d}');\n`, stdio: ["pipe", "pipe", "pipe"] }); return "no error"; }
    catch (e) { return String(e.stderr ?? e.message); }
  })();
  if (!/Only HR Admin may acknowledge this item/.test(out)) throw new Error(`unexpected: ${out.slice(0, 200)}`);
  if (one(`select count(*) from hr_queue_acknowledgements where employee_id = '${ZOFIA}'`) !== "0") throw new Error("an acknowledgement was recorded");
});

await as("ceo");
await step("a CEO sees the items and who acts next, with no Mark as seen", async () => {
  await go("/alerts");
  const t = await body();
  if (!/Acts next: HR Admin of/.test(t)) throw new Error("the CEO is not told who acts next");
  if (await page.getByRole("button", { name: "Mark as seen" }).count()) throw new Error("the CEO is offered Mark as seen");
});

console.log(`\n${passes} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
