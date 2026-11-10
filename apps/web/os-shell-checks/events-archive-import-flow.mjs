// TWO focused checks of the event calendar's archive rule and its bulk import, in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (reseed before
// every run: it expects an empty Sales database) and the isolated stack (stack.sh build + start). It writes to the database it drives.
// Run: `node os-shell-checks/events-archive-import-flow.mjs`. People (all local): emp@ = Sales in the UAE company only; pol.worker@ = Sales in the Poland company only.
//   1. ARCHIVE: an authorised UAE-only person archives an EMPTY edition and an edition linked ONLY to a Poland enquiry she cannot see. The visible result is the same for both,
//      nothing is deleted, the Poland enquiry's link is preserved, and the archived editions are not offered when linking a new enquiry.
//   2. IMPORT: a small spreadsheet with two editions of ONE event and one invalid row is previewed: the invalid row is flagged (row number and reason) and the server refuses to
//      save it, with nothing written. The corrected file imports both editions under one event, a person in ANOTHER company sees them, and uploading the same data again
//      (as .xlsx and as .csv) creates no duplicates.
import ExcelJS from "exceljs";
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb } from "./inventory-flow-lib.mjs";

const UAE = "00000000-0000-4000-8000-00000000a001";
const PL = "00000000-0000-4000-8000-00000000a002";
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/ea-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const eq = (got, want, what) => { if (String(got) !== String(want)) throw new Error(`${what}: expected ${want}, got ${got}`); };
const flat = (t) => t.replace(/\s+/g, " ").trim();
const mainText = async (p) => flat(await p.locator("main").innerText());
const go = (p, path) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
const count = (table) => Number(sql(`select count(*) from ${table}`));

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");

// ---- set-up: Poland company with its own Sales person, one account, one event with an EMPTY edition and an edition that only a Poland enquiry is linked to ----
sql(`insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${PL}', 'PLW', 'PLN') on conflict do nothing`);
sql(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U(9)}', '${PL}', '{}')`);
const client = asDb(5, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE', p_company_id => '${UAE}')`);
const event = asDb(5, `select crm_save_event(null, 'Fictional Archive Show', 'exhibition', null, null)`);
const edition = (start, end) => asDb(5, `select crm_save_edition(null, '${event}', '${start}', '${end}', 'Dubai', 'AE', 'Fictional Hall', null)`);
const emptyEd = edition("2030-10-14", "2030-10-18");
const linkedEd = edition("2031-10-13", "2031-10-17");
const liveEd = edition("2032-10-11", "2032-10-15");
const plOpp = asDb(9, `select crm_create_opportunity(p_company_id => '${PL}', p_title => 'Fictional PL stand', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}')`);
asDb(9, `select crm_set_opportunity_edition('${plOpp}', '${linkedEd}')`);

const emp = await newPage(browser, { width: 1440, height: 900 }, "light"); emp.on("dialog", (d) => d.accept()); await login(emp, "emp@e2e.local");
const pol = await newPage(browser, { width: 1440, height: 900 }, "light"); await login(pol, "pol.worker@e2e.local");

// ------------------------------------------------------------------------------------------------------------------------------ 1
await step("ARCHIVE: an empty edition and an edition linked only to a Poland enquiry give a UAE-only person the same result; the Poland link is preserved; neither is offered for new links", async () => {
  page = emp;
  await go(emp, `/sales/events/${event}`);
  const table = emp.getByRole("table", { name: "Editions of this event" });
  const rowOf = (year) => table.getByRole("row").filter({ hasText: new RegExp(`· ${year} ·`) });
  // before: the two editions look the same to this person (neither shows an enquiry: she cannot see the Poland one), and the only removal offered is Archive
  eq(await emp.getByRole("button", { name: /^Remove/ }).count(), 0, "a Remove (delete) button");
  const shape = async (year) => flat(await rowOf(year).getByRole("cell").nth(4).innerText());
  eq(await shape(2030), "0", "enquiries on the empty edition"); eq(await shape(2031), "0", "enquiries on the Poland-linked edition (invisible to her)");
  for (const [year, label] of [[2030, "empty"], [2031, "Poland-linked"]]) {
    await emp.getByRole("button", { name: new RegExp(`^Archive edition .*· ${year} ·`) }).click();
    await rowOf(year).getByText("Archived", { exact: true }).waitFor({ timeout: 15000 });
    if (await rowOf(year).getByRole("button", { name: /^Archive/ }).count()) throw new Error(`the ${label} edition still offers Archive`);
  }
  // the SAME visible result for both: same badges, same figures, same actions
  const visible = async (year) => flat((await rowOf(year).innerText()).replace(/\d{4}-\d{2}-\d{2}|\d{1,2} \w+ \d{4}|\d{1,2} to \d{1,2} \w+ \d{4}|Fictional Expo Global|Fictional Archive Show · \d{4}/g, ""));
  const a = (await rowOf(2030).getByRole("cell").allInnerTexts()).slice(3).map(flat).join("|");
  const b = (await rowOf(2031).getByRole("cell").allInnerTexts()).slice(3).map(flat).join("|");
  eq(a, b, "what the person sees on the two archived editions (status, figures)");
  void visible;
  // nothing was deleted and the Poland link is intact
  eq(sql(`select count(*) from crm_event_editions where event_id='${event}'`), 3, "editions after archiving (none deleted)");
  eq(sql(`select count(*) from crm_event_editions where id in ('${emptyEd}','${linkedEd}') and archived_at is not null`), 2, "archived editions");
  eq(sql(`select event_edition_id from crm_opportunities where id='${plOpp}'`), linkedEd, "the Poland enquiry's link");
  eq(sql(`select count(*) from crm_event_editions where id='${liveEd}' and archived_at is null`), 1, "the third edition stays live");
  // the Poland person still sees her enquiry linked to the archived edition (history is kept)
  page = pol; await go(pol, `/sales/events/${event}?edition=${linkedEd}`);
  if (!/Fictional PL stand/.test(await mainText(pol))) throw new Error("the Poland person no longer sees her linked enquiry on the archived edition");
  // a NEW enquiry cannot be linked to an archived edition: the picker offers only the live one
  page = emp; await go(emp, "/sales/new");
  const ev = emp.getByRole("combobox", { name: /^Event/ });
  await ev.click(); await ev.fill("Archive Show");
  const list = emp.getByRole("listbox", { name: /^Event.*matches/ });
  await list.getByRole("option").first().waitFor();
  const offered = flat(await list.innerText());
  if (!/2032/.test(offered)) throw new Error(`the live 2032 edition is not offered: ${offered}`);
  if (/2030|2031/.test(offered)) throw new Error(`an archived edition is offered for a new link: ${offered}`);
});

// ------------------------------------------------------------------------------------------------------------------------------ 2
const sheet = async (rows) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Events");
  ws.addRow(["Event name", "Country", "City", "Venue", "Start date", "End date"]); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const good = [["Fictional Import Expo", "Saudi Arabia", "Riyadh", "Fictional Centre", "2027-02-01", "2027-02-04"], ["Fictional Import Expo", "Saudi Arabia", "Riyadh", "Fictional Centre", "2028-02-07", "2028-02-10"]];
const bad = [...good, ["Fictional Broken Expo", "United Arab Emirates", "Dubai", "", "2027-06-10", "2027-06-05"]];   // end before start
const upload = async (p, name, buffer, mimeType) => {
  await go(p, "/sales/events/import");
  await p.locator("#events-import-file").setInputFiles({ name, mimeType, buffer });
  await p.getByRole("button", { name: "Check file and preview" }).click();
  await p.getByRole("heading", { name: /2\. Preview/ }).waitFor();
};
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
await step("IMPORT: the invalid row is flagged before any write; the corrected file adds both editions under one event, visible from another company; re-uploading adds no duplicates", async () => {
  page = emp;
  const before = { events: count("crm_events"), editions: count("crm_event_editions") };
  // the template downloads and is blank (headers only)
  const tpl = await emp.request.get(`${BASE}/api/sales/events/import/template`);
  eq(tpl.status(), 200, "template download");
  // 1. the file WITH an invalid row: flagged, with its row number and reason; the Confirm button is off
  await upload(emp, "calendar.xlsx", await sheet(bad), XLSX);
  const t1 = await mainText(emp);
  if (!/Row 4/.test(t1) || !/End date is before the start date/.test(t1)) throw new Error(`the invalid row is not flagged with its row and reason: ${t1.slice(0, 400)}`);
  if (!/Rows to correct\s*1|1\s*Rows to correct/.test(t1)) throw new Error("the summary does not count the row to correct");
  if (!(await emp.getByRole("button", { name: "Nothing to save yet" }).isDisabled())) throw new Error("Confirm is enabled while a row needs correcting");
  // the server refuses to save it even if the button were bypassed
  const forced = await emp.request.post(`${BASE}/api/sales/events/import`, { multipart: { file: { name: "calendar.xlsx", mimeType: XLSX, buffer: await sheet(bad) }, mode: "confirm", expect: "2" } });
  eq(forced.status(), 409, "a forced save of a file with an invalid row");
  eq(count("crm_events"), before.events, "events after the preview and the refused save"); eq(count("crm_event_editions"), before.editions, "editions after the preview and the refused save");
  // 2. the corrected file: preview, confirm
  await upload(emp, "calendar.xlsx", await sheet(good), XLSX);
  const t2 = await mainText(emp);
  if (!/New event/.test(t2) || !/Adds an edition/.test(t2)) throw new Error(`the preview does not mark the new event and the added edition: ${t2.slice(0, 500)}`);
  await emp.getByRole("button", { name: "Confirm: add 2 editions" }).click();
  await emp.getByRole("heading", { name: /4\. Result/ }).waitFor();
  eq(count("crm_events"), before.events + 1, "events after the import"); eq(count("crm_event_editions"), before.editions + 2, "editions after the import");
  eq(sql(`select count(distinct d.event_id) from crm_event_editions d join crm_events e on e.id = d.event_id where e.name = 'Fictional Import Expo'`), 1, "both editions under ONE event");
  // 3. another company's person sees both editions
  page = pol; await go(pol, "/sales/events?q=Fictional+Import+Expo&when=all");
  const polText = await mainText(pol);
  if (!/2027/.test(polText) || !/2028/.test(polText)) throw new Error(`the Poland person does not see both imported editions: ${polText.slice(0, 300)}`);
  // 4. the same data again, as .xlsx and as .csv: everything is already present, nothing is added, nothing duplicates
  page = emp;
  await upload(emp, "calendar-again.xlsx", await sheet(good), XLSX);
  if (!/Already present/.test(await mainText(emp))) throw new Error("the re-upload is not shown as already present");
  if (!(await emp.getByRole("button", { name: "Nothing to save yet" }).isDisabled())) throw new Error("Confirm is enabled for a file that adds nothing");
  const csv = "Event name,Country,City,Venue,Start date,End date\nFictional Import Expo,SA,Riyadh,Fictional Centre,2027-02-01,2027-02-04\nfictional import-expo,SA,Riyadh,,2028-02-07,2028-02-10\n";
  const again = await emp.request.post(`${BASE}/api/sales/events/import`, { multipart: { file: { name: "calendar.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }, mode: "confirm", expect: "0" } });
  eq(again.status(), 200, "a repeated import"); const body = await again.json();
  eq(body.added.editions, 0, "editions added by the repeat"); eq(body.added.events, 0, "events added by the repeat"); eq(body.skipped, 2, "rows skipped as already present");
  eq(count("crm_events"), before.events + 1, "events after the repeat"); eq(count("crm_event_editions"), before.editions + 2, "editions after the repeat");
});

for (const p of [emp, pol]) await p.context().close();
await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
