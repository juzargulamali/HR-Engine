import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/email-link", () => ({ createEmailLinkClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { createEmailLinkClient } from "@/lib/supabase/email-link";
import { requestPasswordReset } from "./password";

const form = (email: string) => { const f = new FormData(); f.set("email", email); return f; };
afterEach(() => { vi.clearAllMocks(); delete process.env.NEXT_PUBLIC_SITE_URL; });

describe("requestPasswordReset (Forgot password)", () => {
  function clients(resetError: { status?: number; message: string } | null = null) {
    const send = vi.fn().mockResolvedValue({ error: resetError });
    const sessionSend = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createEmailLinkClient).mockReturnValue({ auth: { resetPasswordForEmail: send } } as never);
    vi.mocked(createClient).mockResolvedValue({ auth: { resetPasswordForEmail: sessionSend }, rpc } as never);
    return { send, sessionSend, rpc };
  }

  it("sends the link with the email-link client, to /reset-password, and never with the session client", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hr.example.test/";
    const c = clients();
    expect(await requestPasswordReset({ submitted: false, error: null }, form("person@example.invalid"))).toEqual({ submitted: true, error: null });
    expect(c.send).toHaveBeenCalledWith("person@example.invalid", { redirectTo: "https://hr.example.test/reset-password" });
    expect(c.sessionSend).not.toHaveBeenCalled();
    expect(c.rpc).toHaveBeenCalledWith("log_security_event", { p_action: "password_reset_requested", p_email: "person@example.invalid" });
  });

  it("gives the same answer whether or not the address is real, and sends nothing for a malformed one", async () => {
    const c = clients();
    expect(await requestPasswordReset({ submitted: false, error: null }, form("not-an-address"))).toEqual({ submitted: true, error: null });
    expect(c.send).not.toHaveBeenCalled();
  });

  it("only a rate limit is reported", async () => {
    clients({ status: 429, message: "email rate limit exceeded" });
    expect(await requestPasswordReset({ submitted: false, error: null }, form("person@example.invalid"))).toEqual({ submitted: false, error: "Too many requests — wait a few minutes and try again." });
  });
});
