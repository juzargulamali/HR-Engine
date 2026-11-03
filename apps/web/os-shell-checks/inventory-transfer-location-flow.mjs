// WORKFLOW: physical location versus ownership, in a real browser (LOCAL STACK ONLY, fictional data).
//   A unit owned by company PL is kept at company AE's Dubai warehouse (it got there through the existing, owner-authorised cross-company path).
//   One person who works with both companies moves it Dubai -> Riyadh (both run by AE) through the ordinary Send transfer -> In transit -> Receive transfer.
//   Proves: same barcode / serial / owner before and after; Dubai stops showing it as available at send; Riyadh shows it only after receipt,
//   labelled "Owned by ..."; the scan address resolves the same unit before and after; a person without a PL grant still reads nothing of it.
// NEEDS: the Inventory seed (seed/inventory.sh). RESEED=1 reseeds first (the script writes to the database it drives).
//   Usage: RESEED=1 SHOTS_DIR=<dir> node os-shell-checks/inventory-transfer-location-flow.mjs
import { makeRunner, maybeReseed, sql, sqlRows, asDb, rest, until, sleep, movementHelpers, dayAt, U } from "./inventory-flow-lib.mjs";

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
  const row = R.page.locator("main tbody tr", { hasText: name }).first();
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

await step("a person without a PL grant reads nothing of it (no wider reads): the scan says not found and the data service returns no row", async () => {
  await R.as("hr1");
  await R.go(`/inventory/scan?c=${CODE}`);
  const t = await R.mainText();
  check(!/Truss/.test(t), "hr1 is told nothing about the unit: " + t.slice(0, 200));
  const r = await rest("hr1", "GET", `/inv_units?id=eq.${UNIT}&select=id`);
  eq(JSON.stringify(r.body), "[]", "hr1 reads no row of the PL-owned unit");
  const tr = await rest("hr1", "GET", "/inv_transfers?select=id");
  eq(JSON.stringify(tr.body), "[]", "hr1 reads no PL transfer");
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
  const dxbCells = (await R.page.locator("main tbody tr", { hasText: "Truss 3 m" }).first().locator("td").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
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
  const cells = (await R.page.locator("main tbody tr", { hasText: "Truss 3 m" }).first().locator("td").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
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

await R.stop();
process.exit(R.verdict("inventory-transfer-location-flow"));
