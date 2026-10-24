// WORKFLOW 3: Sales check, changed dates, handover, in a real browser as the real people (LOCAL STACK ONLY).
//   emp@ (Sales owner) raises an open enquiry with technologies "Interactive floor" x2 and "Mystery rig" (no template anywhere)
//   -> the card says "Warehouse check required" for both, and never green
//   ceo@ (founder of Inventory AND Sales) creates the "Interactive floor" template from existing items, with alternatives, and marks it complete
//   emp@ asks the warehouse to check (the card says it reserves nothing), ceo@ records the check (summary level, who and when, nothing reserved)
//   the enquiry's dates are changed in the normal CRM edit screen -> the card says OUT OF DATE and the earlier check stays in history
//   Sales' screens never show cost or custody
//   the enquiry is won (nothing reserved by winning), then the REAL handover of the seeded Won opportunity (Interactive floor x1) is
//   prepared, submitted, assigned and accepted: the requirement snapshot arrives ONCE as a draft request on the new client project.
// NEEDS: the Inventory seed (seed/inventory.sh, which includes seed/base.sh's Won opportunity owned by emp@). RESEED=1 reseeds first.
//   Usage: RESEED=1 node os-shell-checks/inventory-flow-3-sales.mjs      screenshots go to docs/inventory-screenshots/
import { makeRunner, maybeReseed, sql, asDb, asDbTry, until, sleep } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("flow3");
await R.start();
const { step, check, eq } = R;
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const dayIso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const card = () => R.page.locator("section[aria-label='Warehouse stock check']");
const cardText = async () => (await card().innerText()).replace(/\s+/g, " ");
const sectionOf = (name) => card().locator("li", { hasText: name }).first();
const WON = s1("select id from crm_opportunities where stage='won' limit 1");
const itemId = (name) => s1(`select id from inv_items where name='${name}'`);
const cardTextAfter = async (fn) => { await fn(); await card().waitFor(); return cardText(); };
const shotCard = async (name) => { await card().scrollIntoViewIfNeeded(); await R.shot(name); };
const OPEN_TITLE = "Interactive floor for the Expo pavilion";
let OPP = "";

// ---------------------------------------------------------------------------------------------------------------------------
// 1. An open enquiry with technologies, before any template exists
// ---------------------------------------------------------------------------------------------------------------------------
await R.as("emp");
await step("Sales: the owner adds an open enquiry with two technologies, dates and a place (Quick Add)", async () => {
  await R.go("/sales/opportunities");
  await R.page.getByRole("button", { name: /^add enquiry$/i }).first().click();
  const d = R.page.getByRole("dialog", { name: /add an enquiry/i });
  await d.waitFor();
  await d.getByLabel("What is the enquiry?").fill(OPEN_TITLE);
  await d.getByLabel("Where did it come from?").selectOption("direct_client");
  await d.getByLabel("End client", { exact: true }).selectOption({ label: "Orbit Motors (Riyadh)" });
  await d.getByLabel("Next action").fill("Send the layout");
  await d.getByText("Add more details").click();
  await d.getByLabel("Event start").fill(dayIso(34));
  await d.getByLabel("Event end").fill(dayIso(37));
  await d.getByLabel("Installation", { exact: true }).fill(dayIso(30));
  await d.getByLabel("Location").fill("Expo Hall 3, Dubai");
  await d.getByLabel("Technology 1", { exact: true }).fill("Interactive floor");
  await d.getByLabel("Quantity of technology 1").fill("2");
  await d.getByRole("button", { name: "Add technology" }).click();
  await d.getByLabel("Technology 2", { exact: true }).fill("Mystery rig");
  await d.getByLabel("Quantity of technology 2").fill("1");
  await d.getByRole("button", { name: /^add enquiry$/i }).click();
  await R.page.waitForURL(/open=[0-9a-f-]{36}/, { timeout: 15000 });
  OPP = s1(`select id from crm_opportunities where title='${OPEN_TITLE}'`);
  eq(s1(`select jsonb_array_length(technologies) from crm_opportunities where id='${OPP}'`), 2, "two technologies saved");
  eq(s1("select count(*) from inv_reservations"), 0, "nothing reserved");
});
await step("before any check the card says Warehouse check required, never green, and that checking reserves nothing", async () => {
  await card().waitFor();
  const t = await cardText();
  console.log("   card:", t.slice(0, 300));
  check(/Warehouse check required/.test(t), "says warehouse check required");
  check(/Checking availability does not reserve anything/.test(t), "says that checking reserves nothing");
  check(!/\b(Available|Enough|In stock)\b/i.test(t), "no 'available' wording");
  eq(await card().locator("[data-tone]").first().getAttribute("data-tone"), "warn", "the headline tone is a warning, not good");
  await shotCard("flow3-card-before-check");
});
const asks = () => card().getByRole("button", { name: /Ask the warehouse to check|Ask again/ });
await step("Sales: the owner asks the warehouse to check (nothing is reserved, and the card says it is waiting)", async () => {
  await asks().click();
  await R.dialog().waitFor();
  const t = (await R.dialog().innerText()).replace(/\s+/g, " ");
  check(/Nothing is reserved/.test(t), "the dialog says nothing is reserved: " + t.slice(0, 200));
  await R.dialog().getByRole("button", { name: "Ask the warehouse" }).click();
  await R.dialog().getByText(/The warehouse has been asked to check/).waitFor();
  await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
  await R.closedDialog();
  await until(() => s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result='pending'`) === "1");
  await R.page.waitForFunction(() => /Waiting for the warehouse/.test(document.querySelector("aside[role=dialog]").innerText), null, { timeout: 15000 });
  console.log("   card:", (await cardText()).slice(0, 260));
  eq(s1("select count(*) from inv_reservations"), 0, "asking reserved nothing");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2. The founder (Inventory and Sales) records the check: with NO template every technology needs a warehouse check
// ---------------------------------------------------------------------------------------------------------------------------
await R.as("ceo");
const recordCheck = async (note) => {
  await R.go(`/sales/opportunities?open=${OPP}`);
  await card().getByRole("button", { name: "Record the check now" }).click();
  await R.dialog().waitFor();
  const t = (await R.dialog().innerText()).replace(/\s+/g, " ");
  check(/Nothing is reserved/.test(t), "the dialog says nothing is reserved");
  await R.dialog().getByLabel("Location to check against").selectOption({ label: "Dubai" });
  if (note) await R.dialog().getByLabel("Note (optional)").fill(note);
  await R.dialog().getByRole("button", { name: "Record the check" }).click();
  await R.dialog().getByText(/The check is recorded with your name and the time/).waitFor();
  await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
  await R.closedDialog();
};
await step("founder records the check with no template: both technologies read 'Warehouse check required' (summary, who and when, nothing reserved)", async () => {
  await recordCheck("First look, templates are still being written");
  await until(() => s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`) === "1");
  await card().getByText(/Checked by/).waitFor();
  const t = await cardText();
  console.log("   card:", t.slice(0, 500));
  check(/Checked by .+ on \d/.test(t), "who and when are shown");
  for (const name of ["Interactive floor", "Mystery rig"]) {
    const row = sectionOf(name);
    check(/Warehouse check required/.test(await row.innerText()), `${name}: warehouse check required`);
    check(!/emerald|green/.test((await row.locator("span.font-medium").last().getAttribute("class")) ?? ""), `${name} is not green`);
  }
  eq(s1("select count(*) from inv_reservations"), 0, "no reservation row after the check");
  await shotCard("flow3-card-checked-no-template");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 3. The founder writes and completes the template
// ---------------------------------------------------------------------------------------------------------------------------
await step("founder creates the technology template 'Interactive floor' from existing items, with alternatives, and marks it complete", async () => {
  await R.go("/inventory/manage?tech=new#technologies");
  const p = R.panel();
  await p.waitFor();
  await p.getByLabel("Name", { exact: true }).fill("Interactive floor");
  await p.getByLabel("Description (optional)").fill("Motorised LED floor with sensors, as sold in the Interactive floor packages");
  const parts = [
    ["Motor 2.2 kW", "2", ""], ["Motor controller", "2", ""], ["Sending card", "1", "Card"], ["Receiving card", "1", "Card"], ["HDMI cable", "2", ""],
  ];
  for (const [n, [item, qty, alt]] of parts.entries()) {
    if (n > 0) await p.getByRole("button", { name: "Add an item", exact: true }).click();
    const select = p.getByLabel(`Item ${n + 1}`, { exact: true });
    const label = (await select.locator("option").allInnerTexts()).find((o) => o.startsWith(item));
    check(label, `item ${item} is in the catalogue list`);
    await select.selectOption({ label });
    await p.locator(`#tech-qty-${n}`).fill(qty);
    if (alt) await p.locator(`#tech-alt-${n}`).fill(alt);
  }
  await R.shot("flow3-template-editor");
  await p.getByRole("button", { name: "Create template" }).click();
  await until(() => s1("select count(*) from inv_technologies where name='Interactive floor'") === "1");
  eq(s1("select status from inv_technologies where name='Interactive floor'"), "draft", "a new template starts as a draft");
  eq(s1("select count(*) from inv_technology_components c join inv_technologies t on t.id=c.technology_id where t.name='Interactive floor'"), 5, "five components");
  eq(s1("select count(*) from inv_technology_components c join inv_technologies t on t.id=c.technology_id where t.name='Interactive floor' and alt_group='Card'"), 2, "the two cards are alternatives of each other");
  await p.locator("#tech-status-select").selectOption("complete");
  await p.getByRole("button", { name: "Set status" }).click();
  await until(() => s1("select status from inv_technologies where name='Interactive floor'") === "complete");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 4. A second check, now that the template is complete
// ---------------------------------------------------------------------------------------------------------------------------
await R.as("emp");
await step("Sales asks again after the template is complete", async () => {
  await R.go(`/sales/opportunities?open=${OPP}`);
  await asks().click();
  await R.dialog().getByRole("button", { name: "Ask the warehouse" }).click();
  await R.dialog().getByText(/The warehouse has been asked to check/).waitFor();
  await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
  await R.closedDialog();
  await until(() => s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result='pending'`) === "1");
});
await R.as("ceo");
let CHECK2 = "";
await step("founder records the second check: Interactive floor x2 is summarised against stock (shortages shown), Mystery rig still needs a check, nothing is reserved", async () => {
  await recordCheck("After the Interactive floor template was completed");
  await until(() => s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`) === "2");
  await card().getByText(/After the Interactive floor template|Checked by/).first().waitFor();
  const t = await cardText();
  console.log("   card:", t.slice(0, 900));
  const floor = (await sectionOf("Interactive floor").innerText()).replace(/\s+/g, " ");
  console.log("   Interactive floor row:", floor);
  check(!/Warehouse check required/.test(floor), "Interactive floor now has an answer from stock");
  check(/short|shortage|Motor/i.test(floor), "its shortage is described at summary level (4 motors are needed, 2 exist): " + floor);
  check(/Warehouse check required/.test(await sectionOf("Mystery rig").innerText()), "Mystery rig (no template) still reads Warehouse check required");
  check(!/emerald|green/.test((await sectionOf("Mystery rig").locator("span.font-medium").last().getAttribute("class")) ?? ""), "Mystery rig is not green");
  check(/Checked by ceo on \d/.test(t), "who and when");
  eq(s1("select count(*) from inv_reservations"), 0, "no reservation row");
  eq(s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`), 2, "both checks are kept");
  CHECK2 = s1(`select id from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending' order by checked_at desc nulls last limit 1`);
  await shotCard("flow3-card-checked");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 5. The enquiry changes: the earlier check is out of date but stays in the history
// ---------------------------------------------------------------------------------------------------------------------------
const editDetails = async (fn) => {
  await R.go(`/sales/opportunities?open=${OPP}`);
  await R.panel().getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Edit details/ }).click();
  await R.dialog().waitFor();
  await fn(R.dialog());
  await R.dialog().getByRole("button", { name: "Save changes" }).click();
  await R.closedDialog();
};
await R.as("emp");
await step("the dates are changed in the normal CRM edit screen: the card says OUT OF DATE, shows the earlier check, and the check stays in the history", async () => {
  const before = await cardTextAfter(async () => { await R.go(`/sales/opportunities?open=${OPP}`); });
  check(!/Out of date/.test(before), "not out of date before the change");
  await editDetails(async (d) => {
    await d.getByLabel("Installation starts").fill(dayIso(52));
    await d.getByLabel("Show starts").fill(dayIso(56));
    await d.getByLabel("Show ends").fill(dayIso(59));
  });
  await until(() => s1(`select install_start from crm_opportunities where id='${OPP}'`) === dayIso(52));
  await R.page.waitForFunction(() => /Out of date/.test(document.querySelector("aside[role=dialog]")?.innerText ?? ""), null, { timeout: 15000 });
  const t = await cardText();
  console.log("   card:", t.slice(0, 520));
  check(/Out of date/.test(t) && /Ask the warehouse to check again/.test(t), "says it is out of date and to ask again");
  check(/Checked by ceo on/.test(t), "the earlier check is still shown (who and when)");
  eq(s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`), 2, "both earlier checks are still in the history");
  eq(s1("select count(*) from inv_reservations"), 0, "no reservation");
  await shotCard("flow3-card-out-of-date");
});
await R.as("ceo");
await step("a fresh check clears 'out of date'; changing a quantity makes it out of date again", async () => {
  await recordCheck("Dates moved by Sales");
  await until(() => s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`) === "3");
  await R.page.waitForFunction(() => !/Out of date/.test(document.querySelector("aside[role=dialog]")?.innerText ?? "") && /Dates moved by Sales/.test(document.querySelector("aside[role=dialog]")?.innerText ?? ""), null, { timeout: 15000 });
  await R.as("emp");
  await editDetails(async (d) => { await d.getByLabel("Quantity of technology 2").fill("3"); });
  await until(() => s1(`select (technologies->1->>'qty') from crm_opportunities where id='${OPP}'`) === "3");
  await R.page.waitForFunction(() => /Out of date/.test(document.querySelector("aside[role=dialog]")?.innerText ?? ""), null, { timeout: 15000 });
  eq(s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`), 3, "three checks kept");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 6. Sales never sees cost or who holds equipment
// ---------------------------------------------------------------------------------------------------------------------------
const MAX = "00000000-0000-4000-8000-0000000000e4";
await step("set-up: a laptop with a purchase cost is issued to Max Manager (real function, as the operator), so cost and custody exist in the books", async () => {
  sql(`insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency, entered_by) select company_id, item_id, id, current_date, 4321.00, 'AED', '00000000-0000-4000-8000-0000000000a3' from inv_units where serial_number='LAP-SN-001'`);
  const DXB = s1("select id from inv_locations where code='DXB'");
  const unit = s1("select id from inv_units where serial_number='LAP-SN-002'");
  asDb(1, `select inv_issue_to_employee('${AE}','${DXB}','${MAX}','flow3-issue-0000001','[{"unit_id":"${unit}"}]'::jsonb)`);
  eq(s1("select custody_kind || '/' || employee_id from inv_units where serial_number='LAP-SN-002'"), `employee/${MAX}`, "the laptop is with Max");
});
const SALES_PRIVATE = /4321|4,321|1250|LAP-SN|ENG-E-0|ENG-M-|Max Manager|Hugo Drafter|With an employee|custody|unit_cost|purchase cost|inv_costs|serial_number/i;
await R.as("emp");
await step("Sales screens (list, panel, full page, handover) carry no cost, no unit, no holder (page and page source), and the database agrees", async () => {
  const pages = ["/sales/opportunities", `/sales/opportunities?open=${OPP}`, `/sales/opportunities/${OPP}`, `/sales/opportunities/${WON}`, `/sales/opportunities/${WON}/handover`, `/sales`];
  for (const path of pages) {
    await R.go(path);
    const blob = (await R.page.content()) + "\n" + (await R.page.locator("body").innerText());
    const hit = blob.match(SALES_PRIVATE);
    check(!hit, `${path}: Sales sees "${hit?.[0]}"`);
  }
  eq(asDb(5, "select count(*) from inv_costs"), 0, "Sales cannot read costs");
  eq(asDb(5, "select count(*) from inv_units"), 0, "Sales cannot read units");
  eq(asDb(5, "select count(*) from inv_movements"), 0, "Sales cannot read movements");
  const r = asDbTry(5, `select inv_opportunity_availability('${OPP}')::text`);
  check(r.ok, "Sales may read its own enquiry's check summary");
  check(!/4321|LAP-SN|ENG-E|Max Manager|unit_code|employee/i.test(r.out), "and the summary has no cost, unit or person in it: " + r.out.slice(0, 200));
  // the control: a founder DOES see cost and holder where they belong
  await R.as("ceo");
  await R.go(`/inventory?unit=${s1("select code from inv_units where serial_number='LAP-SN-001'")}`);
  check(/4,321|4321/.test(await R.page.locator("aside[role=dialog]").innerText()), "control: the founder sees the cost on the unit page");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 7. Winning reserves nothing
// ---------------------------------------------------------------------------------------------------------------------------
await R.as("emp");
await step("Sales wins the enquiry with a purchase order: nothing is reserved and no equipment request appears by itself", async () => {
  await editDetails(async (d) => { await d.getByLabel("Value", { exact: true }).fill("180000"); });
  await until(() => s1(`select value from crm_opportunities where id='${OPP}'`).startsWith("180000"));
  await R.go(`/sales/opportunities/${OPP}/close`);
  await R.page.getByLabel("PO number").fill("PO-FLOW3-1");
  await R.page.getByLabel("Date on the document").fill(dayIso(0));
  await R.shot("flow3-close-as-won");
  await R.page.getByRole("button", { name: /confirm as won/i }).click();
  await R.page.waitForURL(new RegExp(OPP + "$"), { timeout: 15000 });
  eq(s1(`select stage from crm_opportunities where id='${OPP}'`), "won", "won");
  eq(s1("select count(*) from inv_reservations"), 0, "winning reserved nothing");
  eq(s1("select count(*) from inv_requests"), 0, "no equipment request was made by winning");
  eq(s1("select count(*) from inv_movements where kind in ('dispatch_project','issue_employee') and recorded_at > now() - interval '5 minutes' and project_id is not null"), 0, "nothing was dispatched");
  eq(s1(`select count(*) from inv_availability_checks where opportunity_id='${OPP}' and result <> 'pending'`), 3, "the checks are still there after winning");
  // a closed enquiry no longer asks for checks
  await R.go(`/sales/opportunities?open=${OPP}`);
  check(!(await card().getByRole("button", { name: /Ask the warehouse/ }).count()), "no 'Ask the warehouse' on a closed enquiry");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 8. The real handover of the seeded Won opportunity (Interactive floor x1)
// ---------------------------------------------------------------------------------------------------------------------------
let HANDOVER = ""; let PRJ = "";
await step("Sales prepares and submits the handover of the Won opportunity (no commercial value is copied)", async () => {
  await R.go(`/sales/opportunities/${WON}/handover`);
  await R.page.getByLabel("Scope of work").fill("LED floor and sensors, 6x4 m, with interactive shader content.");
  await R.page.getByRole("button", { name: /save the delivery brief/i }).click();
  await R.page.waitForFunction(() => /Save changes|Submit the handover/.test(document.body.innerText), null, { timeout: 12000 });
  HANDOVER = s1("select id from proj_handovers limit 1");
  check(HANDOVER, "a handover row exists");
  const row = s1("select row_to_json(h)::text from proj_handovers h");
  for (const secret of ["PO-LOCAL-1", "250000"]) check(!row.includes(secret), `commercial value ${secret} copied into the handover`);
  await R.page.getByRole("button", { name: /submit the handover/i }).click();
  await R.page.waitForFunction(() => /Waiting for a Project Manager/i.test(document.body.innerText), null, { timeout: 12000 });
  eq(s1("select status from proj_handovers"), "submitted", "submitted");
  eq(s1("select count(*) from inv_requests"), 0, "submitting the handover made no equipment request");
});
await R.as("ceo");
await step("the founder assigns the Project Manager (mgr)", async () => {
  await R.go("/projects/handovers");
  await R.page.locator("select").filter({ has: R.page.locator("option", { hasText: "mgr" }) }).first().selectOption({ label: "mgr" });
  await R.page.getByRole("button", { name: /assign|choose|save/i }).first().click();
  await until(() => s1("select status from proj_handovers") === "pm_assigned");
  eq(s1("select count(*) from inv_requests"), 0, "assigning made no equipment request");
});
await R.as("mgr");
await step("the PM accepts (double click): exactly one project, and the requirement snapshot arrives ONCE as a DRAFT request on it", async () => {
  await R.go("/projects/handovers");
  const btn = R.page.getByRole("button", { name: /^accept/i }).first();
  await Promise.all([R.page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 20000 }), btn.dblclick()]);
  PRJ = R.page.url().split("/").pop().split("?")[0];
  await sleep(1500);
  eq(s1("select count(*) from proj_projects where kind='client'"), 1, "one client project");
  eq(s1(`select count(*) from inv_requests where project_id='${PRJ}'`), 1, "one equipment request on it");
  eq(s1(`select status || '/' || source || '/' || kind from inv_requests where project_id='${PRJ}'`), "draft/sales_handover/project", "a draft, from the handover");
  const lines = s1(`select string_agg(i.name || ' x' || l.qty::text || coalesce(' (' || l.alt_group || ')', ''), ', ' order by l.sort_order) from inv_request_lines l join inv_items i on i.id=l.item_id join inv_requests r on r.id=l.request_id where r.project_id='${PRJ}'`);
  console.log("   imported lines:", lines);
  check(/Motor 2\.2 kW x2/.test(lines) && /Motor controller x2/.test(lines), "the template's components came across with their quantities (x1 technology)");
  eq(s1("select count(*) from inv_reservations"), 0, "importing reserved nothing");
  eq(s1(`select count(*) from inv_import_log where project_id='${PRJ}' and outcome='failed'`), 0, "the import log has no failure");
});
await step("running the import again (button, second accept, direct call) creates nothing new", async () => {
  const req = s1(`select id from inv_requests where project_id='${PRJ}'`);
  const linesBefore = s1(`select count(*) from inv_request_lines where request_id='${req}'`);
  await R.go(`/projects/${PRJ}/equipment`);
  const t = await R.mainText();
  check(/Imported from the Sales handover/.test(t), "the request is marked as imported from the handover");
  const btn = R.page.getByRole("button", { name: /import/i });
  console.log("   import buttons on the page:", await btn.allInnerTexts());
  if (await btn.count()) { await btn.first().dblclick(); await sleep(1500); }
  asDb(4, `select inv_import_handover_requirements('${PRJ}')`);
  asDb(4, `select proj_accept_handover('${HANDOVER}')`);
  eq(s1(`select count(*) from inv_requests where project_id='${PRJ}'`), 1, "still one request");
  eq(s1(`select count(*) from inv_request_lines where request_id='${req}'`), linesBefore, "same lines");
  eq(s1("select count(*) from proj_projects where kind='client'"), 1, "still one project");
  eq(s1("select count(*) from inv_reservations"), 0, "still nothing reserved");
  await R.shot("flow3-project-imported");
});

const code = R.verdict("inventory-flow-3");
await R.stop();
process.exit(code);
