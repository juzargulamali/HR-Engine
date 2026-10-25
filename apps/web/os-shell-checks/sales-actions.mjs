// Clean end-to-end regression of the real Sales actions through the new ENGINIOUS OS interface (local stack only).
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const browser = await chromium.launch();
let page = await newPage(browser); await login(page, "ceo@e2e.local");
let fails = 0; let url = "";
const step = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0], "| dialog:", (await page.getByRole("dialog").allInnerTexts().catch(() => [])).join(" ").replace(/\s+/g, " ").slice(0, 300)); await page.screenshot({ path: `${SHOTS}/rfail-${name.replace(/\W+/g, "_")}.png`, fullPage: true }); if (url) await page.goto(url, { waitUntil: "networkidle" }); } };
const dialog = () => page.getByRole("dialog");
const text = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const main = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const tab = (name) => page.getByRole("tab", { name }).or(page.getByText(name, { exact: true })).first().click();
const seen = (re, ms = 10000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("main").innerText), re.source, { timeout: ms });
const closed = () => page.waitForFunction(() => !document.querySelector("dialog[open]"));

await step("add organisation (agency)", async () => {
  await page.goto(`${BASE}/sales/clients`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /add organisation/i }).first().click();
  await dialog().getByLabel(/name/i).first().fill("Zeta Media LLC"); await dialog().getByLabel(/type|kind/i).first().selectOption("agency");
  await dialog().getByRole("button", { name: /add|save|create/i }).last().click(); await page.getByText("Zeta Media LLC").first().waitFor({ timeout: 10000 });
});
await step("add contact", async () => {
  await page.getByRole("button", { name: /add contact/i }).first().click();
  await dialog().getByLabel(/^name/i).first().fill("Hana Al Mansoori"); await dialog().getByLabel(/email/i).fill("hana@zeta.example");
  await dialog().getByRole("button", { name: /add|save|create/i }).last().click(); await page.getByText("Hana Al Mansoori").first().waitFor({ timeout: 10000 });
});
await step("create enquiry (forced next action, reference issued)", async () => {
  await page.goto(`${BASE}/sales/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Requirement").fill("Interactive floor projection for showroom launch");
  await page.getByLabel("Where did it come from?").selectOption("agency_call");
  await page.locator("select").filter({ has: page.locator("option", { hasText: "Zeta Media LLC" }) }).first().selectOption({ label: "Zeta Media LLC" });
  await page.getByLabel("Next action").fill("Call Hana to qualify the brief"); await page.getByLabel("Budget or value").fill("170000");
  await page.getByRole("button", { name: /record enquiry/i }).click(); await page.waitForURL(/\/sales\/opportunities\/[0-9a-f-]{36}$/, { timeout: 15000 });
  url = page.url(); await seen(/OPP-UAE-\d{4}-0001/); // the page renders after the redirect: wait for the issued reference
});
await step("create enquiry through Quick Add (agency only, short form) lands on it in the side panel", async () => {
  await page.goto(`${BASE}/sales/follow-ups`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^add enquiry$/i }).first().click();
  const d = page.getByRole("dialog", { name: /add an enquiry/i }); await d.waitFor();
  await d.getByLabel("What is the enquiry?").fill("Quick-added lobby screen");
  await d.getByLabel("Agency", { exact: true }).selectOption({ label: "Zeta Media LLC" });
  await d.getByLabel("Where did it come from?").selectOption("website");
  await d.getByLabel("Next action").fill("Call to qualify"); await d.getByRole("button", { name: /^add enquiry$/i }).click();
  await page.waitForURL(/open=[0-9a-f-]{36}/, { timeout: 15000 }); await page.getByRole("dialog", { name: /quick-added lobby screen/i }).waitFor({ timeout: 15000 });
  if (sql("select count(*) from crm_opportunities where title='Quick-added lobby screen'") !== "1") throw new Error("expected exactly one new enquiry");
  if (!/^OPP-UAE-\d{4}-0002$/.test(sql("select reference from crm_opportunities where title='Quick-added lobby screen'"))) throw new Error("reference not issued in sequence");
  await page.goto(url, { waitUntil: "networkidle" });
});
const oppId = () => url.split("/").pop();
await step("completing the only follow-up demands the next action", async () => {
  await page.getByRole("button", { name: /complete/i }).first().click();
  await dialog().getByLabel(/what happened/i).fill("Spoke to Hana; wants options."); await dialog().getByLabel(/^next action/i).fill("Send two concept options"); await dialog().getByLabel(/^date/i).fill("2026-10-30");
  await dialog().getByRole("button", { name: /^complete$/i }).click(); await page.getByText("Send two concept options").first().waitFor({ timeout: 10000 });
});
await step("move stage to Qualified", async () => {
  await page.getByRole("button", { name: /^move stage$/i }).first().click(); await dialog().getByLabel("Move to").selectOption({ label: "Qualified" });
  await dialog().getByRole("button", { name: /^move stage$/i }).click(); await closed(); if (sql(`select stage from crm_opportunities where id='${oppId()}'`) !== "qualified") throw new Error("stage not saved");
});
await step("hold needs reason + review date, resume needs a next action", async () => {
  await page.getByRole("button", { name: /put on hold/i }).first().click();
  const rs = dialog().getByLabel(/reason/i).first(); if ((await rs.evaluate((e) => e.tagName)) === "SELECT") await rs.selectOption({ index: 1 }); else await rs.fill("Client postponed the event"); await dialog().getByLabel(/review date/i).fill("2026-11-20");
  await dialog().getByRole("button", { name: /put on hold|hold/i }).last().click(); await closed(); await seen(/On hold/);
  await page.getByRole("button", { name: /resume/i }).first().click(); await dialog().getByLabel(/next action/i).fill("Check in with Hana"); await dialog().getByLabel(/^date/i).fill("2026-11-21");
  await dialog().getByRole("button", { name: /resume/i }).last().click(); await closed();
});
await step("add a note", async () => {
  await tab("Activity & history"); await page.getByLabel(/what happened|note|details/i).first().fill("Hana confirmed the venue is Dubai Mall atrium.");
  await page.getByRole("button", { name: /add note|save note|add activity|add/i }).first().click(); await page.getByText("Hana confirmed the venue is Dubai Mall atrium.").first().waitFor({ timeout: 10000 });
});
await step("availability: request then record the check (founder)", async () => {
  await tab("Commercial");
  await page.getByRole("button", { name: /request.*check|request availability/i }).first().click(); await page.getByRole("button", { name: /record the check/i }).first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /record the check/i }).first().click(); await dialog().getByLabel("Note").fill("Two floor projectors free for the dates.");
  await dialog().getByRole("button", { name: /save the check/i }).click(); await closed(); await seen(/Available \(checked\)/);
});
await step("commercial approval stays 'not configured', no request button", async () => {
  if (!/not configured/i.test(await main())) throw new Error("missing wording"); if (await page.getByRole("button", { name: /request approval/i }).count()) throw new Error("request offered");
});
await step("link: https accepted, http refused", async () => {
  await tab("Proposals & files"); await page.getByText("Add a link", { exact: true }).first().click();
  const f = page.getByLabel(/^link|web address|url/i).first(); await f.fill("http://insecure.example/x"); await page.getByRole("button", { name: /add link|save link/i }).first().click(); await page.waitForTimeout(1200); if (await page.getByText("insecure.example").count()) throw new Error("http link was accepted");
  await f.fill("https://www.canva.com/design/abc"); await page.getByRole("button", { name: /add link|save link/i }).first().click(); await seen(/canva\.com/);
});
await step("proposal v1: draft, mark sent, then move to Proposal sent", async () => {
  await page.goto(url, { waitUntil: "networkidle" }); await tab("Proposals & files");
  await page.getByRole("button", { name: /add version 1 as a draft/i }).click(); await page.getByText(/Draft/).first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /mark.*sent|record.*sent/i }).first().click(); if (await dialog().count()) await dialog().getByRole("button", { name: /save|record|mark/i }).last().click(); await page.getByText(/Sent\b/).first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /^move stage$/i }).first().click(); await dialog().getByLabel("Move to").selectOption({ label: "Proposal sent" }); await dialog().getByRole("button", { name: /^move stage$/i }).click(); await closed();
  if (sql(`select stage from crm_opportunities where id='${oppId()}'`) !== "proposal_sent") throw new Error("not Proposal sent");
});
await step("Quote sent refused until the Zoho quote reference is saved, then allowed", async () => {
  await page.getByRole("button", { name: /^move stage$/i }).first().click(); await dialog().getByLabel("Move to").selectOption({ label: "Quote sent" });
  const disabled = await dialog().getByRole("button", { name: /^move stage$/i }).isDisabled(); await dialog().getByRole("button", { name: /^cancel$/i }).click(); if (!disabled) throw new Error("not blocked");
  await tab("Commercial"); await page.getByLabel(/Quote reference/i).fill("QT-1001"); await page.getByRole("button", { name: /save references/i }).click(); await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^move stage$/i }).first().click(); await dialog().getByLabel("Move to").selectOption({ label: "Quote sent" }); await dialog().getByRole("button", { name: /^move stage$/i }).click(); await closed();
  if (sql(`select stage from crm_opportunities where id='${oppId()}'`) !== "quote_sent") throw new Error("not Quote sent");
});
await step("contacts: add an existing shared contact with a role", async () => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /add a contact/i }).click(); await dialog().getByLabel("Role on this opportunity (optional)").fill("Day-to-day"); await dialog().getByRole("button", { name: /add to this opportunity/i }).click(); await closed();
  if (sql(`select role from crm_opportunity_contacts where opportunity_id='${oppId()}'`) !== "Day-to-day") throw new Error("link missing");
});
await step("contacts: edit the shared record (logged on the timeline)", async () => {
  await page.getByRole("button", { name: /edit contact/i }).first().click(); await dialog().getByLabel(/phone/i).fill("+971 50 111 2222"); await dialog().getByRole("button", { name: /save/i }).last().click(); await closed();
  if (sql("select phone from crm_contacts where name='Hana Al Mansoori'") !== "+971 50 111 2222") throw new Error("phone not saved");
  if (!/Contact details updated/.test(sql(`select string_agg(reason, '|') from crm_opportunity_events where opportunity_id='${oppId()}' and kind='contact'`))) throw new Error("no timeline event");
});
await step("contacts: add a new person and link them", async () => {
  await page.getByRole("button", { name: /add a contact/i }).click(); await dialog().getByText("A new person", { exact: true }).click(); await dialog().getByLabel(/^name/i).fill("Omar Khalid"); await dialog().getByLabel(/email/i).fill("omar@zeta.example"); await dialog().getByRole("button", { name: /create and add/i }).last().click(); await closed();
  if (sql(`select count(*) from crm_opportunity_contacts where opportunity_id='${oppId()}'`) !== "2") throw new Error("expected 2 links");
});
await step("contacts: remove from the opportunity (record kept)", async () => {
  await page.getByText("Remove from this opportunity", { exact: true }).last().click(); await page.waitForTimeout(600);
  if (await dialog().count()) { await dialog().getByRole("button", { name: /remove/i }).last().click(); await closed(); } else await page.waitForTimeout(1500);
  if (sql(`select count(*) from crm_opportunity_contacts where opportunity_id='${oppId()}'`) !== "1" || sql("select count(*) from crm_contacts") !== "2") throw new Error("unlink/keep failed");
});
await step("colleague who is not the owner sees no contact-changing buttons", async () => {
  const p2 = await newPage(browser); await login(p2, "emp@e2e.local"); await p2.goto(url, { waitUntil: "networkidle" });
  const b = (await p2.getByRole("button").allInnerTexts()).filter((t) => /add a contact|remove|edit contact|move stage|close as/i.test(t)); await p2.context().close(); if (b.length) throw new Error("buttons visible: " + b.join(","));
});
await step("close as won with PO evidence, then prepare handover", async () => {
  await page.goto(`${url}/close`, { waitUntil: "networkidle" }); await page.getByLabel("PO number").fill("PO-555"); await page.getByLabel("Date on the document").fill("2026-10-16");
  await page.getByRole("button", { name: /confirm as won/i }).click(); await page.waitForURL(new RegExp(oppId() + "$"), { timeout: 15000 }); if (!/Won/.test(await main())) throw new Error("not won");
  await page.goto(`${url}/handover`, { waitUntil: "networkidle" }); const handoverText = await main();
  // One process (Prepare brief, Submit, Assign PM, PM accepts, Project created); no second Project Manager or status form beside the brief.
  for (const step of ["Prepare brief", "Submit", "Assign PM", "PM accepts", "Project created"]) if (!handoverText.includes(step)) throw new Error("handover process step missing: " + step);
  if (/Save handover/.test(handoverText) || /Project Manager and status/.test(handoverText)) throw new Error("the duplicate Sales-side PM and status form is still offered");
  if (!/Project Manager/i.test(await main())) throw new Error("handover page not rendered");
});
await step("founder reopens with reason + new next action; closure history kept", async () => {
  await page.goto(url, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /^reopen/i }).first().click();
  await dialog().getByLabel("Why is it being reopened?").fill("Client asked to revise the scope"); await dialog().getByLabel(/what needs to happen/i).fill("Call Hana about the revised scope"); await dialog().getByLabel(/^date/i).first().fill("2026-10-25");
  await dialog().getByRole("button", { name: /reopen/i }).last().click(); await closed();
  if (sql(`select count(*) from crm_closures where opportunity_id='${oppId()}' and reopened_at is not null`) !== "1") throw new Error("closure not marked reopened");
  await tab("Activity & history"); await page.waitForTimeout(500); const hm = await main(); if (!/Reopened|reopened/.test(hm)) throw new Error("history does not show it: " + hm.slice(0, 400));
});
await step("reports count it as a later-reopened closure", async () => {
  await page.goto(`${BASE}/sales/reports`, { waitUntil: "networkidle" }); if (!/later reopened/.test(await main())) throw new Error("missing");
});
await step("Sales access page + settings keep 'Not configured' wording", async () => {
  await page.goto(`${BASE}/sales/settings`, { waitUntil: "networkidle" }); if (!/Not configured/i.test(await main())) throw new Error("settings wording");
  await page.goto(`${BASE}/sales/access`, { waitUntil: "networkidle" }); if (!/founder/i.test(await main())) throw new Error("access page empty");
});
console.log("client console/page errors:", page.errors.slice(0, 5));
await browser.close(); console.log(fails === 0 ? "\nALL REAL CRM ACTIONS PASSED" : `\n${fails} FAILED`); process.exit(fails ? 1 : 0);
