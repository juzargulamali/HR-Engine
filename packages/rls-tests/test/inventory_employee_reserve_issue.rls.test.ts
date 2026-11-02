import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A7 / D-06. An employee equipment request can be reserved by the warehouse and then issued against that same request.
// The issue must consume the request's own reservation (as a project dispatch does); a unit or quantity reserved for ANOTHER
// request is still refused; booking conflicts and the append-only movement history are unchanged.

const id = () => randomUUID();
const CO = id();
const U = { founder: id(), wh: id(), whOther: id(), head: id(), employee: id(), outsider: id() };
const SQL_USERS = Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-emp-res.ae')`).join(", ");
const LOC = id();
const EMP = { aisha: id(), omar: id() };
const DENIED = /permission denied|row-level security|Only |not set up|do not have|cannot|not allowed|You need|not signed in/i;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const key = () => `key-${id()}`;
const j = (o: unknown) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
/** Dubai local time as the planning functions expect it ("YYYY-MM-DD HH:mm"). */
const dubai = (hoursFromNow: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(Date.now() + hoursFromNow * 3_600_000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const SOON = { dispatch: dubai(2), return_due: dubai(72) };
const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

describe("Employee equipment request: reserve, then issue (D-06)", () => {
  const db = new RlsTestDatabase();
  const q = <T = Row>(user: string | null, sql: string) => db.asUser(user, async (query) => (await query(sql)).rows as T[]);
  const commit = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const one = async <T = unknown>(user: string, sql: string) => (await commit<{ v: T }>(user, `select (${sql}) as v`))[0]!.v;
  let seq = 0;

  async function item(tracking: "individual" | "quantity") {
    return (await admin<{ id: string }>(`insert into inv_items (company_id, name, tracking, status) values ('${CO}', 'Item ${++seq}', '${tracking}', 'active') returning id`))[0]!.id;
  }
  async function unit(itemId: string) {
    return (await admin<{ id: string }>(`insert into inv_units (company_id, item_id, code, lifecycle, condition, custody_kind, location_id)
      values ('${CO}', '${itemId}', 'UAE-E-R${++seq}', 'active', 'good', 'warehouse', '${LOC}') returning id`))[0]!.id;
  }
  async function shelf(itemId: string, qty: number) {
    await admin(`insert into inv_balances (company_id, item_id, holder_kind, location_id, condition, qty) values ('${CO}', '${itemId}', 'warehouse', '${LOC}', 'good', ${qty})`);
  }
  /** An employee request with one line, submitted, window starting in two hours. */
  async function request(forEmployee: string, itemId: string, qty: number) {
    const req = await one<string>(U.head, `inv_create_request('employee', null, '${forEmployee}', 'Equipment', ${j(SOON)}, 'Asia/Dubai')`);
    const line = await one<string>(U.head, `inv_add_request_line('${req}', '${itemId}', ${qty})`);
    await commit(U.head, `select inv_submit_request('${req}')`);
    return { req, line };
  }
  const reserve = (line: string, extra = "") => commit<{ r: Row }>(U.wh, `select inv_reserve('${line}', '${LOC}'${extra}) as r`).then((r) => r[0]!.r);
  const issue = (emp: string, lines: unknown[], req: string | null, user = U.wh, k = key(), expected = iso(24 * 2)) =>
    one<Row>(user, `inv_issue_to_employee('${CO}', '${LOC}', '${emp}', '${k}', ${j(lines)}, '${expected}', null, ${req ? `'${req}'` : "null"})`);
  const reservations = (line: string) => admin<Row>(`select unit_id, qty, dispatched_qty, returned_qty, status from inv_reservations where request_line_id = '${line}' order by made_at`);
  const status = async (req: string) => (await admin<{ status: string }>(`select status from inv_requests where id = '${req}'`))[0]!.status;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${SQL_USERS};
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into inv_company_settings (company_id, reference_code) values ('${CO}', 'UAE');
      insert into inv_locations (id, company_id, code, name, timezone) values ('${LOC}', '${CO}', 'DXB', 'Dubai warehouse', 'Asia/Dubai');
      insert into inv_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO}', '{founder}'), ('${U.wh}', '${CO}', '{warehouse}'), ('${U.whOther}', '${CO}', '{warehouse}'), ('${U.head}', '${CO}', '{request_for_employees}');
      insert into inv_operator_locations (company_id, user_id, location_id) values ('${CO}', '${U.wh}', '${LOC}');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date, employment_status) values
        ('${EMP.aisha}', '${U.employee}', 'E1', '${CO}', 'AE', 'Aisha', 'Khan', current_date - 400, 'active'),
        ('${EMP.omar}', null, 'E2', '${CO}', 'AE', 'Omar', 'Said', current_date - 400, 'active');
    `);
  });
  afterAll(async () => db.teardown());

  it("a unit reserved for request R is issued against R, the reservation counters update and the request is fulfilled", async () => {
    const it1 = await item("individual");
    const u1 = await unit(it1);
    const { req, line } = await request(EMP.aisha, it1, 1);
    await reserve(line, `, array['${u1}']::uuid[]`);
    expect(await reservations(line)).toMatchObject([{ unit_id: u1, status: "active" }]);
    expect(Number((await reservations(line))[0]!.dispatched_qty)).toBe(0);

    const r = await issue(EMP.aisha, [{ unit_id: u1 }], req);
    expect(r).toMatchObject({ employee_id: EMP.aisha, request_id: req, request_status: "fulfilled" });
    expect((await admin<Row>(`select custody_kind, employee_id from inv_units where id = '${u1}'`))[0]).toMatchObject({ custody_kind: "employee", employee_id: EMP.aisha });
    const res = (await reservations(line))[0]!;
    expect(Number(res.dispatched_qty)).toBe(1);
    expect(await status(req)).toBe("fulfilled");
    expect((await admin<Row>(`select count(*) n from inv_movement_lines l join inv_movements m on m.id = l.movement_id where m.request_id = '${req}' and m.kind = 'issue_employee'`))[0]).toMatchObject({ n: "1" });
  });

  it("counted stock reserved for request R issues without spare shelf stock and moves dispatched_qty", async () => {
    const it2 = await item("quantity");
    await shelf(it2, 5);
    const { req, line } = await request(EMP.aisha, it2, 5);
    await reserve(line);
    expect(Number((await reservations(line))[0]!.qty)).toBe(5);

    const part = await issue(EMP.aisha, [{ item_id: it2, qty: 2 }], req);
    expect(part).toMatchObject({ request_status: "in_progress" });
    let res = (await reservations(line))[0]!;
    expect([Number(res.dispatched_qty), res.status]).toEqual([2, "active"]);

    const rest = await issue(EMP.aisha, [{ item_id: it2, qty: 3 }], req);
    expect(rest).toMatchObject({ request_status: "fulfilled" });
    res = (await reservations(line))[0]!;
    expect(Number(res.dispatched_qty)).toBe(5);
    expect(Number((await admin<Row>(`select coalesce(sum(qty),0) s from inv_balances where item_id = '${it2}' and holder_kind = 'warehouse'`))[0]!.s)).toBe(0);
    expect(Number((await admin<Row>(`select coalesce(sum(qty),0) s from inv_balances where item_id = '${it2}' and holder_kind = 'employee' and employee_id = '${EMP.aisha}'`))[0]!.s)).toBe(5);
  });

  it("counted stock beyond the reservation still needs unreserved stock on the shelf", async () => {
    const it3 = await item("quantity");
    await shelf(it3, 5);
    const { req, line } = await request(EMP.aisha, it3, 4);
    await reserve(line, `, null, 3`);                       // 3 reserved, 2 spare
    await expect(issue(EMP.aisha, [{ item_id: it3, qty: 6 }], req)).rejects.toThrow(/Only .* can be issued now|asks for/);
    // 3 reserved + 1 spare = the 4 asked: allowed
    await issue(EMP.aisha, [{ item_id: it3, qty: 4 }], req);
    expect(Number((await reservations(line))[0]!.dispatched_qty)).toBe(3);
  });

  it("a unit reserved by a DIFFERENT request is still refused (with and without a request), and nothing changes", async () => {
    const it4 = await item("individual");
    const u4 = await unit(it4);
    const other = await request(EMP.omar, it4, 1);
    await reserve(other.line, `, array['${u4}']::uuid[]`);
    const mine = await request(EMP.aisha, it4, 1);
    await expect(issue(EMP.aisha, [{ unit_id: u4 }], mine.req)).rejects.toThrow(/is reserved for .* and cannot be issued to a person for that period/);
    await expect(issue(EMP.aisha, [{ unit_id: u4 }], null)).rejects.toThrow(/is reserved for .* and cannot be issued to a person for that period/);
    expect((await admin<Row>(`select custody_kind from inv_units where id = '${u4}'`))[0]!.custody_kind).toBe("warehouse");
    expect(Number((await reservations(other.line))[0]!.dispatched_qty)).toBe(0);
  });

  it("counted stock reserved by a different request is still refused", async () => {
    const it5 = await item("quantity");
    await shelf(it5, 4);
    const other = await request(EMP.omar, it5, 4);
    await reserve(other.line);
    const mine = await request(EMP.aisha, it5, 2);
    await expect(issue(EMP.aisha, [{ item_id: it5, qty: 2 }], mine.req)).rejects.toThrow(/Only 0 of .* can be issued now/);
    expect(Number((await reservations(other.line))[0]!.dispatched_qty)).toBe(0);
  });

  it("issuing a unit that nobody reserved against a request keeps working as before", async () => {
    const it6 = await item("individual");
    const u6 = await unit(it6);
    const { req } = await request(EMP.aisha, it6, 1);
    expect(await issue(EMP.aisha, [{ unit_id: u6 }], req)).toMatchObject({ request_status: "fulfilled" });
  });

  it("replaying the same key returns the same result and does not consume the reservation twice", async () => {
    const it7 = await item("quantity");
    await shelf(it7, 3);
    const { req, line } = await request(EMP.aisha, it7, 3);
    await reserve(line);
    const k = key();
    const back = iso(48);
    const first = await issue(EMP.aisha, [{ item_id: it7, qty: 2 }], req, U.wh, k, back);
    const again = await issue(EMP.aisha, [{ item_id: it7, qty: 2 }], req, U.wh, k, back);
    expect(again.movement_id).toBe(first.movement_id);
    expect(Number((await reservations(line))[0]!.dispatched_qty)).toBe(2);
  });

  it("after the unit comes back, its used-up reservation no longer blocks another request for the same dates", async () => {
    const it8 = await item("individual");
    const u8 = await unit(it8);
    const a = await request(EMP.aisha, it8, 1);
    await reserve(a.line, `, array['${u8}']::uuid[]`);
    await issue(EMP.aisha, [{ unit_id: u8 }], a.req);
    await one(U.wh, `inv_return_from_employee('${CO}', '${LOC}', '${EMP.aisha}', '${key()}', ${j([{ unit_id: u8, condition: "good" }])})`);
    const b = await request(EMP.omar, it8, 1);
    const made = await reserve(b.line, `, array['${u8}']::uuid[]`);
    expect(made.reserved_now).toBe(1);
  });

  it("only warehouse staff who work at the location can issue; the request's requester, an outsider and another-location operator are refused when calling directly", async () => {
    const it9 = await item("individual");
    const u9 = await unit(it9);
    const { req, line } = await request(EMP.aisha, it9, 1);
    await reserve(line, `, array['${u9}']::uuid[]`);
    for (const who of [U.head, U.employee, U.outsider, U.whOther]) {
      await expect(q(who, `select inv_issue_to_employee('${CO}', '${LOC}', '${EMP.aisha}', '${key()}', ${j([{ unit_id: u9 }])}, '${iso(48)}', null, '${req}')`)).rejects.toThrow(DENIED);
    }
    expect((await admin<Row>(`select custody_kind from inv_units where id = '${u9}'`))[0]!.custody_kind).toBe("warehouse");
    expect(Number((await reservations(line))[0]!.dispatched_qty)).toBe(0);
  });

  it("movement history stays append-only and no new ledger problem appears", async () => {
    expect(Number((await admin<Row>(`select count(*) n from inv_movements where kind = 'issue_employee'`))[0]!.n)).toBeGreaterThan(5);
    await expect(admin(`update inv_movements set note = 'tampered'`)).rejects.toThrow();
    await expect(admin(`delete from inv_movement_lines`)).rejects.toThrow();
    // (stock here is seeded without opening movements, so only problems other than "balance differs from ledger" would point at the new code)
    expect(await q(U.founder, `select * from inv_ledger_problems() where problem <> 'balance_differs_from_ledger'`)).toEqual([]);
  });
});
