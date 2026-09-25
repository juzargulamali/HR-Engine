import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reactivateAccount, deactivateAccount, checkAccountStatusConsistency } from "./account-status";

const SYS_ADMIN_SESSION = {
  userId: "11111111-1111-1111-1111-111111111111",
  email: "admin@enginious.ae",
  fullName: "Admin",
  grants: [{ role: "sys_admin" as const, companyId: null, countryCode: null }],
  employeeId: null,
};

const TARGET_USER_ID = "22222222-2222-4222-8222-222222222222";
const REASON = "appeal approved";

function fakeSupabaseClient(rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>) {
  return { rpc: vi.fn(rpcImpl) };
}

function fakeAdminClient(updateUserByIdImpl: () => Promise<{ error: { message: string } | null }>) {
  return { auth: { admin: { updateUserById: vi.fn(updateUserByIdImpl) } } };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("reactivateAccount", () => {
  it("rejects a caller who isn't a System Administrator", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({ ...SYS_ADMIN_SESSION, grants: [] });
    const result = await reactivateAccount(TARGET_USER_ID, REASON);
    expect(result.error).toMatch(/Only a System Administrator/);
  });

  it("(a) never attempts the unban when the profile update itself fails, and reports the RPC's own message", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: "This account no longer exists" } });
    vi.mocked(createClient).mockResolvedValue(fakeSupabaseClient(rpc) as unknown as Awaited<ReturnType<typeof createClient>>);
    const updateUserById = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue(
      { auth: { admin: { updateUserById } } } as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await reactivateAccount(TARGET_USER_ID, REASON);

    expect(result.error).toBe("This account no longer exists");
    expect(updateUserById).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("(b) compensates back to deactivated when the unban fails, and reports failure — never success", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { error: null }; // both the activate call and the compensating deactivate call succeed
    });
    vi.mocked(createClient).mockResolvedValue(fakeSupabaseClient(rpc) as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient(async () => ({ error: { message: "internal GoTrue failure XYZ" } })) as unknown as ReturnType<
        typeof createAdminClient
      >,
    );

    const result = await reactivateAccount(TARGET_USER_ID, REASON);

    expect(result.error).toBe("Reactivation could not be completed; account access remains suspended.");
    // Never leaks the raw Admin API error text.
    expect(result.error).not.toContain("GoTrue");
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0]).toMatchObject({ fn: "set_account_status", args: { p_new_status: "active" } });
    expect(rpcCalls[1]).toMatchObject({ fn: "set_account_status", args: { p_new_status: "deactivated" } });
    // The compensating reason must never silently claim the admin wrote it.
    expect((rpcCalls[1]!.args.p_reason as string)).toMatch(/^System:/);
  });

  it("(c) reports manual reconciliation and logs a security event when compensation ALSO fails", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "set_account_status" && args?.p_new_status === "active") return { error: null };
      if (fn === "set_account_status" && args?.p_new_status === "deactivated") {
        return { error: { message: "deadlock detected" } };
      }
      if (fn === "log_security_event") return { error: null };
      throw new Error(`unexpected rpc call: ${fn}`);
    });
    vi.mocked(createClient).mockResolvedValue(fakeSupabaseClient(rpc) as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient(async () => ({ error: { message: "internal GoTrue failure XYZ" } })) as unknown as ReturnType<
        typeof createAdminClient
      >,
    );

    const result = await reactivateAccount(TARGET_USER_ID, REASON);

    expect(result.error).toMatch(/Manual reconciliation required/i);
    expect(result.error).not.toContain("deadlock");
    expect(result.error).not.toContain("GoTrue");
    const loggedEvent = rpcCalls.find((c) => c.fn === "log_security_event");
    expect(loggedEvent).toBeDefined();
    expect(loggedEvent!.args).toMatchObject({ p_action: "account_reconciliation_required", p_target_user_id: TARGET_USER_ID });
  });

  it("reports success only when both the profile update and the unban succeed", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue(fakeSupabaseClient(rpc) as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient(async () => ({ error: null })) as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await reactivateAccount(TARGET_USER_ID, REASON);

    expect(result.error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("deactivateAccount", () => {
  it("never exposes the raw Admin API error when the ban call fails", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    const rpc = vi.fn();
    vi.mocked(createClient).mockResolvedValue(fakeSupabaseClient(rpc) as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient(async () => ({ error: { message: "internal GoTrue failure XYZ" } })) as unknown as ReturnType<
        typeof createAdminClient
      >,
    );

    const result = await deactivateAccount(TARGET_USER_ID, REASON);

    expect(result.error).not.toContain("GoTrue");
    expect(rpc).not.toHaveBeenCalled();
  });
});

function fakeClientWithProfile(accountStatus: "active" | "deactivated" | "invited" | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: accountStatus ? { account_status: accountStatus } : null }),
        }),
      }),
    }),
  };
}

function fakeAdminClientWithBan(bannedUntil: string | undefined) {
  return {
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: { user: { banned_until: bannedUntil } }, error: null }),
      },
    },
  };
}

const FUTURE_DATE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
const PAST_DATE = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

describe("checkAccountStatusConsistency", () => {
  it("rejects a caller who isn't a System Administrator", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue({ ...SYS_ADMIN_SESSION, grants: [] });
    const result = await checkAccountStatusConsistency(TARGET_USER_ID);
    expect(result.error).toMatch(/Only a System Administrator/);
  });

  it("reports consistent when Deactivated and actually banned", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    vi.mocked(createClient).mockResolvedValue(fakeClientWithProfile("deactivated") as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClientWithBan(FUTURE_DATE) as unknown as ReturnType<typeof createAdminClient>);

    const result = await checkAccountStatusConsistency(TARGET_USER_ID);

    expect(result.error).toBeNull();
    expect(result.consistent).toBe(true);
  });

  it("reports consistent when Active and not banned", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    vi.mocked(createClient).mockResolvedValue(fakeClientWithProfile("active") as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClientWithBan(undefined) as unknown as ReturnType<typeof createAdminClient>);

    const result = await checkAccountStatusConsistency(TARGET_USER_ID);

    expect(result.error).toBeNull();
    expect(result.consistent).toBe(true);
  });

  it("reports the DANGEROUS inconsistency: shown Deactivated but not actually banned (can still log in)", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    vi.mocked(createClient).mockResolvedValue(fakeClientWithProfile("deactivated") as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClientWithBan(undefined) as unknown as ReturnType<typeof createAdminClient>);

    const result = await checkAccountStatusConsistency(TARGET_USER_ID);

    expect(result.error).toBeNull();
    expect(result.consistent).toBe(false);
    expect(result.detail).toMatch(/can still log in/i);
  });

  it("reports the safe-direction inconsistency: shown Active but still banned", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    vi.mocked(createClient).mockResolvedValue(fakeClientWithProfile("active") as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClientWithBan(FUTURE_DATE) as unknown as ReturnType<typeof createAdminClient>);

    const result = await checkAccountStatusConsistency(TARGET_USER_ID);

    expect(result.error).toBeNull();
    expect(result.consistent).toBe(false);
    expect(result.detail).toMatch(/cannot log in/i);
  });

  it("treats a past-dated banned_until as not currently banned", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    vi.mocked(createClient).mockResolvedValue(fakeClientWithProfile("active") as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClientWithBan(PAST_DATE) as unknown as ReturnType<typeof createAdminClient>);

    const result = await checkAccountStatusConsistency(TARGET_USER_ID);

    expect(result.consistent).toBe(true);
  });

  it("never returns the raw banned_until timestamp to the caller", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(SYS_ADMIN_SESSION);
    vi.mocked(createClient).mockResolvedValue(fakeClientWithProfile("deactivated") as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClientWithBan(FUTURE_DATE) as unknown as ReturnType<typeof createAdminClient>);

    const result = await checkAccountStatusConsistency(TARGET_USER_ID);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FUTURE_DATE);
  });
});
