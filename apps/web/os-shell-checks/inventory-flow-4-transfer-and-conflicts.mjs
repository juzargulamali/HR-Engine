// WORKFLOW 4: transfers and conflicts, in a real browser as the real people (LOCAL STACK ONLY).
//   A1  a unit dispatched to project A is moved straight to project B (one movement), destination rules, a third project's reservation is never displaced
//   A2  overlapping reservations are refused in plain words, non-overlapping ones both work, a date extension that would collide displaces nobody,
//       and two browser sessions pressing Reserve at the same moment for the last unit / last quantity: exactly one wins (asserted in the database)
//   A3  transfer Dubai to Riyadh: in transit, not available at Riyadh until received, partial receipt, overdue flagged and never shown as ready
//   A4  Poznan time zone: dates across the last Sunday of March and October show the right local times and store the right UTC
// NEEDS: the Inventory seed (seed/inventory.sh). RESEED=1 reseeds first (the script writes to the database it drives).
//   ONLY=A1,A3 runs some sections (each builds its own set-up on top of the seed).   Usage: RESEED=1 node os-shell-checks/inventory-flow-4-transfer-and-conflicts.mjs
import { rest, makeRunner, maybeReseed, sql, sqlRows, asDb, asDbTry, until, sleep, rpc, refusal, newProjectRequestUI, addLineUI, submitRequestUI, requestAs, movementHelpers, dayAt, U } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("flow4");
await R.start();
const { step, check, eq } = R;
const AE = "00000000-0000-4000-8000-00000000a001"; const PL = "00000000-0000-4000-8000-00000000a002";
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const run = (s) => only.length === 0 || only.includes(s);
const s1 = (q) => sql(q).split("\n")[0];
const itemId = (name) => s1(`select id from inv_items where name='${name}'`);
const loc = (name) => s1(`select id from inv_locations where name='${name}'`);
const DXB = loc("Dubai"); const RUH = loc("Riyadh");
const PRJ_A = s1("select id from proj_projects where name='Showroom refresh'");   // PM mgr@
// Two more internal projects through the real function, as the founder: PM lead@ and PM hr@ (both have Projects access in the seed)
const mkProject = (name, pmN) => s1(`select id from proj_projects where name='${name}'`) || asDb(3, `select proj_create_internal_project('${AE}', '${name}', '${U(pmN)}', false, 'normal', current_date + 10, current_date + 40)`);
const PRJ_B = mkProject("Stage build", 7);
const PRJ_C = mkProject("Pop-up store", 2);
const movementsOf = (kind) => Number(s1(`select count(*) from inv_movements where kind='${kind}'`));
const unit = (code) => sqlRows(`select custody_kind||'|'||coalesce(project_id::text,'')||'|'||coalesce(location_id::text,'') from inv_units where code='${code}'`)[0].split("|");
const activeRes = (where) => Number(s1(`select count(*) from inv_reservations r join inv_request_lines l on l.id=r.request_line_id where r.status='active' and ${where}`));
const H = movementHelpers(R);

// =====================================================================================================================
// A1. Direct project-to-project transfer
// =====================================================================================================================
if (run("A1")) {
  const LAP = itemId("Laptop 14 inch");
  let REQ_A = "", REQ_B = "", REQ_C = "", UNITS = [];
  await step("A1 set-up: project A's manager (UI) requests 3 laptops, project B's manager (UI) requests 2 for a longer window, both submit", async () => {
    await R.as("mgr");
    REQ_A = await newProjectRequestUI(R, PRJ_A, { title: "Showroom laptops", leaves: dayAt(2, "08:00"), back: dayAt(12, "17:00") });
    await R.go(`/projects/${PRJ_A}/equipment?request=${REQ_A}`);
    await addLineUI(R, "Laptop 14 inch", "Laptop", 3);
    await submitRequestUI(R);
    await until(() => s1(`select status from inv_requests where id='${REQ_A}'`) === "submitted");
    await R.as("lead");
    REQ_B = await newProjectRequestUI(R, PRJ_B, { title: "Stage build laptops", leaves: dayAt(3, "08:00"), back: dayAt(32, "17:00") });
    await R.go(`/projects/${PRJ_B}/equipment?request=${REQ_B}`);
    await addLineUI(R, "Laptop 14 inch", "Laptop", 2);
    await submitRequestUI(R);
    await until(() => s1(`select status from inv_requests where id='${REQ_B}'`) === "submitted");
    eq(s1(`select project_id from inv_requests where id='${REQ_B}'`), PRJ_B, "request B belongs to project B");
  });
  await step("A1 set-up: the warehouse reserves A's three laptops and dispatches them to project A (UI)", async () => {
    await R.as("hr1");
    await R.go(`/inventory/requests?open=${REQ_A}`);
    await R.page.locator("aside[role=dialog] tbody tr", { hasText: "Laptop" }).first().getByRole("button", { name: "Reserve", exact: true }).click();
    await R.dialog().waitFor();
    await R.dialog().getByRole("button", { name: "Reserve", exact: true }).click();
    await R.dialog().getByText(/Reserved \d/).first().waitFor();
    await R.dialog().getByRole("button", { name: "Close", exact: true }).first().click();
    await R.closedDialog();
    UNITS = sqlRows(`select u.code from inv_reservations r join inv_units u on u.id=r.unit_id join inv_request_lines l on l.id=r.request_line_id where l.request_id='${REQ_A}' and r.status='active' order by u.code`);
    eq(UNITS.length, 3, "three laptops reserved for A");
    await R.page.locator("aside[role=dialog]").getByRole("link", { name: "Dispatch", exact: true }).click();
    await R.page.waitForURL(/action=dispatch/);
    await H.mv().getByText("Dispatch to a project").first().waitFor();
    for (const c of UNITS) await H.searchAdd(c, new RegExp(`^Add Laptop 14 inch ${c}`));
    await H.review();
    await H.mv().getByRole("button", { name: "Confirm dispatch" }).click();
    await H.mv().getByText("Recorded").first().waitFor({ timeout: 20000 });
    eq(sqlRows(`select code from inv_units where custody_kind='project' and project_id='${PRJ_A}' order by code`).join(","), UNITS.join(","), "all three on project A");
  });
  const [U1, U2, U3] = UNITS;
  await step("A1 set-up: project C (a third project) holds a LATER reservation of the first laptop", async () => {
    const c = requestAs(2, PRJ_C, LAP, 1, 30, 35, { title: "Pop-up laptops" });
    REQ_C = c.request;
    const unitId = s1(`select id from inv_units where code='${U1}'`);
    const out = asDb(1, `select inv_reserve('${c.line}', '${DXB}', array['${unitId}']::uuid[], null, null, null)`);
    check(/"reserved_now": ?1/.test(out), "C reserved " + U1 + ": " + out.slice(0, 160));
    eq(activeRes(`l.request_id='${REQ_C}'`), 1, "one reservation for C");
  });

  const openMove = async (code) => {
    await R.go(`/inventory?unit=${s1(`select id from inv_units where code='${code}'`)}`);
    await R.page.getByRole("button", { name: "More actions" }).click();
    await R.page.getByRole("menuitem", { name: /Move to another project/ }).click();
    await H.mv().getByText(/Move between projects/).first().waitFor({ timeout: 10000 }).catch(async () => { await R.dialog().waitFor(); });
  };
  const moveScope = () => R.page.locator("dialog[open], aside[role=dialog]").last();
  const fillMove = async (toName) => {
    const sc = moveScope();
    const sel = sc.getByLabel("Moving to project");
    await sel.selectOption({ label: (await sel.locator("option", { hasText: toName }).first().textContent()) ?? toName });
    await sc.getByLabel("Request of the project it is going to").selectOption({ index: 1 });
  };
  await step("A1 the move of the laptop that a third project has reserved for later is refused in words; nothing changes and C keeps its reservation", async () => {
    await R.as("hr1");
    const before = { m: movementsOf("transfer_project"), all: s1("select count(*) from inv_movements") };
    await openMove(U1);
    await R.shot("flow4-move-form");
    await fillMove("Stage build");
    const sc = moveScope();
    await sc.getByRole("button", { name: "Review", exact: true }).click();
    await sc.getByText("Check before you confirm").waitFor();
    await sc.getByRole("button", { name: "Confirm move" }).click();
    await sc.getByText(/never displaced|reserved for/i).first().waitFor({ timeout: 20000 });
    const t = (await sc.innerText()).replace(/\s+/g, " ");
    console.log("   refused:", t.match(/[^.]*reserved for[^.]*\./i)?.[0]);
    check(!/Recorded/.test(t), "not recorded");
    eq(movementsOf("transfer_project"), before.m, "no transfer movement");
    eq(s1("select count(*) from inv_movements"), before.all, "no movement at all");
    const u = unit(U1); eq(u[0], "project", "still on a project"); eq(u[1], PRJ_A, "still on project A");
    eq(activeRes(`l.request_id='${REQ_C}'`), 1, "C's reservation is untouched");
    await R.shot("flow4-move-refused-third-project");
  });
  await step("A1 the second laptop moves to project B in ONE movement: old custody closed, new custody opened, reserved for B's request (UI)", async () => {
    const before = Number(s1("select count(*) from inv_movements"));
    await openMove(U2);
    await fillMove("Stage build");
    const sc = moveScope();
    await sc.getByRole("button", { name: "Review", exact: true }).click();
    await sc.getByText("Check before you confirm").waitFor();
    await R.shot("flow4-move-review");
    await sc.getByRole("button", { name: "Confirm move" }).dblclick();
    await sc.getByText("Recorded").first().waitFor({ timeout: 20000 });
    await R.shot("flow4-move-done");
    await sleep(600);
    eq(Number(s1("select count(*) from inv_movements")), before + 1, "exactly one new movement (also after a double click)");
    eq(movementsOf("transfer_project"), 1, "one transfer_project movement");
    const u = unit(U2); eq(u[0], "project", "custody is a project"); eq(u[1], PRJ_B, "now on project B");
    const m = sqlRows(`select project_id||'|'||to_project_id||'|'||request_id from inv_movements where kind='transfer_project'`)[0].split("|");
    eq(m[0], PRJ_A, "movement from A"); eq(m[1], PRJ_B, "movement to B"); eq(m[2], REQ_B, "names the destination request");
    eq(sqlRows(`select l.from_kind||'/'||l.to_kind||'/'||l.from_project_id||'/'||l.to_project_id from inv_movement_lines l join inv_movements m on m.id=l.movement_id where m.kind='transfer_project'`).join(","), `project/project/${PRJ_A}/${PRJ_B}`, "ledger line project to project");
    eq(s1(`select count(*) from inv_reservations r join inv_units u on u.id=r.unit_id where u.code='${U2}' and r.status='active' and r.request_line_id in (select id from inv_request_lines where request_id='${REQ_B}') and r.dispatched_qty=1`), 1, "reserved and dispatched for B's request");
    eq(s1(`select count(*) from inv_reservations r join inv_units u on u.id=r.unit_id where u.code='${U2}' and r.request_line_id in (select id from inv_request_lines where request_id='${REQ_A}') and r.status='active'`), 0, "A's reservation of it is closed");
  });
  await step("A1 both projects' Equipment pages tell the story (A no longer holds it, B does)", async () => {
    await R.as("mgr");
    await R.go(`/projects/${PRJ_A}/equipment`);
    let t = await R.mainText(); const outA = t.slice(t.indexOf("Equipment still out"), t.indexOf("Requests ("));
    check(outA.includes(U1) && outA.includes(U3) && !outA.includes(U2), "A lists " + U1 + " and " + U3 + " but not " + U2 + ": " + outA.slice(0, 300));
    await R.shot("flow4-project-a-equipment");
    await R.as("lead");
    await R.go(`/projects/${PRJ_B}/equipment`);
    t = await R.mainText(); const outB = t.slice(t.indexOf("Equipment still out"), t.indexOf("Requests ("));
    check(outB.includes(U2) && !outB.includes(U1) && !outB.includes(U3), "B lists " + U2 + " only: " + outB.slice(0, 300));
    await R.shot("flow4-project-b-equipment");
    await R.as("hr1");
    await R.go(`/inventory?unit=${s1(`select id from inv_units where code='${U2}'`)}`);
    const h = (await R.panel().innerText()).replace(/\s+/g, " ");
    check(/Moved between projects/.test(h), "the unit's history names the move: " + h.slice(0, 300));
  });
  await step("A1 the destination is checked again by the database: a person who manages neither the project it is on nor works at the warehouse is refused, as is another company's founder, an ordinary employee and a signed-out call", async () => {
    const args = (key) => ({ p_company_id: AE, p_from_project_id: PRJ_A, p_to_project_id: PRJ_B, p_key: "x-" + key + Date.now(), p_lines: [{ unit_id: s1(`select id from inv_units where code='${U3}'`) }], p_request_id: REQ_B, p_expected_return_at: null, p_note: null });
    for (const who of ["lead", "emp", "pol", "admin", "hr"]) {
      const r = await rpc(who, "inv_transfer_between_projects", args(who));
      check(r.status >= 400, `${who} should be refused, got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      console.log(`   ${who}:`, refusal(r).slice(0, 110));
    }
    const anon = await rpc(null, "inv_transfer_between_projects", args("anon"));
    check(anon.status >= 400, "signed-out refused: " + anon.status);
    eq(unit(U3)[1], PRJ_A, "U3 never moved");
    // the destination must be ongoing and the request must be the destination's own
    const wrongReq = await rpc("hr1", "inv_transfer_between_projects", { ...args("wr"), p_request_id: REQ_A });
    check(/not for the destination project/.test(refusal(wrongReq)), "request must be the destination's: " + refusal(wrongReq));
    const sameProject = await rpc("hr1", "inv_transfer_between_projects", { ...args("sp"), p_to_project_id: PRJ_A });
    check(/two different projects/.test(refusal(sameProject)), "same project refused: " + refusal(sameProject));
    const hold = asDb(3, `select proj_create_internal_project('${AE}', 'Paused job', '${U(4)}', false, 'normal', null, null)`);
    sql(`update proj_projects set status='on_hold' where id='${hold}'`);
    const holdReq = requestAs(4, hold, LAP, 1, 5, 9, { title: "paused", submit: false }).request;
    sql(`update inv_requests set status='submitted' where id='${holdReq}'`);
    const toHold = await rpc("hr1", "inv_transfer_between_projects", { ...args("hold"), p_to_project_id: hold, p_request_id: holdReq });
    check(/on hold and cannot receive equipment/.test(refusal(toHold)), "an on-hold destination refuses: " + refusal(toHold));
  });
  await step("A1 destination permission: the manager of the project it is on may NOT push equipment onto a project he or she does not manage (database); someone who manages both may", async () => {
    const args = (key) => ({ p_company_id: AE, p_from_project_id: PRJ_A, p_to_project_id: PRJ_B, p_key: "dest-" + key + Date.now(), p_lines: [{ unit_id: s1(`select id from inv_units where code='${U3}'`) }], p_request_id: REQ_B, p_expected_return_at: null, p_note: null });
    const r = await rpc("mgr", "inv_transfer_between_projects", args("mgr"));
    check(r.status >= 400 && /manage both project/.test(refusal(r)), "mgr@ (manages A, not B) is refused: " + r.status + " " + refusal(r));
    console.log("   mgr@:", refusal(r));
    eq(unit(U3)[1], PRJ_A, "U3 stays on project A");
    const ok = await rpc("ceo", "inv_transfer_between_projects", args("ceo"));
    check(ok.status < 300, "the founder, who manages both, can: " + JSON.stringify(ok.body).slice(0, 200));
    eq(unit(U3)[1], PRJ_B, "U3 is now on project B");
  });
}

// =====================================================================================================================
// A2. Overlapping reservations, date extension, simultaneous Reserve
// =====================================================================================================================
const reserveDialog = async (page, requestId, itemText, { mode = "auto", qty } = {}) => {
  await page.goto(`${BASE_URL}/inventory/requests?open=${requestId}`, { waitUntil: "networkidle" });
  await page.locator("aside[role=dialog] tbody tr", { hasText: itemText }).first().getByRole("button", { name: "Reserve", exact: true }).click();
  const dlg = page.locator("dialog[open]"); await dlg.waitFor();
  if (mode === "units") await dlg.getByLabel("Choose named units").check();
  if (qty !== undefined) await dlg.getByLabel(/^(How many|Quantity)/).fill(String(qty));
  return dlg;
};
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const resText = async (dlg) => (await dlg.innerText()).replace(/\s+/g, " ");
if (run("A2")) {
  const HOLO = itemId("Holofan 75 cm"); const RCARD = itemId("Receiving card");
  const HF = s1(`select code from inv_units where item_id='${HOLO}'`);
  const HF_ID = s1(`select id from inv_units where item_id='${HOLO}'`);
  let X, Y, Z;
  await step("A2 set-up: three submitted requests for the one holofan: X (days 40-45), Y (43-47, overlaps X), Z (50-52, does not)", async () => {
    X = requestAs(4, PRJ_A, HOLO, 1, 40, 45, { title: "X holofan" });
    Y = requestAs(7, PRJ_B, HOLO, 1, 43, 47, { title: "Y holofan" });
    Z = requestAs(2, PRJ_C, HOLO, 1, 50, 52, { title: "Z holofan" });
    eq(sqlRows(`select status from inv_requests where id in ('${X.request}','${Y.request}','${Z.request}')`).join(","), "submitted,submitted,submitted", "all submitted");
  });
  await step("A2 the warehouse reserves X (UI): reserved", async () => {
    await R.as("hr1");
    const dlg = await reserveDialog(R.page, X.request, "Holofan");
    await dlg.getByRole("button", { name: "Reserve", exact: true }).click();
    await dlg.getByText(/Reserved \d/).first().waitFor();
    await dlg.getByRole("button", { name: "Close", exact: true }).first().click(); await R.closedDialog();
    eq(activeRes(`l.request_id='${X.request}'`), 1, "X holds the holofan");
  });
  await step("A2 Y overlaps X: choosing the unit by name shows why it cannot be had, picking 'free ones for me' reserves nothing and says so; X keeps it", async () => {
    const dlg = await reserveDialog(R.page, Y.request, "Holofan", { mode: "units" });
    await dlg.getByText(/reserved|not available/i).first().waitFor({ timeout: 10000 });
    const t = await resText(dlg);
    console.log("   named-unit list says:", t.match(/Holofan 75 cm[^.]*\.|HF-SN[^.]*\.|ENG-E-\d+[^.]*\./)?.[0] ?? t.slice(0, 260));
    eq(await dlg.locator(`input[type=checkbox][value="${HF_ID}"]`).isDisabled(), true, "the unit cannot be ticked for these dates");
    await dlg.getByLabel(/Pick free ones for me/).check();
    await dlg.getByRole("button", { name: "Reserve", exact: true }).click();
    await dlg.locator("[role=status], [role=alert]").filter({ hasText: /reserved|no |none|not|short|0/i }).first().waitFor({ timeout: 15000 });
    const after = await resText(dlg);
    console.log("   auto result:", after.match(/(Nothing|No |Reserved|0 of|Could not)[^.]*\./)?.[0] ?? after.slice(-240));
    check(!/Reserved 1/.test(after), "must not claim a reservation: " + after.slice(-200));
    await R.shot("flow4-reserve-overlap-refused");
    eq(activeRes(`l.request_id='${Y.request}'`), 0, "Y has nothing");
    eq(activeRes(`l.request_id='${X.request}'`), 1, "X still has the holofan");
  });
  await step("A2 the database itself refuses a named reservation of the overlapping unit in plain words and keeps the first", async () => {
    const r = await rpc("hr1", "inv_reserve", { p_line_id: Y.line, p_location_id: DXB, p_unit_ids: [HF_ID], p_qty: null, p_shortage_action: null, p_rental_reference: null });
    check(r.status >= 400, "refused: " + JSON.stringify(r.body).slice(0, 160));
    console.log("   refused:", refusal(r));
    check(/reserved|not available|already|just reserved/i.test(refusal(r)) && !/exclusion|violates|constraint|ERROR/i.test(refusal(r)), "plain words: " + refusal(r));
    eq(activeRes(`r.unit_id='${HF_ID}'`), 1, "exactly one active reservation of the unit");
    eq(s1(`select count(*) from inv_reservations where unit_id='${HF_ID}' and status='active' and request_line_id='${X.line}'`), 1, "and it is X's");
  });
  await step("A2 non-overlapping dates: Z can reserve the same holofan (UI)", async () => {
    const dlg = await reserveDialog(R.page, Z.request, "Holofan");
    await dlg.getByRole("button", { name: "Reserve", exact: true }).click();
    await dlg.getByText(/Reserved 1/).first().waitFor({ timeout: 15000 });
    await dlg.getByRole("button", { name: "Close", exact: true }).first().click(); await R.closedDialog();
    eq(activeRes(`r.unit_id='${HF_ID}'`), 2, "X and Z both hold it");
  });
  const rangeOf = (reqLine) => s1(`select lower(reserved_during)::text||' .. '||upper(reserved_during)::text from inv_reservations where request_line_id='${reqLine}' and status='active'`);
  await step("A2 X's dates are extended through the screen into Z's days: the conflict is reported in words, nobody is displaced and X keeps its earlier dates", async () => {
    const before = rangeOf(X.line);
    await R.as("mgr");
    await R.go(`/projects/${PRJ_A}/equipment?request=${X.request}`);
    const scope = R.page.locator("aside[role=dialog]").first();
    const haveAside = await scope.count();
    const where = haveAside ? scope : R.page.locator("main details[open]").first();   // the request that ?request= opened (the others are closed)
    await where.locator("details[aria-label='Planning dates'] > summary").first().click();
    await where.getByLabel("Equipment due back", { exact: true }).first().fill(dayAt(51, "17:00"));
    await where.getByRole("button", { name: "Change the dates" }).first().click();
    const status = R.page.locator("[role=status]", { hasText: /collide|cannot|could not|not free|conflict|keep|reserved/i }).first();
    await status.waitFor({ timeout: 20000 });
    const t = (await R.page.locator("main").innerText()).replace(/\s+/g, " ");
    const said = t.match(/(The dates|Some lines|[^.]*keep[^.]*)[^]{0,380}/i)?.[0];
    console.log("   shown:", said?.slice(0, 380));
    check(!/violates|exclusion|constraint|P0001|ERROR/i.test(t), "no database wording on screen");
    await R.shot("flow4-extension-conflict");
    eq(rangeOf(X.line), before, "X's reservation keeps its earlier dates");
    eq(activeRes(`r.unit_id='${HF_ID}'`), 2, "Z is not displaced");
    eq(s1(`select count(*) from inv_reservations where request_line_id='${Z.line}' and status='active'`), 1, "Z still holds it");
    eq(s1(`select (needed_until at time zone 'Asia/Dubai')::date from inv_requests where id='${X.request}'`), new Date(Date.now() + 51 * 86400000).toISOString().slice(0, 10), "the request's own dates did change (the warehouse is told the wish)");
  });
  await step("A2 an extension that does not collide (to day 48) is applied to the reservation", async () => {
    await R.go(`/projects/${PRJ_A}/equipment?request=${X.request}`);
    const where = (await R.page.locator("aside[role=dialog]").count()) ? R.page.locator("aside[role=dialog]").first() : R.page.locator("main details[open]").first();   // the request that ?request= opened (the others are closed)
    await where.locator("details[aria-label='Planning dates'] > summary").first().click();
    await where.getByLabel("Equipment due back", { exact: true }).first().fill(dayAt(48, "17:00"));
    await where.getByRole("button", { name: "Change the dates" }).first().click();
    await until(() => rangeOf(X.line).includes(new Date(Date.now() + 48 * 86400000).toISOString().slice(0, 10)) || rangeOf(X.line).includes(new Date(Date.now() + 49 * 86400000).toISOString().slice(0, 10)), 20000, "range ");
    eq(activeRes(`r.unit_id='${HF_ID}'`), 2, "still two reservations, no overlap");
    eq(s1(`select count(*) from inv_reservations a join inv_reservations b on a.unit_id=b.unit_id and a.id<b.id and a.status='active' and b.status='active' and a.reserved_during && b.reserved_during`), 0, "no two active reservations of a unit overlap");
  });

  // ---- simultaneous Reserve -----------------------------------------------------------------------------------------
  const race = async (label, reqs, itemText) => {
    const p1 = await R.extra("hr1"); const p2 = await R.extra("ceo");
    try {
      const [d1, d2] = [await reserveDialog(p1, reqs[0].request, itemText), await reserveDialog(p2, reqs[1].request, itemText)];
      await Promise.all([d1.getByRole("button", { name: "Reserve", exact: true }).click(), d2.getByRole("button", { name: "Reserve", exact: true }).click()]);
      for (const d of [d1, d2]) await d.locator("[role=status], [role=alert]").filter({ hasText: /./ }).first().waitFor({ timeout: 20000 }).catch(() => {});
      await sleep(1500);
      const texts = [await resText(d1), await resText(d2)];
      console.log(`   ${label}: session 1 sees: ${texts[0].slice(-170)}`); console.log(`   ${label}: session 2 sees: ${texts[1].slice(-170)}`);
      return texts;
    } finally { await p1.context().close(); await p2.context().close(); }
  };
  await step("A2 two sessions press Reserve at the same moment for the LAST holofan: exactly one wins (database)", async () => {
    const A = requestAs(4, PRJ_A, HOLO, 1, 70, 72, { title: "race A" }); const B = requestAs(7, PRJ_B, HOLO, 1, 71, 73, { title: "race B" });
    const texts = await race("last unit", [A, B], "Holofan");
    const wins = [A, B].map((q) => activeRes(`l.request_id='${q.request}'`));
    eq(wins.reduce((a, b) => a + b, 0), 1, `exactly one reservation of the last unit (A:${wins[0]} B:${wins[1]})`);
    eq(activeRes(`r.unit_id='${HF_ID}' and r.reserved_during && tstzrange(now() + interval '70 days', now() + interval '74 days')`), 1, "one booking in the contested days");
    check(texts.some((t) => /Reserved 1/.test(t)), "the winner is told: " + texts.join(" || ").slice(0, 200));
    check(!texts.every((t) => /Reserved 1/.test(t)), "the loser is not told it won");
  });
  await step("A2 two sessions press Reserve at the same moment for the last 30 receiving cards (each asks for all 30): exactly 30 are reserved in total, by one request", async () => {
    const A = requestAs(4, PRJ_A, RCARD, 30, 80, 82, { title: "race cards A" }); const B = requestAs(7, PRJ_B, RCARD, 30, 81, 83, { title: "race cards B" });
    await race("last quantity", [A, B], "Receiving card");
    const q = [A, B].map((x) => Number(s1(`select coalesce(sum(r.qty),0) from inv_reservations r join inv_request_lines l on l.id=r.request_line_id where l.request_id='${x.request}' and r.status='active'`)));
    eq(q[0] + q[1], 30, `total reserved is exactly the stock (A:${q[0]} B:${q[1]})`);
    check((q[0] === 30 && q[1] === 0) || (q[0] === 0 && q[1] === 30), "one request wins all of it");
    eq(s1(`select count(*) from inv_reservations r join inv_request_lines l on l.id=r.request_line_id where l.request_id in ('${A.request}','${B.request}') and r.status='active'`), 1, "one reservation row");
  });
}

// =====================================================================================================================
// A3. Transfer Dubai to Riyadh: in transit, not available at Riyadh until received, partial receipt, overdue
// =====================================================================================================================
if (run("A3")) {
  const MOTOR = itemId("Motor 2.2 kW"); const HDMI = itemId("HDMI cable");
  const [M1, M2] = sqlRows(`select code from inv_units where item_id='${MOTOR}' order by code`);
  const onHand = (item, where) => Number(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${item}' and ${where}`));
  const transferCode = () => s1("select code from inv_transfers order by dispatched_at desc limit 1");
  const checkAvail = async (page, itemName, locName, fromDay, untilDay) => {
    await page.goto(`${BASE_URL}/inventory/requests`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Check availability" }).click();
    const dlg = page.locator("dialog[open]"); await dlg.waitFor();
    const box = dlg.getByLabel(/^Item/).first(); await box.fill(itemName);
    const list = dlg.getByLabel("Matching items"); await list.waitFor({ timeout: 10000 });
    const labels = await list.locator("option").allTextContents();
    await list.selectOption({ label: labels.find((l) => l === itemName || l.startsWith(itemName + " ")) });
    await dlg.getByLabel("Location", { exact: true }).selectOption({ label: locName });
    await dlg.getByLabel("From", { exact: true }).fill(dayAt(fromDay, "09:00")); await dlg.getByLabel("Until", { exact: true }).fill(dayAt(untilDay, "17:00"));
    await dlg.getByRole("button", { name: "Check", exact: true }).click();
    await dlg.getByRole("heading", { name: "Right now" }).waitFor({ timeout: 15000 });
    const t = (await dlg.innerText()).replace(/\s+/g, " ");
    const rows = await dlg.evaluate((el) => Object.fromEntries([...el.querySelectorAll("dl > div")].map((d) => [d.querySelector("dt").firstChild.textContent.trim(), d.querySelector("dd").textContent.trim()])));
    const num = (label) => Number(rows[label]);
    return { text: t, usable: num("Usable now"), inTransit: num("In transit"), free: num("Free for these dates"), physical: num("Physically at this location"), rows };
  };
  await step("A3 the warehouse operator sends 2 motors and 5 HDMI cables Dubai to Riyadh (UI): review, then confirm; one movement", async () => {
    await R.as("hr1");
    await R.go("/inventory?action=transfer");
    const mv = H.mv();
    await mv.getByLabel("Send from", { exact: true }).selectOption({ label: "Dubai" });
    await mv.getByLabel("Send to", { exact: true }).selectOption({ label: "Riyadh" });
    for (const c of [M1, M2]) await H.searchAdd(c, new RegExp(`^Add Motor 2.2 kW ${c}`));
    await H.searchAdd("HDMI", /^Add HDMI cable/);
    await H.qtyOf("HDMI cable").fill("5");
    await mv.getByLabel("Expected arrival (optional)").fill(dayAt(3, "12:00"));
    await mv.getByLabel("Carrier (optional)").fill("DHL"); await mv.getByLabel("Reference (optional)").fill("WB-77");
    await R.shot("flow4-transfer-form");
    await H.review();
    const t = await H.text();
    check(/Riyadh/.test(t) && /Dubai/.test(t), "the review names both places: " + t.slice(t.indexOf("Check before"), t.indexOf("Check before") + 300));
    eq(movementsOf("transfer_dispatch"), 0, "nothing recorded at the review step");
    await R.shot("flow4-transfer-review");
    await mv.getByRole("button", { name: /^Confirm/ }).dblclick();
    await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
    await sleep(600);
    eq(movementsOf("transfer_dispatch"), 1, "one dispatch movement");
    eq(s1(`select string_agg(distinct custody_kind, ',') from inv_units where code in ('${M1}','${M2}')`), "transit", "both motors in transit");
    eq(onHand(HDMI, `holder_kind='warehouse' and location_id='${DXB}'`), 7, "HDMI left on the Dubai shelf");
    eq(onHand(HDMI, "holder_kind='transit'"), 5, "HDMI in transit");
    eq(s1("select count(*) from inv_transfers where status='in_transit'"), 1, "one transfer in transit");
  });
  await step("A3 in transit: the motors are 'In transit' on their record and not usable at Riyadh; the availability check says 0 usable now at Riyadh and none free for the next days", async () => {
    await R.go(`/inventory?unit=${s1(`select id from inv_units where code='${M1}'`)}`);
    const t = (await R.panel().innerText()).replace(/\s+/g, " ");
    check(/In transit/.test(t), "unit says In transit: " + t.slice(0, 300));
    await R.shot("flow4-unit-in-transit");
    const riy = await checkAvail(R.page, "Motor 2.2 kW", "Riyadh", 1, 2);
    console.log("   Riyadh now:", `usable ${riy.usable}, physically ${riy.physical}, in transit ${riy.inTransit}, free ${riy.free}`);
    eq(riy.usable, 0, "usable now at Riyadh"); eq(riy.free, 0, "free for days 1-2 at Riyadh (still on the way)");
    const dxb = await checkAvail(R.page, "Motor 2.2 kW", "Dubai", 1, 2);
    eq(dxb.usable, 0, "and not usable at Dubai either"); 
    await R.shot("flow4-availability-transit");
  });
  await step("A3 a request for Riyadh with dates before arrival cannot reserve the motors; the reservation is refused/short, nothing is reserved", async () => {
    const q = requestAs(4, PRJ_A, MOTOR, 1, 1, 2, { title: "Riyadh motors now", location: RUH });
    await R.as("ceo");
    const dlg = await reserveDialog(R.page, q.request, "Motor");
    const sel = dlg.getByLabel("Reserve from"); await sel.selectOption({ label: "Riyadh" });
    await dlg.getByRole("button", { name: "Reserve", exact: true }).click();
    await dlg.locator("[role=status], [role=alert]").filter({ hasText: /reserved|none|not|short|0/i }).first().waitFor({ timeout: 15000 });
    const t = await resText(dlg);
    console.log("   result:", t.slice(-200));
    check(!/Reserved 1/.test(t), "no unit can be reserved while it is on the way: " + t.slice(-160));
    eq(activeRes(`l.request_id='${q.request}'`), 0, "nothing reserved");
    await R.shot("flow4-reserve-riyadh-in-transit");
  });
  await step("A3 the Dubai-only operator cannot receive at Riyadh: the screen offers no transfer to receive and the database refuses", async () => {
    await R.as("hr1");
    await R.go("/inventory?action=transfer&mode=receive");
    const t = await H.text();
    check(/No transfer is on its way to you|no transfer/i.test(t) || !(await H.mv().getByRole("option", { name: new RegExp(transferCode()) }).count()), "the Riyadh transfer is not offered to a Dubai operator: " + t.slice(0, 260));
    const tr = s1("select id from inv_transfers where status='in_transit'");
    const r = await rpc("hr1", "inv_transfer_receive", { p_company_id: AE, p_transfer_id: tr, p_key: "hr1-recv-" + Date.now(), p_lines: null, p_note: null });
    check(r.status >= 400, "refused: " + JSON.stringify(r.body).slice(0, 160)); console.log("   refused:", refusal(r));
    eq(s1(`select string_agg(distinct custody_kind, ',') from inv_units where code in ('${M1}','${M2}')`), "transit", "still in transit");
  });
  await step("A3 Riyadh receives part of it (UI, as the founder): one motor and 3 of the 5 cables; the rest stays in transit", async () => {
    await R.as("ceo");
    await R.go("/inventory?action=transfer&mode=receive");
    const mv = H.mv();
    await mv.getByLabel("Which transfer arrived?").selectOption({ index: 1 });
    await mv.getByLabel(/Only some of it/).check();
    const onTheWay = mv.getByRole("list", { name: /^On the way/ });
    await onTheWay.getByRole("button", { name: new RegExp(`^Add Motor 2.2 kW ${M1}`) }).click(); await sleep(250);
    await onTheWay.getByRole("button", { name: /^Add HDMI cable/ }).click(); await sleep(250);
    await H.qtyOf("HDMI cable").fill("3");
    await R.shot("flow4-receive-partial-form");
    await H.review();
    await mv.getByRole("button", { name: /^Confirm/ }).click();
    await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
    await sleep(500);
    eq(s1(`select custody_kind||'/'||location_id from inv_units where code='${M1}'`), `warehouse/${RUH}`, "motor 1 is on the shelf at Riyadh");
    eq(s1(`select custody_kind from inv_units where code='${M2}'`), "transit", "motor 2 is still on the way");
    eq(onHand(HDMI, `holder_kind='warehouse' and location_id='${RUH}'`), 3, "3 cables at Riyadh");
    eq(onHand(HDMI, "holder_kind='transit'"), 2, "2 cables still in transit");
    eq(s1("select status from inv_transfers order by dispatched_at desc limit 1"), "in_transit", "the transfer is still open (in transit)");
    eq(movementsOf("transfer_receive"), 1, "one receive movement");
    await R.shot("flow4-receive-partial-done");
    const riy = await checkAvail(R.page, "Motor 2.2 kW", "Riyadh", 0, 1);
    eq(riy.usable, 1, "one motor usable now at Riyadh after receipt"); eq(riy.inTransit, 1, "one still in transit");
  });
  await step("A3 the rest is received; the transfer closes; all stock accounted for", async () => {
    await R.go("/inventory?action=transfer&mode=receive");
    const mv = H.mv();
    await mv.getByLabel("Which transfer arrived?").selectOption({ index: 1 });
    await H.review();
    await mv.getByRole("button", { name: /^Confirm/ }).click();
    await mv.getByText("Recorded").first().waitFor({ timeout: 20000 });
    await sleep(500);
    eq(s1("select status from inv_transfers order by dispatched_at desc limit 1"), "received", "the transfer is closed");
    eq(onHand(HDMI, "holder_kind='transit'"), 0, "nothing left in transit");
    eq(onHand(HDMI, `holder_kind='warehouse'`), 12, "all 12 cables are on shelves (7 Dubai + 5 Riyadh)");
    eq(s1(`select count(*) from inv_units where code in ('${M1}','${M2}') and custody_kind='warehouse' and location_id='${RUH}'`), 2, "both motors at Riyadh");
    eq(asDb(3, "select count(*) from inv_ledger_problems()"), "0", "the ledger is consistent");
  });
  await step("A3 overdue: a transfer whose expected arrival has passed is flagged on the record and the expected-back words say overdue; it is not counted as ready or free (UI + availability)", async () => {
    // a second transfer back to Dubai, then time passes (the owner moves the promised arrival into the past, as the clock would)
    const r = await rpc("ceo", "inv_transfer_dispatch", { p_company_id: AE, p_from_location_id: RUH, p_to_location_id: DXB, p_key: "ceo-back-" + Date.now(), p_lines: [{ unit_id: s1(`select id from inv_units where code='${M2}'`) }], p_expected_at: new Date(Date.now() + 2 * 86400000).toISOString(), p_carrier: "DHL", p_reference: "WB-78", p_note: null });
    check(r.status < 300, "second transfer dispatched: " + JSON.stringify(r.body).slice(0, 200));
    sql(`update inv_transfers set expected_at = now() - interval '2 days' where status='in_transit'`);
    const upd = asDbTry(3, "select 1");
    sql(`update inv_units set expected_return_at = now() - interval '2 days' where code='${M2}'`);
    await R.go(`/inventory?unit=${s1(`select id from inv_units where code='${M2}'`)}`);
    const t = (await R.panel().innerText()).replace(/\s+/g, " ");
    check(/Overdue/.test(t) && /\(overdue\)/.test(t), "the unit panel flags it overdue: " + t.slice(0, 400));
    await R.shot("flow4-unit-overdue");
    const dxb = await checkAvail(R.page, "Motor 2.2 kW", "Dubai", 3, 4);
    console.log("   Dubai days 3-4:", `usable ${dxb.usable}, free ${dxb.free}, in transit ${dxb.inTransit}`, /overdue/i.test(dxb.text) ? "| warns overdue" : "");
    eq(dxb.usable, 0, "the late motor is not usable now"); eq(dxb.free, 0, "and is not counted as free for later dates (overdue is never ready)");
    check(/overdue/i.test(dxb.text), "the availability answer says something is overdue: " + dxb.text.slice(0, 400));
    await R.shot("flow4-availability-overdue");
  });
  await step("A3 overdue on a project: a VR headset out on a project and past its return date is flagged and not counted as ready", async () => {
    const LAP = itemId("VR headset");
    const [L1] = sqlRows(`select code from inv_units where item_id='${LAP}' and custody_kind='warehouse' order by code`);
    const out = await rpc("hr1", "inv_dispatch_to_project", { p_company_id: AE, p_location_id: DXB, p_project_id: PRJ_A, p_key: "hr1-late-" + Date.now(), p_lines: [{ unit_id: s1(`select id from inv_units where code='${L1}'`) }], p_request_id: null, p_expected_return_at: new Date(Date.now() + 86400000).toISOString(), p_note: null });
    check(out.status < 300, "dispatched: " + JSON.stringify(out.body).slice(0, 200));
    sql(`update inv_units set expected_return_at = now() - interval '1 day' where code='${L1}'`);
    await R.go(`/inventory?unit=${s1(`select id from inv_units where code='${L1}'`)}`);
    const t = (await R.panel().innerText()).replace(/\s+/g, " ");
    check(/Overdue/.test(t), "flagged overdue: " + t.slice(0, 300));
    const a = await checkAvail(R.page, "VR headset", "Dubai", 3, 4);
    console.log("   VR headsets Dubai days 3-4:", `usable ${a.usable}, free ${a.free}`, /overdue/i.test(a.text) ? "| warns overdue" : "");
    check(/overdue/i.test(a.text), "availability says overdue: " + a.text.slice(0, 300));
    eq(s1(`select inv_unit_free(id, now() + interval '3 days', now() + interval '4 days', '${DXB}') from inv_units where code='${L1}'`), "f", "an overdue unit is never counted as free for later dates");
    await R.as("mgr");
    await R.go(`/projects/${PRJ_A}/equipment`);
    const pt = await R.mainText();
    check(pt.includes(L1) && /overdue/i.test(pt), "the project's own page shows it as overdue: " + pt.slice(pt.indexOf("Equipment still out"), pt.indexOf("Equipment still out") + 300));
  });
}

// =====================================================================================================================
// A4. Poznan time zone: dates across the last Sunday of March / October (the browser is deliberately in another zone)
// =====================================================================================================================
if (run("A4")) {
  let REQ = "";
  const CASES = [
    // [what, dispatch local, return local, UTC stored for the earliest, UTC for the latest, text shown]
    ["spring: the clocks go forward on Sunday 28 March 2027 (Fri 10:00 to Mon 10:00)", "2027-03-27T10:00", "2027-03-29T10:00", "2027-03-27 09:00:00+00", "2027-03-29 08:00:00+00", "27 Mar 2027, 10:00 to 29 Mar 2027, 10:00"],
    ["spring gap: 02:30 on 28 March 2027 does not exist (read as the first real instant, 03:00 CEST)", "2027-03-28T02:30", "2027-03-28T12:00", "2027-03-28 01:00:00+00", "2027-03-28 10:00:00+00", "28 Mar 2027, 03:00 to 28 Mar 2027, 12:00"],
    ["autumn: the clocks go back on Sunday 31 October 2027 (Sat 10:00 to Mon 10:00)", "2027-10-30T10:00", "2027-11-01T10:00", "2027-10-30 08:00:00+00", "2027-11-01 09:00:00+00", "30 Oct 2027, 10:00 to 1 Nov 2027, 10:00"],
    ["autumn repeat: 02:30 on 31 October 2027 happens twice (the first, summer time, 00:30 UTC)", "2027-10-31T02:30", "2027-10-31T12:00", "2027-10-31 00:30:00+00", "2027-10-31 11:00:00+00", "31 Oct 2027, 02:30 to 31 Oct 2027, 12:00"],
  ];
  await step("A4 the Poznan founder (browser clock set to New York) creates an employee request collected at Poznan with the time zone left empty: it takes Poznan's zone", async () => {
    await R.as("pol", undefined, undefined, { timezoneId: "America/New_York" });
    await R.go("/inventory/requests");
    await R.page.getByRole("button", { name: "New request" }).first().click();
    await R.dialog().waitFor();
    const box = R.dialog().getByLabel("Employee", { exact: true });
    for (let i = 0; i < 4; i++) { await box.fill(""); await box.fill("Pola"); if (await R.dialog().getByLabel("Matching employees").waitFor({ timeout: 4000 }).then(() => true, () => false)) break; }
    const list = R.dialog().getByLabel("Matching employees");
    await list.selectOption({ index: 1 });
    await R.dialog().getByLabel("What is it for", { exact: true }).fill("Laptop for the Poznan office");
    await R.dialog().getByLabel("Collected from", { exact: true }).selectOption({ label: "Poznan" });
    await R.dialog().getByLabel("Needed from", { exact: true }).fill(CASES[0][1]);
    await R.dialog().getByLabel(/^Expected back/).fill(CASES[0][2]);
    await R.dialog().getByRole("button", { name: "Create draft" }).click();
    await R.closedDialog();
    await until(() => s1("select count(*) from inv_requests where company_id='" + PL + "'") === "1");
    REQ = s1(`select id from inv_requests where company_id='${PL}'`);
    eq(s1(`select timezone from inv_requests where id='${REQ}'`), "Europe/Warsaw", "the zone of the pickup location");
  });
  const showRequest = async () => { await R.go(`/inventory/requests?open=${REQ}`); await R.panel().waitFor(); return (await R.panel().innerText()).replace(/\s+/g, " "); };
  let i = 0;
  for (const [what, from, to, utcFrom, utcTo, shown] of CASES) {
    i++;
    await step(`A4 ${what}: stored in UTC as ${utcFrom.slice(0, 16)}Z .. ${utcTo.slice(0, 16)}Z and shown in Poznan time (${shown})`, async () => {
      if (i > 1) {   // change the dates through the plan form on the request
        await R.go(`/inventory/requests?open=${REQ}`); await R.panel().waitFor();
        await R.panel().getByLabel("Dispatch and transport", { exact: true }).fill(from);
        await R.panel().getByLabel("Equipment due back", { exact: true }).fill(to);
        await R.panel().getByRole("button", { name: /Save the dates|Change the dates/ }).click();
        await until(() => s1(`select needed_from::text from inv_requests where id='${REQ}'`) === utcFrom, 15000, "needed_from ");
      }
      eq(s1(`select needed_from::text from inv_requests where id='${REQ}'`), utcFrom, "needed_from (UTC)");
      eq(s1(`select needed_until::text from inv_requests where id='${REQ}'`), utcTo, "needed_until (UTC)");
      eq(s1(`select timezone from inv_requests where id='${REQ}'`), "Europe/Warsaw", "zone kept");
      const t = await showRequest();
      check(t.includes(shown), `the panel shows Poznan local time "${shown}": ` + (t.match(/Needed \(local time of the request\)[^]{0,120}/)?.[0] ?? t.slice(0, 200)));
      check(t.includes("Europe/Warsaw"), "and names the zone");
      const form = await R.panel().getByLabel("Dispatch and transport", { exact: true }).inputValue();
      check(form === from, `the date box holds the local time as typed, not the browser's: ${form}`);   // for the gap case the panel above shows 03:00 while the box keeps the typed 02:30 (noted in the report)
      if (i === 1) await R.shot("flow4-poznan-dst");
    });
  }
  await step("A4 a Dubai operator cannot see the Poznan company's request at all", async () => {
    const r = await rest("hr1", "GET", `/inv_requests?id=eq.${REQ}&select=id`);
    check(r.status === 200 && Array.isArray(r.body) && r.body.length === 0, "empty: " + JSON.stringify(r.body));
  });
}

await R.stop();
process.exit(R.verdict("flow 4 (transfer and conflicts)"));
