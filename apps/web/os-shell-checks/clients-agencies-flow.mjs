// Clients & Agencies corrections in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (grants: ceo@ founder, mgr@ and emp@ plain,
// admin@ none; UAE settings) and writes to the database it drives, so reseed before every run. Run: `node os-shell-checks/clients-agencies-flow.mjs`.
//   1. a multi-role organisation is chosen as the agency AND the end client of an inquiry, on create and on edit, and no organisation is created;
//      organisations without the role are not offered;
//   2. a dated follow-up on an account with no inquiry: assigned, seen on Follow-ups, My Day and the account page; reassigning it never changes the
//      account owner (and the other way round); the assignee completes it;
//   3. import: upload, preview, confirm; a change made between preview and confirm gives "preview is out of date" and imports nothing; a fresh preview then succeeds
//      without overwriting the changed value;
//   4. a person without the Sales grant is refused by the page, the route and the database.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await page?.screenshot({ path: `/tmp/ca-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 15000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(200); } throw new Error(`timed out waiting for ${what}`); }
const eq = (a, b, what) => { if (String(a) !== String(b)) throw new Error(`${what}: expected ${b}, got ${a}`); };
const main = async (p = page) => (await p.locator("main").innerText()).replace(/\s+/g, " ");
const orgId = (name) => sql(`select id from crm_organisations where name='${name}'`);
const orgCount = () => Number(sql("select count(*) from crm_organisations"));
const options = async (sel) => (await sel.locator("option").evaluateAll((o) => o.map((x) => x.value))).filter(Boolean);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
const watch = (p) => p.on("dialog", (d) => d.accept());

// Fictional organisations only.
const names = { atlas: "Fictional Atlas Media", agency: "Fictional Agency Only", client: "Fictional Client Only", tech: "Fictional Tech Only", quiet: "Fictional Quiet Account", stale: "Fictional Stale Co" };
if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");
sql(`insert into crm_organisations (name, kind, roles, created_by) values ('${names.atlas}','agency','{agency,client}','${U.ceo}'),('${names.agency}','agency','{agency}','${U.ceo}'),('${names.client}','client','{client}','${U.ceo}'),('${names.tech}','client','{technology}','${U.ceo}'),('${names.quiet}','client','{client}','${U.ceo}'),('${names.stale}','client','{}','${U.ceo}')`);
const ID = Object.fromEntries(Object.entries(names).map(([k, n]) => [k, orgId(n)]));
const BASE_ORGS = orgCount();

// -------------------------------------------------------------------------------------------------------------------------------------------
// 1. Role-aware inquiry pickers
// -------------------------------------------------------------------------------------------------------------------------------------------
page = await newPage(browser); watch(page); await login(page, "emp@e2e.local");
let oppId = "";
await step("create: the multi-role organisation is offered as agency AND end client; organisations without the role are not", async () => {
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  const a = await options(page.locator("#enq-agency")); const c = await options(page.locator("#enq-client"));
  for (const k of ["atlas", "agency"]) if (!a.includes(ID[k])) throw new Error(`agency picker lacks ${k}`);
  for (const k of ["client", "tech", "quiet", "stale"]) if (a.includes(ID[k])) throw new Error(`agency picker offers ${k}`);
  for (const k of ["atlas", "client", "quiet", "stale"]) if (!c.includes(ID[k])) throw new Error(`client picker lacks ${k}`);
  for (const k of ["agency", "tech"]) if (c.includes(ID[k])) throw new Error(`client picker offers ${k}`);
});
await step("create: ONE organisation selected as agency and as end client saves one inquiry and no new organisation", async () => {
  await page.getByLabel("Requirement").fill("Fictional Atlas pitch");
  await page.locator("#enq-source").selectOption("agency_call");
  await page.locator("#enq-agency").selectOption(ID.atlas); await page.locator("#enq-client").selectOption(ID.atlas);
  await page.locator("#enq-next-title").fill("Call to qualify the brief"); await page.locator("#enq-next-date").fill("2027-01-15");
  await page.getByRole("button", { name: "Record enquiry" }).click();
  await page.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}/, { timeout: 20000 });
  oppId = page.url().match(/opportunities\/([0-9a-f-]{36})/)[1];
  eq(sql(`select agency_org_id || '|' || client_org_id from crm_opportunities where id='${oppId}'`), `${ID.atlas}|${ID.atlas}`, "agency|client");
  eq(orgCount(), BASE_ORGS, "organisation count");
});
const openEdit = async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Edit details" }).first().click();
  const d = page.locator("dialog[open]"); await d.waitFor();
  await until(async () => !(await d.locator("#ed-agency").isDisabled()), "the edit pickers to load");
  return d;
};
await step("edit: the same role-aware pickers; choose other organisations, then the multi-role one again, in each field", async () => {
  let d = await openEdit();
  const a = await options(d.locator("#ed-agency")); const c = await options(d.locator("#ed-client"));
  if (!a.includes(ID.atlas) || !a.includes(ID.agency) || a.includes(ID.client) || a.includes(ID.tech)) throw new Error("edit agency picker wrong: " + a.length);
  if (!c.includes(ID.atlas) || !c.includes(ID.client) || c.includes(ID.agency) || c.includes(ID.tech)) throw new Error("edit client picker wrong: " + c.length);
  await d.locator("#ed-agency").selectOption(ID.agency); await d.locator("#ed-client").selectOption(ID.client);
  await d.getByRole("button", { name: "Save changes" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select agency_org_id || '|' || client_org_id from crm_opportunities where id='${oppId}'`), `${ID.agency}|${ID.client}`, "after the first edit");
  await sleep(800);
  d = await openEdit();
  await d.locator("#ed-agency").selectOption(ID.atlas); await d.locator("#ed-client").selectOption(ID.atlas);
  await d.getByRole("button", { name: "Save changes" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select agency_org_id || '|' || client_org_id from crm_opportunities where id='${oppId}'`), `${ID.atlas}|${ID.atlas}`, "after the second edit");
  eq(orgCount(), BASE_ORGS, "organisation count after editing");
});
await step("edit: saving other details does not rewrite the agency or end client", async () => {
  await sleep(800);
  const d = await openEdit();
  await d.getByLabel("Title").fill("Fictional Atlas pitch (revised)");
  await d.getByRole("button", { name: "Save changes" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select agency_org_id || '|' || client_org_id from crm_opportunities where id='${oppId}'`), `${ID.atlas}|${ID.atlas}`, "unchanged");
  const logged = sql(`select string_agg(to_value, ';') from crm_opportunity_events where opportunity_id='${oppId}' and kind='details_changed'`);
  if (/agency_org_id|client_org_id/.test(logged.split(";").pop() ?? "")) throw new Error("the last save logged a party change: " + logged);
});
await step("the database refuses a role the organisation lacks, even when the form is bypassed", async () => {
  const r = await rpc("emp", "crm_update_opportunity", { p_id: oppId, p_expected_version: Number(sql(`select version from crm_opportunities where id='${oppId}'`)), p_patch: { agency_org_id: ID.client } });
  if (!/not recorded as an agency/.test(refusal(r))) throw new Error("not refused: " + JSON.stringify(r.body));
});

// -------------------------------------------------------------------------------------------------------------------------------------------
// 2. A dated follow-up on an account with no inquiry
// -------------------------------------------------------------------------------------------------------------------------------------------
const ceo = await newPage(browser); watch(ceo); await login(ceo, "ceo@e2e.local");
const accountUrl = `${BASE}/sales/accounts/${ID.quiet}?company=${CO}`;
let fuId = "";
await step("founder assigns the account owner, then adds a dated follow-up for emp@ on the account with no inquiry", async () => {
  page = ceo; await ceo.goto(accountUrl, { waitUntil: "networkidle" });
  await ceo.getByRole("button", { name: /Assign owner|Change owner/ }).click();
  let d = ceo.locator("dialog[open]"); await d.locator("#owner-pick").selectOption(U.mgr);
  await d.getByRole("button", { name: "Save owner" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select owner_id from crm_account_profiles where organisation_id='${ID.quiet}'`), U.mgr, "account owner");
  await ceo.getByRole("button", { name: "Add follow-up" }).click();
  d = ceo.locator("dialog[open]");
  await d.locator("#afu-title").fill("Fictional introduction call"); await d.locator("#afu-date").fill(today); await d.locator("#afu-time").fill("23:30");
  await d.locator("#afu-assignee").selectOption(U.emp);
  await d.getByRole("button", { name: "Add follow-up" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  fuId = await until(() => sql(`select id from crm_follow_ups where organisation_id='${ID.quiet}' and opportunity_id is null`), "the follow-up row");
  eq(sql(`select assigned_to || '|' || created_by || '|' || status from crm_follow_ups where id='${fuId}'`), `${U.emp}|${U.ceo}|open`, "assignee|creator|status");
  eq(sql(`select owner_id from crm_account_profiles where organisation_id='${ID.quiet}'`), U.mgr, "account owner after adding the follow-up");
});
await step("the account page shows it under Follow-ups with the account unchanged", async () => {
  await ceo.goto(accountUrl, { waitUntil: "networkidle" });
  const t = await main(ceo);
  if (!/Follow-ups \(1 open/.test(t) || !/Fictional introduction call/.test(t) || !/Account follow-up/.test(t)) throw new Error("account page: " + t.slice(0, 400));
});
const emp = await newPage(browser); watch(emp); await login(emp, "emp@e2e.local");
await step("the assignee sees it on Follow-ups (Today) and on My Day, both pointing at the account", async () => {
  page = emp; await emp.goto(`${BASE}/sales/follow-ups`, { waitUntil: "networkidle" });
  const row = emp.locator("tr", { hasText: "Fictional introduction call" }).first(); await row.waitFor();
  const t = (await row.innerText()).replace(/\s+/g, " ");
  if (!/Fictional Quiet Account/.test(t) || !/Account follow-up \(no inquiry\)/.test(t)) throw new Error("row: " + t);
  await row.getByRole("link", { name: "Fictional Quiet Account" }).first().click(); await emp.waitForURL(new RegExp(`/sales/accounts/${ID.quiet}`), { timeout: 15000 });
  await emp.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const my = (await emp.locator("main").innerText()).replace(/\s+/g, " ");
  if (!/Fictional Quiet Account/.test(my)) throw new Error("My Day does not list it: " + my.slice(0, 500));
  const href = await emp.locator("main a", { hasText: "Fictional Quiet Account" }).first().getAttribute("href");
  if (!href?.includes(`/sales/accounts/${ID.quiet}`)) throw new Error("My Day link: " + href);
});
await step("reassigning the follow-up never changes the account owner, and changing the account owner never changes the follow-up", async () => {
  page = ceo; await ceo.goto(accountUrl, { waitUntil: "networkidle" });
  await ceo.getByRole("button", { name: /^Reassign/ }).first().click();
  let d = ceo.locator("dialog[open]"); await d.locator(`#fu-who-${fuId}`).selectOption(U.ceo);
  await d.getByRole("button", { name: "Save" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select assigned_to from crm_follow_ups where id='${fuId}'`), U.ceo, "follow-up assignee");
  eq(sql(`select owner_id from crm_account_profiles where organisation_id='${ID.quiet}'`), U.mgr, "account owner after reassigning the follow-up");
  await sleep(600);
  await ceo.getByRole("button", { name: /Change owner/ }).click();
  d = ceo.locator("dialog[open]"); await d.locator("#owner-pick").selectOption(U.emp);
  await d.getByRole("button", { name: "Save owner" }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select owner_id from crm_account_profiles where organisation_id='${ID.quiet}'`), U.emp, "account owner");
  eq(sql(`select assigned_to from crm_follow_ups where id='${fuId}'`), U.ceo, "follow-up assignee after changing the account owner");
});
await step("the new assignee completes it on Follow-ups; it leaves the open list and records the outcome", async () => {
  await ceo.goto(`${BASE}/sales/follow-ups`, { waitUntil: "networkidle" });
  await ceo.getByRole("button", { name: "Complete follow-up: Fictional introduction call" }).click();
  const d = ceo.locator("dialog[open]"); await d.getByLabel(/what happened/i).fill("Spoke to the account; sending the portfolio.");
  await d.getByRole("button", { name: /^complete$/i }).click(); await d.waitFor({ state: "hidden", timeout: 15000 });
  eq(sql(`select status || '|' || outcome from crm_follow_ups where id='${fuId}'`), "done|Spoke to the account; sending the portfolio.", "completed");
  eq(sql(`select owner_id from crm_account_profiles where organisation_id='${ID.quiet}'`), U.emp, "account owner after completing");
});

// -------------------------------------------------------------------------------------------------------------------------------------------
// 3. Import: preview, confirm, stale preview, fresh preview, success
// -------------------------------------------------------------------------------------------------------------------------------------------
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Organisations");
ws.addRow(["Organisation name", "Country", "Organisation type", "Website", "Contact name", "Contact title", "Contact email", "Contact phone", "Lead source / exhibition", "Notes", "Account owner work email"]);
ws.addRow(["Fictional Import One", "United Arab Emirates", "Agency", "import-one.example", "Ima One", "Producer", "ima@import-one.example", null, "Referral", null, null]);
ws.addRow(["Fictional Stale Co", "Qatar", "Agency", null, "Cam New", null, "cam@stale.example", null, null, null, null]);
const file = join(tmpdir(), "fictional-clients-agencies-import.xlsx"); await wb.xlsx.writeFile(file);
const importUrl = `${BASE}/sales/accounts/import?company=${CO}`;
const upload = async () => { await ceo.goto(importUrl, { waitUntil: "networkidle" }); await ceo.locator("#import-file").setInputFiles(file); await ceo.getByRole("button", { name: "Check file and preview" }).click(); await ceo.getByText("2. Preview: nothing has been saved yet").waitFor({ timeout: 20000 }); };
await step("upload and preview: nothing is saved", async () => {
  page = ceo; await upload();
  const t = await main(ceo);
  if (!/New organisations/.test(t) || !/Existing, to fill in/.test(t)) throw new Error("preview: " + t.slice(0, 300));
  eq(sql(`select count(*) from crm_organisations where name='Fictional Import One'`), 0, "created before confirm");
});
await step("a change made between preview and confirm: 'preview is out of date', nothing imported", async () => {
  sql(`update crm_organisations set country_code='SA' where name='${names.stale}'`);   // a person edits it after the preview
  await ceo.getByRole("button", { name: "Confirm import" }).click();
  await until(async () => /This preview is out of date/.test(await main(ceo)), "the out-of-date message");
  if (!(await ceo.getByRole("button", { name: "Run a fresh preview" }).isVisible())) throw new Error("no fresh-preview button");
  if ((await ceo.getByRole("button", { name: "Confirm import" }).count()) !== 0) throw new Error("Confirm is still offered");
  eq(sql(`select count(*) from crm_organisations where name='Fictional Import One'`), 0, "created");
  eq(sql(`select count(*) from crm_contacts where email='cam@stale.example'`), 0, "contact added");
});
await step("a fresh preview then succeeds, and never overwrites the value that changed", async () => {
  await ceo.getByRole("button", { name: "Run a fresh preview" }).click();
  await ceo.getByText("2. Preview: nothing has been saved yet").waitFor({ timeout: 20000 });
  if (/This preview is out of date/.test(await main(ceo))) throw new Error("the stale message is still shown");
  await ceo.getByRole("button", { name: "Confirm import" }).click();
  await until(async () => /The import finished/.test(await main(ceo)), "the result");
  eq(sql(`select count(*) from crm_organisations where name='Fictional Import One'`), 1, "created");
  eq(sql(`select country_code from crm_organisations where name='${names.stale}'`), "SA", "the changed country kept");
  eq(sql(`select roles from crm_organisations where name='${names.stale}'`), "{agency}", "empty type filled");
  eq(sql(`select count(*) from crm_contacts where email='cam@stale.example'`), 1, "contact added once");
  eq(orgCount(), BASE_ORGS + 1, "exactly one organisation created");
});
await step("importing the same file again changes nothing", async () => {
  await upload();
  const b = ceo.getByRole("button", { name: /Nothing to apply|Confirm import/ }).first();
  if (!/Nothing to apply/.test(await b.innerText())) throw new Error("the second preview still offers changes: " + (await main(ceo)).slice(0, 300));
  eq(orgCount(), BASE_ORGS + 1, "organisation count");
});

// -------------------------------------------------------------------------------------------------------------------------------------------
// 4. A person without the Sales grant
// -------------------------------------------------------------------------------------------------------------------------------------------
const admin = await newPage(browser); watch(admin); await login(admin, "admin@e2e.local");
await step("no Sales grant: the import page says so, the route refuses, and the database refuses the functions directly", async () => {
  page = admin; await admin.goto(importUrl, { waitUntil: "networkidle" });
  if (!/You do not have Sales access/.test(await admin.locator("main").innerText())) throw new Error("the page does not say so");
  const res = await admin.request.post(`${BASE}/api/sales/accounts/import`, { multipart: { file: { name: "x.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("x") }, companyId: CO, mode: "confirm" } });
  if (![401, 403].includes(res.status())) throw new Error("route status " + res.status());
  const apply = await rpc("admin", "crm_import_apply", { p_company: CO, p_batch_key: "x".repeat(32), p_items: [{ key: "k", name: "Fictional Nobody", fingerprint: "none" }] });
  if (!/Sales access for this company/.test(refusal(apply))) throw new Error("apply not refused: " + JSON.stringify(apply.body));
  const fu = await rpc("admin", "crm_create_account_follow_up", { p_org: ID.quiet, p_company: CO, p_title: "nope", p_due_at: new Date(Date.now() + 86400000).toISOString() });
  if (!/Sales access for this company/.test(refusal(fu))) throw new Error("account follow-up not refused: " + JSON.stringify(fu.body));
  eq(sql(`select count(*) from crm_organisations where name='Fictional Nobody'`), 0, "created");
});

await browser.close();
console.log(fails ? `\nVERDICT: FAIL (${fails})` : "\nVERDICT: PASS");
process.exit(fails ? 1 : 0);
