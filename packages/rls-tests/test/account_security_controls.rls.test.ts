import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

/**
 * 20261104000000_account_security_controls.sql: account_status lifecycle,
 * the self-activation/self-update guard on profiles, set_account_status(),
 * and log_security_event(). Each describe gets its own database for the
 * same reason revoke_role_grant.rls.test.ts does — the last-active-
 * System-Administrator check counts every active sys_admin globally.
 */
describe("account security controls", () => {
  describe("migration backfill (pre-existing profiles)", () => {
    // Uses setupBefore()/applyMigration() rather than setup() — a fresh
    // database created by setup() has no profiles that predate this
    // migration, so it can't exercise what happens to one that does. This
    // reproduces the real upgrade scenario: a profile that already existed
    // when 20261104000000_account_security_controls.sql ran.
    const db = new RlsTestDatabase();
    const PRE_EXISTING_USER = "00000000-0000-0000-0000-0000000c0501";
    const MIGRATION_FILE = "20261104000000_account_security_controls.sql";

    beforeAll(async () => {
      await db.setupBefore(MIGRATION_FILE);
      await db.seed(`insert into auth.users (id, email) values ('${PRE_EXISTING_USER}', 'backfill-pre-existing@enginious.ae');`);
      await db.applyMigration(MIGRATION_FILE);
    }, 30_000);

    afterAll(() => db.teardown());

    it("backfills a pre-existing profile straight to 'active', never 'invited'", async () => {
      const { rows } = await db.seed(`select account_status from profiles where id = '${PRE_EXISTING_USER}'`);
      expect(rows[0].account_status).toBe("active");
    });

    it("does not generate any audit_log noise for the backfill", async () => {
      const { rows } = await db.seed(`select count(*)::int as count from audit_log where table_name = 'profiles'`);
      expect(rows[0].count).toBe(0);
    });

    it("leaves status_reason/status_changed_by/status_changed_at unset for the backfilled row", async () => {
      const { rows } = await db.seed(
        `select status_reason, status_changed_by, status_changed_at from profiles where id = '${PRE_EXISTING_USER}'`,
      );
      expect(rows[0].status_reason).toBeNull();
      expect(rows[0].status_changed_by).toBeNull();
      expect(rows[0].status_changed_at).toBeNull();
    });
  });

  describe("profiles self-update guard + self-activation", () => {
    const db = new RlsTestDatabase();
    const USER_INVITED = "00000000-0000-0000-0000-0000000c0001";
    const USER_ADMIN = "00000000-0000-0000-0000-0000000c0002";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_INVITED}', 'asc-invited@enginious.ae'),
          ('${USER_ADMIN}', 'asc-admin@enginious.ae');
        insert into user_roles (user_id, role) values ('${USER_ADMIN}', 'sys_admin');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("defaults a newly-provisioned profile to invited", async () => {
      const { rows } = await db.seed(`select account_status from profiles where id = '${USER_INVITED}'`);
      expect(rows[0].account_status).toBe("invited");
    });

    it("lets a user complete the invited -> active self-activation transition", async () => {
      const { rows } = await db.asUser(USER_INVITED, async (query) => {
        await query("update profiles set account_status = 'active' where id = $1", [USER_INVITED]);
        return query("select account_status from profiles where id = $1", [USER_INVITED]);
      });
      expect(rows[0].account_status).toBe("active");
    });

    it("blocks a plain user from setting their own account_status to anything else", async () => {
      await expect(
        db.asUser(USER_INVITED, (query) => query("update profiles set account_status = 'deactivated' where id = $1", [USER_INVITED])),
      ).rejects.toThrow("account_status can only be changed by a System Administrator");
    });

    it("blocks a plain user from forging status_reason/status_changed_by on their own row", async () => {
      await expect(
        db.asUser(USER_INVITED, (query) =>
          query("update profiles set status_reason = 'forged' where id = $1", [USER_INVITED]),
        ),
      ).rejects.toThrow("Only full_name and locale can be self-updated");
    });

    it("still lets a plain user update full_name and locale on their own row", async () => {
      const { rows } = await db.asUser(USER_INVITED, async (query) => {
        await query("update profiles set full_name = $2 where id = $1", [USER_INVITED, "New Name"]);
        return query("select full_name from profiles where id = $1", [USER_INVITED]);
      });
      expect(rows[0].full_name).toBe("New Name");
    });

    it("lets Sys Admin set any profile's account_status directly (profiles_write_sysadmin)", async () => {
      const { rows } = await db.asUser(USER_ADMIN, async (query) => {
        await query("update profiles set account_status = 'deactivated', status_reason = 'test' where id = $1", [USER_INVITED]);
        return query("select account_status, status_reason from profiles where id = $1", [USER_INVITED]);
      });
      expect(rows[0].account_status).toBe("deactivated");
      expect(rows[0].status_reason).toBe("test");
    });
  });

  describe("set_account_status() with two System Administrators", () => {
    const db = new RlsTestDatabase();
    const USER_ADMIN_A = "00000000-0000-0000-0000-0000000c0101";
    const USER_ADMIN_B = "00000000-0000-0000-0000-0000000c0102";
    const USER_PLAIN = "00000000-0000-0000-0000-0000000c0103";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_ADMIN_A}', 'asc-admin-a@enginious.ae'),
          ('${USER_ADMIN_B}', 'asc-admin-b@enginious.ae'),
          ('${USER_PLAIN}', 'asc-plain@enginious.ae');
        insert into user_roles (user_id, role) values
          ('${USER_ADMIN_A}', 'sys_admin'),
          ('${USER_ADMIN_B}', 'sys_admin');
        -- Both admins already completed set-password in this scenario — the
        -- last-active-admin guard deliberately only counts 'active' accounts
        -- (an invited/deactivated sys_admin can't sign in to act as one).
        update profiles set account_status = 'active' where id in ('${USER_ADMIN_A}', '${USER_ADMIN_B}');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("rejects a non-sys_admin caller", async () => {
      await expect(
        db.asUser(USER_PLAIN, (query) => query("select set_account_status($1, 'deactivated', 'reason')", [USER_ADMIN_B])),
      ).rejects.toThrow("Only a System Administrator");
    });

    it("rejects an anonymous caller", async () => {
      await expect(
        db.asUser(null, (query) => query("select set_account_status($1, 'deactivated', 'reason')", [USER_PLAIN])),
      ).rejects.toThrow("Only a System Administrator");
    });

    it("rejects a blank reason", async () => {
      await expect(
        db.asUser(USER_ADMIN_A, (query) => query("select set_account_status($1, 'deactivated', '   ')", [USER_PLAIN])),
      ).rejects.toThrow("A reason is required");
    });

    it("rejects a reason over 500 characters (defense-in-depth backstop matching the app-layer limit)", async () => {
      await expect(
        db.asUser(USER_ADMIN_A, (query) => query("select set_account_status($1, 'deactivated', $2)", [USER_PLAIN, "x".repeat(501)])),
      ).rejects.toThrow("too long");
    });

    it("accepts a reason at exactly 500 characters", async () => {
      // asUser (auto-rollback), not asUserCommit — this only needs to prove
      // the call doesn't throw, not leave USER_PLAIN deactivated for the
      // later tests in this same describe that assume it starts 'active'.
      await expect(
        db.asUser(USER_ADMIN_A, (query) => query("select set_account_status($1, 'deactivated', $2)", [USER_PLAIN, "x".repeat(500)])),
      ).resolves.toBeDefined();
    });

    it("blocks a Sys Admin from changing their own account status", async () => {
      await expect(
        db.asUser(USER_ADMIN_A, (query) => query("select set_account_status($1, 'deactivated', 'reason')", [USER_ADMIN_A])),
      ).rejects.toThrow("can't change your own account status");
    });

    it("lets a Sys Admin deactivate a plain user, recording who/why/when", async () => {
      const { rows } = await db.asUser(USER_ADMIN_A, async (query) => {
        await query("select set_account_status($1, 'deactivated', $2)", [USER_PLAIN, "policy violation"]);
        return query("select account_status, status_reason, status_changed_by from profiles where id = $1", [USER_PLAIN]);
      });
      expect(rows[0].account_status).toBe("deactivated");
      expect(rows[0].status_reason).toBe("policy violation");
      expect(rows[0].status_changed_by).toBe(USER_ADMIN_A);
    });

    it("lets a Sys Admin reactivate a deactivated user", async () => {
      const { rows } = await db.asUser(USER_ADMIN_B, async (query) => {
        await query("select set_account_status($1, 'active', $2)", [USER_PLAIN, "appeal approved"]);
        return query("select account_status from profiles where id = $1", [USER_PLAIN]);
      });
      expect(rows[0].account_status).toBe("active");
    });

    it("records the profiles change in audit_log, visible to Sys Admin only", async () => {
      // A dedicated target + asUserCommit, since audit_log is checked from a
      // separate connection afterward — a plain asUser call's write would
      // already have rolled back by the time that separate check runs.
      const USER_AUDIT_TARGET = "00000000-0000-0000-0000-0000000c0106";
      await db.seed(`insert into auth.users (id, email) values ('${USER_AUDIT_TARGET}', 'asc-audit-target@enginious.ae');`);
      await db.asUserCommit(USER_ADMIN_A, (query) =>
        query("select set_account_status($1, 'deactivated', $2)", [USER_AUDIT_TARGET, "audit trail check"]),
      );

      const { rows } = await db.seed(
        `select table_name, action, company_id from audit_log where table_name = 'profiles' and record_id = '${USER_AUDIT_TARGET}' order by occurred_at desc limit 1`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("update");

      const asAdmin = await db.asUser(USER_ADMIN_A, (query) =>
        query("select 1 as ok from audit_log where table_name = 'profiles' and record_id = $1", [USER_AUDIT_TARGET]),
      );
      expect(asAdmin.rows.length).toBeGreaterThan(0);
    });
  });

  describe("set_account_status() last-active-admin guard", () => {
    // Its own database, like revoke_role_grant.rls.test.ts's "with a single
    // System Administrator" describe — the guard counts every active
    // sys_admin in the whole table, so it can't share a fixture with a
    // scenario that seeds a different global count.
    const db = new RlsTestDatabase();
    const USER_SOLE_ACTIVE = "00000000-0000-0000-0000-0000000c0110";
    const USER_NOT_ACTIVE_ADMIN = "00000000-0000-0000-0000-0000000c0111";

    beforeAll(async () => {
      await db.setup();
      // has_role('sys_admin') (the only-a-Sys-Admin-may-call check) reads
      // user_roles, not account_status — it doesn't care that the caller's
      // own account isn't active. That's fine: a real deactivated or
      // never-activated sys_admin can't actually reach this call in
      // production (auth.users.banned_until/no completed sign-in blocks
      // them before RLS ever sees a request), but it means the guard
      // itself has to correctly account for a non-active sys_admin role
      // holder attempting this anyway — seeded here so USER_SOLE_ACTIVE is
      // the only ACTIVE sys_admin and the target.
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_SOLE_ACTIVE}', 'asc-sole-active@enginious.ae'),
          ('${USER_NOT_ACTIVE_ADMIN}', 'asc-not-active-admin@enginious.ae');
        insert into user_roles (user_id, role) values
          ('${USER_SOLE_ACTIVE}', 'sys_admin'),
          ('${USER_NOT_ACTIVE_ADMIN}', 'sys_admin');
        update profiles set account_status = 'active' where id = '${USER_SOLE_ACTIVE}';
        update profiles set account_status = 'deactivated' where id = '${USER_NOT_ACTIVE_ADMIN}';
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("blocks deactivating the last active System Administrator", async () => {
      await expect(
        db.asUser(USER_NOT_ACTIVE_ADMIN, (query) =>
          query("select set_account_status($1, 'deactivated', 'test')", [USER_SOLE_ACTIVE]),
        ),
      ).rejects.toThrow("last active System Administrator");
    });
  });

  describe("concurrent deactivation of two remaining System Administrators", () => {
    const db = new RlsTestDatabase();
    const USER_X = "00000000-0000-0000-0000-0000000c0201";
    const USER_Y = "00000000-0000-0000-0000-0000000c0202";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_X}', 'asc-conc-x@enginious.ae'),
          ('${USER_Y}', 'asc-conc-y@enginious.ae');
        insert into user_roles (user_id, role) values
          ('${USER_X}', 'sys_admin'),
          ('${USER_Y}', 'sys_admin');
        update profiles set account_status = 'active' where id in ('${USER_X}', '${USER_Y}');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("never leaves zero active System Administrators when both deactivate each other at once", async () => {
      const results = await Promise.allSettled([
        db.asUserCommit(USER_X, (query) => query("select set_account_status($1, 'deactivated', 'race')", [USER_Y])),
        db.asUserCommit(USER_Y, (query) => query("select set_account_status($1, 'deactivated', 'race')", [USER_X])),
      ]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const { rows } = await db.seed(`
        select count(*)::int as count from user_roles ur
        join profiles p on p.id = ur.user_id
        where ur.role = 'sys_admin' and ur.revoked_at is null and p.account_status = 'active'
      `);
      expect(rows[0].count).toBe(1);
    });
  });

  describe("log_security_event()", () => {
    const db = new RlsTestDatabase();
    const USER_SELF = "00000000-0000-0000-0000-0000000c0301";
    const USER_ADMIN = "00000000-0000-0000-0000-0000000c0302";
    const USER_OTHER = "00000000-0000-0000-0000-0000000c0303";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_SELF}', 'lse-self@enginious.ae'),
          ('${USER_ADMIN}', 'lse-admin@enginious.ae'),
          ('${USER_OTHER}', 'lse-other@enginious.ae');
        insert into user_roles (user_id, role) values ('${USER_ADMIN}', 'sys_admin');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("lets an anonymous caller log password_reset_requested, resolving the target from the email", async () => {
      await db.asUserCommit(null, (query) =>
        query("select log_security_event('password_reset_requested', null, $1, '{}'::jsonb)", ["lse-self@enginious.ae"]),
      );
      const { rows } = await db.seed(
        `select record_id, actor_id from audit_log where action = 'password_reset_requested' order by occurred_at desc limit 1`,
      );
      expect(rows[0].record_id).toBe(USER_SELF);
      expect(rows[0].actor_id).toBeNull();
    });

    it("succeeds silently for password_reset_requested even when no account matches the email", async () => {
      await expect(
        db.asUser(null, (query) =>
          query("select log_security_event('password_reset_requested', null, $1, '{}'::jsonb)", ["nobody@enginious.ae"]),
        ),
      ).resolves.toBeDefined();
    });

    it("lets a signed-in user log password_changed against themselves only", async () => {
      await db.asUserCommit(USER_SELF, (query) => query("select log_security_event('password_changed')"));
      const { rows } = await db.seed(
        `select record_id from audit_log where action = 'password_changed' order by occurred_at desc limit 1`,
      );
      expect(rows[0].record_id).toBe(USER_SELF);
    });

    it("rejects password_changed from an anonymous caller", async () => {
      await expect(db.asUser(null, (query) => query("select log_security_event('password_changed')"))).rejects.toThrow(
        "Not signed in",
      );
    });

    it("rejects an ordinary user logging an admin-only action", async () => {
      await expect(
        db.asUser(USER_SELF, (query) => query("select log_security_event('invitation_resent', $1)", [USER_OTHER])),
      ).rejects.toThrow("Only a System Administrator");
    });

    it("lets a Sys Admin log invitation_resent against a real target", async () => {
      await db.asUserCommit(USER_ADMIN, (query) => query("select log_security_event('invitation_resent', $1)", [USER_OTHER]));
      const { rows } = await db.seed(
        `select record_id, actor_id from audit_log where action = 'invitation_resent' order by occurred_at desc limit 1`,
      );
      expect(rows[0].record_id).toBe(USER_OTHER);
      expect(rows[0].actor_id).toBe(USER_ADMIN);
    });

    it("rejects an admin-only action against a nonexistent target", async () => {
      await expect(
        db.asUser(USER_ADMIN, (query) =>
          query("select log_security_event('invitation_resent', $1)", ["00000000-0000-0000-0000-000000000000"]),
        ),
      ).rejects.toThrow("Unknown target account");
    });

    it("rejects an unknown action", async () => {
      await expect(db.asUser(USER_SELF, (query) => query("select log_security_event('made_up_action')"))).rejects.toThrow(
        "Unknown security event action",
      );
    });

    it("strips every metadata key — password_changed's allowlist is empty, so nothing survives, not even an innocuous key", async () => {
      await db.asUserCommit(USER_SELF, (query) =>
        query("select log_security_event('password_changed', null, null, $1::jsonb)", [
          JSON.stringify({ password: "hunter2", token: "abc", safe: "ok" }),
        ]),
      );
      const { rows } = await db.seed(
        `select after_data from audit_log where action = 'password_changed' and record_id = '${USER_SELF}' order by occurred_at desc limit 1`,
      );
      // Allowlist, not denylist: 'safe' isn't a secret-shaped key, but it's
      // also not on password_changed's (empty) allowlist, so it's dropped
      // too — proving this isn't just pattern-matching known-bad names.
      expect(rows[0].after_data).toEqual({});
    });

    it("strips obvious secret-shaped key variants beyond the original 4 exact names", async () => {
      await db.asUserCommit(USER_SELF, (query) =>
        query("select log_security_event('password_changed', null, null, $1::jsonb)", [
          JSON.stringify({
            newPassword: "hunter2",
            resetUrl: "https://evil.example/reset?token=abc",
            resetLink: "https://evil.example/reset?token=abc",
            authorization: "Bearer abc123",
            cookie: "sb-session=abc123",
          }),
        ]),
      );
      const { rows } = await db.seed(
        `select after_data from audit_log where action = 'password_changed' and record_id = '${USER_SELF}' order by occurred_at desc limit 1`,
      );
      expect(rows[0].after_data).toEqual({});
    });
  });

  describe("log_security_event() — account_reconciliation_required", () => {
    const db = new RlsTestDatabase();
    const USER_ADMIN = "00000000-0000-0000-0000-0000000c0304";
    const USER_PLAIN = "00000000-0000-0000-0000-0000000c0305";
    const USER_TARGET = "00000000-0000-0000-0000-0000000c0306";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_ADMIN}', 'lse-recon-admin@enginious.ae'),
          ('${USER_PLAIN}', 'lse-recon-plain@enginious.ae'),
          ('${USER_TARGET}', 'lse-recon-target@enginious.ae');
        insert into user_roles (user_id, role) values ('${USER_ADMIN}', 'sys_admin');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("rejects a non-sys_admin caller", async () => {
      await expect(
        db.asUser(USER_PLAIN, (query) => query("select log_security_event('account_reconciliation_required', $1)", [USER_TARGET])),
      ).rejects.toThrow("Only a System Administrator");
    });

    it("rejects an unknown target", async () => {
      await expect(
        db.asUser(USER_ADMIN, (query) =>
          query("select log_security_event('account_reconciliation_required', $1)", ["00000000-0000-0000-0000-000000000000"]),
        ),
      ).rejects.toThrow("Unknown target account");
    });

    it("lets a Sys Admin log it against a real target, actor and target both recorded", async () => {
      await db.asUserCommit(USER_ADMIN, (query) => query("select log_security_event('account_reconciliation_required', $1)", [USER_TARGET]));
      const { rows } = await db.seed(
        `select record_id, actor_id from audit_log where action = 'account_reconciliation_required' order by occurred_at desc limit 1`,
      );
      expect(rows[0].record_id).toBe(USER_TARGET);
      expect(rows[0].actor_id).toBe(USER_ADMIN);
    });
  });

  describe("audit_log_select_sysadmin widened to profiles", () => {
    const db = new RlsTestDatabase();
    const USER_ADMIN = "00000000-0000-0000-0000-0000000c0401";
    const USER_HR = "00000000-0000-0000-0000-0000000c0402";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_ADMIN}', 'alsp-admin@enginious.ae'),
          ('${USER_HR}', 'alsp-hr@enginious.ae');
        insert into user_roles (user_id, role) values
          ('${USER_ADMIN}', 'sys_admin'),
          ('${USER_HR}', 'hr_admin');
        update profiles set full_name = 'Renamed' where id = '${USER_HR}';
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("lets Sys Admin see a profiles audit row", async () => {
      const { rows } = await db.asUser(USER_ADMIN, (query) =>
        query("select 1 as ok from audit_log where table_name = 'profiles' and record_id = $1", [USER_HR]),
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("does not let HR Admin see a profiles audit row (system-scoped, not HR-scoped)", async () => {
      const { rows } = await db.asUser(USER_HR, (query) =>
        query("select 1 as ok from audit_log where table_name = 'profiles' and record_id = $1", [USER_HR]),
      );
      expect(rows).toHaveLength(0);
    });
  });
});
