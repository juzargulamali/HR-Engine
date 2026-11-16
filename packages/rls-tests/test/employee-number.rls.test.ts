import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Employee numbers (migration 20270117000100_people_hr_employee_number_unique.sql): ONE shared series across Enginious UAE, Saudi Arabia and Europe, PERMANENTLY RESERVED FROM NOW for ACTIVE or INVITED employees,
// against a real Postgres. Fictional data throughout.
//   * "active or invited" = not removed, not terminated, login not deactivated (no login yet or an invited login counts). Removed, terminated and deactivated-login records are IGNORED: no reservation, no
//     collision, their numbers are free;
//   * the SQL function gives exactly the canonical forms in supabase/tests/employee-number-vectors.json (the same file the app's normaliser is tested against);
//   * BEFORE the migration there are equivalent numbers among active/invited employees (within and across companies): the audit pack reports them (E003 checked globally; ignored records counted, not collisions),
//     the preflight says STOP, the migration REFUSES and changes nothing, existing numbers stay as recorded; the owner approves specific corrections; the migration then applies and reserves every active/invited number;
//   * after that: a number is reserved for the record it was first given to, for good (also when its employee resigns, is terminated, removed or deleted for good, or the number is corrected away): refused for anyone
//     else by every path (hand, script, import, correction); automatic numbering skips it even if the sequence is rewound; restoring or rehiring the SAME record keeps its number; an ignored record that is brought back
//     claims its number or is refused if another employee holds it; every number nobody active/invited holds is free;
//   * a new hire is numbered by the database (two hires at once in different companies get different numbers; no truncation after E999); a supplied or changed number is saved canonically, an unchanged one is never rewritten;
//   * giving someone access to all three companies never creates an employee row, never changes the employee's id, company or number, and never takes a number from the series;
//   * AUTOMATIC NUMBERING takes the LOWEST free number from a pool built ONCE from the ignored records (E-series only, normalised, deduplicated, never a number an active or invited employee holds), claimed
//     atomically (simultaneous hires get different numbers), reserved permanently for the employee; when the pool is empty the sequence takes over above the highest reserved E-number; gaps outside the pool are left alone;
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
const RESERVED = (n: string) => `Employee number ${n} is reserved for another employee (current, removed or former), in this or another company. Numbers that differ only in capitals, spaces or leading zeros are the same number, and a number is never reused. Use a different number.`;

describe("Employee numbers: one shared series, permanently reserved from now, assigned by the database", () => {
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
  const login = async (status: "invited" | "active" | "deactivated") => {   // a login for an employee: profiles are created 'invited' by the auth trigger
    const u = id();
    await admin(`insert into auth.users (id, email) values ('${u}', 'p${++n}@numbers.test')`);
    if (status !== "invited") await admin(`update profiles set account_status = '${status}' where id = '${u}'`);
    return u;
  };
  const numberOf = async (empId: string | undefined) => (await admin<{ employee_number: string }>(`select employee_number from employees where id = '${empId}'`))[0]!.employee_number;
  const ownerOf = async (key: string) => (await admin<{ employee_id: string }>(`select employee_id from employee_number_reservations where number_key = ${lit(key)}`))[0]?.employee_id;
  const auditRows = async () => await admin<Row>(manual("people_hr_employee_number_00_audit_readonly.sql"));
  const summaryOf = (rows: Row[]) => Object.fromEntries(rows.filter((r) => r.kind === "SUMMARY").map((r) => [r.group_key, r.number_as_recorded]));
  const BLOCK = "groups that block the migration (active or invited employees, any companies)";
  const state = async () => (await admin<Row>(`select to_regprocedure('public.employee_number_canonical(text)') is not null as fn, to_regclass('public.employee_number_seq') is not null as seq, to_regclass('public.employees_company_employee_number_unique') is not null as old`))[0];
  const seqLast = async () => Number((await admin<{ v: string }>(`select last_value::text v from employee_number_seq`))[0]!.v);
  const asHr = (user: string, company: string, number: string | null) => db.asUserCommit(user, async (q) => (await q(`insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values (${number === null ? "null" : lit(number)}, '${company}', 'AE', 'Fictional', 'Hire${++n}', '2026-01-01') returning id, employee_number`)).rows[0] as { id: string; employee_number: string });
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);   // every migration BEFORE this one: the per-company partial exact-match index only
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', '${NAME[CO.uae]}', 'AE', 'AED'), ('${CO.ksa}', '${NAME[CO.ksa]}', 'SA', 'SAR'), ('${CO.eu}', '${NAME[CO.eu]}', 'PL', 'PLN');
      insert into auth.users (id, email) values ('${HR.uae}', 'hr-uae@numbers.test'), ('${HR.ksa}', 'hr-ksa@numbers.test'), ('${HR.eu}', 'hr-eu@numbers.test'), ('${SYSADMIN}', 'sysadmin@numbers.test');
      insert into user_roles (user_id, role, company_id) values ('${HR.uae}', 'hr_admin', '${CO.uae}'), ('${HR.ksa}', 'hr_admin', '${CO.ksa}'), ('${HR.eu}', 'hr_admin', '${CO.eu}');
      insert into user_roles (user_id, role) values ('${SYSADMIN}', 'sys_admin');
    `);
    // ACTIVE or INVITED employees: today's data. The per-company index allows every collision here (a different company or a different spelling is not an exact match).
    ids.e2 = await hire(CO.uae, "E2");                                                    // class A, across companies: UAE E2, Saudi E002, Europe e02
    ids.e002 = await hire(CO.ksa, "E002");
    ids.e02 = await hire(CO.eu, "e02");
    ids.tasneem = await hire(CO.uae, "E003");                                             // E003 was only ever checked within one company: an INVITED Saudi employee holds E03
    ids.e03 = await hire(CO.ksa, "E03", `user_id='${await login("invited")}'`);
    ids.e7a = await hire(CO.uae, "E7");                                                   // class A within ONE company
    ids.e7b = await hire(CO.uae, "e007");
    ids.l1 = await hire(CO.uae, "L-1");                                                   // outside the E-series: left as recorded
    ids.di9 = await hire(CO.ksa, "DI-9");
    ids.k5live = await hire(CO.uae, "k-005");
    ids.live120 = await hire(CO.ksa, "E120");
    ids.inv130 = await hire(CO.eu, "E130", `user_id='${await login("invited")}'`);        // an invited employee: the highest in-scope E-number
    // IGNORED records (test accounts): removed, terminated, or with a deactivated login
    ids.e3gone = await hire(CO.eu, "E3", "deleted_at=now()");                             // shares E003 with an active employee: NOT a collision
    ids.k5 = await hire(CO.uae, "K-5", "deleted_at=now()");                               // shares K-005 with an active employee
    ids.z1 = await hire(CO.eu, "Z-1", "deleted_at=now()");
    ids.z2 = await hire(CO.ksa, "z-001", "employment_status='terminated'");
    ids.top = await hire(CO.eu, "E0450", "deleted_at=now()");                             // a removed test account holds a high E-number: it must NOT push the series up
    ids.term460 = await hire(CO.uae, "E0460", "employment_status='terminated'");
    ids.deact = await hire(CO.eu, "E2", `user_id='${await login("deactivated")}'`);       // a deactivated login still shows E002
    ids.p5 = await hire(CO.uae, "E5", "deleted_at=now()");                                // the POOL: E005 (shown in two spellings, merged), E012, E450, E460; E130 is held by an invited employee: not in it
    ids.p5b = await hire(CO.ksa, "e05", "employment_status='terminated'");
    ids.p12 = await hire(CO.eu, "E12", "deleted_at=now()");
    ids.ign130 = await hire(CO.uae, "E0130", "deleted_at=now()");
  }, 60_000);

  afterAll(async () => { await db.teardown(); });

  it("BEFORE the migration the audit pack covers active and invited employees in ALL companies, reports each blocking group (E003 checked globally), counts the ignored records without treating them as collisions, and changes nothing", async () => {
    const before = await admin<Row>(`select employee_number from employees order by id`);
    const rows = await auditRows();
    const summary = summaryOf(rows);
    expect(summary[BLOCK]).toBe("3");
    expect(summary["  of which across different companies"]).toBe("2");
    expect(summary["active or invited employees audited (all companies)"]).toBe("12");
    expect(summary["  of which invited (login not yet accepted)"]).toBe("2");
    expect(summary["records ignored (removed, terminated or deactivated login): not reserved, not collisions"]).toBe("11");
    expect(summary["  of which share a number with an active or invited employee (information; the active one keeps it)"]).toBe("4");
    expect(summary["active or invited employees holding E003 or an equivalent spelling"]).toBe("2");
    expect(summary["highest E-number an active or invited employee holds"]).toBe("E130");   // the ignored E450 and E460 do not count
    expect(summary["SEQUENCE FALLBACK, used once the pool is empty: the first number it would give out"]).toBe("E131");
    expect(summary["automatic numbering POOL: numbers handed out first, lowest first (from the ignored records)"]).toBe("4");
    expect(summary["  ignored records whose numbers went into the pool (spelling variants and duplicates merged)"]).toBe("5");
    expect(summary["  left out of the pool: numbers held by an active or invited employee"]).toBe("4");
    expect(summary["  left out of the pool: numbers not in the E series"]).toBe("1");
    expect(summary["the NEXT number a new hire would be given"]).toBe("E005");
    const coll = rows.filter((r) => r.kind === "COLLISION");
    expect(coll.every((r) => r.class === "A" && (r.standing === "active" || r.standing === "invited"))).toBe(true);
    expect(coll.filter((r) => r.group_key === "E002").map((r) => r.number_as_recorded).sort()).toEqual(["E002", "E2", "e02"]);   // three companies; the deactivated login's E2 is NOT in it
    expect(new Set(coll.filter((r) => r.group_key === "E002").map((r) => r.company))).toEqual(new Set(Object.values(NAME)));
    expect(coll.filter((r) => r.group_key === "E003").map((r) => `${r.number_as_recorded}:${r.standing}`).sort()).toEqual(["E003:active", "E03:invited"]);   // the removed E3 is ignored
    expect(coll.filter((r) => r.group_key === "E007").map((r) => r.scope)).toEqual(["same company", "same company"]);
    expect(coll.some((r) => ["K-005", "Z-001"].includes(r.group_key))).toBe(false);   // ignored records are not collisions
    const e003 = rows.filter((r) => r.kind === "E003");
    expect(e003.map((r) => `${r.company}|${r.number_as_recorded}|${r.standing}`).sort()).toEqual([`${NAME[CO.eu]}|E3|ignored: removed`, `${NAME[CO.ksa]}|E03|invited`, `${NAME[CO.uae]}|E003|active`].sort());
    expect(rows.some((r) => r.kind === "NOT STANDARD" && r.scope === "outside series" && r.number_as_recorded === "DI-9")).toBe(true);
    expect(rows.some((r) => r.kind === "NOT STANDARD" && r.scope === "not canonical" && r.number_as_recorded === "E2" && r.group_key === "E002")).toBe(true);
    const poolRows = rows.filter((r) => r.kind === "POOL");
    expect(poolRows.map((r) => `${r.scope}|${r.group_key}|${r.number_as_recorded}`)).toEqual(["position 1 of 4|E005|E5, e05", "position 2 of 4|E012|E12", "position 3 of 4|E450|E0450", "position 4 of 4|E460|E0460"]);
    expect(poolRows.map((r) => r.group_key)).not.toContain("E003");
    const out = rows.filter((r) => r.kind === "POOL LEFT OUT");
    expect(out.find((r) => r.group_key === "E003")).toMatchObject({ scope: "held by an active or invited employee", number_as_recorded: "E3" });
    expect(out.find((r) => r.group_key === "E130")).toMatchObject({ scope: "held by an active or invited employee" });
    expect(out.find((r) => r.group_key === "Z-001")).toMatchObject({ scope: "not in the E series" });
    expect(await admin<Row>(`select employee_number from employees order by id`)).toEqual(before);   // read only
  });

  it("BEFORE the migration the preflight says STOP (3 groups, 7 employees; ignored records not counted) and the migration refuses with that count and changes nothing: no function, no sequence, no table, the old index stays, every number as recorded", async () => {
    const pre = (await db.seed(manual("people_hr_employee_number_05_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[0]!.result).toBe("OK");
    expect(pre[1]!.result).toBe("not installed yet");
    expect(pre[2]!.result).toMatch(/^STOP - 3 group\(s\) of equivalent numbers \(7 employees\)/);
    expect(pre[3]!.result).toBe("12");
    expect(pre[4]!.result).toBe("11");
    expect(pre[5]!.result).toBe("E131");
    expect(pre[6]!.result).toBe("4");
    expect(pre[7]!.result).toBe("E005");
    const msg = await message(db.applyMigration(MIGRATION));
    expect(msg).toMatch(/STOP: 3 group\(s\) of equivalent employee numbers \(7 active or invited employees\) exist across the companies/);
    expect(await state()).toEqual({ fn: false, seq: false, old: true });
    expect((await admin<{ t: string | null }>(`select to_regclass('public.employee_number_reservations')::text t`))[0]!.t).toBeNull();
    expect(await numberOf(ids.e2)).toBe("E2");
    expect(await numberOf(ids.e02)).toBe("e02");
  });

  it("the owner approves specific corrections one employee at a time; the audit shows the blockers go down, and every other number (the ignored records' too) stays as recorded", async () => {
    const fix = async (key: string, to: string) => admin(`update employees set employee_number = '${to}' where id = '${ids[key]}'`);
    await fix("e002", "E500"); await fix("e02", "E501");                 // E002 group: UAE E2 keeps it
    expect(summaryOf(await auditRows())[BLOCK]).toBe("2");
    await fix("e03", "E502");                                             // the invited Saudi employee is renumbered: Tasneem keeps E003
    expect(summaryOf(await auditRows())[BLOCK]).toBe("1");
    await fix("e7b", "E503");
    expect(summaryOf(await auditRows())[BLOCK]).toBe("0");
    for (const [key, was] of [["e2", "E2"], ["tasneem", "E003"], ["l1", "L-1"], ["di9", "DI-9"], ["k5live", "k-005"], ["e3gone", "E3"], ["k5", "K-5"], ["z2", "z-001"], ["deact", "E2"]] as const) {
      expect(await numberOf(ids[key]), key).toBe(was);
    }
  });

  it("with no blocking group the preflight is OK and the migration applies: no existing number is rewritten, every ACTIVE or INVITED employee's number is reserved for them, ignored records get no reservation, and the series starts above the active numbers only", async () => {
    const pre = (await db.seed(manual("people_hr_employee_number_05_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[2]!.result).toBe("OK");
    expect(pre[5]!.result).toBe("E504");   // the sequence fallback
    expect(pre[6]!.result).toBe("4");
    expect(pre[7]!.result).toBe("E005");   // the pool's lowest
    const recorded = await admin<Row>(`select id, employee_number from employees order by id`);
    // Supabase grants table and sequence privileges to the signed-in role by DEFAULT when an object is created; the harness's grants file does the same for the objects that exist. It runs BEFORE this migration
    // (as on a real project the new objects are created afterwards and this file's own revokes are what keep people away from them).
    await db.seed(readFileSync(path.join(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8"));
    await db.applyMigration(MIGRATION);
    expect(await admin<Row>(`select id, employee_number from employees order by id`)).toEqual(recorded);
    expect(await state()).toEqual({ fn: true, seq: true, old: false });
    expect(await seqLast()).toBe(503);                                                  // above the active E503; the ignored E450 and E460 are not counted
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_reservations`))[0]!.n).toBe("12");
    expect(await ownerOf("E002")).toBe(ids.e2);
    expect(await ownerOf("E003")).toBe(ids.tasneem);
    expect(await ownerOf("E502")).toBe(ids.e03);                                        // the invited employee's corrected number
    expect(await ownerOf("K-005")).toBe(ids.k5live);
    expect(await ownerOf("E130")).toBe(ids.inv130);                                     // an invited employee
    for (const k of ["E450", "E460", "Z-001", "K-005X", "E003X"]) expect(await ownerOf(k), `${k} is ignored`).toBeUndefined();
    await expect(db.asUser(HR.uae, (q) => q(`select * from employee_number_reservations`))).rejects.toThrow(/permission denied/);   // nobody reads or writes it directly
    // the pool, built once at the migration from the ignored records: normalised, deduplicated, E-series only, never a number an active or invited employee holds
    const pool = await admin<{ number_key: string; claimed_by: string | null }>(`select number_key, claimed_by from employee_number_pool order by number_value`);
    expect(pool.map((r) => r.number_key)).toEqual(["E005", "E012", "E450", "E460"]);
    expect(pool.every((r) => r.claimed_by === null)).toBe(true);
    for (const k of ["E003", "E002", "E130", "K-005", "Z-001"]) expect(pool.map((r) => r.number_key), `${k} cannot be in the pool`).not.toContain(k);
    expect((await admin<Row>(`select pool_size, sequence_start::text from employee_number_allocation`))[0]).toEqual({ pool_size: 4, sequence_start: "503" });
    await expect(db.asUser(HR.uae, (q) => q(`select * from employee_number_pool`))).rejects.toThrow(/permission denied/);
    // the status pack shows the same pool in the same order, the next number and the fallback
    const status = await admin<{ kind: string; item: string; value: string }>(manual("people_hr_employee_number_25_pool_status_readonly.sql"));
    const sv = Object.fromEntries(status.filter((r) => r.kind === "SUMMARY").map((r) => [r.item, r.value]));
    expect(sv["free now (handed out first, lowest first)"]).toBe("4");
    expect(sv["claimed so far (given to an employee)"]).toBe("0");
    expect(sv["the NEXT number a new hire will be given"]).toBe("E005");
    expect(sv["sequence fallback: the highest reserved E-number at rollout"]).toBe("E503");
    expect(sv["sequence fallback: first number it would give out next (before skipping reserved numbers)"]).toBe("E504");
    expect(status.filter((r) => r.kind === "POOL").map((r) => r.value)).toEqual(["E005", "E012", "E450", "E460"]);
  });

  it("AUTOMATIC NUMBERING takes the lowest free pool number, atomically: a hire that fails gives its number back; a pool number entered by hand is skipped; hires at the same moment in different companies each get a different one (the lowest three)", async () => {
    await db.asUser(HR.uae, (q) => q(`insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${CO.uae}', 'AE', 'Fictional', 'Rolledback', '2026-01-01')`));   // rolled back by the harness
    expect((await admin<{ c: string | null }>(`select claimed_by::text c from employee_number_pool where number_key = 'E005'`))[0]!.c).toBeNull();
    const byHand = await hire(CO.ksa, "e12");   // somebody enters E012 by hand: it is reserved, so the pool skips it
    expect(await numberOf(byHand)).toBe("E012");
    const results: string[] = [];
    const users: [string, string][] = [[HR.uae, CO.uae], [HR.ksa, CO.ksa], [HR.eu, CO.eu]];
    let inserted = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await Promise.all(users.map(([user, company]) => db.asUserCommit(user, async (q) => {
      const r = await q(`insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${company}', 'AE', 'Fictional', 'Pooled${++n}', '2026-01-01') returning employee_number`);
      results.push((r.rows[0] as { employee_number: string }).employee_number);
      if (++inserted === users.length) release();
      await gate;   // nobody commits until all three hold a number: genuinely simultaneous
    })));
    expect([...results].sort()).toEqual(["E005", "E450", "E460"]);        // different numbers: the lowest three free ones (E012 was taken by hand)
    const claimed = await admin<{ number_key: string; claimed_by: string }>(`select number_key, claimed_by from employee_number_pool where claimed_by is not null order by number_value`);
    expect(claimed.map((r) => r.number_key)).toEqual(["E005", "E450", "E460"]);
    for (const c of claimed) {
      expect(await ownerOf(c.number_key)).toBe(c.claimed_by);             // reserved for the employee it was given to, for good
      expect(await numberOf(c.claimed_by)).toBe(c.number_key);
    }
  });

  it("when the pool is empty the shared sequence takes over above the highest reserved E-number at rollout (E504); gaps outside the pool are left alone; the status pack says so", async () => {
    expect(await numberOf(await hire(CO.eu, null))).toBe("E504");
    expect(await numberOf(await hire(CO.ksa, null))).toBe("E505");
    for (const gap of ["E006", "E011", "E013", "E100", "E449"]) expect(await ownerOf(gap), `${gap} is a gap outside the pool: left alone`).toBeUndefined();
    const status = await admin<{ kind: string; item: string; value: string }>(manual("people_hr_employee_number_25_pool_status_readonly.sql"));
    const sv = Object.fromEntries(status.filter((r) => r.kind === "SUMMARY").map((r) => [r.item, r.value]));
    expect(sv["free now (handed out first, lowest first)"]).toBe("0");
    expect(sv["claimed so far (given to an employee)"]).toBe("3");
    expect(sv["the NEXT number a new hire will be given"]).toMatch(/^E506 \(sequence fallback/);
    expect(status.filter((r) => r.kind === "POOL")).toHaveLength(0);
    expect(status.filter((r) => r.kind === "CLAIMED")).toHaveLength(3);
  });

  it("a number like Tasneem's E003 cannot enter the pool: not at the build, and not when its holder leaves LATER (the pool is built once; their number stays reserved)", async () => {
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_pool where number_key in ('E003', 'E002', 'E130', 'E503', 'E502')`))[0]!.n).toBe("0");
    await admin(`update employees set employment_status = 'terminated', termination_date = current_date where id = '${ids.tasneem}'`);   // she leaves after the rollout
    await admin(`update employees set deleted_at = now() where id = '${ids.inv130}'`);                                                      // and an invited employee is removed
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_pool`))[0]!.n).toBe("4");                                  // the pool did not grow
    expect(await ownerOf("E003")).toBe(ids.tasneem);
    expect(await ownerOf("E130")).toBe(ids.inv130);
    expect(await code(hire(CO.eu, "E003"))).toBe("23505");                                                                                 // still hers
    expect(await code(hire(CO.eu, "E130"))).toBe("23505");
    for (let i = 0; i < 3; i++) expect(["E003", "E130"]).not.toContain(await numberOf(await hire(CO.uae, null)));                            // and never handed out automatically
    await admin(`update employees set employment_status = 'active', termination_date = null, deleted_at = null where id in ('${ids.tasneem}', '${ids.inv130}')`);   // back, with the same numbers
    expect(await numberOf(ids.tasneem)).toBe("E003");
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

  it("a number held by an active or invited employee is refused ACROSS companies, in any spelling, by every path; the refusal is a sentence that names no one", async () => {
    for (const company of [CO.uae, CO.ksa, CO.eu]) {
      for (const dup of ["E02", "e002", "E2", " e 0002 "]) expect(await code(hire(company, dup)), `${dup} in ${NAME[company]}`).toBe("23505");   // E2 is held by the UAE
    }
    for (const dup of ["E3", "e03", "E003", "e 0003"]) expect(await code(hire(CO.eu, dup)), dup).toBe("23505");   // Tasneem's E003, from Europe
    for (const dup of ["E502", "e0502", "E130"]) expect(await code(hire(CO.uae, dup)), dup).toBe("23505");       // invited employees' numbers
    expect(await code(hire(CO.eu, "l-01"))).toBe("23505");   // L-1 (UAE) holds L-001
    expect(await code(hire(CO.eu, "K-5"))).toBe("23505");    // k-005 is held by an active employee
    const sentence = await message(hire(CO.eu, "e 003"));
    expect(sentence).toBe(RESERVED("E003"));
    expect(sentence).not.toMatch(/Tasneem|Fictional|employees_/);
    const other = await hire(CO.ksa, "E610");
    expect(await code(admin(`update employees set employee_number = 'e2' where id = '${other}'`))).toBe("23505");   // a correction into a reserved number
    expect(await message(admin(`update employees set employee_number = 'E130' where id = '${other}'`))).toBe(RESERVED("E130"));
    expect(await numberOf(other)).toBe("E610");
    expect(await code(hire(CO.eu, "E0044"))).toBe("ok");     // E0044 is E044: a different number
    expect(await code(hire(CO.ksa, "L-002"))).toBe("ok");
  });

  it("every number nobody active or invited holds is AVAILABLE, including the numbers of removed, terminated and deactivated test records; and bringing such a record back claims its number or is refused", async () => {
    expect(await code(hire(CO.ksa, "Z-1"))).toBe("ok");         // a removed test account's number outside the E series is free
    expect(await code(hire(CO.uae, "E0300"))).toBe("ok");       // so is any number nobody active holds (a gap outside the pool)
    expect(await code(hire(CO.uae, "E450"))).toBe("23505");     // E450 and E460 were in the pool and have been handed out (reserved for the employees who got them)
    expect(await code(hire(CO.eu, "E460"))).toBe("23505");
    // those ignored test records, brought back, now meet a reservation held by someone else
    expect(await message(admin(`update employees set deleted_at = null where id = '${ids.top}'`))).toBe(RESERVED("E450"));
    expect(await code(admin(`update employees set employment_status = 'active' where id = '${ids.term460}'`))).toBe("23505");
    expect(await code(admin(`update employees set deleted_at = null where id = '${ids.z1}'`))).toBe("23505");
    // a deactivated login reactivated whose number an active employee holds: refused, and the login stays deactivated
    const deactUser = (await admin<{ user_id: string }>(`select user_id from employees where id = '${ids.deact}'`))[0]!.user_id;
    expect(await message(admin(`update profiles set account_status = 'active' where id = '${deactUser}'`))).toBe(RESERVED("E002"));
    expect((await admin<{ s: string }>(`select account_status::text s from profiles where id = '${deactUser}'`))[0]!.s).toBe("deactivated");
    // an ignored record whose number nobody took is brought back and keeps it (claiming it)
    const free = await hire(CO.uae, "R-77", "deleted_at=now()");
    await admin(`delete from employee_number_reservations where employee_id = '${free}'`);   // (a record the rule never saw: its insert reserved R-077, as everything created after rollout; forget it to mimic a pre-rollout test account)
    await db.asUserCommit(HR.uae, (q) => q(`update employees set deleted_at = null, deleted_by = null where id = '${free}'`));
    expect(await numberOf(free)).toBe("R-077");
    expect(await ownerOf("R-077")).toBe(free);
    const freeUser = await login("deactivated");
    const g7 = await hire(CO.ksa, "G-7", `user_id='${freeUser}'`);
    await admin(`delete from employee_number_reservations where employee_id = '${g7}'`);
    await admin(`update profiles set account_status = 'active' where id = '${freeUser}'`);   // reactivated: claims G-007
    expect(await ownerOf("G-007")).toBe(g7);
  });

  it("an IMPORT is held to the same rule: a statement that supplies an equivalent number twice, or one reserved number among many, fails as a whole and saves nothing; many blank numbers get different numbers", async () => {
    const row = (num: string | null) => `(${num === null ? "null" : lit(num)}, '${CO.ksa}', 'AE', 'Fictional', 'Import${++n}', '2024-01-01')`;
    const cols = "(employee_number, company_id, country_code, first_name, last_name, hire_date)";
    const count = async () => (await admin<{ n: string }>(`select count(*) n from employees`))[0]!.n;
    const before = await count();
    expect(await code(admin(`insert into employees ${cols} values ${row("E800")}, ${row("e0800")}`))).toBe("23505");   // equivalent to each other
    expect(await code(admin(`insert into employees ${cols} values ${row("E801")}, ${row("E003")}, ${row("E802")}`))).toBe("23505");   // one reserved number
    expect(await count()).toBe(before);
    expect(await admin(`select 1 from employee_number_reservations where number_key in ('E800', 'E801', 'E802')`)).toHaveLength(0);   // and none was reserved by the failed statements
    await admin(`insert into employees ${cols} values ${row(null)}, ${row(null)}, ${row(null)}`);
    const got = await admin<{ employee_number: string }>(`select employee_number from employees where first_name = 'Fictional' and last_name like 'Import%' order by employee_number`);
    expect(new Set(got.map((r) => r.employee_number)).size).toBe(3);
  });

  it("a NEW hire with no number is numbered by the database as an HR Admin of any company, also when the number is blank; the number is canonical; the series is closed to signed-in users", async () => {
    const start = await seqLast();
    const a = Number((await asHr(HR.uae, CO.uae, null)).employee_number.slice(1));
    expect(a).toBeGreaterThan(start);
    const b = Number((await asHr(HR.ksa, CO.ksa, "")).employee_number.slice(1));
    const c = Number((await asHr(HR.eu, CO.eu, "   ")).employee_number.slice(1));
    expect([b > a, c > b]).toEqual([true, true]);
    expect((await asHr(HR.uae, CO.uae, "  m 7 ")).employee_number).toBe("M007");   // a supplied number (import, script) is saved canonically and does not use the series
    await expect(db.asUser(HR.uae, (q) => q(`select next_employee_number('00000000-0000-0000-0000-000000000000')`))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(HR.uae, (q) => q(`select nextval('employee_number_seq')`))).rejects.toThrow(/permission denied/);
  });

  it("the numbering counts E008, E009, E010, E011 and E098, E099, E100, E101: three digits at least, so E010 follows E009, E100 follows E099, and nothing is truncated", async () => {
    await admin(`select setval('employee_number_seq', 7, true)`);   // E001 to E007 are not needed: rewind to just before E008
    const got: string[] = [];
    for (let i = 0; i < 4; i++) got.push(await numberOf(await hire([CO.uae, CO.ksa, CO.eu][i % 3]!, null)));
    expect(got).toEqual(["E008", "E009", "E010", "E011"]);
    expect(await code(hire(CO.uae, "e10"))).toBe("23505");          // E10 is E010
    await admin(`select setval('employee_number_seq', 97, true)`);   // and E098, E099, then E100, E101 (E120 and E130 are held, but that is further on)
    const next: string[] = [];
    for (let i = 0; i < 4; i++) next.push(await numberOf(await hire([CO.eu, CO.ksa, CO.uae][i % 3]!, null)));
    expect(next).toEqual(["E098", "E099", "E100", "E101"]);
    expect(await code(hire(CO.eu, "e0100"))).toBe("23505");         // E0100 is E100
  });

  it("two hires saved AT THE SAME TIME in different companies get different numbers (each transaction holds its number open until the other has taken its own), a burst of 12 are all different, and two writers racing to hand-enter the same number in different spellings: exactly one wins", async () => {
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
    const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => {
      const [user, company] = users[i % 3]!;
      return db.asUserCommit(user, async (q) => ((await q(`insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${company}', 'AE', 'Fictional', 'Burst${++n}', '2026-01-01') returning employee_number`)).rows[0] as { employee_number: string }).employee_number);
    }));
    expect(new Set(burst).size).toBe(12);
    const race = await Promise.all(["E900", "e0900"].map((num, i) => code(db.asUserCommit(users[i]![0], (q) => q(`insert into employees (employee_number, company_id, country_code, first_name, last_name, hire_date) values ('${num}', '${users[i]![1]}', 'AE', 'Fictional', 'Race${++n}', '2026-01-01')`)))));
    expect(race.filter((r) => r === "ok")).toHaveLength(1);
    expect(race.filter((r) => r === "23505")).toHaveLength(1);
  });

  it("a CORRECTED number keeps its OLD number reserved for the same record: nobody else can take it, the series never gives it out even when rewound, and the record itself may return to it", async () => {
    const hired = await asHr(HR.uae, CO.uae, null);
    const oldNumber = hired.employee_number;
    await db.asUserCommit(HR.uae, (q) => q(`update employees set employee_number = 'e0700' where id = '${hired.id}'`));   // the correction, as the company's HR Admin
    expect(await numberOf(hired.id)).toBe("E700");
    expect(await ownerOf(oldNumber)).toBe(hired.id);                                    // the old number is still reserved for this record
    expect(await code(hire(CO.ksa, oldNumber.toLowerCase()))).toBe("23505");            // nobody else, in any company, in any spelling
    expect(await message(hire(CO.eu, oldNumber))).toBe(RESERVED(oldNumber));
    await admin(`select setval('employee_number_seq', ${Number(oldNumber.slice(1)) - 1}, true)`);   // rewind the series to just before the old number
    const next = await numberOf(await hire(CO.eu, null));
    expect(next).not.toBe(oldNumber);                                                    // skipped: reserved
    expect(Number(next.slice(1))).toBeGreaterThan(Number(oldNumber.slice(1)));
    await admin(`update employees set employee_number = '${oldNumber}' where id = '${hired.id}'`);   // the same record may go back to a number reserved for it
    expect(await numberOf(hired.id)).toBe(oldNumber);
    expect(await code(hire(CO.eu, "E700"))).toBe("23505");                               // and the number it moved through is still its own
  });

  it("a record deleted for good keeps its number reserved: not reusable by hand in any company, not given out again by the series; the same holds for the delete function HR Admin uses", async () => {
    const hired = await asHr(HR.ksa, CO.ksa, null);
    const number = hired.employee_number;
    await admin(`update employees set deleted_at = now() where id = '${hired.id}'`);                       // removed first (the delete function requires it)
    await db.asUserCommit(HR.ksa, (q) => q(`select permanently_delete_employee('${hired.id}')`));         // deleted for good, as the company's HR Admin
    expect(await admin(`select 1 from employees where id = '${hired.id}'`)).toHaveLength(0);
    expect(await ownerOf(number)).toBe(hired.id);                                                          // the reservation outlives the record
    expect(await code(hire(CO.uae, number))).toBe("23505");
    expect(await code(hire(CO.eu, number.toLowerCase()))).toBe("23505");
    expect(await message(asHr(HR.uae, CO.uae, number))).toBe(RESERVED(number));
    await admin(`select setval('employee_number_seq', ${Number(number.slice(1)) - 1}, true)`);
    const next = await numberOf(await hire(CO.uae, null));
    expect(next).not.toBe(number);
    expect(Number(next.slice(1))).toBeGreaterThan(Number(number.slice(1)));
  });

  it("someone who RESIGNS or is TERMINATED later keeps their number: it stays reserved (also while removed), is never available to others, and comes back with the same record on restore or rehire; a second record for the same person gets a new number", async () => {
    const hired = await asHr(HR.eu, CO.eu, null);
    const number = hired.employee_number;
    await admin(`update employees set employment_status = 'terminated', termination_date = current_date where id = '${hired.id}'`);   // resigns / is terminated
    expect(await code(hire(CO.uae, number))).toBe("23505");
    expect(await ownerOf(number)).toBe(hired.id);
    await admin(`update employees set deleted_at = now() where id = '${hired.id}'`);                       // and later removed
    expect(await code(hire(CO.ksa, number.toLowerCase()))).toBe("23505");
    await db.asUserCommit(HR.eu, (q) => q(`update employees set deleted_at = null, deleted_by = null where id = '${hired.id}'`));   // restored, as the company's HR Admin
    expect(await numberOf(hired.id)).toBe(number);
    await admin(`update employees set employment_status = 'active', termination_date = null where id = '${hired.id}'`);   // rehired: the same record
    expect(await numberOf(hired.id)).toBe(number);
    expect(await ownerOf(number)).toBe(hired.id);
    const second = await hire(CO.eu, null, "job_title='Rehired'");                                        // a NEW record for the same person is a new hire
    expect(await numberOf(second)).not.toBe(number);
    // and a login deactivated after the migration keeps its employee's number too
    const u = await login("active");
    const e = await hire(CO.ksa, null, `user_id='${u}'`);
    const eNumber = await numberOf(e);
    await admin(`update profiles set account_status = 'deactivated' where id = '${u}'`);
    expect(await code(hire(CO.eu, eNumber))).toBe("23505");
    await admin(`update profiles set account_status = 'active' where id = '${u}'`);                        // reactivated: same record, same number
    expect(await numberOf(e)).toBe(eNumber);
  });

  it("an update that does not change the number never rewrites it (L-1 stays L-1, E2 stays E2); a changed or supplied number is saved canonically; a number cannot be blanked", async () => {
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
    expect(await ownerOf("M008")).toBe(created);                                                    // M008 was reserved by the first save and is still this record's
  });

  it("no truncation after E999: E999, E1000, E1001 in order, still unique and reserved", async () => {
    await admin(`select setval('employee_number_seq', 998, true)`);
    const got: string[] = [];
    for (let i = 0; i < 3; i++) got.push(await numberOf(await hire(i % 2 ? CO.ksa : CO.eu, null)));
    expect(got).toEqual(["E999", "E1000", "E1001"]);
    expect(await code(hire(CO.uae, "e01000"))).toBe("23505");   // E01000 is E1000
  });

  describe("access never touches the employee number", () => {
    const person = { user: id(), emp: "" };
    beforeAll(async () => {
      await admin(`insert into auth.users (id, email) values ('${person.user}', 'multi-company@numbers.test')`);
      person.emp = await hire(CO.uae, null, `user_id='${person.user}'`);   // hired by the UAE company; the login is linked
    });

    it("roles in all three companies and module access in all three leave the employee row, its id, company, number, its reservation and the series exactly as they were; no second employee is created", async () => {
      const snapshot = async () => ({
        row: (await admin<Row>(`select id, user_id, company_id, employee_number, employment_status, deleted_at from employees where id = '${person.emp}'`))[0],
        count: (await admin<{ n: string }>(`select count(*) n from employees`))[0]!.n,
        linked: (await admin<{ n: string }>(`select count(*) n from employees where user_id = '${person.user}'`))[0]!.n,
        seq: (await admin<{ v: string; c: boolean }>(`select last_value::text v, is_called c from employee_number_seq`))[0],
        reservations: (await admin<{ n: string }>(`select count(*) n from employee_number_reservations`))[0]!.n,
      });
      const before = await snapshot();
      expect(before.row!.employee_number).toMatch(/^E\d{3,}$/);
      for (const co of [CO.uae, CO.ksa, CO.eu]) {
        await db.asUserCommit(SYSADMIN, (q) => q(`insert into user_roles (user_id, role, company_id) values ('${person.user}', 'hr_admin', '${co}')`));
        await db.asUserCommit(SYSADMIN, (q) => q(`insert into user_roles (user_id, role, company_id) values ('${person.user}', 'ceo', '${co}')`));
      }
      for (const co of [CO.uae, CO.ksa, CO.eu]) {
        await admin(`insert into proj_company_grants (user_id, company_id, capabilities, note) values ('${SYSADMIN}', '${co}', '{founder}', 'test founder') on conflict (user_id, company_id) where revoked_at is null do nothing`);
        await db.asUserCommit(SYSADMIN, (q) => q(`select proj_grant_access('${person.user}', '${co}', '{}', 'all three companies')`));
      }
      expect((await admin<{ n: string }>(`select count(*) n from user_roles where user_id = '${person.user}'`))[0]!.n).toBe("6");
      expect((await admin<{ n: string }>(`select count(*) n from proj_company_grants where user_id = '${person.user}' and revoked_at is null`))[0]!.n).toBe("3");
      expect(await snapshot()).toEqual(before);
      const grants = await admin<{ id: string }>(`select id from user_roles where user_id = '${person.user}'`);
      for (const g of grants) await db.asUserCommit(SYSADMIN, (q) => q(`select revoke_role_grant('${g.id}')`));
      expect(await snapshot()).toEqual(before);
    });
  });

  it("the packs behave as documented: preflight, verify (every row OK) and rollback (restores the per-company index, changes no number, KEEPS the reservations, safe twice); applying again reserves the active and invited numbers that exist then and the series restarts above everything reserved", async () => {
    const pre = (await db.seed(manual("people_hr_employee_number_05_preflight_readonly.sql"))).rows as { result: string }[];
    expect(pre[1]!.result).toMatch(/^already installed/);
    const verify = await admin<{ item: string; result: string }>(manual("people_hr_employee_number_20_verify_readonly.sql"));
    expect(verify).toHaveLength(10);
    expect(verify.filter((r) => r.result !== "OK")).toEqual([]);
    const recorded = await admin<Row>(`select id, employee_number from employees order by id`);
    const reserved = (await admin<{ n: string }>(`select count(*) n from employee_number_reservations`))[0]!.n;
    await db.seed(manual("people_hr_employee_number_90_rollback.sql"));
    await db.seed(manual("people_hr_employee_number_90_rollback.sql"));
    expect(await admin<Row>(`select id, employee_number from employees order by id`)).toEqual(recorded);
    expect(await state()).toEqual({ fn: false, seq: false, old: true });
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_reservations`))[0]!.n).toBe(reserved);   // the reservations survive a rollback
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_pool`))[0]!.n).toBe("4");   // the pool and its build record survive a rollback
    // while rolled back nothing reserves: a number is hand-entered by an active employee, and another test account appears (a deleted record)
    const meanwhile = await hire(CO.uae, "E3000");
    await hire(CO.eu, "E3500", "deleted_at=now()");
    await db.applyMigration(MIGRATION);   // and it applies again: the new active number is reserved, the old reservations are untouched, the series restarts above everything reserved
    expect(await state()).toEqual({ fn: true, seq: true, old: false });
    expect(await ownerOf("E3000")).toBe(meanwhile);
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_pool`))[0]!.n).toBe("4");   // the pool was NOT rebuilt: the later test account's E3500 did not enter it
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_pool where number_key = 'E3500'`))[0]!.n).toBe("0");
    expect((await admin<{ n: string }>(`select count(*) n from employee_number_reservations`))[0]!.n).not.toBe(reserved);
    expect((await admin<{ result: string }>(manual("people_hr_employee_number_20_verify_readonly.sql"))).every((r) => r.result === "OK")).toBe(true);
    expect(await code(hire(CO.eu, "E3000"))).toBe("23505");
    expect(Number((await numberOf(await hire(CO.eu, null))).slice(1))).toBeGreaterThan(3000);
  });
});
