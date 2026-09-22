import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { RlsTestDatabase } from "../src/harness";

const USER_HR1 = "00000000-0000-0000-0000-0000000002b1"; // country HR Admin — drafts
const USER_HR2 = "00000000-0000-0000-0000-0000000002b2"; // country HR Admin — activates HR1's drafts
const USER_CEO = "00000000-0000-0000-0000-0000000002b3";
const USER_COMPANY_HR = "00000000-0000-0000-0000-0000000002b4"; // HR Admin scoped to one company only
const USER_MANAGER = "00000000-0000-0000-0000-0000000002b5"; // no policy-relevant role at all
const COMPANY_A = "00000000-0000-0000-0000-0000000002a1";

// Fixed ids for seeded policy_versions rows — every asUser() call is its own
// transaction that always rolls back (see harness.ts), so tests never
// depend on a PRIOR test's mutation persisting. Instead, everything a test
// reads or attempts to mutate is seeded once, upfront, directly (bypassing
// RLS via the admin connection) via beforeAll. A test that needs to prove a
// multi-step workflow (draft -> activate -> resolve) does every step inside
// one asUser() call, switching identity mid-transaction with actAs() below
// — the intermediate writes are visible within that one transaction even
// though the whole thing rolls back at the end.
const PV_ACTIVE_2025 = "00000000-0000-0000-0000-0000000002d1"; // leave_rules, active, 2025 only
const PV_DRAFT_OVERLAPPING = "00000000-0000-0000-0000-0000000002d2"; // leave_rules draft, overlaps PV_ACTIVE_2025
const PV_DRAFT_NONOVERLAPPING = "00000000-0000-0000-0000-0000000002d3"; // leave_rules draft, starts after PV_ACTIVE_2025 ends
const PV_DRAFT_NOTICE = "00000000-0000-0000-0000-0000000002d4"; // notice_period draft, for the CEO content-edit tests

async function actAs(query: Client["query"], userId: string | null) {
  if (userId) {
    await query("SET LOCAL ROLE authenticated");
    await query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  } else {
    await query("SET LOCAL ROLE anon");
  }
}

describe("Phase 2 row-level security: country policy engine", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();

    await db.seed(`
      insert into auth.users (id, email) values
        ('${USER_HR1}', 'hr1@enginious.ae'),
        ('${USER_HR2}', 'hr2@enginious.ae'),
        ('${USER_CEO}', 'ceo@enginious.ae'),
        ('${USER_COMPANY_HR}', 'company-hr@enginious.ae'),
        ('${USER_MANAGER}', 'manager@enginious.ae');

      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED');
      insert into companies (id, legal_name, country_code, default_currency)
        values ('${COMPANY_A}', 'Enginious LLC FZ', 'AE', 'AED');

      -- Country-scoped grants (company_id null) — the ones policy management requires.
      insert into user_roles (user_id, role, country_code) values
        ('${USER_HR1}', 'hr_admin', 'AE'),
        ('${USER_HR2}', 'hr_admin', 'AE'),
        ('${USER_CEO}', 'ceo', 'AE');
      -- A company-scoped HR Admin — should never manage country policy.
      insert into user_roles (user_id, role, company_id) values
        ('${USER_COMPANY_HR}', 'hr_admin', '${COMPANY_A}');
      insert into user_roles (user_id, role, company_id) values
        ('${USER_MANAGER}', 'line_manager', '${COMPANY_A}');

      insert into policy_versions (id, country_code, policy_type, version_no, effective_from, effective_to, status, payload, created_by, approved_by, approved_at) values
        ('${PV_ACTIVE_2025}', 'AE', 'leave_rules', 1, '2025-01-01', '2025-12-31', 'active', '{"note":"v1 2025"}', '${USER_HR1}', '${USER_HR2}', now()),
        ('${PV_DRAFT_OVERLAPPING}', 'AE', 'leave_rules', 2, '2025-06-01', null, 'draft', '{"note":"draft v2, overlaps v1"}', '${USER_HR1}', null, null),
        ('${PV_DRAFT_NONOVERLAPPING}', 'AE', 'leave_rules', 3, '2026-01-01', null, 'draft', '{"note":"draft v3, does not overlap v1"}', '${USER_HR1}', null, null),
        ('${PV_DRAFT_NOTICE}', 'AE', 'notice_period', 1, '2026-01-01', null, 'draft', '{"default_days":30}', '${USER_HR1}', null, null);

      insert into public_holidays (country_code, holiday_date, name) values ('AE', '2026-01-01', 'New Year''s Day');
    `);
  }, 30_000);

  afterAll(async () => {
    await db.teardown();
  });

  describe("drafting", () => {
    it("lets a country HR Admin draft a policy version", async () => {
      const { rows } = await db.asUser(USER_HR1, (query) =>
        query(
          `insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
           values ('AE', 'probation_rules', 1, '2026-01-01', '{"max_probation_days":180}', $1) returning status`,
          [USER_HR1],
        ),
      );
      expect(rows).toEqual([{ status: "draft" }]);
    });

    it("forces every new row to start as a draft, even if the caller asks for active — otherwise activation's two-person control could be skipped entirely", async () => {
      await expect(
        db.asUser(USER_HR1, (query) =>
          query(
            `insert into policy_versions (country_code, policy_type, version_no, effective_from, status, payload, created_by)
             values ('AE', 'working_week', 1, '2026-01-01', 'active', '{}', $1)`,
            [USER_HR1],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("blocks a company-scoped HR Admin and a line manager from drafting", async () => {
      await expect(
        db.asUser(USER_COMPANY_HR, (query) =>
          query(
            `insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
             values ('AE', 'working_week', 1, '2026-01-01', '{}', $1)`,
            [USER_COMPANY_HR],
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query(
            `insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
             values ('AE', 'working_week', 1, '2026-01-01', '{}', $1)`,
            [USER_MANAGER],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("blocks CEO from drafting — activation only", async () => {
      await expect(
        db.asUser(USER_CEO, (query) =>
          query(
            `insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
             values ('AE', 'working_week', 1, '2026-01-01', '{}', $1)`,
            [USER_CEO],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("draft visibility", () => {
    it("is visible to country HR Admin and CEO, invisible to a company-scoped HR Admin and a line manager", async () => {
      const hr2 = await db.asUser(USER_HR2, (query) => query("select id from policy_versions where status = 'draft'"));
      expect(hr2.rows.length).toBeGreaterThan(0);

      const ceo = await db.asUser(USER_CEO, (query) => query("select id from policy_versions where status = 'draft'"));
      expect(ceo.rows.length).toBeGreaterThan(0);

      const companyHr = await db.asUser(USER_COMPANY_HR, (query) => query("select id from policy_versions where status = 'draft'"));
      expect(companyHr.rows).toEqual([]);

      const manager = await db.asUser(USER_MANAGER, (query) => query("select id from policy_versions where status = 'draft'"));
      expect(manager.rows).toEqual([]);
    });

    it("shows an active version to anyone signed in, even a plain line manager", async () => {
      const { rows } = await db.asUser(USER_MANAGER, (query) => query("select id from policy_versions where status = 'active'"));
      expect(rows.map((r) => r.id)).toContain(PV_ACTIVE_2025);
    });
  });

  describe("two-person activation control", () => {
    it("blocks the drafter from activating their own draft", async () => {
      await expect(
        db.asUser(USER_HR1, (query) => query("update policy_versions set status = 'active' where id = $1", [PV_DRAFT_NONOVERLAPPING])),
      ).rejects.toThrow(/must be activated by someone other than who drafted it/);
    });

    it("lets a different country HR Admin activate it, auto-stamping approved_by/approved_at", async () => {
      const { rows } = await db.asUser(USER_HR2, (query) =>
        query(
          "update policy_versions set status = 'active' where id = $1 returning status, approved_by, approved_at is not null as approved",
          [PV_DRAFT_NONOVERLAPPING],
        ),
      );
      expect(rows).toEqual([{ status: "active", approved_by: USER_HR2, approved: true }]);
    });

    it("blocks CEO from editing a draft's content", async () => {
      await expect(
        db.asUser(USER_CEO, (query) =>
          query("update policy_versions set payload = '{\"default_days\":999}' where id = $1", [PV_DRAFT_NOTICE]),
        ),
      ).rejects.toThrow(/CEO may only activate/);
    });

    it("lets CEO activate a draft without editing its content", async () => {
      const { rows } = await db.asUser(USER_CEO, (query) =>
        query("update policy_versions set status = 'active' where id = $1 returning status, approved_by", [PV_DRAFT_NOTICE]),
      );
      expect(rows).toEqual([{ status: "active", approved_by: USER_CEO }]);
    });
  });

  describe("exclusion constraint", () => {
    it("rejects activating a draft whose date range overlaps an already-active version", async () => {
      await expect(
        db.asUser(USER_HR2, (query) => query("update policy_versions set status = 'active' where id = $1", [PV_DRAFT_OVERLAPPING])),
      ).rejects.toThrow(/conflicting key value violates exclusion constraint/);
    });

    it("allows drafting (though not yet activating) an overlapping version — only ACTIVE ranges are constrained", async () => {
      // PV_DRAFT_OVERLAPPING itself is exactly this case: seeded as a draft
      // overlapping PV_ACTIVE_2025 with no error at insert time.
      const { rows } = await db.asUser(USER_HR1, (query) => query("select status from policy_versions where id = $1", [PV_DRAFT_OVERLAPPING]));
      expect(rows).toEqual([{ status: "draft" }]);
    });
  });

  describe("deleting a draft", () => {
    it("lets a country HR Admin or CEO delete a draft version, but never an active one", async () => {
      const draftId = randomUUID();
      await db.seed(`
        insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
        values ('${draftId}', 'AE', 'probation_rules', 1, '2027-01-01', 'draft', '{}', '${USER_HR1}');
      `);
      await db.asUser(USER_HR2, async (query) => {
        const { rowCount } = await query("delete from policy_versions where id = $1", [draftId]);
        expect(rowCount).toBe(1);
      });

      await db.asUser(USER_HR1, async (query) => {
        const { rowCount } = await query("delete from policy_versions where id = $1", [PV_ACTIVE_2025]);
        expect(rowCount).toBe(0); // RLS silently filters rather than throwing on a no-match delete
      });
      const stillActive = await db.asUser(USER_HR1, (query) => query("select status from policy_versions where id = $1", [PV_ACTIVE_2025]));
      expect(stillActive.rows[0]?.status).toBe("active");
    });

    it("blocks a company-scoped HR Admin and a line manager from deleting a country-level draft", async () => {
      const draftId = randomUUID();
      await db.seed(`
        insert into policy_versions (id, country_code, policy_type, version_no, effective_from, status, payload, created_by)
        values ('${draftId}', 'AE', 'probation_rules', 2, '2027-01-01', 'draft', '{}', '${USER_HR1}');
      `);
      for (const user of [USER_COMPANY_HR, USER_MANAGER]) {
        const { rowCount } = await db.asUser(user, (query) => query("delete from policy_versions where id = $1", [draftId]));
        expect(rowCount).toBe(0);
      }
    });
  });

  describe("resolve_policy()", () => {
    it("resolves the active version covering a given date and nothing else", async () => {
      const covered = await db.asUser(USER_HR1, (query) => query("select resolve_policy('AE', 'leave_rules', '2025-06-01') as payload"));
      expect(covered.rows[0]?.payload).toEqual({ note: "v1 2025" });

      const outOfRange = await db.asUser(USER_HR1, (query) => query("select resolve_policy('AE', 'leave_rules', '2020-01-01') as payload"));
      expect(outOfRange.rows[0]?.payload).toBeNull();

      // 2026-06-01 falls in PV_DRAFT_NONOVERLAPPING's date range, but that
      // row is still a draft in this test's own transaction (its
      // activation in the previous describe block rolled back) — proving
      // resolve_policy() really does filter on status, not just dates.
      const stillDraft = await db.asUser(USER_HR1, (query) => query("select resolve_policy('AE', 'leave_rules', '2026-06-01') as payload"));
      expect(stillDraft.rows[0]?.payload).toBeNull();
    });
  });

  describe("policy_leave_types follows its parent's visibility", () => {
    it("lets HR Admin add a leave type to a draft, but not once the parent is active", async () => {
      const toDraft = await db.asUser(USER_HR1, (query) =>
        query(
          "insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method) values ($1, 'annual', 'Annual leave', 'monthly_accrual') returning leave_type_code",
          [PV_DRAFT_NONOVERLAPPING],
        ),
      );
      expect(toDraft.rows).toEqual([{ leave_type_code: "annual" }]);

      await expect(
        db.asUser(USER_HR1, (query) =>
          query(
            "insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method) values ($1, 'annual', 'Annual leave', 'monthly_accrual')",
            [PV_ACTIVE_2025],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("blocks a line manager from adding a leave type even to a draft", async () => {
      await expect(
        db.asUser(USER_MANAGER, (query) =>
          query(
            "insert into policy_leave_types (policy_version_id, leave_type_code, name, accrual_method) values ($1, 'sick', 'Sick leave', 'annual_grant')",
            [PV_DRAFT_NONOVERLAPPING],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("public_holidays", () => {
    it("is readable by any signed-in user, and invisible when signed out", async () => {
      const manager = await db.asUser(USER_MANAGER, (query) => query("select name from public_holidays"));
      expect(manager.rows.length).toBe(1);

      const anon = await db.asUser(null, (query) => query("select name from public_holidays"));
      expect(anon.rows).toEqual([]);
    });

    it("is writable only by that country's HR Admin", async () => {
      const hrInsert = await db.asUser(USER_HR1, (query) =>
        query("insert into public_holidays (country_code, holiday_date, name) values ('AE', '2026-12-02', 'National Day') returning name"),
      );
      expect(hrInsert.rows).toEqual([{ name: "National Day" }]);

      await expect(
        db.asUser(USER_COMPANY_HR, (query) =>
          query("insert into public_holidays (country_code, holiday_date, name) values ('AE', '2026-05-01', 'Should fail')"),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("adding a 4th country requires zero code changes", () => {
    // The whole point of the policy engine: a country nobody wrote in this
    // test file until this exact moment can draft, activate, and resolve a
    // policy through the same functions and RLS policies as UAE above —
    // proving country differences live entirely in data. Everything runs
    // inside one transaction (switching identity mid-transaction via
    // actAs()) so the intermediate insert is visible to the later
    // update/select even though the whole thing rolls back at the end.
    const FICTIONAL_COUNTRY = "ZZ";
    const USER_ZZ_HR1 = "00000000-0000-0000-0000-0000000002c1";
    const USER_ZZ_HR2 = "00000000-0000-0000-0000-0000000002c2";

    it("drafts, activates, and resolves a policy for a country added on the fly", async () => {
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_ZZ_HR1}', 'hr1@zz.example'),
          ('${USER_ZZ_HR2}', 'hr2@zz.example');
        insert into countries (code, name, default_currency) values ('${FICTIONAL_COUNTRY}', 'Zephyria', 'ZZD');
        insert into user_roles (user_id, role, country_code) values
          ('${USER_ZZ_HR1}', 'hr_admin', '${FICTIONAL_COUNTRY}'),
          ('${USER_ZZ_HR2}', 'hr_admin', '${FICTIONAL_COUNTRY}');
      `);

      await db.asUser(USER_ZZ_HR1, async (query) => {
        const draft = await query(
          `insert into policy_versions (country_code, policy_type, version_no, effective_from, payload, created_by)
           values ($1, 'leave_rules', 1, '2026-01-01', '{"annual_days": 45}', $2) returning id, status`,
          [FICTIONAL_COUNTRY, USER_ZZ_HR1],
        );
        expect(draft.rows[0]?.status).toBe("draft");
        const draftId = draft.rows[0]?.id;

        await actAs(query, USER_ZZ_HR2);
        const activated = await query("update policy_versions set status = 'active' where id = $1 returning status", [draftId]);
        expect(activated.rows).toEqual([{ status: "active" }]);

        const resolved = await query("select resolve_policy($1, 'leave_rules', '2026-06-01') as payload", [FICTIONAL_COUNTRY]);
        expect(resolved.rows[0]?.payload).toEqual({ annual_days: 45 });

        // UAE's own policy is completely unaffected by Zephyria existing.
        const uaeStillResolves = await query("select resolve_policy('AE', 'leave_rules', '2025-06-01') as payload");
        expect(uaeStillResolves.rows[0]?.payload).not.toBeNull();
      });
    });
  });
});
