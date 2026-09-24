import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This route is marked "server-only" so an accidental Client Component
// import fails at build time — vitest's Node environment isn't a Next.js
// build, so it throws on the bare import unless stubbed out here (same
// pattern as the leave-accrual cron route test).
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase/admin";

const CRON_SECRET = "test-cron-secret";

function authorizedRequest(): Request {
  return new Request("https://example.test/api/cron/comp-day-expiry", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/comp-day-expiry", () => {
  it("returns HTTP 500 and never reads or posts any expiry row when the employees id/country_code lookup fails", async () => {
    // Before the fix, a failed query here silently fell through to an empty
    // map, so resolveCountryTimeZone's unrecognised-country fallback quietly
    // treated EVERY employee as Dubai for expiry purposes instead of their
    // own country. The fix must fail loudly and stop before touching
    // comp_day_ledger at all.
    const fromCalls: string[] = [];
    const admin = {
      from(table: string) {
        fromCalls.push(table);
        if (table === "employees") {
          return { select: () => Promise.resolve({ data: null, error: { message: "employees lookup failed" } }) };
        }
        throw new Error(`unexpected query against "${table}" — the route must return before reaching this point`);
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);

    const response = await GET(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "employees lookup failed" });
    // Exactly one query was made, and it was the one that failed — nothing
    // in comp_day_ledger was ever read or written.
    expect(fromCalls).toEqual(["employees"]);
  });
});
