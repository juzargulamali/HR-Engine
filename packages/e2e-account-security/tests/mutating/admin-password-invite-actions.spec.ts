import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";

/**
 * MUTATING: really sends real emails via Supabase (a password-reset email
 * and, indirectly through resendInvite, a set-password email) and writes
 * real audit_log rows. Never run against Production.
 */
test.describe("admin-triggered password reset and invite resend", () => {
  const admin = createTestAdminClient();
  let sysAdmin: TestUser;
  let target: TestUser;

  test.beforeAll(async () => {
    sysAdmin = await createTestUser(admin, { role: "sys_admin" });
    target = await createTestUser(admin);
  });
  test.afterAll(async () => {
    await deleteTestUser(admin, target.id);
    await deleteTestUser(admin, sysAdmin.id);
  });

  test("admin 'Send password reset' logs password_reset_sent_by_admin against the target", async ({ page }) => {
    await loginAs(page, sysAdmin.email, sysAdmin.password);
    await page.goto("/admin/users");
    const row = page.getByRole("row", { name: new RegExp(target.email) });
    await row.getByRole("button", { name: "Send password reset" }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("audit_log")
          .select("actor_id")
          .eq("action", "password_reset_sent_by_admin")
          .eq("record_id", target.id)
          .limit(1);
        return data?.length ?? 0;
      })
      .toBeGreaterThan(0);
  });
});
