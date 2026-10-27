import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUser, resendInvite, deleteUserAccount } from "./users";
import { adminSendPasswordReset } from "./account-status";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const session = (grants: { role: string; companyId: string | null; countryCode: string | null }[]) =>
  ({ userId: ADMIN_ID, email: "admin@enginious.ae", fullName: "Admin", grants, employeeId: null }) as never;
const SYS_ADMIN = session([{ role: "sys_admin", companyId: null, countryCode: null }]);

// Everyone who is not a System Administrator, including people who hold other powerful roles.
const NOT_SYS_ADMIN: [string, ReturnType<typeof session> | null][] = [
  ["nobody signed in", null],
  ["a person with no role", session([])],
  ["an HR Admin", session([{ role: "hr_admin", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }])],
  ["a CEO", session([{ role: "ceo", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }])],
  ["a Finance person", session([{ role: "finance", companyId: "33333333-3333-4333-8333-333333333333", countryCode: null }])],
];

function inviteForm(email = "new.person@example.invalid", fullName = "New Person") {
  const f = new FormData();
  f.set("email", email);
  f.set("fullName", fullName);
  return f;
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe.each(NOT_SYS_ADMIN)("account actions are refused for %s, and reach no service", (_label, who) => {
  it("inviteUser, resendInvite, deleteUserAccount and adminSendPasswordReset", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(who);
    expect((await inviteUser({ error: null }, inviteForm())).error).toMatch(/Only a Sys Admin/);
    expect((await resendInvite("someone@example.invalid")).error).toMatch(/Only a Sys Admin/);
    expect((await deleteUserAccount(TARGET_ID)).error).toMatch(/Only a Sys Admin/);
    expect((await adminSendPasswordReset(TARGET_ID)).error).toMatch(/Only a System Administrator/);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("inviteUser", () => {
  it("invites by e-mail with the set-password page as the destination and records nothing else itself", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hr.example.test/";
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { inviteUserByEmail } } } as never);
    expect(await inviteUser({ error: null }, inviteForm())).toEqual({ error: null });
    expect(inviteUserByEmail).toHaveBeenCalledWith("new.person@example.invalid", { data: { full_name: "New Person" }, redirectTo: "https://hr.example.test/set-password" });
  });

  it("refuses a malformed address or a missing name before calling the service", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    expect((await inviteUser({ error: null }, inviteForm("not-an-address"))).error).toBeTruthy();
    expect((await inviteUser({ error: null }, inviteForm("a@example.invalid", ""))).error).toMatch(/Name is required/);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("points an existing address at 'Resend invite' instead of showing the raw message", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    const inviteUserByEmail = vi.fn().mockResolvedValue({ error: { message: "A user with this email address has already been registered" } });
    vi.mocked(createAdminClient).mockReturnValue({ auth: { admin: { inviteUserByEmail } } } as never);
    expect((await inviteUser({ error: null }, inviteForm())).error).toMatch(/already has an account.*Resend invite/);
  });
});

describe("resendInvite and adminSendPasswordReset", () => {
  function userClient(profile: { id?: string; email?: string } | null, resetError: { message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: resetError });
    const maybeSingle = vi.fn().mockResolvedValue({ data: profile });
    const client = { rpc, auth: { resetPasswordForEmail }, from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) })) };
    vi.mocked(createClient).mockResolvedValue(client as never);
    return { rpc, resetPasswordForEmail, from: client.from };
  }

  it("resend sends the reset-style e-mail to /set-password and logs invitation_resent against the account", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hr.example.test";
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    const c = userClient({ id: TARGET_ID });
    expect(await resendInvite("invited@example.invalid")).toEqual({ error: null });
    expect(c.resetPasswordForEmail).toHaveBeenCalledWith("invited@example.invalid", { redirectTo: "https://hr.example.test/set-password" });
    expect(c.rpc).toHaveBeenCalledWith("log_security_event", { p_action: "invitation_resent", p_target_user_id: TARGET_ID });
  });

  it("resend refuses a malformed address and does not log when the e-mail failed", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    expect((await resendInvite("nope")).error).toBe("Invalid email.");
    const c = userClient({ id: TARGET_ID }, { message: "smtp down" });
    expect((await resendInvite("invited@example.invalid")).error).toBe("smtp down");
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("admin reset re-reads the address from the account (never trusts the caller), goes to /reset-password and logs it", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hr.example.test";
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    const c = userClient({ email: "real.address@example.invalid" });
    expect(await adminSendPasswordReset(TARGET_ID)).toEqual({ error: null });
    expect(c.resetPasswordForEmail).toHaveBeenCalledWith("real.address@example.invalid", { redirectTo: "https://hr.example.test/reset-password" });
    expect(c.rpc).toHaveBeenCalledWith("log_security_event", { p_action: "password_reset_sent_by_admin", p_target_user_id: TARGET_ID });
  });

  it("admin reset refuses a malformed account id and an unknown account without sending anything", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    expect((await adminSendPasswordReset("not-a-uuid")).error).toBe("Invalid account.");
    const c = userClient(null);
    expect((await adminSendPasswordReset(TARGET_ID)).error).toBe("Account not found.");
    expect(c.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("deleteUserAccount", () => {
  function adminClient(deleteError: { message: string } | null) {
    const eqAfterUpdate = { eq: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue({ error: null }), then: undefined as unknown };
    const update = vi.fn(() => ({ eq: vi.fn().mockReturnValue(eqAfterUpdate) }));
    const deleteUser = vi.fn().mockResolvedValue({ error: deleteError });
    const from = vi.fn((_table: string) => ({ update }));
    const client = { from, auth: { admin: { deleteUser } } };
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    return { deleteUser, from };
  }

  it("never lets a System Administrator delete their own login", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    expect((await deleteUserAccount(ADMIN_ID)).error).toMatch(/can't delete your own account/);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("unlinks the employee record and revokes roles before deleting, and reports success", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    const c = adminClient(null);
    expect(await deleteUserAccount(TARGET_ID)).toEqual({ error: null });
    expect(c.from.mock.calls.map((a) => a[0])).toEqual(["employees", "user_roles"]);
    expect(c.deleteUser).toHaveBeenCalledWith(TARGET_ID);
  });

  it("explains a refusal caused by historical records instead of showing the raw database error", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN);
    adminClient({ message: "update or delete on table users violates foreign key constraint" });
    expect((await deleteUserAccount(TARGET_ID)).error).toMatch(/tied to historical records/);
  });
});
