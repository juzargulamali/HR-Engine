import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { configurationErrorPage, missingSettings } from "@/lib/config-check";
import { proxy } from "./proxy";

describe("missingSettings", () => {
  it("reports each required setting that is absent, empty or blank", () => {
    expect(missingSettings({})).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(missingSettings({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "  " })).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    expect(missingSettings({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual([]);
  });
  it("the page names settings and never prints a value", () => {
    const html = configurationErrorPage(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(html).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(html).toContain("Nothing was bypassed");
  });
});

describe("proxy in an unconfigured environment", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["/", "/login", "/leave", "/api/cron/crm-reminders"])("fails closed with an explanation on %s (503, no redirect, no page content)", async (path) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(new NextRequest(`https://preview.example${path}`));
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(body).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
