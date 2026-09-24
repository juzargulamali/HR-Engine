import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Focused coverage for the Phase 2B v2 policy-data synchronisation
// (20261103000000_phase2b_v2_policy_drafts.sql) — narrow, per the brief:
// v2 draft creation/idempotency, no mutation of v1, no duplicate/conflicting
// v2, correct critical UAE/Saudi/Poland values, and the preflight status
// function. Not a re-test of the leave-entitlement math itself (already
// covered by packages/domain/test/annualLeaveEntitlement.test.ts) or of the
// pre-existing leave_rules/overtime_rules seeding shape (already covered by
// the original migration's own history) — just this round's changes.

const ACTOR = randomUUID();

describe("Phase 2B v2 policy-data synchronisation", () => {
  const db = new RlsTestDatabase();

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into auth.users (id, email) values ('${ACTOR}', 'v2-drafter@enginious.ae');
      -- Company-unscoped, country-unscoped HR Admin — matches
      -- policy_versions_select/_insert's has_role('hr_admin', null,
      -- country_code) requirement (a single-company HR Admin can't act on
      -- a policy affecting every company in a country); this actor is only
      -- used to exercise the SECURITY DEFINER function and read back what
      -- it did, same as "whoever is applying this migration" in production.
      insert into user_roles (user_id, role, company_id, country_code) values ('${ACTOR}', 'hr_admin', null, null);
    `);
    // The RLS harness applies supabase/migrations/*.sql only, not
    // supabase/seed.sql — so the 9 real v1 draft rows (production's actual
    // starting state, created_by = the all-zero placeholder) are seeded
    // here explicitly to match what this migration's function will
    // actually run against in production.
    await db.seed(`
      insert into policy_versions (country_code, policy_type, version_no, effective_from, status, payload, created_by) values
        ('AE', 'leave_rules', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('AE', 'notice_period', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('AE', 'probation_rules', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('SA', 'leave_rules', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('SA', 'notice_period', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('SA', 'probation_rules', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('PL', 'leave_rules', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('PL', 'notice_period', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000'),
        ('PL', 'probation_rules', 1, '2026-01-01', 'draft', '{}', '00000000-0000-0000-0000-000000000000');
    `);
  });

  afterAll(async () => {
    await db.teardown();
  });

  it("v1 seed records exist, untouched, before this migration's function ever runs", async () => {
    const { rows } = await db.asUser(ACTOR, (query) =>
      query("select country_code, policy_type, version_no, status, created_by from policy_versions where version_no = 1 order by country_code, policy_type"),
    );
    expect(rows).toHaveLength(9); // 3 countries x (leave_rules, notice_period, probation_rules)
    for (const row of rows) {
      expect(row.status).toBe("draft");
      expect(row.created_by).toBe("00000000-0000-0000-0000-000000000000");
    }
  });

  it("refuses (raises, never overwrites) when a conflicting, unmarked version already occupies the slot it would claim", async () => {
    // Run BEFORE any real v2 draft exists (a genuinely-fresh-database
    // scenario): an unmarked foreign draft sitting at exactly version_no 2
    // for AE/leave_rules — the slot this function would otherwise claim —
    // must abort the whole call rather than stack a v3 on top of it. Both
    // statements share one asUser() transaction, which always rolls back
    // at the end, so this leaves no trace for the tests that follow.
    await db.asUser(ACTOR, async (query) => {
      await query(
        `insert into policy_versions (country_code, policy_type, version_no, effective_from, status, payload, created_by)
         values ('AE', 'leave_rules', 2, '2027-01-01', 'draft', '{"note": "an unrelated manual draft"}', $1)`,
        [ACTOR],
      );
      await expect(query("select * from seed_phase2b_policy_drafts($1)", [ACTOR])).rejects.toThrow(/Conflict/);
    });
  });

  it("creates v2 drafts for leave_rules, overtime_rules, notice_period and probation_rules across AE/SA/PL, never touching v1", async () => {
    await db.asUserCommit(ACTOR, (query) => query("select * from seed_phase2b_policy_drafts($1)", [ACTOR]));

    const created = await db.asUser(ACTOR, (query) =>
      query(
        "select country_code, policy_type, version_no, status, created_by from policy_versions where payload->>'phase2b_seed_marker' = 'leave_policy_configuration' order by country_code, policy_type",
      ),
    );
    expect(created.rows).toHaveLength(12); // 3 countries x 4 policy types
    for (const row of created.rows) {
      // leave_rules/notice_period/probation_rules have a real v1 baseline,
      // so this is v2; overtime_rules (Recovery Leave) has no v1 at all, so
      // this is its own v1 — both are correct "next version" outcomes.
      expect(row.version_no).toBe(row.policy_type === "overtime_rules" ? 1 : 2);
      expect(row.status).toBe("draft"); // never activated
      expect(row.created_by).toBe(ACTOR); // never the all-zero placeholder
    }

    // v1 rows are completely unchanged: still exactly 9, still draft, still
    // the placeholder actor. Filtered by created_by, not just version_no=1
    // — overtime_rules' own freshly-created draft is ALSO version_no 1
    // (it has no v1 baseline of its own), so version_no alone can't
    // distinguish "the real v1 seed" from "a new v1 for a type that never
    // had one".
    const v1 = await db.asUser(ACTOR, (query) =>
      query("select id, status, created_by from policy_versions where created_by = '00000000-0000-0000-0000-000000000000'"),
    );
    expect(v1.rows).toHaveLength(9);
    for (const row of v1.rows) {
      expect(row.status).toBe("draft");
      expect(row.created_by).toBe("00000000-0000-0000-0000-000000000000");
    }
  });

  it("is idempotent — a second call reports every policy type as already seeded and creates no duplicate", async () => {
    const { rows } = await db.asUser(ACTOR, (query) => query("select * from seed_phase2b_policy_drafts($1)", [ACTOR]));
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.action).toBe("skipped_already_seeded");
      expect(row.version_no).toBeNull();
    }

    const count = await db.asUser(ACTOR, (query) =>
      query("select count(*) from policy_versions where payload->>'phase2b_seed_marker' = 'leave_policy_configuration'"),
    );
    expect(Number(count.rows[0]?.count)).toBe(12); // still exactly 12, not 24
  });

  it("UAE and Saudi v2 leave types use the domain calculator's own delta method (per_service_year), never a restored fixed monthly rate", async () => {
    const { rows } = await db.asUser(ACTOR, (query) =>
      query(
        `select pv.country_code, plt.accrual_method, plt.accrual_rate_per_period, plt.max_balance_days
         from policy_versions pv join policy_leave_types plt on plt.policy_version_id = pv.id
         where pv.country_code in ('AE','SA') and pv.policy_type = 'leave_rules' and pv.version_no = 2 and plt.leave_type_code = 'annual'
         order by pv.country_code`,
      ),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.accrual_method).toBe("per_service_year");
      expect(row.accrual_rate_per_period).toBeNull(); // never 2.5 (AE) or 1.75 (SA)
    }
  });

  it("Poland v2 annual leave uses annual_grant with no statutory 20/26 threshold logic encoded", async () => {
    const { rows } = await db.asUser(ACTOR, (query) =>
      query(
        `select pv.payload->>'summary' as summary, plt.accrual_method, plt.max_balance_days
         from policy_versions pv join policy_leave_types plt on plt.policy_version_id = pv.id
         where pv.country_code = 'PL' and pv.policy_type = 'leave_rules' and pv.version_no = 2 and plt.leave_type_code = 'annual'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accrual_method).toBe("annual_grant");
    expect(Number(rows[0]?.max_balance_days)).toBe(26);
    // Flat 26 for every employee stated as the active rule; the retired
    // statutory threshold may still be named ONLY as something explicitly
    // disclaimed/superseded, never as the current entitlement figure.
    expect(rows[0]?.summary).toMatch(/flat Enginious company benefit of 26 working days per complete calendar year for EVERY employee/);
    expect(rows[0]?.summary).not.toMatch(/20 working days\/year/i);
    expect(rows[0]?.summary).not.toMatch(/first-time employee accrues/i);
  });

  it("preflight_phase2b_v2_policy_status reports all 12 v2 drafts as unambiguously resolvable (nothing active yet to collide with)", async () => {
    const { rows } = await db.asUser(ACTOR, (query) => query("select * from preflight_phase2b_v2_policy_status()"));
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.status).toBe("draft");
      expect(row.runtime_can_resolve_unambiguously).toBe(true);
      expect(row.critical_values).not.toBeNull();
    }
  });

  it("refuses a null or non-existent actor — never the all-zero placeholder", async () => {
    await expect(db.asUser(ACTOR, (query) => query("select * from seed_phase2b_policy_drafts(null)"))).rejects.toThrow(/requires a real authenticated actor/);
    await expect(
      db.asUser(ACTOR, (query) => query("select * from seed_phase2b_policy_drafts('00000000-0000-0000-0000-000000000000')")),
    ).rejects.toThrow(/does not correspond to a real auth.users row/);
  });
});
