import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

/**
 * revoke_role_grant() (20261030000000_guard_role_grant_revocation.sql)
 * replaces a direct authenticated UPDATE of user_roles.revoked_at, which is
 * no longer possible at all (see that migration) — this is the only way to
 * revoke a grant now, so it's the one place both the self-revocation guard
 * and the last-System-Administrator guard need to be proven.
 *
 * Each `describe` below gets its own throwaway database because the
 * last-System-Administrator check counts ALL active sys_admin grants in the
 * whole table — a shared fixture across scenarios that need different
 * global counts (one admin vs. two) would make them interfere with each
 * other.
 */
describe("revoke_role_grant()", () => {
  describe("with two System Administrators", () => {
    const db = new RlsTestDatabase();
    const USER_ADMIN_A = "00000000-0000-0000-0000-00000000ab01";
    const USER_ADMIN_B = "00000000-0000-0000-0000-00000000ab02";
    const USER_HR = "00000000-0000-0000-0000-00000000ab03";
    const USER_PLAIN = "00000000-0000-0000-0000-00000000ab04";
    const GRANT_ADMIN_A = "00000000-0000-0000-0000-00000000ac01";
    const GRANT_ADMIN_B = "00000000-0000-0000-0000-00000000ac02";
    const GRANT_HR = "00000000-0000-0000-0000-00000000ac03";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_ADMIN_A}', 'rrg-admin-a@enginious.ae'),
          ('${USER_ADMIN_B}', 'rrg-admin-b@enginious.ae'),
          ('${USER_HR}', 'rrg-hr@enginious.ae'),
          ('${USER_PLAIN}', 'rrg-plain@enginious.ae');

        insert into user_roles (id, user_id, role) values
          ('${GRANT_ADMIN_A}', '${USER_ADMIN_A}', 'sys_admin'),
          ('${GRANT_ADMIN_B}', '${USER_ADMIN_B}', 'sys_admin'),
          ('${GRANT_HR}', '${USER_HR}', 'hr_admin');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("blocks a Sys Admin from revoking their own grant, even though another admin exists", async () => {
      await expect(
        db.asUser(USER_ADMIN_A, (query) => query("select revoke_role_grant($1)", [GRANT_ADMIN_A])),
      ).rejects.toThrow("You can't revoke your own role");
    });

    it("lets one Sys Admin revoke another's grant when at least two remain active", async () => {
      const { rows } = await db.asUser(USER_ADMIN_A, async (query) => {
        await query("select revoke_role_grant($1)", [GRANT_ADMIN_B]);
        return query("select revoked_at from user_roles where id = $1", [GRANT_ADMIN_B]);
      });
      expect(rows[0].revoked_at).not.toBeNull();
    });

    it("revokes an ordinary (non-sys_admin) role grant normally", async () => {
      const { rows } = await db.asUser(USER_ADMIN_A, async (query) => {
        await query("select revoke_role_grant($1)", [GRANT_HR]);
        return query("select revoked_at from user_roles where id = $1", [GRANT_HR]);
      });
      expect(rows[0].revoked_at).not.toBeNull();
    });

    it("rejects an authenticated caller who isn't a System Administrator", async () => {
      await expect(
        db.asUser(USER_PLAIN, (query) => query("select revoke_role_grant($1)", [GRANT_HR])),
      ).rejects.toThrow("Only a System Administrator");
    });

    it("rejects an anonymous caller", async () => {
      await expect(db.asUser(null, (query) => query("select revoke_role_grant($1)", [GRANT_HR]))).rejects.toThrow(
        "Only a System Administrator",
      );
    });

    // The two tests above already prove revoke_role_grant() still works for
    // a permitted revocation ("lets one Sys Admin revoke another's grant…"
    // and "revokes an ordinary…role grant normally"). These two prove the
    // direct-write bypass this correction closes: user_roles has no UPDATE
    // or DELETE policy left at all — so even a genuine Sys Admin's direct
    // UPDATE/DELETE affects zero rows under RLS (silently, not an error;
    // same pattern already relied on for approvals/leave_ledger/
    // comp_day_ledger's own "revoke ... from authenticated" — see
    // phase3.rls.test.ts's "never lets a client directly insert or update a
    // decided approval row..."), not through that guarded RPC.
    it("blocks a Sys Admin from directly UPDATEing revoked_at, bypassing the RPC", async () => {
      const { rowCount } = await db.asUser(USER_ADMIN_A, (query) =>
        query("update user_roles set revoked_at = now() where id = $1", [GRANT_HR]),
      );
      expect(rowCount).toBe(0); // no UPDATE policy exists at all for user_roles
    });

    it("blocks a Sys Admin from directly DELETEing a role grant, bypassing the RPC", async () => {
      const { rowCount } = await db.asUser(USER_ADMIN_A, (query) => query("delete from user_roles where id = $1", [GRANT_HR]));
      expect(rowCount).toBe(0); // no DELETE policy exists at all for user_roles
    });
  });

  describe("with a single System Administrator", () => {
    const db = new RlsTestDatabase();
    const USER_SOLE_ADMIN = "00000000-0000-0000-0000-00000000ad01";
    const GRANT_SOLE_ADMIN = "00000000-0000-0000-0000-00000000ae01";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values ('${USER_SOLE_ADMIN}', 'rrg-sole@enginious.ae');
        insert into user_roles (id, user_id, role) values ('${GRANT_SOLE_ADMIN}', '${USER_SOLE_ADMIN}', 'sys_admin');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("blocks revoking the last active System Administrator", async () => {
      await expect(
        db.asUser(USER_SOLE_ADMIN, (query) => query("select revoke_role_grant($1)", [GRANT_SOLE_ADMIN])),
      ).rejects.toThrow("last System Administrator");
    });
  });

  describe("concurrent revocation of two System Administrators", () => {
    const db = new RlsTestDatabase();
    const USER_X = "00000000-0000-0000-0000-00000000af01";
    const USER_Y = "00000000-0000-0000-0000-00000000af02";
    const GRANT_X = "00000000-0000-0000-0000-00000000b001";
    const GRANT_Y = "00000000-0000-0000-0000-00000000b002";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`
        insert into auth.users (id, email) values
          ('${USER_X}', 'rrg-conc-x@enginious.ae'),
          ('${USER_Y}', 'rrg-conc-y@enginious.ae');

        insert into user_roles (id, user_id, role) values
          ('${GRANT_X}', '${USER_X}', 'sys_admin'),
          ('${GRANT_Y}', '${USER_Y}', 'sys_admin');
      `);
    }, 30_000);

    afterAll(() => db.teardown());

    it("never leaves zero active System Administrators when both are revoked at the same time", async () => {
      // asUserCommit (unlike asUser) actually commits, because this needs to
      // exercise a real cross-transaction race: two System Administrators
      // each revoking the OTHER's grant at the same moment. Without the
      // advisory lock in revoke_role_grant(), both could read "2 active"
      // before either commits and both would proceed, leaving zero.
      const results = await Promise.allSettled([
        db.asUserCommit(USER_X, (query) => query("select revoke_role_grant($1)", [GRANT_Y])),
        db.asUserCommit(USER_Y, (query) => query("select revoke_role_grant($1)", [GRANT_X])),
      ]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const { rows } = await db.seed("select count(*)::int as count from user_roles where role = 'sys_admin' and revoked_at is null");
      expect(rows[0].count).toBe(1);
    });
  });

  describe("service-role / test-seeding access", () => {
    const db = new RlsTestDatabase();
    const USER_SEED = "00000000-0000-0000-0000-00000000b101";
    const GRANT_SEED = "00000000-0000-0000-0000-00000000b102";

    beforeAll(async () => {
      await db.setup();
      await db.seed(`insert into auth.users (id, email) values ('${USER_SEED}', 'rrg-seed@enginious.ae');`);
    }, 30_000);

    afterAll(() => db.teardown());

    // db.seed() runs as the unrestricted admin connection, standing in here
    // for the real service-role client deleteUserAccount() uses — the
    // `revoke update, delete on user_roles from authenticated, anon` above
    // deliberately names only those two roles, so this direct INSERT,
    // UPDATE, and DELETE (the shape of every phaseN test's own fixture
    // setup/teardown, and of deleteUserAccount()'s cleanup) must all keep
    // working exactly as before.
    it("lets the admin/service-role connection insert, update, and delete user_roles rows directly", async () => {
      await db.seed(`insert into user_roles (id, user_id, role) values ('${GRANT_SEED}', '${USER_SEED}', 'hr_admin');`);
      const { rows: afterInsert } = await db.seed(`select revoked_at from user_roles where id = '${GRANT_SEED}'`);
      expect(afterInsert[0].revoked_at).toBeNull();

      await db.seed(`update user_roles set revoked_at = now() where id = '${GRANT_SEED}'`);
      const { rows: afterUpdate } = await db.seed(`select revoked_at from user_roles where id = '${GRANT_SEED}'`);
      expect(afterUpdate[0].revoked_at).not.toBeNull();

      await db.seed(`delete from user_roles where id = '${GRANT_SEED}'`);
      const { rows: afterDelete } = await db.seed(`select id from user_roles where id = '${GRANT_SEED}'`);
      expect(afterDelete).toHaveLength(0);
    });
  });
});
