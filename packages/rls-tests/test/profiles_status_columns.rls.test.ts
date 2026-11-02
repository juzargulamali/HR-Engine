import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A13 / D-11. profiles_select lets every signed-in user read every profile, and the account-security migration added status_reason (free text typed by a System
// Administrator when deactivating: it can describe misconduct), status_changed_by and status_changed_at to the same table without narrowing the read.
//
// Part 1 reproduces that on a database built the way production got it (every migration before the fix, then Supabase's table-level grants): a plain employee
// reads the reason of a deactivated colleague. Part 2 is the fixed database: the three columns are no longer readable by any signed-in user directly (column
// privileges), names, e-mails and the status itself stay readable for the pickers, and a System Administrator reads the details through one narrow function.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = "20261216000400_profiles_status_columns_restricted.sql";
const GRANTS = readFileSync(path.resolve(__dirname, "../../../supabase/tests/grant-authenticated-access.sql"), "utf8");
const id = () => randomUUID();
const U = { sys: id(), emp: id(), hr: id(), leaver: id(), invitee: id() };
const REASON = "Misconduct: the investigation closed on 2026-10-30";
const SEED = `
  insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@profcols.ae')`).join(", ")};
  update profiles set account_status = 'active' where id <> '${U.invitee}';
  update profiles set full_name = 'Lena Leaver', account_status = 'deactivated', is_active = false, status_reason = '${REASON}', status_changed_by = '${U.sys}', status_changed_at = now() where id = '${U.leaver}';
  insert into user_roles (user_id, role) values ('${U.sys}', 'sys_admin'), ('${U.hr}', 'hr_admin');
`;

describe("profiles status columns: reproduction on the pre-fix database", () => {
  const db = new RlsTestDatabase();
  beforeAll(async () => {
    await db.setupBefore(FIX);
    await db.seed(GRANTS);
    await db.seed(SEED);
  }, 60_000);
  afterAll(async () => db.teardown());

  it("REPRODUCED: a plain employee session reads a colleague's deactivation reason, who recorded it and when", async () => {
    const rows = await db.asUser(U.emp, async (q) => (await q(`select status_reason, status_changed_by, status_changed_at from profiles where id = '${U.leaver}'`)).rows);
    expect(rows[0]!.status_reason).toBe(REASON);
    expect(rows[0]!.status_changed_by).toBe(U.sys);
    expect(rows[0]!.status_changed_at).not.toBeNull();
  });
});

describe("profiles status columns: the fixed database (A13)", () => {
  const db = new RlsTestDatabase();
  const as = <T = Record<string, any>>(user: string, sql: string) => db.asUser(user, async (q) => (await q(sql)).rows as T[]); // eslint-disable-line @typescript-eslint/no-explicit-any
  beforeAll(async () => {
    await db.setup();
    await db.seed(SEED);
  }, 60_000);
  afterAll(async () => db.teardown());

  it.each(["status_reason", "status_changed_by", "status_changed_at"])("%s is refused to a plain employee, an HR Admin and even a System Administrator reading the table directly", async (col) => {
    for (const who of [U.emp, U.hr, U.sys]) await expect(as(who, `select ${col} from profiles where id = '${U.leaver}'`), `${col} / ${who}`).rejects.toThrow(/permission denied/);
  });

  it("select * is refused as well (nobody can stumble on the columns), while naming the readable columns works", async () => {
    await expect(as(U.emp, "select * from profiles")).rejects.toThrow(/permission denied/);
    const rows = await as(U.emp, "select id, email, full_name, locale, is_active, account_status, created_at, updated_at from profiles order by email");
    expect(rows).toHaveLength(Object.keys(U).length);
  });

  it("names, e-mails and the status itself stay readable for every signed-in user (approver and manager pickers keep working)", async () => {
    const rows = await as<{ id: string; email: string; full_name: string | null; account_status: string }>(U.emp, "select id, email, full_name, account_status from profiles");
    expect(rows.find((r) => r.id === U.leaver)).toMatchObject({ email: "leaver@profcols.ae", full_name: "Lena Leaver", account_status: "deactivated" });
    expect(await as(U.emp, `select id, full_name, email from profiles where is_active = true order by full_name`)).toHaveLength(Object.keys(U).length - 1);
  });

  it("a System Administrator reads the reason through the function; nobody else does", async () => {
    const d = (await as<{ d: Record<string, any> }>(U.sys, `select account_status_details('${U.leaver}') as d`))[0]!.d; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d).toMatchObject({ status_reason: REASON, status_changed_by: U.sys });
    expect(d.status_changed_at).toBeTruthy();
    for (const who of [U.emp, U.hr, U.leaver]) await expect(as(who, `select account_status_details('${U.leaver}')`), who).rejects.toThrow(/Only a System Administrator/);
    await expect(db.asUser(null, async (q) => q(`select account_status_details('${U.leaver}')`))).rejects.toThrow(/permission denied/);
  });

  it("an account that was never deactivated has no details (null reason)", async () => {
    const d = (await as<{ d: Record<string, any> }>(U.sys, `select account_status_details('${U.emp}') as d`))[0]!.d; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.status_reason).toBeNull();
  });

  it("preservation: deactivating and reactivating still work, still record the reason, and a person still updates their own name and locale", async () => {
    await db.asUserCommit(U.sys, async (q) => q(`select set_account_status('${U.emp}', 'deactivated', 'left')`));
    expect((await as<{ d: Record<string, any> }>(U.sys, `select account_status_details('${U.emp}') as d`))[0]!.d.status_reason).toBe("left"); // eslint-disable-line @typescript-eslint/no-explicit-any
    await db.asUserCommit(U.sys, async (q) => q(`select set_account_status('${U.emp}', 'active', 'back')`));
    await db.asUserCommit(U.emp, async (q) => q(`update profiles set full_name = 'Eve E', locale = 'ar' where id = '${U.emp}'`));
    expect(await as(U.emp, `select full_name, locale from profiles where id = '${U.emp}'`)).toEqual([{ full_name: "Eve E", locale: "ar" }]);
    // the first-sign-in activation (invited -> active) still works for the invitee
    await db.asUserCommit(U.invitee, async (q) => q(`update profiles set account_status = 'active' where id = '${U.invitee}'`));
    expect(await as(U.invitee, `select account_status from profiles where id = '${U.invitee}'`)).toEqual([{ account_status: "active" }]);
    // and the audit trail of profile changes is still written
    const audited = await db.seed(`select count(*)::int as n from audit_log where table_name = 'profiles'`);
    expect(audited.rows[0].n).toBeGreaterThan(0);
  });

  it("the restriction survives: other columns of other tables are unaffected (employees stays readable under its own policy)", async () => {
    await expect(as(U.emp, "select count(*) from employees")).resolves.toBeDefined();
  });
});
