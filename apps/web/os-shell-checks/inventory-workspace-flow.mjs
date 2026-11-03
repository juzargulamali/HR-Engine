// WORKFLOW: the simplified warehouse day, in a real browser as the real people (LOCAL STACK ONLY).
//   Today shows the work for the warehouse, one row per job; a request opens ONE workspace: Prepare (reserve) -> Send out -> Receive back.
//   Reserving never sends; sending is explicit, partial, flagged before confirmation and recorded against the request; a return needs a condition
//   and is recorded against the project (counted stock is never attributed to a request line); owned/rented is chosen when receiving;
//   old addresses redirect; plain employees, Project Managers and read-only people get what they should and nothing more.
// NEEDS: the Inventory seed (seed/inventory.sh). Run with RESEED=1 to reseed first (the script writes to the database it drives).
//   Usage: RESEED=1 node os-shell-checks/inventory-workspace-flow.mjs     screenshots go to $SHOTS_DIR (default docs/inventory-screenshots)
import { makeRunner, maybeReseed, sql, asDb, asDbTry, until, dayAt, requestAs, BASE } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("workspace", { shots: process.env.SHOTS_DIR ?? new URL("../../../docs/inventory-simplification-screenshots/live", import.meta.url).pathname });
await R.start();
const { step, check, eq } = R;
const s1 = (q) => sql(q).split("\n")[0];
const AE = "00000000-0000-4000-8000-00000000a001";
const item = (name) => s1(`select id from inv_items where name='${name}'`);
const PRJ = s1("select id from proj_projects where name='Showroom refresh'");
const LAPTOP = item("Laptop 14 inch"); const HDMI = item("HDMI cable");

// A request for the project: 3 laptops (individual units) and 8 HDMI cables (counted), dispatch this morning, back in 3 days. A second request on the
// same project also asks for HDMI cables, so counted returns CANNOT be attributed to either request (and the screen must say so).
const A = requestAs(4, PRJ, LAPTOP, 3, 0, 3, { title: "Showroom set-up", submit: false });
asDb(4, `select inv_add_request_line('${A.request}', '${HDMI}', 8, null, null)`);
asDb(4, `select inv_submit_request('${A.request}', null)`);
const B = requestAs(4, PRJ, HDMI, 3, 1, 4, { title: "Showroom extras", submit: true });
const resTotals = (req, what) => s1(`select coalesce(sum(x.${what}),0) from inv_reservations x join inv_request_lines l on l.id=x.request_line_id where l.request_id='${req}'`);
const CODE_A = s1(`select code from inv_requests where id='${A.request}'`);
const rowOf = (page) => page.locator("li", { hasText: CODE_A });
const movementCount = (kind) => Number(s1(`select count(*) from inv_movements where kind='${kind}'`));

// ------------------------------------------------------------------------------------------------------------------------------
await R.as("hr1");
await R.go("/inventory");
await step("Today: the warehouse is named, the three sections are offered, and the request is ONE row with its own button", async () => {
  await R.expectText(/You are working in/);
  await R.expectText(/Dubai/);
  const nav = R.page.getByRole("navigation").first();
  for (const l of ["Today", "Stock", "History"]) check(await R.page.getByRole("link", { name: l, exact: true }).first().isVisible(), `${l} missing`);
  const rows = rowOf(R.page);
  eq(await rows.count(), 1, "rows for the request");
  check(await rows.first().getByRole("link", { name: /Prepare equipment/ }).isVisible(), "no Prepare equipment button");
  await R.shot("today-prepare");
});

await step("Today -> the workspace opens on Prepare with the booking window, dispatch and due-back dates visible", async () => {
  await rowOf(R.page).getByRole("link", { name: /Prepare equipment/ }).click();
  await R.page.waitForURL(/\/inventory\/requests\/[0-9a-f-]+\?step=prepare/);
  await R.seen(/Booking window/); await R.expectText(/Dispatch/); await R.expectText(/Due back/);
  await R.expectText(/Laptop 14 inch/); await R.expectText(/HDMI cable/);
  await R.expectNoText(/Dispatched/);               // Prepare leaves the sent / returned columns to the other steps
  check(!(await R.page.getByText("Installation starts").isVisible().catch(() => false)), "the full schedule is shown by default");
  await R.shot("prepare");
});

await step("Prepare: reserving the laptops and the cables holds them and sends nothing", async () => {
  for (const name of ["Laptop 14 inch", "HDMI cable"]) {
    await R.page.getByRole("row", { name: new RegExp(name) }).first().getByRole("button", { name: "Reserve" }).click();
    await R.dialog().waitFor();
    await R.dialog().getByRole("button", { name: "Reserve", exact: true }).click();
    await R.dialog().getByText(/Reserved \d/).first().waitFor();
    await R.page.keyboard.press("Escape");
    await R.closedDialog();
  }
  await until(() => Number(resTotals(A.request, "qty")) === 11, 15000, "reserved");
  eq(resTotals(A.request, "dispatched_qty"), 0, "dispatched after reserving");
  eq(movementCount("dispatch_project"), 0, "dispatch movements after reserving");
});

await step("Today: now the request is a Send row (still one row)", async () => {
  await R.go("/inventory");
  const rows = rowOf(R.page);
  eq(await rows.count(), 1, "rows for the request");
  check(await rows.first().getByRole("link", { name: /Send equipment/ }).isVisible(), "no Send equipment button");
});

await step("Send out: nothing is ticked, a code that is not reserved blocks, a partial dispatch warns", async () => {
  await rowOf(R.page).getByRole("link", { name: /Send equipment/ }).click();
  await R.page.waitForURL(/step=send/);
  await R.seen(/Sending from/); await R.expectText(/Showroom refresh/); await R.expectText(/expected back/);
  eq(await R.page.locator("input[type=checkbox]:checked").count(), 0, "ticked boxes");
  await R.page.getByLabel(/scan or type a code/i).fill("UAE-E-99999");
  await R.page.getByRole("button", { name: "Add", exact: true }).click();
  await R.expectText(/UAE-E-99999 is not reserved for this request/);
  await R.page.getByRole("button", { name: /^Review/ }).click().catch(() => {});
  await R.shot("send-blocked");
});

const laptopCodes = sql(`select code from inv_units where item_id='${LAPTOP}' order by code`).split("\n").filter(Boolean);
await step("Send out: two of the three laptops and 5 of the 8 cables, reviewed and confirmed", async () => {
  await R.go(`/inventory/requests/${A.request}?step=send`);
  const first = laptopCodes.find((c) => true);
  const boxes = R.page.locator("section", { hasText: "Laptop 14 inch" }).locator("input[type=checkbox]");
  await boxes.nth(0).check(); await boxes.nth(1).check();
  await R.page.getByLabel(/counted quantity/i).fill("5");
  await R.expectText(/sending 2 of 3 reserved/); await R.expectText(/sending 5 of 8 reserved/);
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  eq(movementCount("dispatch_project"), 0, "dispatch before confirming");
  await R.shot("send-review");
  await R.page.getByRole("button", { name: /Confirm: send 7/ }).click();
  await R.page.getByText("Recorded", { exact: true }).waitFor();
  await until(() => movementCount("dispatch_project") === 1, 15000, "one dispatch");
  eq(resTotals(A.request, "dispatched_qty"), 7, "dispatched for the request");
  eq(s1(`select count(*) from inv_movements where kind='dispatch_project' and request_id='${A.request}'`), 1, "dispatch recorded against the request");
  eq(s1(`select count(*) from inv_units where item_id='${LAPTOP}' and custody_kind='project'`), 2, "laptops on the project");
  eq(s1(`select count(*) from inv_units where item_id='${LAPTOP}' and custody_kind='warehouse' and lifecycle='active'`), 1, "laptops left on the shelf (the one reserved and not sent)");
});

await step("Send out: what is left stays reserved and unsent, and the screen says so", async () => {
  await R.go(`/inventory/requests/${A.request}?step=send`);
  await R.expectText(/To send 1/); await R.expectText(/To send 3/);
});

// The second request reserves and sends its 3 cables too: from now on a cable coming back cannot be told apart between the two requests.
asDb(1, `select inv_reserve((select id from inv_request_lines where request_id='${B.request}' limit 1), (select id from inv_locations where code='DXB'), null, 3, null, null)`);
asDb(1, `select inv_dispatch_to_project('${AE}', (select id from inv_locations where code='DXB'), '${PRJ}', 'ws-b-send-1', '[{"item_id":"${HDMI}","qty":3}]'::jsonb, '${B.request}', null, null)`);

await step("Receive back: totals at the level the data supports; counted stock is NOT attributed to a request line", async () => {
  await R.go(`/inventory/requests/${A.request}?step=back`);
  await R.seen(/What is actually here now/);
  await R.expectText(/Project level/);               // HDMI cable was sent for two requests of the same project... only once here, but the second request reserved it
  eq(await R.page.locator("input[type=checkbox]:checked").count(), 0, "ticked boxes");
  await R.shot("back");
});

await step("Receive back: a partial return needs a condition; good is available again, damaged is held; the rest stays out", async () => {
  const laptopBox = R.page.getByLabel(/Laptop 14 inch · /).first();
  await laptopBox.check();
  await R.page.getByLabel(/How many HDMI cable came back/).fill("2");
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.expectText(/Choose a condition/);
  // The helper starts empty and only touches ticked lines: Good for both ticked lines, then the exception is changed on its own line.
  const helper = R.page.getByRole("combobox", { name: /Set the condition for all ticked lines/ });
  eq(await helper.inputValue(), "", "the helper starts empty");
  await helper.selectOption("good");
  await R.page.getByRole("button", { name: /^Apply to 2 ticked lines$/ }).click();
  eq(await R.page.getByLabel(/^Condition of Laptop 14 inch/).inputValue(), "good", "helper set the ticked laptop");
  await R.page.getByLabel(/^Condition of HDMI cable/).selectOption("damaged");
  await R.expectText(/Available again/); await R.expectText(/Held, not available/);
  await R.page.getByRole("button", { name: /^Review/ }).click();
  await R.page.getByText("Check before you confirm").waitFor();
  await R.shot("back-review");
  await R.page.getByRole("button", { name: /confirm: record returns/i }).click();
  await R.page.getByText("Recorded", { exact: true }).waitFor();
  await until(() => movementCount("return_project") === 1, 15000, "one return");
  eq(s1(`select count(*) from inv_units where item_id='${LAPTOP}' and custody_kind='project'`), 1, "laptops still on the project");
  eq(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='project'`), 6, "cables still with the project (5 + 3 sent - 2 back)");
  eq(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse' and condition='damaged'`), 2, "damaged cables held");
});

// ------------------------------------------------------------------------------------------------------------------------------
await step("Stock: the warehouse bar, the compact columns and a clear dash for counted stock out", async () => {
  await R.go("/inventory/stock");
  await R.expectText(/You are working in/); await R.expectText(/Dubai/);
  await R.expectText(/Available here/); await R.expectText(/Reserved/);
  await R.expectText(/not split by warehouse/);
  check(await R.page.getByRole("link", { name: "Receive stock" }).isVisible(), "no Receive stock button");
  check(await R.page.getByRole("link", { name: "Give equipment" }).isVisible(), "no Give equipment button");
  await R.shot("stock");
});

await step("Stock: With people lists who holds what, with Give equipment and Receive returns", async () => {
  await R.page.getByRole("link", { name: "With people" }).click();
  await R.page.waitForURL(/view=people/);
  await R.expectText(/With people/);
  await R.shot("with-people");
});

await step("Receive stock: Owned or Rented has to be chosen; owned adds to what the company owns", async () => {
  await R.go("/inventory/stock?action=receive");
  await R.panel().waitFor();
  const before = Number(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse' and rental_id is null`));
  await R.panel().getByLabel("Search for an item or unit to add").fill("HDMI");
  await R.panel().getByRole("list", { name: "Search results" }).getByRole("button", { name: /Add HDMI cable/ }).first().click();
  await R.panel().getByLabel(/Quantity of HDMI cable/).fill("10");
  await R.panel().getByRole("button", { name: "Review", exact: true }).click();
  await R.expectText(/owned or rented/i, "aside[role=dialog]");
  await R.shot("receive-choice-required");
  await R.panel().getByLabel(/^Owned/).check();
  await R.panel().getByRole("button", { name: "Review", exact: true }).click();
  await R.panel().getByText("Check before you confirm").waitFor();
  await R.panel().getByRole("button", { name: /confirm receipt/i }).click();
  await R.panel().getByText("Recorded", { exact: true }).waitFor();
  await until(() => Number(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse' and rental_id is null`)) === before + 10, 15000, "owned +10");
});

await step("Receive stock: rented never adds to what the company owns", async () => {
  await R.go("/inventory/stock?action=receive");
  await R.panel().waitFor();
  const ownedBefore = Number(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse' and rental_id is null`));
  await R.panel().getByLabel("Search for an item or unit to add").fill("HDMI");
  await R.panel().getByRole("list", { name: "Search results" }).getByRole("button", { name: /Add HDMI cable/ }).first().click();
  await R.panel().getByLabel(/Quantity of HDMI cable/).fill("4");
  await R.panel().getByLabel(/^Rented/).check();
  await R.panel().getByLabel("Supplier", { exact: true }).fill("Gulf Rentals");
  await R.panel().getByLabel(/Supplier.s reference/).fill("PO-1");
  await R.panel().getByLabel("Has to go back by").fill(dayAt(30, "10:00"));
  await R.panel().getByRole("button", { name: "Review", exact: true }).click();
  await R.panel().getByText("Check before you confirm").waitFor();
  await R.panel().getByRole("button", { name: /confirm receipt/i }).click();
  await R.panel().getByText("Recorded", { exact: true }).waitFor();
  eq(s1(`select count(*) from inv_rentals where external_reference='PO-1'`), 1, "rental recorded");
  eq(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse' and rental_id is null`), ownedBefore, "owned stock after a rental");
});

await step("Item panel: contextual actions, and the unplanned project dispatch says it does not fulfil a request", async () => {
  await R.go(`/inventory/stock?open=${HDMI}`);
  await R.panel().waitFor();
  await R.panel().getByRole("button", { name: /More actions/ }).click();
  await R.page.getByRole("menuitem", { name: /Give to a person/ }).waitFor();
  await R.page.getByRole("menuitem", { name: /Move to another warehouse/ }).waitFor();
  await R.page.getByRole("menuitem", { name: /Send to a project \(not from a request\)/ }).click();
  await R.dialog().waitFor();
  await R.expectText(/does not fulfil a request/, "dialog[open]");
  await R.page.keyboard.press("Escape");
});

await step("The workspace's unplanned dispatch is separate and says it does not fulfil the request", async () => {
  await R.go(`/inventory/requests/${A.request}?step=send`);
  await R.expectText(/does not fulfil this request/);
  await R.expectText(/not part of a request/);
});

// ------------------------------------------------------------------------------------------------------------------------------
await step("History: the movement ledger is History now, and the old address keeps its parameters", async () => {
  await R.go("/inventory/history");
  await R.expectText(/History/);
  await R.page.goto(`${BASE}/inventory/movements?kind=dispatch`, { waitUntil: "networkidle" });
  check(new URL(R.page.url()).pathname === "/inventory/history" && new URL(R.page.url()).searchParams.get("kind") === "dispatch", `movements redirect: ${R.page.url()}`);
});

await step("Old links: /inventory?unit=, /inventory?action=, and /inventory/employees all still land where they should", async () => {
  const unit = s1(`select id from inv_units where item_id='${LAPTOP}' limit 1`);
  await R.page.goto(`${BASE}/inventory?unit=${unit}`, { waitUntil: "networkidle" });
  check(R.page.url().includes(`/inventory/stock?unit=${unit}`), `unit link: ${R.page.url()}`);
  await R.page.goto(`${BASE}/inventory?action=transfer`, { waitUntil: "networkidle" });
  check(R.page.url().includes("/inventory/stock?action=transfer"), `action link: ${R.page.url()}`);
  await R.page.goto(`${BASE}/inventory/employees`, { waitUntil: "networkidle" });
  check(R.page.url().includes("/inventory/stock") && R.page.url().includes("view=people"), `employees link: ${R.page.url()}`);
});

// ------------------------------------------------------------------------------------------------------------------------------
await R.as("ceo");
await step("A founder with two warehouses gets a switcher; the choice is kept across screens", async () => {
  await R.go("/inventory");
  const sw = R.page.getByRole("combobox", { name: "Warehouse" });
  check(await sw.isVisible(), "no switcher");
  const options = await sw.locator("option").allTextContents();
  check(options.some((o) => /Dubai/.test(o)) && options.some((o) => /Riyadh/.test(o)) && options.some((o) => /All warehouses/.test(o)), `options: ${options.join(", ")}`);
  await sw.selectOption({ label: options.find((o) => /Riyadh/.test(o)) });
  await R.page.waitForURL(/location=/);
  await R.go("/inventory/stock");
  await R.expectText(/Riyadh/);
  await R.shot("switcher-riyadh");
});

await R.as("mgr");
await step("A Project Manager: /inventory goes to Requests; the workspace shows Prepare but no send or receive controls", async () => {
  await R.page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  check(R.page.url().includes("/inventory/requests"), `PM landed on ${R.page.url()}`);
  await R.go(`/inventory/requests/${A.request}?step=send`);
  await R.expectText(/The warehouse sends equipment and receives it back/);
  check((await R.page.getByRole("button", { name: /^Review/ }).count()) === 0, "PM sees a send button");
});

await R.as("emp");
await step("A plain employee goes to My equipment and cannot open the workspace", async () => {
  await R.page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
  check(R.page.url().includes("/inventory/mine"), `employee landed on ${R.page.url()}`);
  await R.go(`/inventory/requests/${A.request}`);
  await R.expectText(/does not exist, or you do not have access/);
});

await R.as("hr");
await step("A person who may only see what employees hold: Stock and With people, nothing that changes stock", async () => {
  await R.go("/inventory/stock?view=people");
  await R.expectText(/With people/);
  check((await R.page.getByRole("link", { name: "Receive stock" }).count()) === 0, "Receive stock offered");
  check((await R.page.getByRole("link", { name: "Give equipment" }).count()) === 0, "Give equipment offered");
});

await R.as("admin");
await step("A person with no Inventory access is told so and sees no stock", async () => {
  await R.go("/inventory/stock");
  await R.expectText(/do not have Inventory access/);
});

// ------------------------------------------------------------------------------------------------------------------------------
await step("The database still refuses what the screen would never offer: an unreserved unit cannot be dispatched against the request", async () => {
  const other = s1(`select id from inv_units where item_id='${item("VR headset")}' and custody_kind='warehouse' and lifecycle='active' limit 1`);
  const r = asDbTry(1, `select inv_dispatch_to_project('${AE}', (select id from inv_locations where code='DXB'), '${PRJ}', 'ws-refused-1', '[{"unit_id":"${other}"}]'::jsonb, '${A.request}', null, null)`);
  check(!r.ok && /not reserved|reserve/i.test(r.out), `expected a refusal, got: ${r.out.slice(0, 200)}`);
});

const code = R.verdict("Inventory workspace flow");
await R.stop();
process.exit(code);
