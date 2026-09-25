import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";
import { loginAs } from "../../src/auth";

/**
 * MUTATING: really changes a (disposable) test account's password and
 * really signs out its other sessions. Never run against Production.
 */
test("a successful password change signs out every other session, keeps this one", async ({ browser }) => {
  const admin = createTestAdminClient();
  const user = await createTestUser(admin);
  const newPassword = "Brand-N3w-Passw0rd!";

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await loginAs(pageA, user.email, user.password);
    await loginAs(pageB, user.email, user.password);

    await pageA.goto("/account/security");
    await pageA.getByLabel("Current password").fill(user.password);
    await pageA.getByLabel("New password", { exact: true }).fill(newPassword);
    await pageA.getByLabel("Confirm new password").fill(newPassword);
    await pageA.getByRole("button", { name: "Change password" }).click();
    await expect(pageA.getByText(/password changed/i)).toBeVisible();

    // Session A must still be usable — signOut({scope:'others'}) never
    // touches the caller's own session.
    await pageA.goto("/account/security");
    await expect(pageA).not.toHaveURL(/\/login/);

    // Session B's next server-verified request (getUser() in proxy.ts) must
    // now reject it, per Supabase's signOut({scope:'others'}) semantics.
    // NOTE: this depends on the Supabase project actually enforcing
    // session-level revocation on getUser() rather than only invalidating
    // the refresh token (leaving an unexpired access token usable until it
    // naturally expires) — this is why the requirement itself says "where
    // supported." If this assertion is flaky on a given project, check
    // that project's GoTrue version/session-revocation behavior before
    // assuming the app code is wrong.
    await pageB.goto("/account/security");
    await expect(pageB).toHaveURL(/\/login/);
  } finally {
    await contextA.close();
    await contextB.close();
    await deleteTestUser(admin, user.id);
  }
});
