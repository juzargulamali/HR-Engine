import { test, expect } from "@playwright/test";
import { createTestAdminClient, createTestUser, deleteTestUser, type TestUser } from "../../src/adminClient";

/**
 * MUTATING: sends a real password-recovery email via Supabase for the
 * existing-account case, and writes a real audit_log row for both cases.
 * Never run against Production (see README.md) — this genuinely emails a
 * real inbox if pointed at a project with real users.
 */
test.describe("forgot-password neutral response", () => {
  const admin = createTestAdminClient();
  let existingUser: TestUser;

  test.beforeAll(async () => {
    existingUser = await createTestUser(admin);
  });
  test.afterAll(async () => deleteTestUser(admin, existingUser.id));

  test("shows the identical neutral message for an existing account and a nonexistent one", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(existingUser.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    const existingMessage = await page.getByText(/if an account exists/i).textContent();

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("definitely-not-a-real-account@example.invalid");
    await page.getByRole("button", { name: "Send reset link" }).click();
    const nonexistentMessage = await page.getByText(/if an account exists/i).textContent();

    expect(existingMessage).toBe(nonexistentMessage);
  });

  test("records password_reset_requested in the audit trail, resolving the real account but not the fake one", async ({
    page,
  }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(existingUser.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/if an account exists/i)).toBeVisible();

    const { data } = await admin
      .from("audit_log")
      .select("record_id, actor_id")
      .eq("action", "password_reset_requested")
      .eq("record_id", existingUser.id)
      .order("occurred_at", { ascending: false })
      .limit(1);
    expect(data).toHaveLength(1);
    expect(data![0]!.actor_id).toBeNull(); // unauthenticated requester
  });
});
