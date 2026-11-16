import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase/admin";

const SECRET = "test-cron-secret";
const req = (auth = `Bearer ${SECRET}`) => new Request("https://example.test/api/cron/employment-changes", { headers: auth ? { authorization: auth } : {} });

type Result = { data?: unknown; error?: { message: string } | null };
function admin(result: Result) {
  const rpc = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ data: null, error: null, ...result }));
  const from = vi.fn();
  vi.mocked(createAdminClient).mockReturnValue({ rpc, from } as never);
  return { rpc, from };
}

beforeEach(() => vi.stubEnv("CRON_SECRET", SECRET));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("GET /api/cron/employment-changes", () => {
  it("refuses a request without the cron secret and touches nothing", async () => {
    const a = admin({});
    expect((await GET(req(""))).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it("makes ONE call to the database applier and sends it no country and no date: each employee's own calendar day is decided there", async () => {
    const a = admin({ data: { ran_at: "2026-11-17T00:45:00Z", applied: 3, skipped: 1, conflicts: 0, failed: 0, held: [], failures: [] } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(a.rpc).toHaveBeenCalledTimes(1);
    expect(a.rpc.mock.calls[0]).toEqual(["apply_due_employment_changes"]);
    expect(await res.json()).toMatchObject({ applied: 3, skipped: 1, conflicts: 0, failed: 0, errors: [] });
  });

  it("a failed application is a FAILURE of the run (500) that names the failed event, and the applications that succeeded in the same run are still reported", async () => {
    admin({ data: { applied: 2, skipped: 0, conflicts: 0, failed: 1, held: [], failures: [{ event_id: "ev-2", employee_id: "e-2", sqlstate: "23505", message: "duplicate key value" }] } });
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ applied: 2, failed: 1 });
    expect(body.failures).toEqual([{ event_id: "ev-2", employee_id: "e-2", sqlstate: "23505", message: "duplicate key value" }]);
  });

  it("an event held for HR review is reported with its employee but is not a failure: the run is still 200", async () => {
    admin({ data: { applied: 1, skipped: 0, conflicts: 1, failed: 0, held: [{ event_id: "ev-9", employee_id: "e-9" }], failures: [] } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applied: 1, conflicts: 1, failed: 0, held: [{ event_id: "ev-9", employee_id: "e-9" }] });
  });

  it("when the database call itself fails (not installed, unreachable) nothing ran and that is a 500 too, with the reason", async () => {
    admin({ data: null, error: { message: "Could not find the function public.apply_due_employment_changes" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ applied: 0, failed: 0, errors: ["Could not find the function public.apply_due_employment_changes"] });
  });
});
