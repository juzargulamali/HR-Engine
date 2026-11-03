import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Completion pass, section 3 (after A16). What a COMPANY-ONLY HR Admin (hr_admin with company_id set, no country-wide grant) can and cannot do with policies.
//
// OUTCOME (intentional, not a regression of A16): they keep the read-only Policies list (active versions only), exactly as before A16, and they do not draft, edit,
// activate or delete a policy and do not see drafts. This is the rule the database has had since the policy engine (docs/02-database-schema.md section 2.4:
// "has_role('hr_admin', null, country_code) deliberately requires an unscoped-by-company grant: a single-company HR Admin manages that company's employees, but shouldn't
// unilaterally change a policy that can affect every company operating in that country") and that policy_versions_select, policy_versions_insert/update/delete, the draft
// functions and the application's canDraftPolicy all share. The A16 status function now says the same thing. Nothing here broadens access to restore a screen.

const id = () => randomUUID();
const CO = id();
const U = { hrCountry: id(), hrCompanyOnly: id(), ceoCountry: id(), employee: id() };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("A company-only HR Admin and policies (intended outcome, tested)", () => {
  const db = new RlsTestDatabase();
  const as = <T = Row>(user: string, sql: string) => db.asUser(user, async (q) => (await q(sql)).rows as T[]);
  let draftId: string;

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR'), ('PL', 'Poland', 'PLN') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO}', 'Enginious UAE', 'AE', 'AED');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@polhr.ae')`).join(", ")};
      insert into user_roles (user_id, role, company_id, country_code) values
        ('${U.hrCountry}', 'hr_admin', null, null), ('${U.hrCompanyOnly}', 'hr_admin', '${CO}', null), ('${U.ceoCountry}', 'ceo', null, null);
    `);
    await db.asUserCommit(U.hrCountry, async (q) => (await q("select * from seed_phase2b_policy_drafts()")).rows);
    draftId = (await db.seed(`select id from policy_versions where status = 'draft' limit 1`)).rows[0].id;
    await db.seed(`update policy_versions set status = 'active', effective_from = '2024-01-01' where id = (select id from policy_versions where status = 'draft' and policy_type = 'notice_period' and country_code = 'AE' limit 1)`);
  }, 60_000);
  afterAll(async () => db.teardown());

  it("reads the Policies list: active versions only, which is what they could read before A16; drafts are invisible to them and visible to country-wide HR and CEO", async () => {
    const mine = await as<Row>(U.hrCompanyOnly, "select status, count(*)::int n from policy_versions group by status");
    expect(mine.map((r) => r.status)).toEqual(["active"]);
    for (const who of [U.hrCountry, U.ceoCountry]) {
      const theirs = await as<Row>(who, "select distinct status from policy_versions");
      expect(theirs.map((r) => r.status).sort(), who).toEqual(["active", "draft"]);
    }
    expect(await as(U.hrCompanyOnly, `select 1 from policy_versions where id = '${draftId}'`)).toHaveLength(0);
  });

  it("the A16 status function gives them nothing (it is the draft status; they may not read drafts)", async () => {
    expect(await as(U.hrCompanyOnly, "select * from preflight_phase2b_v2_policy_status()")).toEqual([]);
  });

  it("cannot draft: both draft functions and a direct insert are refused", async () => {
    await expect(db.asUserCommit(U.hrCompanyOnly, async (q) => q("select * from seed_phase2b_policy_drafts()"))).rejects.toThrow(/company-unscoped HR Admin/);
    await expect(db.asUserCommit(U.hrCompanyOnly, async (q) => q("select * from seed_recovery_windows_policy_drafts()"))).rejects.toThrow(/company-unscoped HR Admin/);
    await expect(db.asUser(U.hrCompanyOnly, async (q) => q(`insert into policy_versions (country_code, policy_type, version_no, status, effective_from, payload, created_by) values ('AE', 'notice_period', 99, 'draft', '2030-01-01', '{}', '${U.hrCompanyOnly}')`))).rejects.toThrow(/row-level security/);
  });

  it("cannot edit, activate or delete a draft, and cannot reach one by id", async () => {
    const touched = await db.asUser(U.hrCompanyOnly, async (q) => {
      const u = await q(`update policy_versions set effective_from = '2031-01-01' where id = '${draftId}'`);
      const a = await q(`update policy_versions set status = 'active' where id = '${draftId}'`);
      const d = await q(`delete from policy_versions where id = '${draftId}'`);
      return [u.rowCount, a.rowCount, d.rowCount];
    });
    expect(touched).toEqual([0, 0, 0]);
    expect((await db.seed(`select status from policy_versions where id = '${draftId}'`)).rows[0].status).toBe("draft");
  });

  it("the country-wide HR Admin keeps the whole workflow (this is the contrast, unchanged)", async () => {
    expect((await as(U.hrCountry, "select * from preflight_phase2b_v2_policy_status()")).length).toBe(12);
    expect(await as(U.hrCountry, `select 1 from policy_versions where id = '${draftId}'`)).toHaveLength(1);
  });
});
