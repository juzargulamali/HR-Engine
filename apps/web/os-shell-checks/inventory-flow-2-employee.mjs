// WORKFLOW 2: employee equipment, in a real browser as the real people (LOCAL STACK ONLY).
//   lead@ (department head) asks for a laptop for Eve (emp@): the employee lookup shows only name, number and department
//   hr1@ (warehouse operator) issues it against that request (review, summary, ONE movement even on a double click)
//   emp@ sees it under My equipment and nothing else; hr@ sees it under Equipment held by employees
//   an assigned unit can NOT be reserved for a project; the operator returns it with a condition; the founder moves another unit back to the
//   pool with a reason (history shown); an employee who has left and still holds equipment stays visible to HR.
//   On every Inventory screen of every person involved: no salary, bank, leave, birth date, nationality, personal e-mail or phone.
// NEEDS: the Inventory seed (seed/inventory.sh). Run with RESEED=1 to reseed first (the script writes to the database it drives).
//   Usage: RESEED=1 node os-shell-checks/inventory-flow-2-employee.mjs      screenshots go to docs/inventory-screenshots/
import { makeRunner, maybeReseed, sql, asDb, asDbTry, until, sleep, PERSONA } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("flow2");
await R.start();
const { step, check, eq } = R;
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const EVE = "00000000-0000-4000-8000-0000000000e5";   // emp@
const SAM = "00000000-0000-4000-8000-0000000000e6";   // admin@ (the employee who leaves)
const itemId = (name) => s1(`select id from inv_items where name='${name}'`);
const movementsOf = (kind) => Number(s1(`select count(*) from inv_movements where kind='${kind}'`));
const unitCode = (serial) => s1(`select code from inv_units where serial_number='${serial}'`);
const mv = () => R.panel();
const pickEmployee = async (label, query) => {
  await mv().getByLabel(label, { exact: true }).fill(query);
  const list = mv().getByRole("list", { name: `${label} results` });
  await list.waitFor();
  const rows = (await list.locator("button").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  console.log(`   "${label}" offers:`, JSON.stringify(rows));
  check(rows.every((r) => !PRIVATE_RE.test(r)), "the choices carry only name, number and department");
  await list.getByRole("button").first().click();
};

// ---- the private data of the people (set up as the owner would; Inventory must never show any of it) -------------------------------
const PRIVATE = {
  salary: "83421", bank: "AE070331234567890123456", bankName: "Zzqbank", email: "eve.private.zzq@example.test", phone: "555 0199 ZZQ", nationality: "Zzqlandish", leave: "ZZQ hospital appointment", dob: "1991-03-04",
};
const PRIVATE_RE = new RegExp([PRIVATE.salary, PRIVATE.bank, PRIVATE.bankName, "eve\\.private\\.zzq", "ZZQ", "Zzqlandish", "1991-03-04", "4 Mar 1991", "\\bsalary\\b", "\\bIBAN\\b"].join("|"), "i");
async function setUpPrivateData() {
  sql(`insert into departments (id, company_id, name) values ('00000000-0000-4000-8000-0000000000d1', '${AE}', 'Sales Engineering')`);
  sql(`update employees set department_id='00000000-0000-4000-8000-0000000000d1', personal_email='${PRIVATE.email}', phone='${PRIVATE.phone}', date_of_birth='${PRIVATE.dob}', nationality='${PRIVATE.nationality}' where id in ('${EVE}','${SAM}')`);
  sql(`insert into compensation_details (employee_id, effective_from, base_salary, currency, bank_name, bank_iban, created_by) values ('${EVE}', '2025-01-01', ${PRIVATE.salary}.50, 'AED', '${PRIVATE.bankName}', '${PRIVATE.bank}', '00000000-0000-4000-8000-0000000000a2')`);
  sql(`set session_replication_role = replica; insert into leave_requests (employee_id, leave_type_code, start_date, end_date, total_days, reason, status) values ('${EVE}', 'annual', current_date + 5, current_date + 6, 2, '${PRIVATE.leave}', 'submitted')`);
}
const privateWasSet = () => Number(s1(`select count(*) from compensation_details where employee_id='${EVE}'`)) === 1 && Number(s1(`select count(*) from leave_requests where employee_id='${EVE}'`)) >= 0;
// Every page a person looked at is checked for those values, in what the browser shows AND in everything the server sent (the page source).
const leakChecks = [];
async function noPrivate(label) {
  const html = await R.page.content();
  const text = await R.page.locator("body").innerText();
  const hit = (html + "\n" + text).match(PRIVATE_RE);
  leakChecks.push(label);
  if (hit) throw new Error(`${label}: private data found on an Inventory screen: "${hit[0]}"`);
}

await step("set-up: Eve has a department and private HR data (pay, bank, leave, birth date, nationality, personal e-mail, phone)", async () => {
  await setUpPrivateData();
  eq(s1(`select count(*) from compensation_details where employee_id='${EVE}'`), 1, "salary row");
  eq(s1(`select count(*) from employees where id='${EVE}' and personal_email is not null and phone is not null`), 1, "personal fields");
  // a cost on the laptop, which an employee must never see
  const lap = unitCode("LAP-SN-001");
  sql(`insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency, entered_by) select company_id, item_id, id, current_date, 4321.00, 'AED', '00000000-0000-4000-8000-0000000000a3' from inv_units where code='${lap}'`);
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1. The department head asks for equipment for an employee
// ---------------------------------------------------------------------------------------------------------------------------
let REQ = "";
await step("department head: the employee lookup shows only name, number and department, and the request is created for Eve", async () => {
  await R.as("lead");
  await R.go("/inventory/requests");
  await noPrivate("lead: requests list");
  await R.page.getByRole("button", { name: "New request" }).first().click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel("What is it for").fill("Laptop for Eve (new starter)");
  await R.dialog().getByLabel("Employee", { exact: true }).fill("Eve");
  const list = R.dialog().getByLabel("Matching employees");
  await list.waitFor();
  const options = (await list.locator("option").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => !/^Choose one/.test(x));
  console.log("   lookup shows:", JSON.stringify(options));
  eq(options.length, 1, "one match for Eve");
  check(/^Eve Employee · L-5 · Sales Engineering$/.test(options[0]), "only name, number and department: " + options[0]);
  check(!PRIVATE_RE.test(await R.dialog().innerHTML()), "the lookup carries no private data");
  await list.selectOption({ index: 1 });
  await R.dialog().getByLabel("Collected from").selectOption({ label: "Dubai" });
  await R.dialog().getByLabel("Needed from").fill(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) + "T09:00");
  await R.dialog().getByLabel("Expected back (optional)").fill(new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10) + "T17:00");
  await R.shot("flow2-request-new");
  // what the lookup function itself returns (its whole column list)
  const cols = asDb(7, `select string_agg(k, ',' order by k) from (select jsonb_object_keys(to_jsonb(x)) k from inv_employee_lookup('${AE}', 'Eve') x limit 20) q`);
  console.log("   inv_employee_lookup columns:", cols);
  check(!/salary|iban|bank|phone|birth|nationality|email|leave/i.test(cols), "the lookup function returns no private column");
  await R.dialog().getByRole("button", { name: "Create draft" }).click();
  await R.closedDialog();
  await until(() => s1("select count(*) from inv_requests") === "1");
  REQ = s1("select id from inv_requests");
  eq(s1(`select kind || '/' || employee_id from inv_requests where id='${REQ}'`), `employee/${EVE}`, "an employee request for Eve");
  eq(s1(`select count(*) from inv_reservations`), 0, "nothing reserved");
});
await step("department head adds a laptop and submits (a draft reserves nothing; submitting reserves nothing)", async () => {
  await R.page.waitForURL(new RegExp(`open=${REQ}`));
  const d = R.page.locator("aside[role=dialog] details:has(> summary:text-is('Add an item'))").first();
  await d.locator("summary").first().click();
  await d.getByLabel("Item", { exact: true }).fill("Laptop");
  await d.getByLabel("Matching items").selectOption({ label: "Laptop 14 inch · L14" });
  await d.getByLabel("Quantity", { exact: true }).fill("1");
  await d.getByRole("button", { name: "Add line" }).click();
  await until(() => s1(`select count(*) from inv_request_lines where request_id='${REQ}'`) === "1");
  await R.panel().getByRole("button", { name: "Submit to the warehouse" }).click();
  await until(() => s1(`select status from inv_requests where id='${REQ}'`) === "submitted");
  await R.shot("flow2-request-submitted");
  await noPrivate("lead: employee request panel");
  eq(s1("select count(*) from inv_reservations"), 0, "no reservation");
  // the department head sees only requests that are theirs
  await R.go("/inventory/requests");
  check(/1 of 1 requests/.test(await R.mainText()), "the head sees their own request only");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 2. The warehouse issues it
// ---------------------------------------------------------------------------------------------------------------------------
const LAP1 = () => unitCode("LAP-SN-001");
await step("operator issues the laptop to Eve against that request: review and summary, ONE movement on a double click", async () => {
  await R.as("hr1");
  await R.go(`/inventory/requests?open=${REQ}`);
  await noPrivate("operator: employee request panel");
  await R.panel().getByRole("link", { name: "Issue to the employee" }).click();
  await R.page.waitForURL(/action=issue/);
  await mv().getByText("Issue to a person").first().waitFor();
  const box = mv().getByLabel("Search for an item or unit to add");
  await box.fill("LAP-SN-001");
  await mv().getByRole("list", { name: "Search results" }).getByRole("button", { name: /^Add Laptop 14 inch/ }).first().click();
  await mv().getByRole("button", { name: "Review", exact: true }).click();
  await mv().getByText("Check before you confirm").waitFor();
  const t = (await mv().innerText()).replace(/\s+/g, " ");
  console.log("   review:", t.slice(t.indexOf("Check before"), t.indexOf("Check before") + 330));
  check(/Eve Employee/.test(t) && new RegExp(LAP1()).test(t), "the summary names the person and the unit");
  check(!PRIVATE_RE.test(t), "no private data in the summary");
  await R.shot("flow2-issue-review");
  eq(movementsOf("issue_employee"), 0, "nothing recorded at the review step");
  await mv().getByRole("button", { name: "Confirm issue" }).dblclick();
  await mv().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(700);
  eq(movementsOf("issue_employee"), 1, "one issue movement after a double click");
  eq(s1(`select custody_kind || '/' || employee_id from inv_units where code='${LAP1()}'`), `employee/${EVE}`, "the laptop is with Eve");
  eq(s1(`select status from inv_requests where id='${REQ}'`), "fulfilled", "the request is fulfilled");
  await R.shot("flow2-issue-done");
  await noPrivate("operator: issue form");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 3. What Eve sees, what HR sees
// ---------------------------------------------------------------------------------------------------------------------------
await step("Eve sees the laptop under My equipment and nothing else", async () => {
  await R.as("emp");
  await R.go("/inventory/mine");
  const t = await R.mainText();
  check(t.includes(LAP1()) && t.includes("LAP-SN-001") && /Laptop 14 inch/.test(t), "the laptop with its ID and serial is listed: " + t.slice(0, 300));
  eq(await R.page.locator("main tbody tr").count(), 1, "exactly one row");
  check(!/4321|AED|cost|price|Showroom|Dubai|Riyadh|hr1|ceo|project/i.test(t.replace(/Equipment assigned to me[^.]*\./, "")), "no cost, place or other person: " + t.slice(0, 400));
  await noPrivate("employee: my equipment");
  await R.shot("flow2-my-equipment");
  // the rest of Inventory is closed to her
  await R.go("/inventory");
  check(/You do not have Inventory access/.test(await R.mainText()), "no stock list for an ordinary employee");
  check(!/Laptop 14 inch|Holofan|Motor/.test(await R.mainText()), "no catalogue either");
  await R.go("/inventory/employees");
  check(/This list is for founders, warehouse operators/.test(await R.mainText()), "not the employees' list");
  await R.go("/inventory/movements");
  check(!/ENG-M-0000/.test(await R.mainText()), "no movements");
  // and the database says the same (her own rows only)
  eq(asDb(5, "select count(*) from inv_my_equipment()"), 1, "inv_my_equipment returns her one item");
  eq(asDb(5, "select count(*) from inv_units"), 0, "she cannot read the unit table");
});
await step("HR sees Eve's laptop under Equipment held by employees, with only her name and number", async () => {
  await R.as("hr");
  await R.go("/inventory/employees");
  const t = await R.mainText();
  check(/Eve Employee/.test(t) && /L-5/.test(t), "Eve is listed with her number");
  await R.page.locator("main summary", { hasText: "1 item" }).first().click();
  check((await R.mainText()).includes(LAP1()), "the laptop's ID is shown");
  await noPrivate("HR: equipment held by employees");
  await R.shot("flow2-employees-held");
  check(!/Return equipment/.test(t), "HR (read-only access) has no Return button");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 4. An assigned unit cannot be reserved for a project
// ---------------------------------------------------------------------------------------------------------------------------
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
let REQ2 = "";
await step("project manager asks for all 3 laptops for Showroom refresh and submits", async () => {
  await R.as("mgr");
  await R.go(`/projects/${PRJ}/equipment`);
  await R.page.getByRole("button", { name: "New equipment request" }).first().click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel("What is it for").fill("Laptops for the showroom kiosks");
  await R.dialog().getByLabel("Pickup location (optional)").selectOption({ label: "Dubai" });
  await R.dialog().getByLabel("Leaves the warehouse").fill(new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) + "T08:00");
  await R.dialog().getByLabel("Due back").fill(new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10) + "T17:00");
  await R.dialog().getByRole("button", { name: "Create draft" }).click();
  await R.closedDialog();
  await until(() => s1("select count(*) from inv_requests where kind='project'") === "1");
  REQ2 = s1("select id from inv_requests where kind='project'");
  await R.page.waitForURL(new RegExp(`request=${REQ2}`));
  const d = R.page.locator("details:has(> summary:text-is('Add an item'))").first();
  await d.locator("summary").first().click();
  await d.getByLabel("Item", { exact: true }).fill("Laptop");
  await d.getByLabel("Matching items").selectOption({ label: "Laptop 14 inch · L14" });
  await d.getByLabel("Quantity", { exact: true }).fill("3");
  await d.getByRole("button", { name: "Add line" }).click();
  await until(() => s1(`select count(*) from inv_request_lines where request_id='${REQ2}'`) === "1");
  await R.page.getByRole("button", { name: "Submit to the warehouse" }).click();
  await until(() => s1(`select status from inv_requests where id='${REQ2}'`) === "submitted");
});
await step("the laptop with Eve is not offered for the project: 2 are free, the assigned one cannot be chosen, and only 2 are reserved", async () => {
  await R.as("hr1");
  await R.go(`/inventory/requests?open=${REQ2}`);
  await R.panel().locator("tbody tr", { hasText: "Laptop 14 inch" }).first().getByRole("button", { name: "Reserve", exact: true }).click();
  await R.dialog().waitFor();
  await R.dialog().getByText(/\(\d+ free for these dates\)/).waitFor();
  const t = (await R.dialog().innerText()).replace(/\s+/g, " ");
  console.log("   reserve dialog:", t.match(/Pick free ones for me[^)]*\)/)?.[0]);
  check(/\(2 free for these dates\)/.test(t), "2 free for these dates (not 3): " + t.slice(0, 300));
  await R.dialog().getByRole("radio", { name: "Choose named units" }).check();
  await R.dialog().getByText(LAP1()).first().waitFor();
  const box = R.dialog().locator(`input[type=checkbox]`).filter({ has: R.page.locator("xpath=.") });
  const assignedRow = R.dialog().locator("li", { hasText: LAP1() });
  check(await assignedRow.locator("input[type=checkbox]").isDisabled(), "the laptop held by Eve cannot be ticked");
  const why = (await assignedRow.innerText()).replace(/\s+/g, " ");
  console.log("   the assigned laptop says:", why);
  check(/employee|Eve|assigned|not available/i.test(why) && !/Free for these dates/.test(why), "and says why it is not free: " + why);
  await R.shot("flow2-reserve-named");
  await R.dialog().getByRole("radio", { name: /Pick free ones for me/ }).check();
  await R.dialog().getByRole("button", { name: "Reserve", exact: true }).click();
  await R.dialog().getByText(/Reserved \d/).first().waitFor();
  console.log("   result:", (await R.dialog().innerText()).replace(/\s+/g, " ").match(/Reserved \d+ of \d+[^.]*\./)?.[0]);
  await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
  eq(s1(`select count(*) from inv_reservations where status='active'`), 2, "two reservations");
  eq(s1(`select count(*) from inv_reservations r join inv_units u on u.id=r.unit_id where u.code='${LAP1()}'`), 0, "none of them is the laptop with Eve");
  await R.panel().getByText(/short by 1/).first().waitFor();
  await R.shot("flow2-reserve-short");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 5. The operator returns it with a condition
// ---------------------------------------------------------------------------------------------------------------------------
await step("operator takes the laptop back from Eve with the condition 'Needs checking': held back, not available, off Eve's list", async () => {
  await R.go("/inventory?action=return");
  await mv().getByLabel("Back into").selectOption({ label: "Dubai" });
  await mv().getByRole("radio", { name: "An employee" }).check();
  await pickEmployee("Which employee?", "Eve");
  await mv().getByRole("list", { name: "What they are holding" }).waitFor();
  await mv().getByRole("list", { name: "What they are holding" }).getByRole("button", { name: new RegExp(`^Add Laptop 14 inch ${LAP1()}`) }).click();
  await mv().getByRole("listitem", { name: `Laptop 14 inch ${LAP1()}`, exact: true }).getByLabel("Condition").selectOption({ label: "Needs checking: held back" });
  await mv().getByRole("listitem", { name: `Laptop 14 inch ${LAP1()}`, exact: true }).getByLabel("Note (optional)").fill("Keyboard sticks");
  await mv().getByRole("button", { name: "Review", exact: true }).click();
  await mv().getByText("Check before you confirm").waitFor();
  await R.shot("flow2-return-review");
  await mv().getByRole("button", { name: "Confirm return" }).dblclick();
  await mv().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(600);
  eq(movementsOf("return_employee"), 1, "one return movement");
  eq(s1(`select custody_kind || '/' || condition from inv_units where code='${LAP1()}'`), "warehouse/needs_inspection", "back in the warehouse, held for checking");
  eq(s1(`select (lifecycle='active' and condition in ('good','fair') and custody_kind='warehouse') from inv_units where code='${LAP1()}'`), "f", "not available");
  await R.as("emp");
  await R.go("/inventory/mine");
  check(/Nothing is assigned to you/.test(await R.mainText()), "Eve's list is empty again");
  await R.as("hr");
  await R.go("/inventory/employees");
  check(/No employee holds company equipment/.test(await R.mainText()), "HR's list is empty again");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 6. The founder moves a unit back to the pool with a reason
// ---------------------------------------------------------------------------------------------------------------------------
const issueDirect = async (code, who) => {
  await R.go("/inventory?action=issue");
  await mv().getByLabel("Take from").selectOption({ label: "Dubai" });
  await pickEmployee("Who receives it?", who);
  await mv().getByLabel("Search for an item or unit to add").fill(code);
  await mv().getByRole("list", { name: "Search results" }).getByRole("button", { name: /^Add VR headset/ }).first().click();
  await mv().getByRole("button", { name: "Review", exact: true }).click();
  await mv().getByText("Check before you confirm").waitFor();
  await mv().getByRole("button", { name: "Confirm issue" }).click();
  await mv().getByText("Recorded").first().waitFor({ timeout: 20000 });
};
await step("a headset is issued to Eve without a request, then the founder moves it back to the project pool with a reason (history shown)", async () => {
  await R.as("hr1");
  await issueDirect("VR-SN-001", "Eve");
  const code = unitCode("VR-SN-001");
  eq(s1(`select custody_kind from inv_units where code='${code}'`), "employee", "with Eve");
  await R.as("ceo");
  await R.go(`/inventory?unit=${code}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Change who holds it/ }).click();
  await R.dialog().waitFor();
  await R.shot("flow2-reassign");
  await R.dialog().getByRole("button", { name: "Record the change" }).click();
  await R.dialog().getByText(/Give a reason|reason/i).first().waitFor();
  await R.dialog().getByLabel("Why?").fill("Eve moved to the Riyadh office and the headset was handed to the project team");
  await R.dialog().getByRole("button", { name: "Record the change" }).dblclick();
  await R.page.waitForTimeout(2500);
  console.log("   after the double click the dialog says:", (await R.dialog().innerText()).replace(/\s+/g, " ").slice(-260));
  await R.dialog().getByText(/Recorded as/).waitFor({ timeout: 15000 });
  await sleep(500);
  eq(movementsOf("pool_change"), 1, "one pool change");
  eq(s1(`select custody_kind || '/' || coalesce(employee_id::text,'-') from inv_units where code='${code}'`), "warehouse/-", "back in the pool, no holder");
  eq(s1("select reason from inv_movements where kind='pool_change'").length > 20, true, "the reason is kept");
  await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click().catch(() => {});
  await R.go(`/inventory?unit=${code}`);
  const hist = (await R.panel().innerText()).replace(/\s+/g, " ");
  console.log("   history:", hist.slice(hist.indexOf("HISTORY"), hist.indexOf("HISTORY") + 360));
  check(/Moved to the project pool/.test(hist) && /Issued to/i.test(hist) || /Moved to the project pool/.test(hist), "the history shows the move");
  check(/Eve|Employee/.test(hist), "and who held it before");
  await R.shot("flow2-reassign-history");
  eq(asDb(5, "select count(*) from inv_my_equipment()"), 0, "nothing is assigned to Eve any more");
  // a unit that is not with an employee cannot be 'moved back'
  const again = asDbTry(3, `select inv_reassign_unit((select id from inv_units where code='${code}'), 'pool', null, 'again', 'reassign-again-0001')`);
  check(!again.ok && /already in the warehouse pool/i.test(again.out), "moving it again is refused: " + again.out.slice(0, 120));
});

// ---------------------------------------------------------------------------------------------------------------------------
// 7. Someone who has left and still holds equipment stays visible to HR
// ---------------------------------------------------------------------------------------------------------------------------
await step("an employee who leaves while holding equipment stays on HR's list with a clear flag (and can no longer be given equipment)", async () => {
  await R.as("hr1");
  await issueDirect("VR-SN-002", "Sam");
  const code = unitCode("VR-SN-002");
  eq(s1(`select employee_id from inv_units where code='${code}'`), SAM, "the headset is with Sam");
  // the owner marks Sam as having left (HR does this in the HR system; Inventory only reads it)
  sql(`update employees set employment_status='terminated', termination_date=current_date - 1 where id='${SAM}'`);
  await R.as("hr");
  await R.go("/inventory/employees");
  const t = await R.mainText();
  console.log("   HR sees:", t.slice(t.indexOf("people") - 20, t.indexOf("people") + 260));
  check(/Sam Sysadmin/.test(t) && /L-6/.test(t), "Sam is still listed");
  check(/equipment still out/i.test(t), "with the flag that equipment is still out");
  await noPrivate("HR: a person who has left");
  await R.shot("flow2-left-employee");
  await R.go("/inventory/employees?show=left");
  check(/Sam Sysadmin/.test(await R.mainText()), "the 'only people who have left' filter finds him");
  // the employee lookup (used to issue equipment) no longer offers him
  await R.as("hr1");
  await R.go("/inventory?action=issue");
  await mv().getByLabel("Take from").selectOption({ label: "Dubai" });
  await mv().getByLabel("Who receives it?", { exact: true }).fill("Sam");
  await R.page.waitForTimeout(1500);
  check(/No active employee matches/.test(await mv().innerText()), "an employee who has left cannot be chosen for new equipment");
  check(!(await mv().getByRole("list", { name: "Who receives it? results" }).count()), "no one to pick");
  // the operator can still take it back from the person who left
  await R.go("/inventory/employees");
  check(/Return equipment/.test(await R.mainText()), "the operator still has the Return button for him");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 8. Private data on every screen
// ---------------------------------------------------------------------------------------------------------------------------
await step("no screen of Inventory shows pay, bank, leave, birth date, nationality, personal e-mail or phone to anyone involved", async () => {
  check(privateWasSet(), "the private data is still in the database");
  const laptop = LAP1(); const vr = unitCode("VR-SN-002");
  const pages = [
    ["hr1", "/inventory"], ["hr1", "/inventory/requests"], ["hr1", `/inventory/requests?open=${REQ}`], ["hr1", "/inventory/employees"], ["hr1", "/inventory/movements"],
    ["hr1", `/inventory?unit=${laptop}`], ["hr1", `/inventory?unit=${vr}`], ["hr1", "/inventory?action=issue"], ["hr1", "/inventory?action=return"], ["hr1", "/inventory/manage"],
    ["lead", "/inventory/requests"], ["lead", `/inventory/requests?open=${REQ}`], ["lead", "/inventory/mine"],
    ["hr", "/inventory/employees"], ["hr", "/inventory/mine"], ["hr", "/inventory/employees?employee=" + EVE],
    ["emp", "/inventory/mine"], ["emp", "/inventory"],
    ["ceo", "/inventory/employees"], ["ceo", `/inventory?unit=${vr}`], ["ceo", "/inventory/movements"], ["ceo", "/inventory/access"],
    ["mgr", "/inventory/requests"],
  ];
  const cur = { key: "" };
  let n = 0;
  for (const [who, path] of pages) {
    if (cur.key !== who) { await R.as(who); cur.key = who; }
    await R.go(path);
    await noPrivate(`${who} ${path}`); n++;
  }
  console.log(`   ${n} screens read, in the page and in the source the server sent: none carries any private value`);
  // the database side of the same rule: the only employee data Inventory functions return, for the people who may call them
  const outstandingCols = asDb(2, `select string_agg(k, ',' order by k) from (select distinct jsonb_object_keys(to_jsonb(x)) k from inv_employee_outstanding('${AE}', null, true) x) q`);
  console.log("   inv_employee_outstanding columns:", outstandingCols);
  check(!/salary|iban|bank|phone|birth|nationality|email|leave|pay/i.test(outstandingCols), "the HR view returns no private column");
});

await step("control: the same detector DOES find the private values where they belong (HR's own employee page), so a clean Inventory result means something", async () => {
  await R.as("hr");
  await R.go(`/employees/${EVE}`);
  const html = (await R.page.content()) + (await R.page.locator("body").innerText());
  const hit = html.match(PRIVATE_RE);
  check(hit, "the detector found nothing even on the HR page: it cannot prove anything");
  console.log("   the HR employee page shows e.g.:", hit[0]);
});

const code = R.verdict("inventory-flow-2");
await R.stop();
process.exit(code);
