// ONE focused check of the shared directory, the enquiry pickers, Events & Exhibitions and the exhibitor / agency history, in a real browser. LOCAL STACK ONLY, fictional
// data only. Needs `seed/sales.sh` (reseed before every run: it expects an empty Sales database) and the isolated stack (stack.sh build + start). It writes to the database
// it drives. Run: `node os-shell-checks/events-outreach-flow.mjs`. Screenshots (light): SHOTS_DIR (default /tmp/eo-shots).
//
// People (all local): emp@ = Sales in the UAE company only; pol.worker@ = Sales in the Poland company only; mgr@ = Sales in BOTH; hr@ = no Sales access.
//   1. SAME ACCOUNT AND PRIORITY ACROSS COMPANIES: an agency added by the Poland team is in the UAE person's directory (there is no Company selector); the UAE person gives it
//      outreach priority 4; the Poland person sees 4, filters and sorts by it; a person with both companies sees the same account and priority whichever company the address names.
//   2. THE ENQUIRY: New enquiry has ONE search-as-you-type field each for Agency, End client and Event / Exhibition; two similar agency names are told apart by country, the right
//      agency, client and edition are chosen, typing alone selects nothing, and the saved enquiry holds exactly those three ids. The link can be changed and cleared from Edit details.
//   3. COUNTS AND SCOPE: the linked edition's figures (total, open, closed, won, lost) come from the enquiries each viewer can read: the UAE person sees only UAE's, the Poland person
//      only Poland's (neither's references appear on the other's page), the person with both sees the current company's by default and the sum under "All my companies"; a person with no
//      Sales access sees nothing.
//   4. HISTORY: the same exhibitor shows a DIFFERENT agency in two years, "No observation" / "Did not exhibit" / "Agency unknown" stay distinct, one observation is recorded on a PHONE
//      viewport without any enquiry, and the upcoming edition lists BOTH past agencies as outreach leads (with their priority and a path to the account's outreach and follow-ups).
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb } from "./inventory-flow-lib.mjs";
import { mkdirSync } from "node:fs";

const UAE = "00000000-0000-4000-8000-00000000a001";
const PL = "00000000-0000-4000-8000-00000000a002";
const U = (n) => `00000000-0000-4000-8000-0000000000a${n}`;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/eo-shots"; mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/eo-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const eq = (got, want, what) => { if (String(got) !== String(want)) throw new Error(`${what}: expected ${want}, got ${got}`); };
const flat = (t) => t.replace(/\s+/g, " ").trim();
const mainText = async (p) => flat(await p.locator("main").innerText());

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");

// ---- set-up: a second company with its own Sales people, accounts added by both teams, one event with three editions ----
sql(`insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${PL}', 'PLW', 'PLN') on conflict do nothing`);
sql(`insert into crm_company_grants (user_id, company_id, capabilities) values ('${U(9)}', '${PL}', '{}'), ('${U(4)}', '${PL}', '{}')`);
const org = (who, company, name, roles, country, website) =>
  asDb(who, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '${roles}', p_country_code => '${country}', p_website => ${website ? `'https://${website}'` : "null"}, p_company_id => '${company}')`);
const harbour = org(5, UAE, "Fictional Harbour Client", "{client}", "AE", "harbour.example");
const orbit = org(5, UAE, "Fictional Orbit Client", "{client}", "AE", "orbit.example");
const agencyA = org(5, UAE, "Fictional Agency A", "{agency}", "AE", "agency-a.example");
const agencyB = org(5, UAE, "Fictional Agency B", "{agency}", "AE", "agency-b.example");
const auroraAE = org(5, UAE, "Fictional Aurora Agency", "{agency}", "AE", "aurora.example");
const auroraSA = org(5, UAE, "Fictional Aurora Agency Gulf", "{agency}", "SA", "aurora-gulf.example");
const warsaw = org(9, PL, "Fictional Warsaw Agency", "{agency}", "PL", "warsaw.example");
const event = asDb(5, `select crm_save_event(null, 'Fictional Expo Global', 'exhibition', 'https://expo.example', null)`);
const edition = (start, end) => asDb(5, `select crm_save_edition(null, '${event}', '${start}', '${end}', 'Dubai', 'AE', 'Fictional Hall', null)`);
const e25 = edition("2025-10-13", "2025-10-17"); const e26 = edition("2026-10-12", "2026-10-16"); const e27 = edition("2027-10-11", "2027-10-15");
const observe = (edition, exhibitor, args) => asDb(5, `select crm_record_observation('${edition}', '${exhibitor}', ${args})`);
observe(e25, harbour, `'exhibited', '${agencyA}', false, 'B12', 'stand_builder', 'seen on site', 'confirmed'`);
observe(e26, harbour, `'exhibited', null, true, 'C4', null, 'second stand, builder not known', 'unverified'`);
observe(e25, orbit, `'did_not_exhibit', null, false, null, null, 'told by the client', 'confirmed'`);

const empPage = await newPage(browser, { width: 1440, height: 900 }, "light"); empPage.on("dialog", (d) => d.accept()); await login(empPage, "emp@e2e.local");
const polPage = await newPage(browser, { width: 1440, height: 900 }, "light"); await login(polPage, "pol.worker@e2e.local");
const mgrPage = await newPage(browser, { width: 1440, height: 900 }, "light"); await login(mgrPage, "mgr@e2e.local");
const noPage = await newPage(browser, { width: 1440, height: 900 }, "light"); await login(noPage, "hr@e2e.local");
const phone = await newPage(browser, { width: 390, height: 844 }, "light", { deviceScaleFactor: 2, hasTouch: true, isMobile: true }); phone.on("dialog", (d) => d.accept()); await login(phone, "emp@e2e.local");
const go = (p, path) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
const rowOf = (p, name) => p.getByRole("row").filter({ hasText: name });

// ------------------------------------------------------------------------------------------------------------------------------ 1
await step("one shared directory: no Company selector; an agency the Poland team added is there for the UAE team; the priority is ONE value every company sees, sortable and filterable", async () => {
  page = empPage;
  await go(empPage, "/sales/accounts");
  eq(await empPage.locator("#ca-company").count(), 0, "a Company selector on the directory");
  await go(empPage, "/sales/accounts?q=Warsaw");
  await rowOf(empPage, "Fictional Warsaw Agency").waitFor();
  if (!/Unrated/.test(await rowOf(empPage, "Fictional Warsaw Agency").innerText())) throw new Error("a new account should read Unrated");
  await empPage.getByRole("link", { name: "Fictional Warsaw Agency" }).click();
  await empPage.waitForURL(/\/sales\/accounts\//);
  await empPage.getByLabel("Outreach priority (shared)").selectOption("4");
  await empPage.getByText("Priority set to 4 of 5").waitFor();
  eq(sql(`select outreach_priority from crm_organisations where id = '${warsaw}'`), 4, "stored priority");
  eq(sql(`select outreach_priority_by from crm_organisations where id = '${warsaw}'`), U(5), "who set it");
  // the Poland person sees the same account and the same priority, and can filter and sort by it
  page = polPage;
  await go(polPage, "/sales/accounts?q=Warsaw");
  if (!/4 of 5/.test(await rowOf(polPage, "Fictional Warsaw Agency").innerText())) throw new Error("the Poland person does not see priority 4");
  await go(polPage, "/sales/accounts?priority=4%2B");
  const filtered = (await polPage.getByRole("row").allInnerTexts()).join("|");
  if (!/Fictional Warsaw Agency/.test(filtered) || /Fictional Harbour Client/.test(filtered)) throw new Error(`priority filter: ${filtered}`);
  await go(polPage, "/sales/accounts?sort=priority&dir=desc");
  const first = (await polPage.getByRole("row").nth(1).innerText());
  if (!/Fictional Warsaw Agency/.test(first)) throw new Error(`highest priority is not first: ${first}`);
  await polPage.screenshot({ path: `${SHOTS}/1-directory-priority.png` });
});
await step("a person with both companies sees the same accounts and the same priority whichever company the address names, and there is no selector", async () => {
  page = mgrPage;
  const names = async (company) => { await go(mgrPage, `/sales/accounts?company=${company}`); eq(await mgrPage.locator("#ca-company").count(), 0, "Company selector"); return (await mgrPage.getByRole("row").allInnerTexts()).map((t) => flat(t).split(" ")[0] + flat(t).slice(0, 40)).sort().join("|"); };
  const a = await names(UAE); const b = await names(PL);
  eq(a, b, "the list of accounts under each company context");
  await go(mgrPage, `/sales/accounts?company=${UAE}&q=Warsaw`);
  if (!/4 of 5/.test(await rowOf(mgrPage, "Fictional Warsaw Agency").innerText())) throw new Error("priority differs under the UAE context");
  await go(mgrPage, `/sales/accounts?company=${PL}&q=Warsaw`);
  if (!/4 of 5/.test(await rowOf(mgrPage, "Fictional Warsaw Agency").innerText())) throw new Error("priority differs under the Poland context");
});

// ------------------------------------------------------------------------------------------------------------------------------ 2
let oppId = "";
await step("New enquiry: one field each for Agency, End client and Event; similar names are told apart; typing alone selects nothing; the saved enquiry holds exactly the chosen agency, client and edition", async () => {
  page = empPage;
  await go(empPage, "/sales/new");
  await empPage.locator("#enq-title").fill("Fictional gala stand");
  await empPage.locator("#enq-source").selectOption("agency_call");
  const agency = empPage.getByRole("combobox", { name: /^Agency/ });
  await agency.click(); await agency.fill("aurora");
  const rows = await empPage.getByRole("listbox", { name: /^Agency matches/ }).getByRole("option").allInnerTexts();
  if (rows.length !== 2 || !rows.some((r) => /United Arab Emirates/.test(r) && /aurora\.example/.test(r)) || !rows.some((r) => /Saudi Arabia/.test(r))) throw new Error(`similar names not told apart: ${rows.join(" || ")}`);
  eq(await empPage.locator('input[name="agencyOrgId"]').inputValue(), "", "an agency selected by typing alone");
  await empPage.getByRole("option", { name: /Saudi Arabia/ }).click();
  eq(await empPage.locator('input[name="agencyOrgId"]').inputValue(), auroraSA, "the chosen agency");
  const client = empPage.getByRole("combobox", { name: /^End client/ });
  await client.click(); await client.fill("harbour");
  await empPage.getByRole("option", { name: /Fictional Harbour Client/ }).click();
  const ev = empPage.getByRole("combobox", { name: /^Event/ });
  await ev.click(); await ev.fill("expo 2026");
  const evRows = await empPage.getByRole("listbox", { name: /^Event.*matches/ }).getByRole("option").allInnerTexts();
  if (evRows.length !== 1 || !/Fictional Expo Global · 2026 · Dubai/.test(evRows[0])) throw new Error(`event matches: ${evRows.join(" || ")}`);
  await ev.press("ArrowDown").catch(() => {}); await empPage.keyboard.press("Enter");   // chosen from the keyboard
  eq(await empPage.locator('input[name="eventEditionId"]').inputValue(), e26, "the chosen edition");
  await empPage.locator("#enq-next-title").fill("Call the agency");
  await empPage.screenshot({ path: `${SHOTS}/2-new-enquiry-pickers.png` });
  await empPage.getByRole("button", { name: "Record enquiry" }).click();
  await empPage.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}$/, { timeout: 30000 });
  oppId = empPage.url().split("/").pop();
  eq(sql(`select agency_org_id || '|' || client_org_id || '|' || event_edition_id from crm_opportunities where id = '${oppId}'`), `${auroraSA}|${harbour}|${e26}`, "stored agency|client|edition");
  await empPage.getByRole("link", { name: "Fictional Expo Global · 2026 · Dubai" }).waitFor();
});
await step("the event link can be changed and cleared from Edit details, and an enquiry made before it existed (no link) still works", async () => {
  await go(empPage, `/sales/opportunities/${oppId}`);
  const open = async () => { await empPage.getByRole("button", { name: "Edit details" }).first().click(); const dlg = empPage.getByRole("dialog"); await dlg.waitFor(); await dlg.getByRole("combobox", { name: /^Agency/ }).waitFor(); await empPage.waitForFunction(() => !document.querySelector('[role=dialog] input[role=combobox][disabled]')); return dlg; };
  let dlg = await open();
  eq(await dlg.getByRole("combobox", { name: /^Event/ }).inputValue(), "Fictional Expo Global · 2026 · Dubai", "the current event in the dialog");
  await dlg.getByRole("combobox", { name: /^Event/ }).fill("2027");
  await dlg.getByRole("option", { name: /2027/ }).click();
  await dlg.getByRole("button", { name: "Save changes" }).click(); await dlg.waitFor({ state: "detached" });
  eq(sql(`select event_edition_id from crm_opportunities where id = '${oppId}'`), e27, "changed to the 2027 edition");
  dlg = await open();
  await dlg.getByRole("button", { name: /^Clear Event/ }).click();
  await dlg.getByRole("button", { name: "Save changes" }).click(); await dlg.waitFor({ state: "detached" });
  eq(sql(`select coalesce(event_edition_id::text, 'none') from crm_opportunities where id = '${oppId}'`), "none", "cleared");
  if (!/Not linked to an event/.test(await mainText(empPage))) { await go(empPage, `/sales/opportunities/${oppId}`); }
  if (!/Not linked to an event/.test(await mainText(empPage))) throw new Error("the page does not say the enquiry is not linked");
  // an enquiry created with NO event still works end to end (the way every older enquiry was made)
  const plain = asDb(5, `select crm_create_opportunity(p_company_id => '${UAE}', p_title => 'Fictional plain enquiry', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${orbit}')`);
  eq(sql(`select coalesce(event_edition_id::text, 'none') from crm_opportunities where id = '${plain}'`), "none", "an enquiry without an event");
  // put the first one back on 2026 for the figures below
  dlg = await open();
  await dlg.getByRole("combobox", { name: /^Event/ }).fill("2026");
  await dlg.getByRole("option", { name: /2026/ }).click();
  await dlg.getByRole("button", { name: "Save changes" }).click(); await dlg.waitFor({ state: "detached" });
  eq(sql(`select event_edition_id from crm_opportunities where id = '${oppId}'`), e26, "linked again");
});

// ------------------------------------------------------------------------------------------------------------------------------ 3
let ukRefs = []; let plRefs = [];
await step("set-up of the figures: the 2026 edition has 2 UAE enquiries (1 open, 1 lost) and 2 Poland enquiries (1 open, 1 won)", async () => {
  const mk = (who, company, title, client) => asDb(who, `select crm_create_opportunity(p_company_id => '${company}', p_title => '${title}', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}')`);
  const uaeLost = mk(5, UAE, "Fictional UAE lost job", harbour);
  const plOpen = mk(9, PL, "Fictional PL open job", harbour);
  const plWon = mk(9, PL, "Fictional PL won job", harbour);
  for (const [who, id] of [[5, uaeLost], [9, plOpen], [9, plWon]]) asDb(who, `select crm_set_opportunity_edition('${id}', '${e26}')`);
  sql(`update crm_opportunities set stage='lost', lost_reason='fictional', closed_at=now() where id='${uaeLost}'`);
  sql(`update crm_opportunities set stage='won', evidence_type='purchase_order', evidence_reference='PO-FICT-1', evidence_date=current_date, closed_at=now() where id='${plWon}'`);
  ukRefs = sql(`select string_agg(reference, ',' order by reference) from crm_opportunities where company_id='${UAE}' and event_edition_id='${e26}'`).split(",");
  plRefs = sql(`select string_agg(reference, ',' order by reference) from crm_opportunities where company_id='${PL}' and event_edition_id='${e26}'`).split(",");
  eq(ukRefs.length, 2, "UAE linked enquiries"); eq(plRefs.length, 2, "Poland linked enquiries");
});
const figures = async (p, label) => {
  const table = p.getByRole("table", { name: "Editions of this event" });
  await table.waitFor();
  const row = table.getByRole("row").filter({ hasText: /2026/ });
  const cells = (await row.first().getByRole("cell").allInnerTexts()).map((c) => flat(c));
  return { text: cells.slice(4, 9).join(","), all: cells.join("|"), label };
};
await step("the linked edition's figures follow each viewer's own permissions: UAE sees only UAE's, Poland only Poland's, neither sees the other's references; the person with both sees the current company by default and the sum under All my companies; no Sales access sees nothing", async () => {
  page = empPage;
  await go(empPage, `/sales/events/${event}?edition=${e26}`);
  eq((await figures(empPage)).text, "2,1,1,0,1", "UAE figures (total, open, closed, won, lost)");
  let t = await mainText(empPage);
  for (const r of plRefs) if (t.includes(r)) throw new Error(`the UAE person sees the Poland enquiry ${r}`);
  for (const r of ukRefs) if (!t.includes(r)) throw new Error(`the UAE drill-down lacks ${r}`);
  if (!/Enquiries linked to Fictional Expo Global · 2026 · Dubai \(2\)/.test(t)) throw new Error("the drill-down count differs from the figure");
  await empPage.screenshot({ path: `${SHOTS}/3-event-uae-view.png`, fullPage: true });
  page = polPage;
  await go(polPage, `/sales/events/${event}?edition=${e26}`);
  eq((await figures(polPage)).text, "2,1,1,1,0", "Poland figures");
  t = await mainText(polPage);
  for (const r of ukRefs) if (t.includes(r)) throw new Error(`the Poland person sees the UAE enquiry ${r}`);
  page = mgrPage;
  await go(mgrPage, `/sales/events/${event}?edition=${e26}`);
  const mgrDefault = (await figures(mgrPage)).text;
  if (mgrDefault !== "2,1,1,0,1" && mgrDefault !== "2,1,1,1,0") throw new Error(`default scope should be ONE company: ${mgrDefault}`);
  await mgrPage.locator("#ev-scope").selectOption("all");
  await mgrPage.getByRole("button", { name: "Apply" }).click();
  await mgrPage.waitForURL(/scope=all/);
  await mgrPage.getByRole("table", { name: "Editions of this event" }).waitFor();
  eq((await figures(mgrPage)).text, "4,2,2,1,1", "figures under All my companies");
  t = await mainText(mgrPage);
  for (const r of [...ukRefs, ...plRefs]) if (!t.includes(r)) throw new Error(`the all-companies drill-down lacks ${r}`);
  page = noPage;
  await go(noPage, "/sales/events");
  if (!/do not have Sales access/i.test(await mainText(noPage))) throw new Error("a person with no Sales access is not refused");
  if (/Fictional Expo Global/.test(await mainText(noPage))) throw new Error("a person with no Sales access can see an event");
});

// ------------------------------------------------------------------------------------------------------------------------------ 4
await step("an observation is recorded on a phone with no enquiry: edition, exhibitor, agency, stand and role", async () => {
  page = phone;
  const before = Number(sql("select count(*) from crm_opportunities"));
  await go(phone, `/sales/events/${event}?edition=${e26}`);
  // the page must fit the phone (a hidden table header once stretched it to 655px and zoomed the page out)
  eq(await phone.evaluate(() => window.innerWidth), 390, "the event page's width on a phone (it must not be wider than the screen)");
  await phone.getByRole("button", { name: "Record an observation" }).click();
  const dlg = phone.getByRole("dialog"); await dlg.waitFor();
  await dlg.getByLabel("Edition").selectOption(e26);
  const ex = dlg.getByRole("combobox", { name: /^Exhibitor/ });
  await ex.click(); await ex.fill("harbour");
  await dlg.getByRole("option", { name: /Fictional Harbour Client/ }).tap();
  const ag = dlg.getByRole("combobox", { name: "Agency", exact: true });
  await ag.click(); await ag.fill("agency b");
  await dlg.getByRole("option", { name: /Fictional Agency B/ }).tap();
  await dlg.getByLabel("Stand number (optional)").fill("C3");
  await dlg.getByLabel("Agency role (optional)").selectOption("stand_builder");
  await phone.screenshot({ path: `${SHOTS}/4-record-observation-phone.png` });
  await dlg.getByRole("button", { name: "Save observation" }).tap(); await dlg.waitFor({ state: "detached" });
  eq(sql(`select o.kind || '|' || a.name || '|' || o.stand_no || '|' || o.agency_role || '|' || o.verification from crm_event_observations o join crm_organisations a on a.id = o.agency_org_id where o.edition_id='${e26}' and o.exhibitor_org_id='${harbour}' and o.agency_org_id is not null`), "exhibited|Fictional Agency B|C3|stand_builder|unverified", "the recorded observation (unverified by default)");
  eq(sql("select count(*) from crm_opportunities"), before, "enquiries created by recording an observation");
  const sx = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sx > 1) throw new Error(`the event page scrolls sideways on a phone by ${sx}px`);
});
await step("the same exhibitor shows a DIFFERENT agency in two years; No observation, Did not exhibit and Agency unknown stay distinct", async () => {
  page = empPage;
  await go(empPage, `/sales/events/${event}`);
  const grid = empPage.getByRole("table", { name: "Exhibitors by edition" });
  const cellsOf = async (name) => (await grid.getByRole("row").filter({ hasText: name }).first().getByRole("cell").allInnerTexts()).map(flat);   // 2027, 2026, 2025
  const h = await cellsOf("Fictional Harbour Client");
  if (!/^No observation$/.test(h[0])) throw new Error(`2027 should read No observation: ${h[0]}`);
  if (!/Fictional Agency B/.test(h[1]) || !/Agency unknown/.test(h[1]) || !/Unverified/.test(h[1])) throw new Error(`2026 cell: ${h[1]}`);
  if (!/Fictional Agency A/.test(h[2]) || !/Confirmed/.test(h[2]) || /Fictional Agency B/.test(h[2])) throw new Error(`2025 cell: ${h[2]}`);
  const o = await cellsOf("Fictional Orbit Client");
  if (!/^No observation$/.test(o[0]) || !/^No observation$/.test(o[1])) throw new Error(`Orbit 2027 / 2026 should read No observation: ${o.join(" | ")}`);
  if (!/Did not exhibit/.test(o[2]) || /No observation/.test(o[2])) throw new Error(`Orbit 2025 should read Did not exhibit: ${o[2]}`);
  // the underlying observations open (several in one edition are NOT merged)
  await grid.getByRole("row").filter({ hasText: "Fictional Harbour Client" }).first().getByRole("cell").nth(1).locator("summary").click();
  const detail = flat(await grid.getByRole("row").filter({ hasText: "Fictional Harbour Client" }).first().getByRole("cell").nth(1).innerText());
  if (!/stand C3/.test(detail) || !/stand C4/.test(detail) || !/second stand, builder not known/.test(detail)) throw new Error(`underlying observations: ${detail}`);
  await empPage.screenshot({ path: `${SHOTS}/5-exhibitor-history.png`, fullPage: true });
});
await step("the upcoming edition lists BOTH past agencies as outreach leads (neither treated as confirmed for 2027), with priority and a path to the account's outreach and follow-ups", async () => {
  page = empPage;
  await go(empPage, `/sales/events/${event}`);   // defaults to the next upcoming edition (2027)
  const section = empPage.getByRole("list", { name: "Past agencies" });
  await section.waitFor();
  const t = flat(await section.innerText());
  for (const name of ["Fictional Agency A", "Fictional Agency B"]) if (!t.includes(name)) throw new Error(`lead missing: ${name}`);
  if (/Agency unknown/.test(t)) throw new Error("an unknown agency is listed as a lead");
  if (!/2025: for Fictional Harbour Client, stand B12/.test(t) || !/2026: for Fictional Harbour Client, stand C3/.test(t)) throw new Error(`sightings: ${t}`);
  const head = flat(await empPage.getByRole("heading", { name: /Agencies to contact for/ }).innerText());
  if (!/2027/.test(head)) throw new Error(`leads are not for the upcoming edition: ${head}`);
  const link = section.getByRole("link", { name: /Open account · outreach/ }).first();
  const href = await link.getAttribute("href");
  if (!/\/sales\/accounts\/[0-9a-f-]{36}.*#outreach$/.test(href ?? "")) throw new Error(`no path to the account's outreach: ${href}`);
  // priority is set right here and is the same shared value
  await section.getByLabel("Outreach priority for Fictional Agency A").selectOption("5");
  await empPage.getByText("Priority set to 5 of 5").first().waitFor();
  eq(sql(`select outreach_priority from crm_organisations where id = '${agencyA}'`), 5, "priority set from the lead list");
  await go(empPage, `/sales/events/${event}`);
  const ordered = (await empPage.getByRole("list", { name: "Past agencies" }).getByRole("listitem").filter({ hasText: /^Fictional Agency/ }).allInnerTexts()).map(flat);
  if (!/^Fictional Agency A/.test(ordered[0] ?? "")) throw new Error(`the highest priority should lead the list: ${ordered.join(" | ")}`);
  await empPage.screenshot({ path: `${SHOTS}/6-leads-2027.png`, fullPage: true });
  await go(empPage, `/sales/events/${event}?edition=${e26}`);
  const t26 = flat(await empPage.getByRole("list", { name: "Past agencies" }).innerText());
  if (!/Fictional Agency A/.test(t26) || /Fictional Agency B/.test(t26)) throw new Error(`2026 leads should be only the 2025 agency: ${t26}`);
});

for (const p of [empPage, polPage, mgrPage, noPage, phone]) await p.context().close();
await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
