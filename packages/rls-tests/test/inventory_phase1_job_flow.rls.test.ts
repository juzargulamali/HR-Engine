import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Inventory Phase 1 (migration 20270114000100_inv_phase1_job_flow.sql) and the stock-safety rules of the owner's brief, against a real Postgres built from every
// migration. Fictional data throughout. Real parallel connections where the brief says "concurrent" or "retry".
//   * two concurrent reservations never commit the same unit, and never promise more counted stock than is free for the same period; a different period is fine;
//   * pick: only warehouse staff at that location, only what is reserved and unsent, never a damaged unit; it moves no stock and changes no availability; a retry
//     with the same key records once;
//   * a retried dispatch and a retried return each post exactly ONE movement; a short reservation and a partial dispatch leave the rest unfulfilled;
//   * a partial return updates only what was received; a damaged unit is out of availability until an inspection by warehouse staff at that location clears it;
//   * a request that serves two site runs keeps the unit on the same custody record (one dispatch movement, no return in between) and both runs read its state;
//   * the availability check reaches the people who run the project, and is flagged for review when dates, quantities or the warehouse change;
//   * permissions per company, warehouse and role (Sales, Project Manager, Warehouse, Operations, an outsider), for writes and for direct reads.

const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { founder: id(), wh: id(), whOther: id(), viewer: id(), cat: id(), sales: id(), pm: id(), member: id(), ops: id(), opsKsa: id(), projFounder: id(), outsider: id(), ksaFounder: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-p1.ae')`).join(", ");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const arr = (ids: string[]) => `array[${ids.map((x) => `'${x}'`).join(",")}]::uuid[]`;
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const key = () => `p1-${randomUUID()}`;
const W1 = { dispatch: "2031-06-10 09:00", return_due: "2031-06-20 18:00" };
const W_OVERLAP = { dispatch: "2031-06-15 09:00", return_due: "2031-06-25 18:00" };
const W_LATER = { dispatch: "2031-07-10 09:00", return_due: "2031-07-12 18:00" };

describe("Inventory Phase 1: pick, site runs, the project's availability check, and the stock-safety rules", () => {
  const db = new RlsTestDatabase();
  const call = async <T = Row>(user: string, expr: string): Promise<T> => (await db.asUserCommit(user, async (query) => (await query(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const read = async <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const num = async (sql: string) => Number((await admin<{ n: string }>(sql))[0]!.n);
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

  const LOC = { dxb: id(), auh: id(), ruh: id() };
  let seq = 0;
  const nm = (p: string) => `${p} ${++seq}`;
  const newItem = async (tracking: string, name = nm("Fictional item")) =>
    (await admin<{ id: string }>(`insert into inv_items (company_id, name, tracking, quantity_scale, status) values ('${CO.uae}', '${name}', '${tracking}', 0, 'active') returning id`))[0]!.id;
  const newUnit = async (item: string, o: { loc?: string; cond?: string; code?: string } = {}) =>
    (await admin<{ id: string }>(`insert into inv_units (company_id, item_id, code, lifecycle, condition, custody_kind, location_id)
       values ('${CO.uae}', '${item}', '${o.code ?? nm("UAE-E-P1")}', 'active', '${o.cond ?? "good"}', 'warehouse', '${o.loc ?? LOC.dxb}') returning id`))[0]!.id;
  const newBalance = async (item: string, qty: number, loc = LOC.dxb) =>
    (await admin<{ id: string }>(`insert into inv_balances (company_id, item_id, holder_kind, location_id, condition, qty) values ('${CO.uae}', '${item}', 'warehouse', '${loc}', 'good', ${qty}) returning id`))[0]!.id;
  const proj = async (ref: string, name: string, o: { opp?: string; pm?: string } = {}) => {
    const pm = o.pm ?? U.pm;
    const p = (await admin<{ id: string }>(`insert into proj_projects (company_id, reference, name, kind, status, pm_user_id, created_by, crm_opportunity_id)
      values ('${CO.uae}', '${ref}', '${name}', '${o.opp ? "client" : "internal"}', 'in_progress', '${pm}', '${pm}', ${o.opp ? `'${o.opp}'` : "null"}) returning id`))[0]!.id;
    await admin(`insert into proj_project_details (project_id, location, site_timezone, technologies) values ('${p}', 'Fictional Hall', 'Asia/Dubai', '[]'::jsonb) on conflict (project_id) do nothing`);
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${p}', '${pm}', 'pm') on conflict do nothing`);
    return p;
  };
  const run = async (p: string, title: string, d1: string, d2: string, kind = "show") =>
    (await admin<{ id: string }>(`insert into proj_plan_items (project_id, plan, title, activity_kind, run_label, status, start_date, end_date, created_by)
       values ('${p}', 'site', '${title}', '${kind}', '${title}', 'planned', '${d1}', '${d2}', '${U.pm}') returning id`))[0]!.id;
  const mkRequest = async (project: string, lines: { item: string; qty: number }[], o: { plan?: Record<string, string>; pm?: string; submit?: boolean } = {}) => {
    const pm = o.pm ?? U.pm;
    const req = await call<string>(pm, `inv_create_request('project', '${project}', null, 'Fictional job', ${j(o.plan ?? W1)}, 'Asia/Dubai')`);
    const ids: string[] = [];
    for (const l of lines) ids.push(await call<string>(pm, `inv_add_request_line('${req}', '${l.item}', ${l.qty})`));
    if (o.submit !== false) await call(pm, `inv_submit_request('${req}')`);
    return { req, lines: ids };
  };
  const reserve = (user: string, line: string, extra = "") => call<Row>(user, `inv_reserve('${line}', '${LOC.dxb}'${extra})`);
  const pick = (user: string, req: string, lines: unknown[], k = key(), loc = LOC.dxb, company = CO.uae) => call<Row>(user, `inv_pick_for_request('${company}', '${loc}', '${req}', '${k}', ${j(lines)})`);
  const dispatch = (user: string, project: string, req: string, lines: unknown[], k = key()) =>
    call<Row>(user, `inv_dispatch_to_project('${CO.uae}', '${LOC.dxb}', '${project}', '${k}', ${j(lines)}, '${req}')`);
  const giveBack = (user: string, project: string, lines: unknown[], k = key()) => call<Row>(user, `inv_return_from_project('${CO.uae}', '${LOC.dxb}', '${project}', '${k}', ${j(lines)})`);
  const free = (item: string, from = "2031-06-10 05:00+00", until = "2031-06-20 14:00+00") => num(`select inv_free_count('${item}', '${LOC.dxb}', '${from}', '${until}') n`);

  let P1 = "", P2 = "", PC = "", OPP = "", agencyId = "", clientId = "";

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious Arabia', 'SA', 'SAR');
      insert into auth.users (id, email) values ${SQL_USERS};
      insert into inv_company_settings (company_id, reference_code) values ('${CO.uae}', 'UAE'), ('${CO.ksa}', 'KSA') on conflict (company_id) do nothing;
      insert into proj_company_settings (company_id, reference_code) values ('${CO.uae}', 'UAE'), ('${CO.ksa}', 'KSA') on conflict (company_id) do nothing;
      insert into inv_locations (id, company_id, code, name, timezone) values
        ('${LOC.dxb}', '${CO.uae}', 'DXB', 'Dubai warehouse', 'Asia/Dubai'), ('${LOC.auh}', '${CO.uae}', 'AUH', 'Abu Dhabi store', 'Asia/Dubai'),
        ('${LOC.ruh}', '${CO.ksa}', 'RUH', 'Riyadh warehouse', 'Asia/Riyadh');
      insert into inv_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.wh}', '${CO.uae}', '{warehouse}'), ('${U.whOther}', '${CO.uae}', '{warehouse}'),
        ('${U.viewer}', '${CO.uae}', '{view_stock}'), ('${U.cat}', '${CO.uae}', '{manage_catalogue}'), ('${U.ksaFounder}', '${CO.ksa}', '{founder}');
      insert into inv_operator_locations (company_id, user_id, location_id) values ('${CO.uae}', '${U.wh}', '${LOC.dxb}'), ('${CO.uae}', '${U.whOther}', '${LOC.auh}');
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sales}', '${CO.uae}', '{}');
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED') on conflict (company_id) do nothing;
      insert into proj_company_grants (user_id, company_id, capabilities) values
        ('${U.projFounder}', '${CO.uae}', '{founder}'), ('${U.pm}', '${CO.uae}', '{}'), ('${U.member}', '${CO.uae}', '{}'), ('${U.ops}', '${CO.uae}', '{operations}'),
        ('${U.opsKsa}', '${CO.ksa}', '{operations}');
    `);
    agencyId = await call<string>(U.sales, `crm_create_organisation('Fictional Agency LLC', 'agency', 'Dubai')`);
    clientId = await call<string>(U.sales, `crm_create_organisation('Fictional Client Co', 'client', 'Dubai')`);
    P1 = await proj("UAE-P-2099-0801", "Fictional Roadshow");
    P2 = await proj("UAE-P-2099-0802", "Fictional Gala");
    await admin(`insert into proj_project_members (project_id, user_id, role) values ('${P1}', '${U.member}', 'member')`);
  });
  afterAll(async () => { await db.teardown(); });

  describe("installation", () => {
    it("opens the six client functions to signed-in users only and closes the helpers", async () => {
      const open = ["inv_pick_for_request", "inv_set_request_runs", "inv_project_run_cover", "inv_company_run_cover", "inv_project_sales_check", "inv_opportunity_check_locations"];
      const closed = ["inv_run_cover_rows", "inv_tech_norm"];
      const rows = await admin<Row>(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${[...open, ...closed].map((n) => `'${n}'`).join(",")}])`);
      for (const n of open) expect(rows.find((r) => r.proname === n), n).toMatchObject({ anon: false, auth: true });
      for (const n of closed) expect(rows.find((r) => r.proname === n), n).toMatchObject({ anon: false, auth: false });
    });
    it("lets nobody write the run links or the picked quantity directly", async () => {
      for (const u of [U.founder, U.pm, U.wh]) {
        expect(await code(read(u, `insert into inv_request_runs (request_id, plan_item_id, project_id) values ('${id()}', '${id()}', '${P1}')`))).toBe("42501");
        // no write policy: an update changes no row (or is refused outright where the table privilege is closed, as on the hosted database)
        const changed = await read(u, `update inv_reservations set picked_qty = 1 returning id`).catch((e: { code?: string }) => e.code);
        expect(changed === "42501" || (Array.isArray(changed) && changed.length === 0), String(changed)).toBe(true);
      }
    });
    it("is safe to apply twice, and the owner pack's verification passes", async () => {
      await db.applyMigration("20270114000100_inv_phase1_job_flow.sql");
      const rows = await admin<Row>(manual("inv_phase1_job_flow_20_verify_readonly.sql"));
      expect(rows.length).toBeGreaterThanOrEqual(6);
      for (const r of rows.filter((x) => !String(x.item).startsWith("information"))) expect(r.result, r.item).toBe("OK");
    });
  });

  describe("two reservations at the same moment", () => {
    it("never give the same unit to two requests for the same period, on two connections", async () => {
      const item = await newItem("individual");
      const unit = await newUnit(item);
      const a = await mkRequest(P1, [{ item, qty: 1 }]);
      const b = await mkRequest(P2, [{ item, qty: 1 }], { plan: W_OVERLAP });
      const res = await Promise.all([reserve(U.wh, a.lines[0]!), reserve(U.wh, b.lines[0]!)]);
      expect(res.map((r) => Number(r.reserved_now)).sort()).toEqual([0, 1]);
      expect(await num(`select count(*) n from inv_reservations where unit_id = '${unit}' and status = 'active'`)).toBe(1);
      // the one that lost says how many are missing
      expect(res.find((r) => Number(r.reserved_now) === 0)).toMatchObject({ shortage: 1, still_needed: 1 });
    });
    it("never promise more counted stock than is free for the same period, however many ask at once", async () => {
      const item = await newItem("quantity");
      await newBalance(item, 10);
      const reqs = [await mkRequest(P1, [{ item, qty: 6 }]), await mkRequest(P2, [{ item, qty: 6 }], { plan: W_OVERLAP }), await mkRequest(P1, [{ item, qty: 6 }], { plan: W_OVERLAP })];
      const res = await Promise.all(reqs.map((r) => reserve(U.wh, r.lines[0]!)));
      const got = res.map((r) => Number(r.reserved_now));
      expect(got.reduce((x, y) => x + y, 0)).toBe(10);
      expect(Math.max(...got)).toBeLessThanOrEqual(6);
      expect(await num(`select coalesce(sum(qty), 0) n from inv_reservations where item_id = '${item}' and status = 'active'`)).toBe(10);
      // a period that does not overlap is not affected
      const later = await mkRequest(P2, [{ item, qty: 10 }], { plan: W_LATER });
      expect(Number((await reserve(U.wh, later.lines[0]!)).reserved_now)).toBe(10);
    });
  });

  describe("the job: short reservation, pick, partial dispatch, two site runs, partial return with a damaged unit", () => {
    let panel = "", cable = "", units: string[] = [], req = "", lPanel = "", lCable = "", runA = "", runB = "", runOther = "";
    it("reserves what is free and reports how many are missing (a short reservation is not a fulfilled line)", async () => {
      panel = await newItem("individual", "Fictional LED panel");
      cable = await newItem("quantity", "Fictional power cable");
      units = [await newUnit(panel, { code: "UAE-E-P1-A" }), await newUnit(panel, { code: "UAE-E-P1-B" }), await newUnit(panel, { code: "UAE-E-P1-C" })];
      await newUnit(panel, { code: "UAE-E-P1-DMG", cond: "damaged" });
      await newBalance(cable, 8);
      const r = await mkRequest(P1, [{ item: panel, qty: 4 }, { item: cable, qty: 8 }]);
      req = r.req; lPanel = r.lines[0]!; lCable = r.lines[1]!;
      const a = await reserve(U.wh, lPanel, `, null, null, 'need_to_rent', 'Fictional Rentals RX-1'`);
      expect(a).toMatchObject({ reserved_now: 3, shortage: 1, still_needed: 1 });
      expect(a.need).toMatchObject({ action: "need_to_rent", qty: 1 });
      expect(Number((await reserve(U.wh, lCable)).reserved_now)).toBe(8);
      const st = await admin<Row>(`select inv_request_state('${req}') v`);
      expect(st[0]!.v).toMatchObject({ state: "partially_ready", short_lines: 1, short_rent: 1, units_short: 1 });
    });
    it("lets the Project Manager say which site runs the request serves; others are refused or see nothing", async () => {
      runA = await run(P1, "Fictional Run A", "2031-06-11", "2031-06-12");
      runB = await run(P1, "Fictional Run B", "2031-06-17", "2031-06-18");
      runOther = await run(P2, "Fictional other project run", "2031-06-11", "2031-06-12");
      expect(await code(call(U.member, `inv_set_request_runs('${req}', ${arr([runA])})`))).toBe("42501");
      expect(await code(call(U.sales, `inv_set_request_runs('${req}', ${arr([runA])})`))).toBe("P0002");
      expect(await code(call(U.outsider, `inv_set_request_runs('${req}', ${arr([runA])})`))).toBe("P0002");
      expect(await code(call(U.ksaFounder, `inv_set_request_runs('${req}', ${arr([runA])})`))).toBe("P0002");
      expect(await code(call(U.pm, `inv_set_request_runs('${req}', ${arr([runA, runOther])})`))).toBe("23514");
      expect((await call<Row>(U.pm, `inv_set_request_runs('${req}', ${arr([runA, runB])})`)).runs).toHaveLength(2);
      // replacing the list unlinks what is not named, and the warehouse may set it too
      await call(U.wh, `inv_set_request_runs('${req}', ${arr([runA])})`);
      expect(await num(`select count(*) n from inv_request_runs where request_id = '${req}'`)).toBe(1);
      await call(U.pm, `inv_set_request_runs('${req}', ${arr([runA, runB])})`);
      expect(await read(U.outsider, `select * from inv_request_runs`)).toHaveLength(0);
      expect(await read(U.sales, `select * from inv_request_runs`)).toHaveLength(0);
      expect(await read(U.pm, `select * from inv_request_runs where request_id = '${req}'`)).toHaveLength(2);
      expect(await read(U.ops, `select * from inv_request_runs where request_id = '${req}'`)).toHaveLength(2);
    });
    it("reads the same request state for each run and names what is wrong for it (short, with how many)", async () => {
      const cover = await call<Row>(U.pm, `inv_project_run_cover('${P1}')`);
      expect(cover.rows.map((r: Row) => r.run_title)).toEqual(["Fictional Run A", "Fictional Run B"]);
      for (const r of cover.rows) expect(r).toMatchObject({ request_id: req, state: "partially_ready", units_short: 1, short_rent: 1, problems: ["short"] });
      // Operations reads it for the company; a Project Manager, the warehouse of another company and an outsider do not
      const ops = await call<Row>(U.ops, `inv_company_run_cover('${CO.uae}')`);
      expect(ops.projects).toHaveLength(1);
      expect(ops.projects[0]).toMatchObject({ project_id: P1, reference: "UAE-P-2099-0801" });
      expect(ops.projects[0].rows).toHaveLength(2);
      expect(await code(call(U.pm, `inv_company_run_cover('${CO.uae}')`))).toBe("42501");
      expect(await code(call(U.opsKsa, `inv_company_run_cover('${CO.uae}')`))).toBe("42501");
      expect(await code(call(U.outsider, `inv_project_run_cover('${P1}')`))).toBe("P0002");
      expect(await code(call(U.sales, `inv_project_run_cover('${P1}')`))).toBe("P0002");
      expect(await code(call(U.ksaFounder, `inv_project_run_cover('${P1}')`))).toBe("P0002");
      expect((await call<Row>(U.wh, `inv_project_run_cover('${P1}')`)).rows).toHaveLength(2);
      expect((await call<Row>(U.ops, `inv_project_run_cover('${P1}')`)).rows).toHaveLength(2);
    });
    it("flags a run that the request's dates do not cover", async () => {
      const late = await run(P1, "Fictional Run after due back", "2031-06-24", "2031-06-25");
      await call(U.pm, `inv_set_request_runs('${req}', ${arr([runA, runB, late])})`);
      const rows = (await call<Row>(U.pm, `inv_project_run_cover('${P1}')`)).rows as Row[];
      expect(rows.find((r) => r.run_id === late)!.problems).toEqual(["short", "due_back_before_run_ends"]);
      await call(U.pm, `inv_set_request_runs('${req}', ${arr([runA, runB])})`);
    });
    it("pick: only warehouse staff at that location, only what is reserved for this request, never a damaged unit", async () => {
      const line = [{ unit_id: units[0] }];
      expect(await code(pick(U.pm, req, line))).toBe("42501");
      expect(await code(pick(U.whOther, req, line))).toBe("42501");
      expect(await code(pick(U.viewer, req, line))).toBe("42501");
      expect(await code(pick(U.sales, req, line))).toBe("42501");
      expect(await code(pick(U.outsider, req, line))).toBe("42501");
      expect(await code(pick(U.ksaFounder, req, line, key(), LOC.ruh, CO.ksa))).toBe("P0002");
      const stray = await newUnit(panel, { code: "UAE-E-P1-STRAY" });
      await expect(pick(U.wh, req, [{ unit_id: stray }])).rejects.toThrow(/not reserved for request/);
      await expect(pick(U.wh, req, [{ item_id: cable, qty: 9 }])).rejects.toThrow(/Only 8 of Fictional power cable is reserved/);
      // a reserved unit that is found damaged at the shelf is refused in words, and stays unpicked
      await admin(`update inv_units set condition = 'damaged' where id = '${units[2]}'`);
      await expect(pick(U.wh, req, [{ unit_id: units[2] }])).rejects.toThrow(/damaged and is held back/);
      await admin(`update inv_units set condition = 'good' where id = '${units[2]}'`);
    });
    it("pick records once on a retry, moves no stock and changes no availability", async () => {
      const before = { free: await free(panel), moves: await num(`select count(*) n from inv_movements`), cable: await num(`select qty n from inv_balances where item_id = '${cable}' and holder_kind = 'warehouse'`) };
      const k = key();
      const lines = [{ unit_id: units[0] }, { unit_id: units[1] }, { item_id: cable, qty: 5 }];
      const [a, b] = await Promise.all([pick(U.wh, req, lines, k), pick(U.wh, req, lines, k).catch((e: Error) => ({ error: e.message }))]);
      // the second arrival either gets the first result back or is told to wait: never a second record
      expect(a.kind ?? (b as Row).kind).toBe("pick");
      const again = await pick(U.wh, req, lines, k);
      expect(again).toMatchObject({ kind: "pick", replayed: true, picked_waiting: 7, reserved_not_picked: 4 });
      expect(await num(`select coalesce(sum(x.picked_qty), 0) n from inv_reservations x join inv_request_lines l on l.id = x.request_line_id where l.request_id = '${req}'`)).toBe(7);
      expect(await free(panel)).toBe(before.free);
      expect(await num(`select count(*) n from inv_movements`)).toBe(before.moves);
      expect(await num(`select qty n from inv_balances where item_id = '${cable}' and holder_kind = 'warehouse'`)).toBe(before.cable);
      expect((await admin<Row>(`select custody_kind, location_id from inv_units where id = '${units[0]}'`))[0]).toMatchObject({ custody_kind: "warehouse", location_id: LOC.dxb });
      // undo one unit, and correct the counted quantity
      await pick(U.wh, req, [{ unit_id: units[1], picked: false }, { item_id: cable, qty: 6 }]);
      expect((await admin<Row>(`select picked_qty, picked_at from inv_reservations where unit_id = '${units[1]}' and status = 'active'`))[0]).toMatchObject({ picked_at: null });
      expect(await num(`select coalesce(sum(picked_qty), 0) n from inv_reservations where item_id = '${cable}' and status = 'active'`)).toBe(6);
      await pick(U.wh, req, [{ unit_id: units[1] }]);
      // "did it post?" is answered for the person who did it, and not for an outsider
      expect(await call<Row>(U.wh, `inv_transaction_status('${CO.uae}', '${k}')`)).toMatchObject({ found: true, status: "recorded", kind: "pick" });
      expect(await call<Row>(U.outsider, `inv_transaction_status('${CO.uae}', '${k}')`)).toMatchObject({ found: false });
    });
    it("a retried dispatch posts ONE movement, and a partial dispatch does not mark the rest fulfilled", async () => {
      const k = key();
      const lines = [{ unit_id: units[0] }, { unit_id: units[1] }, { item_id: cable, qty: 6 }];
      const before = await num(`select count(*) n from inv_movements where kind = 'dispatch_project'`);
      const settled = await Promise.allSettled([dispatch(U.wh, P1, req, lines, k), dispatch(U.wh, P1, req, lines, k)]);
      expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
      const again = await dispatch(U.wh, P1, req, lines, k);
      expect(again.replayed).toBe(true);
      expect(await num(`select count(*) n from inv_movements where kind = 'dispatch_project'`)).toBe(before + 1);
      expect(await num(`select count(*) n from inv_movement_lines l join inv_movements m on m.id = l.movement_id where m.id = '${again.movement_id}' and l.unit_id is not null`)).toBe(2);
      expect((await admin<Row>(`select status from inv_requests where id = '${req}'`))[0]!.status).toBe("in_progress");
      expect((await admin<Row>(`select inv_request_state('${req}') v`))[0]!.v).toMatchObject({ state: "partially_dispatched", units_dispatched: 8, units_out: 8, units_short: 1 });
      // the third panel and two cables are still reserved here, not sent; the picked-and-waiting count went down with the dispatch
      expect(await num(`select coalesce(sum(x.qty - x.dispatched_qty), 0) n from inv_reservations x join inv_request_lines l on l.id = x.request_line_id where l.request_id = '${req}' and x.status = 'active'`)).toBe(3);
      expect(await num(`select coalesce(sum(greatest(0, x.picked_qty - x.dispatched_qty)), 0) n from inv_reservations x join inv_request_lines l on l.id = x.request_line_id where l.request_id = '${req}'`)).toBe(0);
      // other roles cannot send
      for (const u of [U.pm, U.sales, U.ops, U.outsider, U.whOther]) expect(await code(dispatch(u, P1, req, [{ unit_id: units[2] }]))).toBe("42501");
    });
    it("equipment that stays out across two site runs stays on the same custody record", async () => {
      const u = (await admin<Row>(`select custody_kind, project_id, expected_return_at from inv_units where id = '${units[0]}'`))[0]!;
      expect(u).toMatchObject({ custody_kind: "project", project_id: P1 });
      // ONE dispatch line took it out; nothing brought it back or sent it again between the runs
      expect(await num(`select count(*) n from inv_movement_lines where unit_id = '${units[0]}' and to_kind = 'project'`)).toBe(1);
      expect(await num(`select count(*) n from inv_movement_lines where unit_id = '${units[0]}' and from_kind = 'project'`)).toBe(0);
      expect(await num(`select count(*) n from inv_balances where item_id = '${cable}' and holder_kind = 'project' and project_id = '${P1}'`)).toBe(1);
      const rows = (await call<Row>(U.ops, `inv_project_run_cover('${P1}')`)).rows as Row[];
      expect(rows).toHaveLength(2);
      // both runs read the same request and the same out quantity, and "due back" is after the second run
      for (const r of rows) expect(r).toMatchObject({ request_id: req, state: "partially_dispatched", units_out: 8 });
      expect(Date.parse(rows[1]!.due_back_at)).toBeGreaterThan(Date.parse(rows[1]!.run_end));
      expect(Date.parse(u.expected_return_at)).toBeGreaterThan(Date.parse(rows[1]!.run_end));
    });
    it("a retried partial return posts ONE movement and updates only what was received", async () => {
      const k = key();
      const lines = [{ unit_id: units[0], condition: "good" }, { unit_id: units[1], condition: "damaged" }, { item_id: cable, qty: 4, condition: "good" }];
      const before = await num(`select count(*) n from inv_movements where kind = 'return_project'`);
      const settled = await Promise.allSettled([giveBack(U.wh, P1, lines, k), giveBack(U.wh, P1, lines, k)]);
      expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
      const again = await giveBack(U.wh, P1, lines, k);
      expect(again.replayed).toBe(true);
      expect(await num(`select count(*) n from inv_movements where kind = 'return_project'`)).toBe(before + 1);
      expect(again.lines.map((l: Row) => l.available)).toEqual([true, false, true]);
      // only what was received: 2 cables are still with the project, the request still has them out
      expect(await num(`select qty n from inv_balances where item_id = '${cable}' and holder_kind = 'project' and project_id = '${P1}'`)).toBe(2);
      expect(await num(`select qty n from inv_balances where item_id = '${cable}' and holder_kind = 'warehouse' and condition = 'good'`)).toBe(6);
      expect((await admin<Row>(`select inv_request_state('${req}') v`))[0]!.v).toMatchObject({ units_dispatched: 8, units_returned: 6, units_out: 2 });
      for (const u of [U.pm, U.sales, U.ops, U.outsider, U.whOther]) expect(await code(giveBack(u, P1, [{ item_id: cable, qty: 1, condition: "good" }]))).toBe("42501");
    });
    it("the damaged unit is out of availability until warehouse staff at that location clear it", async () => {
      expect((await admin<Row>(`select condition, custody_kind from inv_units where id = '${units[1]}'`))[0]).toMatchObject({ condition: "damaged", custody_kind: "warehouse" });
      // free for a later period: A is back and good; B is held; C is still reserved for this request's own window but free later
      expect(await free(panel, "2031-08-01 00:00+00", "2031-08-05 00:00+00")).toBe(3);   // A, C and the stray; not B, not the unit that was damaged from the start
      const later = await mkRequest(P2, [{ item: panel, qty: 1 }], { plan: { dispatch: "2031-08-01 09:00", return_due: "2031-08-05 18:00" } });
      await expect(reserve(U.wh, later.lines[0]!, `, ${arr([units[1]!])}`)).rejects.toThrow(/damaged and is not available/);
      const clear = (u: string, k = key()) => call<Row>(u, `inv_check_condition('${CO.uae}', '${LOC.dxb}', '${k}', ${j([{ unit_id: units[1], condition: "good", note: "Fictional inspection: bench tested" }])})`);
      for (const u of [U.pm, U.sales, U.ops, U.outsider, U.whOther, U.viewer]) expect(await code(clear(u))).toBe("42501");
      expect(await free(panel, "2031-08-01 00:00+00", "2031-08-05 00:00+00")).toBe(3);
      const done = await clear(U.wh);
      expect(done.lines[0]).toMatchObject({ condition: "good", available: true });
      expect(await free(panel, "2031-08-01 00:00+00", "2031-08-05 00:00+00")).toBe(4);
      expect(Number((await reserve(U.wh, later.lines[0]!, `, ${arr([units[1]!])}`)).reserved_now)).toBe(1);
    });
  });

  describe("the availability check, for the people who run the project", () => {
    let wallTech = "", wallItem = "", checkId = "";
    const WALL = "Fictional LED wall kit";
    it("reaches the Project Manager, Operations and the warehouse with what Sales was told, and nobody else", async () => {
      wallItem = await newItem("quantity", "Fictional wall tile");
      await newBalance(wallItem, 40);
      wallTech = await call<string>(U.cat, `inv_save_technology('${CO.uae}', null, '${WALL}', 'recipe')`);
      await call(U.cat, `inv_save_technology_components('${wallTech}', ${j([{ item_id: wallItem, qty: 10, sort_order: 10 }])})`);
      await call(U.cat, `inv_set_technology_status('${wallTech}', 'complete')`);
      OPP = await call<string>(U.sales, `crm_create_opportunity(p_company_id => '${CO.uae}', p_title => 'Fictional launch', p_source => 'agency_call', p_next_title => 'Call',
        p_next_due => now() + interval '2 days', p_agency_org_id => '${agencyId}', p_client_org_id => '${clientId}')`);
      const techs = [{ name: WALL, qty: 2 }];
      await admin(`update crm_opportunities set technologies = ${j(techs)}, install_start = '2031-09-08', event_start = '2031-09-10', event_end = '2031-09-12', location = 'Fictional Hall' where id = '${OPP}'`);
      // Sales, who cannot read the locations list, is given the names of the warehouses it can ask about, for its own enquiry only
      expect(await read(U.sales, `select id from inv_locations`)).toHaveLength(0);
      expect(await call<Row[]>(U.sales, `inv_opportunity_check_locations('${OPP}')`)).toEqual([{ id: LOC.auh, name: "Abu Dhabi store" }, { id: LOC.dxb, name: "Dubai warehouse" }]);
      for (const u of [U.pm, U.wh, U.outsider, U.ksaFounder, U.ops]) expect(await code(call(u, `inv_opportunity_check_locations('${OPP}')`)), u).toBe("P0002");
      await call(U.sales, `inv_request_opportunity_check('${OPP}', '${LOC.dxb}')`);
      checkId = await call<string>(U.wh, `inv_record_opportunity_check('${OPP}', '${LOC.dxb}', 'Fictional note')`);
      // what Sales sees: a dated result with the equipment, quantity, warehouse and dates it covered; nothing is reserved
      const sales = await call<Row>(U.sales, `inv_opportunity_availability('${OPP}')`);
      expect(sales).toMatchObject({ state: "checked", needs_recheck: false });
      expect(sales.latest).toMatchObject({ check_id: checkId, result: "available", location_name: "Dubai warehouse" });
      expect(sales.latest.covers).toMatchObject({ install_start: "2031-09-08", event_end: "2031-09-12", technologies: techs });
      expect(await num(`select count(*) n from inv_reservations where item_id = '${wallItem}'`)).toBe(0);

      PC = await proj("UAE-P-2099-0803", "Fictional launch project", { opp: OPP });
      await admin(`update proj_project_details set install_start = '2031-09-08', event_start = '2031-09-10', event_end = '2031-09-12', technologies = ${j(techs)} where project_id = '${PC}'`);
      for (const u of [U.pm, U.ops, U.wh, U.projFounder]) {
        const v = await call<Row>(u, `inv_project_sales_check('${PC}')`);
        expect(v, u).toMatchObject({ state: "checked", review: [] });
        expect(v.latest).toMatchObject({ check_id: checkId, result: "available", location_name: "Dubai warehouse", checked_by: expect.any(String) });
        expect(v.latest.covers.technologies).toEqual(techs);
      }
      for (const u of [U.outsider, U.sales, U.ksaFounder, U.member, U.viewer]) expect(await code(call(u, `inv_project_sales_check('${PC}')`)), u).toBe("P0002");
      // a project that did not come from an enquiry says so
      expect(await call<Row>(U.pm, `inv_project_sales_check('${P1}')`)).toMatchObject({ state: "no_enquiry" });
    });
    it("is flagged for review when the dates, the quantities or the warehouse change, and the check itself is never edited", async () => {
      const before = (await admin<Row>(`select row_to_json(c) v from inv_availability_checks c where id = '${checkId}'`))[0]!.v;
      await admin(`update proj_project_details set install_start = '2031-09-07' where project_id = '${PC}'`);
      expect((await call<Row>(U.pm, `inv_project_sales_check('${PC}')`)).review).toEqual([{ field: "install_start", checked: "2031-09-08", now: "2031-09-07" }]);
      await admin(`update proj_project_details set install_start = '2031-09-08', technologies = ${j([{ name: WALL, qty: 3 }])} where project_id = '${PC}'`);
      const q = (await call<Row>(U.pm, `inv_project_sales_check('${PC}')`)).review as Row[];
      expect(q.map((x) => x.field)).toEqual(["quantities"]);
      expect(q[0]!.now).toEqual([{ name: WALL, qty: 3 }]);
      // the same quantity written another way is not a change
      await admin(`update proj_project_details set technologies = ${j([{ name: `  ${WALL.toUpperCase()} `, qty: "2" }])} where project_id = '${PC}'`);
      expect((await call<Row>(U.pm, `inv_project_sales_check('${PC}')`)).review).toEqual([]);
      const r = await call<string>(U.pm, `inv_create_request('project', '${PC}', null, 'Fictional', ${j({ dispatch: "2031-09-08 09:00", return_due: "2031-09-13 18:00" })}, 'Asia/Dubai')`);
      await admin(`update inv_requests set pickup_location_id = '${LOC.auh}' where id = '${r}'`);
      const w = (await call<Row>(U.pm, `inv_project_sales_check('${PC}')`)).review as Row[];
      expect(w).toEqual([{ field: "warehouse", checked: "Dubai warehouse", now: "Abu Dhabi store", request_code: expect.any(String) }]);
      expect((await admin<Row>(`select row_to_json(c) v from inv_availability_checks c where id = '${checkId}'`))[0]!.v).toEqual(before);
    });
  });
});
