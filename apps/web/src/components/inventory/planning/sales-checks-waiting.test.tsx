/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingDates, pendingTechnologies, type PendingSalesCheck } from "@/lib/inventory/planning";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
let rpcResult: { data: unknown; error: { code?: string; message: string } | null } = { data: [], error: null };
const rpc = vi.fn(async () => rpcResult);
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { SalesChecksWaiting } from "./sales-checks-waiting";

const check = (over: Partial<PendingSalesCheck> = {}): PendingSalesCheck => ({
  check_id: "k1", opportunity_id: "o1", company_id: "c1", reference: "OPP-UAE-2026-0003", requested_at: "2026-10-25T09:27:00Z", requested_by: "juzar",
  location_id: "l1", location_name: "Dubai", install_start: "2026-11-01", event_start: "2026-11-02", event_end: "2026-11-04",
  technologies: [{ name: "Laptop", qty: 1 }, { name: "LED wall", qty: "2" }], ...over,
});
const locations = [{ id: "l1", company_id: "c1", name: "Dubai" }, { id: "l2", company_id: "c2", name: "Elsewhere" }];
const render = async () => renderToStaticMarkup((await SalesChecksWaiting({ locations })) ?? <></>);

beforeEach(() => { rpcResult = { data: [], error: null }; rpc.mockClear(); });

describe("pending check wording", () => {
  it("names technologies with quantities, and says so when none are listed", () => {
    expect(pendingTechnologies(check())).toBe("Laptop × 1, LED wall × 2");
    expect(pendingTechnologies(check({ technologies: [] }))).toBe("No technologies listed yet");
    expect(pendingTechnologies(check({ technologies: [{ name: "  ", qty: 1 }] }))).toBe("No technologies listed yet");
  });
  it("gives the dates in the order they happen", () => {
    expect(pendingDates(check())).toBe("Install 1 Nov 2026 · Event 2 Nov 2026 to 4 Nov 2026");
    expect(pendingDates(check({ install_start: null, event_start: "2026-11-02", event_end: "2026-11-02" }))).toBe("Event 2 Nov 2026");
    expect(pendingDates(check({ install_start: null, event_start: null, event_end: null }))).toBe("Dates not set");
  });
});

describe("SalesChecksWaiting", () => {
  it("shows nothing when nothing is waiting", async () => {
    expect(await render()).toBe("");
  });

  it("lists each waiting request with the little the warehouse needs, and a way to answer it", async () => {
    rpcResult = { data: [check()], error: null };
    const html = await render();
    expect(html).toContain("Sales checks waiting (1)");
    expect(html).toContain("OPP-UAE-2026-0003");
    expect(html).toContain("Laptop × 1, LED wall × 2");
    expect(html).toContain("Asked for Dubai");
    expect(html).toContain("asked by juzar");
    expect(html).toContain("Record the check");
    expect(html).toContain("reserves nothing");
  });

  it("says no location was chosen when Sales did not name one", async () => {
    rpcResult = { data: [check({ location_id: null, location_name: null })], error: null };
    expect(await render()).toContain("No location chosen yet");
  });

  it("says nothing, never an alarm, when the function is not there yet or the person may not answer checks", async () => {
    for (const error of [{ code: "42883", message: "function inv_pending_sales_checks() does not exist" }, { code: "42501", message: "permission denied" }]) {
      rpcResult = { data: null, error };
      expect(await render()).toBe("");
    }
  });

  it("says it could not load, rather than nothing is waiting, when the read fails for another reason", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "connection lost" } };
    expect(await render()).toContain("could not be loaded");
  });
});
