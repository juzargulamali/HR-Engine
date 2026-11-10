// ONE focused check of the calendar import's "already present" rule, in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (reseed first) and the
// isolated stack (stack.sh start; the app build does not need to change for this check). Run: `node os-shell-checks/events-import-mismatch-flow.mjs`.
//   A row whose event and dates match a recorded edition but whose COUNTRY differs (UAE recorded, a KSA row) is NOT "already present": it is flagged for review, Confirm is off,
//   and a forced save writes nothing at all (not even a valid new edition in the same file). An exact re-upload (same event, dates and place, written with other case,
//   spaces and punctuation) is still skipped cleanly as already present.
import ExcelJS from "exceljs";
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb } from "./inventory-flow-lib.mjs";

const browser = await chromium.launch();
let fails = 0; let page;
const eq = (got, want, what) => { if (String(got) !== String(want)) throw new Error(`${what}: expected ${want}, got ${got}`); };
const flat = (t) => t.replace(/\s+/g, " ").trim();
const mainText = async (p) => flat(await p.locator("main").innerText());
const count = (table) => Number(sql(`select count(*) from ${table}`));
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const sheet = async (rows) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Events");
  ws.addRow(["Event name", "Country", "City", "Venue", "Start date", "End date"]); rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const upload = async (p, buffer) => {
  await p.goto(`${BASE}/sales/events/import`, { waitUntil: "networkidle" });
  await p.locator("#events-import-file").setInputFiles({ name: "calendar.xlsx", mimeType: XLSX, buffer });
  await p.getByRole("button", { name: "Check file and preview" }).click();
  await p.getByRole("heading", { name: /2\. Preview/ }).waitFor();
};

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");
const event = asDb(5, `select crm_save_event(null, 'Fictional Mismatch Show', 'exhibition', null, null)`);
const recorded = asDb(5, `select crm_save_edition(null, '${event}', '2027-09-14', '2027-09-17', 'Dubai', 'AE', 'Fictional Hall', null)`);
const snapshot = () => sql(`select concat_ws('|', count(*), min(country_code), min(city), min(venue), min(start_date), min(end_date)) from crm_event_editions`);
const emp = await newPage(browser, { width: 1440, height: 900 }, "light"); await login(emp, "emp@e2e.local"); page = emp;

try {
  const before = { events: count("crm_events"), editions: count("crm_event_editions"), snap: snapshot() };
  // 1. same event and dates, KSA instead of UAE, plus a valid new edition in the same file
  await upload(emp, await sheet([
    ["Fictional Mismatch Show", "Saudi Arabia", "Riyadh", "Fictional Centre", "2027-09-14", "2027-09-17"],
    ["Fictional Mismatch Show", "United Arab Emirates", "Dubai", "Fictional Hall", "2028-09-12", "2028-09-15"],
  ]));
  const t = await mainText(emp);
  if (!/Row 2/.test(t) || !/country \(recorded AE, file SA\)/.test(t)) throw new Error(`the mismatch is not flagged with its row and reason: ${t.slice(0, 500)}`);
  if (!/not treated as already present/.test(t)) throw new Error("the row is not said to be not-already-present");
  if (/Already present\s*1/.test(t) && !/Rows to correct\s*1|1\s*Rows to correct/.test(t)) throw new Error("the mismatch was counted as already present");
  if (!(await emp.getByRole("button", { name: "Nothing to save yet" }).isDisabled())) throw new Error("Confirm is enabled while a row needs review");
  const forced = await emp.request.post(`${BASE}/api/sales/events/import`, { multipart: { file: { name: "calendar.xlsx", mimeType: XLSX, buffer: await sheet([
    ["Fictional Mismatch Show", "Saudi Arabia", "Riyadh", "Fictional Centre", "2027-09-14", "2027-09-17"],
    ["Fictional Mismatch Show", "United Arab Emirates", "Dubai", "Fictional Hall", "2028-09-12", "2028-09-15"]]) }, mode: "confirm", expect: "1" } });
  eq(forced.status(), 409, "a forced save of a file with a country mismatch");
  eq(count("crm_events"), before.events, "events after the blocked file"); eq(count("crm_event_editions"), before.editions, "editions after the blocked file (the valid row was not written either)");
  eq(snapshot(), before.snap, "the recorded edition after the blocked file (nothing overwritten)");
  // 2. an exact re-upload (other case, spaces and punctuation) is skipped cleanly
  await upload(emp, await sheet([["fictional mismatch-show", "United Arab Emirates", " dubai ", "FICTIONAL  HALL.", "2027-09-14", "2027-09-17"]]));
  const t2 = await mainText(emp);
  if (!/Already present/.test(t2) || /Needs correction/.test(t2)) throw new Error(`the exact re-upload is not shown as already present: ${t2.slice(0, 400)}`);
  if (!(await emp.getByRole("button", { name: "Nothing to save yet" }).isDisabled())) throw new Error("Confirm is enabled for a file that adds nothing");
  const again = await emp.request.post(`${BASE}/api/sales/events/import`, { multipart: { file: { name: "calendar.xlsx", mimeType: XLSX, buffer: await sheet([["Fictional Mismatch Show", "AE", "Dubai", "Fictional Hall", "2027-09-14", "2027-09-17"]]) }, mode: "confirm", expect: "0" } });
  eq(again.status(), 200, "an exact re-upload"); const body = await again.json();
  eq(body.added.editions, 0, "editions added by the exact re-upload"); eq(body.skipped, 1, "rows skipped as already present");
  eq(count("crm_events"), before.events, "events after the exact re-upload"); eq(count("crm_event_editions"), before.editions, "editions after the exact re-upload"); eq(snapshot(), before.snap, "the recorded edition after the exact re-upload");
  void recorded;
  console.log("PASS a same-date UAE/KSA mismatch is flagged and writes nothing (not even the valid row beside it); an exact re-upload is still skipped cleanly");
} catch (e) {
  fails++; console.log("FAIL", String(e.message).split("\n")[0]);
  await page.screenshot({ path: "/tmp/em-fail.png", fullPage: true }).catch(() => {});
}
await emp.context().close(); await browser.close();
console.log(fails ? "\n1 check FAILED" : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
