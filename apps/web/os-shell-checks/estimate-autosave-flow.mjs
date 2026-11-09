// ONE focused check of the estimate editor's automatic saving, in a real browser. LOCAL STACK ONLY, fictional data only. Needs `seed/sales.sh` (reseed before every run: it
// expects an empty Sales database) and the isolated stack (stack.sh build + start; the gateway includes the in-memory file store). Writes to the database it drives.
// Run: `node os-shell-checks/estimate-autosave-flow.mjs`. Screenshots (light, 1440 x 900): SHOTS_DIR (default /tmp/ea-shots).
//
//   emp@ (the enquiry owner) opens a NEW estimate and, WITHOUT EVER CLICKING "Save draft":
//     1. chooses VAT and types the first item -> the draft saves itself (Saving… then Saved);
//     2. adds a section straight away -> the typed item is saved first, the section is created once, there is still ONE draft;
//     3. types an item in the section and attaches a photo to it before the item has been saved -> the item is saved for the photo, the photo is attached to that item;
//     4. reloads -> the section, both items and the photo are still there, and the database holds exactly one draft, two sections (one hidden), two items, no copies;
//     5. edits an existing item, adds a third item with a photo, goes to Preview & finalise and presses Finalise while that save AND that upload are still pending
//        (every server call is slowed down so the wait can be seen) -> it says it is waiting, nothing is finalised until both are done, then the EXISTING finalisation
//        flow freezes the estimate with the latest edit and the third photo pinned in it.
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb } from "./inventory-flow-lib.mjs";
import { deflateSync } from "node:zlib";
import { mkdirSync } from "node:fs";

const CO = "00000000-0000-4000-8000-00000000a001";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/ea-shots"; mkdirSync(SHOTS, { recursive: true });
let fails = 0; let page;
const browser = await chromium.launch();
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/ea-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const expectEq = (got, want, what) => { if (String(got) !== String(want)) throw new Error(`${what}: expected ${want}, got ${got}`); };
const flat = (t) => t.replace(/\s+/g, " ");

// A real (tiny) PNG, made here so nothing is read from anywhere.
const crc = (buf) => { let c, crcv = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crcv ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c; } return (crcv ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
const png = (shade) => {
  const w = 16, h = 16, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, shade)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
const photo = (name, shade) => ({ name, mimeType: "image/png", buffer: png(shade) });

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");
const client = asDb(5, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE', p_vat_trn => '000555', p_trade_licence_no => '0123')`);
const opp = asDb(5, `select crm_create_opportunity(p_company_id => '${CO}', p_title => 'Fictional hall fit-out', p_source => 'agency_call', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}')`);
sql(`update crm_opportunities set currency='EUR' where id='${opp}'`);

page = await newPage(browser, { width: 1440, height: 900 }, "light", { deviceScaleFactor: 2 });
page.on("dialog", (d) => d.accept());
await login(page, "emp@e2e.local");
let proposalId = ""; let url = "";
// Save draft is never clicked in this flow: the button is simply not used.
const clickedSaveDraft = 0;
const state = () => page.getByTestId("save-state");
const waitSaved = () => page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.startsWith("Saved"), null, { timeout: 15000 });
const goStep = (label) => page.locator('nav[aria-label="Estimate steps"] button', { hasText: label }).click();
const loose = () => page.locator('section[aria-label="Items without a section"]');
const typeRow = async (li, desc, qty, price, unit = "") => {
  await li.locator("textarea").fill(desc); await li.getByPlaceholder("Unit", { exact: true }).fill(unit); await li.getByPlaceholder("Qty").fill(qty); await li.getByPlaceholder("Unit price").fill(price);
};
const count = (q) => Number(sql(q));
const lines = () => count(`select count(*) from crm_quotation_lines where proposal_id='${proposalId}'`);
const sections = () => sql(`select string_agg(title, ',' order by title) from crm_quotation_sections where proposal_id='${proposalId}'`);

await step("a new estimate opens with the draft saving by itself (no Save draft needed): VAT chosen and the first item typed are stored", async () => {
  await page.goto(`${BASE}/sales/opportunities/${opp}?tab=quotations`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Create draft estimate" }).click();
  await page.waitForURL(/\/quotations\//); url = page.url(); proposalId = url.split("/").pop();
  const st = flat(await state().innerText()); if (!/Changes are saved automatically/.test(st)) throw new Error(`state on open: ${st}`);
  const vat = page.locator("#est-vat");
  await vat.selectOption(await vat.locator("option").evaluateAll((os) => os.find((o) => /^5%$/.test(o.textContent))?.value));
  await waitSaved();
  expectEq(sql(`select count(*) from crm_quotations where proposal_id='${proposalId}' and vat_choice_id is not null and currency='EUR' and bill_to_org_id='${client}'`), 1, "VAT, currency and recipient saved without a click");
  await goStep("BOQ");
  await loose().getByRole("button", { name: "Add item" }).click();
  await typeRow(loose().locator("li").first(), "Stage deck", "3", "33.33", "m2");
  await waitSaved();
  expectEq(lines(), 1, "items stored after typing");
});

await step("Add section needs no Save draft: an item typed a moment ago is saved first, the section is created once, still ONE draft", async () => {
  await loose().getByRole("button", { name: "Add item" }).click();
  await typeRow(loose().locator("li").nth(1), "Fascia panels", "1.5", "19.99", "m2");   // typed, not yet saved (the automatic save has not fired)
  await page.getByLabel("Add a section (optional)").fill("AV");
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("heading", { name: "AV" }).waitFor();
  await waitSaved();
  expectEq(lines(), 2, "both items saved exactly once");
  expectEq(sections(), "(no section),AV", "sections: the hidden default one and AV, each once");
  expectEq(count(`select count(*) from crm_proposals where opportunity_id='${opp}'`), 1, "one proposal for the enquiry");
  expectEq(count(`select count(*) from crm_quotations where opportunity_id='${opp}'`), 1, "one estimate header");
});

let ledFile = "";
await step("a photo can be added to an item that is not saved yet: the item is saved for it and the photo lands on that very item (no copy)", async () => {
  await page.locator('section[aria-label="Section AV"]').getByRole("button", { name: "Add item to this section" }).click();
  const li = page.locator('section[aria-label="Section AV"] li').first();
  await typeRow(li, "LED wall", "7", "0.35", "m2");
  await li.locator('input[type="file"]').setInputFiles(photo("led-wall.png", 120));   // straight away: the item has NOT been saved
  await li.locator('img[alt^="Photo"]').waitFor({ timeout: 20000 });
  await waitSaved();
  expectEq(lines(), 3, "items after the photo (the item exists once)");
  expectEq(count(`select count(*) from crm_quotation_lines where proposal_id='${proposalId}' and description='LED wall' and image_file_id is not null`), 1, "the photo is on the LED wall item");
  ledFile = sql(`select image_file_id from crm_quotation_lines where proposal_id='${proposalId}' and description='LED wall'`);
  expectEq(count(`select count(*) from crm_files where id='${ledFile}' and purpose='proposal'`), 1, "one registered file");
  expectEq(clickedSaveDraft, 0, "Save draft clicks so far");
  await page.screenshot({ path: `${SHOTS}/1-boq-after-autosave.png` });
});

await step("reload: the section, both items and the photo are still there, and nothing was created twice", async () => {
  await page.reload({ waitUntil: "networkidle" }); await goStep("BOQ");
  const typed = await page.locator("main textarea").evaluateAll((els) => els.map((e) => e.value));   // item descriptions live in text boxes
  for (const need of ["Stage deck", "Fascia panels", "LED wall"]) if (!typed.includes(need)) throw new Error(`${need} is missing after the reload (${typed.join("|")})`);
  await page.getByRole("heading", { name: "AV" }).waitFor();
  await page.locator('section[aria-label="Section AV"] img[alt^="Photo"]').waitFor();
  expectEq(await page.locator('section[aria-label="Section AV"] li textarea').first().inputValue(), "LED wall", "the item in the section");
  expectEq(lines(), 3, "items"); expectEq(sections(), "(no section),AV", "sections");
  expectEq(count(`select count(*) from crm_proposals where opportunity_id='${opp}'`), 1, "proposals");
  expectEq(count(`select count(*) from crm_files where opportunity_id='${opp}'`), 1, "files");
  expectEq(sql(`select string_agg(description || ':' || quantity::text, ',' order by description) from crm_quotation_lines where proposal_id='${proposalId}'`), "Fascia panels:1.500,LED wall:7.000,Stage deck:3.000", "stored items");
});

await step("Finalise waits for a pending save and a pending upload, then uses the existing finalisation flow with the latest edit and the new photo pinned", async () => {
  // Slow every server call so the wait can be observed (the browser's direct upload to the file store as well).
  const DELAY = 2500; let slow = true;
  await page.route("**/*", async (route) => {
    const r = route.request();
    if (slow && r.method() === "POST" && r.headers()["next-action"]) await new Promise((ok) => setTimeout(ok, DELAY));
    if (slow && r.method() === "PUT" && r.url().includes("/storage/v1/object/upload/sign/")) await new Promise((ok) => setTimeout(ok, DELAY));
    await route.continue();
  });
  // an edit to a saved item (a pending save) and a new item with a photo (a pending upload), then straight to Finalise
  const first = loose().locator("li").first();
  await first.getByPlaceholder("Qty").fill("4");
  await loose().getByRole("button", { name: "Add item" }).click();
  const added = loose().locator("li").nth(2);
  await typeRow(added, "Rigging points", "2", "50", "pcs");
  await added.locator('input[type="file"]').setInputFiles(photo("rigging.png", 200));
  await goStep("Preview & finalise");
  await page.getByRole("checkbox", { name: /I have checked who this estimate is addressed to/ }).check();
  const button = page.getByRole("button", { name: "Finalise estimate" });
  if (await button.isDisabled()) throw new Error("Finalise is disabled while a save is pending (it should wait, not refuse)");
  expectEq(await page.getByTestId("finalise-pending").count(), 1, "the pending-changes note");
  await button.click();
  await page.getByTestId("finalise-wait").waitFor({ timeout: 5000 });
  const waiting = flat(await page.getByTestId("finalise-wait").innerText());
  if (!/Waiting for your changes and photos to finish saving/.test(waiting)) throw new Error(`wait text: ${waiting}`);
  await page.screenshot({ path: `${SHOTS}/2-finalise-waiting.png` });
  // While it waits nothing is frozen and the stored quantity is still the old one
  expectEq(sql(`select count(*) from crm_quotations where proposal_id='${proposalId}' and issued_at is not null`), 0, "nothing is finalised while saves are pending");
  expectEq(sql(`select quantity from crm_quotation_lines where proposal_id='${proposalId}' and description='Stage deck'`), "3.000", "the edit is not stored yet at that moment");
  slow = false;
  await page.waitForFunction(() => /Finalised on/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 60000 });
  expectEq(sql(`select count(*) from crm_quotations where proposal_id='${proposalId}' and issued_at is not null`), 1, "finalised once");
  expectEq(sql(`select quantity from crm_quotation_lines where proposal_id='${proposalId}' and description='Stage deck'`), "4.000", "the edit made just before finalising is in the finalised estimate");
  expectEq(lines(), 4, "items in the finalised estimate (no copies)");
  const snap = sql(`select jsonb_path_query_array(content, '$.sections[*].lines[*]')::text from crm_quotation_snapshots where proposal_id='${proposalId}'`);
  const rigging = JSON.parse(snap).find((l) => l.description === "Rigging points");
  if (rigging?.image?.bucket !== "quotation-assets" || !/^[0-9a-f]{64}$/.test(rigging.image.sha256 ?? "")) throw new Error(`the third photo is not pinned in the snapshot: ${JSON.stringify(rigging)}`);
  expectEq(count(`select count(*) from crm_files where opportunity_id='${opp}'`), 2, "two photos registered, one each");
  await page.screenshot({ path: `${SHOTS}/3-finalised.png` });
});

await page.context().close(); await browser.close();
console.log(fails ? `\n${fails} check(s) FAILED` : "\nALL CHECKS PASSED (Save draft was never clicked)");
process.exit(fails ? 1 : 0);
