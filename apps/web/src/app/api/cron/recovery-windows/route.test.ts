import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase/admin";

const CRON_SECRET = "test-cron-secret";

function request(authorization?: string): Request {
  return new Request("https://example.test/api/cron/recovery-windows", { headers: authorization ? { authorization } : {} });
}

function mockRpc(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
  return rpc;
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/recovery-windows", () => {
  it("rejects a request with no or the wrong secret before touching the database", async () => {
    const rpc = mockRpc({ data: { status: "succeeded" }, error: null });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    expect((await GET(request(`Basic ${CRON_SECRET}`))).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses to run at all when CRON_SECRET is not configured", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", "");
    const rpc = mockRpc({ data: { status: "succeeded" }, error: null });
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs the database processor once, labelled as the Vercel safety-net, and relays its result", async () => {
    const rpc = mockRpc({ data: { status: "succeeded", examined: 3, failed: 0 }, error: null });
    const response = await GET(request(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "succeeded", examined: 3, failed: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("recovery_process_due", { p_origin: "vercel_cron" });
  });

  it("is observable when it fails: a database error and a partial run both return a non-2xx status", async () => {
    mockRpc({ data: null, error: { message: "boom" } });
    const failed = await GET(request(`Bearer ${CRON_SECRET}`));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "boom" });

    mockRpc({ data: { status: "partial", examined: 4, failed: 1 }, error: null });
    const partial = await GET(request(`Bearer ${CRON_SECRET}`));
    expect(partial.status).toBe(500);
    expect((await partial.json()).failed).toBe(1);
  });

  it("treats an overlapping run (already running) as a normal, successful no-op", async () => {
    mockRpc({ data: { status: "skipped_already_running" }, error: null });
    const response = await GET(request(`Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
  });
});
