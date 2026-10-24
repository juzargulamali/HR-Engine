import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A retried call with the same key gets the ORIGINAL result back even when the time-dependent checks of the first call (a return date
// that was still in the future, a request that was still open) would now fail.
const id = () => randomUUID();
const CO = id();
const U = { founder: id(), pm: id() };
type Row = Record<string, unknown>;

describe("Inventory: a retried movement replays instead of failing", () => {
  const db = new RlsTestDatabase();
  let loc = "", item = "", project = "", request = "", line = "", unit = "";
  const call = async <T = Row>(user: string, expr: string) => (await db.asUserCommit(user, async (q) => (await q(`select ${expr} as v`)).rows[0] as { v: T })).v;
  const one = async (sql: string) => ((await db.seed(sql)).rows[0] as Row);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ('${U.founder}', 'founder@inv-replay-test.ae'), ('${U.pm}', 'pm@inv-replay-test.ae');
      insert into inv_company_settings (company_id, reference_code) values ('${CO}', 'UAE');
      insert into inv_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO}', '{founder}');
      insert into proj_company_settings (company_id, reference_code) values ('${CO}', 'UAE');
      insert into proj_company_grants (user_id, company_id, capabilities) values ('${U.founder}', '${CO}', '{founder}'), ('${U.pm}', '${CO}', '{}');
    `);
    loc = await call<string>(U.founder, `inv_save_location('${CO}', null, 'DXB', 'Dubai', 'Asia/Dubai')`);
    item = await call<string>(U.founder, `inv_save_item('${CO}', null, '{"name":"Laptop","tracking":"individual","status":"active"}'::jsonb)`);
    await call(U.founder, `inv_receive_stock('${CO}', '${loc}', 'replay-test-receive-1', '[{"item_id":"${item}","serials":["SN-1"]}]'::jsonb)`);
    unit = String((await one(`select id from inv_units limit 1`)).id);
    project = await call<string>(U.founder, `proj_create_internal_project('${CO}', 'Replay project', '${U.pm}', false, 'normal', current_date + 5, current_date + 12)`);
    const plan = JSON.stringify({ dispatch: "2099-03-01 09:00", return_due: "2099-03-10 18:00" });
    request = await call<string>(U.founder, `inv_create_request('project', '${project}', null, 'Replay', '${plan}'::jsonb, 'Asia/Dubai', null, '${loc}')`);
    line = await call<string>(U.founder, `inv_add_request_line('${request}', '${item}', 1)`);
    await call(U.founder, `inv_submit_request('${request}')`);
    await call(U.founder, `inv_reserve('${line}', '${loc}', array['${unit}']::uuid[])`);
  }, 180_000);
  afterAll(async () => { await db.teardown(); });

  it("returns the original dispatch for the same key after the request became fulfilled, and records nothing twice", async () => {
    const lines = `'[{"unit_id":"${unit}"}]'::jsonb`;
    const first = await call<Record<string, unknown>>(U.founder, `inv_dispatch_to_project('${CO}', '${loc}', '${project}', 'replay-test-dispatch-1', ${lines}, '${request}', '2099-03-10 18:00+04')`);
    expect(first.replayed).not.toBe(true);
    expect((await one(`select status from inv_requests where id = '${request}'`)).status).toBe("fulfilled");
    const again = await call<Record<string, unknown>>(U.founder, `inv_dispatch_to_project('${CO}', '${loc}', '${project}', 'replay-test-dispatch-1', ${lines}, '${request}', '2099-03-10 18:00+04')`);
    expect(again.replayed).toBe(true);
    expect(again.movement_id).toBe(first.movement_id);
    expect(Number((await one(`select count(*) n from inv_movements where kind = 'dispatch_project'`)).n)).toBe(1);
    // a DIFFERENT key for the same thing is a new attempt and is refused, because the request is already fulfilled
    await expect(call(U.founder, `inv_dispatch_to_project('${CO}', '${loc}', '${project}', 'replay-test-dispatch-2', ${lines}, '${request}', '2099-03-10 18:00+04')`)).rejects.toThrow();
  });

  it("still refuses a past expected return date for a NEW entry", async () => {
    await expect(call(U.founder, `inv_repair_out('${CO}', '${loc}', 'replay-test-repair-1', '[{"unit_id":"${unit}"}]'::jsonb, 'REP-1', now() - interval '1 day')`)).rejects.toThrow(/future|cannot|not/i);
  });
});
