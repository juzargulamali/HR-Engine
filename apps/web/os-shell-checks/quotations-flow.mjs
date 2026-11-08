// Estimates (estimates-only change) in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (grants: ceo@ founder, mgr@ and emp@ plain,
// admin@ none; UAE settings) and writes to the database it drives, so reseed before every run. Run: `node os-shell-checks/quotations-flow.mjs`.
//   1. emp@ (the enquiry owner) starts a draft estimate; Details -> BOQ -> Preview & finalise; the recipient is suggested only when exactly one party is linked,
//      forced when both are; the currency is prefilled; the first item is typed with no section; sections are optional; totals are live; one Save draft button says
//      Saved only when everything saved and says it could not save (and never claims saved) when a write fails;
//   2. a company that requires approval: finalising is blocked until the version is approved, a stale approval screen cannot approve;
//   3. FINALISING ONLY FREEZES: the proposal status stays as it was, the enquiry stage is unchanged, and no follow-up, reminder, booking, reservation, Zoho
//      reference or other row appears; the existing "record as sent" path still works for an ordinary proposal and is not offered for an estimate;
//   4. the client files say Estimate (notice on page one, no terms, no acceptance wording, no internal notes); a draft download is marked Draft;
//   4b. ISSUER BRANDING: the System Administrator enters the issuer details of the fictional company on Admin -> Companies; the finalised files carry the header
//      (legal name, address lines, "TRN: ...") and, on every page, the "Sales enquiries: phone · email · website" footer with the website as a link; editing the
//      profile afterwards leaves the finalised revision's files unchanged while a NEW revision picks the new profile up. (The local stack has no object storage,
//      so the logo itself is covered by the unit tests, not here.)
//   5. a quotation frozen BEFORE the change (created through the unchanged database functions, exactly as the old app did) still shows and exports with its
//      original wording, its snapshot is byte-identical after everything else ran, and its revision becomes an estimate.
// Screenshots (light theme, 1440 x 900): SHOTS_DIR (default /tmp/q-shots).
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb, asDbTry } from "./inventory-flow-lib.mjs";
import { execFileSync, spawnSync } from "node:child_process";
const psqlInput = (statements) => execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-d", process.env.LOCAL_DB_NAME ?? "hr_local_stack", "-v", "ON_ERROR_STOP=1", "-q"], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: statements });
import { mkdirSync } from "node:fs";
import ExcelJS from "exceljs";

const CO = "00000000-0000-4000-8000-00000000a001";
const NOTICE = "This is a budgetary estimate for planning purposes only. It is not a quotation or an offer, does not reserve any equipment, stock or dates, and is not an agreement to supply. Prices and availability are subject to review and written confirmation.";
const SECRET = "INTERNAL-ONLY-MARGIN-NOTE-91c2";
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/q-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const flat = (t) => t.replace(/\s+/g, " ");
const text = async () => flat(await page.locator("main").innerText());
const has = async (re, what) => { const t = await text(); if (!re.test(t)) throw new Error(`${what}: not found /${re.source}/ in ${t.slice(0, 400)}`); };
const hasNot = async (re, what) => { const t = (await text()).replace(NOTICE, ""); if (re.test(t)) throw new Error(`${what}: unexpectedly found /${re.source}/`); };   // the mandatory notice itself says "not a quotation"
const optionValue = async (sel, re) => { const o = await sel.locator("option").evaluateAll((os) => os.map((x) => [x.value, x.textContent])); const m = o.find(([, t]) => re.test(t)); if (!m) throw new Error(`no option ${re}`); return m[0]; };
page = await newPage(browser, { width: 1440, height: 900 }, "light", { deviceScaleFactor: 2 }); page.on("dialog", (d) => d.accept());
const OUT = "/tmp/q-out"; mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/q-shots"; mkdirSync(SHOTS, { recursive: true });
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const download = async (name) => { const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name }).first().click()]); const f = `${OUT}/${d.suggestedFilename()}`; await d.saveAs(f); return { file: f, name: d.suggestedFilename() }; };
const pdfText = (f) => spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }).stdout;
const pdfRaw = (f) => spawnSync("pdftotext", ["-raw", f, "-"], { encoding: "utf8" }).stdout;
const cells = async (f) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ws = wb.worksheets[0]; const out = []; ws.eachRow((r) => r.eachCell((c) => { if (c.type !== ExcelJS.ValueType.Merge) out.push(typeof c.value === "object" && c.value && "richText" in c.value ? c.value.richText.map((t) => t.text).join("") : typeof c.value === "object" && c.value && "hyperlink" in c.value ? c.value.text : String(c.value ?? "")); })); return { name: ws.name, all: out.join("\n"), images: ws.getImages().length, ws }; };
const goStep = (label) => page.locator('nav[aria-label="Estimate steps"] button', { hasText: label }).click();
const saveDraft = async () => { await page.getByRole("button", { name: "Save draft" }).click(); };
const saveState = () => page.getByTestId("save-state");
const waitSaved = async () => { await page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.startsWith("Saved")); };

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");
sql(`update companies set legal_name='Fictional Enginious UAE LLC', trn='100000000000003', address='Fictional Tower, Dubai' where id='${CO}'`);
const org = (name, roles, extra = "") => asDb(5, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '${roles}', p_country_code => 'AE'${extra})`);
const agency = org("Fictional Aurora Agency", "{agency}");
const client = org("Fictional Harbour Client", "{client}", ", p_vat_trn => '000555', p_trade_licence_no => '0123'");
const enq = (title, agencyId) => asDb(5, `select crm_create_opportunity(p_company_id => '${CO}', p_title => '${title}', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}'${agencyId ? `, p_agency_org_id => '${agencyId}'` : ""})`);
const oppBoth = enq("Fictional agency gala", agency);
const oppDirect = enq("Fictional direct fit-out", null);
const oppLegacy = enq("Fictional legacy hall", null);
sql(`update crm_opportunities set currency='EUR' where id='${oppBoth}'`);

// ---- Admin -> Companies: the owner enters the issuer details through the existing screen (fictional values; nothing is seeded or hard-coded) ----
const ISSUER_1 = { trn: "100000000000003", address: "Fictional Tower, Level 4\nFictional Bay, Dubai 00000", phone: "+000 11 222 3333", email: "sales@fictional.example", website: "www.fictional.example" };
const ISSUER_2 = { trn: "200000000000009", address: "New Fictional Plaza\nNew Fictional Bay", phone: "+000 99 888 7777", email: "new@fictional.example", website: "https://www.new-fictional.example" };
const adminPage = await newPage(browser, { width: 1440, height: 900 }, "light", { deviceScaleFactor: 2 });
await login(adminPage, "admin@e2e.local");
const editIssuer = async (v, shotName) => {
  await adminPage.goto(`${BASE}/admin/companies`, { waitUntil: "networkidle" });
  await adminPage.getByRole("button", { name: /Issuer details for Fictional Enginious UAE LLC/ }).click();
  const dlg = adminPage.getByRole("dialog"); await dlg.waitFor();
  await adminPage.locator(`#iss-trn-${CO}`).fill(v.trn); await adminPage.locator(`#iss-addr-${CO}`).fill(v.address);
  await adminPage.locator(`#iss-phone-${CO}`).fill(v.phone); await adminPage.locator(`#iss-email-${CO}`).fill(v.email); await adminPage.locator(`#iss-web-${CO}`).fill(v.website);
  if (shotName) await adminPage.screenshot({ path: `${SHOTS}/${shotName}.png` });
  await dlg.getByRole("button", { name: "Save details" }).click();
  await dlg.waitFor({ state: "detached" });
  const row = sql(`select trn || '|' || replace(address, E'\n', '/') || '|' || phone || '|' || email || '|' || website from companies where id='${CO}'`);
  if (row !== `${v.trn}|${v.address.replace("\n", "/")}|${v.phone}|${v.email}|${v.website}`) throw new Error(`stored issuer details: ${row}`);
};
await step("Admin -> Companies: the issuer-details dialog holds legal name, TRN, a multi-line address, phone, email and website; saving stores them exactly", async () => {
  await adminPage.goto(`${BASE}/admin/companies`, { waitUntil: "networkidle" });
  await adminPage.getByRole("button", { name: /Issuer details for Fictional Enginious UAE LLC/ }).click();
  const t = flat(await adminPage.getByRole("dialog").innerText());
  for (const need of ["Issuer details", "Legal name", "Tax registration number (TRN)", "Address", "Phone", "Email", "Website", "Logo"]) if (!t.includes(need)) throw new Error(`the dialog lacks ${need}`);
  if (/quotation/i.test(t)) throw new Error("the dialog still says quotation");
  if ((await adminPage.locator(`#iss-addr-${CO}`).evaluate((e) => e.tagName)) !== "TEXTAREA") throw new Error("the address is not multi-line");
  await adminPage.keyboard.press("Escape");
  await editIssuer(ISSUER_1, "issuer-dialog-light");
});

await login(page, "emp@e2e.local");
let quoteUrl = ""; let proposalId = "";
const rowOf = (n) => page.locator('section[aria-label="Items without a section"] li, section[aria-label^="Section "] li').nth(n);
const typeRow = async (li, desc, qty, price, unit = "") => {
  await li.locator("textarea").fill(desc); await li.getByPlaceholder("Unit", { exact: true }).fill(unit); await li.getByPlaceholder("Qty").fill(qty); await li.getByPlaceholder("Unit price").fill(price);
};

await step("a new estimate: Details first, three clear steps, estimate wording, read-only issuer summary, no terms, no 'Issue quotation'", async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppBoth}?tab=quotations`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create draft estimate" }).click();
  await page.waitForURL(/\/quotations\//); quoteUrl = page.url(); proposalId = quoteUrl.split("/").pop();
  await has(/Estimate QUO-UAE-\d{4}-0001/, "reference"); await has(/Revision 1/, "revision"); await has(/This is a DRAFT estimate/, "draft banner");
  const steps = await page.locator('nav[aria-label="Estimate steps"] button').allInnerTexts();
  if (steps.map((s) => s.replace(/\s+/g, " ").replace(/^\d /, "")).join("|") !== "Details|BOQ|Preview & finalise") throw new Error(`steps ${steps}`);
  if ((await page.locator('nav[aria-label="Estimate steps"] [aria-current="step"]').innerText()).indexOf("Details") < 0) throw new Error("Details is not the active step");
  const issuer = page.locator('section[aria-label="Prepared by"]');
  await issuer.waitFor(); const t = flat(await issuer.innerText());
  if (!/Fictional Enginious UAE LLC/.test(t) || !/TRN 100000000000003/.test(t) || !/Fictional Tower, Level 4/.test(t)) throw new Error(`issuer summary: ${t}`);
  if (await issuer.locator("input, textarea, select").count()) throw new Error("the issuer summary has form fields");
  await hasNot(/Standard terms|Terms and conditions|working draft|pending legal review|Issue quotation|Quotation/i, "old wording on the Details step");
  const cur = await page.locator("#est-currency").inputValue(); if (cur !== "EUR") throw new Error(`currency not prefilled from the enquiry: ${cur}`);
  const vat = await page.locator("#est-vat").inputValue(); if (vat !== "") throw new Error("VAT must stay an explicit choice (no pre-selection)");
  await shot("1-details-light");
});
await step("agency AND end client linked: no default recipient, the person must choose; the choice is saved with Save draft", async () => {
  const radios = page.getByRole("radio"); const n = await radios.count();
  for (let i = 0; i < n; i++) if (await radios.nth(i).isChecked()) throw new Error("a recipient is pre-selected although both parties are linked");
  await has(/agency and an end client are both linked/, "reason for the forced choice");
  await page.getByRole("radio", { name: /Fictional Harbour Client/ }).check();
  await page.locator("#est-vat").selectOption(await optionValue(page.locator("#est-vat"), /^5%$/));
  const s = flat(await saveState().innerText()); if (!/Unsaved changes/.test(s)) throw new Error(`state after editing: ${s}`);
});
await step("More options: internal notes, Assumptions, Exclusions, Next steps, payment details, Review pricing after; saved in one go", async () => {
  await page.getByTestId("more-options").locator("summary").click();
  await page.locator("#est-internal").fill(`${SECRET} margin discussion`);
  await page.locator("#est-assumptions").fill("Prices assume one site visit.\n\nPower is supplied by the venue.");
  await page.getByRole("button", { name: "Add exclusion" }).click();
  await page.getByLabel("Exclusion 1 title").fill("Civil works"); await page.getByLabel("Exclusion 1 text").fill("Civil and MEPFS works are not included unless shown in the BOQ.");
  await page.locator("#est-next").fill("Confirm the scope in writing so the figures can be reviewed.");
  await page.getByRole("button", { name: "Add payment line" }).click(); await page.getByRole("button", { name: "Add payment line" }).click();
  await page.getByLabel("Payment line 1 label").fill("Instalment 1"); await page.getByLabel("Payment line 1 value").fill("40"); await page.getByLabel("Payment line 1 timing").fill("Before mobilisation");
  await page.getByLabel("Payment line 2 label").fill("Instalment 2"); await page.getByLabel("Payment line 2 value").fill("60"); await page.getByLabel("Payment line 2 timing").fill("On completion");
  await page.locator("#est-review").fill("2099-12-31");
  await has(/Review pricing after/, "Review pricing after label"); await hasNot(/Valid until|valid until/, "Valid until label");
  await shot("4-more-options-light");
  await saveDraft(); await waitSaved();
  const db = sql(`select count(*) from crm_quotations where proposal_id='${proposalId}' and internal_notes like '${SECRET}%' and terms_label='estimate-format:2' and validity_date='2099-12-31' and bill_to_org_id='${client}'`);
  if (db !== "1") throw new Error("details were not saved");
  const terms = sql(`select string_agg(t->>'title', ',') from crm_quotations q, jsonb_array_elements(q.terms) t where proposal_id='${proposalId}'`);
  if (terms !== "Assumptions,Next steps") throw new Error(`stored terms: ${terms}`);
});
await step("BOQ: the first item can be typed at once with no section; sections are optional; numbering 1, 2 then 1.1; totals are live before saving", async () => {
  await goStep("BOQ");
  await page.locator('section[aria-label="Items without a section"]').getByRole("button", { name: "Add item" }).click();
  await typeRow(rowOf(0), "Stage deck", "3", "33.33", "m2");
  await page.locator('section[aria-label="Items without a section"]').getByRole("button", { name: "Add item" }).click();
  await typeRow(rowOf(1), "Fascia panels", "1.5", "19.99", "m2");
  await has(/Line total EUR 99\.99/, "line total of item 1"); await has(/Total excl\. VAT EUR 129\.98/, "live total before saving");
  const nums = await page.locator('[aria-label="Item number"]').allInnerTexts(); if (nums.join(",") !== "1,2") throw new Error(`numbers ${nums}`);
  await saveDraft(); await waitSaved();
  if (sql(`select count(*) from crm_quotation_lines where proposal_id='${proposalId}'`) !== "2") throw new Error("two items expected");
  if (sql(`select count(*) from crm_quotation_sections where proposal_id='${proposalId}' and title='(no section)'`) !== "1") throw new Error("the hidden default section was not created exactly once");
  await page.getByLabel("Add a section (optional)").fill("AV"); await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("heading", { name: "AV" }).waitFor();
  await page.locator('section[aria-label="Section AV"]').getByRole("button", { name: "Add item to this section" }).click();
  await typeRow(page.locator('section[aria-label="Section AV"] li').first(), "LED wall", "7", "0.35", "m2");
  await saveDraft(); await waitSaved();
  const nums2 = await page.locator('[aria-label="Item number"]').allInnerTexts(); if (nums2.join(",") !== "1,2,1.1") throw new Error(`numbers after a section ${nums2}`);
  await has(/Total excl\. VAT EUR 132\.43/, "total"); await has(/Total incl\. VAT EUR 139\.05/, "total incl. VAT");
  await has(/Subtotal, items without a section/, "loose subtotal");
  await shot("2-boq-light");
});
await step("Save draft: a failed write says it could not save and never claims Saved; Save again completes WITHOUT duplicating the item", async () => {
  psqlInput("create or replace function _sim_fail() returns trigger language plpgsql as $$ begin raise exception 'simulated outage'; end $$;\ncreate trigger _sim_fail before insert on crm_quotation_lines for each row execute function _sim_fail();\n");
  try {
    await page.locator('section[aria-label="Items without a section"]').getByRole("button", { name: "Add item" }).click();
    await typeRow(rowOf(2), "Rigging points", "2", "50", "pcs");
    await saveDraft();
    await page.waitForFunction(() => /Could not save/.test(document.querySelector('[data-testid="save-state"]')?.textContent ?? ""));
    const s = flat(await saveState().innerText());
    if (/Saved/.test(s.replace(/Could not save/, ""))) throw new Error(`claims saved: ${s}`);
    if (sql(`select count(*) from crm_quotation_lines where proposal_id='${proposalId}'`) !== "3") throw new Error("a failed write changed the item count");
  } finally { psqlInput("drop trigger if exists _sim_fail on crm_quotation_lines;\ndrop function if exists _sim_fail();\n"); }
  await saveDraft(); await waitSaved();
  if (sql(`select count(*) from crm_quotation_lines where proposal_id='${proposalId}' and description='Rigging points'`) !== "1") throw new Error("the item was duplicated or missing");
  const nums = await page.locator('[aria-label="Item number"]').allInnerTexts(); if (nums.join(",") !== "1,2,3,1.1") throw new Error(`numbers ${nums}`);
});
await step("a quantity that cannot be saved is said in words next to the item and nothing is claimed saved", async () => {
  await typeRow(rowOf(2), "Rigging points", "abc", "50", "pcs");
  await has(/Quantity must be a number above zero/, "inline issue");
  await saveDraft();
  await page.waitForFunction(() => /Could not save/.test(document.querySelector('[data-testid="save-state"]')?.textContent ?? ""));
  await typeRow(rowOf(2), "Rigging points", "2", "50", "pcs");
  await saveDraft(); await waitSaved();
});

const tablesNow = () => ({
  counts: sql(`select string_agg(c, ',' order by c) from (select tablename || '=' || (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.' || quote_ident(tablename), false, true, '')))[1]::text as c from pg_tables where schemaname='public' and (tablename ~ 'reserv|booking|follow_up|reminder|zoho|handover|closure|movement|approval')) x`),
  stage: sql(`select stage || '/' || version from crm_opportunities where id='${oppBoth}'`),
  status: sql(`select status || '/' || coalesce(sent_on::text, '-') from crm_proposals where id='${proposalId}'`),
  proposals: sql(`select count(*) from crm_proposals where opportunity_id='${oppBoth}'`),
});
let before;
await step("Preview & finalise: the notice is shown and fixed, the notes preview is short with an Edit action, the blockers are in words", async () => {
  await goStep("Preview & finalise");
  await page.getByTestId("notice-preview").waitFor();
  if (flat(await page.getByTestId("notice-preview").innerText()).indexOf(NOTICE) < 0) throw new Error("notice text differs from the owner's wording");
  await has(/What the client file will say/, "preview heading"); await has(/Assumptions.*Prices assume one site visit\./, "assumptions excerpt");
  await has(/Indicative payment schedule/, "payment label"); await hasNot(/accept|proceed|by signing|Terms and conditions|Standard terms|Quotation/i, "acceptance or old wording");
  await page.getByRole("button", { name: "Edit notes" }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  if ((await dlg.locator("textarea").count()) < 2) throw new Error("the notes editor did not open");
  if (flat(await dlg.innerText()).includes("budgetary estimate for planning purposes")) throw new Error("the notice must not be editable inside the notes editor");
  await dlg.getByRole("button", { name: "Done" }).click();
  await shot("3-finalise-light");
});
await step("a company that REQUIRES approval: finalising is blocked; a STALE reviewer screen cannot approve; a fresh request on the current version can", async () => {
  sql(`update crm_company_settings set approval_policy='required' where company_id='${CO}'`);
  await page.reload({ waitUntil: "networkidle" }); await goStep("Preview & finalise");
  await has(/Request approval of the current version/, "approval blocker");
  if (!(await page.getByRole("button", { name: "Finalise estimate" }).isDisabled())) throw new Error("Finalise should be disabled before approval");
  await page.getByRole("button", { name: "Request approval" }).click();
  await page.getByText(/Waiting for approval/).first().waitFor();
  const refused = asDbTry(5, `select crm_quote_issue('${proposalId}')`);
  if (refused.ok || !/approval/i.test(refused.out)) throw new Error("database finalised without approval: " + refused.out);
  const fpage = await newPage(browser, { width: 1280, height: 900 }); await login(fpage, "ceo@e2e.local");
  await fpage.goto(quoteUrl, { waitUntil: "networkidle" }); await fpage.getByTestId("approval-review").waitFor();
  asDb(5, `select crm_quote_save_header('${proposalId}', '{"validity_date":"2099-06-30"}'::jsonb)`);
  await fpage.getByRole("button", { name: "Approve this version" }).click();
  await fpage.getByText(/This estimate changed after you opened it/).waitFor();
  if (sql(`select count(*) from crm_approvals where state='approved'`) !== "0") throw new Error("a stale approval was recorded");
  await page.reload({ waitUntil: "networkidle" }); await goStep("Preview & finalise");
  await has(/Request approval of the current version/, "the edited version needs a fresh request");
  await page.getByRole("button", { name: "Request approval" }).click(); await page.getByText(/Waiting for approval/).first().waitFor();
  await fpage.reload({ waitUntil: "networkidle" }); await fpage.getByRole("button", { name: "Approve this version" }).click();
  await fpage.getByTestId("approval-review").waitFor({ state: "detached" }); await fpage.context().close();
  await page.reload({ waitUntil: "networkidle" }); await goStep("Preview & finalise");
  await has(/Everything needed to finalise is in place/, "ready");
});
await step("FINALISE: freezes only. Status, stage, follow-ups, reminders, bookings, reservations, Zoho and every other table stay as they were", async () => {
  before = tablesNow();
  if (!(await page.getByRole("button", { name: "Finalise estimate" }).isDisabled())) throw new Error("Finalise must stay off until the recipient is confirmed");
  await page.getByLabel(/I have checked who this estimate is addressed to/).check();
  await page.getByRole("button", { name: "Finalise estimate" }).click();
  await page.getByTestId("issued-snapshot").waitFor();
  await has(/Finalised on /, "banner"); await has(/frozen and read-only/, "frozen"); await has(/Estimate QUO-UAE/, "title");
  const after = tablesNow();
  if (after.counts !== before.counts) throw new Error(`rows changed: ${before.counts} -> ${after.counts}`);
  if (after.stage !== before.stage) throw new Error(`stage/version changed: ${before.stage} -> ${after.stage}`);
  if (after.status !== before.status || !/^draft\/-$/.test(after.status)) throw new Error(`proposal status changed: ${before.status} -> ${after.status}`);
  if (after.proposals !== before.proposals) throw new Error("a proposal row was added");
  if (sql(`select count(*) from crm_zoho_references where opportunity_id='${oppBoth}'`) !== "0") throw new Error("a Zoho reference appeared");
  const events = sql(`select coalesce(string_agg(kind || ':' || coalesce(to_value, ''), ' | ' order by created_at), '') from crm_opportunity_events where opportunity_id='${oppBoth}' and created_at > now() - interval '30 seconds'`);
  if (/stage_changed|follow/.test(events)) throw new Error(`unexpected events: ${events}`);
  const refused = asDbTry(5, `select crm_quote_save_header('${proposalId}', '{"currency":"USD"}'::jsonb)`);
  if (refused.ok || !/issued quotation cannot be edited/.test(refused.out)) throw new Error("database allowed an edit: " + refused.out);
  await shot("5-finalised-light");
});
await step("the Proposal versions list calls it an estimate; an estimate has no 'Record as sent'; an ordinary proposal can still be recorded as sent and the estimate is untouched", async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppBoth}?tab=proposals`, { waitUntil: "networkidle" });
  await has(/Estimate, finalised/, "estimate label in Proposal versions"); await has(/Open the estimate/, "link to the estimate"); await hasNot(/quotation builder/i, "old note text");
  const estimateLi = page.locator("li", { hasText: "Open the estimate" });
  if (await estimateLi.getByRole("button", { name: /sent/i }).count()) throw new Error("'Record as sent' is offered for an estimate");
  asDb(5, `select crm_add_proposal('${oppBoth}', 'Canva proposal v2', null)`);
  await page.reload({ waitUntil: "networkidle" });
  const li = page.locator("li", { hasText: "Canva proposal v2" });
  await li.getByRole("button", { name: /sent/i }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  await dlg.locator('input[type="date"]').fill(new Date().toISOString().slice(0, 10));
  await dlg.getByRole("button", { name: /^(record|save|confirm|mark)/i }).last().click();
  await li.getByText(/recorded as sent/i).waitFor();
  const st = sql(`select string_agg(status, ',' order by version) from crm_proposals where opportunity_id='${oppBoth}'`);
  if (st !== "draft,sent") throw new Error(`statuses after recording the proposal as sent: ${st} (the estimate must stay draft and untouched)`);
});
await step("client files of the FINALISED estimate: Estimate title, notice on page one above the BOQ, no terms, no acceptance wording, no internal notes", async () => {
  await page.goto(quoteUrl, { waitUntil: "networkidle" });
  const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)");
  if (!/^QUO-UAE-\d{4}-0001-rev1\.pdf$/.test(pdf.name) || !/^QUO-UAE-\d{4}-0001-rev1\.xlsx$/.test(xlsx.name)) throw new Error(`file names ${pdf.name} / ${xlsx.name}`);
  const raw = flat(pdfRaw(pdf.file)); const layout = pdfText(pdf.file);
  const p1 = flat(spawnSync("pdftotext", ["-raw", "-f", "1", "-l", "1", pdf.file, "-"], { encoding: "utf8" }).stdout);
  if (!p1.includes(NOTICE) || p1.indexOf(NOTICE) > p1.indexOf("# Description")) throw new Error("the notice is not on page one above the BOQ");
  for (const re of [/Quotation/, /Valid until/i, /Terms and conditions/i, /working draft/i, /accept/i, /sign(ed|ature)/i, /proceed/i, /DRAFT/]) if (re.test(raw.replace(NOTICE, ""))) throw new Error(`forbidden ${re} in the PDF`);
  if (raw.includes(SECRET)) throw new Error("internal notes in the PDF");
  for (const need of ["Estimate", "Review pricing after: 2099-06-30", "Indicative payment schedule", "Assumptions", "Next steps", "Exclusions", "244.05", "Pricing to be reviewed after 2099-06-30. This is not a price guarantee."]) if (!raw.includes(need) && !layout.includes(need)) throw new Error(`PDF is missing ${need}`);
  if (!/^\s*1\s+Stage deck/m.test(layout) || !/\b1\.1\s+LED wall/.test(layout)) throw new Error("PDF numbering of loose and sectioned items");
  if (!/Carlito/.test(execFileSync("pdffonts", [pdf.file]).toString())) throw new Error("Carlito not embedded");
  const c = await cells(xlsx.file);
  if (c.name !== "Estimate") throw new Error(`sheet name ${c.name}`);
  if (!c.all.includes(NOTICE) || !/244\.05/.test(c.all) || c.all.includes(SECRET) || /Quotation|Terms and conditions|Valid until/.test(c.all.replace(NOTICE, ""))) throw new Error("Excel wording or notice");
  let noticeRow = 0; c.ws.eachRow((r, i) => { if (!noticeRow && r.values.some((v) => typeof v === "object" && v && "richText" in v && v.richText.some((t) => t.text.includes("budgetary estimate for planning")))) noticeRow = i; });
  if (noticeRow !== 1) throw new Error(`the notice is on row ${noticeRow}, not the top row`);
  if (execFileSync("sh", ["-c", `unzip -p '${xlsx.file}' | grep -c '${SECRET}' || true`]).toString().trim() !== "0") throw new Error("internal notes inside the xlsx package");
});
let rev1 = null;
const pdfLinks = (f) => [...new Set([...(execFileSync("sh", ["-c", `cat '${f}'`], { maxBuffer: 1 << 28 }).toString("latin1")).matchAll(/\/URI \(([^)]*)\)/g)].map((m) => m[1]))];
const pdfPageCount = (f) => (execFileSync("pdfinfo", [f]).toString().match(/Pages:\s+(\d+)/) ?? [])[1];
const xlsxLinks = (ws) => { const out = []; ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "object" && c.value && "hyperlink" in c.value) out.push(c.value.hyperlink); })); return [...new Set(out)]; };   // merged cells repeat their master's value
const exportBoth = async () => { const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)"); const c = await cells(xlsx.file); return { pdf, xlsx, text: pdfText(pdf.file), pages: pdfPageCount(pdf.file), links: pdfLinks(pdf.file), c, footer: c.ws.headerFooter.oddFooter, xlinks: xlsxLinks(c.ws) }; };
const SALES1 = "Sales enquiries: +000 11 222 3333 · sales@fictional.example · www.fictional.example";
await step("ISSUER BRANDING: the finalised files carry the header block and, on every page, the sales enquiries footer with the website as a link; Excel matches", async () => {
  await page.goto(quoteUrl, { waitUntil: "networkidle" });
  rev1 = await exportBoth();
  const lines = rev1.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "Fictional Enginious UAE LLC" || lines[1] !== "Fictional Tower, Level 4" || lines[2] !== "Fictional Bay, Dubai 00000" || lines[3] !== "TRN: 100000000000003") throw new Error(`header lines: ${lines.slice(0, 5).join(" | ")}`);
  const pages = rev1.text.split("\f").filter((p) => p.trim());
  pages.forEach((p, n) => { const last = flat(p.split("\n").filter((l) => l.trim()).at(-1)); if (!last.includes(SALES1) || !last.includes(`Page ${n + 1} of ${pages.length}`)) throw new Error(`footer of page ${n + 1}: ${last}`); });
  if (rev1.links.join() !== "https://www.fictional.example") throw new Error(`PDF links ${rev1.links}`);
  if (rev1.xlinks.join() !== "https://www.fictional.example") throw new Error(`Excel links ${rev1.xlinks}`);
  const xs = rev1.c.all.split("\n"); const k = xs.findIndex((t) => t.startsWith("Sales enquiries:"));
  if (`${xs[k]} ${xs[k + 1]}` !== SALES1 || !rev1.footer.includes(SALES1)) throw new Error("Excel footer line differs from the PDF");
  if (!xs.includes("TRN: 100000000000003") || !xs.includes("Fictional Bay, Dubai 00000")) throw new Error("Excel header lines");
  await shot("6-finalised-page-light");
});
await step("the company profile is edited AFTER finalising: the same revision re-exports unchanged (PDF text, pages, Excel cells, link, footer)", async () => {
  const frozen = sql(`select md5(content::text) from crm_quotation_snapshots where proposal_id='${proposalId}'`);
  await editIssuer(ISSUER_2);
  await page.goto(quoteUrl, { waitUntil: "networkidle" });
  const again = await exportBoth();
  if (again.text !== rev1.text || again.pages !== rev1.pages) throw new Error("the PDF of the finalised revision changed after the profile edit");
  if (again.c.all !== rev1.c.all || again.footer !== rev1.footer || again.links.join() !== rev1.links.join() || again.xlinks.join() !== rev1.xlinks.join()) throw new Error("the Excel of the finalised revision changed after the profile edit");
  if (/New Fictional|200000000000009|new-fictional/.test(again.text + again.c.all)) throw new Error("new profile values leaked into the finalised revision");
  if (sql(`select md5(content::text) from crm_quotation_snapshots where proposal_id='${proposalId}'`) !== frozen) throw new Error("the snapshot changed");
});
await step("a DRAFT download is marked Draft in the file name, the PDF and the Excel sheet; it never prints the old terms or the internal notes", async () => {
  await page.getByRole("button", { name: "Create revision" }).click();
  await page.waitForURL((u) => u.pathname.includes("/quotations/") && u.toString() !== quoteUrl);
  await has(/Revision 2/, "revision 2"); await has(/This is a DRAFT estimate/, "draft");
  const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)");
  if (!/-rev2-DRAFT\.pdf$/.test(pdf.name) || !/-rev2-DRAFT\.xlsx$/.test(xlsx.name)) throw new Error(`draft names ${pdf.name} / ${xlsx.name}`);
  const raw = flat(pdfRaw(pdf.file));
  if (!/DRAFT, NOT FINALISED/.test(raw) || !raw.includes(NOTICE)) throw new Error("draft PDF banner or notice");
  const c = await cells(xlsx.file);
  if (c.name !== "Estimate DRAFT" || !/^DRAFT, NOT FINALISED/.test(c.all) || !c.all.includes(NOTICE)) throw new Error("draft XLSX is not marked");
  if (raw.includes(SECRET) || c.all.includes(SECRET)) throw new Error("internal text in a draft export");
});
await step("a NEW revision picks the new profile up: its draft shows it, finalising freezes it, and revision 1 still shows the old one", async () => {
  const rev2Url = page.url();
  const d = await exportBoth();
  if (!d.text.includes("TRN: 200000000000009") || !d.text.includes("New Fictional Bay") || d.links.join() !== "https://www.new-fictional.example" || !/DRAFT, NOT FINALISED/.test(d.text.replace(/\s+/g, " "))) throw new Error("the draft of the new revision does not show the live profile");
  sql(`update crm_company_settings set approval_policy='not_required' where company_id='${CO}'`);
  await page.reload({ waitUntil: "networkidle" }); await goStep("Preview & finalise");
  await page.getByLabel(/I have checked who this estimate is addressed to/).check();
  await page.getByRole("button", { name: "Finalise estimate" }).click();
  await page.getByTestId("issued-snapshot").waitFor();
  const f = await exportBoth();
  if (/DRAFT/.test(f.text) || !f.text.includes("TRN: 200000000000009") || !f.text.includes("Sales enquiries: +000 99 888 7777 · new@fictional.example · https://www.new-fictional.example") || f.links.join() !== "https://www.new-fictional.example") throw new Error("the finalised new revision does not carry the new profile");
  if (f.xlinks.join() !== "https://www.new-fictional.example") throw new Error("Excel link of the new revision");
  if (sql(`select content->'issuer'->>'trn' || '|' || (content->'issuer'->>'website') from crm_quotation_snapshots where proposal_id='${rev2Url.split("/").pop()}'`) !== "200000000000009|https://www.new-fictional.example") throw new Error("the new snapshot does not hold the new issuer fields");
  await page.goto(quoteUrl, { waitUntil: "networkidle" });
  const old = await exportBoth();
  if (old.text !== rev1.text || old.c.all !== rev1.c.all) throw new Error("revision 1 changed once revision 2 was finalised");
  await shot("7-revision-2-light");
});
await step("an enquiry with ONE linked party: it is suggested with the reason but not saved until the person saves; VAT stays unselected; a non-owner is refused", async () => {
  sql(`update crm_company_settings set approval_policy='not_required' where company_id='${CO}'`);
  await page.goto(`${BASE}/sales/opportunities/${oppDirect}?tab=quotations`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create draft estimate" }).click(); await page.waitForURL(/\/quotations\//);
  await has(/Only the end client is linked to this enquiry/, "reason");
  if (!(await page.getByRole("radio", { name: /Fictional Harbour Client/ }).isChecked())) throw new Error("the only linked party was not pre-selected");
  if ((await page.locator("#est-vat").inputValue()) !== "") throw new Error("VAT was pre-selected");
  const directId = page.url().split("/").pop();
  if (sql(`select coalesce(bill_to_org_id::text, 'none') from crm_quotations where proposal_id='${directId}'`) !== "none") throw new Error("the suggestion was saved without the person confirming");
  const refused = asDbTry(4, `select crm_quote_save_section('${directId}', null, 'Nope')`);
  if (refused.ok || !/owner of this opportunity or a founder/.test(refused.out)) throw new Error("non-owner was not refused: " + refused.out);
});
await step("a quotation frozen BEFORE this change keeps its wording on screen and in its files, its snapshot is untouched, and its revision becomes an estimate", async () => {
  // Exactly what the previous app did: the unchanged database functions, standard terms copied in, no format marker.
  const q = asDb(5, `select crm_quote_create('${oppLegacy}')`);
  const vat = sql(`select id from crm_quote_vat_choices where company_id='${CO}' and label='5%'`);
  asDb(5, `select crm_quote_save_header('${q}', '{"currency":"EUR","vat_choice_id":"${vat}","bill_to_org_id":"${client}","validity_date":"2099-12-31","milestones":[{"label":"Deposit","kind":"percent","value":"100","due":"On acceptance"}]}'::jsonb)`);
  const sec = asDb(5, `select crm_quote_save_section('${q}', null, 'Fabrication')`);
  asDb(5, `select crm_quote_save_line('${q}', null, '${sec}', '{"description":"Legacy stage deck","unit":"m2","quantity":"3","unit_price":"33.33"}'::jsonb)`);
  asDb(5, `select crm_quote_issue('${q}')`);
  const snap = (id) => sql(`select md5(content::text) || ':' || content_hash from crm_quotation_snapshots where proposal_id='${id}'`);
  const hashBefore = snap(q);
  if (sql(`select content->'terms'->>'label' from crm_quotation_snapshots where proposal_id='${q}'`) !== "Standard terms (working draft, pending legal review)") throw new Error("not a legacy-shaped snapshot");
  await page.goto(`${BASE}/sales/opportunities/${oppLegacy}/quotations/${q}`, { waitUntil: "networkidle" });
  await page.getByTestId("issued-snapshot").waitFor();
  await has(/issued before the estimates-only change as a quotation/, "legacy note"); await has(/Standard terms/, "frozen terms shown as frozen"); await has(/valid until 2099-12-31/, "frozen wording");
  const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)");
  const t = pdfText(pdf.file);
  if (!/Quotation/.test(t) || !/Terms and conditions/.test(t) || !/Valid until: 2099-12-31/.test(t) || /budgetary estimate/i.test(t)) throw new Error("the legacy PDF does not keep its original wording");
  const c = await cells(xlsx.file); if (c.name !== "Quotation" || !/Terms and conditions/.test(c.all)) throw new Error("the legacy Excel does not keep its original wording");
  if (snap(q) !== hashBefore) throw new Error("the legacy snapshot changed");
  await page.getByRole("button", { name: "Create revision" }).click();
  await page.waitForURL((u) => u.pathname.includes("/quotations/") && !u.pathname.endsWith(q));
  const rev = page.url().split("/").pop();
  await has(/Revision 2/, "revision 2");
  await page.getByRole("button", { name: "Save draft" }).click(); await waitSaved();
  const terms = sql(`select coalesce((select string_agg(t->>'title', ',') from jsonb_array_elements(q.terms) t), '') || '|' || q.terms_label from crm_quotations q where proposal_id='${rev}'`);
  if (terms !== "|estimate-format:2") throw new Error(`the revision still holds the old terms: ${terms}`);
  asDb(5, `select crm_quote_issue('${rev}')`);
  if (snap(q) !== hashBefore) throw new Error("the legacy snapshot changed after its revision was finalised");
  if (sql(`select content->'terms'->>'label' from crm_quotation_snapshots where proposal_id='${rev}'`) !== "estimate-format:2") throw new Error("the revision snapshot is not in the current estimate format");
});
await step("Sales settings no longer offer standard terms", async () => {
  await page.goto(`${BASE}/sales/settings`, { waitUntil: "networkidle" });
  await has(/Estimates/, "heading"); await hasNot(/Save standard terms|Add clause|Clause 1 title/i, "terms editor");
});
await browser.close();
console.log(fails === 0 ? "VERDICT: PASS" : `VERDICT: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
