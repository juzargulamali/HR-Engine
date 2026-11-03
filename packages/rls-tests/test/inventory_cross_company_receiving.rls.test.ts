import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Owner decision: sharing-authorised receiving-company warehouse operators may view the MINIMUM equipment and transfer information needed to receive and
// handle stock at their assigned warehouses, including incoming transfers; the owner, barcode and serial are preserved; costs and unrelated company records
// stay restricted; both authorised sides can trace the same transfer through dispatch and receipt. Every case calls the database functions directly, as
// the person concerned.
const id = () => randomUUID();
const CO = { uae: id(), ksa: id(), qat: id(), oman: id() };
const U = {
  uaeFounder: id(), uaeOp: id(), ksaFounder: id(), ksaOp: id(), ksaJeddahOp: id(), ksaViewer: id(), ksaGone: id(),
  qatFounder: id(), qatOp: id(), omanFounder: id(), omanOp: id(), outsider: id(),
};
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const fut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const UNIT_FIELDS = ["bin_code", "bin_id", "category_name", "code", "condition", "custody_kind", "item_id", "item_name", "location_company_id", "location_id", "location_name", "owner_company_id", "owner_company_name", "ownership", "serial_number", "transfer_code", "transfer_id", "unit_id", "usable_here"];
const FORBIDDEN = /cost|price|supplier|rental|note|photo|employee|project|request|email|salary/i;

describe("Inventory: cross-company receiving (minimum visibility, same transfer for both sides)", () => {
  const db = new RlsTestDatabase();
  const q = async <T = Row>(user: string | null, sql: string) => (await db.asUser(user, async (query) => (await query(sql)).rows)) as T[];
  const commit = async <T = Row>(user: string, sql: string) => (await db.asUserCommit(user, async (query) => (await query(sql)).rows)) as T[];
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const call = async <T = Row>(user: string, sql: string): Promise<T> => (await commit<{ r: T }>(user, `select ${sql} as r`))[0]!.r;
  const key = () => `key-${id()}`;
  const L: Record<string, string> = {};
  const UN: Record<string, string> = {};
  let item = ""; let cable = ""; let trA = ""; let trD = ""; let trQty = ""; let codeA = "";
  const unit = async (uid: string) => (await admin<Row>(`select * from inv_units where id = '${uid}'`))[0]!;
  const units = (who: string | null, args = "") => q<Row>(who, `select * from inv_xshare_units(${args})`);
  const transfers = (who: string | null) => q<Row>(who, `select * from inv_xshare_transfers()`);
  const trace = async (who: string | null, tid: string) => (await q<{ t: Row }>(who, `select inv_xshare_transfer_trace('${tid}') t`))[0]!.t;
  const codes = async (who: string | null, args = "") => (await units(who, args)).map((r) => r.code).sort();

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('QA', 'Qatar', 'QAR'), ('OM', 'Oman', 'OMR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR'),
        ('${CO.qat}', 'Enginious Qatar', 'QA', 'QAR'), ('${CO.oman}', 'Enginious Oman', 'OM', 'OMR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@xshare-test.ae')`).join(", ")};
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.uaeFounder}', '${CO.uae}', '{founder}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}'),
        ('${U.qatFounder}', '${CO.qat}', '{founder}'), ('${U.omanFounder}', '${CO.oman}', '{founder}');
    `);
    for (const [c, f, code] of [[CO.uae, U.uaeFounder, "UAE"], [CO.ksa, U.ksaFounder, "KSA"], [CO.qat, U.qatFounder, "QAT"], [CO.oman, U.omanFounder, "OMN"]] as const) {
      await commit(f, `select inv_set_company_code('${c}', '${code}')`);
    }
    await commit(U.uaeFounder, `select inv_grant_access('${U.uaeOp}', '${CO.uae}', '{warehouse}'::text[])`);
    for (const u of [U.ksaOp, U.ksaJeddahOp, U.ksaGone]) await commit(U.ksaFounder, `select inv_grant_access('${u}', '${CO.ksa}', '{warehouse}'::text[])`);
    await commit(U.ksaFounder, `select inv_grant_access('${U.ksaViewer}', '${CO.ksa}', '{view_stock}'::text[])`);
    await commit(U.qatFounder, `select inv_grant_access('${U.qatOp}', '${CO.qat}', '{warehouse}'::text[])`);
    await commit(U.omanFounder, `select inv_grant_access('${U.omanOp}', '${CO.oman}', '{warehouse}'::text[])`);
    L.dubai = await call<string>(U.uaeFounder, `inv_save_location('${CO.uae}', null, 'DXB', 'Dubai warehouse', 'Asia/Dubai')`);
    L.auh = await call<string>(U.uaeFounder, `inv_save_location('${CO.uae}', null, 'AUH', 'Abu Dhabi warehouse', 'Asia/Dubai')`);
    L.riyadh = await call<string>(U.ksaFounder, `inv_save_location('${CO.ksa}', null, 'RUH', 'Riyadh warehouse', 'Asia/Riyadh')`);
    L.jeddah = await call<string>(U.ksaFounder, `inv_save_location('${CO.ksa}', null, 'JED', 'Jeddah warehouse', 'Asia/Riyadh')`);
    L.doha = await call<string>(U.qatFounder, `inv_save_location('${CO.qat}', null, 'DOH', 'Doha warehouse', 'Asia/Qatar')`);
    L.muscat = await call<string>(U.omanFounder, `inv_save_location('${CO.oman}', null, 'MCT', 'Muscat warehouse', 'Asia/Muscat')`);
    await commit(U.uaeFounder, `select inv_set_operator_locations('${CO.uae}', '${U.uaeOp}', '{${L.dubai},${L.auh}}')`);
    await commit(U.ksaFounder, `select inv_set_operator_locations('${CO.ksa}', '${U.ksaOp}', '{${L.riyadh}}')`);
    await commit(U.ksaFounder, `select inv_set_operator_locations('${CO.ksa}', '${U.ksaGone}', '{${L.riyadh}}')`);
    await commit(U.ksaFounder, `select inv_set_operator_locations('${CO.ksa}', '${U.ksaJeddahOp}', '{${L.jeddah}}')`);
    await commit(U.qatFounder, `select inv_set_operator_locations('${CO.qat}', '${U.qatOp}', '{${L.doha}}')`);
    await commit(U.omanFounder, `select inv_set_operator_locations('${CO.oman}', '${U.omanOp}', '{${L.muscat}}')`);
    item = await call<string>(U.uaeFounder, `inv_save_item('${CO.uae}', null, ${j({ name: "LED panel P2.5", tracking: "individual", status: "active" })})`);
    cable = await call<string>(U.uaeFounder, `inv_save_item('${CO.uae}', null, ${j({ name: "HDMI cable 5 m", tracking: "quantity", status: "active" })})`);
    const c = (await call<Row>(U.uaeOp, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
    for (const [k, loc] of [["a", L.dubai], ["b", L.dubai], ["d", L.dubai], ["c", L.auh]] as const) {
      const r = await call<Row>(U.uaeOp, `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${item}', p_serial_number => 'SN-X-${k.toUpperCase()}', p_location_id => '${loc}')`);
      UN[k] = r.unit_id;
    }
    // the opening count only covers Dubai units; the Abu Dhabi unit is confirmed by its own count
    for (const k of ["a", "b", "d"]) await commit(U.uaeOp, `select inv_save_count_line('${c}', 1, p_unit_id => '${UN[k]}')`);
    await call(U.uaeFounder, `inv_confirm_count('${CO.uae}', '${c}', '${key()}')`);
    const c2 = (await call<Row>(U.uaeOp, `inv_start_count('${CO.uae}', '${L.auh}', 'opening')`)).count_id;
    await commit(U.uaeOp, `select inv_save_count_line('${c2}', 1, p_unit_id => '${UN.c}')`);
    await call(U.uaeFounder, `inv_confirm_count('${CO.uae}', '${c2}', '${key()}')`);
    await call(U.uaeOp, `inv_receive_stock('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ item_id: cable, qty: 10 }])})`);
    // a cost on unit A: the receiving side must never be able to reach it
    await admin(`insert into inv_costs (company_id, item_id, unit_id, unit_cost, currency, entered_by) values ('${CO.uae}', '${item}', '${UN.a}', 1234.50, 'AED', '${U.uaeFounder}')`);
    codeA = (await unit(UN.a!)).code;
  }, 240_000);
  afterAll(async () => { await db.teardown(); });

  it("before any sharing: nobody outside the owner can send to, see or trace anything", async () => {
    expect(await q(U.uaeOp, `select * from inv_xshare_destinations()`)).toHaveLength(0);
    for (const who of [U.ksaOp, U.ksaFounder, U.qatOp, U.outsider]) {
      expect(await units(who)).toHaveLength(0);
      expect(await transfers(who)).toHaveLength(0);
    }
  });

  it("the Send form only offers warehouses the OWNER has authorised, and never an unauthorised company's warehouse", async () => {
    await commit(U.uaeFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', true, 'LED walls for the Riyadh show')`);
    const d = await q<Row>(U.uaeOp, `select * from inv_xshare_destinations()`);
    expect(d.map((x) => x.location_name).sort()).toEqual(["Jeddah warehouse", "Riyadh warehouse"]);
    expect(d.every((x) => x.company_id === CO.ksa && x.owner_company_id === CO.uae && x.owner_company_name === "Enginious UAE")).toBe(true);
    expect(Object.keys(d[0]!).sort()).toEqual(["company_id", "company_name", "location_code", "location_id", "location_name", "owner_company_id", "owner_company_name", "timezone"]);
    // not the receiving side (KSA has authorised nothing), not a third company, not a person without a warehouse role, not signed out
    for (const who of [U.ksaOp, U.qatOp, U.omanOp, U.outsider]) expect(await q(who, `select * from inv_xshare_destinations()`)).toHaveLength(0);
    await expect(q(null, `select * from inv_xshare_destinations()`)).rejects.toThrow(/permission denied/);
  });

  it("send: the owner dispatches unit A to Riyadh, unit D to Jeddah and 4 cables to Riyadh (existing workflow, unchanged)", async () => {
    trA = (await call<Row>(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.riyadh}', '${key()}', ${j([{ unit_id: UN.a }])}, '${fut(3)}', 'DHL', 'WB-9')`)).transfer_id;
    trD = (await call<Row>(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.jeddah}', '${key()}', ${j([{ unit_id: UN.d }])}, '${fut(3)}')`)).transfer_id;
    trQty = (await call<Row>(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.riyadh}', '${key()}', ${j([{ item_id: cable, qty: 4 }])}, '${fut(3)}')`)).transfer_id;
    expect((await unit(UN.a!)).custody_kind).toBe("transit");
  });

  it("in transit: the Riyadh operator reads the minimum fields of THEIR incoming unit and nothing else of the owner", async () => {
    const rows = await units(U.ksaOp);
    expect(rows.map((r) => r.code)).toEqual([codeA]); // not B, C (UAE shelves), not D (on its way to Jeddah)
    const a = rows[0]!;
    expect(Object.keys(a).sort()).toEqual(UNIT_FIELDS);
    expect(Object.keys(a).filter((k) => FORBIDDEN.test(k.replace(/^(ownership|transfer_code)$/, "")))).toEqual([]);
    expect(a).toMatchObject({ code: codeA, serial_number: "SN-X-A", item_name: "LED panel P2.5", owner_company_id: CO.uae, owner_company_name: "Enginious UAE", custody_kind: "transit",
      location_id: L.riyadh, location_name: "Riyadh warehouse", transfer_id: trA, ownership: "owned", usable_here: false });
    // by scan: exactly that code, and nothing for another UAE code
    expect(await codes(U.ksaOp, `null, '${codeA}'`)).toEqual([codeA]);
    expect(await codes(U.ksaOp, `null, '${(await unit(UN.b!)).code}'`)).toEqual([]);
    // the Riyadh founder may operate every KSA warehouse: both incoming units; the Jeddah operator only theirs
    expect(await codes(U.ksaFounder)).toEqual([codeA, (await unit(UN.d!)).code].sort());
    expect(await codes(U.ksaJeddahOp)).toEqual([(await unit(UN.d!)).code]);
    expect(await codes(U.ksaFounder, `'${L.jeddah}'`)).toEqual([(await unit(UN.d!)).code]);
  });

  it("the transfer and its trace: header, lines and events, without costs, notes, other units or other companies' records", async () => {
    expect((await transfers(U.ksaOp)).map((t) => t.transfer_id).sort()).toEqual([trA, trQty].sort());
    const t = await trace(U.ksaOp, trA);
    expect(t.transfer).toMatchObject({ transfer_id: trA, status: "in_transit", sender_company_name: "Enginious UAE", from_location_name: "Dubai warehouse", to_location_name: "Riyadh warehouse",
      to_company_name: "Enginious KSA", carrier: "DHL", reference: "WB-9" });
    expect(t.units).toHaveLength(1);
    expect(t.units[0]).toMatchObject({ code: codeA, serial_number: "SN-X-A", owner_company_id: CO.uae, on_the_way: true, at_destination: false, condition: "good", custody_kind: "transit" });
    expect(t.events.map((e: Row) => e.kind)).toEqual(["transfer_dispatch"]);
    const text = JSON.stringify(t).toLowerCase();
    for (const bad of ["1234", "unit_cost", "currency", "supplier", "purchase", "email"]) expect(text).not.toContain(bad);
    // the Jeddah transfer is not theirs; the Dubai-side counted stock line is
    await expect(trace(U.ksaOp, trD)).rejects.toThrow(/Transfer not found/);
    const tq = await trace(U.ksaOp, trQty);
    expect(tq.quantities).toEqual([expect.objectContaining({ item_name: "HDMI cable 5 m", qty_sent: 4, qty_on_the_way: 4, owner_company_name: "Enginious UAE" })]);
    // base tables stay closed: no direct read of the unit, the transfer, the costs, the owner's movements or the owner's catalogue
    for (const sql of [`select 1 from inv_units`, `select 1 from inv_transfers`, `select 1 from inv_costs`, `select 1 from inv_movements`, `select 1 from inv_movement_lines`, `select 1 from inv_items`, `select 1 from inv_locations where id = '${L.dubai}'`]) {
      expect(await q(U.ksaOp, sql)).toHaveLength(0);
    }
  });

  it("refused or empty, called directly: a viewer, a third company, a company with no authorisation, an outsider, a signed-out visitor", async () => {
    for (const who of [U.ksaViewer, U.qatOp, U.qatFounder, U.omanOp, U.outsider]) {
      expect(await units(who)).toHaveLength(0);
      expect(await transfers(who)).toHaveLength(0);
      await expect(trace(who, trA)).rejects.toThrow(/Transfer not found/);
      await expect(q(who, `select inv_xshare_availability('${item}', '${L.riyadh}')`)).rejects.toThrow(/Location not found/);
    }
    for (const sql of [`select * from inv_xshare_units()`, `select * from inv_xshare_transfers()`, `select inv_xshare_transfer_trace('${trA}')`, `select inv_xshare_availability('${item}', '${L.riyadh}')`,
                       `select inv_xshare_may_handle('${CO.uae}', '${L.riyadh}')`, `select inv_xshare_sees('${CO.uae}', '${L.dubai}', '${L.riyadh}')`, `select inv_xshare_active('${CO.uae}', '${CO.ksa}')`]) {
      await expect(q(null, sql)).rejects.toThrow(/permission denied/);
    }
    // the internal helpers are not callable by a signed-in person either
    await expect(q(U.ksaOp, `select inv_xshare_may_handle('${CO.uae}', '${L.riyadh}')`)).rejects.toThrow(/permission denied/);
    // the Jeddah operator holds a sharing-authorised role but not at Riyadh
    await expect(q(U.ksaJeddahOp, `select inv_xshare_availability('${item}', '${L.riyadh}')`)).rejects.toThrow(/Location not found/);
    await expect(trace(U.ksaJeddahOp, trA)).rejects.toThrow(/Transfer not found/);
  });

  it("availability at the destination: nothing usable before receipt (one incoming), the owner's other stock is never counted", async () => {
    const a = (await q<{ a: Row }>(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}') a`))[0]!.a;
    expect(a).toEqual({ physical_at_location: 0, usable_now: 0, in_transit: 1 });
    expect((await q<{ a: Row }>(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}') a`))[0]!.a).not.toHaveProperty("free_for_range");
    // today's own function is unchanged: it still refuses the receiving company's person for the owner's item
    await expect(q(U.ksaOp, `select inv_availability('${item}', '${L.riyadh}', now(), now() + interval '1 hour')`)).rejects.toThrow(/Item not found/);
  });

  it("receive: the Riyadh operator receives through the existing function; code, serial and owner are untouched; costs stay unreadable", async () => {
    await expect(call(U.ksaViewer, `inv_transfer_receive('${CO.ksa}', '${trA}', '${key()}')`)).rejects.toThrow(/not set up to work at this location/);
    await expect(call(U.uaeOp, `inv_transfer_receive('${CO.uae}', '${trA}', '${key()}')`)).rejects.toThrow(/Unknown location/);
    const before = await unit(UN.a!);
    const r = await call<Row>(U.ksaOp, `inv_transfer_receive('${CO.ksa}', '${trA}', '${key()}', ${j([{ unit_id: UN.a, condition: "good" }])})`);
    expect(r).toMatchObject({ status: "received", still_on_the_way: 0 });
    const after = await unit(UN.a!);
    expect(after).toMatchObject({ company_id: CO.uae, code: before.code, serial_number: "SN-X-A", item_id: item, ownership: "owned", custody_kind: "warehouse", location_id: L.riyadh, transfer_id: null });
    await call(U.ksaOp, `inv_transfer_receive('${CO.ksa}', '${trQty}', '${key()}')`);
    expect((await admin<Row>(`select company_id from inv_balances where item_id = '${cable}' and location_id = '${L.riyadh}'`)).map((b) => b.company_id)).toEqual([CO.uae]);
    expect(await q(U.ksaOp, `select 1 from inv_costs`)).toHaveLength(0);
  });

  it("after receipt: the unit is theirs to handle and available there only now; availability matches; the Dubai side no longer shows it", async () => {
    const rows = await units(U.ksaOp);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: codeA, custody_kind: "warehouse", location_id: L.riyadh, usable_here: true, transfer_id: null, owner_company_id: CO.uae });
    expect((await q<{ a: Row }>(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}') a`))[0]!.a).toEqual({ physical_at_location: 1, usable_now: 1, in_transit: 0 });
    // a held (needs inspection) unit would not count as usable: receive D at Jeddah with a condition that holds it
    await call<Row>(U.ksaJeddahOp, `inv_transfer_receive('${CO.ksa}', '${trD}', '${key()}', ${j([{ unit_id: UN.d, condition: "needs_inspection" }])})`);
    expect((await q<{ a: Row }>(U.ksaJeddahOp, `select inv_xshare_availability('${item}', '${L.jeddah}') a`))[0]!.a).toEqual({ physical_at_location: 1, usable_now: 0, in_transit: 0 });
    expect((await units(U.ksaJeddahOp))[0]).toMatchObject({ condition: "needs_inspection", usable_here: false });
  });

  it("trace: the OWNER and the RECEIVER read the same transfer through dispatch and receipt (the receipt is filed under the receiving company)", async () => {
    const owner = await trace(U.uaeOp, trA);
    const receiver = await trace(U.ksaOp, trA);
    expect(receiver).toEqual(owner);
    expect(owner.transfer).toMatchObject({ status: "received", received_by_name: null }); // names come from profiles, empty in the test database
    expect(owner.events.map((e: Row) => [e.kind, e.filed_under_company_name])).toEqual([["transfer_dispatch", "Enginious UAE"], ["transfer_receive", "Enginious KSA"]]);
    expect(owner.events[1].lines).toEqual([expect.objectContaining({ code: codeA, condition_from: "good", condition_to: "good" })]);
    expect(owner.units[0]).toMatchObject({ code: codeA, serial_number: "SN-X-A", owner_company_id: CO.uae, at_destination: true, on_the_way: false });
    // both list it; the founder of the owner too; the sender's other staff of the owner side as well
    expect((await transfers(U.uaeFounder)).map((t) => t.transfer_id)).toContain(trA);
    expect((await transfers(U.ksaOp)).find((t) => t.transfer_id === trA)).toMatchObject({ status: "received", still_on_the_way: 0, line_count: 1 });
    // the owner's own history of the unit still lacks the receipt in the base table (unchanged): the trace is where it is read
    expect((await q(U.uaeOp, `select m.kind from inv_movements m join inv_movement_lines l on l.movement_id = m.id where l.unit_id = '${UN.a}' and m.kind = 'transfer_receive'`))).toHaveLength(0);
    // a counted-stock line is traced to both sides as well
    expect(await trace(U.ksaOp, trQty)).toEqual(await trace(U.uaeOp, trQty));
  });

  it("a person cannot trace a transfer they are not part of: another owner-side outsider, a viewer without the owner's grant", async () => {
    for (const who of [U.qatOp, U.omanFounder, U.outsider, U.ksaViewer]) await expect(trace(who, trA)).rejects.toThrow(/Transfer not found/);
  });

  it("revoked authorisation ends the access at once (the owner keeps its own view); authorising again restores it", async () => {
    await commit(U.uaeFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', false)`);
    expect(await units(U.ksaOp)).toHaveLength(0);
    expect(await transfers(U.ksaOp)).toHaveLength(0);
    await expect(trace(U.ksaOp, trA)).rejects.toThrow(/Transfer not found/);
    await expect(q(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}')`)).resolves.toEqual([{ inv_xshare_availability: { physical_at_location: 0, usable_now: 0, in_transit: 0 } }]);
    expect(await q(U.uaeOp, `select * from inv_xshare_destinations()`)).toHaveLength(0);
    expect((await trace(U.uaeOp, trA)).events).toHaveLength(2);
    await commit(U.uaeFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', true, 'again')`);
    expect(await units(U.ksaOp)).toHaveLength(1);
  });

  it("an inactive person gets nothing, and a removed warehouse assignment ends the access", async () => {
    await admin(`update profiles set is_active = false where id = '${U.ksaGone}'`);
    expect(await units(U.ksaGone)).toHaveLength(0);
    expect(await transfers(U.ksaGone)).toHaveLength(0);
    await expect(trace(U.ksaGone, trA)).rejects.toThrow(/Transfer not found/);
    await admin(`update profiles set is_active = true where id = '${U.ksaGone}'`);
    expect(await units(U.ksaGone)).toHaveLength(1);
    await commit(U.ksaFounder, `select inv_set_operator_locations('${CO.ksa}', '${U.ksaGone}', '{${L.jeddah}}')`);
    expect(await codes(U.ksaGone)).toEqual([(await unit(UN.d!)).code]);
  });

  it("existing owner-side behaviour is unchanged: the owner still reads its own units, its transfers and costs; nothing changed owner or code", async () => {
    expect((await q(U.uaeFounder, `select 1 from inv_units where id = '${UN.a}'`))).toHaveLength(1);
    expect((await q(U.uaeFounder, `select 1 from inv_transfers where id = '${trA}'`))).toHaveLength(1);
    expect((await q(U.uaeFounder, `select unit_cost from inv_costs where unit_id = '${UN.a}'`))).toHaveLength(1);
    expect((await admin<Row>(`select count(*)::int n from inv_units where id in ('${UN.a}', '${UN.d}') and company_id = '${CO.uae}'`))[0]!.n).toBe(2);
  });
});
