import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { GET } from "./route";
import { createAdminClient } from "@/lib/supabase/admin";

const SECRET = "test-cron-secret";
const req = (auth = `Bearer ${SECRET}`) => new Request("https://example.test/api/cron/employment-changes", { headers: auth ? { authorization: auth } : {} });

type Result = { data?: unknown; error?: { message: string } | null };
function admin(opts: { scheduled?: Result; employees?: Result; rpc?: (args: { p_country: string; p_today: string }) => Result }) {
  const rpc = vi.fn(async (_name: string, args: { p_country: string; p_today: string }) => opts.rpc?.(args) ?? { data: { applied: 0, skipped: 0, failed: 0 }, error: null });
  const client = {
    from: vi.fn((table: string) => table === "employee_career_events"
      ? { select: () => ({ is: async () => opts.scheduled ?? { data: [], error: null } }) }
      : { select: () => ({ in: async () => opts.employees ?? { data: [], error: null } }) }),
    rpc,
  };
  vi.mocked(createAdminClient).mockReturnValue(client as never);
  return { client, rpc };
}

beforeEach(() => vi.stubEnv("CRON_SECRET", SECRET));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("GET /api/cron/employment-changes", () => {
  it("refuses a request without the cron secret and touches nothing", async () => {
    const a = admin({});
    expect((await GET(req(""))).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(a.client.from).not.toHaveBeenCalled();
  });

  it("does nothing when no change is scheduled", async () => {
    const a = admin({ scheduled: { data: [], error: null } });
    const res = await GET(req());
    expect(await res.json()).toMatchObject({ applied: 0, countries: [] });
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it("calls the applier once per country present, with that country's own calendar day, and totals the answers", async () => {
    const a = admin({
      scheduled: { data: [{ employee_id: "e1" }, { employee_id: "e2" }, { employee_id: "e3" }], error: null },
      employees: { data: [{ id: "e1", country_code: "AE" }, { id: "e2", country_code: "AE" }, { id: "e3", country_code: "PL" }], error: null },
      rpc: ({ p_country }) => ({ data: p_country === "AE" ? { applied: 2, skipped: 1, failed: 0 } : { applied: 1, skipped: 0, failed: 0 }, error: null }),
    });
    const body = await (await GET(req())).json();
    expect(a.rpc).toHaveBeenCalledTimes(2);
    expect(a.rpc.mock.calls.map((c) => c[1].p_country).sort()).toEqual(["AE", "PL"]);
    for (const c of a.rpc.mock.calls) expect(c[1].p_today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body).toMatchObject({ applied: 3, skipped: 1, failed: 0, errors: [] });
  });

  it("fails loudly (500) when the countries cannot be read, and when a country's run fails, without hiding the others", async () => {
    admin({ scheduled: { data: [{ employee_id: "e1" }], error: null }, employees: { data: null, error: { message: "boom" } } });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });

    const a = admin({
      scheduled: { data: [{ employee_id: "e1" }, { employee_id: "e3" }], error: null },
      employees: { data: [{ id: "e1", country_code: "AE" }, { id: "e3", country_code: "PL" }], error: null },
      rpc: ({ p_country }) => (p_country === "AE" ? { data: null, error: { message: "denied" } } : { data: { applied: 1, skipped: 0, failed: 0 }, error: null }),
    });
    const res2 = await GET(req());
    expect(res2.status).toBe(500);
    expect(await res2.json()).toMatchObject({ applied: 1, errors: ["AE: denied"] });
    expect(a.rpc).toHaveBeenCalledTimes(2);
  });
});
