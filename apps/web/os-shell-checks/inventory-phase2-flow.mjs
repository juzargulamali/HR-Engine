// WALKTHROUGH: Inventory Phase 2, in a real browser as the real people (LOCAL STACK ONLY). Three journeys, and nothing else:
//   (i)  AT PHONE WIDTH (390x844): the technician at Dubai · Enginious UAE (hr1@) starts a transfer from a selected unit; the form names both companies and warehouses
//        (there is a second warehouse called Dubai, run by Enginious Europe); the founder of Enginious Europe (pol.exec@) sees it on Today, receives PART of it against
//        the original transfer (one unit damaged), the transfer says what is still in transit and who acts next, a retried receipt posts once, the remainder is carried
//        when the form is reopened, and custody and History agree with the database.
//   (ii) Give equipment to an employee from the unit, then Receive return from With people: part of it, one item damaged. The holder, the returned and the available
//        quantity agree across With people, Stock, the unit, My equipment, History and the database; the damaged unit is visibly unavailable until it is inspected.
//   (iii) Setup at phone and desktop widths: the founder finds Warehouses and bins and Catalogue and tracking, and the company, the warehouse and the new item carry
//        forward into Receive stock without being entered again.
// NEEDS: seed/inventory-phase2.sh (RESEED=1 reseeds first; the script writes to the database it drives). Fictional data only.
//   Usage: RESEED=1 node os-shell-checks/inventory-phase2-flow.mjs      screenshots: $SHOTS_DIR/inv2-*.png (default docs/inventory-screenshots)
import { makeRunner, maybeReseed, sql, until, sleep, rpc, refusal, movementHelpers } from "./inventory-flow-lib.mjs";

maybeReseed("inventory-phase2.sh");
const R = makeRunner("inv2");
await R.start();
const { step, check, eq } = R;
const H = movementHelpers(R);
const s1 = (q) => sql(q).split("\n")[0];
const count = (q) => Number(s1(q));
const PHONE = { width: 390, height: 844 }, DESK = { width: 1366, height: 900 }, HD = { deviceScaleFactor: 2 };
const shot = (name) => R.shot(`inv2-${name}`);
const AE = "00000000-0000-4000-8000-00000000a001", PL = "00000000-0000-4000-8000-00000000a002";
const DXB = s1("select id from inv_locations where code = 'DXB'"), RUH = s1("select id from inv_locations where code = 'RUH'"), EUDXB = s1("select id from inv_locations where code = 'DXE'");
const unitsOf = (name) => sql(`select u.code from inv_units u join inv_items i on i.id = u.item_id where i.name = '${name}' order by u.code`).split("\n").filter(Boolean);
const laptops = unitsOf("Laptop 14 inch"), vr = unitsOf("VR headset"), holo = unitsOf("Holofan 75 cm");
const HDMI = s1("select id from inv_items where name = 'HDMI cable'"), VRITEM = s1("select id from inv_items where name = 'VR headset'");
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " ");
const noSideways = async (what) => check(await R.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: the page scrolls sideways at this width`);
const unit = (code) => sql(`select custody_kind || '|' || coalesce(location_id::text, '') || '|' || condition || '|' || company_id || '|' || coalesce(employee_id::text, '') from inv_units where code = '${code}'`).split("|");
const moves = (kind) => count(`select count(*) from inv_movements where kind = '${kind}'`);
let TR = "", TRCODE = "";
check(DXB && RUH && EUDXB && laptops.length === 3 && vr.length === 2 && holo.length === 1, "the Phase 2 seed is not loaded (run with RESEED=1)");

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// (i) A transfer between two company and warehouse pairs, at phone width
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await R.as("hr1", PHONE, "light", HD);
await step("(i) phone, sender: the unit says where it is and that it is available, and Transfer stock opens with the unit and the warehouse already there", async () => {
  await R.go(`/inventory/stock?unit=${laptops[0]}`);
  const answers = R.panel().locator("dl[data-available]");
  await answers.waitFor();
  eq(await answers.getAttribute("data-available"), "yes", "the unit is available");
  check(/Where is it now In the warehouse: Dubai/.test(await text(answers)) && /Is it available Available \(good\)/.test(await text(answers)), "where and whether available: " + await text(answers));
  await R.panel().getByRole("link", { name: "Transfer stock" }).click();
  await H.mv().getByTestId("fixed-location").waitFor();
  eq(await text(H.mv().getByTestId("fixed-location")), "Dubai · Enginious UAE", "the one warehouse this person may work at is shown, not asked for");
  await H.mv().getByRole("listitem", { name: `Laptop 14 inch ${laptops[0]}` }).waitFor();
  const options = await H.mv().getByLabel("Send to").locator("option").allTextContents();
  check(options.includes("Riyadh · Enginious UAE") && options.includes("Dubai · Enginious Europe (another company, authorised)"), "both destinations are named with their company: " + options.join(" | "));
  check(!options.some((o) => o === "Dubai"), "a bare 'Dubai' is offered: " + options.join(" | "));
  await noSideways("the transfer form");
  await shot("01-phone-transfer-start");
});

await step("(i) phone, sender: two more lines, the destination, and a review that names both companies, both warehouses and who acts next", async () => {
  await H.searchAdd("Laptop", new RegExp(`Add Laptop 14 inch ${laptops[1]}`));
  await H.searchAdd("HDMI", /Add HDMI cable/);
  await H.mv().getByLabel(/Quantity of HDMI cable/).fill("4");
  await H.mv().getByLabel("Send to").selectOption({ label: "Dubai · Enginious Europe (another company, authorised)" });
  await H.review();
  const t = await H.text();
  check(/From Dubai · Enginious UAE/.test(t), "the sending company and warehouse: " + t.slice(0, 500));
  check(/To Dubai · Enginious Europe \(in transit: not available there until it is received\)/.test(t), "the receiving company and warehouse: " + t.slice(0, 600));
  check(/Who acts next Dubai · Enginious Europe records it as received/.test(t), "who acts next: " + t.slice(0, 900));
  eq(moves("transfer_dispatch"), 0, "nothing is recorded before Confirm");
  await shot("02-phone-transfer-review");
  await H.mv().getByRole("button", { name: "Confirm and send" }).click();
  const line = H.mv().getByTestId("result-line");
  await line.waitFor();
  eq(await text(line), "6 sent from Dubai · Enginious UAE to Dubai · Enginious Europe. In transit: Dubai · Enginious Europe acts next and records what arrives.", "the result line");
  TR = s1("select id from inv_transfers"); TRCODE = s1("select code from inv_transfers");
  eq(s1(`select status || '/' || from_location_id || '/' || to_location_id from inv_transfers where id = '${TR}'`), `in_transit/${DXB}/${EUDXB}`, "the transfer");
  eq(unit(laptops[0])[0] + unit(laptops[1])[0], "transittransit", "custody of the two units");
  eq(s1(`select trim_scale(sum(qty))::text from inv_balances where transfer_id = '${TR}' and holder_kind = 'transit'`), "4", "counted stock in transit");
  await shot("03-phone-transfer-sent");
});

await step("(i) phone, sender: Today says the transfer waits on the receiving warehouse, by company and warehouse", async () => {
  await R.go("/inventory");
  const waiting = R.page.locator("section[aria-labelledby='today-waiting']");
  await waiting.waitFor();
  const row = waiting.locator("li", { hasText: `Transfer ${TRCODE}` });
  eq(await row.count(), 1, "the sent transfer under Waiting on someone else");
  const t = await text(row);
  check(/to Dubai · Enginious Europe: in transit/.test(t) && /Who acts: Dubai · Enginious Europe records it as received/.test(t) && /3 items still in transit/.test(t), "the row: " + t);
  check((await row.getByRole("link", { name: /Open transfer/ }).getAttribute("href")) === `/inventory/transfers/${TR}`, "the row opens the transfer itself");
  await noSideways("Today");
  await shot("04-phone-today-sender-waiting");
});

await step("(i) the receiving warehouse belongs to another company: the sender cannot receive there, and someone without Inventory access cannot read the transfer", async () => {
  const asSender = await rpc("hr1", "inv_transfer_receive", { p_company_id: PL, p_transfer_id: TR, p_key: "inv2-refused-0001" });
  check(asSender.status >= 400, "the sender received at another company's warehouse: " + JSON.stringify(asSender.body).slice(0, 200));
  const outsider = await rpc("admin", "inv_xshare_transfer_trace", { p_transfer_id: TR });
  check(outsider.status >= 400 && /not found/i.test(refusal(outsider)), "a person without access read the transfer: " + JSON.stringify(outsider.body).slice(0, 200));
  eq(moves("transfer_receive"), 0, "receipts recorded");
});

await R.as("pol", PHONE, "light", HD);
await step("(i) phone, receiver: Today shows the transfer on its way here, from the sending company and warehouse, with Receive transfer", async () => {
  await R.go("/inventory");
  eq(await text(R.page.getByTestId("today-scope")), "Enginious Europe · Dubai", "company and warehouse on Today");
  const row = R.page.locator("li", { hasText: `Transfer ${TRCODE} is on its way here` });
  await row.waitFor();
  check(/From Dubai · Enginious UAE · 3 items/.test(await text(row)), "where it comes from: " + await text(row));
  await noSideways("Today");
  await shot("05-phone-today-receiver");
  await row.getByRole("link", { name: /Receive transfer/ }).click();
  const facts = H.mv().getByTestId("transfer-context");
  await facts.waitFor();
  const t = await text(facts);
  check(/Sent from Dubai · Enginious UAE/.test(t) && /Receiving at Dubai · Enginious Europe/.test(t), "both companies and warehouses: " + t);
  check(/3 lines sent · 0 already received · 3 still in transit/.test(t), "sent, received and outstanding: " + t);
  check(/Owned by Enginious UAE/.test(await H.text()), "the stock owner is named where it differs from the receiving company");
});

await step("(i) phone, receiver: nothing is assumed to have arrived; a PARTIAL receipt with one unit damaged says what was received, held and is still in transit", async () => {
  await H.mv().getByRole("button", { name: "Review", exact: true }).click();
  await H.mv().getByText("Say whether everything still in transit arrived, or only some of it.").waitFor();
  eq(moves("transfer_receive"), 0, "nothing is recorded without a choice");
  await H.mv().getByRole("radio", { name: /Only some of it arrived/ }).check();
  const held = H.mv().getByRole("list", { name: new RegExp(`Still in transit \\(${TRCODE}\\)`) });
  await held.getByRole("button", { name: `Add Laptop 14 inch ${laptops[0]}` }).click();
  await held.getByRole("button", { name: "Add HDMI cable" }).click();
  await H.mv().getByLabel(/Quantity of HDMI cable/).fill("2");
  await H.mv().getByRole("listitem", { name: `Laptop 14 inch ${laptops[0]}` }).getByLabel("Condition").selectOption("damaged");
  await noSideways("the receive form");
  await shot("06-phone-receive-partial");
  await H.review();
  const t = await H.text();
  check(/From Dubai · Enginious UAE, in transit/.test(t) && /To Dubai · Enginious Europe/.test(t), "the review names the source and the destination: " + t.slice(0, 600));
  await H.mv().getByRole("button", { name: "Confirm arrival" }).click();
  const line = H.mv().getByTestId("result-line");
  await line.waitFor();
  eq(await text(line), "3 received · 1 held for inspection · 2 lines still in transit.", "the result line");
  eq(moves("transfer_receive"), 1, "one receipt");
  const u0 = unit(laptops[0]);
  eq(`${u0[0]}|${u0[1]}|${u0[2]}|${u0[3]}`, `warehouse|${EUDXB}|damaged|${AE}`, "the received unit: at the Europe warehouse, damaged, still owned by Enginious UAE");
  eq(unit(laptops[1])[0], "transit", "the other unit is still in transit");
  eq(s1(`select trim_scale(sum(qty))::text from inv_balances where transfer_id = '${TR}' and holder_kind = 'transit'`), "2", "counted stock still in transit");
  eq(s1(`select status from inv_transfers where id = '${TR}'`), "in_transit", "the transfer stays open");
  await shot("07-phone-receive-result");
});

await step("(i) phone: the transfer itself says sent, received, still in transit and who acts next, the same record for both sides", async () => {
  await H.mv().getByRole("link", { name: "Open the transfer" }).click();
  await R.page.waitForURL(new RegExp(`/inventory/transfers/${TR}`));
  await R.page.getByTestId("transfer-progress").waitFor();
  eq(await text(R.page.getByTestId("transfer-progress")), "6 sent · 3 received · 3 still in transit", "progress");
  check(/Who acts next: Dubai · Enginious Europe\. 3 still in transit are received there/.test(await text(R.page.getByTestId("transfer-next"))), "who acts next: " + await text(R.page.getByTestId("transfer-next")));
  const t = await R.mainText();
  check(/Dubai · Enginious UAE to Dubai · Enginious Europe/.test(t) && /Partly received/.test(t) && /Between companies/.test(t), "the header: " + t.slice(0, 300));
  check(/Owned by Enginious UAE/.test(t), "the owner on the lines");
  check(/Sent from Dubai · Enginious UAE/.test(t) && /Received at Dubai · Enginious Europe/.test(t), "both events, each filed under its own company");
  await noSideways("the transfer page");
  await shot("08-phone-transfer-record");
});

await step("(i) a retried receipt posts ONCE: the same key twice records one movement and moves the quantity once", async () => {
  const before = moves("transfer_receive");
  const args = { p_company_id: PL, p_transfer_id: TR, p_key: "inv2-retry-receipt-0001", p_lines: [{ item_id: HDMI, qty: 1, from_condition: "good", condition: "good" }] };
  const [a, b] = await Promise.all([rpc("pol", "inv_transfer_receive", args), rpc("pol", "inv_transfer_receive", args)]);
  const c = await rpc("pol", "inv_transfer_receive", args);
  check([a, b, c].every((r) => r.status === 200), "a repeated call was refused: " + [a, b, c].map((r) => `${r.status} ${refusal(r)}`).join(" | "));
  eq(new Set([a, b, c].map((r) => r.body.code)).size, 1, "movement codes returned for one key");
  eq(moves("transfer_receive"), before + 1, "receipts after three calls with one key");
  eq(s1(`select trim_scale(sum(qty))::text from inv_balances where transfer_id = '${TR}' and holder_kind = 'transit'`), "1", "counted stock still in transit after the retried receipt");
});

await step("(i) phone, receiver: reopening Receive against the SAME transfer carries the remainder; receiving it completes the transfer", async () => {
  await R.go(`/inventory/transfers/${TR}`);
  eq(await text(R.page.getByTestId("transfer-progress")), "6 sent · 4 received · 2 still in transit", "progress after the retried receipt");
  await R.page.getByRole("link", { name: "Receive this transfer" }).click();
  const facts = H.mv().getByTestId("transfer-context");
  await facts.waitFor();
  check(/3 lines sent · 1 already received · 2 still in transit/.test(await text(facts)), "the remainder: " + await text(facts));
  const left = await text(H.mv().getByRole("list", { name: "Still in transit" }));
  check(left.includes(laptops[1]) && /HDMI cable, 1/.test(left) && !left.includes(laptops[0]), "only what is still in transit is listed: " + left);
  await H.mv().getByRole("radio", { name: /Everything still in transit arrived \(2 lines\)/ }).check();
  await H.review();
  check(new RegExp(`Laptop 14 inch \\(${laptops[1]}\\)`).test(await H.text()) && /Everything still in transit: 2 lines/.test(await H.text()), "the review names each line, not just 'everything': " + (await H.text()).slice(0, 500));
  await H.mv().getByRole("button", { name: "Confirm arrival" }).click();
  await H.mv().getByTestId("result-line").waitFor();
  eq(await text(H.mv().getByTestId("result-line")), "2 received · nothing left in transit.", "the result line");
  eq(s1(`select status from inv_transfers where id = '${TR}'`), "received", "the transfer");
  eq(count(`select count(*) from inv_units where transfer_id = '${TR}' and custody_kind = 'transit'`) + count(`select count(*) from inv_balances where transfer_id = '${TR}' and holder_kind = 'transit' and qty > 0`), 0, "nothing left in transit");
  eq(s1(`select trim_scale(sum(qty))::text from inv_balances where item_id = '${HDMI}' and holder_kind = 'warehouse' and location_id = '${EUDXB}'`), "4", "cables on the shelf at the Europe warehouse");
  eq(s1(`select trim_scale(sum(qty))::text from inv_balances where item_id = '${HDMI}' and holder_kind = 'warehouse' and location_id = '${DXB}'`), "8", "cables left on the shelf at Dubai · Enginious UAE");
  eq(s1(`select count(distinct company_id) || '/' || min(company_id::text) from inv_units where code in ('${laptops[0]}', '${laptops[1]}')`), `1/${AE}`, "the owner never changed");
});

await step("(i) phone, receiver: Stock shows the other company's equipment at this warehouse with its owner; the damaged unit is held, not available", async () => {
  await R.go("/inventory/stock");
  const section = R.page.locator("section", { hasText: "Equipment of other companies at your warehouses" }).first();
  await section.waitFor();
  const t = await text(section);
  check(t.includes(laptops[0]) && t.includes(laptops[1]) && /Owned by Enginious UAE/.test(t), "the units and their owner: " + t.slice(0, 400));
  check(/At Dubai, held back \(damaged\)/.test(t) && /Available at Dubai/.test(t), "one held, one available: " + t.slice(0, 600));
  await noSideways("Stock");
  await shot("09-phone-receiver-stock");
});

await R.as("hr1", PHONE, "light", HD);
await step("(i) phone, sender: History shows the real source and destination of the transfer, and links the transfer record", async () => {
  await R.go("/inventory/history?kind=transfer_dispatch");
  const row = R.page.locator("tbody tr").first();
  await row.waitFor();
  const t = await text(row);
  check(/Transfer sent/.test(t) && /Dubai → In transit to Dubai · Enginious Europe/.test(t), "the row: " + t);
  await noSideways("History");
  await row.getByRole("link").first().click();
  await R.panel().getByText("Sent from").waitFor();
  const p = await text(R.panel());
  check(/Going to Dubai · Enginious Europe/.test(p), "the destination in the entry: " + p.slice(0, 400));
  check((await R.panel().getByRole("link", { name: /Open the transfer/ }).getAttribute("href")) === `/inventory/transfers/${TR}`, "the entry links the transfer");
  await shot("10-phone-history-transfer");
  await R.go(`/inventory/transfers/${TR}`);
  eq(await text(R.page.getByTestId("transfer-progress")), "6 sent · 6 received · nothing in transit", "the sender reads the same completed record");
  check(/Who acts next: Nobody\. Everything was received at Dubai · Enginious Europe\./.test(await text(R.page.getByTestId("transfer-next"))), "nobody acts next");
});

await R.as("ceo", DESK, "light", HD);
await step("(i) one person working with two companies: every warehouse is named with its company, so the two called Dubai cannot be confused", async () => {
  await R.go(`/inventory/stock?location=${DXB}&action=transfer`);
  const from = await H.mv().getByLabel("Send from").locator("option").allTextContents();
  check(from.includes("Dubai · Enginious UAE") && from.includes("Dubai · Enginious Europe") && from.includes("Riyadh · Enginious UAE"), "Send from: " + from.join(" | "));
  eq(await H.mv().getByLabel("Send from").evaluate((e) => e.options[e.selectedIndex].textContent), "Dubai · Enginious UAE", "the working warehouse is carried into the form");
  const bar = R.page.locator("[aria-label='Company and warehouse']");
  eq(await bar.getAttribute("data-warehouse-id"), DXB, "the bar names the working warehouse");
  await shot("11-desktop-two-companies-transfer");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// (ii) Give equipment to an employee, then a partial return with one item damaged
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await R.as("hr1", PHONE, "light", HD);
await step("(ii) Give equipment from the unit: the unit and the warehouse are already there, the employee is chosen once", async () => {
  await R.go(`/inventory/stock?unit=${vr[0]}`);
  await R.panel().getByRole("link", { name: "Give equipment" }).click();
  await H.mv().getByRole("listitem", { name: `VR headset ${vr[0]}` }).waitFor();
  eq(await text(H.mv().getByTestId("fixed-location")), "Dubai · Enginious UAE", "the warehouse");
  await H.mv().getByLabel("Who receives it?").fill("Eve");
  await H.mv().getByRole("button", { name: /Eve Employee/ }).click();
  await H.searchAdd("VR", new RegExp(`Add VR headset ${vr[1]}`));
  await H.searchAdd("Holofan", new RegExp(`Add Holofan 75 cm ${holo[0]}`));
  await H.review();
  await H.mv().getByRole("button", { name: "Confirm issue" }).click();
  await H.mv().getByTestId("result-line").waitFor();
  eq(await text(H.mv().getByTestId("result-line")), "3 given to Eve Employee from Dubai · Enginious UAE. It shows under With people until it is returned.", "the result line");
  eq([vr[0], vr[1], holo[0]].map((c) => unit(c)[0]).join(","), "employee,employee,employee", "custody");
  await shot("12-phone-give-equipment");
});

await step("(ii) With people: Receive return opens with the employee and what she holds; part of it comes back, one item damaged", async () => {
  await R.go("/inventory/stock?view=people");
  const row = R.page.locator("tbody tr", { hasText: "Eve Employee" });
  await row.waitFor();
  check(/3 items/.test(await text(row)), "what she holds: " + await text(row));
  await noSideways("With people");
  await shot("13-phone-with-people");
  await row.getByRole("link", { name: "Receive return", exact: true }).click();
  const held = H.mv().getByRole("list", { name: "What they are holding" });
  await held.waitFor();
  check(/Eve Employee/.test(await H.text()), "the employee is already chosen");
  eq(await held.getByRole("listitem").count(), 3, "what she holds is listed, not retyped");
  eq(await H.mv().getByRole("list", { name: "On the list" }).count(), 0, "nothing is assumed to have come back");
  await held.getByRole("button", { name: `Add VR headset ${vr[0]}` }).click();
  await held.getByRole("button", { name: `Add VR headset ${vr[1]}` }).click();
  await H.mv().getByRole("button", { name: "Review", exact: true }).click();
  await H.mv().getByText(/condition/i).first().waitFor();
  eq(moves("return_employee"), 0, "a return without a condition is not recorded");
  await H.mv().getByRole("listitem", { name: `VR headset ${vr[0]}` }).getByLabel("Condition").selectOption("good");
  await H.mv().getByRole("listitem", { name: `VR headset ${vr[1]}` }).getByLabel("Condition").selectOption("damaged");
  await H.review();
  const t = await H.text();
  check(/Still outstanding 1 other item stays with the employee/.test(t) && /Held back 1 item is not available again/.test(t), "the review: " + t.slice(0, 900));
  await shot("14-phone-return-review");
  await H.mv().getByRole("button", { name: "Confirm return" }).click();
  await H.mv().getByTestId("result-line").waitFor();
  eq(await text(H.mv().getByTestId("result-line")), "2 returned · 1 available · 1 held for inspection · 1 still out.", "the result line");
  await shot("15-phone-return-result");
});

await step("(ii) the holder, the returned and the available quantity agree across With people, Stock, the unit, History and the database", async () => {
  eq(`${unit(vr[0])[0]}/${unit(vr[0])[2]} ${unit(vr[1])[0]}/${unit(vr[1])[2]} ${unit(holo[0])[0]}`, "warehouse/good warehouse/damaged employee", "the three units in the database");
  eq(count(`select count(*) from inv_movement_lines l join inv_movements m on m.id = l.movement_id where m.kind = 'return_employee'`), 2, "lines on the return");
  eq(count(`select count(*) from inv_units where item_id = '${VRITEM}' and custody_kind = 'warehouse' and lifecycle = 'active' and condition in ('good', 'fair')`), 1, "usable VR headsets in the database");
  await R.go("/inventory/stock?view=people");
  const person = R.page.locator("tbody tr", { hasText: "Eve Employee" });
  check(/1 item\b/.test(await text(person)), "With people: she still holds one: " + await text(person));
  await person.locator("summary").click();
  check((await text(person)).includes(holo[0]) && !(await text(person)).includes(vr[0]) && !(await text(person)).includes(vr[1]), "With people lists only what is still out: " + await text(person));
  await R.go("/inventory/stock?q=VR+headset");
  const row = R.page.locator("tbody tr", { hasText: "VR headset" }).first();
  await row.waitFor();
  const s = await text(row);
  eq(await text(row.locator("td[data-label='Available here']")), "1", "Stock: available here");
  check(/1 not available: held or damaged/.test(s), "Stock: the damaged one is visibly unavailable: " + s);
  await noSideways("Stock");
  await shot("16-phone-stock-held");
  await R.go(`/inventory/stock?unit=${vr[1]}`);
  const answers = R.panel().locator("dl[data-available]");
  await answers.waitFor();
  eq(await answers.getAttribute("data-available"), "no", "the damaged unit is not available");
  check(/Is it available Not available: damaged, held for inspection/.test(await text(answers)) && /Who has it Nobody: it is in the warehouse/.test(await text(answers)), "the unit: " + await text(answers));
  eq(await text(R.panel().locator("[aria-label='Unit actions'] a").first()), "Inspect", "the first action of a held unit");
  check(!(await R.panel().getByRole("link", { name: "Give equipment" }).count()), "a held unit can be given out");
  await shot("17-phone-unit-held");
  await R.go("/inventory/history?kind=return_employee");
  const h = await text(R.page.locator("tbody tr").first());
  check(/Returned by employee/.test(h) && /2 individual items/.test(h) && /Employee: Eve Employee → Dubai/.test(h), "History: " + h);
  await R.go("/inventory/history?kind=issue_employee");
  const g = await text(R.page.locator("tbody tr").first());
  check(/Issued to employee/.test(g) && /3 individual items/.test(g) && /Dubai.* → Employee: Eve Employee/.test(g), "History, the issue: " + g);
  const direct = await rpc("hr1", "inv_issue_to_employee", { p_company_id: AE, p_location_id: DXB, p_employee_id: "00000000-0000-4000-8000-0000000000e5", p_key: "inv2-held-0001", p_lines: [{ unit_id: s1(`select id from inv_units where code = '${vr[1]}'`) }] });
  check(direct.status >= 400 && /held back|checked/i.test(refusal(direct)), "the database gave out a damaged unit: " + JSON.stringify(direct.body).slice(0, 200));
});

await step("(ii) reopening the return carries only the remainder; a unit that is already back is left off and said so", async () => {
  await R.go(`/inventory/stock?action=return&employee=00000000-0000-4000-8000-0000000000e5&codes=${vr[0]},${holo[0]}`);
  const list = H.mv().getByRole("list", { name: "On the list" });
  await list.waitFor();
  eq(await list.getByRole("listitem").count(), 1, "lines carried");
  check((await text(list)).includes(holo[0]), "the item still out is on the list");
  check(new RegExp(`${vr[0]} is no longer recorded with Eve Employee, so it was left off the list`).test(await H.text()), "what was left off is said: " + (await H.text()).slice(0, 400));
});

await step("(ii) Inspect clears the held unit: it is available again, and only then", async () => {
  await R.go(`/inventory/stock?unit=${vr[1]}`);
  await R.panel().getByRole("link", { name: "Inspect" }).click();
  await H.mv().getByRole("listitem", { name: `VR headset ${vr[1]}` }).waitFor();
  await H.mv().getByRole("listitem", { name: `VR headset ${vr[1]}` }).getByLabel("Condition after the check").selectOption("good");
  await H.review();
  await H.mv().getByRole("button", { name: "Confirm check" }).click();
  await until(() => unit(vr[1])[2] === "good");
  await R.go(`/inventory/stock?unit=${vr[1]}`);
  eq(await R.panel().locator("dl[data-available]").getAttribute("data-available"), "yes", "available after the inspection");
});

await R.as("emp", PHONE, "light", HD);
await step("(ii) the employee's own list agrees: one item still assigned, and how to return it", async () => {
  await R.go("/inventory/mine");
  const t = await R.mainText();
  check(t.includes(holo[0]) && !t.includes(vr[0]) && !t.includes(vr[1]), "My equipment: " + t.slice(0, 400));
  check(/To return something, hand it to the warehouse/.test(t), "how to return it");
  check(!(await R.page.getByRole("link", { name: "Receive return" }).count()), "an ordinary employee is offered Receive return");
  await noSideways("My equipment");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// (iii) Setup at phone and desktop widths
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
for (const [name, vp] of [["phone", PHONE], ["desktop", DESK]]) {
  await R.as("ceo", vp, "light", HD);
  await step(`(iii) ${name}: the warehouse chosen on Today carries into Setup, which opens on Warehouses and bins`, async () => {
    await R.go("/inventory");
    await R.page.getByLabel("Company", { exact: true }).selectOption({ label: "Enginious UAE" });
    await R.page.waitForURL(/location=/);
    await R.page.getByLabel("Warehouse", { exact: true }).selectOption({ label: "Riyadh" });
    await R.page.waitForURL(new RegExp(`location=${RUH}`));
    await R.go("/inventory/manage");
    const root = R.page.locator("[data-section]");
    eq(await root.getAttribute("data-section"), "warehouses", "the first group");
    eq(await root.getAttribute("data-company-id"), AE, "the company carried from the working warehouse");
    eq(await root.getAttribute("data-warehouse-id"), RUH, "the warehouse carried");
    check(/Setting up Enginious UAE · working warehouse Riyadh\./.test(await text(R.page.getByTestId("setup-context"))), "the context line: " + await text(R.page.getByTestId("setup-context")));
    const tabs = await R.page.locator("nav[aria-label='Setup sections'] a").allTextContents();
    eq(tabs.join(" | "), "Warehouses and bins | Catalogue and tracking | Getting stock in | Administration", "the four groups");
    const first = R.page.locator("#locations tbody tr").first();
    check(/Riyadh/.test(await text(first)) && /Working here/.test(await text(first)), "the working warehouse is first and marked: " + await text(first));
    const t = await R.mainText();
    check(!/Earlier asset register|Opening stock and counts|Technology templates/.test(t.replace(/Administration, Company record/, "")), "occasional administration crowds the routine screen");
    await noSideways("Setup, Warehouses and bins");
    await shot(`18-${name}-setup-warehouses`);
  });

  await step(`(iii) ${name}: from a warehouse to its bins in one tap`, async () => {
    const row = R.page.locator("#locations tbody tr", { hasText: "Riyadh" });
    const before = count(`select count(*) from inv_bins where location_id = '${RUH}'`);
    await row.getByRole("button", { name: before === 0 ? /Add bins/ : /Bins \(\d+\)/ }).click();
    await R.dialog().getByText("Bins at Riyadh").waitFor();
    if (before === 0) {
      await R.dialog().getByRole("button", { name: "Add a bin" }).click();
      await R.dialog().getByLabel("Bin code").fill("R-01");
      await R.dialog().getByRole("button", { name: "Add bin" }).click();
      await until(() => count(`select count(*) from inv_bins where location_id = '${RUH}'`) === 1);
    } else check(/R-01/.test(await text(R.dialog())), "the bin added earlier is listed");
    await shot(`19-${name}-setup-bins`);
    await R.page.keyboard.press("Escape");
    await R.closedDialog();
  });

  await step(`(iii) ${name}: Catalogue and tracking shows how items are tracked; a new item is added to the carried company without asking for it`, async () => {
    await R.page.locator("nav[aria-label='Setup sections']").getByRole("link", { name: "Catalogue and tracking" }).click();
    await R.page.waitForURL(/section=catalogue/);
    const items = R.page.locator("#items");
    await items.waitFor();
    for (const way of ["Individual item", "Counted stock", "Kit", "Consumable"]) check((await text(items)).includes(way), `the tracking method ${way} is not explained`);
    check(/Categories/.test(await R.mainText()) && /Technology templates/.test(await R.mainText()), "categories and templates are in this group");
    await noSideways("Setup, Catalogue and tracking");
    await shot(`20-${name}-setup-catalogue`);
    const itemName = `Fictional truss clamp ${name}`;
    await items.getByRole("button", { name: "Add item" }).click();
    await R.dialog().waitFor();
    eq(await R.dialog().getByLabel("Company", { exact: true }).count(), 0, "the company is not asked for again");
    await R.dialog().getByLabel("Item name").fill(itemName);
    check(!(await R.dialog().getByLabel("Unit of measure").count()), "counted-stock fields are shown before the tracking method is chosen");
    await R.dialog().getByLabel(/Counted stock/).check();
    await R.dialog().getByLabel("Unit of measure").waitFor();
    await R.dialog().getByRole("button", { name: "Add item" }).click();
    await until(() => count(`select count(*) from inv_items where name = '${itemName}' and company_id = '${AE}' and tracking = 'quantity'`) === 1);
    await R.page.waitForURL(/\/inventory\/stock\?.*open=/, { timeout: 20000 });
    await R.panel().getByRole("link", { name: "Receive stock" }).click();
    await H.mv().getByRole("listitem", { name: itemName }).waitFor();
    eq(await H.mv().getByLabel("Receive into").evaluate((e) => (e.tagName === "SELECT" ? e.options[e.selectedIndex].textContent : e.textContent)), "Riyadh · Enginious UAE", "the working warehouse and its company are already chosen in Receive stock");
    check(!(await H.mv().getByLabel(/Serial numbers/).count()), "a counted item asks for serial numbers");
    await noSideways("Receive stock");
    await shot(`21-${name}-receive-carried`);
  });

  await step(`(iii) ${name}: Getting stock in names the warehouse; Administration holds sharing, counts, corrections and the import, each one tab away`, async () => {
    await R.go("/inventory/manage?section=stock");
    const link = R.page.getByRole("link", { name: "Receive stock at Riyadh" });
    eq(await link.getAttribute("href"), `/inventory/stock?action=receive&location=${RUH}`, "Receive stock carries the warehouse");
    check(/Getting started/.test(await R.mainText()), "the checklist is with getting stock in");
    await noSideways("Setup, Getting stock in");
    await R.go("/inventory/manage?section=admin");
    const t = await R.mainText();
    for (const h of ["Company record", "Sharing equipment between companies", "Opening stock and counts", "Corrections", "Earlier asset register"]) check(t.includes(h), `Administration is missing ${h}`);
    const record = await text(R.page.getByTestId("company-record"));
    check(/Legal name Enginious Local AE/.test(record) && /Shown in Inventory as Enginious UAE/.test(record), "the legal name stays on the company record, apart from the short name: " + record);
    await noSideways("Setup, Administration");
    await shot(`22-${name}-setup-admin`);
  });
}

await R.as("ceo", PHONE, "light", HD);
await step("(iii) phone: choosing the other company shows ITS warehouse called Dubai, as a separate record", async () => {
  await R.go("/inventory/manage");
  await R.page.getByLabel("Company", { exact: true }).selectOption({ label: "Enginious Europe" });
  await R.page.waitForURL(new RegExp(`company=${PL}`));
  await R.page.locator(`[data-company-id='${PL}']`).waitFor();
  const t = await text(R.page.locator("#locations"));
  check(/Dubai/.test(t) && /DXE/.test(t) && !/Riyadh/.test(t), "the Europe company's own warehouses: " + t.slice(0, 300));
  check(/Only a founder can add or change locations/.test(t), "a warehouse operator of that company is not offered location editing");
  eq(count("select count(*) from inv_locations where name = 'Dubai'"), 2, "the two warehouses called Dubai are separate records");
});

await R.as("emp", PHONE, "light", HD);
await step("(iii) someone without Setup rights is told who it is for; the database refuses a direct call", async () => {
  await R.go("/inventory/manage");
  check(/Setup is for founders and people who manage the catalogue/.test(await R.mainText()), "the page: " + (await R.mainText()).slice(0, 200));
  const direct = await rpc("emp", "inv_save_bin", { p_location_id: RUH, p_bin_id: null, p_code: "X-99", p_label: null });
  check(direct.status >= 400, "an employee saved a bin: " + JSON.stringify(direct.body).slice(0, 200));
});

await step("no page raised an error in the browser console", async () => {
  await sleep(200);
  const errors = (R.page.errors ?? []).filter((e) => !/favicon|Failed to load resource: the server responded with a status of 4/.test(e));
  check(errors.length === 0, errors.slice(0, 3).join(" | "));
});

await R.stop();
process.exit(R.verdict("Inventory Phase 2 walkthrough"));
