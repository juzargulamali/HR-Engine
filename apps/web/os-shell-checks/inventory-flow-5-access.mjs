// WORKFLOW 5: wrong role, wrong company, direct calls (LOCAL STACK ONLY). The database is the gate; a hidden button is cosmetic.
//   B1  which Inventory menu entries each person sees
//   B2  which pages each person can use, and that people without stock access get no stock (also not in the page HTML)
//   B3  direct calls to the data service with each person's REAL token: wrong-role functions are refused, tables are read-only and empty for the wrong person
//   B4  purchase costs: founder only (or an explicit view_costs grant made on the Access page), never in the HTML for anyone else
//   B5  locations: the Dubai operator can operate Dubai and not Riyadh
//   B6  another company: a Poznan founder sees no AE stock; cross-company use needs an explicit sharing row made on the Access page, then revoked
//   B7  access revoked while a page is open: the next action fails with the access message and the page then shows no access
//   B8  direct addresses (/inventory/manage, /inventory/access) and the signed-out scan address (sign-in returns to the record)
//   B9  no automatic grants: only the seeded ones exist
// NEEDS: the Inventory seed. RESEED=1 reseeds first.  ONLY=B3,B8 runs some sections.   Usage: RESEED=1 node os-shell-checks/inventory-flow-5-access.mjs
import { makeRunner, maybeReseed, sql, sqlRows, asDb, until, sleep, rpc, rest, refusal, tokenFor, U, PERSONA, BASE } from "./inventory-flow-lib.mjs";

maybeReseed();
const R = makeRunner("flow5");
await R.start();
const { step, check, eq } = R;
const AE = "00000000-0000-4000-8000-00000000a001"; const PL = "00000000-0000-4000-8000-00000000a002";
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
const run = (s) => only.length === 0 || only.includes(s);
const s1 = (q) => sql(q).split("\n")[0];
const DXB = s1("select id from inv_locations where name='Dubai'"); const RUH = s1("select id from inv_locations where name='Riyadh'"); const POZ = s1("select id from inv_locations where name='Poznan'");
const HDMI = s1("select id from inv_items where name='HDMI cable'");
const LAP = s1("select id from inv_items where name='Laptop 14 inch'");
const UNIT_ROW = s1("select id||'|'||code from inv_units where item_id='" + LAP + "' order by code limit 1").split("|");
const UNIT_ID = UNIT_ROW[0]; const UNIT_CODE = UNIT_ROW[1];
const PRJ_A = s1("select id from proj_projects where name='Showroom refresh'");
const COST_UNIT = UNIT_ID;
const noCostsYet = s1(`select count(*) from inv_costs`) === "0";
if (noCostsYet) sql(`insert into inv_costs (company_id, item_id, unit_id, purchase_date, unit_cost, currency, entered_by) select company_id, item_id, id, current_date, 1250.00, 'AED', '${U(3)}' from inv_units where id='${COST_UNIT}'`);
const WHO = ["admin", "emp", "mgr", "lead", "hr", "hr1", "pol", "ceo"];
const countRows = (n) => (Array.isArray(n.body) ? n.body.length : -1);

// =====================================================================================================================
// B1. Menu entries
// =====================================================================================================================
const MENU = {   // the sidebar shows the main pages only: My equipment, Scan and Equipment held by employees are reached from the page headers and the command palette
  admin: ["/inventory/mine"],
  emp: ["/inventory/mine"],
  mgr: ["/inventory", "/inventory/requests"],
  lead: ["/inventory", "/inventory/requests"],
  hr: ["/inventory", "/inventory/requests"],
  hr1: ["/inventory", "/inventory/requests", "/inventory/movements"],
  ceo: ["/inventory", "/inventory/requests", "/inventory/movements", "/inventory/manage", "/inventory/access"],
  pol: ["/inventory", "/inventory/requests", "/inventory/movements", "/inventory/manage", "/inventory/access"],
};
const menuOf = async (page) => page.evaluate(() => [...new Set([...document.querySelectorAll("a[href^='/inventory']")].filter((a) => a.closest("nav, aside, header")).map((a) => new URL(a.href).pathname))].sort());
if (run("B1")) {
  for (const who of WHO) {
    await step(`B1 menu: ${who}@ sees ${MENU[who].length} Inventory entries`, async () => {
      await R.as(who);
      await R.go(who === "admin" || who === "emp" ? "/inventory/mine" : "/inventory/requests");   // the menu shows a module's pages once you are inside it
      const got = await menuOf(R.page);
      const want = [...MENU[who]].sort();
      console.log(`   ${who}@:`, got.join(" "));
      eq(got.join(" "), want.join(" "), `Inventory menu entries of ${who}@`);
    });
  }
}

if (run("B1")) {
  // The pages kept out of the sidebar are reached from the command palette (Ctrl+K): each person finds exactly the ones they may use.
  const PALETTE = { admin: ["My equipment"], emp: ["My equipment"], mgr: ["My equipment", "Scan a label"], lead: ["My equipment", "Scan a label"], hr: ["My equipment", "Scan a label", "Equipment held by employees"], hr1: ["My equipment", "Scan a label", "Equipment held by employees"], ceo: ["My equipment", "Scan a label", "Equipment held by employees"], pol: ["My equipment", "Scan a label", "Equipment held by employees"] };
  for (const who of WHO) {
    await step(`B1 command palette: ${who}@ finds ${PALETTE[who].join(", ")}`, async () => {
      await R.as(who);
      await R.go("/");
      await R.page.keyboard.press("Control+k");
      await R.page.getByRole("dialog").first().waitFor();
      await R.page.keyboard.type("equip");
      await sleep(400);
      const t1 = (await R.page.getByRole("dialog").first().innerText()).replace(/\s+/g, " ");
      await R.page.keyboard.press("Control+a"); await R.page.keyboard.type("scan");
      await sleep(400);
      const t2 = (await R.page.getByRole("dialog").first().innerText()).replace(/\s+/g, " ");
      for (const label of ["My equipment", "Equipment held by employees"]) check(PALETTE[who].includes(label) === t1.includes(label), `${who}@ palette "equip": ${label} should ${PALETTE[who].includes(label) ? "" : "not "}be offered: ${t1.slice(0, 200)}`);
      check(PALETTE[who].includes("Scan a label") === t2.includes("Scan a label"), `${who}@ palette "scan": ${t2.slice(0, 200)}`);
    });
  }
}

// =====================================================================================================================
// B2. Pages and what is in them
// =====================================================================================================================
const STOCK_SECRETS = /ENG-E-\d{3,}|-SN-\d+|Showroom refresh|Orbit/;       // unit codes, serial numbers, project names
if (run("B2")) {
  const PAGES = ["/inventory", "/inventory/requests", "/inventory/movements", "/inventory/manage", "/inventory/access", "/inventory/employees", "/inventory/mine", "/inventory/scan", `/inventory?unit=${UNIT_ID}`, `/inventory/labels?codes=${UNIT_CODE}`];
  for (const who of ["admin", "emp", "mgr", "lead", "hr", "pol"]) {
    await step(`B2 ${who}@ (no stock rights in the AE company): no unit, serial or project secrets on any Inventory page, in the text or the HTML`, async () => {
      await R.as(who);
      const seen = [];
      for (const p of PAGES) {
        const res = await R.page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
        check(res && res.status() < 500, `${p} answered ${res?.status()}`);
        const html = await R.page.content();
        const text = (await R.page.locator("body").innerText()).replace(/\s+/g, " ");
        if (p.startsWith("/inventory/labels")) {   // the typed code is echoed back in the box, but no label may be made for equipment the person cannot see
          eq(await R.page.locator(".label-cell").count(), 0, `${who}@: labels drawn for a unit they cannot see`);
          check(!/Laptop 14 inch|SN-\d+/.test(html), `${who}@: item name or serial on the labels page`);
          seen.push("/inventory/labels: no label drawn"); continue;
        }
        const hit = (html.match(STOCK_SECRETS) ?? [])[0];
        // the Project Manager legitimately sees their OWN project's name on requests; nothing else
        if (hit && !(who === "mgr" && hit === "Showroom refresh")) throw new Error(`${p} contains "${hit}"`);
        seen.push(`${p.split("?")[0]}: ${text.replace(/^.*?Inventory/, "Inventory").slice(0, 70)}`);
      }
      console.log("   " + seen.slice(0, 10).map((x) => x.slice(0, 110)).join("\n   "));
    });
  }
  await step("B2 hr1@ (warehouse at Dubai): sees stock, but Setup and Access are closed to the role and say who can open them", async () => {
    await R.as("hr1");
    await R.go("/inventory");
    check(/Laptop 14 inch/.test(await R.mainText()), "stock table is there");
    await R.go("/inventory/access");
    let t = await R.mainText();
    check(/Only a founder, or someone a founder gave access management to/.test(t), "Access: " + t.slice(0, 200));
    check(!/ceo@e2e\.local|pol\.exec@/.test(await R.page.content()), "no other person's e-mail in the Access page HTML");
    await R.go("/inventory/manage");
    t = await R.mainText();
    eq(await R.page.getByRole("button", { name: "Add a category" }).count(), 0, "no Add a category button for the operator");
    console.log("   Setup as hr1@:", t.slice(0, 160));
  });
  await step("B2 emp@ (ordinary employee): Inventory, requests, movements, Setup and Access show nothing to act on; My equipment is the only thing", async () => {
    await R.as("emp");
    for (const p of ["/inventory/manage", "/inventory/access", "/inventory/movements", "/inventory/employees"]) {
      await R.go(p);
      const t = await R.mainText();
      eq(await R.page.locator("main button, main [role=button]").filter({ hasText: /Add a category|Give access|Start a count|Add item|Receive stock/ }).count(), 0, `${p}: no action buttons`);
      console.log(`   emp ${p}:`, t.slice(0, 120));
    }
    await R.go("/inventory/mine");
    check(/equipment/i.test(await R.mainText()), "My equipment opens");
  });
}

// =====================================================================================================================
// B9. No automatic grants
// =====================================================================================================================
if (run("B9")) {
  await step("B9 only the seeded grants exist: nothing was given to the CEO of Poland/AE as such, HR admins, the system admin, mgr, emp or any test account by default", async () => {
    const rows = sqlRows("select u.email||':'||g.capabilities::text||':'||coalesce(g.note,'') from inv_company_grants g join auth.users u on u.id=g.user_id where g.revoked_at is null order by 1");
    console.log("   active grants:\n   " + rows.join("\n   "));
    const emails = rows.map((r) => r.split(":")[0]);
    for (const e of ["admin@e2e.local", "emp@e2e.local", "mgr@e2e.local", "pol.worker@e2e.local"]) check(!emails.includes(e), `${e} has a grant`);
    eq(rows.length, 5, "exactly the five seeded grants (ceo, pol.exec, hr1, lead, hr)");
    check(rows.every((r) => /local seed/.test(r)), "every grant came from the seed");
    eq(s1("select count(*) from inv_company_grants where revoked_at is null and granted_by is not null and note is distinct from 'local seed' and note not like 'local seed%'"), 0, "no other grant");
  });
}

// =====================================================================================================================
// B3. Direct calls to the data service with each person's real token
// =====================================================================================================================
if (run("B3")) {
  const counts = () => ({ units: Number(s1("select count(*) from inv_units")), movements: Number(s1("select count(*) from inv_movements")), balances: s1("select coalesce(sum(qty),0) from inv_balances"), grants: Number(s1("select count(*) from inv_company_grants")), sharing: Number(s1("select count(*) from inv_company_sharing")), locations: Number(s1("select count(*) from inv_locations")), counts: Number(s1("select count(*) from inv_counts")) });
  const before = counts();
  const key = (who) => `b3-${who}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const calls = (who) => ({
    receive: ["inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: key(who), p_lines: [{ item_id: HDMI, qty: 1 }] }],
    dispatch: ["inv_dispatch_to_project", { p_company_id: AE, p_location_id: DXB, p_project_id: PRJ_A, p_key: key(who), p_lines: [{ unit_id: UNIT_ID }] }],
    issue: ["inv_issue_to_employee", { p_company_id: AE, p_location_id: DXB, p_employee_id: "00000000-0000-4000-8000-0000000000e5", p_key: key(who), p_lines: [{ unit_id: UNIT_ID }] }],
    sharing: ["inv_set_company_sharing", { p_owner_company_id: AE, p_use_company_id: PL, p_enabled: true, p_note: "b3" }],
    grantSelf: ["inv_grant_access", { p_user_id: U(PERSONA[who][1]), p_company_id: AE, p_capabilities: ["founder", "view_costs"], p_note: "b3" }],
    revokeFounder: ["inv_revoke_access", { p_user_id: U(3), p_company_id: AE }],
    code: ["inv_set_company_code", { p_company_id: AE, p_reference_code: "HIJ" }],
    location: ["inv_save_location", { p_company_id: AE, p_location_id: null, p_code: "XXX", p_name: "Rogue", p_timezone: "Asia/Dubai" }],
    count: ["inv_start_count", { p_company_id: AE, p_location_id: DXB, p_kind: "cycle", p_note: "b3" }],
    adjust: ["inv_adjust_stock", { p_company_id: AE, p_location_id: DXB, p_key: key(who), p_action: "retire", p_lines: [{ unit_id: UNIT_ID }], p_reason: "b3" }],
  });
  for (const who of ["admin", "emp", "mgr", "lead", "hr", "pol"]) {
    await step(`B3 ${who}@: every Inventory operation is refused by the database (receive, dispatch, issue, sharing, grant self founder, revoke, code, location, count, retire)`, async () => {
      for (const [name, [fn, args]] of Object.entries(calls(who))) {
        const r = await rpc(who, fn, args);
        check(r.status >= 400, `${name} must be refused for ${who}@, got ${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
        check(!/syntax error|undefined function|does not exist/i.test(refusal(r)), `${name}: refused for the right reason, not a broken call: ${refusal(r)}`);
      }
      console.log(`   ${who}@ e.g. receive: ${refusal(await rpc(who, ...calls(who).receive)).slice(0, 110)}`);
    });
  }
  await step("B3 hr1@ (warehouse at Dubai) may receive at Dubai but cannot grant access, share, revoke or change settings; the Dubai receipt is recorded once", async () => {
    const k = key("hr1");
    const ok = await rpc("hr1", "inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: k, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(ok.status < 300, "Dubai receipt: " + JSON.stringify(ok.body).slice(0, 200));
    const again = await rpc("hr1", "inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: k, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(again.status < 300, "the same key replays: " + JSON.stringify(again.body).slice(0, 120));
    eq(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse'`), 13, "13 cables: 12 + exactly one more");
    for (const name of ["sharing", "grantSelf", "revokeFounder", "code", "location"]) {
      const [fn, args] = calls("hr1")[name]; const r = await rpc("hr1", fn, args);
      check(r.status >= 400, `${name} refused for hr1@: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
  });
  await step("B3 nothing changed behind the refusals (units, movements, grants, sharing, locations, counts)", async () => {
    const after = counts();
    eq(after.units, before.units, "units"); eq(after.grants, before.grants, "grants"); eq(after.sharing, before.sharing, "sharing rows");
    eq(after.locations, before.locations, "locations"); eq(after.counts, before.counts, "counts");
    eq(after.movements, before.movements + 1, "movements: only hr1@'s one Dubai receipt was recorded");
  });

  const TABLES = ["inv_units", "inv_balances", "inv_movements", "inv_movement_lines", "inv_costs", "inv_requests", "inv_reservations", "inv_company_grants", "inv_audit_log", "inv_company_sharing", "inv_items", "inv_locations"];
  const EXPECT = {   // rows each person can read of each table (> means at least one)
    ceo: { inv_units: ">0", inv_balances: ">0", inv_movements: ">0", inv_costs: ">0", inv_company_grants: ">0", inv_audit_log: ">0", inv_items: ">0", inv_locations: ">0" },
    hr1: { inv_units: ">0", inv_balances: ">0", inv_movements: ">0", inv_costs: "0", inv_audit_log: "0", inv_items: ">0", inv_locations: ">0" },
    hr: { inv_units: "0", inv_balances: "0", inv_movements: "0", inv_costs: "0", inv_audit_log: "0", inv_company_sharing: "0" },
    lead: { inv_units: "0", inv_balances: "0", inv_movements: "0", inv_costs: "0", inv_audit_log: "0", inv_company_sharing: "0" },
    mgr: { inv_units: "0", inv_balances: "0", inv_movements: "0", inv_costs: "0", inv_audit_log: "0", inv_company_sharing: "0" },
    emp: { inv_units: "0", inv_balances: "0", inv_movements: "0", inv_movement_lines: "0", inv_costs: "0", inv_requests: "0", inv_reservations: "0", inv_audit_log: "0", inv_items: "0", inv_locations: "0", inv_company_sharing: "0" },
    admin: { inv_units: "0", inv_balances: "0", inv_movements: "0", inv_movement_lines: "0", inv_costs: "0", inv_requests: "0", inv_reservations: "0", inv_audit_log: "0", inv_items: "0", inv_locations: "0", inv_company_sharing: "0" },
    pol: { inv_units: "0", inv_balances: "0", inv_movements: "0", inv_movement_lines: "0", inv_costs: "0", inv_requests: "0", inv_reservations: "0", inv_audit_log: "0", inv_company_sharing: "0" },
  };
  for (const who of WHO) {
    await step(`B3 ${who}@ reads the Inventory tables directly: each is empty or full exactly as the role allows`, async () => {
      const lines = [];
      for (const t of TABLES) {
        const r = await rest(who, "GET", `/${t}?select=*&limit=50`);
        check(r.status === 200 && Array.isArray(r.body), `${t}: ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
        lines.push(`${t.replace("inv_", "")}:${r.body.length}`);
        const want = EXPECT[who][t];
        if (who === "pol" && t === "inv_audit_log") { check(r.body.every((x) => x.company_id === PL), "pol.exec@ reads audit rows of the Poznan company only"); continue; }
        if (want === "0") eq(r.body.length, 0, `${who}@ must read no ${t}`);
        if (want === ">0") check(r.body.length > 0, `${who}@ should read ${t}`);
      }
      console.log(`   ${who}@ ${lines.join(" ")}`);
    });
  }
  await step("B3 purchase costs by table: ONLY the founder reads inv_costs; the closed tables (idempotency, counters) are unreadable even to the founder", async () => {
    for (const who of WHO) {
      const r = await rest(who, "GET", "/inv_costs?select=unit_cost");
      eq(countRows(r), who === "ceo" ? 1 : 0, `inv_costs rows for ${who}@`);
    }
    for (const t of ["inv_idempotency", "inv_reference_counters"]) {
      const r = await rest("ceo", "GET", `/${t}?select=*`);
      check(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t} not readable by the founder: ${r.status}`);
    }
  });
  await step("B3 tables are read-only for EVERY signed-in person including the founder: insert, update and delete are refused and change nothing", async () => {
    const snap = () => s1("select count(*)||'/'||coalesce(sum(qty),0) from inv_balances") + "|" + s1("select string_agg(condition||custody_kind, ',' order by code) from inv_units");
    const b = snap();
    for (const who of ["ceo", "hr1", "mgr", "emp"]) {
      const ins = await rest(who, "POST", "/inv_units", { company_id: AE, item_id: LAP, code: "HACK-1", lifecycle: "active", condition: "good", custody_kind: "warehouse", location_id: DXB });
      check(ins.status >= 400, `${who}@ insert into inv_units must fail: ${ins.status}`);
      const upd = await rest(who, "PATCH", `/inv_units?id=eq.${UNIT_ID}`, { condition: "damaged" });
      check(upd.status >= 400 || upd.body === null || (Array.isArray(upd.body) && upd.body.length === 0), `${who}@ update of inv_units must not apply: ${upd.status} ${JSON.stringify(upd.body).slice(0, 100)}`);
      const bal = await rest(who, "PATCH", "/inv_balances?qty=gte.0", { qty: 9999 });
      check(bal.status >= 400 || (Array.isArray(bal.body) && bal.body.length === 0) || bal.body === null, `${who}@ update of inv_balances must not apply: ${bal.status}`);
      const del = await rest(who, "DELETE", "/inv_movements?id=not.is.null");
      check(del.status >= 400 || del.body === null || (Array.isArray(del.body) && del.body.length === 0), `${who}@ delete of inv_movements must not apply: ${del.status}`);
      const cost = await rest(who, "POST", "/inv_costs", { company_id: AE, item_id: LAP, unit_id: UNIT_ID, unit_cost: 1, currency: "AED", entered_by: U(PERSONA[who][1]) });
      check(cost.status >= 400, `${who}@ insert into inv_costs must fail: ${cost.status}`);
      const grant = await rest(who, "POST", "/inv_company_grants", { user_id: U(PERSONA[who][1]), company_id: AE, capabilities: ["founder"] });
      check(grant.status >= 400, `${who}@ writing a grant directly must fail: ${grant.status}`);
    }
    eq(snap(), b, "balances and units unchanged");
    eq(s1("select count(*) from inv_units where code='HACK-1'"), 0, "no rogue unit");
    // a signed-out call
    const anon = await rest(null, "GET", "/inv_units?select=id");
    check(anon.status >= 400 || (Array.isArray(anon.body) && anon.body.length === 0), "signed-out read: " + anon.status);
    const anonFn = await rpc(null, "inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: key("anon"), p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(anonFn.status >= 400, "signed-out function call refused: " + anonFn.status);
  });
}

// =====================================================================================================================
// B4. Purchase costs in the HTML, and an explicit view_costs grant made on the Access page
// =====================================================================================================================
const unitPanelText = async (page, id = UNIT_ID) => { await page.goto(`${BASE}/inventory?unit=${id}`, { waitUntil: "networkidle" }); return { text: (await page.locator("body").innerText()).replace(/\s+/g, " "), html: await page.content() }; };
if (run("B4")) {
  await step("B4 the founder sees the purchase cost of a unit (AED 1,250.00); warehouse, HR custody, Project Manager, department head, employee and admin never do, not in the text and not in the HTML", async () => {
    await R.as("ceo");
    let r = await unitPanelText(R.page);
    check(/Purchase cost/.test(r.text) && /1,?250/.test(r.text), "founder sees it: " + (r.text.match(/Purchase cost.{0,40}/)?.[0] ?? "(not shown)"));
    await R.shot("flow5-founder-sees-cost");
    for (const who of ["hr1", "hr", "mgr", "lead", "emp", "admin", "pol"]) {
      await R.as(who);
      for (const p of [`/inventory?unit=${UNIT_ID}`, "/inventory", `/inventory?open=${LAP}`, "/inventory/movements", "/inventory/requests", `/projects/${PRJ_A}/equipment`, "/inventory?action=receive"]) {
        await R.page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
        const html = await R.page.content();
        check(!/Purchase cost|1,?250\.00|unit_cost|purchase_date/i.test(html), `${who}@ ${p} shows a cost`);
      }
    }
  });
  await step("B4 the warehouse operator receive form offers no cost field", async () => {
    await R.as("hr1");
    await R.go("/inventory?action=receive");
    await R.panel().waitFor();
    check(!/cost|price|currency/i.test(await R.panel().innerText()), "no cost wording in the receive form: " + (await R.panel().innerText()).replace(/\s+/g, " ").slice(0, 200));
  });
  await step("B4 a founder gives hr1@ the separate 'see purchase costs' right on the Access page: the unit now shows its cost to hr1@ and the table returns it; revoking it hides it again", async () => {
    await R.as("ceo");
    const tick = async (on) => {
      await R.go("/inventory/access");
      const row = R.page.locator("main li").filter({ hasText: "hr1@e2e.local" }).first();
      await row.getByRole("button", { name: /^Change/ }).click();
      await R.dialog().waitFor();
      const box = R.dialog().getByLabel(/See purchase costs/i);
      if (on) await box.check(); else await box.uncheck();
      await R.dialog().getByRole("button", { name: "Save changes" }).click();
      await R.closedDialog();
    };
    await tick(true);
    await until(() => /view_costs/.test(s1(`select capabilities::text from inv_company_grants where user_id='${U(1)}' and revoked_at is null`)), 15000, "grant ");
    await R.shot("flow5-access-cost-grant");
    await R.as("hr1");
    let r = await unitPanelText(R.page);
    check(/Purchase cost/.test(r.text) && /1,?250/.test(r.text), "hr1@ with the explicit right sees the cost");
    eq(countRows(await rest("hr1", "GET", "/inv_costs?select=unit_cost")), 1, "and reads inv_costs");
    await R.as("ceo"); await tick(false);
    await until(() => !/view_costs/.test(s1(`select capabilities::text from inv_company_grants where user_id='${U(1)}' and revoked_at is null`)), 15000, "ungrant ");
    await R.as("hr1");
    r = await unitPanelText(R.page);
    check(!/Purchase cost|1,?250/.test(r.html), "hidden again");
    eq(countRows(await rest("hr1", "GET", "/inv_costs?select=unit_cost")), 0, "table empty again");
    // the other direction: the warehouse right did not come with it
    eq(s1(`select capabilities::text from inv_company_grants where user_id='${U(1)}' and revoked_at is null`), "{warehouse}", "hr1@ is back to exactly the warehouse right");
  });
}

// =====================================================================================================================
// B5. Locations
// =====================================================================================================================
if (run("B5")) {
  await step("B5 hr1@ (Dubai only): the receive form offers Dubai and not Riyadh; the database refuses Riyadh for receive, issue and transfer-out, and allows Dubai", async () => {
    await R.as("hr1");
    await R.go("/inventory?action=receive");
    await R.panel().waitFor();
    const opts = await R.panel().getByLabel("Receive into", { exact: true }).locator("option").allTextContents();
    console.log("   locations offered:", opts.join(" | "));
    check(opts.some((o) => /Dubai/.test(o)) && !opts.some((o) => /Riyadh|Poznan/.test(o)), "only Dubai is offered");
    const ruh = await rpc("hr1", "inv_receive_stock", { p_company_id: AE, p_location_id: RUH, p_key: `b5-${Date.now()}`, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(ruh.status >= 400 && /not set up to work at this location|work at/i.test(refusal(ruh)), "Riyadh refused in words: " + refusal(ruh)); console.log("   Riyadh:", refusal(ruh));
    const out = await rpc("hr1", "inv_transfer_dispatch", { p_company_id: AE, p_from_location_id: RUH, p_to_location_id: DXB, p_key: `b5t-${Date.now()}`, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(out.status >= 400, "sending from Riyadh refused: " + out.status);
    const dxb = await rpc("hr1", "inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: `b5d-${Date.now()}`, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(dxb.status < 300, "Dubai allowed: " + JSON.stringify(dxb.body).slice(0, 160));
    const poz = await rpc("hr1", "inv_receive_stock", { p_company_id: PL, p_location_id: POZ, p_key: `b5p-${Date.now()}`, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(poz.status >= 400, "another company's location refused: " + poz.status);
  });
}

// =====================================================================================================================
// B6. Another company
// =====================================================================================================================
if (run("B6")) {
  let PL_PROJECT = "";
  await step("B6 set-up: the Poznan company gets a Projects reference code and a project (real function, as its founder)", async () => {
    if (s1(`select count(*) from proj_company_settings where company_id='${PL}'`) === "0") sql(`insert into proj_company_settings (company_id, reference_code) values ('${PL}', 'POL')`);
    if (s1(`select count(*) from proj_company_grants where company_id='${PL}' and user_id='${U(8)}'`) === "0") sql(`insert into proj_company_grants (user_id, company_id, capabilities) values ('${U(8)}', '${PL}', '{founder}')`);
    PL_PROJECT = s1("select id from proj_projects where name='Poznan fit-out'") || asDb(8, `select proj_create_internal_project('${PL}', 'Poznan fit-out', '${U(8)}', false, 'normal', current_date + 5, current_date + 30)`);
    check(PL_PROJECT, "project created");
  });
  const dispatchToPl = (key) => rpc("hr1", "inv_dispatch_to_project", { p_company_id: AE, p_location_id: DXB, p_project_id: PL_PROJECT, p_key: key, p_lines: [{ unit_id: s1(`select id from inv_units where code='${UNIT_CODE}'`) }], p_expected_return_at: new Date(Date.now() + 5 * 86400000).toISOString() });
  await step("B6 the Poznan founder sees none of the AE stock: not on the pages, not in the HTML, not through the data service", async () => {
    await R.as("pol");
    for (const p of ["/inventory", "/inventory/movements", `/inventory?unit=${UNIT_ID}`, `/inventory?open=${LAP}`, "/inventory/employees"]) {
      await R.page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      const html = await R.page.content();
      check(!/ENG-E-|Laptop 14 inch|HDMI cable|Dubai|Riyadh|Showroom refresh/.test(html), `${p} leaks AE data`);
    }
    await R.go("/inventory");
    await R.shot("flow5-poznan-founder-inventory");
    for (const t of ["inv_units", "inv_items", "inv_locations", "inv_balances", "inv_categories"]) {
      const r = await rest("pol", "GET", `/${t}?select=id&company_id=eq.${AE}`);
      eq(countRows(r), 0, `pol.exec@ reads no AE ${t}`);
    }
    const r = await rpc("pol", "inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: `b6-${Date.now()}`, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(r.status >= 400, "cannot receive into AE: " + r.status);
  });
  await step("B6 without a sharing row an AE operator cannot send AE equipment to a Poznan project (refused in words, nothing moves)", async () => {
    const before = s1("select count(*) from inv_movements");
    const r = await dispatchToPl(`b6a-${Date.now()}`);
    check(r.status >= 400, "refused: " + JSON.stringify(r.body).slice(0, 160)); console.log("   refused:", refusal(r));
    check(/allow|authoris|another company|share|sharing/i.test(refusal(r)), "the words say why: " + refusal(r));
    eq(s1("select count(*) from inv_movements"), before, "no movement");
    eq(s1(`select custody_kind from inv_units where code='${UNIT_CODE}'`), "warehouse", "unit stays");
  });
  await step("B6 the AE founder makes the sharing row on the Access page (UI): then the same dispatch works; revoking it on the page stops the next one", async () => {
    await R.as("ceo");
    await R.go("/inventory/access");
    await R.page.getByLabel(/^Allow this company to use/).selectOption({ label: "Enginious Local PL" });
    await R.page.getByRole("button", { name: "Allow this company" }).click();
    await until(() => s1(`select count(*) from inv_company_sharing where company_id='${AE}' and use_company_id='${PL}' and revoked_at is null`) === "1", 15000, "sharing row ");
    await R.page.getByText(/Companies allowed to use/).first().waitFor();
    await R.shot("flow5-sharing-allowed");
    const ok = await dispatchToPl(`b6b-${Date.now()}`);
    check(ok.status < 300, "works now: " + JSON.stringify(ok.body).slice(0, 200));
    eq(s1(`select project_id from inv_units where code='${UNIT_CODE}'`), PL_PROJECT, "the AE laptop is on the Poznan project");
    eq(s1(`select company_id from inv_units where code='${UNIT_CODE}'`), AE, "and still belongs to AE (moving never changes the owner)");
    // bring it back (the founder's own route), then withdraw the permission
    const back = await rpc("hr1", "inv_return_from_project", { p_company_id: AE, p_location_id: DXB, p_project_id: PL_PROJECT, p_key: `b6r-${Date.now()}`, p_lines: [{ unit_id: UNIT_ID, condition: "good" }] });
    check(back.status < 300, "returned: " + JSON.stringify(back.body).slice(0, 160));
    await R.go("/inventory/access");
    await R.page.getByRole("button", { name: /Stop allowing/ }).first().click();
    await R.dialog().waitFor();
    await R.dialog().getByRole("button", { name: "Stop allowing" }).click();
    await R.closedDialog();
    await until(() => s1(`select count(*) from inv_company_sharing where company_id='${AE}' and use_company_id='${PL}' and revoked_at is null`) === "0", 15000, "revoked ");
    const again = await dispatchToPl(`b6c-${Date.now()}`);
    check(again.status >= 400, "refused again after the revoke: " + again.status); console.log("   after revoke:", refusal(again));
    eq(s1(`select custody_kind from inv_units where code='${UNIT_CODE}'`), "warehouse", "unit stays at the warehouse");
  });
  await step("B6 only the owning company's founder can make the sharing row: a Poznan founder asking for AE's equipment, and an AE operator, are refused", async () => {
    for (const who of ["pol", "hr1"]) {
      const r = await rpc(who, "inv_set_company_sharing", { p_owner_company_id: AE, p_use_company_id: PL, p_enabled: true, p_note: "x" });
      check(r.status >= 400, `${who}@ refused: ${r.status}`);
    }
    eq(s1(`select count(*) from inv_company_sharing where company_id='${AE}' and revoked_at is null`), 0, "no active sharing row");
  });
}

// =====================================================================================================================
// B7. Access revoked while a page is open
// =====================================================================================================================
if (run("B7")) {
  await step("B7 hr1@ has the Inventory page open; a founder revokes the grant; hr1@'s next action in that page fails with the access message and the page then shows no access", async () => {
    const hr1 = await R.extra("hr1");
    try {
      await hr1.goto(`${BASE}/inventory?action=receive`, { waitUntil: "networkidle" });
      const panel = hr1.locator("aside[role=dialog]"); await panel.waitFor();
      await panel.getByLabel("Receive into", { exact: true }).selectOption({ label: "Dubai" });
      const box = panel.getByLabel("Search for an item or unit to add");
      await box.fill("HDMI");
      const results = panel.getByRole("list", { name: "Search results" }); await results.waitFor();
      await results.getByRole("button", { name: /^Add HDMI cable/ }).first().click();
      await panel.getByLabel("Quantity of HDMI cable", { exact: true }).fill("2");
      await panel.getByRole("button", { name: "Review", exact: true }).click();
      await panel.getByText("Check before you confirm").waitFor();
      const cables = s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse'`);
      // the founder revokes through the real function as the founder (the Access page does exactly this call)
      asDb(3, `select inv_revoke_access('${U(1)}', '${AE}')`);
      await panel.getByRole("button", { name: /^Confirm/ }).click();
      await panel.locator("[role=alert]").first().waitFor({ timeout: 20000 });
      const said = (await panel.locator("[role=alert]").first().innerText()).replace(/\s+/g, " ");
      console.log("   hr1@'s open page says:", said);
      check(!/Recorded/.test((await panel.innerText())), "not recorded");
      check(/access|allowed|permission|not set up|only/i.test(said), "the access message: " + said);
      eq(s1(`select coalesce(sum(qty),0) from inv_balances where item_id='${HDMI}' and holder_kind='warehouse'`), cables, "no stock changed");
      await hr1.screenshot({ path: `${process.env.SHOTS_DIR ?? new URL("../../../docs/inventory-screenshots", import.meta.url).pathname}/flow5-revoked-while-open.png` });
      await hr1.reload({ waitUntil: "networkidle" });
      const t = (await hr1.locator("body").innerText()).replace(/\s+/g, " ");
      check(!/Laptop 14 inch|ENG-E-/.test(await hr1.content()), "the page then shows no stock");
      console.log("   after reload:", t.replace(/^.*?Inventory/, "Inventory").slice(0, 200));
      eq(countRows(await rest("hr1", "GET", "/inv_units?select=id")), 0, "and the data service returns nothing");
    } finally { await hr1.context().close(); }
  });
  await step("B7 a founder gives hr1@ the warehouse right back at Dubai (Access page); the operator can work again", async () => {
    await R.as("ceo");
    await R.go("/inventory/access");
    await R.page.getByLabel("Find a colleague").fill("hr1");
    await R.page.getByLabel("Person", { exact: true }).selectOption({ index: 1 });
    await R.page.getByLabel(/Warehouse operator|Receive, issue/i).first().check().catch(async () => { await R.page.locator("input[name=capabilities][value=warehouse]").check(); });
    await R.page.getByLabel("Dubai").check();
    await R.page.getByRole("button", { name: "Give access" }).click();
    await until(() => s1(`select count(*) from inv_company_grants where user_id='${U(1)}' and revoked_at is null`) === "1", 15000, "regranted ");
    const ok = await rpc("hr1", "inv_receive_stock", { p_company_id: AE, p_location_id: DXB, p_key: `b7-${Date.now()}`, p_lines: [{ item_id: HDMI, qty: 1 }] });
    check(ok.status < 300, "Dubai works again: " + JSON.stringify(ok.body).slice(0, 200));
  });
}

// =====================================================================================================================
// B8. Direct addresses and the signed-out scan address
// =====================================================================================================================
if (run("B8")) {
  await step("B8 /inventory/manage and /inventory/access typed straight into the address bar: hr1@ and emp@ get a plain message, never an error page or data", async () => {
    for (const who of ["hr1", "emp", "admin", "mgr"]) {
      await R.as(who);
      for (const p of ["/inventory/manage", "/inventory/access"]) {
        const res = await R.page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
        check(res.status() < 400, `${who} ${p}: HTTP ${res.status()}`);
        const t = (await R.page.locator("main").innerText()).replace(/\s+/g, " ");
        check(!/Application error|Something went wrong|Internal Server/i.test(t), `${who} ${p} shows an error page`);
        if (p === "/inventory/access") check(/Only a founder|do not have|not have access|no access/i.test(t), `${who} ${p}: ${t.slice(0, 160)}`);
        // an operator may START a count at their own location; nobody here may change access, categories, locations or settings
        eq(await R.page.locator("main").getByRole("button", { name: /Give access|Add a category|Add a location|Add a template|Revoke|Change|Save settings/ }).count(), 0, `${who} ${p}: nothing to change`);
        if (who !== "hr1") eq(await R.page.locator("main").getByRole("button", { name: /Start a count/ }).count(), 0, `${who} ${p}: cannot start a count`);
      }
    }
  });
  const SCAN = `/inventory/scan?c=${UNIT_CODE}`;
  await step("B8 the signed-out scan address goes to sign-in and, after signing in, returns to the same address with the query string kept, then opens the record", async () => {
    const ctx = await R.browser.newContext(); const p = await ctx.newPage();
    try {
      await p.goto(`${BASE}${SCAN}`, { waitUntil: "networkidle" });
      check(/\/login/.test(p.url()), "sent to sign-in: " + p.url());
      console.log("   sign-in address:", p.url().replace(BASE, ""));
      check(/inventory/.test(decodeURIComponent(p.url())) && decodeURIComponent(p.url()).includes(UNIT_CODE), "the sign-in address remembers the code: " + p.url());
      check(!/UNIT_CODE|\bENG-E-\d+.*Laptop/.test(await p.locator("body").innerText()), "the login page shows nothing about the code");
      await p.getByLabel(/email/i).fill("ceo@e2e.local"); await p.getByLabel(/password/i).first().fill("local-stack-password");
      await p.getByRole("button", { name: /sign in|log in/i }).click();
      await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
      console.log("   after sign-in, first address:", p.url().replace(BASE, ""));
      check(p.url().includes("/inventory/scan") && p.url().includes(UNIT_CODE), "returned to the scan address with its query string: " + p.url());
      await p.waitForURL(/unit=/, { timeout: 15000 });          // the scan address then opens the record it names
      await p.waitForLoadState("networkidle");
      console.log("   then:", p.url().replace(BASE, ""));
      check(p.url().includes(`unit=${UNIT_ID}`), "opened the record: " + p.url());
      await p.locator("aside[role=dialog]").getByText(UNIT_CODE).first().waitFor({ timeout: 15000 });   // the unit's record panel names its code
    } finally { await ctx.close(); }
  });
  await step("B8 a signed-in person WITHOUT access scanning a real code and an unknown code sees the same neutral message (the code is never confirmed)", async () => {
    await R.as("emp");
    const messages = [];
    for (const c of [UNIT_CODE, "ENG-E-99999", "NOPE-1"]) {
      await R.page.goto(`${BASE}/inventory/scan?c=${c}`, { waitUntil: "networkidle" });
      const t = (await R.page.locator("main").innerText()).replace(/\s+/g, " ");
      const html = await R.page.content();
      check(!html.includes("Laptop 14 inch") && !/In the warehouse|In use/.test(t), `${c}: nothing about the record`);
      messages.push(t.match(/This code is not available to you or does not exist\.|That is not an Enginious Inventory code[^.]*\./)?.[0] ?? "(no message) " + t.slice(0, 100));
    }
    console.log("   messages:", messages.join(" || "));
    eq(messages[0], messages[1], "real and unknown unit code give the identical message");
    check(/not available to you or does not exist/.test(messages[0]), "neutral wording");
    await R.page.goto(`${BASE}/inventory/scan?c=https://evil.example/x`, { waitUntil: "networkidle" });
    check(/not an Enginious Inventory code/.test(await R.mainText()), "another web address is not an Inventory code");
  });
}

await R.stop();
process.exit(R.verdict("flow 5 (access)"));
