import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Where a unit PHYSICALLY is versus who OWNS it. Reproduces, against a real Postgres built from every migration, what the existing
// Send transfer -> In transit -> Receive transfer process does when UAE-owned equipment goes from the UAE Dubai warehouse to a warehouse
// of ANOTHER company (KSA, Riyadh), and what each side can read afterwards:
//   * the permanent code, serial number and owning company never change; availability leaves Dubai at send and starts in Riyadh only at receipt;
//   * cross-company transfer needs the OWNER's founder to authorise sharing first (unchanged by this work);
//   * the receiving company's people cannot read the unit or the transfer (rows are filed under the OWNER): reported, NOT widened here.
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { uaeFounder: id(), ksaFounder: id(), uaeOp: id(), ksaOp: id(), ksaViewer: id(), outsider: id() };
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const fut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Inventory: physical location versus ownership across companies", () => {
  const db = new RlsTestDatabase();
  const q = async <T = Row>(user: string | null, sql: string) => (await db.asUser(user, async (query) => (await query(sql)).rows)) as T[];
  const commit = async <T = Row>(user: string, sql: string) => (await db.asUserCommit(user, async (query) => (await query(sql)).rows)) as T[];
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const call = async <T = Row>(user: string, sql: string): Promise<T> => (await commit<{ r: T }>(user, `select ${sql} as r`))[0]!.r;
  const key = () => `key-${id()}`;
  const L: Record<string, string> = {};
  let item = ""; let unitId = ""; let unitCode = ""; let transferId = ""; let sendMovement = ""; let receiveMovement = "";
  const unit = async () => (await admin<Row>(`select * from inv_units where id = '${unitId}'`))[0]!;
  const freeAt = async (loc: string) => (await admin<Row>(`select inv_unit_usable(u) and u.location_id = '${loc}' as usable_here from inv_units u where id = '${unitId}'`))[0]!.usable_here as boolean;
  const avail = async (loc: string, who = U.uaeFounder) => (await q<Row>(who, `select inv_availability('${item}', '${loc}', now(), now() + interval '1 hour') a`))[0]!.a as Row;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Enginious UAE', 'AE', 'AED'), ('${CO.ksa}', 'Enginious KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@loc-test.ae')`).join(", ")};
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.uaeFounder}', '${CO.uae}', '{founder}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}');
    `);
    await commit(U.uaeFounder, `select inv_set_company_code('${CO.uae}', 'UAE')`);
    await commit(U.ksaFounder, `select inv_set_company_code('${CO.ksa}', 'KSA')`);
    await commit(U.uaeFounder, `select inv_grant_access('${U.uaeOp}', '${CO.uae}', '{warehouse}'::text[])`);
    await commit(U.ksaFounder, `select inv_grant_access('${U.ksaOp}', '${CO.ksa}', '{warehouse}'::text[])`);
    await commit(U.ksaFounder, `select inv_grant_access('${U.ksaViewer}', '${CO.ksa}', '{view_stock}'::text[])`);
    L.dubai = await call<string>(U.uaeFounder, `inv_save_location('${CO.uae}', null, 'DXB', 'Dubai warehouse', 'Asia/Dubai')`);
    L.abudhabi = await call<string>(U.uaeFounder, `inv_save_location('${CO.uae}', null, 'AUH', 'Abu Dhabi warehouse', 'Asia/Dubai')`);
    L.riyadh = await call<string>(U.ksaFounder, `inv_save_location('${CO.ksa}', null, 'RUH', 'Riyadh warehouse', 'Asia/Riyadh')`);
    await commit(U.uaeFounder, `select inv_set_operator_locations('${CO.uae}', '${U.uaeOp}', '{${L.dubai}}')`);
    await commit(U.ksaFounder, `select inv_set_operator_locations('${CO.ksa}', '${U.ksaOp}', '{${L.riyadh}}')`);
    item = await call<string>(U.uaeFounder, `inv_save_item('${CO.uae}', null, ${j({ name: "LED panel P2.5", tracking: "individual", status: "active" })})`);
    const r = await call<Row>(U.uaeOp, `inv_register_unit(p_company_id => '${CO.uae}', p_item_id => '${item}', p_serial_number => 'SN-LOC-1', p_location_id => '${L.dubai}')`);
    unitId = r.unit_id;
    const c = (await call<Row>(U.uaeOp, `inv_start_count('${CO.uae}', '${L.dubai}', 'opening')`)).count_id;
    await commit(U.uaeOp, `select inv_save_count_line('${c}', 1, p_unit_id => '${unitId}')`);
    await call(U.uaeFounder, `inv_confirm_count('${CO.uae}', '${c}', '${key()}')`);
    unitCode = (await unit()).code;
  }, 180_000);
  afterAll(async () => { await db.teardown(); });

  it("refuses a send to another company's warehouse until the OWNER's founder authorises sharing (existing rule, unchanged)", async () => {
    await expect(call(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.riyadh}', '${key()}', ${j([{ unit_id: unitId }])}, '${fut(3)}')`)).rejects.toThrow(/belongs to another company.*authorise sharing/);
    expect((await unit()).custody_kind).toBe("warehouse");
    await expect(commit(U.ksaFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', true)`)).rejects.toThrow(/Only a founder of the company that owns/);
    await commit(U.uaeFounder, `select inv_set_company_sharing('${CO.uae}', '${CO.ksa}', true, 'LED walls for the Riyadh show')`);
  });

  it("send: the unit leaves Dubai at once (not available in Dubai, not yet in Riyadh), keeps its code, serial and owner", async () => {
    expect(await freeAt(L.dubai!)).toBe(true);
    const r = await call<Row>(U.uaeOp, `inv_transfer_dispatch('${CO.uae}', '${L.dubai}', '${L.riyadh}', '${key()}', ${j([{ unit_id: unitId }])}, '${fut(3)}', 'DHL', 'WB-9')`);
    transferId = r.transfer_id; sendMovement = r.movement_id;
    expect(await unit()).toMatchObject({ company_id: CO.uae, code: unitCode, serial_number: "SN-LOC-1", custody_kind: "transit", transfer_id: transferId });
    expect(await freeAt(L.dubai!)).toBe(false);
    expect(await freeAt(L.riyadh!)).toBe(false);
    // Today's own availability function: for the OWNER's item it only answers for the OWNER's locations.
    expect(await avail(L.dubai!)).toMatchObject({ usable_now: 0, in_transit: 1 });
    await expect(avail(L.riyadh!)).rejects.toThrow(/Location not found/);
  });

  it("in transit: the receiving company's people cannot read the unit or the transfer (rows are filed under the OWNER)", async () => {
    for (const who of [U.ksaOp, U.ksaViewer, U.ksaFounder]) {
      expect(await q(who, `select 1 from inv_units where id = '${unitId}'`)).toHaveLength(0);
      expect(await q(who, `select 1 from inv_transfers where id = '${transferId}'`)).toHaveLength(0);
    }
    expect(await q(U.uaeOp, `select 1 from inv_transfers where id = '${transferId}'`)).toHaveLength(1);
    // ... and the owner cannot name the destination: the Riyadh location row belongs to KSA
    expect(await q(U.uaeOp, `select 1 from inv_locations where id = '${L.riyadh}'`)).toHaveLength(0);
  });

  it("receive: only someone who works at the DESTINATION can, naming the destination's company; the owner's staff cannot receive in Riyadh", async () => {
    await expect(call(U.uaeOp, `inv_transfer_receive('${CO.uae}', '${transferId}', '${key()}')`)).rejects.toThrow(/Unknown location/);
    await expect(call(U.uaeFounder, `inv_transfer_receive('${CO.uae}', '${transferId}', '${key()}')`)).rejects.toThrow(/Unknown location/);
    await expect(call(U.ksaViewer, `inv_transfer_receive('${CO.ksa}', '${transferId}', '${key()}')`)).rejects.toThrow(/not set up to work at this location/);
    const r = await call<Row>(U.ksaOp, `inv_transfer_receive('${CO.ksa}', '${transferId}', '${key()}')`);
    receiveMovement = r.movement_id;
    expect(r).toMatchObject({ status: "received", still_on_the_way: 0 });
  });

  it("after receipt: physically in Riyadh, available there (condition permitting), gone from Dubai, SAME code, serial and owner", async () => {
    expect(await unit()).toMatchObject({ company_id: CO.uae, code: unitCode, serial_number: "SN-LOC-1", custody_kind: "warehouse", location_id: L.riyadh, transfer_id: null });
    expect(await freeAt(L.riyadh!)).toBe(true);
    expect(await freeAt(L.dubai!)).toBe(false);
    expect(await avail(L.dubai!)).toMatchObject({ usable_now: 0, physical_at_location: 0 });
    const lines = await admin<Row>(`select m.company_id, m.kind, l.from_location_id, l.to_location_id from inv_movement_lines l join inv_movements m on m.id = l.movement_id where l.unit_id = '${unitId}' and m.kind like 'transfer\\_%' order by m.recorded_at`);
    expect(lines).toEqual([
      { company_id: CO.uae, kind: "transfer_dispatch", from_location_id: L.dubai, to_location_id: L.riyadh },
      { company_id: CO.ksa, kind: "transfer_receive", from_location_id: L.dubai, to_location_id: L.riyadh },
    ]);
  });

  it("who can read what now: the owner reads the unit but cannot name its place; the KSA warehouse still cannot read the unit (rows follow the owner)", async () => {
    const own = await q<Row>(U.uaeFounder, `select code, company_id, location_id, custody_kind from inv_units where id = '${unitId}'`);
    expect(own).toEqual([{ code: unitCode, company_id: CO.uae, location_id: L.riyadh, custody_kind: "warehouse" }]);
    expect(await q(U.uaeFounder, `select 1 from inv_locations where id = '${L.riyadh}'`)).toHaveLength(0);
    for (const who of [U.ksaOp, U.ksaViewer, U.ksaFounder]) expect(await q(who, `select 1 from inv_units where id = '${unitId}'`)).toHaveLength(0);
    // the owner's unit history lacks the receipt, which is filed under the receiving company
    const hist = await q<Row>(U.uaeFounder, `select m.kind from inv_movements m join inv_movement_lines l on l.movement_id = m.id where l.unit_id = '${unitId}' and m.kind like 'transfer\\_%'`);
    expect(hist.map((h) => h.kind)).toEqual(["transfer_dispatch"]);
    expect(sendMovement).toBeTruthy(); expect(receiveMovement).toBeTruthy();
  });
});
