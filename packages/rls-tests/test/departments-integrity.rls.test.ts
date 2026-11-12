import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Departments (migration 20270103000100_departments_company_integrity.sql), against a real Postgres:
//   * the migration stops, installing nothing, while the data already breaks a rule, and installs once it does not;
//   * an employee's department must belong to the employee's company: a direct update as HR Admin is refused across companies; the same company and clearing work;
//   * one active department per name per company, ignoring capitals and extra spaces; a removed department's name is free again; another company may use the name;
//   * who may add departments and edit employees is unchanged; the owner packs read as expected; rollback and re-apply work.

const MIGRATION = "20270103000100_departments_company_integrity.sql";
const id = () => randomUUID();
const CO = { a: id(), b: id() };
const U = { hrA: id(), hrB: id(), staff: id(), sys: id() };
const E = { a1: id(), a2: id(), b1: id() };
const D = { eng: id(), wh: id(), bOps: id(), removed: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

describe("Departments: company integrity and unique active names", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const as = <T = Row>(user: string, sql: string) => db.asUserCommit(user, async (query) => (await query(sql)).rows as T[]);
  const deptOf = async (employee: string) => (await admin(`select department_id from employees where id = '${employee}'`))[0]!.department_id as string | null;

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.a}', 'Fictional UAE', 'AE', 'AED'), ('${CO.b}', 'Fictional KSA', 'SA', 'SAR');
      insert into auth.users (id, email) values ('${U.hrA}', 'hra@dept-test.ae'), ('${U.hrB}', 'hrb@dept-test.ae'), ('${U.staff}', 'staff@dept-test.ae'), ('${U.sys}', 'sys@dept-test.ae');
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into user_roles (user_id, role, company_id) values ('${U.hrA}', 'hr_admin', '${CO.a}'), ('${U.hrB}', 'hr_admin', '${CO.b}');
      insert into user_roles (user_id, role) values ('${U.sys}', 'sys_admin');
      insert into departments (id, company_id, name) values ('${D.eng}', '${CO.a}', 'Engineering'), ('${D.wh}', '${CO.a}', 'Warehouse'), ('${D.bOps}', '${CO.b}', 'Operations');
      insert into departments (id, company_id, name, deleted_at) values ('${D.removed}', '${CO.a}', 'Old Team', now());
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${E.a1}', '${U.staff}', 'DI-1', '${CO.a}', 'AE', 'Riya', 'Rigger', '2024-01-01'),
        ('${E.a2}', null, 'DI-2', '${CO.a}', 'AE', 'Omar', 'Ops', '2024-01-01'),
        ('${E.b1}', null, 'DI-3', '${CO.b}', 'SA', 'Kaz', 'Khan', '2024-01-01');
    `);
  }, 120_000);
  afterAll(async () => { await db.teardown(); });

  it("before the migration the database accepts what the app refuses; the preflight counts it and the migration stops without installing anything", async () => {
    // the gap: a cross-company department and a duplicate name both go in
    await admin(`update employees set department_id = '${D.bOps}' where id = '${E.a2}'`);
    const dupe = (await admin(`insert into departments (company_id, name) values ('${CO.a}', '  ENGINEERING ') returning id`))[0]!.id as string;
    const pre = await admin(pack("dept_integrity_00_preflight_readonly.sql"));
    expect(pre.map((r) => r.result)).toEqual(["OK", "1 - RESOLVE FIRST (list A below)", "1 - RESOLVE FIRST (list B below)", "0 - OK", "not installed yet", "4", "1 / 0"]);
    await expect(db.applyMigration(MIGRATION)).rejects.toThrow(/nothing was installed\. 1 employee record\(s\) point at a department of another company, 1 active department name\(s\) are used more than once in one company, 0 active/);
    expect(await admin(`select 1 from pg_trigger where tgname = 'trg_employees_department_company'`)).toEqual([]);
    expect(await admin(`select 1 from pg_constraint where conname in ('employees_department_company_fkey', 'departments_id_company_key')`)).toEqual([]);
    expect(await admin(`select 1 from pg_indexes where indexname = 'uq_departments_company_name_active'`)).toEqual([]);
    expect(await deptOf(E.a2)).toBe(D.bOps);                                                     // and it changed no data
    // the conflicts are resolved by a person, not by the migration
    await admin(`update employees set department_id = null where id = '${E.a2}'; delete from departments where id = '${dupe}';`);
    expect((await admin(pack("dept_integrity_00_preflight_readonly.sql"))).map((r) => r.result).slice(0, 5)).toEqual(["OK", "0 - OK", "0 - OK", "0 - OK", "not installed yet"]);
  });

  it("installs on clean data, twice, and the verify pack says OK on every row", async () => {
    await db.applyMigration(MIGRATION);
    await db.applyMigration(MIGRATION);
    expect((await admin(pack("dept_integrity_20_verify_readonly.sql"))).map((r) => r.result)).toEqual(Array(10).fill("OK"));
    expect((await admin(pack("dept_integrity_00_preflight_readonly.sql")))[4]!.result).toBe("already installed");
  });

  it("a direct update as HR Admin: another company's department is refused; the same company and clearing the department still work", async () => {
    await expect(as(U.hrA, `update employees set department_id = '${D.bOps}' where id = '${E.a1}'`)).rejects.toThrow(/belongs to another company/);
    expect(await deptOf(E.a1)).toBeNull();
    expect(await as(U.hrA, `update employees set department_id = '${D.eng}' where id = '${E.a1}' returning id`)).toHaveLength(1);
    expect(await deptOf(E.a1)).toBe(D.eng);
    expect(await as(U.hrA, `update employees set department_id = '${D.wh}' where id = '${E.a1}' returning id`)).toHaveLength(1);   // moving within the company
    expect(await as(U.hrA, `update employees set department_id = null where id = '${E.a1}' returning id`)).toHaveLength(1);         // clearing
    expect(await deptOf(E.a1)).toBeNull();
    // the other company's HR Admin: their own department on their own employee works; our department on their employee is refused
    expect(await as(U.hrB, `update employees set department_id = '${D.bOps}' where id = '${E.b1}' returning id`)).toHaveLength(1);
    await expect(as(U.hrB, `update employees set department_id = '${D.eng}' where id = '${E.b1}'`)).rejects.toThrow(/belongs to another company/);
    expect(await deptOf(E.b1)).toBe(D.bOps);
    // and they still cannot touch an employee of a company that is not theirs at all (unchanged rule)
    expect(await as(U.hrB, `update employees set department_id = '${D.eng}' where id = '${E.a1}' returning id`)).toEqual([]);
  });

  it("two transactions: an assignment and a department's company move cannot both commit and leave a mismatch, whichever goes first", async () => {
    const mismatches = async () => (await admin(`select count(*)::int as n from employees e join departments d on d.id = e.department_id where d.company_id <> e.company_id`))[0]!.n as number;
    const gate = () => { let open!: () => void; const wait = new Promise<void>((r) => { open = r; }); return { open, wait }; };
    const settle = (p: Promise<unknown>) => p.then(() => "committed", (e: Error) => `refused: ${e.message}`);
    const blocked = async () => (await admin(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`))[0]!.n as number;
    const untilBlocked = async () => { for (let i = 0; i < 100 && (await blocked()) === 0; i++) await new Promise((r) => setTimeout(r, 20)); return blocked(); };
    const race = async (refusal: RegExp) => {
      await admin(`update employees set department_id = null where id in ('${E.a1}', '${E.a2}')`);
      // Order 1: the assignment is made first and is still open when the move is attempted. The move waits on the row lock the foreign key took.
      let hold = gate();
      const assign = settle(db.asUserCommit(U.hrA, async (query) => { await query(`update employees set department_id = '${D.wh}' where id = '${E.a2}'`); await hold.wait; }));
      await new Promise((r) => setTimeout(r, 100));
      const move = settle(db.asUserCommit(U.sys, (query) => query(`update departments set company_id = '${CO.b}' where id = '${D.wh}'`)));
      expect(await untilBlocked()).toBeGreaterThan(0);
      hold.open();
      expect(await assign).toBe("committed");
      expect(await move).toMatch(refusal);
      expect(await deptOf(E.a2)).toBe(D.wh);
      expect((await admin(`select company_id from departments where id = '${D.wh}'`))[0]!.company_id).toBe(CO.a);
      expect(await mismatches()).toBe(0);

      // Order 2: the move is made first and is still open when the assignment is attempted. The assignment waits for the move, then is refused.
      await admin(`update employees set department_id = null where id = '${E.a2}'`);
      hold = gate();
      const move2 = settle(db.asUserCommit(U.sys, async (query) => { await query(`update departments set company_id = '${CO.b}' where id = '${D.wh}'`); await hold.wait; }));
      await new Promise((r) => setTimeout(r, 100));
      const assign2 = settle(db.asUserCommit(U.hrA, (query) => query(`update employees set department_id = '${D.wh}' where id = '${E.a2}'`)));
      expect(await untilBlocked()).toBeGreaterThan(0);
      hold.open();
      expect(await move2).toBe("committed");
      expect(await assign2).toMatch(refusal);
      expect(await deptOf(E.a2)).toBeNull();
      expect(await mismatches()).toBe(0);
      await admin(`update departments set company_id = '${CO.a}' where id = '${D.wh}'`);          // put the fixture back
    };

    // As installed. The second transaction is refused once the first commits, by the plain-words trigger where it gets to look again, otherwise by the foreign key.
    await race(/refused: .*(employees_department_company_fkey|has employees of its present company|belongs to another company)/);
    // With both plain-words triggers switched off, the foreign key alone must refuse the second transaction in both orders: it is what makes the rule safe.
    await admin(`alter table employees disable trigger trg_employees_department_company; alter table departments disable trigger trg_departments_company_move;`);
    try { await race(/refused: .*employees_department_company_fkey/); }
    finally { await admin(`alter table employees enable trigger trg_employees_department_company; alter table departments enable trigger trg_departments_company_move;`); }
  });

  it("the foreign key leaves clearing alone: an employee with no department is never checked", async () => {
    await as(U.hrA, `update employees set department_id = '${D.eng}' where id = '${E.a2}'`);
    expect(await as(U.hrA, `update employees set department_id = null where id = '${E.a2}' returning department_id`)).toEqual([{ department_id: null }]);
    expect(await as(U.hrA, `update employees set job_title = 'Planner' where id = '${E.a2}' returning job_title`)).toEqual([{ job_title: "Planner" }]);
    expect((await admin(`select confmatchtype, confupdtype from pg_constraint where conname = 'employees_department_company_fkey'`))[0]).toEqual({ confmatchtype: "s", confupdtype: "a" });
  });

  it("also holds for a new employee, a removed department, and an employee or department moved between companies; unrelated edits are never refused", async () => {
    await expect(admin(`insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date, department_id) values ('DI-9', '${CO.a}', 'AE', 'New', 'Hire', '2025-01-01', '${D.bOps}')`)).rejects.toThrow(/belongs to another company/);
    await expect(as(U.hrA, `update employees set department_id = '${D.removed}' where id = '${E.a1}'`)).rejects.toThrow(/has been removed/);
    await as(U.hrA, `update employees set department_id = '${D.eng}' where id = '${E.a1}'`);
    await expect(admin(`update employees set company_id = '${CO.b}', country_code = 'SA' where id = '${E.a1}'`)).rejects.toThrow(/belongs to another company/);
    await expect(admin(`update departments set company_id = '${CO.b}' where id = '${D.eng}'`)).rejects.toThrow(/has employees of its present company/);
    // someone whose department is removed later keeps it, and their other details can still be edited
    await admin(`update departments set deleted_at = now() where id = '${D.eng}'`);
    expect(await as(U.hrA, `update employees set job_title = 'Senior rigger' where id = '${E.a1}' returning job_title`)).toEqual([{ job_title: "Senior rigger" }]);
    expect(await deptOf(E.a1)).toBe(D.eng);
    await admin(`update departments set deleted_at = null where id = '${D.eng}'`);
  });

  it("one active department per name per company, whatever the capitals and spaces; a removed name is free; another company may use it", async () => {
    for (const name of ["Engineering", " engineering ", "ENGINEERING", "Warehouse"]) {
      await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', '${name}')`)).rejects.toThrow(/uq_departments_company_name_active|duplicate key/);
    }
    await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', 'Site   Operations')`)).resolves.toBeDefined();
    await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', 'site operations')`)).rejects.toThrow(/duplicate key/);
    await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', '   ')`)).rejects.toThrow(/departments_name_not_blank/);
    expect(await as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', 'Old Team') returning name`)).toEqual([{ name: "Old Team" }]);   // the removed one's name
    expect(await as(U.hrB, `insert into departments (company_id, name) values ('${CO.b}', 'Engineering') returning name`)).toEqual([{ name: "Engineering" }]);
    // white space is collapsed before the ends are trimmed: a name of tabs or line breaks is blank, and these are all one name
    for (const blank of ["E'\\t'", "E'\\t\\t \\n'", "E' \\t '"]) {
      await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', ${blank})`)).rejects.toThrow(/departments_name_not_blank/);
    }
    expect(await as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', 'Stage Design') returning name`)).toEqual([{ name: "Stage Design" }]);
    for (const same of ["E'\\tStage Design'", "E'Stage Design\\t'", "E'\\n Stage Design \\n'", "E'  stage\\tdesign  '", "E'STAGE \\t\\n DESIGN'"]) {
      await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', ${same})`)).rejects.toThrow(/duplicate key/);
    }
    expect((await admin(`select department_name_key(E'\\t Stage \\t\\n Design \\t') as k, department_name_key(E'\\t') as blank`))[0]).toEqual({ k: "stage design", blank: "" });
    // a rename into an existing name is refused too
    await expect(admin(`update departments set name = 'warehouse' where id = '${D.eng}'`)).rejects.toThrow(/duplicate key/);
  });

  it("two creates of the same name at the same moment: exactly one is kept", async () => {
    const attempt = () => as(U.hrA, `insert into departments (company_id, name) values ('${CO.a}', 'Content') returning id`).then(() => "ok", (e: Error) => (/duplicate key/.test(e.message) ? "duplicate" : `other: ${e.message}`));
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.sort()).toEqual(["duplicate", "duplicate", "ok"]);
    expect((await admin(`select count(*)::int as n from departments where company_id = '${CO.a}' and lower(name) = 'content' and deleted_at is null`))[0]!.n).toBe(1);
  });

  it("who may add departments is unchanged, and the trigger functions cannot be called directly", async () => {
    await expect(as(U.hrA, `insert into departments (company_id, name) values ('${CO.b}', 'Not Mine')`)).rejects.toThrow(/row-level security/);
    await expect(as(U.staff, `insert into departments (company_id, name) values ('${CO.a}', 'No Role')`)).rejects.toThrow(/row-level security/);
    await expect(db.asUser(U.hrA, (query) => query(`select employees_department_company_check()`))).rejects.toThrow();
  });

  it("rollback removes the rules and deletes nothing; applying again restores them", async () => {
    const before = (await admin(`select (select count(*) from departments)::int as d, (select count(*) from employees)::int as e`))[0];
    await admin(pack("dept_integrity_90_rollback.sql"));
    expect((await admin(`select (select count(*) from departments)::int as d, (select count(*) from employees)::int as e`))[0]).toEqual(before);
    expect(await admin(`select 1 from pg_trigger where tgname in ('trg_employees_department_company', 'trg_departments_company_move')`)).toEqual([]);
    expect(await admin(`select 1 from pg_constraint where conname in ('employees_department_company_fkey', 'departments_id_company_key', 'departments_name_not_blank')`)).toEqual([]);
    expect(await admin(`select 1 from pg_constraint where conname = 'employees_department_id_fkey'`)).toHaveLength(1);   // the original reference is untouched
    await db.applyMigration(MIGRATION);
    expect((await admin(pack("dept_integrity_20_verify_readonly.sql"))).map((r) => r.result)).toEqual(Array(10).fill("OK"));
  });
});
