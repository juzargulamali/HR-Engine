import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// WHO CAN FINISH EACH ONBOARDING ACTION: the database-level checks behind "Add employee, invite, HR roles, module access", on isolated fictional accounts.
// The hosted diagnostic showed Saeed holds hr_admin, sys_admin and finance, each SCOPED to one company. He could add employees and edit profiles, but invitations and HR role assignment came back to the owner. The accounts below separate the causes and prove the delegation now in place (an HR Admin of a company gives Employee and Reporting Manager for that company only):
//   hrOnly      HR Admin of company A, nothing else
//   scopedSys   Saeed's grant set: HR Admin of A + a System Administrator grant SCOPED TO COMPANY A + Finance scoped to A (the grant form lets a company be chosen)
//   globalSys   HR Admin of A + an UNSCOPED System Administrator grant (the control: what "System Admin" must be for the checks below to pass)
//   accessMgr   HR Admin of A + "manage_access" in Sales for A (the existing scoped delegation for module access)
//   founder     founder of Sales in A
// Invitation itself is a server action using the Admin API (no row-level policy): its check, isSysAdmin(grants) with no scope, is covered in apps/web onboarding tests; here the same scoping rule is shown at the database.
const A = randomUUID();
const B = randomUUID();
const U = { owner: randomUUID(), hrOnly: randomUUID(), scopedSys: randomUUID(), globalSys: randomUUID(), accessMgr: randomUUID(), founder: randomUUID(), newbie: randomUUID(), otherCoHr: randomUUID(), plain: randomUUID(), bHire: randomUUID(), noRecord: randomUUID(), gone: randomUUID(), t1: randomUUID(), t2: randomUUID() };
const E = { newbie: randomUUID(), bHire: randomUUID(), gone: randomUUID(), t1: randomUUID(), t2: randomUUID() };

describe("Onboarding: which account can do which action (isolated accounts)", () => {
  const db = new RlsTestDatabase();
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const admin = async (sql: string) => (await db.seed(sql)).rows as Row[];
  const outcome = async (user: string, sql: string) => {
    try { await db.asUserCommit(user, (q) => q(sql)); return "ok"; } catch (e) { return (e as Error).message; }
  };
  const addRole = (user: string, target: string, role: string, company: string | null) =>
    outcome(user, `insert into user_roles (user_id, role, company_id) values ('${target}', '${role}', ${company ? `'${company}'` : "null"})`);
  const rolesOf = async (user: string) => (await admin(`select role::text r, company_id from user_roles where user_id = '${user}' and revoked_at is null order by 1`)).map((r) => `${r.r}:${r.company_id ?? "global"}`);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${A}', 'Fictional Onboarding A', 'AE', 'AED'), ('${B}', 'Fictional Onboarding B', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@onboarding.test')`).join(", ")};
      update profiles set account_status = 'active' where id <> '${U.newbie}';
      insert into user_roles (user_id, role) values ('${U.owner}', 'sys_admin');
      insert into user_roles (user_id, role, company_id) values
        ('${U.hrOnly}', 'hr_admin', '${A}'),
        ('${U.scopedSys}', 'hr_admin', '${A}'), ('${U.scopedSys}', 'sys_admin', '${A}'),
        ('${U.globalSys}', 'hr_admin', '${A}'),
        ('${U.accessMgr}', 'hr_admin', '${A}'), ('${U.founder}', 'hr_admin', '${A}');
      insert into user_roles (user_id, role) values ('${U.globalSys}', 'sys_admin');
      insert into user_roles (user_id, role, company_id) values ('${U.scopedSys}', 'finance', '${A}'), ('${U.otherCoHr}', 'hr_admin', '${B}');
      insert into crm_company_grants (user_id, company_id, capabilities, note) values ('${U.founder}', '${A}', '{founder}', 'test'), ('${U.accessMgr}', '${A}', '{manage_access}', 'test');
      insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, user_id) values ('${E.newbie}', null, '${A}', 'AE', 'New', 'Hire', '2026-01-01', '${U.newbie}');
      insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, user_id) values
        ('${E.bHire}', null, '${B}', 'AE', 'Other', 'Company', '2026-01-01', '${U.bHire}'),
        ('${E.t1}', null, '${A}', 'AE', 'Target', 'One', '2026-01-01', '${U.t1}'),
        ('${E.t2}', null, '${A}', 'AE', 'Target', 'Two', '2026-01-01', '${U.t2}');
      insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, user_id, employment_status, termination_date) values ('${E.gone}', null, '${A}', 'AE', 'Left', 'Company', '2025-01-01', '${U.gone}', 'terminated', '2026-02-01');
    `);
  }, 90_000);
  afterAll(async () => { await db.teardown(); });

  it("ADD EMPLOYEE and EDIT PROFILE: any HR Admin of the company can (employees_insert_hr / employees_update_hr), whatever else they hold; another company's cannot", async () => {
    for (const who of ["hrOnly", "scopedSys", "globalSys", "accessMgr"] as const) {
      expect(await outcome(U[who], `insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${A}', 'AE', 'Added', '${who}', '2026-02-01')`), who).toBe("ok");
      expect(await outcome(U[who], `update employees set job_title = 'Rigger' where id = '${E.newbie}'`), who).toBe("ok");
    }
    await admin(`insert into user_roles (user_id, role, company_id) values ('${U.hrOnly}', 'hr_admin', '${B}')`);   // (control) now also HR Admin of B
    expect(await outcome(U.owner, `select 1`)).toBe("ok");
    const noOne = randomUUID();
    await admin(`insert into auth.users (id, email) values ('${noOne}', 'noone@onboarding.test')`);
    expect(await outcome(noOne, `insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${A}', 'AE', 'Nope', 'Plain', '2026-02-01')`)).toMatch(/row-level security/);
    await admin(`delete from user_roles where user_id = '${U.hrOnly}' and company_id = '${B}'`);
  });

  it("ASSIGN A ROLE, the HR Admin's delegation: an HR Admin of the company (also with a company-limited System Administrator or Finance grant, as Saeed holds) gives EMPLOYEE and LINE_MANAGER for that company to the login of one of its active employees", async () => {
    expect(await addRole(U.hrOnly, U.newbie, "employee", A)).toBe("ok");
    expect(await addRole(U.scopedSys, U.newbie, "line_manager", A)).toBe("ok");          // Saeed's own grant set
    expect(await rolesOf(U.newbie)).toEqual([`employee:${A}`, `line_manager:${A}`]);       // both, from the same flow
    // the granting is recorded against the signer
    const by = await admin(`select granted_by::text g from user_roles where user_id = '${U.newbie}' and role = 'employee' and revoked_at is null`);
    expect(by).toHaveLength(1);
    expect(await outcome(U.hrOnly, `insert into user_roles (user_id, role, company_id, granted_by) values ('${U.t1}', 'employee', '${A}', '${U.hrOnly}')`)).toBe("ok");   // own id as granted_by is fine
    expect(await outcome(U.hrOnly, `insert into user_roles (user_id, role, company_id, granted_by) values ('${U.t2}', 'employee', '${A}', '${U.owner}')`)).toMatch(/row-level security/);   // someone else's id is not
  });

  it("ASSIGN A ROLE, what stays refused: privileged roles (hr_admin, finance, ceo, cto, sys_admin) for HR Admin, scoped System Administrator, access manager and founder; 'all companies', a country scope, an already-revoked row; the unscoped System Administrator keeps every role", async () => {
    for (const who of ["hrOnly", "scopedSys", "accessMgr", "founder"] as const) {
      for (const role of ["hr_admin", "finance", "ceo", "cto", "sys_admin"]) {
        expect(await addRole(U[who], U.t1, role, A), `${who} must not give ${role}`).toMatch(/row-level security/);
      }
      expect(await addRole(U[who], U.t1, "employee", null), `${who}: not for all companies`).toMatch(/row-level security/);
    }
    expect(await outcome(U.hrOnly, `insert into user_roles (user_id, role, company_id, country_code) values ('${U.t1}', 'employee', '${A}', 'AE')`)).toMatch(/row-level security/);
    expect(await outcome(U.hrOnly, `insert into user_roles (user_id, role, company_id, revoked_at) values ('${U.t1}', 'employee', '${A}', now())`)).toMatch(/row-level security/);
    expect((await rolesOf(U.t1)).filter((r) => !r.startsWith(`employee:${A}`))).toEqual([]);   // nothing but the one Employee role from the previous test slipped through
    // unchanged: the unscoped System Administrator still gives any role, in any company
    expect(await addRole(U.globalSys, U.t2, "finance", A)).toBe("ok");
    expect(await addRole(U.owner, U.t2, "line_manager", A)).toBe("ok");
    expect(await rolesOf(U.t2)).toEqual([`finance:${A}`, `line_manager:${A}`]);
  });

  it("ASSIGN A ROLE, company scope: an HR Admin of another company, a role for a company the person does not work for, a login with no employee record, a terminated employee and a user with no role are all refused", async () => {
    // HR Admin of B cannot give anything for A's employee; HR Admin of A cannot give anything for B's employee
    expect(await addRole(U.otherCoHr, U.t1, "employee", A)).toMatch(/row-level security/);
    expect(await addRole(U.hrOnly, U.bHire, "employee", B)).toMatch(/row-level security/);
    expect(await addRole(U.hrOnly, U.bHire, "employee", A)).toMatch(/row-level security/);   // A's HR Admin, A's role, but the person works for B
    expect(await addRole(U.otherCoHr, U.t1, "employee", B)).toMatch(/row-level security/);   // B's HR Admin, B's role, but the person works for A
    expect(await addRole(U.scopedSys, U.bHire, "line_manager", B)).toMatch(/row-level security/);
    // a login with no employee record, and a terminated employee
    expect(await addRole(U.hrOnly, U.noRecord, "employee", A)).toMatch(/row-level security/);
    expect(await addRole(U.hrOnly, U.gone, "employee", A)).toMatch(/row-level security/);
    // a user with no role at all
    expect(await addRole(U.plain, U.t1, "employee", A)).toMatch(/row-level security/);
    expect(await rolesOf(U.bHire)).toEqual([]);
    expect(await rolesOf(U.gone)).toEqual([]);
    // an HR Admin of B can, of course, do it for B's own employee
    expect(await addRole(U.otherCoHr, U.bHire, "employee", B)).toBe("ok");
    expect(await rolesOf(U.bHire)).toEqual([`employee:${B}`]);
    // a removed employee record is also refused
    await admin(`update employees set deleted_at = now() where id = '${E.bHire}'`);
    expect(await addRole(U.otherCoHr, U.bHire, "line_manager", B)).toMatch(/row-level security/);
    await admin(`update employees set deleted_at = null where id = '${E.bHire}'`);
  });

  it("MODULE ACCESS is a separate model: HR Admin and System Administrator (scoped or not) give no right to grant it; only a founder, or an access manager a founder appointed, in that module and company", async () => {
    const grant = (user: string, caps: string, company = A) => outcome(user, `select crm_grant_access('${U.newbie}', '${company}', '${caps}', 'onboarding')`);
    expect(await grant(U.hrOnly, "{assign_owner}")).toMatch(/Only a founder, or someone a founder gave access management to/);
    expect(await grant(U.scopedSys, "{assign_owner}")).toMatch(/Only a founder, or someone a founder gave access management to/);
    expect(await grant(U.globalSys, "{assign_owner}")).toMatch(/Only a founder, or someone a founder gave access management to/);   // even an unscoped System Admin is not a Sales access manager
    expect(await grant(U.accessMgr, "{assign_owner}")).toBe("ok");                                                                  // the EXISTING scoped delegation: routine Sales access for company A
    expect(await grant(U.accessMgr, "{manage_access}")).toMatch(/Only a CRM founder can grant founder or access-management rights/);   // but not another access manager or founder
    expect(await grant(U.accessMgr, "{assign_owner}", B)).toMatch(/Only a founder, or someone a founder gave access management to/);  // and only for the company they manage
    expect(await grant(U.founder, "{assign_owner}")).toBe("ok");
    expect(await grant(U.founder, "{manage_access}")).toBe("ok");
  });

  it("the account that the screen would call 'System Administrator' differs by scope: only the unscoped grants satisfy the database check; the scoped one satisfies the HR Admin check of its own company only", async () => {
    const check = async (user: string) => (await db.asUser(user, async (q) => (await q(`select has_role('sys_admin') g, has_role('sys_admin', '${A}') s, has_role('hr_admin', '${A}') h`)).rows[0])) as { g: boolean; s: boolean; h: boolean };
    expect(await check(U.globalSys)).toEqual({ g: true, s: true, h: true });
    expect(await check(U.scopedSys)).toEqual({ g: false, s: true, h: true });   // scoped: true only when asked with the company, which user_roles_insert_sysadmin never does
    expect(await check(U.hrOnly)).toEqual({ g: false, s: false, h: true });
  });

  it("the owner's read-only diagnostic file reports the same verdicts per account (so the hosted run can be trusted), names the budget module correctly, and changes nothing", async () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/manual-sql/people_access_onboarding_diagnostic_readonly.sql"), "utf8");
    const run = async (who: string) => (await admin(sql.replace("PUT-THE-PERSONS-EMAIL-HERE@example.com", `${who}@onboarding.test`))).map((r) => `${r.section} :: ${r.detail}`);
    const before = await admin(`select (select count(*) from user_roles) r, (select count(*) from crm_company_grants) g`);
    const scoped = await run("scopedSys");    // Saeed's grant set
    expect(scoped.find((l) => l.startsWith("C0"))).toMatch(/installed/);
    expect(scoped.find((l) => l.startsWith("C1"))).toMatch(/ALLOWED/);
    expect(scoped.find((l) => l.startsWith("C2"))).toMatch(/ALLOWED .*HR Admin of: Fictional Onboarding A/);
    expect(scoped.find((l) => l.startsWith("C3a"))).toMatch(/ALLOWED - HR Admin of: Fictional Onboarding A/);
    expect(scoped.find((l) => l.startsWith("C3b"))).toMatch(/BLOCKED/);
    expect(scoped.filter((l) => l.startsWith("C4")).every((l) => /BLOCKED/.test(l))).toBe(true);
    expect(scoped.filter((l) => l.startsWith("C4")).map((l) => l.split("::")[0]!.trim())).toContain("C4 Give module access: Project Budget & Expenses");
    expect(scoped.join("\n")).not.toMatch(/Phone \/ PBX/);
    const global = await run("globalSys");
    expect(global.find((l) => l.startsWith("C2"))).toMatch(/ALLOWED/);
    expect(global.find((l) => l.startsWith("C3b"))).toMatch(/ALLOWED/);
    expect(global.filter((l) => l.startsWith("C4")).every((l) => /BLOCKED/.test(l))).toBe(true);
    const mgr = await run("accessMgr");
    expect(mgr.find((l) => l.startsWith("C4 Give module access: Sales & CRM"))).toMatch(/ALLOWED for: Fictional Onboarding A/);
    const plain = await run("plain");
    expect(plain.find((l) => l.startsWith("C2"))).toMatch(/BLOCKED/);
    expect(plain.find((l) => l.startsWith("C3a"))).toMatch(/BLOCKED/);
    // before the migration the verdict says so: rename the policy away for a moment (the file reads the policy by name), then put it back
    await admin(`alter policy user_roles_insert_hr_admin_employee on user_roles rename to user_roles_insert_hr_admin_employee_off`);
    const without = await run("hrOnly");
    await admin(`alter policy user_roles_insert_hr_admin_employee_off on user_roles rename to user_roles_insert_hr_admin_employee`);
    expect(without.find((l) => l.startsWith("C0"))).toMatch(/NOT installed/);
    expect(without.find((l) => l.startsWith("C3a"))).toMatch(/BLOCKED until migration 20270118000300 is applied/);
    expect(await run("nobody-here")).toEqual(["A0 account :: NO ACCOUNT FOUND for that address - check the spelling"]);
    expect(await admin(`select (select count(*) from user_roles) r, (select count(*) from crm_company_grants) g`)).toEqual(before);
  });
});
