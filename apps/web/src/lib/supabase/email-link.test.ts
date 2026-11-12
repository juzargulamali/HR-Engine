import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createServerClient } from "@supabase/ssr";
import { createEmailLinkClient } from "./email-link";

/**
 * The fault this client exists for, shown on the request each client sends to Supabase's "recover" address (nothing leaves the machine: the
 * request is captured). The session client asks for a link that only the asking browser can finish; the email-link client does not.
 */
const captured: { path: string; challenge: unknown; redirect: string | null }[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const body = JSON.parse(String(init?.body ?? "{}")) as { code_challenge?: unknown };
  captured.push({ path: url.pathname, challenge: body.code_challenge ?? null, redirect: url.searchParams.get("redirect_to") });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

afterEach(() => { captured.length = 0; vi.unstubAllGlobals(); });

describe("who can finish an emailed password link", () => {
  it("the session client asks for a code only the asking browser can exchange, and stores the secret in that browser's cookies", async () => {
    const cookies: string[] = [];
    const session = createServerClient("https://project.example.invalid", "anon", { global: { fetch: fakeFetch }, cookies: { getAll: () => [], setAll: (c) => { cookies.push(...c.map((x) => x.name)); } } });
    await session.auth.resetPasswordForEmail("test.person@example.invalid", { redirectTo: "https://app.example.invalid/set-password" });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.path).toBe("/auth/v1/recover");
    expect(captured[0]!.challenge).not.toBeNull();
    expect(cookies.some((n) => n.endsWith("code-verifier"))).toBe(true);
  });

  it("the email-link client asks for a plain link the recipient can finish in any browser, and writes no cookie", async () => {
    vi.stubGlobal("fetch", fakeFetch);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    await createEmailLinkClient().auth.resetPasswordForEmail("test.person@example.invalid", { redirectTo: "https://app.example.invalid/set-password" });
    expect(captured).toEqual([{ path: "/auth/v1/recover", challenge: null, redirect: "https://app.example.invalid/set-password" }]);
    vi.unstubAllEnvs();
  });
});
