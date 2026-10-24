// WORKFLOW 1: opening stock to final reconciliation, in a real browser as the real people (LOCAL STACK ONLY).
//   founder ceo@ adds a category and items (Quick Add), registers units and confirms an opening count
//   warehouse operator hr1@ prints labels (QR decodes to the readable code; reprint keeps the code)
//   Project Manager mgr@ requests equipment for the internal project "Showroom refresh" and submits it
//   hr1@ reserves it, dispatches part of it (review step, one movement even on a double click and after a lost connection),
//   the project returns part (one damaged, one good), the rest stays outstanding, and the final reconciliation closes it.
// NEEDS: the Inventory seed (seed/inventory.sh). Run with RESEED=1 to reseed first (the script writes to the database it drives).
//   Usage: RESEED=1 node os-shell-checks/inventory-flow-1-stock-to-reconcile.mjs      screenshots go to docs/inventory-screenshots/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { makeRunner, maybeReseed, sql, asDb, asDbTry, until, sleep, BASE } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("flow1");
await R.start();
const { step, check, eq } = R;
const AE = "00000000-0000-4000-8000-00000000a001";
const s1 = (q) => sql(q).split("\n")[0];
const jsQRSource = readFileSync(createRequire(import.meta.url).resolve("jsqr"), "utf8");

// Everything this run created is looked up by name, never by a fixed id.
const CAT = "Interactive floor parts";
const SENSOR = "Floor sensor"; const BRACKET = "Mounting bracket";
const itemId = (name) => s1(`select id from inv_items where name='${name}'`);
const movements = (kind) => Number(s1(`select count(*) from inv_movements where kind='${kind}'`));
const ledgerCheck = () => {
  // 1) the function the owner scripts call, as an authorised caller (the founder holds view_audit)
  const viaFunction = asDb(3, "select count(*) from inv_ledger_problems()");
  // 2) the same two rules as plain SQL, independent of who is asking
  const balancesOff = s1("select count(*) from inv_balances b where b.qty <> coalesce((select sum(case when l.to_balance_id=b.id then l.qty else 0 end) - sum(case when l.from_balance_id=b.id then l.qty else 0 end) from inv_movement_lines l where l.to_balance_id=b.id or l.from_balance_id=b.id),0)");
  const negative = s1("select count(*) from inv_balances where qty < 0");
  return { viaFunction, balancesOff, negative };
};

const dlgFill = async (label, value) => R.dialog().getByLabel(label, { exact: true }).fill(value);

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Founder: category, items (Quick Add), units, opening count
// ---------------------------------------------------------------------------------------------------------------------------
await R.as("ceo");
await step("founder adds a category in Setup", async () => {
  await R.go("/inventory/manage");
  await R.page.getByRole("button", { name: "Add a category", exact: true }).click();
  await R.dialog().waitFor();
  await dlgFill("Name", CAT);
  await R.dialog().getByRole("button", { name: "Add category" }).click();
  await R.closedDialog();
  await R.seen(new RegExp(CAT));
  eq(s1(`select count(*) from inv_categories where name='${CAT}'`), 1, "category rows");
});

const quickAdd = async (name, tracking, extra = async () => {}) => {
  await R.go("/inventory");
  await R.page.getByRole("button", { name: "Add item", exact: true }).first().click();
  await R.dialog().waitFor();
  await dlgFill("Item name", name);
  await R.dialog().getByLabel("Category", { exact: true }).selectOption({ label: CAT });
  await R.dialog().getByRole("radio", { name: new RegExp(`^${tracking}`) }).check();
  await extra();
};
await step("Quick Add: Floor sensor (individually tracked) is catalogued", async () => {
  await quickAdd(SENSOR, "Individual item");
  await R.shot("flow1-quick-add");
  await R.dialog().getByRole("button", { name: "Add item", exact: true }).click();
  await R.closedDialog();
  eq(s1(`select count(*) from inv_items where name='${SENSOR}'`), 1, "item rows");
  eq(s1(`select tracking from inv_items where name='${SENSOR}'`), "individual", "tracking");
});
await step("Quick Add: Mounting bracket (counted stock, whole numbers) is catalogued", async () => {
  await quickAdd(BRACKET, "Counted stock");
  await R.dialog().getByRole("button", { name: "Add item", exact: true }).click();
  await R.closedDialog();
  eq(s1(`select tracking from inv_items where name='${BRACKET}'`), "quantity", "tracking");
  console.log("   item status after Quick Add:", s1(`select status from inv_items where name='${BRACKET}'`), "| scale", s1(`select quantity_scale from inv_items where name='${BRACKET}'`));
});


await step("founder registers four Floor sensor units (they start as Not counted yet)", async () => {
  await R.go(`/inventory?open=${itemId(SENSOR)}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Add unit/ }).click();
  await R.dialog().waitFor();
  for (const n of [1, 2, 3, 4]) {
    await R.dialog().getByLabel("Serial number (optional)").fill(`FS-SN-00${n}`);
    await R.dialog().getByLabel("Where is it kept?").selectOption({ label: "Dubai" });
    await R.dialog().getByLabel("Bin (optional)").selectOption({ label: "A-01 (Shelf A1)" });
    if (n === 1) await R.shot("flow1-add-unit");
    await R.dialog().getByRole("button", { name: "Register unit" }).click();
    await until(() => Number(s1(`select count(*) from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}'`)) === n, 15000, `unit ${n} `);
    await sleep(400);
  }
  eq(s1(`select string_agg(distinct lifecycle, ',') from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}'`), "draft", "new units are draft");
  eq(s1(`select count(*) from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and verified_at is not null`), 0, "not verified yet");
});


let COUNT_ID = "";
await step("founder starts an opening count at Dubai", async () => {
  await R.go("/inventory/manage");
  await R.page.getByRole("button", { name: "Start a count", exact: true }).click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel("Location", { exact: true }).selectOption({ label: "Dubai" });
  await R.dialog().getByRole("radio", { name: /Opening count/ }).check();
  await R.shot("flow1-start-count");
  await R.dialog().getByRole("button", { name: "Start the count" }).click();
  await R.closedDialog();
  await until(() => s1("select count(*) from inv_counts where status='open'") === "1");
  COUNT_ID = s1("select id from inv_counts where status='open'");
  await R.page.waitForURL(new RegExp(`count=${COUNT_ID}`));
});
await step("counted stock (40 brackets) and the four registered units are counted on the sheet", async () => {
  const panel = R.panel();
  await panel.waitFor();
  await panel.getByLabel("Item", { exact: true }).selectOption({ label: BRACKET });
  await panel.getByLabel("Bin", { exact: true }).selectOption({ label: "A-01" });
  await panel.getByLabel(/^Quantity you counted/).fill("40");
  await panel.getByRole("button", { name: "Save this line" }).click();
  await until(() => s1(`select count(*) from inv_count_lines where count_id='${COUNT_ID}'`) === "1");
  for (let n = 1; n <= 4; n++) {
    await panel.getByRole("button", { name: new RegExp(`^Counted here`) }).first().click();
    await until(() => Number(s1(`select count(*) from inv_count_lines where count_id='${COUNT_ID}'`)) === 1 + n, 15000, `line ${n} `);
    await sleep(500);
  }
  await R.shot("flow1-opening-count");
  eq(s1(`select count(*) from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and lifecycle='draft'`), 4, "still draft until confirmed");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='${BRACKET}'`), 0, "no bracket stock before confirmation");
});
await step("the warehouse operator can read the open count but cannot confirm it (only a founder or confirm_stock can)", async () => {
  await R.as("hr1");
  await R.go(`/inventory/manage?count=${COUNT_ID}#counts`);
  await R.panel().waitFor();
  const t = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(/Only a founder, or someone allowed to confirm stock counts, can confirm this count/.test(t), "the operator is told who can confirm: " + t.slice(0, 200));
  eq(await R.panel().getByRole("button", { name: "Confirm this count" }).count(), 0, "no Confirm button for the operator");
  const refused = asDbTry(1, `select inv_confirm_count('${AE}', '${COUNT_ID}', 'operator-try-0000001')`);
  check(!refused.ok && /confirm|allowed|permission/i.test(refused.out), "and the database refuses it: " + refused.out.slice(0, 160));
  eq(s1(`select status from inv_counts where id='${COUNT_ID}'`), "open", "still open");
});
await step("the founder confirms the count: stock becomes real and who/when is shown", async () => {
  await R.as("ceo");
  await R.go(`/inventory/manage?count=${COUNT_ID}#counts`);
  const panel = R.panel();
  await panel.waitFor();
  await panel.getByRole("button", { name: "Confirm this count" }).click();
  await panel.getByText(/^Confirmed\./).waitFor({ timeout: 15000 });
  await R.shot("flow1-count-confirmed");
  eq(s1(`select status from inv_counts where id='${COUNT_ID}'`), "confirmed", "count status");
  eq(s1(`select count(*) from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and lifecycle='active' and verified_at is not null`), 4, "units active and verified");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='${BRACKET}' and holder_kind='warehouse'`), 40, "bracket stock");
  eq(s1(`select u.email from inv_counts c join auth.users u on u.id=c.confirmed_by where c.id='${COUNT_ID}'`), "ceo@e2e.local", "confirmed by the founder");
  await R.go(`/inventory/manage?count=${COUNT_ID}#counts`);
  await R.seen(/Verified by [^ ]+/, 15000, "aside[role=dialog]");
  console.log("   shown:", (await R.panel().innerText()).replace(/\s+/g, " ").match(/Verified by.{0,60}/)?.[0]);
});


// ---------------------------------------------------------------------------------------------------------------------------
// 2. Warehouse operator: labels
// ---------------------------------------------------------------------------------------------------------------------------
const SENSOR_CODES = () => sqlRowsOf(`select u.code from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}' order by u.code`);
function sqlRowsOf(q) { return sql(q).split("\n").filter(Boolean); }
await step("operator opens the labels of the new units from the item and the QR decodes to the readable code (no price, no person)", async () => {
  // a purchase cost and a holder exist in the books: neither may ever reach a label (set up as the owner would: the UI shows costs to founders only)
  const unit1 = SENSOR_CODES()[0];
  sql(`insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency, entered_by) select company_id, item_id, id, current_date, 1250.00, 'AED', '00000000-0000-4000-8000-0000000000a3' from inv_units where code='${unit1}'`);
  await R.as("hr1");
  await R.go(`/inventory?open=${itemId(SENSOR)}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Print labels for all units/ }).click();
  await R.page.waitForURL(/\/inventory\/labels/);
  await R.page.locator(".label-cell").first().waitFor();
  eq(await R.page.locator(".label-cell").count(), 4, "labels shown");
  await R.shot("flow1-labels");
  await R.page.addScriptTag({ content: jsQRSource });
  const decoded = await R.page.evaluate(async () => {
    const out = [];
    for (const cell of document.querySelectorAll(".label-cell")) {
      const svg = cell.querySelector(".label-qr svg"); const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml); await img.decode();
      const c = document.createElement("canvas"); c.width = c.height = 480; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 480, 480); g.drawImage(img, 0, 0, 480, 480);
      const q = window.jsQR(g.getImageData(0, 0, 480, 480).data, 480, 480);
      out.push({ code: cell.getAttribute("data-code"), text: cell.innerText.replace(/\s+/g, " ").trim(), qr: q ? q.data : null });
    }
    return out;
  });
  const codes = SENSOR_CODES();
  eq(decoded.map((d) => d.code).sort().join(","), codes.join(","), "label codes");
  for (const d of decoded) {
    check(d.qr, `QR of ${d.code} did not decode`);
    const u = new URL(d.qr);
    eq(u.pathname + u.search, `/inventory/scan?c=${d.code}`, `QR payload of ${d.code}`);
    check(d.qr.length < 80, "QR payload is only an address with the code");
    check(!/AED|1250|\d+\.\d{2}|@|employee|project|Showroom/i.test(d.qr + " " + d.text), `label ${d.code} carries something private: ${d.text}`);
    check(d.text.includes(d.code) && d.text.includes(SENSOR), `label text is the readable code and short name: ${d.text}`);
  }
  console.log("   label:", decoded[0].text, "| QR ->", decoded[0].qr);
});
await step("printing records the history; a reprint carries the same codes and creates no equipment", async () => {
  const before = codes0();
  function codes0() { return SENSOR_CODES().join(","); }
  const unitsBefore = s1("select count(*) from inv_units");
  await R.page.getByRole("button", { name: /^Print$/ }).click();
  await R.page.getByText(/Print history updated for 4 labels/).waitFor({ timeout: 15000 });
  eq(s1(`select count(*) from inv_label_prints lp join inv_units u on u.id=lp.unit_id join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and reason='first'`), 4, "first prints");
  await R.page.reload({ waitUntil: "load" });
  await R.page.locator(".label-cell").first().waitFor();
  await R.page.getByRole("button", { name: /^Print$/ }).click();
  await R.page.getByText(/Print history updated for 4 labels/).waitFor({ timeout: 15000 });
  eq(s1(`select count(*) from inv_label_prints lp join inv_units u on u.id=lp.unit_id join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and reason='reprint'`), 4, "reprints");
  eq(codes0(), before, "same codes after the reprint");
  eq(s1("select count(*) from inv_units"), unitsBefore, "no new equipment from printing");
  eq(s1(`select count(distinct printed_by) from inv_label_prints`), 1, "printed by one person");
});


// ---------------------------------------------------------------------------------------------------------------------------
// 3. Project Manager: the equipment request
// ---------------------------------------------------------------------------------------------------------------------------
const dayAt = (n, hhmm) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) + "T" + hhmm;
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
let REQ = "";
await step("project manager starts a request for Showroom refresh (dates in Dubai time)", async () => {
  await R.as("mgr");
  await R.go(`/projects/${PRJ}/equipment`);
  await R.page.getByRole("button", { name: "New equipment request" }).first().click();
  await R.dialog().waitFor();
  await dlgFill("What is it for", "Interactive floor for the showroom");
  await R.dialog().getByLabel("Pickup location (optional)").selectOption({ label: "Dubai" });
  await dlgFill("Leaves the warehouse", dayAt(9, "08:00"));
  await dlgFill("Due back", dayAt(21, "17:00"));
  await R.dialog().locator("summary", { hasText: "Add more details" }).click();
  await R.dialog().getByLabel("Time zone of the dates").fill("Asia/Dubai");
  await R.dialog().getByLabel("Destination").fill("Showroom, Dubai Design District");
  await R.shot("flow1-request-new");
  await R.dialog().getByRole("button", { name: "Create draft" }).click();
  await R.closedDialog();
  await until(() => s1("select count(*) from inv_requests") === "1");
  REQ = s1("select id from inv_requests");
  eq(s1(`select status from inv_requests where id='${REQ}'`), "draft", "draft");
  eq(s1(`select timezone from inv_requests where id='${REQ}'`), "Asia/Dubai", "time zone");
  eq(s1("select count(*) from inv_reservations"), 0, "a draft reserves nothing");
  await R.page.waitForURL(new RegExp(`request=${REQ}`));
});


const addLine = async (itemName, search, qty) => {
  const d = R.page.locator("details:has(> summary:text-is('Add an item'))").first();
  if (!(await d.evaluate((e) => e.open))) await d.locator("summary").first().click();
  await d.getByLabel("Item", { exact: true }).fill(search);
  const list = d.getByLabel("Matching items");
  await list.waitFor();
  await list.selectOption({ label: itemName });
  await d.getByLabel("Quantity", { exact: true }).fill(String(qty));
  await d.getByRole("button", { name: "Add line" }).click();
  await R.page.locator("main").getByText(new RegExp(itemName), { exact: false }).first().waitFor();
};
await step("project manager adds the items (whole units and metres) and submits the request", async () => {
  await R.go(`/projects/${PRJ}/equipment?request=${REQ}`);
  await addLine(SENSOR, "Floor", 4);
  await until(() => s1(`select count(*) from inv_request_lines where request_id='${REQ}'`) === "1");
  await addLine("HDMI cable", "HDMI", 6);
  await until(() => s1(`select count(*) from inv_request_lines where request_id='${REQ}'`) === "2");
  await addLine("Power cable", "Power", 20.5);
  await until(() => s1(`select count(*) from inv_request_lines where request_id='${REQ}'`) === "3");
  await addLine(BRACKET, "Mounting", 10);
  await until(() => s1(`select count(*) from inv_request_lines where request_id='${REQ}'`) === "4");
  eq(s1(`select qty from inv_request_lines l join inv_items i on i.id=l.item_id where request_id='${REQ}' and i.name='Power cable'`), 20.5, "metre quantity kept");
  await R.page.getByText(new RegExp(BRACKET)).first().waitFor();
  await sleep(500);
  await R.shot("flow1-request-lines");
  await R.page.getByRole("button", { name: "Submit to the warehouse" }).click();
  await until(() => s1(`select status from inv_requests where id='${REQ}'`) === "submitted");
  eq(s1("select count(*) from inv_reservations"), 0, "submitting reserves nothing");
});


// ---------------------------------------------------------------------------------------------------------------------------
// 4. Warehouse operator: reserve, dispatch part of it
// ---------------------------------------------------------------------------------------------------------------------------
const lineRow = (name) => R.page.locator("aside[role=dialog] tbody tr", { hasText: name }).filter({ has: R.page.getByRole("button", { name: "Reserve", exact: true }) }).first();
await step("operator reserves every line from Dubai (nothing is dispatched yet)", async () => {
  await R.as("hr1");
  await R.go(`/inventory/requests?open=${REQ}`);
  await R.shot("flow1-request-warehouse");
  for (const name of [SENSOR, "HDMI cable", "Power cable", BRACKET]) {
    await R.page.locator("aside[role=dialog] tbody tr", { hasText: name }).first().getByRole("button", { name: "Reserve", exact: true }).click();
    await R.dialog().waitFor();
    if (name === SENSOR) await R.shot("flow1-reserve-dialog");
    await R.dialog().getByRole("button", { name: "Reserve", exact: true }).click();
    await R.dialog().getByText(/Reserved \d/).first().waitFor();   // the result is read first, then the dialog is closed
    if (name === SENSOR) await R.shot("flow1-reserve-result");
    await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
    await R.closedDialog();
    await until(() => Number(s1(`select count(*) from inv_reservations r join inv_request_lines l on l.id=r.request_line_id join inv_items i on i.id=l.item_id where l.request_id='${REQ}' and i.name='${name}' and r.status='active'`)) >= 1, 15000, name + " ");
  }
  eq(s1("select count(*) from inv_reservations where unit_id is not null and status='active'"), 4, "four unit reservations");
  eq(s1(`select sum(r.qty) from inv_reservations r join inv_request_lines l on l.id=r.request_line_id join inv_items i on i.id=l.item_id where i.name='Power cable' and r.status='active'`), 20.5, "metres reserved");
  eq(s1("select count(*) from inv_movements where kind='dispatch_project'"), 0, "reserving moves nothing");
});


// A movement form in the side panel: search, add what the list needs, type quantities. (Nothing is recorded before the review step.)
const mvPanel = () => R.panel();
const searchAdd = async (query, addName, times = 1) => {
  const box = mvPanel().getByLabel("Search for an item or unit to add");
  await box.fill(""); await box.fill(query);
  const results = mvPanel().getByRole("list", { name: "Search results" });
  await results.waitFor();
  for (let n = 0; n < times; n++) await results.getByRole("button", { name: addName }).nth(n).click().then(() => sleep(250));
  await box.fill("");
};
const qtyOf = (label) => mvPanel().getByLabel(`Quantity of ${label}`, { exact: true });
const reviewText = async () => (await mvPanel().innerText()).replace(/\s+/g, " ");
const movementsOf = (kind) => Number(s1(`select count(*) from inv_movements where kind='${kind}'`));
const openDispatchFromRequest = async () => {
  await R.go(`/inventory/requests?open=${REQ}`);
  await R.page.locator("aside[role=dialog]").getByRole("link", { name: "Dispatch", exact: true }).click();
  await R.page.waitForURL(/action=dispatch/);
  await mvPanel().getByText("Dispatch to a project").first().waitFor();
};

await step("dispatch form refuses 2.5 of a whole-number item and more than is on the shelf, in plain words", async () => {
  await R.as("hr1");
  await openDispatchFromRequest();
  eq(await mvPanel().getByLabel("Request (optional)").inputValue() !== "", true, "request preselected");
  await searchAdd("HDMI", /^Add HDMI cable/);
  await qtyOf("HDMI cable").fill("2.5");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText(/whole number/i).first().waitFor({ timeout: 8000 });
  console.log("   2.5 HDMI ->", (await reviewText()).match(/[^.]*whole number[^.]*\./i)?.[0]);
  await qtyOf("HDMI cable").fill("500");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await R.page.waitForTimeout(800);
  let t = await reviewText();
  const alerts = (await mvPanel().locator("[role=alert]").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
  if (!/Check before you confirm/.test(t)) { console.log("   500 HDMI refused before review:", alerts); check(/(only|not enough|more than|enough|short|shelf)/i.test(alerts), "plain message about the quantity: " + alerts); }
  else {
    await mvPanel().getByRole("button", { name: "Confirm dispatch" }).click();
    await R.page.waitForTimeout(1500);
    t = await reviewText();
    console.log("   500 HDMI refused by the database:", t.match(/(Only|Not enough|more than|enough)[^.]*\./i)?.[0]);
    check(!/Recorded/.test(t), "500 HDMI must not be recorded");
    check(/(only|not enough|more than|enough|short)/i.test(t), "plain message about the quantity: " + t.slice(0, 300));
  }
  await mvPanel().getByRole("button", { name: "Remove HDMI cable from the list" }).click();
  await searchAdd("Power", /^Add Power cable/);
  await qtyOf("Power cable").fill("1.2345");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText(/At most 3 decimal places/i).first().waitFor({ timeout: 8000 });
  console.log("   1.2345 m ->", (await mvPanel().locator("[role=alert], p").allInnerTexts()).find((x) => /decimal/i.test(x)));
  eq(movementsOf("dispatch_project"), 0, "nothing recorded by a refused dispatch");
  check(Number(s1("select min(qty) from inv_balances")) >= 0, "no negative balance");
  await R.shot("flow1-dispatch-refused");
});


await step("operator dispatches part of the request (3 of 4 sensors, 4 of 6 HDMI, 12.25 m of cable, all brackets): review step, then ONE movement on a double click", async () => {
  await openDispatchFromRequest();
  await searchAdd("Floor", /^Add Floor sensor/, 3);
  await searchAdd("HDMI", /^Add HDMI cable/);
  await qtyOf("HDMI cable").fill("4");
  await searchAdd("Power", /^Add Power cable/);
  await qtyOf("Power cable").fill("12.25");
  await searchAdd("Mounting", /^Add Mounting bracket/);
  await qtyOf("Mounting bracket").fill("10");
  await R.shot("flow1-dispatch-form");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText("Check before you confirm").waitFor();
  const t = await reviewText();
  check(/This is what will be recorded\. Nothing has changed yet/.test(t), "review wording");
  eq(movementsOf("dispatch_project"), 0, "nothing recorded at the review step");
  console.log("   review:", t.slice(t.indexOf("Check before"), t.indexOf("Check before") + 420));
  await R.shot("flow1-dispatch-review");
  await mvPanel().getByRole("button", { name: "Confirm dispatch" }).dblclick();
  await mvPanel().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await R.shot("flow1-dispatch-done");
  await sleep(800);
  eq(movementsOf("dispatch_project"), 1, "one dispatch movement after a double click");
  eq(s1("select count(*) from inv_movement_lines l join inv_movements m on m.id=l.movement_id where m.kind='dispatch_project'"), 6, "6 lines: 3 units, HDMI, cable, brackets");
  eq(s1(`select count(*) from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and custody_kind='project'`), 3, "three sensors on the project");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='HDMI cable' and holder_kind='project'`), 4, "HDMI on the project");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='HDMI cable' and holder_kind='warehouse'`), 8, "HDMI left on the shelf");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='Power cable' and holder_kind='project'`), 12.25, "metres on the project");
  eq(s1(`select status from inv_requests where id='${REQ}'`), "in_progress", "request is in progress");
});


// The connection is lost AFTER the server has done the work: the real request goes through and its answer is thrown away.
const loseNextAnswer = async () => {
  let armed = true;
  const handler = async (route) => {
    const req = route.request();
    if (armed && req.method() === "POST" && req.headers()["next-action"]) { armed = false; await route.fetch(); await route.abort("connectionreset"); }
    else await route.continue();
  };
  await R.page.route("**/*", handler);
  return async () => { await R.page.unroute("**/*", handler); };
};
await step("lost connection: the answer is lost after the server recorded the dispatch; \"Try again with the same entry\" records nothing twice", async () => {
  await openDispatchFromRequest();
  await searchAdd("Floor", /^Add Floor sensor/, 1);
  await searchAdd("HDMI", /^Add HDMI cable/);
  await qtyOf("HDMI cable").fill("2");
  await searchAdd("Power", /^Add Power cable/);
  await qtyOf("Power cable").fill("8.25");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText("Check before you confirm").waitFor();
  const before = movementsOf("dispatch_project");
  const restore = await loseNextAnswer();
  await mvPanel().getByRole("button", { name: "Confirm dispatch" }).click();
  await mvPanel().getByRole("button", { name: "Check whether it went through" }).waitFor({ timeout: 20000 });
  await R.shot("flow1-dispatch-lost-connection");
  console.log("   shown:", (await mvPanel().locator("[role=alert]").first().innerText()).replace(/\s+/g, " "));
  await restore();
  eq(movementsOf("dispatch_project"), before + 1, "the server had recorded it once");
  check(!(await mvPanel().getByText("Recorded", { exact: true }).count()), "success is not claimed before the database says so");
  await mvPanel().getByRole("button", { name: "Try again with the same entry" }).click();
  await mvPanel().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(600);
  eq(movementsOf("dispatch_project"), before + 1, "retrying the identical entry recorded nothing more");
  eq(s1(`select count(*) from inv_units u join inv_items i on i.id=u.item_id where i.name='${SENSOR}' and custody_kind='project'`), 4, "all four sensors on the project");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='HDMI cable' and holder_kind='project'`), 6, "HDMI on the project");
  eq(s1(`select status from inv_requests where id='${REQ}'`), "fulfilled", "everything requested has gone out");
});


// ---------------------------------------------------------------------------------------------------------------------------
// 5. The project returns part of it
// ---------------------------------------------------------------------------------------------------------------------------
const [S1, S2, S3, S4] = SENSOR_CODES();
const openReturnFromProject = async () => {
  await R.go("/inventory?action=return");
  await mvPanel().getByLabel("Back into").selectOption({ label: "Dubai" });
  await mvPanel().getByRole("radio", { name: "A project" }).check();
  await mvPanel().getByLabel("Which project?").selectOption({ index: 1 });
  await mvPanel().getByRole("list", { name: "What they are holding" }).waitFor();
};
const addHeld = async (name) => { await mvPanel().getByRole("list", { name: "What they are holding" }).getByRole("button", { name }).click(); await sleep(250); };
const lineOf = (label) => mvPanel().getByRole("listitem", { name: label, exact: true });
const usableNow = (code) => s1(`select (lifecycle='active' and condition in ('good','fair') and custody_kind='warehouse') from inv_units where code='${code}'`);
await step("project returns part: sensor 1 good, sensor 2 damaged, 3 HDMI, 5.25 m of cable; the rest stays outstanding", async () => {
  await openReturnFromProject();
  const held = (await mvPanel().getByRole("list", { name: "What they are holding" }).innerText()).replace(/\s+/g, " ");
  console.log("   project holds:", held.slice(0, 300));
  await addHeld(new RegExp(`^Add Floor sensor ${S1}`));
  await addHeld(new RegExp(`^Add Floor sensor ${S2}`));
  await addHeld(/^Add HDMI cable/);
  await addHeld(/^Add Power cable/);
  await lineOf(`Floor sensor ${S2}`).getByLabel("Condition").selectOption({ label: "Damaged: held back" });
  await lineOf(`Floor sensor ${S2}`).getByLabel("Note (optional)").fill("Cracked glass on one corner");
  await qtyOf("HDMI cable").fill("3");
  await qtyOf("Power cable").fill("5.25");
  await R.shot("flow1-return-form");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText("Check before you confirm").waitFor();
  const t = await reviewText();
  check(/Damaged/i.test(t), "review shows the damaged unit: " + t.slice(0, 400));
  await R.shot("flow1-return-review");
  eq(movementsOf("return_project"), 0, "nothing recorded at review");
  await mvPanel().getByRole("button", { name: "Confirm return" }).dblclick();
  await mvPanel().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(800);
  eq(movementsOf("return_project"), 1, "one return movement");
  eq(usableNow(S1), "t", "the good sensor is available again");
  eq(s1(`select condition from inv_units where code='${S2}'`), "damaged", "the damaged sensor is recorded as damaged");
  eq(usableNow(S2), "f", "the damaged sensor is NOT available");
  eq(s1(`select custody_kind from inv_units where code='${S2}'`), "warehouse", "the damaged sensor is back in the warehouse, held");
  eq(s1(`select custody_kind from inv_units where code in ('${S3}','${S4}') group by 1`), "project", "sensors 3 and 4 are still out");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='HDMI cable' and holder_kind='project'`), 3, "3 HDMI still out");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='Power cable' and holder_kind='project'`), 15.25, "15.25 m of cable still out");
  eq(s1(`select status from inv_requests where id='${REQ}'`), "fulfilled", "not closed: equipment is still out");
});
await step("the usable stock counts the good sensor and not the damaged one", async () => {
  await R.go(`/inventory?open=${itemId(SENSOR)}`);
  const t = (await R.panel().innerText()).replace(/\s+/g, " ");
  const usable = Number(t.match(/Usable now\s*(\d+)/)?.[1]);
  eq(usable, 1, "usable sensors shown (only the good one is back and free)");
  check(/Needs checking, damaged, missing or out for repair\s*1/.test(t), "the damaged one is counted under needs attention: " + t.slice(0, 500));
  await R.shot("flow1-item-after-return");
});


await step("the project's Equipment page and the request show what is still outstanding", async () => {
  await R.as("mgr");
  await R.go(`/projects/${PRJ}/equipment`);
  const t = await R.mainText();
  const out = t.slice(t.indexOf("Equipment still out"), t.indexOf("Requests ("));
  console.log("   still out:", out.slice(0, 520));
  for (const code of [S3, S4]) check(out.includes(code), `${code} is listed as still out`);
  check(!out.includes(S1) && !out.includes(S2), "returned sensors are no longer listed as out");
  check(/HDMI cable/.test(out) && /3/.test(out), "HDMI outstanding listed");
  check(/15\.25 m/.test(out), "metres outstanding listed: " + out.slice(0, 400));
  check(/Mounting bracket/.test(out) && /10/.test(out), "brackets outstanding listed");
  await R.shot("flow1-project-outstanding");
  await R.go(`/projects/${PRJ}/equipment?request=${REQ}`);
  const row = (name) => R.page.locator("main tbody tr", { hasText: name }).first();
  const cells = async (name) => (await row(name).locator("td").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  const sensor = await cells(SENSOR);
  console.log("   sensor line:", sensor.join(" | "));
  eq(sensor[1], "4", "needed"); eq(sensor[3], "4", "dispatched"); eq(sensor[4], "2", "returned"); eq(sensor[5], "2", "outstanding");
  const cable = await cells("Power cable");
  eq(cable[5], "15.25 m", "metres outstanding on the request line");
  check(/equipment still out on 4 lines/.test(await R.mainText()), "the request header says on how many lines equipment is still out (never a sum of unlike units)");
  await row(SENSOR).scrollIntoViewIfNeeded();
  await R.shot("flow1-request-outstanding");
});


// ---------------------------------------------------------------------------------------------------------------------------
// 6. Final reconciliation by the warehouse operator
// ---------------------------------------------------------------------------------------------------------------------------
await step("final return: sensor 3, the other 3 HDMI, the other 15.25 m and the brackets come back (the answer is lost; the check says it went through)", async () => {
  await R.as("hr1");
  await openReturnFromProject();
  await addHeld(new RegExp(`^Add Floor sensor ${S3}`));
  await addHeld(/^Add HDMI cable/);
  await addHeld(/^Add Power cable/);
  await addHeld(/^Add Mounting bracket/);
  await qtyOf("HDMI cable").fill("3");
  await qtyOf("Power cable").fill("15.25");
  await qtyOf("Mounting bracket").fill("10");
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText("Check before you confirm").waitFor();
  const t = await reviewText();
  console.log("   review:", t.slice(t.indexOf("Still outstanding"), t.indexOf("Still outstanding") + 160));
  check(/Still outstanding\s*1 other item stays with the project/.test(t), "review says one item (sensor 4) is still out: " + t);
  const before = movementsOf("return_project");
  const restore = await loseNextAnswer();
  await mvPanel().getByRole("button", { name: "Confirm return" }).click();
  await mvPanel().getByRole("button", { name: "Check whether it went through" }).waitFor({ timeout: 20000 });
  await restore();
  eq(movementsOf("return_project"), before + 1, "the server recorded it once");
  await mvPanel().getByRole("button", { name: "Check whether it went through" }).click();
  await mvPanel().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(600);
  eq(movementsOf("return_project"), before + 1, "checking recorded nothing more");
  eq(usableNow(S3), "t", "sensor 3 is available again");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='HDMI cable' and holder_kind='warehouse' and condition='good'`), 12, "all 12 HDMI cables are on the shelf");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='Power cable' and holder_kind='warehouse'`), 150.5, "all the metres are on the shelf");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='${BRACKET}' and holder_kind='warehouse'`), 40, "all brackets on the shelf");
});


const itemAction = async (item, menuItem) => {
  await R.go(`/inventory?open=${itemId(item)}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: menuItem }).click();
  await R.dialog().waitFor();
};
const dlgSearchAdd = async (query, addName) => {
  const box = R.dialog().getByLabel("Search for an item or unit to add");
  await box.fill(query);
  const list = R.dialog().getByRole("list", { name: "Search results" });
  await list.waitFor();
  await list.getByRole("button", { name: addName }).first().click();
};
await step("sensor 4 never came back: the operator marks it missing with a reason, from the unit's own page", async () => {
  await R.go(`/inventory?unit=${S4}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Mark missing/ }).click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel("At", { exact: true }).selectOption({ label: "Dubai" });
  await R.dialog().getByLabel("Reason", { exact: true }).fill("Not returned by the site team after the install; the project manager confirms it was not taken back");
  await R.dialog().getByRole("button", { name: "Review", exact: true }).click();
  await R.dialog().getByText("Check before you confirm").waitFor();
  await R.shot("flow1-missing-review");
  await R.dialog().getByRole("button", { name: /Confirm missing/ }).click();
  await R.dialog().getByText("Recorded").first().waitFor({ timeout: 20000 });
  eq(s1(`select lifecycle from inv_units where code='${S4}'`), "missing", "sensor 4 is missing");
  eq(usableNow(S4), "f", "a missing unit is not available");
  eq(s1("select count(*) from inv_movements where kind='adjust_missing'"), 1, "one adjustment movement");
  eq(s1("select length(reason) > 10 from inv_movements where kind='adjust_missing'"), "t", "the reason is kept");
});
await step("a missing unit is shown as missing (not as a normal outstanding item) on the project's Equipment page", async () => {
  await R.as("mgr");
  await R.go(`/projects/${PRJ}/equipment`);
  const t = await R.mainText();
  const out = t.slice(t.indexOf("Equipment still out"), t.indexOf("Requests ("));
  console.log("   still out:", out.slice(0, 300));
  check(out.includes(S4) && /Recorded as missing/.test(out) && /not returned/.test(out), "sensor 4 listed as missing and not returned");
  check(!out.includes(S3), "sensor 3 (returned) is not listed");
  await R.shot("flow1-project-missing");
});
const REPAIR_REF = "JOB-REPAIR-0042";
await step("the damaged sensor 2 is sent for repair (not available) and comes back good (available)", async () => {
  await R.as("hr1");
  await R.go(`/inventory?unit=${S2}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Send for repair/ }).click();
  await R.dialog().waitFor();
  await R.dialog().getByLabel(/Repair reference|repairer/i).first().fill(REPAIR_REF);
  await R.dialog().getByRole("button", { name: "Review", exact: true }).click();
  await R.dialog().getByText("Check before you confirm").waitFor();
  await R.dialog().getByRole("button", { name: /Confirm sent for repair/ }).click();
  await R.dialog().getByText("Recorded").first().waitFor({ timeout: 20000 });
  eq(s1(`select custody_kind from inv_units where code='${S2}'`), "repair", "out for repair");
  eq(usableNow(S2), "f", "not available while at the repairer");
  await R.go(`/inventory?unit=${S2}`);
  await R.page.getByRole("button", { name: "More actions" }).click();
  await R.page.getByRole("menuitem", { name: /Back from repair/ }).click();
  await R.dialog().waitFor();
  await R.shot("flow1-repair-in");
  await R.dialog().getByRole("button", { name: "Review", exact: true }).click();
  await R.dialog().getByText("Check before you confirm").waitFor();
  const t = await R.dialog().innerText();
  console.log("   back from repair, condition offered:", t.replace(/\s+/g, " ").match(/(Good|Damaged)[^.]{0,40}/)?.[0]);
  await R.dialog().getByRole("button", { name: /Confirm back from repair/ }).click();
  await R.dialog().getByText("Recorded").first().waitFor({ timeout: 20000 });
  console.log("   after repair: condition", s1(`select condition from inv_units where code='${S2}'`), "usable", usableNow(S2));
});

await step("operator receives a delivery of 20 more brackets (review step, one movement on a double click, the bin kept)", async () => {
  await R.go("/inventory?action=receive");
  await mvPanel().getByLabel("Receive into").selectOption({ label: "Dubai" });
  await searchAdd("Mounting", /^Add Mounting bracket/);
  await qtyOf("Mounting bracket").fill("20");
  await mvPanel().getByRole("listitem", { name: "Mounting bracket", exact: true }).getByLabel("Put into bin").selectOption({ label: "A-01 (Shelf A1)" });
  await mvPanel().getByRole("button", { name: "Review", exact: true }).click();
  await mvPanel().getByText("Check before you confirm").waitFor();
  await R.shot("flow1-receive-review");
  const before = movementsOf("receipt");
  await mvPanel().getByRole("button", { name: "Confirm receipt" }).dblclick();
  await mvPanel().getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(600);
  eq(movementsOf("receipt"), before + 1, "one receipt after a double click");
  eq(s1(`select coalesce(sum(b.qty),0) from inv_balances b join inv_items i on i.id=b.item_id where i.name='${BRACKET}' and holder_kind='warehouse'`), 60, "brackets on the shelf");
  await R.shot("flow1-receive-done");
});

// ---------------------------------------------------------------------------------------------------------------------------
// 7. The books agree
// ---------------------------------------------------------------------------------------------------------------------------
await step("idempotency and negative stock at the database itself (same key twice, same key with other content, more than exists)", async () => {
  const lines = (qty) => `'[{"item_id":"${itemId("Cable ties")}","qty":${qty}}]'::jsonb`;
  const hdmi = (qty) => `'[{"item_id":"${itemId("HDMI cable")}","qty":${qty}}]'::jsonb`;
  const DXB = s1("select id from inv_locations where code='DXB'");
  const ties = () => Number(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${itemId("Cable ties")}' and holder_kind='warehouse'`));
  const t0 = ties(); const m0 = Number(s1("select count(*) from inv_movements"));
  const first = asDbTry(1, `select inv_receive_stock('${AE}','${DXB}','idem-proof-00000001',${lines(5)})->>'code'`);
  const again = asDbTry(1, `select inv_receive_stock('${AE}','${DXB}','idem-proof-00000001',${lines(5)})->>'code'`);
  check(first.ok && again.ok, "both calls answer: " + first.out + " / " + again.out);
  eq(again.out, first.out, "the retry returns the SAME movement");
  eq(ties(), t0 + 5, "stock went up once");
  eq(Number(s1("select count(*) from inv_movements")), m0 + 1, "one movement");
  const other = asDbTry(1, `select inv_receive_stock('${AE}','${DXB}','idem-proof-00000001',${lines(7)})`);
  check(!other.ok && /key|already|different/i.test(other.out), "the same key with other content is refused: " + other.out.slice(0, 200));
  const huge = asDbTry(1, `select inv_issue_to_employee('${AE}','${DXB}',(select id from employees where company_id='${AE}' limit 1),'neg-proof-00000001',${hdmi(100000)})`);
  check(!huge.ok, "issuing more than exists must be refused");
  console.log("   refusal text:", huge.out.replace(/\s+/g, " ").slice(0, 200));
  check(/only|not enough|enough|on the shelf/i.test(huge.out) && !/violates|constraint|stack|syntax/i.test(huge.out), "the refusal is plain words");
  eq(ties(), t0 + 5, "a refused call changed nothing");
});
await step("the books agree: no ledger problem, every balance equals its ledger lines, nothing negative, units agree with their last movement", async () => {
  const L = ledgerCheck();
  eq(L.viaFunction, 0, "inv_ledger_problems() rows (as the founder, who holds view_audit)");
  eq(L.balancesOff, 0, "balances that differ from their ledger lines");
  eq(L.negative, 0, "negative balances");
  // per item: what the balances hold equals what the ledger says came in minus what went out
  const rows = sqlRowsOf(`select i.name || ': balances ' || coalesce(b.q,0) || ' ledger ' || coalesce(l.net,0) from inv_items i
    left join (select item_id, sum(qty) q from inv_balances group by item_id) b on b.item_id=i.id
    left join (select item_id, sum(case when to_balance_id is not null then qty else 0 end) - sum(case when from_balance_id is not null then qty else 0 end) net from inv_movement_lines group by item_id) l on l.item_id=i.id
    where i.tracking in ('quantity','consumable') order by i.name`);
  for (const r of rows) { const m = r.match(/balances ([\d.]+) ledger (-?[\d.]+)/); eq(Number(m[1]), Number(m[2]), "item total vs ledger (" + r + ")"); }
  console.log("   " + rows.join(" | "));
  // units: custody and lifecycle agree with the last movement (the second rule of inv_ledger_problems, restated)
  const unitsOff = s1(`select count(*) from inv_units u join (select distinct on (l.unit_id) l.unit_id, l.to_kind from inv_movement_lines l join inv_movements m on m.id=l.movement_id where l.unit_id is not null order by l.unit_id, m.recorded_at desc, m.code desc, l.id desc) x on x.unit_id=u.id
    where not (case x.to_kind when 'warehouse' then u.custody_kind='warehouse' when 'project' then u.custody_kind='project' when 'repair' then u.custody_kind='repair' when 'adjustment' then u.lifecycle in ('missing','retired') else true end)`);
  eq(unitsOff, 0, "units whose custody differs from their last movement");
  eq(s1("select count(*) from inv_movements where kind in ('opening','receipt')"), s1("select count(*) from inv_movements where kind in ('opening','receipt')"), "(sanity)");
  const summary = sqlRowsOf(`select code || ' ' || lifecycle || '/' || condition || '/' || custody_kind from inv_units u where item_id='${itemId(SENSOR)}' order by code`);
  console.log("   sensors at the end:", summary.join(" | "));
  eq(s1(`select status from inv_requests where id='${REQ}'`), "fulfilled", "the request stays open while one unit is missing (not closed as if everything came back)");
});

R.stop = R.stop; // (keeps the linter quiet about the helper surface)
const code = R.verdict("inventory-flow-1");
await R.stop();
process.exit(code);
