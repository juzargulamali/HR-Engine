import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Runs the REAL proxy() with only @supabase/ssr replaced, so the redirect
// logic under test is the production code, not a copy of it.
const getUser = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { proxy } from "./proxy";
import { ALLOW_SCHEDULED_ROUTES_ENV, SCHEDULED_ROUTE_PATHS } from "./lib/cron/scheduled-routes";

const ORIGIN = "http://localhost:3000";

function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

function signedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
}

/** A request shaped like Vercel Cron's: Bearer secret, no cookie. */
function cronRequest(pathname: string): NextRequest {
  return new NextRequest(`${ORIGIN}${pathname}`, { headers: { authorization: "Bearer not-a-real-secret" } });
}

function isRedirectToLogin(response: Response): boolean {
  if (response.status !== 307) return false;
  const location = response.headers.get("location");
  return location !== null && new URL(location).pathname === "/login";
}

/** NextResponse.next() marks a pass-through with this header; a redirect never carries it. */
function isPassThrough(response: Response): boolean {
  return response.status === 200 && response.headers.get("x-middleware-next") === "1";
}

const SCHEDULED = [...SCHEDULED_ROUTE_PATHS];
const NOT_LISTED_API = [
  "/api/cron/leave-accrual-evil",
  "/api/cron/leave-accrual/",
  "/api/cron/leave-accrual/extra",
  "/api/cron/Leave-Accrual",
  "/API/CRON/leave-accrual",
  "/api/cron",
  "/api/cron/",
  "/api/cron/unknown-job",
  "/api/ai/other",
  "/api/ai/detect-balance-discrepancies-evil",
  "/api/health",
  "/api/anything-else",
  "/api/cron/leave-accrual/../x",
  "/api/cron/leave-accrual/%2e%2e/x",
  "/api/cron/leave-accrual%2Fevil",
  "/api/cron/leave-accrual;x",
];
const APP_PAGES = ["/", "/dashboard", "/employees", "/leave", "/attendance", "/admin/users", "/approvals"];

describe("proxy() and the scheduled routes", () => {
  const original = process.env[ALLOW_SCHEDULED_ROUTES_ENV];

  beforeEach(() => {
    getUser.mockReset();
    signedOut();
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ALLOW_SCHEDULED_ROUTES_ENV];
    else process.env[ALLOW_SCHEDULED_ROUTES_ENV] = original;
  });

  describe("flag unset (the default): today's behaviour, unchanged", () => {
    beforeEach(() => {
      delete process.env[ALLOW_SCHEDULED_ROUTES_ENV];
    });

    it.each(SCHEDULED)("%s without a session redirects to /login (this is the production defect)", async (pathname) => {
      const response = await proxy(cronRequest(pathname));
      expect(isRedirectToLogin(response)).toBe(true);
      expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe(pathname);
    });

    it.each([...NOT_LISTED_API, ...APP_PAGES])("%s without a session redirects to /login", async (pathname) => {
      expect(isRedirectToLogin(await proxy(cronRequest(pathname)))).toBe(true);
    });

    it("public pages stay reachable and a signed-in user still passes through", async () => {
      expect(isPassThrough(await proxy(cronRequest("/login")))).toBe(true);
      expect(isPassThrough(await proxy(cronRequest("/forgot-password")))).toBe(true);
      signedIn();
      expect(isPassThrough(await proxy(cronRequest("/dashboard")))).toBe(true);
      expect(isPassThrough(await proxy(cronRequest("/api/cron/leave-accrual")))).toBe(true);
    });
  });

  describe("flag set to something other than the exact string 'on'", () => {
    it.each(["true", "1", "ON", "On", "yes", " on", "on ", "", "off"])("value %j does not enable it", async (value) => {
      process.env[ALLOW_SCHEDULED_ROUTES_ENV] = value;
      for (const pathname of SCHEDULED) {
        expect(isRedirectToLogin(await proxy(cronRequest(pathname)))).toBe(true);
      }
    });
  });

  describe("flag set to exactly 'on'", () => {
    beforeEach(() => {
      process.env[ALLOW_SCHEDULED_ROUTES_ENV] = "on";
    });

    it.each(SCHEDULED)("%s passes through without a session so the route's own CRON_SECRET check can run", async (pathname) => {
      expect(isPassThrough(await proxy(cronRequest(pathname)))).toBe(true);
    });

    it("also passes through when called with a query string (Vercel may add none, preflight adds one)", async () => {
      expect(isPassThrough(await proxy(cronRequest("/api/cron/leave-accrual?mode=preflight")))).toBe(true);
    });

    it.each(NOT_LISTED_API)("%s is NOT exempt and still redirects to /login", async (pathname) => {
      expect(isRedirectToLogin(await proxy(cronRequest(pathname)))).toBe(true);
    });

    it.each(APP_PAGES)("application page %s still redirects to /login", async (pathname) => {
      expect(isRedirectToLogin(await proxy(cronRequest(pathname)))).toBe(true);
    });

    it("the exemption list is exactly the five scheduled paths, nothing else", async () => {
      expect([...SCHEDULED_ROUTE_PATHS].sort()).toEqual(
        [
          "/api/ai/detect-balance-discrepancies",
          "/api/cron/comp-day-expiry",
          "/api/cron/document-expiry",
          "/api/cron/leave-accrual",
          "/api/cron/recovery-windows",
        ].sort(),
      );
    });

    it("does not change what a signed-in user sees on /login", async () => {
      signedIn();
      const response = await proxy(cronRequest("/login"));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/");
    });
  });

  it("SCHEDULED_ROUTE_PATHS matches the crons in vercel.json exactly (no drift)", () => {
    const vercelJson = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../vercel.json"), "utf8")) as {
      crons: { path: string }[];
    };
    expect([...SCHEDULED_ROUTE_PATHS].sort()).toEqual(vercelJson.crons.map((c) => c.path).sort());
  });
});
