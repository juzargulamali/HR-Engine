import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Who may read which policy versions, and who may change them. The Policies page shows only the latest version of each policy and offers a
// "Show older versions" toggle to everybody, so the rule behind that toggle has to hold in the database:
//   * everyone signed in may read ACTIVE versions, including older ones whose effective range has closed;
//   * only HR Admin and CEO / CTO with a country-wide grant may read DRAFT and SUPERSEDED versions;
//   * only they may change or delete anything, and only drafts (policy_versions_select / _insert / _update / _delete).

const EMPLOYEE = "00000000-0000-0000-0000-00000000c001";
const MANAGER = "00000000-0000-0000-0000-00000000c002";
const HR_COUNTRY = "00000000-0000-0000-0000-00000000c003";
const CEO_COUNTRY = "00000000-0000-0000-0000-00000000c004";
const HR_ONE_COMPANY = "00000000-0000-0000-0000-00000000c005";

const COMPANY = "00000000-0000-0000-0000-00000000c0a1";
const EMP_EMPLOYEE = "00000000-0000-0000-0000-00000000c101";
const EMP_MANAGER = "00000000-0000-0000-0000-00000000c102";

const LEAVE_V1_OLD_ACTIVE = "00000000-0000-0000-0000-00000000c901";
const LEAVE_V2_LATEST_ACTIVE = "00000000-0000-0000-0000-00000000c902";
const LEAVE_V3_DRAFT = "00000000-0000-0000-0000-00000000c903";
const NOTICE_V1_SUPERSEDED = "00000000-0000-0000-0000-00000000c904";
const NOTICE_V2_ACTIVE = "00000000-0000-0000-0000-00000000c905";

const ACTIVE_IDS = [LEAVE_V1_OLD_ACTIVE, LEAVE_V2_LATEST_ACTIVE, NOTICE_V2_ACTIVE].sort();
const ALL_IDS = [LEAVE_V1_OLD_ACTIVE, LEAVE_V2_LATEST_ACTIVE, LEAVE_V3_DRAFT, NOTICE_V1_SUPERSEDED, NOTICE_V2_ACTIVE].sort();

describe("policy versions: who can read older, draft and superseded versions", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into auth.users (id, email) values
        ('${EMPLOYEE}', 'pv-employee@enginious.test'), ('${MANAGER}', 'pv-manager@enginious.test'),
        ('${HR_COUNTRY}', 'pv-hr-country@enginious.test'), ('${CEO_COUNTRY}', 'pv-ceo@enginious.test'),
        ('${HR_ONE_COMPANY}', 'pv-hr-company@enginious.test');
      insert into countries (code, name, default_currency) values ('ZZ', 'Zedland', 'ZZD') on conflict (code) do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${COMPANY}', 'Policy View Co', 'ZZ', 'ZZD');
      insert into employees (id, user_id, employee_number, company_id, country_code, first_name, last_name, hire_date) values
        ('${EMP_EMPLOYEE}', '${EMPLOYEE}', 'PV-01', '${COMPANY}', 'ZZ', 'Eve', 'Employee', '2024-01-01'),
        ('${EMP_MANAGER}', '${MANAGER}', 'PV-02', '${COMPANY}', 'ZZ', 'Max', 'Manager', '2024-01-01');
      update employees set manager_id = '${EMP_MANAGER}' where id = '${EMP_EMPLOYEE}';
      insert into user_roles (user_id, role, company_id, country_code) values
        ('${MANAGER}', 'line_manager', '${COMPANY}', null),
        ('${HR_COUNTRY}', 'hr_admin', null, null),
        ('${CEO_COUNTRY}', 'ceo', null, null),
        ('${HR_ONE_COMPANY}', 'hr_admin', '${COMPANY}', null);

      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, effective_to, status, payload, created_by) values
        ('${LEAVE_V1_OLD_ACTIVE}', 'ZZ', 'leave_rules', 1, '2020-01-01', '2024-12-31', 'active', '{}', '${HR_COUNTRY}'),
        ('${LEAVE_V2_LATEST_ACTIVE}', 'ZZ', 'leave_rules', 2, '2025-01-01', null, 'active', '{}', '${HR_COUNTRY}'),
        ('${LEAVE_V3_DRAFT}', 'ZZ', 'leave_rules', 3, '2026-06-01', null, 'draft', '{}', '${HR_COUNTRY}'),
        ('${NOTICE_V1_SUPERSEDED}', 'ZZ', 'notice_period', 1, '2020-01-01', '2022-12-31', 'superseded', '{}', '${HR_COUNTRY}'),
        ('${NOTICE_V2_ACTIVE}', 'ZZ', 'notice_period', 2, '2023-01-01', null, 'active', '{}', '${HR_COUNTRY}');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  const idsSeenBy = (userId: string) =>
    db.asUser(userId, async (query) => {
      const { rows } = await query("select id from policy_versions where country_code = 'ZZ'");
      return rows.map((r: { id: string }) => r.id).sort();
    });

  describe.each([
    ["an employee", EMPLOYEE],
    ["a line manager", MANAGER],
    ["an HR Admin of one company (no country-wide grant)", HR_ONE_COMPANY],
  ])("%s", (_label, userId) => {
    it("reads every active version, including an older one whose range has closed, and nothing else", async () => {
      const seen = await idsSeenBy(userId);
      expect(seen).toEqual(ACTIVE_IDS);
      expect(seen).toContain(LEAVE_V1_OLD_ACTIVE);
      expect(seen).not.toContain(LEAVE_V3_DRAFT);
      expect(seen).not.toContain(NOTICE_V1_SUPERSEDED);
    });

    it("cannot create a policy version", async () => {
      await expect(
        db.asUser(userId, (query) =>
          query(
            `insert into policy_versions (country_code, policy_type, version_no, effective_from, status, payload, created_by)
             values ('ZZ', 'probation_rules', 1, '2026-01-01', 'draft', '{}', '${userId}')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("cannot activate a draft, edit an active version, or delete anything", async () => {
      const result = await db.asUser(userId, async (query) => {
        const activate = await query("update policy_versions set status = 'active' where id = $1", [LEAVE_V3_DRAFT]);
        const editActive = await query("update policy_versions set payload = '{\"x\":1}' where id = $1", [LEAVE_V2_LATEST_ACTIVE]);
        const delDraft = await query("delete from policy_versions where id = $1", [LEAVE_V3_DRAFT]);
        const delActive = await query("delete from policy_versions where id = $1", [LEAVE_V2_LATEST_ACTIVE]);
        return [activate.rowCount, editActive.rowCount, delDraft.rowCount, delActive.rowCount];
      });
      expect(result).toEqual([0, 0, 0, 0]);
    });
  });

  it.each([
    ["an HR Admin with a country-wide grant", HR_COUNTRY],
    ["a CEO with a country-wide grant", CEO_COUNTRY],
  ])("%s reads active, draft and superseded versions", async (_label, userId) => {
    expect(await idsSeenBy(userId)).toEqual(ALL_IDS);
  });

  it("changes nothing for anyone through those attempts: every row is as seeded", async () => {
    const { rows } = await db.seed("select id, status from policy_versions where country_code = 'ZZ' order by id");
    expect(rows.map((r: { id: string; status: string }) => `${r.id}:${r.status}`)).toEqual([
      `${LEAVE_V1_OLD_ACTIVE}:active`,
      `${LEAVE_V2_LATEST_ACTIVE}:active`,
      `${LEAVE_V3_DRAFT}:draft`,
      `${NOTICE_V1_SUPERSEDED}:superseded`,
      `${NOTICE_V2_ACTIVE}:active`,
    ]);
  });
});
