import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// WHO CAN FINISH EACH ONBOARDING ACTION: the database-level checks behind "Add employee, invite, HR roles, module access", on isolated fictional accounts.
// Saeed was given HR Admin and System Admin and can add employees and edit profiles, but invitations, HR role assignment and module access fall back to the owner. The accounts below separate the possible causes:
//   hrOnly      HR Admin of company A, nothing else
//   scopedSys   HR Admin of A + a System Administrator grant SCOPED TO COMPANY A (the grant form lets a company be chosen)
//   globalSys   HR Admin of A + an UNSCOPED System Administrator grant (the control: what "System Admin" must be for the checks below to pass)
//   accessMgr   HR Admin of A + "manage_access" in Sales for A (the existing scoped delegation for module access)
//   founder     founder of Sales in A
// Invitation itself is a server action using the Admin API (no row-level policy): its check, isSysAdmin(grants) with no scope, is covered in apps/web onboarding tests; here the same scoping rule is shown at the database.
const A = randomUUID();
const B = randomUUID();
const U = { owner: randomUUID(), hrOnly: randomUUID(), scopedSys: randomUUID(), globalSys: randomUUID(), accessMgr: randomUUID(), founder: randomUUID(), newbie: randomUUID() };
const E = { newbie: randomUUID() };

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
      insert into crm_company_grants (user_id, company_id, capabilities, note) values ('${U.founder}', '${A}', '{founder}', 'test'), ('${U.accessMgr}', '${A}', '{manage_access}', 'test');
      insert into employees (id, employee_number, company_id, country_code, first_name, last_name, hire_date, user_id) values ('${E.newbie}', null, '${A}', 'AE', 'New', 'Hire', '2026-01-01', '${U.newbie}');
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
    await admin(`insert into auth.users (id, email) values ('${noOne}', 'plain@onboarding.test')`);
    expect(await outcome(noOne, `insert into employees (company_id, country_code, first_name, last_name, hire_date) values ('${A}', 'AE', 'Nope', 'Plain', '2026-02-01')`)).toMatch(/row-level security/);
    await admin(`delete from user_roles where user_id = '${U.hrOnly}' and company_id = '${B}'`);
  });

  it("ASSIGN AN HR ROLE: only an UNSCOPED System Administrator passes (user_roles_insert_sysadmin = has_role('sys_admin') with no company); HR Admin alone, and a System Admin grant scoped to one company, are refused", async () => {
    expect(await addRole(U.hrOnly, U.newbie, "employee", A)).toMatch(/row-level security/);
    expect(await addRole(U.scopedSys, U.newbie, "employee", A)).toMatch(/row-level security/);     // the likely cause for Saeed: his System Admin grant carries a company
    expect(await addRole(U.accessMgr, U.newbie, "employee", A)).toMatch(/row-level security/);     // module access management does not give role assignment
    expect(await addRole(U.founder, U.newbie, "employee", A)).toMatch(/row-level security/);
    expect(await addRole(U.globalSys, U.newbie, "employee", A)).toBe("ok");
    expect(await addRole(U.owner, U.newbie, "line_manager", A)).toBe("ok");
    expect(await rolesOf(U.newbie)).toEqual([`employee:${A}`, `line_manager:${A}`]);
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

  it("the owner's read-only diagnostic file reports the same verdicts per account (so the hosted run can be trusted), and changes nothing", async () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/manual-sql/people_access_onboarding_diagnostic_readonly.sql"), "utf8");
    const run = async (who: string) => (await admin(sql.replace("PUT-THE-PERSONS-EMAIL-HERE@example.com", `${who}@onboarding.test`))).map((r) => `${r.section} :: ${r.detail}`);
    const before = await admin(`select (select count(*) from user_roles) r, (select count(*) from crm_company_grants) g`);
    const scoped = await run("scopedSys");
    expect(scoped.find((l) => l.startsWith("C1"))).toMatch(/ALLOWED - HR Admin of: Fictional Onboarding A/);
    expect(scoped.find((l) => l.startsWith("C2"))).toMatch(/BLOCKED - the System Administrator grant is limited to: Fictional Onboarding A/);
    expect(scoped.find((l) => l.startsWith("C3"))).toMatch(/BLOCKED/);
    expect(scoped.filter((l) => l.startsWith("C4")).every((l) => /BLOCKED/.test(l))).toBe(true);
    const global = await run("globalSys");
    expect(global.find((l) => l.startsWith("C2"))).toMatch(/ALLOWED/);
    expect(global.find((l) => l.startsWith("C3"))).toMatch(/ALLOWED/);
    expect(global.filter((l) => l.startsWith("C4")).every((l) => /BLOCKED/.test(l))).toBe(true);
    const mgr = await run("accessMgr");
    expect(mgr.find((l) => l.startsWith("C4 Give module access: Sales & CRM"))).toMatch(/ALLOWED for: Fictional Onboarding A/);
    expect(await run("nobody-here")).toEqual(["A0 account :: NO ACCOUNT FOUND for that address - check the spelling"]);
    expect(await admin(`select (select count(*) from user_roles) r, (select count(*) from crm_company_grants) g`)).toEqual(before);
  });
});
