// WALKTHROUGH: Inventory Phase 1, ONE equipment job from the Sales availability check to the return, in a real browser as the real people (LOCAL STACK ONLY).
//   Sales (emp@, desktop) asks the warehouse to check an enquiry; the technician (hr1@, PHONE 390x844) answers it from Today; Sales sees the dated result with the
//   warehouse, the proposed dates, the equipment and "Availability checked · stock not reserved.". The job is won and handed over; the Project Manager (mgr@) accepts,
//   sees the same check on the project (flagged for review when a project date changes), ticks the TWO site runs the request serves, takes the dates suggested from
//   the Site schedule and sends the request to the warehouse. The technician, on the phone: Today (Do now / Coming up / Waiting on someone else), a SHORT reservation
//   (how many are missing, who acts), Pick items (a wrong and a repeated scan are said in place), Send equipment (what was picked is already ticked), then a PARTIAL
//   return with ONE DAMAGED unit (the result line, the unit out of availability, then cleared by the technician's inspection). The same equipment stays out across
//   the two runs on the SAME custody record. Operations (lead@) and the Project Manager read the same statuses under each run. Direct links and direct calls by
//   people without the right are refused.
// NEEDS: seed/inventory-phase1.sh (RESEED=1 reseeds first; the script writes to the database it drives). Fictional data only.
//   Usage: RESEED=1 node os-shell-checks/inventory-phase1-flow.mjs      screenshots: $SHOTS_DIR/inv1-*.png (default docs/inventory-screenshots)
import { makeRunner, maybeReseed, sql, asDb, asDbTry, until, sleep, rpc, refusal } from "./inventory-flow-lib.mjs";

maybeReseed("inventory-phase1.sh");
const R = makeRunner("inv1");
await R.start();
const { step, check, eq } = R;
const s1 = (q) => sql(q).split("\n")[0];
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 }, HD = { deviceScaleFactor: 2 };
const shot = (name) => R.shot(`inv1-${name}`);
const AE = "00000000-0000-4000-8000-00000000a001";
const OPP = s1("select id from crm_opportunities where title = 'Fictional Phase 1 roadshow'");
const DXB = s1("select id from inv_locations where code = 'DXB'");
const LAPTOP = s1("select id from inv_items where name = 'Laptop 14 inch'"), HDMI = s1("select id from inv_items where name = 'HDMI cable'");
const laptops = sql(`select code from inv_units where item_id = '${LAPTOP}' order by code`).split("\n").filter(Boolean);
const count = (q) => Number(s1(q));
const moves = (kind) => count(`select count(*) from inv_movements where kind = '${kind}'`);
const card = () => R.page.locator("section[aria-label='Warehouse stock check']");
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ");
const noSideways = async () => check(await R.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the page scrolls sideways at this width");
let PRJ = "", REQ = "", CODE = "";
check(OPP && DXB && laptops.length === 3, "the Phase 1 seed is not loaded (run with RESEED=1)");

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 1. Sales: the availability check on the enquiry
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await R.as("emp", DESK, "light", HD);
await step("Sales asks the warehouse to check the enquiry (nothing is reserved by asking)", async () => {
  await R.go(`/sales/opportunities?open=${OPP}`);
  await card().waitFor();
  await card().getByRole("button", { name: /Ask the warehouse to check/ }).click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel("Location to check against").selectOption({ label: "Dubai" });
  await R.dialog().getByRole("button", { name: "Ask the warehouse" }).click();
  await R.dialog().getByText(/The warehouse has been asked to check/).waitFor();
  await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
  await R.closedDialog();
  await until(() => count(`select count(*) from inv_availability_checks where opportunity_id = '${OPP}' and result = 'pending'`) === 1);
  eq(count("select count(*) from inv_reservations"), 0, "reservations after asking");
});

await R.as("hr1", PHONE, "light", HD);
await step("Technician (phone): Today names the company and the warehouse, and the Sales check is a job under Do now with one button", async () => {
  await R.go("/inventory");
  eq(await text(R.page.getByTestId("today-scope")), "Enginious UAE · Dubai", "company and warehouse on Today");
  const now = R.page.locator("section[aria-labelledby='today-now']");
  await now.waitFor();
  check(/Do now/.test(await text(now.locator("h2"))), "the first section is not Do now");
  const row = now.locator("li", { hasText: /Sales asks whether equipment is free/ });
  eq(await row.count(), 1, "Sales check rows under Do now");
  check(/Fictional roadshow laptop kit/.test(await text(row)), "the row does not name the equipment asked for");
  await noSideways();
  await shot("01-phone-today-sales-check");
  await row.getByRole("button", { name: /Check availability/ }).click();
  await R.dialog().waitFor();
  await R.dialog().getByRole("button", { name: "Record the check" }).click();
  await until(() => count(`select count(*) from inv_availability_checks where opportunity_id = '${OPP}' and result <> 'pending'`) === 1);
  eq(count("select count(*) from inv_reservations"), 0, "reservations after the check");
});

await R.as("emp", DESK, "light", HD);
await step("Sales sees the dated result: equipment, quantity, warehouse, proposed dates, and 'Availability checked · stock not reserved.'", async () => {
  await R.go(`/sales/opportunities?open=${OPP}`);
  await card().getByTestId("check-not-reserved").waitFor();
  const t = await text(card());
  check(/Availability checked · stock not reserved\./.test(t), "the line is missing: " + t.slice(0, 200));
  const facts = await text(card().getByTestId("check-facts"));
  check(/Checked \d.* by /.test(facts), "who and when: " + facts);
  check(/Warehouse Dubai/.test(facts), "the warehouse: " + facts);
  check(/Proposed dates checked \d+ \w+ \d{4} to \d+ \w+ \d{4}/.test(facts), "the proposed date range: " + facts);
  check(/Fictional roadshow laptop kit × 1/.test(t) && /Partly available/.test(t), "equipment, quantity and result: " + t.slice(0, 400));
  check(/Laptop 14 inch: short by 1/.test(t), "what is short: " + t.slice(0, 500));
  eq(s1(`select (covers ->> 'install_start') is not null and location_id = '${DXB}' and covers -> 'technologies' -> 0 ->> 'qty' = '1' from inv_availability_checks where opportunity_id = '${OPP}' and result <> 'pending'`), "t", "the check record holds the dates, the warehouse and the quantity");
  await card().scrollIntoViewIfNeeded();
  await shot("02-sales-availability-checked");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 2. Won, handed over, accepted: the Project Manager gets the scope and the check
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await step("the job is won and handed over (Sales prepares and submits, the founder names the Project Manager)", async () => {
  // Winning is recorded as the base seed records it (the Close page is covered by the Sales checks); the handover goes through the real functions as the real people.
  sql(`update crm_opportunities set stage = 'won', evidence_type = 'purchase_order', evidence_reference = 'PO-FICTIONAL-P1', evidence_date = current_date, closed_at = now(), closed_by = '00000000-0000-4000-8000-0000000000a5' where id = '${OPP}'`);
  const h = asDb(5, `select proj_save_handover('${OPP}', '{}'::jsonb)`);
  asDb(5, `select proj_submit_handover('${h}')`);
  asDb(3, `select proj_assign_handover_pm('${h}', '00000000-0000-4000-8000-0000000000a4')`);
  eq(s1(`select status from proj_handovers where id = '${h}'`), "pm_assigned", "handover status");
});

await R.as("mgr", DESK, "light", HD);
await step("Project Manager accepts the handover: one project, the approved equipment as a draft request, enquiry and project linked", async () => {
  await R.go("/projects/handovers");
  const btn = R.page.getByRole("button", { name: /^accept/i }).first();
  await Promise.all([R.page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 20000 }), btn.click()]);
  PRJ = s1(`select id from proj_projects where crm_opportunity_id = '${OPP}'`);
  check(PRJ, "no project is linked to the enquiry");
  await until(() => count(`select count(*) from inv_requests where project_id = '${PRJ}'`) === 1);
  REQ = s1(`select id from inv_requests where project_id = '${PRJ}'`); CODE = s1(`select code from inv_requests where id = '${REQ}'`);
  eq(s1(`select status || '/' || source from inv_requests where id = '${REQ}'`), "draft/sales_handover", "the request");
  eq(s1(`select string_agg(i.name || ' x' || trim_scale(l.qty)::text, ', ' order by l.sort_order) from inv_request_lines l join inv_items i on i.id = l.item_id where l.request_id = '${REQ}'`), "Laptop 14 inch x4, HDMI cable x6", "the approved equipment scope");
});

await step("Project Manager sees the relevant availability check on the project, not flagged while nothing changed", async () => {
  await R.go(`/projects/${PRJ}/equipment`);
  const p = R.page.getByTestId("project-sales-check");
  await p.waitFor();
  const t = await text(p);
  check(/Availability checked · stock not reserved\./.test(t) && /Warehouse Dubai/.test(t) && /Fictional roadshow laptop kit × 1/.test(t) && /Laptop 14 inch: short by 1/.test(t), "the check as Sales saw it: " + t.slice(0, 400));
  eq(await p.getAttribute("data-review"), "false", "flagged for review");
  await p.scrollIntoViewIfNeeded();
  await shot("03-pm-check-from-sales");
});

await step("when a project date changes the check is flagged for review, with the date then and now, and the check itself is not edited", async () => {
  const before = s1(`select md5(row_to_json(c)::text) from inv_availability_checks c where opportunity_id = '${OPP}' and result <> 'pending'`);
  sql(`update proj_project_details set event_end = event_end + 1 where project_id = '${PRJ}'`);     // a committed date moved (set-up: the Project details form is covered elsewhere)
  await R.go(`/projects/${PRJ}/equipment`);
  const p = R.page.getByTestId("project-sales-check");
  eq(await p.getAttribute("data-review"), "true", "flagged for review");
  check(/Review this check/.test(await text(p)) && /The event end was \d+ \w+ \d{4} when the check was made and is now \d+ \w+ \d{4}\./.test(await text(p)), "the review sentence: " + (await text(p)).slice(-400));
  eq(s1(`select md5(row_to_json(c)::text) from inv_availability_checks c where opportunity_id = '${OPP}' and result <> 'pending'`), before, "the check record");
  await p.scrollIntoViewIfNeeded();
  await shot("04-pm-check-flagged");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 3. Send to Warehouse: Leaves warehouse, Due back, the site runs served
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
await step("Project Manager: two site runs on the Site schedule (set-up through the real function)", async () => {
  const run = (f) => JSON.parse(asDb(4, `select proj_save_site_activity('${PRJ}', null, '${JSON.stringify(f)}'::jsonb)`)).id;
  run({ activity_kind: "show", title: "Fictional Run A", run_label: "Run A", location: "Fictional Expo Hall 3", start_date: day(11), end_date: day(12) });
  run({ activity_kind: "show", title: "Fictional Run B", run_label: "Run B", location: "Fictional Arena", start_date: day(16), end_date: day(17) });
  eq(count(`select count(*) from proj_plan_items where project_id = '${PRJ}' and plan = 'site'`), 2, "site runs");
});

await step("Send to Warehouse: the runs are ticked, dates are SUGGESTED from the Site schedule and shown in place, both runs read Covered, then it is sent", async () => {
  await R.go(`/projects/${PRJ}/equipment?request=${REQ}`);
  const form = R.page.getByTestId(`send-to-warehouse-${REQ}`);
  await form.waitFor();
  // the two dates are in the main form, empty: nothing is filled in silently
  eq(await form.getByLabel("Leaves warehouse", { exact: true }).inputValue(), "", "Leaves warehouse before a suggestion is taken");
  check(await form.getByLabel("Due back", { exact: true }).isVisible(), "Due back is not in the main form");
  check(!(await form.getByLabel("Installation starts").isVisible()), "the other dates are not under More dates");
  await form.getByLabel(/Fictional Run A/).check();
  await form.getByLabel(/Fictional Run B/).check();
  const sug = form.getByTestId("runs-suggestion");
  await sug.waitFor();
  check(/Suggested from the Site schedule/.test(await text(sug)) && /the day before Fictional Run A starts, the day after Fictional Run B ends/.test(await text(sug)), "the suggestion: " + (await text(sug)));
  await sug.getByRole("button", { name: "Use these dates" }).click();
  eq(await form.getByLabel("Leaves warehouse", { exact: true }).inputValue(), `${day(10)}T09:00`, "Leaves warehouse");
  eq(await form.getByLabel("Due back", { exact: true }).inputValue(), `${day(18)}T18:00`, "Due back");
  const covered = form.getByTestId("runs-covered");
  eq(await covered.locator("li[data-covered='true']").count(), 2, "runs covered");
  check(/The same equipment stays out from Fictional Run A to Fictional Run B/.test(await text(covered)), "the stays-out sentence");
  await form.scrollIntoViewIfNeeded();
  await shot("05-pm-send-to-warehouse");
  await form.getByRole("button", { name: "Save the dates and site runs" }).click();
  await until(() => count(`select count(*) from inv_request_runs where request_id = '${REQ}'`) === 2, 15000, "runs linked");
  await R.seen(/2 site runs are linked to this request/);
  await R.go(`/projects/${PRJ}/equipment?request=${REQ}`);
  await R.page.getByRole("button", { name: "Send to Warehouse" }).click();
  await until(() => s1(`select status from inv_requests where id = '${REQ}'`) === "submitted", 15000, "submitted");
  eq(count("select count(*) from inv_reservations"), 0, "sending reserved nothing");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 4. Warehouse Today, short reservation, pick, send (the technician, on a phone)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await R.as("hr1", PHONE, "light", HD);
const jobRow = (section) => R.page.locator(`section[aria-labelledby='today-${section}'] li`, { hasText: CODE });
await step("Technician (phone): the job is under Do now with the project, the date, what is not reserved yet, and goes straight to Prepare", async () => {
  await R.go("/inventory");
  const row = jobRow("now");
  eq(await row.count(), 1, "rows for the job under Do now");
  const t = await text(row);
  check(/Fictional Phase 1 roadshow needs its equipment prepared/.test(t) && /Leaves warehouse/.test(t), "what and when: " + t);
  check(/Laptop 14 inch: 4 of 4 not reserved yet/.test(t) && /HDMI cable: 6 of 6 not reserved yet/.test(t), "the quantities: " + t);
  await noSideways();
  await shot("06-phone-today-do-now");
  await row.getByRole("link", { name: /Prepare equipment/ }).click();
  await R.page.waitForURL(/step=prepare/);
  eq(await text(R.page.getByTestId("job-scope")), "Enginious UAE · Dubai", "company and warehouse on the job");
  const runs = R.page.getByTestId("job-runs");
  check(/Fictional Run A/.test(await text(runs)) && /Fictional Run B/.test(await text(runs)) && /The same equipment stays out between these runs/.test(await text(runs)), "the runs served: " + (await text(runs)).slice(0, 300));
});

await step("a SHORT reservation: 3 of the 4 laptops are reserved, the missing one is marked to rent, and the line is not shown as done", async () => {
  const reserve = async (name, fill) => {
    await R.page.getByRole("row", { name: new RegExp(name) }).first().getByRole("button", { name: "Reserve" }).click();
    await R.dialog().waitFor();
    if (fill) await fill(R.dialog());
    await R.dialog().getByRole("button", { name: "Reserve", exact: true }).click();
    await R.dialog().getByText(/Reserved \d/).first().waitFor();
    const said = await text(R.dialog());
    await R.page.keyboard.press("Escape");
    await R.closedDialog();
    return said;
  };
  const said = await reserve("Laptop 14 inch", async (d) => {
    await d.getByLabel("If not everything can be reserved, mark the rest as").selectOption("need_to_rent");
    await d.getByLabel("External reference of the rental").fill("FICTIONAL-RENT-1");
  });
  console.log("   reserve said:", said.slice(0, 220));
  await reserve("HDMI cable");
  await until(() => count(`select coalesce(sum(x.qty), 0) from inv_reservations x join inv_request_lines l on l.id = x.request_line_id where l.request_id = '${REQ}' and x.status = 'active'`) === 9, 15000, "reserved");
  eq(s1(`select inv_request_state('${REQ}') ->> 'state'`), "partially_ready", "request state");
  eq(s1(`select inv_request_state('${REQ}') ->> 'units_short'`), 1, "units short");
  eq(moves("dispatch_project"), 0, "dispatches after reserving");
  await R.go(`/inventory/requests/${REQ}?step=prepare`);
  check(/short by 1/.test(await R.mainText()), "the line does not say it is short by 1");
  await shot("07-phone-prepare-short");
});

await step("Today: the shortage waits on someone else (1 missing of 4, to rent, who acts); the job itself goes to Pick items", async () => {
  await R.go("/inventory");
  const w = jobRow("waiting");
  eq(await w.count(), 1, "rows under Waiting on someone else");
  const t = await text(w);
  check(/Laptop 14 inch: 1 missing of 4 · to rent \(rental FICTIONAL-RENT-1\)/.test(t), "how many are missing: " + t);
  check(/Who acts: To rent: whoever arranges the rental/.test(t), "who acts: " + t);
  const next = R.page.locator("section li", { hasText: CODE }).filter({ has: R.page.getByRole("link", { name: /Pick items/ }) });
  eq(await next.count(), 1, "one Pick items row for the job");
  check(/Laptop 14 inch × 3/.test(await text(next)) && /HDMI cable × 6/.test(await text(next)), "what is to pick: " + (await text(next)));
  await w.scrollIntoViewIfNeeded();
  await shot("08-phone-today-waiting-shortage");
  await next.getByRole("link", { name: /Pick items/ }).click();
  await R.page.waitForURL(/step=pick/);
});

await step("Pick: bins and the four quantities; a wrong code and a repeated scan are said in place; one action saves; no stock moves", async () => {
  const led = R.page.locator("section[data-item='Laptop 14 inch']");
  await led.waitFor();
  eq((await led.locator("[data-qty] dd").allInnerTexts()).join("/"), "4/3/0/0", "requested / reserved / picked / sent");
  check(/Short: 1 of 4 not reserved/.test(await text(led)), "the short line is not said on the pick list");
  check(/Bin A-01/.test(await text(led)), "the bin of a reserved unit: " + (await text(led)).slice(0, 300));
  check(/Bin B-02/.test(await text(R.page.locator("section[data-item='HDMI cable']"))), "the bin of counted stock");
  const box = R.page.getByLabel(/scan or type a code/i);
  const add = async (code) => { await box.fill(code); await R.page.getByRole("button", { name: "Add", exact: true }).click(); };
  await add("ENG-E-99999");
  check(/Wrong item: ENG-E-99999 is not reserved for this request/.test(await text(R.page.locator("[data-scan='bad']"))), "the wrong scan is not said");
  await add(laptops[0]);
  eq(await led.locator("input[type=checkbox]:checked").count(), 1, "ticked after a good scan");
  await add(laptops[0]);
  check(/Already scanned/.test(await text(R.page.locator("[data-scan='warn']"))), "the repeated scan is not said");
  eq(await led.locator("input[type=checkbox]:checked").count(), 1, "ticked after the repeated scan");
  await shot("09-phone-pick-scans");
  // the wrong code blocks the save until it is taken off; the working list is kept
  await R.page.getByRole("button", { name: /Take ENG-E-99999 off the list/ }).click();
  await led.getByRole("button", { name: /Tick all 3/ }).click();
  await R.page.locator("section[data-item='HDMI cable']").getByRole("button", { name: /^All 6/ }).click();
  const bar = R.page.getByTestId("pick-action");
  check(/Saving records 9 as picked for this request\. Nothing leaves the warehouse\./.test(await text(bar)), "the effect of saving: " + (await text(bar)));
  const box2 = await bar.getByRole("button", { name: "Pick items" }).boundingBox();
  check(box2 && box2.height >= 44 && box2.y + box2.height <= 844, "the primary action is not a large target within reach on the phone");
  await noSideways();
  await shot("10-phone-pick-ready");
  const before = { free: s1(`select inv_free_count('${LAPTOP}', '${DXB}', now() + interval '60 days', now() + interval '61 days')`), moves: count("select count(*) from inv_movements") };
  await bar.getByRole("button", { name: "Pick items" }).click();
  await R.page.locator("[data-step='pick-done']").waitFor();
  check(/Picked\. 9 are picked and waiting to be sent\. Next: the warehouse sends the equipment\./.test(await R.mainText()), "the confirmation: " + (await R.mainText()).slice(-300));
  eq(count(`select coalesce(sum(x.picked_qty), 0) from inv_reservations x join inv_request_lines l on l.id = x.request_line_id where l.request_id = '${REQ}'`), 9, "picked in the database");
  eq(count("select count(*) from inv_movements"), before.moves, "movements after picking");
  eq(s1(`select inv_free_count('${LAPTOP}', '${DXB}', now() + interval '60 days', now() + interval '61 days')`), before.free, "availability after picking");
  await shot("11-phone-pick-done");
});

await step("Send equipment: what was picked is already ticked and counted; one confirmation records ONE dispatch against the request; the short line stays open", async () => {
  await R.page.getByRole("link", { name: "Send equipment" }).click();
  await R.page.waitForURL(/step=send/);
  await R.page.locator("[data-step='send']").waitFor();
  eq(await R.page.locator("[data-step='send'] input[type=checkbox]:checked").count(), 3, "units ticked from the pick");
  eq(await R.page.getByLabel(/counted quantity/i).inputValue(), "6", "counted quantity from the pick");
  eq((await R.page.locator("section[aria-label='Laptop 14 inch'] [data-qty] dd").allInnerTexts()).join("/"), "4/3/3/0", "requested / reserved / picked / sent");
  await noSideways();
  await shot("12-phone-send-prefilled");
  await R.page.getByRole("button", { name: /^Send equipment \(9\)/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  eq(moves("dispatch_project"), 0, "dispatches before confirming");
  const confirm = R.page.getByRole("button", { name: /Confirm: send 9/ });
  await confirm.dblclick();                                                                    // a double tap sends one request
  await R.page.getByText("Recorded", { exact: true }).waitFor();
  await until(() => moves("dispatch_project") === 1, 15000, "one dispatch");
  await sleep(800);
  eq(moves("dispatch_project"), 1, "dispatch movements after a double tap");
  eq(s1(`select request_id from inv_movements where kind = 'dispatch_project'`), REQ, "the dispatch names the request");
  eq(s1(`select status from inv_requests where id = '${REQ}'`), "in_progress", "the request is not marked fulfilled while a line is short");
  eq(s1(`select inv_request_state('${REQ}') ->> 'state'`), "partially_dispatched", "request state");
  check(/What happens next/.test(await R.mainText()), "what happens next is not said");
  await shot("13-phone-send-recorded");
});

await step("the equipment stays out across the two site runs on the SAME custody record (one dispatch, no return and re-send in between)", async () => {
  eq(count(`select count(*) from inv_units where item_id = '${LAPTOP}' and custody_kind = 'project' and project_id = '${PRJ}'`), 3, "laptops in the project's custody");
  eq(count(`select count(*) from inv_movement_lines l join inv_units u on u.id = l.unit_id where u.item_id = '${LAPTOP}' and l.to_kind = 'project'`), 3, "one dispatch line per laptop");
  eq(count(`select count(*) from inv_movement_lines l join inv_units u on u.id = l.unit_id where u.item_id = '${LAPTOP}' and l.from_kind = 'project'`), 0, "returns between the runs");
  eq(count(`select count(*) from inv_balances where item_id = '${HDMI}' and holder_kind = 'project' and project_id = '${PRJ}'`), 1, "one custody row for the cables");
  const rows = JSON.parse(asDb(1, `select inv_project_run_cover('${PRJ}')`)).rows;
  eq(rows.length, 2, "runs that read the request");
  check(rows.every((r) => r.request_id === REQ && r.state === "partially_dispatched" && Number(r.units_out) === 9), "both runs read the same request, state and quantity out: " + JSON.stringify(rows.map((r) => [r.run_title, r.state, r.units_out])));
  check(rows.every((r) => new Date(r.due_back_at) > new Date(r.run_end)), "due back is after each run ends");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 5. Receive and inspect: a partial return with one damaged unit
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await step("Receive return starts from the dispatch (what went out is listed, nothing ticked); a partial return with one DAMAGED laptop says its result in one line", async () => {
  await R.go(`/inventory/requests/${REQ}?step=back`);
  await R.page.locator("[data-step='back']").waitFor();
  check(/Sent for /.test(await text(R.page.getByTestId("return-dispatches"))) && /\(9 sent\)/.test(await text(R.page.getByTestId("return-dispatches"))), "the original dispatch: " + (await text(R.page.getByTestId("return-dispatches"))));
  eq(await R.page.locator("[data-step='back'] input[type=checkbox]").count(), 3, "laptops listed from the dispatch");
  eq(await R.page.locator("[data-step='back'] input[type=checkbox]:checked").count(), 0, "ticked before anything is recorded");
  check(/sent on /.test(await R.mainText()), "the dispatch each unit left on is not shown");
  await R.page.getByLabel(new RegExp(`Laptop 14 inch · ${laptops[0]}`)).first().check();
  await R.page.getByLabel(new RegExp(`Laptop 14 inch · ${laptops[1]}`)).first().check();
  await R.page.getByLabel(/How many HDMI cable came back/).fill("4");
  const bar = R.page.getByTestId("receive-action");
  check(/Choose a condition for 3 lines/.test(await text(bar)), "the missing requirement is not said beside the action: " + (await text(bar)));
  await R.page.getByLabel(new RegExp(`Condition of Laptop 14 inch · ${laptops[0]}`)).selectOption("good");
  await R.page.getByLabel(new RegExp(`Condition of Laptop 14 inch · ${laptops[1]}`)).selectOption("damaged");
  await R.page.getByLabel(/Condition of HDMI cable/).selectOption("good");
  check(/After saving: 6 returned · 5 available · 1 held for inspection · 3 still out\./.test(await text(bar)), "the result line before saving: " + (await text(bar)));
  await noSideways();
  await shot("14-phone-receive-partial");
  await bar.getByRole("button", { name: /^Receive return/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  await R.page.getByRole("button", { name: /Confirm: receive return/ }).dblclick();
  await R.page.getByTestId("return-result").waitFor();
  check(/6 returned · 5 available · 1 held for inspection · 3 still out\./.test(await text(R.page.getByTestId("return-result"))), "the result line: " + (await text(R.page.getByTestId("return-result"))));
  await until(() => moves("return_project") === 1, 15000, "one return");
  await sleep(800);
  eq(moves("return_project"), 1, "return movements after a double tap");
  await shot("15-phone-receive-result");
  // only what was received changed: one laptop and two cables are still with the project
  eq(count(`select count(*) from inv_units where item_id = '${LAPTOP}' and custody_kind = 'project'`), 1, "laptops still out");
  eq(count(`select qty from inv_balances where item_id = '${HDMI}' and holder_kind = 'project' and project_id = '${PRJ}'`), 2, "cables still out");
  eq(s1(`select inv_request_state('${REQ}') ->> 'units_out'`), 3, "units out on the request");
});

const DAMAGED = () => s1(`select id from inv_units where code = '${laptops[1]}'`);
await step("the damaged laptop is out of availability, shown on Today as held, and people who are not warehouse staff there cannot clear it", async () => {
  eq(s1(`select condition || '/' || custody_kind from inv_units where id = '${DAMAGED()}'`), "damaged/warehouse", "the damaged unit");
  const freeLater = (unit) => s1(`select inv_unit_free('${unit}', now() + interval '60 days', now() + interval '61 days', '${DXB}')`);
  eq(freeLater(DAMAGED()), "f", "the damaged laptop is free for a later period");
  eq(freeLater(s1(`select id from inv_units where code = '${laptops[0]}'`)), "t", "the laptop that came back good is free for a later period");
  const before = Number(s1(`select inv_free_count('${LAPTOP}', '${DXB}', now() + interval '60 days', now() + interval '61 days')`));
  globalThis.FREE_BEFORE = before;
  const clear = `select inv_check_condition('${AE}', '${DXB}', 'inv1-clear-KEY', '[{"unit_id":"${DAMAGED()}","condition":"good","note":"Fictional inspection"}]'::jsonb)`;
  for (const [who, n] of [["the Project Manager", 4], ["Sales", 5], ["Operations", 7], ["a person with no access", 6]]) {
    const r = asDbTry(n, clear.replace("KEY", String(n)));
    check(!r.ok, `${who} cleared the damaged unit`);
  }
  eq(s1(`select condition from inv_units where id = '${DAMAGED()}'`), "damaged", "still damaged after the refused attempts");
  await R.go("/inventory");
  const held = R.page.locator("section[aria-labelledby='today-now'] li", { hasText: laptops[1] });
  eq(await held.count(), 1, "the held unit under Do now");
  check(/is held for checking/.test(await text(held)) && /Damaged/.test(await text(held)) && /not available until it is checked/.test(await text(held)), "the held row: " + (await text(held)));
  await held.scrollIntoViewIfNeeded();
  await shot("16-phone-today-held");
});

await step("the technician's inspection clears it: the unit is available again", async () => {
  // The inspection itself is the existing Inspect movement (inv_check_condition), recorded here as the technician through the real function.
  const out = JSON.parse(asDb(1, `select inv_check_condition('${AE}', '${DXB}', 'inv1-clear-technician', '[{"unit_id":"${DAMAGED()}","condition":"good","note":"Fictional inspection: bench tested"}]'::jsonb)`));
  check(out.lines[0].available === true, "the cleared unit is not reported available");
  eq(s1(`select inv_unit_free('${DAMAGED()}', now() + interval '60 days', now() + interval '61 days', '${DXB}')`), "t", "the cleared laptop is free for a later period");
  eq(s1(`select inv_free_count('${LAPTOP}', '${DXB}', now() + interval '60 days', now() + interval '61 days')`), globalThis.FREE_BEFORE + 1, "laptops free after the inspection");
  await R.go("/inventory");
  eq(await R.page.locator("section li", { hasText: `${laptops[1]} is held` }).count(), 0, "held rows after the inspection");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 6. Operations and the Project Manager read the same statuses, under each run
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await R.as("lead", DESK, "light", HD);
await step("Operations: each site run shows the request, its state and quantities, and the shortage with how many and who acts", async () => {
  await R.go("/operations");
  const p = R.page.getByTestId("ops-run-equipment");
  await p.waitFor();
  const runs = p.locator("li[data-run]");
  eq(await runs.count(), 2, "site runs listed for Operations");
  for (const name of ["Fictional Run A", "Fictional Run B"]) {
    const t = await text(p.locator(`li[data-run='${name}']`));
    // a request with a short line is never called Sent or Returned: it reads Partly sent, with the quantities
    check(new RegExp(CODE).test(t) && /Partly sent/.test(t) && /requested 10 · sent 9 · back 6 · out 3 · short 1/.test(t), `${name}: ` + t);
    check(/\d+ \w+ \d{4} to \d+ \w+ \d{4}/.test(t) && !/00:00/.test(t), `${name} dates: ` + t);
    check(/1 short on request .*: whoever arranges the rental rents it\./.test(t), `${name} exception: ` + t);
  }
  await p.scrollIntoViewIfNeeded();
  await shot("17-operations-equipment-by-run");
});

await R.as("mgr", DESK, "light", HD);
await step("Project Manager: the project's Equipment tab reads the same state under each run; the workspace offers no pick, send or receive to them", async () => {
  await R.go(`/projects/${PRJ}/equipment`);
  const p = R.page.getByTestId(`run-equipment-${PRJ}`);
  await p.waitFor();
  eq(await p.locator("li[data-run]").count(), 2, "site runs on the project");
  check(/Partly sent/.test(await text(p)) && /out 3 · short 1/.test(await text(p)), "the same state and quantities: " + (await text(p)).slice(0, 300));
  await p.scrollIntoViewIfNeeded();
  await shot("18-pm-equipment-by-run");
  await R.go(`/inventory/requests/${REQ}?step=pick`);
  check(/The warehouse sends equipment and receives it back/.test(await R.mainText()), "the Project Manager is offered the pick list");
  eq(await R.page.getByRole("button", { name: "Pick items" }).count(), 0, "Pick items for the Project Manager");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// 7. Direct links and direct calls enforce the same rules
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await step("a direct link to the job by Sales or by a person with no access shows no job; direct calls to pick, link runs and read run status are refused", async () => {
  for (const who of ["emp", "admin"]) {
    await R.as(who, DESK, "light", HD);
    await R.go(`/inventory/requests/${REQ}?step=pick`);
    const t = await R.mainText();
    check(/does not exist, or you do not have access/.test(t) || !/Laptop 14 inch/.test(t), `${who} sees the job: ` + t.slice(0, 200));
    check(!/Laptop 14 inch/.test(t) && !new RegExp(CODE).test(t), `${who} sees data of the job`);
  }
  const line = [{ unit_id: s1(`select id from inv_units where code = '${laptops[2]}'`) }];
  for (const who of ["emp", "mgr", "lead", "admin"]) {
    const r = await rpc(who, "inv_pick_for_request", { p_company_id: AE, p_location_id: DXB, p_request_id: REQ, p_key: `inv1-direct-${who}`, p_lines: line });
    check(r.status >= 400, `${who} picked through a direct call: ${JSON.stringify(r.body).slice(0, 120)}`);
    check(!/Laptop|ENG-E/.test(refusal(r)), `${who}'s refusal carries data: ${refusal(r)}`);
  }
  for (const who of ["emp", "admin"]) {
    const a = await rpc(who, "inv_set_request_runs", { p_request_id: REQ, p_plan_item_ids: [] });
    const b = await rpc(who, "inv_project_run_cover", { p_project_id: PRJ });
    const c = await rpc(who, "inv_project_sales_check", { p_project_id: PRJ });
    check(a.status >= 400 && b.status >= 400 && c.status >= 400, `${who} reached a Phase 1 function: ${a.status} ${b.status} ${c.status}`);
    check(/not found/i.test(refusal(b)) && /not found/i.test(refusal(c)), `${who} is not told "not found": ${refusal(b)} | ${refusal(c)}`);
  }
  eq((await rpc("mgr", "inv_company_run_cover", { p_company_id: AE })).status >= 400, true, "the Project Manager reading the company-wide run status");
  eq(count(`select count(*) from inv_request_runs where request_id = '${REQ}'`), 2, "run links after the refused calls");
});

await R.stop();
process.exit(R.verdict("Inventory Phase 1 walkthrough"));
