import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The guided onboarding (migration 20270118000300_people_hr_onboarding.sql) on isolated fictional accounts:
//   * the PLAN (employee_onboarding_plans): HR Admin of the employee's company and an UNSCOPED System Administrator can write it; nobody else; no deletes; audited; it grants nothing;
//   * the SNAPSHOT (onboarding_access_snapshot): what the employee's account, roles and module rights ARE, shown to those two only and only for the companies they administer;
//   * one end-to-end pass through the same calls the screens make, with the person who is allowed to do each step: HR Admin saves the plan, an unrestricted System Administrator invites/links roles,
//     a Sales access manager applies the module right; the snapshot reflects each step and a repeat changes nothing; nothing creates a second employee row or takes a number.
const A = randomUUID();
const B = randomUUID();
const U = { hrA: randomUUID(), hrB: randomUUID(), sys: randomUUID(), scopedSys: randomUUID(), plain: randomUUID(), accessMgr: randomUUID(), newbie: randomUUID() };
const E = { newbie: randomUUID() };

describe("Onboarding plan and snapshot", () => {
  const db = new RlsTestDatabase();
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const admin = async (sql: string) => (await db.seed(sql)).rows as Row[];
  const as = async <T = Row[]>(user: string, sql: string): Promise<T> => (await db.asUserCommit(user, async (q) => (await q(sql)).rows)) as T;
  const attempt = async (user: string, sql: string) => { try { await as(user, sql); return "ok"; } catch (e) { return (e as Error).message; } };
  const snapshot = async (user: string, employeeId = E.newbie) => (await as<{ s: Row }[]>(user, `select onboarding_access_snapshot('${employeeId}') s`))[0]!.s;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${A}', 'Fictional Plan A', 'AE', 'AED'), ('${B}', 'Fictional Plan B', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@plan.test')`).join(", ")};
      update profiles set account_status = 'active' where id <> '${U.newbie}';
      insert into user_roles (user_id, role, company_id) values ('${U.hrA}', 'hr_admin', '${A}'), ('${U.hrB}', 'hr_admin', '${B}'), ('${U.scopedSys}', 'sys_admin', '${A}'), ('${U.accessMgr}', 'hr_admin', '${A}');
      insert into user_roles (user_id, role) values ('${U.sys}', 'sys_admin');
      insert into crm_company_grants (user_id, company_id, capabilities, note) values ('${U.accessMgr}', '${A}', '{manage_access}', 'test');
      insert into employees (id, company_id, country_code, first_name, last_name, hire_date, user_id) values ('${E.newbie}', '${A}', 'AE', 'New', 'Hire', '2026-01-01', '${U.newbie}');
    `);
  }, 90_000);
  afterAll(async () => { await db.teardown(); });

  it("the PLAN: HR Admin of the employee's company and an unscoped System Administrator can save it; another company's HR Admin, a company-scoped System Administrator, an access manager who is not HR Admin here, and a plain person cannot", async () => {
    const insert = (user: string, company = A) => attempt(user, `insert into employee_onboarding_plans (employee_id, company_id, invite_email, prepared_by) values ('${E.newbie}', '${company}', 'new.hire@plan.test', '${user}')`);
    expect(await insert(U.hrB)).toMatch(/row-level security/);
    expect(await insert(U.scopedSys)).toMatch(/row-level security/);
    expect(await insert(U.plain)).toMatch(/row-level security/);
    expect(await insert(U.hrA, B)).toMatch(/row-level security/);                 // a plan must carry the employee's OWN company
    expect(await insert(U.hrA)).toBe("ok");
    expect(await insert(U.sys)).toMatch(/duplicate key/);                         // one plan per employee: the unscoped System Administrator may write, but it is the same row
    expect(await attempt(U.sys, `update employee_onboarding_plans set invite_email = 'x@plan.test', updated_by = '${U.sys}' where employee_id = '${E.newbie}'`)).toBe("ok");
    expect(await attempt(U.hrB, `update employee_onboarding_plans set invite_email = 'evil@plan.test' where employee_id = '${E.newbie}'`)).toBe("ok");   // updates zero rows under row-level security
    expect((await admin(`select invite_email from employee_onboarding_plans`))[0]!.invite_email).toBe("x@plan.test");
    // no delete policy exists (and on a real project the migration also revokes the delete right; the test harness re-grants table rights after migrations): a delete removes nothing
    await attempt(U.hrA, `delete from employee_onboarding_plans where employee_id = '${E.newbie}'`);
    expect(Number((await admin(`select count(*) n from employee_onboarding_plans`))[0]!.n)).toBe(1);
    expect((await as(U.hrB, `select * from employee_onboarding_plans`)).length).toBe(0);   // and cannot read it
    expect((await as(U.hrA, `select * from employee_onboarding_plans`)).length).toBe(1);
    expect(Number((await admin(`select count(*) n from audit_log where table_name = 'employee_onboarding_plans'`))[0]!.n)).toBeGreaterThanOrEqual(2);
  });

  it("the SNAPSHOT is shown only to HR Admin of that company and unscoped System Administrators; everyone else is refused", async () => {
    expect(await attempt(U.hrB, `select onboarding_access_snapshot('${E.newbie}')`)).toMatch(/You cannot see onboarding for this employee/);
    expect(await attempt(U.plain, `select onboarding_access_snapshot('${E.newbie}')`)).toMatch(/You cannot see onboarding/);
    expect(await attempt(U.scopedSys, `select onboarding_access_snapshot('${E.newbie}')`)).toMatch(/You cannot see onboarding/);
    expect(await attempt(U.accessMgr, `select onboarding_access_snapshot('${E.newbie}')`)).toBe("ok");   // (also HR Admin of A in this fixture)
    const s = await snapshot(U.hrA);
    expect(s).toMatchObject({ employeeId: E.newbie, companyId: A, account: { status: "invited", active: true } });
    expect(s.roles).toEqual([]);
    expect(s.modules).toEqual([]);
  });

  it("WALK-THROUGH: each step is done by the person allowed to do it; the snapshot follows; a repeat changes nothing; no second employee, no new number", async () => {
    const employeesBefore = (await admin(`select count(*) n, string_agg(employee_number, ',' order by employee_number) numbers from employees`))[0]!;
    // 1. HR Admin of A prepares the plan (address, role, module right): it grants nothing
    expect(await attempt(U.hrA, `update employee_onboarding_plans set hr_roles = '[{"role":"line_manager","companyId":"${A}"}]'::jsonb, module_grants = '[{"module":"sales","companyId":"${A}","capabilities":["assign_owner"]}]'::jsonb, updated_by = '${U.hrA}', reviewed_at = null where employee_id = '${E.newbie}'`)).toBe("ok");
    expect((await snapshot(U.hrA)).roles).toEqual([]);
    // 2. the HR Admin of A gives Reporting Manager for A (the person works for A); a privileged role is refused to them; a System Administrator limited to one company who is not HR Admin of A is refused too
    const roleInsert = (user: string, role = "line_manager") => attempt(user, `insert into user_roles (user_id, role, company_id) values ('${U.newbie}', '${role}', '${A}')`);
    expect(await roleInsert(U.scopedSys)).toMatch(/row-level security/);
    expect(await roleInsert(U.hrA, "finance")).toMatch(/row-level security/);
    expect(await roleInsert(U.hrB)).toMatch(/row-level security/);            // HR Admin of another company
    expect(await roleInsert(U.hrA)).toBe("ok");
    expect((await snapshot(U.hrA)).roles).toEqual([{ role: "line_manager", companyId: A }]);
    // 3. the Sales right: HR Admin and System Administrator cannot; the Sales access manager of A can; the snapshot shows it
    expect(await attempt(U.hrA, `select crm_grant_access('${U.newbie}', '${A}', '{assign_owner}', 'onboarding')`)).toMatch(/Only a founder, or someone a founder gave access management to/);
    expect(await attempt(U.sys, `select crm_grant_access('${U.newbie}', '${A}', '{assign_owner}', 'onboarding')`)).toMatch(/Only a founder, or someone a founder gave access management to/);
    expect(await attempt(U.accessMgr, `select crm_grant_access('${U.newbie}', '${A}', '{assign_owner}', 'onboarding')`)).toBe("ok");
    expect((await snapshot(U.hrA)).modules).toEqual([{ module: "sales", companyId: A, capabilities: ["assign_owner"] }]);
    // 4. a repeat of the same grant changes nothing (one active grant, one role)
    expect(await attempt(U.accessMgr, `select crm_grant_access('${U.newbie}', '${A}', '{assign_owner}', 'onboarding')`)).toBe("ok");
    expect(Number((await admin(`select count(*) n from crm_company_grants where user_id = '${U.newbie}' and revoked_at is null`))[0]!.n)).toBe(1);
    expect(Number((await admin(`select count(*) n from user_roles where user_id = '${U.newbie}' and revoked_at is null`))[0]!.n)).toBe(1);
    // 5. HR Admin of ANOTHER company sees nothing about this person; an HR Admin of A sees only company A's lines; an unscoped System Administrator sees roles in every company
    await admin(`insert into user_roles (user_id, role, company_id) values ('${U.newbie}', 'employee', '${B}')`);
    expect((await snapshot(U.hrA)).roles).toEqual([{ role: "line_manager", companyId: A }]);   // company B's role is not shown to A's HR Admin
    expect((await snapshot(U.sys)).roles.map((r: Row) => r.companyId).sort()).toEqual([A, B].sort());
    // nothing in any of this created a second employee row or changed a number
    const employeesAfter = (await admin(`select count(*) n, string_agg(employee_number, ',' order by employee_number) numbers from employees`))[0]!;
    expect(employeesAfter).toEqual(employeesBefore);
  });

  it("THE OWNER'S PACKS: verify says OK for every row (including the HR Admin role policy); rollback STOPS while a plan exists, then removes the table, the function AND only the HR Admin's new role right (roles already given stay), and is safe to run twice", async () => {
    const pack = (name: string) => readFileSync(resolve(__dirname, `../../../supabase/manual-sql/${name}`), "utf8");
    // the harness re-grants blanket privileges after the migrations (as Supabase's defaults would for a new table); the migration's own revokes are what a real install keeps, so put them back for the privilege rows
    await admin(`revoke all on employee_onboarding_plans from anon; revoke delete, truncate on employee_onboarding_plans from authenticated`);
    const verify = await admin(pack("people_hr_onboarding_20_verify_readonly.sql"));
    expect(verify).toHaveLength(5);
    expect(verify.every((r) => r.result === "OK"), JSON.stringify(verify)).toBe(true);
    // a plan exists (from the walk-through): the rollback refuses and changes nothing
    await expect(admin(pack("people_hr_onboarding_90_rollback.sql"))).rejects.toThrow(/STOP: onboarding plans exist/);
    expect((await admin(`select count(*) n from pg_policies where policyname = 'user_roles_insert_hr_admin_employee'`))[0]!.n).toBe("1");
    const rolesBefore = Number((await admin(`select count(*) n from user_roles where revoked_at is null`))[0]!.n);
    await admin(`delete from employee_onboarding_plans`);
    await admin(pack("people_hr_onboarding_90_rollback.sql"));
    await admin(pack("people_hr_onboarding_90_rollback.sql"));                       // twice
    expect((await admin(`select to_regclass('public.employee_onboarding_plans') t, to_regprocedure('public.onboarding_access_snapshot(uuid)') f`))[0]).toEqual({ t: null, f: null });
    expect((await admin(`select count(*) n from pg_policies where policyname = 'user_roles_insert_hr_admin_employee'`))[0]!.n).toBe("0");
    expect((await admin(`select count(*) n from pg_policies where policyname = 'user_roles_insert_sysadmin'`))[0]!.n).toBe("1");   // the System Administrator's own right is untouched
    expect(Number((await admin(`select count(*) n from user_roles where revoked_at is null`))[0]!.n)).toBe(rolesBefore);          // nothing was revoked
    // with the policy gone an HR Admin can no longer give the role; an unrestricted System Administrator still can
    expect(await attempt(U.hrA, `insert into user_roles (user_id, role, company_id) values ('${U.newbie}', 'employee', '${A}')`)).toMatch(/row-level security/);
    expect(await attempt(U.sys, `insert into user_roles (user_id, role, company_id) values ('${U.newbie}', 'employee', '${A}')`)).toBe("ok");
  });
});
