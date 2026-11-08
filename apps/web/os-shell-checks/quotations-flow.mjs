// Estimates & Quotations (part 1) in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (grants: ceo@ founder, mgr@ and emp@ plain,
// admin@ none; UAE settings) and writes to the database it drives, so reseed before every run. Run: `node os-shell-checks/quotations-flow.mjs`.
//   1. emp@ (the enquiry owner) starts a draft from an enquiry; adds sections and items; reorders sections (totals and item numbers follow); chooses VAT and currency;
//      bills the AGENCY on one enquiry and the END CLIENT on another; saves the draft with an identifier missing (no TRN on the account);
//   2. a company that requires approval: issuing is blocked until a founder approves (the existing commercial approval), then the quotation is issued;
//   3. the issued quotation is read-only (page and database), frozen against later account / company edits, and a revision (same reference, revision 2) can be started;
//   4. a plain Sales colleague who does not own the enquiry sees the estimate but is refused by the database.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb, asDbTry } from "./inventory-flow-lib.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const CO = "00000000-0000-4000-8000-00000000a001";
const browser = await chromium.launch();
let fails = 0; let page;
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/q-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const text = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const has = async (re, what) => { const t = await text(); if (!re.test(t)) throw new Error(`${what}: not found /${re.source}/ in ${t.slice(0, 300)}`); };
const hasNot = async (re, what) => { const t = await text(); if (re.test(t)) throw new Error(`${what}: unexpectedly found /${re.source}/`); };
const optionValue = async (sel, re) => { const o = await sel.locator("option").evaluateAll((os) => os.map((x) => [x.value, x.textContent])); const m = o.find(([, t]) => re.test(t)); if (!m) throw new Error(`no option ${re}`); return m[0]; };
page = await newPage(browser); page.on("dialog", (d) => d.accept());
const OUT = "/tmp/q-out"; mkdirSync(OUT, { recursive: true });
const SHOTS = new URL("../../../docs/enginious-os/screenshots/quotations/", import.meta.url).pathname; mkdirSync(SHOTS, { recursive: true });
const download = async (name) => { const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name }).click()]); const f = `${OUT}/${d.suggestedFilename()}`; await d.saveAs(f); return { file: f, name: d.suggestedFilename() }; };
const pdfText = (f) => spawnSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }).stdout;
const cells = async (f) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ws = wb.worksheets[0]; const out = []; ws.eachRow((r) => out.push(JSON.stringify(r.values))); return { name: ws.name, rows: out, images: ws.getImages().length, ws }; };
let issuedDump = null;

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");
// Fictional issuer profile on the company record (not hard-coded anywhere in the app).
sql(`update companies set legal_name='Fictional Enginious UAE LLC', trn='100000000000003', address='Fictional Tower, Dubai' where id='${CO}'`);
const org = (name, roles, extra = "") => asDb(5, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '${roles}', p_country_code => 'AE'${extra})`);
const agency = org("Fictional Aurora Agency", "{agency}");              // no TRN recorded on purpose
const client = org("Fictional Harbour Client", "{client}", ", p_vat_trn => '000555', p_trade_licence_no => '0123'");
const enq = (title, agencyId) => asDb(5, `select crm_create_opportunity(p_company_id => '${CO}', p_title => '${title}', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}'${agencyId ? `, p_agency_org_id => '${agencyId}'` : ""})`);
const oppAgency = enq("Fictional agency gala", agency);
const oppDirect = enq("Fictional direct fit-out", null);

await login(page, "emp@e2e.local");
let quoteUrl = "";
const addSection = async (title) => { await page.getByLabel("New section").fill(title); await page.getByRole("button", { name: "Add section" }).click(); await page.getByRole("heading", { name: title }).waitFor(); };
const addItem = async (section, desc, qty, price) => {
  await page.locator(`section[aria-label="Section ${section}"]`).getByRole("button", { name: "Add item" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Description").fill(desc); await d.getByLabel("Quantity").fill(qty); await d.getByLabel("Unit selling price").fill(price);
  await d.getByRole("button", { name: "Add item" }).click(); await page.getByText(desc).first().waitFor();
};

await step("start a draft from the enquiry's Estimates & Quotations tab; the draft is clearly a draft", async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppAgency}?tab=quotations`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create draft estimate" }).click();
  await page.waitForURL(/\/quotations\//); quoteUrl = page.url();
  await has(/QUO-UAE-\d{4}-0001/, "reference"); await has(/Revision 1/, "revision"); await has(/This is a DRAFT estimate/, "draft banner");
  await has(/Fictional Enginious UAE LLC/, "issuer from the company profile"); await has(/TRN 100000000000003/, "issuer TRN");
  await has(/Standard terms \(working draft, pending legal review\)/, "terms label");
});
await step("sections and items: add, numbering is sequential across the document", async () => {
  await addSection("Fabrication"); await addSection("AV");
  await addItem("Fabrication", "Stage deck", "3", "33.33");
  await addItem("Fabrication", "Fascia panels", "1.5", "19.99");
  await addItem("AV", "LED wall", "7", "0.35");
  await has(/Section subtotal: 129\.98/, "Fabrication subtotal"); await has(/Total excl\. VAT 132\.43/, "total");
});
await step("reorder sections: totals unchanged, numbers follow the new order", async () => {
  await page.getByRole("button", { name: "Move section AV up" }).click();
  await page.waitForFunction(() => { const h = [...document.querySelectorAll("section[aria-label^='Section ']")].map((s) => s.getAttribute("aria-label")); return h[0] === "Section AV"; });
  await has(/Total excl\. VAT 132\.43/, "total after reorder");
  const first = await page.locator("section[aria-label='Section AV'] [aria-label='Item number']").first().innerText();
  if (first.trim() !== "1.1") throw new Error(`first item number is ${first} (items are numbered per section: 1.1, 1.2, 2.1)`);
  await has(/1\.1/, "section-based numbers");
});
await step("choose currency, VAT and bill-to the AGENCY; incomplete identifiers do not block saving; issue is blocked with reasons until VAT is chosen", async () => {
  await has(/Before this can be issued/, "blockers"); await has(/Choose the currency/, "currency blocker"); await has(/Choose the VAT treatment/, "vat blocker");
  await page.locator("#q-billto").selectOption(await optionValue(page.locator("#q-billto"), /Fictional Aurora Agency \(agency\)/));
  await page.locator("#q-currency").selectOption("EUR");
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByText(/Billed to: Fictional Aurora Agency/).waitFor();
  await has(/No VAT \/ TRN recorded/, "missing identifier is said, not blocked");
  await has(/Choose the VAT treatment/, "still blocked on VAT");
  if (!(await page.getByRole("button", { name: "Issue quotation" }).isDisabled())) throw new Error("Issue should be disabled");
  await page.locator("#q-vat").selectOption(await optionValue(page.locator("#q-vat"), /^5%$/));
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByText(/Everything needed to issue is in place/).waitFor();
  await has(/Total incl\. VAT EUR 139\.05/, "total incl VAT in EUR");
});
await step("Exclusions are their own block, empty by default, separate from the six working-draft terms", async () => {
  if (await page.getByLabel("Exclusion 1 title").count()) throw new Error("Exclusions should start empty (nothing seeded)");
  await has(/Standard terms \(working draft, pending legal review\)/, "terms keep their working-draft label");
  await page.getByRole("button", { name: "Add exclusion" }).click();
  await page.getByLabel("Exclusion 1 title").fill("Civil works");
  await page.getByLabel("Exclusion 1 text").fill("Civil and MEPFS works are not included unless shown in the BOQ.");
  await page.getByRole("button", { name: "Save milestones, exclusions and terms" }).click();
  await page.getByText(/Everything needed to issue is in place/).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  if (!(await page.getByLabel("Exclusion 1 title").inputValue()).includes("Civil works")) throw new Error("exclusion not saved");
});
await step("a company that REQUIRES approval: STALE reviewer screen cannot approve; a fresh request decided on the current version can; then issue", async () => {
  sql(`update crm_company_settings set approval_policy='required' where company_id='${CO}'`);
  await page.reload({ waitUntil: "networkidle" });
  await has(/Request a founder's approval/, "approval blocker");
  await page.getByRole("button", { name: "Request founder approval" }).click();
  await page.getByText(/Waiting for a founder's approval/).waitFor();
  const proposalId = quoteUrl.split("/").pop();
  const refused = asDbTry(5, `select crm_quote_issue('${proposalId}')`);
  if (refused.ok || !/approval/i.test(refused.out)) throw new Error("database issued without approval: " + refused.out);
  // The founder opens the reviewer screen ...
  const fpage = await newPage(browser); await login(fpage, "ceo@e2e.local");
  await fpage.goto(quoteUrl, { waitUntil: "networkidle" });
  await fpage.getByTestId("approval-review").waitFor();
  // ... Sales then changes the scope ...
  asDb(5, `select crm_quote_save_header('${proposalId}', '{"validity_date":"2099-06-30"}'::jsonb)`);
  // ... and the founder approves from the STALE screen: refused, not recorded.
  await fpage.getByRole("button", { name: "Approve this version" }).click();
  await fpage.getByText(/changed after you opened it/).waitFor();
  if (sql(`select count(*) from crm_approvals where state='approved'`) !== "0") throw new Error("a stale approval was recorded");
  await page.reload({ waitUntil: "networkidle" });
  await has(/Request a founder's approval/, "edited version needs a fresh request");
  if (!(await page.getByRole("button", { name: "Issue quotation" }).isDisabled())) throw new Error("Issue should be disabled after the edit");
  await page.getByRole("button", { name: "Request founder approval" }).click();
  await page.getByText(/Waiting for a founder's approval/).waitFor();
  await fpage.reload({ waitUntil: "networkidle" });
  await fpage.getByRole("button", { name: "Approve this version" }).click();
  await fpage.getByTestId("approval-review").waitFor({ state: "detached" });
  await fpage.close();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(/Everything needed to issue is in place/).waitFor();
});
await step("issue: frozen, read-only, shows issuer and bill-to (with identifiers from the account) and totals", async () => {
  await page.getByRole("button", { name: "Issue quotation" }).click();
  await page.getByTestId("issued-snapshot").waitFor();
  await has(/Issued on /, "issued banner"); await has(/Fictional Aurora Agency/, "bill to"); await has(/frozen and read-only/, "frozen");
  if (await page.getByRole("button", { name: "Add item" }).count()) throw new Error("an issued quotation offers Add item");
  const proposalId = quoteUrl.split("/").pop();
  const refused = asDbTry(5, `select crm_quote_save_header('${proposalId}', '{"currency":"USD"}'::jsonb)`);
  if (refused.ok || !/issued quotation cannot be edited/.test(refused.out)) throw new Error("database allowed an edit: " + refused.out);
});
await step("download the ISSUED quotation as PDF and Excel through the buttons: files open, totals match, fonts and logo embedded, not marked Draft", async () => {
  const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)");
  if (!/^QUO-UAE-\d{4}-0001-rev1\.pdf$/.test(pdf.name) || !/^QUO-UAE-\d{4}-0001-rev1\.xlsx$/.test(xlsx.name)) throw new Error(`file names ${pdf.name} / ${xlsx.name}`);
  const text = pdfText(pdf.file);
  if (!/139\.05/.test(text) || !/132\.43/.test(text) || !/2\.1\s+Stage deck/.test(text) || !/Civil works/.test(text)) throw new Error("PDF text is missing totals, numbering or exclusions");
  if (/DRAFT/.test(text)) throw new Error("issued PDF is marked draft");
  if (!/Carlito/.test(execFileSync("pdffonts", [pdf.file]).toString())) throw new Error("Carlito not embedded");
  if (!/image/.test(execFileSync("pdfimages", ["-list", pdf.file]).toString().split("\n").slice(2).join("\n"))) throw new Error("logo image not embedded");
  const c = await cells(xlsx.file);
  if (c.name !== "Quotation" || !c.rows.join("").includes("139.05") || !c.rows.join("").includes("132.43")) throw new Error("XLSX totals missing");
  if (c.rows.join("").match(/DRAFT/)) throw new Error("issued XLSX is marked draft");
  issuedDump = { pdf: text, xlsx: c.rows.join("\n") };
});
await step("later edits to the account, the company and the terms template do not change the issued copy", async () => {
  const before = sql(`select content_hash from crm_quotation_snapshots`);
  asDb(5, `select crm_update_organisation('${agency}', '{"vat_trn":"CHANGED-LATER"}'::jsonb)`);
  sql(`update companies set legal_name='Renamed After Issue' where id='${CO}'`);
  await page.reload({ waitUntil: "networkidle" });
  const frozen = (await page.getByTestId("issued-snapshot").innerText()).replace(/\s+/g, " ");
  if (!/Fictional Enginious UAE LLC/.test(frozen)) throw new Error("issuer name as issued missing");
  if (/CHANGED-LATER|Renamed After Issue/.test(frozen)) throw new Error("the issued copy shows a later edit");
  if (sql(`select content_hash from crm_quotation_snapshots`) !== before) throw new Error("snapshot changed");
  const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)");
  if (pdfText(pdf.file) !== issuedDump.pdf) throw new Error("the issued PDF changed after the account and company were edited");
  if ((await cells(xlsx.file)).rows.join("\n") !== issuedDump.xlsx) throw new Error("the issued XLSX changed after the account and company were edited");
  sql(`update companies set legal_name='Fictional Enginious UAE LLC' where id='${CO}'`);
});
await step("create revision: a new draft, same reference, revision 2; it needs its own approval; the issued one is untouched", async () => {
  await page.getByRole("button", { name: "Create revision" }).click();
  await page.waitForURL((u) => u.pathname.includes("/quotations/") && u.toString() !== quoteUrl);
  await has(/QUO-UAE-\d{4}-0001/, "same reference"); await has(/Revision 2/, "revision 2"); await has(/This is a DRAFT estimate/, "draft");
  await has(/Request a founder's approval/, "needs its own approval");
  await page.locator("#q-billto").selectOption(await optionValue(page.locator("#q-billto"), /Fictional Harbour Client \(end client\)/));
  await page.getByRole("button", { name: "Save details" }).click();
  await page.getByText(/Billed to: Fictional Harbour Client/).waitFor();
  await has(/VAT \/ TRN 000555/, "end client identifier with leading zeros shown");
});
await step("a DRAFT download (revision 2) is marked Draft in the file name, the PDF and the Excel sheet", async () => {
  const pdf = await download("Download PDF"); const xlsx = await download("Download Excel (.xlsx)");
  if (!/-rev2-DRAFT\.pdf$/.test(pdf.name) || !/-rev2-DRAFT\.xlsx$/.test(xlsx.name)) throw new Error(`draft names ${pdf.name} / ${xlsx.name}`);
  if (!/DRAFT, NOT ISSUED/.test(pdfText(pdf.file))) throw new Error("draft PDF has no Draft banner");
  const c = await cells(xlsx.file);
  if (c.name !== "Quotation DRAFT" || !String(c.ws.getCell(1, 1).value).startsWith("DRAFT, NOT ISSUED")) throw new Error("draft XLSX is not marked");
  if (/SECRET|internal/i.test(pdfText(pdf.file) + c.rows.join(""))) throw new Error("internal text in a draft export");
});
await step("direct-client enquiry: the end client is billed; a plain colleague who is not the owner is refused by the database", async () => {
  sql(`update crm_company_settings set approval_policy='not_required' where company_id='${CO}'`);
  await page.goto(`${BASE}/sales/opportunities/${oppDirect}?tab=quotations`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create draft estimate" }).click(); await page.waitForURL(/\/quotations\//);
  const directId = page.url().split("/").pop();
  await page.locator("#q-billto").selectOption(await optionValue(page.locator("#q-billto"), /Fictional Harbour Client \(end client\)/));
  await page.getByRole("button", { name: "Save details" }).click(); await page.getByText(/Billed to: Fictional Harbour Client/).waitFor();
  const refused = asDbTry(4, `select crm_quote_save_section('${directId}', null, 'Nope')`);
  if (refused.ok || !/owner of this opportunity or a founder/.test(refused.out)) throw new Error("non-owner was not refused: " + refused.out);
});
await step("a 45-line fictional BOQ issues and exports over several pages; page images for the app map", async () => {
  const directId = sql(`select proposal_id from crm_quotations order by created_at desc limit 1`);
  asDb(5, `select crm_quote_save_header('${directId}', '{"currency":"AED","validity_date":"2099-12-31"}'::jsonb)`);
  const vatId = sql(`select id from crm_quote_vat_choices where company_id='${CO}' and label='5%'`);
  asDb(5, `select crm_quote_save_header('${directId}', '{"vat_choice_id":"${vatId}"}'::jsonb)`);
  const sec = asDb(5, `select crm_quote_save_section('${directId}', null, 'Fictional fit-out')`);
  const sec2 = asDb(5, `select crm_quote_save_section('${directId}', null, 'Fictional lighting and AV')`);
  const lorem = "Powder-coated aluminium frame with integrated cable management, rigging points and a printed fascia, delivered, installed and struck on site.";
  for (let i = 1; i <= 45; i++) asDb(5, `select crm_quote_save_line('${directId}', null, '${i <= 26 ? sec : sec2}', '{"description":"Fictional item ${i} ${i % 7 === 0 ? lorem : "panel"}","unit":"pcs","quantity":"${i}","unit_price":"${(i * 12.5 + 0.33).toFixed(2)}"}'::jsonb)`);
  asDb(5, `select crm_quote_save_header('${directId}', '{"exclusions":[{"title":"Civil works","body":"Civil and MEPFS works are not included unless shown in the BOQ."}],"milestones":[{"label":"Deposit","kind":"percent","value":"40","due":"On acceptance"},{"label":"Balance","kind":"percent","value":"60","due":"On completion"}]}'::jsonb)`);
  asDb(5, `select crm_quote_issue('${directId}')`);
  await page.goto(`${BASE}/sales/opportunities/${oppDirect}/quotations/${directId}`, { waitUntil: "networkidle" });
  const pdf = await download("Download PDF");
  const text = pdfText(pdf.file);
  const pages = text.split("\f").filter((p) => p.trim());
  if (pages.length < 3) throw new Error(`expected a multi-page PDF, got ${pages.length}`);
  if (pages.filter((p) => /Unit price/.test(p) && /Excl\. VAT/.test(p)).length < 2) throw new Error("table header does not repeat");
  if (!/Page 2 of \d+/.test(text)) throw new Error("page numbers missing");
  execFileSync("pdftoppm", ["-png", "-r", "60", "-f", "1", "-l", "2", pdf.file, `${SHOTS}quotation-pdf`]);
  const x = await download("Download Excel (.xlsx)");
  const soffice = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", OUT, x.file], { encoding: "utf8", timeout: 120000 });
  if (soffice.status === 0) execFileSync("pdftoppm", ["-png", "-r", "50", "-f", "1", "-l", "1", `${OUT}/${x.name.replace(/\.xlsx$/, ".pdf")}`, `${SHOTS}quotation-xlsx`]);
});
await browser.close();
console.log(fails === 0 ? "VERDICT: PASS" : `VERDICT: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
