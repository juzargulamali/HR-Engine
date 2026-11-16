import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The allocator (next_employee_number, migration 20270117000100): a pool number that is only LOCKED by another in-flight hire must not make the next hire treat the pool as exhausted.
// A pool of exactly ONE number (E007, the number of a removed test account) and one active employee (E100, so the sequence fallback would start at E101).
//   * hire 1 claims E007 and holds its transaction open; hire 2, saved meanwhile, must WAIT (not run on to the sequence);
//   * hire 1 rolls back  -> hire 2 gets E007;
//   * hire 1 commits     -> hire 2 gets the sequence's E101 (the pool is now really empty).
// Fictional data throughout.
const MIGRATION = "20270117000100_people_hr_employee_number_unique.sql";
const CO = randomUUID();
const HR1 = randomUUID();
const HR2 = randomUUID();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Employee numbers: the allocator waits for a locked pool number instead of treating the pool as exhausted", () => {
  const db = new RlsTestDatabase();
  const hireSql = (label: string) => `insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${CO}', 'AE', 'Fictional', '${label}', '2026-01-01') returning employee_number`;
  const poolState = async () => (await db.seed(`select number_key, claimed_by::text c from employee_number_pool order by number_value`)).rows as { number_key: string; c: string | null }[];

  async function reset() {
    await db.seed(`
      delete from employees where first_name = 'Fictional';
      delete from employee_number_reservations where number_key <> 'E100';
      update employee_number_pool set claimed_by = null, claimed_at = null;
      select setval('employee_number_seq', 100, true);
    `);
  }

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Fictional Allocator LLC', 'AE', 'AED');
      insert into auth.users (id, email) values ('${HR1}', 'a1@alloc.test'), ('${HR2}', 'a2@alloc.test');
      insert into user_roles (user_id, role, company_id) values ('${HR1}', 'hr_admin', '${CO}'), ('${HR2}', 'hr_admin', '${CO}');
      insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values ('E100', '${CO}', 'AE', 'Active', 'Holder', '2024-01-01');
      insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date, deleted_at) values ('E7', '${CO}', 'AE', 'Removed', 'Test', '2024-01-01', now());
    `);
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8"));
    await db.applyMigration(MIGRATION);
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  it("the pool is exactly one number, E007, and the sequence would start at E101", async () => {
    expect((await poolState()).map((r) => r.number_key)).toEqual(["E007"]);
    expect((await db.seed(`select sequence_start::text s from employee_number_allocation`)).rows[0]).toEqual({ s: "100" });
  });

  it("hire 1 holds E007 open; hire 2 WAITS; when hire 1 ROLLS BACK, hire 2 gets E007", async () => {
    await reset();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let tookFirst!: () => void;
    const first = new Promise<void>((r) => { tookFirst = r; });
    let firstNumber = "";
    const hire1 = db.asUser(HR1, async (q) => {   // asUser rolls back at the end
      firstNumber = ((await q(hireSql("One"))).rows[0] as { employee_number: string }).employee_number;
      tookFirst();
      await gate;
    });
    await first;
    expect(firstNumber).toBe("E007");
    let secondNumber: string | null = null;
    const hire2 = db.asUserCommit(HR2, async (q) => { secondNumber = ((await q(hireSql("Two"))).rows[0] as { employee_number: string }).employee_number; });
    await delay(700);
    expect(secondNumber, "hire 2 must be waiting, not given the sequence's E101").toBeNull();
    release();
    await hire1;           // rolled back: E007 is free again
    await hire2;
    expect(secondNumber).toBe("E007");
    expect((await poolState())[0]).toEqual({ number_key: "E007", c: expect.any(String) });   // now claimed by hire 2
  });

  it("hire 1 holds E007 open; hire 2 WAITS; when hire 1 COMMITS, hire 2 gets the sequence's E101 (the pool is really empty)", async () => {
    await reset();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let tookFirst!: () => void;
    const first = new Promise<void>((r) => { tookFirst = r; });
    let firstNumber = "";
    const hire1 = db.asUserCommit(HR1, async (q) => {
      firstNumber = ((await q(hireSql("One"))).rows[0] as { employee_number: string }).employee_number;
      tookFirst();
      await gate;
    });
    await first;
    expect(firstNumber).toBe("E007");
    let secondNumber: string | null = null;
    const hire2 = db.asUserCommit(HR2, async (q) => { secondNumber = ((await q(hireSql("Two"))).rows[0] as { employee_number: string }).employee_number; });
    await delay(700);
    expect(secondNumber).toBeNull();
    release();
    await hire1;           // committed: E007 belongs to hire 1
    await hire2;
    expect(secondNumber).toBe("E101");
    expect((await poolState())[0]!.c).not.toBeNull();
  });

  it("with the pool really empty a hire goes straight to the sequence without waiting", async () => {
    const started = Date.now();
    const got = (await db.asUserCommit(HR1, async (q) => ((await q(hireSql("Three"))).rows[0] as { employee_number: string }).employee_number));
    expect(got).toBe("E102");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
