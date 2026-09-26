import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut, signOutEverywhere } from "./auth";

afterEach(() => {
  vi.clearAllMocks();
});

describe("signOut", () => {
  it("ends only the current session (scope: local), not every session for the account", async () => {
    const signOutMock = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({ auth: { signOut: signOutMock } } as unknown as Awaited<
      ReturnType<typeof createClient>
    >);

    await signOut();

    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("signOutEverywhere", () => {
  it("ends every session for the account (scope: global) — the real all-devices case", async () => {
    const signOutMock = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createClient).mockResolvedValue({ auth: { signOut: signOutMock }, rpc } as unknown as Awaited<
      ReturnType<typeof createClient>
    >);

    await signOutEverywhere();

    expect(signOutMock).toHaveBeenCalledWith({ scope: "global" });
    expect(rpc).toHaveBeenCalledWith("log_security_event", { p_action: "all_device_signout_requested" });
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
