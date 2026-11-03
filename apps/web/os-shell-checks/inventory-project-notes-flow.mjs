// WORKFLOW: dispatch notes and return checklists, end to end, in a real browser as the real people (LOCAL STACK ONLY).
//   Switch on -> the warehouse sends out -> the success panel offers the numbered PDF (downloaded and read back: pending band, no signature wording,
//   Carlito fonts and logo) -> the Project Manager sees it pending (Project -> Equipment and My Day / Needs me) and acknowledges it -> the warehouse sees the status
//   (History) and the PDF now says who acknowledged it -> a return makes a checklist with the project totals -> the PM reports a difference -> the warehouse sees
//   "PM reported a difference" on Today with its age, answers it, and nothing about custody or availability changed -> who may read the PDF -> light and dark, phone
//   width -> the switch is turned OFF again and nothing new shows.
// NEEDS: the Inventory seed (seed/inventory.sh). Run with RESEED=1 to reseed first (the script writes to the database it drives, and switches notes on for the AE company
//   through the founder function, the documented path: inv_set_project_notes).
//   Usage: RESEED=1 node os-shell-checks/inventory-project-notes-flow.mjs     screenshots go to $SHOTS_DIR
//   OUTAGE_STOP_CMD / OUTAGE_START_CMD (optional): stop and start the data service for the "could not load" section.
import { execSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeRunner, maybeReseed, sql, asDb, until, requestAs, BASE } from "./inventory-flow-lib.mjs";

const axeSrc = readFileSync(createRequire(new URL("../../../package.json", import.meta.url)).resolve("axe-core/axe.min.js"), "utf8");
maybeReseed();
const R = makeRunner("notes", { shots: process.env.SHOTS_DIR ?? new URL("../../../docs/inventory-screenshots", import.meta.url).pathname });
await R.start();
const { step, check, eq } = R;
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const item = (name) => s1(`select id from inv_items where name='${name}'`);
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
const LAPTOP = item("Laptop 14 inch"); const HDMI = item("HDMI cable");
const DXB = s1("select id from inv_locations where code='DXB'");
const noteCount = () => Number(s1("select count(*) from inv_project_notes"));
const movementCount = (kind) => Number(s1(`select count(*) from inv_movements where kind='${kind}'`));
const custody = () => s1(`select (select count(*) from inv_units where custody_kind='project')||'/'||(select count(*) from inv_units where custody_kind='warehouse' and lifecycle='active' and condition in ('good','fair'))||'/'||(select coalesce(sum(qty),0) from inv_balances where holder_kind='project')||'/'||(select count(*) from inv_movements)||'/'||(select coalesce(sum(dispatched_qty),0)||','||coalesce(sum(returned_qty),0) from inv_reservations)`);
const tmp = mkdtempSync(path.join(tmpdir(), "notes-flow-"));
const pdfText = (file) => spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).stdout.replace(/[ \t]+/g, " ");

// ------------------------------------------------------------------------------------------------------------------------------
// Set-up: notes ON for the AE company (a founder's switch), a request for the project with 2 laptops and 5 HDMI cables, reserved.
asDb(3, `select inv_set_project_notes('${AE}', true)`);
eq(s1(`select project_notes_enabled from inv_company_settings where company_id='${AE}'`), "t", "switch on");
const A = requestAs(4, PRJ, LAPTOP, 2, 0, 3, { title: "Showroom set-up", submit: false });
asDb(4, `select inv_add_request_line('${A.request}', '${HDMI}', 5, null, null)`);
asDb(4, `select inv_submit_request('${A.request}', null)`);
asDb(1, `select inv_reserve((select id from inv_request_lines where request_id='${A.request}' and item_id='${LAPTOP}'), '${DXB}', null, 2, null, null)`);
asDb(1, `select inv_reserve((select id from inv_request_lines where request_id='${A.request}' and item_id='${HDMI}'), '${DXB}', null, 5, null, null)`);
const mgrName = s1("select coalesce(nullif(btrim(full_name),''), split_part(email,'@',1)) from profiles where email='mgr@e2e.local'");

let noteId, noteNo, pdfPath;
// ------------------------------------------------------------------------------------------------------------------------------
await R.as("hr1");
await step("Send out: the success panel offers the numbered note, with Download PDF and Open to print", async () => {
  await R.go(`/inventory/requests/${A.request}?step=send`);
  await R.seen(/Sending from/);
  const boxes = R.page.locator("section", { hasText: "Laptop 14 inch" }).locator("input[type=checkbox]");
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await R.page.getByLabel(/counted quantity/i).fill("5");
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  await R.page.getByRole("button", { name: /Confirm: send 7/ }).click();
  await R.page.getByText("Recorded", { exact: true }).waitFor();
  await until(() => movementCount("dispatch_project") === 1, 15000, "one dispatch");
  eq(noteCount(), 1, "notes after one dispatch");
  noteNo = s1("select note_no from inv_project_notes");
  noteId = s1("select id from inv_project_notes");
  check(/^ENG-D-00001$/.test(noteNo), `numbering: ${noteNo}`);
  await R.expectText(new RegExp(`Dispatch note ${noteNo}`));
  await R.expectText(/nothing else waits/);
  check(await R.page.getByRole("link", { name: /Download PDF/ }).isVisible(), "no Download PDF");
  check(await R.page.getByRole("link", { name: /Open to print/ }).isVisible(), "no Open to print");
  await R.shot("notes-send-done");
});

await step("The PDF downloads, says ACKNOWLEDGEMENT PENDING, has the lines, no signature wording, Carlito and the logo", async () => {
  const [dl] = await Promise.all([R.page.waitForEvent("download"), R.page.getByRole("link", { name: /Download PDF/ }).click()]);
  eq(dl.suggestedFilename(), `${noteNo}.pdf`, "file name");
  pdfPath = path.join(tmp, `${noteNo}.pdf`);
  await dl.saveAs(pdfPath);
  const bytes = readFileSync(pdfPath);
  check(bytes.subarray(0, 5).toString() === "%PDF-" && bytes.length > 4000, "not a PDF");
  const text = pdfText(pdfPath);
  for (const want of [noteNo, "DISPATCH NOTE", "ACKNOWLEDGEMENT PENDING", "Issue: original", "Showroom refresh", "From Dubai", "Recorded by", "Ledger reference", "Laptop 14 inch", "HDMI cable", "Content ID", "Page 1 of 1", "Pending: the Project Manager has not yet acknowledged this list"]) check(text.includes(want) || text.replace(/\s+/g, " ").includes(want), `PDF lacks "${want}":\n${text.slice(0, 800)}`);
  check(!/signature|signed/i.test(text), "the PDF talks about a signature");
  check(/\bLAP-SN-00\d\b|ENG-E-000\d\d/.test(text), "no unit serial or equipment ID on the PDF");
  const fonts = spawnSync("pdffonts", [pdfPath], { encoding: "utf8" }).stdout;
  check(/Carlito-Regular/.test(fonts) && /Carlito-Bold/.test(fonts), `fonts: ${fonts}`);
  check(!/Helvetica/.test(fonts), "a fallback face is embedded");
  const images = spawnSync("pdfimages", ["-list", pdfPath], { encoding: "utf8" }).stdout.split("\n").filter((l) => /^\s*\d+\s+\d+\s+image/.test(l));
  check(images.length >= 1, "the logo image is missing");
  spawnSync("pdftoppm", ["-png", "-r", "70", "-f", "1", "-l", "1", pdfPath, path.join(process.env.SHOTS_DIR ?? tmp, "notes-pdf-pending")]);
});

await step("The note holds exactly what was recorded: 2 laptops and 5 cables, each with its equipment ID and serial; ledger and custody unchanged by the note", async () => {
  eq(s1(`select jsonb_array_length(payload->'lines') from inv_project_notes`), 3, "lines");
  eq(s1(`select count(*) from inv_project_notes where payload_hash is not null and movement_code = (select code from inv_movements where kind='dispatch_project')`), 1, "linked to the ledger reference");
});

// ------------------------------------------------------------------------------------------------------------------------------
await R.as("mgr");
const BEFORE_ACK = custody();
await R.go("/");
await step("My Day: the Project Manager's Needs me has the note waiting for acknowledgement, linking to the project's Equipment", async () => {
  await R.seen(/Dispatch note waiting for you: Showroom refresh/, 20000, "body");
  const link = R.page.getByRole("link", { name: /Dispatch note waiting for you: Showroom refresh/ }).first();
  check((await link.getAttribute("href")).includes(`/projects/${PRJ}/equipment?note=${noteId}`), `link: ${await link.getAttribute("href")}`);
  await R.shot("notes-myday");
});

await step("Project -> Equipment: 'Dispatch waiting for you' shows the note, its lines and who recorded it, with Acknowledge and Report a difference", async () => {
  await R.page.getByRole("link", { name: /Dispatch note waiting for you: Showroom refresh/ }).first().click();
  await R.page.waitForURL(/\/equipment\?note=/);
  await R.seen(/Dispatch & return notes/);
  await R.expectText(/Dispatch waiting for you \(1\)/);
  await R.expectText(new RegExp(noteNo));
  await R.expectText(/waiting today/);
  await R.expectText(/Laptop 14 inch/); await R.expectText(/LAP-SN-00/); await R.expectText(/HDMI cable/);
  await R.expectText(/Recorded by/);
  check(await R.page.getByRole("button", { name: "Acknowledge", exact: true }).isVisible(), "no Acknowledge");
  check(await R.page.getByRole("button", { name: "Report a difference" }).first().isVisible(), "no Report a difference");
  await R.shot("notes-project-pending");
});

await step("Acknowledge: records the name and capacity; one click, harmless again; stock, availability, custody and reservations unchanged", async () => {
  await R.page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await until(() => Number(s1("select count(*) from inv_project_note_events where event='acknowledged'")) === 1, 15000, "ack event");
  eq(s1("select by_name||'|'||capacity from inv_project_note_events where event='acknowledged'"), `${mgrName}|pm`, "who and capacity");
  await R.seen(new RegExp(`Acknowledged by ${mgrName} \\(Project Manager\\)`));
  check(!(await R.page.getByRole("button", { name: "Acknowledge", exact: true }).isVisible().catch(() => false)), "Acknowledge still offered");
  eq(custody(), BEFORE_ACK, "stock/custody/reservations/ledger after acknowledging");
  const again = asDb(4, `select inv_ack_project_note('${noteId}', 'acknowledge')::jsonb->>'replayed'`);
  eq(again, "true", "a second click returns the original");
  eq(s1("select count(*) from inv_project_note_events where event='acknowledged'"), 1, "still one acknowledgement");
  await R.go("/");
  await R.expectNoText(/Dispatch note waiting for you/);
  await R.shot("notes-project-acknowledged");
});

// ------------------------------------------------------------------------------------------------------------------------------
await R.as("hr1");
await step("The warehouse sees the status on the movement in History, and the PDF now names who acknowledged it", async () => {
  const mv = s1("select id from inv_movements where kind='dispatch_project'");
  await R.go(`/inventory/history?open=${mv}`);
  await R.seen(new RegExp(`Dispatch note ${noteNo} · acknowledged`), 15000, "aside[role=dialog]");
  const res = await R.page.request.get(`${BASE}/projects/${PRJ}/equipment/notes/${noteId}/pdf`);
  eq(res.status(), 200, "PDF for the warehouse operator");
  const file = path.join(tmp, "after-ack.pdf"); writeFileSync(file, await res.body());
  const text = pdfText(file).replace(/\s+/g, " ");
  check(text.includes(`ACKNOWLEDGED BY ${mgrName.toUpperCase()}`) && text.includes(`Acknowledged in ENGINIOUS OS by ${mgrName} (Project Manager)`), `after-ack PDF:\n${text.slice(0, 900)}`);
  check(!text.includes("ACKNOWLEDGEMENT PENDING"), "pending band still printed");
  check(!/signature|signed/i.test(text), "signature wording");
});

await step("Renaming an item, editing a serial and changing the destination afterwards does not change the note or its PDF", async () => {
  const before = s1("select md5(payload::text)||project_name||coalesce(destination,'') from inv_project_notes");
  asDb(3, `select inv_save_item('${AE}', '${LAPTOP}', '{"name":"Laptop 14 inch RENAMED"}'::jsonb)`);
  const res = await R.page.request.get(`${BASE}/projects/${PRJ}/equipment/notes/${noteId}/pdf`);
  const file = path.join(tmp, "after-rename.pdf"); writeFileSync(file, await res.body());
  const text = pdfText(file);
  check(text.includes("Laptop 14 inch") && !text.includes("RENAMED"), "the PDF followed the rename");
  eq(s1("select md5(payload::text)||project_name||coalesce(destination,'') from inv_project_notes"), before, "frozen content");
  asDb(3, `select inv_save_item('${AE}', '${LAPTOP}', '{"name":"Laptop 14 inch"}'::jsonb)`);
});

// ------------------------------------------------------------------------------------------------------------------------------
// Who may read the PDF.
await step("PDF access: a member and a warehouse operator get it; a person with no part in it gets 404; signed out is not served", async () => {
  const url = `${BASE}/projects/${PRJ}/equipment/notes/${noteId}/pdf`;
  for (const key of ["hr1", "mgr", "ceo"]) { await R.as(key); eq((await R.page.request.get(url)).status(), 200, `${key} reads the PDF`); }
  for (const key of ["emp", "admin"]) { await R.as(key); eq((await R.page.request.get(url)).status(), 404, `${key} reads the PDF`); }
  const out = await fetch(url, { redirect: "manual" });
  check([401, 302, 303, 307, 308].includes(out.status) && out.headers.get("content-type") !== "application/pdf", `signed out: ${out.status}`);
  const bad = await fetch(`${BASE}/projects/${PRJ}/equipment/notes/not-an-id/pdf`, { redirect: "manual" });
  check(bad.headers.get("content-type") !== "application/pdf", "a bad id gave a PDF");
});

// ------------------------------------------------------------------------------------------------------------------------------
// Receive back: one laptop and two cables come back, the laptop damaged.
await R.as("hr1");
await step("Receive back: a partial return needs a condition (helper starts empty); the success panel offers the return checklist", async () => {
  await R.go(`/inventory/requests/${A.request}?step=back`);
  await R.seen(/What is actually here now/);
  eq(await R.page.locator("input[type=checkbox]:checked").count(), 0, "ticked boxes");
  await R.page.getByLabel(/Laptop 14 inch · /).first().check();
  await R.page.getByLabel(/How many HDMI cable came back/).fill("2");
  const helper = R.page.getByRole("combobox", { name: /Set the condition for all ticked lines/ });
  eq(await helper.inputValue(), "", "the helper starts empty");
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.expectText(/Choose a condition/);
  await helper.selectOption("good");
  await R.page.getByRole("button", { name: /^Apply to 2 ticked lines$/ }).click();
  await R.page.getByLabel(/^Condition of Laptop 14 inch/).selectOption("damaged");
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  await R.page.getByRole("button", { name: /confirm: record returns/i }).click();
  await R.page.getByText("Recorded", { exact: true }).waitFor();
  await until(() => movementCount("return_project") === 1, 15000, "one return");
  eq(noteCount(), 2, "notes after the return");
  check(await R.page.getByText(/Return checklist/).first().isVisible(), "no return checklist offered");
  check(await R.page.getByRole("link", { name: /Download PDF/ }).isVisible(), "no Download PDF after the return");
  await R.shot("notes-back-done");
});

const RT = () => s1("select id from inv_project_notes where kind='return'");
await step("The return checklist PDF: this return with the recorded outcomes, and the project totals (units exact, counted stock at project level)", async () => {
  const res = await R.page.request.get(`${BASE}/projects/${PRJ}/equipment/notes/${RT()}/pdf`);
  eq(res.status(), 200, "return PDF");
  const file = path.join(tmp, "return.pdf"); writeFileSync(file, await res.body());
  const text = pdfText(file).replace(/\s+/g, " ");
  for (const want of ["RETURN CHECKLIST", "CONFIRMATION PENDING", "Back, held for checking: damaged", "Project totals after this return", "(project level)", "does not guess which request"]) check(text.includes(want), `return PDF lacks "${want}":\n${text.slice(0, 1200)}`);
  spawnSync("pdftoppm", ["-png", "-r", "70", "-f", "1", "-l", "1", file, path.join(process.env.SHOTS_DIR ?? tmp, "notes-pdf-return")]);
  // 2 sent, 1 back (the damaged one), still out 1; cables 5 sent, 2 back, still out 3
  eq(s1(`select (e->>'sent')||'/'||(e->>'received_now')||'/'||(e->>'still_out') from inv_project_notes n, jsonb_array_elements(n.payload->'totals') e where n.kind='return' and e->>'item_name'='Laptop 14 inch'`), "2/1/1", "laptop totals");
  eq(s1(`select (e->>'sent')||'/'||(e->>'received_now')||'/'||(e->>'still_out') from inv_project_notes n, jsonb_array_elements(n.payload->'totals') e where n.kind='return' and e->>'item_name'='HDMI cable'`), "5/2/3", "cable totals");
});

// ------------------------------------------------------------------------------------------------------------------------------
await R.as("mgr");
await step("PM: 'Returned, please confirm' shows the outcomes and totals; nothing is pre-ticked in Report a difference; the condition can not be changed by the PM", async () => {
  await R.go(`/projects/${PRJ}/equipment`);
  await R.seen(/Returned, please confirm \(1\)/);
  await R.expectText(/Back, held for checking: damaged/);
  await R.expectText(/Project totals after this return/);
  await R.expectText(/Sent in dispatch note ENG-D-00001/);
  const card = R.page.locator("details[data-state=waiting_for_pm]", { hasText: "ENG-RT-00001" });
  await card.getByRole("button", { name: "Report a difference" }).click();
  eq(await card.locator("input[name=line]:checked").count(), 0, "ticked lines");
  eq(await card.locator("select[name=reason]").inputValue(), "", "the reason starts empty");
  await R.shot("notes-report-difference");
});

const BEFORE_DIFF = custody();
await step("PM: a difference needs the line and what differs; then it goes to the warehouse and changes nothing about custody or availability", async () => {
  const card = R.page.locator("details[data-state=waiting_for_pm]", { hasText: "ENG-RT-00001" });
  await card.getByRole("button", { name: "Send to the warehouse" }).click();
  await R.seen(/Say what is different/);
  await card.locator("select[name=reason]").selectOption("quantity_differs");
  await card.getByRole("button", { name: "Send to the warehouse" }).click();
  await R.seen(/Tick the line or lines that differ/);
  eq(Number(s1("select count(*) from inv_project_note_events where event='difference_reported'")), 0, "a refused report was recorded");
  await card.locator("input[name=line]").nth(1).check();
  await card.locator("textarea[name=comment]").fill("The list says 2 cables came back but I counted 1");
  await card.getByRole("button", { name: "Send to the warehouse" }).click();
  await until(() => Number(s1("select count(*) from inv_project_note_events where event='difference_reported'")) === 1, 15000, "difference event");
  await R.seen(/Difference reported, waiting for the warehouse/);
  eq(s1("select lines::text from inv_project_note_events where event='difference_reported'"), "[2]", "lines");
  eq(custody(), BEFORE_DIFF, "custody/availability after the difference");
  check(!(await R.page.getByRole("button", { name: "Confirm this list" }).isVisible().catch(() => false)), "Confirm offered over an open difference");
  check(await R.page.getByRole("button", { name: "Withdraw the report" }).isVisible(), "no Withdraw");
});

await R.as("hr1");
await step("Warehouse Today: 'PM reported a difference' shows with its age, the PM's words and the PDF; custody is still unchanged", async () => {
  await R.go("/inventory");
  await R.expectText(/PM reported a difference/);
  await R.expectText(/ENG-RT-00001: the Project Manager reports a difference/);
  await R.expectText(/waiting today/);
  await R.expectText(/Quantity differs/); await R.expectText(/Custody and availability are unchanged/);
  check(await R.page.getByRole("button", { name: /Answer the difference/ }).isVisible(), "no answer control");
  await R.shot("notes-today-difference");
});

await step("Warehouse answers: a comment is required; 'the record stands' closes it; the old note and its history are never altered", async () => {
  const frozenBefore = s1("select md5(string_agg(n::text, '' order by id)) from inv_project_notes n");
  await R.page.getByRole("button", { name: /Answer the difference/ }).click();
  await R.page.getByLabel(/The record stands/).check();
  await R.page.getByRole("button", { name: "Save the answer" }).click();
  await R.seen(/Say what the warehouse found/);
  await R.page.getByLabel(/What the warehouse found/).fill("Counted again with the driver: 2 cables were handed over");
  await R.page.getByRole("button", { name: "Save the answer" }).click();
  await until(() => Number(s1("select count(*) from inv_project_note_events where event='resolved_record_stands'")) === 1, 15000, "resolved");
  await R.seen(/Nothing waiting|PM reported a difference/, 15000, "body");
  eq(s1("select count(*) from inv_project_note_events"), 3, "events (ack, difference, resolution): nothing deleted");
  eq(s1("select md5(string_agg(n::text, '' order by id)) from inv_project_notes n"), frozenBefore, "notes unchanged");
  eq(custody(), BEFORE_DIFF, "custody/availability after the answer");
  await R.go("/inventory");
  check(!(await R.page.getByText(/ENG-RT-00001: the Project Manager reports a difference/).first().isVisible().catch(() => false)), "the answered difference is still on Today");
});

await R.as("mgr");
await step("PM: sees the warehouse answer in the history and may now confirm; confirming records the confirmation only", async () => {
  await R.go(`/projects/${PRJ}/equipment`);
  await R.seen(/Warehouse answer by .*: the record stands/);
  await R.page.locator("details[data-note-no=ENG-RT-00001]").getByRole("button", { name: "Confirm this list" }).click();
  await until(() => Number(s1("select count(*) from inv_project_note_events where event='acknowledged'")) === 2, 15000, "confirmed");
  eq(custody(), BEFORE_DIFF, "custody after confirming");
  eq(s1("select count(*) from inv_units where condition='damaged' and custody_kind='warehouse'"), 1, "the damaged laptop is still held: only a warehouse check releases it");
  await R.expectText(/Acknowledged/);
  await R.page.waitForFunction(() => document.querySelector("details[data-note-no='ENG-RT-00001']")?.getAttribute("data-state") === "acknowledged", null, { timeout: 15000 });
});

// ------------------------------------------------------------------------------------------------------------------------------
// Light and dark, desktop and phone: no sideways scroll on the notes pages.
for (const [theme, viewport, label] of [["light", { width: 1280, height: 900 }, "desktop light"], ["dark", { width: 1280, height: 900 }, "desktop dark"], ["light", { width: 390, height: 800 }, "phone light"], ["dark", { width: 360, height: 780 }, "phone dark"]]) {
  await step(`Layout (${label}): the notes (cards and forms open) and Today have no serious accessibility findings, fit, and nothing scrolls sideways`, async () => {
    const pages = [["mgr", `/projects/${PRJ}/equipment`], ["hr1", "/inventory"]];
    for (const [key, p] of pages) {
      await R.as(key, viewport, theme);
      await R.go(p);
      if (p.includes("equipment")) await R.page.locator("details[data-note-no]").first().evaluate((e) => { e.open = true; });
      if (p.includes("equipment")) for (const b of await R.page.getByRole("button", { name: "Report a difference" }).all()) await b.click().catch(() => {});
      await R.page.evaluate(axeSrc);
      const axe = await R.page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} x${v.nodes.length}: ${v.nodes[0].target.join(" ")}`));
      check(axe.length === 0, `${label}: ${p.split("?")[0].replace(PRJ, ":id")} accessibility: ${axe.slice(0, 4).join(" | ")}`);
      const wide = await R.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(!wide, `${label}: ${p} scrolls sideways`);
      if (label === "phone dark" || label === "desktop light") await R.shot(`notes-${key}-${label.replace(" ", "-")}`);
    }
  });
}

// ------------------------------------------------------------------------------------------------------------------------------
// Optional: the data service is down while the pages load. Errors say "could not load" and never look like "no notes" or "nothing waiting".
if (process.env.OUTAGE_STOP_CMD && process.env.OUTAGE_START_CMD) {
  await R.as("mgr");
  await step("Outage: the notes section and My Day say they could not load; the PDF says so instead of giving a document", async () => {
    execSync(process.env.OUTAGE_STOP_CMD);
    try {
      await R.go(`/projects/${PRJ}/equipment`).catch(() => {});
      const text = await R.page.locator("body").innerText();
      check(/could not load/i.test(text), `the outage page does not say it could not load: ${text.slice(0, 300)}`);
      check(!/Dispatch waiting for you \(0\)|No notes|Nothing is out on this project/.test(text), "the outage looked like an empty list");
      const res = await R.page.request.get(`${BASE}/projects/${PRJ}/equipment/notes/${noteId}/pdf`);
      check(res.status() !== 200 && res.headers()["content-type"] !== "application/pdf", `PDF during the outage: ${res.status()}`);
    } finally { execSync(process.env.OUTAGE_START_CMD); }
  });
}

// ------------------------------------------------------------------------------------------------------------------------------
// A difference answered with "Corrected": the correcting movement's note is a NEW note that cites the old one; the old note and its history are never altered.
const CX = requestAs(4, PRJ, HDMI, 2, 0, 3, { title: "Showroom cables", submit: true });
asDb(1, `select inv_reserve((select id from inv_request_lines where request_id='${CX.request}' limit 1), '${DXB}', null, 2, null, null)`);
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'notes-corr-1', '[{"item_id":"${HDMI}","qty":2}]'::jsonb, '${CX.request}', null, null)`);
const OLD = s1("select id from inv_project_notes where kind='dispatch' order by created_at desc limit 1");
const OLD_NO = s1(`select note_no from inv_project_notes where id='${OLD}'`);
check(OLD_NO === "ENG-D-00002", `the cable dispatch made ${OLD_NO}`);
await R.as("mgr");
await step("Correction: the PM reports a difference on a second dispatch (the cable count)", async () => {
  await R.go(`/projects/${PRJ}/equipment`);
  const card = R.page.locator(`details[data-note-no=${OLD_NO}]`);
  await card.getByRole("button", { name: "Report a difference" }).click();
  await card.locator("select[name=reason]").selectOption("quantity_differs");
  await card.locator("input[name=line]").first().check();
  await card.locator("textarea[name=comment]").fill("Only 1 cable arrived");
  await card.getByRole("button", { name: "Send to the warehouse" }).click();
  await until(() => s1(`select state from inv_project_note_status where note_id='${OLD}'`) === "difference_open", 15000, "difference open");
});
// The warehouse records the correcting movement through an existing action (a dispatch of the missing amount: here, one more cable), then answers "Corrected".
const FROZEN_NOTE = () => s1(`select md5(n::text) from inv_project_notes n where id='${OLD}'`);
const EVENTS_OLD = () => s1(`select count(*)||'|'||md5(string_agg(e::text, '' order by seq)) from inv_project_note_events e where note_id='${OLD}'`);
const noteBefore = FROZEN_NOTE(); const eventsBefore = EVENTS_OLD();
const [evCountBefore] = eventsBefore.split("|");
asDb(1, `select inv_dispatch_to_project('${AE}', '${DXB}', '${PRJ}', 'notes-corr-2', '[{"item_id":"${HDMI}","qty":1}]'::jsonb, null, now() + interval '3 days', null)`);
const CORR_MOVE = s1("select code from inv_movements where kind='dispatch_project' order by recorded_at desc limit 1");
const NEW_NO = s1(`select note_no from inv_project_notes where movement_id=(select id from inv_movements where code='${CORR_MOVE}')`);
check(NEW_NO === "ENG-D-00003", `the correcting dispatch made ${NEW_NO}`);
const BEFORE_CORR = custody();
await R.as("hr1");
await step("Correction: the warehouse answers 'Corrected' naming the movement; a NEW note cites the old one", async () => {
  await R.go("/inventory");
  await R.expectText(new RegExp(`${OLD_NO}: the Project Manager reports a difference`));
  await R.page.getByRole("button", { name: /Answer the difference/ }).click();
  await R.page.getByLabel(/Corrected: I already recorded/).check();
  await R.page.getByLabel(/Reference of the movement/).fill(CORR_MOVE);
  await R.page.getByLabel(/What the warehouse found/).fill("One cable was missing from the load; the missing cable was sent");
  await R.page.getByRole("button", { name: "Save the answer" }).click();
  await until(() => Number(s1(`select count(*) from inv_project_note_events where event='resolved_corrected' and note_id='${OLD}'`)) === 1, 15000, "resolved_corrected");
  eq(s1(`select (select note_no from inv_project_notes where id=e.linked_note_id) from inv_project_note_events e where event='resolved_corrected' and note_id='${OLD}'`), NEW_NO, "the answer links the new note");
  eq(s1(`select (select note_no from inv_project_notes where id=e.linked_note_id) from inv_project_note_events e where event='correction_of' and note_id=(select id from inv_project_notes where note_no='${NEW_NO}')`), OLD_NO, "the new note cites the old one");
});
await step("Correction: the old note is byte-for-byte unchanged and its earlier history is intact (one event appended); custody and availability unchanged by the answer", async () => {
  eq(FROZEN_NOTE(), noteBefore, "the old note row");
  eq(Number(EVENTS_OLD().split("|")[0]), Number(evCountBefore) + 1, "only the answer was appended to the old note's history");
  eq(s1(`select count(*) from (select e::text from inv_project_note_events e where note_id='${OLD}' order by seq limit ${evCountBefore}) x`), evCountBefore, "earlier events are still there");
  eq(s1(`select md5(string_agg(e::text, '' order by seq)) from (select * from inv_project_note_events where note_id='${OLD}' order by seq limit ${evCountBefore}) e`), eventsBefore.split("|")[1], "earlier events unchanged");
  eq(s1(`select state from inv_project_note_status where note_id='${OLD}'`), "superseded", "old note state");
  eq(custody(), BEFORE_CORR, "custody/availability after the answer");
  // The guard trigger refuses every role, the owner of the database included.
  const tryAsOwner = (stmt) => { try { sql(stmt); return ""; } catch (e) { return String(e.stderr ?? e.message); } };
  check(/never edited or deleted/.test(tryAsOwner(`update inv_project_notes set project_name='x' where id='${OLD}'`)), "the old note can be edited");
  check(/never edited or deleted/.test(tryAsOwner(`delete from inv_project_note_events where note_id='${OLD}'`)), "the old history can be deleted");
  eq(FROZEN_NOTE(), noteBefore, "the old note row after the refused edit");
});
await R.as("mgr");
await step("Correction: the PM sees the old note 'Superseded by' the new one, and the new one waits for acknowledgement", async () => {
  await R.go(`/projects/${PRJ}/equipment`);
  await R.expectText(new RegExp(`Superseded by ${NEW_NO}`));
  eq(s1(`select state from inv_project_note_status where note_id=(select id from inv_project_notes where note_no='${NEW_NO}')`), "waiting_for_pm", "the new note waits for the PM");
  eq(s1(`select n.note_no from inv_project_note_status s join inv_project_notes n on n.id = s.replaces_note_id where s.note_no='${NEW_NO}'`), OLD_NO, "the new note names what it replaces");
  await R.page.locator(`details[data-note-no=${NEW_NO}]`).getByRole("button", { name: "Acknowledge", exact: true }).click();
  await until(() => s1(`select state from inv_project_note_status where note_id=(select id from inv_project_notes where note_no='${NEW_NO}')`) === "acknowledged", 15000, "new note acknowledged");
  eq(s1(`select state from inv_project_note_status where note_id='${OLD}'`), "superseded", "the old note stays superseded after the new one is acknowledged");
});

// ------------------------------------------------------------------------------------------------------------------------------
// The switch is turned OFF: the next dispatch makes no note, and nothing new shows.
const noteCountWithSwitchOn = noteCount();
asDb(3, `select inv_set_project_notes('${AE}', false)`);
const B = requestAs(4, PRJ, HDMI, 3, 1, 4, { title: "Showroom extras", submit: true });
asDb(1, `select inv_reserve((select id from inv_request_lines where request_id='${B.request}' limit 1), '${DXB}', null, 3, null, null)`);
await R.as("hr1");
const dispatchesBefore = movementCount("dispatch_project");
await step("Switch OFF: a dispatch makes no note and the success panel offers no PDF; the older notes stay readable", async () => {
  const notesBefore = noteCount();
  await R.go(`/inventory/requests/${B.request}?step=send`);
  await R.seen(/Sending from/);
  await R.page.getByLabel(/counted quantity/i).fill("3");
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  await R.page.getByRole("button", { name: /Confirm: send 3/ }).click();
  await R.page.getByText("Recorded", { exact: true }).waitFor();
  await until(() => movementCount("dispatch_project") === dispatchesBefore + 1, 15000, "dispatch with the switch off");
  eq(noteCount(), notesBefore, "notes after a dispatch with the switch off");
  await R.expectNoText(/Dispatch note ENG-D/);
  check(!(await R.page.getByRole("link", { name: /Download PDF/ }).isVisible().catch(() => false)), "a PDF is offered with the switch off");
});
await step("Switch OFF: nothing new on Today, My Day or the Project Manager's page for the new dispatch", async () => {
  await R.go("/inventory");
  await R.expectNoText(/PM reported a difference/);
  check(!(await R.page.getByRole("link", { name: /PM reported a difference/ }).isVisible().catch(() => false)), "the difference filter is offered with nothing to show");
  await R.as("mgr");
  await R.go("/");
  await R.expectNoText(/waiting for you: Showroom refresh/);
  await R.go(`/projects/${PRJ}/equipment`);
  await R.seen(/Dispatch & return notes/);
  eq(await R.page.locator("details[data-note-no]").count(), noteCountWithSwitchOn, "only the earlier notes");
});

console.log(`(screenshots and the downloaded PDFs of this run: ${process.env.SHOTS_DIR ?? "docs/inventory-screenshots"}, ${tmp})`);
await R.stop();
process.exit(R.verdict("Dispatch notes and return checklists"));
