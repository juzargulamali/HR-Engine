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

const UNIT_FIELDS = ["bin_code", "bin_id", "category_name", "code", "condition", "custody_kind", "item_id", "item_name", "location_company_id", "location_id", "location_name", "owner_company_id", "owner_company_name", "ownership", "serial_number", "sharing_revoked", "transfer_code", "transfer_id", "unit_id", "usable_here"];
const COUNTED_FIELDS = ["bin_code", "bin_id", "category_name", "condition", "custody_kind", "item_id", "item_name", "location_company_id", "location_id", "location_name", "owner_company_id", "owner_company_name", "qty", "rented", "sharing_revoked", "transfer_code", "transfer_id", "unit_of_measure"];
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
  let item = ""; let cable = ""; let trA = ""; let trD = ""; let trQty = ""; let trQty2 = ""; let trRev = ""; let codeA = "";
  const unit = async (uid: string) => (await admin<Row>(`select * from inv_units where id = '${uid}'`))[0]!;
  const units = (who: string | null, args = "") => q<Row>(who, `select * from inv_xshare_units(${args})`);
  const transfers = (who: string | null) => q<Row>(who, `select * from inv_xshare_transfers()`);
  const trace = async (who: string | null, tid: string) => (await q<{ t: Row }>(who, `select inv_xshare_transfer_trace('${tid}') t`))[0]!.t;
  const codes = async (who: string | null, args = "") => (await units(who, args)).map((r) => r.code).sort();
  const counted = (who: string | null, args = "") => q<Row>(who, `select * from inv_xshare_counted_stock(${args})`);
  // the cable balances as the database holds them (admin view): [holder, location name or transfer, qty], and the whole trace without the viewer-dependent flag
  const cableBalances = async () => (await admin<Row>(`select b.holder_kind, b.qty::float qty, l.name loc, b.company_id from inv_balances b left join inv_locations l on l.id = b.location_id where b.item_id = '${cable}' and b.qty > 0 order by b.holder_kind, l.name`));
  const noFlag = (t: Row) => ({ ...t, transfer: { ...t.transfer, sharing_revoked: undefined } });

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

  it("counted stock, sent: the source quantity drops at dispatch, the 4 are in transit (owner unchanged) and nothing is at the destination until receipt", async () => {
    expect(await cableBalances()).toEqual([
      expect.objectContaining({ holder_kind: "transit", qty: 4, company_id: CO.uae }),
      expect.objectContaining({ holder_kind: "warehouse", qty: 6, loc: "Dubai warehouse", company_id: CO.uae })]);
    // the receiving operator reads nothing of it from the stock table, yet sees the 4 on the way (item, owner, quantity, the transfer; no cost field)
    expect(await q(U.ksaOp, `select 1 from inv_balances`)).toHaveLength(0);
    const c = await counted(U.ksaOp);
    expect(c).toHaveLength(1);
    expect(Object.keys(c[0]!).sort()).toEqual(COUNTED_FIELDS);
    expect(Object.keys(c[0]!).filter((k) => FORBIDDEN.test(k.replace(/^transfer_code$/, "")))).toEqual([]);
    expect(c[0]).toMatchObject({ item_id: cable, item_name: "HDMI cable 5 m", qty: "4.000", custody_kind: "transit", owner_company_id: CO.uae, owner_company_name: "Enginious UAE",
      location_id: L.riyadh, location_name: "Riyadh warehouse", location_company_id: CO.ksa, transfer_id: trQty, bin_id: null, rented: false, sharing_revoked: false });
    // the sending side's Dubai shelf is not "at the receiver's warehouse", and the other warehouse's operator sees none of it
    expect(await counted(U.ksaJeddahOp)).toHaveLength(0);
    expect(await counted(U.uaeOp)).toHaveLength(0); // the owner's own people read their stock through the existing screens, not this function
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
      expect(await counted(who)).toHaveLength(0);
      await expect(trace(who, trA)).rejects.toThrow(/Transfer not found/);
      await expect(q(who, `select inv_xshare_availability('${item}', '${L.riyadh}')`)).rejects.toThrow(/Location not found/);
    }
    for (const sql of [`select * from inv_xshare_units()`, `select * from inv_xshare_counted_stock()`, `select * from inv_xshare_transfers()`, `select inv_xshare_transfer_trace('${trA}')`, `select inv_xshare_availability('${item}', '${L.riyadh}')`,
                       `select inv_xshare_may_handle('${CO.uae}', '${L.riyadh}')`, `select inv_xshare_sees('${CO.uae}', '${L.dubai}', '${L.riyadh}')`, `select inv_xshare_active('${CO.uae}', '${CO.ksa}')`,
                       `select inv_xshare_revoked('${CO.uae}', '${CO.ksa}')`, `select inv_xshare_transfer_revoked('${trA}')`]) {
      await expect(q(null, sql)).rejects.toThrow(/permission denied/);
    }
    // the internal helpers are not callable by a signed-in person either
    for (const fn of [`inv_xshare_may_handle('${CO.uae}', '${L.riyadh}')`, `inv_xshare_revoked('${CO.uae}', '${CO.ksa}')`, `inv_xshare_transfer_revoked('${trA}')`, `inv_xshare_active('${CO.uae}', '${CO.ksa}')`]) {
      await expect(q(U.ksaOp, `select ${fn}`)).rejects.toThrow(/permission denied/);
    }
    // the Jeddah operator holds a sharing-authorised role but not at Riyadh
    await expect(q(U.ksaJeddahOp, `select inv_xshare_availability('${item}', '${L.riyadh}')`)).rejects.toThrow(/Location not found/);
    await expect(trace(U.ksaJeddahOp, trA)).rejects.toThrow(/Transfer not found/);
  });

  it("availability at the destination: nothing usable before receipt (one incoming), the owner's other stock is never counted", async () => {
    const a = (await q<{ a: Row }>(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}') a`))[0]!.a;
    expect(a).toEqual({ physical_at_location: 0, usable_now: 0, in_transit: 1, sharing_revoked: false });
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
    expect(rows[0]).toMatchObject({ code: codeA, custody_kind: "warehouse", location_id: L.riyadh, usable_here: true, transfer_id: null, owner_company_id: CO.uae, sharing_revoked: false });
    expect((await q<{ a: Row }>(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}') a`))[0]!.a).toEqual({ physical_at_location: 1, usable_now: 1, in_transit: 0, sharing_revoked: false });
    // a held (needs inspection) unit would not count as usable: receive D at Jeddah with a condition that holds it
    await call<Row>(U.ksaJeddahOp, `inv_transfer_receive('${CO.ksa}', '${trD}', '${key()}', ${j([{ unit_id: UN.d, condition: "needs_inspection" }])})`);
    expect((await q<{ a: Row }>(U.ksaJeddahOp, `select inv_xshare_availability('${item}', '${L.jeddah}') a`))[0]!.a).toEqual({ physical_at_location: 1, usable_now: 0, in_transit: 0, sharing_revoked: false });
    expect((await units(U.ksaJeddahOp))[0]).toMatchObject({ condition: "needs_inspection", usable_here: false });
  });

  it("counted stock, received: the 4 cables are at the Riyadh shelf with OWNER and PLACE apart; source stays at 6; identity and owner unchanged; no cost", async () => {
    expect(await cableBalances()).toEqual([expect.objectContaining({ holder_kind: "warehouse", qty: 6, loc: "Dubai warehouse", company_id: CO.uae }), expect.objectContaining({ holder_kind: "warehouse", qty: 4, loc: "Riyadh warehouse", company_id: CO.uae })]);
    const c = await counted(U.ksaOp);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ item_id: cable, item_name: "HDMI cable 5 m", qty: "4.000", custody_kind: "warehouse", condition: "good", owner_company_id: CO.uae, owner_company_name: "Enginious UAE",
      location_id: L.riyadh, location_name: "Riyadh warehouse", location_company_id: CO.ksa, transfer_id: null, sharing_revoked: false });
    expect(await counted(U.ksaOp, `'${L.riyadh}'`)).toHaveLength(1);
    expect(await counted(U.ksaOp, `'${L.jeddah}'`)).toHaveLength(0); // a warehouse the person does not operate shows nothing of it
    // the item itself is the owner's, unchanged, and the trace says 4 sent, none on the way
    expect((await admin<Row>(`select company_id, name, tracking from inv_items where id = '${cable}'`))[0]).toMatchObject({ company_id: CO.uae, name: "HDMI cable 5 m", tracking: "quantity" });
    expect((await trace(U.ksaOp, trQty)).quantities).toEqual([expect.objectContaining({ qty_sent: 4, qty_on_the_way: 0, owner_company_name: "Enginious UAE" })]);
    expect(await q(U.ksaOp, `select 1 from inv_balances`)).toHaveLength(0);
    expect(JSON.stringify(c).toLowerCase()).not.toMatch(/1234|unit_cost|supplier|purchase|email/);
  });

  it("counted stock, partial receipt (existing rule): 5 sent, 2 received, 3 stay on the way and the transfer stays open; the rest arrives later; quantities exact", async () => {
    trQty2 = (await call<Row>(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.riyadh}', '${key()}', ${j([{ item_id: cable, qty: 5 }])}, '${fut(3)}')`)).transfer_id;
    expect((await cableBalances()).map((b) => [b.holder_kind, b.loc ?? null, b.qty])).toEqual([["transit", null, 5], ["warehouse", "Dubai warehouse", 1], ["warehouse", "Riyadh warehouse", 4]]);
    expect((await counted(U.ksaOp)).map((r) => [r.custody_kind, r.qty]).sort()).toEqual([["transit", "5.000"], ["warehouse", "4.000"]]);
    const r = await call<Row>(U.ksaOp, `inv_transfer_receive('${CO.ksa}', '${trQty2}', '${key()}', ${j([{ item_id: cable, qty: 2 }])})`);
    expect(r).toMatchObject({ status: "in_transit", still_on_the_way: 1 });
    const mid = await counted(U.ksaOp);
    expect(Object.fromEntries(mid.map((x) => [x.custody_kind, x.qty]))).toEqual({ transit: "3.000", warehouse: "6.000" });
    expect(mid.find((x) => x.custody_kind === "transit")).toMatchObject({ transfer_id: trQty2, owner_company_name: "Enginious UAE" });
    expect((await trace(U.ksaOp, trQty2)).quantities).toEqual([expect.objectContaining({ qty_sent: 5, qty_on_the_way: 3 })]);
    expect((await trace(U.ksaOp, trQty2)).transfer.status).toBe("in_transit");
    await call(U.ksaOp, `inv_transfer_receive('${CO.ksa}', '${trQty2}', '${key()}')`);
    expect((await counted(U.ksaOp)).map((x) => [x.custody_kind, x.qty])).toEqual([["warehouse", "9.000"]]);
    expect((await cableBalances()).map((b) => [b.loc, b.qty])).toEqual([["Dubai warehouse", 1], ["Riyadh warehouse", 9]]);
    expect(await trace(U.ksaOp, trQty2)).toEqual(await trace(U.uaeOp, trQty2));
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

  it("sharing revoked while a transfer is in transit: the receiver keeps what it needs to receive it, can receive it, and keeps tracking it on its shelf", async () => {
    // dispatch unit B and the last cable while the sharing is still active
    trRev = (await call<Row>(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.riyadh}', '${key()}', ${j([{ unit_id: UN.b }, { item_id: cable, qty: 1 }])}, '${fut(3)}')`)).transfer_id;
    const codeB = (await unit(UN.b!)).code;
    expect((await transfers(U.ksaOp)).find((t) => t.transfer_id === trRev)).toMatchObject({ status: "in_transit", sharing_revoked: false });
    await commit(U.uaeFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', false)`);

    // still there for the receiver, minimum fields only, with the flag from the database; its own unit on the shelf too; nothing else of the owner
    const rows = await units(U.ksaOp);
    expect(rows.map((r) => r.code).sort()).toEqual([codeA, codeB].sort());
    expect(rows.every((r) => r.sharing_revoked === true && r.usable_here === false && r.owner_company_id === CO.uae)).toBe(true);
    expect(rows.every((r) => Object.keys(r).sort().join() === UNIT_FIELDS.join())).toBe(true);
    expect(rows.find((r) => r.code === codeB)).toMatchObject({ custody_kind: "transit", transfer_id: trRev, location_id: L.riyadh });
    expect(rows.find((r) => r.code === codeA)).toMatchObject({ custody_kind: "warehouse", location_id: L.riyadh, condition: "good" });
    expect(await codes(U.ksaOp, `null, '${codeB}'`)).toEqual([codeB]);
    expect(await codes(U.ksaOp, `null, '${(await unit(UN.c!)).code}'`)).toEqual([]); // the owner's Abu Dhabi unit is nothing of theirs
    const heads = await transfers(U.ksaOp);
    expect(heads.map((t) => t.transfer_id).sort()).toEqual([trA, trQty, trQty2, trRev].sort());
    expect(heads.every((t) => t.sharing_revoked === true)).toBe(true);
    const cs = await counted(U.ksaOp);
    expect(cs.map((x) => [x.custody_kind, x.qty, x.sharing_revoked]).sort()).toEqual([["transit", "1.000", true], ["warehouse", "9.000", true]]);
    expect((await q<{ a: Row }>(U.ksaOp, `select inv_xshare_availability('${item}', '${L.riyadh}') a`))[0]!.a).toEqual({ physical_at_location: 1, usable_now: 0, in_transit: 1, sharing_revoked: true });
    const tr = await trace(U.ksaOp, trRev);
    expect(tr.transfer).toMatchObject({ status: "in_transit", sharing_revoked: true, to_location_name: "Riyadh warehouse" });
    expect(tr.units).toEqual([expect.objectContaining({ code: codeB, on_the_way: true })]);
    expect(tr.quantities).toEqual([expect.objectContaining({ qty_sent: 1, qty_on_the_way: 1 })]);
    for (const bad of ["1234", "unit_cost", "currency", "supplier", "purchase", "email"]) expect(JSON.stringify(tr).toLowerCase()).not.toContain(bad);
    await expect(trace(U.ksaOp, trD)).rejects.toThrow(/Transfer not found/); // not dispatched to their warehouse
    // base tables are still closed to them
    for (const sql of [`select 1 from inv_units`, `select 1 from inv_balances`, `select 1 from inv_transfers`, `select 1 from inv_costs`, `select 1 from inv_company_sharing`]) expect(await q(U.ksaOp, sql)).toHaveLength(0);

    // receipt is not blocked: the existing function, unchanged, receives what was dispatched
    const r = await call<Row>(U.ksaOp, `inv_transfer_receive('${CO.ksa}', '${trRev}', '${key()}')`);
    expect(r).toMatchObject({ status: "received", still_on_the_way: 0 });
    expect(await unit(UN.b!)).toMatchObject({ company_id: CO.uae, code: codeB, serial_number: "SN-X-B", custody_kind: "warehouse", location_id: L.riyadh });
    // after receipt: the unit and the cables are on their shelf, owner unchanged, flagged, not usable until the owner authorises again
    expect((await units(U.ksaOp)).map((x) => [x.code, x.custody_kind, x.sharing_revoked, x.usable_here]).sort()).toEqual([[codeA, "warehouse", true, false], [codeB, "warehouse", true, false]].sort());
    expect((await counted(U.ksaOp)).map((x) => [x.custody_kind, x.qty, x.owner_company_name, x.location_name, x.sharing_revoked])).toEqual([["warehouse", "10.000", "Enginious UAE", "Riyadh warehouse", true]]);
    expect((await cableBalances()).map((b) => [b.loc, b.qty])).toEqual([["Riyadh warehouse", 10]]);
    // the owner side keeps the identical trace of every transfer, with no flag for the owner
    for (const t of [trA, trQty, trQty2, trRev]) {
      const owner = await trace(U.uaeOp, t);
      const receiver = await trace(U.ksaOp, t);
      expect(noFlag(receiver)).toEqual(noFlag(owner));
      expect(owner.transfer.sharing_revoked).toBe(false);
      expect(receiver.transfer.sharing_revoked).toBe(true);
    }
    expect((await trace(U.uaeOp, trRev)).events.map((e: Row) => [e.kind, e.filed_under_company_name])).toEqual([["transfer_dispatch", "Enginious UAE"], ["transfer_receive", "Enginious KSA"]]);
    expect((await transfers(U.uaeFounder)).map((t) => t.transfer_id)).toEqual(expect.arrayContaining([trA, trQty, trQty2, trRev]));
    expect((await transfers(U.uaeFounder)).every((t) => t.sharing_revoked === false)).toBe(true);
  });

  it("revocation still stops NEW cross-company dispatches and removes the revoked company's warehouses from the Send form", async () => {
    expect(await q(U.uaeOp, `select * from inv_xshare_destinations()`)).toHaveLength(0);
    await expect(call(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.auh}', '${L.riyadh}', '${key()}', ${j([{ unit_id: UN.c }])}, '${fut(3)}')`)).rejects.toThrow(/authorise sharing/);
    await call(U.uaeOp, `inv_receive_stock('${CO.uae}', '${L.dubai}', '${key()}', ${j([{ item_id: cable, qty: 2 }])})`);
    await expect(call(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.jeddah}', '${key()}', ${j([{ item_id: cable, qty: 1 }])}, '${fut(3)}')`)).rejects.toThrow(/authorise sharing/);
    expect((await unit(UN.c!)).custody_kind).toBe("warehouse");
    expect((await cableBalances()).map((b) => [b.loc, b.qty])).toEqual([["Dubai warehouse", 2], ["Riyadh warehouse", 10]]);
  });

  it("while revoked, everyone else still gets nothing: viewer, third companies, a company that never had sharing, an outsider, signed-out", async () => {
    for (const who of [U.ksaViewer, U.qatOp, U.qatFounder, U.omanOp, U.omanFounder, U.outsider]) {
      expect(await units(who)).toHaveLength(0);
      expect(await counted(who)).toHaveLength(0);
      expect(await transfers(who)).toHaveLength(0);
      for (const t of [trA, trRev, trQty2]) await expect(trace(who, t)).rejects.toThrow(/Transfer not found/);
    }
    // the Jeddah operator works at another warehouse: unit D was received there earlier and is still theirs to see, nothing that went to Riyadh
    expect(await codes(U.ksaJeddahOp)).toEqual([(await unit(UN.d!)).code]);
    expect(await counted(U.ksaJeddahOp)).toHaveLength(0);
    await expect(trace(U.ksaJeddahOp, trRev)).rejects.toThrow(/Transfer not found/);
    for (const sql of [`select * from inv_xshare_units()`, `select * from inv_xshare_counted_stock()`, `select * from inv_xshare_transfers()`, `select inv_xshare_transfer_trace('${trRev}')`]) {
      await expect(q(null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it("authorising again clears the flag and lets the equipment be used at the warehouse once more", async () => {
    await commit(U.uaeFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', true, 'again')`);
    const rows = await units(U.ksaOp);
    expect(rows.map((r) => r.code).sort()).toEqual([codeA, (await unit(UN.b!)).code].sort());
    expect(rows.every((r) => r.sharing_revoked === false && r.usable_here === true)).toBe(true);
    expect((await counted(U.ksaOp)).map((x) => x.sharing_revoked)).toEqual([false]);
    expect((await transfers(U.ksaOp)).every((t) => t.sharing_revoked === false)).toBe(true);
    expect((await trace(U.ksaOp, trRev)).transfer.sharing_revoked).toBe(false);
    expect((await q(U.uaeOp, `select * from inv_xshare_destinations()`)).map((d) => d.location_name).sort()).toEqual(["Jeddah warehouse", "Riyadh warehouse"]);
  });

  it("an inactive person gets nothing, and a removed warehouse assignment ends the access", async () => {
    await admin(`update profiles set is_active = false where id = '${U.ksaGone}'`);
    expect(await units(U.ksaGone)).toHaveLength(0);
    expect(await transfers(U.ksaGone)).toHaveLength(0);
    await expect(trace(U.ksaGone, trA)).rejects.toThrow(/Transfer not found/);
    expect(await counted(U.ksaGone)).toHaveLength(0);
    await admin(`update profiles set is_active = true where id = '${U.ksaGone}'`);
    expect(await units(U.ksaGone)).toHaveLength(2);
    expect(await counted(U.ksaGone)).toHaveLength(1);
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
