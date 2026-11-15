// "Record as sent" stays; "Estimate sent" is not a pipeline stage any more (migration 20270111000100). LOCAL STACK ONLY, fictional data only. Needs
// `seed/sales.sh` (grants: ceo@ founder, mgr@ and emp@ plain) and writes to the database it drives, so reseed before every run.
// Run: `node os-shell-checks/estimate-sent-record-flow.mjs`.
//   1. emp@ (the enquiry owner) records a finalised estimate as sent on the Estimates tab: the dialog offers no stage move and says the stage stays; afterwards
//      the row shows the sent date, when it was recorded and by whom; the timeline names the exact revision and the date; the stage and version are unchanged;
//   2. the stage is offered nowhere for an ordinary enquiry: Move stage, the table's Stage filter, the board's lanes and its Move-to control;
//   3. the database refuses a move into it for the owner and the founder, and the call the previously deployed app makes (p_move = true) records the send and
//      leaves the stage alone; an estimate recorded as sent unlocks neither Proposal sent nor Quote sent;
//   4. an enquiry LEFT at Estimate sent (its records did not say where it belongs) still opens: it is labelled "stage no longer used", the page says what to
//      do, the board and Reports show it in its own lane / row, its old history lines stay readable; mgr@ (a colleague, not the owner) can read it and cannot
//      act; emp@ moves it out, and it cannot be moved back in;
//   5. ceo@ (a founder) can record an estimate as sent on a colleague's enquiry; mgr@ is offered nothing and refused by the database;
//   6. the migration's own move: an enquiry whose history shows it entered Estimate sent from Qualified goes back to Qualified with a system timeline line.
// Screenshots (light theme, 1440 x 900, scale 2): SHOTS_DIR (default /tmp/est-sent-shots).
import { chromium, newPage, login, BASE, psql as sql } from "./lib.mjs";
import { asDb, asDbTry } from "./inventory-flow-lib.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const CO = "00000000-0000-4000-8000-00000000a001";
const DB = process.env.LOCAL_DB_NAME ?? "hr_local_stack";
const MIGRATION = new URL("../../../supabase/migrations/20270111000100_crm_retire_estimate_sent_stage.sql", import.meta.url).pathname;
const browser = await chromium.launch();
let fails = 0; let page;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/est-sent-shots"; mkdirSync(SHOTS, { recursive: true });
const step = async (name, fn) => {
  try { await fn(); console.log("PASS", name); } catch (e) {
    fails++; console.log("FAIL", name, "::", String(e.message).split("\n")[0]);
    await page?.screenshot({ path: `/tmp/est-sent-fail-${name.replace(/\W+/g, "_").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
  }
};
const flat = (t) => t.replace(/\s+/g, " ");
const textOf = async (p = page) => flat(await p.locator("main").innerText());
const has = async (re, what, p = page) => { const t = await textOf(p); if (!re.test(t)) throw new Error(`${what}: not found /${re.source}/ in ${t.slice(0, 500)}`); };
const hasNot = async (re, what, p = page) => { const t = await textOf(p); if (re.test(t)) throw new Error(`${what}: unexpectedly found /${re.source}/`); };
const shot = (name, p = page) => p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const open = async (who) => { const p = await newPage(browser, { width: 1440, height: 900 }, "light", { deviceScaleFactor: 2 }); p.on("dialog", (d) => d.accept()); await login(p, who); return p; };
const STAGE_WORDS = /Estimate sent/;

if (sql("select count(*) from crm_organisations") !== "0") throw new Error("reseed first (seed/sales.sh): this run expects an empty Sales database");
sql(`update companies set legal_name='Fictional Enginious UAE LLC' where id='${CO}'`);
const client = asDb(5, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE')`);
const enq = (title, who = 5) => asDb(who, `select crm_create_opportunity(p_company_id => '${CO}', p_title => '${title}', p_source => 'direct_client', p_next_title => 'Call', p_next_due => now() + interval '2 days', p_client_org_id => '${client}')`);
const vat = sql(`select id from crm_quote_vat_choices where company_id='${CO}' and label='5%'`);
const finalEstimate = (opp, who = 5) => {
  const q = asDb(who, `select crm_quote_create('${opp}')`);
  asDb(who, `select crm_quote_save_header('${q}', '{"currency":"EUR","vat_choice_id":"${vat}","bill_to_org_id":"${client}","terms_label":"estimate-format:2","terms":[]}'::jsonb)`);
  const sec = asDb(who, `select crm_quote_save_section('${q}', null, 'Fabrication')`);
  asDb(who, `select crm_quote_save_line('${q}', null, '${sec}', '{"description":"Fictional stage deck","unit":"m2","quantity":"3","unit_price":"33.33"}'::jsonb)`);
  asDb(who, `select crm_quote_issue('${q}')`);
  return q;
};
const stageOf = (id) => sql(`select stage || '|' || version from crm_opportunities where id='${id}'`);
const admin = (statements) => execFileSync("psql", ["-h", "127.0.0.1", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-q"], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, input: statements });

const oppA = enq("Fictional estimate first hall"); asDb(5, `select crm_move_stage('${oppA}', 'qualified')`);
const estA = finalEstimate(oppA);
const refA = sql(`select reference from crm_quotations where proposal_id='${estA}'`);
// An enquiry left at the retired stage, as the migration leaves an ambiguous one: it went on to Quote sent and stepped back (history written by the functions of the time).
const oppL = enq("Fictional left at estimate sent");
const estL = finalEstimate(oppL);
admin(`insert into crm_estimate_sends (proposal_id, opportunity_id, company_id, reference, revision, sent_on, recorded_by) select q.proposal_id, q.opportunity_id, q.company_id, q.reference, q.revision, current_date, '00000000-0000-4000-8000-0000000000a5' from crm_quotations q where q.proposal_id='${estL}';
update crm_opportunities set stage='estimate_sent', version=version+1 where id='${oppL}';
insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, actor_id) values ('${oppL}', '${CO}', 'stage_changed', 'new', 'quote_sent', '00000000-0000-4000-8000-0000000000a5');
insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, actor_id, created_at) values ('${oppL}', '${CO}', 'stage_changed', 'quote_sent', 'estimate_sent', '00000000-0000-4000-8000-0000000000a5', now() + interval '1 second');`);

page = await open("emp@e2e.local");

await step("emp@ records the finalised estimate as sent: no stage move is offered, the dialog says the stage stays, and the stage and version do not change", async () => {
  const before = stageOf(oppA);
  await page.goto(`${BASE}/sales/opportunities/${oppA}?tab=quotations`, { waitUntil: "networkidle" });
  await has(/3\. Record as sent.*It records the exact revision and the date: nothing is emailed from here, and the enquiry.s stage does not change\./, "step 3 wording");
  await page.getByRole("button", { name: "Record estimate as sent" }).first().click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  const t = flat(await dlg.innerText());
  if (await dlg.getByRole("checkbox").count() || /Move the enquiry/.test(t)) throw new Error("the dialog offers a stage move");
  if (!t.includes("The enquiry stays at Qualified. Recording an estimate as sent does not move the enquiry")) throw new Error("the dialog does not say the stage stays: " + t.slice(0, 400));
  if (!t.includes("It is not a sent proposal, not a Zoho Books quote, not an approval and not a win.")) throw new Error("the dialog does not say what the record is not");
  await shot("pr1-10-record-as-sent-dialog");
  await dlg.getByRole("button", { name: "Record as sent" }).click();
  await page.getByText(/Sent to client/).first().waitFor();
  const rowLi = page.locator("li", { has: page.getByTestId("estimate-send-record") }).first();
  const row = flat(await rowLi.innerText());
  if (!/Sent to client \d{1,2} \w{3} \d{4}/.test(row) || !/recorded \d{1,2} \w{3} \d{4}.*by /.test(row)) throw new Error("the row does not show the sent date and who recorded it when: " + row);
  if (!row.includes(refA) || await rowLi.getByRole("button", { name: "Record estimate as sent" }).count()) throw new Error("the action is still offered for a revision already recorded");
  const send = sql(`select revision || '|' || reference || '|' || (sent_on = current_date) || '|' || (recorded_at > now() - interval '5 minutes') || '|' || (recorded_by = '00000000-0000-4000-8000-0000000000a5') from crm_estimate_sends where proposal_id='${estA}'`);
  if (send !== `1|${refA}|true|true|true`) throw new Error(`the send record: ${send}`);
  if (stageOf(oppA) !== before) throw new Error(`the stage or version changed: ${before} -> ${stageOf(oppA)}`);
  await shot("pr1-11-estimates-tab-recorded");
});
await step("the enquiry and its history show the record with the exact revision and date; the stage badge is still Qualified", async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppA}?tab=activity`, { waitUntil: "networkidle" });
  await has(new RegExp(`Estimate ${refA} revision 1 recorded as sent to the client on \\d{4}-\\d{2}-\\d{2}\\.`), "timeline line");
  await page.goto(`${BASE}/sales/opportunities/${oppA}`, { waitUntil: "networkidle" });
  await has(new RegExp(`Estimate ${refA}, revision 1, recorded as sent on`), "where it stands");
  await has(/Qualified/, "stage"); await hasNot(/Estimate sent \(stage no longer used\)|Move to Estimate sent/, "the retired stage on an ordinary enquiry");
  await shot("pr1-12-enquiry-summary-after-record");
});
await step("the stage is offered nowhere: Move stage, the Stage filter and the board (lanes and Move-to) have no Estimate sent", async () => {
  await page.getByRole("button", { name: "More", exact: true }).first().click(); await page.getByRole("menuitem", { name: /Move to another stage/ }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  const opts = await dlg.getByLabel("Move to").locator("option").allInnerTexts();
  if (opts.some((o) => STAGE_WORDS.test(o))) throw new Error("Move stage offers Estimate sent: " + opts.join(" | "));
  if (!opts.includes("Proposal sent") || !opts.includes("Quote sent")) throw new Error("Move stage options: " + opts.join(" | "));
  await page.keyboard.press("Escape");
  // Table filter and board, without the enquiry that was left at the stage (it is hidden for this look by putting it on another owner's list: search by title).
  await page.goto(`${BASE}/sales/opportunities?view=table&q=estimate+first`, { waitUntil: "load" }); await page.getByText("Fictional estimate first hall").first().waitFor();
  const html = await page.content();
  if (/>Estimate sent</.test(html)) throw new Error("the table page offers Estimate sent");
  await page.goto(`${BASE}/sales/opportunities?view=board&q=estimate+first`, { waitUntil: "load" }); await page.getByText("Fictional estimate first hall").first().waitFor();
  const lanes = await page.getByRole("heading", { level: 2 }).allInnerTexts().catch(() => []);
  if ((await textOf()).match(STAGE_WORDS)) throw new Error("the board shows an Estimate sent lane with no enquiry at it: " + lanes.join(" | "));
  await shot("pr1-13-board-without-the-stage");
});
await step("the database refuses a move into it (owner and founder); the earlier app's call with the move ticked records and leaves the stage; the send unlocks no gate", async () => {
  for (const who of [5, 3]) {
    const r = asDbTry(who, `select crm_move_stage('${oppA}', 'estimate_sent')`);
    if (r.ok || !/Estimate sent is no longer a pipeline stage/.test(r.out)) throw new Error(`move into the stage as ${who}: ${r.out}`);
  }
  const opp2 = enq("Fictional earlier app call"); const est2 = finalEstimate(opp2); const before = stageOf(opp2);
  const out = asDb(5, `select crm_record_estimate_sent('${est2}', current_date, true, null)`);
  if (!/"moved": ?false/.test(out) || !/"stage": ?"new"/.test(out)) throw new Error("the earlier app's call: " + out);
  if (stageOf(opp2) !== before || sql(`select count(*) from crm_estimate_sends where proposal_id='${est2}'`) !== "1") throw new Error("the earlier app's call moved the stage or did not record");
  for (const [to, re] of [["proposal_sent", /Record a proposal as sent before moving to Proposal sent/], ["quote_sent", /Record the Zoho Books quote reference before moving to Quote sent/]]) {
    const r = asDbTry(5, `select crm_move_stage('${oppA}', '${to}')`);
    if (r.ok || !re.test(r.out)) throw new Error(`an estimate send unlocked ${to}: ${r.out}`);
  }
});
await step("an enquiry LEFT at Estimate sent still opens for its owner: labelled as no longer used, told what to do, history readable, moves out offered and none in", async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppL}`, { waitUntil: "networkidle" });
  await has(/Estimate sent \(stage no longer used\)/, "the stage label");
  await has(/Move this enquiry to a current stage/, "the guide headline");
  await has(/Estimate sent is no longer a pipeline stage\. This enquiry was left here because its records did not show clearly which stage it belongs in\./, "why it is here");
  await has(/Choose its stage with Move stage\./, "what to do");
  await shot("pr1-14-left-at-retired-stage-owner");
  await page.getByRole("button", { name: "More", exact: true }).first().click(); await page.getByRole("menuitem", { name: /Move to another stage/ }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  const opts = await dlg.getByLabel("Move to").locator("option").allInnerTexts();
  if (opts.some((o) => STAGE_WORDS.test(o)) || !["Proposal preparation", "Proposal sent", "Quote sent", "Negotiation"].every((o) => opts.includes(o))) throw new Error("moves out of the retired stage: " + opts.join(" | "));
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/sales/opportunities/${oppL}?tab=activity`, { waitUntil: "networkidle" });
  await has(/Stage changed from Quote sent to Estimate sent \(stage no longer used\)\./, "the old history line");
});
await step("the board and Reports show it where it really is: its own lane and its own row, so the totals still add up", async () => {
  await page.goto(`${BASE}/sales/opportunities?view=board`, { waitUntil: "networkidle" });
  await has(/Estimate sent \(stage no longer used\)/, "the lane");
  await has(/Fictional left at estimate sent/, "the card");
  await shot("pr1-15-board-with-retired-lane");
  const ceo = await open("ceo@e2e.local");
  await ceo.goto(`${BASE}/sales/reports`, { waitUntil: "networkidle" });
  await has(/Estimate sent \(stage no longer used\)/, "the Reports row", ceo);
  await shot("pr1-16-reports-retired-row", ceo);
  await ceo.context().close();
});
await step("mgr@ (a colleague, not the owner) can read both enquiries and cannot act: no Move stage, no Record as sent, and the database refuses", async () => {
  const mgr = await open("mgr@e2e.local");
  await mgr.goto(`${BASE}/sales/opportunities/${oppL}`, { waitUntil: "networkidle" });
  await has(/Estimate sent \(stage no longer used\)/, "the colleague sees the stage", mgr);
  await has(/Its owner or a founder can move it to the right stage\./, "the colleague is told who can move it", mgr);
  const more = mgr.getByRole("button", { name: "More", exact: true });
  if (await more.count()) { await more.first().click(); const items = (await mgr.getByRole("menuitem").allInnerTexts()).join(" | "); if (/Move to another stage|hold|won|lost/i.test(items)) throw new Error("the colleague is offered: " + items); await mgr.keyboard.press("Escape"); }
  await shot("pr1-17-left-at-retired-stage-colleague", mgr);
  const opp3 = enq("Fictional colleague cannot record"); const est3 = finalEstimate(opp3);
  await mgr.goto(`${BASE}/sales/opportunities/${opp3}?tab=quotations`, { waitUntil: "networkidle" });
  await has(/Finalised/, "the colleague reads the estimate", mgr);
  if (await mgr.getByRole("button", { name: "Record estimate as sent" }).count()) throw new Error("the colleague is offered Record as sent");
  const r1 = asDbTry(4, `select crm_record_estimate_sent('${est3}', current_date, false, null)`);
  const r2 = asDbTry(4, `select crm_move_stage('${oppL}', 'proposal_prep')`);
  if (r1.ok || r2.ok) throw new Error(`the database let the colleague act: ${r1.out} / ${r2.out}`);
  if (sql(`select count(*) from crm_estimate_sends where proposal_id='${est3}'`) !== "0" || !stageOf(oppL).startsWith("estimate_sent|")) throw new Error("the colleague changed something");
  // A founder can, on a colleague's enquiry, through the screen.
  const ceo = await open("ceo@e2e.local");
  await ceo.goto(`${BASE}/sales/opportunities/${opp3}?tab=quotations`, { waitUntil: "networkidle" });
  const before = stageOf(opp3);
  await ceo.getByRole("button", { name: "Record estimate as sent" }).first().click();
  await ceo.getByRole("dialog").getByRole("button", { name: "Record as sent" }).click();
  await ceo.getByText(/Sent to client/).first().waitFor();
  if (sql(`select (recorded_by = '00000000-0000-4000-8000-0000000000a3')::text from crm_estimate_sends where proposal_id='${est3}'`) !== "true" || stageOf(opp3) !== before) throw new Error("the founder's record");
  await shot("pr1-18-founder-records-on-colleague-enquiry", ceo);
  await ceo.context().close(); await mgr.context().close();
});
await step("emp@ moves the left-behind enquiry out through Move stage; it cannot be moved back in, and its lane is gone", async () => {
  await page.goto(`${BASE}/sales/opportunities/${oppL}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "More", exact: true }).first().click(); await page.getByRole("menuitem", { name: /Move to another stage/ }).click();
  const dlg = page.getByRole("dialog"); await dlg.waitFor();
  await dlg.getByLabel("Move to").selectOption({ label: "Proposal preparation" });
  await dlg.getByRole("button", { name: /^move stage$/i }).click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  if (!stageOf(oppL).startsWith("proposal_prep|")) throw new Error("not moved out: " + stageOf(oppL));
  const back = asDbTry(5, `select crm_move_stage('${oppL}', 'estimate_sent')`);
  if (back.ok || !/no longer a pipeline stage/.test(back.out)) throw new Error("moved back in: " + back.out);
  await page.goto(`${BASE}/sales/opportunities?view=board`, { waitUntil: "networkidle" });
  await hasNot(/Estimate sent \(stage no longer used\)/, "the lane after the last enquiry left");
  await page.goto(`${BASE}/sales/opportunities/${oppL}?tab=activity`, { waitUntil: "networkidle" });
  await has(/Stage changed from Estimate sent \(stage no longer used\) to Proposal preparation\./, "the move out in history");
  await has(/Stage changed from Quote sent to Estimate sent \(stage no longer used\)\./, "the earlier history line is still there");
});
await step("the migration's own move: an enquiry that entered Estimate sent from Qualified goes back to Qualified, with a system line in its history; a second run changes nothing", async () => {
  const oppM = enq("Fictional moved by the update"); asDb(5, `select crm_move_stage('${oppM}', 'qualified')`);
  admin(`update crm_opportunities set stage='estimate_sent', version=version+1 where id='${oppM}';
insert into crm_opportunity_events (opportunity_id, company_id, kind, from_value, to_value, actor_id) values ('${oppM}', '${CO}', 'stage_changed', 'qualified', 'estimate_sent', '00000000-0000-4000-8000-0000000000a5');`);
  admin(`\\i ${MIGRATION}`);
  if (!stageOf(oppM).startsWith("qualified|")) throw new Error("the migration did not move it: " + stageOf(oppM));
  const again = stageOf(oppM); const events = sql(`select count(*) from crm_opportunity_events where opportunity_id='${oppM}'`);
  admin(`\\i ${MIGRATION}`);
  if (stageOf(oppM) !== again || sql(`select count(*) from crm_opportunity_events where opportunity_id='${oppM}'`) !== events) throw new Error("a second run changed something");
  await page.goto(`${BASE}/sales/opportunities/${oppM}?tab=activity`, { waitUntil: "networkidle" });
  await has(/Stage changed from Estimate sent \(stage no longer used\) to Qualified\. Estimate sent is no longer a pipeline stage\. Moved by the system update because the stage history shows it entered Estimate sent from qualified\./, "the system line");
  await has(/Stage changed from Qualified to Estimate sent \(stage no longer used\)\./, "the earlier line");
  await shot("pr1-19-history-after-system-move");
});
if (page.errors.length) { fails++; console.log("FAIL page errors ::", page.errors.slice(0, 5).join(" || ")); }
await browser.close();
console.log(fails === 0 ? "VERDICT: PASS" : `VERDICT: ${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
