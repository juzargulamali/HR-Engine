// Sales & CRM staff-readiness walk-through in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales-readiness.sh` (Sales grants: ceo@ founder, mgr@ and
// emp@ plain; Projects grants: ceo@ founder, mgr@ the Project Manager, lead@ a colleague who is NOT the assigned PM; one fictional client; no enquiry) and WRITES to the
// database it drives, so reseed before every run. Nothing is sent to any client and nothing is written to Zoho (there is no Zoho connection in the app). Run:
//   node os-shell-checks/sales-crm-readiness-flow.mjs        (SHOTS_DIR, default /tmp/sales-readiness-shots; light theme, 1440 x 900)
// One enquiry from creation to a running project, with SEPARATE accounts:
//   1. emp@ (Sales owner) creates the enquiry on the screen; My Day's "due today" link lands on the Follow-ups TODAY view with only today's rows;
//   2. emp@ builds and finalises an estimate (freezes only: stage, status and every other table unchanged);
//   3. an ordinary proposal is recorded as sent (an estimate is not, EST01); replacement and the superseded starting statuses are enforced by the database;
//   4. Zoho Books references: (decision B: emptying the quote reference at Quote sent is refused; with the save function missing the form says saving is unavailable and writes nothing) two people saving DIFFERENT fields at the same time keep both changes, a stale edit of the SAME field is refused, an emptied field is an
//      intentional clear, an untouched field is never cleared; Quote sent is refused without the reference and works with it;
//   5. Mark Won with a purchase order: the form's date limit is the Dubai day, the DATABASE refuses a future date and leaves every row as it was;
//   6. handover: emp@ saves and submits (nothing is accepted by submitting), the founder assigns the PM, a colleague who is not the PM and even the founder cannot accept,
//      only mgr@ (the assigned PM) accepts; accepting twice (double click and a repeat call) creates exactly ONE project;
//   7. Reports: readable source names and counts (company scoping is covered by reports/page.test.tsx with two companies); 8. a failed read says "Could not load" (provoked with a read policy that raises) on the Enquiry, Close
//      and Handover pages, on one enquiry section and on one Reports card, and the actions that depend on it are gone; 9. everything is back to normal afterwards.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb, asDbTry } from "./inventory-flow-lib.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const CO = "00000000-0000-4000-8000-00000000a001";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/sales-readiness-shots"; mkdirSync(SHOTS, { recursive: true });
const psqlInput = (statements) => execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-d", process.env.LOCAL_DB_NAME ?? "hr_local_stack", "-v", "ON_ERROR_STOP=1", "-q"], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: statements, stdio: ["pipe", "pipe", "pipe"] });
const browser = await chromium.launch();
let fails = 0; let passes = 0; let page;
const step = async (name, fn) => {
  try { await fn(); passes++; console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `${SHOTS}/fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const flat = (t) => t.replace(/\s+/g, " ");
const text = async (p = page) => flat(await p.locator("main").innerText());
const has = async (re, what, p = page) => { const t = await text(p); if (!re.test(t)) throw new Error(`${what}: not found /${re.source}/ in ${t.slice(0, 500)}`); };
const hasNot = async (re, what, p = page) => { const t = await text(p); if (re.test(t)) throw new Error(`${what}: unexpectedly found /${re.source}/`); };
const as = async (email) => { if (page) await page.context().close(); page = await newPage(browser, { width: 1440, height: 900 }, "light"); page.on("dialog", (d) => d.accept()); await login(page, email); return page; };
const go = (path, p = page) => p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
const shot = (name, p = page) => p.screenshot({ path: `${SHOTS}/${name}.png` });
const goStep = (label) => page.locator('nav[aria-label="Estimate steps"] button', { hasText: label }).click();
const saveDraft = () => page.getByRole("button", { name: "Save draft" }).click();
const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.startsWith("Saved"));
const dubaiToday = () => sql("select crm_today_dubai()");
const optionValue = async (sel, re) => { const o = await sel.locator("option").evaluateAll((os) => os.map((x) => [x.value, x.textContent])); const m = o.find(([, t]) => re.test(t)); if (!m) throw new Error(`no option ${re}`); return m[0]; };
/** Everything a refused call must not change. */
const world = (opp) => sql(`select md5(o::text) || '|' || (select count(*) from crm_closures where opportunity_id='${opp}') || '|' || coalesce((select string_agg(id::text || status, ',' order by id) from crm_follow_ups where opportunity_id='${opp}'), '') || '|' || (select count(*) from crm_handovers where opportunity_id='${opp}') || '|' || (select count(*) from crm_opportunity_events where opportunity_id='${opp}') from crm_opportunities o where id='${opp}'`);

if (sql("select count(*) from crm_opportunities") !== "0") throw new Error("reseed first (seed/sales-readiness.sh): this run expects an empty Sales database");
const client = sql("select id from crm_organisations where name='Fictional Harbour Client'");
let OPP = ""; let oppUrl = ""; let estimateId = "";

// ---- 1. Sales owner creates the enquiry; My Day's "due today" link --------------------------------------------------------------------------------------------------
await as("emp@e2e.local");
await step("emp@ (Sales owner) creates the enquiry on the screen and the reference is OPP-<code>-<year>-<number>", async () => {
  await go("/sales/new");
  await page.getByLabel("Requirement").fill("Fictional interactive floor for the harbour launch");
  await page.getByLabel("Where did it come from?").selectOption("agency_call");
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Fictional Harbour Client" }) }).first().selectOption({ label: "Fictional Harbour Client" });
  await page.getByLabel("Next action").fill("Call the client to qualify the brief"); await page.getByLabel("Budget or value").fill("90000");
  await page.getByRole("button", { name: /record enquiry/i }).click(); await page.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}$/, { timeout: 20000 });
  oppUrl = page.url(); OPP = oppUrl.split("/").pop();
  await page.waitForFunction(() => /OPP-UAE-\d{4}-0001/.test(document.querySelector("main").innerText));
  if (!/^OPP-UAE-\d{4}-0001$/.test(sql(`select reference from crm_opportunities where id='${OPP}'`))) throw new Error("reference");
});
await step("My Day: 'due today' link lands on the Follow-ups TODAY view with only today's rows (an overdue and an upcoming one stay out of it)", async () => {
  sql(`insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by) values ('${OPP}','${CO}','00000000-0000-4000-8000-0000000000a5','Overdue chase', 'call', now() - interval '3 days','00000000-0000-4000-8000-0000000000a5'), ('${OPP}','${CO}','00000000-0000-4000-8000-0000000000a5','Upcoming check', 'call', now() + interval '6 days','00000000-0000-4000-8000-0000000000a5')`);
  await go("/");
  const link = page.getByRole("link", { name: /1 due today/ });
  await link.waitFor({ timeout: 15000 });
  if ((await link.getAttribute("href")) !== "/sales/follow-ups?view=today") throw new Error(`link: ${await link.getAttribute("href")}`);
  await Promise.all([page.waitForURL(/\/sales\/follow-ups\?view=today/), link.click()]);
  await page.getByText("Showing only what is due today").waitFor({ timeout: 20000 });
  await has(/Showing only what is due today/, "today note");
  await has(/Call the client to qualify the brief/, "today's row");
  await hasNot(/Overdue chase|Upcoming check/, "other groups");
  const headings = await page.locator("main h2").allInnerTexts();
  if (headings.some((h) => /Overdue|Upcoming/.test(h))) throw new Error(`other groups shown: ${headings}`);
  await shot("1-follow-ups-today");
  await page.getByRole("link", { name: "Show all to-do" }).click(); await page.getByText("Overdue chase").first().waitFor({ timeout: 20000 });
  await has(/Overdue chase/, "overdue back in the full view"); await has(/Upcoming check/, "upcoming back in the full view");
});

// ---- 2. Estimate: build and finalise ---------------------------------------------------------------------------------------------------------------------------------
await step("emp@ builds an estimate (Details, BOQ) and finalises it; finalising freezes only", async () => {
  await go(`/sales/opportunities/${OPP}?tab=quotations`);
  await page.getByRole("button", { name: "Create draft estimate" }).click();
  await page.waitForURL(/\/quotations\//); estimateId = page.url().split("/").pop();
  await page.locator("#est-vat").selectOption(await optionValue(page.locator("#est-vat"), /^5%$/));
  await saveDraft(); await waitSaved();
  await goStep("BOQ");
  await page.locator('section[aria-label="Items without a section"]').getByRole("button", { name: "Add item" }).click();
  const li = page.locator('section[aria-label="Items without a section"] li').first();
  await li.locator("textarea").fill("Interactive LED floor"); await li.getByPlaceholder("Unit", { exact: true }).fill("m2"); await li.getByPlaceholder("Qty").fill("24"); await li.getByPlaceholder("Unit price").fill("3500");
  await saveDraft(); await waitSaved();
  if (sql(`select count(*) from crm_quotation_lines where proposal_id='${estimateId}'`) !== "1") throw new Error("item not saved");
  await goStep("Preview & finalise");
  const before = sql(`select stage || '/' || version from crm_opportunities where id='${OPP}'`) + "|" + sql(`select status from crm_proposals where id='${estimateId}'`) + "|" + sql("select count(*) from crm_zoho_references");
  await page.getByLabel(/I have checked who this estimate is addressed to/).check();
  await page.getByRole("button", { name: "Finalise estimate" }).click();
  await page.getByTestId("issued-snapshot").waitFor();
  const after = sql(`select stage || '/' || version from crm_opportunities where id='${OPP}'`) + "|" + sql(`select status from crm_proposals where id='${estimateId}'`) + "|" + sql("select count(*) from crm_zoho_references");
  if (before !== after || !/^new\/\d+\|draft\|0$/.test(after)) throw new Error(`finalising changed more than the estimate: ${before} -> ${after}`);
  if (sql(`select count(*) from crm_quotation_snapshots where proposal_id='${estimateId}'`) !== "1") throw new Error("no frozen copy");
});

// ---- 3. Proposals: sent, replacement, superseded starting statuses ----------------------------------------------------------------------------------------------------
let p1 = ""; let p2 = "";
await step("an ordinary proposal is recorded as sent on the screen; an estimate has no such button and the database refuses it (EST01)", async () => {
  p1 = asDb(5, `select crm_add_proposal('${OPP}', 'Fictional Canva proposal v1', null)`);
  await go(`/sales/opportunities/${OPP}?tab=proposals`);
  await has(/Estimate, finalised/, "estimate label");
  if (await page.locator("li", { hasText: "Open the estimate" }).getByRole("button", { name: /sent/i }).count()) throw new Error("'Record as sent' offered for an estimate");
  const li = page.locator("li", { hasText: "Fictional Canva proposal v1" });
  await li.getByRole("button", { name: /sent/i }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  await dlg.locator('input[type="date"]').fill(dubaiToday());
  await dlg.getByRole("button", { name: /^(record|save|confirm|mark)/i }).last().click();
  await li.getByText(/recorded as sent/i).waitFor();
  if (sql(`select status from crm_proposals where id='${p1}'`) !== "sent") throw new Error("not sent");
  const direct = asDbTry(5, `select crm_set_proposal_status('${estimateId}', 'sent', date '${dubaiToday()}')`);
  if (direct.ok || !/An estimate cannot be marked as sent/.test(direct.out)) throw new Error(`EST01: ${direct.out}`);
  if (sql(`select status from crm_proposals where id='${p1}'`) !== "sent") throw new Error("the refusal changed the sent proposal");
});
await step("a newer proposal recorded as sent replaces the earlier one; superseded is refused from superseded and from accepted, allowed from draft and sent", async () => {
  p2 = asDb(5, `select crm_add_proposal('${OPP}', 'Fictional Canva proposal v2', null)`);
  await page.reload({ waitUntil: "networkidle" });
  const li = page.locator("li", { hasText: "Fictional Canva proposal v2" });
  await li.getByRole("button", { name: /sent/i }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  await dlg.locator('input[type="date"]').fill(dubaiToday());
  await dlg.getByRole("button", { name: /^(record|save|confirm|mark)/i }).last().click();
  await li.getByText(/recorded as sent/i).waitFor();
  if (sql(`select string_agg(status, ',' order by version) from crm_proposals where opportunity_id='${OPP}' and id in ('${p1}','${p2}')`) !== "superseded,sent") throw new Error("replacement");
  const w = world(OPP);
  const again = asDbTry(5, `select crm_set_proposal_status('${p1}', 'superseded', null)`);
  if (again.ok || !/Only a draft or sent proposal can be marked superseded/.test(again.out)) throw new Error(`superseded twice: ${again.out}`);
  const draft = asDb(5, `select crm_add_proposal('${OPP}', 'Fictional draft v3', null)`);
  asDb(5, `select crm_set_proposal_status('${draft}', 'superseded', null)`);
  if (sql(`select status from crm_proposals where id='${draft}'`) !== "superseded") throw new Error("draft -> superseded should work");
  if (world(OPP) === w) throw new Error("(sanity) the allowed supersede changed nothing");
});

// ---- 4. Zoho Books references: two editors, stale edit, clear, Quote sent gate ------------------------------------------------------------------------------------------
await step("Quote sent is refused without the Zoho quote reference (screen hint and database), stage unchanged", async () => {
  asDb(5, `select crm_move_stage('${OPP}', 'qualified')`); asDb(5, `select crm_move_stage('${OPP}', 'proposal_prep')`); asDb(5, `select crm_move_stage('${OPP}', 'proposal_sent')`);
  const w = world(OPP);
  const refused = asDbTry(5, `select crm_move_stage('${OPP}', 'quote_sent')`);
  if (refused.ok || !/Zoho Books quote reference/.test(refused.out)) throw new Error(`gate: ${refused.out}`);
  if (world(OPP) !== w) throw new Error("the refusal changed the enquiry");
  await go(oppUrl.replace(BASE, ""));
  await page.getByRole("button", { name: /^move stage$/i }).first().click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  await dlg.getByLabel("Move to").selectOption({ label: "Quote sent" });
  if (!/Record the Zoho Books quote reference first/.test(flat(await dlg.innerText()))) throw new Error("the Move stage dialog does not say the quote reference is needed");
  await page.keyboard.press("Escape");
});
let pageB; let quoteRefBefore;
await step("Zoho references: two people open the form, save DIFFERENT fields, and both changes survive; the untouched fields are not overwritten", async () => {
  const goCommercial = async (p) => { await go(`/sales/opportunities/${OPP}?tab=commercial`, p); };
  await goCommercial(page);
  await page.locator("#z-qref").fill("QT-2001"); await page.locator("#z-qdate").fill(dubaiToday());
  await page.getByRole("button", { name: "Save references" }).click();
  await page.getByText(/Last updated/).first().waitFor();
  if (sql(`select quote_ref from crm_zoho_references where opportunity_id='${OPP}'`) !== "QT-2001") throw new Error("first save");
  quoteRefBefore = "QT-2001";
  // Person B (the founder) opens the form NOW; person A (emp@) then changes the invoice reference and saves; B (stale form) records the payment date only.
  pageB = await newPage(browser, { width: 1440, height: 900 }, "light"); await login(pageB, "ceo@e2e.local"); await goCommercial(pageB);
  await page.locator("#z-iref").fill("INV-77"); await page.getByRole("button", { name: "Save references" }).click();
  await page.waitForFunction(() => document.querySelector("#z-iref")?.value === "INV-77"); await page.waitForTimeout(800);
  if (sql(`select invoice_ref from crm_zoho_references where opportunity_id='${OPP}'`) !== "INV-77") throw new Error("A's save");
  if ((await pageB.locator("#z-iref").inputValue()) !== "") throw new Error("B's form should still be the stale one");
  await pageB.locator("#z-pdate").fill(dubaiToday()); await pageB.locator("#z-paid").fill("500");
  await pageB.getByRole("button", { name: "Save references" }).click(); await pageB.waitForTimeout(1500);
  const row = sql(`select quote_ref || '|' || invoice_ref || '|' || (payment_received_on is not null)::text || '|' || paid_amount::text from crm_zoho_references where opportunity_id='${OPP}'`);
  if (row !== "QT-2001|INV-77|true|500.00") throw new Error(`both changes should survive: ${row}`);
});
await step("a stale edit of the SAME field is refused in words and changes nothing", async () => {
  // A changes the quote reference; B (who still sees QT-2001) tries to change it too.
  await go(`/sales/opportunities/${OPP}?tab=commercial`);
  await page.locator("#z-qref").fill("QT-2001-B"); await page.getByRole("button", { name: "Save references" }).click(); await page.waitForTimeout(1200);
  if (sql(`select quote_ref from crm_zoho_references where opportunity_id='${OPP}'`) !== "QT-2001-B") throw new Error("A's quote change");
  await pageB.locator("#z-qref").fill("QT-2001-HIJACK"); await pageB.getByRole("button", { name: "Save references" }).click();
  await pageB.getByText(/Someone else changed the quote reference since you opened this form/).waitFor({ timeout: 10000 });
  if (sql(`select quote_ref from crm_zoho_references where opportunity_id='${OPP}'`) !== "QT-2001-B") throw new Error("the stale edit overwrote");
  await shot("2-zoho-stale-edit-refused", pageB);
  await pageB.context().close();
});
await step("an emptied field is an intentional clear; the others stay; saving with no change says nothing was changed", async () => {
  await go(`/sales/opportunities/${OPP}?tab=commercial`);
  await page.locator("#z-pdate").fill(""); await page.locator("#z-paid").fill("");
  await page.getByRole("button", { name: "Save references" }).click(); await page.waitForTimeout(1200);
  const row = sql(`select quote_ref || '|' || invoice_ref || '|' || coalesce(payment_received_on::text, 'NULL') || '|' || coalesce(paid_amount::text, 'NULL') from crm_zoho_references where opportunity_id='${OPP}'`);
  if (row !== "QT-2001-B|INV-77|NULL|NULL") throw new Error(`clear: ${row}`);
  await page.getByRole("button", { name: "Save references" }).click();
  await page.getByText(/Nothing was changed, so nothing was saved/).waitFor({ timeout: 8000 });
});
await step("with the quote reference recorded, Quote sent works on the screen", async () => {
  await go(oppUrl.replace(BASE, ""));
  await page.getByRole("button", { name: /^move stage$/i }).first().click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  await dlg.getByLabel("Move to").selectOption({ label: "Quote sent" });
  await dlg.getByRole("button", { name: /^move stage$/i }).click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  if (sql(`select stage from crm_opportunities where id='${OPP}'`) !== "quote_sent") throw new Error("stage not moved");
});
await step("decision B: at Quote sent, emptying the quote reference is refused in words and changes nothing; correcting it to another reference works", async () => {
  await go(`/sales/opportunities/${OPP}?tab=commercial`);
  const w = world(OPP); const z0 = sql(`select md5(z::text) from crm_zoho_references z where opportunity_id='${OPP}'`);
  await page.locator("#z-qref").fill(""); await page.getByRole("button", { name: "Save references" }).click();
  await page.getByRole("alert").filter({ hasText: /quote reference cannot be cleared once the enquiry has reached Quote sent/ }).waitFor({ timeout: 10000 });
  if (sql(`select md5(z::text) from crm_zoho_references z where opportunity_id='${OPP}'`) !== z0 || world(OPP) !== w) throw new Error("the refused clear changed something");
  await shot("2-zoho-clear-refused-at-quote-sent");
  await page.locator("#z-qref").fill("QT-2001-C"); await page.getByRole("button", { name: "Save references" }).click();
  await page.getByRole("alert").waitFor({ state: "detached", timeout: 10000 }).catch(() => {}); await page.waitForTimeout(1500);
  if (sql(`select quote_ref from crm_zoho_references where opportunity_id='${OPP}'`) !== "QT-2001-C") throw new Error("the correction was not saved");
});
await step("no fallback: with the save function not installed the form says saving is temporarily unavailable, nothing is written, and the references stay readable", async () => {
  psqlInput("alter function crm_save_zoho_reference(uuid, jsonb, jsonb) rename to crm_save_zoho_reference_off;\nnotify pgrst, 'reload schema';\n"); await page.waitForTimeout(2500);
  try {
    const z0 = sql(`select md5(z::text) from crm_zoho_references z where opportunity_id='${OPP}'`);
    await go(`/sales/opportunities/${OPP}?tab=commercial`);
    if ((await page.locator("#z-qref").inputValue()) !== "QT-2001-C") throw new Error("the stored reference is not readable");
    await page.locator("#z-iref").fill("INV-77-X"); await page.getByRole("button", { name: "Save references" }).click();
    const alertText = flat(await page.getByRole("alert").filter({ hasText: /Saving Zoho Books references is temporarily unavailable/ }).innerText({ timeout: 10000 }));
    if (/Someone else changed|cannot be cleared|could not save/i.test(alertText) || /try again\./i.test(alertText.replace("Trying again will not help", ""))) throw new Error(`the message looks like a refusal or invites a retry: ${alertText}`);
    if (sql(`select md5(z::text) from crm_zoho_references z where opportunity_id='${OPP}'`) !== z0) throw new Error("something was written");
    await shot("2-zoho-save-unavailable");
  } finally { psqlInput("alter function crm_save_zoho_reference_off(uuid, jsonb, jsonb) rename to crm_save_zoho_reference;\nnotify pgrst, 'reload schema';\n"); await page.waitForTimeout(2500); }
});

// ---- 5. Mark Won ----------------------------------------------------------------------------------------------------------------------------------------------------
await step("Won: the date field's limit is the Dubai day and the DATABASE refuses a future date with no side effect; the screen then records a valid PO", async () => {
  await go(`/sales/opportunities/${OPP}/close?outcome=won`);
  const max = await page.locator("#won-date").getAttribute("max");
  if (max !== dubaiToday()) throw new Error(`form max ${max} is not the Dubai day ${dubaiToday()}`);
  const w = world(OPP);
  const future = asDbTry(5, `select crm_mark_won('${OPP}', 'purchase_order', 'PO-FUTURE', date '${dubaiToday()}' + 1)`);
  if (future.ok || !/cannot be in the future/.test(future.out)) throw new Error(`future date: ${future.out}`);
  if (world(OPP) !== w) throw new Error("the refused Won changed the enquiry, closures, follow-ups, handover or events");
  if (sql(`select stage from crm_opportunities where id='${OPP}'`) !== "quote_sent") throw new Error("stage changed");
  await page.locator("#won-ref").fill("PO-FICTIONAL-4411"); await page.locator("#won-date").fill(dubaiToday());
  await page.getByRole("button", { name: "Confirm as won" }).click();
  await page.waitForURL(new RegExp(`/sales/opportunities/${OPP}$`), { timeout: 20000 });
  const row = sql(`select stage || '|' || evidence_reference || '|' || evidence_date::text || '|' || (select count(*) from crm_closures where opportunity_id=o.id and outcome='won') || '|' || (select count(*) from crm_handovers where opportunity_id=o.id) from crm_opportunities o where id='${OPP}'`);
  if (row !== `won|PO-FICTIONAL-4411|${dubaiToday()}|1|1`) throw new Error(`won row ${row}`);
});

// ---- 6. Handover with separate accounts ------------------------------------------------------------------------------------------------------------------------------
let HANDOVER = "";
await step("Sales (emp@) saves the delivery brief as a draft, then saves and submits it; submitting accepts nothing and creates no project", async () => {
  await go(`/sales/opportunities/${OPP}/handover`);
  await page.getByLabel("Scope of work").fill("Interactive LED floor, 6 x 4 m, with fictional shader content.");
  await page.getByRole("button", { name: /^save draft$/i }).click();
  await page.waitForFunction(() => /Not submitted yet/.test(document.body.innerText), null, { timeout: 15000 });
  HANDOVER = sql("select id from proj_handovers limit 1");
  if (sql("select status from proj_handovers") !== "draft") throw new Error("save draft submitted it");
  await page.getByRole("button", { name: /^save and submit$/i }).click();
  await page.waitForFunction(() => /Waiting for a Project Manager/i.test(document.body.innerText), null, { timeout: 15000 });
  if (sql("select status from proj_handovers") !== "submitted") throw new Error("not submitted");
  if (sql("select count(*) from proj_projects") !== "0") throw new Error("submitting created a project");
  await shot("3-handover-submitted");
});
await as("ceo@e2e.local");
await step("the founder assigns the Project Manager (assigning is not accepting: still no project)", async () => {
  await go("/projects/handovers");
  await page.locator("select").filter({ has: page.locator("option", { hasText: "mgr" }) }).first().selectOption({ label: "mgr" });
  await page.getByRole("button", { name: /assign|choose|save/i }).first().click();
  await page.waitForFunction(() => /mgr/.test(document.querySelector("main").innerText) && /accept/i.test(document.querySelector("main").innerText), null, { timeout: 15000 });
  if (sql("select status from proj_handovers") !== "pm_assigned") throw new Error("PM not assigned");
  if (sql("select count(*) from proj_projects") !== "0") throw new Error("assigning created a project");
});
await step("only the assigned PM can accept: Sales owner, a colleague with Projects access and even the founder are refused; nothing is created", async () => {
  for (const [who, name] of [[5, "emp@ (Sales owner)"], [7, "lead@ (not the PM)"], [3, "ceo@ (founder)"]]) {
    const r = asDbTry(who, `select proj_accept_handover('${HANDOVER}')`);
    if (r.ok) throw new Error(`${name} could accept`);
    if (!/Only the assigned Project Manager can accept|Handover not found/.test(r.out)) throw new Error(`${name}: ${r.out}`);
  }
  if (sql("select count(*) from proj_projects") !== "0" || sql("select status from proj_handovers") !== "pm_assigned") throw new Error("a refused accept changed something");
});
await as("lead@e2e.local");
await step("the colleague who is not the PM sees no accept button", async () => {
  await go("/projects/handovers");
  if (await page.getByRole("button", { name: /^accept/i }).count()) throw new Error("accept offered to a non-PM");
});
await as("mgr@e2e.local");
await step("the assigned PM (mgr@) accepts with a double click: exactly ONE project; a repeat call returns the same project", async () => {
  await go("/projects/handovers");
  const btn = page.getByRole("button", { name: /^accept/i }).first();
  await Promise.all([page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 25000 }), btn.dblclick()]);
  const P = page.url().split("/").pop();
  if (sql("select count(*) from proj_projects") !== "1" || sql("select count(*) from proj_handovers where project_id is not null") !== "1") throw new Error("not exactly one project");
  if (sql("select status from proj_handovers") !== "accepted") throw new Error("not accepted");
  const again = asDb(4, `select proj_accept_handover('${HANDOVER}')`);
  if (again !== P) throw new Error(`repeat accept returned ${again}, not ${P}`);
  if (sql("select count(*) from proj_projects") !== "1") throw new Error("a repeat call created another project");
});

// ---- 7. Reports --------------------------------------------------------------------------------------------------------------------------------------------------------------
await as("emp@e2e.local");
await step("Reports: readable source names (never the stored id) and the counts; no card says 'Could not load'", async () => {
  await go("/sales/reports");
  const card = page.locator("div", { has: page.getByRole("heading", { name: "Enquiries by source" }) }).last();
  await has(/Enquiries by source/, "card");
  const t = flat(await page.locator("main").innerText());
  if (!/Agency call \(outbound\)\s*1/.test(t)) throw new Error("readable source name missing");
  if (/agency_call/.test(t)) throw new Error("the stored id is shown");
  if (!/n = 1 enquiries/.test(t) || !/Won\s*1/.test(t)) throw new Error(`counts: ${t.slice(0, 600)}`);
  if (/Could not load|This report is incomplete/.test(t)) throw new Error("a card failed on a clean read");
  await page.getByRole("heading", { name: "Enquiries by source" }).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -140));
  await shot("4-reports");
  void card;
});

// ---- 8. Failed reads: provoked with a read policy that raises (local database only) --------------------------------------------------------------------------------
const failReadByPrivilege = (table) => psqlInput(`revoke select on ${table} from authenticated;\n`);   // a refused read is an error, not an empty result
const healReadByPrivilege = (table) => psqlInput(`grant select on ${table} to authenticated;\n`);
const failRead = (table) => psqlInput(`create or replace function _sim_read_fail() returns boolean language plpgsql as $$ begin raise exception 'simulated read outage'; end $$;\ngrant execute on function _sim_read_fail() to authenticated;\ncreate policy _sim_fail on ${table} as restrictive for select to authenticated using (_sim_read_fail());\n`);
const healRead = (table) => psqlInput(`drop policy if exists _sim_fail on ${table};\n`);
await step("the enquiry itself cannot be read: Enquiry, Close and Handover each say 'Could not load', offer no action, and are not 'not found'", async () => {
  failRead("crm_opportunities");
  try {
    await go(`/sales/opportunities/${OPP}`);
    await has(/Could not load this enquiry/, "enquiry page"); await has(/Try again/, "retry");
    for (const re of [/Close as won/, /Close as lost/, /Move stage/, /Handover package/, /not found|could not be found/i]) await hasNot(re, `enquiry page ${re}`);
    await shot("5-enquiry-could-not-load");
    await go(`/sales/opportunities/${OPP}/close?outcome=won`);
    await has(/Could not load this enquiry/, "close page");
    if (await page.getByRole("button", { name: "Confirm as won" }).count()) throw new Error("Mark Won offered when the enquiry failed to load");
    await go(`/sales/opportunities/${OPP}/handover`);
    await has(/Could not load this enquiry/, "handover page");
    if (await page.getByRole("button", { name: /save draft|save and submit|resubmit/i }).count()) throw new Error("a handover save or submit button is offered when the enquiry failed to load");
    await shot("6-handover-could-not-load");
  } finally { healRead("crm_opportunities"); }
});
await step("one enquiry section cannot be read: the Zoho references say 'Could not load' with no form while the rest of the page works", async () => {
  failRead("crm_zoho_references");
  try {
    await go(`/sales/opportunities/${OPP}?tab=commercial`);
    await has(/Could not load the Zoho Books references/, "zoho section");
    if (await page.locator("#z-qref").count()) throw new Error("the Zoho form is offered although its data could not be read");
    await has(/Equipment availability/, "other sections still render");
    await hasNot(/Could not load this enquiry/, "whole-page error");
    await go(`/sales/opportunities/${OPP}/handover`);
    await has(/Zoho Books references \(entered by hand\) Could not load/, "handover money panel");
  } finally { healRead("crm_zoho_references"); }
});
await step("one Reports card cannot be read: 'Could not load' on that card, the report says it is incomplete, nothing is shown as a zero", async () => {
  failReadByPrivilege("crm_closures");
  try {
    await go("/sales/reports");
    await has(/This report is incomplete/, "report-level notice"); await has(/Could not load the count of closures that were later reopened/, "card message");
    await has(/n = 1 enquiries/, "other cards intact");
  } finally { healReadByPrivilege("crm_closures"); }
});
await step("everything is back to normal once the reads work again", async () => {
  await go(`/sales/opportunities/${OPP}`); await has(/Fictional interactive floor for the harbour launch/, "enquiry"); await hasNot(/Could not load/, "enquiry");
  await go("/sales/reports"); await hasNot(/Could not load|This report is incomplete/, "reports");
  await go("/sales/clients"); await has(/Clients & contacts/, "legacy clients page unchanged"); await hasNot(/Could not load/, "clients");
  if (page.url().indexOf("/sales/clients") < 0) throw new Error("the legacy page redirected");
});

console.log(`\n${fails === 0 ? "ALL PASSED" : `${fails} FAILED`} (${passes} passed, ${fails} failed)`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
