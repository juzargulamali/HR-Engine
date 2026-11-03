import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Launch package 3a (C1, C2, C7): dispatch notes and return checklists. A note is a frozen, numbered copy of what the warehouse recorded; the PM's
// acknowledgement and any dispute are separate append-only records beside the ledger. Nothing here may move stock, change availability, custody or reservations,
// or rewrite history. Creation happens INSIDE the movement transaction behind a per-company switch that is OFF by default.

const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = {
  founder: id(), wh: id(), whPoz: id(), whB: id(), pm: id(), newPm: id(), acting: id(), expired: id(), member: id(), projFounder: id(), invFounder: id(), viewer: id(),
  outsider: id(), pmB: id(),
};
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-notes.ae')`).join(", ");
const DENIED = /permission denied|row-level security|Only |not set up|do not have|cannot|not allowed|You need|not signed in/i;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const key = () => `key-${id()}`;
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const EXPECTED = iso(5);   // one value for the whole file, so a retried call carries identical content

describe("Dispatch notes and return checklists (C1, C2, C7)", () => {
  const db = new RlsTestDatabase();
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const fails = (user: string | null, sql: string, re: RegExp = DENIED) => expect(q(user, sql)).rejects.toThrow(re);
  const count = async (sql: string) => Number((await admin<{ n: string }>(`select count(*) n from (${sql}) x`))[0]!.n);

  let LOC = "", LOC2 = "", BIN_A = "", BIN_B = "", P1 = "", PB = "";
  const IT: Record<string, string> = {};
  const UN: string[] = [];
  let seq = 0;

  const dispatch = (user: string, lines: unknown[], k = key(), project = P1, loc = LOC, company = CO.a) =>
    call<Row>(user, `inv_dispatch_to_project('${company}', '${loc}', '${project}', '${k}', ${j(lines)}, null, '${EXPECTED}')`);
  const giveBack = (user: string, lines: unknown[], k = key(), project = P1, loc = LOC, company = CO.a) =>
    call<Row>(user, `inv_return_from_project('${company}', '${loc}', '${project}', '${k}', ${j(lines)})`);
  const note = async (noteId: string) => (await admin<Row>(`select * from inv_project_notes where id = '${noteId}'`))[0]!;
  const status = async (noteId: string) => (await admin<Row>(`select * from inv_project_note_status where note_id = '${noteId}'`))[0]!;
  const ack = (user: string, noteId: string, action = "acknowledge", extra = "null, null, null, null") => call<Row>(user, `inv_ack_project_note('${noteId}', '${action}', ${extra})`);
  const diff = (user: string, noteId: string, lines: number[], reason: string, comment: string | null = null, k: string | null = null) =>
    call<Row>(user, `inv_ack_project_note('${noteId}', 'report_difference', ${j(lines)}, ${comment ? `'${comment}'` : "null"}, '${reason}', ${k ? `'${k}'` : "null"})`);
  const resolve = (user: string, noteId: string, how: string, comment: string | null, movement: string | null = null, k: string | null = null) =>
    call<Row>(user, `inv_resolve_note_difference('${noteId}', '${how}', ${comment ? `'${comment}'` : "null"}, ${movement ? `'${movement}'` : "null"}, ${k ? `'${k}'` : "null"})`);
  const setSwitch = (on: boolean) => admin(`update inv_company_settings set project_notes_enabled = ${on} where company_id = '${CO.a}'`);
  const unitRow = async (u: string) => (await admin<Row>(`select custody_kind, condition, lifecycle, location_id, project_id from inv_units where id = '${u}'`))[0]!;
  /** A fingerprint of everything a note, an acknowledgement or a dispute must never touch. */
  const stockFingerprint = async () => (await admin<Row>(`select
      (select count(*) from inv_movements) movements, (select count(*) from inv_movement_lines) lines,
      (select md5(coalesce(string_agg(row(u.id, u.custody_kind, u.condition, u.lifecycle, u.location_id, u.project_id, u.version)::text, ',' order by u.id), '')) from inv_units u) units,
      (select md5(coalesce(string_agg(row(b.id, b.holder_kind, b.condition, b.qty, b.location_id, b.project_id)::text, ',' order by b.id), '')) from inv_balances b) balances,
      (select md5(coalesce(string_agg(row(r.id, r.qty, r.dispatched_qty, r.returned_qty, r.status)::text, ',' order by r.id), '')) from inv_reservations r) reservations,
      (select count(*) from inv_requests) requests`))[0]!;
  async function newUnits(n: number, item = IT.laptop!) {
    const serials = Array.from({ length: n }, () => `SN-${++seq}`);
    await call(U.founder, `inv_receive_stock('${CO.a}', '${LOC}', '${key()}', ${j([{ item_id: item, serials }])})`);
    const rows = await admin<{ id: string }>(`select id from inv_units where serial_number = any (array[${serials.map((s) => `'${s}'`).join(",")}]) order by serial_number`);
    rows.forEach((r) => UN.push(r.id));
    return rows.map((r) => r.id);
  }
  const moreCables = (n: number) => call(U.founder, `inv_receive_stock('${CO.a}', '${LOC}', '${key()}', ${j([{ item_id: IT.cable, qty: n, bin_id: BIN_A }])})`);
  async function noteFor(res: Row) { return note(String(res.note_id)); }

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Enginious UAE', 'AE', 'AED'), ('${CO.b}', 'Brand Co', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      update auth.users set raw_user_meta_data = '{}'::jsonb where false;
      insert into inv_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'BRD');
      insert into inv_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.a}', '{founder}'), ('${U.invFounder}', '${CO.a}', '{founder}'), ('${U.wh}', '${CO.a}', '{warehouse}'), ('${U.whPoz}', '${CO.a}', '{warehouse}'),
        ('${U.viewer}', '${CO.a}', '{view_stock}'), ('${U.whB}', '${CO.b}', '{warehouse}');
      insert into proj_company_settings (company_id, reference_code) values ('${CO.a}', 'UAE'), ('${CO.b}', 'BRD');
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.a}', '{founder}'), ('${U.projFounder}', '${CO.a}', '{founder}'), ('${U.pm}', '${CO.a}', '{}'), ('${U.newPm}', '${CO.a}', '{}'),
        ('${U.acting}', '${CO.a}', '{}'), ('${U.expired}', '${CO.a}', '{}'), ('${U.member}', '${CO.a}', '{}'), ('${U.pmB}', '${CO.b}', '{}');
      update profiles set full_name = 'Pat Manager' where id = '${U.pm}';
      update profiles set full_name = 'Wanda Warehouse' where id = '${U.wh}';
    `);
    await db.seed(`
      insert into inv_locations (company_id, code, name, timezone) values ('${CO.a}', 'DXB', 'Dubai warehouse', 'Asia/Dubai'), ('${CO.a}', 'POZ', 'Poznan warehouse', 'Europe/Warsaw');
    `);
    LOC = (await admin<{ id: string }>(`select id from inv_locations where code = 'DXB'`))[0]!.id;
    LOC2 = (await admin<{ id: string }>(`select id from inv_locations where code = 'POZ'`))[0]!.id;
    await db.seed(`
      insert into inv_operator_locations (company_id, user_id, location_id) values ('${CO.a}', '${U.wh}', '${LOC}'), ('${CO.a}', '${U.whPoz}', '${LOC2}');
      insert into inv_bins (company_id, location_id, code) values ('${CO.a}', '${LOC}', 'A1'), ('${CO.a}', '${LOC}', 'B2');
      insert into inv_items (company_id, name, manufacturer, model, tracking, status) values
        ('${CO.a}', 'Laptop 14 inch', 'Dell', 'XPS', 'individual', 'active'), ('${CO.a}', 'HDMI cable 5 m', null, null, 'quantity', 'active'),
        ('${CO.a}', 'Case screws', null, null, 'quantity', 'active');
    `);
    for (const [k, name] of [["laptop", "Laptop 14 inch"], ["cable", "HDMI cable 5 m"], ["screws", "Case screws"]] as const) {
      IT[k] = (await admin<{ id: string }>(`select id from inv_items where name = '${name}'`))[0]!.id;
    }
    BIN_A = (await admin<{ id: string }>(`select id from inv_bins where code = 'A1'`))[0]!.id;
    BIN_B = (await admin<{ id: string }>(`select id from inv_bins where code = 'B2'`))[0]!.id;
    // projects (direct rows, with the members the application would create)
    P1 = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by)
        values ('${CO.a}', 'UAE-P-2026-0007', 'Mall activation', 'internal', 'in_progress', '${U.pm}', '${U.pm}') returning id`))[0]!.id;
    PB = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by)
        values ('${CO.b}', 'BRD-P-2026-0001', 'Brand roadshow', 'internal', 'in_progress', '${U.pmB}', '${U.pmB}') returning id`))[0]!.id;
    await db.seed(`
      insert into proj_project_details (project_id, location, site_timezone) values ('${P1}', 'Dubai Mall, Level 2 service entrance', 'Asia/Dubai'), ('${PB}', 'Riyadh expo ground', 'Asia/Riyadh');
      insert into proj_project_members (project_id, user_id, role, acting_until) values
        ('${P1}', '${U.pm}', 'pm', null), ('${P1}', '${U.acting}', 'acting_pm', current_date + 10), ('${P1}', '${U.expired}', 'acting_pm', current_date - 1),
        ('${P1}', '${U.member}', 'member', null), ('${PB}', '${U.pmB}', 'pm', null);
    `);
    // stock: cables in two bins (7 + 5), laptops arrive by receipt
    await call(U.founder, `inv_receive_stock('${CO.a}', '${LOC}', '${key()}', ${j([{ item_id: IT.cable, qty: 7, bin_id: BIN_A }, { item_id: IT.cable, qty: 5, bin_id: BIN_B }])})`);
    await call(U.founder, `inv_receive_stock('${CO.a}', '${LOC}', '${key()}', ${j([{ item_id: IT.screws, qty: 40, bin_id: BIN_A }])})`);
    await newUnits(24);
  }, 240_000);
  afterAll(async () => { await db.teardown(); });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C7: preservation of the two movement functions", () => {
    const original = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/20261201000300_inv_stock_functions.sql"), "utf8");
    const bodyOf = (src: string, name: string) => {
      const i = src.indexOf(`create or replace function ${name}(`);
      const a = src.indexOf("as $$", i) + 5;
      return src.slice(a, src.indexOf("\n$$;", a));
    };
    for (const name of ["inv_dispatch_to_project", "inv_return_from_project"]) {
      it(`${name}: with the guarded call and its result addition taken out, the installed body is exactly the earlier one`, async () => {
        const installed = (await admin<{ prosrc: string }>(`select prosrc from pg_proc where proname = '${name}' and pronamespace = 'public'::regnamespace`))[0]!.prosrc;
        const stripped = installed
          .replace(" v_note jsonb;", "")
          .replace(/\n  -- (Dispatch note|Return checklist) \(launch package 3\)[^\n]*\n  if inv_project_notes_enabled\(p_company_id\) then v_note := inv_make_project_note\(v_mid\); end if;/, "")
          .replace(/\n           \|\| case when v_note is null then '\{\}'::jsonb else jsonb_build_object\('note_id', v_note->'note_id', 'note_no', v_note->'note_no'\) end\)/, ")");
        expect(stripped.trimEnd()).toBe(bodyOf(original, name).trimEnd());
      });
    }
    it("keeps the signature, ownership flags and who may execute them", async () => {
      const r = await admin<Row>(`select proname, prosecdef, proconfig::text cfg, has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') auth
        from pg_proc where pronamespace = 'public'::regnamespace and proname in ('inv_dispatch_to_project', 'inv_return_from_project') order by proname`);
      expect(r).toMatchObject([{ prosecdef: true, cfg: "{search_path=public}", anon: false, auth: true }, { prosecdef: true, cfg: "{search_path=public}", anon: false, auth: true }]);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C7: the switch is OFF by default and then dispatch and return behave as before", () => {
    it("is off for every company, and a dispatch and a return record no note, take no number and return the same result keys", async () => {
      expect(await admin<Row>(`select company_id, project_notes_enabled from inv_company_settings order by reference_code`)).toMatchObject([{ project_notes_enabled: false }, { project_notes_enabled: false }]);
      const u = UN[0]!;
      const d = await dispatch(U.wh, [{ unit_id: u }]);
      expect(Object.keys(d).sort()).toEqual(["code", "expected_return_at", "kind", "lines", "movement_id", "project_id", "recorded_at", "request_id", "request_status"]);
      const r = await giveBack(U.wh, [{ unit_id: u, condition: "good" }]);
      expect(Object.keys(r).sort()).toEqual(["code", "kind", "lines", "movement_id", "project_id", "recorded_at"]);
      expect(await count(`select 1 from inv_project_notes`)).toBe(0);
      expect(await count(`select 1 from inv_reference_counters where kind in ('dispatch_note', 'return_note')`)).toBe(0);
      expect((await admin<Row>(`select count(*) n from inv_movements where kind in ('dispatch_project', 'return_project')`))[0]!.n).toBe("2");
    });
    it("only an Inventory founder of the company can switch it, and the change is audited", async () => {
      for (const who of [U.wh, U.viewer, U.projFounder, U.outsider, U.whB]) await fails(who, `select inv_set_project_notes('${CO.a}', true)`, /Only an Inventory founder|not signed in|permission denied/i);
      await fails(U.founder, `select inv_set_project_notes('${CO.b}', true)`, /Only an Inventory founder/);
      await fails(null, `select inv_set_project_notes('${CO.a}', true)`, /permission denied/i);
      await call(U.founder, `inv_set_project_notes('${CO.a}', true)`);
      expect((await admin<Row>(`select project_notes_enabled from inv_company_settings where company_id = '${CO.a}'`))[0]!.project_notes_enabled).toBe(true);
      expect((await admin<Row>(`select project_notes_enabled from inv_company_settings where company_id = '${CO.b}'`))[0]!.project_notes_enabled).toBe(false);
      expect(await count(`select 1 from inv_audit_log where table_name = 'inv_company_settings' and company_id = '${CO.a}' and action = 'update' and (new_row->>'project_notes_enabled')::boolean`)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C2: creation inside the movement transaction", () => {
    let n1: Row = {};
    let firstKey = "", firstResult: Row = {};
    const sentUnits: string[] = [];

    it("a dispatch of 2 units and 12 cables makes exactly one note numbered <ref>-D-nnnnn with exactly the movement's lines (cables merged), and not what is only reserved", async () => {
      // something reserved for another request but not sent must not appear
      const [req] = await admin<{ id: string }>(`insert into inv_requests (company_id, code, kind, project_id, requested_by, status, timezone, needed_from, needed_until, expected_return_at)
        values ('${CO.a}', 'UAE-R-90001', 'project', '${P1}', '${U.pm}', 'submitted', 'Asia/Dubai', now() + interval '1 day', now() + interval '9 days', now() + interval '9 days') returning id`);
      const [line] = await admin<{ id: string }>(`insert into inv_request_lines (request_id, company_id, item_id, qty) values ('${req!.id}', '${CO.a}', '${IT.screws}', 10) returning id`);
      await admin(`insert into inv_reservations (company_id, request_line_id, item_id, location_id, qty, reserved_during, made_by)
        values ('${CO.a}', '${line!.id}', '${IT.screws}', '${LOC}', 10, tstzrange(now() + interval '1 day', now() + interval '9 days'), '${U.pm}')`);
      const before = await stockFingerprint();
      sentUnits.push(UN[1]!, UN[2]!);
      firstKey = key();
      firstResult = await dispatch(U.wh, [{ unit_id: sentUnits[0] }, { unit_id: sentUnits[1] }, { item_id: IT.cable, qty: 12 }], firstKey);
      expect(firstResult).toMatchObject({ note_no: "UAE-D-00001" });
      const n = await noteFor(firstResult);
      n1 = n;
      expect(n).toMatchObject({
        kind: "dispatch", company_id: CO.a, project_company_id: CO.a, project_ref: "UAE-P-2026-0007", project_name: "Mall activation", destination: "Dubai Mall, Level 2 service entrance",
        site_timezone: "Asia/Dubai", location_name: "Dubai warehouse", location_timezone: "Asia/Dubai", recorded_by: U.wh, recorded_by_name: "Wanda Warehouse", recorded_by_role: "Warehouse operator",
        pm_user_id_at_time: U.pm, pm_name_at_time: "Pat Manager", movement_id: firstResult.movement_id, request_id: null, replaces_note_id: null,
      });
      expect(n.movement_code).toMatch(/^UAE-M-\d{5}$/);
      expect(new Date(n.expected_return_at).getTime()).toBeGreaterThan(Date.now());
      const lines = n.payload.lines as Row[];
      expect(lines).toHaveLength(3);
      expect(lines.map((l) => l.n)).toEqual([1, 2, 3]);
      expect(lines.slice(0, 2)).toMatchObject([{ item_name: "Laptop 14 inch", manufacturer: "Dell", model: "XPS", equipment_id: expect.stringMatching(/^UAE-E-/), qty: 1, condition: "good" }, { qty: 1 }]);
      expect(lines[0]!.serial).toMatch(/^SN-/);
      expect(lines[2]).toMatchObject({ item_name: "HDMI cable 5 m", unit_id: null, equipment_id: null, serial: null, qty: 12, condition: "good" });
      expect(lines.some((l) => l.item_id === IT.screws)).toBe(false);
      expect(lines.every((l) => !("outcome" in l))).toBe(true);
      expect(n.payload_hash).toBe((await admin<{ h: string }>(`select md5(payload::text) h from inv_project_notes where id = '${n.id}'`))[0]!.h);
      // two ledger lines (7 + 5 from two bins) became ONE note line
      expect(await count(`select 1 from inv_movement_lines where movement_id = '${n.movement_id}' and item_id = '${IT.cable}'`)).toBeGreaterThanOrEqual(2);
      // the movement itself is exactly what a movement without notes would be: stock moved, ledger grew by the movement only
      const after = await stockFingerprint();
      expect(Number(after.movements)).toBe(Number(before.movements) + 1);
      expect(Number(after.requests)).toBe(Number(before.requests));
      expect(after.reservations).toBe(before.reservations);
      expect(await count(`select 1 from inv_project_notes`)).toBe(1);
      // the ledger code numbering is untouched by the new counters
      expect(n.movement_code).toBe((await admin<{ code: string }>(`select code from inv_movements where id = '${n.movement_id}'`))[0]!.code);
    });

    it("the same key replays the same note and takes no number", async () => {
      const again = await dispatch(U.wh, [{ unit_id: sentUnits[0] }, { unit_id: sentUnits[1] }, { item_id: IT.cable, qty: 12 }], firstKey);
      expect(again).toMatchObject({ replayed: true, note_id: firstResult.note_id, note_no: "UAE-D-00001", movement_id: firstResult.movement_id });
      expect(await count(`select 1 from inv_project_notes`)).toBe(1);
      expect(Number((await admin<Row>(`select last_value from inv_reference_counters where company_id = '${CO.a}' and kind = 'dispatch_note'`))[0]!.last_value)).toBe(1);
    });

    it("a movement that rolls back leaves no note and consumes no number", async () => {
      const u = UN[3]!;
      const inside = await db.asUser(U.wh, async (query) => {
        const r = (await query(`select inv_dispatch_to_project('${CO.a}', '${LOC}', '${P1}', '${key()}', ${j([{ unit_id: u }])}, null, '${EXPECTED}') as v`)).rows[0] as { v: Row };
        const c = (await query(`select count(*) n from inv_project_notes`)).rows[0] as { n: string };
        return { r: r.v, c: Number(c.n) };
      });
      expect(inside.c).toBe(2);                    // made inside the very same transaction (and then rolled back by the harness)
      expect(inside.r.note_no).toBe("UAE-D-00002");
      expect(await count(`select 1 from inv_project_notes`)).toBe(1);
      expect(Number((await admin<Row>(`select last_value from inv_reference_counters where company_id = '${CO.a}' and kind = 'dispatch_note'`))[0]!.last_value)).toBe(1);
      expect((await unitRow(u)).custody_kind).toBe("warehouse");
      // a dispatch that is refused (unit already out) records nothing either
      await expect(dispatch(U.wh, [{ unit_id: sentUnits[0] }])).rejects.toThrow(/not on the shelf/);
      expect(await count(`select 1 from inv_project_notes`)).toBe(1);
    });

    it("when the note cannot be made the whole movement is refused with a clear message and nothing is recorded", async () => {
      const u = UN[3]!;
      const before = await stockFingerprint();
      // force a collision: the next number already exists
      await admin(`update inv_reference_counters set last_value = 0 where company_id = '${CO.a}' and kind = 'dispatch_note'`);
      await expect(dispatch(U.wh, [{ unit_id: u }])).rejects.toThrow(/dispatch note could not be made, so nothing was recorded/);
      expect(await stockFingerprint()).toEqual(before);
      expect((await unitRow(u)).custody_kind).toBe("warehouse");
      await admin(`update inv_reference_counters set last_value = 1 where company_id = '${CO.a}' and kind = 'dispatch_note'`);
    });

    it("concurrent dispatches get distinct, gap-free numbers and never a raw database error", async () => {
      const units = await newUnits(6);
      const out = await Promise.allSettled(units.map((u) => dispatch(U.wh, [{ unit_id: u }])));
      expect(out.map((o) => o.status)).toEqual(Array(6).fill("fulfilled"));
      const nos = out.map((o) => String((o as PromiseFulfilledResult<Row>).value.note_no)).sort();
      expect(nos).toEqual(["UAE-D-00002", "UAE-D-00003", "UAE-D-00004", "UAE-D-00005", "UAE-D-00006", "UAE-D-00007"]);
      expect(new Set(nos).size).toBe(6);
      expect(Number((await admin<Row>(`select last_value from inv_reference_counters where company_id = '${CO.a}' and kind = 'dispatch_note'`))[0]!.last_value)).toBe(7);
      // return them again so later tests start from a known stock picture
      for (const u of units) await giveBack(U.wh, [{ unit_id: u, condition: "good" }]);
    });

    it("keeps the first note frozen: renaming the item, changing the serial, the destination or the zone later does not change it", async () => {
      const hash = n1.payload_hash;
      await admin(`update inv_items set name = 'Renamed laptop' where id = '${IT.laptop}'`);
      await admin(`update inv_units set serial_number = 'CHANGED' where id = '${sentUnits[0]}'`);
      await admin(`update proj_project_details set location = 'Somewhere else' where project_id = '${P1}'`);
      await admin(`update inv_locations set timezone = 'Europe/Warsaw' where id = '${LOC}'`);
      const now = await note(String(n1.id));
      expect(now.payload_hash).toBe(hash);
      expect(now.payload.lines[0].item_name).toBe("Laptop 14 inch");
      expect(now.payload.lines[0].serial).toMatch(/^SN-/);
      expect(now.destination).toBe("Dubai Mall, Level 2 service entrance");
      expect(now.location_timezone).toBe("Asia/Dubai");
      await admin(`update inv_items set name = 'Laptop 14 inch' where id = '${IT.laptop}'`);
      await admin(`update proj_project_details set location = 'Dubai Mall, Level 2 service entrance' where project_id = '${P1}'`);
      await admin(`update inv_locations set timezone = 'Asia/Dubai' where id = '${LOC}'`);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C1: frozen content and append-only history, for every role", () => {
    let noteId = "";
    beforeAll(async () => {
      noteId = (await admin<{ id: string }>(`select id from inv_project_notes where note_no = 'UAE-D-00001'`))[0]!.id;
      await ack(U.pm, noteId);                    // one event exists
    });
    it("refuses UPDATE, DELETE and TRUNCATE on a note even for the table owner", async () => {
      for (const col of ["payload", "note_no", "project_name", "destination", "recorded_by_name", "created_at", "expected_return_at", "replaces_note_id"]) {
        const v = col === "payload" ? `'{}'::jsonb` : col === "created_at" || col === "expected_return_at" ? `now()` : col === "replaces_note_id" ? `id` : `'x'`;
        await expect(admin(`update inv_project_notes set ${col} = ${v} where id = '${noteId}'`), col).rejects.toThrow(/never edited or deleted/);
      }
      await expect(admin(`delete from inv_project_notes where id = '${noteId}'`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`truncate inv_project_notes cascade`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`update inv_project_notes set note_no = note_no`)).rejects.toThrow(/never edited or deleted/);
    });
    it("refuses UPDATE, DELETE and TRUNCATE on an event", async () => {
      await expect(admin(`update inv_project_note_events set comment = 'edited' where note_id = '${noteId}'`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`update inv_project_note_events set event = 'difference_withdrawn'`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`delete from inv_project_note_events where note_id = '${noteId}'`)).rejects.toThrow(/never edited or deleted/);
      await expect(admin(`truncate inv_project_note_events`)).rejects.toThrow(/never edited or deleted/);
    });
    it("gives signed-in users no way to write the tables directly (founder, PM, warehouse, anyone)", async () => {
      for (const who of [U.founder, U.pm, U.wh, U.projFounder, U.invFounder]) {
        for (const t of ["inv_project_notes", "inv_project_note_events"]) {
          const upd = await db.asUser(who, async (query) => { try { return (await query(`update ${t} set id = id`)).rowCount; } catch (e) { return (e as Error).message; } });
          expect(upd === 0 || (typeof upd === "string" && DENIED.test(upd)), `${t}/${who}: ${String(upd)}`).toBe(true);
          const del = await db.asUser(who, async (query) => { try { return (await query(`delete from ${t}`)).rowCount; } catch (e) { return (e as Error).message; } });
          expect(del === 0 || (typeof del === "string" && DENIED.test(del)), `${t}/${who}: ${String(del)}`).toBe(true);
        }
        await fails(who, `insert into inv_project_note_events (note_id, company_id, project_id, event, by_user, by_name, capacity) select id, company_id, project_id, 'acknowledged', '${who}', 'x', 'pm' from inv_project_notes limit 1`);
        await fails(who, `insert into inv_project_notes select * from inv_project_notes limit 1`);
      }
    });
    it("every table and the internal functions are closed to signed-out and signed-in callers alike", async () => {
      await fails(null, `select 1 from inv_project_notes`, /permission denied/i);
      await fails(null, `select 1 from inv_project_note_events`, /permission denied/i);
      await fails(null, `select 1 from inv_project_note_status`, /permission denied/i);
      for (const f of ["inv_ack_project_note", "inv_resolve_note_difference", "inv_notes_waiting_for_me", "inv_set_project_notes"]) {
        const r = (await admin<Row>(`select has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p where p.proname = '${f}'`))[0]!;
        expect([f, r.anon, r.auth]).toEqual([f, false, true]);
      }
      for (const f of ["inv_make_project_note", "inv_project_notes_enabled", "inv_project_notes_frozen"]) {
        const r = (await admin<Row>(`select has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p where p.proname = '${f}'`))[0]!;
        expect([f, r.anon, r.auth]).toEqual([f, false, false]);
      }
      const mv = (await admin<{ id: string }>(`select id from inv_movements where kind = 'dispatch_project' limit 1`))[0]!.id;
      for (const who of [U.founder, U.wh, U.pm]) await fails(who, `select inv_make_project_note('${mv}')`, /permission denied/i);
      await fails(U.founder, `select inv_project_notes_enabled('${CO.a}')`, /permission denied/i);
      await fails(U.founder, `select inv_next_code('${CO.a}', 'dispatch_note')`, /permission denied/i);
    });
    it("keeps every other counter kind and the movement code sequence as before", async () => {
      expect(await count(`select 1 from pg_constraint where conrelid = 'inv_reference_counters'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dispatch_note%' and pg_get_constraintdef(oid) like '%movement%'`)).toBe(1);
      const codes = (await admin<{ code: string }>(`select code from inv_movements order by recorded_at, code`)).map((r) => Number(r.code.slice(-5)));
      for (let i = 1; i < codes.length; i++) expect(codes[i]!).toBe(codes[i - 1]! + 1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C1: who can read a note", () => {
    it("a Project Manager with NO Inventory grant reads the notes and events of their project and still cannot read the ledger", async () => {
      expect((await q<Row>(U.pm, `select note_no from inv_project_notes order by note_no`)).length).toBeGreaterThanOrEqual(1);
      expect((await q<Row>(U.pm, `select 1 from inv_project_note_events`)).length).toBeGreaterThanOrEqual(1);
      expect((await q<Row>(U.pm, `select state from inv_project_note_status where note_no = 'UAE-D-00001'`))[0]!.state).toBe("acknowledged");
      expect(await q(U.pm, `select 1 from inv_movements`)).toHaveLength(0);
      expect(await q(U.pm, `select 1 from inv_movement_lines`)).toHaveLength(0);
      expect(await q(U.pm, `select 1 from inv_units`)).toHaveLength(0);
    });
    it("project members, a Projects founder and warehouse / view-stock holders of the company read them", async () => {
      for (const who of [U.member, U.acting, U.projFounder, U.founder, U.wh, U.whPoz, U.viewer]) {
        expect((await q<Row>(who, `select 1 from inv_project_notes where project_id = '${P1}'`)).length, who).toBeGreaterThanOrEqual(1);
      }
    });
    it("everyone else reads nothing: outsiders, another company's warehouse and an Inventory founder with no project role are not project members", async () => {
      for (const who of [U.outsider, U.whB, U.pmB, U.newPm]) {
        expect(await q(who, `select 1 from inv_project_notes`), who).toHaveLength(0);
        expect(await q(who, `select 1 from inv_project_note_events`), who).toHaveLength(0);
        expect(await q(who, `select 1 from inv_project_note_status`), who).toHaveLength(0);
      }
      // an Inventory founder reads the company's notes (ledger access)
      expect((await q<Row>(U.invFounder, `select 1 from inv_project_notes`)).length).toBeGreaterThanOrEqual(1);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C2: the Project Manager's acknowledgement", () => {
    let nA = "", nB = "", nC = "";
    let uA: string[] = [], uB: string[] = [], uC: string[] = [];
    beforeAll(async () => {
      [uA, uB, uC] = [await newUnits(1), await newUnits(1), await newUnits(1)];
      nA = String((await dispatch(U.wh, [{ unit_id: uA[0] }])).note_id);
      nB = String((await dispatch(U.wh, [{ unit_id: uB[0] }])).note_id);
      nC = String((await dispatch(U.wh, [{ unit_id: uC[0] }])).note_id);
    });

    it("refuses everyone who is not the PM, an acting PM or a Projects founder, in the database, and records nothing", async () => {
      for (const who of [U.outsider, U.member, U.wh, U.invFounder, U.viewer, U.newPm, U.expired, U.pmB, U.whB]) {
        await fails(who, `select inv_ack_project_note('${nA}', 'acknowledge')`, /Only the project's Project Manager|Note not found|permission denied/);
      }
      await fails(null, `select inv_ack_project_note('${nA}', 'acknowledge')`, /permission denied/i);
      expect(await count(`select 1 from inv_project_note_events where note_id = '${nA}'`)).toBe(0);
      expect((await status(nA)).state).toBe("waiting_for_pm");
    });

    it("the PM acknowledges (name, capacity, time recorded), changes no stock, availability, custody or reservation, and a second click returns the original acknowledgement", async () => {
      const before = await stockFingerprint();
      const r = await ack(U.pm, nA);
      expect(r).toMatchObject({ event: "acknowledged", by_name: "Pat Manager", capacity: "pm", replayed: false });
      expect(await stockFingerprint()).toEqual(before);
      const again = await ack(U.pm, nA);
      expect(again).toMatchObject({ event: "acknowledged", by_name: "Pat Manager", capacity: "pm", replayed: true, at: r.at });
      const other = await ack(U.projFounder, nA);                   // someone else clicking later gets the ORIGINAL acknowledgement too
      expect(other).toMatchObject({ by_name: "Pat Manager", capacity: "pm", replayed: true });
      expect(await count(`select 1 from inv_project_note_events where note_id = '${nA}'`)).toBe(1);
      const s = await status(nA);
      expect(s).toMatchObject({ state: "acknowledged", awaiting: null, acknowledged_by: U.pm, acknowledged_capacity: "pm" });
    });

    it("an acting PM can act (capacity acting_pm); an acting PM whose period has expired cannot", async () => {
      await fails(U.expired, `select inv_ack_project_note('${nB}', 'acknowledge')`, /Only the project's Project Manager/);
      expect(await ack(U.acting, nB)).toMatchObject({ capacity: "acting_pm", by_name: expect.any(String), replayed: false });
    });

    it("a Projects founder can act on behalf (capacity projects_founder)", async () => {
      expect(await ack(U.projFounder, nC)).toMatchObject({ capacity: "projects_founder" });
    });

    it("after the PM is reassigned the NEW PM can act, the old one cannot, and the record shows who and in what capacity", async () => {
      const u = (await newUnits(1))[0]!;
      const n = String((await dispatch(U.wh, [{ unit_id: u }])).note_id);
      await admin(`update proj_projects set pm_user_id = '${U.newPm}' where id = '${P1}'`);
      await admin(`insert into proj_project_members (project_id, user_id, role) values ('${P1}', '${U.newPm}', 'pm')`);
      await fails(U.pm, `select inv_ack_project_note('${n}', 'acknowledge')`, /Only the project's Project Manager/);
      expect(await ack(U.newPm, n)).toMatchObject({ capacity: "pm", replayed: false });
      expect((await note(n)).pm_name_at_time).toBe("Pat Manager");               // the note still prints the PM AT dispatch
      expect((await admin<Row>(`select by_user from inv_project_note_events where note_id = '${n}'`))[0]!.by_user).toBe(U.newPm);
      await admin(`update proj_projects set pm_user_id = '${U.pm}' where id = '${P1}'`);
      await admin(`delete from proj_project_members where project_id = '${P1}' and user_id = '${U.newPm}'`);
    });

    it("a retried call with the same key returns the same answer (the existing idempotency pattern), another caller or other content is refused", async () => {
      const u = (await newUnits(1))[0]!;
      const n = String((await dispatch(U.wh, [{ unit_id: u }])).note_id);
      const k = key();
      const first = await diff(U.pm, n, [1], "not_on_site", "Not here", k);
      const again = await diff(U.pm, n, [1], "not_on_site", "Not here", k);
      expect(again).toMatchObject({ replayed: true, at: first.at, event: "difference_reported" });
      expect(await count(`select 1 from inv_project_note_events where note_id = '${n}'`)).toBe(1);
      await expect(diff(U.projFounder, n, [1], "not_on_site", "Not here", k)).rejects.toThrow(/already used by someone else/);
      await expect(diff(U.pm, n, [1], "quantity_differs", "Not here", k)).rejects.toThrow(/already used for a different request/);
    });

    it("lists the notes the caller can answer now, oldest first, and nothing for someone who cannot", async () => {
      const mine = await q<Row>(U.pm, `select * from inv_notes_waiting_for_me()`);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(mine[0]!).sort()).toEqual(["kind", "note_id", "note_no", "project_id", "project_name", "project_ref", "waiting_since"]);
      expect(mine.every((r) => r.project_id === P1)).toBe(true);
      const ids = mine.map((r) => r.note_id);
      expect(ids).not.toContain(nA);                     // acknowledged
      for (const who of [U.member, U.wh, U.outsider, U.pmB, U.viewer]) expect(await q(who, `select * from inv_notes_waiting_for_me()`), who).toHaveLength(0);
      expect((await q<Row>(U.projFounder, `select 1 from inv_notes_waiting_for_me()`)).length).toBe(mine.length);
      await fails(null, `select * from inv_notes_waiting_for_me()`, /permission denied/i);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C2: a difference, the warehouse's answer, and corrections as new notes", () => {
    let dn = "", du: string[] = [];
    beforeAll(async () => {
      du = await newUnits(2);
      await moreCables(30);
      dn = String((await dispatch(U.wh, [{ unit_id: du[0] }, { unit_id: du[1] }, { item_id: IT.cable, qty: 4 }])).note_id);
    });

    it("needs the line(s), a reason (and a comment for 'other') and is refused for a non-PM", async () => {
      await fails(U.member, `select inv_ack_project_note('${dn}', 'report_difference', '[1]'::jsonb, 'x', 'other')`, /Only the project's Project Manager/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', null, null, 'not_on_site')`, /Tick the line/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[]'::jsonb, null, 'not_on_site')`, /Tick the line/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[1]'::jsonb, null, null)`, /Say what is different/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[1]'::jsonb, null, 'not_returned')`, /Say what is different/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[1]'::jsonb, null, 'other')`, /Describe the difference/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[9]'::jsonb, null, 'not_on_site')`, /no line 9/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[1,1]'::jsonb, null, 'not_on_site')`, /listed twice/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '["a"]'::jsonb, null, 'not_on_site')`, /by their numbers/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'nonsense')`, /Choose acknowledge/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'withdraw')`, /no open difference/);
      expect(await count(`select 1 from inv_project_note_events where note_id = '${dn}'`)).toBe(0);
    });

    it("a reported difference is owned by the warehouse, blocks nothing else, and never changes custody, availability or reservations", async () => {
      const before = await stockFingerprint();
      const r = await diff(U.pm, dn, [1, 3], "quantity_differs", "Only 3 cables arrived");
      expect(r).toMatchObject({ event: "difference_reported", capacity: "pm" });
      expect(await stockFingerprint()).toEqual(before);
      expect(await status(dn)).toMatchObject({ state: "difference_open", awaiting: "warehouse", difference_state: "open", difference_reason: "quantity_differs", difference_lines: [1, 3] });
      expect((await unitRow(du[0]!)).custody_kind).toBe("project");
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'acknowledge')`, /A difference is open/);
      await fails(U.pm, `select inv_ack_project_note('${dn}', 'report_difference', '[1]'::jsonb, null, 'not_on_site')`, /already open/);
      expect((await q<Row>(U.pm, `select 1 from inv_notes_waiting_for_me() where note_id = '${dn}'`))).toHaveLength(0);   // the next step is the warehouse's
    });

    it("only an operator at THAT location can answer: another location's operator, a viewer, the PM and an outsider are refused", async () => {
      for (const who of [U.whPoz, U.viewer, U.pm, U.projFounder, U.outsider, U.whB]) {
        await fails(who, `select inv_resolve_note_difference('${dn}', 'record_stands', 'All good')`, /Only a warehouse operator at Dubai warehouse|Note not found|permission denied/);
      }
      await fails(U.wh, `select inv_resolve_note_difference('${dn}', 'record_stands', null)`, /Say what the warehouse found/);
      await fails(U.wh, `select inv_resolve_note_difference('${dn}', 'maybe', 'x')`, /Choose/);
      await fails(U.wh, `select inv_resolve_note_difference('${dn}', 'corrected', 'x')`, /Name the movement/);
      await fails(U.wh, `select inv_resolve_note_difference('${dn}', 'record_stands', 'x', '${(await note(dn)).movement_id}')`, /only when the record was corrected/);
      expect((await status(dn)).difference_state).toBe("open");
    });

    it("'the record stands' closes it with the warehouse's name and comment, and the PM may then acknowledge", async () => {
      const before = await stockFingerprint();
      const r = await resolve(U.wh, dn, "record_stands", "Counted again: 4 cables were sent", null, key());
      expect(r).toMatchObject({ event: "resolved_record_stands", capacity: "warehouse", by_name: "Wanda Warehouse" });
      expect(await stockFingerprint()).toEqual(before);
      expect(await status(dn)).toMatchObject({ difference_state: "resolved", awaiting: "pm", state: "waiting_for_pm" });
      await fails(U.wh, `select inv_resolve_note_difference('${dn}', 'record_stands', 'again')`, /no open difference/);
      expect(await ack(U.pm, dn)).toMatchObject({ event: "acknowledged" });
      // the history stays in order, nothing was replaced
      expect((await admin<Row>(`select event from inv_project_note_events where note_id = '${dn}' order by seq`)).map((e) => e.event)).toEqual(["difference_reported", "resolved_record_stands", "acknowledged"]);
    });

    it("the PM can withdraw an open report (who and when stay on record) and report again later, even after acknowledging", async () => {
      const r2 = await diff(U.pm, dn, [2], "condition_differs", "Scratched");
      expect(r2.event).toBe("difference_reported");
      expect(await ack(U.pm, dn, "withdraw", "null, 'Looked again'")).toMatchObject({ event: "difference_withdrawn" });
      expect(await status(dn)).toMatchObject({ difference_state: "withdrawn", awaiting: null, state: "acknowledged" });
      await resolve(U.founder, (await diff(U.pm, dn, [2], "condition_differs", "Scratched again")).note_id as string, "record_stands", "Checked");
      expect(await count(`select 1 from inv_project_note_events where note_id = '${dn}'`)).toBe(7);
    });

    it("'corrected' links the movement that corrected the record: the correction is a NEW note citing the old one, and the old note and its events are never altered", async () => {
      // the warehouse corrects the ledger with the EXISTING actions: take one laptop back and send it out again
      const u = (await newUnits(2)).slice(0, 2);
      const old = String((await dispatch(U.wh, [{ unit_id: u[0] }, { unit_id: u[1] }])).note_id);
      await diff(U.pm, old, [2], "different_item", "Wrong laptop model");
      const oldNoteBefore = JSON.stringify(await note(old));
      const oldEventsBefore = JSON.stringify(await admin(`select * from inv_project_note_events where note_id = '${old}' order by seq`));
      await giveBack(U.wh, [{ unit_id: u[1]!, condition: "good" }]);
      const redo = await dispatch(U.wh, [{ unit_id: u[1]! }]);                          // switch on: its note is created automatically
      const redoNote = await noteFor(redo);
      expect(redoNote.replaces_note_id).toBeNull();
      const before = await stockFingerprint();
      await fails(U.wh, `select inv_resolve_note_difference('${old}', 'corrected', 'Re-sent', '${(await note(old)).movement_id}')`, /later movement/);
      const res = await resolve(U.wh, old, "corrected", "Returned and re-sent the right one", String(redo.movement_id));
      expect(res).toMatchObject({ event: "resolved_corrected", linked_note_id: redoNote.id, capacity: "warehouse" });
      expect(await stockFingerprint()).toEqual(before);
      // old note: byte-for-byte identical; its earlier events identical; one event appended
      expect(JSON.stringify(await note(old))).toBe(oldNoteBefore);
      const oldEventsAfter = await admin(`select * from inv_project_note_events where note_id = '${old}' order by seq`);
      expect(JSON.stringify(oldEventsAfter.slice(0, oldEventsBefore ? JSON.parse(oldEventsBefore).length : 0))).toBe(oldEventsBefore);
      expect(oldEventsAfter).toHaveLength(JSON.parse(oldEventsBefore).length + 1);
      // the new note cites the old one; the old one shows it is superseded
      expect(await status(String(redoNote.id))).toMatchObject({ replaces_note_id: old, state: "waiting_for_pm" });
      expect(await status(old)).toMatchObject({ superseded_by_note_id: redoNote.id, state: "superseded", awaiting: null, difference_state: "resolved" });
      await fails(U.pm, `select inv_ack_project_note('${old}', 'acknowledge')`, /replaced by a newer note/);
      expect(await ack(U.pm, String(redoNote.id))).toMatchObject({ event: "acknowledged" });
    });

    it("when the correcting movement has no note yet (switch was off), the warehouse's resolution makes the NEW note and the new note itself cites the old one", async () => {
      const u = (await newUnits(1))[0]!;
      const old = String((await dispatch(U.wh, [{ unit_id: u }])).note_id);
      await diff(U.pm, old, [1], "not_on_site", "Not here");
      await giveBack(U.wh, [{ unit_id: u, condition: "good" }]);
      await setSwitch(false);
      const redo = await dispatch(U.wh, [{ unit_id: u }]);
      expect(redo.note_id).toBeUndefined();
      await setSwitch(true);
      const res = await resolve(U.wh, old, "corrected", "Re-sent", String(redo.movement_id));
      const newNote = await note(String(res.linked_note_id));
      expect(newNote).toMatchObject({ replaces_note_id: old, movement_id: redo.movement_id, kind: "dispatch" });
      expect(newNote.note_no).toMatch(/^UAE-D-\d{5}$/);
      expect(await status(old)).toMatchObject({ superseded_by_note_id: newNote.id, state: "superseded" });
    });

    it("a movement of another kind or project is recorded as the correction but makes no note, and a movement for another project is refused", async () => {
      const u = (await newUnits(1))[0]!;
      const old = String((await dispatch(U.wh, [{ unit_id: u }])).note_id);
      await diff(U.pm, old, [1], "not_on_site", "Not here");
      const back = await giveBack(U.wh, [{ unit_id: u, condition: "good" }]);          // a return is not a dispatch note's replacement
      const notesBefore = await count(`select 1 from inv_project_notes`);
      const res = await resolve(U.wh, old, "corrected", "Taken back", String(back.movement_id));
      expect(res.linked_note_id).toBeNull();
      expect(await count(`select 1 from inv_project_notes`)).toBe(notesBefore);
      expect(await status(old)).toMatchObject({ state: "waiting_for_pm", difference_state: "resolved" });
      // other project
      const u2 = (await newUnits(1))[0]!;
      const old2 = String((await dispatch(U.wh, [{ unit_id: u2 }])).note_id);
      await diff(U.pm, old2, [1], "not_on_site", "Not here");
      const u3 = (await newUnits(1))[0]!;
      await admin(`insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.wh}', '${CO.a}', '{}') on conflict do nothing`);
      const other = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by)
        values ('${CO.a}', 'UAE-P-2026-0099', 'Other', 'internal', 'in_progress', '${U.pm}', '${U.pm}') returning id`))[0]!.id;
      const res3 = await dispatch(U.wh, [{ unit_id: u3 }], key(), other);
      await fails(U.wh, `select inv_resolve_note_difference('${old2}', 'corrected', 'x', '${res3.movement_id}')`, /another project/);
      await resolve(U.wh, old2, "record_stands", "Fine");
    });

    it("works only while Inventory is on for the company", async () => {
      const u = (await newUnits(1))[0]!;
      const n = String((await dispatch(U.wh, [{ unit_id: u }])).note_id);
      await diff(U.pm, n, [1], "not_on_site", "Not here");
      await admin(`update inv_company_settings set is_enabled = false where company_id = '${CO.a}'`);
      await fails(U.wh, `select inv_resolve_note_difference('${n}', 'record_stands', 'x')`, /switched off/);
      await admin(`update inv_company_settings set is_enabled = true where company_id = '${CO.a}'`);
      await resolve(U.wh, n, "record_stands", "Fine");
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C2: return checklists (same tables, same rules)", () => {
    it("a partial return (1 of 2 units, 10 of 12 cables) freezes what was received and the project totals from the ledger, with outcomes in plain words", async () => {
      const proj = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by)
        values ('${CO.a}', 'UAE-P-2026-0100', 'Return project', 'internal', 'in_progress', '${U.pm}', '${U.pm}') returning id`))[0]!.id;
      await admin(`insert into proj_project_members (project_id, user_id, role) values ('${proj}', '${U.pm}', 'pm')`);
      const u = await newUnits(2);
      await moreCables(12);
      await dispatch(U.wh, [{ unit_id: u[0] }, { unit_id: u[1] }, { item_id: IT.cable, qty: 12 }], key(), proj);
      const before = await stockFingerprint();
      const ret = await giveBack(U.wh, [{ unit_id: u[0]!, condition: "damaged" }, { item_id: IT.cable, qty: 10, condition: "good" }], key(), proj);
      expect(ret.note_no).toMatch(/^UAE-RT-\d{5}$/);
      const rn = await noteFor(ret);
      expect(rn).toMatchObject({ kind: "return", location_id: LOC, expected_return_at: null, recorded_by_name: "Wanda Warehouse", project_ref: "UAE-P-2026-0100" });
      const lines = rn.payload.lines as Row[];
      expect(lines).toMatchObject([{ item_name: "Laptop 14 inch", equipment_id: expect.stringMatching(/^UAE-E-/), qty: 1, condition: "damaged", outcome: "held" }, { item_name: "HDMI cable 5 m", qty: 10, condition: "good", outcome: "available" }]);
      const totals = rn.payload.totals as Row[];
      const lap = totals.find((t) => t.item_name === "Laptop 14 inch")!;
      const cab = totals.find((t) => t.item_name === "HDMI cable 5 m")!;
      expect(lap).toMatchObject({ individual: true, sent: 2, returned_before: 0, received_now: 1, still_out: 1 });
      expect(cab).toMatchObject({ individual: false, sent: 12, returned_before: 0, received_now: 10, still_out: 2 });
      expect(JSON.stringify(rn.payload)).not.toMatch(/request/i);                 // nothing attributed to a request line
      // a second batch makes a second checklist; previously returned includes the first
      const ret2 = await giveBack(U.wh, [{ unit_id: u[1]!, condition: "good" }, { item_id: IT.cable, qty: 2, condition: "good" }], key(), proj);
      const rn2 = await noteFor(ret2);
      expect(rn2.note_no).not.toBe(rn.note_no);
      const t2 = rn2.payload.totals as Row[];
      expect(t2.find((t) => t.item_name === "Laptop 14 inch")).toMatchObject({ sent: 2, returned_before: 1, received_now: 1, still_out: 0 });
      expect(t2.find((t) => t.item_name === "HDMI cable 5 m")).toMatchObject({ sent: 12, returned_before: 10, received_now: 2, still_out: 0 });
      // the PM's confirmation does not release a damaged unit: it stays exactly as the ledger left it
      expect(await ack(U.pm, String(rn.id))).toMatchObject({ event: "acknowledged" });
      const lap0 = await unitRow(u[0]!);
      expect(lap0).toMatchObject({ condition: "damaged", custody_kind: "warehouse" });
      expect(Number((await stockFingerprint()).movements)).toBe(Number(before.movements) + 2);
      // and a difference on a checklist uses the return reasons
      await fails(U.pm, `select inv_ack_project_note('${rn.id}', 'report_difference', '[1]'::jsonb, null, 'not_on_site')`, /Say what is different/);
      expect(await diff(U.pm, String(rn.id), [2], "not_returned", "Two cables still on site")).toMatchObject({ event: "difference_reported" });
      expect(await unitRow(u[0]!)).toEqual(lap0);
      await resolve(U.wh, String(rn.id), "record_stands", "Counted: 10 received");
      // 'something returned is missing from the list' needs no line
      expect(await diff(U.pm, String(rn.id), [], "missing_from_list", "A tripod came back too")).toMatchObject({ event: "difference_reported" });
    });

    it("numbers return checklists on their own counter", async () => {
      expect(await count(`select 1 from inv_reference_counters where company_id = '${CO.a}' and kind = 'return_note'`)).toBe(1);
      const nos = (await admin<{ note_no: string }>(`select note_no from inv_project_notes where kind = 'return' order by created_at`)).map((r) => r.note_no);
      expect(nos).toEqual(nos.map((_, i) => `UAE-RT-${String(i + 1).padStart(5, "0")}`));           // contiguous, no gaps
      expect(Number((await admin<Row>(`select last_value from inv_reference_counters where company_id = '${CO.a}' and kind = 'return_note'`))[0]!.last_value)).toBe(nos.length);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------------------------------
  describe("C2: numbering by the warehouse location's company, and the switch afterwards", () => {
    it("a dispatch to another company's project is numbered by the warehouse's company and both companies are on the note; the project's PM can read and answer", async () => {
      await admin(`insert into inv_company_sharing (company_id, use_company_id, authorised_by) values ('${CO.a}', '${CO.b}', '${U.founder}')`);
      const u = (await newUnits(1))[0]!;
      const d = await dispatch(U.wh, [{ unit_id: u }], key(), PB);
      expect(d.note_no).toMatch(/^UAE-D-\d{5}$/);
      const n = await noteFor(d);
      expect(n).toMatchObject({ company_id: CO.a, project_company_id: CO.b, project_ref: "BRD-P-2026-0001", destination: "Riyadh expo ground", site_timezone: "Asia/Riyadh", pm_user_id_at_time: U.pmB });
      expect((await q<Row>(U.pmB, `select 1 from inv_project_notes where id = '${n.id}'`))).toHaveLength(1);
      expect(await q(U.pm, `select 1 from inv_project_notes where id = '${n.id}'`)).toHaveLength(0);
      expect(await ack(U.pmB, String(n.id))).toMatchObject({ capacity: "pm" });
      await fails(U.pm, `select inv_ack_project_note('${n.id}', 'acknowledge')`, /Only the project's Project Manager|Note not found/);
      await giveBack(U.wh, [{ unit_id: u, condition: "good" }], key(), PB);
    });

    it("switching it off again stops new notes, keeps every issued note and its history, and the movement result goes back to the plain shape", async () => {
      const notes = await count(`select 1 from inv_project_notes`);
      const events = await count(`select 1 from inv_project_note_events`);
      await call(U.founder, `inv_set_project_notes('${CO.a}', false)`);
      const u = (await newUnits(1))[0]!;
      const d = await dispatch(U.wh, [{ unit_id: u }]);
      expect(d.note_id).toBeUndefined();
      await giveBack(U.wh, [{ unit_id: u, condition: "good" }]);
      expect(await count(`select 1 from inv_project_notes`)).toBe(notes);
      expect(await count(`select 1 from inv_project_note_events`)).toBe(events);
      // PM can still read and answer what was issued while it was on
      expect((await q<Row>(U.invFounder, `select 1 from inv_project_notes`)).length).toBe(notes);
      expect((await q<Row>(U.pm, `select 1 from inv_project_notes`)).length).toBeGreaterThan(0);
    });
  });
});
