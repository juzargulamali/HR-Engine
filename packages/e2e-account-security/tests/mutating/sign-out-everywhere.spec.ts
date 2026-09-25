import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";

/** MUTATING: really signs out every session for a disposable test account. */
test("sign out of all devices ends every session, including the one that requested it", async ({ browser }) => {
  const admin = createTestAdminClient();
  const user: TestUser = await createTestUser(admin);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await loginAs(pageA, user.email, user.password);
    await loginAs(pageB, user.email, user.password);

    await pageA.goto("/account/security");
    await pageA.getByRole("button", { name: "Sign out of all devices" }).click();
    await pageA.getByRole("button", { name: "Confirm" }).click();
    await expect(pageA).toHaveURL(/\/login/);

    await pageB.goto("/account/security");
    await expect(pageB).toHaveURL(/\/login/);

    const { data } = await admin
      .from("audit_log")
      .select("action, actor_id")
      .eq("table_name", "profiles")
      .eq("record_id", user.id)
      .eq("action", "all_device_signout_requested")
      .limit(1);
    expect(data).toHaveLength(1);
    expect(data![0]!.actor_id).toBe(user.id);
  } finally {
    await contextA.close();
    await contextB.close();
    await deleteTestUser(admin, user.id);
  }
});
