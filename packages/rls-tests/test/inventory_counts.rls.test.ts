import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A mistaken count line can be taken out of an open count (inv_remove_count_line) without touching any stock.
const id = () => randomUUID();
const CO = id();
const U = { founder: id(), op: id(), outsider: id() };
type Row = Record<string, unknown>;

describe("Inventory counts: removing a count line", () => {
  const db = new RlsTestDatabase();
  let loc = "";
  let item = "";
  const call = async <T = Row>(user: string, expr: string) => (await db.asUserCommit(user, async (q) => (await q(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const rows = async (sql: string) => (await db.seed(sql)).rows as Row[];

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@inv-counts-test.ae')`).join(", ")};
      insert into inv_company_settings (company_id, reference_code) values ('${CO}', 'UAE');
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO}', '{founder}'), ('${U.op}', '${CO}', '{warehouse,confirm_stock}'), ('${U.outsider}', '${CO}', '{}');
    `);
    loc = await call<string>(U.founder, `inv_save_location('${CO}', null, 'DXB', 'Dubai', 'Asia/Dubai')`);
    await call(U.founder, `inv_set_operator_locations('${CO}', '${U.op}', array['${loc}']::uuid[])`);
    item = await call<string>(U.founder, `inv_save_item('${CO}', null, '{"name":"HDMI cable","tracking":"quantity","status":"active"}'::jsonb)`);
  }, 120_000);
  afterAll(async () => { await db.teardown(); });

  it("removes a mistaken line from an open count and leaves the books alone", async () => {
    const count = (await call<{ count_id: string }>(U.op, `inv_start_count('${CO}', '${loc}', 'opening')`)).count_id;
    const line = await call<string>(U.op, `inv_save_count_line('${count}', 99, null, '${item}', null, 'good')`);
    expect(Number((await rows(`select count(*) n from inv_count_lines where count_id = '${count}'`))[0]!.n)).toBe(1);
    await call(U.op, `inv_remove_count_line('${count}', '${line}')`);
    expect(Number((await rows(`select count(*) n from inv_count_lines where count_id = '${count}'`))[0]!.n)).toBe(0);
    expect(Number((await rows(`select count(*) n from inv_balances`))[0]!.n)).toBe(0);
    expect(Number((await rows(`select count(*) n from inv_movements`))[0]!.n)).toBe(0);
    // the same mistake can be removed only once, and the line must belong to that count
    await expect(call(U.op, `inv_remove_count_line('${count}', '${line}')`)).rejects.toThrow(/not on this count/);
    // after correcting and confirming, the count becomes stock as usual
    await call(U.op, `inv_save_count_line('${count}', 12, null, '${item}', null, 'good')`);
    await call(U.op, `inv_confirm_count('${CO}', '${count}', 'counts-test-confirm-1')`);
    expect(Number((await rows(`select qty from inv_balances where item_id = '${item}'`))[0]!.qty)).toBe(12);
  });

  it("refuses once the count is confirmed, and to people who may not operate the location or have no access", async () => {
    const count = (await call<{ count_id: string }>(U.op, `inv_start_count('${CO}', '${loc}', 'cycle')`)).count_id;
    const line = await call<string>(U.op, `inv_save_count_line('${count}', 12, null, '${item}', null, 'good')`);
    await expect(call(U.outsider, `inv_remove_count_line('${count}', '${line}')`)).rejects.toThrow();
    await call(U.op, `inv_confirm_count('${CO}', '${count}', 'counts-test-confirm-2')`);
    await expect(call(U.op, `inv_remove_count_line('${count}', '${line}')`)).rejects.toThrow(/already confirmed/);
    await expect(call(U.founder, `inv_remove_count_line('${id()}', '${line}')`)).rejects.toThrow(/Count not found/);
  });

  it("is not executable by anonymous or unauthenticated callers", async () => {
    const r = await rows(`select has_function_privilege('anon', 'inv_remove_count_line(uuid, uuid)', 'execute') a, has_function_privilege('authenticated', 'inv_remove_count_line(uuid, uuid)', 'execute') b`);
    expect(r[0]).toEqual({ a: false, b: true });
  });
});
