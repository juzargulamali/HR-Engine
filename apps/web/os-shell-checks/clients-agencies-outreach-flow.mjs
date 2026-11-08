// Pre-inquiry outreach in a real browser, one full journey. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (ceo@ founder, mgr@ and emp@ plain
// Sales, admin@ no grant; UAE settings) and writes to the database it drives, so reseed before every run. Run: `node os-shell-checks/clients-agencies-outreach-flow.mjs`.
//   import a fictional prospect from an in-memory .xlsx -> a Sales lead assigns outreach with NO inquiry -> the assignee logs a call and an email (status is
//   In progress, never Replied) -> sets the next action -> marks Meeting booked -> creates a REAL inquiry from the outreach -> Inquiry raised, history still on the
//   account; the lead sees it in All outreach; a plain salesperson and a person without the grant are refused.
import { createRequire } from "node:module";
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { refusal, rpc } from "./inventory-flow-lib.mjs";

const ExcelJS = createRequire(import.meta.url)("exceljs");
const CO = "00000000-0000-4000-8000-00000000a001";
const U = { ceo: "00000000-0000-4000-8000-0000000000a3", mgr: "00000000-0000-4000-8000-0000000000a4", emp: "00000000-0000-4000-8000-0000000000a5" };
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/oa-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(200); } throw new Error(`timed out waiting for ${what}`); }
const eq = (a, b, what) => { if (String(a) !== String(b)) throw new Error(`${what}: expected ${b}, got ${a}`); };
const main = async (p = page) => (await p.locator("main").innerText()).replace(/\s+/g, " ");
const watch = (p) => p.on("dialog", (d) => d.accept());
const NAME = "Fictional Prospect Studio";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");

const ceo = await newPage(browser); watch(ceo); await login(ceo, "ceo@e2e.local");
const emp = await newPage(browser); watch(emp); await login(emp, "emp@e2e.local");
const mgr = await newPage(browser); watch(mgr); await login(mgr, "mgr@e2e.local");
const nobody = await newPage(browser); watch(nobody); await login(nobody, "admin@e2e.local");
let orgId = ""; let outreachId = ""; let oppId = "";

await step("import a fictional prospect from an in-memory workbook (no file on disk)", async () => {
  page = ceo;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Organisations");
  ws.addRow(["Organisation name", "Country", "Organisation type", "Website", "Contact name", "Contact title", "Contact email", "Contact phone", "Lead source / exhibition", "Notes", "Account owner work email"]);
  ws.addRow([NAME, "United Arab Emirates", "Agency", "prospect-studio.example", "Pia Prospect", "Producer", "pia@prospect-studio.example", null, "Exhibition", null, null]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await ceo.goto(`${BASE}/sales/accounts/import?company=${CO}`, { waitUntil: "networkidle" });
  await ceo.locator("#import-file").setInputFiles({ name: "fictional-prospects.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await ceo.getByRole("button", { name: "Check file and preview" }).click();
  await ceo.getByText("2. Preview: nothing has been saved yet").waitFor({ timeout: 20000 });
  await ceo.getByRole("button", { name: "Confirm import" }).click();
  await until(async () => /The import finished/.test(await main(ceo)), "the import result");
  orgId = sql(`select id from crm_organisations where name='${NAME}'`);
  eq(sql("select count(*) from crm_opportunities"), 0, "inquiries");
});

await step("a Sales lead selects the prospect and assigns outreach to a salesperson: no inquiry, no deal, owner untouched", async () => {
  page = ceo; await ceo.goto(`${BASE}/sales/accounts?company=${CO}`, { waitUntil: "networkidle" });
  await ceo.getByLabel(`Select ${NAME} for outreach`).check();
  if (!/1 selected of \d+ shown/.test(await main(ceo))) throw new Error("the selection count is not shown");
  await ceo.getByRole("button", { name: "Assign outreach" }).click();
  const d = ceo.locator("dialog[open]"); await d.waitFor();
  await d.locator("#oa-who").selectOption(U.emp); await d.locator("#oa-target").fill("2027-01-15");
  await d.locator("#oa-objective").fill("Reconnect and ask about upcoming exhibitions");
  await d.getByRole("button", { name: "Assign outreach" }).click();
  await until(async () => /Assigned/.test(await d.innerText()) && /Result for each account/.test(await d.innerHTML()), "the per-account result");
  await d.getByRole("button", { name: "Done" }).click();
  outreachId = sql(`select id from crm_outreach where organisation_id='${orgId}'`);
  eq(sql(`select assigned_to || '|' || status || '|' || target_date from crm_outreach where id='${outreachId}'`), `${U.emp}|not_started|2027-01-15`, "outreach");
  eq(sql("select count(*) from crm_opportunities"), 0, "inquiries after assigning");
  eq(sql(`select coalesce((select owner_id::text from crm_account_profiles where organisation_id='${orgId}'), 'none')`), "none", "account owner");
});

await step("the assignee sees it in My outreach; a plain salesperson who was not assigned sees nothing", async () => {
  page = emp; await emp.goto(`${BASE}/sales/outreach`, { waitUntil: "networkidle" });
  const t = await main(emp);
  if (!t.includes(NAME) || !/Not started/.test(t) || !/Reconnect and ask about upcoming exhibitions/.test(t)) throw new Error("My outreach: " + t.slice(0, 400));
  page = mgr; await mgr.goto(`${BASE}/sales/outreach`, { waitUntil: "networkidle" });
  const m = await main(mgr);
  if (m.includes(NAME) || !/Nothing assigned to you/.test(m)) throw new Error("mgr sees: " + m.slice(0, 300));
  if ((await mgr.getByRole("link", { name: "All outreach" }).count()) !== 0) throw new Error("a plain salesperson is offered All outreach");
});

await step("the assignee logs a call and an email: status In progress, never Replied", async () => {
  page = emp; await emp.goto(`${BASE}/sales/accounts/${orgId}?company=${CO}`, { waitUntil: "networkidle" });
  const log = async (kind, outcome, note) => {
    await emp.getByRole("button", { name: "Log activity" }).first().click();
    const d = emp.locator("dialog[open]"); await d.waitFor();
    await d.getByLabel("What", { exact: true }).selectOption(kind);
    const offered = await d.getByLabel("Outcome").locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (offered.includes("replied") !== (kind === "email") || offered.includes("spoke") !== (kind === "call")) throw new Error(`outcome choices do not follow the kind ${kind}: ${offered}`);
    await d.getByLabel("Outcome").selectOption(outcome); await d.getByLabel("Note (optional)").fill(note);
    await d.getByRole("button", { name: "Log activity" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  };
  await log("call", "no_answer", "Rang the studio twice");
  await log("email", "sent", "Sent the portfolio");
  eq(sql(`select status || '|' || last_outcome || '|' || last_contact_kind from crm_outreach where id='${outreachId}'`), "in_progress|sent|email", "after call and email");
  eq(sql(`select count(*) from crm_outreach_events where outreach_id='${outreachId}' and outcome='replied'`), 0, "replied events");
  const t = await main(emp);
  if (/Replied/.test(t.replace(/Waiting for reply/g, ""))) throw new Error("the page shows a reply that was never recorded");
  if (!/Rang the studio twice/.test(t) || !/Sent the portfolio/.test(t)) throw new Error("history is missing the entries");
});

await step("set the next action and mark Meeting booked", async () => {
  await emp.getByRole("button", { name: "Set next action" }).click();
  let d = emp.locator("dialog[open]"); await d.getByLabel("What to do next").fill("Visit the studio and present the LED wall options"); await d.getByLabel("Due date").fill("2027-01-20");
  await d.getByRole("button", { name: "Save next action" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  await emp.getByRole("button", { name: /^Status:/ }).click();
  d = emp.locator("dialog[open]"); await d.getByLabel("Status").selectOption("meeting_booked");
  await d.getByRole("button", { name: "Save status" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select status || '|' || next_action || '|' || next_due from crm_outreach where id='${outreachId}'`), "meeting_booked|Visit the studio and present the LED wall options|2027-01-20", "outreach");
  // Closed needs a reason (the form requires it) and Inquiry raised is not offered by hand.
  await emp.getByRole("button", { name: /^Status:/ }).click();
  d = emp.locator("dialog[open]");
  const opts = await d.getByLabel("Status").locator("option").evaluateAll((o) => o.map((x) => x.value));
  if (opts.includes("inquiry_raised")) throw new Error("Inquiry raised is offered by hand");
  await d.getByLabel("Status").selectOption("closed");
  if (!(await d.getByLabel("Why is it closed?").isVisible())) throw new Error("no reason field for Closed");
  await d.getByRole("button", { name: "Cancel" }).click();
});

await step("the assignee creates a REAL inquiry from the outreach: pre-filled, then Inquiry raised, history kept", async () => {
  await emp.getByRole("link", { name: "Create inquiry" }).click();
  await emp.waitForURL(/\/sales\/new\?/, { timeout: 15000 });
  eq(await emp.locator("#enq-agency").inputValue(), orgId, "agency pre-filled");
  await emp.getByLabel("Requirement").fill("Fictional LED wall for the Prospect Studio launch");
  await emp.locator("#enq-source").selectOption("agency_call");
  await emp.locator("#enq-next-title").fill("Send the quote"); await emp.locator("#enq-next-date").fill("2027-01-25");
  await emp.getByRole("button", { name: "Record enquiry" }).click();
  await emp.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}/, { timeout: 20000 });
  oppId = emp.url().match(/opportunities\/([0-9a-f-]{36})/)[1];
  eq(sql(`select status || '|' || opportunity_id from crm_outreach where id='${outreachId}'`), `inquiry_raised|${oppId}`, "outreach after the inquiry");
  eq(sql("select count(*) from crm_opportunities"), 1, "inquiries (one real one, no placeholder)");
  await emp.goto(`${BASE}/sales/accounts/${orgId}?company=${CO}`, { waitUntil: "networkidle" });
  const t = await main(emp);
  if (!/Inquiry raised/.test(t) || !/Rang the studio twice/.test(t) || !/Sent the portfolio/.test(t) || !/Inquiry linked/.test(t)) throw new Error("account page: " + t.slice(0, 600));
  eq(sql(`select owner_id is null from crm_account_profiles where organisation_id='${orgId}'`), "t", "account owner still unassigned");
});

await step("the Sales lead sees it in All outreach with last contact, latest outcome and status, filtered by assignee", async () => {
  page = ceo; await ceo.goto(`${BASE}/sales/outreach?company=${CO}&view=all&assignee=${U.emp}&status=inquiry_raised`, { waitUntil: "networkidle" });
  const t = await main(ceo);
  if (!t.includes(NAME) || !/Inquiry raised/.test(t) || !/Sent/.test(t) || !/Email/.test(t)) throw new Error("All outreach: " + t.slice(0, 500));
  await ceo.goto(`${BASE}/sales/outreach?company=${CO}&view=all&assignee=${U.mgr}`, { waitUntil: "networkidle" });
  if (!/Nothing matches|No outreach yet/.test(await main(ceo))) throw new Error("the assignee filter did not narrow the list");
});

await step("refusals: a plain salesperson has no selection boxes and the database refuses; no grant is refused by the page and the database", async () => {
  page = mgr; await mgr.goto(`${BASE}/sales/accounts?company=${CO}`, { waitUntil: "networkidle" });
  if ((await mgr.getByLabel(`Select ${NAME} for outreach`).count()) !== 0 || (await mgr.getByRole("button", { name: "Assign outreach" }).count()) !== 0) throw new Error("a plain salesperson is offered Assign outreach");
  const r = await rpc("mgr", "crm_assign_outreach", { p_company: CO, p_orgs: [orgId], p_assignee: U.mgr, p_target: "2027-02-01" });
  if (!/assign owners right/.test(refusal(r))) throw new Error("not refused: " + JSON.stringify(r.body));
  page = nobody; await nobody.goto(`${BASE}/sales/outreach`, { waitUntil: "networkidle" });
  if (!/You do not have Sales access/.test(await nobody.locator("main").innerText())) throw new Error("the page does not say so");
  const n = await rpc("admin", "crm_assign_outreach", { p_company: CO, p_orgs: [orgId], p_assignee: U.emp, p_target: "2027-02-01" });
  if (!/assign owners right/.test(refusal(n))) throw new Error("no-grant not refused: " + JSON.stringify(n.body));
  eq(sql("select count(*) from crm_outreach"), 1, "outreach rows");
});

await browser.close();
console.log(fails ? `\nVERDICT: FAIL (${fails})` : "\nVERDICT: PASS");
process.exit(fails ? 1 : 0);
