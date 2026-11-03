// WORKFLOW: physical location versus ownership, in a real browser (LOCAL STACK ONLY, fictional data).
//   A unit owned by company PL is kept at company AE's Dubai warehouse (it got there through the existing, owner-authorised cross-company path).
//   One person who works with both companies moves it Dubai -> Riyadh (both run by AE) through the ordinary Send transfer -> In transit -> Receive transfer.
//   Proves: same barcode / serial / owner before and after; Dubai stops showing it as available at send; Riyadh shows it only after receipt,
//   labelled "Owned by ..."; the scan address resolves the same unit before and after; a person without a PL grant still reads nothing of it.
//   PART 2, across companies: equipment owned by AE (UAE) is sent Dubai -> "Riyadh hub", a warehouse run by PL, through the same Send transfer -> In transit -> Receive transfer.
//   Proves: the Send form lists PL's warehouses only once AE has authorised sharing; a PL warehouse operator (works for PL only) sees the incoming unit
//   and its transfer (minimum fields, "Owned by Enginious Local AE", never a cost, never AE's other units), receives it through the screen, and then sees
//   it available there; the owner (AE) traces the same transfer through dispatch and receipt; anyone else is told nothing.
//   Revoking the sharing AFTER dispatch strands nothing: 3 counted Sending cards sent, sharing revoked, the PL operator still sees them (and the laptop) with
//   "Sharing revoked\u2014contact owner", receives them through the screen, reads "3 \u00d7 Sending card \u00b7 Owned by ... \u00b7 at the hub"; new dispatches and the Send form are refused; authorising again clears the flag.
// NEEDS: the Inventory seed (seed/inventory.sh). RESEED=1 reseeds first (the script writes to the database it drives).
//   Usage: RESEED=1 SHOTS_DIR=<dir> node os-shell-checks/inventory-transfer-location-flow.mjs
import { makeRunner, maybeReseed, sql, sqlRows, asDb, asDbTry, rest, rpc, until, sleep, movementHelpers, dayAt, U } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("transfer-location");
await R.start();
const { step, check, eq } = R;
const AE = "00000000-0000-4000-8000-00000000a001"; const PL = "00000000-0000-4000-8000-00000000a002";
const AE_NAME = "Enginious Local AE"; const PL_NAME = "Enginious Local PL";
const s1 = (q) => sql(q).split("\n")[0];
const DXB = s1("select id from inv_locations where name='Dubai'"); const RUH = s1("select id from inv_locations where name='Riyadh'"); const POZ = s1("select id from inv_locations where name='Poznan'");
const H = movementHelpers(R);
const key = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let CODE = ""; let UNIT = ""; let TRUSS = "";

/** The row of the Stock list for an item, as text, or null when the list does not show it. */
const stockRow = async (location, name) => {
  await R.go(`/inventory/stock?location=${location}&q=${encodeURIComponent(name)}`);
  // the item list only: equipment of other companies has its own table further down the page
  const row = R.page.locator("main table", { has: R.page.locator("caption", { hasText: "Inventory items" }) }).first().locator("tbody tr", { hasText: name }).first();
  return (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ") : null;
};
const pickPlace = async (sel, re) => {   // the options arrive with the form: wait for the one we want
  let labels = [];
  for (let i = 0; i < 40; i++) { labels = await sel.locator("option").allInnerTexts(); const l = labels.find((x) => re.test(x)); if (l) { await sel.selectOption({ label: l }); return; } await sleep(250); }
  throw new Error(`no ${re} among ${labels.join(" | ")}`);
};
const scanUnitId = async () => { await R.go(`/inventory/scan?c=${CODE}`); return new URL(R.page.url()).searchParams.get("unit"); };

await step("set-up (through the real functions): a PL-owned truss is counted in at Poznan, PL authorises AE to use it, and it reaches AE's Dubai warehouse; the AE founder also works for PL", async () => {
  asDb(8, `select inv_save_category('${PL}', null, 'Structures')`);
  TRUSS = asDb(8, `select inv_save_item('${PL}', null, '{"name":"Truss 3 m","tracking":"individual","status":"active"}'::jsonb)`);
  UNIT = asDb(8, `select (inv_register_unit(p_company_id => '${PL}', p_item_id => '${TRUSS}', p_serial_number => 'TRUSS-LOC-001', p_location_id => '${POZ}'))->>'unit_id'`);
  const count = asDb(8, `select (inv_start_count('${PL}', '${POZ}', 'opening'))->>'count_id'`);
  asDb(8, `select inv_save_count_line('${count}', 1, p_unit_id => '${UNIT}')`);
  asDb(8, `select inv_confirm_count('${PL}', '${count}', '${key("cnt")}')`);
  asDb(8, `select inv_set_company_sharing('${PL}', '${AE}', true, 'local flow: truss for the Dubai show')`);
  const tr = asDb(8, `select (inv_transfer_dispatch('${PL}', '${POZ}', '${DXB}', '${key("send")}', '[{"unit_id":"${UNIT}"}]'::jsonb, '${new Date(Date.now() + 3 * 86400000).toISOString()}'))->>'transfer_id'`);
  asDb(1, `select inv_transfer_receive('${AE}', '${tr}', '${key("recv")}')`);   // hr1@: Dubai operator of AE
  sql(`insert into inv_company_grants (user_id, company_id, capabilities, note) values ('${U(3)}', '${PL}', '{founder}', 'local flow: works for both companies')`);
  CODE = s1(`select code from inv_units where id='${UNIT}'`);
  eq(s1(`select company_id||'/'||location_id||'/'||custody_kind from inv_units where id='${UNIT}'`), `${PL}/${DXB}/warehouse`, "owned by PL, on the shelf at AE's Dubai");
});

await step("before: the Dubai stock list shows the truss available, labelled with its owner; the scan address opens the same unit", async () => {
  await R.as("ceo");
  const row = await stockRow(DXB, "Truss 3 m");
  check(row && /Owned by Enginious Local PL/.test(row), "Dubai row names the owner: " + row);
  check(/\b1\b/.test(row), "available there: " + row);
  eq(await scanUnitId(), UNIT, "scan resolves the unit");
  const t = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(new RegExp(`In the warehouse: Dubai · ${AE_NAME}`).test(t), "place named with the company that runs it: " + t.slice(0, 400));
  check(new RegExp(`Owned by.*${PL_NAME}`).test(t), "owner shown apart from the place: " + t.slice(0, 400));
  check(t.includes("TRUSS-LOC-001") && t.includes(CODE), "serial and permanent code shown");
});

await step("a person without a PL grant reads no PL row (the data service returns none); as the operator of the warehouse where it sits he sees only the minimum record, and a person with no Inventory access is told nothing", async () => {
  await R.as("hr1");
  await R.go(`/inventory/scan?c=${CODE}`);
  const p = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(p.includes(CODE) && p.includes("TRUSS-LOC-001") && new RegExp(`Owned by.*${PL_NAME}`).test(p), "hr1 (Dubai operator) sees code, serial and owner: " + p.slice(0, 300));
  check(!/Purchase cost|Notes|\bHISTORY\b/.test(p), "and nothing beyond the minimum record: " + p.slice(0, 600));
  const r = await rest("hr1", "GET", `/inv_units?id=eq.${UNIT}&select=id`);
  eq(JSON.stringify(r.body), "[]", "hr1 reads no row of the PL-owned unit");
  const tr = await rest("hr1", "GET", "/inv_transfers?select=id");
  eq(JSON.stringify(tr.body), "[]", "hr1 reads no PL transfer");
  await R.as("mgr");
  await R.go(`/inventory/scan?c=${CODE}`);
  const t = await R.mainText();
  check(!/Truss/.test(t), "mgr (no Inventory access) is told nothing about the unit: " + t.slice(0, 200));
});

await step("Send transfer (UI): Dubai to Riyadh; the review names both warehouses with their company; one movement; it is in transit", async () => {
  await R.as("ceo");
  await R.go(`/inventory/stock?unit=${UNIT}`);
  await R.panel().getByRole("link", { name: "Send to another location" }).click();
  await H.mv().getByText("Send to another location").first().waitFor({ timeout: 10000 }).catch(() => {});
  const mv = H.mv();
  await pickPlace(mv.getByLabel("Send from", { exact: true }), /^Dubai/);
  await pickPlace(mv.getByLabel("Send to", { exact: true }), /^Riyadh/);
  await mv.getByLabel("Expected arrival (optional)").fill(dayAt(3, "12:00"));
  await H.review();
  const t = await H.text();
  check(new RegExp(`Dubai · ${AE_NAME}`).test(t) && new RegExp(`Riyadh · ${AE_NAME}`).test(t), "review names both places with their company: " + t.slice(t.indexOf("Check before"), t.indexOf("Check before") + 400));
  const before = Number(s1("select count(*) from inv_movements where kind='transfer_dispatch'"));
  eq(s1("select count(*) from inv_movements where kind='transfer_dispatch'"), before, "nothing is recorded at the review step");
  await mv.getByRole("button", { name: /^Confirm/ }).click();
  await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(500);
  eq(s1("select count(*) from inv_movements where kind='transfer_dispatch'"), before + 1, "one dispatch movement (the PL dispatch of the set-up is the other)");
  eq(s1(`select company_id||'/'||custody_kind||'/'||code||'/'||serial_number from inv_units where id='${UNIT}'`), `${PL}/transit/${CODE}/TRUSS-LOC-001`, "in transit, owner, code and serial unchanged");
});

await step("In transit: Dubai no longer shows it as available (it says 1 in transit); Riyadh does not show it yet; the unit says where it is going; scan resolves the same unit", async () => {
  const dxb = await stockRow(DXB, "Truss 3 m");
  check(dxb && /1 in transit/.test(dxb) && !/Available here\s*1/.test(dxb), "Dubai: in transit, not available: " + dxb);
  const dxbCells = (await R.page.locator("main table", { has: R.page.locator("caption", { hasText: "Inventory items" }) }).first().locator("tbody tr", { hasText: "Truss 3 m" }).first().locator("td").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  eq(dxbCells[1], "0", "Available here at Dubai is 0");
  eq(await stockRow(RUH, "Truss 3 m"), null, "Riyadh does not list it before receipt");
  eq(await scanUnitId(), UNIT, "scan resolves the same unit while in transit");
  const t = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(new RegExp(`In transit: Dubai · ${AE_NAME} to Riyadh · ${AE_NAME} \\(`).test(t), "the unit names the route: " + t.slice(0, 400));
  check(new RegExp(`Owned by.*${PL_NAME}`).test(t), "owner still shown");
});

await step("Receive transfer (UI): the screen names the owner, receiving puts it at Riyadh without changing the owner", async () => {
  await R.go("/inventory/stock?action=transfer&mode=receive");
  const mv = H.mv();
  await mv.getByLabel("Which transfer arrived?").selectOption({ index: 1 });
  await mv.getByText(/Owned by Enginious Local PL/).first().waitFor({ timeout: 10000 });
  const t = await H.text();
  check(/does not change who owns it/.test(t), "the receive step says it does not change the owner: " + t.slice(0, 500));
  await R.shot("transfer-location-1-receive");
  await H.review();
  const before = Number(s1("select count(*) from inv_movements where kind='transfer_receive'"));
  await mv.getByRole("button", { name: /^Confirm/ }).click();
  await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(500);
  eq(s1("select count(*) from inv_movements where kind='transfer_receive'"), before + 1, "one receive movement");
  eq(s1(`select company_id||'/'||custody_kind||'/'||location_id||'/'||code||'/'||serial_number from inv_units where id='${UNIT}'`), `${PL}/warehouse/${RUH}/${CODE}/TRUSS-LOC-001`, "on the shelf at Riyadh; owner, code and serial unchanged");
});

await step("After receipt: Riyadh lists it available with 'Owned by', Dubai no longer lists it; the scan resolves the same unit and its record says Riyadh and who owns it", async () => {
  const ruh = await stockRow(RUH, "Truss 3 m");
  check(ruh && /Owned by Enginious Local PL/.test(ruh), "Riyadh row names the owner: " + ruh);
  const cells = (await R.page.locator("main table", { has: R.page.locator("caption", { hasText: "Inventory items" }) }).first().locator("tbody tr", { hasText: "Truss 3 m" }).first().locator("td").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  eq(cells[1], "1", "Available here at Riyadh is 1");
  await R.shot("transfer-location-2-riyadh-stock");
  eq(await stockRow(DXB, "Truss 3 m"), null, "Dubai no longer lists it");
  eq(await scanUnitId(), UNIT, "scan resolves the same unit after the move");
  const t = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(new RegExp(`In the warehouse: Riyadh · ${AE_NAME}`).test(t), "the unit says Riyadh, run by AE: " + t.slice(0, 400));
  check(new RegExp(`Owned by.*${PL_NAME}`).test(t), "owner unchanged: " + t.slice(0, 400));
  const hist = t.slice(t.search(/HISTORY/i));
  check(/Riyadh/.test(hist) && /Dubai/.test(hist), "history names the move from Dubai to Riyadh: " + hist.slice(0, 500));
  await R.shot("transfer-location-3-unit");
});

await step("ledger: two transfers for this unit (PL to Dubai, Dubai to Riyadh) plus the receipts; availability by the database agrees", async () => {
  eq(s1(`select count(*) from inv_movement_lines l join inv_movements m on m.id=l.movement_id where l.unit_id='${UNIT}' and m.kind in ('transfer_dispatch','transfer_receive')`), 4, "four transfer lines for the unit");
  eq(s1(`select (inv_unit_usable(u) and u.location_id='${RUH}')::text from inv_units u where id='${UNIT}'`), "true", "usable at Riyadh");
  eq(s1(`select (inv_unit_usable(u) and u.location_id='${DXB}')::text from inv_units u where id='${UNIT}'`), "false", "not usable at Dubai");
});

// =====================================================================================================================================
// PART 2: across companies. Owner AE (UAE) -> a warehouse run by PL ("Riyadh hub"); the PL operator is pol.worker@ (works for PL only).
// =====================================================================================================================================
const HUB_NAME = "Riyadh hub";
let HUB = ""; let LAP = ""; let LAPCODE = ""; let XTR = ""; let OTHERCODE = "";

await step("part 2 set-up (through the real functions): PL founder adds the Riyadh hub warehouse and a PL-only operator; a cost sits on an AE laptop", async () => {
  HUB = asDb(8, `select inv_save_location('${PL}', null, 'RYH', '${HUB_NAME}', 'Asia/Riyadh')`);
  asDb(8, `select inv_grant_access('${U(9)}', '${PL}', '{warehouse}'::text[])`);
  asDb(8, `select inv_set_operator_locations('${PL}', '${U(9)}', '{${HUB}}')`);
  LAP = s1("select u.id from inv_units u where u.serial_number='LAP-SN-003'");
  OTHERCODE = s1("select u.code from inv_units u where u.serial_number='LAP-SN-001'");
  LAPCODE = s1(`select code from inv_units where id='${LAP}'`);
  sql(`insert into inv_costs (company_id, item_id, unit_id, unit_cost, currency, entered_by) select company_id, item_id, id, 4321.50, 'AED', '${U(3)}' from inv_units where id='${LAP}'`);
  eq(s1(`select company_id||'/'||location_id from inv_units where id='${LAP}'`), `${AE}/${DXB}`, "the AE laptop is on the shelf at Dubai");
});

await step("Send form (UI): before AE authorises sharing, the Dubai operator is offered no PL warehouse; the database refuses it too", async () => {
  await R.as("hr1");
  await R.go(`/inventory/stock?unit=${LAP}`);
  await R.panel().getByRole("link", { name: "Send to another location" }).click();
  const sel = H.mv().getByLabel("Send to", { exact: true });
  await sel.waitFor({ timeout: 10000 });
  await sleep(500);
  const labels = (await sel.locator("option").allInnerTexts()).join(" | ");
  check(/Riyadh/.test(labels) && !/hub|Poznan|Local PL/.test(labels), "no PL warehouse is offered: " + labels);
  const r = await rpc("hr1", "inv_transfer_dispatch", { p_company_id: AE, p_from_location_id: DXB, p_to_location_id: HUB, p_key: key("nosh"), p_lines: [{ unit_id: LAP }] });
  check(r.status >= 400 && /authorise sharing/.test(JSON.stringify(r.body)), "the database refuses until AE authorises sharing: " + JSON.stringify(r.body).slice(0, 200));
});

await step("Send transfer (UI): after AE's founder authorises sharing the hub is offered, named with its company; the review says the equipment stays AE's; one dispatch", async () => {
  asDb(3, `select inv_set_company_sharing('${AE}', '${PL}', true, 'local flow: AE equipment for the Riyadh hub')`);
  await R.go(`/inventory/stock?unit=${LAP}`);
  await R.panel().getByRole("link", { name: "Send to another location" }).click();
  const mv = H.mv();
  const sel = mv.getByLabel("Send to", { exact: true });
  await pickPlace(sel, new RegExp(`^${HUB_NAME} · ${PL_NAME} \\(authorised\\)`));
  const t0 = await H.text();
  check(/The equipment stays yours/.test(t0), "says it stays the sender's: " + t0.slice(0, 300));
  await mv.getByLabel("Expected arrival (optional)").fill(dayAt(3, "12:00"));
  await H.review();
  const t = await H.text();
  check(new RegExp(`${HUB_NAME} · ${PL_NAME}`).test(t), "review names the hub with its company: " + t.slice(t.indexOf("Check before"), t.indexOf("Check before") + 400));
  const before = Number(s1("select count(*) from inv_movements where kind='transfer_dispatch'"));
  await mv.getByRole("button", { name: /^Confirm/ }).click();
  await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(500);
  eq(s1("select count(*) from inv_movements where kind='transfer_dispatch'"), before + 1, "one dispatch movement");
  XTR = s1(`select transfer_id from inv_units where id='${LAP}'`);
  eq(s1(`select company_id||'/'||custody_kind||'/'||code||'/'||serial_number from inv_units where id='${LAP}'`), `${AE}/transit/${LAPCODE}/LAP-SN-003`, "in transit; owner, code and serial unchanged");
});

await step("incoming (UI): the PL-only operator sees the unit and its transfer, owned by AE, with no cost and none of AE's other units", async () => {
  await R.as("polw");
  await R.go(`/inventory/stock?location=${HUB}`);
  const t = await R.mainText();
  check(/Equipment of other companies at your warehouses/i.test(t), "section shown: " + t.slice(0, 300));
  check(t.includes(LAPCODE) && /LAP-SN-003/.test(t) && /Laptop 14 inch/.test(t), "the incoming unit: " + t.slice(0, 600));
  check(new RegExp(`Owned by ${AE_NAME}`).test(t) && new RegExp(`On the way to ${HUB_NAME}`).test(t), "owner and route named: " + t.slice(0, 600));
  check(!t.includes(OTHERCODE) && !/LAP-SN-00[12]/.test(t), "no other AE unit is shown");
  check(!/4321|Purchase cost|AED/.test(t), "no cost is shown");
  check(/Transfers between companies/i.test(t) && /Sent/.test(t), "the transfer is listed");
  await R.shot("transfer-location-4-incoming-hub");
  // the data service itself: no direct read of AE's rows or costs
  const aeItem = s1(`select item_id from inv_units where id='${LAP}'`);
  for (const path of [`/inv_units?company_id=eq.${AE}&select=id`, `/inv_transfers?company_id=eq.${AE}&select=id`, `/inv_costs?company_id=eq.${AE}&select=id`, `/inv_items?company_id=eq.${AE}&select=id`, `/inv_movements?company_id=eq.${AE}&select=id`, `/inv_locations?company_id=eq.${AE}&select=id`]) eq(JSON.stringify((await rest("polw", "GET", path)).body), "[]", `polw reads no AE row of ${path}`);
  check(aeItem.length > 10, "the AE item exists");
  const rows = (await rpc("polw", "inv_xshare_units", {})).body;
  eq(rows.length, 1, "the narrow function returns exactly the one incoming unit");
  check(!Object.keys(rows[0]).some((k) => /cost|price|supplier|note/i.test(k)), "no cost-like field is returned: " + Object.keys(rows[0]).join(","));
});

await step("incoming (UI): scan resolves the unit for the PL operator (opening the minimal record); another AE code says not found; the transfer trace reads dispatch, in transit, not yet received", async () => {
  await R.go(`/inventory/scan?c=${LAPCODE}`);
  await R.panel().waitFor({ timeout: 10000 });
  const t = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(t.includes(LAPCODE) && t.includes("LAP-SN-003") && new RegExp(`Owned by.*${AE_NAME}`).test(t), "minimal record shows code, serial, owner: " + t.slice(0, 500));
  check(/In transit/.test(t) && !/4321|Purchase cost|\bHISTORY\b/.test(t), "status shown, no cost, no history section: " + t.slice(0, 500));
  await R.go(`/inventory/scan?c=${OTHERCODE}`);
  check(!/Laptop/.test(await R.mainText()), "another AE code tells nothing");
  await R.go(`/inventory/transfers/${XTR}`);
  const tr = await R.mainText();
  check(/Dispatched/.test(tr) && /In transit/.test(tr) && new RegExp(`Not received yet at ${HUB_NAME}`).test(tr), "trace before receipt: " + tr.slice(0, 600));
  check(!/4321|Purchase cost/.test(tr), "no cost in the trace");
});

await step("nobody else is told anything: an AE person without stock rights, a person with no Inventory access, and the data service for both", async () => {
  for (const who of ["hr", "mgr"]) {
    await R.as(who);
    await R.go(`/inventory/transfers/${XTR}`);
    const t = await R.mainText();
    check(/not found|do not have access/i.test(t) && !/Laptop|LAP-SN/.test(t), `${who} is told nothing: ` + t.slice(0, 300));
    eq(JSON.stringify((await rpc(who, "inv_xshare_units", {})).body), "[]", `${who} gets no units`);
    eq(JSON.stringify((await rpc(who, "inv_xshare_transfers", {})).body), "[]", `${who} gets no transfers`);
    const tr = await rpc(who, "inv_xshare_transfer_trace", { p_transfer_id: XTR });
    check(tr.status >= 400 && /Transfer not found/.test(JSON.stringify(tr.body)), `${who} cannot trace it: ` + JSON.stringify(tr.body).slice(0, 200));
  }
});

await step("Receive transfer (UI): the PL operator receives it; the screen names the owner; owner, code and serial are unchanged; it is at the hub", async () => {
  await R.as("polw");
  await R.go("/inventory/stock?action=transfer&mode=receive");
  const mv = H.mv();
  await mv.getByLabel("Which transfer arrived?").selectOption({ index: 1 });
  await mv.getByText(new RegExp(`Owned by ${AE_NAME}`)).first().waitFor({ timeout: 10000 });
  const t = await H.text();
  check(t.includes(LAPCODE) && /does not change who owns it/.test(t), "names the unit and the owner rule: " + t.slice(0, 500));
  await R.shot("transfer-location-5-receive-hub");
  await H.review();
  const before = Number(s1("select count(*) from inv_movements where kind='transfer_receive'"));
  await mv.getByRole("button", { name: /^Confirm/ }).click();
  await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(500);
  eq(s1("select count(*) from inv_movements where kind='transfer_receive'"), before + 1, "one receive movement");
  eq(s1(`select company_id||'/'||custody_kind||'/'||location_id||'/'||code||'/'||serial_number from inv_units where id='${LAP}'`), `${AE}/warehouse/${HUB}/${LAPCODE}/LAP-SN-003`, "at the hub; owner, code and serial unchanged");
  eq(s1(`select company_id from inv_movements where kind='transfer_receive' order by recorded_at desc limit 1`), PL, "the receipt is filed under the receiving company");
});

await step("after receipt: the PL operator sees it available at the hub, still owned by AE, with the same trace; the unit record shows no cost", async () => {
  await R.go(`/inventory/stock?location=${HUB}`);
  const t = await R.mainText();
  check(new RegExp(`Available at ${HUB_NAME}`).test(t) && new RegExp(`Owned by ${AE_NAME}`).test(t) && t.includes(LAPCODE), "available at the hub, owner named: " + t.slice(0, 700));
  eq((await rpc("polw", "inv_xshare_availability", { p_item_id: s1(`select item_id from inv_units where id='${LAP}'`), p_location_id: HUB })).body.usable_now, 1, "the database counts it usable at the hub");
  await R.go(`/inventory/stock?unit=${LAPCODE}`);
  const p = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(/Available at/.test(p) && !/4321|Purchase cost|Notes/.test(p), "record without cost: " + p.slice(0, 500));
  await R.go(`/inventory/transfers/${XTR}`);
  const tr = await R.mainText();
  check(/Received/.test(tr) && new RegExp(`at ${HUB_NAME} \\(${PL_NAME}\\)`).test(tr), "receipt shown with the receiving company: " + tr.slice(0, 700));
  await R.shot("transfer-location-6-trace-receiver");
});

await step("the OWNER traces the same transfer through dispatch and receipt (the receipt is filed under PL): from the transfer, and from the unit's own record", async () => {
  await R.as("hr1");
  await R.go(`/inventory/transfers/${XTR}`);
  const tr = await R.mainText();
  check(/Dispatched/.test(tr) && new RegExp(`at ${HUB_NAME} \\(${PL_NAME}\\)`).test(tr) && /Received/.test(tr), "owner reads dispatch and receipt: " + tr.slice(0, 700));
  check(!/4321|Purchase cost/.test(tr), "no cost in the trace");
  await R.go(`/inventory/stock?unit=${LAP}`);
  const p = (await R.panel().innerText()).replace(/\s+/g, " ");
  check(/Transfers to other companies/i.test(p) && new RegExp(`to ${HUB_NAME} · ${PL_NAME}`).test(p) && /Received/.test(p), "the unit's record shows the transfer and its receipt: " + p.slice(0, 900));
  await R.shot("transfer-location-7-owner-trace");
  const a = await rpc("hr1", "inv_xshare_transfer_trace", { p_transfer_id: XTR });
  const b = await rpc("polw", "inv_xshare_transfer_trace", { p_transfer_id: XTR });
  eq(JSON.stringify(a.body), JSON.stringify(b.body), "both sides read the very same record");
});

// Revoking AFTER dispatch must not strand equipment: 3 counted Sending cards are dispatched while the sharing is active, AE then revokes it, and the PL operator
// still sees the cards on the way (flagged "Sharing revoked\u2014contact owner"), receives them through the screen, and keeps seeing them (and the laptop) at the hub.
const REVOKED = "Sharing revoked\u2014contact owner";
const CARD = s1("select id from inv_items where name='Sending card'");
let CTR = "";
const dubaiCards = () => Number(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${CARD}' and holder_kind='warehouse' and location_id='${DXB}'`));

await step("counted stock sent, then the owner revokes the sharing: the source drops by 3, 3 are in transit (owner AE), and the PL operator still sees them with the revoked message", async () => {
  const before = dubaiCards();
  CTR = asDb(1, `select (inv_transfer_dispatch('${AE}', '${DXB}', '${HUB}', '${key("qsend")}', '[{"item_id":"${CARD}","qty":3}]'::jsonb, '${new Date(Date.now() + 3 * 86400000).toISOString()}'))->>'transfer_id'`);
  eq(dubaiCards(), before - 3, "the source quantity dropped by exactly 3");
  eq(s1(`select company_id||'/'||qty from inv_balances where holder_kind='transit' and transfer_id='${CTR}'`), `${AE}/3.000`, "3 in transit, owner AE");
  eq(s1(`select count(*) from inv_balances where item_id='${CARD}' and location_id='${HUB}'`), "0", "nothing at the hub before receipt");
  asDb(3, `select inv_set_company_sharing('${AE}', '${PL}', false)`);
  const rows = (await rpc("polw", "inv_xshare_counted_stock", {})).body;
  eq(rows.length, 1, "the narrow function lists the 3 cards on the way");
  check(!Object.keys(rows[0]).some((k) => /cost|price|supplier|note/i.test(k)), "no cost-like field: " + Object.keys(rows[0]).join(","));
  await R.as("polw");
  await R.go(`/inventory/stock?location=${HUB}`);
  const t = await R.mainText();
  check(/3 \u00d7 Sending card/.test(t) && new RegExp(`On the way to ${HUB_NAME}`).test(t) && new RegExp(`Owned by ${AE_NAME}`).test(t), "3 \u00d7 Sending card on the way, owner named: " + t.slice(0, 900));
  check(t.includes(REVOKED), "the revoked message is shown: " + t.slice(0, 900));
  check(t.includes(LAPCODE) && !/4321|Purchase cost|AED/.test(t), "the laptop on the hub shelf is still listed, no cost");
  await R.shot("transfer-location-8-revoked-incoming");
});

await step("Receive transfer (UI) after the revocation: the transfer is listed with the revoked message and is received; 3 cards are at the hub, owner AE, the source stays down by 3", async () => {
  await R.go("/inventory/stock?action=transfer&mode=receive");
  const mv = H.mv();
  await mv.getByLabel("Which transfer arrived?").selectOption({ index: 1 });
  await mv.getByText(new RegExp(`Owned by ${AE_NAME}`)).first().waitFor({ timeout: 10000 });
  check((await H.text()).includes(REVOKED), "the receive form says: " + (await H.text()).slice(0, 500));
  await H.review();
  await mv.getByRole("button", { name: /^Confirm/ }).click();
  await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
  await sleep(500);
  eq(s1(`select status from inv_transfers where id='${CTR}'`), "received", "the transfer is received");
  eq(s1(`select company_id||'/'||qty from inv_balances where item_id='${CARD}' and holder_kind='warehouse' and location_id='${HUB}'`), `${AE}/3.000`, "3 at the hub, owner unchanged");
  eq(s1(`select count(*) from inv_balances where holder_kind='transit' and transfer_id='${CTR}' and qty>0`), "0", "nothing left in transit");
});

await step("after receipt, still revoked: the PL operator reads '3 \u00d7 Sending card \u00b7 Owned by AE \u00b7 at the hub' and the laptop, both flagged; the owner reads the identical trace; new dispatches and the Send form are refused", async () => {
  await R.go(`/inventory/stock?location=${HUB}`);
  const t = await R.mainText();
  check(/3 \u00d7 Sending card/.test(t) && new RegExp(`At ${HUB_NAME}`).test(t) && new RegExp(`Owned by ${AE_NAME}`).test(t), "counted stock at the hub, owner named: " + t.slice(0, 900));
  check(t.includes(LAPCODE) && (t.match(new RegExp(REVOKED, "g")) ?? []).length >= 2, "both rows carry the message: " + t.slice(0, 900));
  await R.go(`/inventory/transfers/${CTR}`);
  check((await R.mainText()).includes(REVOKED), "the trace says it too");
  await R.go(`/inventory/stock?unit=${LAPCODE}`);
  check(((await R.panel().innerText()).replace(/\s+/g, " ")).includes(REVOKED), "the unit's minimal record says it");
  await R.shot("transfer-location-9-revoked-at-hub");
  const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.transfer.sharing_revoked; return JSON.stringify(c); };
  for (const id of [XTR, CTR]) {
    const a = (await rpc("hr1", "inv_xshare_transfer_trace", { p_transfer_id: id })).body;
    const b = (await rpc("polw", "inv_xshare_transfer_trace", { p_transfer_id: id })).body;
    eq(strip(a), strip(b), "owner and receiver read the same record");
    eq([a.transfer.sharing_revoked, b.transfer.sharing_revoked].join("/"), "false/true", "the flag is for the receiver only");
  }
  const refused = asDbTry(1, `select inv_transfer_dispatch('${AE}', '${DXB}', '${HUB}', '${key("qsend2")}', '[{"item_id":"${CARD}","qty":1}]'::jsonb, '${new Date(Date.now() + 3 * 86400000).toISOString()}')`);
  check(!refused.ok && /authori[sz]e sharing/i.test(refused.out), "a new dispatch is refused: " + refused.out.slice(0, 200));
  eq(JSON.stringify((await rpc("hr1", "inv_xshare_destinations", {})).body), "[]", "the Send form no longer offers the hub");
  eq((await rpc("hr1", "inv_xshare_transfer_trace", { p_transfer_id: CTR })).status, 200, "the owner still traces it");
});

await step("authorising again clears the flag for the PL operator", async () => {
  asDb(3, `select inv_set_company_sharing('${AE}', '${PL}', true, 'again')`);
  const rows = (await rpc("polw", "inv_xshare_units", {})).body;
  check(rows.length >= 1 && rows.every((r) => r.sharing_revoked === false), "unit flags cleared");
  check((await rpc("polw", "inv_xshare_counted_stock", {})).body.every((r) => r.sharing_revoked === false), "counted flags cleared");
  await R.go(`/inventory/stock?location=${HUB}`);
  check(!(await R.mainText()).includes(REVOKED), "no message once authorised again");
});

await R.stop();
process.exit(R.verdict("inventory-transfer-location-flow"));
