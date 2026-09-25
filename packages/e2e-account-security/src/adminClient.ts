import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for test SETUP/TEARDOWN only (creating/deleting
 * disposable test accounts, seeding account_status, reading audit_log to
 * assert an event was recorded) — never used by a spec to act AS a user or
 * to bypass what the UI itself should enforce. Every actual test action
 * goes through the browser/UI, exactly like a real user.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY, which must never be set when running
 * against Production for tests/mutating/ (see README.md) — this file
 * throws immediately if the required env vars are missing, rather than
 * silently no-op-ing.
 */
export function createTestAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run tests/mutating/ — see packages/e2e-account-security/README.md",
    );
  }
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/**
 * Creates a disposable, already-confirmed test account (skips the invite-
 * email step entirely — createUser + email_confirm: true, rather than
 * inviteUserByEmail, since these tests need a known password immediately,
 * not a one-time link). Every email is namespaced under a fixed test
 * domain and a random suffix so parallel/rerun test runs never collide,
 * and so it's obvious in a real project's user list which accounts are
 * disposable test fixtures.
 */
export async function createTestUser(
  admin: ReturnType<typeof createTestAdminClient>,
  opts: { role?: "hr_admin" | "sys_admin"; companyId?: string } = {},
): Promise<TestUser> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-account-security-${suffix}@example.invalid`;
  const password = `Test-Passw0rd-${suffix}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "E2E Test User" },
  });
  if (error || !data.user) throw new Error(`createTestUser failed: ${error?.message}`);

  // profiles row is auto-created by the handle_new_auth_user trigger; flip
  // it straight to 'active' — these tests aren't exercising the invite flow.
  await admin.from("profiles").update({ account_status: "active" }).eq("id", data.user.id);

  if (opts.role) {
    await admin.from("user_roles").insert({ user_id: data.user.id, role: opts.role, company_id: opts.companyId ?? null });
  }

  return { id: data.user.id, email, password };
}

export async function deleteTestUser(admin: ReturnType<typeof createTestAdminClient>, userId: string): Promise<void> {
  await admin.from("user_roles").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
}
