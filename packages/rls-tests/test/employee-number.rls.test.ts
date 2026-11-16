import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Employee numbers (migration 20270117000100_people_hr_employee_number_unique.sql): ONE shared series across Enginious UAE, Saudi Arabia and Europe, against a real Postgres. Fictional data throughout.
//   * the SQL function gives exactly the canonical forms in supabase/tests/employee-number-vectors.json (the same file the app's normaliser is tested against);
//   * BEFORE the migration there are live equivalent numbers, within a company and across companies: the audit pack reports them (all companies, inactive and removed included, classed A/B/C, E003 checked
//     globally), the migration REFUSES and changes nothing, existing numbers stay as recorded; the owner approves specific corrections; the migration then applies and starts the series ABOVE every number any row holds;
//   * after that: uniqueness on the normalised number ACROSS companies among live rows; a new hire is numbered by the database from one sequence (two hires at once in different companies get different numbers; a
//     number taken is never given out again; no truncation after E999); a supplied or changed number is saved canonically, an unchanged one is never rewritten;
//   * giving someone access to all three companies (roles and module grants) never creates an employee row, never changes the employee's id, company or number, and never takes a number from the series;
//   * the packs behave as documented.
const MIGRATION = "20270117000100_people_hr_employee_number_unique.sql";
const manual = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const vectors = JSON.parse(readFileSync(path.join(__dirname, "../../../supabase/tests/employee-number-vectors.json"), "utf8")) as { vectors: { input: string; canonical: string }[]; equivalentGroups: string[][] };
const id = () => randomUUID();
const CO = { uae: id(), ksa: id(), eu: id() };
const NAME = { [CO.uae]: "Fictional UAE LLC", [CO.ksa]: "Fictional Saudi LLC", [CO.eu]: "Fictional Europe Sp. z o.o." } as Record<string, string>;
const HR = { uae: id(), ksa: id(), eu: id() };   // one HR Admin per company
const SYSADMIN = id();
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Employee numbers: one shared series, equivalent numbers are one number, assigned by the database", () => {
  const db = new RlsTestDatabase();
  const admin = async <T = Row>(sql: string) => (await db.seed(sql)).rows as T[];
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const message = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return (e as Error).message; } };
  let n = 0;
  const hire = async (company: string, number: string | null, extra = "") => {   // as the unrestricted connection; number null = the way the app now hires (no number supplied)
    const empId = id();
    const cols = extra ? ", " + extra.split("=")[0] : "";
    const vals = extra ? ", " + extra.split("=").slice(1).join("=") : "";
    await db.seed(`insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date${cols}) values ('${empId}', ${number === null ? "null" : lit(number)}, '${company}', 'AE', 'Fictional', 'Person${++n}', '2024-01-01'${vals})`);
    return empId;
  };
  const numberOf = async (empId: string) => (await admin<{ employee_number: string }>(`select employee_number from employees where id = '${empId}'`))[0]!.employee_number;
  const auditSummary = async () => Object.fromEntries((await admin<Row>(manual("people_hr_employee_number_00_audit_readonly.sql"))).filter((r) => r.kind === "SUMMARY").map((r) => [r.group_key, r.number_as_recorded]));
  const state = async () => (await admin<Row>(`select to_regprocedure('public.employee_number_canonical(text)') is not null as fn, to_regclass('public.employee_number_seq') is not null as seq, to_regclass('public.employees_employee_number_canonical_unique') is not null as idx, to_regclass('public.employees_company_employee_number_unique') is not null as old`))[0];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);   // every migration BEFORE this one: the per-company exact-match index only
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', '${NAME[CO.uae]}', 'AE', 'AED'), ('${CO.ksa}', '${NAME[CO.ksa]}', 'SA', 'SAR'), ('${CO.eu}', '${NAME[CO.eu]}', 'PL', 'PLN');
      insert into auth.users (id, email) values ('${HR.uae}', 'hr-uae@numbers.test'), ('${HR.ksa}', 'hr-ksa@numbers.test'), ('${HR.eu}', 'hr-eu@numbers.test'), ('${SYSADMIN}', 'sysadmin@numbers.test');
      insert into user_roles (user_id, role, company_id) values ('${HR.uae}', 'hr_admin', '${CO.uae}'), ('${HR.ksa}', 'hr_admin', '${CO.ksa}'), ('${HR.eu}', 'hr_admin', '${CO.eu}');
      insert into user_roles (user_id, role) values ('${SYSADMIN}', 'sys_admin');
    `);
    // Today's data: the per-company index allows every one of these (a different company, or a different spelling, is not an exact match).
    ids.e2 = await hire(CO.uae, "E2");                                                    // E002 group: UAE E2, Saudi E002, Europe e02 (terminated: still live) -> across companies
    ids.e002 = await hire(CO.ksa, "E002");
    ids.e02 = await hire(CO.eu, "e02", "employment_status='terminated'");
    ids.tasneem = await hire(CO.uae, "E003");                                             // E003 was only ever checked within one company: Saudi holds E03 as a live employee
    ids.e03 = await hire(CO.ksa, "E03");
    ids.e3gone = await hire(CO.eu, "E3", "deleted_at=now()");                             // and a removed Europe employee held E3
    ids.e7a = await hire(CO.uae, "E7");                                                   // E007 group within ONE company
    ids.e7b = await hire(CO.uae, "e007");
    ids.l1 = await hire(CO.uae, "L-1");                                                   // outside the E-series: left as recorded
    ids.di9 = await hire(CO.ksa, "DI-9");
    ids.k5 = await hire(CO.uae, "K-5", "deleted_at=now()");                               // class B: a live employee reusing a removed employee's number
    ids.k5live = await hire(CO.uae, "k-005");
    ids.z1 = await hire(CO.eu, "Z-1", "deleted_at=now()");                                // class C: removed only
    ids.z2 = await hire(CO.ksa, "z-001", "deleted_at=now()");
    ids.top = await hire(CO.eu, "E0450", "deleted_at=now()");                             // the HIGHEST E-number is held by a REMOVED employee
    ids.live120 = await hire(CO.ksa, "E120");
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  it("BEFORE the migration the audit pack reports every group across ALL companies (inactive and removed included), with scope, class, E003 checked globally and the series start, and changes nothing", async () => {
    const before = await admin<Row>(`select employee_number from employees order by id`);
    const rows = await admin<Row>(manual("people_hr_employee_number_00_audit_readonly.sql"));
    const summary = Object.fromEntries(rows.filter((r) => r.kind === "SUMMARY").map((r) => [r.group_key, r.number_as_recorded]));
    expect(summary["groups that block the migration (live employees, any companies)"]).toBe("3");
    expect(summary["  of which across different companies"]).toBe("2");
    expect(summary["groups that reuse a removed employee's number (not a blocker)"]).toBe("1");
    expect(summary["groups among removed employees only (information)"]).toBe("1");
    expect(summary["employees audited (all companies, including terminated and removed)"]).toBe("16");
    expect(summary["employees holding E003 or an equivalent spelling (any company, any status)"]).toBe("3");
    expect(summary["highest E-number held by ANY employee (live, terminated or removed)"]).toBe("E450");
    expect(summary["the first number the new series would give out"]).toBe("E451");
    const a = rows.filter((r) => r.kind === "COLLISION" && r.class === "A");
    expect(a.filter((r) => r.group_key === "E002").map((r) => r.number_as_recorded).sort()).toEqual(["E002", "E2", "e02"]);   // three companies, the inactive one included
    expect(new Set(a.filter((r) => r.group_key === "E002").map((r) => r.company))).toEqual(new Set(Object.values(NAME)));
    expect(a.find((r) => r.number_as_recorded === "e02")).toMatchObject({ employment_status: "terminated", removed: "no", employee_id: ids.e02, scope: "different companies" });
    expect(a.filter((r) => r.group_key === "E003").map((r) => r.number_as_recorded).sort()).toEqual(["E003", "E03", "E3"]);   // the removed Europe row is listed with its group
    expect(a.filter((r) => r.group_key === "E007").map((r) => r.scope)).toEqual(["same company", "same company"]);
    const e003 = rows.filter((r) => r.kind === "E003");
    expect(e003.map((r) => `${r.company}|${r.number_as_recorded}|${r.removed}`).sort()).toEqual([`${NAME[CO.eu]}|E3|yes`, `${NAME[CO.ksa]}|E03|no`, `${NAME[CO.uae]}|E003|no`].sort());
    expect(rows.filter((r) => r.kind === "COLLISION" && r.class === "B").map((r) => [r.number_as_recorded, r.removed]).sort()).toEqual([["K-5", "yes"], ["k-005", "no"]]);
    expect(rows.filter((r) => r.kind === "COLLISION" && r.class === "C").map((r) => r.number_as_recorded).sort()).toEqual(["Z-1", "z-001"]);
    expect(rows.some((r) => r.kind === "NOT STANDARD" && r.scope === "outside series" && r.number_as_recorded === "DI-9")).toBe(true);
    expect(rows.some((r) => r.kind === "NOT STANDARD" && r.scope === "not canonical" && r.number_as_recorded === "E2" && r.group_key === "E002")).toBe(true);
    expect(await admin<Row>(`select employee_number from employees order by id`)).toEqual(before);   // read only
  });

  it("BEFORE the migration the preflight says STOP (3 groups) and the migration refuses with that count and changes nothing: no function, no sequence, no new index, the old index stays, every number as recorded", async () => {
    const pre = (await db.seed(manual("people_hr_employee_number_05_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[0]!.result).toBe("OK");
    expect(pre[1]!.result).toBe("not installed yet");
    expect(pre[2]!.result).toMatch(/^STOP - 3 group\(s\)/);
    expect(pre[5]!.result).toBe("E451");
    const msg = await message(db.applyMigration(MIGRATION));
    expect(msg).toMatch(/STOP: 3 group\(s\) of equivalent employee numbers \(7 live employees\) exist across the companies/);
    expect(await state()).toEqual({ fn: false, seq: false, idx: false, old: true });
    expect(await numberOf(ids.e2)).toBe("E2");
    expect(await numberOf(ids.e02)).toBe("e02");
  });

  it("the owner approves specific corrections one employee at a time; until none is left the audit still blocks, and every other number stays as recorded", async () => {
    await admin(`update employees set employee_number = 'E500' where id = '${ids.e002}'`);   // approved correction 1
    await admin(`update employees set employee_number = 'E501' where id = '${ids.e02}'`);    // approved correction 2: the E002 group is now one holder (E2)
    expect((await auditSummary())["groups that block the migration (live employees, any companies)"]).toBe("2");
    await admin(`update employees set employee_number = 'E502' where id = '${ids.e03}'`);    // approved correction 3: Tasneem's E003 now has one live holder
    await admin(`update employees set employee_number = 'E503' where id = '${ids.e7b}'`);    // approved correction 4
    expect((await auditSummary())["groups that block the migration (live employees, any companies)"]).toBe("0");
    expect(await numberOf(ids.e2)).toBe("E2");
    expect(await numberOf(ids.tasneem)).toBe("E003");
    expect(await numberOf(ids.l1)).toBe("L-1");
    expect(await numberOf(ids.di9)).toBe("DI-9");
  });

  it("with no blocking group the preflight is OK and the migration applies: no existing number is rewritten, the series starts above EVERY number any row holds (a removed E450 and the corrections up to E503)", async () => {
    const pre = (await db.seed(manual("people_hr_employee_number_05_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[2]!.result).toBe("OK");
    expect(pre[5]!.result).toBe("E504");
    const recorded = await admin<Row>(`select id, employee_number from employees order by id`);
    // Supabase grants table and sequence privileges to the signed-in role by DEFAULT when an object is created; the harness's grants file does the same for the tables that exist. It runs BEFORE this migration
    // (as on a real project the sequence is created afterwards and this file's own revoke is what keeps people away from it).
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8"));
    await db.applyMigration(MIGRATION);
    expect(await admin<Row>(`select id, employee_number from employees order by id`)).toEqual(recorded);
    expect(await state()).toEqual({ fn: true, seq: true, idx: true, old: false });
    expect((await admin<{ v: string }>(`select last_value::text v from employee_number_seq`))[0]!.v).toBe("503");
  });

  it("the SQL function gives the same canonical forms as the shared vectors, and every equivalence group is one number", async () => {
    for (const v of vectors.vectors) {
      expect((await admin<{ c: string }>(`select employee_number_canonical(${lit(v.input)}) as c`))[0]!.c, `input ${JSON.stringify(v.input)}`).toBe(v.canonical);
    }
    for (const g of vectors.equivalentGroups) {
      expect(await admin<{ k: string }>(`select distinct employee_number_canonical(x) k from unnest(array[${g.map(lit).join(",")}]) x`)).toHaveLength(1);
    }
    expect((await admin<{ c: string | null }>(`select employee_number_canonical(null) as c`))[0]!.c).toBe("");
  });

  it("an equivalent number is refused ACROSS companies, in any spelling, whichever path wrote it (insert, or changing a number); E003 is held globally", async () => {
    for (const company of [CO.uae, CO.ksa, CO.eu]) {
      for (const dup of ["E02", "e002", "E2", " e 0002 "]) expect(await code(hire(company, dup)), `${dup} in ${NAME[company]}`).toBe("23505");   // E2 is held by the UAE
    }
    for (const dup of ["E3", "e03", "E003", "e 0003"]) expect(await code(hire(CO.eu, dup)), dup).toBe("23505");   // Tasneem's E003, from Europe
    const other = await hire(CO.ksa, "E610");
    expect(await code(admin(`update employees set employee_number = 'e2' where id = '${other}'`))).toBe("23505");
    expect(await numberOf(other)).toBe("E610");
    expect(await code(hire(CO.eu, "l-01"))).toBe("23505");   // L-1 (UAE) holds L-001
    // the refusal is a sentence, not an index name, and names no one (the other employee may belong to a company the writer cannot see)
    const sentence = await message(hire(CO.eu, "e 003"));
    expect(sentence).toBe("Employee number E003 is already used by another employee, in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number, and one number belongs to one employee across Enginious. Use a different number.");
    expect(sentence).not.toMatch(/Tasneem|Fictional|employees_/);
    expect(await message(admin(`update employees set employee_number = 'E03' where id = '${other}'`))).toBe(sentence);
    expect(await code(hire(CO.eu, "E0044"))).toBe("ok");     // E0044 is E044: a different number
    expect(await code(hire(CO.ksa, "L-002"))).toBe("ok");
  });

  it("a NEW hire with no number is numbered by the database as an HR Admin of any company (E504, E505, E506, ...), also when the number is blank; the number is canonical", async () => {
    const asHr = (user: string, company: string, number: string | null) => db.asUserCommit(user, async (q) => (await q(`insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values (${number === null ? "null" : lit(number)}, '${company}', 'AE', 'Fictional', 'Hire${++n}', '2026-01-01') returning id, employee_number`)).rows[0] as { id: string; employee_number: string });
    expect((await asHr(HR.uae, CO.uae, null)).employee_number).toBe("E504");
    expect((await asHr(HR.ksa, CO.ksa, "")).employee_number).toBe("E505");
    expect((await asHr(HR.eu, CO.eu, "   ")).employee_number).toBe("E506");
    expect((await asHr(HR.uae, CO.uae, "  m 7 ")).employee_number).toBe("M007");   // a supplied number (import, script) is saved canonically and does not use the series
    expect((await admin<{ v: string }>(`select last_value::text v from employee_number_seq`))[0]!.v).toBe("506");
    // an HR Admin has no right to the sequence or the numbering function themselves
    await expect(db.asUser(HR.uae, (q) => q(`select next_employee_number()`))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(HR.uae, (q) => q(`select nextval('employee_number_seq')`))).rejects.toThrow(/permission denied/);
  });

  it("two hires saved AT THE SAME TIME in different companies get different numbers (each transaction holds its number open until the other has taken its own)", async () => {
    const results: string[] = [];
    const users: [string, string][] = [[HR.uae, CO.uae], [HR.ksa, CO.ksa], [HR.eu, CO.eu]];
    let inserted = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await Promise.all(users.map(([user, company]) => db.asUserCommit(user, async (q) => {
      const r = await q(`insert into employees (company_id, country_code, first_name, last_name, hire_date, employee_number) values ('${company}', 'AE', 'Fictional', 'Concurrent${++n}', '2026-01-01', null) returning employee_number`);
      results.push((r.rows[0] as { employee_number: string }).employee_number);
      if (++inserted === users.length) release();
      await gate;   // nobody commits until all three hold a number: genuinely simultaneous
    })));
    expect(new Set(results).size).toBe(3);
    // and a burst: 12 more at once across the three companies are all different
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const [user, company] = users[i % 3]!;
      return db.asUserCommit(user, async (q) => ((await q(`insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${company}', 'AE', 'Fictional', 'Burst${++n}', '2026-01-01') returning employee_number`)).rows[0] as { employee_number: string }).employee_number);
    }));
    expect(new Set(burst).size).toBe(12);
    const all = (await admin<{ k: string }>(`select employee_number_canonical(employee_number) k from employees where deleted_at is null`)).map((r) => r.k);
    expect(new Set(all).size).toBe(all.length);   // still unique across the whole table
  });

  it("numbers taken are RESERVED: a rolled-back hire, a failed hire and a removed employee's number are never given out again; a number typed by hand is skipped when the sequence reaches it", async () => {
    const next = async () => numberOf(await hire(CO.uae, null));
    const before = Number((await admin<{ v: string }>(`select last_value::text v from employee_number_seq`))[0]!.v);
    await db.asUser(HR.uae, (q) => q(`insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${CO.uae}', 'AE', 'Fictional', 'Rolledback', '2026-01-01')`));   // rolled back by the harness
    const gap = await next();
    expect(Number(gap.slice(1))).toBeGreaterThan(before + 1);   // the rolled-back hire used a number: a gap, never a reuse
    const removed = await hire(CO.eu, null, "deleted_at=now()");
    const removedNumber = await numberOf(removed);
    const afterRemoved = await next();
    expect(afterRemoved).not.toBe(removedNumber);
    expect(Number(afterRemoved.slice(1))).toBeGreaterThan(Number(removedNumber.slice(1)));
    // a hand-typed E-number ahead of the sequence is skipped, with the same canonical spelling
    const last = Number((await admin<{ v: string }>(`select last_value::text v from employee_number_seq`))[0]!.v);
    await hire(CO.ksa, `e0${last + 1}`);   // takes the very next number by hand (leading zero: still the same number)
    expect(await next()).toBe(`E${last + 2}`);
    // a number held by a REMOVED employee is skipped too (not reissued automatically)
    await admin(`select setval('employee_number_seq', ${last + 9}, true)`);
    await hire(CO.eu, `E${last + 10}`, "deleted_at=now()");
    expect(await next()).toBe(`E${last + 11}`);
  });

  it("no truncation after E999: E999, E1000, E1001 in order, still unique", async () => {
    await admin(`select setval('employee_number_seq', 998, true)`);
    const got: string[] = [];
    for (let i = 0; i < 3; i++) got.push(await numberOf(await hire(i % 2 ? CO.ksa : CO.eu, null)));
    expect(got).toEqual(["E999", "E1000", "E1001"]);
    expect(await code(hire(CO.uae, "e01000"))).toBe("23505");   // E01000 is E1000
  });

  it("a supplied or CHANGED number is saved canonically; an update that does not change the number never rewrites it (L-1 stays L-1, E2 stays E2); a number cannot be blanked", async () => {
    const created = await hire(CO.uae, "  m 8 ");
    expect(await numberOf(created)).toBe("M008");
    await admin(`update employees set employee_number = 'x02' where id = '${created}'`);
    expect(await numberOf(created)).toBe("X002");
    await admin(`update employees set job_title = 'Rigger' where id in ('${ids.l1}', '${ids.e2}')`);
    await admin(`update employees set employee_number = employee_number where id = '${ids.e2}'`);   // same value in the SET list: still untouched
    expect(await numberOf(ids.l1)).toBe("L-1");
    expect(await numberOf(ids.e2)).toBe("E2");
    expect(await code(admin(`update employees set employee_number = '   ' where id = '${created}'`))).toBe("23514");
    expect(await numberOf(created)).toBe("X002");
  });

  it("a removed employee's number may be reused by hand (the earlier decision), and restoring that employee onto a number a live employee now holds is refused", async () => {
    const gone = await hire(CO.uae, "R-9");
    await admin(`update employees set deleted_at = now() where id = '${gone}'`);
    expect(await code(hire(CO.eu, "r-009"))).toBe("ok");               // reuse of a removed number, in another company
    expect(await code(admin(`update employees set deleted_at = null, deleted_by = null where id = '${gone}'`))).toBe("23505");
    expect(await message(admin(`update employees set deleted_at = null, deleted_by = null where id = '${gone}'`))).toBe("This employee cannot be restored: employee number R-009 is now used by another employee, in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number.");
    // as the signed-in HR Admin of the company (the restoreEmployee path), the same refusal
    await expect(db.asUser(HR.uae, (q) => q(`update employees set deleted_at = null, deleted_by = null where id = '${gone}'`))).rejects.toMatchObject({ code: "23505" });
    expect(await numberOf(gone)).toBe("R-009");
  });

  describe("access never touches the employee number", () => {
    const person = { user: id(), emp: "" };
    beforeAll(async () => {
      await admin(`insert into auth.users (id, email) values ('${person.user}', 'multi-company@numbers.test')`);
      person.emp = await hire(CO.uae, null, `user_id='${person.user}'`);   // hired by the UAE company; the login is linked
    });

    it("roles in all three companies and module access in all three leave the employee row, its id, company, number and the series exactly as they were; no second employee is created", async () => {
      const snapshot = async () => ({
        row: (await admin<Row>(`select id, user_id, company_id, employee_number, employment_status, deleted_at from employees where id = '${person.emp}'`))[0],
        count: (await admin<{ n: string }>(`select count(*) n from employees`))[0]!.n,
        linked: (await admin<{ n: string }>(`select count(*) n from employees where user_id = '${person.user}'`))[0]!.n,
        seq: (await admin<{ v: string; c: boolean }>(`select last_value::text v, is_called c from employee_number_seq`))[0],
      });
      const before = await snapshot();
      expect(before.row!.employee_number).toMatch(/^E\d{3,}$/);
      // People & Access, role assignment (the assignRole path: a System Administrator inserts user_roles) in every company
      for (const co of [CO.uae, CO.ksa, CO.eu]) {
        await db.asUserCommit(SYSADMIN, (q) => q(`insert into user_roles (user_id, role, company_id) values ('${person.user}', 'hr_admin', '${co}')`));
        await db.asUserCommit(SYSADMIN, (q) => q(`insert into user_roles (user_id, role, company_id) values ('${person.user}', 'ceo', '${co}')`));
      }
      // People & Access, module access (the applyModuleAccess path: a founder grants Projects access) in every company
      for (const co of [CO.uae, CO.ksa, CO.eu]) {
        await admin(`insert into proj_company_grants (user_id, company_id, capabilities, note) values ('${SYSADMIN}', '${co}', '{founder}', 'test founder') on conflict (user_id, company_id) where revoked_at is null do nothing`);
        await db.asUserCommit(SYSADMIN, (q) => q(`select proj_grant_access('${person.user}', '${co}', '{}', 'all three companies')`));
      }
      expect((await admin<{ n: string }>(`select count(*) n from user_roles where user_id = '${person.user}'`))[0]!.n).toBe("6");
      expect((await admin<{ n: string }>(`select count(*) n from proj_company_grants where user_id = '${person.user}' and revoked_at is null`))[0]!.n).toBe("3");
      expect(await snapshot()).toEqual(before);
      // removing access afterwards changes nothing either
      const grants = await admin<{ id: string }>(`select id from user_roles where user_id = '${person.user}'`);
      for (const g of grants) await db.asUserCommit(SYSADMIN, (q) => q(`select revoke_role_grant('${g.id}')`));
      expect(await snapshot()).toEqual(before);
    });
  });

  it("the packs behave as documented: preflight, verify (every row OK) and rollback (restores the per-company index, changes no number, forgets nothing it should keep, safe twice)", async () => {
    const pre = (await db.seed(manual("people_hr_employee_number_05_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[1]!.result).toMatch(/^already installed/);
    const verify = await admin<{ item: string; result: string }>(manual("people_hr_employee_number_20_verify_readonly.sql"));
    expect(verify).toHaveLength(6);
    expect(verify.filter((r) => r.result !== "OK")).toEqual([]);
    const recorded = await admin<Row>(`select id, employee_number from employees order by id`);
    await db.seed(manual("people_hr_employee_number_90_rollback.sql"));
    await db.seed(manual("people_hr_employee_number_90_rollback.sql"));
    expect(await admin<Row>(`select id, employee_number from employees order by id`)).toEqual(recorded);
    expect(await state()).toEqual({ fn: false, seq: false, idx: false, old: true });
    await db.applyMigration(MIGRATION);   // and it applies again, and the series restarts above everything still held
    expect(await state()).toEqual({ fn: true, seq: true, idx: true, old: false });
    expect((await admin<{ result: string }>(manual("people_hr_employee_number_20_verify_readonly.sql"))).every((r) => r.result === "OK")).toBe(true);
    expect(Number((await numberOf(await hire(CO.eu, null))).slice(1))).toBeGreaterThan(1001);
  });
});
