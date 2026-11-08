// Clients & Agencies directory TABLE in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (reseed before each run: it expects an empty Sales database,
// then inserts fictional organisations and enquiries itself). Read-only on the page. Run: `node os-shell-checks/clients-agencies-table-flow.mjs [screenshot-dir]`.
//   one row per organisation with the four relationship badges; sorting by clicking headers (aria-sort, URL); the Enquiries note; quick filters (one at a time, counts, URL, kept
//   through sort); More filters indicator; selection scope (select all on this page, label, cleared when the view changes, assign dialog lists only the selected); a person
//   without the assign owners right has no boxes; 390 px: no sideways scroll, no clipped text, tap targets of at least 40 px; optional screenshots (light, plus one dark).
import { mkdirSync } from "node:fs";
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";

const CO = "00000000-0000-4000-8000-00000000a001";
const U = { ceo: "00000000-0000-4000-8000-0000000000a3", mgr: "00000000-0000-4000-8000-0000000000a4", emp: "00000000-0000-4000-8000-0000000000a5" };
const OUT = process.argv[2];
if (OUT) mkdirSync(OUT, { recursive: true });
if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");

// Fictional data. [name, roles, country, owner, [[stage, daysAgo], ...]]
const D = [
  ["Fictional Aurora Events", "{agency,client}", "AE", U.mgr, [["won", 12], ["new", 5]]],
  ["Fictional Bluewave Media", "{agency}", "AE", U.emp, [["won", 40], ["lost", 20]]],
  ["Fictional Cedar Motors", "{client}", "SA", U.mgr, [["negotiation", 9]]],
  ["Fictional Desert Lights", "{technology,client}", "QA", null, [["lost", 30]]],
  ["Fictional Eastgate Retail", "{client,direct}", "AE", U.emp, [["won", 400], ["lost", 300]]],
  ["Fictional Falcon Expo Group", "{agency}", "SA", U.ceo, [["lost", 150]]],
  ["Fictional Gulf Harbour Co", "{direct}", "OM", null, []],
  ["Fictional Harbour Studio", "{agency,technology}", "AE", U.ceo, [["won", 95], ["won", 130], ["qualified", 100]]],
  ["Fictional Iris Pharma", "{client}", "KW", U.mgr, [["proposal_sent", 25]]],
  ["Fictional Jade Interiors", "{}", null, null, []],
  ["Fictional Kite Festivals", "{client}", "AE", null, [["new", 2], ["lost", 60]]],
  ["Fictional Lotus Hospitality", "{client}", "BH", U.emp, [["won", 200]]],
];
let n = 9000;
for (const [name, roles, cc, owner, opps] of D) {
  sql(`insert into crm_organisations (name, kind, roles, country_code, created_by) values ('${name}','client','${roles}',${cc ? `'${cc}'` : "null"},'${U.ceo}')`);
  const id = sql(`select id from crm_organisations where name='${name}'`);
  if (owner) sql(`insert into crm_account_profiles (organisation_id, company_id, owner_id) values ('${id}','${CO}','${owner}')`);
  for (const [stage, days] of opps) {
    const col = /client|direct/.test(roles) ? "client_org_id" : "agency_org_id";
    const closed = stage === "won" || stage === "lost";
    sql(`insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, currency, stage, ${col}, created_at, closed_at, lost_reason, evidence_type, evidence_reference, evidence_date) values ('${CO}','UAE-${++n}','Fictional job ${n}','other','${U.ceo}','${U.ceo}','AED','${stage}','${id}', now() - interval '${days} days', ${closed ? `now() - interval '${days} days'` : "null"}, ${stage === "lost" ? "'Fictional reason'" : "null"}, ${stage === "won" ? "'purchase_order'" : "null"}, ${stage === "won" ? "'PO-FICTIONAL'" : "null"}, ${stage === "won" ? "current_date" : "null"})`);
  }
}
// One account named as agency AND end client of the same enquiry must count once.
const twin = sql("select id from crm_organisations where name='Fictional Aurora Events'");
sql(`insert into crm_opportunities (company_id, reference, title, source, owner_id, created_by, currency, stage, agency_org_id, client_org_id, created_at) values ('${CO}','UAE-${++n}','Fictional twin-role job','other','${U.ceo}','${U.ceo}','AED','new','${twin}','${twin}', now() - interval '3 days')`);

const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]); await page?.screenshot({ path: `/tmp/ca-table-fail-${name.replace(/\W+/g, "_").slice(0, 40)}.png`, fullPage: true }).catch(() => {}); }
};
const eq = (a, b, w) => { if (String(a) !== String(b)) throw new Error(`${w}: expected ${b}, got ${a}`); };
const URL_ = `${BASE}/sales/accounts?company=${CO}`;
const names = async () => (await page.locator("tbody tr td:first-child a").allInnerTexts()).map((s) => s.trim());
const rowFor = (name) => page.locator("tbody tr", { has: page.getByRole("link", { name, exact: true }) });
const shot = async (file) => { if (OUT) await page.screenshot({ path: `${OUT}/${file}` }); };

page = await newPage(browser, { width: 1400, height: 1500 }, "light"); await login(page, "ceo@e2e.local");
await step("table: one row per organisation, the four badges with their words, and the Enquiries note", async () => {
  await page.goto(URL_, { waitUntil: "networkidle" });
  eq((await names()).length, D.length, "rows");
  const row = async (n) => (await rowFor(n).innerText()).replace(/\s+/g, " ");
  const expectBadge = async (n, word) => { if (!(await row(n)).includes(word)) throw new Error(`${n}: no '${word}' in '${await row(n)}'`); };
  await expectBadge("Fictional Aurora Events", "Won work");
  await expectBadge("Fictional Cedar Motors", "No wins yet");
  await expectBadge("Fictional Gulf Harbour Co", "No enquiries recorded");
  await expectBadge("Fictional Eastgate Retail", "Dormant");
  await expectBadge("Fictional Harbour Studio", "Won work"); // an old win, but an open enquiry exists: not Dormant
  await expectBadge("Fictional Lotus Hospitality", "Dormant"); // won 200 days ago, nothing open: Dormant beats Won work
  // twin-role enquiry counted once: 2 enquiries (won + new + twin new = 3). Aurora has won, new and the twin = 3
  const cells = await rowFor("Fictional Aurora Events").locator("td").allInnerTexts();
  eq(cells[3].trim(), "3", "Aurora enquiries (the twin-role enquiry counts once)"); eq(cells[4].trim(), "1", "Aurora won");
  if (!/not quotes Enginious sent/.test(await page.locator("main").innerText())) throw new Error("the Enquiries note is not visible");
  if (!/Dormant = last enquiry 90\+ days ago and no open enquiry/.test(await page.locator("main").innerText())) throw new Error("the 90-day rule is not shown");
  await shot("1-desktop-table.png");
});
await step("sorting: name A-Z by default, click headers, aria-sort, direction, URL, missing dates last", async () => {
  const n0 = await names(); if (JSON.stringify(n0) !== JSON.stringify([...n0].sort((a, b) => a.localeCompare(b)))) throw new Error("default is not A-Z");
  eq(await page.locator("th", { hasText: /^Name/ }).getAttribute("aria-sort"), "ascending", "Name aria-sort");
  await page.locator("thead").getByRole("link", { name: /Last enquiry/ }).click(); await page.waitForURL(/sort=last/);
  eq(await page.locator("th", { hasText: "Last enquiry" }).getAttribute("aria-sort"), "descending", "Last enquiry aria-sort");
  const dates = await page.locator("tbody tr td:nth-child(6)").allInnerTexts();
  const none = dates.map((d, i) => (d.trim() === "None" ? i : -1)).filter((i) => i >= 0);
  if (!none.length || none[0] !== dates.length - none.length) throw new Error("accounts without an enquiry are not last: " + dates.join("|"));
  await page.locator("thead").getByRole("link", { name: /Last enquiry/ }).click(); await page.waitForURL(/dir=asc/);
  eq(await page.locator("th", { hasText: "Last enquiry" }).getAttribute("aria-sort"), "ascending", "toggled");
  const d2 = await page.locator("tbody tr td:nth-child(6)").allInnerTexts();
  eq(d2.slice(-none.length).every((d) => d.trim() === "None"), true, "None still last when ascending");
  await page.locator("thead").getByRole("link", { name: /^Enquiries/ }).click(); await page.waitForURL(/sort=enquiries/);
  const counts = (await page.locator("tbody tr td:nth-child(4)").allInnerTexts()).map((t) => Number(t.trim()));
  if (JSON.stringify(counts) !== JSON.stringify([...counts].sort((a, b) => b - a))) throw new Error("Enquiries not descending: " + counts);
});
await step("quick filters: counts, one at a time, kept in the address, reset with All, Export filtered keeps it", async () => {
  await page.goto(URL_, { waitUntil: "networkidle" });
  const nav = page.getByRole("navigation", { name: "Relationship quick filters" });
  const txt = (await nav.innerText()).replace(/\s+/g, " ");
  for (const [w, c] of [["Won work", 3], ["No wins yet", 4], ["No enquiries recorded", 2], ["Dormant", 3]]) if (!new RegExp(`${w}\\s*\\(${c}\\)`).test(txt)) throw new Error(`count for ${w} is not ${c}: ${txt}`);
  await nav.getByRole("link", { name: /Dormant/ }).click(); await page.waitForURL(/rel=dormant/);
  eq((await names()).length, 3, "dormant rows");
  eq(await nav.getByRole("link", { name: /Dormant/ }).getAttribute("aria-current"), "true", "active chip");
  eq(await nav.getByRole("link", { name: /Won work/ }).getAttribute("aria-current"), null, "other chip");
  const href = await page.getByRole("link", { name: "Export filtered results" }).getAttribute("href");
  if (!/rel=dormant/.test(href)) throw new Error("Export filtered lacks rel: " + href);
  const res = await page.request.get(new URL(href, BASE).toString()); eq(res.status(), 200, "export status");
  await nav.getByRole("link", { name: /Dormant/ }).click(); await page.waitForURL((u) => !u.search.includes("rel="));
  eq((await names()).length, D.length, "reset by clicking the active chip");
});
await step("More filters: closed without filters, a count when a hidden filter is active", async () => {
  eq(await page.locator("details summary", { hasText: "More filters" }).count(), 1, "disclosure");
  eq(await page.locator("details").first().evaluate((d) => d.open), false, "closed");
  await page.goto(`${URL_}&country=AE`, { waitUntil: "networkidle" });
  if (!(await page.locator("details summary").innerText()).includes("1 active")) throw new Error("no active count");
  eq(await page.locator("details").first().evaluate((d) => d.open), true, "open when active");
  eq((await names()).length, 5, "AE rows");
});
await step("selection: select all on this page, label, assign dialog lists only the selected, cleared when the view changes", async () => {
  await page.goto(`${URL_}&rel=won`, { waitUntil: "networkidle" });
  const status = () => page.getByRole("region", { name: "Assign outreach" }).innerText().then((t) => t.replace(/\s+/g, " "));
  if (!/0 selected of 3 shown \(Assign outreach applies to the 0 selected\)/.test(await status())) throw new Error("label: " + await status());
  await page.getByRole("button", { name: "Select all 3 on this page" }).click();
  if (!/3 selected of 3 shown/.test(await status())) throw new Error("select all: " + await status());
  await page.getByLabel("Select Fictional Aurora Events for outreach").uncheck();
  if (!/2 selected of 3 shown/.test(await status())) throw new Error("uncheck: " + await status());
  await shot("2-desktop-quick-filter-selection.png");
  await page.getByRole("button", { name: "Assign outreach" }).first().click();
  const d = page.locator("dialog[open]"); await d.waitFor();
  const listed = await d.getByRole("list", { name: "Selected accounts" }).innerText();
  if (listed.includes("Aurora") || !listed.includes("Harbour Studio") || !listed.includes("Bluewave")) throw new Error("dialog list: " + listed);
  await d.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: /Dormant/ }).click(); await page.waitForURL(/rel=dormant/);
  if (!/0 selected of 3 shown/.test(await status())) throw new Error("selection survived a filter change: " + await status());
  await page.getByRole("button", { name: "Select all 3 on this page" }).click();
  await page.locator("thead").getByRole("link", { name: /^Enquiries/ }).click(); await page.waitForURL(/sort=enquiries/);
  if (!/0 selected of 3 shown/.test(await status())) throw new Error("selection survived a sort change: " + await status());
});
await step("a plain salesperson has no selection boxes, but sorts and filters", async () => {
  const emp = await newPage(browser, { width: 1400, height: 900 }, "light"); await login(emp, "emp@e2e.local");
  await emp.goto(`${URL_}&rel=won`, { waitUntil: "networkidle" });
  eq(await emp.getByRole("checkbox").count(), 0, "checkboxes"); eq(await emp.locator("tbody tr").count(), 3, "rows");
  await emp.context().close();
});
await step("390 px: readable cards, no sideways scroll, quick filters wrap, tap targets of at least 40 px", async () => {
  const p = await newPage(browser, { width: 390, height: 1500 }, "light"); await login(p, "ceo@e2e.local");
  await p.goto(`${URL_}&rel=won`, { waitUntil: "networkidle" });
  const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  if (w.sw > w.cw + 1) throw new Error(`horizontal scroll ${w.sw} > ${w.cw}`);
  const small = await p.evaluate(() => [...document.querySelectorAll("main table a, main table input[type=checkbox], main nav[aria-label=\"Relationship quick filters\"] a, main nav[aria-label=\"Sort accounts\"] a, main [aria-label=\"Assign outreach\"] button, main details summary, main form button[type=submit]")].filter((e) => { const r = e.getBoundingClientRect(); const box = e.closest("span.inline-flex") ?? e; const b = box.getBoundingClientRect(); return r.width > 0 && Math.max(b.height, r.height) < 39.5; }).map((e) => (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30)));
  if (small.length) throw new Error("targets under 40px: " + [...new Set(small)].join(", "));
  const card = (await p.locator("tbody tr").first().innerText()).replace(/\s+/g, " ");
  if (!card.includes("Won work")) throw new Error(`card lacks the badge: ${card}`);
  const labels = await p.locator("tbody tr").first().locator("td").evaluateAll((tds) => tds.map((t) => t.getAttribute("data-label")));
  for (const w of ["Enquiries", "Won enquiries", "Last enquiry", "Relationship", "Account owner"]) if (!labels.includes(w)) throw new Error(`card lacks the label ${w}: ${labels}`);
  if (OUT) { await p.getByRole("navigation", { name: "Relationship quick filters" }).evaluate((e) => e.scrollIntoView()); await p.screenshot({ path: `${OUT}/3-phone-390.png` }); }
  await p.context().close();
});
if (OUT) {
  const dark = await newPage(browser, { width: 1400, height: 1500 }, "dark"); await login(dark, "ceo@e2e.local");
  await dark.goto(URL_, { waitUntil: "networkidle" }); await dark.screenshot({ path: `${OUT}/4-desktop-dark.png` });
}
await browser.close();
console.log(fails ? `VERDICT: FAIL (${fails})` : "VERDICT: PASS"); process.exit(fails ? 1 : 0);
