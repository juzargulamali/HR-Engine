import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// A16 / D-22. preflight_phase2b_v2_policy_status() is SECURITY DEFINER and used to answer every signed-in user, including the status and key values of the
// seeded DRAFT policy versions that policy_versions_select hides from them. It now returns a slot only to people who may read that country's drafts (the same
// test as policy_versions_select: HR Admin / CEO / CTO with a grant that is not limited to one company). HR Admin sees the same rows as before.

const id = () => randomUUID();
const CO = id();
const U = { employee: id(), manager: id(), hrCountry: id(), hrCompanyOnly: id(), ceoCountry: id(), ctoCountry: id(), hrAeOnly: id(), outsider: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("preflight_phase2b_v2_policy_status: role check inside the function (A16)", () => {
  const db = new RlsTestDatabase();
  const status = (user: string | null) => db.asUser(user, async (q) => (await q("select * from preflight_phase2b_v2_policy_status()")).rows as Row[]);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@polstat.ae')`).join(", ")};
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date)
        select gen_random_uuid(), u, 'PS-' || n, '${CO}', 'AE', 'P' || n, 'Person', '2024-01-01'
        from (values ('${U.employee}'::uuid, 1), ('${U.manager}'::uuid, 2)) v(u, n);
      insert into user_roles (user_id, role, company_id, country_code) values
        ('${U.manager}', 'line_manager', '${CO}', null),
        ('${U.hrCountry}', 'hr_admin', null, null), ('${U.hrCompanyOnly}', 'hr_admin', '${CO}', null),
        ('${U.ceoCountry}', 'ceo', null, null), ('${U.ctoCountry}', 'cto', null, null),
        ('${U.hrAeOnly}', 'hr_admin', null, 'AE');
    `);
    // The seeded v2 drafts (what the Policies page offers to create): created by an HR Admin, exactly as the app does.
    await db.asUserCommit(U.hrCountry, async (q) => (await q("select * from seed_phase2b_policy_drafts()")).rows);
  }, 60_000);
  afterAll(async () => db.teardown());

  it("HR Admin, CEO and CTO (country-wide grants) see all 12 slots, with the seeded draft values, as before", async () => {
    for (const who of [U.hrCountry, U.ceoCountry, U.ctoCountry]) {
      const rows = await status(who);
      expect(rows, who).toHaveLength(12);
      expect(rows.filter((r) => r.status !== "not_created"), who).not.toHaveLength(0);
      expect(rows.find((r) => r.status !== "not_created")!.critical_values, who).not.toBeNull();
    }
  });

  it("an ordinary employee, a line manager, a company-only HR Admin and a person with no role get no rows when calling the function directly", async () => {
    for (const who of [U.employee, U.manager, U.hrCompanyOnly, U.outsider]) expect(await status(who), who).toEqual([]);
  });

  it("an anonymous caller is refused", async () => {
    await expect(status(null)).rejects.toThrow(/permission denied|must be called|not signed in/i);
  });

  it("a person who may read drafts for one country only sees that country's slots (the same boundary as policy_versions_select)", async () => {
    const rows = await status(U.hrAeOnly);
    expect(rows.length).toBeGreaterThan(0);
    expect([...new Set(rows.map((r) => r.country_code))]).toEqual(["AE"]);
  });

  it("the function reveals nothing that policy_versions_select does not: whatever it returns, the caller can read those drafts directly", async () => {
    const asEmployee = await db.asUser(U.employee, async (q) => (await q("select count(*)::int as n from policy_versions where status = 'draft'")).rows[0]);
    expect(asEmployee).toEqual({ n: 0 });
  });
});
